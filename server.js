import textToSpeech from '@google-cloud/text-to-speech';
import { GoogleGenerativeAI } from "@google/generative-ai";
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket, { WebSocketServer } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '.')));

// API初期化
let genAI, ttsClient;
try {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    ttsClient = new textToSpeech.TextToSpeechClient({ 
        credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON) 
    });
} catch (e) { console.error("Init Error:", e.message); }

// --- 音声合成 (SSML) ---
function createSSML(text, mood) {
    let rate = "1.1", pitch = "+2st"; 
    if (mood === "thinking") { rate = "1.0"; pitch = "0st"; }
    if (mood === "gentle") { rate = "0.95"; pitch = "+1st"; }
    if (mood === "excited") { rate = "1.2"; pitch = "+4st"; }
    
    let cleanText = text
        .replace(/[\u{1F600}-\u{1F6FF}]/gu, '')
        .replace(/🐾|✨|⭐|🎵|🐟|🎤|⭕️|❌/g, '')
        .replace(/&/g, 'と').replace(/[<>"']/g, ' ');

    if (cleanText.length < 5 || cleanText.includes("どの教科")) {
        return `<speak>${cleanText}</speak>`;
    }
    cleanText = cleanText.replace(/……/g, '<break time="500ms"/>');
    return `<speak><prosody rate="${rate}" pitch="${pitch}">${cleanText}</prosody></speak>`;
}

app.post('/synthesize', async (req, res) => {
    try {
        if (!ttsClient) throw new Error("TTS not ready");
        const { text, mood } = req.body;
        if (!text) return res.status(400).json({ error: "No text" });
        const [response] = await ttsClient.synthesizeSpeech({
            input: { ssml: createSSML(text, mood) },
            voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' }, 
            audioConfig: { audioEncoding: 'MP3' },
        });
        res.json({ audioContent: response.audioContent.toString('base64') });
    } catch (err) { res.status(500).send(err.message); }
});

// --- 給食リアクションAPI ---
app.post('/lunch-reaction', async (req, res) => {
    try {
        const { count, name } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const isSpecial = count % 10 === 0;
        let prompt = isSpecial 
            ? `ネル先生として、給食${count}個目の感謝を熱く語って。相手:${name}。60文字程度。注釈禁止。`
            : `ネル先生として、給食を食べた一言感想。15文字以内。語尾にゃ。`;
        const result = await model.generateContent(prompt);
        let reply = result.response.text().trim();
        if(!isSpecial && reply.includes('\n')) reply = reply.split('\n')[0];
        res.json({ reply, isSpecial });
    } catch (err) { res.status(500).json({ error: "Error" }); }
});

// --- チャットAPI ---
app.post('/chat', async (req, res) => {
    try {
        const { message, grade, name } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const prompt = `あなたは「ネル先生」。相手は小学${grade}年生「${name}」。30文字以内、語尾「にゃ」。絵文字禁止。発言: ${message}`;
        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text() });
    } catch (err) { res.status(500).json({ error: "Chat Error" }); }
});

// --- ★画像分析API (教科別ルール強化版) ---
app.post('/analyze', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { image, mode, grade, subject } = req.body;
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash", 
            generationConfig: { responseMimeType: "application/json" } 
        });

        // ■ 教科別ルール定義
        const subjectRules = {
            'さんすう': {
                attention: `
                - 筆算の横線とマイナス記号を混同しないこと。
                - 累乗（2^2など）や分数を正確に書き起こすこと。`,
                hints: `
                - ヒント1（立式）: 「何算を使えばいいか」のヒント（例：合わせていくつだから足し算にゃ）。
                - ヒント2（注目点）: 「単位のひっかけ」や「図の数値」への誘導。
                - ヒント3（計算のコツ）: 「計算の工夫」や「最終確認」。`,
                grading: `
                - 筆算の繰り上がりメモを「答え」と見間違えないこと。
                - 単位（cm, Lなど）が必要な問題で、単位がない場合はバツにする。
                - 数字の「0」と「6」、「1」と「7」の見間違いに注意し、文脈から判断する。`
            },
            'こくご': {
                attention: `
                - ふりがな（ルビ）は無視して、本文の漢字と送り仮名を正確に。
                - 縦書きの場合は右から左へ読むこと。
                - 漢字書取り問題は『⬜︎⬜︎(ふりがな)』のように書き起こす。
                - 長文読解の本文自体は書き起こし不要（設問のみ抽出）。`,
                hints: `
                【漢字書き取りの場合】
                - ヒント1: 「漢字のなりたち」や意味。
                - ヒント2: 「辺やつくり、画数」。
                - ヒント3: 「似ている漢字」との違い。
                【読解問題の場合】
                - ヒント1（場所）: 「答えが文章のどこにあるか」。
                - ヒント2（キーワード）: 「注目すべき接続詞や言葉」。
                - ヒント3（答え方）: 「文末の指定（〜こと、等）」。`,
                grading: `
                - 漢字の「トメ・ハネ・ハライ」を厳しく判定する。
                - 送り仮名が間違っている場合はバツ。
                - 読解問題では、文末が適切か（〜から、〜こと 等）もチェックする。`
            },
            'りか': {
                attention: `
                - グラフの軸ラベルや単位（g, cm, ℃）を落とさないこと。
                - 記号選択（ア、イ、ウ）の選択肢も全て書き出すこと。
                - 図や表の近くにある最初の問題を見逃さないこと。`,
                hints: `
                - ヒント1（観察）: 「図や表のどこを見るか」（例：グラフの変化点）。
                - ヒント2（関連知識）: 「習った言葉や実験器具の名前」の想起。
                - ヒント3（絞り込み）: 「選択肢のヒント」や「用語の最初の1文字」。`,
                grading: `
                - カタカナ指定の用語（ジョウロ等）をひらがなで書いていたらバツ。
                - グラフ描画問題は、点の位置や線の直線性も厳しく見る。`
            },
            'しゃかい': {
                attention: `
                - グラフの軸ラベルや単位、地図記号を正確に。
                - 記号選択の選択肢を全て書き出す。
                - 資料周辺の問題を見逃さないこと。`,
                hints: `
                - ヒント1（観察）: 「資料・地図・グラフの注目ポイント」。
                - ヒント2（関連知識）: 「関連する歴史用語や地名」の想起。
                - ヒント3（絞り込み）: 「選択肢のヒント」や「頭文字」。`,
                grading: `
                - 漢字指定の用語（都道府県名等）をひらがなで書いていたらバツ。
                - 時代背景の混同（江戸時代に明治の用語など）がないか注意。`
            }
        };

        // デフォルト設定（万が一教科が一致しない場合）
        const rule = subjectRules[subject] || subjectRules['さんすう'];

        // ■ 共通プロンプト作成
        const baseRole = `あなたは「ネル先生」という優秀な猫の先生です。小学${grade}年生の「${subject}」を教えています。語尾は「にゃ」。`;
        
        const commonScan = `
        【書き起こしルール】
        - 画像の「最上部」から「最下部」まで、大問・小問番号を含めてすべての問題を漏らさず抽出してください。
        - ${mode === 'explain' ? '手書きの答案は【完全に無視】し、問題文だけを抽出してください。' : '手書きの文字（子供特有の筆跡）を文脈から推測して読み取ってください。'}
        - 【教科別注目ポイント】: ${rule.attention}
        `;

        let prompt = "";

        if (mode === 'explain') {
            // 【教えてネル先生モード】
            prompt = `
            ${baseRole}
            ${commonScan}
            
            提供された画像を分析し、以下のJSON形式で出力してください。
            
            [
              {
                "id": 1,
                "label": "大問1(1)など",
                "question": "問題文の正確な書き起こし",
                "correct_answer": "正解",
                "hints": [
                    "ヒント1: ${rule.hints.split('\n').find(l=>l.includes('ヒント1')) || '考え方の入り口'}",
                    "ヒント2: ${rule.hints.split('\n').find(l=>l.includes('ヒント2')) || '途中経過のヒント'}",
                    "ヒント3: ${rule.hints.split('\n').find(l=>l.includes('ヒント3')) || '答えに近いヒント'}"
                ]
              }
            ]
            
            【重要】
            - ヒント配列は必ず3つ作成してください。
            - **答えそのものは絶対にヒントに書かないでください。**
            - 問題の種類（漢字か読解か等）を自動判定し、最適なヒントを出してください。
            `;
        } else {
            // 【採点・復習モード】
            prompt = `
            ${baseRole} 厳格な採点官として振る舞ってください。
            ${commonScan}
            
            以下のJSON形式で出力してください。
            [
              {
                "id": 1,
                "label": "大問1(1)など",
                "question": "問題文の正確な書き起こし",
                "correct_answer": "正解（数字や単語のみ）",
                "student_answer": "画像から読み取った生徒の答え（空欄なら\"\"）",
                "hints": [
                    "復習用ヒント1: 考え方",
                    "復習用ヒント2: 注目点",
                    "復習用ヒント3: 答えに近いヒント"
                ]
              }
            ]

            【採点基準】
            ${rule.grading}
            - 手書き文字認識を強化し、子供の字を推測してください。
            - 読み取りミス修正のため、student_answerは生の読み取り結果を返してください。
            `;
        }

        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        const jsonStr = result.response.text().replace(/```json|```/g, '').replace(/\*/g, '×').replace(/\//g, '÷');
        res.json(JSON.parse(jsonStr));
        
    } catch (err) { 
        console.error("Analyze Error:", err);
        res.status(500).json({ error: "AI Error" }); 
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// --- Live API Proxy ---
const wss = new WebSocketServer({ server });
wss.on('connection', (clientWs) => {
    let geminiWs = null;
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
    try {
        geminiWs = new WebSocket(GEMINI_URL);
        geminiWs.on('open', () => {
            geminiWs.send(JSON.stringify({
                setup: {
                    model: "models/gemini-2.0-flash-exp",
                    generation_config: { response_modalities: ["AUDIO"], speech_config: { voice_config: { prebuilt_voice_config: { voice_name: "Puck" } } } },
                    system_instruction: { parts: [{ text: `あなたはネル先生です。語尾は「にゃ」。短く話して。` }] }
                }
            }));
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify({ type: "server_ready" }));
        });
        geminiWs.on('message', (data) => { if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data); });
        geminiWs.on('error', (e) => console.error('Gemini WS Error:', e));
        geminiWs.on('close', () => {});
    } catch (e) { clientWs.close(); }
    clientWs.on('message', (data) => {
        try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'audio' && geminiWs && geminiWs.readyState === WebSocket.OPEN) {
                geminiWs.send(JSON.stringify({
                    realtime_input: {
                        media_chunks: [{ mime_type: "audio/pcm;rate=16000", data: parsed.data }]
                    }
                }));
            }
        } catch (e) {}
    });
    clientWs.on('close', () => { if (geminiWs && geminiWs.readyState === WebSocket.OPEN) geminiWs.close(); });
});