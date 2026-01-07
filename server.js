import textToSpeech from '@google-cloud/text-to-speech';
import { GoogleGenerativeAI } from "@google/generative-ai";
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket, { WebSocketServer } from 'ws';
import { parse } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' })); // 画像送信用に拡張
app.use(express.static(path.join(__dirname, '.')));

// API初期化
let genAI, ttsClient;
try {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    ttsClient = new textToSpeech.TextToSpeechClient({
        credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON)
    });
} catch (e) { console.error("Init Error:", e.message); }

// --- 音声合成 (SSML) ---
function createSSML(text, mood) {
    let rate = "1.1", pitch = "+2st";
    if (mood === "thinking") { rate = "1.0"; pitch = "0st"; }
    if (mood === "gentle") { rate = "0.95"; pitch = "+1st"; }
    if (mood === "excited") { rate = "1.2"; pitch = "+4st"; }

    let cleanText = text
        .replace(/[\n\r]/g, " ")
        .replace(/[<>]/g, "");

    return `
        <speak>
            <prosody rate="${rate}" pitch="${pitch}">
                <emphasis level="moderate">${cleanText}</emphasis>
            </prosody>
        </speak>`;
}

// --- 音声API ---
app.post('/speech', async (req, res) => {
    try {
        const { text, mood } = req.body;
        const request = {
            input: { ssml: createSSML(text, mood) },
            voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' },
            audioConfig: { audioEncoding: 'MP3' },
        };
        const [response] = await ttsClient.synthesizeSpeech(request);
        res.set('Content-Type', 'audio/mpeg');
        res.send(response.audioContent);
    } catch (e) { res.status(500).send(e.message); }
});

// --- ★画像分析API (1.5 Pro 安定・鉄壁版) ---
app.post('/analyze', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { image, mode, grade, subject } = req.body;
        
        // 分析は中2の問題にも強い1.5 Proを使用
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

        const rules = {
            'さんすう': `... (既存のさんすうルール) ...`,
            'こくご': `... (既存のこくごルール) ...`,
            'えいご': `... (既存のえいごルール) ...`,
            '数学': `中2数学の専門家として、図形や連立方程式を丁寧に分析してください。`
        };

        const targetSubject = subject || (grade >= 7 ? '数学' : 'さんすう');
        const prompt = `${rules[targetSubject] || rules['数学']}\n必ず純粋なJSON配列 [ ... ] のみを出力してください。`;

        const result = await model.generateContent([
            { inlineData: { mime_type: "image/jpeg", data: image } }, 
            { text: prompt }
        ]);
        
        let textResponse = result.response.text().trim();
        console.log("AI分析結果(生データ):", textResponse);

        // --- JSON抽出の魔法にゃ！ ---
        const start = textResponse.indexOf('[');
        const end = textResponse.lastIndexOf(']');
        
        if (start !== -1 && end !== -1) {
            let jsonStr = textResponse.substring(start, end + 1);
            // 制御文字だけ掃除（本物の改行はそのままにパースするにゃ）
            jsonStr = jsonStr.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");

            try {
                const parsedData = JSON.parse(jsonStr);

                // パース後に中身を綺麗にするにゃ（安全第一）
                const safeData = parsedData.map(item => ({
                    ...item,
                    question: item.question?.replace(/\*/g, '×').replace(/\//g, '÷') || "",
                    correct_answer: item.correct_answer?.toString().replace(/\*/g, '×').replace(/\//g, '÷') || ""
                }));

                return res.json(safeData);
            } catch (pErr) {
                console.error("JSON Parse Error:", pErr);
                throw new Error("JSON形式が崩れていたにゃ");
            }
        } else {
            throw new Error("JSONが見つからなかったにゃ");
        }

    } catch (err) {
        console.error("Analyze Error:", err.message);
        // エラー時は「ごめんねJSON」を返してアプリを止めないにゃ
        res.json([{
            id: 1, label: "!", question: "ごめんにゃ、AIがちょっと考え込んじゃったみたいだにゃ。もう一度撮ってにゃ！",
            correct_answer: "", student_answer: "", hints: ["明るい場所で撮ってみてにゃ", "", ""]
        }]);
    }
});

// --- WebSocket (Live API) ---
const server = app.listen(process.env.PORT || 3000, () => {
    console.log(`Server started on port ${process.env.PORT || 3000}`);
});

// ★タイムアウト時間を120秒に延長にゃ！
server.timeout = 120000;
server.keepAliveTimeout = 121000;

const wss = new WebSocketServer({ server });
wss.on('connection', (clientWs, req) => {
    const { query } = parse(req.url, true);
    const userName = query.userName || 'さん';
    const userGrade = query.userGrade || '1';

    try {
        const url = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=" + process.env.GEMINI_API_KEY;
        const geminiWs = new WebSocket(url);

        geminiWs.on('open', () => {
            geminiWs.send(JSON.stringify({
                setup: {
                    model: "models/gemini-2.0-flash-exp", // 会話は爆速のFlash
                    generation_config: { response_modalities: ["AUDIO"] },
                    system_instruction: {
                        parts: [{ text: `あなたはネル先生だにゃ。小学${userGrade}年生の${userName}さんと話してにゃ。語尾は「〜にゃ」。` }]
                    }
                }
            }));
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify({ type: "server_ready" }));
        });

        geminiWs.on('message', (data) => { if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data); });
        geminiWs.on('error', (e) => console.error('Gemini WS Error:', e));
        geminiWs.on('close', () => clientWs.close());

        clientWs.on('message', (data) => {
            if (geminiWs.readyState === WebSocket.OPEN) geminiWs.send(data);
        });
        clientWs.on('close', () => geminiWs.close());
    } catch (e) { clientWs.close(); }
});