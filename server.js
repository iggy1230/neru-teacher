// --- server.js (完全版 v74.0: ヒントの答えバレ防止・書き起こし強化) ---

import textToSpeech from '@google-cloud/text-to-speech';
import { GoogleGenerativeAI } from "@google/generative-ai";
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket, { WebSocketServer } from 'ws';
import { parse } from 'url';
import dotenv from 'dotenv';
import fs from 'fs/promises';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '.')));

const MEMORY_FILE = path.join(__dirname, 'server_log.json');

async function initMemoryFile() {
    try { await fs.access(MEMORY_FILE); } 
    catch { await fs.writeFile(MEMORY_FILE, JSON.stringify({})); }
}
initMemoryFile();

async function appendToServerLog(name, text) {
    try {
        const data = JSON.parse(await fs.readFile(MEMORY_FILE, 'utf8'));
        const timestamp = new Date().toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        const newLog = `[${timestamp}] ${text}`;
        let currentLogs = data[name] || [];
        currentLogs.push(newLog);
        if (currentLogs.length > 50) currentLogs = currentLogs.slice(-50);
        data[name] = currentLogs;
        await fs.writeFile(MEMORY_FILE, JSON.stringify(data, null, 2));
    } catch (e) {}
}

let genAI, ttsClient;
try {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
        ttsClient = new textToSpeech.TextToSpeechClient({ credentials });
    } else {
        ttsClient = new textToSpeech.TextToSpeechClient();
    }
} catch (e) { }

// --- API ---

app.post('/detect-document', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: "No image" });
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp", generationConfig: { responseMimeType: "application/json" } });
        const prompt = `画像内にある「メインの書類」の四隅の座標を検出してください。JSON形式 {"points": [{"x":.., "y":..}, ...]} (TL, TR, BR, BLの順, 0-100%)`;
        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        let text = result.response.text();
        const match = text.match(/\{[\s\S]*\}/);
        if (match) text = match[0];
        res.json(JSON.parse(text));
    } catch (e) { res.json({ points: [{x:5,y:5}, {x:95,y:5}, {x:95,y:95}, {x:5,y:95}] }); }
});

function createSSML(text, mood) {
    let rate = "1.1"; let pitch = "+2st";
    if (mood === "thinking") { rate = "1.0"; pitch = "0st"; }
    if (mood === "gentle") { rate = "0.95"; pitch = "+1st"; }
    if (mood === "excited") { rate = "1.2"; pitch = "+4st"; }
    let cleanText = text.replace(/[\u{1F600}-\u{1F6FF}]/gu, '').replace(/[<>"']/g, ' ').replace(/^[・-]\s*/gm, '').replace(/……/g, '<break time="500ms"/>');
    cleanText = cleanText.replace(/私は/g, 'わたしわ').replace(/ユーザーは/g, 'ユーザーわ').replace(/次/g, 'つぎ').replace(/内/g, 'ない').replace(/＋/g, 'たす').replace(/－/g, 'ひく').replace(/×/g, 'かける').replace(/÷/g, 'わる').replace(/＝/g, 'わ').replace(/□/g, 'しかく');
    if (cleanText.length < 5) return `<speak>${cleanText}</speak>`;
    return `<speak><prosody rate="${rate}" pitch="${pitch}">${cleanText}</prosody></speak>`;
}

app.post('/synthesize', async (req, res) => {
    try {
        if (!ttsClient) throw new Error("TTS Not Ready");
        const { text, mood } = req.body;
        const [response] = await ttsClient.synthesizeSpeech({
            input: { ssml: createSSML(text, mood) },
            voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' },
            audioConfig: { audioEncoding: 'MP3' },
        });
        res.json({ audioContent: response.audioContent.toString('base64') });
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/game-reaction', async (req, res) => {
    try {
        const { type, name, score } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        let prompt = `ネル先生の実況。状況: ${type}。「うまい！」「すごい！」など一言だけ。語尾「にゃ」。`;
        if (type === 'start') prompt = `あなたはネル先生。生徒「${name}」がゲーム開始。「${name}さん！カリカリいっぱいゲットしてにゃ！」とだけ言って。`;
        else if (type === 'end') {
            await appendToServerLog(name, `ゲーム終了。スコア${score}点。`);
            prompt = `あなたはネル先生。ゲーム終了。スコア${score}個(最大20)。褒めるか励まして。20文字以内。語尾「にゃ」。`;
        }
        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text().trim(), mood: "excited" });
    } catch (err) { res.json({ reply: "がんばれにゃ！", mood: "excited" }); }
});

app.post('/lunch-reaction', async (req, res) => {
    try {
        const { count, name } = req.body;
        await appendToServerLog(name, `給食をくれた(${count}個目)。`);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp", generationConfig: { maxOutputTokens: 100 } });
        let prompt = "";
        if (count % 10 === 0) {
            prompt = `ネル先生です。生徒「${name}」さんから${count}個目の給食をもらいました！必ず「${name}さん」と呼んで。カリカリへの愛と感謝を熱く語って。語尾「にゃ」。60文字。`;
        } else {
            const themes = ["カリカリの歯ごたえ", "魚の風味", "満腹感", "幸せ", "感謝", "今日のカリカリは格別", "カリカリの音", "カリカリの形"];
            const theme = themes[Math.floor(Math.random() * themes.length)];
            prompt = `あなたはネル先生です。生徒「${name}」さんから給食をもらいました。【絶対ルール】1. 必ず「${name}さん」と呼んでください（呼び捨て厳禁）。2. テーマ「${theme}」について、15文字以内の一言で感想を言ってください。3. 語尾は「にゃ」。`;
        }
        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text().trim(), isSpecial: count % 10 === 0 });
    } catch (err) { res.status(500).json({ error: "Lunch Error" }); }
});

app.post('/summarize-notes', async (req, res) => {
    try {
        const { text } = req.body;
        if (!text || text.length < 2) return res.json({ notes: [] });
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        const prompt = `以下は先生と生徒の会話ログです。次回以降の指導や関係づくりに使える情報をJSON配列にしてください。【絶対ルール】1. 「〜が好き」「〜が嫌い」「〜が得意/苦手」「趣味は〜」という記述があれば必ず抽出。2. 挨拶は除外。3. 最大3つ。4. 出力はJSON配列形式 ["サッカーが好き", "算数が不安"] のみ。ログ：${text.slice(-3000)}`;
        const result = await model.generateContent(prompt);
        let responseText = result.response.text().trim();
        const firstBracket = responseText.indexOf('[');
        const lastBracket = responseText.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket !== -1) {
            res.json({ notes: JSON.parse(responseText.substring(firstBracket, lastBracket + 1)) });
        } else { res.json({ notes: [] }); }
    } catch (e) { res.json({ notes: [] }); }
});

// --- 6. 問題分析・採点 (書き起こし・ヒント強化) ---
app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject, analysisType } = req.body;
        let modelName = analysisType === 'precision' ? "gemini-2.5-pro" : "gemini-2.0-flash-exp";
        const model = genAI.getGenerativeModel({ model: modelName, generationConfig: { responseMimeType: "application/json" } });

        // 教科別詳細ルール (★ヒントの答えバレ防止強化)
        const rules = {
            'さんすう': {
                points: `・筆算の横線とマイナス記号を混同しないこと。\n・累乗（2^2など）や分数を正確に。`,
                hints: `
                  • ヒント1（立式）: 「何算を使えばいいか」のヒント（例：全部でいくつ？と聞かれているから足し算にゃ）。
                  • ヒント2（注目点）: 「単位のひっかけ」や「図の数値」への誘導（例：cmをmに直すのを忘れてないかにゃ？）。
                  • ヒント3（計算のコツ）: 「計算の工夫」や「最終確認」（例：一の位から順番に計算してみるにゃ）。`,
                grading: `・筆算の繰り上がりを見間違えない。単位がないものはバツ。数字の0と6、1と7の見間違いに注意。`
            },
            'こくご': {
                points: `
                  ・国語の問題は縦書きが多い。縦書きの場合は右から左へ読むこと。
                  ・漢字の書き取り問題では、答えとなる空欄を『□(ふりがな)』という形式で、ふりがなを漏らさず正確に書き起こしてください。
                  ・□の横に小さく書いてある文字が(ふりがな)。□の中の漢字を答える問題である。
                  ・読解問題の長い文章本文は書き起こししない。`,
                hints: `
                  ・【重要】漢字書き取り問題のヒントでは、その漢字自体（答えの文字）を絶対に使わないでください。「その漢字」や「答えの字」と言い換えてください。
                  ・ヒント1: 「漢字のなりたち」を教える（例：木へんに...）
                  ・ヒント2: 「辺やつくりや画数」を教える
                  ・ヒント3: 「似た漢字」や「熟語」を教える
                  ・読解問題の場合 ヒント1（場所）: 「答えがどこにあるか」を教える
                  ・読解問題の場合 ヒント2（キーワード）: 「注目すべき言葉」を教える
                  ・読解問題の場合 ヒント3（答え方）: 「語尾の指定」など`,
                grading: `・送り仮名ミスはバツ。文末表現（〜こと、〜から等）もチェック。`
            },
            'りか': {
                points: `・グラフの軸ラベルや単位（g, cm, ℃など）を落とさないこと。\n・記号選択問題の選択肢も書き出すこと。\n・最初の問題が図や表と似た位置にある場合があるので見逃さないこと。`,
                hints: `
                  • ヒント1（観察）: 「図や表のどこを見るか」（例：グラフが急に上がっているところを探してみてにゃ）。
                  • ヒント2（関連知識）: 「習った言葉の想起」（例：この実験で使った、あの青い液体の名前は何だったかにゃ？）。
                  • ヒント3（絞り込み）: 「選択肢のヒント」や「最初の1文字」（例：『平』から始まる4文字の時代にゃ）。`,
                grading: `・カタカナ指定をひらがなで書いたらバツ。グラフ描画は厳しく。`
            },
            'しゃかい': {
                points: `・グラフの軸ラベルや単位を落とさないこと。\n・記号選択問題の選択肢も書き出すこと。\n・最初の問題が図や表と似た位置にある場合があるので見逃さないこと。`,
                hints: `
                  • ヒント1（観察）: 「図や表のどこを見るか」（例：グラフが急に上がっているところを探してみてにゃ）。
                  • ヒント2（関連知識）: 「習った言葉の想起」（例：この実験で使った、あの青い液体の名前は何だったかにゃ？）。
                  • ヒント3（絞り込み）: 「選択肢のヒント」や「最初の1文字」（例：『平』から始まる4文字の時代にゃ）。`,
                grading: `・漢字指定をひらがなで書いたらバツ。時代背景の混同に注意。`
            }
        };
        const r = rules[subject] || rules['さんすう'];
        
        let instruction = mode === 'explain' 
            ? `・「教えて」モード。画像内の手書き文字（生徒の答え）は【完全に無視】し、"student_answer" は空文字 "" にする。` 
            : `・「採点」モード。「手書き文字」への意識を強化。子供の筆跡を考慮し、生徒の答えを "student_answer" に入れる。採点基準: ${r.grading}`;

        const prompt = `
            あなたは「ねこご市立ねこづか小学校」のネル先生（小学${grade}年生${subject}担当）です。語尾は「にゃ」。
            画像の問題をJSONデータにしてください。
            
            【書き起こしルール】
            1. 大問、小問の数字や項目名は可能な限り書き起こす。
            2. ${r.points}
            3. ${instruction}

            【ヒント生成ルール（絶対遵守）】
            1. **絶対に答えそのもの（正解の漢字や用語、数値）は書かないこと。** 答えを書いてしまうと勉強になりません。
            2. 正答を導き出した上で、以下の3段階のヒントを作成してください。
            ${r.hints}

            出力JSON: [{ "id": 1, "label": "①", "question": "...", "correct_answer": "...", "student_answer": "...", "hints": ["ヒント1", "ヒント2", "ヒント3"] }]
        `;

        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        let text = result.response.text();
        const firstBracket = text.indexOf('[');
        const lastBracket = text.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket !== -1) {
            const json = JSON.parse(text.substring(firstBracket, lastBracket + 1));
            if (json.length > 0) await appendToServerLog("SYSTEM", `分析実行: ${subject}`);
            res.json(json);
        } else { throw new Error("データ形式がおかしいにゃ…"); }
    } catch (err) { res.status(500).json({ error: "AI読み取りエラー: " + err.message }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

const wss = new WebSocketServer({ server });

wss.on('connection', async (clientWs, req) => {
    const params = parse(req.url, true).query;
    const grade = params.grade || "1";
    const name = decodeURIComponent(params.name || "生徒");
    const statusContext = decodeURIComponent(params.status || "特になし");

    let geminiWs = null;
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
    
    try {
        geminiWs = new WebSocket(GEMINI_URL);
        
        geminiWs.on('open', () => {
            const setupMsg = {
                setup: {
                    model: "models/gemini-2.0-flash-exp",
                    generationConfig: { 
                        responseModalities: ["AUDIO"], 
                        speech_config: { voice_config: { prebuilt_voice_config: { voice_name: "Aoede" } }, language_code: "ja-JP" } 
                    }, 
                    systemInstruction: {
                        parts: [{
                            text: `
                            あなたは「ねこご市立、ねこづか小学校」のネル先生だにゃ。相手は小学${grade}年生の${name}さん。
                            語尾は「にゃ」。親しみやすく。
                            【NG】ロボットみたいな区切り、早口。
                            【重要：今の状況と記憶（これを踏まえて話して！）】
                            ${statusContext}
                            【ルール】
                            相手が好きなものや新しいことは「〇〇が好きなんだにゃ！覚えたにゃ！」と復唱して。
                            `
                        }]
                    }
                }
            };
            geminiWs.send(JSON.stringify(setupMsg));
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify({ type: "server_ready" }));
        });

        clientWs.on('message', async (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.base64Audio && geminiWs.readyState === WebSocket.OPEN) {
                     geminiWs.send(JSON.stringify({ realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: msg.base64Audio }] } }));
                }
                if (msg.type === 'log_text') await appendToServerLog(name, `発言: ${msg.text}`);
            } catch (e) { }
        });

        geminiWs.on('message', (data) => { if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data); });
        geminiWs.on('close', () => {});
        geminiWs.on('error', (e) => console.error("Gemini Error:", e));

    } catch (e) { clientWs.close(); }
    clientWs.on('close', () => { if (geminiWs) geminiWs.close(); });
});