// --- server.js (完全版 v116.0: Analyze高速化 & スリム化) ---

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
app.use(express.json({ limit: '50mb' })); // 画像転送用に制限緩和
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
    // APIキーの設定を確認
    if (!process.env.GEMINI_API_KEY) {
        console.error("⚠️ GEMINI_API_KEY が設定されていません。.envファイルを確認してください。");
    }
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
        ttsClient = new textToSpeech.TextToSpeechClient({ credentials });
    } else {
        // ローカル開発用（認証ファイルがある場合）
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

// --- ★修正: Analyze (スリム化 & 高速化版) ---
app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject, analysisType } = req.body;
        console.log(`[Analyze] スリムモード: ${subject}, Mode: ${mode}`);

        // マルチモーダル対応モデルを使用（Gemini 2.0 Flash または Pro）
        // ※ 画像も文字も一度に理解できるモデルを指定
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-pro-002", // 高速で画像認識に強いモデル
            generationConfig: { responseMimeType: "application/json" } 
        });

        // anlyze.js が期待するフォーマットに合わせるためのプロンプト
        const studentAnswerPrompt = mode === 'grade' 
            ? "画像内の手書き文字（生徒の答え）も読み取って student_answer に入れてください。空欄や不正解でもそのまま読み取ること。" 
            : "このモードでは生徒の答えは不要です。student_answer は必ず空文字 \"\" にしてください。";

        const prompt = `
        あなたは小学${grade}年生の${subject}担当の教育AI「ネル先生」です。
        添付された画像のプリント問題を解き、以下のJSON形式（配列）で返してください。

        【タスク】
        1. 画像内の問題を正確に読み取る（OCR）。
        2. 問題の正解を導き出す。
        3. ${studentAnswerPrompt}
        4. 答えそのものではなく、ヒントとなる考え方を3段階で作成する。

        【出力JSONフォーマット】
        [
          {
            "id": 1,
            "label": "①",
            "question": "問題文(原文ママ)",
            "correct_answer": "正解",
            "student_answer": "生徒の答え(または空文字)",
            "hints": ["ヒント1: 考え方の第一歩", "ヒント2: 途中式のヒント", "ヒント3: 答えにかなり近いヒント"]
          }
        ]

        ※ ${subject}の採点ルール: 単位忘れや漢字指定のミスも厳密にチェックすること。
        ※ 必ずJSON配列のみを出力すること。Markdownのバッククォートは不要。
        `;

        // 画像とプロンプトを同時に送信（1パス処理）
        const result = await model.generateContent([
            prompt,
            { inlineData: { mime_type: "image/jpeg", data: image } }
        ]);

        const responseText = result.response.text();
        
        // JSONパース処理（安全策付き）
        let problems = [];
        try {
            // responseMimeType: "application/json" を指定しているのでそのままパースできるはず
            problems = JSON.parse(responseText);
        } catch (e) {
            // 万が一Markdownなどが混ざっていた場合の救済措置
            const jsonMatch = responseText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                problems = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error("AIからの応答が正しいJSON形式ではありませんでした。");
            }
        }

        // anlyze.js は配列を期待しているので、配列をそのまま返す
        res.json(problems);

    } catch (error) {
        console.error("解析エラーにゃ:", error);
        res.status(500).json({ error: "解析に失敗したにゃ: " + error.message });
    }
});

// --- 4. 給食反応 ---
app.post('/lunch-reaction', async (req, res) => {
    try {
        const { count, name } = req.body;
        await appendToServerLog(name, `給食をくれた(${count}個目)。`);
        
        const isSpecial = (count % 10 === 0);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        
        let prompt = "";
        if (isSpecial) {
            prompt = `あなたは猫の「ネル先生」。生徒「${name}さん」から記念すべき${count}個目の給食をもらいました！感謝感激して、少し大げさに、50文字以内で熱く語ってください。語尾は「にゃ」。`;
        } else {
            prompt = `あなたは猫の「ネル先生」。生徒「${name}」から${count}回目の給食をもらいました。短く、面白く、20文字以内でリアクションして。語尾は「にゃ」。`;
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
            prompt = `あなたはネル先生。ゲーム終了。スコアは${score}点（満点20点）。スコアに応じて${name}さんに20文字以内でコメントして。0-5点は笑って励ます、6-15点は褒める、16点以上は大絶賛。語尾は「にゃ」。`;
        } else {
            return res.json({ reply: "ナイスにゃ！", mood: "excited" });
        }

        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text().trim(), mood });
    } catch { 
        res.json({ reply: "おつかれさまにゃ！", mood: "happy" }); 
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// --- Server & WebSocket (Live Chat) ---
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

const wss = new WebSocketServer({ server });

wss.on('connection', async (clientWs, req) => {
    const params = parse(req.url, true).query;
    const grade = params.grade || "1";
    const name = decodeURIComponent(params.name || "生徒");
    const statusContext = decodeURIComponent(params.status || "特になし");

    // Gemini Realtime APIへの接続
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
                            語尾は「にゃ」。明るく親しみやすく、子供好きの先生として振る舞ってください。
                            【現在の状況】${statusContext}`
                        }]
                    }
                }
            }));
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify({ type: "server_ready" }));
        });

        clientWs.on('message', (data) => {
            const msg = JSON.parse(data);
            // 音声データのリレー
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