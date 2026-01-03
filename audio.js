// --- audio.js (口パク連動・完全版) ---

let audioCtx = null;
let currentSource = null;

// ★重要: グローバル変数を初期化
window.isNellSpeaking = false;

async function speakNell(text, mood = "normal") {
    if (!text || text === "") return;

    if (currentSource) { try { currentSource.stop(); } catch(e) {} currentSource = null; }

    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();

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
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const buffer = await audioCtx.decodeAudioData(bytes.buffer);
        const source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(audioCtx.destination);
        currentSource = source;
        
        // ★口パク開始
        window.isNellSpeaking = true;
        source.start(0);

        return new Promise(resolve => {
            source.onended = () => {
                // ★口パク終了
                window.isNellSpeaking = false;
                resolve();
            };
        });

    } catch (e) {
        console.error("Audio Error:", e);
        window.isNellSpeaking = false;
    }
}

async function updateNellMessage(t, mood = "normal") {
    const el = document.getElementById('nell-text');
    if (el) el.innerText = t;
    return await speakNell(t, mood);
}