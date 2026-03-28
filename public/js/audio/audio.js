// --- START OF FILE audio.js ---

// --- js/audio/audio.js (v442.0: 公式Google Cloud TTS 高音質版) ---
window.audioCtx = null;
window.masterGainNode = null; 
window.currentNellAudio = null;
window.isNellSpeaking = false;
window.speechQueue =[]; // 長文を分割して順番に再生するためのキュー

window.initAudioContext = async function() {
    try {
        if (!window.audioCtx) {
            window.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            window.masterGainNode = window.audioCtx.createGain();
            window.masterGainNode.connect(window.audioCtx.destination);

            const targetVol = (typeof window.isMuted !== 'undefined' && window.isMuted) ? 0 : (window.appVolume || 0.5);
            window.masterGainNode.gain.setValueAtTime(targetVol, window.audioCtx.currentTime);

            window.audioContext = window.audioCtx;
        }
        
        if (window.audioCtx.state === 'suspended') {
            await window.audioCtx.resume();
        }
    } catch(e) {
        console.warn("AudioContext init/resume failed:", e);
    }
};

window.cancelNellSpeech = function() {
    window.isNellSpeaking = false;
    window.speechQueue =[]; // キューを空にする
    if (window.currentNellAudio) {
        window.currentNellAudio.pause();
        window.currentNellAudio.currentTime = 0;
        window.currentNellAudio = null;
    }
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }
};

// ★公式APIを使って音声を再生する
window.speakNell = function(text, mood = "normal") {
    return new Promise((resolve) => {
        if (!text || text === "") return resolve();

        window.cancelNellSpeech();

        let cleanText = text;
        cleanText = cleanText.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, ''); 
        cleanText = cleanText.replace(/[★☆✨♪！!？?🐾]/g, ''); 
        cleanText = cleanText.replace(/[\(（][^\)）]+[\)）]/g, ''); 

        if (cleanText.trim() === "") return resolve();

        // 長い文章は句点で分割して順番にAPIに投げる
        let sentences = cleanText.match(/[^。！？.!?]+[。！？.!?]*/g) || [cleanText];
        let queue =[];
        sentences.forEach(s => {
            if (s.length > 50) {
                let parts = s.match(/[^、，,]+[、，,]*/g) || [s];
                queue.push(...parts);
            } else {
                queue.push(s);
            }
        });

        window.speechQueue = queue.map(s => s.trim()).filter(s => s.length > 0);

        async function playNext() {
            if (window.speechQueue.length === 0) {
                window.isNellSpeaking = false;
                window.currentNellAudio = null;
                resolve();
                return;
            }

            const sentence = window.speechQueue.shift();
            
            try {
                // 自前のサーバー（公式APIプロキシ）へリクエスト
                const response = await fetch('/api/tts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: sentence })
                });

                if (!response.ok) throw new Error("Server TTS Error");

                const data = await response.json();
                if (!data.audioContent) throw new Error("No audio content");

                // Base64の音声データをAudioオブジェクトにして再生
                const audioUrl = "data:audio/mp3;base64," + data.audioContent;
                const audio = new Audio(audioUrl);
                window.currentNellAudio = audio;

                const vol = (typeof window.isMuted !== 'undefined' && window.isMuted) ? 0 : (window.appVolume || 0.5);
                audio.volume = vol;

                audio.onplay = () => { window.isNellSpeaking = true; };
                audio.onended = () => { playNext(); };
                
                audio.onerror = (e) => {
                    console.warn("Audio Playback Error:", e);
                    playFallbackTTS(sentence + " " + window.speechQueue.join(" "), resolve);
                    window.speechQueue =[];
                };

                await audio.play();

            } catch (e) {
                console.error("公式TTS APIの取得に失敗しました:", e);
                playFallbackTTS(sentence + " " + window.speechQueue.join(" "), resolve);
                window.speechQueue =[];
            }
        }
        
        playNext();
    });
};


// 最終防衛ライン: ブラウザ内蔵音声
function playFallbackTTS(text, resolveCallback) {
    console.log("ブラウザ内蔵音声(TTS)に切り替えますにゃ。");
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const msg = new SpeechSynthesisUtterance(text);
        msg.lang = 'ja-JP';
        msg.rate = 1.2; 
        
        msg.onstart = () => { window.isNellSpeaking = true; };
        msg.onend = () => { window.isNellSpeaking = false; resolveCallback(); };
        msg.onerror = () => { window.isNellSpeaking = false; resolveCallback(); };
        
        window.speechSynthesis.speak(msg);
    } else {
        resolveCallback();
    }
}

// （互換性維持用）グローバル空間にも関数を露出
if (typeof speakNell === 'undefined') {
    window.speakNell = window.speakNell;
}