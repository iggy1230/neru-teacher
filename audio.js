// --- audio.js (重複完全防止版) ---

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
        await audioCtx.resume();
    }
};

async function speakNell(text, mood = "normal") {
    if (!text || text === "") return;

    // 1. 前の音声を停止
    if (currentSource) {
        try { currentSource.stop(); } catch(e) {}
        currentSource = null;
    }

    // 2. 前の通信（読み込み中）があればキャンセル
    if (abortController) {
        abortController.abort();
    }
    abortController = new AbortController(); // 新しいコントローラー作成

    // 3. 口パクOFF（一旦リセット）
    window.isNellSpeaking = false;

    await window.initAudioContext();

    try {
        const res = await fetch('/synthesize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, mood }),
            signal: abortController.signal // キャンセル信号を紐付け
        });

        if (!res.ok) throw new Error("TTS Error");
        const data = await res.json();
        
        const binary = window.atob(data.audioContent);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const buffer = await audioCtx.decodeAudioData(bytes.buffer);
        
        // デコード中に別の音声リクエストが来ていたら再生しない
        if (abortController.signal.aborted) return;

        const source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(audioCtx.destination);
        currentSource = source;
        
        // ★再生開始
        window.isNellSpeaking = true;
        source.start(0);

        return new Promise(resolve => {
            source.onended = () => {
                // 最後まで再生された場合のみOFFにする
                // (途中で次のが来て強制停止された場合は、次のやつがONにするので触らない)
                if (currentSource === source) {
                    window.isNellSpeaking = false;
                    currentSource = null;
                }
                resolve();
            };
        });

    } catch (e) {
        // キャンセルされたエラーなら無視、それ以外はログ出力
        if (e.name !== 'AbortError') {
            console.error("Audio Error:", e);
            window.isNellSpeaking = false;
        }
    }
}

async function updateNellMessage(t, mood = "normal") {
    const el = document.getElementById('nell-text');
    if (el) el.innerText = t;
    return await speakNell(t, mood);
}