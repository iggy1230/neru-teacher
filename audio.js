// --- audio.js (再生エラー対策版) ---

let currentAudio = null;

async function speakNell(text, mood = "normal") {
    // 空文字や未定義の場合は何もしない
    if (!text || text === "undefined" || text.trim() === "") return;

    // 前の音声を停止
    if (currentAudio) { 
        currentAudio.pause(); 
        currentAudio = null; 
    }

    try {
        // サーバーの音声合成APIを呼び出す
        const res = await fetch('/synthesize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, mood })
        });

        if (!res.ok) throw new Error("TTS Server Error");

        const data = await res.json();
        if (!data.audioContent) throw new Error("No audio content");

        // Base64音声を再生
        // 再生時にエラーが出たらフォールバックするようにイベントリスナーを設定
        return new Promise(resolve => {
            const audio = new Audio("data:audio/mp3;base64," + data.audioContent);
            currentAudio = audio;

            audio.onended = resolve;
            
            // 再生エラー（形式非対応など）の場合
            audio.onerror = () => {
                console.warn("Audio Playback Error, falling back to browser voice.");
                fallbackSpeech(text, resolve); 
            };
            
            // play()のPromiseが拒否された場合（自動再生ポリシーなど）
            audio.play().catch(e => {
                console.warn("Autoplay blocked or failed:", e);
                // 再生できない場合は、無理にロボット声を出さずに終了させる（エラー音回避）
                resolve();
            });
        });

    } catch (e) {
        console.warn("Voice Synthesis Failed (using browser voice):", e);
        // 通信エラーなどの場合はブラウザの音声を使う
        return new Promise(resolve => fallbackSpeech(text, resolve));
    }
}

// ブラウザ標準の音声合成（フォールバック）
function fallbackSpeech(text, callback) {
    if (!window.speechSynthesis) {
        if (callback) callback();
        return;
    }
    
    // 現在の発声をキャンセル
    window.speechSynthesis.cancel();

    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    u.rate = 1.2; // 少し早口にして子供っぽく
    u.pitch = 1.5; // 声を高くして猫っぽく
    
    u.onend = callback;
    u.onerror = callback; 
    
    window.speechSynthesis.speak(u);
}

// メッセージ更新関数
async function updateNellMessage(t, mood = "normal") {
    const el = document.getElementById('nell-text');
    if (el) el.innerText = t;
    return await speakNell(t, mood);
}