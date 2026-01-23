// --- server.js (v272.0: 音声とテキストの両立・安定版) ---

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

// --- ログ機能 ---
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

// --- AI初期化 ---
let genAI, ttsClient;
try {
    if (!process.env.GEMINI_API_KEY) console.error("⚠️ GEMINI_API_KEY が設定されていません。");
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    ttsClient = new textToSpeech.TextToSpeechClient();
} catch (e) { console.error("Init Error:", e.message); }

// --- 通常のAPIエンドポイント ---

// 1. TTS
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

// 2. 記憶更新 (Gemini 1.5 Flash - 負荷分散)
app.post('/update-memory', async (req, res) => {
    try {
        const { currentProfile, chatLog } = req.body;
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash", 
            generationConfig: { responseMimeType: "application/json" }
        });
        const prompt = `あなたは生徒の長期記憶を管理するAIです。以下のプロフィールと会話ログから、新しい情報を追加してJSONで返してください。\n\n現在のプロフィール: ${JSON.stringify(currentProfile)}\n会話ログ: ${chatLog}`;
        const result = await model.generateContent(prompt);
        let text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        res.json(JSON.parse(text));
    } catch (error) { res.status(500).json({ error: "Memory update failed" }); }
});

// 3. 宿題分析 (Gemini 2.5 Pro - 精度重視)
app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject, name } = req.body;
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-pro", 
            generationConfig: { responseMimeType: "application/json" }
        });
        const prompt = `あなたは小学${grade}年生の${name}さんの${subject}担当AI「ネル先生」です。画像を解析し、問題文、正解(配列)、生徒の答え(配列)、正誤判定、ヒントをJSON配列で出力してください。`;
        const result = await model.generateContent([prompt, { inlineData: { mime_type: "image/jpeg", data: image } }]);
        let text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        res.json(JSON.parse(text));
    } catch (error) { res.status(500).json({ error: "Analysis failed" }); }
});

// 4. 反応系 (Gemini 1.5 Flash - 負荷分散)
app.post('/lunch-reaction', async (req, res) => {
    try {
        const { count, name } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(`${name}さんから${count}個目の給食をもらいました。短く喜んで。`);
        res.json({ reply: result.response.text().trim(), isSpecial: (count % 10 === 0) });
    } catch { res.json({ reply: "おいしいにゃ！", isSpecial: false }); }
});
app.post('/game-reaction', async (req, res) => {
    try {
        const { type, name, score } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(`ゲーム${type}。スコア${score}。短くコメントして。`);
        res.json({ reply: result.response.text().trim(), mood: "excited" });
    } catch { res.json({ reply: "ナイスにゃ！", mood: "excited" }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// --- WebSocket (Live Chat) ---
const wss = new WebSocketServer({ server });

wss.on('connection', async (clientWs, req) => {
    const params = parse(req.url, true).query;
    const name = decodeURIComponent(params.name || "生徒");
    const grade = params.grade || "1";
    let geminiWs = null;

    const connectToGemini = (context) => {
        const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
        try {
            geminiWs = new WebSocket(GEMINI_URL);
            geminiWs.on('open', () => {
                console.log("Gemini Connected");
                // ★設定：音声とテキストの両方を要求 (CamelCase)
                geminiWs.send(JSON.stringify({
                    setup: {
                        model: "models/gemini-2.0-flash-exp",
                        generationConfig: { 
                            responseModalities: ["AUDIO", "TEXT"], 
                            speechConfig: { 
                                voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
                                languageCode: "ja-JP"
                            }
                        },
                        systemInstruction: {
                            parts: [{ text: `あなたは猫のネル先生。相手は小学${grade}年生の${name}さん。語尾は「にゃ」。\n記憶: ${context}` }]
                        },
                        tools: [{ functionDeclarations: [
                            {
                                name: "register_collection_item",
                                description: "Register an item shown in the camera to the collection.",
                                parameters: { type: "OBJECT", properties: { item_name: { type: "STRING" } }, required: ["item_name"] }
                            }
                        ]}]
                    }
                }));
                if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify({ type: "server_ready" }));
            });

            geminiWs.on('message', (data) => {
                try {
                    const response = JSON.parse(data);
                    // ツール呼び出し処理
                    const serverContent = response.serverContent;
                    if (serverContent?.modelTurn?.parts) {
                        serverContent.modelTurn.parts.forEach(part => {
                            if (part.functionCall && part.functionCall.name === "register_collection_item") {
                                if (clientWs.readyState === WebSocket.OPEN) {
                                    clientWs.send(JSON.stringify({ type: "save_to_collection", itemName: part.functionCall.args.item_name }));
                                }
                                geminiWs.send(JSON.stringify({
                                    toolResponse: { functionResponses: [{ name: "register_collection_item", response: { result: "ok" }, id: part.functionCall.id }] }
                                }));
                            }
                        });
                    }
                    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
                } catch(e) {}
            });

            geminiWs.on('close', (code) => {
                if (clientWs.readyState === WebSocket.OPEN) clientWs.close(1000, "Gemini Closed");
            });

            geminiWs.on('error', (e) => console.error("Gemini Error:", e));

        } catch(e) { clientWs.close(); }
    };

    clientWs.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.type === 'init') {
            connectToGemini(msg.context || "");
        } else if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
            if (msg.base64Audio) {
                geminiWs.send(JSON.stringify({ realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: msg.base64Audio }] } }));
            } else if (msg.base64Image) {
                geminiWs.send(JSON.stringify({ realtimeInput: { mediaChunks: [{ mimeType: "image/jpeg", data: msg.base64Image }] } }));
            }
        }
    });

    clientWs.on('close', () => { if (geminiWs) geminiWs.close(); });
});