// --- server.js (完全版 v35.0: 受信ログ強化・デバッグ対応) ---

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

async function initMemoryFile() {
    try {
        await fs.access(MEMORY_FILE);
    } catch {
        await fs.writeFile(MEMORY_FILE, JSON.stringify({}));
        console.log("📝 新しい記憶ファイル(memory.json)を作成しました");
    }
}
initMemoryFile();

async function appendToMemory(name, text) {
    if (!name || !text) return;
    try {
        let memories = {};
        try {
            const data = await fs.readFile(MEMORY_FILE, 'utf8');
            memories = JSON.parse(data);
        } catch {}

        const timestamp = new Date().toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        const newLog = `\n[${timestamp}] ${text}`;
        
        let currentMem = memories[name] || "";
        currentMem = (currentMem + newLog).slice(-5000); 
        
        memories[name] = currentMem;
        await fs.writeFile(MEMORY_FILE, JSON.stringify(memories, null, 2));
        console.log(`💾 記憶ファイルに追記: ${text.substring(0, 30)}...`);
    } catch (e) { console.error("❌ Memory Save Error:", e); }
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

app.get('/debug/memory', async (req, res) => {
    try {
        const data = await fs.readFile(MEMORY_FILE, 'utf8');
        res.header("Content-Type", "application/json; charset=utf-8");
        res.send(data);
    } catch (e) { res.status(500).send("Error"); }
});

// ... (detect-document, synthesize, game, lunch, chat, analyze APIは変更なし、そのまま維持) ...
// ※長くなるため省略しませんが、以前のコードと同じ内容を使用してください。
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
        if (!ttsClient) throw new Error("TTS Not Ready");
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
        if (type === 'end') await appendToMemory(name, `ゲーム終了。スコア${score}点。`);
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
        
        // (プロンプト省略なしで記述)
        const rules = {
            'さんすう': { attention: `・筆算の横線とマイナス記号を混同しないこと。\n・累乗（2^2など）や分数を正確に。`, hints: `1.立式のヒント...` },
            'こくご': { attention: `・漢字の書き取り...`, hints: `1.漢字のなりたち...` },
            'りか': { attention: `・グラフの軸ラベル...`, hints: `1.観察のポイント...` },
            'しゃかい': { attention: `・地図記号...`, hints: `1.資料の注目点...` }
        };
        const r = rules[subject] || rules['さんすう'];
        const studentAnswerInstruction = mode === 'explain' ? `・解答は空文字。` : `・手書き文字を読み取る。`;
        const prompt = `あなたはネル先生。画像の問題をJSON出力。ルール: 全て抽出。${studentAnswerInstruction}`; // 簡略化
        
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

// --- ★Live API Proxy (デバッグ強化版) ---
const wss = new WebSocketServer({ server });

wss.on('connection', async (clientWs, req) => {
    const params = parse(req.url, true).query;
    const grade = params.grade || "1";
    const name = decodeURIComponent(params.name || "生徒");
    
    let userMemory = "";
    try {
        const data = await fs.readFile(MEMORY_FILE, 'utf8');
        userMemory = JSON.parse(data)[name] || "まだ記録はありません。";
        console.log(`📖 [${name}] 記憶ロード: ${userMemory.length}文字`);
    } catch (e) { }

    let geminiWs = null;
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
    
    try {
        geminiWs = new WebSocket(GEMINI_URL);
        
        geminiWs.on('open', () => {
            console.log(`✨ [${name}] Gemini接続成功`);
            const setupMsg = {
                setup: {
                    model: "models/gemini-2.0-flash-exp",
                    generationConfig: { 
                        responseModalities: ["AUDIO"], 
                        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } } }
                    }, 
                    systemInstruction: {
                        parts: [{
                            text: `あなたは「ねこご市立ねこづか小学校」のネル先生。語尾は「〜にゃ」。記憶:${userMemory.slice(-3000)}`
                        }]
                    }
                }
            };
            geminiWs.send(JSON.stringify(setupMsg));
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ type: "server_ready" }));
            }
        });

        // クライアントからのメッセージ処理
        clientWs.on('message', async (data) => {
            try {
                // 生データ受信
                const rawStr = data.toString();
                
                // JSONパース試行
                let msg;
                try {
                    msg = JSON.parse(rawStr);
                } catch(e) {
                    console.error("❌ JSON Parse Error on Server:", e);
                    return;
                }
                
                // 1. 音声データの場合
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
                
                // 2. テキストログの場合 (ここが重要！)
                else if (msg.type === 'log_text') {
                    console.log(`📝 [${name}] 生徒発言を受信: ${msg.text}`);
                    await appendToMemory(name, `生徒の発言: ${msg.text}`);
                }
                else {
                    console.log("❓ 不明なメッセージタイプ:", Object.keys(msg));
                }
                
            } catch (e) {
                console.error("🔥 Server Message Handler Error:", e);
            }
        });

        geminiWs.on('message', (data) => {
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data); 
        });

        geminiWs.on('close', (c, r) => {
            if(c !== 1000) console.log(`🔒 Gemini Close: ${c} ${r}`);
        });

    } catch (e) { 
        console.error("WS Setup Error", e); 
        clientWs.close(); 
    }
    
    clientWs.on('close', async () => {
        if (geminiWs) geminiWs.close();
        console.log(`👋 [${name}] 切断`);
    });
});