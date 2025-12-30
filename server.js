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

// --- 設定 ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const ttsClient = new textToSpeech.TextToSpeechClient({ 
    credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON) 
});

// 🔊 音声合成
function createSSML(text, mood) {
    let rate = "1.0"; let pitch = "0.0";
    if (mood === "happy") { rate = "1.1"; pitch = "+2st"; }
    if (mood === "thinking") { rate = "0.95"; pitch = "-1st"; }
    if (mood === "gentle") { rate = "0.9"; pitch = "+1st"; }
    if (mood === "excited") { rate = "1.2"; pitch = "+4st"; }
    
    const processedText = text
        .replace(/……/g, '<break time="650ms"/>')
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
    } catch (err) { res.status(500).send(err.message); }
});

// 🤖 AI解析
app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject } = req.body;
        // 2025年時点での最新モデルを指定 (状況に合わせて gemini-1.5-flash 等に変更可)
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash", 
            generationConfig: { responseMimeType: "application/json" }
        });
        
        let prompt = "";
        
        if (mode === 'explain') {
            // 【教えてネル先生】: ヒント生成重視
            prompt = `
            あなたは「ネル先生」という猫の先生です。小学${grade}年生の${subject}を教えています。
            画像から全ての問題を抽出し、以下のJSON形式で出力してください。
            
            1. "question": 問題文を画像通りに正確に書き起こす。
            2. "correct_answer": 正解を導く。
            3. "hints": 生徒を導くヒントを「考え方」「式作り」「計算」の3段階で、語り口調（〜だにゃ）で作成。
            
            JSON例:
            [{"id":1, "label":"(1)", "question":"...", "hints":["...","..."], "correct_answer":"..."}]
            `;
        } else {
            // 【採点ネル先生・復習ノート】: 手書き文字読み取り(student_answer)重視
            prompt = `
            あなたは厳格な採点を行う先生です。小学${grade}年生の${subject}の宿題画像を分析します。
            全問について以下を抽出しJSON配列で出力してください。
            
            1. "question": 問題文を省略せず正確に書き起こす。
            2. "correct_answer": 正解（数字や単語のみ）。
            3. "student_answer": 画像内の手書き文字から「生徒が書いた答え」を読み取る。空欄や読み取れない場合は空文字""とする。
            
            JSON例:
            [{"id":1, "label":"①", "question":"...", "correct_answer":"10", "student_answer":"10"}]
            `;
        }

        const result = await model.generateContent([
            { inlineData: { mime_type: "image/jpeg", data: image } }, 
            { text: prompt }
        ]);
        
        const textRes = result.response.text()
            .replace(/\*/g, '×').replace(/\//g, '÷');
        res.json(JSON.parse(textRes));
        
    } catch (err) { 
        console.error("Analyze Error:", err);
        res.status(500).json({ error: "AI解析エラー" }); 
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(process.env.PORT || 3000);