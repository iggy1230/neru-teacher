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

// --- 設定 (自分のキーを入れてにゃ！) ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
const ttsClient = new textToSpeech.TextToSpeechClient({ credentials: GOOGLE_CREDENTIALS });

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
        const { image, mode, grade, subject } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }); // 安定の2.0
        
        // 以前の「動いていた頃」のシンプルで強力なプロンプトに戻したにゃ！
        const prompt = mode === 'explain' 
            ? `あなたはネル先生。生徒は小${grade}。教科は${subject}。
               画像内の全問題を正確に書き起こして。算数記号は×÷、横棒はマイナス。
               ヒントを3段階で作り、答え(correct_answer)と一緒にJSONで返して。
               JSON形式:[{"id":1,"label":"①","question":"式","hints":["ヒ1","ヒ2","ヒ3"],"correct_answer":"答え"}]`
            : `小${grade}の採点。独立計算せよ。JSON形式で返して。`;

        const result = await model.generateContent([
            { inlineData: { mimeType: "image/jpeg", data: image } },
            { text: prompt }
        ]);
        
        const responseText = result.response.text();
        // どんな返答が来てもJSONの塊[]だけを引っこ抜く魔法にゃ！
        const jsonStart = responseText.indexOf('[');
        const jsonEnd = responseText.lastIndexOf(']') + 1;
        const jsonString = responseText.substring(jsonStart, jsonEnd);

        let cleanedJson = jsonString.replace(/\*/g, '×').replace(/\//g, '÷');
        res.json(JSON.parse(cleanedJson));
    } catch (err) { 
        console.error("AI Error:", err.message);
        res.status(500).json({ error: "読み取りに失敗したにゃ。もう一度撮ってにゃ🐾" }); 
    }
});

app.use(express.static(path.join(__dirname, '.')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(process.env.PORT || 3000);