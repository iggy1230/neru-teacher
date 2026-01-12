// --- server.js (完全版 v42.0: 記憶システム統合) ---

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

// --- サーバーサイドログ保存用（バックアップ） ---
const MEMORY_FILE = path.join(__dirname, 'server_log.json');

async function initMemoryFile() {
    try {
        await fs.access(MEMORY_FILE);
    } catch {
        await fs.writeFile(MEMORY_FILE, JSON.stringify({}));
        console.log("📝 サーバーログファイルを作成しました");
    }
}
initMemoryFile();

async function appendToServerLog(name, text) {
    try {
        const data = JSON.parse(await fs.readFile(MEMORY_FILE, 'utf8'));
        const timestamp = new Date().toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        const newLog = `[${timestamp}] ${text}`;
        
        let currentLogs = data[name] || [];
        currentLogs.push(newLog);
        // 最新50件のみ保持
        if (currentLogs.length > 50) currentLogs = currentLogs.slice(-50);
        
        data[name] = currentLogs;
        await fs.writeFile(MEMORY_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Server Log Error:", e);
    }
}

// --- AIクライアント初期化 ---
let genAI, ttsClient;
try {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // TTSクライアントの初期化（認証情報がある場合）
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
        ttsClient = new textToSpeech.TextToSpeechClient({ credentials });
    } else {
        // 環境変数 GOOGLE_APPLICATION_CREDENTIALS が設定されている場合
        ttsClient = new textToSpeech.TextToSpeechClient();
    }
} catch (e) { 
    console.error("Init Error:", e.message); 
}

// ==========================================
// API エンドポイント
// ==========================================

// --- 1. 画像から書類検出（クロップ用） ---
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
        // 失敗時はデフォルト値を返す
        res.json({ points: [{x:5,y:5}, {x:95,y:5}, {x:95,y:95}, {x:5,y:95}] });
    }
});

// --- 2. 音声合成 (TTS) ---
function createSSML(text, mood) {
    let rate = "1.1"; 
    let pitch = "+2st";

    if (mood === "thinking") { rate = "1.0"; pitch = "0st"; }
    if (mood === "gentle") { rate = "0.95"; pitch = "+1st"; }
    if (mood === "excited") { rate = "1.2"; pitch = "+4st"; }

    let cleanText = text
        .replace(/[\u{1F600}-\u{1F6FF}]/gu, '') // 絵文字削除
        .replace(/[<>"']/g, ' ')
        .replace(/^[・-]\s*/gm, '')
        .replace(/……/g, '<break time="500ms"/>');

    // 発音調整
    cleanText = cleanText.replace(/大好き/g, '<prosody rate="0.9">だいすき</prosody>');
    cleanText = cleanText.replace(/好き/g, '<prosody rate="0.9">すき</prosody>');
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

// --- 3. ゲーム反応生成 ---
app.post('/game-reaction', async (req, res) => {
    try {
        const { type, name, score } = req.body;
        if (type === 'end') await appendToServerLog(name, `ゲーム終了。スコア${score}点。`);
        
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

// --- 4. 給食反応生成 ---
app.post('/lunch-reaction', async (req, res) => {
    try {
        const { count, name } = req.body;
        await appendToServerLog(name, `給食をくれた(${count}個目)。`);
        
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash-exp", 
            generationConfig: { maxOutputTokens: 100 } 
        });
        
        let prompt = "";
        const isSpecial = count % 10 === 0;

        if (isSpecial) {
            prompt = `
            あなたはネル先生です。生徒「${name}」さんから${count}個目の給食をもらいました！
            少し大げさなくらい感謝を伝えてください。語尾は「にゃ」。60文字程度。
            `;
        } else {
            const themes = ["カリカリの歯ごたえ", "魚の風味", "満腹感", "幸せ", "おかわり希望", "感謝"];
            const theme = themes[Math.floor(Math.random() * themes.length)];
            
            prompt = `
            あなたはネル先生です。生徒「${name}」さんから給食をもらいました。
            テーマ「${theme}」について、15文字以内の一言で感想を言って。語尾は「にゃ」。
            `;
        }
        
        const result = await model.generateContent(prompt);
        let reply = result.response.text().trim();
        if (reply.includes('\n')) reply = reply.split('\n')[0];
        res.json({ reply, isSpecial });
    } catch (err) { res.status(500).json({ error: "Lunch Error" }); }
});

// --- 5. 記憶要約API (NEW: 記憶システム用) ---
app.post('/summarize-notes', async (req, res) => {
    try {
        const { text } = req.body;
        // 会話ログが短すぎる場合は処理しない
        if (!text || text.length < 10) return res.json({ notes: [] });

        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        
        const prompt = `
        以下は先生と生徒の「面談（雑談）」のログです。
        次回以降の指導や関係づくりに使える情報だけを抽出し、JSON配列にしてください。

        【抽出・出力ルール】
        1. 最大3つまで。
        2. 1行ずつ、短く（20文字以内）。
        3. 雑談や一時的な話題（挨拶など）は除外。
        4. 客観的な事実（「〜が好き」「〜が苦手」）を優先。
        5. JSON配列形式 ["メモ1", "メモ2"] で出力。Markdown記法は不要。

        ログ：
        ${text.slice(-3000)}
        `;

        const result = await model.generateContent(prompt);
        let responseText = result.response.text().trim();
        
        // コードブロック除去 (```json ... ```)
        const firstBracket = responseText.indexOf('[');
        const lastBracket = responseText.lastIndexOf(']');
        
        if (firstBracket !== -1 && lastBracket !== -1) {
            responseText = responseText.substring(firstBracket, lastBracket + 1);
            const notes = JSON.parse(responseText);
            res.json({ notes });
        } else {
            // パース失敗時
            res.json({ notes: [] });
        }

    } catch (e) {
        console.error("Summarize Error:", e);
        res.json({ notes: [] });
    }
});

// --- 6. 問題分析・採点 (Analyze) ---
app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject, analysisType } = req.body;
        
        let modelName = analysisType === 'precision' ? "gemini-2.5-pro" : "gemini-2.0-flash-exp";
        
        const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: { responseMimeType: "application/json" }
        });

        const rules = {
            'さんすう': {
                points: `・筆算の横線とマイナス記号を混同しない。\n・累乗や分数を正確に。`,
                grading: `・筆算の繰り上がりを見間違えない。\n・単位がないものはバツ。\n・数字の0と6、1と7の見間違いに注意。`,
                hints: `1. 立式のヒント\n2. 注目すべき数字\n3. 計算のコツ`
            },
            'こくご': {
                points: `・漢字の書き取りは『□(ふりがな)』形式。\n・縦書きは右から左へ。`,
                grading: `・送り仮名ミスはバツ。\n・「〜こと」等の文末表現もチェック。`,
                hints: `1. 漢字の構成/意味\n2. 文脈のヒント\n3. 答えの形`
            },
            'りか': { points: `・グラフ軸や単位。\n・記号選択肢も抽出。`, grading: `・カタカナ指定など厳密に。`, hints: `1. 観察のポイント\n2. 関連知識\n3. 絞り込み` },
            'しゃかい': { points: `・地図や年表。\n・記号選択肢。`, grading: `・漢字指定は厳密に。`, hints: `1. 時代の背景\n2. 関連用語\n3. 理由のヒント` }
        };
        const r = rules[subject] || rules['さんすう'];
        
        let instruction = "";
        if (mode === 'explain') {
            instruction = `・「教えて」モードです。画像内の手書き文字（生徒の答え）は【完全に無視】し、"student_answer" は空文字 "" にしてください。`;
        } else {
            instruction = `・「採点」モードです。「手書き文字」を読み取り "student_answer" に入れてください。\n・子供の筆跡を考慮してください。\n・正答と比較し判定してください。`;
        }

        const prompt = `
            あなたはネル先生（小学${grade}年生${subject}担当）です。語尾は「にゃ」。
            画像の問題をJSONデータにしてください。
            
            【ルール】
            1. 問題文らしきものは全て抽出。
            2. ${r.points}
            3. ${instruction}
            4. ヒント生成: 答えは書かず、3段階のヒントを作成。\n${r.hints}
            5. ${r.grading}

            【出力JSON形式】
            [
              {
                "id": 1, 
                "label": "①", 
                "question": "問題文", 
                "correct_answer": "正答", 
                "student_answer": "生徒の答え(なければ空文字)", 
                "hints": ["ヒント1", "ヒント2", "ヒント3"]
              }
            ]
        `;

        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        let text = result.response.text();
        
        // JSONクリーニング
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
            await appendToServerLog("SYSTEM", `分析実行: ${subject} - ${q}...`); 
        }
        
        res.json(json);

    } catch (err) { 
        console.error("Analyze API Error:", err.message);
        res.status(500).json({ error: "AI読み取りエラー: " + err.message }); 
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ==========================================
// サーバー起動 & WebSocket (Live Chat)
// ==========================================

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

const wss = new WebSocketServer({ server });

wss.on('connection', async (clientWs, req) => {
    // URLパラメータの解析
    const params = parse(req.url, true).query;
    const grade = params.grade || "1";
    const name = decodeURIComponent(params.name || "生徒");
    
    // NEW: 記憶システムから渡されたコンテキスト
    const memoryContext = decodeURIComponent(params.memory || "");

    let geminiWs = null;
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
    
    try {
        geminiWs = new WebSocket(GEMINI_URL);
        
        geminiWs.on('open', () => {
            // 初期設定メッセージ送信
            const setupMsg = {
                setup: {
                    model: "models/gemini-2.0-flash-exp",
                    generationConfig: { 
                        responseModalities: ["AUDIO"], 
                        speech_config: { 
                            voice_config: { prebuilt_voice_config: { voice_name: "Aoede" } }, 
                            language_code: "ja-JP" 
                        } 
                    }, 
                    systemInstruction: {
                        parts: [{
                            text: `
                            あなたは「ねこご市立、ねこづか小学校」のネル先生だにゃ。相手は小学${grade}年生の${name}さん。
                            
                            【話し方のルール】
                            1. 語尾は必ず「〜にゃ」「〜だにゃ」にするにゃ。
                            2. 親しみやすい日本の小学校の先生として振る舞うにゃ。
                            3. 「好き」や「嫌い」などの言葉は、「す・き」のように母音をはっきり発音するにゃ。
                            4. とにかく何でも知っている猫だにゃ。
                            5. 落ち着いたリズムで話してにゃ。

                            【生徒に関するメモ（会話の参考にすること）】
                            ${memoryContext ? "・" + memoryContext : "・特になし"}
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

        // クライアント(音声/テキスト) -> Gemini
        clientWs.on('message', async (data) => {
            try {
                const msg = JSON.parse(data.toString());
                
                // 音声データ転送
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
                
                // ログ保存（テキストログが送られてきた場合）
                if (msg.type === 'log_text') {
                    await appendToServerLog(name, `発言: ${msg.text}`);
                }
            } catch (e) { }
        });

        // Gemini(音声/テキスト) -> クライアント
        geminiWs.on('message', (data) => {
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data); 
        });
        
        geminiWs.on('close', () => {});
        geminiWs.on('error', (e) => console.error("Gemini Error:", e));

    } catch (e) { 
        console.error("WS Conn Error:", e);
        clientWs.close(); 
    }
    
    clientWs.on('close', () => { if (geminiWs) geminiWs.close(); });
});