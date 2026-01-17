// --- server.js (完全版 v123.0: Gemini 2.5 Pro 安定・高精度版) ---

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

// --- ★修正: Analyze (Gemini 2.5 Pro 3段階ヒント・高精度版) ---
app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject } = req.body;
        console.log(`[Analyze] Subject: ${subject}, Grade: ${grade}, Mode: ${mode} (Model: Gemini 2.5 Pro)`);

        // ★最強の目: Gemini 2.5 Pro
        // 複雑な推論とOCR精度を最優先する設定
        const model = genAI.getGenerativeModel({ 
            model: "models/gemini-2.5-pro", 
            generationConfig: { responseMimeType: "application/json" }
        });

        // 教科別の書き起こし・OCRルール（Proの精度を活かす詳細指示）
        const ocrRules = {
            'さんすう': `
                ・数式、筆算の配置、単位（cm, L, kgなど）を正確に読み取ってください。
                ・数字の書き間違い（例: 0と6、1と7）も、子供の筆跡として忠実に読み取ってください。`,
            'こくご': `
                ・縦書き問題は右行から左行へ順に読み取ってください。
                ・漢字の書き取りは『□(ふりがな)』形式で。送り仮名のミスも修正せずそのまま読み取ってください。`,
            'りか': `
                ・グラフの目盛り、実験器具の名称、記号選択（ア、イ、ウ）を正確に。`,
            'しゃかい': `
                ・地図記号、年号、人名の漢字（旧字含む）を正確に。`
        };

        // 3段階ヒント生成ルール
        const hintRules = {
            'さんすう': `
                ・ヒント1（方針）: 計算の種類や公式の確認（例:「あわせていくつ？だから…」）。
                ・ヒント2（気付き）: 単位変換や繰り上がり等の注意点（例:「1mは100cmだにゃ」）。
                ・ヒント3（核心）: 答えの一歩手前（例:「一の位は計算できたにゃ？次は…」）。`,
            'こくご': `
                ・ヒント1（着眼点）: 漢字の部首や、文章中の探す場所（例:「『しかし』の後ろを見てにゃ」）。
                ・ヒント2（構成）: 画数や熟語の構成（例:「きへんだにゃ」）。
                ・ヒント3（類似）: 形の似ている文字や対義語（例:「『右』の反対だにゃ」）。`,
            'りか': `
                ・ヒント1: 図や表の注目ポイント。
                ・ヒント2: 実験の目的や用語の定義。
                ・ヒント3: 選択肢の絞り込み。`,
            'しゃかい': `
                ・ヒント1: 資料の読み取り方。
                ・ヒント2: 時代の流れや関連用語。
                ・ヒント3: キーワードの頭文字など。`
        };

        const prompt = `
        あなたは小学${grade}年生の${subject}担当の教育AI「ネル先生」です。
        添付画像を、最高レベルの精度を持つGemini 2.5 Proとして解析し、JSON配列で返してください。

        【タスク1: 超高精度OCR】
        1. 印刷された「問題文」を一字一句正確に書き起こしてください。
        2. 子供が書いた「手書きの答え」を、文脈と筆跡から判断して読み取ってください。
           - 空欄は空文字 "" とする。
           - 誤字や消しゴム跡も考慮し、書かれている「現状」を正確にデータ化する。
           ${ocrRules[subject] || ""}

        【タスク2: 厳密な採点】
        1. 問題文から論理的に「正解」を導き出してください。
        2. 手書きの答えと正解を比較し、判定(is_correct)を行ってください。
           - 算数の単位忘れ、国語の送り仮名ミス、漢字指定等は「不正解」として扱ってください。

        【タスク3: 3段階ヒント生成】
        以下の指針に従い、答えを直接教えずに導くヒントを作成してください。
        ${hintRules[subject] || ""}

        【出力JSONフォーマット】
        [
          {
            "id": 1,
            "label": "①", // 問題番号
            "question": "問題文",
            "correct_answer": "正解",
            "student_answer": "手書きの答え",
            "is_correct": true, // または false
            "hints": ["ヒント1(方針)", "ヒント2(気付き)", "ヒント3(核心)"]
          }
        ]
        `;

        const result = await model.generateContent([
            prompt,
            { inlineData: { mime_type: "image/jpeg", data: image } }
        ]);

        const responseText = result.response.text();
        
        // JSON抽出とパース
        let problems = [];
        try {
            const jsonMatch = responseText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                problems = JSON.parse(jsonMatch[0]);
            } else {
                problems = JSON.parse(responseText);
            }
        } catch (e) {
            console.error("JSON Parse Error:", responseText);
            throw new Error("AIの応答が正しいJSON形式ではありませんでした。");
        }

        res.json(problems);

    } catch (error) {
        console.error("解析エラー:", error);
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
        
        let prompt = isSpecial 
            ? `あなたは猫の「ネル先生」。生徒「${name}」さんから${count}個目の給食をもらいました！感謝感激して、50文字以内で熱く語ってください。語尾は「にゃ」。`
            : `あなたは猫の「ネル先生」。生徒「${name}」から${count}回目の給食をもらいました。20文字以内で面白くリアクションして。語尾は「にゃ」。`;
        
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
            prompt = `ネル先生として${name}のゲーム開始を短く応援して。`;
        } else if (type === 'end') {
            prompt = `ネル先生としてゲーム終了後の${name}（スコア${score}/20）に20文字以内でコメントして。0-5点は励まし、6-15点は褒め、16点以上は絶賛。語尾は「にゃ」。`;
        } else {
            return res.json({ reply: "ナイスにゃ！", mood: "excited" });
        }

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
                    model: "models/gemini-2.0-flash-exp", // チャットはFlashで高速応答
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
                            【状況】${statusContext}`
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