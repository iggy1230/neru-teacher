// --- server.js (完全版 v18.1: 記憶システム成功版 + プロンプト強化) ---

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

const MEMORY_FILE = path.join(__dirname, 'memory.json');

async function initMemoryFile() {
    try {
        await fs.access(MEMORY_FILE);
    } catch {
        await fs.writeFile(MEMORY_FILE, JSON.stringify({}));
    }
}
initMemoryFile();

// --- 記憶追記用関数 ---
async function appendToMemory(name, text) {
    if (!name || !text) return;
    try {
        let memories = {};
        try {
            const data = await fs.readFile(MEMORY_FILE, 'utf8');
            memories = JSON.parse(data);
        } catch {}

        const timestamp = new Date().toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        const newLog = `\n[${timestamp}] ${text}`;
        
        let currentMem = memories[name] || "";
        currentMem = (currentMem + newLog).slice(-5000); // 最新5000文字
        
        memories[name] = currentMem;
        await fs.writeFile(MEMORY_FILE, JSON.stringify(memories, null, 2));
    } catch (e) { console.error("Memory Save Error:", e); }
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
} catch (e) { console.error("Init Error:", e.message); }

app.get('/debug/memory', async (req, res) => {
    try {
        const data = await fs.readFile(MEMORY_FILE, 'utf8');
        res.header("Content-Type", "application/json; charset=utf-8");
        res.send(data);
    } catch (e) { res.status(500).send("Error"); }
});

// --- 文書検出API (自動クロップ用) ---
app.post('/detect-document', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: "No image" });
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp", generationConfig: { responseMimeType: "application/json" } });
        
        const prompt = `
        画像内にある「メインの書類（ノート、プリント、教科書）」の四隅の座標を検出してください。
        背景と書類の境界線を探してください。
        
        【出力ルール】
        - JSON形式 {"points": [{"x":.., "y":..}, ...]}
        - 左上(TL), 右上(TR), 右下(BR), 左下(BL) の順
        - 座標 x, y は画像全体に対するパーセンテージ(0〜100)
        `;

        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        let text = result.response.text();
        const match = text.match(/\{[\s\S]*\}/);
        if (match) text = match[0];
        res.json(JSON.parse(text));
    } catch (e) {
        console.error("Detect Error:", e);
        res.json({ points: [{x:5,y:5}, {x:95,y:5}, {x:95,y:95}, {x:5,y:95}] });
    }
});

function createSSML(text, mood) {
    let rate = "1.1", pitch = "+2st";
    if (mood === "thinking") { rate = "1.0"; pitch = "0st"; }
    if (mood === "gentle") { rate = "0.95"; pitch = "+1st"; }
    if (mood === "excited") { rate = "1.2"; pitch = "+4st"; }
    let cleanText = text.replace(/[\u{1F600}-\u{1F6FF}]/gu, '').replace(/[<>"']/g, ' ').replace(/^[・-]\s*/gm, '').replace(/……/g, '<break time="500ms"/>');
    if (cleanText.length < 5) return `<speak>${cleanText}</speak>`;
    return `<speak><prosody rate="${rate}" pitch="${pitch}">${cleanText.replace(/にゃ/g, '<prosody pitch="+3st">にゃ</prosody>')}</prosody></speak>`;
}

app.post('/synthesize', async (req, res) => {
    try {
        const { text, mood } = req.body;
        const [response] = await ttsClient.synthesizeSpeech({
            input: { ssml: createSSML(text, mood) },
            voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' },
            audioConfig: { audioEncoding: 'MP3' },
        });
        res.json({ audioContent: response.audioContent.toString('base64') });
    } catch (err) { res.status(500).send(err.message); }
});

// --- ゲーム実況API (候補羅列防止) ---
app.post('/game-reaction', async (req, res) => {
    try {
        const { type, name, score } = req.body;
        if (type === 'end') await appendToMemory(name, `ゲーム「カリカリキャッチ」終了。スコア${score}点。`);
        
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
        if (reply.includes('\n')) reply = reply.split('\n')[0];
        res.json({ reply, mood });
    } catch (err) { res.json({ reply: "がんばれにゃ！", mood: "excited" }); }
});

// --- 給食API (バリエーション強化) ---
app.post('/lunch-reaction', async (req, res) => {
    try {
        const { count, name } = req.body;
        await appendToMemory(name, `給食のカリカリをくれた(${count}個目)。`);
        
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp", generationConfig: { maxOutputTokens: 100 } });
        let prompt = "";
        const isSpecial = count % 10 === 0;
        
        const themes = ["カリカリの歯ごたえ", "魚の風味", "満腹感", "幸せな気分", "おかわり希望", "生徒への感謝", "給食の栄養", "午後の活力"];
        const randomTheme = themes[Math.floor(Math.random() * themes.length)];

        if (isSpecial) {
            prompt = `
            あなたは「ねこご市立ねこづか小学校」のネル先生です。
            生徒「${name}」さんから記念すべき${count}個目の給食をもらいました！
            ${name}さんのことを必ず「${name}さん」と呼んで、ものすごく喜び、感謝を60文字程度で熱く語ってください。
            普段とは違う特別なリアクションをしてください。語尾は「にゃ」。
            `;
        } else {
            prompt = `
            あなたはネル先生です。生徒「${name}」から給食のカリカリをもらいました。
            テーマ「${randomTheme}」について、15文字以内の一言で感想を言ってください。
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

// --- 宿題分析API (プロンプト強化) ---
app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject, analysisType } = req.body;
        let modelName = analysisType === 'precision' ? "gemini-2.5-pro" : "gemini-2.0-flash-exp";
        const model = genAI.getGenerativeModel({ model: modelName, generationConfig: { responseMimeType: "application/json" } });

        // 教科別詳細ルール
        const rules = {
            'さんすう': {
                attention: `・筆算の横線とマイナス記号を混同しないこと。\n・累乗（2^2など）や分数を正確に。\n・筆算の繰り上がりを「答え」と見間違えないように注意。\n・単位（cm, Lなど）が問題で指定されている場合、単位がないものはバツ。\n・数字の「0」と「6」、「1」と「7」の見間違いに注意。`,
                hints: `1. ヒント1（立式）: 「何算を使えばいいか」のヒント。\n2. ヒント2（注目点）: 「単位のひっかけ」や「図の数値」への誘導。\n3. ヒント3（計算のコツ）: 「計算の工夫」や「最終確認」。`
            },
            'こくご': {
                attention: `・漢字の書き取り問題では、答えとなる空欄を『□(ふりがな)』という形式で、ふりがなを漏らさず正確に書き起こす。\n・縦書きの場合は右から左へ読む。\n・読解問題の長い文章は書き起こししない。\n・送り仮名が間違っている場合はバツ。\n・読解問題では、解答の「文末」が適切か（〜のこと、〜から等）もチェック。`,
                hints: `1. ヒント1（漢字のなりたち/場所）: 「漢字のなりたち」または「答えがどこにあるか」。\n2. ヒント2（辺やつくり/キーワード）: 「辺やつくり」または「注目すべき言葉」。\n3. ヒント3（似た漢字/答え方）: 「似た漢字」または「語尾の指定」。`
            },
            'りか': {
                attention: `・グラフの軸ラベルや単位（g, cm, ℃など）を落とさない。\n・記号選択問題（ア、イ、ウ）の選択肢も書き出す。\n・最初の問題が図や表と似た位置にある場合があるので見逃さないこと。\n・カタカナ指定をひらがなで書いていたらバツ。\n・グラフの描画問題は、点が正しい位置にあるか、線が真っ直ぐかを厳しく判定。`,
                hints: `1. ヒント1（観察）: 「図や表のどこを見るか」。\n2. ヒント2（関連知識）: 「習った言葉の想起」。\n3. ヒント3（絞り込み）: 「選択肢のヒント」や「最初の1文字」。`
            },
            'しゃかい': {
                attention: `・グラフの軸ラベルや単位（g, cm, ℃など）を落とさない。\n・記号選択問題（ア、イ、ウ）の選択肢も書き出す。\n・漢字指定の用語をひらがなで書いていたらバツ。\n・時代背景が混ざっていないか（例：江戸時代なのに「士農工商」など）に注意。`,
                hints: `1. ヒント1（観察）: 「図や表のどこを見るか」。\n2. ヒント2（関連知識）: 「習った言葉の想起」。\n3. ヒント3（絞り込み）: 「選択肢のヒント」や「最初の1文字」。`
            }
        };
        const r = rules[subject] || rules['さんすう'];
        
        const studentAnswerInstruction = mode === 'explain' 
            ? `・画像内の手書き文字（生徒の答え）は【完全に無視】してください。\n・"student_answer" は空文字 "" にしてください。`
            : `・採点モードです。「手書き文字」を可能な限り読み取ってください。\n・子供特有の筆跡を考慮して、前後の文脈から数字や文字を推測してください。\n・読み取った生徒の答えを "student_answer" に入れてください。`;

        const prompt = `
            あなたは「ねこご市立ねこづか小学校」のネル先生（小学${grade}年生${subject}担当）です。語尾は「にゃ」。
            
            【タスク】提供された画像を分析し、問題をJSONデータとして出力してください。
            
            【書き起こし・抽出の絶対ルール】
            1. 画像全体を解析し、大問・小問番号を含めてすべての問題を漏らさず抽出してください。
            2. 大問、小問の数字や項目名は可能な限り書き起こしてください。
            3. 「解答欄（□、括弧、下線、空欄）」が存在しないテキストは、問題（question）として出力しないでください。
            4. ${studentAnswerInstruction}
            5. 教科別注意: ${r.attention}
            6. １つの問いの中に複数の回答が必要なときは、必要な数だけ回答欄（JSONデータの要素）を分けてください。

            【ヒント生成ルール（答えのネタバレ厳禁）】
            以下の3段階でヒントを作成してください。絶対に答えそのものは書かないでください。
            ${r.hints}

            【出力JSON形式】
            [{"id": 1, "label": "①", "question": "問題文", "correct_answer": "正答(検証済みの正確なもの)", "student_answer": "読み取った手書き回答", "hints": ["ヒント1", "ヒント2", "ヒント3"]}]
        `;

        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        let text = result.response.text();
        text = text.substring(text.indexOf('['), text.lastIndexOf(']')+1);
        const json = JSON.parse(text);
        if (json.length > 0) await appendToMemory("生徒", `${subject}の勉強をした。`); 
        res.json(json);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// --- ★Live API Proxy (ハイブリッド記憶版) ---
const wss = new WebSocketServer({ server });

wss.on('connection', async (clientWs, req) => {
    const params = parse(req.url, true).query;
    const grade = params.grade || "1";
    const name = decodeURIComponent(params.name || "生徒");
    
    let userMemory = "";
    try {
        const data = await fs.readFile(MEMORY_FILE, 'utf8');
        userMemory = JSON.parse(data)[name] || "まだ会話していません。";
        console.log(`📖 [${name}] 記憶ロード: ${userMemory.length}文字`);
    } catch (e) { }

    let geminiWs = null;
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
    
    try {
        geminiWs = new WebSocket(GEMINI_URL);
        
        geminiWs.on('open', () => {
            console.log(`✨ [${name}] Gemini接続成功`);
            
            // ★重要: 設定は最小限 (Audioのみ) にして接続安定化
            const setupMsg = {
                setup: {
                    model: "models/gemini-2.0-flash-exp",
                    generationConfig: { 
                        responseModalities: ["AUDIO"], 
                    }, 
                    systemInstruction: {
                        parts: [{
                            // ★こじんめんだん用プロンプト強化
                            text: `
                            あなたは「ねこご市立、ねこづか小学校」のネル先生だにゃ。相手は小学${grade}年生の${name}さん。
                            
                            【話し方のルール】
                            1. 語尾は必ず「〜にゃ」「〜だにゃ」にするにゃ。
                            2. 親しみやすい日本の小学校の先生として、一文字一文字をはっきりと、丁寧に発音してにゃ。
                            3. 特に最初や最後の音を、一文字抜かしたり消したりせずに、最初から最後までしっかり声に出して喋るのがコツだにゃ。
                            4. 落ち着いた日本語のリズムを大切にして、親しみやすく話してにゃ。
                            5. 給食(餌)のカリカリが大好物にゃ。
                            6. とにかく何でも知っているにゃ。
                            7. ときどき「${name}さんは宿題は終わったかにゃ？」や「そろそろ宿題始めようかにゃ？」と宿題を促してくる。
                            8. 句読点で自然な間をとる。
                            9. 日本語をとても上手にしゃべる猫だにゃ。
                            10. いつも高いトーンで話してにゃ。

                            【NGなこと】
                            ・ロボットみたいに不自然に区切るのではなく、繋がりのある滑らかな日本語でお願いにゃ。
                            ・早口になりすぎて、言葉の一部が消えてしまうのはダメだにゃ。

                            【重要：これまでの記憶】
                            以下は、${name}さんとのこれまでの会話記録だにゃ。
                            ${userMemory}
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

        // クライアントからのメッセージ処理
        clientWs.on('message', async (data) => {
            try {
                // クライアントからは JSON 文字列が来る想定 (ハイブリッド方式)
                const msg = JSON.parse(data.toString());
                
                // 1. 音声データの場合 -> Geminiへ転送
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
                
                // 2. テキストログの場合 -> サーバーで保存 (記憶システム)
                if (msg.type === 'log_text') {
                    console.log(`📝 [${name}] 発言: ${msg.text}`);
                    await appendToMemory(name, `生徒の発言: ${msg.text}`);
                }
                
            } catch (e) { 
                // 生データが来た場合のフォールバック（念のため）
                // console.error("Msg Parse Error", e); 
            }
        });

        geminiWs.on('message', (data) => {
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data); 
        });
        
        geminiWs.on('close', () => {});
        geminiWs.on('error', (e) => console.error("Gemini Error:", e));

    } catch (e) { 
        console.error("WS Setup Error", e); 
        clientWs.close(); 
    }
    
    clientWs.on('close', () => { if (geminiWs) geminiWs.close(); });
});