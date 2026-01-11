// --- server.js (完全版 v29.0: 読み取り強化・エラー回避) ---

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

const MEMORY_FILE = path.join(__dirname, 'memory.json');

async function initMemoryFile() {
    try {
        await fs.access(MEMORY_FILE);
    } catch {
        await fs.writeFile(MEMORY_FILE, JSON.stringify({}));
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
    } catch (e) { console.error("Memory Save Error:", e); }
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
} catch (e) { 
    console.error("Init Error:", e.message); 
}

// --- API ---

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

        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash-exp", 
            generationConfig: { responseMimeType: "application/json" }
        });

        const prompt = `
        画像内にある「メインの書類（ノート、プリント、教科書）」の四隅の座標を検出してください。
        
        【出力ルール】
        - JSON形式 {"points": [{"x":.., "y":..}, ...]}
        - 左上(TL), 右上(TR), 右下(BR), 左下(BL) の順
        - 座標 x, y は画像全体に対するパーセンテージ(0〜100)
        `;

        const result = await model.generateContent([
            { inlineData: { mime_type: "image/jpeg", data: image } },
            { text: prompt }
        ]);

        let text = result.response.text();
        const match = text.match(/\{[\s\S]*\}/);
        if (match) text = match[0];
        res.json(JSON.parse(text));
    } catch (e) {
        console.error("Detect Error:", e);
        res.json({ points: [{x:5,y:5}, {x:95,y:5}, {x:95,y:95}, {x:5,y:95}] });
    }
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

// --- ★修正: 宿題分析API (プロンプト大幅緩和・JSON抽出強化) ---
app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject, analysisType } = req.body;
        
        // 分析モード
        let modelName = analysisType === 'precision' ? "gemini-2.5-pro" : "gemini-2.0-flash-exp";
        
        const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: { responseMimeType: "application/json" }
        });

        // 指示の緩和（studentAnswerInstruction）
        const studentAnswerInstruction = mode === 'explain' 
            ? `・"student_answer" は空文字 "" にしてください。`
            : `・手書き文字があれば "student_answer" に入れる。なければ空文字。`;

        const prompt = `
            あなたは「ねこご市立ねこづか小学校」のネル先生（小学${grade}年生${subject}担当）です。語尾は「にゃ」。
            
            【タスク】
            画像に含まれる「問題」と思われる部分をすべて抽出し、JSONデータにしてください。
            
            【超重要ルール】
            1. **多少読み取りにくくても、問題文らしきものがあればすべて書き出してください。**
            2. **解答欄（□や括弧）がなくても、設問文があれば抽出対象です。**
            3. ${studentAnswerInstruction}
            4. １つの大問に複数の小問がある場合は、別々のアイテムとして出力してください。

            【ヒント生成】
            正解を直接書かず、3段階のヒントを作成してください。

            【出力JSON形式】
            [
              {
                "id": 1, 
                "label": "①", 
                "question": "ここに問題文を書き写す", 
                "correct_answer": "正解", 
                "student_answer": "", 
                "hints": ["ヒント1", "ヒント2", "ヒント3"]
              }
            ]
        `;

        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        let text = result.response.text();
        
        // ★JSON抽出ロジック強化: 配列のブラケットを探して切り出す
        const firstBracket = text.indexOf('[');
        const lastBracket = text.lastIndexOf(']');
        
        if (firstBracket !== -1 && lastBracket !== -1) {
            text = text.substring(firstBracket, lastBracket + 1);
        } else {
            // 配列が見つからない場合のエラー処理
            console.error("Invalid JSON format:", text);
            throw new Error("データ形式がおかしいにゃ…");
        }
        
        const json = JSON.parse(text);
        
        if (json.length > 0) {
            await appendToMemory("生徒", `${subject}の勉強をした。`); 
        } else {
            // 空配列の場合もエラー扱いにせず、クライアント側でハンドリングさせる
            console.warn("Empty questions array");
        }
        
        res.json(json);

    } catch (err) { 
        console.error("Analyze API Error:", err);
        // クライアントがキャッチしやすい形でエラーを返す
        res.status(500).json({ error: "AI読み取りエラー: " + err.message }); 
    }
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
    
    let userMemory = "";
    try {
        const data = await fs.readFile(MEMORY_FILE, 'utf8');
        userMemory = JSON.parse(data)[name] || "";
    } catch (e) { }

    let currentSessionLog = "";
    let geminiWs = null;
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
    
    try {
        geminiWs = new WebSocket(GEMINI_URL);
        
        geminiWs.on('open', () => {
            // Aoedeボイス設定 & キャメルケース
            const setupMsg = {
                setup: {
                    model: "models/gemini-2.0-flash-exp",
                    generationConfig: { 
                        responseModalities: ["AUDIO"], 
                        speechConfig: {
                            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } }
                        }
                    }, 
                    systemInstruction: {
                        parts: [{
                            text: `
                            あなたは「ねこご市立、ねこづか小学校」のネル先生だにゃ。相手は小学${grade}年生の${name}さん。
                            語尾は「〜にゃ」。
                            【記憶】${userMemory.slice(-3000)}
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

        // クライアント -> Gemini
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
                    console.log(`📝 [${name}] 発言: ${msg.text}`);
                    await appendToMemory(name, `生徒の発言: ${msg.text}`);
                }
            } catch (e) { }
        });

        geminiWs.on('message', (data) => {
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data); 
        });
        
        geminiWs.on('close', () => {});
    } catch (e) { clientWs.close(); }
    
    clientWs.on('close', async () => {
        if (geminiWs) geminiWs.close();
    });
});