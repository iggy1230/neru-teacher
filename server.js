// --- server.js (完全版 v117.0: 共通高精度OCR & 採点判定ロジック) ---

import textToSpeech from '@google-cloud/text-to-speech';
import { GoogleGenerativeAI } from "@google/generative-ai";
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket, { WebSocketServer } from 'ws';
import { parse } from 'url';
import dotenv from 'dotenv';
import fs from 'fs/promises';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '.')));

// --- Server Log ---
const MEMORY_FILE = path.join(__dirname, 'server_log.json');
async function appendToServerLog(name, text) {
    try {
        let data = {};
        try { data = JSON.parse(await fs.readFile(MEMORY_FILE, 'utf8')); } catch {}
        const timestamp = new Date().toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        const newLog = `[${timestamp}] ${text}`;
        let currentLogs = data[name] || [];
        currentLogs.push(newLog);
        if (currentLogs.length > 50) currentLogs = currentLogs.slice(-50);
        data[name] = currentLogs;
        await fs.writeFile(MEMORY_FILE, JSON.stringify(data, null, 2));
    } catch (e) { console.error("Server Log Error:", e); }
}

// --- AI Initialization ---
let genAI, ttsClient;
try {
    if (!process.env.GEMINI_API_KEY) console.error("⚠️ GEMINI_API_KEY が設定されていません。");
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
        ttsClient = new textToSpeech.TextToSpeechClient({ credentials });
    } else {
        ttsClient = new textToSpeech.TextToSpeechClient();
    }
} catch (e) { console.error("Init Error:", e.message); }

// ==========================================
// API Endpoints
// ==========================================

// --- TTS ---
app.post('/synthesize', async (req, res) => {
    try {
        if (!ttsClient) throw new Error("TTS Not Ready");
        const { text, mood } = req.body;
        let rate = "1.1"; let pitch = "+2st";
        if (mood === "thinking") { rate = "1.0"; pitch = "0st"; }
        if (mood === "gentle") { rate = "0.95"; pitch = "+1st"; }
        if (mood === "excited") { rate = "1.2"; pitch = "+4st"; }
        const ssml = `<speak><prosody rate="${rate}" pitch="${pitch}">${text}</prosody></speak>`;
        const [response] = await ttsClient.synthesizeSpeech({
            input: { ssml },
            voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' },
            audioConfig: { audioEncoding: 'MP3' },
        });
        res.json({ audioContent: response.audioContent.toString('base64') });
    } catch (err) { res.status(500).send(err.message); }
});

// --- ★修正: Analyze (共通ロジック・最強の目) ---
app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject } = req.body; // modeはログ用に残すがロジックでは分岐させない
        console.log(`[Analyze] Subject: ${subject}, Grade: ${grade}, Mode: ${mode}`);

        // ★最強の目: gemini-1.5-pro (または gemini-2.0-flash-exp)
        // 手書き文字認識に強いモデルを選択
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-pro", 
            generationConfig: { responseMimeType: "application/json" } 
        });

        // ★共通プロンプト: モードに関係なく「手書き」も「問題」も全て読み取る
        const prompt = `
        あなたは小学${grade}年生の${subject}担当の教育AI「ネル先生」です。
        添付された画像のプリントを読み取り、以下のJSON形式（配列）で返してください。

        【絶対的な指示】
        1. **印刷された問題文**を一字一句正確に書き起こしてください。
        2. **生徒が手書きで書いた答え**を、前後の文脈や筆跡から推測して正確に書き起こしてください。
           - 空欄の場合は空文字 "" にしてください。
           - 間違っている場合も、書かれている通りに読み取ってください（修正しないこと）。
        3. その問題の本来の**正解**を導き出してください。
        4. 手書きの答えと正解を比較し、あっているか判定(is_correct)してください。
        5. 答えそのものではなく、考え方のヒントを3段階で作成してください。

        【出力JSONフォーマット】
        [
          {
            "id": 1,
            "label": "①",
            "question": "問題文(原文ママ)",
            "correct_answer": "正解",
            "student_answer": "読み取った手書きの答え(空欄なら空文字)",
            "is_correct": true, // または false
            "hints": ["ヒント1", "ヒント2", "ヒント3"]
          }
        ]
        
        ※ JSON配列のみを出力してください。Markdownは不要です。
        `;

        const result = await model.generateContent([
            prompt,
            { inlineData: { mime_type: "image/jpeg", data: image } }
        ]);

        const responseText = result.response.text();
        
        let problems = [];
        try {
            problems = JSON.parse(responseText);
        } catch (e) {
            const jsonMatch = responseText.match(/\[[\s\S]*\]/);
            if (jsonMatch) problems = JSON.parse(jsonMatch[0]);
            else throw new Error("Invalid JSON response");
        }

        res.json(problems);

    } catch (error) {
        console.error("解析エラー:", error);
        res.status(500).json({ error: "解析エラー: " + error.message });
    }
});

// --- 4. 給食反応 ---
app.post('/lunch-reaction', async (req, res) => {
    try {
        const { count, name } = req.body;
        await appendToServerLog(name, `給食をくれた(${count}個目)。`);
        const isSpecial = (count % 10 === 0);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        let prompt = isSpecial 
            ? `あなたは猫のネル先生。生徒${name}さんから${count}個目の給食をもらいました。感謝感激して50文字以内で熱く語って。語尾は「にゃ」。`
            : `あなたは猫のネル先生。生徒${name}から${count}回目の給食をもらいました。20文字以内で面白くリアクションして。語尾は「にゃ」。`;
        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text().trim(), isSpecial });
    } catch { res.json({ reply: "おいしいにゃ！", isSpecial: false }); }
});

// --- 3. ゲーム反応 ---
app.post('/game-reaction', async (req, res) => {
    try {
        const { type, name, score } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        let prompt = "";
        let mood = "excited";
        if (type === 'start') prompt = `ネル先生として${name}のゲーム開始を短く応援して。`;
        else if (type === 'end') prompt = `ネル先生としてゲーム終了後の${name}（スコア${score}/20）に20文字以内でコメントして。0-5点は励まし、6-15点は褒め、16点以上は絶賛。語尾は「にゃ」。`;
        else return res.json({ reply: "ナイスにゃ！", mood: "excited" });
        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text().trim(), mood });
    } catch { res.json({ reply: "おつかれさまにゃ！", mood: "happy" }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

const wss = new WebSocketServer({ server });
wss.on('connection', async (clientWs, req) => {
    const params = parse(req.url, true).query;
    const grade = params.grade || "1";
    const name = decodeURIComponent(params.name || "生徒");
    const statusContext = decodeURIComponent(params.status || "特になし");
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
    let geminiWs = null;
    try {
        geminiWs = new WebSocket(GEMINI_URL);
        geminiWs.on('open', () => {
            geminiWs.send(JSON.stringify({
                setup: {
                    model: "models/gemini-2.0-flash-exp",
                    generationConfig: { responseModalities: ["AUDIO"], speech_config: { voice_config: { prebuilt_voice_config: { voice_name: "Aoede" } }, language_code: "ja-JP" } }, 
                    systemInstruction: { parts: [{ text: `あなたはネル先生（猫）。相手は${grade}年生の${name}。語尾は「にゃ」。【状況】${statusContext}` }] }
                }
            }));
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify({ type: "server_ready" }));
        });
        clientWs.on('message', (data) => { const msg = JSON.parse(data); if (msg.base64Audio && geminiWs.readyState === WebSocket.OPEN) geminiWs.send(JSON.stringify({ realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: msg.base64Audio }] } })); });
        geminiWs.on('message', (data) => { if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data); });
        geminiWs.on('error', (e) => console.error(e));
        clientWs.on('close', () => geminiWs.close());
    } catch (e) { clientWs.close(); }
});