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

// ==========================================
// 🐾 設定エリア (Build v2.7.0)
// ==========================================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
const ttsClient = new textToSpeech.TextToSpeechClient({ credentials: GOOGLE_CREDENTIALS });

// 🔊 音声合成 ( ja-JP-Neural2-B )
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

// --- 教科別プロンプト生成 ---
function getSystemPrompt(subject, grade, mode) {
    const isExplain = mode === 'explain';
    const base = `あなたは教育猫型AI「ネル先生」です。小学${grade}年生の${subject}の先生です。`;
    const subjectRules = {
        '算数': `×÷記号を正確に。分数は 1/2。筆算の横線とマイナス(－)を混同しないで。`,
        '国語': `漢字を正確に。縦書きは横書きに直して。ふりがなは無視して本文だけを。`,
        '理科': `単位（g, cm, ℃）を正確に。図は[図：〜]と記述。`,
        '社会': `地名、人名、年号を正確に。選択肢もすべて書き出して。`
    };
    const modeInstructions = isExplain 
        ? `【手順】1.画像を正確に書き起こす。2.3段階ヒント(考え方、コツ、計算)を作る。3.正解を記入。JSON:[{"id":1,"label":"①","question":"問題文全文","hints":["ヒ1","ヒ2","ヒ3"],"correct_answer":"答え"}]`
        : `採点。独立計算。JSON:[{"id":1,"label":"①","question":"式","student_answer":"答","status":"correct/incorrect","correct_answer":"正解"}]`;
    return `${base}\n${subjectRules[subject] || ""}\n${modeInstructions}`;
}

app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash", generationConfig: { responseMimeType: "application/json" } });
        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: getSystemPrompt(subject, grade, mode) }]);
        let text = result.response.text().replace(/\*/g, '×').replace(/\//g, '÷');
        res.json(JSON.parse(text));
    } catch (err) { res.status(500).json({ error: "読み取り失敗にゃ🐾" }); }
});

app.use(express.static(path.join(__dirname, '.')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(process.env.PORT || 3000);