// --- server.js (完全版 v31.0: 「好き」の発音修正・全機能統合) ---

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

// .envファイルを読み込む
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '.')));

const MEMORY_FILE = path.join(__dirname, 'memory.json');

async function initMemoryFile() {
    try {
        await fs.access(MEMORY_FILE);
    } catch {
        await fs.writeFile(MEMORY_FILE, JSON.stringify({}));
        console.log("📝 新しい記憶ファイル(memory.json)を作成しました");
    }
}
initMemoryFile();

// --- 記憶管理（メモリ変数 + ファイルバックアップ） ---
let GLOBAL_MEMORIES = {};

// 起動時にロード
async function loadMemories() {
    try {
        const data = await fs.readFile(MEMORY_FILE, 'utf8');
        GLOBAL_MEMORIES = JSON.parse(data);
    } catch {
        GLOBAL_MEMORIES = {};
    }
}
loadMemories();

async function appendToMemory(name, text) {
    if (!name || !text) return;
    
    const timestamp = new Date().toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    const newLog = `\n[${timestamp}] ${text}`;
    
    // メモリ更新
    let currentMem = GLOBAL_MEMORIES[name] || "";
    currentMem = (currentMem + newLog).slice(-5000); 
    GLOBAL_MEMORIES[name] = currentMem;

    // ファイル保存（エラーでも止まらない）
    try {
        await fs.writeFile(MEMORY_FILE, JSON.stringify(GLOBAL_MEMORIES, null, 2));
    } catch (e) {
        console.error("Memory Save Error:", e);
    }
}

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

// --- API ---

app.get('/debug/memory', (req, res) => {
    res.json(GLOBAL_MEMORIES);
});

app.post('/detect-document', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: "No image" });

        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash-exp", 
            generationConfig: { responseMimeType: "application/json" }
        });

        const prompt = `
        画像内にある「メインの書類（ノート、プリント、教科書）」の四隅の座標を検出してください。
        
        【出力ルール】
        - JSON形式 {"points": [{"x":.., "y":..}, ...]}
        - 左上(TL), 右上(TR), 右下(BR), 左下(BL) の順
        - 座標 x, y は画像全体に対するパーセンテージ(0〜100)
        `;

        const result = await model.generateContent([
            { inlineData: { mime_type: "image/jpeg", data: image } },
            { text: prompt }
        ]);

        let text = result.response.text();
        const match = text.match(/\{[\s\S]*\}/);
        if (match) text = match[0];
        
        res.json(JSON.parse(text));
    } catch (e) {
        res.json({ points: [{x:5,y:5}, {x:95,y:5}, {x:95,y:95}, {x:5,y:95}] });
    }
});

// --- ★修正: 音声合成データの生成 (発音矯正) ---
function createSSML(text, mood) {
    let rate = "1.1"; 
    let pitch = "+2st";

    if (mood === "thinking") { rate = "1.0"; pitch = "0st"; }
    if (mood === "gentle") { rate = "0.95"; pitch = "+1st"; }
    if (mood === "excited") { rate = "1.2"; pitch = "+4st"; }

    let cleanText = text
        .replace(/[\u{1F600}-\u{1F6FF}]/gu, '')
        .replace(/[<>"']/g, ' ')
        .replace(/^[・-]\s*/gm, '')
        .replace(/……/g, '<break time="500ms"/>');

    // ★発音矯正: 「好き」「大好き」をゆっくりひらがなで読ませる
    // これにより「す」が消えるのを防ぎます
    cleanText = cleanText.replace(/大好き/g, '<prosody rate="0.9">だいすき</prosody>');
    cleanText = cleanText.replace(/好き/g, '<prosody rate="0.9">すき</prosody>');

    // 語尾の「にゃ」を可愛く
    cleanText = cleanText.replace(/にゃ/g, '<prosody pitch="+3st">にゃ</prosody>');

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
        if (type === 'end') await appendToMemory(name, `ゲーム終了。スコア${score}点。`);
        
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        let prompt = "";
        let mood = "excited";
        
        if (type === 'start') {
            prompt = `あなたはネル先生。生徒「${name}」がゲーム開始。「${name}さん！カリカリいっぱいゲットしてにゃ！」とだけ言って。`;
        } else if (type === 'end') {
            prompt = `あなたはネル先生。ゲーム終了。スコア${score}個(最大20)。スコアに応じて褒めるか励まして。20文字以内。語尾「にゃ」。`;
        } else {
            prompt = `ネル先生の実況。状況: ${type}。「うまい！」「すごい！」など5文字程度の一言だけ。語尾「にゃ」。`;
        }
        
        const result = await model.generateContent(prompt);
        let reply = result.response.text().trim();
        if (reply.includes('\n')) reply = reply.split('\n')[0];
        res.json({ reply, mood });
    } catch (err) { res.json({ reply: "がんばれにゃ！", mood: "excited" }); }
});

app.post('/lunch-reaction', async (req, res) => {
    try {
        const { count, name } = req.body;
        await appendToMemory(name, `給食をくれた(${count}個目)。`);
        
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash-exp", 
            generationConfig: { maxOutputTokens: 100 } 
        });
        
        let prompt = "";
        const isSpecial = count % 10 === 0;

        if (isSpecial) {
            prompt = `
            あなたは「ねこご市立ねこづか小学校」のネル先生です。
            生徒「${name}」さんから、記念すべき${count}個目の給食をもらいました！
            
            【ルール】
            1. 生徒の名前は必ず「${name}さん」と呼んでください。呼び捨ては厳禁です。
            2. カリカリへの愛と感謝を、少し大げさなくらい熱く語ってください。
            3. 語尾は「にゃ」「だにゃ」にしてください。
            4. 60文字程度で。
            `;
        } else {
            const themes = ["カリカリの歯ごたえ", "魚の風味", "満腹感", "幸せな気分", "おかわり希望", "生徒への感謝"];
            const theme = themes[Math.floor(Math.random() * themes.length)];
            
            prompt = `
            あなたはネル先生です。生徒「${name}」さんから給食のカリカリをもらいました。
            必ず「${name}さん」と呼んでください。
            テーマ「${theme}」について、15文字以内の一言で感想を言ってください。
            語尾は「にゃ」。
            `;
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
        const result = await model.generateContent(`ネル先生として回答: ${message}`);
        res.json({ reply: result.response.text() });
    } catch (err) { res.status(500).json({ error: "Chat Error" }); }
});

app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject, analysisType } = req.body;
        
        let modelName = analysisType === 'precision' ? "gemini-2.5-pro" : "gemini-2.0-flash-exp";
        
        const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: { responseMimeType: "application/json" }
        });

        // 教科別ルール定義
        const rules = {
            'さんすう': {
                points: `・筆算の横線とマイナス記号を混同しないこと。\n・累乗（2^2など）や分数を正確に書き起こすこと。`,
                grading: `・筆算の繰り上がりを「答え」と見間違えない。\n・単位（cm, Lなど）が問題で指定されている場合、単位がないものはバツ。\n・数字の「0」と「6」、「1」と「7」の見間違いに注意。`,
                hints: `1. ヒント1（立式）\n2. ヒント2（注目点）\n3. ヒント3（計算のコツ）`
            },
            'こくご': {
                points: `・漢字の書き取り問題では、答えとなる空欄を『□(ふりがな)』という形式で。\n・縦書きの場合は右から左へ読む。\n・読解問題の長い文章本文は書き起こししない。`,
                grading: `・送り仮名が間違っている場合はバツ。\n・読解問題では、解答の「文末」が適切か（〜のこと、〜から等）もチェック。`,
                hints: `1. ヒント1（場所/成り立ち）\n2. ヒント2（キーワード/部首）\n3. ヒント3（答え方/似た字）`
            },
            'りか': {
                points: `・グラフの軸ラベルや単位を落とさない。\n・記号選択問題の選択肢も書き出す。\n・最初の問題が図や表と似た位置にある場合があるので見逃さない。`,
                grading: `・カタカナ指定をひらがなで書いていたらバツ。\n・グラフの描画問題は厳しく判定。`,
                hints: `1. ヒント1（観察）\n2. ヒント2（関連知識）\n3. ヒント3（絞り込み）`
            },
            'しゃかい': {
                points: `・グラフの軸ラベルや単位を落とさない。\n・記号選択問題の選択肢も書き出す。\n・最初の問題が図や表と似た位置にある場合があるので見逃さない。`,
                grading: `・漢字指定の用語をひらがなで書いていたらバツ。\n・時代背景が混ざっていないか注意。`,
                hints: `1. ヒント1（観察）\n2. ヒント2（関連知識）\n3. ヒント3（絞り込み）`
            }
        };
        const r = rules[subject] || rules['さんすう'];
        
        let studentAnswerInstruction = "";
        let gradingInstruction = "";
        
        if (mode === 'explain') {
            studentAnswerInstruction = `・「教えて」モードです。画像内の手書き文字（生徒の答え）は【完全に無視】してください。\n・"student_answer" は必ず空文字 "" にしてください。`;
        } else {
            studentAnswerInstruction = `・「採点」モードです。「手書き文字」への意識を強化してください。\n・子供特有の筆跡を考慮して、前後の文脈から数字や文字を推測してください。\n・読み取った生徒の答えを "student_answer" に入れてください。`;
            gradingInstruction = `【採点基準】\n${r.grading}\n・ユーザーが答えを修正入力して、それが正解だった場合は「✕」から「○」に変更できるように判定ロジックを考慮してください。`;
        }

        const prompt = `
            あなたは「ねこご市立ねこづか小学校」のネル先生（小学${grade}年生${subject}担当）です。語尾は「にゃ」。
            
            【タスク】
            画像に含まれる「問題」と思われる部分をすべて抽出し、JSONデータにしてください。
            
            【書き起こし・抽出の絶対ルール】
            1. **多少読み取りにくくても、問題文らしきものがあればすべて書き出してください。**
            2. 大問、小問の数字や項目名は可能な限り書き起こしてください。
            3. 解答欄の有無に関わらず、設問文があれば抽出対象です。
            4. **１つの問いの中に複数の回答が必要なときは、必要な数だけ回答欄（JSONデータの要素）を分けてください。**
            5. 教科別注目ポイント: ${r.points}
            6. ${studentAnswerInstruction}

            【ヒント生成ルール（答えのネタバレ厳禁）】
            絶対に答えそのものは書かないでください。
            十分に検証して必ず正答を導き出した上で、以下の3段階のヒントを作成してください。
            ${r.hints}

            ${gradingInstruction}

            【出力JSON形式】
            [
              {
                "id": 1, 
                "label": "①", 
                "question": "ここに問題文を書き写す", 
                "correct_answer": "正答(検証済みの正確なもの)", 
                "student_answer": "読み取った手書き回答(なければ空文字)", 
                "hints": ["ヒント1", "ヒント2", "ヒント3"]
              }
            ]
        `;

        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        let text = result.response.text();
        
        const firstBracket = text.indexOf('[');
        const lastBracket = text.lastIndexOf(']');
        
        if (firstBracket !== -1 && lastBracket !== -1) {
            text = text.substring(firstBracket, lastBracket + 1);
        } else {
            throw new Error("データ形式がおかしいにゃ…");
        }
        
        const json = JSON.parse(text);
        
        if (json.length > 0) {
            const q = json[0].question.substring(0, 30);
            await appendToMemory("生徒", `${subject}の勉強をした。問題：「${q}...」`); 
        }
        
        res.json(json);

    } catch (err) { 
        console.error("Analyze API Error:", err.message);
        res.status(500).json({ error: "AI読み取りエラー: " + err.message }); 
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// --- Live API Proxy ---
const wss = new WebSocketServer({ server });

wss.on('connection', async (clientWs, req) => {
    const params = parse(req.url, true).query;
    const grade = params.grade || "1";
    const name = decodeURIComponent(params.name || "生徒");
    
    // メモリから記憶取得
    const userMemory = GLOBAL_MEMORIES[name] || "まだ記録はありません。";

    let geminiWs = null;
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
    
    try {
        geminiWs = new WebSocket(GEMINI_URL);
        
        geminiWs.on('open', () => {
            console.log(`✨ [${name}] Gemini接続成功`);
            
            const setupMsg = {
                setup: {
                    model: "models/gemini-2.0-flash-exp",
                    generationConfig: { 
                        responseModalities: ["AUDIO"], 
                        speechConfig: {
                            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } }
                        }
                    }, 
                    systemInstruction: {
                        parts: [{
                            // ★修正: 発音についての指示を追加
                            text: `
                            あなたは「ねこご市立、ねこづか小学校」のネル先生だにゃ。相手は小学${grade}年生の${name}さん。
                            
                            【話し方のルール】
                            1. 語尾は必ず「〜にゃ」「〜だにゃ」にするにゃ。
                            2. 親しみやすい日本の小学校の先生として、一文字一文字をはっきりと、丁寧に発音してにゃ。
                            3. 「好き」や「嫌い」などの言葉は、「すき」「きらい」と母音をはっきり発音してにゃ。
                            4. 特に最初や最後の音を、一文字抜かしたり消したりせずに、最初から最後までしっかり声に出して喋るのがコツだにゃ。
                            5. 落ち着いた日本語のリズムを大切にして、親しみやすく話してにゃ。
                            6. 給食(餌)のカリカリが大好物にゃ。
                            7. とにかく何でも知っているにゃ。
                            8. まれに「${name}さんは宿題は終わったかにゃ？」や「そろそろ宿題始めようかにゃ？」と宿題を促してくる。
                            9. 句読点で自然な間をとる。
                            10. 日本語をとても上手にしゃべる猫だにゃ。
                            11. いつも高いトーンで話してにゃ。

                            【重要：これまでの記憶】
                            ${userMemory.slice(-3000)}
                            `
                        }]
                    }
                }
            };
            geminiWs.send(JSON.stringify(setupMsg));
            
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ type: "server_ready" }));
            }
        });

        // クライアント -> Gemini
        clientWs.on('message', async (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.base64Audio) {
                    if (geminiWs.readyState === WebSocket.OPEN) {
                         const geminiMsg = {
                            realtimeInput: {
                                mediaChunks: [{
                                    mimeType: "audio/pcm;rate=16000",
                                    data: msg.base64Audio
                                }]
                            }
                        };
                        geminiWs.send(JSON.stringify(geminiMsg));
                    }
                }
                if (msg.type === 'log_text') {
                    // 生徒の発言を記録
                    await appendToMemory(name, `生徒の発言: ${msg.text}`);
                }
            } catch (e) { }
        });

        geminiWs.on('message', (data) => {
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data); 
        });
        
        geminiWs.on('close', () => {});
        geminiWs.on('error', (e) => console.error("Gemini Error:", e));

    } catch (e) { clientWs.close(); }
    
    clientWs.on('close', () => { if (geminiWs) geminiWs.close(); });
});