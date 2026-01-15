// --- server.js (完全版 v112.0: 給食＆ゲーム演出強化) ---

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

// --- Hybrid Analyze ---
app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject, analysisType } = req.body;
        console.log(`[Analyze] Type: ${analysisType}, Subject: ${subject}, Mode: ${mode}`);

        // --- Step 1: OCR (Flash) ---
        const flashModel = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
        
        let additionalOcrInstruction = "";
        if (subject === 'こくご') {
            additionalOcrInstruction = `
            ・国語は縦書きが多いです。右の行から左の行へ読み進めてください。
            `;
        } else {
            additionalOcrInstruction = `
            ・横書きで左右2列の場合は、左列を上から下まで読んでから、右列へ移動してください。
            ・隣り合う問題の文字を混同しないようにしてください。
            `;
        }

        const ocrPrompt = `
        この${subject}のプリント画像を詳細に読み取ってください。
        
        【タスク: 完全な書き起こし】
        画像内の「活字（問題）」と「手書き（回答）」を、対応関係がわかるようにすべて書き出してください。
        
        【読み取り順序】
        ${additionalOcrInstruction}
        
        【重要】
        ・問題文は**一字一句正確に**書き起こしてください。要約や省略は厳禁です。
        ・手書き文字（子供の答え）も、前後の文脈から推測して読み取ってください。
        
        出力形式: テキスト（見たままの順序で）
        `;
        
        const flashResult = await flashModel.generateContent([
            ocrPrompt,
            { inlineData: { mime_type: "image/jpeg", data: image } }
        ]);
        const transcribedText = flashResult.response.text();
        console.log("OCR Result:", transcribedText.substring(0, 100) + "...");

        // --- Step 2: 推論 (Pro 2.5) ---
        const reasoningModelName = "gemini-2.5-pro"; // ★絶対固定
        const reasoningModel = genAI.getGenerativeModel({ 
            model: reasoningModelName,
            generationConfig: { responseMimeType: "application/json" }
        });

        const gradingRules = {
            'さんすう': `- 単位（cm, L, kgなど）が問題で指定されている場合、単位がない答えは不正解。\n- 数字の「0」と「6」、「1」と「7」の見間違いに注意。`,
            'こくご': `- 送り仮名が間違っている場合は不正解。\n- 読解問題は、文末（〜こと、〜から等）が設問の要求に合っているかチェック。`,
            'りか': `- カタカナ指定の用語（例：ジョウロ）をひらがなで書いていたら不正解。`,
            'しゃかい': `- 漢字指定の用語をひらがなで書いていたら不正解。`
        };
        const specificRule = gradingRules[subject] || gradingRules['さんすう'];

        let studentAnswerInstruction = "";
        if (mode === 'grade') {
            studentAnswerInstruction = `
            - **student_answer**: OCRテキストの中から、手書き文字部分を抽出して入れてください。
               - 空欄や判読不能な場合は、必ず空文字 "" にしてください。
               - 誤字や書き間違いも、修正せずにそのまま抽出してください。
            `;
        } else {
            studentAnswerInstruction = `
            - **student_answer**: このモードでは生徒の答えは不要です。必ず空文字 "" にしてください。
            `;
        }

        const solvePrompt = `
        あなたは小学${grade}年生の${subject}担当のネル先生です。
        以下の「読み取ったテキスト（OCR結果）」を元に、JSONデータを作成してください。

        【読み取ったテキスト】
        ${transcribedText}

        【作成ルール】
        1. **question**: OCRテキストの「問題文」を**そのまま、一字一句改変せず**に使ってください。要約禁止。
        2. **correct_answer**: 問題文から論理的に導き出した「絶対の正解」を入れてください。
        3. **student_answer**: ${studentAnswerInstruction}
        4. **hints**: 答えそのものは書かず、考え方や着眼点を3段階で教えてください。

        【${subject}の採点方針】
        ${specificRule}

        【出力JSON形式 (リスト)】
        [
          {
            "id": 1, "label": "①", "question": "問題文(原文ママ)", "correct_answer": "正答", "student_answer": "生徒の答え(または空文字)", "hints": ["ヒント1", "ヒント2", "ヒント3"]
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

// --- 4. 給食反応 (特別演出 & バリエーション強化) ---
app.post('/lunch-reaction', async (req, res) => {
    try {
        const { count, name } = req.body;
        await appendToServerLog(name, `給食をくれた(${count}個目)。`);
        
        const isSpecial = (count % 10 === 0);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        
        let prompt = "";
        if (isSpecial) {
            // 10回に1回: 熱く語る（さん付け必須）
            prompt = `
            あなたは猫の「ネル先生」です。生徒「${name}」から、記念すべき${count}個目の給食（カリカリ）をもらいました！
            【指示】
            1. 必ず「${name}さん」と、さん付けで呼んでください。
            2. カリカリへの愛を熱く、情熱的に語ってください。
            3. 感謝を少し大げさなくらい感激して伝えてください。
            4. 文字数は50文字程度。語尾は「にゃ」「だにゃ」。
            `;
        } else {
            // 通常時: 笑えるバリエーション（さん付けはたまに）
            prompt = `
            あなたは猫の「ネル先生」です。生徒「${name}」から${count}回目の給食（カリカリ）をもらいました。
            【指示】
            1. 普段は名前を呼ばなくていいですが、5回に1回くらいの確率で気まぐれに「${name}さん」と呼んでください。呼ぶときは必ず「さん」をつけてください。
            2. カリカリの味、音、匂い、食感などを独特な表現で褒めるか、または猫としてのシュールなジョークを言ってください。
            3. ユーモアたっぷり、笑える感じで。
            4. 20文字以内。
            `;
        }
        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text().trim(), isSpecial });
    } catch { res.json({ reply: "おいしいにゃ！", isSpecial: false }); }
});

// --- 3. ゲーム反応 (スコア連動) ---
app.post('/game-reaction', async (req, res) => {
    try {
        const { type, name, score } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        let prompt = "";
        let mood = "excited";

        if (type === 'start') {
            prompt = `あなたはネル先生。「${name}」がゲーム開始。「がんばれ！」と短く応援して。`;
        } else if (type === 'end') {
            // スコアに応じたコメント
            prompt = `
            あなたはネル先生。ゲーム終了。スコアは${score}点（満点20点）です。
            スコアに応じて以下のテンションで、${name}さんに20文字以内でコメントしてください。
            ・0-5点: 下手すぎて笑ってしまう感じで励ます。
            ・6-15点: まあまあだね、と上から目線で褒める。
            ・16-20点: すごい！と大げさに驚く。
            語尾は「にゃ」。
            `;
        } else {
            // プレイ中
            return res.json({ reply: "ナイスにゃ！", mood: "excited" });
        }

        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text().trim(), mood });
    } catch { 
        res.json({ reply: "おつかれさまにゃ！", mood: "happy" }); 
    }
});

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