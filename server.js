import textToSpeech from '@google-cloud/text-to-speech';
import { GoogleGenerativeAI } from "@google/generative-ai";
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '.')));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const ttsClient = new textToSpeech.TextToSpeechClient({ 
    credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON) 
});

// SSML生成（ロボット声対策強化版）
function createSSML(text, mood) {
    let rate = "1.0"; let pitch = "0.0";
    if (mood === "happy") { rate = "1.1"; pitch = "+2st"; }
    if (mood === "excited") { rate = "1.2"; pitch = "+4st"; }
    if (mood === "thinking") { rate = "0.95"; pitch = "-1st"; }
    
    // 1. 読み上げ禁止文字削除
    let cleanText = text.replace(/🐾|✨|⭐|🎵|🐟/g, '').replace(/⭕️/g, '正解').replace(/❌/g, '不正解');

    // ★重要対策：短い疑問形（教科選択など）はタグをつけすぎるとエラーになるためシンプルにする
    if (cleanText.includes("どの教科") || cleanText.includes("にするにゃ")) {
        return `<speak>${cleanText}</speak>`;
    }

    // 通常の処理
    const processedText = cleanText
        .replace(/……/g, '<break time="650ms"/>')
        .replace(/にゃ/g, 'にゃ'); // prosodyタグを一旦外して安定性重視にする
        
    return `<speak><prosody rate="${rate}" pitch="${pitch}">${processedText}</prosody></speak>`;
}

app.post('/synthesize', async (req, res) => {
    try {
        const { text, mood } = req.body;
        if (!text) return res.status(400).json({ error: "No text" });

        const [response] = await ttsClient.synthesizeSpeech({
            input: { ssml: createSSML(text, mood) },
            voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' },
            audioConfig: { audioEncoding: 'MP3' },
        });
        res.json({ audioContent: response.audioContent.toString('base64') });
    } catch (err) { 
        console.error("TTS Error:", err);
        res.status(500).send(err.message); 
    }
});

// ★新設：会話モード用エンドポイント
app.post('/chat', async (req, res) => {
    try {
        const { message, grade, name } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        
        const prompt = `
        あなたは小学校の猫の先生「ネル先生」です。
        相手は小学${grade}年生の「${name}」さんです。
        以下の発言に対して、優しく、短く（30文字以内）、猫語（語尾に「にゃ」をつける）で返事をしてください。
        子供が相談しやすい雰囲気で。
        
        子供の発言: ${message}
        `;
        
        const result = await model.generateContent(prompt);
        const reply = result.response.text();
        res.json({ reply });
    } catch (err) {
        console.error("Chat Error:", err);
        res.status(500).json({ error: "Chat Error" });
    }
});

app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject } = req.body;
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash", 
            generationConfig: { responseMimeType: "application/json" }
        });
        
        const hintInstruction = `
        - "hints": 生徒が間違えた時に備えて、解き方を導くヒントを3つ作成してください。
          1. 「考え方の入り口」
          2. 「式のヒントや途中経過」
          3. 「答えにかなり近づく大きなヒント（※ただし答えそのものは書かないでください）」
          語尾は「〜だにゃ」「〜してね」等のネル先生口調にしてください。
        `;

        let prompt = "";
        if (mode === 'explain') {
            prompt = `あなたは「ネル先生」。小学${grade}年生の${subject}。画像から全問抽出。
            1. "question": 問題文書き起こし。
            2. "correct_answer": 正解。
            3. ${hintInstruction}
            4. 算数記号は×÷。JSON配列で出力。`;
        } else {
            prompt = `厳格な採点先生。小学${grade}年生の${subject}。
            1. "question": 問題文書き起こし。
            2. "correct_answer": 正解。
            3. "student_answer": 手書き文字読み取り(空欄なら"")。
            4. ${hintInstruction}
            JSON配列で出力。`;
        }

        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        res.json(JSON.parse(result.response.text().replace(/\*/g, '×').replace(/\//g, '÷')));
    } catch (err) { 
        console.error("Analyze Error:", err);
        res.status(500).json({ error: "AI解析エラー" }); 
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(process.env.PORT || 3000);