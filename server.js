// --- server.js (完全版 v203.0: データ抽出ロジック強化) ---

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

// --- Memory Update ---
app.post('/update-memory', async (req, res) => {
    try {
        const { currentProfile, chatLog } = req.body;
        console.log("[Memory] Updating profile...");
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash", 
            generationConfig: { responseMimeType: "application/json" }
        });
        const prompt = `
        あなたは生徒の長期記憶を管理するAIです。
        以下の「現在のプロフィール」と「直近の会話ログ」をもとに、プロフィールを更新してください。
        【現在のプロフィール】${JSON.stringify(currentProfile)}
        【直近の会話ログ】${chatLog}
        【更新ルール】
        1. **birthday**: 誕生日や年齢があれば記録。
        2. **likes**: 好きなものを追加。
        3. **weaknesses**: 苦手なことを追加。
        4. **achievements**: 頑張ったことを記録。
        5. **last_topic**: 最後の話題を記録。
        6. JSON形式で出力。
        `;
        const result = await model.generateContent(prompt);
        let text = result.response.text();
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const newProfile = JSON.parse(text);
        console.log("[Memory] Updated:", newProfile);
        res.json(newProfile);
    } catch (error) {
        console.error("Memory Update Error:", error);
        res.status(500).json({ error: "Memory update failed" });
    }
});

// --- Analyze (Gemini 2.5 Pro) ---
app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject, name } = req.body;
        console.log(`[Analyze] Subject: ${subject}, Grade: ${grade}, Name: ${name}, Mode: ${mode}`);

        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-pro-exp-02-05", // 最新の高性能モデルを使用
            generationConfig: { temperature: 0.0 } // 創造性をゼロにして正確性重視
        });

        const prompt = `
        あなたは小学${grade}年生の${name}さんの${subject}担当の教育AI「ネル先生」です。
        画像（鮮明化処理済み）を解析し、以下の厳格なJSONフォーマットでデータを出力してください。

        【タスク1: 問題文の書き起こし】
        - 設問文、選択肢（ア：〜、イ：〜）を含めて書き起こす。

        【タスク2: 手書き答えの読み取り】
        - ${name}さんの手書きの答えを読み取る。
        - **空欄判定**: 解答欄に**「手書きの筆跡」**がない場合は、正解が分かっていても**絶対に student_answer を空文字 "" にしてください。**

        【タスク3: 正解データの作成 (配列形式)】
        - **答えは必ず「文字列のリスト（配列）」にする**。
        - 記述問題（文章）の場合も、["文章"] という形式にする。
        - 複数回答（アとイなど）の場合のみ、["ア", "イ"] とする。

        【タスク4: 採点 & ヒント】
        - 判定(is_correct)と、3段階のヒントを作成。

        【出力JSONフォーマット】
        [
          {
            "id": 1,
            "label": "①",
            "question": "問題文",
            "correct_answer": ["正解"], 
            "student_answer": ["手書きの答え"],
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
        console.log("[Analyze] Raw Response Length:", responseText.length);
        
        let problems = [];
        try {
            // ★最強の抽出ロジック: 最初の大カッコ [ から 最後の大カッコ ] までを抜き出す
            const jsonStart = responseText.indexOf('[');
            const jsonEnd = responseText.lastIndexOf(']');
            
            if (jsonStart !== -1 && jsonEnd !== -1) {
                const jsonString = responseText.substring(jsonStart, jsonEnd + 1);
                problems = JSON.parse(jsonString);
            } else {
                throw new Error("JSONの配列が見つかりませんでした。");
            }
        } catch (e) {
            console.error("JSON Parse Error:", responseText);
            throw new Error("AIからの応答が正しく読み取れませんでした。");
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
               50文字以内で熱く語って。語尾は「にゃ」。`
            : `あなたは猫の「ネル先生」。生徒「${name}さん」から${count}回目の給食をもらいました。
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
            prompt = `あなたはネル先生。「${name}さん」がゲーム開始。短く応援して。語尾は「にゃ」。`;
        } else if (type === 'end') {
            prompt = `
            あなたはネル先生。ゲーム終了。「${name}さん」のスコアは${score}点（満点20点）。
            スコアに応じて20文字以内でコメントして。語尾は「にゃ」。
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
            2. 親しみやすく、子供にも分かりやすい言葉で話してにゃ。
            3. 生徒を呼び捨て禁止。必ず「さん」をつけるにゃ。
            
            【特殊機能】
            1. **show_kanji ツール**: 「漢字の書き方」「式」などを聞かれたら必ず使って表示してにゃ。
               （ツールが使えない場合は [DISPLAY: 文字] タグを使ってにゃ）
            2. **画像認識**: 画像が来たら、その内容を詳しく解説してにゃ。

            【生徒についての記憶】
            ${statusContext}
            ※もし誕生日の情報があれば、「そういえばもうすぐ誕生日だにゃ？」などと話題にしてにゃ。
            `;

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