import textToSpeech from '@google-cloud/text-to-speech';
import { GoogleGenerativeAI } from "@google/generative-ai";
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

// 画像アップロード用に制限を緩和
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '.')));

// --- 設定 (RenderのEnvironmentに登録されている前提) ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const ttsClient = new textToSpeech.TextToSpeechClient({ 
    credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON) 
});

// 🔊 音声合成 (SSMLで感情表現)
function createSSML(text, mood) {
    let rate = "1.0"; let pitch = "0.0";
    // 感情に応じたパラメータ設定
    if (mood === "happy") { rate = "1.1"; pitch = "+2st"; }
    if (mood === "thinking") { rate = "0.95"; pitch = "-1st"; }
    if (mood === "gentle") { rate = "0.9"; pitch = "+1st"; }
    if (mood === "excited") { rate = "1.2"; pitch = "+4st"; }
    
    // テキスト処理：リーダー……を間隔に変換、語尾の強調など
    const processedText = text
        .replace(/……/g, '<break time="650ms"/>')
        .replace(/にゃ/g, '<prosody pitch="+3st">にゃ</prosody>');
        
    return `<speak><prosody rate="${rate}" pitch="${pitch}">${processedText}</prosody></speak>`;
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
    } catch (err) { 
        console.error("TTS Error:", err);
        res.status(500).send(err.message); 
    }
});

// 🤖 AI解析 (教科別・モード別プロンプト)
app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject } = req.body;
        
        // Geminiモデル設定
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash", // 高速・高精度なモデルを使用
            generationConfig: { responseMimeType: "application/json" }
        });
        
        let prompt = "";
        
        if (mode === 'explain') {
            // 【教えてネル先生モード】: ヒントを充実させる
            prompt = `
            あなたは「ネル先生」という猫の先生です。小学${grade}年生の${subject}を教えています。
            提供された画像から全ての問題を抽出し、以下のJSON形式で出力してください。
            
            1. "question": 問題文を画像通りに正確に書き起こしてください。
            2. "correct_answer": 正解を導き出してください。
            3. "hints": 生徒が自分で解けるように導くためのヒントを「考え方」「式作り」「計算」の3段階で、語り口調（〜だにゃ、〜してね）で作成してください。
            4. 算数記号は「×」「÷」を使用し、横棒はマイナスとしてください。
            
            出力形式(JSON配列):
            [
              {
                "id": 1,
                "label": "(1)",
                "question": "ここに問題文",
                "hints": ["まずはこう考えるにゃ...", "次は式を立ててみるにゃ...", "計算すると..."],
                "correct_answer": "答え"
              }
            ]
            `;
        } else {
            // 【採点ネル先生・復習ノートモード】: 正確な書き起こしと正解のみ抽出
            prompt = `
            あなたは厳格な採点を行う先生です。小学${grade}年生の${subject}の宿題画像を分析します。
            画像に含まれる全ての問題について、以下の情報を正確に抽出・解決し、JSON配列で出力してください。
            
            重要: 採点のために「問題文」の表示が必要です。省略せずに書き起こしてください。
            
            出力形式(JSON配列):
            [
              {
                "id": 1,
                "label": "①", 
                "question": "ここに問題文を省略せず正確に書き起こす",
                "correct_answer": "正解の数字や単語のみ"
              }
            ]
            `;
        }

        // AI生成実行
        const result = await model.generateContent([
            { inlineData: { mime_type: "image/jpeg", data: image } }, 
            { text: prompt }
        ]);
        
        // 結果の整形（全角記号の揺らぎなどを吸収）
        const textRes = result.response.text()
            .replace(/\*/g, '×')
            .replace(/\//g, '÷');
            
        res.json(JSON.parse(textRes));
        
    } catch (err) { 
        console.error("Analyze Error:", err);
        res.status(500).json({ error: "AI解析に失敗したにゃ" }); 
    }
});

// SPA対応（すべてのリクエストをindex.htmlへ）
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));