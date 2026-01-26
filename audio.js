// --- audio.js (完全版 v240.0: タイムアウト＆安全装置付き) ---

let audioCtx = null;
let currentSource = null;
let abortController = null; // 通信キャンセル用

// 口パク管理用グローバル変数
window.isNellSpeaking = false;

// 外部から初期化
window.initAudioContext = async function() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        try {
            await audioCtx.resume();
        } catch(e) {
            console.warn("AudioContext resume failed:", e);
        }
    }
};

// 通常のTTSを強制停止する関数（Live Chat優先用）
window.cancelNellSpeech = function() {
    if (currentSource) {
        try { currentSource.stop(); } catch(e) {}
        currentSource = null;
    }
    if (abortController) {
        abortController.abort();
        abortController = null;
    }
    window.isNellSpeaking = false;
};

async function speakNell(text, mood = "normal") {
    if (!text || text === "") return;

    // 1. 前の音声を停止
    window.cancelNellSpeech();

    // 2. 新しい通信用コントローラー
    abortController = new AbortController();
    const signal = abortController.signal;

    // 3. 口パクOFF (準備中)
    window.isNellSpeaking = false;

    // AudioContextの準備（エラーでも止まらないようにする）
    try {
        await window.initAudioContext();
    } catch(e) {
        console.error("Audio Init Failed:", e);
        return; // 音声なしで終了
    }

    try {
        // ★修正: 5秒のタイムアウトを設定
        const timeoutId = setTimeout(() => abortController.abort(), 5000);

        const res = await fetch('/synthesize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, mood }),
            signal: signal
        });

        clearTimeout(timeoutId); // 成功したらタイマー解除

        if (!res.ok) throw new Error(`TTS Error: ${res.status}`);
        const data = await res.json();
        
        if (signal.aborted) return;

        const binary = window.atob(data.audioContent);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const buffer = await audioCtx.decodeAudioData(bytes.buffer);
        
        if (signal.aborted) return;

        const source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(audioCtx.destination);
        currentSource = source;
        
        window.isNellSpeaking = true;
        source.start(0);

        return new Promise(resolve => {
            source.onended = () => {
                if (currentSource === source) {
                    window.isNellSpeaking = false;
                    currentSource = null;
                }
                resolve();
            };
        });

    } catch (e) {
        // エラーが出てもアプリを止めない
        if (e.name === 'AbortError') {
            console.log("TTS Timed out or Aborted");
        } else {
            console.error("Audio Playback Error:", e);
        }
        window.isNellSpeaking = false;
    }
}