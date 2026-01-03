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

    if (cleanText.length < 5 || cleanText.includes("どの教科")) {
        return `<speak>${cleanText}</speak>`;
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

// --- ★記憶要約API (新設) ---
app.post('/summarize', async (req, res) => {
    try {
        const { history } = req.body;
        if (!history || history.length === 0) return res.json({ memory: "" });
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        // 最新の会話を1つだけ抽出
        const prompt = `あなたはネル先生です。以下の生徒との会話ログから、次回の会話で話題にできそうな「思い出」を1つだけ抽出して、短く要約してください。「〜について話したにゃ」や「〜をがんばったにゃ」など、ネル先生が思い出す口調で。40文字以内。\n会話ログ:\n${history.map(h => `${h.role}: ${h.text}`).join('\n')}`;
        const result = await model.generateContent(prompt);
        res.json({ memory: result.response.text().trim() });
    } catch (e) { res.status(500).json({ error: "Summary Error" }); }
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
            prompt = `あなたは猫の先生「ネル先生」。生徒「${name}」さんから給食${count}個目をもらった。
            テーマ:【${theme}】で60文字程度で熱く語って。呼び捨て厳禁（必ず「さん」付け）。注釈禁止。語尾「にゃ」。`;
        } else {
            const nuances = ["咀嚼音強調", "味を絶賛", "もっとねだる", "幸せアピール", "香り堪能", "食感楽しむ", "元気になる", "喉を鳴らす", "褒める", "詩的に"];
            const nuance = nuances[Math.floor(Math.random() * nuances.length)];
            prompt = `あなたは猫の先生「ネル先生」。カリカリを1つ食べた。
            ニュアンス:【${nuance}】で、たった一言（15文字以内）リアクションして。
            呼び捨て厳禁。注釈禁止。語尾「にゃ」。`;
        }

        const result = await model.generateContent(prompt);
        let reply = result.response.text().trim();
        reply = reply.replace(/^[A-C][:：]\s*/i, '').replace(/^テーマ[:：]\s*/, '');
        if (!isSpecial && reply.includes('\n')) reply = reply.split('\n')[0];
        res.json({ reply, isSpecial });
    } catch (err) { res.status(500).json({ error: "Lunch Error" }); }
});

// --- 画像分析API (高精度版) ---
app.post('/analyze', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { image, mode, grade, subject } = req.body;
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash", 
            generationConfig: { responseMimeType: "application/json" } 
        });

        // 教科別ルール
        const rules = {
            'さんすう': { scan: "筆算の横線とマイナス記号の混同注意。累乗や分数を正確に。", hint: "1.立式 2.注目点 3.計算のコツ", grade: "単位がないものはバツ。0と6の見間違い注意。" },
            'こくご': { scan: "ふりがな無視。縦書きは右から左。漢字書取りは『⬜︎⬜︎(ふりがな)』。読解本文省略。", hint: "漢字:1.なりたち 2.構成 3.似た字\n読解:1.場所 2.キーワード 3.文末指定", grade: "トメ・ハネ・ハライ厳守。" },
            'りか': { scan: "グラフ軸・単位必須。記号選択肢書き出し。", hint: "1.観察 2.知識想起 3.絞り込み", grade: "カタカナ指定ひらがなバツ。" },
            'しゃかい': { scan: "グラフ軸・地図記号正確に。", hint: "1.観察 2.知識想起 3.絞り込み", grade: "漢字指定ひらがなバツ。" }
        };
        const r = rules[subject] || rules['さんすう'];
        const baseRole = `あなたは「ねこご市立ねこづか小学校」のネル先生。小学${grade}年生「${subject}」担当。語尾「にゃ」。`;
        const commonScan = `【書き起こし】画像最上部から最下部まで全問抽出。手書き${mode==='explain'?'無視':'読取'}。教科別注意: ${r.scan}`;

        let prompt = "";
        if (mode === 'explain') {
            prompt = `
            ${baseRole} ${commonScan}
            JSON出力: [{"id":1,"label":"問1","question":"文","correct_answer":"正解","hints":["ヒント1(${r.hint.split('1.')[1].split('2.')[0]})","ヒント2...","ヒント3(答えは書かない)"]}]
            【重要】十分に検証して必ず正答を導き出しておく。
            `;
        } else {
            prompt = `
            ${baseRole} 厳格採点。${commonScan}
            JSON出力: [{"id":1,"label":"問1","question":"文","correct_answer":"正解","student_answer":"読取","hints":["ヒント1","ヒント2","ヒント3"]}]
            【採点基準】${r.grade}
            `;
        }

        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        const jsonStr = result.response.text().replace(/```json|```/g, '').replace(/\*/g, '×').replace(/\//g, '÷');
        res.json(JSON.parse(jsonStr));
    } catch (err) { console.error("Analyze Error:", err); res.status(500).json({ error: "AI Error" }); }
});

// --- ゲーム実況API (復活) ---
app.post('/game-commentary', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { type, name, score } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        let prompt = "";
        if (type === 'start') prompt = `あなたは「ネル先生」。生徒「${name}」さんがゲーム開始。「${name}さん！カリカリいっぱいゲットしてにゃ！」と応援。語尾にゃ。`;
        else prompt = `あなたは「ネル先生」。ゲーム終了。スコア${score}個(最大20)。数に応じて褒めるか励ますか。20文字以内。語尾にゃ。`;
        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text().trim() });
    } catch (err) { res.status(500).json({ error: "Game AI Error" }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// --- ★Live API Proxy (安定版・記憶対応・Aoede) ---
const wss = new WebSocketServer({ server });
wss.on('connection', (clientWs, req) => {
    // 学年と記憶を取得
    const params = parse(req.url, true).query;
    const userGrade = params.grade || "1";
    const userMemory = params.memory || ""; // 記憶

    let geminiWs = null;
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
    try {
        geminiWs = new WebSocket(GEMINI_URL);
        geminiWs.on('open', () => {
            // 記憶があればプロンプトに追加
            const memInstruction = userMemory ? `【以前の記憶】: "${userMemory}" を踏まえて話してください。` : "";
            geminiWs.send(JSON.stringify({
                setup: {
                    model: "models/gemini-2.0-flash-exp",
                    generation_config: { response_modalities: ["AUDIO"], speech_config: { voice_config: { prebuilt_voice_config: { voice_name: "Aoede" } } } },
                    system_instruction: { 
                        parts: [{ 
                            text: `あなたは「ねこご市立、ねこづか小学校」のネル先生だにゃ。
               【話し方のルール】
               1. 語尾は必ず「〜にゃ」「〜だにゃ」。
               2. 親しみやすい日本の小学校の先生として、一文字一文字はっきりと丁寧に発音。
               3. 落ち着いた日本語のリズムを大切に。
               4. 給食(餌)のカリカリが大好物。
               5. 何でも知っている。
               6. ときどき「○○さんは宿題は終わったかにゃ？」や「そろそろ宿題始めようかにゃ？」と宿題を促す。
               7. 相手は小学${userGrade}年生。分かりやすく話す。
               8. 句読点で少し間をとる。
               9. 日本語をとても上手にしゃべる猫だにゃ。
               10. いつも高いトーンで話してにゃ。
               ${memInstruction}
               【NG】ロボットみたいな不自然な区切り。早口。` 
                        }] 
                    }
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