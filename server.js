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

// 通常TTS
function createSSML(text, mood) {
    let rate = "1.1", pitch = "+2st"; 
    if (mood === "thinking") { rate = "1.0"; pitch = "0st"; }
    let cleanText = text.replace(/[\u{1F600}-\u{1F6FF}]/gu, '').replace(/🐾|✨|⭐|🎵|🐟|🎤|⭕️|❌/g, '').replace(/&/g, 'と').replace(/[<>"']/g, ' ');
    if (cleanText.length < 5) return `<speak>${cleanText}</speak>`;
    return `<speak><prosody rate="${rate}" pitch="${pitch}">${cleanText.replace(/……/g, '<break time="500ms"/>').replace(/にゃ/g, '<prosody pitch="+3st">にゃ</prosody>')}</prosody></speak>`;
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

// 給食API
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

// --- ★分析API (教科別・超高精度版) ---
app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject } = req.body;
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash", 
            generationConfig: { responseMimeType: "application/json" } 
        });

        // ■ 教科別ルール定義
        const subjectRules = {
            'さんすう': {
                scan: `・筆算の横線とマイナス記号を混同しない。\n・累乗や分数を正確に。\n・図形問題の数値も見逃さない。`,
                hints: `
                  1. 立式: 「何算を使えばいいか」のヒント（例：全部でいくつだから足し算にゃ）。
                  2. 注目点: 「単位のひっかけ」や「図の数値」への誘導（例：cmをmに直すのを忘れてないかにゃ？）。
                  3. 計算のコツ: 「計算の工夫」や「最終確認」（例：一の位から順番に計算にゃ）。`,
                grading: `
                  ・筆算の繰り上がりメモを答えと間違えない。
                  ・単位（cm, L等）がない場合はバツ。
                  ・数字の0と6、1と7の見間違いに注意。`
            },
            'こくご': {
                scan: `・ふりがな（ルビ）は無視。本文の漢字と送り仮名を正確に。\n・縦書きは右から左へ。\n・読解の長文は省略し、設問のみ抽出。\n・漢字書き取りは『⬜︎⬜︎(ふりがな)』と表記。`,
                hints: `
                  1. 場所/なりたち: 読解なら「答えの場所」、漢字なら「なりたち」。
                  2. キーワード/構成: 読解なら「注目する言葉」、漢字なら「辺やつくり」。
                  3. 答え方/似た字: 読解なら「文末の指定（〜こと）」、漢字なら「似た漢字」。`,
                grading: `
                  ・漢字のトメ・ハネ・ハライを厳しく判定。
                  ・送り仮名のミスはバツ。
                  ・読解は文末（〜から、〜こと）が適切かチェック。`
            },
            'りか': {
                scan: `・グラフの軸ラベルや単位（g, ℃）を落とさない。\n・記号選択の選択肢（ア、イ）も書き出す。\n・図の近くにある最初の問題を見逃さない。`,
                hints: `
                  1. 観察: 「図や表のどこを見るか」（例：グラフが急変している所）。
                  2. 関連知識: 「習った言葉や実験器具」の想起。
                  3. 絞り込み: 「選択肢のヒント」や「頭文字」。`,
                grading: `
                  ・カタカナ指定（ジョウロ等）をひらがなで書いたらバツ。
                  ・グラフ描画は点の位置や直線性も厳しく判定。`
            },
            'しゃかい': {
                scan: `・グラフの軸、単位、地図記号を正確に。\n・選択肢を書き出す。\n・資料問題を見逃さない。`,
                hints: `
                  1. 観察: 「資料・地図・グラフの注目点」。
                  2. 関連知識: 「歴史用語や地名」の想起。
                  3. 絞り込み: 「選択肢のヒント」や「頭文字」。`,
                grading: `
                  ・漢字指定（都道府県等）をひらがなで書いたらバツ。
                  ・時代背景の矛盾（江戸時代に明治の用語など）をチェック。`
            }
        };
        const rule = subjectRules[subject] || subjectRules['さんすう'];

        // ■ 共通プロンプト構築
        const baseRole = `あなたは「ねこご市立ねこづか小学校」のネル先生です。小学${grade}年生の「${subject}」担当です。語尾は「にゃ」。`;
        
        const scanCommon = `
        【書き起こし絶対ルール】
        1. 画像の最上部から最下部まで、大問・小問番号を含め全問抽出してください。
        2. ${mode === 'explain' ? '画像内の手書き文字（生徒の答案）は【完全に無視】し、問題文のみ抽出してください。' : '採点のため、生徒の手書き文字（student_answer）を読み取ってください。子供の筆跡を文脈から推測してください。'}
        3. 1つの問いに複数の回答欄がある場合は、JSONデータを分けて出力してください（例: 問1(1)①, 問1(1)②）。
        4. 教科別注意: ${rule.scan}`;

        let prompt = "";

        if (mode === 'explain') {
            // 【教えてモード】
            prompt = `
            ${baseRole}
            ${scanCommon}
            
            以下のJSON形式で出力してください。
            [
              {
                "id": 1,
                "label": "問題番号",
                "question": "問題文の正確な書き起こし",
                "correct_answer": "正解",
                "hints": [
                    "ヒント1: ${rule.hints.split('\n')[1] || '考え方'}",
                    "ヒント2: ${rule.hints.split('\n')[2] || '注目点'}",
                    "ヒント3: ${rule.hints.split('\n')[3] || '答えに近いヒント'}"
                ]
              }
            ]
            【重要】
            - ヒント配列は必ず3段階作成。
            - **答えそのものは絶対に書かないこと。**
            `;
        } else {
            // 【採点モード】
            prompt = `
            ${baseRole} 厳格な採点官として振る舞ってください。
            ${scanCommon}
            
            以下のJSON形式で出力してください。
            [
              {
                "id": 1,
                "label": "問題番号",
                "question": "問題文",
                "correct_answer": "正解（数字や単語のみ）",
                "student_answer": "手書きの読み取り結果（空欄なら\"\"）",
                "hints": [
                    "復習ヒント1",
                    "復習ヒント2",
                    "復習ヒント3"
                ]
              }
            ]
            【採点基準】
            ${rule.grading}
            - 読み取りミス修正のため、student_answerは生の読み取り結果を返してください。
            - 答えそのものはヒントに書かないでください。
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

// --- チャットAPI (設定反映) ---
app.post('/chat', async (req, res) => {
    try {
        const { message, grade, name } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        // ★指定された人格設定
        const persona = `君は『ねこご市立ねこづか小学校』のネル先生だにゃ。いつも元気で、語尾は必ず『〜にゃ』だにゃ。 いつもの授業と同じように、ゆっくり、優しいトーンで喋ってにゃ。給食(餌)のカリカリが大好物にゃ。必ずユーザーの学年(小${grade})に合わせて分かりやすいように話す。`;
        
        const result = await model.generateContent(`${persona}\n相手:${name}\n発言:${message}\n(30文字以内、絵文字禁止)`);
        res.json({ reply: result.response.text() });
    } catch (err) { res.status(500).json({ error: "Chat Error" }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// --- Live API Proxy (WebSocket) ---
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
                    generation_config: { response_modalities: ["AUDIO"], speech_config: { voice_config: { prebuilt_voice_config: { voice_name: "Aoide" } } } },
                    system_instruction: { 
                        parts: [{ 
                            // ★WebSocket側にも同じ人格設定を反映
                            text: `君は『ねこご市立ねこづか小学校』のネル先生だにゃ。いつも元気で、語尾は必ず『〜にゃ』だにゃ。ゆっくり、優しいトーンで喋ってにゃ。給食(餌)のカリカリが大好物にゃ。` 
                        }] 
                    }
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
                geminiWs.send(JSON.stringify({ realtime_input: { media_chunks: [{ mime_type: "audio/pcm;rate=16000", data: parsed.data }] } }));
            }
        } catch (e) {}
    });
    clientWs.on('close', () => { if (geminiWs && geminiWs.readyState === WebSocket.OPEN) geminiWs.close(); });
});