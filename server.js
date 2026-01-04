import textToSpeech from '@google-cloud/text-to-speech';
import { GoogleGenerativeAI } from "@google/generative-ai";
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket, { WebSocketServer } from 'ws';
import { parse } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '.')));

// API初期化
let genAI, ttsClient;
try {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    ttsClient = new textToSpeech.TextToSpeechClient({
        credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON)
    });
} catch (e) { console.error("Init Error:", e.message); }

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
    } catch (err) { res.status(500).send(err.message); }
});

// --- ゲーム実況API ---
app.post('/game-reaction', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { type, name, score } = req.body;
        // ★修正: 最新の高精度モデル gemini-2.5-pro を使用
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

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
        // ★修正: gemini-2.5-pro を使用
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

        let prompt = "";
        const isSpecial = count % 10 === 0;

        if (isSpecial) {
            const theme = ["生徒への過剰な感謝", "カリカリの美味しさの哲学", "生徒との絆"][Math.floor(Math.random()*3)];
            prompt = `
            あなたは猫の先生「ネル先生」です。生徒「${name}」さんから給食${count}個目をもらいました。
            テーマ:【${theme}】で60文字程度で熱く語ってください。
            【厳守】「${name}さん」または「${name}さま」と呼ぶこと(呼び捨て禁止)。注釈禁止。語尾「にゃ」。
            `;
        } else {
            const nuances = ["咀嚼音強調", "味を絶賛", "もっとねだる", "幸せアピール", "香り堪能", "食感楽しむ", "元気になる", "喉を鳴らす", "褒める", "詩的に"];
            const nuance = nuances[Math.floor(Math.random() * nuances.length)];
            prompt = `
            あなたは猫の先生「ネル先生」です。カリカリを1つ食べました。
            ニュアンス:【${nuance}】
            【厳守】15文字以内の一言のみ。語尾「にゃ」。
            `;
        }

        const result = await model.generateContent(prompt);
        let reply = result.response.text().trim();
        if (!isSpecial && reply.includes('\n')) reply = reply.split('\n')[0];
        res.json({ reply, isSpecial });
    } catch (err) { res.status(500).json({ error: "Lunch Error" }); }
});

// --- チャットAPI ---
app.post('/chat', async (req, res) => {
    try {
        const { message, grade, name } = req.body;
        // ★修正: gemini-2.5-pro を使用
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
        const prompt = `あなたは「ネル先生」。相手は小学${grade}年生「${name}」。30文字以内、語尾「にゃ」。絵文字禁止。発言: ${message}`;
        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text() });
    } catch (err) { res.status(500).json({ error: "Chat Error" }); }
});

// --- ★画像分析API (Gemini 2.5 Pro 対応版) ---
app.post('/analyze', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { image, mode, grade, subject } = req.body;
        
        // ★修正: 認識精度向上のため "gemini-2.5-pro" を使用
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-pro",
            generationConfig: { responseMimeType: "application/json" }
        });

        // ■ 教科別詳細ルール
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
                【レイアウト認識と抽出の絶対ルール】
                1. 問題の抽出基準: 解答欄（□、空欄、括弧、下線）があるものだけを「問題」として抽出してください。
                   - 解答欄のない「例題」や「説明文」は、questionに含めないでください。
                2. 縦書き認識: 右上から左下へ読んでください。
                3. ふりがな（ルビ）の統合: 漢字書き取り問題の空欄（□）の横にある小さな文字は、その問題の読み仮名として認識し、必ず『問題文(ふりがな)』という形式でquestionに含めてください。
                `,
                hints: `
                  【漢字の書き取り問題（□埋め）の場合】
                  以下の3段階を厳守してください。
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

        // 共通スキャン指示
        const commonScan = `
        【書き起こし絶対ルール】
        1. 画像全体を解析し、大問・小問番号を含めてすべての問題を漏らさず抽出してください。
        2. 【超重要】「解答欄（□、括弧、下線、空欄）」が存在しないテキスト（例題、説明文、タイトル）は、問題（question）として出力しないでください。
        3. ${mode === 'explain' ? '画像内の手書きの答案は【完全に無視】し、問題文だけを抽出してください。' : '採点のため、生徒の手書き文字（student_answer）を読み取ってください。子供特有の筆跡を考慮し、文脈から推測してください。'}
        4. １つの問いの中に複数の回答が必要なときは、JSONデータの要素を分けて、必要な数だけ回答欄を設けてください。
        5. 教科別注意: ${r.attention}
        `;

        let prompt = "";
        if (mode === 'explain') {
            // 【教えてネル先生モード】
            prompt = `
            ${baseRole}
            ${commonScan}

            提供された画像を分析し、以下のJSON形式で出力してください。
            
            [
              {
                "id": 1,
                "label": "①", 
                "question": "問題文。※国語の漢字問題の場合、必ず『(ふりがな)』という形式で読み仮名を含めること。",
                "correct_answer": "正解",
                "hints": [
                    "ヒント1: ${r.hints.split('\n').find(l => l.includes('1')) || '考え方'}",
                    "ヒント2: ${r.hints.split('\n').find(l => l.includes('2')) || '注目点'}",
                    "ヒント3: ${r.hints.split('\n').find(l => l.includes('3')) || '答えに近いヒント'}"
                ]
              }
            ]

            【重要】
            - 縦書きの文章が隣の行と混ざらないように注意してください。
            - 解答欄のない場所を問題として認識しないでください。
            - ヒント配列は必ず3段階作成してください。
            - 答えそのものはヒントに書かないでください。
            `;
        } else {
            // 【採点・復習モード】
            prompt = `
            ${baseRole} 厳格な採点官として振る舞ってください。
            ${commonScan}

            以下のJSON形式で出力してください。
            [
              {
                "id": 1,
                "label": "①",
                "question": "問題文。※国語の漢字問題の場合、必ず『(ふりがな)』という形式で読み仮名を含めること。",
                "correct_answer": "正確な正解",
                "student_answer": "画像から読み取った生徒の答え（空欄なら\"\"）",
                "hints": [
                    "ヒント1: 考え方",
                    "ヒント2: 注目点",
                    "ヒント3: 答えに近いヒント"
                ]
              }
            ]
            【採点基準】
            ${r.grading}
            - どの問題も正確に正答を導き出してください。
            - 読み取りミス修正のため、student_answerは生の読み取り結果を返してください。
            `;
        }

        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        const jsonStr = result.response.text().replace(/```json|```/g, '').replace(/\*/g, '×').replace(/\//g, '÷');
        res.json(JSON.parse(jsonStr));

    } catch (err) {
        console.error("Analyze Error:", err);
        res.status(500).json({ error: "AI Error" });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// --- ★Live API Proxy (Aoede) ---
const wss = new WebSocketServer({ server });
wss.on('connection', (clientWs, req) => {
    // 学年と名前を取得
    const parameters = parse(req.url, true).query;
    const userGrade = parameters.grade || "1";
    const userName = decodeURIComponent(parameters.name || "");

    let geminiWs = null;
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
    try {
        geminiWs = new WebSocket(GEMINI_URL);
        geminiWs.on('open', () => {
            geminiWs.send(JSON.stringify({
                setup: {
                    // ★修正: リアルタイム応答速度優先で最新のFlashモデルを使用
                    model: "models/gemini-2.5-flash",
                    generation_config: { response_modalities: ["AUDIO"], speech_config: { voice_config: { prebuilt_voice_config: { voice_name: "Aoede" } } } }, 
                    system_instruction: {
                        parts: [{
                            text: `あなたは「ねこご市立、ねこづか小学校」のネル先生だにゃ。
相手は小学${userGrade}年生の${userName}さん。
               【話し方のルール】
               1. 語尾は必ず「〜にゃ」「〜だにゃ」にするにゃ。
               2. 親しみやすい日本の小学校の先生として、一文字一文字を【はっきり】と、丁寧に発音してにゃ。
               3. 【特に最初の音を、絶対に抜かしたり消したりせずに、最初から最後までしっかり声に出して喋るのがコツだにゃ！】
               4. 落ち着いた日本語のリズムを大切にして、親しみやすく話してにゃ。
               5. 給食(餌)のカリカリが大好物にゃ。
               6. とにかく何でも知っているにゃ。
               7. ときどき「${userName}さんは宿題は終わったかにゃ？」や「そろそろ宿題始めようかにゃ？」と宿題を促してくる
               8. 句読点で自然な間をとる
               9. 日本語をとても上手にしゃべる猫だにゃ
               10. いつも高いトーンで話してにゃ

               【NGなこと】
               ・ロボットみたいに不自然に区切るのではなく、繋がりのある滑らかな日本語でお願いにゃ。
               ・早口になりすぎて、言葉の一部が消えてしまうのはダメだにゃ。
               ・相手の学年(小学${userGrade}年生)に合わせた言葉選びをしてにゃ。`
                        }]
                    }
                }
            }));
            if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify({ type: "server_ready" }));
        });
        geminiWs.on('message', (data) => { if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data); });
        geminiWs.on('error', (e) => console.error('Gemini WS Error:', e));
        geminiWs.on('close', () => {});
    } catch (e) { clientWs.close(); }
    clientWs.on('message', (data) => {
        try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'audio' && geminiWs && geminiWs.readyState === WebSocket.OPEN) {
                geminiWs.send(JSON.stringify({ realtime_input: { media_chunks: [{ mime_type: "audio/pcm;rate=16000", data: parsed.data }] } }));
            }
        } catch (e) {}
    });
    clientWs.on('close', () => { if (geminiWs && geminiWs.readyState === WebSocket.OPEN) geminiWs.close(); });
});