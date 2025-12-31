import textToSpeech from '@google-cloud/text-to-speech';
import { GoogleGenerativeAI } from "@google/generative-ai";
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws'; // ★WebSocketServerをインポート★

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '.')));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const ttsClient = new textToSpeech.TextToSpeechClient({ 
    credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON) 
});

// SSML生成（ロボット声対策強化版）
function createSSML(text, mood) {
    let rate = "1.0"; let pitch = "0.0";
    if (mood === "happy") { rate = "1.1"; pitch = "+2st"; }
    if (mood === "thinking") { rate = "0.95"; pitch = "-1st"; }
    if (mood === "gentle") { rate = "0.9"; pitch = "+1st"; }
    if (mood === "excited") { rate = "1.2"; pitch = "+4st"; }
    
    let cleanText = text.replace(/🐾|✨|⭐|🎵|🐟/g, '').replace(/⭕️/g, '正解').replace(/❌/g, '不正解');

    // ★特別対策：教科選択メッセージはシンプルに
    if (cleanText.includes("どの教科") && cleanText.includes("にするのかにゃ")) {
        return `<speak>${cleanText}</speak>`;
    }

    cleanText = cleanText
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    const processedText = cleanText
        .replace(/……/g, '<break time="650ms"/>')
        .replace(/にゃ/g, '<prosody pitch="+3st">にゃ</prosody>'); // プロソディタグを安定化のため個別に適用
        
    return `<speak><prosody rate="${rate}" pitch="${pitch}">${processedText}</prosody></speak>`;
}

app.post('/synthesize', async (req, res) => {
    try {
        const { text, mood } = req.body;
        if (!text) return res.status(400).json({ error: "No text" });

        try {
            const [response] = await ttsClient.synthesizeSpeech({
                input: { ssml: createSSML(text, mood) },
                voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' },
                audioConfig: { audioEncoding: 'MP3' },
            });
            return res.json({ audioContent: response.audioContent.toString('base64') });
        } catch (innerErr) {
            console.warn("TTS Rich Failed, retrying simple mode:", innerErr.message);
            // 失敗したらシンプルなSSMLで再試行
            const [retryRes] = await ttsClient.synthesizeSpeech({
                input: { text: text.replace(/🐾|✨|⭐|🎵|🐟/g, '').replace(/⭕️/g, '正解').replace(/❌/g, '不正解') }, // タグなしテキスト
                voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' },
                audioConfig: { audioEncoding: 'MP3' },
            });
            return res.json({ audioContent: retryRes.audioContent.toString('base64') });
        }
    } catch (err) { 
        console.error("TTS Fatal Error:", err);
        res.status(500).send(err.message); 
    }
});

// 通常の分析エンドポイントは残す
app.post('/analyze', async (req, res) => {
    try {
        const { image, mode, grade, subject } = req.body;
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash", 
            generationConfig: { responseMimeType: "application/json" }
        });
        
        const hintInstruction = `
        - "hints": 生徒が間違えた時に備えて、解き方を導くヒントを3つ作成してください。
          1. 「考え方の入り口」
          2. 「式のヒントや途中経過」
          3. 「答えにかなり近づく大きなヒント（※ただし答えそのものは書かないでください）」
          語尾は「〜だにゃ」「〜してね」等のネル先生口調にしてください。
        `;

        let prompt = "";
        if (mode === 'explain') {
            prompt = `あなたは「ネル先生」。小学${grade}年生の${subject}。画像から全問抽出。
            1. "question": 問題文書き起こし。
            2. "correct_answer": 正解。
            3. ${hintInstruction}
            4. 算数記号は×÷。JSON配列で出力。
            `;
        } else {
            prompt = `厳格な採点先生。小学${grade}年生の${subject}。
            1. "question": 問題文書き起こし。
            2. "correct_answer": 正解。
            3. "student_answer": 手書き文字読み取り(空欄なら"")。
            4. ${hintInstruction}
            JSON配列で出力。
            `;
        }

        const result = await model.generateContent([{ inlineData: { mime_type: "image/jpeg", data: image } }, { text: prompt }]);
        res.json(JSON.parse(result.response.text().replace(/\*/g, '×').replace(/\//g, '÷')));
    } catch (err) { 
        console.error("Analyze Error:", err);
        res.status(500).json({ error: "AI解析エラー" }); 
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// ★★★ Gemini Live API用 WebSocketサーバー ★★★
const wss = new WebSocketServer({ server });

wss.on('connection', async (ws) => {
    console.log('Client connected to WebSocket for live chat');
    
    // Gemini Live APIへの接続
    let geminiWs = null;

    // クライアントから初期設定を受け取る
    ws.on('message', async (message) => {
        const data = JSON.parse(message);

        if (data.type === 'init') {
            const { grade, name } = data.payload;
            
            // Gemini Live APIのURL
            const geminiLiveApiUrl = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidirectionalGenerateContent?key=" + process.env.GEMINI_API_KEY;

            geminiWs = new WebSocket(geminiLiveApiUrl);

            geminiWs.onopen = () => {
                console.log('Connected to Gemini Live API');
                // ネル先生の魂設定をGeminiに送信
                const setupMessage = {
                    "configure_session": {
                        "model": "models/gemini-1.5-flash-preview-0514", // Live APIは専用モデル
                        "generation_config": {
                            "response_modalities": ["audio"],
                            "speech_config": {
                                "voice_config": { "prebuilt_voice_config": { "voice_name": "Puck" } } // 猫っぽい声
                            }
                        },
                        "system_instruction": {
                            "parts": [{ "text": `あなたは『猫後市立ねこづか小学校』のネル先生です。相手は小学${grade}年生の「${name}」さんです。語尾は必ず『〜にゃ』にしてください。親切に、短く（30文字以内）、優しく、楽しくお話ししてください。子供の相談に乗ってあげてください。` }]
                        }
                    }
                };
                geminiWs.send(JSON.stringify(setupMessage));
            };

            geminiWs.onmessage = (event) => {
                // Geminiからのメッセージをそのままクライアントに転送
                const geminiData = JSON.parse(event.data);
                if (geminiData.generate_content_response?.candidates?.[0]?.audio) {
                    ws.send(JSON.stringify({ type: 'audio', audioContent: geminiData.generate_content_response.candidates[0].audio.audio_bytes }));
                } else if (geminiData.generate_content_response?.candidates?.[0]?.text) {
                    // テキスト応答もクライアントに送る (デバッグ用や画面表示用)
                    ws.send(JSON.stringify({ type: 'text', textContent: geminiData.generate_content_response.candidates[0].text.parts[0].text }));
                }
            };

            geminiWs.onerror = (error) => {
                console.error('Gemini Live API Error:', error);
                ws.send(JSON.stringify({ type: 'error', message: 'Gemini Live APIでエラーが発生したにゃ。' }));
                geminiWs.close();
            };

            geminiWs.onclose = () => {
                console.log('Disconnected from Gemini Live API');
            };

        } else if (data.type === 'audio') {
            // クライアントからの音声データを受け取り、Geminiへ転送
            if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
                geminiWs.send(JSON.stringify({ "stream_generate_content_request": { "audio_input": { "audio_chunk": data.audioChunk } } }));
            }
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected from WebSocket');
        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
            geminiWs.close();
        }
    });

    ws.onerror = (error) => {
        console.error('Client WebSocket Error:', error);
    };
});