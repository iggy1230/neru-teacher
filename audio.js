// --- audio.js (再生強化版) ---

let currentAudio = null;

async function speakNell(text, mood = "normal") {
    // 空文字チェック
    if (!text || text === "undefined" || text.trim() === "") return;

    // 前の音声を強制停止
    if (currentAudio) { 
        currentAudio.pause(); 
        currentAudio.currentTime = 0;
        currentAudio = null; 
    }

    try {
        console.log("Fetching TTS for:", text);
        const res = await fetch('/synthesize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, mood })
        });

        if (!res.ok) throw new Error("TTS Server Error");

        const data = await res.json();
        if (!data.audioContent) throw new Error("No audio content");

        // 音声再生
        return new Promise(resolve => {
            const audio = new Audio("data:audio/mp3;base64," + data.audioContent);
            currentAudio = audio;

            audio.onended = () => {
                console.log("Playback ended");
                resolve();
            };
            
            audio.onerror = (e) => {
                console.error("Audio Playback Error:", e);
                // エラーでも止まらないようにresolveする
                resolve(); 
            };
            
            // 再生実行（ユーザー操作直後でないとブロックされる可能性があるが、会話の流れなら通ることが多い）
            const playPromise = audio.play();
            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    console.warn("Autoplay blocked:", error);
                    // 自動再生がブロックされた場合、ユーザーに「再生ボタン」などを出すのが定石だが
                    // ここでは進行を止めないためにresolveする
                    resolve();
                });
            }
        });

    } catch (e) {
        console.error("Voice Error:", e);
        // サーバーエラー時は何もしない（無音で進む）
        return Promise.resolve();
    }
}

// ネル先生のメッセージ更新ラッパー
async function updateNellMessage(t, mood = "normal") {
    const el = document.getElementById('nell-text');
    if (el) el.innerText = t;
    // テキスト表示後に音声を再生
    return await speakNell(t, mood);
}