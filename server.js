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

// --- 既存のAPI設定 (TTS/Analyze) ---
let genAI, ttsClient;
try {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    ttsClient = new textToSpeech.TextToSpeechClient({ credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON) });
} catch (e) { console.error("Init Error:", e.message); }

// 通常TTS
function createSSML(text, mood) {
    let rate = "1.1", pitch = "+2st"; 
    if (mood === "thinking") { rate = "1.0"; pitch = "0st"; }
    let clean = text.replace(/[\u{1F600}-\u{1F6FF}]/gu, '').replace(/🐾|✨|⭐|🎵|🐟|🎤/g, '');
    if (clean.length < 5) return `<speak>${clean}</speak>`;
    return `<speak><prosody rate="${rate}" pitch="${pitch}">${clean.replace(/……/g, '<break time="500ms"/>').replace(/にゃ/g, '<prosody pitch="+3st">にゃ</prosody>')}</prosody></speak>`;
}

app.post('/synthesize', async (req, res) => {
    try {
        const { text, mood } = req.body;
        const [r] = await ttsClient.synthesizeSpeech({
            input: { ssml: createSSML(text, mood) },
            voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' },
            audioConfig: { audioEncoding: 'MP3' }
        });
        res.json({ audioContent: r.audioContent.toString('base64') });
    } catch (e) { res.status(500).send(e.message); }
});

// 分析API
app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig: { responseMimeType: "application/json" } });
        const hint = `- "hints": ヒント3つ(1.考え方 2.式 3.ほぼ答え)。語尾は「〜にゃ」。`;
        let prompt = mode === 'explain' ? `ネル先生。小学${grade}${subject}。1."question":書き起こし 2."correct_answer":正解 3.${hint} 4.記号は×÷。JSON配列。` : `採点。小学${grade}${subject}。1."question":書き起こし 2."correct_answer":正解 3."student_answer":手書き読取 4.${hint} JSON配列。`;
        const r = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        res.json(JSON.parse(r.response.text().replace(/\*/g, '×').replace(/\//g, '÷')));
    } catch (e) { res.status(500).json({ error: "AI Error" }); }
});

// 給食API
app.post('/lunch-reaction', async (req, res) => {
    try {
        const { count, name } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const isSpecial = count % 10 === 0;
        let prompt = isSpecial 
            ? `あなたは猫の先生「ネル先生」。生徒「${name}」から給食(カリカリ)${count}個目をもらった。60文字程度で熱く感謝を語って。注釈禁止。語尾「にゃ」。`
            : `あなたは猫の先生「ネル先生」。カリカリを1つ食べた。15文字以内で一言リアクション。「うみゃい！」など。語尾「にゃ」。`;
        const r = await model.generateContent(prompt);
        res.json({ reply: r.response.text().trim(), isSpecial });
    } catch (e) { res.status(500).json({ error: "Error" }); }
});

// HTTPサーバー起動
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));


// ★★★ Gemini Live API Proxy ★★★
const wss = new WebSocketServer({ noServer: true });

// HTTPサーバーのUpgradeリクエストをフックしてWebSocketに流す
server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

wss.on('connection', (clientWs) => {
    console.log('Client connected to Live Chat');
    
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidirectionalGenerateContent?key=${process.env.GEMINI_API_KEY}`;
    let geminiWs = null;

    try {
        geminiWs = new WebSocket(GEMINI_URL);

        geminiWs.on('open', () => {
            console.log('Connected to Gemini');
            // 1. 初期設定 (Setup) 送信
            const setupMsg = {
                setup: {
                    model: "models/gemini-2.0-flash-exp",
                    generation_config: {
                        response_modalities: ["AUDIO"],
                        speech_config: {
                            voice_config: { prebuilt_voice_config: { voice_name: "Puck" } } // 猫っぽい声
                        }
                    },
                    system_instruction: {
                        parts: [{ 
                            text: `あなたは『猫後市立ねこづか小学校』のネル先生です。
                            語尾は必ず『〜にゃ』『〜だにゃ』をつけてください。
                            小学生が相手なので、優しく、元気よく、短めの文章で話してください。
                            会話の合間に『にゃ〜ん』と鳴き声を混ぜたり、喉を鳴らす音を入れたりして、猫らしさを全開にしてください。
                            相手の話を遮って反応しても構いません。相槌を打ってください。` 
                        }]
                    }
                }
            };
            geminiWs.send(JSON.stringify(setupMsg));
        });

        // 2. Geminiからの音声 -> クライアントへ
        geminiWs.on('message', (data) => {
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(data);
            }
        });

        geminiWs.on('error', (e) => console.error('Gemini Error:', e));
        geminiWs.on('close', () => console.log('Gemini Closed'));

    } catch (e) {
        console.error("Connection failed:", e);
        clientWs.close();
    }

    // 3. クライアントからの音声 -> Geminiへ
    clientWs.on('message', (data) => {
        try {
            const parsed = JSON.parse(data);
            if (parsed.realtime_input && geminiWs && geminiWs.readyState === WebSocket.OPEN) {
                geminiWs.send(JSON.stringify(parsed));
            }
        } catch (e) { /* 無視 */ }
    });

    clientWs.on('close', () => {
        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) geminiWs.close();
    });
});