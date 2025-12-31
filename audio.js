// --- audio.js (堅牢版) ---
let audioCtx = null;
let currentSource = null;

async function speakNell(text, mood = "normal") {
    if (!text) return;
    if (currentSource) { try { currentSource.stop(); } catch(e){} currentSource = null; }

    // AudioContextシングルトン管理
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    try {
        const res = await fetch('/synthesize', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, mood })
        });
        if (!res.ok) throw new Error("TTS Error");
        const data = await res.json();
        
        const binary = window.atob(data.audioContent);
        const bytes = new Uint8Array(binary.length);
        for(let i=0; i<binary.length; i++) bytes[i] = binary.charCodeAt(i);
        
        const buffer = await audioCtx.decodeAudioData(bytes.buffer);
        const source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(audioCtx.destination);
        currentSource = source;
        source.start(0);
        return new Promise(r => source.onended = r);
    } catch(e) { console.error(e); }
}

async function updateNellMessage(t, m="normal") {
    const el = document.getElementById('nell-text');
    if(el) el.innerText = t;
    return await speakNell(t, m);
}