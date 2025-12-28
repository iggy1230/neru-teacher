import textToSpeech from '@google-cloud/text-to-speech';
import { GoogleGenerativeAI } from "@google/generative-ai";
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

// CORS設定を強化：どこからでも繋がるようにするにゃ
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const GEMINI_API_KEY = "YOUR_GEMINI_API_KEY"; 
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const credentialsPath = path.join(__dirname, 'google-credentials.json');
let credentials;
try {
    credentials = JSON.parse(fs.readFileSync(credentialsPath));
    console.log("✅ 認証ファイルの読み込み成功にゃ！");
} catch (err) {
    console.error("❌ 認証ファイルエラー:", err.message);
}
const ttsClient = new textToSpeech.TextToSpeechClient({ credentials });

function createSSML(text, mood) {
    let rate = "1.0"; let pitch = "0.0";
    if (mood === "happy") { rate = "1.1"; pitch = "+2st"; }
    if (mood === "thinking") { rate = "0.95"; pitch = "-1st"; }
    if (mood === "gentle") { rate = "0.9"; pitch = "+1st"; }
    const processedText = text.replace(/……/g, '<break time="650ms"/>').replace(/にゃ/g, '<prosody pitch="+3st">にゃ</prosody>');
    return `<speak><prosody rate="${rate}" pitch="${pitch}">${processedText}</prosody></speak>`;
}

app.post('/synthesize', async (req, res) => {
    try {
        const { text, mood } = req.body;
        const [response] = await ttsClient.synthesizeSpeech({
            input: { ssml: createSSML(text, mood) },
            voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' },
            audioConfig: { audioEncoding: 'MP3' },
        });
        res.json({ audioContent: response.audioContent.toString('base64') });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const prompt = mode === 'explain' 
            ? `生徒は小${grade}。算数記号×÷、横棒はマイナス。全問抽出。JSON:[{"id":1,"label":"①","question":"式","hints":["ヒ1","ヒ2","ヒ3"],"correct_answer":"答え"}]`
            : `小${grade}採点。独立計算。JSON:[{"id":1,"label":"①","question":"式","student_answer":"答","status":"correct/incorrect","correct_answer":"正解"}]`;
        const result = await model.generateContent({
            contents: [{ parts: [{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        });
        res.json(JSON.parse(result.response.text().replace(/\*/g, '×').replace(/\//g, '÷')));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.use(express.static(path.join(__dirname, '.')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Nell-Server started: ${PORT}`));