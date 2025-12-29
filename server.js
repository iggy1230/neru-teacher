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

// --- 設定 ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
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
        '算数': `【算数特化】
            - 数式、計算記号、単位を正確に。
            - ヒント1：使うべき「公式」や「考え方の入り口」を教えるにゃ。
            - ヒント2：計算の途中の「注目すべきポイント」を指摘するにゃ。
            - ヒント3：あと少しで解ける「最後のひと押し」を話すにゃ。`,
        '国語': `【国語特化】
            - 縦書きは横書きに変換。漢字、送り仮名を正確に。
            - ヒント1：答えが隠れている「段落」や「行」の目安を教えるにゃ。
            - ヒント2：接続詞や心情を表す「キーワード」に注目させるにゃ。
            - ヒント3：答えの「語尾（〜のこと、〜から等）」を指示するにゃ。`,
        '理科': `【理科特化】
            - 実験器具や数値、グラフの軸ラベルを正確に。
            - ヒント1：実験の「目的」や「変化の様子」を思い出させるにゃ。
            - ヒント2：グラフの「増え方」や「傾向」に注目させるにゃ。
            - ヒント3：習った「用語」の最初の1文字をヒントに出すにゃ。`,
        '社会': `【社会特化】
            - 地名、人名、歴史用語の漢字を絶対に間違えない。
            - ヒント1：関係する「時代」や「地方」の特徴を話すにゃ。
            - ヒント2：教科書の「資料や地図」のどこを見るか教えるにゃ。
            - ヒント3：その出来事が「なぜ起きたか」の背景をヒントにするにゃ。`
    };
    return rules[subject] || "問題を正確に書き起こして、ステップバイステップでヒントを出してにゃ。";
}

app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject } = req.body;
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash",
            generationConfig: { responseMimeType: "application/json" }
        });
        const subjectRule = getSubjectInstruction(subject);
        const prompt = `あなたは教育猫型AI「ネル先生」です。小${grade}の${subject}を教えています。
        ${subjectRule}
        【ミッション】1.画像内の問題を1つずつ正確に書き起こす。2.3段階ヒントを作る。3.正解(correct_answer)を記入。
        JSON:[{"id":1,"label":"①","question":"内容","hints":["ヒ1","ヒ2","ヒ3"],"correct_answer":"答え"}]`;

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