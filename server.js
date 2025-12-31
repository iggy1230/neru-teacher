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

// API初期化（エラー時はログ出力のみでサーバーは落とさない）
let genAI, ttsClient;
try {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    ttsClient = new textToSpeech.TextToSpeechClient({ 
        credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON) 
    });
} catch (e) {
    console.error("Init Error:", e.message);
}

// SSML生成（ロボット声・エラー対策）
function createSSML(text, mood) {
    let rate = "1.0"; let pitch = "0.0";
    if (mood === "happy") { rate = "1.1"; pitch = "+2st"; }
    if (mood === "excited") { rate = "1.2"; pitch = "+4st"; }
    if (mood === "thinking") { rate = "0.95"; pitch = "-1st"; }
    
    // 1. 読み上げ禁止文字・記号の徹底削除
    let cleanText = text
        .replace(/[\u{1F600}-\u{1F64F}]/gu, '') // 絵文字範囲1
        .replace(/[\u{1F300}-\u{1F5FF}]/gu, '') // 絵文字範囲2
        .replace(/[\u{1F680}-\u{1F6FF}]/gu, '') // 絵文字範囲3
        .replace(/🐾|✨|⭐|🎵|🐟|🎤|😊|💦|🥰/g, '') // 特定の記号
        .replace(/⭕️/g, '正解').replace(/❌/g, '不正解')
        .replace(/[*_~`]/g, ''); // Markdown記号

    // 空っぽになってしまった場合の保険
    if (!cleanText || cleanText.trim().length === 0) {
        cleanText = "にゃあ？";
    }

    // 短い疑問形はタグなし（ロボット声回避の特効薬）
    if (cleanText.includes("どの教科") || cleanText.includes("にするにゃ") || cleanText.length < 5) {
        return `<speak>${cleanText}</speak>`;
    }

    // SSMLエスケープ
    cleanText = cleanText
        .replace(/&/g, 'と')
        .replace(/</g, ' ')
        .replace(/>/g, ' ')
        .replace(/"/g, ' ')
        .replace(/'/g, ' ');

    const processedText = cleanText
        .replace(/……/g, '<break time="650ms"/>')
        .replace(/にゃ/g, '<prosody pitch="+3st">にゃ</prosody>');
        
    return `<speak><prosody rate="${rate}" pitch="${pitch}">${processedText}</prosody></speak>`;
}

app.post('/synthesize', async (req, res) => {
    try {
        if (!ttsClient) throw new Error("TTS Client not ready");
        const { text, mood } = req.body;
        if (!text) return res.status(400).json({ error: "No text" });

        try {
            const [response] = await ttsClient.synthesizeSpeech({
                input: { ssml: createSSML(text, mood) },
                voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' },
                audioConfig: { audioEncoding: 'MP3' },
            });
            return res.json({ audioContent: response.audioContent.toString('base64') });
        } catch (innerErr) {
            console.warn("TTS Retry:", innerErr.message);
            // 失敗時は平文で再試行
            const [retryRes] = await ttsClient.synthesizeSpeech({
                input: { text: text.replace(/[^a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g, '') },
                voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' },
                audioConfig: { audioEncoding: 'MP3' },
            });
            return res.json({ audioContent: retryRes.audioContent.toString('base64') });
        }
    } catch (err) { 
        console.error("TTS Fatal Error:", err);
        res.status(500).send(err.message); 
    }
});

// チャットAI（指示を強化）
app.post('/chat', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { message, grade, name } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        
        // ★重要：絵文字を使わないように指示
        const prompt = `
        あなたは小学校の猫の先生「ネル先生」です。相手は小学${grade}年生の「${name}」さんです。
        以下の発言に対して、30文字以内で、優しく、猫語（語尾に「にゃ」）で返事をしてください。
        【重要】読み上げエラーになるため、絵文字や記号（✨や🐾など）は絶対に使わないでください。ひらがな多めで。
        
        子供の発言: ${message}
        `;
        
        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text() });
    } catch (err) {
        console.error("Chat Error:", err);
        res.status(500).json({ error: "Error" });
    }
});

app.post('/analyze', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { image, mode, grade, subject } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig: { responseMimeType: "application/json" } });
        
        const hintInstruction = `
        - "hints": ヒント3つ。1.考え方 2.式 3.ほぼ答え。語尾は「〜にゃ」。
        `;
        let prompt = mode === 'explain' 
            ? `ネル先生。小学${grade} ${subject}。全問抽出。1."question":書き起こし 2."correct_answer":正解 3.${hintInstruction} 4.記号は×÷。JSON配列。`
            : `採点。小学${grade} ${subject}。1."question":書き起こし 2."correct_answer":正解 3."student_answer":手書き読取 4.${hintInstruction} JSON配列。`;

        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        res.json(JSON.parse(result.response.text().replace(/\*/g, '×').replace(/\//g, '÷')));
    } catch (err) { 
        console.error("Analyze Error:", err);
        res.status(500).json({ error: "AI Error" }); 
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));