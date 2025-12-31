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

// --- HTTP API設定 (既存機能用) ---
let genAI;
try {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
} catch (e) {
    console.error("Init Error:", e.message);
}

// 既存のHTTPエンドポイント (/analyze, /chat, /synthesize) はそのまま維持
// (コードが長くなるため、ここにはLive APIに必要な部分を中心に記述しますが、
//  実際のファイルには以前の /analyze 等も残しておいてください)

app.post('/synthesize', async (req, res) => { /* ...以前と同じ... */ res.json({}); });
app.post('/chat', async (req, res) => { /* ...以前と同じ... */ res.json({}); });
app.post('/analyze', async (req, res) => { 
    // ... 以前と同じ analyze 処理 ...
    try {
        const { image, mode, grade, subject } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig: { responseMimeType: "application/json" } });
        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: "分析して" }]);
        res.json(JSON.parse(result.response.text().replace(/\*/g, '×').replace(/\//g, '÷')));
    } catch(e) { res.status(500).json({error:"AI Error"}); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));


// ★★★ Gemini Live API Proxy (WebSocket) ★★★
const wss = new WebSocketServer({ server });

wss.on('connection', (clientWs) => {
    console.log('Client connected to Live Chat');
    
    let geminiWs = null;
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidirectionalGenerateContent?key=${process.env.GEMINI_API_KEY}`;

    try {
        // 1. Google Gemini Live APIへ接続
        geminiWs = new WebSocket(GEMINI_URL);

        geminiWs.on('open', () => {
            console.log('Connected to Gemini Live API');
            
            // 2. 接続確立直後に「設定(Setup)」を送信
            // ここでネル先生の人格を注入します
            const setupMsg = {
                setup: {
                    model: "models/gemini-2.0-flash-exp",
                    generation_config: {
                        response_modalities: ["AUDIO"], // 音声で返事をもらう
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

        // 3. Geminiからのメッセージ(音声)をクライアントへ転送
        geminiWs.on('message', (data) => {
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(data);
            }
        });

        geminiWs.on('error', (err) => console.error('Gemini WS Error:', err));
        geminiWs.on('close', () => console.log('Gemini WS Closed'));

    } catch (e) {
        console.error("Connection failed:", e);
        clientWs.close();
    }

    // 4. クライアントからのメッセージ(音声)をGeminiへ転送
    clientWs.on('message', (data) => {
        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
            geminiWs.send(data);
        }
    });

    clientWs.on('close', () => {
        console.log('Client disconnected');
        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
            geminiWs.close();
        }
    });
});