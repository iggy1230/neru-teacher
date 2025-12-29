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

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '.')));

// ==========================================
// 🐾 設定エリア (Build v2.6.0)
// ==========================================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
const ttsClient = new textToSpeech.TextToSpeechClient({ credentials: GOOGLE_CREDENTIALS });

// 🔊 ja-JP-Neural2-B 音声生成
function createSSML(text, mood) {
    let rate = "1.0"; let pitch = "0.0";
    if (mood === "happy") { rate = "1.05"; pitch = "+2st"; }
    if (mood === "thinking") { rate = "0.95"; pitch = "-1st"; }
    if (mood === "gentle") { rate = "0.9"; pitch = "+1st"; }
    if (mood === "excited") { rate = "1.15"; pitch = "+3st"; }

    const processedText = text.replace(/……/g, '<break time="650ms"/>')
                              .replace(/にゃ/g, '<prosody pitch="+3st">にゃ</prosody>');
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
        const { image, mode, grade, subject } = req.body;
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash",
            generationConfig: { responseMimeType: "application/json" }
        });
        
        const prompt = mode === 'explain' 
            ? `あなたはネル先生です。生徒は小${grade}生、教科は${subject}です。
               【最重要：全問抽出と正確な書き起こし】
               画像内の全ての問題（大問1から最後の大問まで）を抽出してください。
               "question"フィールドには、問題番号だけでなく、問題文の全文を一文字残さず書き起こしてください。
               算数記号は×÷、横棒はマイナス。
               【重要】ヒントは必ず3段階（1.考え方、2.式の作り方、3.計算のコツ）で構成し、
               その次に正解(correct_answer)を日本語で返してください。
               JSON形式:[{"id":1,"label":"大問1 ①","question":"問題文全文","hints":["考え方","式作り","計算"],"correct_answer":"正解"}]`
            : `小学校${grade}年生の${subject}の採点。独立計算。JSON形式。`;

        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        let text = result.response.text().replace(/\*/g, '×').replace(/\//g, '÷');
        res.json(JSON.parse(text));
    } catch (err) { res.status(500).json({ error: "読み取り失敗だにゃ🐾" }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Nell Build v2.6.0 Final started`));