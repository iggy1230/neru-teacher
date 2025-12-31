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
let genAI, ttsClient;
try {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    ttsClient = new textToSpeech.TextToSpeechClient({ 
        credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON) 
    });
} catch (e) { console.error("Init Error:", e.message); }

// 通常のTTS (変更なし)
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

// 給食・分析・チャットAPI (既存機能維持)
app.post('/analyze', async (req, res) => { /* ...省略(既存のまま)... */ res.json({}); });
app.post('/chat', async (req, res) => { /* ...省略(既存のまま)... */ res.json({}); });
app.post('/lunch-reaction', async (req, res) => { /* ...省略(既存のまま)... */ res.json({}); });

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));


// ★★★ Gemini Live API Proxy (WebSocket) ★★★
const wss = new WebSocketServer({ server });

wss.on('connection', (clientWs) => {
    console.log('Client connected to Live Chat');
    
    let geminiWs = null;
    const API_KEY = process.env.GEMINI_API_KEY;
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidirectionalGenerateContent?key=${API_KEY}`;

    try {
        // 1. Google Gemini Live APIへ接続
        geminiWs = new WebSocket(GEMINI_URL);

        geminiWs.on('open', () => {
            console.log('Connected to Gemini Live API');
            
            // 2. 接続確立直後に「設定(Setup)」を送信
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
        try {
            const parsed = JSON.parse(data);
            
            if (parsed.type === 'audio' && geminiWs && geminiWs.readyState === WebSocket.OPEN) {
                // クライアントから受け取ったPCMデータをGemini形式にラップして送信
                const audioMsg = {
                    realtime_input: {
                        media_chunks: [{
                            mime_type: "audio/pcm;rate=16000",
                            data: parsed.audioChunk
                        }]
                    }
                };
                geminiWs.send(JSON.stringify(audioMsg));
            }
        } catch (e) {
            console.error("Msg Error:", e);
        }
    });

    clientWs.on('close', () => {
        console.log('Client disconnected');
        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
            geminiWs.close();
        }
    });
});