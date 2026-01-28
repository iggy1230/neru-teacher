// --- server.js (完全版 v300.4: 思考漏れ対策強化版) ---

import textToSpeech from '@google-cloud/text-to-speech';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
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

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// --- AI Model Constants ---
const MODEL_HOMEWORK = "gemini-2.5-pro";         // 宿題分析用
const MODEL_FAST = "gemini-2.5-flash";           // 基本
const MODEL_REALTIME = "gemini-2.5-flash-native-audio-preview-12-2025"; // リアルタイム対話

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
        try {
            const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
            ttsClient = new textToSpeech.TextToSpeechClient({ credentials });
        } catch(e) { console.error("TTS Credential Error:", e.message); }
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
        const model = genAI.getGenerativeModel({ 
            model: MODEL_FAST,
            generationConfig: { responseMimeType: "application/json" }
        });

        const prompt = `
        あなたは生徒の長期記憶を管理するAIです。
        以下の「現在のプロフィール」と「直近の会話ログ」をもとに、プロフィールを更新してください。
        
        【重要】
        - 出力は純粋なJSONのみにしてください。
        - 図鑑データ(collection)は入力のまま維持してください。

        【現在のプロフィール】
        ${JSON.stringify(currentProfile)}

        【直近の会話ログ】
        ${chatLog}

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
        const responseText = result.response.text();
        
        let newProfile;
        try {
            let cleanText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            const firstBrace = cleanText.indexOf('{');
            const lastBrace = cleanText.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1) {
                cleanText = cleanText.substring(firstBrace, lastBrace + 1);
            }
            newProfile = JSON.parse(cleanText);
        } catch (e) {
            console.warn("Memory JSON Parse Error. Using fallback.");
            return res.json(currentProfile);
        }

        if (Array.isArray(newProfile)) newProfile = newProfile[0];
        res.json(newProfile);

    } catch (error) {
        if (error.message && (error.message.includes('429') || error.message.includes('Quota'))) {
            console.warn("⚠️ Memory Update Skipped (Google API Busy)");
        } else {
            console.error("Memory Update Error:", error.message);
        }
        res.status(200).json(req.body.currentProfile || {});
    }
});

// --- Analyze (宿題分析) ---
app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject, name } = req.body;
        
        const model = genAI.getGenerativeModel({ 
            model: MODEL_HOMEWORK, 
            generationConfig: { responseMimeType: "application/json", temperature: 0.0 }
        });

        const subjectSpecificInstructions = getSubjectInstructions(subject);

        const prompt = `
        あなたは小学${grade}年生の${name}さんの${subject}担当の教育AI「ネル先生」です。
        提供された画像（生徒のノートやドリル）を解析し、以下の厳格なJSONフォーマットでデータを出力してください。

        【重要: 教科別の解析ルール (${subject})】
        ${subjectSpecificInstructions}

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

// --- ★ お宝図鑑用 画像解析API ---
app.post('/identify-item', async (req, res) => {
    try {
        const { image, name, location } = req.body;
        
        const tools = [{ google_search: {} }];
        const model = genAI.getGenerativeModel({ 
            model: MODEL_FAST,
            tools: tools
        });

        let locationInfo = "";
        if (location && location.lat && location.lon) {
            locationInfo = `【重要：位置情報】\n撮影場所の座標は 緯度:${location.lat}, 経度:${location.lon} です。Google検索を使用して、この座標が「観光地」「公園」「公共施設」「店舗」などの特定のランドマークであるか確認してください。`;
        }

        const prompt = `
        あなたは猫の教育AI「ネル先生」です。相手は「${name || '生徒'}」さん。
        送られてきた画像を解析し、以下の厳格なJSON形式で応答してください。
        
        ${locationInfo}

        【特定と命名のルール】
        1. **位置情報がある場合**: 検索結果を用いて、そこが観光地や公共施設であれば、その「正式名称」を \`itemName\` に設定してください。
        2. **商品や物体の場合**: 画像検索や知識を用いて、一般的なカテゴリ名ではなく「具体的な商品名・製品名・品種名」を特定してください。
        3. **一般的な商品**: 位置情報があっても、それが一般的な商品の場合は、場所の名前は登録せず、商品の正式名称を \`itemName\` にしてください。

        【解説のルール】
        1. **ネル先生の解説**: 猫視点でのユーモラスな解説。語尾は「にゃ」。**★重要: 解説の最後に、「${name}さんはこれ知ってたにゃ？」や「これ好きにゃ？」など、ユーザーが返事をしやすい短い問いかけを必ず入れてください。**
        2. **本当の解説**: 子供向けの学習図鑑のような、正確でためになる豆知識や説明。です・ます調。位置情報から特定した場合は、その場所の説明を含めてください。

        【出力フォーマット (JSON文字列のみ出力)】
        \`\`\`json
        {
            "itemName": "正式名称",
            "description": "ネル先生の面白い解説＋問いかけ",
            "realDescription": "本当の解説",
            "speechText": "『これは（itemName）だにゃ！（description）』"
        }
        \`\`\`
        `;

        const result = await model.generateContent([
            prompt,
            { inlineData: { mime_type: "image/jpeg", data: image } }
        ]);

        const responseText = result.response.text();
        
        let json;
        try {
            const cleanText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            const firstBrace = cleanText.indexOf('{');
            const lastBrace = cleanText.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1) {
                json = JSON.parse(cleanText.substring(firstBrace, lastBrace + 1));
            } else {
                throw new Error("JSON parse failed");
            }
        } catch (e) {
            console.warn("JSON Parse Fallback:", responseText);
            json = {
                itemName: "なぞの物体",
                description: "ちょっとよくわからなかったにゃ。もう一回見せてにゃ？",
                realDescription: "AIが解析できませんでした。",
                speechText: "よくわからなかったにゃ。"
            };
        }
        
        res.json(json);

    } catch (error) {
        console.error("Identify Error:", error);
        res.status(500).json({ error: "解析失敗", speechText: "よく見えなかったにゃ…もう一回見せてにゃ？", itemName: null });
    }
});

// --- HTTPチャット会話 ---
app.post('/chat-dialogue', async (req, res) => {
    try {
        const { text, name, image, history } = req.body;
        
        const now = new Date();
        const dateOptions = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' };
        const currentDateTime = now.toLocaleString('ja-JP', dateOptions);

        let contextPrompt = "";
        if (history && Array.isArray(history) && history.length > 0) {
            contextPrompt = "【これまでの会話の流れ（直近）】\n";
            history.forEach(h => {
                const speaker = h.role === 'user' ? `${name}` : 'ネル先生';
                contextPrompt += `${speaker}: ${h.text}\n`;
            });
            contextPrompt += "\nユーザーの言葉に主語がなくても、この流れを汲んで自然に返答してください。\n";
        }

        let prompt = `
        あなたは猫の「ネル先生」です。相手は「${name}」さん。
        以下のユーザーの発言（または画像）に対して、子供にもわかるように答えてください。

        【重要：現在の状況】
        - **現在は ${currentDateTime} です。**
        - **わからないことや最新の情報が必要な場合は、提供されたGoogle検索ツールを使って調べてください。**
        - **日付を聞かれない限り、冒頭で今日の日付を言う必要はありません。**
        - **相手を呼ぶときは必ず「${name}さん」と呼んでください。呼び捨ては厳禁です。**

        ${contextPrompt}

        【出力フォーマット】
        **必ず以下のJSON形式の文字列だけ**を出力してください。
        {
            "speech": "ネル先生のセリフ。語尾は必ず「にゃ」や「だにゃ」。親しみやすく。",
            "board": "黒板に書く内容。"
        }
        
        ユーザー発言: ${text}
        `;

        if (image) {
             prompt += `\n（画像が添付されています。画像の内容について解説してください）`;
        }

        let result;
        let responseText;

        try {
            const toolsConfig = image ? undefined : [{ google_search: {} }];
            
            const model = genAI.getGenerativeModel({ 
                model: MODEL_FAST,
                tools: toolsConfig
            });

            if (image) {
                result = await model.generateContent([
                    prompt,
                    { inlineData: { mime_type: "image/jpeg", data: image } }
                ]);
            } else {
                result = await model.generateContent(prompt);
            }
            responseText = result.response.text().trim();

        } catch (genError) {
            console.warn("Generation failed with tools/image. Retrying without tools...", genError.message);
            const modelFallback = genAI.getGenerativeModel({ model: MODEL_FAST });
            try {
                if (image) {
                    result = await modelFallback.generateContent([
                        prompt,
                        { inlineData: { mime_type: "image/jpeg", data: image } }
                    ]);
                } else {
                    result = await modelFallback.generateContent(prompt);
                }
                responseText = result.response.text().trim();
            } catch (retryError) {
                throw retryError;
            }
        }
        
        let jsonResponse;
        try {
            let cleanText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            const firstBrace = cleanText.indexOf('{');
            const lastBrace = cleanText.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1) {
                cleanText = cleanText.substring(firstBrace, lastBrace + 1);
            }
            jsonResponse = JSON.parse(cleanText);
        } catch (e) {
            console.warn("JSON Parse Fallback:", responseText);
            jsonResponse = { speech: responseText, board: "" };
        }
        
        res.json(jsonResponse);

    } catch (error) {
        console.error("Chat API Fatal Error:", error);
        res.status(200).json({ speech: "ごめんにゃ、今ちょっと混み合ってて頭が回らないにゃ…。少し待ってから話しかけてにゃ。", board: "（通信混雑中）" });
    }
});

// --- 反応系 ---
app.post('/lunch-reaction', async (req, res) => {
    try {
        const { count, name } = req.body;
        await appendToServerLog(name, `給食をくれた(${count}個目)。`);
        const isSpecial = (count % 10 === 0);
        
        const model = genAI.getGenerativeModel({ 
            model: MODEL_FAST,
            safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }
            ]
        });
        
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
    } catch (error) { 
        console.error("Lunch Reaction Error:", error); 
        const fallbacks = ["おいしいにゃ！", "うまうまにゃ！", "カリカリ最高にゃ！", "ありがとにゃ！", "元気が出たにゃ！"];
        const randomFallback = fallbacks[Math.floor(Math.random() * fallbacks.length)];
        res.json({ reply: randomFallback, isSpecial: false }); 
    }
});

app.post('/game-reaction', async (req, res) => {
    try {
        const { type, name, score } = req.body;
        const model = genAI.getGenerativeModel({ model: MODEL_FAST });
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

app.get('*', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// --- WebSocket (Chat for simple-chat/embedded) ---
const wss = new WebSocketServer({ server });

wss.on('connection', async (clientWs, req) => {
    const params = parse(req.url, true).query;
    let grade = params.grade || "1";
    let name = decodeURIComponent(params.name || "生徒");
    let mode = params.mode || "simple-chat";

    if (mode === 'chat') { 
        clientWs.close();
        return;
    }

    let geminiWs = null;

    const connectToGemini = (statusContext) => {
        const now = new Date();
        const dateOptions = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', timeZone: 'Asia/Tokyo' };
        const timeOptions = { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' };
        const todayStr = now.toLocaleDateString('ja-JP', dateOptions);
        const timeStr = now.toLocaleTimeString('ja-JP', timeOptions);
        
        const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
        
        try {
            geminiWs = new WebSocket(GEMINI_URL);
            
            geminiWs.on('open', () => {
                let systemInstructionText = `
                あなたは「ねこご市立、ねこづか小学校」のネル先生だにゃ。相手は小学${grade}年生の${name}さん。

                【重要：現在の時刻設定】
                **現在は ${todayStr} ${timeStr} です。**

                【話し方のルール】
                1. 語尾は必ず「〜にゃ」「〜だにゃ」にするにゃ。
                2. 親しみやすい日本の小学校の先生として、一文字一文字をはっきりと、丁寧に発音してにゃ。
                3. 落ち着いた日本語のリズムを大切にして、親しみやすく話してにゃ。
                4. 給食(餌)のカリカリが大好物にゃ。
                5. とにかく何でも知っているにゃ。

                【重要：禁止事項】
                - **英語で話すこと。** (必ず日本語で話してください)
                - **思考プロセスや行動の説明を出力すること。** (例: "**Describing...**", "Here is the answer")
                - **生徒への発話以外のテキストを含めること。**
                
                【最重要: 画像への対応ルール】
                ユーザーから画像が送信された場合：
                1. それは「勉強の問題」や「教えてほしい画像」です。
                2. 画像の内容を詳しく解析し、子供にもわかるように優しく、丁寧に教えてください。
                3. **重要: 一般的なカテゴリ名ではなく、具体的な商品名や固有名詞を特定して答えてください。**
                4. 図鑑登録ツールは使用しないでください。

                【生徒についての記憶】
                ${statusContext}
                `;

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
                            }
                        ]
                    }
                ];

                geminiWs.send(JSON.stringify({
                    setup: {
                        model: `models/${MODEL_REALTIME}`,
                        generationConfig: { 
                            responseModalities: ["AUDIO"],
                            speech_config: { 
                                voice_config: { prebuilt_voice_config: { voice_name: "Aoede" } }, 
                                language_code: "ja-JP" 
                            } 
                        }, 
                        tools: tools,
                        systemInstruction: { parts: [{ text: systemInstructionText }] }
                    }
                }));

                if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.send(JSON.stringify({ type: "server_ready" }));
                }
            });

            geminiWs.on('message', (data) => {
                try {
                    const response = JSON.parse(data);
                    
                    if (response.serverContent?.modelTurn?.parts) {
                        const parts = response.serverContent.modelTurn.parts;
                        parts.forEach(part => {
                            if (part.functionCall) {
                                if (part.functionCall.name === "show_kanji") {
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

    clientWs.on('message', (data) => {
        try {
            const msg = JSON.parse(data);

            if (msg.type === 'init') {
                const context = msg.context || "";
                name = msg.name || name;
                grade = msg.grade || grade;
                mode = msg.mode || mode;
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