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

    if (cleanText.length < 5 || cleanText.includes("どの教科")) {
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
        const [response] = await ttsClient.synthesizeSpeech({
            input: { ssml: createSSML(text, mood) },
            voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' }, 
            audioConfig: { audioEncoding: 'MP3' },
        });
        res.json({ audioContent: response.audioContent.toString('base64') });
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
    } catch (err) { res.status(500).json({ error: "Lunch Error" }); }
});

// --- チャットAPI ---
app.post('/chat', async (req, res) => {
    try {
        const { message, grade, name } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const prompt = `あなたは「ネル先生」。相手は小学${grade}年生「${name}」。30文字以内、語尾「にゃ」。絵文字禁止。発言: ${message}`;
        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text() });
    } catch (err) { res.status(500).json({ error: "Chat Error" }); }
});

// --- ★画像分析API (教科別・高精度版) ---
app.post('/analyze', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { image, mode, grade, subject } = req.body;
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash", 
            generationConfig: { responseMimeType: "application/json" } 
        });

        // 教科別ルール定義
        const rules = {
            'さんすう': {
                attn: "筆算の横線とマイナス記号の混同注意。累乗や分数を正確に。",
                hint: "1.立式(何算か) 2.注目点(単位や数値) 3.計算のコツ",
                grade: "筆算の繰り上がりメモを答えと間違えない。単位がないものはバツ。0と6、1と7の見間違い注意。"
            },
            'こくご': {
                attn: "ふりがな無視。縦書きは右から左。漢字書取りは『⬜︎⬜︎(ふりがな)』と表記。長文読解の本文は省略。",
                hint: "漢字:1.なりたち 2.辺やつくり 3.似た字\n読解:1.場所 2.キーワード 3.文末指定",
                grade: "トメ・ハネ・ハライ厳守。送り仮名ミスはバツ。読解の文末(〜こと)チェック。"
            },
            'りか': {
                attn: "グラフ軸ラベル・単位(g,℃)必須。記号選択肢も書き出す。図付近の問題見逃し厳禁。",
                hint: "1.観察(図のどこを見るか) 2.関連知識(用語想起) 3.絞り込み(選択肢)",
                grade: "カタカナ指定をひらがなで書いたらバツ。グラフ描画は点の位置と直線性重視。"
            },
            'しゃかい': {
                attn: "グラフ軸・単位・地図記号正確に。選択肢書き出し。資料周辺の問題注意。",
                hint: "1.観察(資料の注目点) 2.関連知識(歴史用語・地名) 3.絞り込み",
                grade: "漢字指定をひらがなで書いたらバツ。時代背景の矛盾チェック。"
            }
        };
        const r = rules[subject] || rules['さんすう'];

        const base = `あなたは「ねこご市立ねこづか小学校」のネル先生。小学${grade}年生の「${subject}」担当。語尾「にゃ」。`;
        const common = `
        【書き起こし】画像最上部から最下部まで全問抽出。大問小問番号必須。
        教科別注意: ${r.attn}
        `;

        let prompt = "";
        if (mode === 'explain') {
            // 解説モード：手書き無視
            prompt = `
            ${base} ${common}
            手書き答案は【完全に無視】し、問題文のみ正確に書き起こしてください。
            
            JSON形式:
            [
              {
                "id": 1,
                "label": "問1",
                "question": "問題文",
                "correct_answer": "正解",
                "hints": ["ヒント1(${r.hint.split('1.')[1].split('2.')[0]})", "ヒント2...", "ヒント3(答えは書かない)"]
              }
            ]
            `;
        } else {
            // 採点モード：手書き推測
            prompt = `
            ${base} 厳格な採点官。 ${common}
            手書き文字(student_answer)は子供の筆跡を考慮し、文脈から推測して読み取ってください。
            1つの問いに複数の回答欄がある場合は、回答欄の数だけ配列要素を作成してください。
            
            JSON形式:
            [
              {
                "id": 1,
                "label": "問1",
                "question": "問題文",
                "correct_answer": "正解(数字/単語)",
                "student_answer": "読み取った手書き文字(空欄は\"\")",
                "hints": ["復習ヒント1", "復習ヒント2", "復習ヒント3"]
              }
            ]
            【採点基準】${r.grade}
            `;
        }

        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        const jsonStr = result.response.text().replace(/```json|```/g, '').replace(/\*/g, '×').replace(/\//g, '÷');
        res.json(JSON.parse(jsonStr));
    } catch (err) { console.error(err); res.status(500).json({ error: "AI Error" }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// --- ★Live API Proxy (復元・安定版) ---
const wss = new WebSocketServer({ server });

wss.on('connection', (clientWs) => {
    console.log('Client connected to Live Chat');
    let geminiWs = null;
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;

    try {
        geminiWs = new WebSocket(GEMINI_URL);
        geminiWs.on('open', () => {
            console.log('Connected to Gemini');
            const setupMsg = {
                setup: {
                    model: "models/gemini-2.0-flash-exp",
                    generation_config: {
                        response_modalities: ["AUDIO"],
                        speech_config: { voice_config: { prebuilt_voice_config: { voice_name: "Charon" } } } // Charonに設定
                    },
                    system_instruction: { 
                        parts: [{ 
                            text: `君は『ねこご市立ねこづか小学校』のネル先生だにゃ。いつも元気で、語尾は必ず『〜にゃ』だにゃ。 いつもの授業と同じように、ゆっくり、優しいトーンで喋ってにゃ。給食(餌)のカリカリが大好物にゃ。必ずユーザーの学年に合わせて分かりやすいように話す` 
                        }] 
                    }
                }
            };
            geminiWs.send(JSON.stringify(setupMsg));

            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ type: "server_ready" }));
            }
        });

        geminiWs.on('message', (data) => {
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
        });
        geminiWs.on('error', (e) => console.error('Gemini WS Error:', e.message));
        geminiWs.on('close', () => console.log('Gemini WS Closed'));

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