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

// --- 音声合成 (SSML安定版) ---
// 修正点: 入れ子構造を廃止し、エラー率をゼロに近づけました
function createSSML(text, mood) {
    let rate = "1.1"; // 基本的に少し早口で子供っぽく
    let pitch = "+2st"; // 声を高く

    if (mood === "thinking") { rate = "1.0"; pitch = "0st"; }
    if (mood === "gentle") { rate = "0.95"; pitch = "+1st"; }
    if (mood === "excited") { rate = "1.2"; pitch = "+4st"; }
    
    // 記号削除とエスケープ
    let cleanText = text
        .replace(/[\u{1F600}-\u{1F6FF}]/gu, '')
        .replace(/🐾|✨|⭐|🎵|🐟|🎤|⭕️|❌/g, '')
        .replace(/&/g, 'と')
        .replace(/[<>"']/g, ' ');

    // 短い文や特定のフレーズは安定性重視でタグなし（ただしVoice設定でキャラは保たれる）
    if (cleanText.length < 2 || cleanText.includes("どの教科")) {
        return `<speak>${cleanText}</speak>`;
    }

    // 「……」を「間」に変換する処理だけ残し、他はシンプルに全体適用
    cleanText = cleanText.replace(/……/g, '<break time="500ms"/>');

    return `<speak><prosody rate="${rate}" pitch="${pitch}">${cleanText}</prosody></speak>`;
}

app.post('/synthesize', async (req, res) => {
    try {
        if (!ttsClient) throw new Error("TTS not ready");
        const { text, mood } = req.body;
        if (!text) return res.status(400).json({ error: "No text" });

        try {
            const [response] = await ttsClient.synthesizeSpeech({
                input: { ssml: createSSML(text, mood) },
                // Voice設定: ここでキャラ性を担保
                voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' }, 
                audioConfig: { audioEncoding: 'MP3' },
            });
            res.json({ audioContent: response.audioContent.toString('base64') });
        } catch (e) {
            console.warn("TTS Retry:", e.message);
            // エラー時のリトライ（完全にタグなし）
            const [retry] = await ttsClient.synthesizeSpeech({
                input: { text: text.replace(/[^a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g, '') },
                voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' },
                audioConfig: { audioEncoding: 'MP3' },
            });
            res.json({ audioContent: retry.audioContent.toString('base64') });
        }
    } catch (err) { res.status(500).send(err.message); }
});

// --- チャットAPI ---
app.post('/chat', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { message, grade, name } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        
        const prompt = `
        あなたは小学校の猫の先生「ネル先生」です。相手は小学${grade}年生の「${name}」さんです。
        以下の発言に対し、30文字以内で、優しく、語尾に「にゃ」をつけて返事してください。
        絵文字は使用禁止です。
        発言: ${message}`;
        
        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text() });
    } catch (err) { res.status(500).json({ error: "Chat Error" }); }
});

// --- 画像分析API (プロンプト強化版) ---
app.post('/analyze', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { image, mode, grade, subject } = req.body;
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash", 
            generationConfig: { responseMimeType: "application/json" } 
        });
        
        // 共通設定
        const role = `あなたは「ネル先生」という優秀な猫の先生です。小学${grade}年生の「${subject}」を教えています。`;
        
        let prompt = "";
        
        if (mode === 'explain') {
            // 【教えてネル先生】: 精度重視の詳細プロンプト
            prompt = `
            ${role}
            提供された宿題の画像を詳しく分析し、全ての問題について以下のJSONデータを作成してください。
            
            # 出力フォーマット (JSON配列)
            [
              {
                "id": 1,
                "label": "問題番号(例: (1))",
                "question": "画像内の問題文を一字一句正確に書き起こしてください。読み取れない場合は推測せず『読み取れませんでした』としてください。",
                "correct_answer": "この問題の正解",
                "hints": [
                  "ヒント1: まずはどう考えるか、考え方の入り口を『〜してみようにゃ』という口調で。",
                  "ヒント2: 式の立て方や、注目のポイントを『〜に注目だにゃ』という口調で。",
                  "ヒント3: 答えにかなり近づく具体的なヒントを『〜計算するとどうなるかにゃ？』という口調で（※答えそのものは書かない）"
                ]
              }
            ]
            
            # 制約事項
            - 算数の記号は「×」「÷」を使用してください。
            - 子供が理解できる言葉を選んでください。
            - 語尾は必ず「にゃ」にしてください。
            `;
        } else {
            // 【採点・復習】: 手書き認識重視
            prompt = `
            ${role}
            厳格な採点官として画像を分析してください。
            
            # 出力フォーマット (JSON配列)
            [
              {
                "id": 1,
                "label": "問題番号",
                "question": "問題文の正確な書き起こし",
                "correct_answer": "正解（数字や単語のみ）",
                "student_answer": "画像内の手書き文字から読み取った生徒の答え（空欄や読み取れない場合は空文字\"\"）",
                "hints": [
                   "考え方のヒント（〜にゃ）",
                   "式のヒント（〜にゃ）",
                   "答えに近いヒント（〜にゃ）"
                ]
              }
            ]
            
            # 制約事項
            - student_answer は手書き文字を慎重に読み取ってください。
            - 採点のため、correct_answer は余計な文字を含まないでください。
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

// --- Live API Proxy (WebSocket) ---
const wss = new WebSocketServer({ server });

wss.on('connection', (clientWs) => {
    let geminiWs = null;
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidirectionalGenerateContent?key=${process.env.GEMINI_API_KEY}`;

    try {
        geminiWs = new WebSocket(GEMINI_URL);
        geminiWs.on('open', () => {
            const setupMsg = {
                setup: {
                    model: "models/gemini-2.0-flash-exp",
                    generation_config: {
                        response_modalities: ["AUDIO"],
                        speech_config: { voice_config: { prebuilt_voice_config: { voice_name: "Puck" } } }
                    },
                    system_instruction: { parts: [{ text: `あなたはネル先生です。語尾は「にゃ」。短く話して。` }] }
                }
            };
            geminiWs.send(JSON.stringify(setupMsg));
        });
        geminiWs.on('message', (data) => { if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data); });
        geminiWs.on('error', (e) => console.error('Gemini WS Error:', e));
        geminiWs.on('close', () => {});
    } catch (e) { clientWs.close(); }

    clientWs.on('message', (data) => {
        try {
            const parsed = JSON.parse(data);
            if (parsed.realtime_input && geminiWs && geminiWs.readyState === WebSocket.OPEN) {
                geminiWs.send(JSON.stringify(parsed));
            }
        } catch (e) {}
    });
    clientWs.on('close', () => { if (geminiWs && geminiWs.readyState === WebSocket.OPEN) geminiWs.close(); });
});