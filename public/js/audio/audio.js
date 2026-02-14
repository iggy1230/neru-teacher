// --- js/audio/audio.js (v435.0: 音声速度1.3倍版) ---
window.audioCtx = null;
window.masterGainNode = null; // 全体の音量制御用
// 【重要】現在再生中のAudioオブジェクトを保持する変数
window.currentNellAudio = null;
window.isNellSpeaking = false;

window.initAudioContext = async function() {
    try {
        // コンテキストの初期化（効果音再生用に必要）
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
    // 念のためブラウザ標準TTSも停止
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }

    // API音声の停止処理
    if (window.currentNellAudio) {
        window.currentNellAudio.pause();
        window.currentNellAudio.currentTime = 0;
        window.currentNellAudio = null;
    }

    window.isNellSpeaking = false;
};

// ネル先生音声APIを使った読み上げ関数
async function speakNell(text, mood = "normal") {
    if (!text || text === "") return;

    // 前の音声をキャンセル
    window.cancelNellSpeech();

    // テキストクリーニング
    // 読み上げエラーの原因になりそうな記号や、発音させたくないカッコ書きなどを削除
    let cleanText = text;
    cleanText = cleanText.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, ''); // 絵文字削除
    cleanText = cleanText.replace(/[★☆✨♪！!？?]/g, ''); // 記号削除
    cleanText = cleanText.replace(/[\(（][^\)）]+[\)）]/g, ''); // カッコ書き削除

    if (cleanText.trim() === "") return;

    // ネル先生APIのURLを生成
    const url = `https://iggy1230-neru-sensei.hf.space/speak?text=${encodeURIComponent(cleanText)}`;
    
    // 音声を生成
    const audio = new Audio(url);
    
    // 再生中のオーディオとして登録（中断用）
    window.currentNellAudio = audio;

    // 音量設定
    const vol = (typeof window.isMuted !== 'undefined' && window.isMuted) ? 0 : (window.appVolume || 0.5);
    audio.volume = vol;

    // ★再生速度を1.3倍に設定
    audio.playbackRate = 1.3;

    // イベントリスナー設定（口パク制御用）
    audio.onplay = () => {
        window.isNellSpeaking = true;
    };

    audio.onended = () => {
        window.isNellSpeaking = false;
        window.currentNellAudio = null;
    };

    audio.onpause = () => {
        window.isNellSpeaking = false;
    };

    audio.onerror = (e) => {
        console.error("Nell Audio API Error:", e);
        window.isNellSpeaking = false;
        window.currentNellAudio = null;
    };

    // 再生実行
    audio.play().catch(e => {
        console.warn("自動再生ブロックに負けたにゃ。クリックが必要にゃ！", e);
        window.isNellSpeaking = false;
    });
}

// 音声リストの読み込み完了を待つ（標準TTS互換性のための残骸、今回はAPI使用のため影響なし）
if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => {
        // console.log("Voices loaded (Not used)");
    };
}