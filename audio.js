// --- audio.js (Web Audio API版：遅延再生対応) ---

let audioCtx = null;
let currentSource = null;

// 1. オーディオエンジンの初期化（ユーザーがクリックした瞬間に呼ぶ必要がある）
function initAudioEngine() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // サスペンド状態なら再開させる（これが重要）
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

// 2. 音声再生メイン関数
async function speakNell(text, mood = "normal") {
    if (!text || text === "undefined" || text.trim() === "") return;

    // 前の音声を停止
    if (currentSource) {
        try { currentSource.stop(); } catch(e) {}
        currentSource = null;
    }

    // まだエンジンが起きてなければ起こす
    initAudioEngine();

    try {
        console.log("Synthesizing:", text);
        const res = await fetch('/synthesize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, mood })
        });

        if (!res.ok) throw new Error("Server Error");
        const data = await res.json();
        if (!data.audioContent) throw new Error("No audio");

        // Base64をバイナリデータに変換
        const binaryString = window.atob(data.audioContent);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        // デコードして再生
        const audioBuffer = await audioCtx.decodeAudioData(bytes.buffer);
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioCtx.destination);
        
        currentSource = source;
        source.start(0);

        return new Promise(resolve => {
            source.onended = resolve;
        });

    } catch (e) {
        console.error("Audio Error:", e);
        // エラー時は何もしない（止まらないようにする）
    }
}

// メッセージ更新ラッパー
async function updateNellMessage(t, mood = "normal") {
    const el = document.getElementById('nell-text');
    if (el) el.innerText = t;
    return await speakNell(t, mood);
}