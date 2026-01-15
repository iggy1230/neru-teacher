// --- anlyze.js (完全版 v117.0: 分析セリフ修正 & 記憶断捨離) ---

// グローバル変数の初期化
window.transcribedProblems = []; 
window.selectedProblem = null; 
window.hintIndex = 0; 
window.isAnalyzing = false; 
window.currentSubject = '';
window.currentMode = ''; 
window.lunchCount = 0; 
window.analysisType = 'precision';

let liveSocket = null;
let audioContext = null;
let mediaStream = null;
let workletNode = null;
let stopSpeakingTimer = null;
let currentTtsSource = null;
let chatTranscript = ""; 
let nextStartTime = 0;
let connectionTimeout = null;

let recognition = null;
let isRecognitionActive = false;

let gameCanvas, ctx, ball, paddle, bricks, score, gameRunning = false, gameAnimId = null;

let cropImg = new Image();
let cropPoints = [];
let activeHandle = -1;

const sfxBori = new Audio('boribori.mp3');
const sfxHit = new Audio('cat1c.mp3');
const sfxPaddle = new Audio('poka02.mp3'); 
const sfxOver = new Audio('gameover.mp3');
// 分析BGM
const sfxBunseki = new Audio('bunseki.mp3');
sfxBunseki.volume = 0.1;

const gameHitComments = ["うまいにゃ！", "すごいにゃ！", "さすがにゃ！", "がんばれにゃ！"];

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

// --- ★記憶システム (断捨離フィルター実装版) ---
async function saveToNellMemory(role, text) {
    if (!currentUser || !currentUser.id) return;

    // --- フィルター (お耳の関所) ---
    // 1. 2文字以下は覚えない
    if (text.length <= 2) return;

    // 2. 意味のない相槌や呼びかけを無視
    const ignoreWords = ["あー", "えーと", "うーん", "あのー", "はい", "ねえ", "ネル先生", "にゃー"];
    if (ignoreWords.includes(text.trim())) {
        console.log("🤫 不要な相槌なので覚えなかったにゃ:", text);
        return;
    }
    // --- フィルターここまで ---

    const newItem = { role: role, text: text, time: new Date().toISOString() };
    console.log(`📝 記憶保存: [${role}] ${text.substring(0, 15)}...`);

    // 1. LocalStorage (バックアップ)
    try {
        const memoryKey = `nell_raw_chat_log_${currentUser.id}`;
        let history = JSON.parse(localStorage.getItem(memoryKey) || '[]');
        
        // 重複チェック（直前と同じなら保存しない）
        if (history.length > 0 && history[history.length - 1].text === text) return;

        history.push(newItem);
        if (history.length > 50) history.shift(); // 50件制限
        localStorage.setItem(memoryKey, JSON.stringify(history));
    } catch(e) { console.error("Local Save Error:", e); }

    // 2. Firestore (Googleユーザーなら同期)
    if (currentUser.isGoogleUser && typeof db !== 'undefined' && db !== null) {
        try {
            const docRef = db.collection("memories").doc(currentUser.id);
            const docSnap = await docRef.get();
            let cloudHistory = docSnap.exists ? (docSnap.data().history || []) : [];
            
            // クラウド側でも重複チェック
            if (cloudHistory.length > 0 && cloudHistory[cloudHistory.length - 1].text === text) return;

            cloudHistory.push(newItem);
            if (cloudHistory.length > 50) cloudHistory.shift();

            await docRef.set({ 
                history: cloudHistory,
                lastUpdated: new Date().toISOString()
            }, { merge: true });
        } catch(e) { console.error("Cloud Save Error:", e); }
    }
}

// --- メッセージ更新 (TTS待機 & フィルター修正) ---
window.updateNellMessage = async function(t, mood = "normal") {
    const gameScreen = document.getElementById('screen-game');
    const isGameHidden = gameScreen ? gameScreen.classList.contains('hidden') : true;
    const targetId = isGameHidden ? 'nell-text' : 'nell-text-game';
    const el = document.getElementById(targetId);
    
    if (el) el.innerText = t;

    if (t && t.includes("もぐもぐ")) { try { sfxBori.currentTime = 0; sfxBori.play(); } catch(e){} }
    
    // ★修正: "ちょっと待ってて" を除外条件から削除しました (分析中のセリフを喋らせるため)
    if (!t || t.includes("もぐもぐ") || t.includes("接続中")) return;

    // 記憶に保存
    saveToNellMemory('nell', t);

    // 音声合成 (再生終了を待つ)
    if (typeof speakNell === 'function') {
        const textForSpeech = t.replace(/🐾/g, "");
        await speakNell(textForSpeech, mood);
    }
};

// --- 分析演出用ヘルパー ---
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 分析中のセリフを順次再生
async function playAnalyzeSequence(firstMessage) {
    const messages = [
        { text: firstMessage, mood: "thinking" }, // 最初の「ふむふむ...」
        { text: "じーっと見て、問題を書き写してるにゃ...", mood: "thinking" },
        { text: "この問題、どこかで見たことあるにゃ...えーっと...", mood: "thinking" },
        { text: "ネル先生の天才的な頭脳で解いてるから、ちょっと待っててにゃ！", mood: "excited" },
        { text: "よしよし、だいたい分かってきたにゃ...", mood: "happy" }
    ];

    for (let i = 0; i < messages.length; i++) {
        if (!isAnalyzing) break; // 分析が終わっていたら即中断
        
        // セリフ再生（読み終わるまでここで待機）
        await updateNellMessage(messages[i].text, messages[i].mood);
        
        if (!isAnalyzing) break; // 再生中に終わった場合も中断

        // 次のセリフまで3秒待つ
        await wait(3000);
    }
}

// --- 分析開始 (startAnalysis) ---
async function startAnalysis(b64) {
    isAnalyzing = true;
    
    // UI切り替え
    document.getElementById('cropper-modal').classList.add('hidden');
    document.getElementById('thinking-view').classList.remove('hidden');
    document.getElementById('upload-controls').classList.add('hidden');
    const backBtn = document.getElementById('main-back-btn'); 
    if(backBtn) backBtn.classList.add('hidden');
    
    // BGMスタート
    try { sfxBunseki.currentTime = 0; sfxBunseki.play(); sfxBunseki.loop = true; } catch(e){}

    // プログレスバー開始
    updateProgress(0); 
    let p = 0; 
    const progressTimer = setInterval(() => { if (p < 95) { p += 1; updateProgress(p); } }, 200);

    // ★演出開始 (非同期で実行)
    const initialMsg = `ふむふむ…\n${currentUser.grade}年生の${currentSubject}の問題だにゃ…`;
    playAnalyzeSequence(initialMsg);

    try {
        const res = await fetch('/analyze', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ 
                image: b64, mode: currentMode, grade: currentUser.grade, 
                subject: currentSubject, analysisType: analysisType 
            }) 
        });
        
        if (!res.ok) throw new Error("Server Error");
        const data = await res.json();
        
        if (!data || data.length === 0) { 
            cleanupAnalysis(progressTimer);
            updateNellMessage("問題が見つからなかったにゃ…\nもう一度写真を撮ってみて！", "thinking"); 
            setTimeout(() => { 
                document.getElementById('thinking-view').classList.add('hidden'); 
                document.getElementById('upload-controls').classList.remove('hidden'); 
                if(backBtn) backBtn.classList.remove('hidden'); 
            }, 3000); 
            return; 
        }

        transcribedProblems = data.map((prob, index) => ({ 
            ...prob, id: index + 1, student_answer: prob.student_answer || "", status: "unanswered" 
        }));
        
        cleanupAnalysis(progressTimer);
        updateProgress(100); 

        setTimeout(() => { 
            document.getElementById('thinking-view').classList.add('hidden'); 
            const doneMsg = "読めたにゃ！"; 
            if (currentMode === 'grade') { 
                showGradingView(true); 
                updateNellMessage(doneMsg, "happy").then(() => { 
                    setTimeout(() => { updateGradingMessage(); }, 1500); 
                }); 
            } else { 
                renderProblemSelection(); 
                updateNellMessage(doneMsg, "happy"); 
            } 
        }, 800);

    } catch (err) { 
        cleanupAnalysis(progressTimer);
        document.getElementById('thinking-view').classList.add('hidden'); 
        document.getElementById('upload-controls').classList.remove('hidden'); 
        if(backBtn) backBtn.classList.remove('hidden'); 
        updateNellMessage("エラーだにゃ…", "thinking"); 
    }
}

// 分析終了時のクリーンアップ
function cleanupAnalysis(timerId) {
    isAnalyzing = false; // これでセリフループが止まる
    if(timerId) clearInterval(timerId);
    sfxBunseki.pause();
}

// --- モード選択など ---
window.selectMode = function(m) {
    currentMode = m; 
    if (typeof switchScreen === 'function') switchScreen('screen-main'); 
    
    const ids = ['subject-selection-view', 'upload-controls', 'thinking-view', 'problem-selection-view', 'final-view', 'chalkboard', 'chat-view', 'lunch-view', 'grade-sheet-container', 'hint-detail-container'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
    
    const backBtn = document.getElementById('main-back-btn');
    if (backBtn) { backBtn.classList.remove('hidden'); backBtn.onclick = backToLobby; }
    
    stopLiveChat(); gameRunning = false;
    const icon = document.querySelector('.nell-avatar-wrap img'); if(icon) icon.src = defaultIcon;
    document.getElementById('mini-karikari-display').classList.remove('hidden'); 
    updateMiniKarikari();

    if (m === 'chat') {
        document.getElementById('chat-view').classList.remove('hidden');
        updateNellMessage("「おはなしする」を押してね！", "gentle");
        const btn = document.getElementById('mic-btn');
        if(btn) { btn.innerText = "🎤 おはなしする"; btn.onclick = startLiveChat; btn.disabled = false; btn.style.background = "#ff85a1"; btn.style.boxShadow = "none"; }
    } else if (m === 'lunch') {
        document.getElementById('lunch-view').classList.remove('hidden'); 
        updateNellMessage("お腹ペコペコだにゃ……", "thinking");
    } else if (m === 'review') { 
        renderMistakeSelection(); 
    } else { 
        const subjectView = document.getElementById('subject-selection-view');
        if (subjectView) subjectView.classList.remove('hidden'); 
        updateNellMessage("どの教科にするのかにゃ？", "normal"); 
    }
};

window.setSubject = function(s) { 
    currentSubject = s; 
    if(typeof currentUser !== 'undefined' && currentUser){
        currentUser.history = currentUser.history || {};
        currentUser.history[s]=(currentUser.history[s]||0)+1; 
        if(typeof saveAndSync === 'function') saveAndSync();
    } 
    const icon = document.querySelector('.nell-avatar-wrap img'); if(icon&&subjectImages[s]){icon.src=subjectImages[s].base; icon.onerror=()=>{icon.src=defaultIcon;};} 
    
    document.getElementById('subject-selection-view').classList.add('hidden'); 
    document.getElementById('upload-controls').classList.remove('hidden'); 
    updateNellMessage(`${currentSubject}の問題をみせてにゃ！`, "happy"); 
    
    const btnFast = document.getElementById('mode-btn-fast');
    const btnPrec = document.getElementById('mode-btn-precision');
    
    if (btnFast) {
        btnFast.innerText = "📷 ネル先生に宿題を見せる";
        btnFast.className = "main-btn"; 
        btnFast.style.background = "#ff85a1";
        btnFast.style.width = "100%";
        btnFast.style.cursor = "default";
        btnFast.style.boxShadow = "none";
        btnFast.onclick = null;
    }
    if (btnPrec) btnPrec.style.display = "none";

    const backBtn = document.getElementById('main-back-btn');
    if (backBtn) {
        backBtn.classList.remove('hidden');
        backBtn.onclick = () => {
            document.getElementById('upload-controls').classList.add('hidden');
            document.getElementById('subject-selection-view').classList.remove('hidden');
            updateNellMessage("どの教科にするのかにゃ？", "normal");
            backBtn.onclick = backToLobby;
        };
    }
};

window.setAnalyzeMode = function(type) { analysisType = 'precision'; };

// --- 給食 ---
window.giveLunch = function() {
    if (currentUser.karikari < 1) return updateNellMessage("カリカリがないにゃ……", "thinking");
    updateNellMessage("もぐもぐ……", "normal");
    currentUser.karikari--; 
    if(typeof saveAndSync === 'function') saveAndSync(); 
    updateMiniKarikari(); showKarikariEffect(-1); lunchCount++;
    fetch('/lunch-reaction', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: lunchCount, name: currentUser.name })
    }).then(r => r.json()).then(d => {
        setTimeout(() => { updateNellMessage(d.reply || "おいしいにゃ！", d.isSpecial ? "excited" : "happy"); }, 1500);
    }).catch(e => { setTimeout(() => { updateNellMessage("おいしいにゃ！", "happy"); }, 1500); });
};

// --- ゲーム ---
window.showGame = function() {
    switchScreen('screen-game'); 
    document.getElementById('mini-karikari-display').classList.remove('hidden'); 
    updateMiniKarikari(); 
    initGame(); 
    fetchGameComment("start"); 
    const startBtn = document.getElementById('start-game-btn');
    if (startBtn) {
        const newBtn = startBtn.cloneNode(true);
        startBtn.parentNode.replaceChild(newBtn, startBtn);
        newBtn.onclick = () => { if (!gameRunning) { initGame(); gameRunning = true; newBtn.disabled = true; drawGame(); } };
    }
};

// --- ヒント/正解 ---
window.startHint = function(id) {
    if (window.initAudioContext) window.initAudioContext().catch(e=>{});
    selectedProblem = transcribedProblems.find(p => p.id == id); 
    if (!selectedProblem) return updateNellMessage("データエラーだにゃ", "thinking");
    
    ['problem-selection-view', 'grade-sheet-container', 'answer-display-area', 'chalkboard'].forEach(i => { const el = document.getElementById(i); if(el) el.classList.add('hidden'); });
    document.getElementById('final-view').classList.remove('hidden'); 
    document.getElementById('hint-detail-container').classList.remove('hidden');
    const board = document.getElementById('chalkboard'); if(board) { board.innerText = selectedProblem.question; board.classList.remove('hidden'); }
    document.getElementById('main-back-btn').classList.add('hidden');
    
    hintIndex = 0; updateNellMessage("カリカリをくれたらヒントを出してやってもいいにゃ🐾", "thinking");
    const nextBtn = document.getElementById('next-hint-btn'); const revealBtn = document.getElementById('reveal-answer-btn');
    if(nextBtn) { nextBtn.innerText = "🍖 ネル先生にカリカリを5個あげてヒントをもらう"; nextBtn.classList.remove('hidden'); nextBtn.onclick = window.showNextHint; }
    if(revealBtn) revealBtn.classList.add('hidden');
    const hl = document.getElementById('hint-step-label'); if(hl) hl.innerText = "考え方";
};

window.showNextHint = function() {
    if (window.initAudioContext) window.initAudioContext();
    let cost = 5; if (hintIndex === 2) cost = 10;
    if (currentUser.karikari < cost) return updateNellMessage(`カリカリが足りないにゃ…あと${cost}個！`, "thinking");
    currentUser.karikari -= cost; saveAndSync(); updateMiniKarikari(); showKarikariEffect(-cost);
    
    let hints = selectedProblem.hints || [];
    updateNellMessage(hints[hintIndex] || "……", "thinking");
    const hl = document.getElementById('hint-step-label'); if(hl) hl.innerText = `ヒント ${hintIndex + 1}`; hintIndex++;
    
    const nextBtn = document.getElementById('next-hint-btn'); const revealBtn = document.getElementById('reveal-answer-btn');
    if (hintIndex === 1) nextBtn.innerText = "🍖 さらに5個あげてヒント！";
    else if (hintIndex === 2) nextBtn.innerText = "🍖 さらに10個あげてヒント！";
    else { if(nextBtn) nextBtn.classList.add('hidden'); if(revealBtn) { revealBtn.classList.remove('hidden'); revealBtn.innerText = "答えを見る"; revealBtn.onclick = window.revealAnswer; } }
};

window.revealAnswer = function() {
    const ansArea = document.getElementById('answer-display-area'); const finalTxt = document.getElementById('final-answer-text');
    const revealBtn = document.getElementById('reveal-answer-btn');
    if (ansArea && finalTxt) { finalTxt.innerText = selectedProblem.correct_answer; ansArea.classList.remove('hidden'); ansArea.style.display = "block"; }
    if (revealBtn) { revealBtn.classList.add('hidden'); }
    updateNellMessage(`答えは「${selectedProblem.correct_answer}」だにゃ！`, "gentle"); 
};

window.backToProblemSelection = function() {
    document.getElementById('final-view').classList.add('hidden'); 
    document.getElementById('hint-detail-container').classList.add('hidden'); 
    document.getElementById('chalkboard').classList.add('hidden');
    document.getElementById('answer-display-area').classList.add('hidden');
    
    if (currentMode === 'grade') showGradingView();
    else { renderProblemSelection(); updateNellMessage("他も見るにゃ？", "normal"); }
    
    const backBtn = document.getElementById('main-back-btn');
    if(backBtn) { backBtn.classList.remove('hidden'); backBtn.onclick = backToLobby; }
};

window.pressThanks = function() { window.backToProblemSelection(); };

window.finishGrading = async function(btnElement) { 
    if(btnElement) { btnElement.disabled = true; btnElement.innerText = "採点完了！"; }
    if (currentUser) { currentUser.karikari += 100; saveAndSync(); updateMiniKarikari(); showKarikariEffect(100); } 
    await updateNellMessage("よくがんばったにゃ！カリカリ100個あげる！", "excited"); 
    setTimeout(() => { if(typeof backToLobby === 'function') backToLobby(true); }, 3000); 
};

window.pressAllSolved = function(btnElement) { 
    if(btnElement) { btnElement.disabled = true; btnElement.innerText = "すごい！"; }
    if (currentUser) { currentUser.karikari += 100; saveAndSync(); showKarikariEffect(100); updateMiniKarikari(); 
        updateNellMessage("よくがんばったにゃ！カリカリ100個あげるにゃ！", "excited").then(() => { setTimeout(() => { if(typeof backToLobby === 'function') backToLobby(true); }, 3000); });
    }
};

// --- Live Chat ---
async function startLiveChat() {
    const btn = document.getElementById('mic-btn');
    if (liveSocket) { stopLiveChat(); return; }
    try {
        updateNellMessage("ネル先生を呼んでるにゃ…", "thinking");
        if(btn) btn.disabled = true;
        chatTranscript = "";
        
        if (window.initAudioContext) await window.initAudioContext();
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        await audioContext.resume();
        nextStartTime = audioContext.currentTime;
        
        const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        let statusSummary = `${currentUser.name}さんは今、お話しにきたにゃ。カリカリは${currentUser.karikari}個持ってるにゃ。`;
        const url = `${wsProto}//${location.host}?grade=${currentUser.grade}&name=${encodeURIComponent(currentUser.name)}&status=${encodeURIComponent(statusSummary)}`;
        liveSocket = new WebSocket(url); liveSocket.binaryType = "blob";
        connectionTimeout = setTimeout(() => { if (liveSocket && liveSocket.readyState !== WebSocket.OPEN) { updateNellMessage("なかなかつながらないにゃ…", "thinking"); stopLiveChat(); } }, 10000);
        liveSocket.onopen = () => { clearTimeout(connectionTimeout); if(btn) { btn.innerText = "📞 つながった！(終了)"; btn.style.background = "#ff5252"; btn.disabled = false; } updateNellMessage("お待たせ！なんでも話してにゃ！", "happy"); isRecognitionActive = true; startMicrophone(); };
        liveSocket.onmessage = async (event) => { try { let data = event.data instanceof Blob ? JSON.parse(await event.data.text()) : JSON.parse(event.data); if (data.serverContent?.modelTurn?.parts) { data.serverContent.modelTurn.parts.forEach(p => { if (p.inlineData) playLivePcmAudio(p.inlineData.data); if (p.text) liveResponseBuffer += p.text; }); } if (data.serverContent?.turnComplete && liveResponseBuffer.length > 0) { saveToNellMemory('nell', liveResponseBuffer); liveResponseBuffer = ""; } } catch (e) {} };
        liveSocket.onclose = () => stopLiveChat();
        liveSocket.onerror = () => stopLiveChat();
    } catch (e) { stopLiveChat(); }
}
function stopLiveChat() { isRecognitionActive = false; if (connectionTimeout) clearTimeout(connectionTimeout); if (recognition) try{recognition.stop()}catch(e){} if (mediaStream) mediaStream.getTracks().forEach(t=>t.stop()); if (workletNode) { workletNode.port.postMessage('stop'); workletNode.disconnect(); } if (liveSocket) liveSocket.close(); if (audioContext) audioContext.close(); window.isNellSpeaking = false; const btn = document.getElementById('mic-btn'); if (btn) { btn.innerText = "🎤 おはなしする"; btn.style.background = "#ff85a1"; btn.disabled = false; btn.onclick = startLiveChat; } liveSocket = null; }

// --- Audio/Speech ---
async function startMicrophone() { try { if ('webkitSpeechRecognition' in window) { recognition = new webkitSpeechRecognition(); recognition.continuous = true; recognition.interimResults = true; recognition.lang = 'ja-JP'; recognition.onresult = (event) => { let interim = ''; for (let i = event.resultIndex; i < event.results.length; ++i) { if (event.results[i].isFinal) { saveToNellMemory('user', event.results[i][0].transcript); const el = document.getElementById('user-speech-text'); if(el) el.innerText = event.results[i][0].transcript; } else interim += event.results[i][0].transcript; } }; recognition.onend = () => { if (isRecognitionActive && liveSocket && liveSocket.readyState === WebSocket.OPEN) try{recognition.start()}catch(e){} }; recognition.start(); } mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } }); const processorCode = `class PcmProcessor extends AudioWorkletProcessor { constructor() { super(); this.bufferSize = 2048; this.buffer = new Float32Array(this.bufferSize); this.index = 0; } process(inputs, outputs, parameters) { const input = inputs[0]; if (input.length > 0) { const channel = input[0]; for (let i = 0; i < channel.length; i++) { this.buffer[this.index++] = channel[i]; if (this.index >= this.bufferSize) { this.port.postMessage(this.buffer); this.index = 0; } } } return true; } } registerProcessor('pcm-processor', PcmProcessor);`; const blob = new Blob([processorCode], { type: 'application/javascript' }); await audioContext.audioWorklet.addModule(URL.createObjectURL(blob)); const source = audioContext.createMediaStreamSource(mediaStream); workletNode = new AudioWorkletNode(audioContext, 'pcm-processor'); source.connect(workletNode); workletNode.port.onmessage = (event) => { if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) return; const downsampled = downsampleBuffer(event.data, audioContext.sampleRate, 16000); liveSocket.send(JSON.stringify({ base64Audio: arrayBufferToBase64(floatTo16BitPCM(downsampled)) })); }; } catch(e){} }
function playLivePcmAudio(base64) { if (!audioContext) return; const binary = window.atob(base64); const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); const float32 = new Float32Array(bytes.length / 2); const view = new DataView(bytes.buffer); for (let i = 0; i < float32.length; i++) float32[i] = view.getInt16(i * 2, true) / 32768.0; const buffer = audioContext.createBuffer(1, float32.length, 24000); buffer.copyToChannel(float32, 0); const source = audioContext.createBufferSource(); source.buffer = buffer; source.connect(audioContext.destination); const now = audioContext.currentTime; if (nextStartTime < now) nextStartTime = now + 1.0; source.start(nextStartTime); nextStartTime += buffer.duration; window.isNellSpeaking = true; if (stopSpeakingTimer) clearTimeout(stopSpeakingTimer); source.onended = () => { stopSpeakingTimer = setTimeout(() => { window.isNellSpeaking = false; }, 250); }; }
function floatTo16BitPCM(float32Array) { const buffer = new ArrayBuffer(float32Array.length * 2); const view = new DataView(buffer); let offset = 0; for (let i = 0; i < float32Array.length; i++, offset += 2) { let s = Math.max(-1, Math.min(1, float32Array[i])); view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true); } return buffer; }
function downsampleBuffer(buffer, sampleRate, outSampleRate) { if (outSampleRate >= sampleRate) return buffer; const ratio = sampleRate / outSampleRate; const newLength = Math.round(buffer.length / ratio); const result = new Float32Array(newLength); let offsetResult = 0, offsetBuffer = 0; while (offsetResult < result.length) { const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio); let accum = 0, count = 0; for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) { accum += buffer[i]; count++; } result[offsetResult] = accum / count; offsetResult++; offsetBuffer = nextOffsetBuffer; } return result; }
function arrayBufferToBase64(buffer) { let binary = ''; const bytes = new Uint8Array(buffer); for (let i = 0; i < bytes.byteLength; i++) { binary += String.fromCharCode(bytes[i]); } return window.btoa(binary); }
function updateMiniKarikari() { if(currentUser) { const el = document.getElementById('mini-karikari-count'); if(el) el.innerText = currentUser.karikari; const el2 = document.getElementById('karikari-count'); if(el2) el2.innerText = currentUser.karikari; } }
function showKarikariEffect(amount) { const container = document.querySelector('.nell-avatar-wrap'); if(container) { const floatText = document.createElement('div'); floatText.className = 'floating-text'; floatText.innerText = amount > 0 ? `+${amount}` : `${amount}`; floatText.style.color = amount > 0 ? '#ff9100' : '#ff5252'; floatText.style.right = '0px'; floatText.style.top = '0px'; container.appendChild(floatText); setTimeout(() => floatText.remove(), 1500); } }

// --- Analyze (DOM Ready) ---
window.addEventListener('DOMContentLoaded', () => {
    const camIn = document.getElementById('hw-input-camera'); 
    const albIn = document.getElementById('hw-input-album'); 
    if(camIn) camIn.addEventListener('change', (e) => { handleFileUpload(e.target.files[0]); e.target.value=''; });
    if(albIn) albIn.addEventListener('change', (e) => { handleFileUpload(e.target.files[0]); e.target.value=''; });
});

window.handleFileUpload = async (file) => {
    if (isAnalyzing || !file) {
        if(isAnalyzing) console.log("Busy analyzing...");
        return;
    }
    
    const uploadControls = document.getElementById('upload-controls');
    const cropperModal = document.getElementById('cropper-modal');
    
    if (uploadControls) uploadControls.classList.add('hidden');
    if (cropperModal) cropperModal.classList.remove('hidden');
    
    const canvas = document.getElementById('crop-canvas'); 
    if(canvas) canvas.style.opacity = '0';
    
    let loader = document.getElementById('crop-loader');
    if (!loader && document.querySelector('.cropper-wrapper')) { 
        loader = document.createElement('div'); 
        loader.id = 'crop-loader'; 
        loader.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:white;font-weight:bold;'; 
        loader.innerText = '📷 画像を読み込んでるにゃ...'; 
        document.querySelector('.cropper-wrapper').appendChild(loader); 
    }
    if(loader) loader.style.display = 'block';
    
    const reader = new FileReader();
    reader.onload = async (e) => { 
        const rawBase64 = e.target.result; 
        cropImg = new Image(); 
        cropImg.onload = async () => { 
            const w = cropImg.width; 
            const h = cropImg.height; 
            const getDefaultRect = (w, h) => [ { x: w * 0.1, y: h * 0.1 }, { x: w * 0.9, y: h * 0.1 }, { x: w * 0.9, y: h * 0.9 }, { x: w * 0.1, y: h * 0.9 } ]; 
            cropPoints = getDefaultRect(w, h); 
            if(loader) loader.style.display = 'none'; 
            if(canvas) canvas.style.opacity = '1'; 
            updateNellMessage("ここを読み取るにゃ？", "normal"); 
            initCustomCropper(); 
        }; 
        cropImg.src = rawBase64; 
    };
    reader.readAsDataURL(file);
};

function initCustomCropper() {
    const modal = document.getElementById('cropper-modal'); modal.classList.remove('hidden'); const canvas = document.getElementById('crop-canvas'); const MAX_CANVAS_SIZE = 2500; let w = cropImg.width; let h = cropImg.height; if (w > MAX_CANVAS_SIZE || h > MAX_CANVAS_SIZE) { const scale = Math.min(MAX_CANVAS_SIZE / w, MAX_CANVAS_SIZE / h); w *= scale; h *= scale; cropPoints = cropPoints.map(p => ({ x: p.x * scale, y: p.y * scale })); } canvas.width = w; canvas.height = h; canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.objectFit = 'contain'; const ctx = canvas.getContext('2d'); ctx.drawImage(cropImg, 0, 0, w, h); updateCropUI(canvas);
    const handles = ['handle-tl', 'handle-tr', 'handle-br', 'handle-bl']; handles.forEach((id, idx) => { const el = document.getElementById(id); const startDrag = (e) => { e.preventDefault(); activeHandle = idx; }; el.onmousedown = startDrag; el.ontouchstart = startDrag; });
    const move = (e) => { if (activeHandle === -1) return; e.preventDefault(); const rect = canvas.getBoundingClientRect(); const imgRatio = canvas.width / canvas.height; const rectRatio = rect.width / rect.height; let drawX, drawY, drawW, drawH; if (imgRatio > rectRatio) { drawW = rect.width; drawH = rect.width / imgRatio; drawX = 0; drawY = (rect.height - drawH) / 2; } else { drawH = rect.height; drawW = rect.height * imgRatio; drawY = 0; drawX = (rect.width - drawW) / 2; } const clientX = e.touches ? e.touches[0].clientX : e.clientX; const clientY = e.touches ? e.touches[0].clientY : e.clientY; let relX = (clientX - rect.left - drawX) / drawW; let relY = (clientY - rect.top - drawY) / drawH; relX = Math.max(0, Math.min(1, relX)); relY = Math.max(0, Math.min(1, relY)); cropPoints[activeHandle] = { x: relX * canvas.width, y: relY * canvas.height }; updateCropUI(canvas); };
    const end = () => { activeHandle = -1; }; window.onmousemove = move; window.ontouchmove = move; window.onmouseup = end; window.ontouchend = end;
    document.getElementById('cropper-cancel-btn').onclick = () => { modal.classList.add('hidden'); window.onmousemove = null; window.ontouchmove = null; document.getElementById('upload-controls').classList.remove('hidden'); };
    document.getElementById('cropper-ok-btn').onclick = () => { modal.classList.add('hidden'); window.onmousemove = null; window.ontouchmove = null; const croppedBase64 = performPerspectiveCrop(canvas, cropPoints); startAnalysis(croppedBase64); };
}
function updateCropUI(canvas) {
    const handles = ['handle-tl', 'handle-tr', 'handle-br', 'handle-bl']; const rect = canvas.getBoundingClientRect(); const imgRatio = canvas.width / canvas.height; const rectRatio = rect.width / rect.height; let drawX, drawY, drawW, drawH; if (imgRatio > rectRatio) { drawW = rect.width; drawH = rect.width / imgRatio; drawX = 0; drawY = (rect.height - drawH) / 2; } else { drawH = rect.height; drawW = rect.height * imgRatio; drawY = 0; drawX = (rect.width - drawW) / 2; } const toScreen = (p) => ({ x: (p.x / canvas.width) * drawW + drawX + canvas.offsetLeft, y: (p.y / canvas.height) * drawH + drawY + canvas.offsetTop }); const screenPoints = cropPoints.map(toScreen); handles.forEach((id, i) => { const el = document.getElementById(id); el.style.left = screenPoints[i].x + 'px'; el.style.top = screenPoints[i].y + 'px'; }); const svg = document.getElementById('crop-lines'); svg.style.left = canvas.offsetLeft + 'px'; svg.style.top = canvas.offsetTop + 'px'; svg.style.width = canvas.offsetWidth + 'px'; svg.style.height = canvas.offsetHeight + 'px'; const toSvg = (p) => ({ x: (p.x / canvas.width) * drawW + drawX, y: (p.y / canvas.height) * drawH + drawY }); const svgPts = cropPoints.map(toSvg); const ptsStr = svgPts.map(p => `${p.x},${p.y}`).join(' '); svg.innerHTML = `<polyline points="${ptsStr} ${svgPts[0].x},${svgPts[0].y}" style="fill:rgba(255,255,255,0.2);stroke:#ff4081;stroke-width:2;stroke-dasharray:5" />`;
}
function performPerspectiveCrop(sourceCanvas, points) {
    const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x)); const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y)); let w = maxX - minX, h = maxY - minY; if (w < 1) w = 1; if (h < 1) h = 1; const tempCv = document.createElement('canvas'); const MAX_OUT = 1536; let outW = w, outH = h; if (outW > MAX_OUT || outH > MAX_OUT) { const s = Math.min(MAX_OUT/outW, MAX_OUT/outH); outW *= s; outH *= s; } tempCv.width = outW; tempCv.height = outH; const ctx = tempCv.getContext('2d'); ctx.drawImage(sourceCanvas, minX, minY, w, h, 0, 0, outW, outH); return tempCv.toDataURL('image/jpeg', 0.85).split(',')[1];
}