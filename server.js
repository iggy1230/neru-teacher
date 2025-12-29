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

// 自分のAPIキーを入れてにゃ！
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
const ttsClient = new textToSpeech.TextToSpeechClient({ credentials: GOOGLE_CREDENTIALS });

function createSSML(text, mood) {
    let rate = "1.0"; let pitch = "0.0";
    if (mood === "happy") { rate = "1.1"; pitch = "+2st"; }
    if (mood === "thinking") { rate = "0.95"; pitch = "-1st"; }
    if (mood === "gentle") { rate = "0.9"; pitch = "+1st"; }
    if (mood === "excited") { rate = "1.2"; pitch = "+3st"; }
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
        const { image, mode, grade, subject } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const prompt = mode === 'explain' 
            ? `あなたはネル先生。小${grade}生向けの「${subject}」の解説です。
               画像内の全ての問題を一文字残さず書き起こしてJSONで返して。算数記号は×÷、横棒はマイナス。
               ヒントは3段階（考え方、式の作り方、計算）で、お喋りなネル先生らしく優しく詳しく教えてにゃ。
               JSON形式:[{"id":1,"label":"①","question":"問題文","hints":["ヒ1","ヒ2","ヒ3"],"correct_answer":"答え"}]`
            : `小${grade}・${subject}の採点。独立計算。JSON配列で返して。`;

        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        const responseText = result.response.text();
        // 強力なJSON抽出ロジック
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error("AIがデータを作れなかったにゃ");
        
        let cleanedJson = jsonMatch[0].replace(/\*/g, '×').replace(/\//g, '÷');
        res.json(JSON.parse(cleanedJson));
    } catch (err) { 
        console.error("AI解析エラー:", err.message);
        res.status(500).json({ error: err.message }); 
    }
});

app.use(express.static(path.join(__dirname, '.')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(process.env.PORT || 3000);