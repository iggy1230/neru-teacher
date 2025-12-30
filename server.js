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

// SSML生成（リッチ版）
function createRichSSML(text, mood) {
    let rate = "1.0"; let pitch = "0.0";
    if (mood === "happy") { rate = "1.1"; pitch = "+2st"; }
    if (mood === "thinking") { rate = "0.95"; pitch = "-1st"; }
    if (mood === "gentle") { rate = "0.9"; pitch = "+1st"; }
    if (mood === "excited") { rate = "1.2"; pitch = "+4st"; }
    
    // 読み上げ禁止文字削除 & エスケープ
    let cleanText = text.replace(/🐾|✨|⭐|🎵/g, '').replace(/⭕️/g, '正解').replace(/❌/g, '不正解')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const processedText = cleanText
        .replace(/……/g, '<break time="650ms"/>')
        .replace(/にゃ/g, '<prosody pitch="+3st">にゃ</prosody>');
        
    return `<speak><prosody rate="${rate}" pitch="${pitch}">${processedText}</prosody></speak>`;
}

// ロボット声対策用：安全なSSML（タグなし）
function createSafeSSML(text) {
    let cleanText = text.replace(/🐾|✨|⭐|🎵/g, '').replace(/⭕️/g, '正解').replace(/❌/g, '不正解');
    return `<speak>${cleanText}</speak>`;
}

app.post('/synthesize', async (req, res) => {
    try {
        const { text, mood } = req.body;
        if (!text) return res.status(400).json({ error: "No text" });

        // まずリッチな音声で試す
        try {
            const [response] = await ttsClient.synthesizeSpeech({
                input: { ssml: createRichSSML(text, mood) },
                voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' },
                audioConfig: { audioEncoding: 'MP3' },
            });
            return res.json({ audioContent: response.audioContent.toString('base64') });
        } catch (innerErr) {
            console.warn("TTS Rich Failed, retrying safe mode:", innerErr.message);
            // 失敗したら安全モードで再試行（これでロボット声を防ぐ）
            const [retryRes] = await ttsClient.synthesizeSpeech({
                input: { ssml: createSafeSSML(text) },
                voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' },
                audioConfig: { audioEncoding: 'MP3' },
            });
            return res.json({ audioContent: retryRes.audioContent.toString('base64') });
        }
    } catch (err) { 
        console.error("TTS Fatal Error:", err);
        res.status(500).send(err.message); 
    }
});

app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject } = req.body;
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash", 
            generationConfig: { responseMimeType: "application/json" }
        });
        
        // ★修正：ヒント3が答えにならないように指示を明確化
        const hintInstruction = `
        - "hints": 生徒が間違えた時に備えて、解き方を導くヒントを3つ作成してください。
          1. 「考え方の入り口」
          2. 「式のヒントや途中経過」
          3. 「答えにかなり近づく大きなヒント（※ただし答えそのものは書かないでください）」
          語尾は「〜だにゃ」「〜してね」等のネル先生口調にしてください。
        `;

        let prompt = "";
        if (mode === 'explain') {
            prompt = `あなたは「ネル先生」。小学${grade}年生の${subject}。画像から全問抽出。
            1. "question": 問題文書き起こし。
            2. "correct_answer": 正解。
            3. ${hintInstruction}
            4. 算数記号は×÷。JSON配列で出力。
            `;
        } else {
            prompt = `厳格な採点先生。小学${grade}年生の${subject}。
            1. "question": 問題文書き起こし。
            2. "correct_answer": 正解。
            3. "student_answer": 手書き文字読み取り(空欄なら"")。
            4. ${hintInstruction}
            JSON配列で出力。
            `;
        }

        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        res.json(JSON.parse(result.response.text().replace(/\*/g, '×').replace(/\//g, '÷')));
    } catch (err) { 
        console.error("Analyze Error:", err);
        res.status(500).json({ error: "AIエラー" }); 
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(process.env.PORT || 3000);