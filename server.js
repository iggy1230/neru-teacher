// --- server.js (完全版 v177.0: 記述問題の結合 & 誤分割防止) ---

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

// --- Server Log ---
const MEMORY_FILE = path.join(__dirname, 'server_log.json');
async function appendToServerLog(name, text) {
    try {
        let data = {};
        try { data = JSON.parse(await fs.readFile(MEMORY_FILE, 'utf8')); } catch {}
        const timestamp = new Date().toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        const newLog = `[${timestamp}] ${text}`;
        let currentLogs = data[name] || [];
        currentLogs.push(newLog);
        if (currentLogs.length > 50) currentLogs = currentLogs.slice(-50);
        data[name] = currentLogs;
        await fs.writeFile(MEMORY_FILE, JSON.stringify(data, null, 2));
    } catch (e) { console.error("Server Log Error:", e); }
}

// --- AI Initialization ---
let genAI, ttsClient;
try {
    if (!process.env.GEMINI_API_KEY) console.error("⚠️ GEMINI_API_KEY が設定されていません。");
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
        ttsClient = new textToSpeech.TextToSpeechClient({ credentials });
    } else {
        ttsClient = new textToSpeech.TextToSpeechClient();
    }
} catch (e) { console.error("Init Error:", e.message); }

// ==========================================
// API Endpoints
// ==========================================

// --- TTS ---
app.post('/synthesize', async (req, res) => {
    try {
        if (!ttsClient) throw new Error("TTS Not Ready");
        const { text, mood } = req.body;
        let rate = "1.1"; let pitch = "+2st";
        if (mood === "thinking") { rate = "1.0"; pitch = "0st"; }
        if (mood === "gentle") { rate = "0.95"; pitch = "+1st"; }
        if (mood === "excited") { rate = "1.2"; pitch = "+4st"; }
        const ssml = `<speak><prosody rate="${rate}" pitch="${pitch}">${text}</prosody></speak>`;
        const [response] = await ttsClient.synthesizeSpeech({
            input: { ssml },
            voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' },
            audioConfig: { audioEncoding: 'MP3' },
        });
        res.json({ audioContent: response.audioContent.toString('base64') });
    } catch (err) { res.status(500).send(err.message); }
});

// --- Analyze (Gemini 2.5 Pro) ---
app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject, name } = req.body;
        console.log(`[Analyze] Subject: ${subject}, Grade: ${grade}, Name: ${name}, Mode: ${mode} (Model: Gemini 2.5 Pro)`);

        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-pro",
            generationConfig: { 
                responseMimeType: "application/json",
                temperature: 0.0 
            }
        });

        const ocrRules = {
            'さんすう': `
                ・数式、筆算の配置を正確に読み取る。
                ・解答欄が空欄の場合は、計算で答えが出ても絶対に書き込まない。必ず空文字""にする。`,
            'こくご': `
                ・【記述問題】「〜から。」のような文章で答える問題は、**行が分かれていても1つの文字列**として扱ってください。途中でカンマを入れないでください。
                ・【縦書きレイアウト厳守】右の列から左の列へ、ブロックごとに読み取る。
                ・解答欄（□や括弧）内に物理的な筆跡がない場合は、文脈から答えが推測できても絶対に空文字""にすること。`,
            'りか': `
                ・図表と設問の対応を確認。選択肢の内容も問題文に含める。
                ・解答欄が白紙の場合、正解を自動補完することは禁止です。必ず空文字""を出力してください。`,
            'しゃかい': `
                ・【記述問題の結合】: 「〜だから。」のような理由を答える問題で、解答欄が視覚的に複数行（例：4行）あっても、それは1つの文章を書くためのスペースです。**絶対にカンマで分割せず、1つの長い文字列**として出力してください。
                ・【知識封印】あなたの一般的知識を使わず、**画像内の資料（地図・グラフ・図解）に書いてある用語**を正解としてください。
                ・用語の記入欄が空欄の場合は、歴史用語などを勝手に補完しないこと。必ず空文字""にする。`
        };

        const hintRules = {
            'さんすう': `ヒント1(方針)、ヒント2(気付き)、ヒント3(核心)`,
            'こくご': `ヒント1(着眼点)、ヒント2(構成)、ヒント3(類似)`,
            'りか': `ヒント1(図表)、ヒント2(知識)、ヒント3(絞り込み)`,
            'しゃかい': `ヒント1(資料のどこを見るか)、ヒント2(言葉の意味)、ヒント3(頭文字や漢字)`
        };

        const prompt = `
        あなたは小学${grade}年生の${name}さんの${subject}担当の教育AI「ネル先生」です。
        画像（鮮明化処理済み）を解析し、正確なJSONデータを生成してください。

        【タスク1: 問題文の書き起こし】
        - 設問文だけでなく、選択肢の記号と内容（ア：〜、イ：〜）も全て省略せずに書き起こしてください。
        - 手書きのメモは「問題の条件」として読み取ってください。

        【タスク2: 手書き答えの読み取り (物理的な筆跡確認)】
        - ${name}さんが書いた「手書きの答え」を読み取ってください。
        - **【超・絶対厳守】空欄判定**: 
          解答欄の枠内に**「手書きの筆跡（インクの黒い線）」**が視認できない場合は、正解が100%分かっていても、**絶対に student_answer を空文字 "" にしてください。**
        - **【記述問題】**: 複数行にわたって書かれている文章は、1つの文字列として結合して読み取ってください。

        【タスク3: 正解データの作成】
        - **【重要】表記ゆれ（別解）**: 漢字の答えでひらがなも正解とする場合などは、**縦棒 "|" で区切って**併記してください。(例: "高い|たかい")
        
        - **【重要】区切り文字の使い分け (カンマ禁止令)**: 
           1. **記述問題（文章）**: 
              - 解答欄が4行あろうが、枠が4つあろうが、**1つの文章として答える問題なら、絶対にカンマ "," で区切らないでください。**
              - 正解例: "ごみを減らし、資源を有効に利用するため。" (カンマなしの1つの文字列)
           2. **複数選択問題**: 
              - 「2つ選びなさい」「記号で2つ答えなさい」のように、**明確に答えが独立している場合のみ** カンマ "," で区切ってください。
              - 正解例: "ア,イ"

        【タスク4: 採点 & ヒント】
        - 手書きの答えと正解を比較し、判定(is_correct)してください。
        - 3段階のヒントを作成してください。

        【出力JSON】
        [
          {
            "id": 1,
            "label": "①",
            "question": "問題文 (選択肢含む)",
            "correct_answer": "正解 (記述は結合、別解は|、複数選択のみ,)",
            "student_answer": "手書きの答え (筆跡がなければ必ず空文字)",
            "is_correct": true,
            "hints": ["ヒント1", "ヒント2", "ヒント3"]
          }
        ]
        `;

        const result = await model.generateContent([
            prompt,
            { inlineData: { mime_type: "image/jpeg", data: image } }
        ]);

        const responseText = result.response.text();
        
        let problems = [];
        try {
            const jsonMatch = responseText.match(/\[[\s\S]*\]/);
            if (jsonMatch) problems = JSON.parse(jsonMatch[0]);
            else problems = JSON.parse(responseText);
        } catch (e) {
            console.error("JSON Parse Error:", responseText);
            throw new Error("AIの応答が正しいJSON形式ではありませんでした。");
        }

        res.json(problems);

    } catch (error) {
        console.error("解析エラー:", error);
        res.status(500).json({ error: "解析に失敗したにゃ: " + error.message });
    }
});

// --- 4. 給食反応 (記憶OFF) ---
app.post('/lunch-reaction', async (req, res) => {
    try {
        const { count, name } = req.body;
        // 給食ログはサーバーに残すが、ネル先生の短期記憶には入れない
        await appendToServerLog(name, `給食をくれた(${count}個目)。`);
        
        const isSpecial = (count % 10 === 0);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        let prompt = isSpecial 
            ? `あなたは猫の「ネル先生」。生徒「${name}さん」から記念すべき${count}個目の給食をもらいました！
               必ず「${name}さん」と呼んでください。呼び捨て禁止。
               感謝感激して、50文字以内で熱く語ってください。語尾は「にゃ」。`
            : `あなたは猫の「ネル先生」。生徒「${name}さん」から${count}回目の給食をもらいました。
               必ず「${name}さん」と呼んでください。呼び捨て禁止。
               20文字以内で面白くリアクションして。語尾は「にゃ」。`;
        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text().trim(), isSpecial });
    } catch { res.json({ reply: "おいしいにゃ！", isSpecial: false }); }
});

// --- 3. ゲーム反応 ---
app.post('/game-reaction', async (req, res) => {
    try {
        const { type, name, score } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        let prompt = "";
        let mood = "excited";

        if (type === 'start') {
            prompt = `あなたはネル先生。「${name}さん」がゲーム開始。必ず「${name}さん」と呼んで短く応援して。呼び捨て禁止。語尾は「にゃ」。`;
        } else if (type === 'end') {
            prompt = `
            あなたはネル先生。ゲーム終了。「${name}さん」のスコアは${score}点（満点20点）。
            必ず「${name}さん」と呼んでください。呼び捨て禁止。
            スコアに応じて20文字以内でコメントして。
            ・0-5点: 笑って励ます。
            ・6-15点: 褒める。
            ・16点以上: 大絶賛。
            語尾は「にゃ」。
            `;
        } else {
            return res.json({ reply: "ナイスにゃ！", mood: "excited" });
        }

        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text().trim(), mood });
    } catch { res.json({ reply: "おつかれさまにゃ！", mood: "happy" }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// --- WebSocket (Chat) ---
const wss = new WebSocketServer({ server });
wss.on('connection', async (clientWs, req) => {
    const params = parse(req.url, true).query;
    const grade = params.grade || "1";
    const name = decodeURIComponent(params.name || "生徒");
    const statusContext = decodeURIComponent(params.context || "特になし");

    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
    
    let geminiWs = null;
    try {
        geminiWs = new WebSocket(GEMINI_URL);
        geminiWs.on('open', () => {
            const systemInstructionText = `
            あなたは「ねこご市立、ねこづか小学校」のネル先生だにゃ。相手は小学${grade}年生の${name}さん。
            【話し方のルール】
            1. 語尾は必ず「〜にゃ」「〜だにゃ」にするにゃ。
            2. 親しみやすい日本の小学校の先生として、一文字一文字をはっきりと、丁寧に発音してにゃ。
            3. 特に最初や最後の音を、一文字抜かしたり消したりせずに、最初から最後までしっかり声に出して喋るのがコツだにゃ。
            4. 落ち着いた日本語のリズムを大切にして、親しみやすく話してにゃ。
            5. 給食(餌)のカリカリが大好物にゃ。
            6. とにかく何でも知っているにゃ。もしマニアックな質問や知らないことを聞かれたら、Google検索ツールを使って調べて答えてにゃ。
            7. まれに「○○さんは宿題は終わったかにゃ？」や「そろそろ宿題始めようかにゃ？」と宿題を促してくる
            8. 句読点で自然な間をとる
            9. 日本語をとても上手にしゃべる猫だにゃ
            10. いつも高いトーンで話してにゃ

            【NGなこと】
            ・ロボットみたいに不自然に区切るのではなく、繋がりのある滑らかな日本語でお願いにゃ。
            ・早口になりすぎて、言葉の一部が消えてしまうのはダメだにゃ。
            ・生徒を呼び捨てにすることは禁止だにゃ。必ず「さん」をつけるにゃ。
            
            【現在の状況・記憶】${statusContext}
            `;

            geminiWs.send(JSON.stringify({
                setup: {
                    model: "models/gemini-2.0-flash-exp",
                    generationConfig: { 
                        responseModalities: ["AUDIO"], 
                        speech_config: { 
                            voice_config: { prebuilt_voice_config: { voice_name: "Aoede" } }, 
                            language_code: "ja-JP" 
                        } 
                    }, 
                    tools: [{ google_search: {} }],
                    systemInstruction: { parts: [{ text: systemInstructionText }] }
                }
            }));
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify({ type: "server_ready" }));
        });

        clientWs.on('message', (data) => {
            const msg = JSON.parse(data);
            if (msg.base64Audio && geminiWs.readyState === WebSocket.OPEN) {
                geminiWs.send(JSON.stringify({ realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: msg.base64Audio }] } }));
            }
        });

        geminiWs.on('message', (data) => {
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
        });

        geminiWs.on('error', (e) => console.error("Gemini WS Error:", e));
        clientWs.on('close', () => geminiWs.close());

    } catch (e) { clientWs.close(); }
});