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

// --- 通常TTS ---
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

// --- 給食リアクション ---
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

// --- 分析API ---
app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig: { responseMimeType: "application/json" } });
        const hint = `"hints": 3つのヒントを作成(必須)。正解は書かない。`;
        let prompt = mode === 'explain' 
            ? `ネル先生。小学${grade}${subject}。全問抽出。1."question":書き起こし 2."correct_answer":正解 3.${hint} 4.記号は×÷。JSON配列。`
            : `採点。小学${grade}${subject}。1."question":書き起こし 2."correct_answer":正解 3."student_answer":手書き読取 4.${hint} JSON配列。`;
        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        res.json(JSON.parse(result.response.text().replace(/\*/g, '×').replace(/\//g, '÷')));
    } catch (err) { res.status(500).json({ error: "AI Error" }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// --- ★Live API Proxy (復元・安定版) ---
const wss = new WebSocketServer({ server });

wss.on('connection', (clientWs, req) => {
    // 学年取得
    const parameters = parse(req.url, true).query;
    const userGrade = parameters.grade || "1";

    let geminiWs = null;
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;

    try {
        geminiWs = new WebSocket(GEMINI_URL);

        geminiWs.on('open', () => {
            console.log('Connected to Gemini Live API');
            
            geminiWs.send(JSON.stringify({
                setup: {
                    model: "models/gemini-2.0-flash-exp",
                    generation_config: { 
                        response_modalities: ["AUDIO"], 
                        // 声モデル: Aoede
                        speech_config: { voice_config: { prebuilt_voice_config: { voice_name: "Aoede" } } } 
                    },
                    system_instruction: { 
                        parts: [{ 
                            text: `君は『ねこご市立ねこづか小学校』のネル先生だにゃ。いつも元気で、語尾は必ず『〜にゃ』だにゃ。 いつもの授業と同じように、ゆっくり、優しいトーンで喋ってにゃ。給食(餌)のカリカリが大好物にゃ。必ずユーザーの${userGrade}学年に合わせて分かりやすいように話す` 
                        }] 
                    }
                }
            }));
            
            // ★接続待機用シグナル
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ type: "server_ready" }));
            }
        });

        geminiWs.on('message', (data) => {
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
        });
        geminiWs.on('error', (e) => console.error('Gemini WS Error:', e.message));
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