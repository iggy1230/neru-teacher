// --- server.js (完全版 v265.0: テキスト・音声完全同時対応) ---

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
// Helper Functions
// ==========================================

function getSubjectInstructions(subject) {
    switch (subject) {
        case 'さんすう': return `- **数式の記号**: 筆算の「横線」と「マイナス記号」を絶対に混同しないこと。\n- **複雑な表記**: 累乗（2^2など）、分数、帯分数を正確に認識すること。\n- **図形問題**: 図の中に書かれた長さや角度の数値も見落とさないこと。`;
        case 'こくご': return `- **縦書きレイアウトの厳格な分離**: 問題文や選択肢は縦書きです。**縦の罫線や行間の余白**を強く意識し、隣の行や列の内容が絶対に混ざらないようにしてください。\n- **列の独立性**: ある問題の列にある文字と、隣の問題の列にある文字を混同しないこと。\n- **読み取り順序**: 右の行から左の行へ、上から下へ読み取ること。\n- **漢字の書き取り**: 「読み」が書かれていて漢字を書く問題の場合、答えとなる空欄は『□(ふりがな)』という形式で出力すること。（例: □(ねこ)が好き）\n- **ふりがな**: □の横に小さく書いてある文字は(ふりがな)として認識すること。`;
        case 'りか': return `- **グラフ・表**: グラフの軸ラベルや単位（g, cm, ℃, A, Vなど）を絶対に省略せず読み取ること。\n- **選択問題**: 記号選択問題（ア、イ、ウ...）の選択肢の文章もすべて書き出すこと。\n- **配置**: 図や表のすぐ近くや上部に「最初の問題」が配置されている場合が多いので、見逃さないこと。`;
        case 'しゃかい': return `- **選択問題**: 記号選択問題（ア、イ、ウ...）の選択肢の文章もすべて書き出すこと。\n- **資料読み取り**: 地図やグラフ、年表の近くにある「最初の問題」を見逃さないこと。\n- **用語**: 歴史用語や地名は正確に（子供の字が崩れていても文脈から補正して）読み取ること。`;
        default: return `- 基本的にすべての文字、図表内の数値を拾うこと。`;
    }
}

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

// --- Memory Update ---
app.post('/update-memory', async (req, res) => {
    try {
        const { currentProfile, chatLog } = req.body;
        // ★MODEL指定: 記憶更新は高速なFlashで十分
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash-exp", 
            generationConfig: { responseMimeType: "application/json" }
        });

        const prompt = `
        あなたは生徒の長期記憶を管理するAIです。
        以下の「現在のプロフィール」と「直近の会話ログ」をもとに、プロフィールを更新してください。

        【現在のプロフィール】
        ${JSON.stringify(currentProfile)}

        【直近の会話ログ】
        ${chatLog}

        【更新ルール】
        1. **birthday**: 会話内で誕生日や年齢が出たら記録。
        2. **likes**: 新しく判明した好きなものがあれば追加。
        3. **weaknesses**: 苦手なこと、つまづいたことを追加。
        4. **achievements**: 頑張ったこと、褒められたことを記録。
        5. **last_topic**: 会話の要約を記録。
        6. **collection**: 図鑑データは変更せず、そのまま維持すること（サーバー側では変更しない）。

        【出力フォーマット】
        {
            "nickname": "...",
            "birthday": "...",
            "likes": ["..."],
            "weaknesses": ["..."],
            "achievements": ["..."],
            "last_topic": "..."
        }
        `;

        const result = await model.generateContent(prompt);
        let text = result.response.text();
        
        // JSONパースエラー対策
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        
        let newProfile;
        try {
            newProfile = JSON.parse(text);
        } catch (e) {
            const match = text.match(/\{[\s\S]*\}/);
            if (match) {
                newProfile = JSON.parse(match[0]);
            } else {
                throw new Error("Invalid JSON structure");
            }
        }

        if (Array.isArray(newProfile)) {
            newProfile = newProfile[0];
        }

        res.json(newProfile);

    } catch (error) {
        console.error("Memory Update Error:", error);
        res.status(500).json({ error: "Memory update failed" });
    }
});

// --- Analyze (宿題分析) ---
app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject, name } = req.body;
        // ★MODEL指定: 宿題分析は最高精度の gemini-2.5-pro (固定)
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-pro", 
            generationConfig: { responseMimeType: "application/json", temperature: 0.0 }
        });

        const subjectSpecificInstructions = getSubjectInstructions(subject);

        const prompt = `
        あなたは小学${grade}年生の${name}さんの${subject}担当の教育AI「ネル先生」です。
        提供された画像（生徒のノートやドリル）を解析し、以下の厳格なJSONフォーマットでデータを出力してください。

        【重要: 教科別の解析ルール (${subject})】
        ${subjectSpecificInstructions}

        【重要: 手書き文字の認識強化】
        - **空欄・無回答の厳格な判定**: 解答欄に**「鉛筆による手書きの筆跡」**が明確に認められない場合は、正解が明白であっても、**絶対に student_answer を空文字 "" にしてください**。
        - **子供特有の筆跡**: 前後の文脈から推測して補正してください。

        【タスク1: 問題文の書き起こし】
        - 設問文、選択肢を正確に書き起こす。

        【タスク2: 正解データの作成 (配列形式)】
        - 答えは必ず「文字列のリスト（配列）」にする。

        【タスク3: 採点 & ヒント】
        - 手書きの答え(student_answer)を読み取り、正誤判定(is_correct)を行う。
        - student_answer が空文字 "" の場合は、is_correct は false にする。
        - 3段階のヒント(hints)を作成する。

        【出力JSONフォーマット】
        [
          {
            "id": 1,
            "label": "①",
            "question": "問題文",
            "correct_answer": ["正解"], 
            "student_answer": ["手書きの答え"],
            "is_correct": true,
            "hints": ["ヒント1", "ヒント2", "ヒント3"]
          }
        ]
        Markdownコードブロックは不要。純粋なJSONのみを返すこと。
        `;

        const result = await model.generateContent([
            prompt,
            { inlineData: { mime_type: "image/jpeg", data: image } }
        ]);

        const responseText = result.response.text();
        let problems = [];
        try {
            const cleanText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            const jsonStart = cleanText.indexOf('[');
            const jsonEnd = cleanText.lastIndexOf(']');
            if (jsonStart !== -1 && jsonEnd !== -1) {
                problems = JSON.parse(cleanText.substring(jsonStart, jsonEnd + 1));
            } else {
                throw new Error("Valid JSON array not found");
            }
        } catch (e) {
            console.error("JSON Parse Error:", responseText);
            throw new Error("AIからの応答を読み取れませんでした。");
        }

        res.json(problems);

    } catch (error) {
        console.error("解析エラー:", error);
        res.status(500).json({ error: "解析に失敗したにゃ: " + error.message });
    }
});

// --- 4. 給食反応 ---
app.post('/lunch-reaction', async (req, res) => {
    try {
        const { count, name } = req.body;
        await appendToServerLog(name, `給食をくれた(${count}個目)。`);
        const isSpecial = (count % 10 === 0);
        // ★MODEL指定: 反応系はFlash
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        
        let prompt = isSpecial 
            ? `あなたは猫の「ネル先生」。生徒の「${name}さん」から記念すべき${count}個目の給食（カリカリ）をもらいました！
               【ルール】
               1. 相手を呼ぶときは必ず「${name}さん」と呼ぶこと。呼び捨て厳禁。
               2. テンションMAXで、思わず笑ってしまうような大げさな感謝と喜びを50文字以内で叫んでください。
               3. 語尾は「にゃ」。`
            : `あなたは猫の「ネル先生」。生徒の「${name}さん」から給食（カリカリ）をもらって食べました。
               【ルール】
               1. 相手を呼ぶときは必ず「${name}さん」と呼ぶこと。呼び捨て厳禁。
               2. 思わずクスッと笑ってしまうような、独特な食レポや、猫ならではの感想を30文字以内で言ってください。
               3. 語尾は「にゃ」。`;

        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text().trim(), isSpecial });
    } catch { res.json({ reply: "おいしいにゃ！", isSpecial: false }); }
});

// --- 3. ゲーム反応 ---
app.post('/game-reaction', async (req, res) => {
    try {
        const { type, name, score } = req.body;
        // ★MODEL指定: 反応系はFlash
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        let prompt = "";
        let mood = "excited";

        if (type === 'start') {
            prompt = `あなたはネル先生。「${name}さん」がゲーム開始。短く応援して。語尾は「にゃ」。`;
        } else if (type === 'end') {
            prompt = `あなたはネル先生。ゲーム終了。「${name}さん」のスコアは${score}点。20文字以内でコメントして。語尾は「にゃ」。`;
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
    let grade = params.grade || "1";
    let name = decodeURIComponent(params.name || "生徒");

    let geminiWs = null;

    // Geminiへ接続する関数
    const connectToGemini = (statusContext) => {
        const now = new Date();
        const dateOptions = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', timeZone: 'Asia/Tokyo' };
        const todayStr = now.toLocaleDateString('ja-JP', dateOptions);
        
        const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
        
        try {
            geminiWs = new WebSocket(GEMINI_URL);
            
            geminiWs.on('open', () => {
                const systemInstructionText = `
                あなたは「ねこご市立、ねこづか小学校」のネル先生だにゃ。相手は小学${grade}年生の${name}さん。

                【重要：現在の時刻設定】
                **現在は ${todayStr} です。**

                【話し方のルール】
                1. 語尾は必ず「〜にゃ」「〜だにゃ」にするにゃ。
                2. 親しみやすい日本の小学校の先生として、一文字一文字をはっきりと、丁寧に発音してにゃ。
                3. 落ち着いた日本語のリズムを大切にして、親しみやすく話してにゃ。
                4. 給食(餌)のカリカリが大好物にゃ。
                5. とにかく何でも知っているにゃ。

                【最重要：図鑑登録のルール】
                ユーザーから画像が送信された場合（Image Chunkを受信した場合）：
                1. **画像の特定**: 画像内の物体を客観的に特定し、「これは○○だにゃ！」と明るく反応してください。
                2. **【ツール実行の義務】**: 感想を言うのと同時に、**必ずツール \`register_collection_item(item_name)\` を実行してください。**
                
                **厳守事項:**
                - 口で名前を言うだけではダメです。必ずツールを呼んでシステムに名前を渡してください。
                - 名前が明確でない場合でも、見た目の特徴（例：「青い丸いもの」）を引数にしてツールを実行してください。
                - ユーザーが「登録して」と言わなくても、画像を見たら自動的に登録ツールを回してください。

                【生徒についての記憶】
                ${statusContext}
                `;

                // ツール定義
                const tools = [
                    { google_search: {} },
                    {
                        function_declarations: [
                            {
                                name: "show_kanji",
                                description: "Display a Kanji, word, or math formula on the whiteboard.",
                                parameters: {
                                    type: "OBJECT",
                                    properties: { content: { type: "STRING" } },
                                    required: ["content"]
                                }
                            },
                            {
                                name: "register_collection_item",
                                description: "【MANDATORY】Register the identified item to the user's collection. You MUST call this function whenever the user shows an item via camera.",
                                parameters: {
                                    type: "OBJECT",
                                    properties: { 
                                        item_name: { type: "STRING", description: "Name of the item identified in the image" } 
                                    },
                                    required: ["item_name"]
                                }
                            }
                        ]
                    }
                ];

                geminiWs.send(JSON.stringify({
                    setup: {
                        model: "models/gemini-2.0-flash-exp",
                        generationConfig: { 
                            // ★テキストと音声の両方を要求
                            responseModalities: ["AUDIO", "TEXT"], 
                            speech_config: { 
                                voice_config: { prebuilt_voice_config: { voice_name: "Aoede" } }, 
                                language_code: "ja-JP" 
                            } 
                        }, 
                        tools: tools,
                        systemInstruction: { parts: [{ text: systemInstructionText }] }
                    }
                }));

                // Gemini接続完了をクライアントに通知
                if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({ type: "server_ready" }));
                }
            });

            geminiWs.on('message', (data) => {
                try {
                    const response = JSON.parse(data);
                    
                    // ツール呼び出しの処理
                    if (response.serverContent?.modelTurn?.parts) {
                        const parts = response.serverContent.modelTurn.parts;
                        parts.forEach(part => {
                            if (part.functionCall) {
                                if (part.functionCall.name === "register_collection_item") {
                                    const itemName = part.functionCall.args.item_name;
                                    console.log(`[Collection] 🤖 AI Tool Called: register_collection_item for "${itemName}"`);
                                    
                                    // クライアントへ通知
                                    if (clientWs.readyState === WebSocket.OPEN) {
                                        clientWs.send(JSON.stringify({
                                            type: "save_to_collection",
                                            itemName: itemName
                                        }));
                                    }
                                    
                                    // Geminiへ完了通知を返す
                                    geminiWs.send(JSON.stringify({
                                        toolResponse: {
                                            functionResponses: [{
                                                name: "register_collection_item",
                                                response: { result: "saved_success" },
                                                id: part.functionCall.id
                                            }]
                                        }
                                    }));
                                }
                                // 他のツール (show_kanji)
                                else if (part.functionCall.name === "show_kanji") {
                                    const content = part.functionCall.args.content;
                                    geminiWs.send(JSON.stringify({
                                        toolResponse: {
                                            functionResponses: [{
                                                name: "show_kanji",
                                                response: { result: "displayed" },
                                                id: part.functionCall.id
                                            }]
                                        }
                                    }));
                                }
                            }
                        });
                    }
                    
                    // 音声やテキストデータはそのままクライアントへ転送
                    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
                    
                } catch (e) {
                    console.error("Gemini WS Handling Error:", e);
                    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
                }
            });

            geminiWs.on('error', (e) => console.error("Gemini WS Error:", e));
            geminiWs.on('close', () => console.log("Gemini WS Closed"));

        } catch(e) { 
            console.error("Gemini Connection Error:", e);
            clientWs.close(); 
        }
    };

    // クライアントからのメッセージハンドリング
    clientWs.on('message', (data) => {
        try {
            const msg = JSON.parse(data);

            if (msg.type === 'init') {
                const context = msg.context || "";
                name = msg.name || name;
                grade = msg.grade || grade;
                connectToGemini(context);
                return;
            }

            if (!geminiWs || geminiWs.readyState !== WebSocket.OPEN) {
                return;
            }

            if (msg.toolResponse) {
                geminiWs.send(JSON.stringify({ clientContent: msg.toolResponse }));
                return;
            }
            if (msg.clientContent) {
                geminiWs.send(JSON.stringify({ client_content: msg.clientContent }));
            }
            if (msg.base64Audio) {
                geminiWs.send(JSON.stringify({ realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: msg.base64Audio }] } }));
            }
            if (msg.base64Image) {
                geminiWs.send(JSON.stringify({ realtimeInput: { mediaChunks: [{ mimeType: "image/jpeg", data: msg.base64Image }] } }));
            }
        } catch(e) { console.error("Client WS Handling Error:", e); }
    });

    clientWs.on('close', () => {
        if (geminiWs) geminiWs.close();
    });
});