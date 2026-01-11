// --- server.js (完全版 v25.1: 検出・分析精度向上) ---

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
} catch (e) { console.error("Init Error:", e.message); }

app.get('/debug/memory', async (req, res) => {
    try {
        const data = await fs.readFile(MEMORY_FILE, 'utf8');
        res.header("Content-Type", "application/json; charset=utf-8");
        res.send(data);
    } catch (e) { res.status(500).send("Error"); }
});

// --- 文書検出API (強化版) ---
app.post('/detect-document', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: "No image" });

        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash-exp", 
            generationConfig: { responseMimeType: "application/json" }
        });

        const prompt = `
        画像内にある「学習ドリル」や「プリント」の**ページ全体**の四隅の座標を検出してください。
        
        【重要】
        ・ページ内の小さなイラストや囲み枠ではなく、**紙の端（輪郭）**を探してください。
        ・背景（机や床）と紙の境界線を特定してください。
        ・紙の一部しか写っていない場合は、画像全体の四隅を選択してください。
        
        【出力形式 (JSON)】
        {
          "points": [
            { "x": 左上(0-100), "y": 左上(0-100) },
            { "x": 右上, "y": 右上 },
            { "x": 右下, "y": 右下 },
            { "x": 左下, "y": 左下 }
          ]
        }
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
        // エラー時はデフォルト値を返す
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

// --- 宿題分析API (JSON形式の安定化) ---
app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject, analysisType } = req.body;
        let modelName = analysisType === 'precision' ? "gemini-1.5-pro" : "gemini-2.0-flash-exp";
        const model = genAI.getGenerativeModel({ model: modelName, generationConfig: { responseMimeType: "application/json" } });

        const rules = {
            'さんすう': { attention: `・筆算の横線とマイナス記号を混同しない。\n・累乗や分数を正確に。\n・筆算の繰り上がりを「答え」と見間違えない。`, hints: `1.立式のヒント 2.単位や図のヒント 3.計算のコツ` },
            'こくご': { attention: `・縦書きは右から左へ読む。\n・解答欄（□）は『□(読み仮名)』形式で。\n・送り仮名ミスはバツ。`, hints: `1.漢字のなりたち 2.注目すべき言葉 3.文末の指定` },
            'りか': { attention: `・グラフの軸ラベルや単位を落とさない。\n・選択肢も書き出す。\n・カタカナ指定をひらがなで書いたらバツ。`, hints: `1.図表の見方 2.関連知識 3.選択肢の絞り込み` },
            'しゃかい': { attention: `・地図記号や年表を正確に読み取る。\n・漢字指定をひらがなで書いたらバツ。`, hints: `1.資料の注目点 2.時代の背景 3.キーワード` }
        };
        const r = rules[subject] || rules['さんすう'];
        const studentAnswerInstruction = mode === 'explain' ? `・手書き文字（生徒の答え）は無視し、student_answerは空文字にする。` : `・採点モード。手書き文字を可能な限り読み取りstudent_answerに入れる。`;

        const prompt = `
            あなたはネル先生（小学${grade}年生${subject}担当）。語尾は「にゃ」。
            画像の問題をJSONデータとして出力してください。
            【ルール】
            1. 全ての問題を抽出。
            2. 「解答欄」がないテキストは問題として扱わない。
            3. ${studentAnswerInstruction}
            4. 教科別注意: ${r.attention}
            5. １つの問いの中に複数の回答が必要なときは、必要な数だけ回答欄（JSONデータの要素）を分けてください。
            
            【重要】
            必ず有効なJSON配列形式で出力してください。Markdownのコードブロックは不要です。

            【出力JSON形式】
            [{"id": 1, "label": "①", "question": "問題文", "correct_answer": "正答", "student_answer": "", "hints": ["ヒント1", "ヒント2", "ヒント3"]}]
        `;

        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        let text = result.response.text();
        
        // JSON抽出の強化
        const firstBracket = text.indexOf('[');
        const lastBracket = text.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket !== -1) {
            text = text.substring(firstBracket, lastBracket + 1);
        }
        
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
                            text: `あなたはネル先生。語尾は「〜にゃ」。相手は小学${grade}年生の${name}さん。記憶:${userMemory.slice(-3000)}`
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
                    currentSessionLog += `生徒: ${msg.text}\n`;
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
        if (currentSessionLog.trim().length > 0) {
            await appendToMemory(name, currentSessionLog);
        }
    });
});