// --- analyze.js (真・完全版 v250.0: 全機能網羅・省略なし) ---

// ==========================================
// 1. グローバル変数 & 初期化
// ==========================================

window.transcribedProblems = []; 
window.selectedProblem = null; 
window.hintIndex = 0; 
window.isAnalyzing = false; 
window.currentSubject = '';
window.currentMode = ''; 
window.lunchCount = 0; 
window.analysisType = 'precision';

// 採点・入力制御用
window.gradingTimer = null; 
window.isComposing = false;

// 音声・Socket関連
let liveSocket = null;
let audioContext = null;
let mediaStream = null;
let workletNode = null;
let stopSpeakingTimer = null;
let speakingStartTimer = null;
let currentTtsSource = null;
let chatTranscript = ""; 
let nextStartTime = 0;
let connectionTimeout = null;
let recognition = null;
let isRecognitionActive = false;
let recognitionWatchdogTimer = null; // 音声認識の「番犬」用

// 音声ソース管理
let liveAudioSources = []; 
let ignoreIncomingAudio = false;
let currentLiveAudioSource = null;

// 図鑑用画像キャッシュ
window.lastSentCollectionImage = null;

// ゲーム・Cropper関連
let gameCanvas, ctx, ball, paddle, bricks, score, gameRunning = false, gameAnimId = null;
let cropImg = new Image();
let cropPoints = [];
let activeHandle = -1;
let analysisTimers = [];
let homeworkStream = null;

// タイマー関連
let studyTimerValue = 0;
let studyTimerInterval = null;
let studyTimerRunning = false;
let studyTimerCheck = 0; 

// 効果音定義
const sfxBori = new Audio('boribori.mp3');
const sfxHit = new Audio('cat1c.mp3');
const sfxPaddle = new Audio('poka02.mp3'); 
const sfxOver = new Audio('gameover.mp3');
const sfxBunseki = new Audio('bunseki.mp3'); 
sfxBunseki.volume = 0.05; 
const sfxHirameku = new Audio('hirameku.mp3'); 
const sfxMaru = new Audio('maru.mp3');
const sfxBatu = new Audio('batu.mp3');

const gameHitComments = ["うまいにゃ！", "すごいにゃ！", "さすがにゃ！", "がんばれにゃ！"];

// 画像リソース
const subjectImages = {
    'こくご': { base: 'nell-kokugo.png', talk: 'nell-kokugo-talk.png' },
    'さんすう': { base: 'nell-sansu.png', talk: 'nell-sansu-talk.png' },
    'りか': { base: 'nell-rika.png', talk: 'nell-rika-talk.png' },
    'しゃかい': { base: 'nell-shakai.png', talk: 'nell-shakai-talk.png' },
    'おはなし': { base: 'nell-normal.png', talk: 'nell-talk.png' }
};
const defaultIcon = 'nell-normal.png'; 
const talkIcon = 'nell-talk.png';

// --- 音声処理ヘルパー関数 ---
function floatTo16BitPCM(float32Array) { 
    const buffer = new ArrayBuffer(float32Array.length * 2); 
    const view = new DataView(buffer); 
    let offset = 0; 
    for (let i = 0; i < float32Array.length; i++, offset += 2) { 
        let s = Math.max(-1, Math.min(1, float32Array[i])); 
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true); 
    } 
    return buffer; 
}

function downsampleBuffer(buffer, sampleRate, outSampleRate) { 
    if (outSampleRate >= sampleRate) return buffer; 
    const ratio = sampleRate / outSampleRate; 
    const newLength = Math.round(buffer.length / ratio); 
    const result = new Float32Array(newLength); 
    let offsetResult = 0, offsetBuffer = 0; 
    while (offsetResult < result.length) { 
        const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio); 
        let accum = 0, count = 0; 
        for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) { 
            accum += buffer[i]; count++; 
        } 
        result[offsetResult] = accum / count; 
        offsetResult++; 
        offsetBuffer = nextOffsetBuffer; 
    } 
    return result; 
}

function arrayBufferToBase64(buffer) { 
    let binary = ''; 
    const bytes = new Uint8Array(buffer); 
    for (let i = 0; i < bytes.byteLength; i++) { 
        binary += String.fromCharCode(bytes[i]); 
    } 
    return window.btoa(binary); 
}

// 口パクアニメーション
function startMouthAnimation() {
    let toggle = false;
    setInterval(() => {
        const img = document.getElementById('nell-face') || document.querySelector('.nell-avatar-wrap img');
        if (!img) return;
        let baseImg = defaultIcon;
        let talkImg = talkIcon;
        if (currentSubject && subjectImages[currentSubject] && 
           (currentMode === 'explain' || currentMode === 'grade' || currentMode === 'review')) {
            baseImg = subjectImages[currentSubject].base;
            talkImg = subjectImages[currentSubject].talk;
        }
        if (window.isNellSpeaking) img.src = toggle ? talkImg : baseImg;
        else img.src = baseImg;
        toggle = !toggle;
    }, 150);
}
startMouthAnimation();

window.addEventListener('DOMContentLoaded', () => {
    const camIn = document.getElementById('hw-input-camera'); 
    const albIn = document.getElementById('hw-input-album'); 
    if(camIn) camIn.addEventListener('change', (e) => { handleFileUpload(e.target.files[0]); e.target.value=''; });
    if(albIn) albIn.addEventListener('change', (e) => { handleFileUpload(e.target.files[0]); e.target.value=''; });
    const startCamBtn = document.getElementById('start-webcam-btn');
    if (startCamBtn) startCamBtn.onclick = startHomeworkWebcam;
});

// ==========================================
// 宿題用カメラ機能
// ==========================================
async function startHomeworkWebcam() {
    const modal = document.getElementById('camera-modal');
    const video = document.getElementById('camera-video');
    const shutter = document.getElementById('camera-shutter-btn');
    const cancel = document.getElementById('camera-cancel-btn');
    if (!modal || !video) return;
    try {
        let constraints = { video: { facingMode: "environment" } };
        try { homeworkStream = await navigator.mediaDevices.getUserMedia(constraints); } 
        catch (e) { homeworkStream = await navigator.mediaDevices.getUserMedia({ video: true }); }
        video.srcObject = homeworkStream;
        video.setAttribute('playsinline', true); 
        await video.play();
        modal.classList.remove('hidden');
        shutter.onclick = () => {
            const canvas = document.getElementById('camera-canvas');
            canvas.width = video.videoWidth; canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => {
                if(blob) {
                    const file = new File([blob], "homework_capture.jpg", { type: "image/jpeg" });
                    closeHomeworkCamera();
                    handleFileUpload(file);
                }
            }, 'image/jpeg', 0.9);
        };
        cancel.onclick = closeHomeworkCamera;
    } catch (err) { alert("カメラエラー: " + err.message); closeHomeworkCamera(); }
}
function closeHomeworkCamera() {
    const modal = document.getElementById('camera-modal');
    const video = document.getElementById('camera-video');
    if (homeworkStream) { homeworkStream.getTracks().forEach(t => t.stop()); homeworkStream = null; }
    if (video) video.srcObject = null;
    if (modal) modal.classList.add('hidden');
}

// ==========================================
// 3. 記憶・メッセージ管理
// ==========================================
async function saveToNellMemory(role, text) {
    if (!currentUser || !currentUser.id) return;
    const trimmed = text.trim();
    const ignoreWords = ["あー", "えーと", "うーん", "はい", "ねえ", "ネル先生", "にゃー", "にゃ", "。", "ok", "OK", "接続中...", "読み込み中..."];
    if (trimmed.length <= 1 || ignoreWords.includes(trimmed)) return;
    chatTranscript += `${role === 'user' ? '生徒' : 'ネル'}: ${trimmed}\n`;
    const newItem = { role: role, text: trimmed, time: new Date().toISOString() };
    try {
        const memoryKey = `nell_raw_chat_log_${currentUser.id}`;
        let history = JSON.parse(localStorage.getItem(memoryKey) || '[]');
        if (history.length > 0 && history[history.length - 1].text === trimmed) return;
        history.push(newItem);
        if (history.length > 50) history.shift(); 
        localStorage.setItem(memoryKey, JSON.stringify(history));
    } catch(e) {}
    if (currentUser.isGoogleUser && typeof db !== 'undefined' && db !== null) {
        try {
            const docRef = db.collection("memories").doc(currentUser.id);
            const docSnap = await docRef.get();
            let cloudHistory = docSnap.exists ? (docSnap.data().history || []) : [];
            if (cloudHistory.length > 0 && cloudHistory[cloudHistory.length - 1].text === trimmed) return;
            cloudHistory.push(newItem);
            if (cloudHistory.length > 50) cloudHistory.shift();
            await docRef.set({ history: cloudHistory, lastUpdated: new Date().toISOString() }, { merge: true });
        } catch(e) {}
    }
}

window.updateNellMessage = async function(t, mood = "normal", saveToMemory = false, speak = true) {
    if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
        speak = false;
    }
    const gameScreen = document.getElementById('screen-game');
    const isGameHidden = gameScreen ? gameScreen.classList.contains('hidden') : true;
    const targetId = isGameHidden ? 'nell-text' : 'nell-text-game';
    const el = document.getElementById(targetId);
    
    const displayText = t.replace(/(?:\[|\【)?DISPLAY[:：]\s*(.+?)(?:\]|\】)?/gi, "");
    if (el) el.innerText = displayText;
    if (t && t.includes("もぐもぐ")) { try { sfxBori.currentTime = 0; sfxBori.play(); } catch(e){} }
    if (saveToMemory) { saveToNellMemory('nell', t); }
    
    if (speak && typeof speakNell === 'function') {
        let textForSpeech = displayText.replace(/【.*?】/g, "").trim();
        textForSpeech = textForSpeech.replace(/🐾/g, "");
        if (textForSpeech.length > 0) {
            try { await speakNell(textForSpeech, mood); } catch(e) {}
        }
    }
};

// ==========================================
// 4. モード選択 & UI制御
// ==========================================
window.selectMode = function(m) {
    currentMode = m; 
    if (typeof switchScreen === 'function') switchScreen('screen-main'); 
    const ids = ['subject-selection-view', 'upload-controls', 'thinking-view', 'problem-selection-view', 'final-view', 'chalkboard', 'chat-view', 'simple-chat-view', 'lunch-view', 'grade-sheet-container', 'hint-detail-container'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
    const backBtn = document.getElementById('main-back-btn');
    if (backBtn) { backBtn.classList.remove('hidden'); backBtn.onclick = backToLobby; }
    stopLiveChat(); gameRunning = false;
    const icon = document.querySelector('.nell-avatar-wrap img'); if(icon) icon.src = defaultIcon;
    document.getElementById('mini-karikari-display').classList.remove('hidden'); 
    if(typeof updateMiniKarikari === 'function') updateMiniKarikari();
    
    if (m === 'chat') { 
        document.getElementById('chat-view').classList.remove('hidden'); 
        updateNellMessage("「おはなしする」を押してね！", "gentle", false); 
        updateTimerDisplay();
    } 
    else if (m === 'simple-chat') {
        document.getElementById('simple-chat-view').classList.remove('hidden');
        updateNellMessage("今日はお話だけするにゃ？", "gentle", false);
    }
    else if (m === 'lunch') { document.getElementById('lunch-view').classList.remove('hidden'); updateNellMessage("お腹ペコペコだにゃ……", "thinking", false); } 
    else if (m === 'review') { renderMistakeSelection(); } 
    else { const subjectView = document.getElementById('subject-selection-view'); if (subjectView) subjectView.classList.remove('hidden'); updateNellMessage("どの教科にするのかにゃ？", "normal", false); }
};

window.setSubject = function(s) { 
    currentSubject = s; 
    const icon = document.querySelector('.nell-avatar-wrap img'); if(icon&&subjectImages[s]){icon.src=subjectImages[s].base; icon.onerror=()=>{icon.src=defaultIcon;};} 
    document.getElementById('subject-selection-view').classList.add('hidden'); 
    document.getElementById('upload-controls').classList.remove('hidden'); 
    updateNellMessage(`${currentSubject}の問題をみせてにゃ！`, "happy", false); 
    const btnFast = document.getElementById('mode-btn-fast');
    const btnPrec = document.getElementById('mode-btn-precision');
    if (btnFast) { btnFast.innerText = "📷 ネル先生に宿題を見せる"; btnFast.className = "main-btn"; btnFast.style.background = "#ff85a1"; btnFast.style.width = "100%"; btnFast.onclick = null; }
    if (btnPrec) btnPrec.style.display = "none";
};

window.setAnalyzeMode = function(type) { analysisType = 'precision'; };

// ==========================================
// 5. ネル先生タイマー
// ==========================================
window.setTimer = function(minutes) {
    if (studyTimerRunning) return;
    studyTimerValue += minutes * 60;
    updateTimerDisplay();
};

window.resetTimer = function() {
    if (studyTimerRunning) {
        clearInterval(studyTimerInterval);
        studyTimerRunning = false;
        document.getElementById('timer-toggle-btn').innerText = "スタート！";
        document.getElementById('timer-toggle-btn').className = "main-btn pink-btn";
    }
    studyTimerValue = 0;
    studyTimerCheck = 0;
    updateTimerDisplay();
};

window.toggleTimer = function() {
    if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) {
        alert("タイマーの応援を聞くには、先に「🎤 おはなしする」ボタンを押してネル先生とつながってにゃ！");
        return;
    }
    if (studyTimerRunning) {
        clearInterval(studyTimerInterval);
        studyTimerRunning = false;
        document.getElementById('timer-toggle-btn').innerText = "再開する";
        document.getElementById('timer-toggle-btn').className = "main-btn blue-btn";
    } else {
        if (studyTimerValue <= 0) return alert("時間をセットしてにゃ！");
        studyTimerRunning = true;
        studyTimerCheck = 0;
        document.getElementById('timer-toggle-btn').innerText = "一時停止";
        document.getElementById('timer-toggle-btn').className = "main-btn gray-btn";
        if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
            sendSilentPrompt("勉強タイマーをスタートしたよ。短く応援して。");
        }
        studyTimerInterval = setInterval(() => {
            if (studyTimerValue > 0) {
                studyTimerValue--;
                studyTimerCheck++;
                updateTimerDisplay();
                if (studyTimerCheck >= 300) {
                    studyTimerCheck = 0;
                    if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
                        sendSilentPrompt("5分経ったよ。進み具合を心配したり、褒めたりして。");
                    }
                }
            } else {
                clearInterval(studyTimerInterval);
                studyTimerRunning = false;
                document.getElementById('timer-toggle-btn').innerText = "スタート！";
                document.getElementById('timer-toggle-btn').className = "main-btn pink-btn";
                try { sfxChime.play(); } catch(e){}
                if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
                    sendSilentPrompt("タイマー終了！たくさん褒めて！");
                } else {
                    updateNellMessage("時間だにゃ！おつかれさまにゃ！", "excited", false);
                }
            }
        }, 1000);
    }
};

function updateTimerDisplay() {
    const el = document.getElementById('study-timer');
    const m = Math.floor(studyTimerValue / 60).toString().padStart(2, '0');
    const s = (studyTimerValue % 60).toString().padStart(2, '0');
    if(el) el.innerText = `${m}:${s}`;
}

function sendSilentPrompt(text) {
    if (!liveSocket) return;
    liveSocket.send(JSON.stringify({ 
        clientContent: { 
            turns: [{ role: "user", parts: [{ text: `（システム指示: ${text}）` }] }],
            turnComplete: true 
        } 
    }));
}

// ==========================================
// 6. 「これ見て！」カメラ機能 & 音声割り込み
// ==========================================

function stopAudioPlayback() {
    liveAudioSources.forEach(source => { try { source.stop(); } catch(e){} });
    liveAudioSources = []; 
    if (audioContext && audioContext.state === 'running') {
        nextStartTime = audioContext.currentTime; 
    }
    window.isNellSpeaking = false;
    if(stopSpeakingTimer) clearTimeout(stopSpeakingTimer);
    if(speakingStartTimer) clearTimeout(speakingStartTimer);
    if (window.cancelNellSpeech) window.cancelNellSpeech();
}

window.captureAndSendLiveImage = function() {
    if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) {
        return alert("まずは「おはなしする」でネル先生とつながってにゃ！");
    }
    const video = document.getElementById('live-chat-video');
    if (!video || !video.srcObject || !video.srcObject.active) {
        return alert("カメラが動いてないにゃ...。一度「おはなしする」を終了して、もう一度つなぎ直してみてにゃ。");
    }

    stopAudioPlayback();
    ignoreIncomingAudio = false; 

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    const thumbCanvas = document.createElement('canvas');
    const thumbSize = 150; 
    let tw = canvas.width, th = canvas.height;
    if (tw > th) { th *= thumbSize / tw; tw = thumbSize; }
    else { tw *= thumbSize / th; th = thumbSize; }
    thumbCanvas.width = tw; thumbCanvas.height = th;
    thumbCanvas.getContext('2d').drawImage(canvas, 0, 0, tw, th);
    window.lastSentCollectionImage = thumbCanvas.toDataURL('image/jpeg', 0.7);

    const base64Data = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
    
    const flash = document.createElement('div');
    flash.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:white; opacity:0.8; z-index:9999; pointer-events:none; transition:opacity 0.3s;";
    document.body.appendChild(flash);
    setTimeout(() => { flash.style.opacity = 0; setTimeout(() => flash.remove(), 300); }, 50);

    const videoContainer = document.getElementById('live-chat-video-container');
    if (videoContainer) {
        const oldPreview = document.getElementById('snapshot-preview-overlay');
        if(oldPreview) oldPreview.remove();
        const previewImg = document.createElement('img');
        previewImg.id = 'snapshot-preview-overlay';
        previewImg.src = canvas.toDataURL('image/jpeg', 0.8);
        previewImg.style.cssText = "position:absolute; top:0; left:0; width:100%; height:100%; object-fit:cover; z-index:10; border:4px solid #ffeb3b; box-sizing:border-box; animation: fadeIn 0.2s;";
        videoContainer.style.position = "relative"; 
        videoContainer.appendChild(previewImg);
        setTimeout(() => { if(previewImg && previewImg.parentNode) previewImg.remove(); }, 3000);
    }

    updateNellMessage("ん？どれどれ…", "thinking", false, false);
    
    // 画像送信
    liveSocket.send(JSON.stringify({ base64Image: base64Data }));

    // 指示送信
    setTimeout(() => {
        if (recognition) { try { recognition.start(); } catch(e){} }
        const ts = Date.now(); 
        liveSocket.send(JSON.stringify({ 
            textInput: `【緊急画像認識指示 ID:${ts}】\nたった今、画像を送ったにゃ。\nこの画像に写っているものを特定して、感想を言う前に **必ず** \`register_collection_item\` ツールを実行して！\n「登録した」と嘘をつくのは禁止！` 
        }));
    }, 200); 
};

// ==========================================
// 7. 宿題分析ロジック
// ==========================================
window.startAnalysis = async function(b64) {
    if (isAnalyzing) return;
    isAnalyzing = true; 
    document.getElementById('cropper-modal').classList.add('hidden'); 
    document.getElementById('thinking-view').classList.remove('hidden'); 
    document.getElementById('upload-controls').classList.add('hidden'); 
    const backBtn = document.getElementById('main-back-btn'); if(backBtn) backBtn.classList.add('hidden');
    
    try { 
        sfxHirameku.volume = 0; sfxHirameku.play().then(() => { sfxHirameku.pause(); sfxHirameku.currentTime = 0; sfxHirameku.volume = 1; }).catch(e => {});
        sfxBunseki.currentTime = 0; sfxBunseki.play(); sfxBunseki.loop = true; 
    } catch(e){}
    
    let p = 0; 
    const timer = setInterval(() => { if (!isAnalyzing) { clearInterval(timer); return; } if (p < 30) p += 1; else if (p < 80) p += 0.4; else if (p < 95) p += 0.1; updateProgress(p); }, 300);
    
    const performAnalysisNarration = async () => {
        const msgs = [
            { text: "じーっと見て、問題を書き写してるにゃ…", mood: "thinking" },
            { text: "肉球がちょっとじゃまだにゃ…", mood: "thinking" },
            { text: "ふむふむ…この問題、なかなか手強いにゃ…", mood: "thinking" },
            { text: "今、ネル先生の天才的な頭脳で解いてるからにゃね…", mood: "thinking" },
            { text: "この問題、どこかで見たことあるにゃ…えーっと…", mood: "thinking" },
            { text: "しっぽの先まで集中して考え中だにゃ…", mood: "thinking" },
            { text: "ネル先生のピピピッ！と光るヒゲが、正解をバッチリ受信してるにゃ！", mood: "thinking" },
            { text: "にゃるほど…だいたい分かってきたにゃ…", mood: "thinking" },
            { text: "あとちょっとで、ネル先生の脳みそが『ピコーン！』って鳴るにゃ！", mood: "thinking" }
        ];
        for (const item of msgs) { 
            if (!isAnalyzing) return; 
            await updateNellMessage(item.text, item.mood, false); 
            if (!isAnalyzing) return; 
            await new Promise(r => setTimeout(r, 1500)); 
        }
    };
    performAnalysisNarration();

    try {
        const res = await fetch('/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: b64, mode: currentMode, grade: currentUser.grade, subject: currentSubject, name: currentUser.name }) });
        if (!res.ok) throw new Error("Server Error"); 
        
        const data = await res.json();
        
        if (!data || !Array.isArray(data) || data.length === 0) {
            throw new Error("データが空か、正しい形式ではありませんでした。");
        }
        
        transcribedProblems = data.map((prob, index) => {
            let studentArr = Array.isArray(prob.student_answer) ? prob.student_answer : (prob.student_answer ? [prob.student_answer] : []);
            let correctArr = Array.isArray(prob.correct_answer) ? prob.correct_answer : (prob.correct_answer ? [prob.correct_answer] : []);
            
            return { 
                ...prob, 
                id: index + 1, 
                student_answer: studentArr, 
                correct_answer: correctArr, 
                status: (studentArr.length > 0 && studentArr[0] !== "") ? "answered" : "unanswered", 
                currentHintLevel: 1, 
                maxUnlockedHintLevel: 0 
            };
        });

        isAnalyzing = false; clearInterval(timer); updateProgress(100); cleanupAnalysis();
        try { sfxHirameku.currentTime = 0; sfxHirameku.play().catch(e=>{}); } catch(e){}
        setTimeout(() => { document.getElementById('thinking-view').classList.add('hidden'); const doneMsg = "読めたにゃ！"; if (currentMode === 'grade') { showGradingView(true); updateNellMessage(doneMsg, "happy", false).then(() => setTimeout(updateGradingMessage, 1500)); } else { renderProblemSelection(); updateNellMessage(doneMsg, "happy", false); } }, 1500); 
    } catch (err) { 
        console.error("Analysis Error:", err);
        isAnalyzing = false; cleanupAnalysis(); clearInterval(timer); 
        document.getElementById('thinking-view').classList.add('hidden'); 
        document.getElementById('upload-controls').classList.remove('hidden'); 
        if(backBtn) backBtn.classList.remove('hidden'); 
        updateNellMessage("うまく読めなかったにゃ…もう一度お願いにゃ！", "thinking", false); 
    }
};

function cleanupAnalysis() { isAnalyzing = false; sfxBunseki.pause(); if(typeof analysisTimers !== 'undefined' && analysisTimers) { analysisTimers.forEach(t => clearTimeout(t)); analysisTimers = []; } }

// ==========================================
// 8. ヒント & 採点UI
// ==========================================
window.startHint = function(id) {
    if (window.initAudioContext) window.initAudioContext().catch(e=>{});
    selectedProblem = transcribedProblems.find(p => p.id == id); 
    if (!selectedProblem) return updateNellMessage("データエラーだにゃ", "thinking", false);
    if (!selectedProblem.currentHintLevel) selectedProblem.currentHintLevel = 1;
    if (selectedProblem.maxUnlockedHintLevel === undefined) selectedProblem.maxUnlockedHintLevel = 0;
    ['problem-selection-view', 'grade-sheet-container', 'answer-display-area', 'chalkboard'].forEach(i => { const el = document.getElementById(i); if(el) el.classList.add('hidden'); });
    document.getElementById('final-view').classList.remove('hidden'); document.getElementById('hint-detail-container').classList.remove('hidden');
    const board = document.getElementById('chalkboard'); if(board) { board.innerText = selectedProblem.question; board.classList.remove('hidden'); }
    document.getElementById('main-back-btn').classList.add('hidden');
    updateNellMessage("ヒントを見るにゃ？", "thinking", false);
    renderHintUI();
};

function renderHintUI() {
    const p = selectedProblem;
    const maxUnlocked = p.maxUnlockedHintLevel;
    const hintBtnsContainer = document.querySelector('.hint-btns');
    hintBtnsContainer.innerHTML = `<div class="hint-step-badge" id="hint-step-label">考え方</div>`;

    let nextCost = 0, nextLabel = "";
    let nextLevel = maxUnlocked + 1;
    if (nextLevel === 1) { nextCost = 5; nextLabel = "カリカリ(×5)でヒントをもらう"; }
    else if (nextLevel === 2) { nextCost = 5; nextLabel = "カリカリ(×5)でさらにヒントをもらう"; }
    else if (nextLevel === 3) { nextCost = 10; nextLabel = "カリカリ(×10)で大ヒントをもらう"; }

    if (nextLevel <= 3) {
        const unlockBtn = document.createElement('button');
        unlockBtn.className = "main-btn blue-btn";
        unlockBtn.innerText = nextLabel;
        unlockBtn.onclick = () => unlockNextHint(nextLevel, nextCost);
        hintBtnsContainer.appendChild(unlockBtn);
    } else {
        const revealBtn = document.createElement('button');
        revealBtn.className = "main-btn orange-btn";
        revealBtn.innerText = "答えを見る";
        revealBtn.onclick = window.revealAnswer;
        hintBtnsContainer.appendChild(revealBtn);
    }
    
    if (maxUnlocked > 0) {
        const reviewContainer = document.createElement('div');
        reviewContainer.style.display = "flex";
        reviewContainer.style.gap = "5px";
        reviewContainer.style.marginTop = "10px";
        reviewContainer.style.flexWrap = "wrap";
        for (let i = 1; i <= maxUnlocked; i++) {
            const btn = document.createElement('button');
            btn.className = "main-btn gray-btn";
            btn.style.fontSize = "0.9rem";
            btn.style.padding = "8px";
            btn.style.flex = "1";
            btn.innerText = `ヒント${i}を見る`;
            btn.onclick = () => showHintText(i);
            reviewContainer.appendChild(btn);
        }
        hintBtnsContainer.appendChild(reviewContainer);
    }
    
    const ansDiv = document.createElement('div');
    ansDiv.id = "answer-display-area";
    ansDiv.className = "answer-box hidden";
    ansDiv.innerHTML = `ネル先生の答え：<br><span id="final-answer-text"></span>`;
    hintBtnsContainer.appendChild(ansDiv);
}

window.unlockNextHint = function(level, cost) {
    if (window.initAudioContext) window.initAudioContext();
    if (currentUser.karikari < cost) return updateNellMessage(`カリカリが足りないにゃ…あと${cost}個！`, "thinking", false);
    currentUser.karikari -= cost; saveAndSync(); updateMiniKarikari(); showKarikariEffect(-cost);
    selectedProblem.maxUnlockedHintLevel = level;
    showHintText(level); renderHintUI();
};

window.showHintText = function(level) {
    const hints = selectedProblem.hints || [];
    const text = hints[level - 1] || "ヒントが見つからないにゃ...";
    updateNellMessage(text, "thinking", false);
    const hl = document.getElementById('hint-step-label'); if(hl) hl.innerText = `ヒント Lv.${level}`; 
};

window.revealAnswer = function() {
    const ansArea = document.getElementById('answer-display-area'); const finalTxt = document.getElementById('final-answer-text');
    const correctArr = Array.isArray(selectedProblem.correct_answer) ? selectedProblem.correct_answer : [selectedProblem.correct_answer];
    let displayAnswer = correctArr.map(part => part.split('|')[0]).join(', ');
    if (ansArea && finalTxt) { finalTxt.innerText = displayAnswer; ansArea.classList.remove('hidden'); ansArea.style.display = "block"; }
    const btns = document.querySelectorAll('.hint-btns button.orange-btn'); btns.forEach(b => b.classList.add('hidden'));
    updateNellMessage(`答えは「${displayAnswer}」だにゃ！`, "gentle", false); 
};

// --- リスト生成 (配列対応版) ---
function createProblemItem(p, mode) {
    const isGradeMode = (mode === 'grade');
    let markHtml = "", bgStyle = "background:white;";
    
    let correctList = Array.isArray(p.correct_answer) ? p.correct_answer : [String(p.correct_answer)];
    correctList = correctList.map(s => String(s).trim()).filter(s => s !== ""); 

    let studentList = Array.isArray(p.student_answer) ? p.student_answer : [String(p.student_answer)];
    
    if (isGradeMode) {
        let isCorrect = p.is_correct;
        if (isCorrect === undefined) { 
            if (correctList.length !== studentList.length) isCorrect = false;
            else {
                isCorrect = true;
                for(let i=0; i<correctList.length; i++) {
                    if (!isMatch(studentList[i] || "", correctList[i])) { isCorrect = false; break; }
                }
            }
        }
        const mark = isCorrect ? "⭕" : "❌"; const markColor = isCorrect ? "#ff5252" : "#4a90e2"; bgStyle = isCorrect ? "background:#fff5f5;" : "background:#f0f8ff;";
        markHtml = `<div id="mark-${p.id}" style="font-weight:900; color:${markColor}; font-size:2rem; width:50px; text-align:center; flex-shrink:0;">${mark}</div>`;
    } else {
        markHtml = `<div id="mark-${p.id}" style="font-weight:900; color:#4a90e2; font-size:2rem; width:50px; text-align:center; flex-shrink:0;"></div>`;
    }
    
    let inputHtml = "";
    
    if (correctList.length > 1) {
        inputHtml = `<div style="display:grid; grid-template-columns: 1fr 1fr; gap:5px; width:100%;">`;
        for (let i = 0; i < correctList.length; i++) {
            let val = studentList[i] || "";
            const onInput = isGradeMode ? `oninput="checkMultiAnswer(${p.id}, event)"` : "";
            inputHtml += `<input type="text" value="${val}" class="multi-input-${p.id}" ${onInput} style="width:100%; padding:8px; border:2px solid #ddd; border-radius:8px; font-size:1rem; font-weight:bold; color:#333; min-width:0; box-sizing:border-box;">`;
        }
        inputHtml += `</div>`;
    } else {
        const val = studentList[0] || "";
        const onInput = isGradeMode ? `oninput="checkAnswerDynamically(${p.id}, this, event)"` : "";
        const idAttr = isGradeMode ? "" : `id="single-input-${p.id}"`;
        inputHtml = `<div style="width:100%;"><input type="text" ${idAttr} value="${val}" ${onInput} style="width:100%; padding:8px; border:2px solid #ddd; border-radius:8px; font-size:1rem; font-weight:bold; color:#333; box-sizing:border-box;"></div>`;
    }

    let buttonsHtml = "";
    if (isGradeMode) {
        buttonsHtml = `<div style="display:flex; flex-direction:column; gap:5px; width:80px; flex-shrink:0; justify-content:center; margin-left:auto;"><button class="mini-teach-btn" onclick="startHint(${p.id})" style="width:100%;">教えて</button></div>`;
    } else {
        buttonsHtml = `<div style="display:flex; flex-direction:column; gap:5px; width:80px; flex-shrink:0; margin-left:auto;"><button class="mini-teach-btn" onclick="checkOneProblem(${p.id})" style="background:#ff85a1; width:100%;">採点</button><button class="mini-teach-btn" onclick="startHint(${p.id})" style="width:100%;">教えて</button></div>`;
    }
    const div = document.createElement('div'); div.className = "grade-item"; div.id = `grade-item-${p.id}`; div.style.cssText = `border-bottom:1px solid #eee; padding:15px; margin-bottom:10px; border-radius:10px; ${bgStyle}`; 
    div.innerHTML = `<div style="display:flex; align-items:center; width:100%;">${markHtml}<div style="flex:1; margin-left:10px; display:flex; flex-direction:column; min-width:0;"><div style="font-size:0.9rem; color:#888; margin-bottom:4px;">${p.label || '問'}</div><div style="font-weight:bold; font-size:0.9rem; margin-bottom:8px; width:100%; word-break:break-all;">${p.question}</div><div style="display:flex; gap:10px; align-items:flex-start; width:100%; justify-content:space-between;"><div style="flex:1; min-width:0; margin-right:5px;">${inputHtml}<div style="font-size:0.7rem; color:#666; margin-top:4px;">キミの答え (直せるよ)</div></div>${buttonsHtml}</div></div></div>`; 
    return div;
}

// --- 採点ロジック (配列対応) ---
function normalizeAnswer(str) { if (!str) return ""; let normalized = str.trim().replace(/[\u30a1-\u30f6]/g, m => String.fromCharCode(m.charCodeAt(0) - 0x60)); return normalized; }
function isMatch(student, correctString) { const s = normalizeAnswer(student); const options = normalizeAnswer(correctString).split('|'); return options.some(opt => opt === s); }

window.checkMultiAnswer = function(id, event) {
    if (window.isComposing) return;
    const problem = transcribedProblems.find(p => p.id === id);
    if (problem) {
        const inputs = document.querySelectorAll(`.multi-input-${id}`);
        const userValues = Array.from(inputs).map(input => input.value);
        problem.student_answer = userValues;
    }
    if(window.gradingTimer) clearTimeout(window.gradingTimer);
    window.gradingTimer = setTimeout(() => { _performCheckMultiAnswer(id); }, 1000);
};

function _performCheckMultiAnswer(id) {
    const problem = transcribedProblems.find(p => p.id === id); if (!problem) return;
    const userValues = problem.student_answer; 
    const correctList = Array.isArray(problem.correct_answer) ? problem.correct_answer : [problem.correct_answer];
    let allCorrect = false;
    if (userValues.length === correctList.length) {
        const usedIndices = new Set(); let matchCount = 0;
        for (const uVal of userValues) {
            for (let i = 0; i < correctList.length; i++) {
                if (!usedIndices.has(i)) { if (isMatch(uVal, correctList[i])) { usedIndices.add(i); matchCount++; break; } }
            }
        }
        allCorrect = (matchCount === correctList.length);
    }
    problem.is_correct = allCorrect;
    updateMarkDisplay(id, allCorrect);
    if (currentMode === 'grade') updateGradingMessage();
    if (allCorrect) { try { sfxMaru.currentTime = 0; sfxMaru.play(); } catch(e){} } 
    else if (userValues.some(v => v.trim().length > 0)) { try { sfxBatu.currentTime = 0; sfxBatu.play(); } catch(e){} }
}

window.checkAnswerDynamically = function(id, inputElem, event) { 
    if (window.isComposing) return;
    const problem = transcribedProblems.find(p => p.id === id);
    if(problem) problem.student_answer = [inputElem.value];
    const val = inputElem.value;
    if(window.gradingTimer) clearTimeout(window.gradingTimer);
    window.gradingTimer = setTimeout(() => { _performCheckAnswerDynamically(id, val); }, 1000);
};

function _performCheckAnswerDynamically(id, val) {
    const problem = transcribedProblems.find(p => p.id === id); if (!problem) return;
    const correctVal = Array.isArray(problem.correct_answer) ? problem.correct_answer[0] : problem.correct_answer;
    const isCorrect = isMatch(val, String(correctVal));
    problem.is_correct = isCorrect; 
    updateMarkDisplay(id, isCorrect);
    if (currentMode === 'grade') updateGradingMessage(); 
    if (isCorrect) { try { sfxMaru.currentTime = 0; sfxMaru.play(); } catch(e){} } 
    else if (val.trim().length > 0) { try { sfxBatu.currentTime = 0; sfxBatu.play(); } catch(e){} }
}

window.checkOneProblem = function(id) { 
    const problem = transcribedProblems.find(p => p.id === id); if (!problem) return; 
    const correctList = Array.isArray(problem.correct_answer) ? problem.correct_answer : [problem.correct_answer];
    let userValues = []; 
    if (correctList.length > 1) { 
        const inputs = document.querySelectorAll(`.multi-input-${id}`); 
        userValues = Array.from(inputs).map(i => i.value); 
    } else { 
        const input = document.getElementById(`single-input-${id}`); 
        if(input) userValues = [input.value]; 
    } 
    let isCorrect = false; 
    if (userValues.length === correctList.length) { 
        const usedIndices = new Set(); let matchCount = 0; 
        for (const uVal of userValues) { 
            for (let i = 0; i < correctList.length; i++) { 
                if (!usedIndices.has(i)) { if (isMatch(uVal, correctList[i])) { usedIndices.add(i); matchCount++; break; } } 
            } 
        } 
        isCorrect = (matchCount === correctList.length); 
    } 
    if (isCorrect) { try { sfxMaru.currentTime = 0; sfxMaru.play(); } catch(e){} } else { try { sfxBatu.currentTime = 0; sfxBatu.play(); } catch(e){} } 
    const markElem = document.getElementById(`mark-${id}`); const container = document.getElementById(`grade-item-${id}`); 
    if (markElem && container) { 
        if (isCorrect) { markElem.innerText = "⭕"; markElem.style.color = "#ff5252"; container.style.backgroundColor = "#fff5f5"; updateNellMessage("正解だにゃ！すごいにゃ！", "excited", false); } 
        else { markElem.innerText = "❌"; markElem.style.color = "#4a90e2"; container.style.backgroundColor = "#f0f8ff"; updateNellMessage("おしい！もう一回考えてみて！", "gentle", false); } 
    } 
};

function updateMarkDisplay(id, isCorrect) { const container = document.getElementById(`grade-item-${id}`); const markElem = document.getElementById(`mark-${id}`); if (container && markElem) { if (isCorrect) { markElem.innerText = "⭕"; markElem.style.color = "#ff5252"; container.style.backgroundColor = "#fff5f5"; } else { markElem.innerText = "❌"; markElem.style.color = "#4a90e2"; container.style.backgroundColor = "#f0f8ff"; } } }
window.updateGradingMessage = function() { let correctCount = 0; transcribedProblems.forEach(p => { if (p.is_correct) correctCount++; }); const scoreRate = correctCount / (transcribedProblems.length || 1); if (scoreRate === 1.0) updateNellMessage(`全問正解だにゃ！天才だにゃ〜！！`, "excited", false); else if (scoreRate >= 0.5) updateNellMessage(`あと${transcribedProblems.length - correctCount}問！直してみるにゃ！`, "happy", false); else updateNellMessage(`間違ってても大丈夫！入力し直してみて！`, "gentle", false); };
window.backToProblemSelection = function() { document.getElementById('final-view').classList.add('hidden'); document.getElementById('hint-detail-container').classList.add('hidden'); document.getElementById('chalkboard').classList.add('hidden'); document.getElementById('answer-display-area').classList.add('hidden'); if (currentMode === 'grade') showGradingView(); else { renderProblemSelection(); updateNellMessage("他も見るにゃ？", "normal", false); } const backBtn = document.getElementById('main-back-btn'); if(backBtn) { backBtn.classList.remove('hidden'); backBtn.onclick = backToLobby; } };
window.pressThanks = function() { window.backToProblemSelection(); };
window.finishGrading = async function(btnElement) { if(btnElement) { btnElement.disabled = true; btnElement.innerText = "採点完了！"; } if (currentUser) { currentUser.karikari += 100; saveAndSync(); updateMiniKarikari(); showKarikariEffect(100); } await updateNellMessage("よくがんばったにゃ！カリカリ100個あげる！", "excited", false); setTimeout(() => { if(typeof backToLobby === 'function') backToLobby(true); }, 3000); };
window.pressAllSolved = function(btnElement) { if(btnElement) { btnElement.disabled = true; btnElement.innerText = "すごい！"; } if (currentUser) { currentUser.karikari += 100; saveAndSync(); showKarikariEffect(100); updateMiniKarikari(); updateNellMessage("よくがんばったにゃ！カリカリ100個あげるにゃ！", "excited", false).then(() => { setTimeout(() => { if(typeof backToLobby === 'function') backToLobby(true); }, 3000); }); } };
window.renderMistakeSelection = function() { if (!currentUser.mistakes || currentUser.mistakes.length === 0) { updateNellMessage("ノートは空っぽにゃ！", "happy", false); setTimeout(backToLobby, 2000); return; } transcribedProblems = currentUser.mistakes; renderProblemSelection(); updateNellMessage("復習するにゃ？", "excited", false); };
window.giveLunch = function() { if (currentUser.karikari < 1) return updateNellMessage("カリカリがないにゃ……", "thinking", false); updateNellMessage("もぐもぐ……", "normal", false); currentUser.karikari--; if(typeof saveAndSync === 'function') saveAndSync(); updateMiniKarikari(); showKarikariEffect(-1); lunchCount++; fetch('/lunch-reaction', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count: lunchCount, name: currentUser.name }) }).then(r => r.json()).then(d => { setTimeout(() => { updateNellMessage(d.reply || "おいしいにゃ！", d.isSpecial ? "excited" : "happy", true); }, 1500); }).catch(e => { setTimeout(() => { updateNellMessage("おいしいにゃ！", "happy", false); }, 1500); }); }; 
window.showGame = function() { switchScreen('screen-game'); document.getElementById('mini-karikari-display').classList.remove('hidden'); updateMiniKarikari(); initGame(); fetchGameComment("start"); const startBtn = document.getElementById('start-game-btn'); if (startBtn) { const newBtn = startBtn.cloneNode(true); startBtn.parentNode.replaceChild(newBtn, startBtn); newBtn.onclick = () => { if (!gameRunning) { initGame(); gameRunning = true; newBtn.disabled = true; drawGame(); } }; } };
function fetchGameComment(type, score=0) { fetch('/game-reaction', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, name: currentUser.name, score }) }).then(r=>r.json()).then(d=>{ updateNellMessage(d.reply, d.mood || "excited", true); }).catch(e=>{}); }
function initGame() { gameCanvas = document.getElementById('game-canvas'); if(!gameCanvas) return; ctx = gameCanvas.getContext('2d'); paddle = { w: 80, h: 10, x: 120, speed: 7 }; ball = { x: 160, y: 350, dx: 3, dy: -3, r: 8 }; score = 0; document.getElementById('game-score').innerText = score; bricks = []; for(let c=0; c<5; c++) for(let r=0; r<4; r++) bricks.push({ x: c*64+10, y: r*35+40, status: 1 }); gameCanvas.removeEventListener("mousemove", movePaddle); gameCanvas.removeEventListener("touchmove", touchPaddle); gameCanvas.addEventListener("mousemove", movePaddle, false); gameCanvas.addEventListener("touchmove", touchPaddle, { passive: false }); }
function movePaddle(e) { const rect = gameCanvas.getBoundingClientRect(); const scaleX = gameCanvas.width / rect.width; const rx = (e.clientX - rect.left) * scaleX; if(rx > 0 && rx < gameCanvas.width) paddle.x = rx - paddle.w/2; }
function touchPaddle(e) { e.preventDefault(); const rect = gameCanvas.getBoundingClientRect(); const scaleX = gameCanvas.width / rect.width; const rx = (e.touches[0].clientX - rect.left) * scaleX; if(rx > 0 && rx < gameCanvas.width) paddle.x = rx - paddle.w/2; }
function drawGame() { if (!gameRunning) return; ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height); ctx.font = "20px serif"; bricks.forEach(b => { if(b.status === 1) ctx.fillText("🍖", b.x + 10, b.y + 20); }); ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI*2); ctx.fillStyle = "#ff85a1"; ctx.fill(); ctx.closePath(); ctx.fillStyle = "#4a90e2"; ctx.fillRect(paddle.x, gameCanvas.height - paddle.h - 10, paddle.w, paddle.h); bricks.forEach(b => { if(b.status === 1 && ball.x>b.x && ball.x<b.x+40 && ball.y>b.y && ball.y<b.y+30){ ball.dy*=-1; b.status=0; score++; document.getElementById('game-score').innerText=score; try { sfxHit.currentTime=0; sfxHit.play(); } catch(e){} if (Math.random() > 0.7 && !window.isNellSpeaking) { updateNellMessage(gameHitComments[Math.floor(Math.random() * gameHitComments.length)], "excited", false); } if(score===bricks.length) { endGame(true); return; } } }); if(ball.x+ball.dx > gameCanvas.width-ball.r || ball.x+ball.dx < ball.r) ball.dx *= -1; if(ball.y+ball.dy < ball.r) ball.dy *= -1; else if(ball.y+ball.dy > gameCanvas.height - ball.r - 20) { if(ball.x > paddle.x && ball.x < paddle.x + paddle.w) { ball.dy *= -1; ball.dx = (ball.x - (paddle.x+paddle.w/2)) * 0.15; try { sfxPaddle.currentTime = 0; sfxPaddle.play(); } catch(e){} } else if(ball.y+ball.dy > gameCanvas.height-ball.r) { try { sfxOver.currentTime=0; sfxOver.play(); } catch(e){} endGame(false); return; } } ball.x += ball.dx; ball.y += ball.dy; gameAnimId = requestAnimationFrame(drawGame); }
function endGame(c) { gameRunning = false; if(gameAnimId)cancelAnimationFrame(gameAnimId); fetchGameComment("end", score); const s=document.getElementById('start-game-btn'); if(s){s.disabled=false;s.innerText="もう一回！";} setTimeout(()=>{ alert(c?`すごい！全クリだにゃ！\nカリカリ ${score} 個ゲット！`:`おしい！\nカリカリ ${score} 個ゲット！`); if(currentUser&&score>0){currentUser.karikari+=score;if(typeof saveAndSync==='function')saveAndSync();updateMiniKarikari();showKarikariEffect(score);} }, 500); }

// ==========================================
// 10. WebSocket (Live Chat)
// ==========================================

async function startLiveChat() { 
    const btnId = currentMode === 'simple-chat' ? 'mic-btn-simple' : 'mic-btn';
    const btn = document.getElementById(btnId);
    if (liveSocket) { stopLiveChat(); return; } 
    try { 
        updateNellMessage("ネル先生を呼んでるにゃ…", "thinking", false); 
        if(btn) btn.disabled = true; 
        
        let memoryContext = "";
        if (window.NellMemory) {
            memoryContext = await window.NellMemory.generateContextString(currentUser.id);
        }
        
        chatTranscript = ""; 
        
        if (window.initAudioContext) await window.initAudioContext(); 
        audioContext = new (window.AudioContext || window.webkitAudioContext)(); 
        await audioContext.resume(); 
        nextStartTime = audioContext.currentTime; 
        
        const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:'; 
        let statusSummary = `${currentUser.name}さんは今、お話しにきたにゃ。カリカリは${currentUser.karikari}個持ってるにゃ。`; 
        
        const url = `${wsProto}//${location.host}?grade=${currentUser.grade}&name=${encodeURIComponent(currentUser.name)}&context=${encodeURIComponent(statusSummary + "\n" + memoryContext)}`; 
        liveSocket = new WebSocket(url); 
        liveSocket.binaryType = "blob"; 
        connectionTimeout = setTimeout(() => { if (liveSocket && liveSocket.readyState !== WebSocket.OPEN) { updateNellMessage("なかなかつながらないにゃ…", "thinking", false); stopLiveChat(); } }, 10000); 
        
        liveSocket.onopen = () => { 
            clearTimeout(connectionTimeout); 
            if(btn) { btn.innerText = "📞 つながった！(終了)"; btn.style.background = "#ff5252"; btn.disabled = false; } 
            updateNellMessage("お待たせ！なんでも話してにゃ！", "happy", false, false); 
            isRecognitionActive = true; 
            startMicrophone();
            
            // ★追加: 音声認識の「番犬」タイマー (2秒ごとにチェック)
            if(recognitionWatchdogTimer) clearInterval(recognitionWatchdogTimer);
            recognitionWatchdogTimer = setInterval(() => {
                if (isRecognitionActive && recognition) {
                    try {
                        recognition.start();
                    } catch(e) {
                    }
                }
            }, 2000);
        }; 
        
        liveSocket.onmessage = async (event) => { 
            try { 
                let rawData = event.data;
                if (rawData instanceof Blob) rawData = await rawData.text();
                const data = JSON.parse(rawData);

                // ★追加: 図鑑登録指令の受信処理
                if (data.type === "save_to_collection") {
                    console.log(`[Collection] 📥 Save command received for: ${data.itemName}`);
                    
                    let imageToSave = window.lastSentCollectionImage;

                    // ★ 救済措置: キャッシュがない場合、現在の映像からキャプチャを試みる
                    if (!imageToSave) {
                        const v = document.getElementById('live-chat-video');
                        if (v && v.srcObject && v.srcObject.active) {
                            const c = document.createElement('canvas');
                            c.width = 150; c.height = 150; // サムネイルサイズ
                            const vw = v.videoWidth || 640;
                            const vh = v.videoHeight || 480;
                            const size = Math.min(vw, vh);
                            const sx = (vw - size) / 2;
                            const sy = (vh - size) / 2;
                            c.getContext('2d').drawImage(v, sx, sy, size, size, 0, 0, 150, 150);
                            imageToSave = c.toDataURL('image/jpeg', 0.7);
                        }
                    }

                    if (imageToSave) {
                        try {
                            await window.NellMemory.addToCollection(currentUser.id, data.itemName, imageToSave);
                            
                            const notif = document.createElement('div');
                            notif.innerText = `📖 図鑑に「${data.itemName}」を登録したにゃ！`;
                            notif.style.cssText = "position:fixed; top:20%; left:50%; transform:translateX(-50%); background:rgba(255,255,255,0.95); border:4px solid #00bcd4; color:#006064; padding:15px 25px; border-radius:30px; font-weight:900; z-index:10000; box-shadow:0 10px 25px rgba(0,0,0,0.3); font-size:1.2rem; animation: popIn 0.5s ease;";
                            document.body.appendChild(notif);
                            setTimeout(() => notif.remove(), 4000);
                            
                            try{ sfxHirameku.currentTime=0; sfxHirameku.play(); } catch(e){} 
                        } catch (err) {
                            console.error("[Collection] ❌ Memory save failed:", err);
                        }
                    }
                    return; 
                }
                
                if (data.serverContent?.modelTurn?.parts) { 
                    data.serverContent.modelTurn.parts.forEach(p => { 
                        if (p.functionCall) {
                            if (p.functionCall.name === "show_kanji") {
                                const content = p.functionCall.args.content;
                                document.getElementById('inline-whiteboard').classList.remove('hidden');
                                document.getElementById('whiteboard-content').innerText = content;
                                liveSocket.send(JSON.stringify({ toolResponse: { functionResponses: [{ name: "show_kanji", response: { result: "displayed" }, id: p.functionCall.id || "call_id" }] } }));
                            }
                        }
                        if (p.text) { 
                            const match = p.text.match(/(?:\[|\【)?DISPLAY[:：]\s*(.+?)(?:\]|\】)?/i);
                            if (match) {
                                const content = match[1].trim();
                                document.getElementById('inline-whiteboard').classList.remove('hidden');
                                document.getElementById('whiteboard-content').innerText = content;
                            }
                            saveToNellMemory('nell', p.text); 
                            updateNellMessage(p.text, "normal", false, false);
                        } 
                        // Audio
                        if (p.inlineData) {
                            // ★重要: ここで音声再生時にResumeをかける (v250.0)
                            if (audioContext && audioContext.state === 'suspended') {
                                audioContext.resume().then(() => {
                                    playLivePcmAudio(p.inlineData.data);
                                }).catch(err => {
                                    console.error("Audio resume failed inside websocket:", err);
                                    playLivePcmAudio(p.inlineData.data); // とりあえず再生試行
                                });
                            } else {
                                playLivePcmAudio(p.inlineData.data);
                            }
                        }
                    }); 
                } 
            } catch (e) {} 
        }; 
        
        liveSocket.onclose = () => stopLiveChat(); 
        liveSocket.onerror = () => stopLiveChat(); 
    } catch (e) { stopLiveChat(); } 
}

function stopLiveChat() { 
    if (window.NellMemory) {
        if (chatTranscript && chatTranscript.length > 10) {
            console.log(`【Memory】更新開始 (ログ長: ${chatTranscript.length})`);
            window.NellMemory.updateProfileFromChat(currentUser.id, chatTranscript);
        } else {
            console.log("【Memory】会話が短いため更新スキップ");
        }
    }

    isRecognitionActive = false; 
    if (connectionTimeout) clearTimeout(connectionTimeout); 
    if (recognition) try{recognition.stop()}catch(e){} 
    if (recognitionWatchdogTimer) clearInterval(recognitionWatchdogTimer);
    if (mediaStream) mediaStream.getTracks().forEach(t=>t.stop()); 
    if (workletNode) { workletNode.port.postMessage('stop'); workletNode.disconnect(); } 
    if (liveSocket) liveSocket.close(); 
    if (audioContext && audioContext.state !== 'closed') audioContext.close(); 
    window.isNellSpeaking = false; 
    if(stopSpeakingTimer) clearTimeout(stopSpeakingTimer); 
    if(speakingStartTimer) clearTimeout(speakingStartTimer); 
    
    // UIのリセット処理
    const btnId = currentMode === 'simple-chat' ? 'mic-btn-simple' : 'mic-btn';
    const btn = document.getElementById(btnId);
    if (btn) { btn.innerText = "🎤 おはなしする"; btn.style.background = currentMode === 'simple-chat' ? "#66bb6a" : "#ff85a1"; btn.disabled = false; btn.onclick = startLiveChat; } 
    liveSocket = null; 
    
    const video = document.getElementById('live-chat-video');
    if(video) video.srcObject = null;
    document.getElementById('live-chat-video-container').style.display = 'none';
}

async function startMicrophone() { 
    try { 
        if ('webkitSpeechRecognition' in window) { 
            recognition = new webkitSpeechRecognition(); 
            recognition.continuous = true; 
            recognition.interimResults = true; 
            recognition.lang = 'ja-JP'; 
            
            recognition.onresult = (event) => { 
                let currentText = "";
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    currentText += event.results[i][0].transcript;
                }
                
                const aizuchi = [
                    "うん", "はい", "へー", "そう", "あ", "え", "ん", "うんうん", "はいはい", 
                    "そっか", "なるほど", "えっと", "すごい", "ほんと", "わかった", "ありがとう", 
                    "マジ", "うそ", "へえ", "ふーん", "それで", "オッケー", "OK"
                ];
                const cleanText = currentText.trim();
                
                if (window.isNellSpeaking && cleanText.length > 0) {
                    if (cleanText.length >= 3 && !aizuchi.includes(cleanText)) {
                        console.log(`【Audio】割り込み検知: "${cleanText}" -> 停止`);
                        stopAudioPlayback();
                    }
                }

                let interim = ''; 
                for (let i = event.resultIndex; i < event.results.length; ++i) { 
                    if (event.results[i].isFinal) { 
                        const userText = event.results[i][0].transcript;
                        saveToNellMemory('user', userText); 
                        
                        const txtId = currentMode === 'simple-chat' ? 'user-speech-text-simple' : 'user-speech-text';
                        const el = document.getElementById(txtId); 
                        if(el) el.innerText = userText; 
                    } else interim += event.results[i][0].transcript; 
                } 
            }; 
            recognition.onend = () => { if (isRecognitionActive && liveSocket && liveSocket.readyState === WebSocket.OPEN) try{recognition.start()}catch(e){} }; 
            recognition.start(); 
        } 
        
        const useVideo = (currentMode === 'chat');
        
        mediaStream = await navigator.mediaDevices.getUserMedia({ 
            audio: { sampleRate: 16000, channelCount: 1 }, 
            video: useVideo ? { facingMode: "environment" } : false 
        }); 
        
        if (useVideo) {
            const video = document.getElementById('live-chat-video');
            if (video) {
                video.srcObject = mediaStream;
                video.play();
                document.getElementById('live-chat-video-container').style.display = 'block';
            }
        }

        const processorCode = `class PcmProcessor extends AudioWorkletProcessor { constructor() { super(); this.bufferSize = 2048; this.buffer = new Float32Array(this.bufferSize); this.index = 0; } process(inputs, outputs, parameters) { const input = inputs[0]; if (input.length > 0) { const channel = input[0]; for (let i = 0; i < channel.length; i++) { this.buffer[this.index++] = channel[i]; if (this.index >= this.bufferSize) { this.port.postMessage(this.buffer); this.index = 0; } } } return true; } } registerProcessor('pcm-processor', PcmProcessor);`; 
        const blob = new Blob([processorCode], { type: 'application/javascript' }); 
        await audioContext.audioWorklet.addModule(URL.createObjectURL(blob)); 
        const source = audioContext.createMediaStreamSource(mediaStream); 
        workletNode = new AudioWorkletNode(audioContext, 'pcm-processor'); 
        source.connect(workletNode); 
        workletNode.port.onmessage = (event) => { 
            if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) return; 
            const downsampled = downsampleBuffer(event.data, audioContext.sampleRate, 16000); 
            liveSocket.send(JSON.stringify({ base64Audio: arrayBufferToBase64(floatTo16BitPCM(downsampled)) })); 
        }; 
    } catch(e) {
        console.warn("Camera failed or not needed, trying audio only:", e);
        try {
            mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } });
            const processorCode = `class PcmProcessor extends AudioWorkletProcessor { constructor() { super(); this.bufferSize = 2048; this.buffer = new Float32Array(this.bufferSize); this.index = 0; } process(inputs, outputs, parameters) { const input = inputs[0]; if (input.length > 0) { const channel = input[0]; for (let i = 0; i < channel.length; i++) { this.buffer[this.index++] = channel[i]; if (this.index >= this.bufferSize) { this.port.postMessage(this.buffer); this.index = 0; } } } return true; } } registerProcessor('pcm-processor', PcmProcessor);`; 
            const blob = new Blob([processorCode], { type: 'application/javascript' }); 
            await audioContext.audioWorklet.addModule(URL.createObjectURL(blob)); 
            const source = audioContext.createMediaStreamSource(mediaStream); 
            workletNode = new AudioWorkletNode(audioContext, 'pcm-processor'); 
            source.connect(workletNode); 
            workletNode.port.onmessage = (event) => { 
                if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) return; 
                const downsampled = downsampleBuffer(event.data, audioContext.sampleRate, 16000); 
                liveSocket.send(JSON.stringify({ base64Audio: arrayBufferToBase64(floatTo16BitPCM(downsampled)) })); 
            };
        } catch(ex) { alert("マイクも使えないみたいだにゃ..."); }
    } 
}

// ==========================================
// 12. 欠落していた重要関数群（ここも必須！）
// ==========================================

function updateMiniKarikari() { if(currentUser) { const el = document.getElementById('mini-karikari-count'); if(el) el.innerText = currentUser.karikari; const el2 = document.getElementById('karikari-count'); if(el2) el2.innerText = currentUser.karikari; } }

function showKarikariEffect(amount) { const container = document.querySelector('.nell-avatar-wrap'); if(container) { const floatText = document.createElement('div'); floatText.className = 'floating-text'; floatText.innerText = amount > 0 ? `+${amount}` : `${amount}`; floatText.style.color = amount > 0 ? '#ff9100' : '#ff5252'; floatText.style.right = '0px'; floatText.style.top = '0px'; container.appendChild(floatText); setTimeout(() => floatText.remove(), 1500); } }

window.handleFileUpload = async (file) => { if (isAnalyzing || !file) return; document.getElementById('upload-controls').classList.add('hidden'); document.getElementById('cropper-modal').classList.remove('hidden'); const canvas = document.getElementById('crop-canvas'); canvas.style.opacity = '0'; const reader = new FileReader(); reader.onload = async (e) => { cropImg = new Image(); cropImg.onload = async () => { const w = cropImg.width; const h = cropImg.height; cropPoints = [ { x: w * 0.1, y: h * 0.1 }, { x: w * 0.9, y: h * 0.1 }, { x: w * 0.9, y: h * 0.9 }, { x: w * 0.1, y: h * 0.9 } ]; canvas.style.opacity = '1'; updateNellMessage("ここを読み取るにゃ？", "normal"); initCustomCropper(); }; cropImg.src = e.target.result; }; reader.readAsDataURL(file); };

function initCustomCropper() { const modal = document.getElementById('cropper-modal'); modal.classList.remove('hidden'); const canvas = document.getElementById('crop-canvas'); const MAX_CANVAS_SIZE = 2500; let w = cropImg.width; let h = cropImg.height; if (w > MAX_CANVAS_SIZE || h > MAX_CANVAS_SIZE) { const scale = Math.min(MAX_CANVAS_SIZE / w, MAX_CANVAS_SIZE / h); w *= scale; h *= scale; cropPoints = cropPoints.map(p => ({ x: p.x * scale, y: p.y * scale })); } canvas.width = w; canvas.height = h; canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.objectFit = 'contain'; const ctx = canvas.getContext('2d'); ctx.drawImage(cropImg, 0, 0, w, h); updateCropUI(canvas); const handles = ['handle-tl', 'handle-tr', 'handle-br', 'handle-bl']; handles.forEach((id, idx) => { const el = document.getElementById(id); const startDrag = (e) => { e.preventDefault(); activeHandle = idx; }; el.onmousedown = startDrag; el.ontouchstart = startDrag; }); const move = (e) => { if (activeHandle === -1) return; e.preventDefault(); const rect = canvas.getBoundingClientRect(); const imgRatio = canvas.width / canvas.height; const rectRatio = rect.width / rect.height; let drawX, drawY, drawW, drawH; if (imgRatio > rectRatio) { drawW = rect.width; drawH = rect.width / imgRatio; drawX = 0; drawY = (rect.height - drawH) / 2; } else { drawH = rect.height; drawW = rect.height * imgRatio; drawY = 0; drawX = (rect.width - drawW) / 2; } const clientX = e.touches ? e.touches[0].clientX : e.clientX; const clientY = e.touches ? e.touches[0].clientY : e.clientY; let relX = (clientX - rect.left - drawX) / drawW; let relY = (clientY - rect.top - drawY) / drawH; relX = Math.max(0, Math.min(1, relX)); relY = Math.max(0, Math.min(1, relY)); cropPoints[activeHandle] = { x: relX * canvas.width, y: relY * canvas.height }; updateCropUI(canvas); }; const end = () => { activeHandle = -1; }; window.onmousemove = move; window.ontouchmove = move; window.onmouseup = end; window.ontouchend = end; document.getElementById('cropper-cancel-btn').onclick = () => { modal.classList.add('hidden'); window.onmousemove = null; window.ontouchmove = null; document.getElementById('upload-controls').classList.remove('hidden'); }; document.getElementById('cropper-ok-btn').onclick = () => { modal.classList.add('hidden'); window.onmousemove = null; window.ontouchmove = null; const croppedBase64 = performPerspectiveCrop(canvas, cropPoints); startAnalysis(croppedBase64); }; }

function updateCropUI(canvas) { const handles = ['handle-tl', 'handle-tr', 'handle-br', 'handle-bl']; const rect = canvas.getBoundingClientRect(); const imgRatio = canvas.width / canvas.height; const rectRatio = rect.width / rect.height; let drawX, drawY, drawW, drawH; if (imgRatio > rectRatio) { drawW = rect.width; drawH = rect.width / imgRatio; drawX = 0; drawY = (rect.height - drawH) / 2; } else { drawH = rect.height; drawW = rect.height * imgRatio; drawY = 0; drawX = (rect.width - drawW) / 2; } const toScreen = (p) => ({ x: (p.x / canvas.width) * drawW + drawX + canvas.offsetLeft, y: (p.y / canvas.height) * drawH + drawY + canvas.offsetTop }); const screenPoints = cropPoints.map(toScreen); handles.forEach((id, i) => { const el = document.getElementById(id); el.style.left = screenPoints[i].x + 'px'; el.style.top = screenPoints[i].y + 'px'; }); const svg = document.getElementById('crop-lines'); svg.style.left = canvas.offsetLeft + 'px'; svg.style.top = canvas.offsetTop + 'px'; svg.style.width = canvas.offsetWidth + 'px'; svg.style.height = canvas.offsetHeight + 'px'; const toSvg = (p) => ({ x: (p.x / canvas.width) * drawW + drawX, y: (p.y / canvas.height) * drawH + drawY }); const svgPts = cropPoints.map(toSvg); const ptsStr = svgPts.map(p => `${p.x},${p.y}`).join(' '); svg.innerHTML = `<polyline points="${ptsStr} ${svgPts[0].x},${svgPts[0].y}" style="fill:rgba(255,255,255,0.2);stroke:#ff4081;stroke-width:2;stroke-dasharray:5" />`; }

// ★画像補正・リサイズ処理
function processImageForAI(sourceCanvas) {
    const MAX_WIDTH = 1600; 
    let w = sourceCanvas.width;
    let h = sourceCanvas.height;
    if (w > MAX_WIDTH || h > MAX_WIDTH) { if (w > h) { h *= MAX_WIDTH / w; w = MAX_WIDTH; } else { w *= MAX_WIDTH / h; h = MAX_WIDTH; } }
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(sourceCanvas, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.9);
}

// クロップ処理
function performPerspectiveCrop(sourceCanvas, points) { 
    const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x)); 
    const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y)); 
    let w = maxX - minX, h = maxY - minY; 
    if (w < 1) w = 1; if (h < 1) h = 1; 
    const tempCv = document.createElement('canvas'); 
    tempCv.width = w; tempCv.height = h; 
    const ctx = tempCv.getContext('2d'); 
    ctx.drawImage(sourceCanvas, minX, minY, w, h, 0, 0, w, h); 
    return processImageForAI(tempCv).split(',')[1];
}

// ==========================================
// 11. 記憶管理 (Memory Manager) UI
// ==========================================

window.openMemoryManager = async function() {
    if (!currentUser) return;
    const modal = document.getElementById('memory-manager-modal');
    if (modal) {
        modal.classList.remove('hidden');
        switchMemoryTab('profile'); // デフォルトはプロフィール
    }
};

window.closeMemoryManager = function() {
    const modal = document.getElementById('memory-manager-modal');
    if (modal) modal.classList.add('hidden');
};

window.switchMemoryTab = async function(tab) {
    const tabProfile = document.getElementById('tab-profile');
    const tabLogs = document.getElementById('tab-logs');
    const viewProfile = document.getElementById('memory-view-profile');
    const viewLogs = document.getElementById('memory-view-logs');

    if (tab === 'profile') {
        tabProfile.classList.add('active');
        tabLogs.classList.remove('active');
        viewProfile.classList.remove('hidden');
        viewLogs.classList.add('hidden');
        await renderProfile();
    } else {
        tabProfile.classList.remove('active');
        tabLogs.classList.add('active');
        viewProfile.classList.add('hidden');
        viewLogs.classList.remove('hidden');
        await renderMemoryList();
    }
};

// プロフィール描画
window.renderProfile = async function() {
    const container = document.getElementById('profile-container');
    if (!container || !window.NellMemory) return;
    container.innerHTML = '<p style="text-align:center;">読み込み中にゃ...</p>';

    const profile = await window.NellMemory.getUserProfile(currentUser.id);
    container.innerHTML = '';

    if (!profile) {
        container.innerHTML = '<p>まだデータがないにゃ。</p>';
        return;
    }

    const createSection = (title, icon, items, key) => {
        if (!items || items.length === 0) return '';
        let tagsHtml = items.map((item, idx) => `
            <div class="profile-tag">
                ${item}
                <button class="profile-tag-delete" onclick="deleteProfileItem('${key}', ${idx})">×</button>
            </div>
        `).join('');
        return `
            <div class="profile-section">
                <div class="profile-title">${icon} ${title}</div>
                <div class="profile-tags">${tagsHtml}</div>
            </div>
        `;
    };

    let html = "";
    
    // 基本情報
    if (profile.nickname || profile.birthday) {
        html += `<div class="profile-section"><div class="profile-title">👤 基本情報</div><div style="font-size:0.9rem; padding:5px;">`;
        if (profile.nickname) html += `あだ名: <b>${profile.nickname}</b><br>`;
        if (profile.birthday) html += `誕生日: <b>${profile.birthday}</b>`;
        html += `</div></div>`;
    }

    html += createSection("好きなもの", "💖", profile.likes, "likes");
    html += createSection("苦手なこと", "💦", profile.weaknesses, "weaknesses");
    html += createSection("頑張ったこと", "🏆", profile.achievements, "achievements");
    
    if (profile.last_topic) {
        html += `<div class="profile-section"><div class="profile-title">💬 前回の話題</div><div style="font-size:0.9rem; padding:5px; background:#f5f5f5; border-radius:5px;">${profile.last_topic}</div></div>`;
    }

    if (html === "") {
        html = '<p style="text-align:center; color:#999;">まだ真っ白だにゃ。</p>';
    }

    container.innerHTML = html;
};

// プロフィール項目削除
window.deleteProfileItem = async function(key, index) {
    if (!confirm("この情報を削除するにゃ？")) return;
    
    const profile = await window.NellMemory.getUserProfile(currentUser.id);
    if (profile[key] && Array.isArray(profile[key])) {
        profile[key].splice(index, 1);
        await window.NellMemory.saveUserProfile(currentUser.id, profile);
        renderProfile(); // 再描画
    }
};

window.renderMemoryList = async function() {
    const container = document.getElementById('memory-list-container');
    if (!container) return;
    container.innerHTML = '<p style="text-align:center;">読み込み中にゃ...</p>';

    // データの取得
    let history = [];
    const memoryKey = `nell_raw_chat_log_${currentUser.id}`;
    
    try {
        history = JSON.parse(localStorage.getItem(memoryKey) || '[]');
    } catch(e) {}

    // Firestoreからも取得
    if (currentUser.isGoogleUser && typeof db !== 'undefined' && db !== null) {
        try {
            const doc = await db.collection("memories").doc(currentUser.id).get();
            if (doc.exists) {
                history = doc.data().history || [];
            }
        } catch(e) { console.error("Memory Fetch Error:", e); }
    }

    container.innerHTML = '';
    if (history.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:#999;">まだ会話ログがないにゃ</p>';
        return;
    }

    // 新しい順に表示
    for (let i = history.length - 1; i >= 0; i--) {
        const item = history[i];
        const div = document.createElement('div');
        div.className = 'memory-item';
        
        const roleLabel = item.role === 'user' ? 'キミ' : 'ネル先生';
        const roleClass = item.role === 'user' ? 'memory-role-user' : 'memory-role-nell';
        
        div.innerHTML = `
            <div style="flex:1;">
                <div class="memory-meta ${roleClass}">${roleLabel} (${new Date(item.time).toLocaleTimeString()})</div>
                <div class="memory-text">${item.text}</div>
            </div>
            <button onclick="deleteMemoryItem(${i})" class="delete-mem-btn">削除</button>
        `;
        container.appendChild(div);
    }
};

window.deleteMemoryItem = async function(index) {
    if (!confirm("このログを削除するにゃ？")) return;
    
    const memoryKey = `nell_raw_chat_log_${currentUser.id}`;
    let history = JSON.parse(localStorage.getItem(memoryKey) || '[]');
    
    if (index >= 0 && index < history.length) {
        history.splice(index, 1);
    }
    
    localStorage.setItem(memoryKey, JSON.stringify(history));
    
    if (currentUser.isGoogleUser && typeof db !== 'undefined' && db !== null) {
        try {
            await db.collection("memories").doc(currentUser.id).set({
                history: history,
                lastUpdated: new Date().toISOString()
            }, { merge: true });
        } catch(e) { console.error("Memory Delete Sync Error:", e); }
    }

    renderMemoryList();
};