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

// --- 文書検出API (精度向上版) ---
app.post('/detect-document', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: "No image" });

        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash-exp", 
            generationConfig: { responseMimeType: "application/json" }
        });

        const prompt = `
        画像内にある「メインの書類（ノート、プリント、教科書）」の領域を特定し、四隅の座標を出力してください。
        
        【重要ルール】
        1. 画像全体ではなく、写っている「紙」の輪郭を探してください。
        2. 背景（机や床）を除外し、紙の角（コーナー）を特定してください。
        3. もし紙がはみ出している場合は、画像の四隅（0,0 / 100,0 / 100,100 / 0,100）を選択してください。
        
        【出力形式 (JSONのみ)】
        {
          "points": [
            { "x": 左上のXパーセント(0-100), "y": 左上のYパーセント(0-100) },
            { "x": 右上のXパーセント, "y": 右上のYパーセント },
            { "x": 右下のXパーセント, "y": 右下のYパーセント },
            { "x": 左下のXパーセント, "y": 左下のYパーセント }
          ]
        }
        `;

        const result = await model.generateContent([
            { inlineData: { mime_type: "image/jpeg", data: image } },
            { text: prompt }
        ]);

        let text = result.response.text();
        // JSONブロックの抽出を強化
        const match = text.match(/\{[\s\S]*\}/);
        if (match) text = match[0];

        const json = JSON.parse(text);
        res.json(json);
    } catch (e) {
        console.error("Detect Error:", e);
        // エラー時はデフォルト（全体）を返す
        res.json({ points: [{x:0,y:0}, {x:100,y:0}, {x:100,y:100}, {x:0,y:100}] });
    }
});

function createSSML(text, mood) {
    let rate = "1.1", pitch = "+2st";
    if (mood === "thinking") { rate = "1.0"; pitch = "0st"; }
    if (mood === "gentle") { rate = "0.95"; pitch = "+1st"; }
    if (mood === "excited") { rate = "1.2"; pitch = "+4st"; }

    let cleanText = text
        .replace(/[\u{1F600}-\u{1F6FF}]/gu, '')
        .replace(/🐾|✨|⭐|🎵|🐟|🎤|⭕️|❌/g, '')
        .replace(/&/g, 'と').replace(/[<>"']/g, ' ');

    // 箇条書き記号などを削除
    cleanText = cleanText.replace(/^[・-]\s*/gm, '');

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

// --- ゲーム実況API (修正版: 候補羅列防止) ---
app.post('/game-reaction', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { type, name, score } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        let prompt = "";
        let mood = "excited";
        
        if (type === 'start') {
            prompt = `あなたはネル先生。生徒「${name}」がゲーム開始。「${name}さん！カリカリいっぱいゲットしてにゃ！」とだけ言って。余計な言葉は不要。`;
        } else if (type === 'end') {
            prompt = `あなたはネル先生。ゲーム終了。スコア${score}個(最大20)。スコアに応じて褒めるか励ます言葉を【1つだけ】出力して。20文字以内。語尾「にゃ」。候補を羅列しないでください。`;
        } else {
            prompt = `ネル先生の実況。状況: ${type}。「うまい！」「すごい！」など5文字程度の一言だけ。語尾「にゃ」。`;
        }
        
        const result = await model.generateContent(prompt);
        let reply = result.response.text().trim();
        // 改行が含まれていたら1行目だけを使う（念のため）
        if (reply.includes('\n')) reply = reply.split('\n')[0];
        
        res.json({ reply, mood });
    } catch (err) {
        res.json({ reply: "がんばれにゃ！", mood: "excited" });
    }
});

app.post('/lunch-reaction', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { count, name } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp", generationConfig: { maxOutputTokens: 60 } });
        let prompt = "";
        const isSpecial = count % 10 === 0;
        if (isSpecial) {
            prompt = `あなたはネル先生。生徒「${name}」から記念すべき${count}個目の給食をもらった。感謝を60文字程度で熱く語って。語尾は「にゃ」。`;
        } else {
            prompt = `ネル先生として給食のカリカリを食べた一言感想。15文字以内。語尾にゃ。`;
        }
        const result = await model.generateContent(prompt);
        let reply = result.response.text().trim();
        if (!isSpecial && reply.includes('\n')) reply = reply.split('\n')[0];
        res.json({ reply, isSpecial });
    } catch (err) { res.status(500).json({ error: "Lunch Error" }); }
});

app.post('/chat', async (req, res) => {
    try {
        const { message, grade, name } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        const prompt = `あなたは「ネル先生」。相手は小学${grade}年生「${name}」。30文字以内、語尾「にゃ」。絵文字禁止。発言: ${message}`;
        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text() });
    } catch (err) { res.status(500).json({ error: "Chat Error" }); }
});

app.post('/analyze', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { image, mode, grade, subject, analysisType } = req.body;
        
        let modelName = "gemini-2.0-flash-exp"; 
        if (analysisType === 'precision') modelName = "gemini-1.5-pro"; 

        const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: { responseMimeType: "application/json" }
        });

        const rules = {
            'さんすう': { attention: `・筆算の横線とマイナス記号を混同しない。\n・累乗や分数を正確に。`, hints: `1.立式のヒント 2.単位や図のヒント 3.計算のコツ`, grading: `・筆算の繰り上がりを答えと見間違えない。\n・単位忘れはバツ。\n・0と6、1と7の見間違いに注意。` },
            'こくご': { attention: `・縦書きです。右上から読んでください。\n・解答欄（□）は『□(読み仮名)』形式で。`, hints: `1.漢字のなりたち 2.注目すべき言葉 3.文末の指定`, grading: `・送り仮名ミスはバツ。\n・文末（〜こと）が合っているかチェック。` },
            'りか': { attention: `・グラフの軸ラベルや単位を落とさない。\n・選択肢も書き出す。`, hints: `1.図表の見方 2.関連知識 3.選択肢の絞り込み`, grading: `・カタカナ指定をひらがなで書いたらバツ。` },
            'しゃかい': { attention: `・地図記号や年表を正確に読み取る。`, hints: `1.資料の注目点 2.時代の背景 3.キーワード`, grading: `・漢字指定をひらがなで書いたらバツ。` }
        };
        const r = rules[subject] || rules['さんすう'];
        const studentAnswerInstruction = mode === 'explain' 
            ? `・画像内の手書き文字（生徒の答え）は【完全に無視】してください。\n・"student_answer" は空文字 "" にしてください。`
            : `・生徒の手書き文字を可能な限り読み取り "student_answer" に入れてください。`;

        const prompt = `
            あなたは「ねこご市立ねこづか小学校」のネル先生（小学${grade}年生${subject}担当）です。語尾は「にゃ」。
            【タスク】提供された画像を分析し、問題をJSONデータとして出力してください。
            【ルール】
            1. 全ての問題を抽出。
            2. 「解答欄」がないテキストは問題として扱わない。
            3. ${studentAnswerInstruction}
            4. 教科別注意: ${r.attention}
            【ヒント生成 (答えネタバレ厳禁)】${r.hints}
            【出力JSON形式】
            [{"id": 1, "label": "①", "question": "問題文", "correct_answer": "正解", "student_answer": "", "hints": ["ヒント1", "ヒント2", "ヒント3"]}]
            ${mode === 'grade' ? `【採点基準】\n${r.grading}` : ''}
        `;

        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        let textResponse = result.response.text();
        const firstBracket = textResponse.indexOf('[');
        const lastBracket = textResponse.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket !== -1) textResponse = textResponse.substring(firstBracket, lastBracket + 1);
        textResponse = textResponse.replace(/\*/g, '×').replace(/\//g, '÷');
        res.json(JSON.parse(textResponse));
    } catch (err) {
        console.error("Analyze Error Details:", err);
        res.status(500).json({ error: "AI分析エラー: " + err.message });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

const wss = new WebSocketServer({ server });
wss.on('connection', (clientWs, req) => {
    const params = parse(req.url, true).query;
    const grade = params.grade || "1";
    const name = decodeURIComponent(params.name || "");
    const memory = decodeURIComponent(params.memory || "まだ会話していない");

    let geminiWs = null;
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
    
    try {
        geminiWs = new WebSocket(GEMINI_URL);
        geminiWs.on('open', () => {
            geminiWs.send(JSON.stringify({
                setup: {
                    model: "models/gemini-2.0-flash-exp",
                    generation_config: { 
                        response_modalities: ["AUDIO"], 
                        speech_config: { voice_config: { prebuilt_voice_config: { voice_name: "Aoede" } }, language_code: "ja-JP" } 
                    }, 
                    system_instruction: {
                        parts: [{
                            text: `あなたはネル先生。語尾は「〜にゃ」。相手は小学${grade}年生の${name}さん。
                            【記憶】${memory}
                            短い言葉で明るく話して。`
                        }]
                    }
                }
            }));
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify({ type: "server_ready" }));
        });
        clientWs.on('message', (data) => {
            if (geminiWs.readyState === WebSocket.OPEN) {
                geminiWs.send(JSON.stringify({ realtime_input: { media_chunks: [{ mime_type: "audio/pcm;rate=16000", data: data.toString() }] } }));
            }
        });
        geminiWs.on('message', (data) => { if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data); });
        geminiWs.on('close', () => {});
    } catch (e) { clientWs.close(); }
    clientWs.on('close', () => { if (geminiWs) geminiWs.close(); });
});