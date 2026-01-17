// --- server.js (完全版 v2026.0: Gemini 3 Flash & Code Execution 搭載) ---

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
    // 2026年最新SDKとして初期化
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

// --- TTS (Text to Speech) ---
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

// --- ★修正: Analyze (Gemini 3 Flash 最強版) ---
app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject } = req.body;
        console.log(`[Analyze] Subject: ${subject}, Grade: ${grade}, Mode: ${mode} (Gemini 3 Flash Running...)`);

        // ★2026年最新モデル: Gemini 3 Flash Preview
        // Thinking Mode & Code Execution をフル活用
        const model = genAI.getGenerativeModel({ 
            model: "gemini-3-flash-preview", 
            generationConfig: { 
                responseMimeType: "application/json",
                // 【Thinking Mode】思考プロセスを有効化 (Mediumレベル)
                thinkingConfig: { thinkingLevel: "medium" } 
            },
            // 【Code Execution】Pythonコード実行による計算検証を有効化
            tools: [{ codeExecution: {} }]
        });

        // 教科別の詳細ルール（v118の資産を継承して精度維持）
        const ocrRules = {
            'さんすう': `・数式や筆算は、Code Execution機能を使って必ず計算結果を検証してください。`,
            'こくご': `・縦書きは右から左へ。漢字書き取りは『□(ふりがな)』形式で。`,
            'りか': `・グラフや図表の数値を正確に読み取ること。`,
            'しゃかい': `・歴史用語や地名は正確な漢字で読み取ること。`
        };

        const hintRules = {
            'さんすう': `・計算問題は、Pythonで検算した正確な値を元にヒントを出すこと。`,
            'こくご': `・読解は本文の該当箇所を探させるヒント。漢字は部首や構成のヒント。`,
            'りか': `・実験器具の使い方や、図表の読み取り方をヒントにする。`,
            'しゃかい': `・関連する用語や時代の前後関係をヒントにする。`
        };

        // ★最強プロンプト
        const prompt = `
        あなたは小学${grade}年生の${subject}担当の教育AI「ネル先生」です。
        最新の **Gemini 3 Flash** の能力（超高精度OCR、思考モード、コード実行）を駆使して、画像を解析してください。

        【タスク実行手順】
        1. **画像認識 (OCR)**: 
           - 印刷された「問題文」と、子供が書いた「手書きの答え」を正確に読み取ってください。
           - 消しゴムの跡や、独特な書き順も文脈から補正して読み取ってください。
           ${ocrRules[subject] || ""}

        2. **正誤判定 & 検証 (Thinking & Code Execution)**:
           - **算数の場合**: 読み取った数式を必ず **Code Execution (Python)** で計算し、正解を導き出してください。AIの思い込みによる計算ミスは許されません。
           - 正解と手書きの答えを比較し、厳密に判定(is_correct)してください。

        3. **アドバイス作成 (Thinking Mode)**:
           - なぜ生徒がその答えを書いたのか、思考モードで「間違いの原因」を推測してください。
           - その推測に基づき、答えそのものではなく「気付き」を与えるヒントを3段階で作成してください。
           ${hintRules[subject] || ""}

        【出力JSONフォーマット】
        [
          {
            "id": 1,
            "label": "①",
            "question": "問題文(原文ママ)",
            "correct_answer": "正解",
            "student_answer": "読み取った手書きの答え(空欄なら空文字)",
            "is_correct": true, // または false
            "hints": ["ヒント1 (思考モードの結果に基づく)", "ヒント2", "ヒント3"]
          }
        ]
        
        ※ 思考プロセス(thought)はJSONに含めず、結果のJSON配列のみを出力してください。
        `;

        const result = await model.generateContent([
            prompt,
            { inlineData: { mime_type: "image/jpeg", data: image } }
        ]);

        const responseText = result.response.text();
        
        // JSON抽出処理（Thinking Modeの思考ログが混ざる可能性を考慮して厳密に抽出）
        let problems = [];
        try {
            const jsonMatch = responseText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                problems = JSON.parse(jsonMatch[0]);
            } else {
                // そのままパースを試みる
                problems = JSON.parse(responseText);
            }
        } catch (e) {
            console.error("JSON Parse Error:", responseText);
            throw new Error("AIの応答がJSON形式ではありませんでした。");
        }

        res.json(problems);

    } catch (error) {
        console.error("解析エラー:", error);
        // エラーハンドリングもネル先生らしく
        res.status(500).json({ error: "Gemini 3 Flashの起動に失敗したにゃ。APIキーかSDKを確認してにゃ！: " + error.message });
    }
});

// --- 4. 給食反応 (v118準拠) ---
app.post('/lunch-reaction', async (req, res) => {
    try {
        const { count, name } = req.body;
        await appendToServerLog(name, `給食をくれた(${count}個目)。`);
        const isSpecial = (count % 10 === 0);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" }); // 会話は軽量モデルでOK
        let prompt = isSpecial 
            ? `あなたは猫のネル先生。生徒${name}さんから${count}個目の給食をもらいました。感謝感激して50文字以内で熱く語って。語尾は「にゃ」。`
            : `あなたは猫のネル先生。生徒${name}から${count}回目の給食をもらいました。20文字以内で面白くリアクションして。語尾は「にゃ」。`;
        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text().trim(), isSpecial });
    } catch { res.json({ reply: "おいしいにゃ！", isSpecial: false }); }
});

// --- 3. ゲーム反応 (v118準拠) ---
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

// --- WebSocket (Chat) ---
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