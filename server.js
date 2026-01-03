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
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '.')));

// API初期化
let genAI, ttsClient;
try {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    ttsClient = new textToSpeech.TextToSpeechClient({ 
        credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON) 
    });
} catch (e) { console.error("Init Error:", e.message); }

// --- 通常TTS ---
function createSSML(text, mood) {
    let rate = "1.1", pitch = "+2st"; 
    if (mood === "thinking") { rate = "1.0"; pitch = "0st"; }
    let cleanText = text.replace(/[\u{1F600}-\u{1F6FF}]/gu, '').replace(/🐾|✨|⭐|🎵|🐟|🎤|⭕️|❌/g, '').replace(/&/g, 'と').replace(/[<>"']/g, ' ');
    if (cleanText.length < 5) return `<speak>${cleanText}</speak>`;
    return `<speak><prosody rate="${rate}" pitch="${pitch}">${cleanText.replace(/……/g, '<break time="500ms"/>').replace(/にゃ/g, '<prosody pitch="+3st">にゃ</prosody>')}</prosody></speak>`;
}

app.post('/synthesize', async (req, res) => {
    try {
        if (!ttsClient) throw new Error("TTS not ready");
        const { text, mood } = req.body;
        if (!text) return res.status(400).json({ error: "No text" });
        const [response] = await ttsClient.synthesizeSpeech({
            input: { ssml: createSSML(text, mood) },
            voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' },
            audioConfig: { audioEncoding: 'MP3' },
        });
        res.json({ audioContent: response.audioContent.toString('base64') });
    } catch (err) { res.status(500).send(err.message); }
});

// --- ★修正: ゲーム実況API (箇条書き禁止) ---
app.post('/game-reaction', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { type, name, score } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        
        let prompt = "";
        let mood = "excited";

        if (type === 'start') {
            prompt = `あなたは「ネル先生」。生徒「${name}」さんがゲーム開始。「${name}さん！カリカリいっぱいゲットしてにゃ！」と応援して。語尾にゃ。`;
        } else if (type === 'end') {
            prompt = `あなたは「ネル先生」。ゲーム終了。スコア${score}個。一言だけ感想を言って。20文字以内。語尾にゃ。`;
        } else {
            // ★重要: ここで箇条書きを禁止する
            prompt = `
            あなたは「ネル先生」。ゲーム中の実況。
            状況: ${type} (hit=成功, pinch=ピンチ)。
            
            【厳守事項】
            - 出力は「たった一つのフレーズ」のみ。
            - 箇条書きやリストは絶対禁止。
            - 候補を複数出すな。1つだけ選んで出力せよ。
            - 10文字以内。語尾にゃ。
            `;
        }

        const result = await model.generateContent(prompt);
        // 万が一改行が入っていたら1行目だけ取る
        let reply = result.response.text().trim().split('\n')[0];
        // 記号除去
        reply = reply.replace(/[-*・]/g, '').trim();
        
        res.json({ reply: reply, mood: mood });
    } catch (err) { 
        res.status(500).json({ error: "Game AI Error" }); 
    }
});

// --- 給食リアクションAPI ---
app.post('/lunch-reaction', async (req, res) => {
    try {
        const { count, name } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const isSpecial = count % 10 === 0;
        let prompt = isSpecial 
            ? `ネル先生として、給食${count}個目の感謝を熱く語って。相手:${name}さん(呼び捨て禁止)。60文字程度。注釈禁止。`
            : `ネル先生として、給食を食べた一言感想。15文字以内。語尾にゃ。`;
        const result = await model.generateContent(prompt);
        let reply = result.response.text().trim();
        if(!isSpecial && reply.includes('\n')) reply = reply.split('\n')[0];
        res.json({ reply, isSpecial });
    } catch (err) { res.status(500).json({ error: "Error" }); }
});

// --- ★修正: 画像分析API (エラー対策強化) ---
app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig: { responseMimeType: "application/json" } });
        const hint = `"hints": 3つのヒントを作成(必須)。正解は書かない。`;
        
        let prompt = mode === 'explain' 
            ? `ネル先生。小学${grade}${subject}。全問抽出。1."question":書き起こし 2."correct_answer":正解 3.${hint} 4.記号は×÷。JSON配列。`
            : `採点。小学${grade}${subject}。1."question":書き起こし 2."correct_answer":正解 3."student_answer":手書き読取 4.${hint} JSON配列。`;
        
        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        
        // ★Markdown記号を徹底的に除去してJSONパースエラーを防ぐ
        let jsonStr = result.response.text()
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .replace(/\*/g, '×')
            .replace(/\//g, '÷')
            .trim();
            
        res.json(JSON.parse(jsonStr));

    } catch (err) { 
        console.error("Analyze Error:", err);
        res.status(500).json({ error: "AI Error: 画像が読み取れなかったか、AIが疲れています。" }); 
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// --- ★修正: Live API Proxy (喋りすぎ防止) ---
const wss = new WebSocketServer({ server });

wss.on('connection', (clientWs, req) => {
    const parameters = parse(req.url, true).query;
    const userGrade = parameters.grade || "1";
    let geminiWs = null;
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;

    try {
        geminiWs = new WebSocket(GEMINI_URL);

        geminiWs.on('open', () => {
            console.log('Connected to Gemini');
            
            geminiWs.send(JSON.stringify({
                setup: {
                    model: "models/gemini-2.0-flash-exp",
                    generation_config: { 
                        response_modalities: ["AUDIO"], 
                        speech_config: { voice_config: { prebuilt_voice_config: { voice_name: "Aoede" } } } 
                    },
                    system_instruction: { 
                        parts: [{ 
                            text: `あなたは「ねこご市立、ねこづか小学校」のネル先生だにゃ。
               
               【話し方】
               1. 語尾は必ず「〜にゃ」。
               2. 小学${userGrade}年生相手に、ゆっくり、はっきりと話す。
               3. 最初の1文字目を特に強調して、はっきり発音する。
               
               【対話ルール】
               1. 相手の話を最後まで聞く。
               2. 一言喋ったら、必ず相手の反応を待つ（長々と一人で喋り続けない）。
               3. 文節ごとに区切らず、なめらかに話す。` 
                        }] 
                    }
                }
            }));
            
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ type: "server_ready" }));
            }
        });

        geminiWs.on('message', (data) => {
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
        });

        geminiWs.on('error', (e) => console.error('Gemini WS Error:', e.message));
        geminiWs.on('close', () => {});

    } catch (e) { clientWs.close(); }

    clientWs.on('message', (data) => {
        try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'audio' && geminiWs && geminiWs.readyState === WebSocket.OPEN) {
                geminiWs.send(JSON.stringify({
                    realtime_input: {
                        media_chunks: [{ mime_type: "audio/pcm;rate=16000", data: parsed.data }]
                    }
                }));
            }
        } catch (e) {}
    });

    clientWs.on('close', () => {
        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) geminiWs.close();
    });
});