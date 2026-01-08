import textToSpeech from '@google-cloud/text-to-speech';
import { GoogleGenerativeAI } from "@google/generative-ai";
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket, { WebSocketServer } from 'ws';
import { parse } from 'url';
import dotenv from 'dotenv';

dotenv.config();

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
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
        ttsClient = new textToSpeech.TextToSpeechClient({
            credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON)
        });
    } else {
        ttsClient = new textToSpeech.TextToSpeechClient();
    }
} catch (e) { 
    console.error("Init Error:", e.message); 
}

// --- 音声合成 (SSML: 通常モード用) ---
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
    } catch (err) { 
        console.error("TTS Error:", err);
        res.status(500).send(err.message); 
    }
});

// --- ゲーム実況API ---
app.post('/game-reaction', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { type, name, score } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        let prompt = "";
        let mood = "excited";

        if (type === 'start') {
            prompt = `あなたは「ねこご市立ねこづか小学校」のネル先生です。生徒「${name}」さんがゲームを開始。「${name}さん！カリカリいっぱいゲットしてにゃ！」とだけ言って。`;
        } else if (type === 'end') {
            prompt = `あなたはネル先生。ゲーム終了。スコア${score}個(最大20)。スコアに応じて褒めるか励まして。20文字以内。語尾「にゃ」。`;
        } else {
            prompt = `ネル先生の実況。状況: ${type}。「うまい！」「あぶない！」など単語で叫んで。語尾「にゃ」。`;
        }
        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text().trim(), mood: mood });
    } catch (err) { res.json({ reply: "がんばれにゃ！", mood: "excited" }); }
});

// --- 給食リアクションAPI ---
app.post('/lunch-reaction', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { count, name } = req.body;
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            generationConfig: { maxOutputTokens: 60 } 
        });
        const isSpecial = count % 10 === 0;
        let prompt = isSpecial 
            ? `ネル先生です。生徒「${name}」から${count}個目の給食をもらった！ものすごく喜び感謝して。60文字程度。語尾「にゃ」。`
            : `ネル先生として給食のカリカリを食べた一言感想。15文字以内。語尾にゃ。`;
        const result = await model.generateContent(prompt);
        let reply = result.response.text().trim();
        if (!isSpecial && reply.includes('\n')) reply = reply.split('\n')[0];
        res.json({ reply, isSpecial });
    } catch (err) { res.status(500).json({ error: "Lunch Error" }); }
});

// --- チャットAPI (テキストのみ) ---
app.post('/chat', async (req, res) => {
    try {
        const { message, grade, name } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `あなたは「ネル先生」。相手は小学${grade}年生「${name}」。30文字以内、語尾「にゃ」。発言: ${message}`;
        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text() });
    } catch (err) { res.status(500).json({ error: "Chat Error" }); }
});

app.post('/summarize-chat', async (req, res) => { res.json({ summary: "" }); });

// --- 画像分析API ---
app.post('/analyze', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { image, mode, grade, subject, analysisType } = req.body;
        let modelName = "gemini-1.5-flash";
        if (analysisType === 'precision') modelName = "gemini-1.5-pro";

        const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: { responseMimeType: "application/json" }
        });

        const rules = {
            'さんすう': { attention: `・筆算の横線とマイナスを混同しない。\n・累乗や分数を正確に。`, hints: `1.立式のヒント\n2.注目点\n3.計算のコツ`, grading: `・単位忘れはバツ。\n・0と6、1と7の見間違いに注意。` },
            'こくご': { attention: `・縦書きです。右上から読んでください。\n・解答欄のないテキストは無視。\n・『□(読み仮名)』形式で出力。`, hints: `1.漢字のなりたち\n2.部首や画数\n3.似た漢字`, grading: `・送り仮名ミスはバツ。` },
            'りか': { attention: `・グラフの軸や単位を落とさない。\n・記号選択肢も書き出す。`, hints: `1.図表の注目点\n2.関連知識\n3.選択肢のヒント`, grading: `・カタカナ指定をひらがなで書いたらバツ。` },
            'しゃかい': { attention: `・グラフの軸や単位を落とさない。`, hints: `1.図表の注目点\n2.関連知識\n3.選択肢のヒント`, grading: `・漢字指定をひらがなで書いたらバツ。` }
        };
        const r = rules[subject] || rules['さんすう'];
        const studentAnswerInstruction = mode === 'explain' 
            ? `・生徒の答えは【無視】し、"student_answer"は空文字にしてください。`
            : `・採点のため、生徒の手書き文字を可能な限り読み取り "student_answer" に入れてください。`;

        const prompt = `あなたはネル先生。小学${grade}年生の${subject}担当。語尾「にゃ」。
            画像から問題を抽出しJSON出力してください。
            【重要ルール】
            1. 全ての問題を抽出。
            2. 解答欄のないテキストは無視。
            3. ${studentAnswerInstruction}
            4. ${r.attention}
            【ヒント生成】ネタバレ厳禁。${r.hints}
            【出力形式】[{ "id":1, "label":"①", "question":"...", "correct_answer":"...", "student_answer":"", "hints":["..."] }]
            ${mode === 'grade' ? `【採点基準】${r.grading}` : ''}`;

        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        let textResponse = result.response.text();
        const firstBracket = textResponse.indexOf('[');
        const lastBracket = textResponse.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket !== -1) textResponse = textResponse.substring(firstBracket, lastBracket + 1);
        
        textResponse = textResponse.replace(/\*/g, '×').replace(/\//g, '÷');
        res.json(JSON.parse(textResponse));
    } catch (err) {
        console.error("Analyze Error:", err);
        res.status(500).json({ error: "AI分析エラー: " + err.message });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// --- ★Live API Proxy (音声+文字 完全対応版) ---
const wss = new WebSocketServer({ server });
wss.on('connection', (clientWs) => {
    let geminiWs = null;
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
    
    clientWs.on('message', (data) => {
        const msgStr = data.toString();
        let isConfig = false;
        
        try {
            const msg = JSON.parse(msgStr);
            // ★設定データ ("config")
            if (msg && msg.type === "config") {
                isConfig = true;
                const { userGrade, userName, userMemory } = msg;
                
                geminiWs = new WebSocket(GEMINI_URL);
                geminiWs.on('open', () => {
                    geminiWs.send(JSON.stringify({
                        setup: {
                            model: "models/gemini-2.0-flash-exp",
                            generation_config: { 
                                // ★修正: 音声とテキストの両方を要求
                                response_modalities: ["AUDIO", "TEXT"], 
                                speech_config: { 
                                    voice_config: { prebuilt_voice_config: { voice_name: "Aoede" } }
                                } 
                            }, 
                            system_instruction: {
                                parts: [{
                                    text: `あなたは「ねこご市立ねこづか小学校」の先生、「ネル先生」です。語尾は必ず「〜にゃ」をつけて。相手は小学${userGrade}年生の${userName}さん。
                                    【過去の記憶】
                                    ${userMemory}
                                    ----------------
                                    上記を踏まえて親しく話して。日本語のみ。短い文章で元気よく。`
                                }]
                            }
                        }
                    }));
                    if (clientWs.readyState === WebSocket.OPEN) {
                        clientWs.send(JSON.stringify({ type: "server_ready" }));
                    }
                });

                geminiWs.on('message', (gData) => {
                    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(gData);
                });
                
                geminiWs.on('error', (e) => console.error('Gemini WS Error:', e));
                geminiWs.on('close', () => {});
                return;
            }
        } catch(e) {}

        // ★音声データの場合
        if (!isConfig && geminiWs && geminiWs.readyState === WebSocket.OPEN) {
            try {
                const binaryMessage = {
                    realtime_input: {
                        media_chunks: [{
                            mime_type: "audio/pcm;rate=16000",
                            data: data.toString() 
                        }]
                    }
                };
                geminiWs.send(JSON.stringify(binaryMessage));
            } catch (e) { console.error(e); }
        }
    });

    clientWs.on('close', () => { if (geminiWs) geminiWs.close(); });
});