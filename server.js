import textToSpeech from '@google-cloud/text-to-speech';
import { GoogleGenerativeAI } from "@google/generative-ai";
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// --- クラウド用のカギ設定 ---
// Renderの管理画面から設定する値を受け取るにゃ
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const ttsClient = new textToSpeech.TextToSpeechClient({
    credentials: GOOGLE_CREDENTIALS // JSONファイルの中身を直接渡すにゃ
});

// (createSSML関数などは以前と同じにゃ)
function createSSML(text, mood) {
    let rate = "1.0"; let pitch = "0.0";
    if (mood === "happy") { rate = "1.1"; pitch = "+2st"; }
    if (mood === "thinking") { rate = "0.95"; pitch = "-1st"; }
    if (mood === "gentle") { rate = "0.9"; pitch = "+1st"; }
    if (mood === "excited") { rate = "1.2"; pitch = "+3st"; }
    const processedText = text.replace(/……/g, '<break time="600ms"/>').replace(/にゃ/g, '<prosody pitch="+3st">にゃ</prosody>');
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
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const prompt = mode === 'explain' 
            ? `小${grade}向けのネル先生。全問JSON。[{...}]` 
            : `小${grade}の採点。独立計算。JSON:[{...}]`;
        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        let text = result.response.text().replace(/```json|```/g, "").trim().replace(/\*/g, '×').replace(/\//g, '÷');
        res.json(JSON.parse(text));
    } catch (err) { res.status(500).send(err.message); }
});

// Renderから指定されるポート番号を使うようにするにゃ
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Nell-Server started on port ${PORT}`));