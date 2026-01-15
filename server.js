// --- server.js (完全版 v95.0: 採点ルール強化 & ハイブリッド) ---

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
        if (mood === "gentle") { rate = "0.95"; pitch = "+1st"; } // 優しいトーン追加
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
        const { image, mode, grade, subject, analysisType } = req.body;
        
        console.log(`[Analyze] Type: ${analysisType}, Subject: ${subject}, Mode: ${mode}`);

        // --- Step 1: Gemini 2.0 Flash で「手書き文字」を含むOCR ---
        const flashModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        
        // ★修正: 手書き抽出を強力に指示するプロンプト
        const ocrPrompt = `
        この${subject}のプリント画像を詳細に読み取ってください。
        
        【最重要タスク】
        活字の「問題文」だけでなく、**子供が鉛筆で書いた「手書きの答え」**を必ず読み取ってください。
        
        ・子供の筆跡なので、多少汚くても前後の文脈（計算式や文章の流れ）から数字や文字を推測してください。
        ・筆算の「繰り上がりのメモ」などの小さな数字は、答えと混同しないように区別してください。
        ・空欄（答えが書いていない）場合は、正直に「空欄」と認識してください。
        ・出力は構造化せず、見えたものを上から順にすべてテキスト化してください。
        `;
        
        const flashResult = await flashModel.generateContent([
            ocrPrompt,
            { inlineData: { mime_type: "image/jpeg", data: image } }
        ]);
        const transcribedText = flashResult.response.text();
        console.log("OCR Result:", transcribedText.substring(0, 100) + "...");

        // --- Step 2: Gemini 1.5 Pro で採点・推論 ---
        const reasoningModelName = "gemini-1.5-pro"; // 常にProを使う（精度優先）
        const reasoningModel = genAI.getGenerativeModel({ 
            model: reasoningModelName,
            generationConfig: { responseMimeType: "application/json" }
        });

        // 教科ごとの厳格な採点ルール
        const gradingRules = {
            'さんすう': `
                - 筆算の繰り上がりメモを「答え」と見間違えないこと。
                - 単位（cm, L, kgなど）が問題で指定されている場合、単位がない答えは不正解とみなす。
                - 数字の「0」と「6」、「1」と「7」の見間違いに注意し、文脈から慎重に判定する。`,
            'こくご': `
                - 漢字の書き取りは、トメ・ハネまで厳密に見なくてよいが、別の字に見える場合は不正解。
                - 送り仮名が間違っている場合は不正解。
                - 読解問題は、文末（〜こと、〜から等）が設問の要求に合っているかチェックする。`,
            'りか': `
                - カタカナ指定の用語（例：ジョウロ）をひらがなで書いていたら不正解。
                - 記号選択問題は記号が合致しているか確認。`,
            'しゃかい': `
                - 漢字指定の用語（例：都道府県名）をひらがなで書いていたら不正解。
                - 時代背景と用語が矛盾していないかチェック（例：江戸時代に士農工商）。`
        };
        const specificRule = gradingRules[subject] || gradingRules['さんすう'];

        const solvePrompt = `
        あなたは小学${grade}年生の${subject}担当のネル先生です。
        以下の「読み取ったテキスト（OCR結果）」を元に、JSONデータを作成してください。

        【読み取ったテキスト】
        ${transcribedText}

        【タスク】
        1. **student_answer**: 子供の手書き回答を抽出して入れる。
           - 空欄や判読不能な場合は、勝手に正解を入れず、必ず空文字 "" にする。
           - 読み取りミスがありそうな場合も、AIが見えたままの文字を入れる（後でユーザーが修正するため）。
        2. **correct_answer**: 問題文から論理的に導き出した「絶対の正解」を入れる。
        3. **判定**: 以下の採点ルールに基づき、正誤判定を行う（ここではヒント作成に利用）。
        
        【${subject}の特別採点ルール】
        ${specificRule}

        【ヒント生成ルール】
        - 答えそのものは書かない。
        - ヒント1: 考え方や公式。
        - ヒント2: 途中計算やキーワード。
        - ヒント3: ほぼ答えに近い誘導。

        【出力JSON形式 (リスト)】
        1つの問いの中に複数の回答欄がある場合は、それぞれ別の項目として出力してください。
        [
          {
            "id": 1, 
            "label": "①", 
            "question": "問題文", 
            "correct_answer": "正答", 
            "student_answer": "読み取った手書き回答", 
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

// --- Other Endpoints ---
app.post('/lunch-reaction', async (req, res) => {
    try {
        const { count, name } = req.body;
        await appendToServerLog(name, `給食をくれた(${count}個目)。`);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        const prompt = `生徒「${name}」から${count}回目の給食（カリカリ）をもらった猫のネル先生。
        15文字以内で、最高に喜ぶユニークな感想を言って。語尾は「にゃ」。`;
        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text().trim(), isSpecial: count % 5 === 0 });
    } catch { res.json({ reply: "おいしいにゃ！", isSpecial: false }); }
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
                        speech_config: { voice_config: { prebuilt_voice_config: { voice_name: "Aoede" } } } 
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