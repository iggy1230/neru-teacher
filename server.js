// --- server.js (完全版 v16.5: 接続エラー通知強化) ---

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

// .envファイルを読み込む
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '.')));

// --- 記憶システム設定 ---
const MEMORY_FILE = path.join(__dirname, 'memory.json');

async function initMemoryFile() {
    try {
        await fs.access(MEMORY_FILE);
    } catch {
        await fs.writeFile(MEMORY_FILE, JSON.stringify({}));
        console.log("📝 新しい記憶ファイル(memory.json)を作成しました");
    }
}
initMemoryFile();

// --- APIクライアント初期化 ---
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

// --- 各種API (変更なし) ---
app.get('/debug/memory', async (req, res) => {
    try {
        const data = await fs.readFile(MEMORY_FILE, 'utf8');
        res.header("Content-Type", "application/json; charset=utf-8");
        res.send(data);
    } catch (e) { res.status(500).send("Error"); }
});

app.post('/detect-document', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: "No image" });
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp", generationConfig: { responseMimeType: "application/json" } });
        const prompt = `画像内のメイン書類の四隅の座標を検出。JSON形式 {"points": [{"x":.., "y":..}, ...]}`;
        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        let text = result.response.text();
        const match = text.match(/\{[\s\S]*\}/);
        if (match) text = match[0];
        res.json(JSON.parse(text));
    } catch (e) { res.json({ points: [{x:0,y:0}, {x:100,y:0}, {x:100,y:100}, {x:0,y:100}] }); }
});

function createSSML(text, mood) {
    let rate = "1.1", pitch = "+2st";
    if (mood === "thinking") { rate = "1.0"; pitch = "0st"; }
    if (mood === "gentle") { rate = "0.95"; pitch = "+1st"; }
    if (mood === "excited") { rate = "1.2"; pitch = "+4st"; }
    let cleanText = text.replace(/[\u{1F600}-\u{1F6FF}]/gu, '').replace(/[<>"']/g, ' ').replace(/^[・-]\s*/gm, '').replace(/……/g, '<break time="500ms"/>');
    if (cleanText.length < 5) return `<speak>${cleanText}</speak>`;
    return `<speak><prosody rate="${rate}" pitch="${pitch}">${cleanText.replace(/にゃ/g, '<prosody pitch="+3st">にゃ</prosody>')}</prosody></speak>`;
}

app.post('/synthesize', async (req, res) => {
    try {
        const { text, mood } = req.body;
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
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        let prompt = type === 'start' ? `生徒「${name}」開始。一言応援。` : `終了。スコア${score}。一言感想。`;
        const result = await model.generateContent(prompt);
        let reply = result.response.text().trim();
        if (reply.includes('\n')) reply = reply.split('\n')[0];
        res.json({ reply, mood: "excited" });
    } catch (err) { res.json({ reply: "がんばれにゃ！", mood: "excited" }); }
});

app.post('/lunch-reaction', async (req, res) => {
    try {
        const { count, name } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp", generationConfig: { maxOutputTokens: 100 } });
        const prompt = `生徒「${name}」から${count}個目の給食。感想を。`;
        const result = await model.generateContent(prompt);
        let reply = result.response.text().trim();
        if (reply.includes('\n')) reply = reply.split('\n')[0];
        res.json({ reply, isSpecial: count%10===0 });
    } catch (err) { res.status(500).json({ error: "Lunch Error" }); }
});

app.post('/chat', async (req, res) => {
    try {
        const { message, grade, name } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        const result = await model.generateContent(`ネル先生として回答: ${message}`);
        res.json({ reply: result.response.text() });
    } catch (err) { res.status(500).json({ error: "Chat Error" }); }
});

app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject, analysisType } = req.body;
        let modelName = analysisType === 'precision' ? "gemini-1.5-pro" : "gemini-2.0-flash-exp";
        const model = genAI.getGenerativeModel({ model: modelName, generationConfig: { responseMimeType: "application/json" } });
        const prompt = `あなたはネル先生（小学${grade}年生${subject}担当）。画像の問題をJSON出力。ルール: 全て抽出。hints3段階。出力JSON形式: [{"id":1, "label":"①", "question":"...", "correct_answer":"...", "student_answer":"", "hints":[...]}]`;
        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        let text = result.response.text();
        text = text.substring(text.indexOf('['), text.lastIndexOf(']')+1);
        res.json(JSON.parse(text));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// --- ★Live API Proxy (エラー通知強化版) ---
const wss = new WebSocketServer({ server });

wss.on('connection', async (clientWs, req) => {
    const params = parse(req.url, true).query;
    const grade = params.grade || "1";
    const name = decodeURIComponent(params.name || "生徒");
    
    let userMemory = "";
    try {
        const data = await fs.readFile(MEMORY_FILE, 'utf8');
        userMemory = JSON.parse(data)[name] || "まだ会話していません。";
    } catch (e) { console.error("Memory Load Error:", e); }

    let currentSessionLog = "";
    let geminiWs = null;
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
    
    try {
        geminiWs = new WebSocket(GEMINI_URL);
        
        geminiWs.on('open', () => {
            console.log(`✨ [${name}] Gemini接続成功`);
            const setupMsg = {
                setup: {
                    model: "models/gemini-2.0-flash-exp",
                    generation_config: { 
                        response_modalities: ["AUDIO", "TEXT"], 
                        speech_config: { voice_config: { prebuilt_voice_config: { voice_name: "Aoede" } } } 
                    }, 
                    system_instruction: {
                        parts: [{
                            text: `あなたは「ねこご市立ねこづか小学校」のネル先生だにゃ。相手は小学${grade}年生の${name}さん。語尾は「〜にゃ」。記憶:${userMemory}`
                        }]
                    }
                }
            };
            geminiWs.send(JSON.stringify(setupMsg));
            
            // クライアントに準備完了を通知
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ type: "server_ready" }));
            }
        });

        // Geminiエラー時
        geminiWs.on('error', (e) => {
            console.error("Gemini WS Error:", e);
            if (clientWs.readyState === WebSocket.OPEN) {
                // クライアントにエラーを通知
                clientWs.send(JSON.stringify({ type: "error", message: "Gemini接続エラー" }));
            }
        });

        clientWs.on('message', (data) => {
            if (geminiWs.readyState === WebSocket.OPEN) {
                geminiWs.send(JSON.stringify({ 
                    realtime_input: { 
                        media_chunks: [{ mime_type: "audio/pcm;rate=16000", data: data.toString() }] 
                    } 
                }));
            }
        });

        geminiWs.on('message', (data) => {
            const parsed = JSON.parse(data);
            if (parsed.serverContent?.modelTurn?.parts) {
                parsed.serverContent.modelTurn.parts.forEach(p => {
                    if (p.text) {
                        currentSessionLog += `ネル: ${p.text}\n`;
                    }
                });
            }
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data); 
        });

        geminiWs.on('close', () => console.log("\n🔒 Gemini WS Closed"));

    } catch (e) { 
        console.error("WS Setup Error", e); 
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: "error", message: "サーバーエラー" }));
        }
        clientWs.close(); 
    }
    
    clientWs.on('close', async () => {
        if (geminiWs) geminiWs.close();
        if (currentSessionLog.trim().length > 0) {
            try {
                let currentAllMemories = {};
                try {
                    const data = await fs.readFile(MEMORY_FILE, 'utf8');
                    currentAllMemories = JSON.parse(data);
                } catch {}
                const oldMem = currentAllMemories[name] || "";
                const newEntry = `\n--- ${new Date().toLocaleString('ja-JP')} ---\n${currentSessionLog}`;
                let combined = (oldMem + newEntry).slice(-10000); 
                currentAllMemories[name] = combined;
                await fs.writeFile(MEMORY_FILE, JSON.stringify(currentAllMemories, null, 2));
            } catch (e) { console.error("Save Error:", e); }
        }
    });
});