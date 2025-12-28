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

// 画像データなどを受け取れるように制限を大きく設定
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 1. 静的ファイル（HTML, CSS, JS, 画像）を公開する設定
app.use(express.static(path.join(__dirname, '.')));

// ==========================================
// 🐾 環境変数の読み込みとチェック
// ==========================================
const credsRaw = process.env.GOOGLE_CREDENTIALS_JSON;
const geminiKey = process.env.GEMINI_API_KEY;

if (!credsRaw) {
    console.error("❌ エラー：GOOGLE_CREDENTIALS_JSON が設定されていませんにゃ！");
}
if (!geminiKey) {
    console.error("❌ エラー：GEMINI_API_KEY が設定されていませんにゃ！");
}

// カギの準備
let GOOGLE_CREDENTIALS;
try {
    GOOGLE_CREDENTIALS = JSON.parse(credsRaw);
    console.log("✅ Google Cloud 認証データの解析に成功したにゃ！");
} catch (e) {
    console.error("❌ Google Cloud 認証データの解析に失敗したにゃ。形式を確認してにゃ。");
}

const genAI = new GoogleGenerativeAI(geminiKey);
const ttsClient = new textToSpeech.TextToSpeechClient({ credentials: GOOGLE_CREDENTIALS });

// ==========================================
// 🎭 ネル先生の感情読み上げ SSML作成
// ==========================================
function createSSML(text, mood) {
    let rate = "1.0"; // 速さ
    let pitch = "0.0"; // 高さ
    
    if (mood === "happy") { rate = "1.1"; pitch = "+2st"; }
    if (mood === "thinking") { rate = "0.95"; pitch = "-1st"; }
    if (mood === "gentle") { rate = "0.9"; pitch = "+1st"; }
    if (mood === "excited") { rate = "1.2"; pitch = "+4st"; }

    const processedText = text
        .replace(/……/g, '<break time="650ms"/>')
        .replace(/。/g, '。<break time="300ms"/>')
        .replace(/にゃ/g, '<prosody pitch="+3st">にゃ</prosody>');

    return `<speak><prosody rate="${rate}" pitch="${pitch}">${processedText}</prosody></speak>`;
}

// --- 音声合成エンドポイント ---
app.post('/synthesize', async (req, res) => {
    try {
        const { text, mood } = req.body;
        console.log(`[TTS] 受信: "${text}" [${mood}]`);

        const request = {
            input: { ssml: createSSML(text, mood) },
            voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' },
            audioConfig: { audioEncoding: 'MP3' },
        };

        const [response] = await ttsClient.synthesizeSpeech(request);
        res.json({ audioContent: response.audioContent.toString('base64') });
    } catch (err) {
        console.error("❌ TTSエラー:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 🤖 AI 解析ロジック (Gemini 2.5 Flash)
// ==========================================
app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade } = req.body;
        console.log(`[AI] 解析開始: ${mode} [小${grade}]`);
        
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const prompt = mode === 'explain' 
            ? `あなたは猫後市立ねこづか小学校のネル先生です。生徒は${grade}年生。
               画像内の①〜⑳の問題を正確に抜き出し、記号は×÷、横棒はマイナスとして扱ってください。
               3段階のヒント（考え方、式の作り方、計算）を作成してください。
               JSON形式で返してください:[{"id":1,"label":"①","question":"式","hints":["考え方","式の作り方","計算"],"correct_answer":"答え"}]`
            : `小学校${grade}年生の宿題を厳格に採点してください。
               独立計算を行い、一文字でも違えば不正解です。JSON形式で返してください。
               JSON:[{"id":1,"label":"①","question":"式","student_answer":"答え","status":"correct/incorrect","correct_answer":"正解"}]`;

        const result = await model.generateContent({
            contents: [{ parts: [{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        });

        const responseText = result.response.text();
        let cleanedJson = responseText
            .replace(/```json|```/g, "")
            .trim()
            .replace(/\*/g, '×')
            .replace(/\//g, '÷');

        res.json(JSON.parse(cleanedJson));
        console.log("✅ AI解析完了");

    } catch (err) {
        console.error("❌ AI解析エラー:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// 2. サイトのトップページにアクセスしたら index.html を返す設定
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Nell-Server started on port ${PORT}`));