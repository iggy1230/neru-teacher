// --- audio.js (独立再生版) ---

let currentAudio = null;

async function speakNell(text, mood = "normal") {
    if (!text || text === "") return;

    // 前の音声を止める
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }

    try {
        const res = await fetch('/synthesize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, mood })
        });

        if (!res.ok) throw new Error("TTS Error");
        const data = await res.json();
        
        // 通常のHTML5 Audioで再生（これが一番干渉しにくい）
        const audio = new Audio("data:audio/mp3;base64," + data.audioContent);
        currentAudio = audio;
        
        return new Promise(resolve => {
            audio.onended = resolve;
            audio.onerror = resolve;
            audio.play().catch(e => {
                console.warn("Autoplay blocked", e);
                resolve();
            });
        });

    } catch (e) {
        console.error("Voice Error:", e);
    }
}

async function updateNellMessage(t, mood = "normal") {
    const el = document.getElementById('nell-text');
    if (el) el.innerText = t;
    // メッセージ表示後に音声を再生
    return await speakNell(t, mood);
}