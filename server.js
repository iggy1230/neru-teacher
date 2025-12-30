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
app.use(express.static(path.join(__dirname, '.')));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const ttsClient = new textToSpeech.TextToSpeechClient({ 
    credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON) 
});

// 🔊 音声合成 (SSML調整版)
function createSSML(text, mood) {
    let rate = "1.0"; let pitch = "0.0";
    if (mood === "happy") { rate = "1.1"; pitch = "+2st"; }
    if (mood === "thinking") { rate = "0.95"; pitch = "-1st"; }
    if (mood === "gentle") { rate = "0.9"; pitch = "+1st"; }
    if (mood === "excited") { rate = "1.2"; pitch = "+4st"; }
    
    // ★読み上げ禁止文字の削除★
    const cleanText = text
        .replace(/🐾/g, '') // 足跡を読まない
        .replace(/[✨⭐🎵]/g, '') // 絵文字を読まない
        .replace(/⭕️/g, '正解') // 記号を言葉に
        .replace(/❌/g, '不正解');

    const processedText = cleanText
        .replace(/……/g, '<break time="650ms"/>')
        .replace(/にゃ/g, '<prosody pitch="+3st">にゃ</prosody>');
        
    return `<speak><prosody rate="${rate}" pitch="${pitch}">${processedText}</prosody></speak>`;
}

app.post('/synthesize', async (req, res) => {
    try {
        const { text, mood } = req.body;
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            return res.status(400).json({ error: "Text required" });
        }
        const [response] = await ttsClient.synthesizeSpeech({
            input: { ssml: createSSML(text, mood) },
            voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' },
            audioConfig: { audioEncoding: 'MP3' },
        });
        res.json({ audioContent: response.audioContent.toString('base64') });
    } catch (err) { 
        console.error("TTS Error:", err);
        res.status(500).send(err.message); 
    }
});

// 🤖 AI解析
app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject } = req.body;
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash", 
            generationConfig: { responseMimeType: "application/json" }
        });
        
        let prompt = "";
        const hintInstruction = `
        - "hints": 生徒が間違えた時に備えて、解き方を導くヒントを3つ作成してください。
          1つ目は「考え方」、2つ目は「式のヒント」、3つ目は「答えに近づくヒント」です。
          語尾は「〜だにゃ」「〜してね」等のネル先生口調にしてください。
        `;

        if (mode === 'explain') {
            prompt = `
            あなたは「ネル先生」という猫の先生です。小学${grade}年生の${subject}を教えています。
            画像から全問を抽出し、以下のJSON形式で出力してください。
            1. "question": 問題文を画像通りに正確に書き起こす。
            2. "correct_answer": 正解。
            3. ${hintInstruction}
            4. 算数記号は×÷を使用。
            JSON例: [{"id":1, "label":"(1)", "question":"...", "hints":["..."], "correct_answer":"..."}]
            `;
        } else {
            prompt = `
            あなたは厳格な採点を行う先生です。小学${grade}年生の${subject}の宿題画像を分析します。
            以下を抽出しJSON配列で出力してください。
            1. "question": 問題文を省略せず正確に書き起こす。
            2. "correct_answer": 正解（数字や単語のみ）。
            3. "student_answer": 画像内の手書き文字から「生徒が書いた答え」を読み取る。空欄や読み取れない場合は空文字""とする。
            4. ${hintInstruction}
            JSON例: [{"id":1, "label":"①", "question":"...", "correct_answer":"10", "student_answer":"10", "hints":["..."]}]
            `;
        }

        const result = await model.generateContent([
            { inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }
        ]);
        const textRes = result.response.text().replace(/\*/g, '×').replace(/\//g, '÷');
        res.json(JSON.parse(textRes));
    } catch (err) { 
        console.error("Analyze Error:", err);
        res.status(500).json({ error: "AI解析エラー" }); 
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(process.env.PORT || 3000);