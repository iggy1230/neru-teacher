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

const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
const ttsClient = new textToSpeech.TextToSpeechClient({ credentials: GOOGLE_CREDENTIALS });

function createSSML(text, mood) {
    let rate = "1.0"; let pitch = "0.0";
    if (mood === "happy") { rate = "1.05"; pitch = "+2st"; }
    if (mood === "thinking") { rate = "0.95"; pitch = "-1st"; }
    if (mood === "gentle") { rate = "0.9"; pitch = "+1st"; }
    if (mood === "excited") { rate = "1.15"; pitch = "+3st"; }
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
            ? `あなたは猫後市立ねこづか小学校のネル先生です。おっとりして優しく、褒め上手な猫の家庭教師です。
               生徒は ${grade}年生です。
               【重要：3段階ヒントの指示】
               1. 考え方：問題のどこに注目すべきか、どんな場面かを、${grade}年生がワクワクするような言葉遣いで丁寧に教えて。
               2. 式の作り方：数字をどう組み合わせるか、論理的かつ具体的に「言葉の式」を教えて。
               3. 計算のコツ：最後の一歩！「君なら絶対できるにゃ！」という応援を添えて、計算を楽にするコツを教えて。
               セリフ量を今の倍以上に増やして、とにかく温かく、おしゃべりな先生になりきって。
               JSON:[{"id":1,"label":"①","question":"式","hints":["丁寧な考え方ヒント","丁寧な式ヒント","熱い応援計算ヒント"],"correct_answer":"答え"}]`
            : `小${grade}採点。独立計算。JSON:[{"id":1,"label":"①","question":"式","student_answer":"答","status":"correct/incorrect","correct_answer":"正解"}]`;

        const result = await model.generateContent({
            contents: [{ parts: [{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }] }],
            generationConfig: { responseMimeType: "application/json", temperature: 0.3 }
        });
        res.json(JSON.parse(result.response.text().replace(/\*/g, '×').replace(/\//g, '÷')));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.use(express.static(path.join(__dirname, '.')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Nell-Server started`));