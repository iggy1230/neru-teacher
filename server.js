import textToSpeech from '@google-cloud/text-to-speech';
import { GoogleGenerativeAI } from "@google/generative-ai";
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket, { WebSocketServer } from 'ws';
import { parse } from 'url';
import dotenv from 'dotenv';

dotenv.config();

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
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
        ttsClient = new textToSpeech.TextToSpeechClient({
            credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON)
        });
    } else {
        ttsClient = new textToSpeech.TextToSpeechClient();
    }
} catch (e) { 
    console.error("Init Error:", e.message); 
}

// --- 音声合成 (SSML) ---
function createSSML(text, mood) {
    let rate = "1.1", pitch = "+2st";
    if (mood === "thinking") { rate = "1.0"; pitch = "0st"; }
    if (mood === "gentle") { rate = "0.95"; pitch = "+1st"; }
    if (mood === "excited") { rate = "1.2"; pitch = "+4st"; }
    let cleanText = text.replace(/[\u{1F600}-\u{1F6FF}]/gu, '').replace(/[<>"']/g, ' ');
    if (cleanText.length < 5) return `<speak>${cleanText}</speak>`;
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

app.post('/game-reaction', async (req, res) => {
    try {
        const { type, name, score } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        let prompt = type === 'start' ? `${name}さんがゲーム開始！応援して！` : `ゲーム終了。スコア${score}。褒めて！`;
        const result = await model.generateContent(prompt + " 20文字以内、語尾にゃ。");
        res.json({ reply: result.response.text().trim(), mood: "excited" });
    } catch (err) { res.json({ reply: "がんばれにゃ！", mood: "excited" }); }
});

app.post('/lunch-reaction', async (req, res) => {
    try {
        const { count, name } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `給食${count}個目をもらった。感謝して。30文字以内、語尾にゃ。`;
        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text().trim(), isSpecial: count % 10 === 0 });
    } catch (err) { res.json({ reply: "おいしいにゃ！", isSpecial: false }); }
});

app.post('/chat', async (req, res) => {
    try {
        const { message, grade, name } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(`小学${grade}年生の${name}への返事。語尾にゃ。内容:${message}`);
        res.json({ reply: result.response.text() });
    } catch (err) { res.status(500).json({ error: "Chat Error" }); }
});

app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash", generationConfig: { responseMimeType: "application/json" } });
        const prompt = `小学${grade}年生の${subject}の問題。画像から問題をJSON抽出して。
        解答欄のない文字は無視。手書き文字は${mode==='explain'?'無視':'読み取る'}。
        出力形式:[{"id":1,"label":"①","question":"...","correct_answer":"...","student_answer":"","hints":["..."]}]`;
        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        let text = result.response.text();
        const start = text.indexOf('['); const end = text.lastIndexOf(']');
        if (start !== -1 && end !== -1) text = text.substring(start, end + 1);
        res.json(JSON.parse(text));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// --- ★Live API Proxy (修復版: 安定重視) ---
const wss = new WebSocketServer({ server });
wss.on('connection', (clientWs) => {
    let geminiWs = null;
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
    
    clientWs.on('message', (data) => {
        const msgStr = data.toString();
        
        // 1. JSON (設定データ) の場合
        if (msgStr.startsWith('{')) {
            try {
                const msg = JSON.parse(msgStr);
                if (msg.type === "config") {
                    // Geminiに接続
                    geminiWs = new WebSocket(GEMINI_URL);
                    geminiWs.on('open', () => {
                        geminiWs.send(JSON.stringify({
                            setup: {
                                model: "models/gemini-2.0-flash-exp",
                                generation_config: { 
                                    response_modalities: ["AUDIO"], // ★安定のため音声のみに戻す
                                    speech_config: { voice_config: { prebuilt_voice_config: { voice_name: "Aoede" } } } 
                                }, 
                                system_instruction: {
                                    parts: [{
                                        text: `あなたは「ネル先生」です。語尾は「〜にゃ」。
                                        相手: 小学${msg.userGrade}年生の${msg.userName}さん。
                                        記憶: ${msg.userMemory}
                                        元気よく日本語で話してください。`
                                    }]
                                }
                            }
                        }));
                        // クライアントに準備完了を通知
                        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify({ type: "server_ready" }));
                    });
                    
                    geminiWs.on('message', (gData) => {
                        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(gData);
                    });
                    geminiWs.on('error', (e) => console.error(e));
                    geminiWs.on('close', () => {});
                }
            } catch(e) {}
        } 
        // 2. それ以外 (音声データ) の場合
        else if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
            try {
                geminiWs.send(JSON.stringify({
                    realtime_input: {
                        media_chunks: [{ mime_type: "audio/pcm;rate=16000", data: msgStr }]
                    }
                }));
            } catch (e) { console.error(e); }
        }
    });

    clientWs.on('close', () => { if (geminiWs) geminiWs.close(); });
});