// --- audio.js (口パクスイッチ完全連動版) ---

let audioCtx = null;
let currentSource = null;

// ★世界共通の口パクスイッチ（初期化）
window.isNellSpeaking = false;

// 外部からオーディオエンジンを起動できるようにする
window.initAudioContext = async function() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }
};

async function speakNell(text, mood = "normal") {
    if (!text || text === "") return;

    // 前の音声を停止
    if (currentSource) {
        try { currentSource.stop(); } catch(e) {}
        currentSource = null;
    }
    window.isNellSpeaking = false; // 一旦リセット

    await window.initAudioContext();

    try {
        const res = await fetch('/synthesize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, mood })
        });

        if (!res.ok) throw new Error("TTS Error");
        const data = await res.json();
        
        const binary = window.atob(data.audioContent);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }

        const buffer = await audioCtx.decodeAudioData(bytes.buffer);
        const source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(audioCtx.destination);
        
        currentSource = source;
        
        // ★再生開始：口パクON
        window.isNellSpeaking = true;
        source.start(0);

        return new Promise(resolve => {
            source.onended = () => {
                // ★再生終了：口パクOFF
                window.isNellSpeaking = false;
                currentSource = null;
                resolve();
            };
        });

    } catch (e) {
        console.error("Audio Error:", e);
        window.isNellSpeaking = false;
    }
}

// メッセージ更新ラッパー
async function updateNellMessage(t, mood = "normal") {
    const el = document.getElementById('nell-text');
    if (el) el.innerText = t;
    // テキスト表示後に音声再生
    return await speakNell(t, mood);
}