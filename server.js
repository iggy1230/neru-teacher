// --- server.js (完全版 v78.0: 書き起こし精度統一・空欄処理修正・漢字ヒント平仮名化) ---

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

// --- サーバーサイドログ保存用 ---
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
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
        ttsClient = new textToSpeech.TextToSpeechClient({ credentials });
    } else {
        ttsClient = new textToSpeech.TextToSpeechClient();
    }
} catch (e) { 
    console.error("Init Error:", e.message); 
}

// ==========================================
// API エンドポイント
// ==========================================

// --- 1. 書類検出 ---
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
        JSON形式 {"points": [{"x":.., "y":..}, ...]} (TL, TR, BR, BLの順, 0-100%)
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

// --- 2. 音声合成 (TTS) ---
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

    // 読み上げ・発音の修正
    cleanText = cleanText.replace(/私は/g, 'わたしわ');
    cleanText = cleanText.replace(/ユーザーは/g, 'ユーザーわ');
    cleanText = cleanText.replace(/次/g, 'つぎ');
    cleanText = cleanText.replace(/内/g, 'ない');
    cleanText = cleanText.replace(/＋/g, 'たす');
    cleanText = cleanText.replace(/－/g, 'ひく');
    cleanText = cleanText.replace(/×/g, 'かける');
    cleanText = cleanText.replace(/÷/g, 'わる');
    cleanText = cleanText.replace(/＝/g, 'わ');
    cleanText = cleanText.replace(/□/g, 'しかく');

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

// --- 3. ゲーム反応 ---
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
            let scoreCommentType = "";
            if (score === 20) scoreCommentType = "「満点クリア！すごい！」と褒める";
            else if (score >= 15) scoreCommentType = "「たくさん取れたね！」と褒める";
            else scoreCommentType = "「おしい！次は頑張ろう」と励ます";

            prompt = `
            あなたはネル先生。ゲーム終了。スコアは${score}個（最大20個）です。
            ${scoreCommentType}内容で、20文字以内でコメントしてください。語尾は「にゃ」。
            `;
        } else {
            prompt = `ネル先生の実況。状況: ${type}。「うまい！」「すごい！」など5文字程度の一言だけ。語尾「にゃ」。`;
        }
        
        const result = await model.generateContent(prompt);
        let reply = result.response.text().trim();
        res.json({ reply, mood });
    } catch (err) { res.json({ reply: "がんばれにゃ！", mood: "excited" }); }
});

// --- 4. 給食反応 ---
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
            あなたはネル先生です。生徒「${name}」さんから記念すべき${count}個目の給食をもらいました！
            【絶対ルール】
            1. 名前を呼ぶときは必ず「${name}さん」と呼んでください。呼び捨ては厳禁です。
            2. カリカリへの溢れんばかりの愛と、${name}さんへの深い感謝を、少し大げさなくらい熱く、情熱的に語ってください。
            3. 語尾は「にゃ」。60文字程度。
            `;
        } else {
            const themes = [
                "カリカリの歯ごたえ", "魚の風味", "チキンの香り", "満腹感", "幸せな気分", 
                "おかわり希望", "生徒への感謝", "食べる速さ", "元気が出る", "毛艶が良くなる",
                "午後の授業への活力", "給食の時間が一番好き", "隠し味の予想", "咀嚼音の良さ",
                "今日のカリカリは格別", "カリカリの音", "カリカリの形", "カリカリの色"
            ];
            const theme = themes[Math.floor(Math.random() * themes.length)];
            
            const shouldCallName = Math.random() < 0.1;
            let nameRule = shouldCallName ? `名前「${name}さん」を呼んでください（呼び捨て厳禁）。` : `名前は呼ばないでください。いきなり感想から話し始めてください。`;
            
            prompt = `
            あなたはネル先生です。生徒「${name}」さんから給食をもらいました。
            【絶対ルール】
            1. ${nameRule}
            2. テーマ「${theme}」について、15文字以内の一言でユニークな感想を言ってください。
            3. 語尾は「にゃ」。
            `;
        }
        
        const result = await model.generateContent(prompt);
        let reply = result.response.text().trim();
        if (reply.includes('\n')) reply = reply.split('\n')[0];
        res.json({ reply, isSpecial });
    } catch (err) { res.status(500).json({ error: "Lunch Error" }); }
});

// --- 5. 記憶要約API ---
app.post('/summarize-notes', async (req, res) => {
    try {
        const { text } = req.body;
        if (!text || text.length < 2) return res.json({ notes: [] });

        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        
        const prompt = `
        以下は先生と生徒の会話ログです。
        次回以降の指導や関係づくりに使える情報をJSON配列にしてください。

        【絶対ルール】
        1. **「〜が好き」「〜が嫌い」「〜が得意/苦手」「趣味は〜」という記述があれば、些細なことでも必ず抽出してください。**（例: サッカー, ゲーム, 食べ物など）
        2. 挨拶や意味のない相槌は除外してください。
        3. 最大3つまで。
        4. 出力はJSON配列形式 ["サッカーが好き", "算数が不安"] のみ。

        ログ：${text.slice(-3000)}
        `;

        const result = await model.generateContent(prompt);
        let responseText = result.response.text().trim();
        
        const firstBracket = responseText.indexOf('[');
        const lastBracket = responseText.lastIndexOf(']');
        
        if (firstBracket !== -1 && lastBracket !== -1) {
            responseText = responseText.substring(firstBracket, lastBracket + 1);
            const notes = JSON.parse(responseText);
            res.json({ notes });
        } else {
            res.json({ notes: [] });
        }
    } catch (e) { res.json({ notes: [] }); }
});

// --- 6. 問題分析・採点 (Analyze: 精度向上・ルール統一) ---
app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject, analysisType } = req.body;
        
        let modelName = analysisType === 'precision' ? "gemini-2.5-pro" : "gemini-2.0-flash-exp";
        
        const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: { responseMimeType: "application/json" }
        });

        // 教科別詳細ルール (★統一・強化)
        const rules = {
            'さんすう': {
                points: `・筆算の横線とマイナス記号を混同しないこと。\n・累乗（2^2など）や分数を正確に書き起こすこと。`,
                hints: `
                  • ヒント1（立式）: 「何算を使えばいいか」のヒント（例：全部でいくつ？と聞かれているから足し算にゃ）。
                  • ヒント2（注目点）: 「単位のひっかけ」や「図の数値」への誘導（例：cmをmに直すのを忘れてないかにゃ？）。
                  • ヒント3（計算のコツ）: 「計算の工夫」や「最終確認」（例：一の位から順番に計算してみるにゃ）。`,
                grading: `
                  ・筆算の繰り上がりを「答え」と見間違えないように注意してにゃ。
                  ・単位（cm, Lなど）が問題で指定されている場合、単位がないものはバツにしてにゃ。
                  ・数字の「0」と「6」、「1」と「7」の見間違いに注意して、慎重に判定してにゃ。`
            },
            'こくご': {
                points: `
                  ・国語の問題は縦書きが多い。縦書きの場合は右から左へ読むこと。
                  ・漢字の書き取り問題では、答えとなる空欄を『□(ふりがな)』という形式で、ふりがなを漏らさず正確に書き起こしてください。
                  ・□の横に小さく書いてある文字が(ふりがな)。□の中の漢字を答える問題である。
                  ・読解問題の長い文章本文は書き起こししない。`,
                hints: `
                  ・【重要】漢字書き取り問題のヒントでは、その漢字自体（答えの文字）を絶対に使わないこと。「その漢字」や「答えの字」と言い換えてください。
                  ・もし答えの漢字に言及する必要がある場合は、**必ず平仮名表記**にしてください。（例：「『はこ』という字は…」）
                  ・ヒント1: 「漢字のなりたち」を教える
                  ・ヒント2: 「辺やつくりや画数」を教える
                  ・ヒント3: 「似た漢字」を教える
                  ・読解問題の場合 ヒント1（場所）: 「答えがどこにあるか」を教える
                  ・読解問題の場合 ヒント2（キーワード）: 「注目すべき言葉」を教える
                  ・読解問題の場合 ヒント3（答え方）: 「語尾の指定」など`,
                grading: `
                  ・送り仮名が間違っている場合はバツだにゃ。
                  ・読解問題では、解答の「文末」が適切か（〜のこと、〜から等）もチェックしてにゃ。`
            },
            'りか': {
                points: `
                  ・グラフの軸ラベルや単位（g, cm, ℃など）を落とさないこと。
                  ・記号選択問題（ア、イ、ウ）の選択肢も書き出すこと。
                  ・最初の問題が図や表と似た位置にある場合があるので見逃さないこと。`,
                hints: `
                  • ヒント1（観察）: 「図や表のどこを見るか」（例：グラフが急に上がっているところを探してみてにゃ）。
                  • ヒント2（関連知識）: 「習った言葉の想起」（例：この実験で使った、あの青い液体の名前は何だったかにゃ？）。
                  • ヒント3（絞り込み）: 「選択肢のヒント」や「最初の1文字」（例：『平』から始まる4文字の時代にゃ）。`,
                grading: `
                  ・カタカナ指定（例：ジョウロ、アルコールランプ）をひらがなで書いていたらバツにしてにゃ。
                  ・グラフの描画問題は、点が正しい位置にあるか、線が真っ直ぐかを厳しく判定してにゃ。`
            },
            'しゃかい': {
                points: `
                  ・グラフの軸ラベルや単位（g, cm, ℃など）を落とさないこと。
                  ・記号選択問題（ア、イ、ウ）の選択肢も書き出すこと。
                  ・最初の問題が図や表と似た位置にある場合があるので見逃さないこと。`,
                hints: `
                  • ヒント1（観察）: 「図や表のどこを見るか」（例：グラフが急に上がっているところを探してみてにゃ）。
                  • ヒント2（関連知識）: 「習った言葉の想起」（例：この実験で使った、あの青い液体の名前は何だったかにゃ？）。
                  • ヒント3（絞り込み）: 「選択肢のヒント」や「最初の1文字」（例：『平』から始まる4文字の時代にゃ）。`,
                grading: `
                  ・漢字指定の用語（例：都道府県名）をひらがなで書いていたらバツにゃ。
                  ・時代背景が混ざっていないか（例：江戸時代なのに「士農工商」など）に注意してにゃ。`
            }
        };
        const r = rules[subject] || rules['さんすう'];
        
        let studentAnswerInstruction = "";
        let gradingInstruction = "";
        
        if (mode === 'explain') {
            studentAnswerInstruction = `
            ・「教えて」モードです。画像内の手書き文字（生徒の答え）は【完全に無視】してください。
            ・"student_answer" は必ず空文字 "" にしてください。
            `;
        } else {
            studentAnswerInstruction = `
            ・「採点」モードです。「手書き文字」への意識を強化してください。
            ・子供特有の筆跡を考慮して、前後の文脈から数字や文字を推測してください。
            ・読み取った生徒の答えを "student_answer" に入れてください。
            ・【重要】生徒がまだ答えを書いていない（空欄の）場合は、勝手に正解を入れず、必ず空文字 "" にしてください。
            `;
            gradingInstruction = `
            【採点基準】
            ${r.grading}
            ・ユーザーが答えを修正入力して、それが正解だった場合は「✕」から「○」に変更できるように判定ロジックを考慮してください。
            ・どの問題も正確に正答を導き出してください。
            ・１つの問いの中に複数の回答が必要なときは、必要な数だけ回答欄（JSONデータの要素）を分けてください。
            `;
        }

        const prompt = `
            あなたは「ねこご市立ねこづか小学校」のネル先生（小学${grade}年生${subject}担当）です。語尾は「にゃ」。
            
            【タスク】
            画像に含まれる「問題」と思われる部分をすべて抽出し、JSONデータにしてください。
            
            【書き起こし・抽出の絶対ルール (全モード共通)】
            1. **多少読み取りにくくても、問題文らしきものがあればすべて書き出してください。**
            2. 大問、小問の数字や項目名は可能な限り書き起こしてください。
            3. 解答欄の有無に関わらず、設問文があれば抽出対象です。
            4. 教科別注目ポイント: ${r.points}
            5. ${studentAnswerInstruction}

            【ヒント生成ルール（絶対遵守）】
            1. **絶対に答えそのもの（正解の漢字や用語、数値）は書かないこと。**
            2. **漢字の書き取り問題でヒントにその文字を含める場合は、必ず「平仮名」で表記すること。**
            3. 十分に検証して必ず正答を導き出した上で、以下の3段階のヒントを作成してください。
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
    const params = parse(req.url, true).query;
    const grade = params.grade || "1";
    const name = decodeURIComponent(params.name || "生徒");
    const statusContext = decodeURIComponent(params.status || "特になし");

    let geminiWs = null;
    const GEMINI_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${process.env.GEMINI_API_KEY}`;
    
    try {
        geminiWs = new WebSocket(GEMINI_URL);
        
        geminiWs.on('open', () => {
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
                            2. 親しみやすい日本の小学校の先生として、一文字一文字をはっきりと、丁寧に発音してにゃ。
                            3. 特に最初や最後の音を、一文字抜かしたり消したりせずに、最初から最後までしっかり声に出して喋るのがコツだにゃ。
                            4. 落ち着いた日本語のリズムを大切にして、親しみやすく話してにゃ。
                            5. 給食(餌)のカリカリが大好物にゃ。
                            6. とにかく何でも知っているにゃ。
                            7. まれに「${name}さんは宿題は終わったかにゃ？」や「そろそろ宿題始めようかにゃ？」と宿題を促してくる。
                            8. 句読点で自然な間をとる。
                            9. 日本語をとても上手にしゃべる猫だにゃ。
                            10. いつも高いトーンで話してにゃ。

                            【NGなこと】
                            ・ロボットみたいに不自然に区切るのではなく、繋がりのある滑らかな日本語でお願いにゃ。
                            ・早口になりすぎて、言葉の一部が消えてしまうのはダメだにゃ。

                            【重要：今の状況と記憶（これを踏まえて話して！）】
                            ${statusContext}
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
                    await appendToServerLog(name, `発言: ${msg.text}`);
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