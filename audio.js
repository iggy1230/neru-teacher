let currentAudio = null;

async function speakNell(text, mood = "normal") {
    if (!text || text === "undefined") return;
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    try {
        const res = await fetch('/synthesize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, mood })
        });
        const data = await res.json();
        currentAudio = new Audio("data:audio/mp3;base64," + data.audioContent);
        return new Promise(resolve => {
            currentAudio.onended = resolve;
            currentAudio.play();
        });
    } catch (e) {
        return new Promise(resolve => {
            const u = new SpeechSynthesisUtterance(text);
            u.lang = 'ja-JP'; u.onend = resolve;
            window.speechSynthesis.speak(u);
        });
    }
}

async function updateNellMessage(t, mood = "normal") {
    const el = document.getElementById('nell-text');
    if (el) el.innerText = t;
    return await speakNell(t, mood);
}