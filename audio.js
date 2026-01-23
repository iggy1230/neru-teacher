// --- audio.js (v241.0: 通常TTS用) ---

let ttsCtx = null;

window.cancelNellSpeech = function() {
    if (ttsCtx) { try { ttsCtx.close(); } catch(e){} ttsCtx = null; }
    window.isNellSpeaking = false;
};

async function speakNell(text, mood = "normal") {
    if (!text || window.liveSocket) return; // Live Chat中は喋らない

    window.cancelNellSpeech();
    ttsCtx = new (window.AudioContext || window.webkitAudioContext)();

    try {
        const res = await fetch('/synthesize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, mood })
        });
        if (!res.ok) return;
        const data = await res.json();
        
        const bin = atob(data.audioContent);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const buffer = await ttsCtx.decodeAudioData(bytes.buffer);

        const source = ttsCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(ttsCtx.destination);
        source.start(0);
        
        window.isNellSpeaking = true;
        source.onended = () => { window.isNellSpeaking = false; };
        
    } catch(e) { window.isNellSpeaking = false; }
}