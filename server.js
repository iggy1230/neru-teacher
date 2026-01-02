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

// SSML
function createSSML(text, mood) {
    let rate = "1.1", pitch = "+2st"; 
    if (mood === "thinking") { rate = "1.0"; pitch = "0st"; }
    let cleanText = text.replace(/[\u{1F600}-\u{1F6FF}]/gu, '').replace(/🐾|✨|⭐|🎵|🐟|🎤|⭕️|❌/g, '');
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

// ★新設: 思い出要約API
app.post('/summarize', async (req, res) => {
    try {
        const { history } = req.body;
        if (!history || history.length === 0) return res.json({ memory: "" });

        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        // 最新の会話から重要なトピックを1つだけ抽出
        const prompt = `
        あなたはネル先生です。以下の生徒との会話ログから、次回の会話で話題にできそうな「思い出」を1つだけ抽出して、短く要約してください。
        
        形式: 「〜について話したにゃ」や「〜をがんばったにゃ」など、ネル先生が思い出す口調で。
        制限: 40文字以内。
        
        会話ログ:
        ${history.map(h => `${h.role}: ${h.text}`).join('\n')}
        `;
        
        const result = await model.generateContent(prompt);
        res.json({ memory: result.response.text().trim() });
    } catch (e) { res.status(500).json({ error: "Summary Error" }); }
});

// ★修正: チャットAPI (記憶対応)
app.post('/chat', async (req, res) => {
    try {
        const { message, grade, name, memory } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        
        // 記憶をプロンプトに注入
        const memoryPrompt = memory ? `【以前の記憶】: "${memory}" (この話題にも触れつつ話して)` : "";
        
        const prompt = `
        あなたは「ネル先生」。相手は小学${grade}年生「${name}」。
        ${memoryPrompt}
        30文字以内、語尾「にゃ」。絵文字禁止。
        発言: ${message}`;
        
        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text() });
    } catch (err) { res.status(500).json({ error: "Chat Error" }); }
});

// 分析・給食API (既存)
app.post('/lunch-reaction', async (req, res) => { /* 変更なし */
    try { const { count, name } = req.body; const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const isSpecial = count % 10 === 0;
        let prompt = isSpecial ? `ネル先生として、給食${count}個目の感謝を熱く語って。相手:${name}。60文字程度。注釈禁止。` : `ネル先生として、給食を食べた一言感想。15文字以内。語尾にゃ。`;
        const result = await model.generateContent(prompt); let reply = result.response.text().trim();
        if(!isSpecial) reply = reply.split('\n')[0]; res.json({ reply, isSpecial });
    } catch (err) { res.status(500).json({ error: "Error" }); }
});
app.post('/analyze', async (req, res) => { /* 変更なし */
    try { const { image, mode, grade, subject } = req.body; const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig: { responseMimeType: "application/json" } });
        const r = `ネル先生。小${grade}${subject}。`; const s = `全問抽出。手書き${mode==='explain'?'無視':'読取'}。`;
        const h = `"hints": 3段階ヒント(必須)。正解書かない。`;
        let p = mode === 'explain' ? `${r} ${s} [{"id":1,"label":"(1)","question":"文","correct_answer":"答",${h}}]` : `${r} 採点。${s} [{"id":1,"label":"①","question":"文","correct_answer":"答","student_answer":"読取",${h}}]`;
        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: p }]);
        res.json(JSON.parse(result.response.text().replace(/\*/g, '×').replace(/\//g, '÷')));
    } catch (err) { res.status(500).json({ error: "AI Error" }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// ★修正: Live API Proxy (記憶対応)
const wss = new WebSocketServer({ server });
wss.on('connection', (clientWs, req) => {
    // URLから学年と記憶を取得
    const params = parse(req.url, true).query;
    const userGrade = params.grade || "1";
    const userMemory = params.memory || ""; // 記憶

    let geminiWs = null;
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
    try {
        geminiWs = new WebSocket(GEMINI_URL);
        geminiWs.on('open', () => {
            const memInstruction = userMemory ? `【以前の記憶】: "${userMemory}" を踏まえて話してください。` : "";
            geminiWs.send(JSON.stringify({
                setup: {
                    model: "models/gemini-2.0-flash-exp",
                    generation_config: { response_modalities: ["AUDIO"], speech_config: { voice_config: { prebuilt_voice_config: { voice_name: "Charon" } } } },
                    system_instruction: { 
                        parts: [{ 
                            text: `君は『ねこご市立ねこづか小学校』のネル先生だにゃ。いつも元気で、語尾は必ず『〜にゃ』だにゃ。${memInstruction} 給食(餌)のカリカリが大好物にゃ。必ずユーザーの${userGrade}学年に合わせて分かりやすいように話す` 
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
        try { const parsed = JSON.parse(data); if (parsed.type === 'audio' && geminiWs && geminiWs.readyState === WebSocket.OPEN) geminiWs.send(JSON.stringify({ realtime_input: { media_chunks: [{ mime_type: "audio/pcm;rate=16000", data: parsed.data }] } })); } catch (e) {}
    });
    clientWs.on('close', () => { if (geminiWs && geminiWs.readyState === WebSocket.OPEN) geminiWs.close(); });
});