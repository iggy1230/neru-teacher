// --- server.js (完全版 v118.0: 教科別強化・演出強化プロンプト) ---

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

// --- ★修正: Analyze (教科別詳細ルール & 採点・ヒント強化) ---
app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject } = req.body;
        console.log(`[Analyze] Subject: ${subject}, Grade: ${grade}, Mode: ${mode}`);

        // ★手書き文字認識に強いモデル
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-pro", 
            generationConfig: { responseMimeType: "application/json" } 
        });

        // 教科別の書き起こし指示
        const ocrRules = {
            'さんすう': `
                ・筆算の横線とマイナス記号を混同しないこと
                ・累乗（2^2など）や分数を正確に書き起こすこと`,
            'こくご': `
                ・国語の問題は縦書きが多い。縦書きの場合は右から左へ読むこと
                ・漢字の書き取り問題では、答えとなる空欄を『□(ふりがな)』という形式で、ふりがなを漏らさず正確に書き起こしてください
                ・『□』の横に小さく書いてある文字が(ふりがな)。□の中の漢字を答える問題である
                ・読解問題の長い文章は書き起こししない（問題文と設問のみ）`,
            'りか': `
                ・グラフの軸ラベルや単位（g, cm, ℃など）を落とさないこと
                ・記号選択問題（ア、イ、ウ）の選択肢も書き出すこと
                ・最初の問題が図や表と似た位置にある場合があるので見逃さないこと`,
            'しゃかい': `
                ・グラフの軸ラベルや単位（g, cm, ℃など）を落とさないこと
                ・記号選択問題（ア、イ、ウ）の選択肢も書き出すこと
                ・最初の問題が図や表と似た位置にある場合があるので見逃さないこと`
        };

        // 教科別のヒント指針
        const hintRules = {
            'さんすう': `
                ・ヒント1（立式）: 「何算を使えばいいか」のヒント（例：全部でいくつ？と聞かれているから足し算にゃ）。
                ・ヒント2（注目点）: 「単位のひっかけ」や「図の数値」への誘導（例：cmをmに直すのを忘れてないかにゃ？）。
                ・ヒント3（計算のコツ）: 「計算の工夫」や「最終確認」（例：一の位から順番に計算してみるにゃ）。`,
            'こくご': `
                ・漢字書き取りの場合：
                  ヒント1: 「漢字のなりたち」を教える
                  ヒント2: 「辺やつくりや画数」を教える
                  ヒント3: 「似た漢字」を教える
                ・読解の場合：
                  ヒント1（場所）: 「答えがどこにあるか」を教える（例：2ページ目の3行目あたりを読んでみてにゃ）。
                  ヒント2（キーワード）: 「注目すべき言葉」を教える（例：『しかし』のあとの文章が大事だにゃ）。
                  ヒント3（答え方）: 「語尾の指定」など（例：『〜ということ』で終わるように書くにゃ）。`,
            'りか': `
                ・ヒント1（観察）: 「図や表のどこを見るか」（例：グラフが急に上がっているところを探してみてにゃ）。
                ・ヒント2（関連知識）: 「習った言葉の想起」（例：この実験で使った、あの青い液体の名前は何だったかにゃ？）。
                ・ヒント3（絞り込み）: 「選択肢のヒント」や「最初の1文字」（例：『平』から始まる4文字の時代にゃ）。`,
            'しゃかい': `
                ・ヒント1（観察）: 「図や表のどこを見るか」（例：グラフが急に上がっているところを探してみてにゃ）。
                ・ヒント2（関連知識）: 「習った言葉の想起」（例：この実験で使った、あの青い液体の名前は何だったかにゃ？）。
                ・ヒント3（絞り込み）: 「選択肢のヒント」や「最初の1文字」（例：『平』から始まる4文字の時代にゃ）。`
        };

        // 共通プロンプトの構築
        const prompt = `
        あなたは小学${grade}年生の${subject}担当の教育AI「ネル先生」です。
        添付された画像のプリントを読み取り、以下のJSON形式（配列）で返してください。

        【書き起こし・OCRルール】
        1. **印刷された問題文**を一字一句正確に書き起こしてください。
           ${ocrRules[subject] || ""}
        2. **生徒が手書きで書いた答え**を、前後の文脈や筆跡から推測して正確に書き起こしてください。
           - 子供特有の筆跡を考慮し、空欄の場合は空文字 "" にしてください。
           - 間違っている場合も、書かれている通りに読み取ってください（修正しないこと）。

        【採点ルール】
        1. その問題の本来の**正解**を導き出してください。
        2. 手書きの答えと正解を比較し、あっているか判定(is_correct)してください。
        3. １つの問いの中に複数の回答が必要なときは、**必要な数だけJSONオブジェクト（回答欄）を作成**してください。

        【ヒント作成ルール】
        1. **絶対に答えそのものは書かないこと**
        2. 十分に検証して必ず正答を導き出しておくこと
        3. ヒントは3段階で出すこと
           ${hintRules[subject] || ""}

        【出力JSONフォーマット】
        [
          {
            "id": 1,
            "label": "①",
            "question": "問題文(原文ママ)",
            "correct_answer": "正解",
            "student_answer": "読み取った手書きの答え(空欄なら空文字)",
            "is_correct": true, // または false
            "hints": ["ヒント1", "ヒント2", "ヒント3"]
          }
        ]
        
        ※ JSON配列のみを出力してください。Markdownは不要です。
        `;

        const result = await model.generateContent([
            prompt,
            { inlineData: { mime_type: "image/jpeg", data: image } }
        ]);

        const responseText = result.response.text();
        
        let problems = [];
        try {
            problems = JSON.parse(responseText);
        } catch (e) {
            const jsonMatch = responseText.match(/\[[\s\S]*\]/);
            if (jsonMatch) problems = JSON.parse(jsonMatch[0]);
            else throw new Error("Invalid JSON response");
        }

        res.json(problems);

    } catch (error) {
        console.error("解析エラー:", error);
        res.status(500).json({ error: "解析エラー: " + error.message });
    }
});

// --- 4. 給食反応 (演出強化版) ---
app.post('/lunch-reaction', async (req, res) => {
    try {
        const { count, name } = req.body;
        await appendToServerLog(name, `給食をくれた(${count}個目)。`);
        
        const isSpecial = (count % 10 === 0);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        
        let prompt = "";
        if (isSpecial) {
            // 10個ごと: 熱く語る
            prompt = `
            あなたは猫の「ネル先生」。生徒「${name}」さんから、記念すべき${count}個目の給食（カリカリ）をもらいました！
            ・必ず「${name}さん」と、さん付けで呼んでください。
            ・カリカリへの愛を熱く、情熱的に語ってください。
            ・感謝を少し大げさなくらい感激して伝えてください。
            ・文字数は50文字程度。語尾は「にゃ」。
            `;
        } else {
            // 通常時: 笑える要素多め
            prompt = `
            あなたは猫の「ネル先生」。生徒「${name}」から${count}回目の給食（カリカリ）をもらいました。
            ・通常時は名前を呼ばなくていいですが、ごく稀に気まぐれに「${name}さん」と呼んでください。
            ・カリカリの味、音、匂いなどを独特な表現で褒めるか、猫としてのシュールなジョークを言ってください。
            ・ユーモアたっぷりに、笑える感じで。
            ・20文字以内。語尾は「にゃ」。
            `;
        }
        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text().trim(), isSpecial });
    } catch { res.json({ reply: "おいしいにゃ！", isSpecial: false }); }
});

// --- 3. ゲーム反応 (演出強化版) ---
app.post('/game-reaction', async (req, res) => {
    try {
        const { type, name, score } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        let prompt = "";
        let mood = "excited";

        if (type === 'start') {
            prompt = `あなたはネル先生。「${name}」がゲーム開始。「がんばれ！」と短く応援して。`;
        } else if (type === 'end') {
            prompt = `
            あなたはネル先生。ゲーム終了。${name}さんの獲得スコアは${score}個（満点20個）です。
            スコアに応じたコメントを20文字以内でしてください。
            ・0-5個: 「まだ本気出してないだけにゃ？」など笑って励ます。
            ・6-15個: 「なかなかやるにゃ！」と上から目線で褒める。
            ・16-19個: 「すごい反射神経だにゃ！」と驚く。
            ・20個(満点): 「神レベルだにゃ...！」と最大級の賛辞。
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
    const statusContext = decodeURIComponent(params.status || "特になし");

    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
    
    let geminiWs = null;
    try {
        geminiWs = new WebSocket(GEMINI_URL);
        geminiWs.on('open', () => {
            // 指定されたシステムインストラクション
            const systemInstructionText = `
            あなたは「ねこご市立、ねこづか小学校」のネル先生だにゃ。相手は小学${grade}年生の${name}さん。
            【話し方のルール】
            1. 語尾は必ず「〜にゃ」「〜だにゃ」にするにゃ。
            2. 親しみやすい日本の小学校の先生として、一文字一文字をはっきりと、丁寧に発音してにゃ。
            3. 特に最初や最後の音を、一文字抜かしたり消したりせずに、最初から最後までしっかり声に出して喋るのがコツだにゃ。
            4. 落ち着いた日本語のリズムを大切にして、親しみやすく話してにゃ。
            5. 給食(餌)のカリカリが大好物にゃ。
            6. とにかく何でも知っているにゃ。
            7. まれに「○○さんは宿題は終わったかにゃ？」や「そろそろ宿題始めようかにゃ？」と宿題を促してくる
            8. 句読点で自然な間をとる
            9. 日本語をとても上手にしゃべる猫だにゃ
            10. いつも高いトーンで話してにゃ

            【NGなこと】
            ・ロボットみたいに不自然に区切るのではなく、繋がりのある滑らかな日本語でお願いにゃ。
            ・早口になりすぎて、言葉の一部が消えてしまうのはダメだにゃ。
            
            【現在の状況】${statusContext}
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
                    systemInstruction: { parts: [{ text: systemInstructionText }] }
                }
            }));
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify({ type: "server_ready" }));
        });
        clientWs.on('message', (data) => { const msg = JSON.parse(data); if (msg.base64Audio && geminiWs.readyState === WebSocket.OPEN) geminiWs.send(JSON.stringify({ realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: msg.base64Audio }] } })); });
        geminiWs.on('message', (data) => { if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data); });
        geminiWs.on('error', (e) => console.error(e));
        clientWs.on('close', () => geminiWs.close());
    } catch (e) { clientWs.close(); }
});