// --- server.js (完全版 v127.0: 縦書き・カタカナ誤読防止強化版) ---

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

// --- Analyze (Gemini 2.5 Pro) ---
app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject, name } = req.body;
        console.log(`[Analyze] Subject: ${subject}, Grade: ${grade}, Name: ${name}, Mode: ${mode}`);

        // 空間認識能力が高い最新モデルを使用
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-pro",
            generationConfig: { responseMimeType: "application/json" }
        });

        // ★教科別の詳細ルール（国語の縦書き・カタカナ対策を大幅強化）
        const ocrRules = {
            'さんすう': `
                ・数式、筆算の配置を正確に読み取る。
                ・隣の問題の数字を混同しないよう、設問番号との距離を確認する。`,
            'こくご': `
                ・【重要】縦書きレイアウトの認識強化。
                ・設問番号（問一、①など）の『真下』または『すぐ左』にある解答欄を、その問題の答えとして認識すること。
                ・離れた場所にある解答欄（2問先など）を誤って結びつけないよう、幾何学的な距離を厳密に判定してください。
                ・カタカナの選択肢（ア、イ、ウ、エ）は、形状が似ていても筆跡を慎重に区別してください（特に「イ」と「ウ」、「ア」と「マ」の混同に注意）。`,
            'りか': `
                ・図や表と設問の位置関係を把握。選択問題の記号（ア、イ）を見落とさない。`,
            'しゃかい': `
                ・地図や資料の近くにある設問をセットで認識。`
        };

        const hintRules = {
            'さんすう': `ヒント1(方針)、ヒント2(気付き)、ヒント3(核心)`,
            'こくご': `ヒント1(着眼点)、ヒント2(構成)、ヒント3(類似)`,
            'りか': `ヒント1(図表)、ヒント2(知識)、ヒント3(絞り込み)`,
            'しゃかい': `ヒント1(資料)、ヒント2(知識)、ヒント3(頭文字)`
        };

        const prompt = `
        あなたは小学${grade}年生の${name}さんの${subject}担当の教育AI「ネル先生」です。
        画像を解析し、正確なJSONデータを生成してください。

        【読み取りの注意点（空間認識・誤読防止）】
        1. **縦書き対応**: 国語などの縦書き問題では、視線の移動は「右の行から左の行」へ、行内は「上から下」へとなります。
        2. **回答の紐付け**: 手書き文字は、必ず**幾何学的にもっとも近い設問**に紐付けてください。数センチ離れた別の解答欄と入れ替わらないように注意してください。

        【タスク】
        1. 問題文を書き起こす。
        2. ${name}さんが書いた「手書きの答え」を読み取る（空欄は ""）。
           ${ocrRules[subject] || ""}
        3. 正解を導き出し、手書きの答えと判定(is_correct)する。
        4. 3段階のヒントを作成する。
           ${hintRules[subject] || ""}

        【出力JSON】
        [
          {
            "id": 1,
            "label": "①",
            "question": "問題文",
            "correct_answer": "正解",
            "student_answer": "手書きの答え",
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
            if (jsonMatch) problems = JSON.parse(jsonMatch[0]);
            else problems = JSON.parse(responseText);
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
        if (type === 'start') prompt = `ネル先生として${name}のゲーム開始を短く応援して。`;
        else if (type === 'end') prompt = `ネル先生としてゲーム終了後の${name}（スコア${score}/20）に20文字以内でコメントして。語尾は「にゃ」。`;
        else return res.json({ reply: "ナイスにゃ！", mood: "excited" });
        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text().trim(), mood: "excited" });
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
    const statusContext = decodeURIComponent(params.context || "特になし");

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
                            【状況・記憶】${statusContext}`
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