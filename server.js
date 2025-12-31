import textToSpeech from '@google-cloud/text-to-speech';
import { GoogleGenerativeAI } from "@google/generative-ai";
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
// WebSocketは今回使いませんが、エラー防止のため残しておきます
import WebSocket, { WebSocketServer } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '.')));

// API初期化
let genAI, ttsClient;
try {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    ttsClient = new textToSpeech.TextToSpeechClient({ 
        credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON) 
    });
} catch (e) { console.error("Init Error:", e.message); }

// --- 音声合成 ---
function createSSML(text, mood) {
    let rate = "1.1", pitch = "+2st"; 
    if (mood === "thinking") { rate = "1.0"; pitch = "0st"; }
    if (mood === "gentle") { rate = "0.95"; pitch = "+1st"; }
    if (mood === "excited") { rate = "1.2"; pitch = "+4st"; }
    
    let cleanText = text
        .replace(/[\u{1F600}-\u{1F6FF}]/gu, '')
        .replace(/🐾|✨|⭐|🎵|🐟|🎤|⭕️|❌/g, '')
        .replace(/&/g, 'と').replace(/[<>"']/g, ' ');

    if (cleanText.length < 2 || cleanText.includes("どの教科") || cleanText.includes("おはなし")) {
        return `<speak>${cleanText}</speak>`;
    }
    cleanText = cleanText.replace(/……/g, '<break time="500ms"/>');
    return `<speak><prosody rate="${rate}" pitch="${pitch}">${cleanText}</prosody></speak>`;
}

app.post('/synthesize', async (req, res) => {
    try {
        if (!ttsClient) throw new Error("TTS not ready");
        const { text, mood } = req.body;
        if (!text) return res.status(400).json({ error: "No text" });
        try {
            const [response] = await ttsClient.synthesizeSpeech({
                input: { ssml: createSSML(text, mood) },
                voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' }, 
                audioConfig: { audioEncoding: 'MP3' },
            });
            res.json({ audioContent: response.audioContent.toString('base64') });
        } catch (e) {
            const [retry] = await ttsClient.synthesizeSpeech({
                input: { text: text.replace(/[^a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g, '') },
                voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' },
                audioConfig: { audioEncoding: 'MP3' },
            });
            res.json({ audioContent: retry.audioContent.toString('base64') });
        }
    } catch (err) { res.status(500).send(err.message); }
});

// --- ★修正：給食リアクションAPI ---
app.post('/lunch-reaction', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { count, name } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        
        let prompt = "";
        const isSpecial = count % 10 === 0;

        if (isSpecial) {
            // 10個ごとの特別演出
            prompt = `
            あなたは猫の先生「ネル先生」です。生徒「${name}」さんから給食(カリカリ)をもらいました。
            本日${count}個目の記念すべきカリカリです！
            
            以下のどちらかの内容で、感情豊かに熱く語ってください。
            - 生徒への過剰な感謝と称賛
            - カリカリの美味しさについての哲学的・情熱的な語り
            
            【重要制約】
            - 「Aパターン」「Bパターン」などの注釈や説明は絶対に出力しないでください。
            - セリフの中身だけを出力してください。
            - 語尾は「にゃ」。
            - 60文字程度。
            `;
        } else {
            // 通常時（必ず短く）
            prompt = `
            あなたは猫の先生「ネル先生」です。カリカリをもらって食べています。
            
            【重要制約】
            - 「うみゃい！」「最高にゃ！」「たまらないにゃ〜」のような、一言二言の短いセリフにしてください。
            - 15文字以内厳守。
            - 毎回表現を少し変えてください。
            - 語尾は「にゃ」。
            `;
        }

        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text(), isSpecial: isSpecial });
    } catch (err) { 
        res.status(500).json({ error: "Lunch Error" }); 
    }
});

// --- チャットAPI ---
app.post('/chat', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { message, grade, name } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const prompt = `あなたは「ネル先生」。相手は小学${grade}年生「${name}」。30文字以内、語尾「にゃ」。絵文字禁止。発言: ${message}`;
        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text() });
    } catch (err) { res.status(500).json({ error: "Chat Error" }); }
});

// --- 画像分析API ---
app.post('/analyze', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { image, mode, grade, subject } = req.body;
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash", 
            generationConfig: { responseMimeType: "application/json" } 
        });
        
        const role = `あなたは「ネル先生」という優秀な猫の先生です。小学${grade}年生の「${subject}」を教えています。`;
        const scanInstruction = `画像の「最上部」から「最下部」まで、すべての問題を漏らさず抽出してください。問題文は一字一句正確に。`;
        const hintInstruction = `
        "hints": 生徒が段階的に解けるよう、必ず3つのヒントを作成してください。正解そのものは書かないでください。
        ■漢字: 意味、部首、構成要素。
        ■算数: 考え方、式、注目点。
        `;
        
        let prompt = "";
        if (mode === 'explain') {
            prompt = `${role} ${scanInstruction} 以下のJSON形式で出力。[{"id":1,"label":"問題番号","question":"文","correct_answer":"正解",${hintInstruction}}] 記号は×÷。語尾「にゃ」。`;
        } else {
            prompt = `${role} 厳格な採点。${scanInstruction} [{"id":1,"label":"問題番号","question":"文","correct_answer":"正解","student_answer":"手書き読取(空欄なら\"\")",${hintInstruction}}]`;
        }

        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        res.json(JSON.parse(result.response.text().replace(/\*/g, '×').replace(/\//g, '÷')));
    } catch (err) { res.status(500).json({ error: "AI Error" }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));