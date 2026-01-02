import textToSpeech from '@google-cloud/text-to-speech';
import { GoogleGenerativeAI } from "@google/generative-ai";
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket, { WebSocketServer } from 'ws';
import { parse } from 'url';

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

    // ゲーム実況などは短くハキハキと
    if (cleanText.length < 10 || cleanText.includes("！")) {
        return `<speak><prosody rate="1.2" pitch="+3st">${cleanText}</prosody></speak>`;
    }

    cleanText = cleanText.replace(/……/g, '<break time="500ms"/>');
    return `<speak><prosody rate="${rate}" pitch="${pitch}">${cleanText.replace(/にゃ/g, '<prosody pitch="+3st">にゃ</prosody>')}</prosody></speak>`;
}

app.post('/synthesize', async (req, res) => {
    try {
        if (!ttsClient) throw new Error("TTS not ready");
        const { text, mood } = req.body;
        if (!text) return res.status(400).json({ error: "No text" });
        const [response] = await ttsClient.synthesizeSpeech({
            input: { ssml: createSSML(text, mood) },
            voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' }, 
            audioConfig: { audioEncoding: 'MP3' },
        });
        res.json({ audioContent: response.audioContent.toString('base64') });
    } catch (err) { res.status(500).send(err.message); }
});

// --- ★新設：ゲーム実況API ---
app.post('/game-commentary', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { situation, name } = req.body; // situation: start, hit, pinch, clear, fail
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        
        const prompt = `
        あなたは猫の先生「ネル先生」です。生徒の「${name}」さんがブロック崩しゲームをしています。
        今の状況に合わせて、10文字以内で一言だけ、実況または応援してください。
        
        状況: ${situation}
        
        【条件】
        - 10文字以内（絶対に短く！）。
        - 語尾は「にゃ」または「にゃ！」。
        - 絵文字禁止。
        - 状況別例（これを使わず毎回変えて）:
          start -> 「始めるにゃ！」「いくよ！」
          hit -> 「ナイスにゃ！」「いいぞ！」
          pinch -> 「危ないにゃ！」「落ちるにゃ！」
          clear -> 「すごいにゃ！」「天才にゃ！」
          fail -> 「どんまいにゃ」「惜しいにゃ」
        `;

        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text().trim() });
    } catch (err) { res.status(500).json({ error: "Game AI Error" }); }
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
            const theme = ["生徒への過剰な感謝", "カリカリの美味しさの哲学", "生徒との絆"][Math.floor(Math.random()*3)];
            prompt = `あなたは猫の先生「ネル先生」。生徒「${name}」から給食${count}個目をもらった。
            テーマ:【${theme}】で60文字程度で熱く語って。注釈禁止。語尾「にゃ」。`;
        } else {
            prompt = `あなたは猫の先生「ネル先生」。カリカリを1つ食べた。15文字以内で一言リアクション。例:「うみゃい！」など。語尾「にゃ」。`;
        }

        const result = await model.generateContent(prompt);
        let reply = result.response.text().trim();
        reply = reply.replace(/^[A-C][:：]\s*/i, '').replace(/^テーマ[:：]\s*/, '');
        if (!isSpecial && reply.includes('\n')) reply = reply.split('\n')[0];
        res.json({ reply, isSpecial });
    } catch (err) { res.status(500).json({ error: "Error" }); }
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

        const rules = {
            'さんすう': { scan: "筆算の横線とマイナス記号の混同注意。累乗や分数を正確に。", hint: "1.立式 2.注目点 3.計算のコツ", grade: "筆算の繰り上がりメモを答えと間違えない。単位がないものはバツ。0と6の見間違い注意。" },
            'こくご': { scan: "ふりがな無視。縦書きは右から左。", hint: "漢字:1.なりたち 2.構成 3.似た字", grade: "トメ・ハネ・ハライ厳守。" },
            'りか': { scan: "グラフ軸ラベル・単位必須。記号選択肢も書き出す。", hint: "1.観察 2.知識想起 3.絞り込み", grade: "カタカナ指定をひらがなで書いたらバツ。" },
            'しゃかい': { scan: "グラフ軸・地図記号正確に。", hint: "1.観察 2.知識想起 3.絞り込み", grade: "漢字指定をひらがなで書いたらバツ。" }
        };
        const r = rules[subject] || rules['さんすう'];
        const baseRole = `あなたは「ねこご市立ねこづか小学校」のネル先生です。小学${grade}年生の「${subject}」担当です。語尾は「にゃ」。`;
        
        const commonScan = `
        【書き起こし絶対ルール】
        1. 画像の「最上部」から「最下部」まで、すべての問題を漏らさず抽出してください。
        2. ${mode === 'explain' ? '手書き答案は無視し、問題文のみ抽出。' : '手書き文字（student_answer）を文脈から推測して読み取る。'}
        3. 1つの問いに複数の回答が必要なときは要素を分ける（例: 問1(1)①, 問1(1)②）。
        4. 教科別注意: ${r.scan}`;

        let prompt = "";
        if (mode === 'explain') {
            prompt = `
            ${baseRole} ${commonScan}
            JSON出力: [{"id":1,"label":"問1","question":"文","correct_answer":"正解","hints":["ヒント1(${r.hint.split('1.')[1].split('2.')[0]})","ヒント2...","ヒント3(答えは書かない)"]}]
            `;
        } else {
            prompt = `
            ${baseRole} 厳格な採点官。 ${commonScan}
            JSON出力: [{"id":1,"label":"問1","question":"文","correct_answer":"正解","student_answer":"読取","hints":["ヒント1","ヒント2","ヒント3"]}]
            【採点基準】${r.grade}
            `;
        }

        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        res.json(JSON.parse(result.response.text().replace(/```json|```/g, '').replace(/\*/g, '×').replace(/\//g, '÷')));
    } catch (err) { res.status(500).json({ error: "AI Error" }); }
});

// --- チャットAPI ---
app.post('/chat', async (req, res) => {
    try {
        const { message, grade, name } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const result = await model.generateContent(`あなたは「ネル先生」。相手は小学${grade}年生「${name}」。30文字以内、語尾「にゃ」。絵文字禁止。発言: ${message}`);
        res.json({ reply: result.response.text() });
    } catch (err) { res.status(500).json({ error: "Chat Error" }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// --- Live API Proxy ---
const wss = new WebSocketServer({ server });
wss.on('connection', (clientWs, req) => {
    const parameters = parse(req.url, true).query;
    const userGrade = parameters.grade || "1";
    let geminiWs = null;
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;

    try {
        geminiWs = new WebSocket(GEMINI_URL);
        geminiWs.on('open', () => {
            geminiWs.send(JSON.stringify({
                setup: {
                    model: "models/gemini-2.0-flash-exp",
                    generation_config: { response_modalities: ["AUDIO"], speech_config: { voice_config: { prebuilt_voice_config: { voice_name: "Charon" } } } },
                    system_instruction: { parts: [{ text: `君は『ねこご市立ねこづか小学校』のネル先生だにゃ。いつも元気で、語尾は必ず『〜にゃ』だにゃ。ゆっくり、優しいトーンで喋ってにゃ。給食(餌)のカリカリが大好物にゃ。必ずユーザーの${userGrade}学年に合わせて分かりやすいように話す` }] }
                }
            }));
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify({ type: "server_ready" }));
        });
        geminiWs.on('message', (data) => { if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data); });
        geminiWs.on('error', (e) => console.error('Gemini WS Error:', e));
        geminiWs.on('close', () => {});
    } catch (e) { clientWs.close(); }
    clientWs.on('message', (data) => {
        try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'audio' && geminiWs && geminiWs.readyState === WebSocket.OPEN) {
                geminiWs.send(JSON.stringify({ realtime_input: { media_chunks: [{ mime_type: "audio/pcm;rate=16000", data: parsed.data }] } }));
            }
        } catch (e) {}
    });
    clientWs.on('close', () => { if (geminiWs && geminiWs.readyState === WebSocket.OPEN) geminiWs.close(); });
});