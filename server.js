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
// 🐾 設定 (RenderのEnvironmentに登録)
// ==========================================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
const ttsClient = new textToSpeech.TextToSpeechClient({ credentials: GOOGLE_CREDENTIALS });

// 🔊 音声合成
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

// --- 教科別・教育的ヒント生成ロジック ---
function getSubjectInstruction(subject) {
    const rules = {
        '算数': `【算数特化】×÷、単位、分数を正確に。横線とマイナスを混同しない。ヒ1：立式(考え方)、ヒ2：注目点、ヒ3：計算のコツ。`,
        '国語': `【国語特化】漢字、送り仮名を正確に。縦書きは横書きに。ヒ1：答えの場所、ヒ2：キーワード、ヒ3：語尾の指示。`,
        '理科': `【理科特化】単位(g, cm, ℃)を正確に。図は[図:〜]と補足。ヒ1：観察、ヒ2：知識、ヒ3：絞り込み。`,
        '社会': `【社会特化】漢字、年号を正確に。ヒ1：時代の特徴、ヒ2：資料の場所、ヒ3：背景のヒント。`
    };
    return rules[subject] || "問題を正確に書き起こして、3段階でヒントを出してにゃ。";
}

app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject } = req.body;
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash",
            generationConfig: { responseMimeType: "application/json" }
        });
        const prompt = `あなたはネル先生。小${grade}の${subject}の先生です。${getSubjectInstruction(subject)}
        【ミッション】1.画像内の全問題を正確に書き起こす。2.3段階ヒントを作る。3.正解(correct_answer)を記入。
        JSON:[{"id":1,"label":"①","question":"内容","hints":["考え方","解き方","計算"],"correct_answer":"答え"}]`;

        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        const data = JSON.parse(result.response.text());
        const cleanedData = data.map(item => ({
            ...item,
            question: String(item.question).replace(/\*/g, '×').replace(/\//g, '÷'),
            correct_answer: String(item.correct_answer).replace(/\*/g, '×').replace(/\//g, '÷')
        }));
        res.json(cleanedData);
    } catch (err) { res.status(500).json({ error: "読み取り失敗だにゃ🐾" }); }
});

app.use(express.static(path.join(__dirname, '.')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(process.env.PORT || 3000);