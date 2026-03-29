// --- START OF FILE audio.js ---

// --- js/audio/audio.js (v442.5: 二重再生防止・構文エラー完全修正版) ---
window.audioCtx = null;
window.masterGainNode = null; 
window.currentNellAudio = null;
window.isNellSpeaking = false;
window.speechQueue =[]; 

// ★再生競合を防ぐための「整理券（トークン）」
window.speechToken = 0; 

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
    window.speechToken++; // キャンセル時に整理券を更新し、待機中の音声を無効化
    window.isNellSpeaking = false;
    window.speechQueue =[]; 
    if (window.currentNellAudio) {
        // ★重要: 再生が終わった後のイベントが発火しないようにリスナーを全て削除
        window.currentNellAudio.onended = null;
        window.currentNellAudio.onerror = null;
        window.currentNellAudio.onplay = null;
        window.currentNellAudio.pause();
        window.currentNellAudio.currentTime = 0;
        window.currentNellAudio.src = ""; // ソースを空にして読み込みを停止
        window.currentNellAudio = null;
    }
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }
};

window.speakNell = function(text, mood = "normal") {
    return new Promise((resolve) => {
        if (!text || text === "") return resolve();

        // 前の音声をキャンセルし、新しい整理券を発行
        window.cancelNellSpeech();
        const currentToken = window.speechToken; 

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
            // 通信待ちの間に別の音声がリクエストされていたら中断
            if (currentToken !== window.speechToken) return resolve(); 

            if (window.speechQueue.length === 0) {
                window.isNellSpeaking = false;
                window.currentNellAudio = null;
                resolve();
                return;
            }

            const sentence = window.speechQueue.shift();
            
            try {
                const response = await fetch('/api/tts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: sentence })
                });

                // 通信終了時にも整理券を確認
                if (currentToken !== window.speechToken) return resolve(); 

                if (!response.ok) throw new Error("Server TTS Error");

                const data = await response.json();
                if (!data.audioContent) throw new Error("No audio content");

                const audioUrl = "data:audio/mp3;base64," + data.audioContent;
                const audio = new Audio(audioUrl);
                window.currentNellAudio = audio;

                const vol = (typeof window.isMuted !== 'undefined' && window.isMuted) ? 0 : (window.appVolume || 0.5);
                audio.volume = vol;
                audio.playbackRate = 1.0; 

                audio.onplay = () => { 
                    if (currentToken !== window.speechToken) {
                        audio.pause();
                        resolve();
                        return;
                    }
                    window.isNellSpeaking = true; 
                };
                
                audio.onended = () => { playNext(); };
                
                audio.onerror = (e) => {
                    console.warn("Audio Playback Error:", e);
                    const remainingText = sentence + " " + window.speechQueue.join(" ");
                    window.speechQueue =[];
                    if (currentToken === window.speechToken) playFallbackTTS(remainingText, currentToken, resolve);
                };

                await audio.play();

            } catch (e) {
                console.error("公式TTS APIの取得に失敗しました:", e);
                const remainingText = sentence + " " + window.speechQueue.join(" ");
                window.speechQueue =[];
                playFallbackTTS(remainingText, currentToken, resolve);
            }
        }
        
        playNext();
    });
};

// 最終防衛ライン: ブラウザ内蔵音声
function playFallbackTTS(text, token, resolveCallback) {
    if (token !== window.speechToken) return resolveCallback();

    console.log("ブラウザ内蔵音声(TTS)に切り替えますにゃ。");
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const msg = new SpeechSynthesisUtterance(text);
        msg.lang = 'ja-JP';
        msg.rate = 1.2; 
        
        msg.onstart = () => { 
            if (token === window.speechToken) window.isNellSpeaking = true; 
        };
        msg.onend = () => { 
            window.isNellSpeaking = false; 
            resolveCallback(); 
        };
        msg.onerror = () => { 
            window.isNellSpeaking = false; 
            resolveCallback(); 
        };
        
        window.speechSynthesis.speak(msg);
    } else {
        resolveCallback();
    }
}

// （互換性維持用）グローバル空間にも関数を露出
if (typeof speakNell === 'undefined') {
    window.speakNell = window.speakNell;
}

if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => {};
}