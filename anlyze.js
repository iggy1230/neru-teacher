// --- anlyze.js (Live API 音声対話版) ---

let transcribedProblems = []; 
let selectedProblem = null; 
let hintIndex = 0; 
let isAnalyzing = false; 
let currentSubject = '';
let currentMode = ''; 
let lunchCount = 0; 

// ★Live API用の変数
let liveSocket = null;
let audioContext = null;
let audioWorkletNode = null;
let mediaStream = null;
let nextStartTime = 0; // 音声再生のスケジュール管理用

const subjectImages = {
    'こくご': 'nell-kokugo.png', 'さんすう': 'nell-sansu.png',
    'りか': 'nell-rika.png', 'しゃかい': 'nell-shakai.png'
};
const defaultIcon = 'nell-icon.png';

// 1. モード選択
function selectMode(m) {
    currentMode = m; 
    switchScreen('screen-main'); 
    
    // UIリセット
    const ids = ['subject-selection-view', 'upload-controls', 'thinking-view', 'problem-selection-view', 'final-view', 'chalkboard', 'chat-view', 'lunch-view'];
    ids.forEach(id => document.getElementById(id).classList.add('hidden'));
    
    // Liveチャット切断
    stopLiveChat();

    const icon = document.querySelector('.nell-avatar-wrap img');
    if(icon) icon.src = defaultIcon;
    document.getElementById('mini-karikari-display').classList.remove('hidden');
    updateMiniKarikari();

    if (m === 'chat') {
        document.getElementById('chat-view').classList.remove('hidden');
        updateNellMessage("準備ができたら「おはなしする」を押してにゃ！", "normal");
        const btn = document.getElementById('mic-btn');
        btn.innerText = "🎤 おはなしする";
        btn.onclick = startLiveChat; // 関数を切り替え
        btn.disabled = false;
        btn.style.background = "#ff85a1";
        document.getElementById('user-speech-text').innerText = "（リアルタイム対話モード）";
    } else if (m === 'lunch') {
        document.getElementById('lunch-view').classList.remove('hidden');
        updateNellMessage("お腹ペコペコだにゃ……", "thinking");
    } else if (m === 'review') {
        renderMistakeSelection();
    } else {
        document.getElementById('subject-selection-view').classList.remove('hidden');
        updateNellMessage("どの教科にするのかにゃ？", "normal");
    }
}

// 2. ★リアルタイム音声対話 (Live Chat)
async function startLiveChat() {
    const btn = document.getElementById('mic-btn');
    
    // 接続中なら切断処理へ
    if (liveSocket) {
        stopLiveChat();
        btn.innerText = "🎤 おはなしする";
        btn.style.background = "#ff85a1";
        updateNellMessage("またお話しようね！", "happy");
        return;
    }

    try {
        updateNellMessage("接続してるにゃ……", "thinking");
        
        // 1. AudioContextの準備 (サンプルレートは環境依存だが、出力時に調整される)
        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
        await audioContext.resume();
        nextStartTime = audioContext.currentTime;

        // 2. WebSocket接続
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        liveSocket = new WebSocket(`${wsProtocol}//${window.location.host}`);

        liveSocket.onopen = async () => {
            console.log("Live WS Connected");
            btn.innerText = "📞 通話中 (押すと終了)";
            btn.style.background = "#ff5252";
            updateNellMessage("つながったにゃ！なんでも話してにゃ！", "happy");
            
            // マイク開始
            await startMicrophone();
        };

        liveSocket.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            
            // サーバーからの音声データ (PCM 24kHz) を再生
            if (data.serverContent?.modelTurn?.parts?.[0]?.inlineData) {
                const base64Audio = data.serverContent.modelTurn.parts[0].inlineData.data;
                playPcmAudio(base64Audio);
            }
        };

        liveSocket.onclose = () => {
            console.log("Live WS Closed");
            stopLiveChat();
        };

    } catch (e) {
        console.error("Live Chat Error:", e);
        alert("エラーだにゃ: " + e.message);
        stopLiveChat();
    }
}

function stopLiveChat() {
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }
    if (liveSocket) {
        liveSocket.close();
        liveSocket = null;
    }
    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }
    const btn = document.getElementById('mic-btn');
    if(btn) {
        btn.innerText = "🎤 おはなしする";
        btn.style.background = "#ff85a1";
    }
}

// ★マイク入力を取得して 16kHz PCM に変換して送信
async function startMicrophone() {
    mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
            channelCount: 1,
            sampleRate: 16000, // 理想は16kだが、ブラウザが無視する場合もあるので下で変換
            echoCancellation: true
        }
    });

    const source = audioContext.createMediaStreamSource(mediaStream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);

    source.connect(processor);
    processor.connect(audioContext.destination);

    processor.onaudioprocess = (e) => {
        if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) return;

        const inputData = e.inputBuffer.getChannelData(0);
        
        // 16kHzへダウンサンプリング & Int16変換
        const targetRate = 16000;
        const currentRate = audioContext.sampleRate;
        const pcm16 = downsampleAndConvertToPCM16(inputData, currentRate, targetRate);
        
        // Base64にして送信
        const base64Audio = arrayBufferToBase64(pcm16);
        
        const msg = {
            realtime_input: {
                media_chunks: [{
                    mime_type: "audio/pcm;rate=16000",
                    data: base64Audio
                }]
            }
        };
        liveSocket.send(JSON.stringify(msg));
    };
}

// ★PCMデータ再生 (受信した24kHz音声を再生)
function playPcmAudio(base64String) {
    const pcmData = base64ToArrayBuffer(base64String);
    const float32Data = new Float32Array(pcmData.byteLength / 2);
    const dataView = new DataView(pcmData);

    // Int16 -> Float32 変換
    for (let i = 0; i < float32Data.length; i++) {
        const int16 = dataView.getInt16(i * 2, true); // Little Endian
        float32Data[i] = int16 / 32768.0;
    }

    // AudioBuffer作成 (24kHz Mono)
    const buffer = audioContext.createBuffer(1, float32Data.length, 24000);
    buffer.copyToChannel(float32Data, 0);

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);

    // 途切れないようにスケジュール再生
    const currentTime = audioContext.currentTime;
    if (nextStartTime < currentTime) nextStartTime = currentTime;
    
    source.start(nextStartTime);
    nextStartTime += buffer.duration;
}

// --- 音声処理ユーティリティ ---

// ダウンサンプリング & Int16変換
function downsampleAndConvertToPCM16(inputData, sampleRate, targetRate) {
    if (sampleRate === targetRate) {
        return floatTo16BitPCM(inputData);
    }
    const ratio = sampleRate / targetRate;
    const newLength = Math.round(inputData.length / ratio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetSource = 0;
    
    while (offsetResult < result.length) {
        const nextOffsetSource = Math.round((offsetResult + 1) * ratio);
        let accum = 0, count = 0;
        for (let i = offsetSource; i < nextOffsetSource && i < inputData.length; i++) {
            accum += inputData[i];
            count++;
        }
        result[offsetResult] = accum / count;
        offsetSource = nextOffsetSource;
        offsetResult++;
    }
    return floatTo16BitPCM(result);
}

function floatTo16BitPCM(input) {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return output.buffer;
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

function base64ToArrayBuffer(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

// 3. その他（給食などは変更なし）
function updateMiniKarikari() {
    if(currentUser) {
        document.getElementById('mini-karikari-count').innerText = currentUser.karikari;
        const k = document.getElementById('karikari-count');
        if(k) k.innerText = currentUser.karikari;
    }
}
function showKarikariEffect(amount = 5) { /* ...省略(変更なし)... */ }
function giveLunch() { /* ...省略(変更なし)... */ }
// ... (他の関数は既存のまま維持) ...
function setSubject(s) { /* ... */ updateNellMessage(`${s}の問題をみせてにゃ！`, "happy"); }
async function shrinkImage(file) { /* ... */ }
// ... (analyze, review, etc...) ...