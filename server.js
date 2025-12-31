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

// --- 通常のTTS (音声合成) ---
function createSSML(text, mood) {
    let rate = "1.0", pitch = "0.0";
    if (mood === "happy") { rate = "1.1"; pitch = "+2st"; }
    // 記号削除
    let clean = text.replace(/[\u{1F600}-\u{1F6FF}]/gu, '').replace(/🐾|✨|⭐|🎵|🐟|🎤/g, '');
    // 短い文はタグなしで安定化
    if (clean.length < 5 || clean.includes("どの教科")) return `<speak>${clean}</speak>`;
    
    clean = clean.replace(/&/g, 'と').replace(/[<>]/g, ' ');
    return `<speak><prosody rate="${rate}" pitch="${pitch}">${clean.replace(/……/g, '<break time="500ms"/>').replace(/にゃ/g, '<prosody pitch="+2st">にゃ</prosody>')}</prosody></speak>`;
}

app.post('/synthesize', async (req, res) => {
    try {
        if (!ttsClient) throw new Error("TTS not ready");
        const { text, mood } = req.body;
        if (!text) return res.status(400).json({ error: "No text" });
        try {
            const [r] = await ttsClient.synthesizeSpeech({
                input: { ssml: createSSML(text, mood) },
                voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' },
                audioConfig: { audioEncoding: 'MP3' }
            });
            res.json({ audioContent: r.audioContent.toString('base64') });
        } catch (e) {
            // エラー時は平文で再試行
            const [r2] = await ttsClient.synthesizeSpeech({
                input: { text: text.replace(/[^a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g, '') },
                voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' },
                audioConfig: { audioEncoding: 'MP3' }
            });
            res.json({ audioContent: r2.audioContent.toString('base64') });
        }
    } catch (err) { res.status(500).send(err.message); }
});

// --- 通常の画像分析 ---
app.post('/analyze', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { image, mode, grade, subject } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig: { responseMimeType: "application/json" } });
        const hint = `- "hints": ヒント3つ(1.考え方 2.式 3.ほぼ答え)。語尾は「〜にゃ」。`;
        let prompt = mode === 'explain' 
            ? `ネル先生。小学${grade}${subject}。1."question":書き起こし 2."correct_answer":正解 3.${hint} 4.記号は×÷。JSON配列。`
            : `採点。小学${grade}${subject}。1."question":書き起こし 2."correct_answer":正解 3."student_answer":手書き読取(空欄なら"") 4.${hint} JSON配列。`;
        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        res.json(JSON.parse(result.response.text().replace(/\*/g, '×').replace(/\//g, '÷')));
    } catch (err) { res.status(500).json({ error: "AI Error" }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// --- ★Live API Proxy (ここが重要) ---
const wss = new WebSocketServer({ server });

wss.on('connection', (clientWs) => {
    console.log('Client connected to Live Chat');
    let geminiWs = null;
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidirectionalGenerateContent?key=${process.env.GEMINI_API_KEY}`;

    try {
        geminiWs = new WebSocket(GEMINI_URL);

        geminiWs.on('open', () => {
            console.log('Connected to Gemini');
            const setupMsg = {
                setup: {
                    model: "models/gemini-2.0-flash-exp",
                    generation_config: {
                        response_modalities: ["AUDIO"],
                        speech_config: { voice_config: { prebuilt_voice_config: { voice_name: "Puck" } } }
                    },
                    system_instruction: {
                        parts: [{ text: `あなたは小学校のネル先生です。語尾は「にゃ」。短く、明るく、子供と会話して。` }]
                    }
                }
            };
            geminiWs.send(JSON.stringify(setupMsg));
        });

        geminiWs.on('message', (data) => {
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
        });

        geminiWs.on('error', (e) => console.error('Gemini WS Error:', e));
        geminiWs.on('close', () => console.log('Gemini WS Closed'));

    } catch (e) { console.error("Connection failed:", e); clientWs.close(); }

    clientWs.on('message', (data) => {
        try {
            const parsed = JSON.parse(data);
            if (parsed.realtime_input && geminiWs && geminiWs.readyState === WebSocket.OPEN) {
                // クライアントから来たデータをそのままGeminiへ転送
                geminiWs.send(JSON.stringify(parsed));
            }
        } catch (e) { console.error("Msg Error:", e); }
    });

    clientWs.on('close', () => {
        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) geminiWs.close();
    });
});