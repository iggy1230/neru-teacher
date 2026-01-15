// --- server.js (完全版 v99.0: 採点ロジック統一 & 給食演出強化) ---

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

// --- Hybrid Analyze (Flash OCR -> Pro Reasoning) ---
app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject } = req.body;
        
        console.log(`[Analyze] Subject: ${subject}, Mode: ${mode}`);

        // --- Step 1: Gemini 2.0 Flash で「手書き文字」を含むOCR ---
        const flashModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        
        const ocrPrompt = `
        この${subject}のプリント画像を詳細に読み取ってください。
        
        【タスク】
        1. 活字の「問題文」を、**一字一句正確に、改変せずに**書き起こしてください。
        2. 子供が鉛筆で書いた「手書きの文字（答え）」があれば、それも読み取ってください。
        
        出力は構造化せず、見えたままのテキストデータとして出力してください。
        `;
        
        const flashResult = await flashModel.generateContent([
            ocrPrompt,
            { inlineData: { mime_type: "image/jpeg", data: image } }
        ]);
        const transcribedText = flashResult.response.text();
        console.log("OCR Result:", transcribedText.substring(0, 100) + "...");

        // --- Step 2: Gemini 2.5 Pro で推論 (仕様統一) ---
        // 「教えて」も「採点」も同じProモデルで、同じように正解を導き出す。
        const reasoningModel = genAI.getGenerativeModel({ 
            model: "gemini-1.5-pro",
            generationConfig: { responseMimeType: "application/json" }
        });

        // 手書き抽出の指示（モードによる切り替え）
        let answerExtractionInstruction = "";
        if (mode === 'grade') {
            answerExtractionInstruction = `
            - **student_answer**: OCRテキストの中から、子供が手書きで書いたと思われる「答え」の部分を抽出して入れてください。
            - 読み取れない、または空欄の場合は、勝手に正解を埋めず、必ず空文字 "" にしてください。
            - 誤字や書き間違いも、修正せずにそのまま抽出してください。
            `;
        } else {
            // 教えてモード
            answerExtractionInstruction = `
            - **student_answer**: このモードでは生徒の答えは不要です。必ず空文字 "" にしてください。
            `;
        }

        const solvePrompt = `
        あなたは小学${grade}年生の${subject}担当のネル先生です。
        以下の「読み取ったテキスト（OCR結果）」を元に、JSONデータを作成してください。

        【読み取ったテキスト】
        ${transcribedText}

        【重要ルール】
        1. **question**: OCR結果の問題文を**改変せず、そのまま**使ってください。要約したり、勝手に補完しないでください。
        2. **correct_answer**: 問題文から論理的に導き出した「絶対の正解」を入れてください。計算ミスや知識の間違いがないように慎重に解いてください。
        3. **hints**: 答えそのものは書かず、考え方や着眼点を3段階で教えてください。

        【回答抽出ルール】
        ${answerExtractionInstruction}

        【出力JSON形式 (リスト)】
        [
          {
            "id": 1, 
            "label": "①", 
            "question": "問題文(原文ママ)", 
            "correct_answer": "正答", 
            "student_answer": "生徒の答え(または空文字)", 
            "hints": ["ヒント1", "ヒント2", "ヒント3"]
          }
        ]
        `;

        const proResult = await reasoningModel.generateContent(solvePrompt);
        let finalText = proResult.response.text();
        
        const firstBracket = finalText.indexOf('[');
        const lastBracket = finalText.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket !== -1) {
            finalText = finalText.substring(firstBracket, lastBracket + 1);
        }

        const json = JSON.parse(finalText);
        res.json(json);

    } catch (err) { 
        console.error("Analyze Error:", err);
        res.status(500).json({ error: "解析エラーだにゃ: " + err.message }); 
    }
});

// --- 4. 給食反応 (10回ごと特別演出) ---
app.post('/lunch-reaction', async (req, res) => {
    try {
        const { count, name } = req.body;
        await appendToServerLog(name, `給食をくれた(${count}個目)。`);
        
        const isSpecial = (count % 10 === 0);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        
        let prompt = "";
        if (isSpecial) {
            prompt = `
            あなたは猫の「ネル先生」です。生徒「${name}」から、記念すべき${count}個目の給食（カリカリ）をもらいました！
            
            【指示】
            ・カリカリへの愛を熱く、情熱的に語ってください。
            ・${name}さんへの感謝を、少し大げさなくらい感激して伝えてください。
            ・文字数は50文字程度。
            ・語尾は「にゃ」「だにゃ」。
            `;
        } else {
            prompt = `
            あなたは猫の「ネル先生」です。生徒「${name}」から${count}回目の給食（カリカリ）をもらいました。
            ・「おいしいにゃ！」「最高だにゃ！」など、短く喜びを伝えて。
            ・20文字以内。
            ・毎回少し違う言い回しで。
            `;
        }

        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text().trim(), isSpecial });
    } catch { 
        res.json({ reply: "おいしいにゃ！", isSpecial: false }); 
    }
});

app.post('/game-reaction', async (req, res) => { res.json({ reply: "がんばれにゃ！", mood: "excited" }); });
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