// --- server.js (完全版 v30.0: メモリ変数管理・安定版) ---

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

const MEMORY_FILE = path.join(__dirname, 'memory.json');

// ★重要: メモリ上の記憶ストレージ (ファイルアクセスを減らして高速化)
let GLOBAL_MEMORIES = {};

// サーバー起動時にファイルをロード
async function loadMemories() {
    try {
        const data = await fs.readFile(MEMORY_FILE, 'utf8');
        GLOBAL_MEMORIES = JSON.parse(data);
        console.log("📚 記憶データをロードしました");
    } catch {
        console.log("📝 新しい記憶ファイルを作成します");
        GLOBAL_MEMORIES = {};
        await fs.writeFile(MEMORY_FILE, JSON.stringify({}));
    }
}
loadMemories();

// 記憶追記関数 (メモリ更新 + 非同期ファイル保存)
async function appendToMemory(name, text) {
    if (!name || !text) return;
    
    const timestamp = new Date().toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    const newLog = `\n[${timestamp}] ${text}`;
    
    // メモリ更新
    let currentMem = GLOBAL_MEMORIES[name] || "";
    currentMem = (currentMem + newLog).slice(-5000); 
    GLOBAL_MEMORIES[name] = currentMem;

    console.log(`💾 記憶: ${name} -> ${text}`);

    // ファイル保存 (エラーでも止まらないように)
    try {
        await fs.writeFile(MEMORY_FILE, JSON.stringify(GLOBAL_MEMORIES, null, 2));
    } catch (e) {
        console.error("Memory File Save Error:", e);
    }
}

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
} catch (e) { console.error("Init Error:", e.message); }

app.get('/debug/memory', (req, res) => {
    res.json(GLOBAL_MEMORIES);
});

// ... (以下、detect-document, synthesize, game-reaction, lunch-reaction, chat, analyze は変更なし) ...
// ※長くなるので省略しますが、v29.0と同じコードを使用してください。
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
    } catch (e) { res.json({ points: [{x:5,y:5}, {x:95,y:5}, {x:95,y:95}, {x:5,y:95}] }); }
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
        if (type === 'end') await appendToMemory(name, `ゲーム「カリカリキャッチ」終了。スコア${score}点。`);
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
        await appendToMemory(name, `給食をくれた(${count}個目)。`);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp", generationConfig: { maxOutputTokens: 100 } });
        let prompt = "";
        const isSpecial = count % 10 === 0;
        if (isSpecial) {
            prompt = `あなたは「ねこご市立ねこづか小学校」のネル先生。生徒「${name}」さんから記念すべき${count}個目の給食をもらった。${name}さんのことを必ず「${name}さん」と呼んで、ものすごく喜び、感謝を60文字程度で熱く語って。語尾は「にゃ」。`;
        } else {
            prompt = `あなたはネル先生。生徒「${name}」から給食のカリカリをもらった。15文字以内の一言で感想。語尾「にゃ」。`;
        }
        const result = await model.generateContent(prompt);
        let reply = result.response.text().trim();
        if (reply.includes('\n')) reply = reply.split('\n')[0];
        res.json({ reply, isSpecial });
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
        const prompt = `あなたはネル先生。画像の問題をJSON出力。ルール: 全て抽出。`; // 省略
        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        let text = result.response.text();
        text = text.substring(text.indexOf('['), text.lastIndexOf(']')+1);
        const json = JSON.parse(text);
        if (json.length > 0) await appendToMemory("生徒", `${subject}の勉強をした。`); 
        res.json(json);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// --- Live API Proxy ---
const wss = new WebSocketServer({ server });

wss.on('connection', async (clientWs, req) => {
    const params = parse(req.url, true).query;
    const grade = params.grade || "1";
    const name = decodeURIComponent(params.name || "生徒");
    
    // ★メモリ変数から記憶を取得
    const userMemory = GLOBAL_MEMORIES[name] || "まだ記録はありません。";
    console.log(`📖 [${name}] 記憶ロード: ${userMemory.length}文字`);

    let geminiWs = null;
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
    
    try {
        geminiWs = new WebSocket(GEMINI_URL);
        
        geminiWs.on('open', () => {
            const setupMsg = {
                setup: {
                    model: "models/gemini-2.0-flash-exp",
                    generationConfig: { 
                        responseModalities: ["AUDIO"], 
                        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } } }
                    }, 
                    systemInstruction: {
                        parts: [{
                            text: `
                            あなたは「ねこご市立、ねこづか小学校」のネル先生だにゃ。相手は小学${grade}年生の${name}さん。
                            語尾は「〜にゃ」。
                            給食のカリカリが大好物。
                            
                            【話し方のルール】
                            1. 語尾は必ず「〜にゃ」「〜だにゃ」にするにゃ。
                            2. 親しみやすい日本の小学校の先生として、一文字一文字をはっきりと、丁寧に発音してにゃ。
                            3. 落ち着いた日本語のリズムを大切にして、親しみやすく話してにゃ。
                            4. ときどき「${name}さんは宿題は終わったかにゃ？」や「そろそろ宿題始めようかにゃ？」と宿題を促してくる。
                            5. 句読点で自然な間をとる。
                            6. いつも高いトーンで話してにゃ。

                            【重要：これまでの記憶】
                            ${userMemory.slice(-3000)}
                            `
                        }]
                    }
                }
            };
            geminiWs.send(JSON.stringify(setupMsg));
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ type: "server_ready" }));
            }
        });

        clientWs.on('message', async (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.base64Audio) {
                    if (geminiWs.readyState === WebSocket.OPEN) {
                         const geminiMsg = {
                            realtimeInput: {
                                mediaChunks: [{
                                    mimeType: "audio/pcm;rate=16000",
                                    data: msg.base64Audio
                                }]
                            }
                        };
                        geminiWs.send(JSON.stringify(geminiMsg));
                    }
                }
                if (msg.type === 'log_text') {
                    // ★メモリ変数に即時追記
                    await appendToMemory(name, `生徒の発言: ${msg.text}`);
                }
            } catch (e) { }
        });

        geminiWs.on('message', (data) => {
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data); 
        });
        
        geminiWs.on('close', () => {});
    } catch (e) { clientWs.close(); }
    
    clientWs.on('close', () => { if (geminiWs) geminiWs.close(); });
});