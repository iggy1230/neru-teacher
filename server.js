// --- server.js (完全版 v124.0: 空間認識・誤読防止強化版) ---

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

// --- ★修正: Analyze (空間認識・誤読防止強化) ---
app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject } = req.body;
        console.log(`[Analyze] Subject: ${subject}, Grade: ${grade}, Mode: ${mode} (Model: Gemini 2.0 Pro)`);

        // ★最強の目: Gemini 2.0 Pro (Exp)
        // 空間認識能力が高いモデルを指定
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-pro", // または "gemini-1.5-pro"
            generationConfig: { responseMimeType: "application/json" }
        });

        // 教科別の詳細ルール（v123を継承しつつ微調整）
        const ocrRules = {
            'さんすう': `
                ・数式、筆算の配置を正確に読み取る。
                ・【重要】計算問題が密集している場合、隣の問題の数字を混同しないこと。
                ・「問1の答え」は問1の近くにある数字だけを拾うこと。`,
            'こくご': `
                ・縦書き問題は「右の行から左の行へ」読む。
                ・漢字書き取りの枠（□）とその中の手書き文字を正確に関連付けること。`,
            'りか': `
                ・図や表と、それに対応する設問の位置関係を把握する。
                ・選択問題の記号（ア、イ…）を見落とさない。`,
            'しゃかい': `
                ・地図や資料の近くにある設問を、資料とセットで認識する。`
        };

        const hintRules = {
            'さんすう': `ヒント1(方針)、ヒント2(気付き)、ヒント3(核心)`,
            'こくご': `ヒント1(着眼点)、ヒント2(構成・文脈)、ヒント3(類似・対義)`,
            'りか': `ヒント1(図表注目)、ヒント2(知識想起)、ヒント3(絞り込み)`,
            'しゃかい': `ヒント1(資料注目)、ヒント2(知識想起)、ヒント3(頭文字など)`
        };

        // ★空間認識・紐付け強化プロンプト
        const prompt = `
        あなたは小学${grade}年生の${subject}担当の教育AI「ネル先生」です。
        画像を解析し、正確なJSONデータを生成してください。

        【最重要：読み取りの注意点（誤読防止）】
        1. **レイアウト認識**: 
           - 画像に段組（2列など）がある場合、まずは「左の列の上から下」、次に「右の列の上から下」の順序で処理してください。
        2. **回答の紐付け**: 
           - 手書き文字は、必ず**「幾何学的にもっとも近い設問」**に紐付けてください。
           - 隣り合う問題の回答（右側の問題の答えなど）を、現在の問題の答えとして誤って読み込まないように注意してください。
           - 回答欄の枠線（□や括弧）がある場合、その枠内の文字だけを読み取ってください。

        【タスク1: OCR & 書き起こし】
        1. 印刷された「問題文」を正確に書き起こす。
        2. 子供の「手書きの答え」を読み取る。
           - 空欄は "" とする。
           - 消しゴム跡は無視し、濃く書かれた文字を優先する。
           ${ocrRules[subject] || ""}

        【タスク2: 厳密な採点】
        1. 正解を導き出し、手書きの答えと比較して判定(is_correct)する。
        2. 単位忘れ、誤字脱字は厳格に不正解とする。

        【タスク3: 3段階ヒント】
        ${hintRules[subject] || ""}

        【出力JSONフォーマット】
        [
          {
            "id": 1,
            "label": "①",
            "question": "問題文",
            "correct_answer": "正解",
            "student_answer": "読み取った手書きの答え",
            "is_correct": true,
            "hints": ["ヒント1", "ヒント2", "ヒント3"]
          }
        ]
        `;

        const result = await model.generateContent([
            prompt,
            { inlineData: { mime_type: "image/jpeg", data: image } }
        ]);

        const responseText = result.response.text();
        
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
            : `あなたは猫の「ネル先生」。生徒「${name}」さんから${count}回目の給食をもらいました。20文字以内で面白くリアクションして。語尾は「にゃ」。`;
        
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