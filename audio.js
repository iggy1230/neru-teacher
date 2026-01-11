// --- audio.js (最終完全版) ---

let audioCtx = null;
let currentSource = null;
let abortController = null; 

window.isNellSpeaking = false;

// 外部から初期化するための関数
window.initAudioContext = async function() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }
};

// 単発のTTS再生用（補助）
async function speakNell(text, mood = "normal") {
    if (!text || text === "") return;

    if (currentSource) {
        try { currentSource.stop(); } catch(e) {}
        currentSource = null;
    }

    if (abortController) {
        abortController.abort();
    }
    abortController = new AbortController();

    window.isNellSpeaking = false;

    await window.initAudioContext();

    try {
        const res = await fetch('/synthesize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, mood }),
            signal: abortController.signal
        });

        if (!res.ok) throw new Error("TTS Error");
        const data = await res.json();
        
        const binary = window.atob(data.audioContent);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const buffer = await audioCtx.decodeAudioData(bytes.buffer);
        
        if (abortController.signal.aborted) return;

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
        if (e.name !== 'AbortError') {
            console.error("Audio Error:", e);
            window.isNellSpeaking = false;
        }
    }
}