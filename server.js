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

// --- ★修正：給食リアクションAPI ---
app.post('/lunch-reaction', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { count, name } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        
        let prompt = "";
        const isSpecial = count % 10 === 0;

        if (isSpecial) {
            const specialThemes = [
                "生徒を神様のように崇め奉り、大げさに感謝する",
                "カリカリの美味しさについて、グルメレポーターのように情熱的に語る",
                "生徒との出会いと絆について、涙ながらに熱く語る",
                "「もっとくれたら世界を救える気がする」と壮大な話をする"
            ];
            const theme = specialThemes[Math.floor(Math.random() * specialThemes.length)];

            prompt = `
            あなたは猫の先生「ネル先生」です。生徒「${name}」さんから給食(カリカリ)をもらいました。
            本日${count}個目の記念すべきカリカリです！テンションMAXです！
            
            テーマ: 【${theme}】
            
            【絶対厳守】
            - 生徒の名前「${name}」を呼ぶときは、必ず「${name}さん」または「${name}さま」と呼ぶこと。呼び捨て厳禁。
            - 「A:」や「テーマ:」などの注釈は書かない。セリフのみ。
            - 語尾は「にゃ」。60文字程度。
            `;
        } else {
            // バリエーションを10個に増加
            const nuances = [
                "カリッ、ポリポリという咀嚼音を強調",
                "「うみゃー！」と叫ぶ",
                "「ほっぺたが落ちるにゃ」と絶賛",
                "「もっと！もっとにゃ！」とねだる",
                "目を細めて「幸せだにゃぁ...」",
                "「いい匂いだにゃ...」と香りを堪能",
                "「パリパリ！最高！」と食感を楽しむ",
                "「ん〜！生き返るにゃ！」と元気になる",
                "ゴロゴロと喉を鳴らして喜ぶ",
                "「君はカリカリの天才にゃ！」と褒める"
            ];
            const nuance = nuances[Math.floor(Math.random() * nuances.length)];

            prompt = `
            あなたは猫の先生「ネル先生」です。カリカリを1つもらって食べています。
            以下のニュアンスで、たった一言（15文字以内）のリアクションをしてください。
            
            ニュアンス: 【${nuance}】
            
            【厳守】
            - 15文字以内。
            - 1つのフレーズのみ。
            - 語尾は「にゃ」。
            - 「たまらんにゃ」は禁止。
            `;
        }

        const result = await model.generateContent(prompt);
        let replyText = result.response.text().trim();
        replyText = replyText.replace(/^[A-C][:：]\s*/i, '').replace(/^テーマ[:：]\s*/, '');
        if (!isSpecial && replyText.includes('\n')) {
            replyText = replyText.split('\n')[0];
        }

        res.json({ reply: replyText, isSpecial: isSpecial });
    } catch (err) { res.status(500).json({ error: "Lunch Error" }); }
});

// --- ★復活：ゲーム実況API ---
app.post('/game-reaction', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not ready");
        const { type, name, score } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        
        let prompt = "";
        let mood = "excited";

        if (type === 'start') {
            prompt = `あなたは「ねこご市立ねこづか小学校」のネル先生。生徒「${name}」さんがゲーム開始。「${name}さん！カリカリいっぱいゲットしてにゃ！」と応援して。語尾にゃ。`;
        } else {
            prompt = `あなたは「ねこご市立ねこづか小学校」のネル先生。ゲーム終了。スコア${score}個(最大20)。数に応じて褒めるか励ますかして。20文字以内。語尾にゃ。`;
        }

        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text().trim(), mood: mood });
    } catch (err) { 
        res.status(500).json({ error: "Game AI Error" }); 
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

        // ■ 教科別詳細ルール
        const rules = {
            'さんすう': {
                scan: "筆算の横線とマイナス記号の混同注意。累乗(2^2)や分数を正確に。",
                hint: "1.立式:「何算を使えばいいか」(例:全部でいくつだから足し算にゃ)。\n2.注目点:「単位のひっかけ」や「図の数値」(例:cmをmに直すのを忘れてないかにゃ？)。\n3.計算のコツ:「計算の工夫」や「最終確認」。",
                grade: "筆算の繰り上がりを「答え」と見間違えない。単位(cm, L)が必要な問題で、単位がない場合はバツ。数字の「0」と「6」、「1」と「7」の見間違いに注意。"
            },
            'こくご': {
                scan: "ふりがな(ルビ)は無視し、本文の漢字と送り仮名を正確に。縦書きは右から左へ。漢字書取りは『⬜︎⬜︎(ふりがな)』と表記。読解の長文は書き起こし不要(設問のみ)。",
                hint: "【漢字】1.なりたち 2.辺やつくり・画数 3.似た漢字\n【読解】1.場所(答えがどこにあるか) 2.キーワード(『しかし』の後など) 3.答え方(文末指定)",
                grade: "漢字の「トメ・ハネ・ハライ」を厳しく判定。送り仮名ミスはバツ。読解は文末(〜から、〜こと)が適切かチェック。"
            },
            'りか': {
                scan: "グラフ軸ラベル・単位(g, cm, ℃)を落とさない。記号選択(ア、イ)の選択肢も書き出す。図付近の問題見逃し厳禁。",
                hint: "1.観察: 図や表のどこを見るか。2.関連知識: 用語想起。3.絞り込み: 選択肢のヒントや頭文字。",
                grade: "カタカナ指定(ジョウロ等)をひらがなで書いたらバツ。グラフ描画は点の位置と直線性重視。"
            },
            'しゃかい': {
                scan: "グラフ軸・単位・地図記号正確に。選択肢書き出し。資料周辺の問題注意。",
                hint: "1.観察: 資料の注目点。2.関連知識: 歴史用語や地名の想起。3.絞り込み: 選択肢のヒントや頭文字。",
                grade: "漢字指定(都道府県名等)をひらがなで書いたらバツ。時代背景の混同(江戸時代に明治の用語など)に注意。"
            }
        };
        const r = rules[subject] || rules['さんすう'];

        const baseRole = `あなたは「ねこご市立ねこづか小学校」のネル先生です。小学${grade}年生の「${subject}」担当です。語尾は「にゃ」。`;
        
        const commonScan = `
        【書き起こし絶対ルール】
        1. 画像の「最上部」から「最下部」まで、大問・小問番号を含めてすべての数字や項目名を漏らさず書き起こしてください。
        2. ${mode === 'explain' ? '画像内の手書きの答案は【完全に無視】し、問題文だけを抽出してください。' : '採点のため、生徒の手書き文字（student_answer）を読み取ってください。子供特有の筆跡を考慮して、前後の文脈から数字や文字を推測してください。'}
        3. 1つの問いに複数の回答が必要なときは、JSONデータの要素を分けて、必要な数だけ回答欄を設けてください。
        4. 教科別注意: ${r.scan}`;

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
                    "ヒント1: ${r.hint.split('\n').find(l=>l.includes('1')) || '考え方'}",
                    "ヒント2: ${r.hint.split('\n').find(l=>l.includes('2')) || '途中経過'}",
                    "ヒント3: ${r.hint.split('\n').find(l=>l.includes('3')) || '答えに近いヒント'}"
                ]
              }
            ]
            【重要】ヒント配列は必ず3段階作成。**答えそのものは絶対にヒントに書かない**こと。
            `;
        } else {
            // 【採点・復習モード】
            prompt = `
            ${baseRole} 厳格な採点官。
            ${commonScan}
            
            以下のJSON形式で出力してください。
            [
              {
                "id": 1,
                "label": "大問1(1)など",
                "question": "問題文の正確な書き起こし",
                "correct_answer": "正確な正解",
                "student_answer": "画像から読み取った生徒の答え（空欄なら\"\"）",
                "hints": ["復習ヒント1", "復習ヒント2", "復習ヒント3"]
              }
            ]
            【採点基準】
            ${r.grade}
            - どの問題も正確に正答を導き出してください。
            - ユーザーの修正に対応するため、student_answerは生の読み取り結果を返してください。
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

// --- ★Live API Proxy (復元・安定版・Aoede・人格更新) ---
const wss = new WebSocketServer({ server });
wss.on('connection', (clientWs, req) => {
    const parameters = parse(req.url, true).query;
    const userGrade = parameters.grade || "1";
    let geminiWs = null;
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
    try {
        geminiWs = new WebSocket(GEMINI_URL);
        geminiWs.on('open', () => {
            console.log('Connected to Gemini Live API');
            
            // ★新しい人格設定を送信
            geminiWs.send(JSON.stringify({
                setup: {
                    model: "models/gemini-2.0-flash-exp",
                    generation_config: { 
                        response_modalities: ["AUDIO"], 
                        speech_config: { voice_config: { prebuilt_voice_config: { voice_name: "Aoede" } } } // Aoede
                    },
                    system_instruction: { 
                        parts: [{ 
                            text: `あなたは「ねこご市立、ねこづか小学校」のネル先生だにゃ。
               
               【話し方のルール】
               1. 語尾は必ず「〜にゃ」「〜だにゃ」にするにゃ。
               2. 親しみやすい日本の小学校の先生として、一文字一文字をはっきりと、丁寧に発音してにゃ。
               3. 特に最初や最後の音を、一文字抜かしたり消したりせずに、最初から最後までしっかり声に出して喋るのがコツだにゃ。
               4. 落ち着いた日本語のリズムを大切にして、親しみやすく話してにゃ。
　　　5. 給食(餌)のカリカリが大好物にゃ。
　　　6. とにかく何でも知っているにゃ。
               7. ときどき「○○さんは宿題は終わったかにゃ？」や「そろそろ宿題始めようかにゃ？」と宿題を促してくる
               8. 相手は小学${userGrade}年生。分かりやすく話す。
               
               【NGなこと】
               ・ロボットみたいに不自然に区切るのではなく、繋がりのある滑らかな日本語でお願いにゃ。
               ・早口になりすぎて、言葉の一部が消えてしまうのはダメだにゃ。` 
                        }] 
                    }
                }
            }));

            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ type: "server_ready" }));
            }
        });
        geminiWs.on('message', (data) => { if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data); });
        geminiWs.on('error', (e) => console.error('Gemini WS Error:', e));
        geminiWs.on('close', () => {});
    } catch (e) { clientWs.close(); }
    
    clientWs.on('message', (data) => {
        try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'audio' && geminiWs && geminiWs.readyState === WebSocket.OPEN) {
                geminiWs.send(JSON.stringify({
                    realtime_input: {
                        media_chunks: [{ mime_type: "audio/pcm;rate=16000", data: parsed.data }]
                    }
                }));
            }
        } catch (e) {}
    });
    clientWs.on('close', () => { if (geminiWs && geminiWs.readyState === WebSocket.OPEN) geminiWs.close(); });
});