// --- audio.js (音声再生・口パク連動 完全版) ---

let audioCtx = null;
let currentSource = null;

// ★重要: 口パク管理用グローバル変数 (anlyze.jsと共有)
// trueの間、anlyze.jsが画像をパカパカ切り替えます
window.isNellSpeaking = false;

// 外部（ボタンクリック時など）からオーディオエンジンを起動するための関数
window.initAudioContext = async function() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }
};

async function speakNell(text, mood = "normal") {
    // 空文字なら何もしない
    if (!text || text === "") return;

    // 前の音声が再生中なら停止する
    if (currentSource) {
        try { currentSource.stop(); } catch(e) {}
        currentSource = null;
    }
    
    // 一旦口を閉じる
    window.isNellSpeaking = false;

    // オーディオエンジン準備
    await window.initAudioContext();

    try {
        // サーバーに音声合成をリクエスト
        const res = await fetch('/synthesize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, mood })
        });

        if (!res.ok) throw new Error("TTS Error");
        const data = await res.json();
        
        // Base64データをバイナリに変換
        const binary = window.atob(data.audioContent);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }

        // 音声データをデコード
        const buffer = await audioCtx.decodeAudioData(bytes.buffer);
        
        // 音源ノード作成
        const source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(audioCtx.destination);
        
        currentSource = source;
        
        // ★再生開始：口パクスイッチON
        window.isNellSpeaking = true;
        source.start(0);

        // 再生終了時の処理
        return new Promise(resolve => {
            source.onended = () => {
                // ★再生終了：口パクスイッチOFF
                window.isNellSpeaking = false;
                currentSource = null;
                resolve();
            };
        });

    } catch (e) {
        console.error("Audio Error:", e);
        // エラーが起きても口パク状態は解除しておく
        window.isNellSpeaking = false;
    }
}

// ネル先生の吹き出しを更新して喋らせるラッパー関数
async function updateNellMessage(t, mood = "normal") {
    const el = document.getElementById('nell-text');
    if (el) el.innerText = t;
    // テキスト更新後に音声を再生
    return await speakNell(t, mood);
}