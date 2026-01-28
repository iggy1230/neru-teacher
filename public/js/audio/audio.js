// --- audio.js (完全版 v297.0: 音量制御対応) ---

let audioCtx = null;
let currentSource = null;
let abortController = null; 
window.ttsGainNode = null; // 音量制御用

window.isNellSpeaking = false;

window.initAudioContext = async function() {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            window.ttsGainNode = audioCtx.createGain();
            window.ttsGainNode.connect(audioCtx.destination);
            
            // 現在の音量を適用
            const targetVol = window.isMuted ? 0 : (window.appVolume || 0.5);
            window.ttsGainNode.gain.value = targetVol;
        }
        
        if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
            console.log("AudioContext resumed");
        }
    } catch(e) {
        console.warn("AudioContext init/resume failed:", e);
    }
};

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

    window.cancelNellSpeech();

    abortController = new AbortController();
    const signal = abortController.signal;

    window.isNellSpeaking = false;

    await window.initAudioContext();

    try {
        const timeoutId = setTimeout(() => abortController.abort(), 5000);

        const res = await fetch('/synthesize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, mood }),
            signal: signal
        });

        clearTimeout(timeoutId);

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
        
        // GainNodeを経由して接続 (音量制御のため)
        if (window.ttsGainNode) {
            source.connect(window.ttsGainNode);
            // 再生直前にも念のため音量同期
            const currentVol = window.isMuted ? 0 : (window.appVolume || 0.5);
            window.ttsGainNode.gain.setValueAtTime(currentVol, audioCtx.currentTime);
        } else {
            source.connect(audioCtx.destination);
        }
        
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
            console.error("Audio Playback Error:", e);
        }
        window.isNellSpeaking = false;
    }
}