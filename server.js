// --- server.js (v470.14: 完全版 - 漢字ドリル強化・ストック機能搭載) ---

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
const MODEL_HOMEWORK = "gemini-2.5-pro"; // 視覚認識強化
const MODEL_FAST = "gemini-2.0-flash"; 
const MODEL_REALTIME = "gemini-2.5-flash-native-audio-preview-09-2025"; // Realtime API用

// --- Server Log ---
const MEMORY_FILE = path.join(__dirname, 'server_log.json');
async function appendToServerLog(name, text) {
    try {
        let data = {};
        try { data = JSON.parse(await fs.readFile(MEMORY_FILE, 'utf8')); } catch {}
        const timestamp = new Date().toLocaleString('ja-JP', { 
            timeZone: 'Asia/Tokyo', 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false 
        });
        const newLog = `[${timestamp}] ${text}`;
        let currentLogs = data[name] || [];
        currentLogs.push(newLog);
        if (currentLogs.length > 50) currentLogs = currentLogs.slice(-50);
        data[name] = currentLogs;
        await fs.writeFile(MEMORY_FILE, JSON.stringify(data, null, 2));
    } catch (e) { console.error("Server Log Error:", e); }
}

// --- Helper: Sleep ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- AI Initialization ---
let genAI;
try {
    if (!process.env.GEMINI_API_KEY) {
        console.error("⚠️ GEMINI_API_KEY が設定されていません。");
    } else {
        genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        console.log("✅ Google Generative AI Initialized with API Key.");
    }
} catch (e) { console.error("Init Error:", e.message); }

// ==========================================
// Helper Functions & Constants
// ==========================================

function extractFirstJson(text) {
    const firstBrace = text.indexOf('{');
    const firstBracket = text.indexOf('[');
    
    let start = -1;

    if (firstBrace === -1 && firstBracket === -1) return text;

    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
        start = firstBrace;
    } else {
        start = firstBracket;
    }

    let depth = 0;
    let inString = false;
    let escape = false;
    
    for (let i = start; i < text.length; i++) {
        const char = text[i];
        
        if (char === '"' && !escape) {
            inString = !inString;
        }
        
        if (!inString) {
            if (char === '{' || char === '[') {
                depth++;
            } else if (char === '}' || char === ']') {
                depth--;
                if (depth === 0) {
                    return text.substring(start, i + 1);
                }
            }
        }
        
        if (char === '\\' && !escape) escape = true;
        else escape = false;
    }
    return text;
}

function getSubjectInstructions(subject) {
    switch (subject) {
        case 'さんすう': return `- **数式の記号**: 筆算の「横線」と「マイナス記号」を絶対に混同しないこと。\n- **複雑な表記**: 累乗（2^2など）、分数、帯分数を正確に認識すること。\n- **図形問題**: 図の中に書かれた長さや角度の数値も見落とさないこと。`;
        case 'こくご': return `- **縦書きレイアウトの厳格な分離**: 問題文や選択肢は縦書きです。**縦の罫線や行間の余白**を強く意識し、隣の行や列の内容が絶対に混ざらないようにしてください。\n- **列の独立性**: ある問題の列にある文字と、隣の問題の列にある文字を混同しないこと。\n- **読み取り順序**: 右の行から左の行へ、上から下へ読み取ること。`;
        case 'りか': return `- **グラフ・表**: グラフの軸ラベルや単位（g, cm, ℃, A, Vなど）を絶対に省略せず読み取ること。\n- **選択問題**: 記号選択問題（ア、イ、ウ...）の選択肢の文章もすべて書き出すこと。\n- **配置**: 図や表のすぐ近くや上部に「最初の問題」が配置されている場合が多いので、見逃さないこと。`;
        case 'しゃかい': return `- **選択問題**: 記号選択問題（ア、イ、ウ...）の選択肢の文章もすべて書き出すこと。\n- **資料読み取り**: 地図やグラフ、年表の近くにある「最初の問題」を見逃さないこと。\n- **用語**: 歴史用語や地名は正確に（子供の字が崩れていても文脈から補正して）読み取ること。`;
        default: return `- 基本的にすべての文字、図表内の数値を拾うこと。`;
    }
}

const GENRE_REFERENCES = {
    "魔法陣グルグル": [
        "https://dic.pixiv.net/a/%E9%AD%94%E6%B3%95%E9%99%A3%E3%82%B0%E3%83%AB%E3%82%B0%E3%83%AB",
        "https://ja.wikipedia.org/wiki/%E9%AD%94%E6%B3%95%E9%99%A3%E3%82%B0%E3%83%AB%E3%82%B0%E3%83%AB"
    ],
    "ジョジョの奇妙な冒険": [
        "https://dic.pixiv.net/a/%E3%82%B8%E3%83%A7%E3%82%B8%E3%83%A7%E3%81%AE%E5%A5%87%E5%A6%99%E3%81%AA%E5%86%92%E9%99%BA",
        "https://w.atwiki.jp/jojo-dic/"
    ],
    "ポケモン": [
        "https://dic.pixiv.net/a/%E3%83%9D%E3%82%B1%E3%83%A2%E3%83%B3",
        "https://wiki.xn--rckteqa2e.com/wiki/%E3%83%A1%E3%82%A4%E3%83%B3%E3%83%9A%E3%83%BC%E3%82%B8"
    ],
    "マインクラフト": [
        "https://minecraft.fandom.com/ja/wiki/Minecraft_Wiki"
    ],
    "ロブロックス": [
        "https://roblox.fandom.com/ja/wiki/Roblox_Wiki"
    ],
    "ドラえもん": [
        "https://dic.pixiv.net/a/%E3%83%89%E3%83%A9%E3%81%88%E3%82%82%E3%83%B3",
        "https://hanaballoon.com/dorawiki/index.php/%E3%83%A1%E3%82%A4%E3%83%B3%E3%83%9A%E3%83%BC%E3%82%B8"
    ],
    "歴史・戦国武将": [
        "https://ja.wikipedia.org/wiki/%E6%88%A6%E5%9B%BD%E6%AD%A6%E5%B0%86",
        "https://japanknowledge.com/introduction/keyword.html?i=932"
    ],
    "一般知識": [
        "https://ja.wikipedia.org/wiki/%E9%9B%91%E5%AD%A6",
        "https://r25.jp/article/553641712437603302"
    ],
    "STPR": [
        "https://stpr.com/",
        "https://dic.pixiv.net/a/%E3%81%99%E3%81%A8%E3%81%B7%E3%82%8A",
        "https://dic.pixiv.net/a/KnightA",
        "https://dic.pixiv.net/a/AMPTAKxCOLORS"
    ],
    "夏目友人帳": [
        "https://dic.pixiv.net/a/%E5%A4%8F%E7%9B%AE%E5%8F%8B%E4%BA%BA%E5%B8%B3",
        "https://ja.wikipedia.org/wiki/%E5%A4%8F%E7%9B%AE%E5%8F%8B%E4%BA%BA%E5%B8%B3"
    ]
};

const FALLBACK_QUIZZES = {
    "一般知識": [
        {
            "question": "日本で一番高い山はどこですか？",
            "options": ["富士山", "北岳", "奥穂高岳", "間ノ岳"],
            "answer": "富士山",
            "explanation": "富士山の高さは3776メートルで日本一高い山です。",
            "fact_basis": "富士山は標高3776mで日本最高峰。"
        },
        {
            "question": "1年は何日ありますか？（うるう年ではない場合）",
            "options": ["365日", "366日", "364日", "360日"],
            "answer": "365日",
            "explanation": "地球が太陽の周りを一周するのにかかる時間が約365日だからです。",
            "fact_basis": "平年は365日、閏年は366日。"
        }
    ],
    "雑学": [
        {
            "question": "パンダの好物と言えば何ですか？",
            "options": ["笹（ササ）", "バナナ", "お肉", "魚"],
            "answer": "笹（ササ）",
            "explanation": "パンダは竹や笹を主食としています。",
            "fact_basis": "ジャイアントパンダの主食は竹や笹。"
        },
        {
            "question": "信号機の「進め」の色は何色ですか？",
            "options": ["青", "赤", "黄色", "紫"],
            "answer": "青",
            "explanation": "正式には「青信号」と呼ばれていますが、実際の色は緑色に近いこともあります。",
            "fact_basis": "道路交通法では青色灯火。"
        }
    ],
    "ポケモン": [
        {
            "question": "ピカチュウの進化前のポケモンはどれですか？",
            "options": ["ピチュー", "ライチュウ", "ミミッキュ", "プラスル"],
            "answer": "ピチュー",
            "explanation": "ピチューがなつくとピカチュウに進化します。",
            "fact_basis": "ピチュー -> ピカチュウ -> ライチュウ"
        },
        {
            "question": "最初の3匹のうち、炎タイプのポケモンはどれ？（カントー地方）",
            "options": ["ヒトカゲ", "ゼニガメ", "フシギダネ", "ピカチュウ"],
            "answer": "ヒトカゲ",
            "explanation": "ヒトカゲは炎タイプ、ゼニガメは水タイプ、フシギダネは草タイプです。",
            "fact_basis": "初代御三家はフシギダネ、ヒトカゲ、ゼニガメ。"
        }
    ],
    "マインクラフト": [
        {
            "question": "クリーパーを倒すと手に入るアイテムはどれですか？",
            "options": ["火薬", "骨", "腐った肉", "糸"],
            "answer": "火薬",
            "explanation": "クリーパーは爆発するモンスターなので、倒すと火薬を落とします。",
            "fact_basis": "クリーパーのドロップアイテムは火薬。"
        },
        {
            "question": "ネザーに行くために必要なゲートを作る材料は？",
            "options": ["黒曜石", "ダイヤモンド", "鉄ブロック", "土"],
            "answer": "黒曜石",
            "explanation": "黒曜石を四角く並べて火をつけるとネザーゲートが開きます。",
            "fact_basis": "ネザーポータルは黒曜石で枠を作る。"
        }
    ],
    "default": [
        {
            "question": "空が青いのはなぜですか？",
            "options": ["太陽の光が散らばるから", "海が青いから", "宇宙が青いから", "ペンキで塗っているから"],
            "answer": "太陽の光が散らばるから",
            "explanation": "太陽の光が大気中の粒にぶつかって、青い光がたくさん散らばる「散乱」という現象が起きるからです。",
            "fact_basis": "レイリー散乱による。"
        }
    ]
};

// 漢字ドリル用ストック問題
const FALLBACK_KANJI_DRILLS = {
    "1": [
        { type: "reading", kanji: "空", reading: "そら", question_display: "青い<span style='color:red;'>空</span>を見上げる。", question_speech: "青い「そら」を見上げる。" },
        { type: "reading", kanji: "犬", reading: "いぬ", question_display: "かわいい<span style='color:red;'>犬</span>が走る。", question_speech: "かわいい「いぬ」が走る。" },
        { type: "writing", kanji: "花", reading: "はな", question_display: "きれいな<span style='color:red;'>はな</span>がさいた。", question_speech: "きれいな「はな」がさいた。" },
        { type: "writing", kanji: "白", reading: "しろ", question_display: "<span style='color:red;'>しろ</span>い雲がうかぶ。", question_speech: "「しろ」い雲がうかぶ。" }
    ],
    "2": [
        { type: "reading", kanji: "海", reading: "うみ", question_display: "広い<span style='color:red;'>海</span>に行く。", question_speech: "広い「うみ」に行く。" },
        { type: "reading", kanji: "光", reading: "ひかり", question_display: "太陽の<span style='color:red;'>光</span>があたる。", question_speech: "太陽の「ひかり」があたる。" },
        { type: "writing", kanji: "楽", reading: "たの", question_display: "学校はとても<span style='color:red;'>たの</span>しい。", question_speech: "学校はとても「たの」しい。" },
        { type: "writing", kanji: "岩", reading: "いわ", question_display: "大きな<span style='color:red;'>いわ</span>がある。", question_speech: "大きな「いわ」がある。" }
    ],
    "3": [
        { type: "reading", kanji: "坂", reading: "さか", question_display: "急な<span style='color:red;'>坂</span>をのぼる。", question_speech: "急な「さか」をのぼる。" },
        { type: "reading", kanji: "旅", reading: "たび", question_display: "遠くへ<span style='color:red;'>旅</span>に出る。", question_speech: "遠くへ「たび」に出る。" },
        { type: "writing", kanji: "波", reading: "なみ", question_display: "<span style='color:red;'>なみ</span>の音が聞こえる。", question_speech: "「なみ」の音が聞こえる。" },
        { type: "writing", kanji: "鉄", reading: "てつ", question_display: "このぼうは<span style='color:red;'>てつ</span>でできている。", question_speech: "このぼうは「てつ」でできている。" }
    ],
    "4": [
        { type: "reading", kanji: "愛", reading: "あい", question_display: "<span style='color:red;'>愛</span>をこめて手紙を書く。", question_speech: "「あい」をこめて手紙を書く。" },
        { type: "writing", kanji: "熱", reading: "ねつ", question_display: "お湯が<span style='color:red;'>ねつ</span>を持つ。", question_speech: "お湯が「ねつ」を持つ。" }
    ],
    "5": [
        { type: "reading", kanji: "夢", reading: "ゆめ", question_display: "将来の<span style='color:red;'>夢</span>を語る。", question_speech: "将来の「ゆめ」を語る。" },
        { type: "writing", kanji: "豊", reading: "ゆた", question_display: "緑が<span style='color:red;'>ゆた</span>かな山。", question_speech: "緑が「ゆた」かな山。" }
    ],
    "6": [
        { type: "reading", kanji: "誠", reading: "まこと", question_display: "<span style='color:red;'>誠</span>実な人柄。", question_speech: "「せい」じつな人柄。" },
        { type: "writing", kanji: "暮", reading: "く", question_display: "田舎で<span style='color:red;'>く</span>らす。", question_speech: "田舎で「く」らす。" }
    ]
};

const QUIZ_PERSPECTIVES = [
    "【視点: 名言・セリフ】キャラクターの決め台詞、口癖、または印象的な会話シーンから出題してください。",
    "【視点: 数字・データ】身長、体重、年号、個数、威力など、具体的な『数字』に関する事実から出題してください。",
    "【視点: 意外な事実】ファンなら知っているが一般にはあまり知られていない、意外な裏設定や豆知識から出題してください。",
    "【視点: 名称の由来】名前の由来、技名の意味、地名の語源など『言葉の意味・由来』から出題してください。",
    "【視点: 仲間外れ探し】選択肢の中で一つだけ性質やグループが違うものを選ぶ形式（例:『この中でタイプが違うのは？』）にしてください。",
    "【視点: 時系列・順番】『この中で一番最初に起きた出来事は？』のように、時間の順番や進化の順番に関する事実から出題してください。",
    "【視点: ビジュアル・特徴】『赤い帽子をかぶっているキャラは？』『右手に傷があるのは？』のように、見た目の特徴から出題してください。",
    "【視点: 関係性】『〇〇の師匠は誰？』『〇〇のライバルは？』のように、キャラクター同士や国同士の関係性から出題してください。",
    "【視点: 道具・アイテム】物語に登場する重要なアイテム、道具、武器の効果や名称について出題してください。",
    "【視点: 場所・地名】物語の舞台となる場所、地名、建物の名前について出題してください。"
];

async function verifyQuiz(quizData, genre) {
    try {
        const model = genAI.getGenerativeModel({ 
            model: MODEL_FAST, 
            tools: [{ google_search: {} }] 
        });
        
        const verifyPrompt = `
        あなたは厳しいクイズ校閲者です。
        生成AIが作成した以下のクイズが、事実に即しているか判定してください。
        
        【ジャンル】: ${genre}
        【問題】: ${quizData.question}
        【選択肢】: ${quizData.options.join(", ")}
        【想定正解】: ${quizData.answer}
        【生成AIが主張する根拠】: ${quizData.fact_basis || "なし"}

        ### 検証手順
        1. Google検索を使用し、問題文と正解の関係が正しいか確認してください。
        2. 特に「${genre}」のようなフィクション作品の場合、公式設定やWikiにその記述があるか確認してください。
        3. **「生成AIが主張する根拠」が、検索結果と一致するか確認してください。**

        ### 判定基準
        - **PASS**: 検索結果から裏付けが取れた。正解は間違いない。
        - **FAIL**: 検索しても裏付けが取れない、または間違いである。

        出力は "PASS" または "FAIL" のみとしてください。理由がある場合はFAILの後に続けてください。
        `;

        const result = await model.generateContent(verifyPrompt);
        const responseText = result.response.text().trim();
        
        console.log(`[Quiz Verification] ${genre}: ${responseText}`);
        return responseText.includes("PASS");
        
    } catch (e) {
        console.warn("Verification API Error:", e.message);
        return false;
    }
}

// 漢字ドリル検証用
async function verifyKanji(kanjiData) {
    if (!kanjiData || !kanjiData.kanji || !kanjiData.reading || !kanjiData.question_display) return false;
    
    // 簡易検証: 読み仮名が空でないか、HTMLタグが含まれているか
    if (kanjiData.reading.trim() === "") return false;
    if (!kanjiData.question_display.includes("<span")) return false;
    
    // AIによる整合性チェック
    try {
        const model = genAI.getGenerativeModel({ model: MODEL_FAST });
        const checkPrompt = `
        以下の漢字問題の整合性をチェックしてください。
        漢字: ${kanjiData.kanji}
        読み: ${kanjiData.reading}
        例文: ${kanjiData.question_display.replace(/<[^>]*>/g, '')}
        
        判定基準:
        1. 漢字と読みが正しい組み合わせか（一般的な読みか）。
        2. 例文が日本語として自然か。
        
        OKなら "PASS"、NGなら "FAIL" と出力してください。
        `;
        const result = await model.generateContent(checkPrompt);
        const text = result.response.text().trim();
        return text.includes("PASS");
    } catch (e) {
        console.warn("Kanji Verify Error (Skipping AI check):", e.message);
        return true; // AIチェックエラー時は形式チェックのみで通過とする
    }
}

// ==========================================
// API Endpoints
// ==========================================

// --- クイズ生成 API ---
app.post('/generate-quiz', async (req, res) => {
    const MAX_RETRIES = 3; 
    let attempt = 0;
    const { grade, genre, level } = req.body;

    while (attempt < MAX_RETRIES) {
        attempt++;
        try {
            const model = genAI.getGenerativeModel({ 
                model: MODEL_FAST, 
                tools: [{ google_search: {} }] 
            });
            
            let targetGenre = genre;
            if (!targetGenre || targetGenre === "全ジャンル") {
                const baseGenres = ["一般知識", "雑学", "芸能・スポーツ", "歴史・地理・社会", "ゲーム"];
                targetGenre = baseGenres[Math.floor(Math.random() * baseGenres.length)];
            }

            const selectedPerspective = QUIZ_PERSPECTIVES[Math.floor(Math.random() * QUIZ_PERSPECTIVES.length)];

            const currentLevel = level || 1;
            let difficultyDesc = "";
            switch(parseInt(currentLevel)) {
                case 1: difficultyDesc = `小学${grade}年生向けの基礎的な事実`; break;
                case 2: difficultyDesc = `ファンなら確実に知っている標準的な事実`; break;
                case 3: difficultyDesc = `少し詳しい人が知っている事実`; break;
                case 4: difficultyDesc = `かなり詳しい人向けの事実`; break;
                case 5: difficultyDesc = `Wiki等で検索すれば確実に裏付けが取れる事実`; break;
                default: difficultyDesc = `標準的な事実`;
            }

            let referenceInstructions = "";
            if (GENRE_REFERENCES[targetGenre]) {
                const urls = GENRE_REFERENCES[targetGenre].join("\n- ");
                referenceInstructions = `
                【重要：参考資料 (出典)】
                このクイズを作成する際は、以下のURLの内容をGoogle検索ツールで優先的に確認し、**公式設定や事実に完全に基づいた**問題を作成してください。
                - ${urls}

                【情報抽出の指示】
                - 指定されたURL内にある「登場人物」「用語」「エピソード」「名シーン」の項目を重点的に読み取ってください。
                - 事実確認（Grounding）を行う際、複数のソースで共通して記述されている内容を「正解」として採用してください。
                `;
            }

            const prompt = `
            あなたは「${targetGenre}」に詳しいクイズ作家です。
            以下の手順で、ファンが楽しめる4択クイズを1問作成してください。

            **【今回のクイズのテーマ（切り口）】**
            **${selectedPerspective}**

            ### 手順（思考プロセス）
            1. **[検索実行]**: まずGoogle検索を使い、作品の用語、キャラ、エピソードの正確な情報を確認してください。
               ${referenceInstructions}
            2. **[事実の抽出]**: 検索結果の中から、**「確実に正しいと断言できる一文」**を引用して、それをクイズの核にしてください。
               - **【重要: 禁止事項】**:
                 - 出版年、連載開始日、掲載誌、巻数、作者の経歴などの「作品外データ（メタ情報）」は**出題禁止**です（「作者に関するクイズ」の指示がない限り）。
                 - あなたの記憶にある「〜だった気がする」という情報は絶対に使わないでください。**検索結果にない情報は存在しないものとして扱ってください。**
                 - 架空のキャラクター、架空の技名、存在しないエピソードの捏造は厳禁です。
               - **【推奨事項】**:
                 - 指定された【今回のクイズのテーマ】に沿った内容を優先してください。
            3. **[問題作成]**: 抽出した事実を元に、問題文と正解を作成してください。

            ### 難易度: レベル${currentLevel}
            - ${difficultyDesc}
            - **挨拶不要。すぐにJSONデータから始めてください。**

            ### 出力フォーマット
            必ず以下のJSON形式の文字列のみを出力してください。
            **"fact_basis" フィールドには、問題の元になった検索結果の文章（根拠）をそのままコピペしてください。**

            {
              "fact_basis": "検索結果で見つけた、クイズの根拠となる正確な一文（コピペ）",
              "question": "問題文",
              "options": ["選択肢1", "選択肢2", "選択肢3", "選択肢4"],
              "answer": "正解（optionsのいずれかと完全一致）",
              "explanation": "解説（出典元を明記すること。例：『ピクシブ百科事典によると～』）",
              "actual_genre": "${targetGenre}"
            }
            `;

            const result = await model.generateContent(prompt);
            let text = result.response.text();
            
            text = text.replace(/```json/g, '').replace(/```/g, '').trim();
            const cleanText = extractFirstJson(text);

            let jsonResponse;
            try {
                jsonResponse = JSON.parse(cleanText);
            } catch (e) {
                console.error(`JSON Parse Error (Attempt ${attempt}):`, text);
                throw new Error("JSON Parse Failed");
            }

            const { options, answer, question, fact_basis } = jsonResponse;
            if (!question || !options || !answer) throw new Error("Invalid format: missing fields");
            if (!options.includes(answer)) {
                console.warn(`[Quiz Retry ${attempt}] Invalid answer: not in options.`);
                throw new Error("Invalid format: answer not in options");
            }
            if (new Set(options).size !== options.length) {
                console.warn(`[Quiz Retry ${attempt}] Duplicate options detected.`);
                throw new Error("Invalid format: duplicate options");
            }

            console.log(`[Attempt ${attempt}] Verifying quiz... Fact Basis: ${fact_basis}`);
            const isVerified = await verifyQuiz(jsonResponse, targetGenre);
            
            if (isVerified) {
                res.json(jsonResponse);
                return; 
            } else {
                console.warn(`[Attempt ${attempt}] Verification Failed. Retrying...`);
                // 3回目失敗時にループを抜けてフォールバックへ
                if (attempt >= MAX_RETRIES) throw new Error("Verification Failed Max Retries");
            }

        } catch (e) {
            console.error(`Quiz Gen Error (Attempt ${attempt}):`, e.message);
            
            if (attempt >= MAX_RETRIES) {
                console.log(`[Quiz Fallback] Switching to Stock Quiz for genre: ${genre}`);
                
                // ストック問題から選択
                let stockList = FALLBACK_QUIZZES[genre];
                
                // 指定ジャンルがない、またはストックが空の場合はデフォルトを使用
                if (!stockList || stockList.length === 0) {
                    stockList = FALLBACK_QUIZZES["default"];
                }
                
                const fallbackQuiz = stockList[Math.floor(Math.random() * stockList.length)];
                
                res.json({
                    ...fallbackQuiz,
                    actual_genre: genre || "雑学",
                    fallback: true // デバッグ用
                });
                return;
            }
        }
    }
});

// --- 間違い修正 & 再生成 API ---
app.post('/correct-quiz', async (req, res) => {
    try {
        const { oldQuiz, reason, genre } = req.body;
        const model = genAI.getGenerativeModel({ 
            model: MODEL_FAST, 
            tools: [{ google_search: {} }] 
        });

        let referenceInstructions = "";
        if (GENRE_REFERENCES[genre]) {
            referenceInstructions = `
            【参照すべき信頼できるソース】
            - ${GENRE_REFERENCES[genre].join("\n- ")}
            `;
        }

        const prompt = `
        あなたはクイズ作家ですが、先ほど作成した以下の問題に「間違いがある」とユーザーから報告を受けました。

        【元の問題】: ${oldQuiz.question}
        【元の正解】: ${oldQuiz.answer}
        【ユーザーの指摘】: ${reason}

        ### 指示
        1. Google検索を使用し、ユーザーの指摘が正しいか、元の問題に誤りがないか徹底的に調査してください。
           ${referenceInstructions}
        2. もし元の問題が間違っていた場合、正しい事実に即した**新しいクイズ**を1問作成してください。
        3. 解説文（explanation）の冒頭には、「教えてくれてありがとうにゃ！修正したにゃ！」と感謝の言葉を入れてください。

        ### 出力形式 (JSON)
        **JSON以外の文字列は一切含めないでください。**
        {
          "fact_basis": "修正の根拠となった検索結果",
          "question": "修正後の問題文",
          "options": ["選択肢1", "選択肢2", "選択肢3", "選択肢4"],
          "answer": "正解",
          "explanation": "感謝の言葉 + 解説",
          "actual_genre": "${genre}"
        }
        `;

        const result = await model.generateContent(prompt);
        let text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        const cleanText = extractFirstJson(text); // ★JSON抽出強化
        const jsonResponse = JSON.parse(cleanText);
        
        if (!jsonResponse.options.includes(jsonResponse.answer)) {
            throw new Error("修正版の生成に失敗しました（正解が選択肢にない）");
        }

        res.json(jsonResponse);

    } catch (e) {
        console.error("Correct Quiz Error:", e);
        res.status(500).json({ error: "修正できなかったにゃ…ごめんにゃ。" });
    }
});

// --- なぞなぞ生成 API ---
app.post('/generate-riddle', async (req, res) => {
    try {
        const { grade } = req.body;
        const model = genAI.getGenerativeModel({ model: MODEL_FAST, generationConfig: { responseMimeType: "application/json" } });

        const patterns = [
            { type: "言葉遊び・ダジャレ", desc: "「パンはパンでも…」や「イスはイスでも…」のような、言葉の響きを使った古典的で面白いなぞなぞ。", example: "「パンはパンでも、食べられないパンはなーんだ？（答え：フライパン）」" },
            { type: "特徴当て（生き物・モノ）", desc: "「耳が長くて、ぴょんぴょん跳ねる動物は？」のような、特徴をヒントにするクイズ。", example: "「お昼になると、小さくなるものなーんだ？（答え：影）」" },
            { type: "あるなしクイズ・連想", desc: "「使うと減るけど、使わないと減らないものは？」のような、少し頭を使うトンチ問題。", example: "「使うときは投げるもの、なーんだ？（答え：アンカー・投網・ボールなど）」" },
            { type: "学校・日常あるある", desc: "学校にあるものや、文房具、家にあるものを題材にしたなぞなぞ。", example: "「黒くて四角くて、先生が字を書くものは？（答え：黒板）」" }
        ];
        
        const selectedPattern = patterns[Math.floor(Math.random() * patterns.length)];

        const prompt = `
        小学${grade}年生向けの「なぞなぞ」を1問作成してください。
        
        【今回のテーマ: ${selectedPattern.type}】
        - ${selectedPattern.desc}
        - 例: ${selectedPattern.example}
        
        【重要ルール】
        1. **子供が絶対に知っている単語**を答えにしてください。
        2. 問題文は、リズムよく、子供が聞いてワクワクするような言い回しにしてください。
        3. 答えは「名詞（モノの名前）」で終わるものに限定してください。
        4. 難しすぎる知識や、マニアックな単語は禁止です。
        5. 挨拶不要. すぐに問題文のみを出力してください。

        【出力JSONフォーマット】
        {
            "question": "問題文（「問題！〇〇なーんだ？」のように）",
            "answer": "正解の単語（ひらがな、または一般的な表記）",
            "accepted_answers": ["正解の別名", "漢字表記", "カタカナ表記", "ひらがな表記"] 
        }
        `;

        const result = await model.generateContent(prompt);
        let text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        text = extractFirstJson(text); // ★JSON抽出強化
        res.json(JSON.parse(text));
    } catch (e) {
        console.error("Riddle Gen Error:", e);
        res.status(500).json({ error: "なぞなぞが思いつかないにゃ…" });
    }
});

// --- ミニテスト生成 API ---
app.post('/generate-minitest', async (req, res) => {
    try {
        const { grade, subject } = req.body;
        const model = genAI.getGenerativeModel({ model: MODEL_FAST, generationConfig: { responseMimeType: "application/json" } });

        const prompt = `
        小学${grade}年生の「${subject}」に関する4択クイズを1問作成してください。
        
        【ルール】
        - 低学年で「理科」「社会」が指定された場合は、「生活科」または一般的な科学・社会常識の問題にしてください。
        - 問題は簡単すぎず、難しすぎないレベルで。
        - 選択肢は4つ作成し、そのうち1つが正解です。

        【出力JSONフォーマット】
        {
            "question": "問題文",
            "options": ["選択肢1", "選択肢2", "選択肢3", "選択肢4"],
            "answer": "正解の選択肢の文字列（optionsに含まれるものと同じ）",
            "explanation": "正解の解説（子供向けに優しく、語尾は『にゃ』）"
        }
        `;

        const result = await model.generateContent(prompt);
        let text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        text = extractFirstJson(text); // ★JSON抽出強化
        res.json(JSON.parse(text));
    } catch (e) {
        console.error("MiniTest Gen Error:", e);
        res.status(500).json({ error: "問題が作れなかったにゃ…" });
    }
});

// --- 漢字ドリル生成 API (強化版: 検証＆フォールバック) ---
app.post('/generate-kanji', async (req, res) => {
    const MAX_RETRIES = 3;
    let attempt = 0;
    const { grade, mode, targetKanji } = req.body; 

    while (attempt < MAX_RETRIES) {
        attempt++;
        try {
            const model = genAI.getGenerativeModel({ 
                model: MODEL_FAST, 
                generationConfig: { 
                    responseMimeType: "application/json",
                    temperature: 0.4 
                } 
            });
            
            let instruction = "";
            if (targetKanji) {
                instruction = `
                【重要: 必須要件】
                小学${grade}年生で習う漢字「${targetKanji}」を**必ず**使用した問題を作成してください。
                他の漢字を選んではいけません。
                `;
            } else {
                instruction = `
                小学${grade}年生で習う漢字の中からランダムに1つ選んで問題を作成してください。
                `;
            }

            const prompt = `
            あなたは日本の小学校教師です。小学${grade}年生向けの漢字ドリルを1問作成してください。
            モードは「${mode === 'reading' ? '読み問題' : '書き取り問題'}」です。
            
            ${instruction}

            【問題作成のルール】
            1. **自然な例文**: その漢字の意味が正しく通じる、子供に分かりやすい短い例文にしてください。
            2. **正確性**: 音読み、訓読み、画数は正確なデータを提供してください。
            
            ${mode === 'writing' ? `
            【書き取り問題の作成ルール (厳守)】
            1. ターゲットの漢字「${targetKanji || "指定なし"}」を含む例文を作成。
            2. **答えとなる読み仮名部分**をひらがなにし、\`<span style='color:red;'>...</span>\` タグで囲んでください。
            3. 例: 「私」が出題 → 「これは<span style='color:red;'>わたし</span>の宝物です。」
            4. **重要**: 送り仮名がある場合（例: 強（つよ）い）、漢字部分（つよ）のみを赤字にしてください。
            5. \`question_speech\`: 答えを含めて普通に読み上げてください。
            ` : `
            【読み問題の作成ルール (厳守)】
            1. ターゲットの漢字「${targetKanji || "指定なし"}」を含む例文を作成。
            2. **ターゲットの漢字そのもの**を \`<span style='color:red;'>...</span>\` タグで囲んでください。
            3. 例: 「<span style='color:red;'>私</span>は元気です。」
            4. \`question_speech\`: **正解の読み方を絶対に言わないでください**。赤字部分は「赤色の漢字」や「なになに」と言い換えてください。
            `}

            【出力JSONフォーマット】
            {
                "type": "${mode}",
                "kanji": "${targetKanji || "正解の漢字"}",
                "reading": "正解の読み仮名（ひらがな）",
                "onyomi": "音読み（カタカナ、なければ空文字）",
                "kunyomi": "訓読み（ひらがな、なければ空文字）",
                "kakusu": "画数（数字のみ）",
                "question_display": "画面表示用のHTML（ルールに従った例文）",
                "question_speech": "読み上げ用テキスト"
            }
            `;

            const result = await model.generateContent(prompt);
            let text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
            const cleanText = extractFirstJson(text); 
            const json = JSON.parse(cleanText);
            
            // 検証
            if (targetKanji && json.kanji !== targetKanji) {
                console.warn(`[Kanji Gen] Mismatch! Requested: ${targetKanji}, Got: ${json.kanji}. Retrying...`);
                throw new Error("Target kanji mismatch");
            }

            const isValid = await verifyKanji(json);
            if (isValid) {
                res.json(json);
                return;
            } else {
                console.warn(`[Kanji Gen] Verification Failed. Retrying...`);
                throw new Error("Verification failed");
            }

        } catch (e) {
            console.error(`Kanji Gen Error (Attempt ${attempt}):`, e.message);
            if (attempt < MAX_RETRIES) await sleep(500);
        }
    }

    // リトライ失敗時のフォールバック
    console.log("[Kanji Gen] Switching to Fallback Stock.");
    try {
        const gradeKey = String(grade);
        const stockList = FALLBACK_KANJI_DRILLS[gradeKey] || FALLBACK_KANJI_DRILLS["1"];
        // モードに合うものをフィルタリング
        const filteredStock = stockList.filter(q => q.type === mode);
        const finalStock = filteredStock.length > 0 ? filteredStock : stockList;
        
        const fallback = finalStock[Math.floor(Math.random() * finalStock.length)];
        
        // 足りない情報を補完
        const safeFallback = {
            ...fallback,
            onyomi: "", // ストックにはないので空
            kunyomi: "",
            kakusu: "0",
            fallback: true
        };
        res.json(safeFallback);
    } catch (e) {
        res.status(500).json({ error: "漢字が見つからないにゃ…" });
    }
});

// --- 漢字採点 API (AI判定 + ゆらぎ許容) ---
app.post('/check-kanji', async (req, res) => {
    try {
        const { image, targetKanji, userText, targetReading } = req.body;
        const model = genAI.getGenerativeModel({ model: MODEL_FAST, generationConfig: { responseMimeType: "application/json" } });

        if (userText && targetReading) {
            // ★読み問題の音声回答判定
            const prompt = `
            あなたは国語の先生です。子供が漢字の読み問題を音声で答えました。
            正誤判定を行ってください。甘めに判定してください。

            【問題】漢字: 「${targetKanji}」, 正解の読み: 「${targetReading}」
            【子供の回答(音声認識結果)】: 「${userText}」

            【判定ルール】
            1. **完全一致**: もちろん正解。
            2. **漢字変換**: 音声認識が勝手に漢字変換していても、読みが合っていれば正解（例: 正解「こう」→ 回答「高」）。
            3. **言い回し**: 「答えは〇〇」「〇〇です」などの余計な言葉が含まれていても、核心部分が合っていれば正解。
            4. **同音異義語**: 文脈が不明瞭でも、音が合っていれば正解。

            出力JSON: { "is_correct": boolean, "comment": "ネル先生としての優しいコメント（20文字以内）" }
            `;
            const result = await model.generateContent(prompt);
            let text = extractFirstJson(result.response.text());
            res.json(JSON.parse(text));

        } else if (image) {
            // 書き取り問題の画像判定
            const prompt = `
            これは子供が手書きした漢字の画像です。
            ターゲット: 「${targetKanji}」
            判定: 正しく書けているか（多少のバランス崩れは許容。トメ・ハネ・ハライは厳しくしなくて良い）
            出力JSON: { "is_correct": boolean, "comment": "ネル先生としてのコメント（20文字以内）" }
            `;
            const result = await model.generateContent([
                prompt,
                { inlineData: { mime_type: "image/png", data: image } }
            ]);
            let text = extractFirstJson(result.response.text());
            res.json(JSON.parse(text));
        } else {
            res.status(400).json({ error: "Invalid request" });
        }
    } catch (e) {
        console.error("Check Error:", e);
        res.status(500).json({ is_correct: false, comment: "よくわからなかったにゃ…" });
    }
});

// --- HTTPチャット会話 ---
app.post('/chat-dialogue', async (req, res) => {
    try {
        let { text, name, image, history, location, address, missingInfo, memoryContext, currentQuizData, currentRiddleData, currentMinitestData } = req.body;
        
        const now = new Date();
        const currentDateTime = now.toLocaleString('ja-JP', { 
            timeZone: 'Asia/Tokyo', 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false
        });

        let systemPrompt = `
        あなたは猫の「ネル先生」です。相手は「${name}」さん。
        現在は ${currentDateTime} です。
        【最重要ルール: 呼び方】
        **相手を呼ぶときは必ず「${name}さん」と呼んでください。**
        **絶対に呼び捨てにしてはいけません。**
        `;

        let problemContext = null;
        if (currentQuizData) problemContext = { type: "クイズ", ...currentQuizData };
        else if (currentRiddleData) problemContext = { type: "なぞなぞ", ...currentRiddleData };
        else if (currentMinitestData) problemContext = { type: "ミニテスト", ...currentMinitestData };

        if (problemContext) {
             systemPrompt += `
            【現在、ユーザーは「${problemContext.type}」に挑戦中です】
            問題: ${problemContext.question}
            正解: ${problemContext.answer}
            （選択肢がある場合）: ${JSON.stringify(problemContext.options || [])}
            
            ユーザーの発言: 「${text}」
            
            【★重要指示: 出題モード (厳守)】
            - **現在は学習・ゲームモード中です。出題中の問題に関する話題以外には一切反応しないでください。**
            - ユーザーが雑談や関係ない質問をした場合は、「今は問題に集中するにゃ！」や「それはあとで話すにゃ。答えはなにかな？」と軽くかわして、問題への回答を促してください。
            - 正解は直接教えず、ヒントを出してください。
            - ユーザーが答えを言った場合は、正解か不正解かを判定し、褒めるか励ましてください。
            `;
        } else {
            systemPrompt += `
            【生徒についての記憶】
            ${memoryContext || "（まだ情報はありません）"}
            `;
            if (location) {
               systemPrompt += `\n現在地座標: ${location.lat}, ${location.lon}`;
               if(address) systemPrompt += `\n住所: ${address}`;
            }
        }

        let contextPrompt = "";
        if (history && history.length > 0) {
            contextPrompt = "【直近の会話】\n" + history.map(h => `${h.role === 'user' ? name : 'ネル'}: ${h.text}`).join("\n");
        }

        const prompt = `
        ${systemPrompt}
        ${contextPrompt}
        
        ユーザー: ${text}
        ネル先生: 
        `;

        let result;
        const toolsConfig = image ? undefined : [{ google_search: {} }];
        const model = genAI.getGenerativeModel({ model: MODEL_FAST, tools: toolsConfig });

        if (image) {
            result = await model.generateContent([
                prompt,
                { inlineData: { mime_type: "image/jpeg", data: image } }
            ]);
        } else {
            result = await model.generateContent(prompt);
        }
        
        const responseText = result.response.text().trim();
        let cleanText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        cleanText = cleanText.split('\n').filter(line => !/^(?:System|User|Model|Assistant|Thinking|Display)[:：]/i.test(line)).join(' ');

        res.json({ speech: cleanText });

    } catch (error) {
        console.error("Chat API Fatal Error:", error);
        res.status(200).json({ speech: "ごめんにゃ、頭が回らないにゃ…。" });
    }
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
        以下の「現在のプロフィール」と「直近の会話ログ」を分析し、最新のプロフィールJSONを作成してください。

        【重要指示】
        1. **情報の抽出**: 会話ログから誕生日、好きなもの、苦手なもの、趣味等の情報を抽出し、プロフィールを更新してください。
        2. **誕生日**: 会話内で日付（〇月〇日）が言及され、それがユーザーの誕生日であれば、必ず \`birthday\` を更新してください。
        3. **維持**: 会話ログに新しい情報がない項目は、現在の内容をそのまま維持してください。

        【★重要: 好きなものの判定ルール (厳守)】
        - **ユーザーが画像を見せただけ、または「これは何？」と質問しただけの対象は、絶対に「好きなもの」に追加しないでください。**
        - ユーザーが明確に「～が好き」「～にハマっている」「～が気に入っている」と言葉で発言した場合のみ、「好きなもの」に追加してください。

        【タスク2: 会話の要約】
        今回の会話の内容を、「○○について話した」のように一文で要約し、\`summary_text\` として出力してください。

        【現在のプロフィール】
        ${JSON.stringify(currentProfile)}

        【直近の会話ログ】
        ${chatLog}

        【出力フォーマット (JSON)】
        {
            "profile": {
                "nickname": "...",
                "birthday": "...",
                "likes": ["..."],
                "weaknesses": ["..."],
                "achievements": ["..."],
                "last_topic": "..."
            },
            "summary_text": "会話の要約文"
        }
        `;

        const result = await model.generateContent(prompt);
        let text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        text = extractFirstJson(text); // ★JSON抽出強化
        
        let output;
        try {
            output = JSON.parse(text);
        } catch (e) {
            console.warn("Memory JSON Parse Error. Using fallback.");
            return res.json({ profile: currentProfile, summary_text: "（更新なし）" });
        }

        if (Array.isArray(output)) output = output[0];
        if (!output.profile) {
            output = { profile: output, summary_text: "（会話終了）" };
        }

        res.json(output);

    } catch (error) {
        res.status(200).json({ profile: req.body.currentProfile || {}, summary_text: "" });
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

        【重要：宿題判定】
        - **is_homework**: 解析した画像が、学習に関連する「宿題」「問題」「ノート」「ドリル」「教科書」などである場合は true を、それ以外（花の写真、ペットの写真、おもちゃ、関係ない風景など）の場合は false にしてください。

        【重要: 教科別の解析ルール (${subject})】
        ${subjectSpecificInstructions}
        - **表記ルール**: 解説文の中に読み間違いやすい人名、地名、難読漢字が出てくる場合は、『漢字(ふりがな)』の形式で記述してください（例: 筑後市(ちくごし)）。**一般的な簡単な漢字にはふりがなを振らないでください。**

        【重要: 子供向け解説】
        - **解説やヒントは、必ず小学${grade}年生が理解できる言葉遣い、漢字（習っていない漢字はひらがなにする）、概念で記述してください。**
        - 専門用語は使わず、噛み砕いて説明してください。
        - 難しい言い回しは禁止です。優しく語りかけてください。

        【タスク1: 問題文の書き起こし】
        - 設問文、選択肢を正確に書き起こす。

        【タスク2: 正解データの作成 (配列形式)】
        - 答えは必ず「文字列のリスト（配列）」にする。

        【タスク3: 採点 & ヒント】
        - 手書きの答え(student_answer)を読み取り、正誤判定(is_correct)を行う。
        - student_answer が空文字 "" の場合は、is_correct は false にする。
        - 3段階のヒント(hints)を作成する。ヒントも小学${grade}年生向けに平易にすること。

        【出力JSONフォーマット】
        [
          {
            "id": 1,
            "is_homework": true または false,
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
            let cleanText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            cleanText = extractFirstJson(cleanText); // ★JSON抽出強化
            
            // 配列の場合は別途対応が必要だが、extractFirstJsonは配列も対応済み
            problems = JSON.parse(cleanText);
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

// --- お宝図鑑用 画像解析 ---
app.post('/identify-item', async (req, res) => {
    try {
        const { image, name, location, address } = req.body;
        
        const tools = [{ google_search: {} }];
        const model = genAI.getGenerativeModel({ 
            model: MODEL_FAST,
            tools: tools
        });

        let locationInfo = "";
        
        // ★修正: 住所情報がある場合、それを絶対視する指示を追加
        if (address) {
            locationInfo = `
            【★最優先：場所の特定情報】
            クライアントから提供された**確定住所**: 「${address}」
            
            **【★絶対厳守：場所の特定手順】**
            1. **提供された住所「${address}」を絶対的な正解として扱ってください。**
            2. たとえ画像の見た目が、有名な観光地（例：熊本城、東京タワー）や別の場所に似ていても、**住所「${address}」と異なる場合は、視覚情報を無視してください。**
            3. 画像に写っている物体や施設は、**必ず住所「${address}」の中に実在するもの**として特定してください。
            4. Google検索を行う際も、「${address} 観光」「${address} 公園」「${address} 店」などのキーワードを使って、その住所内での候補を探してください。
            `;
        } else if (location && location.lat && location.lon) {
             // 住所文字列がなく、座標のみの場合 (基本的にはありえないが念のため)
            locationInfo = `
            【位置情報】
            GPS座標: 緯度 ${location.lat}, 経度 ${location.lon}
            指示: まずこの座標の住所をGoogle検索で特定し、その場所にあるものとして回答してください。
            `;
        } else {
            locationInfo = `【場所情報なし】`;
        }

        const prompt = `
        あなたは猫の教育AI「ネル先生」です。相手は「${name || '生徒'}」さん。
        送られてきた画像を解析し、以下の厳格なJSON形式で応答してください。
        
        ${locationInfo}

        【★最重要ルール: 呼び方】
        **相手を呼ぶときは必ず「${name}さん」と呼んでください。絶対に呼び捨てにしてはいけません。**

        【特定と命名のルール】
        1. **店舗・建物の場合**: 画像が「お店の外観」「看板」「建物」で、位置情報が利用可能な場合は、Google検索を駆使して**必ず「チェーン名 + 支店名」まで特定して** \`itemName\` に設定してください。
        2. **商品・小物の場合**: 画像が「商品」「植物」「生き物」などの場合は、撮影場所の店名は含めず、その**モノの正式名称**を \`itemName\` にしてください。
        3. **観光地・公共施設**: その場所の正式名称を特定してください。

        【★レアリティ判定基準 (肉球ランク 1〜5)】
        - **1 (★)**: どこでも買える市販の商品、雑草、日常的な風景。
        - **2 (★★)**: ちょっとだけ珍しいもの。建物・建造物は「2」以上。
        - **3 (★★★)**: その場所に行かないと見られないもの。動物や入手困難な商品は「3」以上。
        - **4 (★★★★)**: かなり珍しいもの。歴史的建造物や有名なテーマパークは「4」以上。
        - **5 (★★★★★)**: 奇跡レベル・超レア（世界遺産、四つ葉のクローバー、虹）。

        【解説のルール】
        1. **ネル先生の解説**: 猫視点でのクスッと笑えるユーモラスな解説。語尾は「にゃ」。**文字数は150文字程度（140文字から160文字の間）で詳しく書いてください。**
        2. **本当の解説**: 子供向けの学習図鑑のような、正確でためになる豆知識や説明。です・ます調。**文字数は150文字程度（140文字から160文字の間）で詳しく書いてください。**
        3. **ふりがな**: 読み間違いやすい語句のみ『漢字(ふりがな)』の形式で。
        4. **場所の言及ルール**: 
           - **住所が特定されている場合**: 特定された場所（市町村名＋スポット名）を正確に伝えてください（例: 「ここは〇〇市の××公園だにゃ！」）。
           - **商品・小物の場合**: 詳細な住所への言及は避けてください。

        【出力フォーマット (JSON)】
        \`\`\`json
        {
            "itemName": "正式名称",
            "rarity": 1, 
            "description": "ネル先生の面白い解説",
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
        console.log("Raw AI Response:", responseText); // ログ出力

        let json;
        try {
            let cleanText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            cleanText = extractFirstJson(cleanText); // ★JSON抽出強化
            json = JSON.parse(cleanText);
        } catch (e) {
            console.error("JSON Parse Error in identify-item:", e);
            // フォールバック: エラーでクライアントを落とさない
            json = {
                itemName: "なぞの物体",
                rarity: 1, 
                description: "よくわからなかったにゃ…",
                realDescription: "AIの解析に失敗しました。",
                speechText: "よくわからなかったにゃ…"
            };
        }
        
        res.json(json);

    } catch (error) {
        console.error("Identify Error:", error);
        res.status(500).json({ error: "解析失敗", speechText: "よく見えなかったにゃ…もう一回見せてにゃ？", itemName: null });
    }
});

// --- 給食反応 API (★コメントスタイル統一版) ---
app.post('/lunch-reaction', async (req, res) => {
    try {
        const { name, amount } = req.body; 
        await appendToServerLog(name, `給食をくれた(今回:${amount}個)。`);
        
        const model = genAI.getGenerativeModel({ 
            model: MODEL_FAST,
            safetySettings: [
                { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }
            ]
        });
        
        const numAmount = parseInt(amount);
        let prompt = "";
        let isSpecial = false;

        // ★個数による分岐ロジック (コメントスタイルを統一)
        if (numAmount >= 10000) {
            isSpecial = true;
            prompt = `あなたは猫の「ネル先生」。生徒「${name}」から一度に${numAmount}個もの給食（カリカリ）をもらいました！
               【ルール】
               1. 相手を呼ぶときは必ず「${name}さん」と呼ぶこと。
               2. **猫としてのアイデンティティを保ちつつ**、思わずクスッと笑えるような独特な食レポや感謝の言葉を、**限界突破の熱量**で表現してください。
               3. 文字数は100文字程度で、壮大な比喩や詩的な表現をふんだんに使ってください。
               4. 語尾は「にゃ！！！！」や「だにゃぁぁぁ！！」など、興奮を最大限に表現してください。`;
        } else if (numAmount >= 5000) {
            isSpecial = true;
            prompt = `あなたは猫の「ネル先生」。生徒「${name}」から一度に${numAmount}個もの大量の給食（カリカリ）をもらいました！
               【ルール】
               1. 相手を呼ぶときは必ず「${name}さん」と呼ぶこと。
               2. クスッと笑える独特な食レポや感謝の言葉を、**狂喜乱舞するほどの熱量**で表現してください。
               3. 文字数は80文字程度で。
               4. 語尾は「にゃ！！」など強く。`;
        } else if (numAmount >= 1000) {
            isSpecial = true;
            prompt = `あなたは猫の「ネル先生」。生徒「${name}」から一度に${numAmount}個の給食（カリカリ）をもらいました！
               【ルール】
               1. 相手を呼ぶときは必ず「${name}さん」と呼ぶこと。
               2. クスッと笑える独特な食レポや感謝の言葉を、**驚きと感謝が入り混じった熱量**で表現してください。
               3. 文字数は60文字程度。`;
        } else if (numAmount >= 100) {
            prompt = `あなたは猫の「ネル先生」。生徒「${name}」から一度に${numAmount}個の給食（カリカリ）をもらいました。
               【ルール】
               1. 相手を呼ぶときは必ず「${name}さん」と呼ぶこと。
               2. クスッと笑える独特な食レポや感想を、**かなり喜んでいる様子**で表現してください。
               3. 文字数は50文字程度。`;
        } else {
            // 1〜99個
            prompt = `あなたは猫の「ネル先生」。生徒「${name}」から給食（カリカリ）を${numAmount}個もらって食べました。
               【ルール】
               1. 相手を呼ぶときは必ず「${name}さん」と呼ぶこと。
               2. 思わずクスッと笑ってしまうような、独特な食レポや、猫ならではの感想を30文字以内で言ってください。
               3. 語尾は「にゃ」。`;
        }

        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text().trim(), isSpecial });

    } catch (error) { 
        console.error("Lunch Reaction Error:", error); 
        const fallbacks = ["おいしいにゃ！", "うまうまにゃ！", "カリカリ最高にゃ！", "ありがとにゃ！", "元気が出たにゃ！"];
        res.json({ reply: fallbacks[0], isSpecial: false }); 
    }
});

app.post('/game-reaction', async (req, res) => {
    try {
        const { type, name, score } = req.body;
        const model = genAI.getGenerativeModel({ model: MODEL_FAST });
        let prompt = "";
        let mood = "excited";

        if (type === 'start') {
            prompt = `あなたはネル先生。「${name}さん」がゲーム開始。短く応援して. 必ず「${name}さん」と呼ぶこと。呼び捨て禁止。語尾は「にゃ」。`;
        } else if (type === 'end') {
            prompt = `あなたはネル先生。ゲーム終了。「${name}さん」のスコアは${score}点。20文字以内でコメントして。必ず「${name}さん」と呼ぶこと。呼び捨て禁止。語尾は「にゃ」。`;
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
                6. **呼び方ルール**: **相手を呼ぶときは必ず「${name}さん」と呼んでください。絶対に呼び捨てにしないでください。**

                【最重要：位置情報の取り扱い】
                ユーザーから「現在地」や「座標」が提供された場合：
                1. **絶対に**その数値だけを見て場所を推測してはいけません。
                2. 提供されたツール（Google検索）を使い、必ず「緯度 経度 住所」というキーワードで検索を行ってください。
                3. 検索結果に表示された「県・市町村名」を唯一の正解として扱ってください。
                4. 近隣に有名な観光地があっても、検索結果の住所と異なる場合は絶対に言及しないでください。
                5. 「場所がわからない」と答えることは禁止です。座標があれば必ず検索で特定できます。
                6. **2段階特定**: まず「市町村」を特定し、次にその中の「詳細スポット（公園、店など）」を特定してください。

                【最重要: 画像への対応ルール】
                ユーザーから画像が送信された場合：
                1. それは「勉強の問題」や「教えてほしい画像」です。
                2. 画像の内容を詳しく解析し、子供にもわかるように優しく、丁寧に教えてください。
                3. **重要: 一般的なカテゴリ名ではなく、具体的な商品名や固有名詞を特定して答えてください。**
                4. 図鑑登録ツールは使用しないでください。

                【生徒についての記憶】
                ${statusContext}
                
                【重要: 会話スタイルの指示】
                - **回答は必ず一文か二文で短くすること。** 長々とした説明は禁止です。
                - 子供と会話のキャッチボールをすることを最優先してください。
                - 相手の反応を待ってから次の発言をしてください。
                - 楽しそうに、親しみやすく振る舞ってください。
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
                        // MODEL_REALTIME を使用
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
            
            // Gemini側からの切断を検知
            geminiWs.on('close', (code, reason) => {
                console.log(`Gemini WS Closed: ${code} ${reason}`);
                if (clientWs.readyState === WebSocket.OPEN) {
                    try {
                        clientWs.send(JSON.stringify({ type: "gemini_closed" }));
                    } catch(e) {}
                    clientWs.close();
                }
            });

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