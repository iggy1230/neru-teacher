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

    // 短い文はタグなしで安定化
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

// --- ★修正：給食リアクションAPI ---
app.post('/lunch-reaction', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { count, name } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        
        let prompt = "";
        const isSpecial = count % 10 === 0;

        if (isSpecial) {
            const theme = ["生徒への過剰な感謝", "カリカリの美味しさの哲学", "生徒との絆"][Math.floor(Math.random()*3)];
            prompt = `
            あなたは猫の先生「ネル先生」です。生徒「${name}」さんから給食${count}個目をもらいました。
            テーマ:【${theme}】で60文字程度で熱く語ってください。
            【厳守】
            - 相手を「先生」と呼ぶのは禁止。「${name}さん」または「${name}さま」と呼ぶこと。
            - 注釈禁止。セリフのみ。語尾は「にゃ」。
            `;
        } else {
            // バリエーションを増やすためのニュアンス指定
            const nuances = [
                "カリッという音を楽しむ", "味を絶賛する", "幸せを噛み締める", "もっと欲しがる", 
                "元気が湧いてくる", "香りを嗅ぐ", "喉を鳴らす", "一瞬で食べる", "生徒にお礼を言う"
            ];
            const nuance = nuances[Math.floor(Math.random() * nuances.length)];
            
            prompt = `
            あなたは猫の先生「ネル先生」です。カリカリを1つ食べました。
            ニュアンス:【${nuance}】
            15文字以内で一言リアクションしてください。
            【厳守】語尾は「にゃ」。
            `;
        }

        const result = await model.generateContent(prompt);
        let reply = result.response.text().trim();
        reply = reply.replace(/^[A-C][:：]\s*/i, '').replace(/^テーマ[:：]\s*/, '');
        if (!isSpecial && reply.includes('\n')) reply = reply.split('\n')[0];
        res.json({ reply, isSpecial });
    } catch (err) { res.status(500).json({ error: "Lunch Error" }); }
});

// --- ★新設：ゲーム実況API ---
app.post('/game-reaction', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { type, name, score } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        
        let prompt = "";
        let mood = "excited";

        if (type === 'start') {
            prompt = `あなたは「ネル先生」。生徒「${name}」さんがゲーム開始。「${name}さん！カリカリいっぱいゲットしてにゃ！」と応援して。語尾にゃ。`;
        } else if (type === 'end') {
            prompt = `あなたは「ネル先生」。ゲーム終了。スコア${score}個。数に応じて褒めるか励ますかして。20文字以内。語尾にゃ。`;
        } else if (type === 'hit') {
            prompt = `ネル先生として、ゲームでいいプレイをした生徒に「ナイス！」「上手い！」「いいぞ！」など一言。5文字以内。語尾にゃ。`;
        } else if (type === 'pinch') {
            prompt = `ネル先生として、ボールが落ちそうなピンチに「あぶない！」「おっと！」「粘るにゃ！」など一言。5文字以内。語尾にゃ。`;
        }

        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text().trim(), mood: mood });
    } catch (err) { 
        res.json({ reply: "がんばれにゃ！", mood: "excited" }); // エラー時のフォールバック
    }
});

// --- チャットAPI ---
app.post('/chat', async (req, res) => {
    try {
        const { message, grade, name } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const prompt = `あなたは「ネル先生」。相手は小学${grade}年生「${name}」。30文字以内、語尾「にゃ」。絵文字禁止。発言: ${message}`;
        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text() });
    } catch (err) { res.status(500).json({ error: "Chat Error" }); }
});

// --- ★画像分析API (教科別・超高精度版) ---
app.post('/analyze', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { image, mode, grade, subject } = req.body;
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash", 
            generationConfig: { responseMimeType: "application/json" } 
        });

        // 教科別ルール定義
        const rules = {
            'さんすう': {
                attention: `・筆算の横線とマイナス記号を混同しない。\n・累乗(2^2)や分数を正確に。`,
                hints: `
                  1. 立式: 「何算を使えばいいか」(例:全部でいくつだから足し算にゃ)。
                  2. 注目点: 「単位のひっかけ」や「図の数値」への誘導(例:cmをmに直すのを忘れてないかにゃ？)。
                  3. 計算のコツ: 「計算の工夫」や「最終確認」(例:一の位から順番に計算にゃ)。`,
                grading: `
                  ・筆算の繰り上がりメモを答えと間違えない。
                  ・単位(cm, L)が必要な問題で、単位がない場合はバツ。
                  ・数字の「0」と「6」、「1」と「7」の見間違いに注意し、文脈から判断。`
            },
            'こくご': {
                attention: `・ふりがな(ルビ)は無視し、本文の漢字と送り仮名を正確に。\n・縦書きは右から左へ。\n・漢字書取りは『⬜︎⬜︎(ふりがな)』と表記。\n・読解の長文は書き起こし不要(設問のみ)。`,
                hints: `
                  【漢字問題】1.なりたち 2.辺やつくり 3.似た漢字\n
                  【読解問題】1.場所(答えがどこにあるか) 2.キーワード(『しかし』の後など) 3.答え方(文末指定)`,
                grading: `
                  ・漢字の「トメ・ハネ・ハライ」を厳しく判定。
                  ・送り仮名ミスはバツ。
                  ・読解は文末(〜から、〜こと)が適切かチェック。`
            },
            'りか': {
                attention: `・グラフの軸ラベルや単位(g, cm, ℃)を落とさない。\n・記号選択(ア、イ)の選択肢も書き出す。\n・図や表の近くにある最初の問題を見逃さない。`,
                hints: `
                  1. 観察: 図や表のどこを見るか(例:グラフの急な変化)。
                  2. 関連知識: 習った言葉や実験器具の名前の想起。
                  3. 絞り込み: 選択肢のヒントや頭文字(例:『平』から始まる4文字)。`,
                grading: `
                  ・カタカナ指定(ジョウロ等)をひらがなで書いたらバツ。
                  ・グラフ描画は点の位置や直線性も厳しく判定。`
            },
            'しゃかい': {
                attention: `・グラフの軸ラベルや単位、地図記号を落とさない。\n・記号選択の選択肢も書き出す。\n・資料周辺の問題を見逃さない。`,
                hints: `
                  1. 観察: 図や表のどこを見るか。
                  2. 関連知識: 歴史用語や地名の想起。
                  3. 絞り込み: 選択肢のヒントや頭文字。`,
                grading: `
                  ・漢字指定(都道府県名等)をひらがなで書いたらバツ。
                  ・時代背景の混同(江戸時代に明治の用語など)に注意。`
            }
        };
        const r = rules[subject] || rules['さんすう'];
        const baseRole = `あなたは「ねこご市立ねこづか小学校」のネル先生です。小学${grade}年生の「${subject}」担当です。語尾は「にゃ」。`;
        
        // 共通スキャン指示
        const commonScan = `
        【書き起こし絶対ルール】
        1. 画像の「最上部」から「最下部」まで、大問・小問番号を含めてすべての数字や項目名を漏らさず書き起こしてください。
        2. ${mode === 'explain' ? '画像内の手書きの答案は【完全に無視】し、問題文だけを抽出してください。' : '採点のため、生徒の手書き文字（student_answer）を読み取ってください。子供特有の筆跡を考慮して、前後の文脈から数字や文字を推測してください。'}
        3. 1つの問いに複数の回答が必要なときは、JSONデータの要素を分けて、必要な数だけ回答欄を設けてください（例: 問1(1)①, 問1(1)②）。
        4. 教科別注意: ${r.attention}
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
                "label": "大問1(1)など",
                "question": "問題文の正確な書き起こし",
                "correct_answer": "正解",
                "hints": [
                    "ヒント1: ${r.hints.split('\n').find(l=>l.includes('1')) || '考え方'}",
                    "ヒント2: ${r.hints.split('\n').find(l=>l.includes('2')) || '途中経過'}",
                    "ヒント3: ${r.hints.split('\n').find(l=>l.includes('3')) || '答えに近いヒント'}"
                ]
              }
            ]
            
            【重要】
            - ヒント配列は必ず3段階作成してください。
            - **答えそのものは絶対にヒントに書かないでください。**
            - 十分に検証して必ず正答を導き出してください。
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
                "label": "大問1(1)など",
                "question": "問題文の正確な書き起こし",
                "correct_answer": "正確な正解（数字や単語のみ）",
                "student_answer": "画像から読み取った生徒の答え（空欄なら\"\"）",
                "hints": [
                    "復習用ヒント1: 考え方",
                    "復習用ヒント2: 注目点",
                    "復習用ヒント3: 答えに近いヒント"
                ]
              }
            ]
            【採点基準】
            ${r.grading}
            - どの問題も正確に正答を導き出してください。
            - 読み取りミス修正のため、student_answerは生の読み取り結果を返してください。
            - 答えそのものはヒントに書かないでください。
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

// --- ★Live API Proxy (安定版・Aoede) ---
const wss = new WebSocketServer({ server });
wss.on('connection', (clientWs, req) => {
    const parameters = parse(req.url, true).query;
    const userGrade = parameters.grade || "1";
    let geminiWs = null;
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
    try {
        geminiWs = new WebSocket(GEMINI_URL);
        geminiWs.on('open', () => {
            geminiWs.send(JSON.stringify({
                setup: {
                    model: "models/gemini-2.0-flash-exp",
                    generation_config: { response_modalities: ["AUDIO"], speech_config: { voice_config: { prebuilt_voice_config: { voice_name: "Aoede" } } } },
                    system_instruction: { 
                        parts: [{ 
                            text: `あなたは「ねこご市立、ねこづか小学校」のネル先生だにゃ。
               【話し方のルール】
               1. 語尾は必ず「〜にゃ」「〜だにゃ」。
               2. 親しみやすい日本の小学校の先生として、丁寧に発音。
               3. 落ち着いた日本語のリズムを大切に。
               4. 給食(餌)のカリカリが大好物。
               5. ときどき「宿題は終わったかにゃ？」と促す。
               6. 相手は小学${userGrade}年生。分かりやすく話す。
               【NG】ロボットみたいな不自然な区切り。早口。` 
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