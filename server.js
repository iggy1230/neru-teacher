import textToSpeech from '@google-cloud/text-to-speech';
import { GoogleGenerativeAI } from "@google/generative-ai";
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
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

// --- 音声合成 (SSML) ---
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

// --- 給食リアクションAPI ---
app.post('/lunch-reaction', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { count, name } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        
        let prompt = "";
        const isSpecial = count % 10 === 0;

        if (isSpecial) {
            const specialThemes = [
                "生徒を神様のように崇め奉り、大げさに感謝する",
                "カリカリの美味しさについて、グルメレポーターのように情熱的に語る",
                "生徒との出会いと絆について、涙ながらに熱く語る",
                "「もっとくれたら世界を救える気がする」と壮大な話をする"
            ];
            const theme = specialThemes[Math.floor(Math.random() * specialThemes.length)];

            prompt = `
            あなたは猫の先生「ネル先生」です。生徒「${name}」さんから給食(カリカリ)をもらいました。
            本日${count}個目の記念すべきカリカリです！テンションMAXです！
            テーマ: 【${theme}】
            【厳守】注釈禁止。セリフのみ。語尾は「にゃ」。60文字程度。
            `;
        } else {
            const nuances = [
                "食べる音（カリッ、ポリポリ）をメインにする",
                "「うまい！」「美味しい！」と叫ぶ",
                "「幸せ〜」と表現する",
                "「もっと！」とねだる",
                "「いい音だにゃ...」と噛み締める"
            ];
            const nuance = nuances[Math.floor(Math.random() * nuances.length)];

            prompt = `
            あなたは猫の先生「ネル先生」です。カリカリを1つもらって食べています。
            ニュアンス: 【${nuance}】
            【厳守】15文字以内の一言のみ。箇条書き禁止。語尾は「にゃ」。
            `;
        }

        const result = await model.generateContent(prompt);
        let replyText = result.response.text().trim();
        replyText = replyText.replace(/^[A-C][:：]\s*/i, '').replace(/^テーマ[:：]\s*/, '');
        if (!isSpecial && replyText.includes('\n')) {
            replyText = replyText.split('\n')[0];
        }

        res.json({ reply: replyText, isSpecial: isSpecial });
    } catch (err) { res.status(500).json({ error: "Lunch Error" }); }
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

// --- 画像分析API (高精度・漢字対応版) ---
app.post('/analyze', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { image, mode, grade, subject } = req.body;
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash", 
            generationConfig: { responseMimeType: "application/json" } 
        });
        
        const role = `あなたは「ネル先生」という優秀な猫の先生です。小学${grade}年生の「${subject}」を教えています。`;
        
        // ★書き起こし指示の強化
        const scanInstruction = `
        【書き起こしルール】
        1. 画像の最上部から最下部まで、すべての問題を抽出してください。
        2. 画像内に「手書きの文字（生徒の答案）」があっても、それは【無視】して、印刷された問題文だけを正確に書き起こしてください。
        3. 問題文は省略せず、一字一句正確に。
        `;

        // ★ヒント生成指示の強化（漢字対応・答えバレ防止）
        const hintInstruction = `
        "hints": 生徒が段階的に解けるよう、必ず3つのヒントを作成してください。
        【絶対厳守】ヒントの中で「正解の文字・数字」そのものは絶対に書かないでください。
        
        ■問題が「漢字の書き取り・読み」の場合：
          ヒント1: 「漢字のなりたち」や「意味」を教える（例：木のような形からできたにゃ）
          ヒント2: 「部首（へん・つくり）」や「構成要素」を言葉で説明する（例：きへんだにゃ、ウ冠だにゃ）
          ヒント3: 「似ている漢字」との違いや「特徴」を教える（例：〇〇という字に似てるけどここが違うにゃ）
        
        ■それ以外の問題（算数など）の場合：
          ヒント1: 「考え方の入り口（〜してみようにゃ）」
          ヒント2: 「式のヒントや注目点（〜に注目だにゃ）」
          ヒント3: 「答えにかなり近づくヒント（〜計算するとどうなるかにゃ？）」
        `;
        
        let prompt = "";
        
        if (mode === 'explain') {
            // 【教えてネル先生】
            prompt = `
            ${role}
            ${scanInstruction}
            以下のJSON形式で出力してください。
            [
              {
                "id": 1,
                "label": "問題番号",
                "question": "問題文の正確な書き起こし",
                "correct_answer": "正解",
                ${hintInstruction}
              }
            ]
            算数記号は「×」「÷」を使用。語尾は「にゃ」。
            `;
        } else {
            // 【採点・復習】
            prompt = `
            ${role}
            厳格な採点官として画像を分析してください。
            ${scanInstruction}
            
            [
              {
                "id": 1,
                "label": "問題番号",
                "question": "問題文の正確な書き起こし（手書きは無視）",
                "correct_answer": "正解（数字や単語のみ）",
                "student_answer": "画像内の手書き文字を読み取った生徒の答え（空欄なら空文字\"\"）",
                ${hintInstruction}
              }
            ]
            `;
        }

        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        const jsonStr = result.response.text().replace(/```json|```/g, '').replace(/\*/g, '×').replace(/\//g, '÷');
        res.json(JSON.parse(jsonStr));
        
    } catch (err) { 
        console.error("Analyze Error:", err);
        res.status(500).json({ error: "AI Error" }); 
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// --- Live API Proxy ---
const wss = new WebSocketServer({ server });
wss.on('connection', (clientWs) => {
    let geminiWs = null;
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
    try {
        geminiWs = new WebSocket(GEMINI_URL);
        geminiWs.on('open', () => {
            geminiWs.send(JSON.stringify({
                setup: {
                    model: "models/gemini-2.0-flash-exp",
                    generation_config: { response_modalities: ["AUDIO"], speech_config: { voice_config: { prebuilt_voice_config: { voice_name: "Puck" } } } },
                    system_instruction: { parts: [{ text: `あなたはネル先生です。語尾は「にゃ」。短く話して。` }] }
                }
            }));
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ type: "server_ready" }));
            }
        });
        geminiWs.on('message', (data) => { if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data); });
        geminiWs.on('error', (e) => console.error('Gemini WS Error:', e));
        geminiWs.on('close', () => {});
    } catch (e) { clientWs.close(); }
    clientWs.on('message', (data) => {
        try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'audio' && geminiWs && geminiWs.readyState === WebSocket.OPEN) {
                geminiWs.send(JSON.stringify({
                    realtime_input: {
                        media_chunks: [{ mime_type: "audio/pcm;rate=16000", data: parsed.data }]
                    }
                }));
            }
        } catch (e) {}
    });
    clientWs.on('close', () => { if (geminiWs && geminiWs.readyState === WebSocket.OPEN) geminiWs.close(); });
});