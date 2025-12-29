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
// 🐾 設定エリア (Renderの環境変数に登録してにゃ)
// ==========================================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
const ttsClient = new textToSpeech.TextToSpeechClient({ credentials: GOOGLE_CREDENTIALS });

// 🔊 音声合成 (SSML対応)
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

// --- 教科別プロンプト生成関数 ---
function getSystemPrompt(subject, grade, mode) {
    const isExplain = mode === 'explain';
    const base = `あなたは教育猫型AI「ネル先生」です。小学${grade}年生の${subject}を教えています。語尾に「にゃ」をつけて優しく、丁寧に詳しくお喋りしてください。`;
    
    const subjectRules = {
        '算数': `【算数特別ルール】
                1. ×や÷の記号を正確に。
                2. 分数は 1/2、累乗（$2^2$など）は 2^2 と表記してにゃ。
                3. 筆算の横線をマイナス記号と混同しないで正確に数式を抜き出して。`,
        '国語': `【国語特別ルール】
                1. 漢字、送り仮名を正確に。
                2. 縦書きの問題は「右から左へ」読む順番で横書きに直して。
                3. ふりがな（ルビ）は無視して、本文の漢字だけを正確に書き起こして。`,
        '理科': `【理科特別ルール】
                1. 実験図のラベルやグラフの数値、単位（g, cm, ℃）を正確に。
                2. 図がある場合は[図：〜の説明]として問題文に含めてにゃ。`,
        '社会': `【社会特別ルール】
                1. 地名、人名、年号を正確に。
                2. 地図の記号や年表の情報も詳細に書き起こして。
                3. 記号選択問題（ア、イ、ウ）は選択肢の内容もすべて書き出してにゃ。`
    };

    const modeInstructions = isExplain 
        ? `【手順】
           1. 画像内の全問題を正確に書き起こす。
           2. 以下のJSON形式で返す。
           3. hintsは「1.考え方の入り口」「2.解き方のコツ」「3.計算や解法の最終ステップ」の3段階で構成し、${grade}年生にわかるよう超丁寧にお喋りして。
           4. correct_answerは、画像に答えがなくても問題から推測して記入して。`
        : `【手順】
           1. 画像内の問題と生徒の答えを読み取る。
           2. 厳格に正誤判定を行い、アドバイスを添えてJSONで返す。`;

    return `${base}\n${subjectRules[subject] || ""}\n${modeInstructions}
    
    【JSON形式厳守】
    [
      {
        "id": 1,
        "label": "①",
        "question": "問題文全文",
        "hints": ["ヒント1", "ヒント2", "ヒント3"],
        "correct_answer": "正解"
      }
    ]`;
}

app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject } = req.body;
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash",
            generationConfig: { responseMimeType: "application/json" }
        });
        const prompt = getSystemPrompt(subject, grade, mode);
        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        const data = JSON.parse(result.response.text());
        const cleanedData = data.map(item => ({
            ...item,
            question: item.question.replace(/\*/g, '×').replace(/\//g, '÷'),
            correct_answer: String(item.correct_answer).replace(/\*/g, '×').replace(/\//g, '÷')
        }));
        res.json(cleanedData);
    } catch (err) { res.status(500).json({ error: "読み取りに失敗したにゃ🐾" }); }
});

app.use(express.static(path.join(__dirname, '.')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(process.env.PORT || 3000);