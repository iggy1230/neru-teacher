import textToSpeech from '@google-cloud/text-to-speech';
import { GoogleGenerativeAI } from "@google/generative-ai";
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket, { WebSocketServer } from 'ws';
import { parse } from 'url';

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
    return `<speak><prosody rate="${rate}" pitch="${pitch}">${cleanText.replace(/にゃ/g, '<prosody pitch="+3st">にゃ</prosody>')}</prosody></speak>`;
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

// --- チャットAPI (Fallback) ---
app.post('/chat', async (req, res) => {
    try {
        const { message, grade, name } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const prompt = `あなたは「ネル先生」。相手は小学${grade}年生「${name}」。30文字以内、語尾「にゃ」。絵文字禁止。発言: ${message}`;
        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text() });
    } catch (err) { res.status(500).json({ error: "Chat Error" }); }
});

// --- ★画像分析API (教科別・超高精度版) ---
app.post('/analyze', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { image, mode, grade, subject } = req.body;
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash", 
            generationConfig: { responseMimeType: "application/json" } 
        });

        // ■ 教科別ルール定義
        const rules = {
            'さんすう': {
                scan: "筆算の横線とマイナス記号の混同注意。累乗や分数を正確に。",
                hint: "1.立式(何算か) 2.注目点(単位や数値) 3.計算のコツ",
                grade: "筆算の繰り上がりメモを答えと間違えない。単位(cm,L)がないものはバツ。0と6、1と7の見間違い注意。"
            },
            'こくご': {
                scan: "ふりがな無視。縦書きは右から左。漢字書取りは『⬜︎⬜︎(ふりがな)』と表記。長文読解の本文は省略。",
                hint: "漢字:1.なりたち 2.辺やつくり 3.似た字\n読解:1.場所 2.キーワード 3.文末指定",
                grade: "トメ・ハネ・ハライ厳守。送り仮名ミスはバツ。読解は文末(〜から、〜こと)が適切かチェック。"
            },
            'りか': {
                scan: "グラフ軸ラベル・単位(g,℃)必須。記号選択肢も書き出す。図付近の問題見逃し厳禁。",
                hint: "1.観察(図のどこを見るか) 2.関連知識(用語想起) 3.絞り込み(選択肢)",
                grade: "カタカナ指定をひらがなで書いたらバツ。グラフ描画は点の位置と直線性重視。"
            },
            'しゃかい': {
                scan: "グラフ軸・単位・地図記号正確に。選択肢書き出し。資料周辺の問題注意。",
                hint: "1.観察(資料の注目点) 2.関連知識(歴史用語・地名) 3.絞り込み",
                grade: "漢字指定をひらがなで書いたらバツ。時代背景の矛盾(江戸時代に明治の用語など)チェック。"
            }
        };
        const r = rules[subject] || rules['さんすう'];

        const baseRole = `あなたは「ねこご市立ねこづか小学校」のネル先生です。小学${grade}年生の「${subject}」担当です。語尾は「にゃ」。`;
        
        // 共通の強力な書き起こし指示
        const commonScan = `
        【書き起こし絶対ルール】
        1. 画像の「最上部」から「最下部」まで、大問・小問番号を含めてすべての問題を漏らさず抽出してください。
        2. ${mode === 'explain' ? '画像内の手書きの答案は【完全に無視】し、問題文だけを抽出してください。' : '採点のため、生徒の手書き文字（student_answer）を読み取ってください。子供特有の筆跡を考慮し、文脈から推測してください。'}
        3. 1つの問いに複数の回答が必要なときは、JSONデータの要素を分けて、必要な数だけ回答欄を設けてください（例: 問1(1)①, 問1(1)②）。
        4. 教科別注意: ${r.scan}`;

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
                    "ヒント1: ${r.hint.split('\n').find(l=>l.includes('1.')) || '考え方'}",
                    "ヒント2: ${r.hint.split('\n').find(l=>l.includes('2.')) || '途中経過'}",
                    "ヒント3: ${r.hint.split('\n').find(l=>l.includes('3.')) || '答えに近いヒント'}"
                ]
              }
            ]
            
            【重要】
            - ヒント配列は必ず3段階作成してください。
            - **答えそのものは絶対にヒントに書かないでください。**
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
            ${r.grade}
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

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// --- ★Live API Proxy (復元・安定版・Charon) ---
const wss = new WebSocketServer({ server });

wss.on('connection', (clientWs, req) => {
    // URLから学年を取得
    const parameters = parse(req.url, true).query;
    const userGrade = parameters.grade || "1";

    let geminiWs = null;
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;

    try {
        geminiWs = new WebSocket(GEMINI_URL);

        geminiWs.on('open', () => {
            console.log('Connected to Gemini Live API');
            
            // 1. 設定送信
            const setupMsg = {
                setup: {
                    model: "models/gemini-2.0-flash-exp",
                    generation_config: {
                        response_modalities: ["AUDIO"],
                        speech_config: { voice_config: { prebuilt_voice_config: { voice_name: "Aoede" } } } // ★Charon指定
                    },
                    system_instruction: { 
                        parts: [{ 
                            text: `あなたは「ねこご市立ねこづか小学校」のネル先生です。
               
               【話し方のガイドライン】
               1. 語尾は必ず「〜にゃ」「〜だにゃ」にします。
               2. 日本の子供たちと話す、優しくて明るい先生になりきってください。
               3. 英語のようなアクセントは避け、日本人のネイティブな発音と自然なイントネーションを意識してください。
               4. 文末や区切りでは、一息置くようにゆっくり、丁寧に喋ってください。
               5. 感情を豊かに、ワクワクしたトーンで話すと、よりネル先生らしくなります。
           6. 給食(餌)のカリカリが大好物です。
               
               【重要】
               不自然な抑揚を避けるため、一文を短くし、適切な位置に句読点（。や、）があるつもりで喋ってください。` 
                        }] 
                    }
                }
            };
            geminiWs.send(JSON.stringify(setupMsg));

            // 2. 準備OK通知
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ type: "server_ready" }));
            }
        });

        geminiWs.on('message', (data) => {
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
        });

        geminiWs.on('error', (e) => console.error('Gemini WS Error:', e.message));
        geminiWs.on('close', () => console.log('Gemini WS Closed'));

    } catch (e) {
        console.error("Connection failed:", e);
        clientWs.close();
    }

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

    clientWs.on('close', () => {
        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) geminiWs.close();
    });
});