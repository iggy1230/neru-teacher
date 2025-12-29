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
// 🐾 設定エリア (Build v2.7.4)
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
    } catch (err) { res.status(500).send(err.message); }
});

// 教科別プロンプト生成
function getSubjectInstruction(subject) {
    const rules = {
        '算数': `【算数特化】×÷記号、単位、分数(1/2)を正確に。筆算の横線とマイナス(－)を混同しない。`,
        '国語': `【国語特化】漢字、送り仮名を正確に。縦書きは右から左へ読む順番で横書きに変換。ふりがなは無視。`,
        '理科': `【理科特化】実験図のラベル、グラフ、単位（g, cm³, ℃）を正確に。`,
        '社会': `【社会特化】地名、人名、年号の漢字を正確に。選択肢もすべて書き出す。`
    };
    return rules[subject] || "";
}

app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject } = req.body;
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash",
            generationConfig: { responseMimeType: "application/json" }
        });
        const prompt = `あなたは教育猫型AI「ネル先生」です。小${grade}の${subject}の先生です。
        ${getSubjectInstruction(subject)}
        【思考プロセス】まず画像内の文字をすべて詳細に書き起こし、その後に内容をJSONにまとめて。
        【ミッション】1.画像内の全問題を正確に書き起こす。2.3段階ヒントを作る。3.正解を算出。
        JSON形式:[{"id":1, "label":"①", "question":"問題内容", "hints":["考え方","式作り","計算"], "correct_answer":"正解"}]`;

        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        const data = JSON.parse(result.response.text());
        const cleanedData = data.map(item => ({
            ...item,
            question: String(item.question).replace(/\*/g, '×').replace(/\//g, '÷'),
            correct_answer: String(item.correct_answer).replace(/\*/g, '×').replace(/\//g, '÷')
        }));
        res.json(cleanedData);
    } catch (err) { res.status(500).json({ error: "解析失敗にゃ" }); }
});

app.use(express.static(path.join(__dirname, '.')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(process.env.PORT || 3000);