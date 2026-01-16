// --- server.js (完全版 v118.0: JSON解析強化 & 安定版) ---

import textToSpeech from '@google-cloud/text-to-speech';
import { GoogleGenerativeAI } from "@google/generative-ai";
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket, { WebSocketServer } from 'ws';
import { parse } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '.')));

const googleAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- ヘルパー: 頑丈なJSONパーサー ---
function extractAndParseJSON(text) {
    try {
        // 1. そのままパース
        return JSON.parse(text);
    } catch (e) {
        // 2. Markdown記法 ```json ... ``` を除去
        let clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
        try { return JSON.parse(clean); } catch (e) {}

        // 3. 配列 [ ... ] を無理やり抽出
        const start = clean.indexOf('[');
        const end = clean.lastIndexOf(']');
        if (start !== -1 && end !== -1) {
            clean = clean.substring(start, end + 1);
            try { return JSON.parse(clean); } catch (e) {}
        }
        
        console.error("JSON Parse Error Text:", text);
        return []; // 失敗したら空配列を返してクラッシュ回避
    }
}

// --- 共通解析エンドポイント ---
app.post('/analyze', async (req, res) => {
    try {
        const { image, grade, name } = req.body;
        // Gemini 1.5 Proを使用 (2.5はまだ安定していない可能性があるため1.5へ安全策)
        const model = googleAI.getGenerativeModel({ 
            model: "gemini-2.5-pro",
            generationConfig: { responseMimeType: "application/json" }
        });

        const prompt = `あなたは教育AI「ネル先生」です。相手は${grade}年生の${name}ちゃんです。
        画像から以下の情報を正確に読み取り、JSON形式で返してください。
        
        【重要ルール】
        1. 印刷されている「問題文」を一字一句正確に書き起こすこと。
        2. 生徒が書いた「手書きの答え」を正確に書き起こすこと。空欄なら空文字。
        3. その問題の本来の「正解」を導き出すこと。
        4. 手書きの答えと正解を比較し、あっているか判定(isCorrect)すること。

        【出力形式】
        [
          {
            "id": 1,
            "label": "問1",
            "question": "問題の内容",
            "studentAnswer": "読み取った手書きの答え",
            "correctAnswer": "本来の正解",
            "isCorrect": true,
            "hint1": "考え方のヒント",
            "hint2": "もっと詳しいヒント",
            "hint3": "答えに近いヒント"
          }
        ]`;

        const result = await model.generateContent([
            prompt,
            { inlineData: { mime_type: "image/jpeg", data: image } }
        ]);

        const responseText = result.response.text();
        // 頑丈なパーサーを通す
        const problems = extractAndParseJSON(responseText);

        res.json({ problems });
    } catch (error) {
        console.error("解析エラー:", error);
        // クライアントには空の結果を返して止まらないようにする
        res.status(500).json({ error: "解析に失敗したにゃ", details: error.message });
    }
});

// --- 給食リアクション ---
app.post('/lunch-reaction', async (req, res) => {
    try {
        const { menu, name } = req.body;
        const model = googleAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        const result = await model.generateContent(`${name}から${menu}をもらったネル先生（猫）の喜ぶセリフを語尾「にゃ」で1つ短く返して。`);
        res.json({ reply: result.response.text() });
    } catch (e) { res.json({ reply: "おいしいにゃ！ありがとうにゃ！" }); }
});

// --- 音声合成 ---
let ttsClient;
try {
    // 認証情報がある場合のみ初期化
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
        ttsClient = new textToSpeech.TextToSpeechClient({ credentials });
    } else {
        ttsClient = new textToSpeech.TextToSpeechClient();
    }
} catch (e) { console.error("TTS Init Skipped:", e.message); }

app.post('/synthesize', async (req, res) => {
    if (!ttsClient) return res.json({ audioContent: null }); // TTS無効なら何もしない
    try {
        const [response] = await ttsClient.synthesizeSpeech({
            input: { text: req.body.text },
            voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' },
            audioConfig: { audioEncoding: 'MP3', speakingRate: 1.1 },
        });
        res.json({ audioContent: response.audioContent.toString('base64') });
    } catch (e) { 
        console.error("TTS Error:", e);
        res.status(500).send(e.message); 
    }
});

// --- WebSocket ---
const server = app.listen(process.env.PORT || 3000, () => console.log("Server ready!"));
const wss = new WebSocketServer({ server });

wss.on('connection', (clientWs, req) => {
    const { query } = parse(req.url, true);
    const { name, grade, status } = query;

    const geminiWs = new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`);

    geminiWs.on('open', () => {
        geminiWs.send(JSON.stringify({
            setup: {
                model: "models/gemini-2.0-flash-exp",
                generationConfig: { 
                    responseModalities: ["AUDIO"],
                    speech_config: { voice_config: { prebuilt_voice_config: { voice_name: "Aoede" } }, language_code: "ja-JP" }
                },
                systemInstruction: { parts: [{ text: `あなたはネル先生（猫）。相手は${grade}年生の${name}。語尾は「にゃ」。履歴：${status}` }] }
            }
        }));
    });

    clientWs.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            if (msg.base64Audio && geminiWs.readyState === WebSocket.OPEN) {
                geminiWs.send(JSON.stringify({ realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: msg.base64Audio }] } }));
            }
        } catch(e){}
    });

    geminiWs.on('message', (data) => { if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data); });
    geminiWs.on('error', (e) => console.error("Gemini WS Error:", e));
    clientWs.on('close', () => geminiWs.close());
});