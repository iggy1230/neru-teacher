import textToSpeech from '@google-cloud/text-to-speech';
import { GoogleGenerativeAI } from "@google/generative-ai";
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
// ★修正点1：WebSocket をデフォルトインポートとして追加（これで new WebSocket が使えるようになります）
import WebSocket, { WebSocketServer } from 'ws'; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '.')));

// 認証情報の読み込みエラー対策
let genAI;
let ttsClient;
try {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    ttsClient = new textToSpeech.TextToSpeechClient({ 
        credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON) 
    });
} catch (e) {
    console.error("Credentials Error:", e.message);
    // 起動時に環境変数がなくても、サーバーだけは立ち上がるようにする（ログで気づけるように）
}

// SSML生成
function createSSML(text, mood) {
    let rate = "1.0"; let pitch = "0.0";
    if (mood === "happy") { rate = "1.1"; pitch = "+2st"; }
    if (mood === "excited") { rate = "1.2"; pitch = "+4st"; }
    if (mood === "thinking") { rate = "0.95"; pitch = "-1st"; }
    
    let cleanText = text.replace(/🐾|✨|⭐|🎵|🐟/g, '').replace(/⭕️/g, '正解').replace(/❌/g, '不正解');

    if (cleanText.includes("どの教科") || cleanText.includes("にするにゃ")) {
        return `<speak>${cleanText}</speak>`;
    }

    cleanText = cleanText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const processedText = cleanText.replace(/……/g, '<break time="650ms"/>').replace(/にゃ/g, 'にゃ');
        
    return `<speak><prosody rate="${rate}" pitch="${pitch}">${processedText}</prosody></speak>`;
}

app.post('/synthesize', async (req, res) => {
    try {
        if (!ttsClient) throw new Error("TTS Client not initialized");
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
            console.warn("TTS Retry:", innerErr.message);
            const [retryRes] = await ttsClient.synthesizeSpeech({
                input: { text: text.replace(/🐾|✨|⭐|🎵|🐟/g, '') },
                voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' },
                audioConfig: { audioEncoding: 'MP3' },
            });
            return res.json({ audioContent: retryRes.audioContent.toString('base64') });
        }
    } catch (err) { 
        console.error("TTS Error:", err);
        res.status(500).send(err.message); 
    }
});

app.post('/chat', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not initialized");
        const { message, grade, name } = req.body;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        
        const prompt = `あなたは「ネル先生」。小学${grade}年生の「${name}」さんとの会話。
        発言: ${message}
        30文字以内、猫語（〜にゃ）で優しく返信。`;
        
        const result = await model.generateContent(prompt);
        res.json({ reply: result.response.text() });
    } catch (err) {
        console.error("Chat Error:", err);
        res.status(500).json({ error: "Chat Error" });
    }
});

app.post('/analyze', async (req, res) => {
    try {
        if (!genAI) throw new Error("GenAI not initialized");
        const { image, mode, grade, subject } = req.body;
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.0-flash", 
            generationConfig: { responseMimeType: "application/json" }
        });
        
        const hintInstruction = `
        - "hints": ヒント3つ。1.考え方 2.式 3.ほぼ答え。語尾は「〜にゃ」。
        `;

        let prompt = "";
        if (mode === 'explain') {
            prompt = `ネル先生。小学${grade} ${subject}。全問抽出。
            1."question":書き起こし 2."correct_answer":正解 3.${hintInstruction} 4.記号は×÷。JSON配列。`;
        } else {
            prompt = `採点。小学${grade} ${subject}。
            1."question":書き起こし 2."correct_answer":正解 3."student_answer":手書き読取 4.${hintInstruction} JSON配列。`;
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

// ★★★ WebSocketサーバー ★★★
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log('Client connected to WebSocket');
    let geminiWs = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'init') {
                const { grade, name } = data.payload;
                const geminiLiveApiUrl = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidirectionalGenerateContent?key=" + process.env.GEMINI_API_KEY;

                // ★修正点2：ここで new WebSocket を使うために、冒頭の import WebSocket from 'ws' が必要でした
                geminiWs = new WebSocket(geminiLiveApiUrl);

                geminiWs.onopen = () => {
                    console.log('Connected to Gemini Live API');
                    const setupMessage = {
                        "setup": { // ★Live APIの仕様に合わせてキー名を 'setup' に修正
                            "model": "models/gemini-2.0-flash-exp", 
                            "generation_config": {
                                "response_modalities": ["AUDIO"], // 小文字ではなく大文字推奨の場合あり
                                "speech_config": {
                                    "voice_config": { "prebuilt_voice_config": { "voice_name": "Puck" } }
                                }
                            },
                            "system_instruction": {
                                "parts": [{ "text": `あなたはネル先生。相手は小学${grade}年生の${name}さん。語尾は「にゃ」。` }]
                            }
                        }
                    };
                    geminiWs.send(JSON.stringify(setupMessage));
                };

                geminiWs.onmessage = (event) => {
                    try {
                        const geminiData = JSON.parse(event.data);
                        // 音声データがある場合
                        if (geminiData.serverContent?.modelTurn?.parts?.[0]?.inlineData) {
                             const audioData = geminiData.serverContent.modelTurn.parts[0].inlineData.data;
                             ws.send(JSON.stringify({ type: 'audio', audioContent: audioData }));
                        }
                    } catch (e) {
                        console.error("Gemini Msg Parse Error", e);
                    }
                };
                
                geminiWs.onerror = (err) => console.error("Gemini WS Error:", err);
                geminiWs.onclose = () => console.log("Gemini WS Closed");

            } else if (data.type === 'audio') {
                // クライアントからの音声を転送
                if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
                    const audioMsg = {
                        "realtime_input": {
                            "media_chunks": [{
                                "mime_type": "audio/pcm;rate=16000", // WebMではなくPCMが推奨されることが多いが一旦WebMで試行
                                "data": data.audioChunk
                            }]
                        }
                    };
                    // Live APIは仕様が流動的なため、シンプルなcontent送信形式を使用
                    geminiWs.send(JSON.stringify({ "client_content": { "turns": [{ "role": "user", "parts": [{ "inline_data": { "mime_type": "audio/webm", "data": data.audioChunk } }] }] } }));
                }
            }
        } catch (e) {
            console.error("WS Message Error:", e);
        }
    });

    ws.on('close', () => {
        if (geminiWs && geminiWs.readyState === WebSocket.OPEN) geminiWs.close();
    });
});