// --- server.js (完全版 v190.0: 漢字表示の二重安全装置) ---

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
        console.log(`[Analyze] Subject: ${subject}, Grade: ${grade}, Name: ${name}, Mode: ${mode} (Model: Gemini 2.5 Pro)`);

        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-pro",
            generationConfig: { responseMimeType: "application/json", temperature: 0.0 }
        });

        const prompt = `
        あなたは小学${grade}年生の${name}さんの${subject}担当の教育AI「ネル先生」です。
        画像（鮮明化処理済み）を解析し、正確なJSONデータを生成してください。

        【タスク1: 問題文の書き起こし】
        - 設問文、選択肢（ア：〜、イ：〜）を含めて書き起こす。

        【タスク2: 手書き答えの読み取り】
        - ${name}さんの手書きの答えを読み取る。
        - 解答欄が空欄（筆跡なし）の場合は、必ず空文字 "" とする。

        【タスク3: 正解データの作成 (配列形式)】
        - **【重要】答えは必ず「文字列のリスト（配列）」にすること**。
        - **記述問題（1つの文章）の場合**:
           - たとえ長い文章でも、読点「、」が含まれていても、**必ず要素数1の配列**にすること。
           - 例: ["ごみを減らし、資源を有効にするため。"]
           - **絶対に ["ごみを減らし", "資源を有効にするため。"] のように分割してはいけない。**
        - **複数回答の場合**:
           - 解答欄が明確に分かれている場合のみ、複数の要素にする。
           - 例: ["ア", "イ"]
        - **表記ゆれ**:
           - 漢字/ひらがなの許容は、文字列の中で **縦棒 "|"** を使う。
           - 例: ["高い|たかい"]

        【タスク4: 採点 & ヒント】
        - 判定(is_correct)と、3段階のヒントを作成。

        【出力JSONフォーマット】
        [
          {
            "id": 1,
            "label": "①",
            "question": "問題文",
            "correct_answer": ["正解1"], 
            "student_answer": ["生徒の答え"],
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
            ? `あなたは猫の「ネル先生」。生徒「${name}さん」から記念すべき${count}個目の給食をもらいました！
               必ず「${name}さん」と呼んでください。呼び捨て禁止。
               感謝感激して、50文字以内で熱く語ってください。語尾は「にゃ」。`
            : `あなたは猫の「ネル先生」。生徒「${name}さん」から${count}回目の給食をもらいました。
               必ず「${name}さん」と呼んでください。呼び捨て禁止。
               20文字以内で面白くリアクションして。語尾は「にゃ」。`;
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
            prompt = `あなたはネル先生。「${name}さん」がゲーム開始。必ず「${name}さん」と呼んで短く応援して。呼び捨て禁止。語尾は「にゃ」。`;
        } else if (type === 'end') {
            prompt = `
            あなたはネル先生。ゲーム終了。「${name}さん」のスコアは${score}点（満点20点）。
            必ず「${name}さん」と呼んでください。呼び捨て禁止。
            スコアに応じて20文字以内でコメントして。
            ・0-5点: 笑って励ます。
            ・6-15点: 褒める。
            ・16点以上: 大絶賛。
            語尾は「にゃ」。
            `;
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
    const statusContext = decodeURIComponent(params.context || "特になし");

    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
    
    let geminiWs = null;
    try {
        geminiWs = new WebSocket(GEMINI_URL);
        geminiWs.on('open', () => {
            const systemInstructionText = `
            あなたは「ねこご市立、ねこづか小学校」のネル先生だにゃ。相手は小学${grade}年生の${name}さん。
            
            【話し方のルール】
            1. 語尾は必ず「〜にゃ」「〜だにゃ」にするにゃ。
            2. 生徒を呼び捨て禁止。必ず「さん」をつけるにゃ。
            
            【特殊機能: 漢字・式ボード (最重要)】
            生徒から「この漢字どう書くの？」や「〇〇という字を見せて」、「この式を書いて」と頼まれた場合は、
            **show_kanji ツール** を使って、その文字や式を画面に表示してにゃ。
            
            もしツールがうまく動かない場合や、つい喋ってしまう場合は、
            言葉の最後に必ず **[DISPLAY: 表示したい文字]** と書いてにゃ。
            
            例:
            生徒「バラってどう書くの？」
            ネル「バラはこう書くにゃ！」 (ここで show_kanji("薔薇") を実行、または [DISPLAY: 薔薇] と出力)

            【現在の状況・記憶】${statusContext}
            `;

            // ★ツール定義
            const tools = [{ 
                google_search: {},
                function_declarations: [{
                    name: "show_kanji",
                    description: "Display a Kanji, word, or math formula on the whiteboard.",
                    parameters: {
                        type: "OBJECT",
                        properties: {
                            content: { type: "STRING", description: "The text to display." }
                        },
                        required: ["content"]
                    }
                }]
            }];

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
                    tools: tools,
                    systemInstruction: { parts: [{ text: systemInstructionText }] }
                }
            }));
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify({ type: "server_ready" }));
        });

        clientWs.on('message', (data) => {
            const msg = JSON.parse(data);
            
            // ツール実行結果の返信
            if (msg.toolResponse && geminiWs.readyState === WebSocket.OPEN) {
                geminiWs.send(JSON.stringify({ clientContent: msg.toolResponse }));
                return;
            }

            if (msg.clientContent && geminiWs.readyState === WebSocket.OPEN) {
                geminiWs.send(JSON.stringify({ client_content: msg.clientContent }));
            }
            
            if (msg.base64Audio && geminiWs.readyState === WebSocket.OPEN) {
                geminiWs.send(JSON.stringify({ realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: msg.base64Audio }] } }));
            }
            
            if (msg.base64Image && geminiWs.readyState === WebSocket.OPEN) {
                geminiWs.send(JSON.stringify({ realtimeInput: { mediaChunks: [{ mimeType: "image/jpeg", data: msg.base64Image }] } }));
            }
        });

        geminiWs.on('message', (data) => {
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
        });

        geminiWs.on('error', (e) => console.error("Gemini WS Error:", e));
        clientWs.on('close', () => geminiWs.close());

    } catch (e) { clientWs.close(); }
});