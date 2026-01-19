// --- anlyze.js (完全版 v187.0: 音声被り防止 & インラインホワイトボード) ---

// グローバル変数の初期化
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

// --- アニメーション ---
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

// --- 初期化イベント ---
window.addEventListener('DOMContentLoaded', () => {
    const camIn = document.getElementById('hw-input-camera'); 
    const albIn = document.getElementById('hw-input-album'); 
    if(camIn) camIn.addEventListener('change', (e) => { handleFileUpload(e.target.files[0]); e.target.value=''; });
    if(albIn) albIn.addEventListener('change', (e) => { handleFileUpload(e.target.files[0]); e.target.value=''; });
    const startCamBtn = document.getElementById('start-webcam-btn');
    if (startCamBtn) startCamBtn.onclick = startHomeworkWebcam;
});

// --- 宿題用カメラ機能 ---
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

// --- 記憶システム ---
async function saveToNellMemory(role, text) {
    if (!currentUser || !currentUser.id) return;
    const trimmed = text.trim();
    const ignoreWords = [
        "あー", "えーと", "うーん", "はい", "ねえ", "ネル先生", "にゃー", "にゃ", "。", 
        "ok", "OK", "接続中...", "読み込み中...",
        "お待たせ！なんでも話してにゃ！", "おいしいにゃ！", "おつかれさまにゃ！"
    ];
    if (trimmed.length <= 1 || ignoreWords.includes(trimmed)) return;
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

// --- メッセージ更新（修正版） ---
// ★修正: speak引数を追加して、音声再生を制御
window.updateNellMessage = async function(t, mood = "normal", saveToMemory = false, speak = true) {
    const gameScreen = document.getElementById('screen-game');
    const isGameHidden = gameScreen ? gameScreen.classList.contains('hidden') : true;
    const targetId = isGameHidden ? 'nell-text' : 'nell-text-game';
    const el = document.getElementById(targetId);
    if (el) el.innerText = t;
    if (t && t.includes("もぐもぐ")) { try { sfxBori.currentTime = 0; sfxBori.play(); } catch(e){} }
    if (saveToMemory) { saveToNellMemory('nell', t); }
    
    // speakフラグがtrueの時だけ喋る
    if (speak && typeof speakNell === 'function') {
        let textForSpeech = t.replace(/【.*?】/g, "").trim();
        textForSpeech = textForSpeech.replace(/\[DISPLAY:.*?\]/g, ""); 
        textForSpeech = textForSpeech.replace(/🐾/g, "");
        if (textForSpeech.length > 0) await speakNell(textForSpeech, mood);
    }
};

// --- モード選択 ---
window.selectMode = function(m) {
    currentMode = m; 
    if (typeof switchScreen === 'function') switchScreen('screen-main'); 
    const ids = ['subject-selection-view', 'upload-controls', 'thinking-view', 'problem-selection-view', 'final-view', 'chalkboard', 'chat-view', 'simple-chat-view', 'lunch-view', 'grade-sheet-container', 'hint-detail-container'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
    const backBtn = document.getElementById('main-back-btn');
    if (backBtn) { backBtn.classList.remove('hidden'); backBtn.onclick = backToLobby; }
    stopLiveChat(); gameRunning = false;
    const icon = document.querySelector('.nell-avatar-wrap img'); if(icon) icon.src = defaultIcon;
    document.getElementById('mini-karikari-display').classList.remove('hidden'); updateMiniKarikari();
    
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
// ネル先生タイマー
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
        // ストップ
        clearInterval(studyTimerInterval);
        studyTimerRunning = false;
        document.getElementById('timer-toggle-btn').innerText = "再開する";
        document.getElementById('timer-toggle-btn').className = "main-btn blue-btn";
    } else {
        // スタート
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
// 「これ見て！」カメラ機能
// ==========================================

window.captureAndSendLiveImage = function() {
    if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) {
        return alert("まずは「おはなしする」でネル先生とつながってにゃ！");
    }
    
    const video = document.getElementById('live-chat-video');
    if (!video || !video.srcObject || !video.srcObject.active) {
        return alert("カメラが動いてないにゃ...。一度「おはなしする」を終了して、もう一度つなぎ直してみてにゃ。");
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    const base64Data = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
    
    // ★修正: speak=false を指定して、音声再生を抑制
    updateNellMessage("どれどれ…見てみるにゃ…", "thinking", false, false);
    liveSocket.send(JSON.stringify({ base64Image: base64Data }));
    
    setTimeout(() => {
        sendSilentPrompt("今カメラで見せているものについて、詳しく解説して。問題なら解き方を教えて。");
    }, 500);
};


// --- 分析ロジック (既存) ---
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
            { text: "じーっと見て、問題を書き写してるにゃ...", mood: "thinking" },
            { text: "肉球がちょっとじゃまだにゃ…", mood: "thinking" },
            { text: "ふむふむ…この問題、なかなか手強いにゃ。", mood: "thinking" },
            { text: "今、ネル先生の天才的な頭脳で解いてるからにゃね…", mood: "thinking" },
            { text: "この問題、どこかで見たことあるにゃ...えーっと...", mood: "thinking" },
            { text: "しっぽの先まで集中して考え中だにゃ…", mood: "thinking" },
            { text: "うにゃ〜、この問題は手強いにゃ…。でも大丈夫、ネル先生のピピピッ！と光るヒゲが、正解をバッチリ受信してるにゃ！", mood: "thinking" },
            { text: "にゃるほど…だいたい分かってきたにゃ...", mood: "thinking" },
            { text: "あとちょっとで、ネル先生の脳みそが『ピコーン！』って鳴るにゃ！", mood: "thinking" }
        ];
        for (const item of msgs) { if (!isAnalyzing) return; await updateNellMessage(item.text, item.mood, false); if (!isAnalyzing) return; await new Promise(r => setTimeout(r, 1500)); }
    };
    performAnalysisNarration();
    try {
        const res = await fetch('/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: b64, mode: currentMode, grade: currentUser.grade, subject: currentSubject, name: currentUser.name }) });
        if (!res.ok) throw new Error("Server Error"); 
        const data = await res.json();
        if (!data || data.length === 0) throw new Error("No Data");
        
        transcribedProblems = data.map((prob, index) => {
            let studentArr = Array.isArray(prob.student_answer) ? prob.student_answer : (prob.student_answer ? [prob.student_answer] : []);
            return { 
                ...prob, 
                id: index + 1, 
                student_answer: studentArr, 
                status: (studentArr.length > 0 && studentArr[0] !== "") ? "answered" : "unanswered", 
                currentHintLevel: 1, 
                maxUnlockedHintLevel: 0 
            };
        });

        isAnalyzing = false; clearInterval(timer); updateProgress(100); cleanupAnalysis();
        try { sfxHirameku.currentTime = 0; sfxHirameku.play().catch(e=>{}); } catch(e){}
        setTimeout(() => { document.getElementById('thinking-view').classList.add('hidden'); const doneMsg = "読めたにゃ！"; if (currentMode === 'grade') { showGradingView(true); updateNellMessage(doneMsg, "happy", false).then(() => setTimeout(updateGradingMessage, 1500)); } else { renderProblemSelection(); updateNellMessage(doneMsg, "happy", false); } }, 1500); 
    } catch (err) { isAnalyzing = false; cleanupAnalysis(); clearInterval(timer); document.getElementById('thinking-view').classList.add('hidden'); document.getElementById('upload-controls').classList.remove('hidden'); if(backBtn) backBtn.classList.remove('hidden'); updateNellMessage("うまく読めなかったにゃ…もう一度お願いにゃ！", "thinking", false); }
};
function cleanupAnalysis() { isAnalyzing = false; sfxBunseki.pause(); if(typeof analysisTimers !== 'undefined' && analysisTimers) { analysisTimers.forEach(t => clearTimeout(t)); analysisTimers = []; } }

// --- ヒント機能 ---
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
    // 配列対応
    const correctArr = Array.isArray(selectedProblem.correct_answer) ? selectedProblem.correct_answer : [selectedProblem.correct_answer];
    let displayAnswer = correctArr.map(part => part.split('|')[0]).join(', ');
    if (ansArea && finalTxt) { finalTxt.innerText = displayAnswer; ansArea.classList.remove('hidden'); ansArea.style.display = "block"; }
    const btns = document.querySelectorAll('.hint-btns button.orange-btn'); btns.forEach(b => b.classList.add('hidden'));
    updateNellMessage(`答えは「${displayAnswer}」だにゃ！`, "gentle", false); 
};

// --- Socket (Live Chat) ---
async function startLiveChat() { 
    // ★修正: モードに応じてボタンを特定
    const btnId = currentMode === 'simple-chat' ? 'mic-btn-simple' : 'mic-btn';
    const btn = document.getElementById(btnId);
    
    if (liveSocket) { stopLiveChat(); return; } 
    
    try { 
        updateNellMessage("ネル先生を呼んでるにゃ…", "thinking", false); 
        if(btn) btn.disabled = true; 
        chatTranscript = ""; 
        
        if (window.initAudioContext) await window.initAudioContext(); 
        audioContext = new (window.AudioContext || window.webkitAudioContext)(); 
        await audioContext.resume(); 
        nextStartTime = audioContext.currentTime; 
        
        const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:'; 
        let savedHistory = []; 
        if (currentUser.isGoogleUser && typeof db !== 'undefined' && db !== null) { 
            try { const doc = await db.collection("memories").doc(currentUser.id).get(); if (doc.exists) savedHistory = doc.data().history || []; } catch(e) {} 
        } 
        if (savedHistory.length === 0) { const memoryKey = `nell_raw_chat_log_${currentUser.id}`; savedHistory = JSON.parse(localStorage.getItem(memoryKey) || '[]'); } 
        const historySummary = savedHistory.slice(-15).map(m => `- ${m.role === 'user' ? 'キミ' : 'ネル'}: ${m.text}`).join('\n'); 
        let statusSummary = `${currentUser.name}さんは今、お話しにきたにゃ。カリカリは${currentUser.karikari}個持ってるにゃ。`; 
        if (historySummary) { statusSummary += `\n【直近の思い出】\n${historySummary}`; } 
        
        const url = `${wsProto}//${location.host}?grade=${currentUser.grade}&name=${encodeURIComponent(currentUser.name)}&context=${encodeURIComponent(statusSummary)}`; 
        liveSocket = new WebSocket(url); 
        liveSocket.binaryType = "blob"; 
        connectionTimeout = setTimeout(() => { if (liveSocket && liveSocket.readyState !== WebSocket.OPEN) { updateNellMessage("なかなかつながらないにゃ…", "thinking", false); stopLiveChat(); } }, 10000); 
        
        liveSocket.onopen = () => { 
            clearTimeout(connectionTimeout); 
            if(btn) { btn.innerText = "📞 つながった！(終了)"; btn.style.background = "#ff5252"; btn.disabled = false; } 
            updateNellMessage("お待たせ！なんでも話してにゃ！", "happy", false, false); // ★ここもfalse推奨
            isRecognitionActive = true; 
            startMicrophone(); 
        }; 
        
        liveSocket.onmessage = async (event) => { 
            try { 
                let data = event.data instanceof Blob ? JSON.parse(await event.data.text()) : JSON.parse(event.data); 
                if (data.serverContent?.modelTurn?.parts) { 
                    data.serverContent.modelTurn.parts.forEach(p => { 
                        if (p.inlineData) playLivePcmAudio(p.inlineData.data); 
                        if (p.text) { 
                            // ★ホワイトボード処理（インライン）
                            const match = p.text.match(/\[DISPLAY:\s*(.+?)\]/);
                            if (match) {
                                const content = match[1];
                                document.getElementById('inline-whiteboard').classList.remove('hidden');
                                document.getElementById('whiteboard-content').innerText = content;
                            }
                            saveToNellMemory('nell', p.text); 
                            const el = document.getElementById('nell-text'); 
                            if(el) el.innerText = p.text.replace(/\[DISPLAY:.*?\]/g, "");
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
    isRecognitionActive = false; 
    if (connectionTimeout) clearTimeout(connectionTimeout); 
    if (recognition) try{recognition.stop()}catch(e){} 
    if (mediaStream) mediaStream.getTracks().forEach(t=>t.stop()); 
    if (workletNode) { workletNode.port.postMessage('stop'); workletNode.disconnect(); } 
    if (liveSocket) liveSocket.close(); 
    if (audioContext && audioContext.state !== 'closed') audioContext.close(); 
    window.isNellSpeaking = false; 
    if(stopSpeakingTimer) clearTimeout(stopSpeakingTimer); 
    if(speakingStartTimer) clearTimeout(speakingStartTimer); 
    
    // ★修正: モードに応じてボタンを復帰
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
                let interim = ''; 
                for (let i = event.resultIndex; i < event.results.length; ++i) { 
                    if (event.results[i].isFinal) { 
                        saveToNellMemory('user', event.results[i][0].transcript); 
                        // ★修正: テキスト表示先も分岐
                        const txtId = currentMode === 'simple-chat' ? 'user-speech-text-simple' : 'user-speech-text';
                        const el = document.getElementById(txtId); 
                        if(el) el.innerText = event.results[i][0].transcript; 
                    } else interim += event.results[i][0].transcript; 
                } 
            }; 
            recognition.onend = () => { if (isRecognitionActive && liveSocket && liveSocket.readyState === WebSocket.OPEN) try{recognition.start()}catch(e){} }; 
            recognition.start(); 
        } 
        
        // カメラは個別指導モードのときだけON
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
function playLivePcmAudio(base64) { if (!audioContext) return; const binary = window.atob(base64); const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); const float32 = new Float32Array(bytes.length / 2); const view = new DataView(bytes.buffer); for (let i = 0; i < float32.length; i++) float32[i] = view.getInt16(i * 2, true) / 32768.0; const buffer = audioContext.createBuffer(1, float32.length, 24000); buffer.copyToChannel(float32, 0); const source = audioContext.createBufferSource(); source.buffer = buffer; source.connect(audioContext.destination); const now = audioContext.currentTime; if (nextStartTime < now) nextStartTime = now; source.start(nextStartTime); const startDelay = (nextStartTime - now) * 1000; const duration = buffer.duration * 1000; if(stopSpeakingTimer) clearTimeout(stopSpeakingTimer); speakingStartTimer = setTimeout(() => { window.isNellSpeaking = true; }, startDelay); stopSpeakingTimer = setTimeout(() => { window.isNellSpeaking = false; }, startDelay + duration + 100); nextStartTime += buffer.duration; }
function floatTo16BitPCM(float32Array) { const buffer = new ArrayBuffer(float32Array.length * 2); const view = new DataView(buffer); let offset = 0; for (let i = 0; i < float32Array.length; i++, offset += 2) { let s = Math.max(-1, Math.min(1, float32Array[i])); view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true); } return buffer; }
function downsampleBuffer(buffer, sampleRate, outSampleRate) { if (outSampleRate >= sampleRate) return buffer; const ratio = sampleRate / outSampleRate; const newLength = Math.round(buffer.length / ratio); const result = new Float32Array(newLength); let offsetResult = 0, offsetBuffer = 0; while (offsetResult < result.length) { const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio); let accum = 0, count = 0; for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) { accum += buffer[i]; count++; } result[offsetResult] = accum / count; offsetResult++; offsetBuffer = nextOffsetBuffer; } return result; }
function arrayBufferToBase64(buffer) { let binary = ''; const bytes = new Uint8Array(buffer); for (let i = 0; i < bytes.byteLength; i++) { binary += String.fromCharCode(bytes[i]); } return window.btoa(binary); }
function updateMiniKarikari() { if(currentUser) { const el = document.getElementById('mini-karikari-count'); if(el) el.innerText = currentUser.karikari; const el2 = document.getElementById('karikari-count'); if(el2) el2.innerText = currentUser.karikari; } }
function showKarikariEffect(amount) { const container = document.querySelector('.nell-avatar-wrap'); if(container) { const floatText = document.createElement('div'); floatText.className = 'floating-text'; floatText.innerText = amount > 0 ? `+${amount}` : `${amount}`; floatText.style.color = amount > 0 ? '#ff9100' : '#ff5252'; floatText.style.right = '0px'; floatText.style.top = '0px'; container.appendChild(floatText); setTimeout(() => floatText.remove(), 1500); } }
window.addEventListener('DOMContentLoaded', () => { const camIn = document.getElementById('hw-input-camera'); const albIn = document.getElementById('hw-input-album'); if(camIn) camIn.addEventListener('change', (e) => { handleFileUpload(e.target.files[0]); e.target.value=''; }); if(albIn) albIn.addEventListener('change', (e) => { handleFileUpload(e.target.files[0]); e.target.value=''; }); });
window.handleFileUpload = async (file) => { if (isAnalyzing || !file) return; document.getElementById('upload-controls').classList.add('hidden'); document.getElementById('cropper-modal').classList.remove('hidden'); const canvas = document.getElementById('crop-canvas'); canvas.style.opacity = '0'; const reader = new FileReader(); reader.onload = async (e) => { cropImg = new Image(); cropImg.onload = async () => { const w = cropImg.width; const h = cropImg.height; cropPoints = [ { x: w * 0.1, y: h * 0.1 }, { x: w * 0.9, y: h * 0.1 }, { x: w * 0.9, y: h * 0.9 }, { x: w * 0.1, y: h * 0.9 } ]; canvas.style.opacity = '1'; updateNellMessage("ここを読み取るにゃ？", "normal"); initCustomCropper(); }; cropImg.src = e.target.result; }; reader.readAsDataURL(file); };
function initCustomCropper() { const modal = document.getElementById('cropper-modal'); modal.classList.remove('hidden'); const canvas = document.getElementById('crop-canvas'); const MAX_CANVAS_SIZE = 2500; let w = cropImg.width; let h = cropImg.height; if (w > MAX_CANVAS_SIZE || h > MAX_CANVAS_SIZE) { const scale = Math.min(MAX_CANVAS_SIZE / w, MAX_CANVAS_SIZE / h); w *= scale; h *= scale; cropPoints = cropPoints.map(p => ({ x: p.x * scale, y: p.y * scale })); } canvas.width = w; canvas.height = h; canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.objectFit = 'contain'; const ctx = canvas.getContext('2d'); ctx.drawImage(cropImg, 0, 0, w, h); updateCropUI(canvas); const handles = ['handle-tl', 'handle-tr', 'handle-br', 'handle-bl']; handles.forEach((id, idx) => { const el = document.getElementById(id); const startDrag = (e) => { e.preventDefault(); activeHandle = idx; }; el.onmousedown = startDrag; el.ontouchstart = startDrag; }); const move = (e) => { if (activeHandle === -1) return; e.preventDefault(); const rect = canvas.getBoundingClientRect(); const imgRatio = canvas.width / canvas.height; const rectRatio = rect.width / rect.height; let drawX, drawY, drawW, drawH; if (imgRatio > rectRatio) { drawW = rect.width; drawH = rect.width / imgRatio; drawX = 0; drawY = (rect.height - drawH) / 2; } else { drawH = rect.height; drawW = rect.height * imgRatio; drawY = 0; drawX = (rect.width - drawW) / 2; } const clientX = e.touches ? e.touches[0].clientX : e.clientX; const clientY = e.touches ? e.touches[0].clientY : e.clientY; let relX = (clientX - rect.left - drawX) / drawW; let relY = (clientY - rect.top - drawY) / drawH; relX = Math.max(0, Math.min(1, relX)); relY = Math.max(0, Math.min(1, relY)); cropPoints[activeHandle] = { x: relX * canvas.width, y: relY * canvas.height }; updateCropUI(canvas); }; const end = () => { activeHandle = -1; }; window.onmousemove = move; window.ontouchmove = move; window.onmouseup = end; window.ontouchend = end; document.getElementById('cropper-cancel-btn').onclick = () => { modal.classList.add('hidden'); window.onmousemove = null; window.ontouchmove = null; document.getElementById('upload-controls').classList.remove('hidden'); }; document.getElementById('cropper-ok-btn').onclick = () => { modal.classList.add('hidden'); window.onmousemove = null; window.ontouchmove = null; const croppedBase64 = performPerspectiveCrop(canvas, cropPoints); startAnalysis(croppedBase64); }; }
function updateCropUI(canvas) { const handles = ['handle-tl', 'handle-tr', 'handle-br', 'handle-bl']; const rect = canvas.getBoundingClientRect(); const imgRatio = canvas.width / canvas.height; const rectRatio = rect.width / rect.height; let drawX, drawY, drawW, drawH; if (imgRatio > rectRatio) { drawW = rect.width; drawH = rect.width / imgRatio; drawX = 0; drawY = (rect.height - drawH) / 2; } else { drawH = rect.height; drawW = rect.height * imgRatio; drawY = 0; drawX = (rect.width - drawW) / 2; } const toScreen = (p) => ({ x: (p.x / canvas.width) * drawW + drawX + canvas.offsetLeft, y: (p.y / canvas.height) * drawH + drawY + canvas.offsetTop }); const screenPoints = cropPoints.map(toScreen); handles.forEach((id, i) => { const el = document.getElementById(id); el.style.left = screenPoints[i].x + 'px'; el.style.top = screenPoints[i].y + 'px'; }); const svg = document.getElementById('crop-lines'); svg.style.left = canvas.offsetLeft + 'px'; svg.style.top = canvas.offsetTop + 'px'; svg.style.width = canvas.offsetWidth + 'px'; svg.style.height = canvas.offsetHeight + 'px'; const toSvg = (p) => ({ x: (p.x / canvas.width) * drawW + drawX, y: (p.y / canvas.height) * drawH + drawY }); const svgPts = cropPoints.map(toSvg); const ptsStr = svgPts.map(p => `${p.x},${p.y}`).join(' '); svg.innerHTML = `<polyline points="${ptsStr} ${svgPts[0].x},${svgPts[0].y}" style="fill:rgba(255,255,255,0.2);stroke:#ff4081;stroke-width:2;stroke-dasharray:5" />`; }
function performPerspectiveCrop(sourceCanvas, points) { const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x)); const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y)); let w = maxX - minX, h = maxY - minY; if (w < 1) w = 1; if (h < 1) h = 1; const tempCv = document.createElement('canvas'); const MAX_OUT = 1536; let outW = w, outH = h; if (outW > MAX_OUT || outH > MAX_OUT) { const s = Math.min(MAX_OUT/outW, MAX_OUT/outH); outW *= s; outH *= s; } tempCv.width = outW; tempCv.height = outH; const ctx = tempCv.getContext('2d'); ctx.drawImage(sourceCanvas, minX, minY, w, h, 0, 0, outW, outH); return tempCv.toDataURL('image/jpeg', 0.85).split(',')[1]; }

// ==========================================
// 記憶管理 (Memory Manager) 機能
// ==========================================

window.openMemoryManager = async function() {
    if (!currentUser) return;
    const modal = document.getElementById('memory-manager-modal');
    if (modal) {
        modal.classList.remove('hidden');
        await renderMemoryList();
    }
};

window.closeMemoryManager = function() {
    const modal = document.getElementById('memory-manager-modal');
    if (modal) modal.classList.add('hidden');
};

window.renderMemoryList = async function() {
    const container = document.getElementById('memory-list-container');
    if (!container) return;
    container.innerHTML = '<p style="text-align:center;">読み込み中にゃ...</p>';

    // データの取得
    let history = [];
    const memoryKey = `nell_raw_chat_log_${currentUser.id}`;
    
    // 1. まずローカルストレージから取得
    try {
        history = JSON.parse(localStorage.getItem(memoryKey) || '[]');
    } catch(e) {}

    // 2. GoogleユーザーならFirestoreからも取得して結合（最新状態にする）
    if (currentUser.isGoogleUser && typeof db !== 'undefined' && db !== null) {
        try {
            const doc = await db.collection("memories").doc(currentUser.id).get();
            if (doc.exists) {
                history = doc.data().history || [];
                // ローカルも更新しておく
                localStorage.setItem(memoryKey, JSON.stringify(history));
            }
        } catch(e) { console.error("Memory Fetch Error:", e); }
    }

    // 表示生成
    container.innerHTML = '';
    if (history.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:#999;">まだ記憶がないにゃ</p>';
        return;
    }

    // 新しい順に表示（配列の後ろが最新なので逆順ループ）
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
    if (!confirm("この記憶を忘れさせるにゃ？")) return;
    
    const memoryKey = `nell_raw_chat_log_${currentUser.id}`;
    let history = JSON.parse(localStorage.getItem(memoryKey) || '[]');
    
    // 削除実行
    if (index >= 0 && index < history.length) {
        history.splice(index, 1); // 指定インデックスを削除
    }
    
    // 保存
    localStorage.setItem(memoryKey, JSON.stringify(history));
    
    if (currentUser.isGoogleUser && typeof db !== 'undefined' && db !== null) {
        try {
            await db.collection("memories").doc(currentUser.id).set({
                history: history,
                lastUpdated: new Date().toISOString()
            }, { merge: true });
        } catch(e) { console.error("Memory Delete Sync Error:", e); }
    }

    // 再描画
    renderMemoryList();
};