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

const BUILD_VERSION = "v2.2.0-Detailed"; 

// --- 設定 ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const GOOGLE_CREDENTIALS = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
const ttsClient = new textToSpeech.TextToSpeechClient({ credentials: GOOGLE_CREDENTIALS });

function createSSML(text, mood) {
    let rate = "1.0"; let pitch = "0.0";
    if (mood === "happy") { rate = "1.1"; pitch = "+2st"; }
    if (mood === "thinking") { rate = "0.95"; pitch = "-1st"; }
    if (mood === "gentle") { rate = "0.9"; pitch = "+1st"; }
    if (mood === "excited") { rate = "1.2"; pitch = "+3st"; }
    const processedText = text.replace(/……/g, '<break time="650ms"/>')
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        
        // ネル先生を「教育者」として強く定義するプロンプト
        const prompt = mode === 'explain' 
            ? `あなたは世界一優しくておしゃべりな家庭教師、ネル先生です。生徒は小学校 ${grade} 年生です。
               【重要ルール】
               1. 一言だけの短いヒントは絶対に禁止です。各ヒントは3〜4文章で丁寧に構成してください。
               2. 小学校 ${grade} 年生が習っていない漢字や難しい言葉は使わないでください。
               3. ヒント1(考え方)：問題を解くのが楽しくなるような励ましと、どこに注目すればいいか「……」を交えてお喋りして。
               4. ヒント2(式の作り方)：具体的な例え（お菓子や図など）を出しながら、論理的に式の立て方を教えて。
               5. ヒント3(計算)：計算ミスをしないためのコツを伝えて、最後の一押しをして。
               6. 算数記号は必ず「×」「÷」を使い、横棒はマイナス記号です。
               JSON形式:[{"id":1,"label":"①","question":"式","hints":["丁寧なヒント1","丁寧なヒント2","丁寧なヒント3"],"correct_answer":"答え"}]`
            : `小学校 ${grade} 年生の答案を、世界一優しく厳格に採点してにゃ。間違っていても「おしいにゃ！次はできるにゃ！」と必ず励まして。JSON配列で返して。`;

        const result = await model.generateContent({
            contents: [{ parts: [{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }] }],
            generationConfig: { responseMimeType: "application/json", temperature: 0.3 }
        });
        let text = result.response.text().replace(/```json|```/g, "").trim().replace(/\*/g, '×').replace(/\//g, '÷');
        res.json(JSON.parse(text));
    } catch (err) { 
        res.status(err.status === 429 ? 429 : 500).json({ error: err.message }); 
    }
});

app.use(express.static(path.join(__dirname, '.')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Nell-Server ${BUILD_VERSION} started`));