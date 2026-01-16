// --- server.js (完全版 v114.0: Analyzeスリム化 & 安定版ベース) ---

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

// --- Hybrid Analyze (Slim Version) ---
app.post('/analyze', async (req, res) => {
    try {
        const { image, subject, grade, name } = req.body;

        // Proモデルに直接画像を見せるにゃ！
        // (元の変数名 genAI を使用)
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-pro", 
            generationConfig: { responseMimeType: "application/json" } 
        });

        const prompt = `あなたは教育AI「ネル先生」です。相手は${grade}年生の${name}ちゃんです。
        画像内の問題を解き、以下のJSON形式で返してください。
        【形式】[{"id": 1, "label": "問1", "question": "問題の内容", "answer": "答え", "hint1": "考え方", "hint2": "ヒント"}]
        ※問題文は要約しないでください。正確に解くことを最優先してください。`;

        // 画像とプロンプトを同時に送るにゃ！
        const result = await model.generateContent([
            prompt,
            { inlineData: { mime_type: "image/jpeg", data: image } }
        ]);

        const responseText = result.response.text();
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        const problems = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

        res.json({ problems });
    } catch (error) {
        console.error("解析エラーにゃ:", error);
        res.status(500).json({ error: "解析に失敗したにゃ" });
    }
});

// --- 4. 給食反応 (箇条書き禁止 & 特別演出 - v113.0仕様) ---
app.post('/lunch-reaction', async (req, res) => {
    try {
        const { count, name } = req.body;
        await appendToServerLog(name, `給食をくれた(${count}個目)。`);
        
        const isSpecial = (count % 10 === 0);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        
        let prompt = "";
        if (isSpecial) {
            // 10回に1回: 熱く語る（さん付け必須）
            prompt = `
            あなたは猫の「ネル先生」です。生徒「${name}」から、記念すべき${count}個目の給食（カリカリ）をもらいました！
            
            【指示】
            1. 必ず「${name}さん」と、さん付けで呼んでください。
            2. カリカリへの愛を熱く、情熱的に語ってください。
            3. 感謝を少し大げさなくらい感激して伝えてください。
            4. 文字数は50文字程度。語尾は「にゃ」「だにゃ」。
            `;
        } else {
            // 通常時: 箇条書き禁止ルール追加
            prompt = `
            あなたは猫の「ネル先生」です。生徒「${name}」から${count}回目の給食（カリカリ）をもらいました。
            
            【絶対守るべき指示】
            1. 「箇条書き」や「複数の案」を出さないでください。セリフは1つだけにしてください。
            2. 普段は名前を呼ばなくていいですが、5回に1回くらいの確率で気まぐれに「${name}さん」と呼んでください。
            3. カリカリの味、音、匂い、食感などを独特な表現で褒めるか、または猫としてのシュールなジョークを言ってください。
            4. ユーモアたっぷり、笑える感じで。
            5. 20文字以内。
            `;
        }
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

        if (type === 'start') {
            prompt = `あなたはネル先生。「${name}」がゲーム開始。「がんばれ！」と短く応援して。`;
        } else if (type === 'end') {
            prompt = `
            あなたはネル先生。ゲーム終了。スコアは${score}点（満点20点）です。
            スコアに応じて以下のテンションで、${name}さんに20文字以内でコメントしてください。
            ・0-5点: 下手すぎて笑ってしまう感じで励ます。
            ・6-15点: まあまあだね、と上から目線で褒める。
            ・16-20点: すごい！と大げさに驚く。
            語尾は「にゃ」。
            `;
        } else {
            return res.json({ reply: "ナイスにゃ！", mood: "excited" });
        }

        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text().trim(), mood });
    } catch { 
        res.json({ reply: "おつかれさまにゃ！", mood: "happy" }); 
    }
});

app.post('/summarize-notes', async (req, res) => { res.json({ notes: [] }); }); 

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// --- Server & WebSocket ---
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
                    generationConfig: { 
                        responseModalities: ["AUDIO"], 
                        speech_config: { 
                            voice_config: { prebuilt_voice_config: { voice_name: "Aoede" } }, 
                            language_code: "ja-JP" 
                        } 
                    }, 
                    systemInstruction: {
                        parts: [{
                            text: `あなたはネル先生（猫）。相手は${grade}年生の${name}。
                            語尾は「にゃ」。明るく親しみやすく。
                            【コンテキスト】${statusContext}`
                        }]
                    }
                }
            }));
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify({ type: "server_ready" }));
        });

        clientWs.on('message', (data) => {
            const msg = JSON.parse(data);
            if (msg.base64Audio && geminiWs.readyState === WebSocket.OPEN) {
                geminiWs.send(JSON.stringify({ realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: msg.base64Audio }] } }));
            }
        });

        geminiWs.on('message', (data) => {
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
        });

        geminiWs.on('error', (e) => console.error("Gemini WS Error:", e));
        clientWs.on('close', () => geminiWs.close());

    } catch (e) { clientWs.close(); }
});