// --- audio.js (完全版 v290.0: 音量管理 & SEローダー強化版) ---

let audioCtx = null;
let currentSource = null;
let abortController = null;
let masterGainNode = null; // 全体の音量
let isMuted = false;
let globalVolume = 1.0;

// 口パク管理用グローバル変数
window.isNellSpeaking = false;

// SE用バッファキャッシュ
const seBuffers = {};
const seList = [
    'boribori.mp3', 'cat1c.mp3', 'poka02.mp3', 'gameover.mp3', 
    'bunseki.mp3', 'hirameku.mp3', 'maru.mp3', 'batu.mp3', 
    'Jpn_sch_chime.mp3', 'botan1.mp3', 'class_door1.mp3'
];

// 初期化
window.initAudioContext = async function() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        // マスターゲインノード作成
        masterGainNode = audioCtx.createGain();
        masterGainNode.gain.value = globalVolume;
        masterGainNode.connect(audioCtx.destination);

        // SEのプリロード
        seList.forEach(url => loadSE(url));
    }
    if (audioCtx.state === 'suspended') {
        try {
            await audioCtx.resume();
        } catch(e) {
            console.warn("AudioContext resume failed:", e);
        }
    }
    return audioCtx;
};

// SE読み込み
async function loadSE(url) {
    try {
        const res = await fetch(url);
        const arrayBuffer = await res.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        seBuffers[url] = audioBuffer;
    } catch(e) {
        console.error(`Failed to load SE: ${url}`, e);
    }
}

// SE再生 (Web Audio API経由)
window.playSE = async function(url, loop = false) {
    if (isMuted) return; // ミュート時は再生しない
    await window.initAudioContext();
    
    const buffer = seBuffers[url];
    if (!buffer) {
        // まだ読み込まれていない場合は読み込んで再生
        await loadSE(url);
        if (seBuffers[url]) return window.playSE(url, loop);
        return;
    }

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    
    // SE専用ゲイン（必要なら調整）
    const seGain = audioCtx.createGain();
    seGain.gain.value = 1.0; // SEは常に100%（マスターで調整）
    
    source.connect(seGain);
    seGain.connect(masterGainNode); // マスターに接続
    
    source.start(0);
    return source; // 停止制御が必要な場合用（BGMなど）
};

// 音量設定
window.setGlobalVolume = function(val) {
    // val: 0-100
    globalVolume = val / 100;
    if (masterGainNode) {
        masterGainNode.gain.value = isMuted ? 0 : globalVolume;
    }
};

// ミュート切り替え
window.toggleMute = function() {
    isMuted = !isMuted;
    const btn = document.getElementById('mute-btn');
    if (btn) btn.innerText = isMuted ? "🔇" : "🔊";
    
    if (masterGainNode) {
        masterGainNode.gain.value = isMuted ? 0 : globalVolume;
    }
};

// 通常のTTSを強制停止する関数
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

// TTS再生関数
async function speakNell(text, mood = "normal") {
    if (!text || text === "") return;
    window.cancelNellSpeech();

    abortController = new AbortController();
    const signal = abortController.signal;
    window.isNellSpeaking = false;

    try {
        await window.initAudioContext();
    } catch(e) { return; }

    try {
        const timeoutId = setTimeout(() => abortController.abort(), 8000); // タイムアウト延長

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
        
        // マスターゲインに接続
        source.connect(masterGainNode);
        
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
        if (e.name !== 'AbortError') console.error("Audio Playback Error:", e);
        window.isNellSpeaking = false;
    }
}

// 外部からマスターゲインを取得するためのアクセサ
window.getMasterGainNode = function() {
    return masterGainNode;
};
window.getAudioContext = function() {
    return audioCtx;
};