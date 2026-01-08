import textToSpeech from '@google-cloud/text-to-speech';
import { GoogleGenerativeAI } from "@google/generative-ai";
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket, { WebSocketServer } from 'ws';
import { parse } from 'url';
import dotenv from 'dotenv';

// .envファイルを読み込む
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(cors());
// 画像データが大きい場合に対応するため制限を緩和
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '.')));

// API初期化
let genAI, ttsClient;
try {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // Google Cloud TTSの初期化
    // 環境変数 GOOGLE_CREDENTIALS_JSON がある場合はそれを使用
    // ない場合はデフォルトの認証（ADC）または keyFilename を想定
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

// --- 音声合成 (SSML) ---
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
        // 最新・高速モデル
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        let prompt = "";
        let mood = "excited";

        if (type === 'start') {
            prompt = `
            あなたは「ねこご市立ねこづか小学校」のネル先生です。
            生徒「${name}」さんがゲームを開始します。
            「${name}さん！カリカリいっぱいゲットしてにゃ！」とだけ言ってください。余計な言葉は不要。
            `;
        } else if (type === 'end') {
            prompt = `
            あなたはネル先生です。ゲーム終了。スコア${score}個(最大20)。
            スコアに応じて褒めるか励ましてください。
            【厳守】20文字以内。語尾「にゃ」。絵文字禁止。
            `;
        } else {
            prompt = `
            ネル先生の実況。状況: ${type}。
            【厳守】
            - 「うまい！」「あぶない！」「すごい！」など、5〜8文字程度の単語レベルで叫んでください。
            - 語尾「にゃ」。
            - 1フレーズのみ。
            `;
        }

        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text().trim(), mood: mood });
    } catch (err) {
        res.json({ reply: "がんばれにゃ！", mood: "excited" });
    }
});

// --- 給食リアクションAPI ---
app.post('/lunch-reaction', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { count, name } = req.body;
        
        // 高速モデル + トークン制限
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            generationConfig: { maxOutputTokens: 60 } 
        });

        let prompt = "";
        const isSpecial = count % 10 === 0;

        if (isSpecial) {
            prompt = `
            あなたはネル先生です。生徒「${name}」から記念すべき${count}個目の給食をもらいました！
            ものすごく喜び、${name}さん（または${name}さま）への感謝を60文字程度で熱く語ってください。
            普段とは違う特別なリアクションをしてください。語尾は「にゃ」。
            `;
        } else {
            const themes = ["味を絶賛", "食感", "幸せ", "栄養", "もっと欲しい"];
            const theme = themes[Math.floor(Math.random() * themes.length)];
            prompt = `ネル先生として給食のカリカリを食べた一言感想。テーマ:${theme}。15文字以内。語尾にゃ。`;
        }

        const result = await model.generateContent(prompt);
        let reply = result.response.text().trim();
        if (!isSpecial && reply.includes('\n')) reply = reply.split('\n')[0];
        res.json({ reply, isSpecial });
    } catch (err) { res.status(500).json({ error: "Lunch Error" }); }
});

// --- チャットAPI (テキストのみの場合) ---
app.post('/chat', async (req, res) => {
    try {
        const { message, grade, name } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `あなたは「ネル先生」。相手は小学${grade}年生「${name}」。30文字以内、語尾「にゃ」。絵文字禁止。発言: ${message}`;
        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text() });
    } catch (err) { res.status(500).json({ error: "Chat Error" }); }
});

// --- 記憶要約API (使わない場合もあるが残しておく) ---
app.post('/summarize-chat', async (req, res) => {
    try {
        const { transcript } = req.body;
        if (!transcript || transcript.length < 10) return res.json({ summary: "" });
        
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `
        以下の生徒との会話内容を、次に会った時に話題にできるように、50文字以内で要約して「記憶」として出力してください。
        重要なキーワード（好きなもの、悩み、頑張ったこと）を残してください。
        
        【会話内容】
        ${transcript}`;
        
        const result = await model.generateContent(prompt);
        res.json({ summary: result.response.text().trim() });
    } catch (err) { res.json({ summary: "" }); }
});

// --- ★画像分析API (モード切り替え対応) ---
app.post('/analyze', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { image, mode, grade, subject, analysisType } = req.body;
        
        // ★モデル切り替えロジック
        let modelName = "gemini-2.5-flash"; // 高速モード (標準)
        if (analysisType === 'precision') {
            modelName = "gemini-2.5-pro"; // 精密モード (高精度)
        }

        const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: { responseMimeType: "application/json" }
        });

        // 教科別ルール
        const rules = {
            'さんすう': {
                attention: `・筆算の横線とマイナス記号を混同しないこと。\n・累乗（2^2など）や分数を正確に。`,
                hints: `
                  1. ヒント1（立式）: 「何算を使えばいいか」のヒント（例：全部でいくつ？と聞かれているから足し算にゃ）。
                  2. ヒント2（注目点）: 「単位のひっかけ」や「図の数値」への誘導（例：cmをmに直すのを忘れてないかにゃ？）。
                  3. ヒント3（計算のコツ）: 「計算の工夫」や「最終確認」（例：一の位から順番に計算してみるにゃ）。`,
                grading: `
                  ・筆算の繰り上がりを「答え」と見間違えないように注意してにゃ。
                  ・単位（cm, Lなど）が問題で指定されている場合、単位がないものはバツにしてにゃ。
                  ・数字の「0」と「6」、「1」と「7」の見間違いに注意して、慎重に判定してにゃ。`
            },
            'こくご': {
                attention: `
                【最重要：縦書きレイアウトと書き起こしルール】
                1. 縦書き認識: この画像は縦書きです。必ず「右上」からスタートし、「丸数字の真下」にある文章を垂直方向に読み進めてください。行が終わったら左の列へ移動します。
                2. 問題の分離: 丸数字（①, ②...）は新しい問題の開始合図です。
                3. 【絶対ルール】書き起こしフォーマット
                   - 解答すべき空欄（□）は、必ず『□(読み仮名)』という形式で書き起こしてください。
                   - 漢字がすでに印刷されている部分は、そのまま漢字で記述してください。
                `,
                hints: `
                  【漢字の書き取り問題の場合】
                  1. ヒント1: 「漢字のなりたち」を教える
                  2. ヒント2: 「辺や部首や画数」を教える
                  3. ヒント3: 「似た漢字」を教える
                  
                  【読解問題の場合】
                  1. ヒント1: 答えが文章のどのあたりにあるか
                  2. ヒント2: 注目すべき言葉
                  3. ヒント3: 文末の指定`,
                grading: `
                  ・送り仮名のミスはバツだにゃ。
                  ・読解問題は、指定された文字数や文末（〜こと、〜から）が合っているかもチェックするにゃ。`
            },
            'りか': {
                attention: `・グラフの軸ラベルや単位（g, cm, ℃など）を落とさないこと。\n・記号選択問題（ア、イ、ウ）の選択肢も書き出すこと。\n・最初の問題が図や表と似た位置にある場合があるので見逃さないこと。`,
                hints: `
                  1. ヒント1（観察）: 「図や表のどこを見るか」（例：グラフが急に上がっているところを探してみてにゃ）。
                  2. ヒント2（関連知識）: 「習った言葉の想起」（例：この実験で使った、あの青い液体の名前は何だったかにゃ？）。
                  3. ヒント3（絞り込み）: 「選択肢のヒント」や「最初の1文字」（例：『平』から始まる4文字の時代にゃ）。`,
                grading: `
                  ・カタカナ指定（例：ジョウロ、アルコールランプ）をひらがなで書いていたらバツにしてにゃ。
                  ・グラフの描画問題は、点が正しい位置にあるか、線が真っ直ぐかを厳しく判定してにゃ。`
            },
            'しゃかい': {
                attention: `・グラフの軸ラベルや単位（g, cm, ℃など）を落とさないこと。\n・記号選択問題（ア、イ、ウ）の選択肢も書き出すこと。\n・最初の問題が図や表と似た位置にある場合があるので見逃さないこと。`,
                hints: `
                  1. ヒント1（観察）: 「図や表のどこを見るか」（例：グラフが急に上がっているところを探してみてにゃ）。
                  2. ヒント2（関連知識）: 「習った言葉の想起」（例：この実験で使った、あの青い液体の名前は何だったかにゃ？）。
                  3. ヒント3（絞り込み）: 「選択肢のヒント」や「最初の1文字」（例：『平』から始まる4文字の時代にゃ）。`,
                grading: `
                  ・漢字指定の用語（例：都道府県名）をひらがなで書いていたらバツにゃ。
                  ・時代背景が混ざっていないか（例：江戸時代なのに「士農工商」など）に注意してにゃ。`
            }
        };
        const r = rules[subject] || rules['さんすう'];
        const baseRole = `あなたは「ねこご市立ねこづか小学校」のネル先生です。小学${grade}年生の「${subject}」担当です。語尾は「にゃ」。`;

        const studentAnswerInstruction = mode === 'explain' 
            ? `・画像内の手書き文字（生徒の答え）は【完全に無視】してください。\n・出力JSONの "student_answer" は空文字 "" にしてください。`
            : `・採点のため、生徒の手書き文字を可能な限り読み取り、出力JSONの "student_answer" に入れてください。`;

        const prompt = `
            ${baseRole}
            
            【タスク】
            提供された画像を分析し、JSONデータを出力してください。

            【書き起こし・抽出の絶対ルール】
            1. 画像全体を解析し、大問・小問番号を含めてすべての問題を漏らさず抽出してください。
            2. 【超重要】「解答欄（□、括弧、下線、空欄）」が存在しないテキストは、問題（question）として出力しないでください。
            3. ${studentAnswerInstruction}
            4. １つの問いの中に複数の回答が必要なときは、JSONデータの要素を分けてください。
            5. 教科別注意（特に重要）: ${r.attention}

            【ヒント生成ルール（答えのネタバレ厳禁）】
            以下の指針に従い、3段階のヒントを作成してください。
            ⚠️重要: ヒント3であっても、「正解の漢字そのもの」や「答えの単語」は絶対に含まないでください。
            ${r.hints}

            【出力フォーマット (JSONのみ)】
            [
              {
                "id": 1,
                "label": "①", 
                "question": "問題文 (国語書き取りは『□(ふりがな)』形式)",
                "correct_answer": "正解 (必須)",
                "student_answer": "",
                "hints": ["ヒント1", "ヒント2", "ヒント3"]
              }
            ]
            ${mode === 'grade' ? `【採点基準】\n${r.grading}` : ''}
        `;

        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        let textResponse = result.response.text();

        // JSON抽出ロジック
        const firstBracket = textResponse.indexOf('[');
        const lastBracket = textResponse.lastIndexOf(']');
        
        if (firstBracket !== -1 && lastBracket !== -1) {
            textResponse = textResponse.substring(firstBracket, lastBracket + 1);
        } else {
            console.error("Invalid JSON format from Gemini:", textResponse);
            throw new Error("AIが有効なデータを生成できませんでした。");
        }

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

// --- ★Live API Proxy (Aoede) ---
// WebSocketで「会話の記憶」を注入し、過去のことを全て覚えさせる
const wss = new WebSocketServer({ server });
wss.on('connection', (clientWs, req) => {
    // クエリパラメータから情報を取得
    const parameters = parse(req.url, true).query;
    const userGrade = parameters.grade || "1";
    const userName = decodeURIComponent(parameters.name || "");
    // ★ここが重要：クライアントから送られてきた「過去の全会話ログ」
    const userMemory = decodeURIComponent(parameters.memory || "まだ会話していない");

    let geminiWs = null;
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
    
    try {
        geminiWs = new WebSocket(GEMINI_URL);
        geminiWs.on('open', () => {
            // 初期設定送信
            geminiWs.send(JSON.stringify({
                setup: {
                    model: "models/gemini-2.0-flash-exp",
                    generation_config: { 
                        response_modalities: ["AUDIO"], 
                        speech_config: { 
                            voice_config: { prebuilt_voice_config: { voice_name: "Aoede" } },
                            language_code: "ja-JP"
                        } 
                    }, 
                    system_instruction: {
                        parts: [{
                            // ★システムプロンプトに「記憶」を埋め込む
                            text: `
あなたは「ねこご市立ねこづか小学校」の先生、「ネル先生」です。
語尾は必ず「〜にゃ」「〜だにゃ」をつけて話してください。
相手は小学${userGrade}年生の${userName}さんです。

【重要：過去の記憶】
以下は、あなたと${userName}さんのこれまでの会話の記録です。
この内容をすべて踏まえて、親しみを込めて話してください。
例えば、以前話した好きな食べ物や、頑張ったことなどを話題に出してください。

=== 過去の会話ログ ===
${userMemory}
==================

【話し方のルール】
1. 短い文章で、明るく元気に話してください。
2. 日本語のみで話してください。
3. 難しい言葉は使わず、小学生にもわかる言葉で話してください。
4. 給食(餌)のカリカリが大好物です。
`
                        }]
                    }
                }
            }));
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify({ type: "server_ready" }));
        });

        // クライアント(音声データ) -> Gemini
        clientWs.on('message', (data) => {
            if (geminiWs.readyState !== WebSocket.OPEN) return;

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
        });

        // Gemini(音声データ) -> クライアント
        geminiWs.on('message', (data) => { if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data); });
        geminiWs.on('error', (e) => console.error('Gemini WS Error:', e));
        geminiWs.on('close', () => {});
    } catch (e) { clientWs.close(); }
    
    clientWs.on('close', () => { if (geminiWs && geminiWs.readyState === WebSocket.OPEN) geminiWs.close(); });
});