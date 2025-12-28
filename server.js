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

// 1. 静的ファイルの公開
app.use(express.static(path.join(__dirname, '.')));

// ==========================================
// 🐾 環境変数の読み込み（超厳重チェック）
// ==========================================
const credsRaw = process.env.GOOGLE_CREDENTIALS_JSON;
const geminiKey = process.env.GEMINI_API_KEY;

if (!credsRaw) console.error("❌ エラー：GOOGLE_CREDENTIALS_JSON が未設定にゃ！");
if (!geminiKey) console.error("❌ エラー：GEMINI_API_KEY が未設定にゃ！");

let GOOGLE_CREDENTIALS;
try {
    GOOGLE_CREDENTIALS = JSON.parse(credsRaw);
    console.log("✅ Google Cloud 認証データの解析成功だにゃ！");
} catch (e) {
    console.error("❌ エラー：JSONの形がおかしいにゃ！貼り付けミスがないか確認してにゃ。");
}

const genAI = new GoogleGenerativeAI(geminiKey);
const ttsClient = new textToSpeech.TextToSpeechClient({ credentials: GOOGLE_CREDENTIALS });

// (createSSML 関数などはそのまま維持)
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
    } catch (err) { 
        console.error("❌ TTSエラー:", err.message);
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const prompt = mode === 'explain' 
            ? `小${grade}向けのネル先生。全問をJSONで返して。[{"id":1,"label":"①","question":"式","hints":["ヒ1","ヒ2","ヒ3"],"correct_answer":"答え"}]`
            : `小${grade}の採点。JSONで返して。`;

        const result = await model.generateContent({
            contents: [{ parts: [{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        });
        res.json(JSON.parse(result.response.text()));
    } catch (err) { 
        console.error("❌ AI解析エラー:", err.message);
        res.status(500).json({ error: err.message }); 
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Nell-Server started: ${PORT}`));