// --- js/audio/audio.js (v308.0: AudioContext再生成対応版) ---

window.audioCtx = null;
window.masterGainNode = null; // 全体の音量制御用
let currentSource = null;
let abortController = null; 

window.isNellSpeaking = false;

window.initAudioContext = async function() {
    try {
        // 既にコンテキストがあるが、閉じている(closed)場合は破棄して再作成させる
        if (window.audioCtx && window.audioCtx.state === 'closed') {
            console.log("AudioContext is closed. Re-initializing...");
            window.audioCtx = null;
            window.masterGainNode = null;
        }

        // コンテキストがない場合は新規作成
        if (!window.audioCtx) {
            window.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            
            // Master Gain Node 作成
            window.masterGainNode = window.audioCtx.createGain();
            window.masterGainNode.connect(window.audioCtx.destination);
            
            // 初期音量を適用
            const targetVol = (typeof window.isMuted !== 'undefined' && window.isMuted) ? 0 : (window.appVolume || 0.5);
            window.masterGainNode.gain.setValueAtTime(targetVol, window.audioCtx.currentTime);

            // voice-service.js 等で使われる window.audioContext と同期をとる
            window.audioContext = window.audioCtx;
        }
        
        if (window.audioCtx.state === 'suspended') {
            await window.audioCtx.resume();
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
        const timeoutId = setTimeout(() => abortController.abort(), 10000);

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

        // decodeAudioDataはContextがclosedだと失敗するので、initAudioContextで確実に開いておく
        if (!window.audioCtx || window.audioCtx.state === 'closed') {
             await window.initAudioContext();
        }

        const buffer = await window.audioCtx.decodeAudioData(bytes.buffer);
        
        if (signal.aborted) return;

        const source = window.audioCtx.createBufferSource();
        source.buffer = buffer;
        
        // Master Gain Node に接続して音量制御を有効化
        if (window.masterGainNode) {
            source.connect(window.masterGainNode);
        } else {
            source.connect(window.audioCtx.destination);
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