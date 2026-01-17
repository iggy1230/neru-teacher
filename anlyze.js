// --- anlyze.js (完全版 v150.0: 記憶システム完全復元 & ユーザーID管理) ---

// グローバル変数の初期化
window.transcribedProblems = []; 
window.selectedProblem = null; 
window.hintIndex = 0; 
window.isAnalyzing = false; 
window.currentSubject = '';
window.currentMode = ''; 
window.lunchCount = 0; 
window.analysisType = 'precision';

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

const sfxBori = new Audio('boribori.mp3');
const sfxHit = new Audio('cat1c.mp3');
const sfxPaddle = new Audio('poka02.mp3'); 
const sfxOver = new Audio('gameover.mp3');
const sfxBunseki = new Audio('bunseki.mp3'); 
sfxBunseki.volume = 0.05; 
const sfxHirameku = new Audio('hirameku.mp3'); 

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

// --- ★修正: 記憶システム (ユーザーIDベース) ---
async function saveToNellMemory(role, text) {
    if (!currentUser || !currentUser.id) return;
    const trimmed = text.trim();
    const ignoreWords = ["あー", "えーと", "うーん", "はい", "ねえ", "ネル先生", "にゃー", "にゃ"];
    if (trimmed.length <= 2 || ignoreWords.includes(trimmed)) return;

    const newItem = { role: role, text: trimmed, time: new Date().toISOString() };
    
    // 1. ローカルストレージ (IDごと)
    try {
        const memoryKey = `nell_raw_chat_log_${currentUser.id}`;
        let history = JSON.parse(localStorage.getItem(memoryKey) || '[]');
        if (history.length > 0 && history[history.length - 1].text === trimmed) return; // 重複回避
        history.push(newItem);
        if (history.length > 50) history.shift(); 
        localStorage.setItem(memoryKey, JSON.stringify(history));
    } catch(e) {}

    // 2. Firebase (Googleユーザーのみ)
    if (currentUser.isGoogleUser && typeof db !== 'undefined' && db !== null) {
        try {
            const docRef = db.collection("memories").doc(currentUser.id);
            const docSnap = await docRef.get();
            let cloudHistory = docSnap.exists ? (docSnap.data().history || []) : [];
            if (cloudHistory.length > 0 && cloudHistory[cloudHistory.length - 1].text === trimmed) return;
            cloudHistory.push(newItem);
            if (cloudHistory.length > 50) cloudHistory.shift();
            await docRef.set({ history: cloudHistory, lastUpdated: new Date().toISOString() }, { merge: true });
        } catch(e) { console.error("Memory sync failed:", e); }
    }
}

// --- メッセージ更新 ---
window.updateNellMessage = async function(t, mood = "normal") {
    const gameScreen = document.getElementById('screen-game');
    const isGameHidden = gameScreen ? gameScreen.classList.contains('hidden') : true;
    const targetId = isGameHidden ? 'nell-text' : 'nell-text-game';
    const el = document.getElementById(targetId);
    if (el) el.innerText = t;
    if (t && t.includes("もぐもぐ")) { try { sfxBori.currentTime = 0; sfxBori.play(); } catch(e){} }
    if (!t || t.includes("ちょっと待ってて") || t.includes("もぐもぐ") || t.includes("接続中")) return;
    
    saveToNellMemory('nell', t);
    
    if (typeof speakNell === 'function') {
        let textForSpeech = t.replace(/【.*?】/g, "").trim();
        textForSpeech = textForSpeech.replace(/🐾/g, "");
        await speakNell(textForSpeech, mood);
    }
};

// --- モード選択 ---
window.selectMode = function(m) {
    currentMode = m; 
    if (typeof switchScreen === 'function') switchScreen('screen-main'); 
    
    const ids = ['subject-selection-view', 'upload-controls', 'thinking-view', 'problem-selection-view', 'final-view', 'chalkboard', 'chat-view', 'lunch-view', 'grade-sheet-container', 'hint-detail-container'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
    
    const backBtn = document.getElementById('main-back-btn');
    if (backBtn) { backBtn.classList.remove('hidden'); backBtn.onclick = backToLobby; }
    
    stopLiveChat(); 
    gameRunning = false;
    const icon = document.querySelector('.nell-avatar-wrap img'); if(icon) icon.src = defaultIcon;
    document.getElementById('mini-karikari-display').classList.remove('hidden'); 
    updateMiniKarikari();

    if (m === 'chat') {
        document.getElementById('chat-view').classList.remove('hidden');
        updateNellMessage("「おはなしする」を押してね！", "gentle");
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
        btnFast.onclick = null; 
    }
    if (btnPrec) btnPrec.style.display = "none";
};

window.setAnalyzeMode = function(type) { analysisType = 'precision'; };

// --- 分析ロジック ---
window.startAnalysis = async function(b64) {
    if (isAnalyzing) return;
    isAnalyzing = true; 
    
    document.getElementById('cropper-modal').classList.add('hidden'); 
    document.getElementById('thinking-view').classList.remove('hidden'); 
    document.getElementById('upload-controls').classList.add('hidden'); 
    const backBtn = document.getElementById('main-back-btn'); if(backBtn) backBtn.classList.add('hidden');
    
    try { sfxBunseki.currentTime = 0; sfxBunseki.play(); sfxBunseki.loop = true; } catch(e){}
    
    let p = 0; 
    const timer = setInterval(() => { 
        if (!isAnalyzing) { clearInterval(timer); return; }
        if (p < 30) p += 1;
        else if (p < 80) p += 0.4;
        else if (p < 95) p += 0.1;
        updateProgress(p); 
    }, 300);

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
        
        for (const item of msgs) {
            if (!isAnalyzing) return; 
            await updateNellMessage(item.text, item.mood); 
            
            if (!isAnalyzing) return;
            await new Promise(r => setTimeout(r, 1500)); 
        }
    };
    
    performAnalysisNarration();
    
    try {
        const res = await fetch('/analyze', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ 
                image: b64, 
                mode: currentMode, 
                grade: currentUser.grade, 
                subject: currentSubject,
                name: currentUser.name 
            }) 
        });
        
        if (!res.ok) throw new Error("Server Error"); 
        const data = await res.json();
        
        if (!data || data.length === 0) throw new Error("No Data");

        transcribedProblems = data.map((prob, index) => ({ 
            ...prob, 
            id: index + 1, 
            student_answer: prob.student_answer || "", 
            status: prob.student_answer ? "answered" : "unanswered",
            currentHintLevel: 1,
            maxUnlockedHintLevel: 0 
        }));
        
        isAnalyzing = false; // ループ停止
        clearInterval(timer); 
        updateProgress(100); 
        cleanupAnalysis();

        try { sfxHirameku.currentTime = 0; sfxHirameku.play(); } catch(e){}

        setTimeout(() => { 
            document.getElementById('thinking-view').classList.add('hidden'); 
            const doneMsg = "読めたにゃ！"; 
            if (currentMode === 'grade') { 
                showGradingView(true); 
                updateNellMessage(doneMsg, "happy").then(() => setTimeout(updateGradingMessage, 1500)); 
            } else { 
                renderProblemSelection(); 
                updateNellMessage(doneMsg, "happy"); 
            } 
        }, 1500); 

    } catch (err) { 
        isAnalyzing = false;
        cleanupAnalysis();
        clearInterval(timer); 
        document.getElementById('thinking-view').classList.add('hidden'); 
        document.getElementById('upload-controls').classList.remove('hidden'); 
        if(backBtn) backBtn.classList.remove('hidden'); 
        updateNellMessage("うまく読めなかったにゃ…もう一度お願いにゃ！", "thinking"); 
    }
};

function cleanupAnalysis() {
    isAnalyzing = false;
    sfxBunseki.pause();
    if(typeof analysisTimers !== 'undefined' && analysisTimers) {
        analysisTimers.forEach(t => clearTimeout(t));
        analysisTimers = [];
    }
}

// --- ヒント機能 ---
window.startHint = function(id) {
    if (window.initAudioContext) window.initAudioContext().catch(e=>{});
    selectedProblem = transcribedProblems.find(p => p.id == id); 
    if (!selectedProblem) return updateNellMessage("データエラーだにゃ", "thinking");
    
    if (!selectedProblem.currentHintLevel) selectedProblem.currentHintLevel = 1;
    if (selectedProblem.maxUnlockedHintLevel === undefined) selectedProblem.maxUnlockedHintLevel = 0;

    ['problem-selection-view', 'grade-sheet-container', 'answer-display-area', 'chalkboard'].forEach(i => { const el = document.getElementById(i); if(el) el.classList.add('hidden'); });
    document.getElementById('final-view').classList.remove('hidden'); 
    document.getElementById('hint-detail-container').classList.remove('hidden');
    const board = document.getElementById('chalkboard'); if(board) { board.innerText = selectedProblem.question; board.classList.remove('hidden'); }
    document.getElementById('main-back-btn').classList.add('hidden');
    
    updateNellMessage("ヒントを見るにゃ？", "thinking");
    const nextBtn = document.getElementById('next-hint-btn'); const revealBtn = document.getElementById('reveal-answer-btn');
    
    if(nextBtn) { 
        let label = selectedProblem.maxUnlockedHintLevel >= 1 ? "ヒント1を見る (済)" : "🍖 カリカリ5個でヒント！";
        nextBtn.innerText = label; 
        nextBtn.classList.remove('hidden'); 
        nextBtn.onclick = window.showNextHint; 
    }
    if(revealBtn) revealBtn.classList.add('hidden');
    const hl = document.getElementById('hint-step-label'); if(hl) hl.innerText = "考え方";
};

window.showNextHint = function() {
    if (window.initAudioContext) window.initAudioContext();
    const p = selectedProblem;
    if (!p) return;

    if (!p.currentHintLevel) p.currentHintLevel = 1;
    if (p.maxUnlockedHintLevel === undefined) p.maxUnlockedHintLevel = 0;

    let targetLevel = p.currentHintLevel; 
    
    if (targetLevel > p.maxUnlockedHintLevel) {
        let cost = 5;
        if (currentUser.karikari < cost) return updateNellMessage(`カリカリが足りないにゃ…あと${cost}個！`, "thinking");
        
        currentUser.karikari -= cost; 
        saveAndSync(); 
        updateMiniKarikari(); 
        showKarikariEffect(-cost);
        
        p.maxUnlockedHintLevel = targetLevel;
    }

    let hints = p.hints || [];
    let text = "";
    
    if (targetLevel === 1) {
        text = `【ヒント1：まずはここを見てにゃ】\n${hints[0] || "ヒントが見つからないにゃ..."}`;
        p.currentHintLevel = 2;
    } else if (targetLevel === 2) {
        text = `【ヒント2：考え方のコツだにゃ】\n${hints[1] || hints[0] || "ヒントが見つからないにゃ..."}`;
        p.currentHintLevel = 3;
    } else {
        text = `【ヒント3：もう答えはすぐそこだにゃ！】\n${hints[2] || hints[1] || "ヒントが見つからないにゃ..."}`;
        p.currentHintLevel = 1; 
    }

    updateNellMessage(text, "thinking");
    const hl = document.getElementById('hint-step-label'); 
    if(hl) hl.innerText = `ヒント Lv.${targetLevel}`; 
    
    const nextBtn = document.getElementById('next-hint-btn');
    if (nextBtn) {
        let nextLvl = p.currentHintLevel; 
        if (nextLvl > p.maxUnlockedHintLevel) {
             nextBtn.innerText = "🍖 さらに5個あげてヒント！";
        } else {
             nextBtn.innerText = `ヒント${nextLvl}を見る (済)`;
        }
    }

    const revealBtn = document.getElementById('reveal-answer-btn');
    if (p.maxUnlockedHintLevel >= 3 && revealBtn) {
        revealBtn.classList.remove('hidden'); 
        revealBtn.innerText = "答えを見る"; 
        revealBtn.onclick = window.revealAnswer;
    }
};

window.revealAnswer = function() {
    const ansArea = document.getElementById('answer-display-area'); const finalTxt = document.getElementById('final-answer-text');
    const revealBtn = document.getElementById('reveal-answer-btn');
    if (ansArea && finalTxt) { finalTxt.innerText = selectedProblem.correct_answer; ansArea.classList.remove('hidden'); ansArea.style.display = "block"; }
    if (revealBtn) { revealBtn.classList.add('hidden'); }
    updateNellMessage(`答えは「${selectedProblem.correct_answer}」だにゃ！`, "gentle"); 
};

// --- リスト生成 (共通) ---
function createProblemItem(p, mode) {
    const isGradeMode = (mode === 'grade');
    
    let markHtml = "";
    let bgStyle = "background:white;";
    
    if (isGradeMode) {
        let isCorrect = p.is_correct;
        if (isCorrect === undefined) { 
            const s = String(p.student_answer || "").trim(); 
            const c = String(p.correct_answer || "").trim(); 
            isCorrect = (s !== "" && s === c); 
        }
        const mark = isCorrect ? "⭕" : "❌"; 
        const markColor = isCorrect ? "#ff5252" : "#4a90e2"; 
        bgStyle = isCorrect ? "background:#fff5f5;" : "background:#f0f8ff;";
        markHtml = `<div id="mark-${p.id}" style="font-weight:900; color:${markColor}; font-size:2rem; width:50px; text-align:center; flex-shrink:0;">${mark}</div>`;
    } else {
        markHtml = `<div id="mark-${p.id}" style="font-weight:900; color:#4a90e2; font-size:2rem; width:50px; text-align:center; flex-shrink:0;"></div>`;
    }

    const correctAnswers = String(p.correct_answer || "").split(/,|、/).map(s => s.trim()).filter(s => s);
    const studentAnswers = String(p.student_answer || "").split(/,|、/).map(s => s.trim()); 
    let inputHtml = "";
    
    if (correctAnswers.length > 1) {
        inputHtml = `<div style="display:grid; grid-template-columns: 1fr 1fr; gap:5px; width:100%;">`;
        for (let i = 0; i < correctAnswers.length; i++) {
            let val = studentAnswers[i] || "";
            const onInput = isGradeMode ? `oninput="checkMultiAnswer(${p.id})"` : "";
            inputHtml += `<input type="text" value="${val}" class="multi-input-${p.id}" ${onInput} style="width:100%; padding:8px; border:2px solid #ddd; border-radius:8px; font-size:1rem; font-weight:bold; color:#333; min-width:0; box-sizing:border-box;">`;
        }
        inputHtml += `</div>`;
    } else {
        const onInput = isGradeMode ? `oninput="checkAnswerDynamically(${p.id}, this)"` : "";
        const idAttr = isGradeMode ? "" : `id="single-input-${p.id}"`;
        inputHtml = `<div style="width:100%;">
            <input type="text" ${idAttr} value="${p.student_answer || ""}" ${onInput} style="width:100%; padding:8px; border:2px solid #ddd; border-radius:8px; font-size:1rem; font-weight:bold; color:#333; box-sizing:border-box;">
        </div>`;
    }

    let buttonsHtml = "";
    if (isGradeMode) {
        buttonsHtml = `<div style="display:flex; flex-direction:column; gap:5px; width:80px; flex-shrink:0; justify-content:center; margin-left:auto;">
            <button class="mini-teach-btn" onclick="startHint(${p.id})" style="width:100%;">教えて</button>
        </div>`;
    } else {
        buttonsHtml = `<div style="display:flex; flex-direction:column; gap:5px; width:80px; flex-shrink:0; margin-left:auto;">
            <button class="mini-teach-btn" onclick="checkOneProblem(${p.id})" style="background:#ff85a1; width:100%;">採点</button>
            <button class="mini-teach-btn" onclick="startHint(${p.id})" style="width:100%;">教えて</button>
        </div>`;
    }

    const div = document.createElement('div'); 
    div.className = "grade-item"; 
    div.id = `grade-item-${p.id}`; 
    div.style.cssText = `border-bottom:1px solid #eee; padding:15px; margin-bottom:10px; border-radius:10px; ${bgStyle}`; 
    
    div.innerHTML = `
        <div style="display:flex; align-items:center; width:100%;">
            ${markHtml}
            <div style="flex:1; margin-left:10px; display:flex; flex-direction:column; min-width:0;">
                <div style="font-size:0.9rem; color:#888; margin-bottom:4px;">${p.label || '問'}</div>
                <div style="font-weight:bold; font-size:0.9rem; margin-bottom:8px; width:100%; word-break:break-all;">${p.question}</div>
                <div style="display:flex; gap:10px; align-items:flex-start; width:100%; justify-content:space-between;">
                    <div style="flex:1; min-width:0; margin-right:5px;">
                        ${inputHtml}
                        <div style="font-size:0.7rem; color:#666; margin-top:4px;">キミの答え (直せるよ)</div>
                    </div>
                    ${buttonsHtml}
                </div>
            </div>
        </div>`; 
    return div;
}

window.showGradingView = function(silent = false) { 
    document.getElementById('problem-selection-view').classList.add('hidden'); 
    document.getElementById('final-view').classList.remove('hidden'); 
    document.getElementById('grade-sheet-container').classList.remove('hidden'); 
    document.getElementById('hint-detail-container').classList.add('hidden'); 
    
    const container = document.getElementById('problem-list-grade'); 
    container.innerHTML = ""; 
    
    transcribedProblems.forEach(p => { 
        container.appendChild(createProblemItem(p, 'grade'));
    });
    
    const btnDiv = document.createElement('div'); 
    btnDiv.style.textAlign = "center"; 
    btnDiv.style.marginTop = "20px"; 
    btnDiv.innerHTML = `<button onclick="finishGrading(this)" class="main-btn orange-btn">💯 採点おわり！</button>`; 
    container.appendChild(btnDiv); 
    
    if (!silent) { updateGradingMessage(); } 
};

window.renderProblemSelection = function() { 
    document.getElementById('problem-selection-view').classList.remove('hidden'); 
    const l = document.getElementById('transcribed-problem-list'); l.innerHTML = ""; 
    
    transcribedProblems.forEach(p => { 
        l.appendChild(createProblemItem(p, 'explain'));
    });
    
    const btn = document.querySelector('#problem-selection-view button.orange-btn'); 
    if (btn) { btn.disabled = false; btn.innerText = "✨ ぜんぶわかったにゃ！"; } 
};

// --- 採点ロジック ---

function normalizeAnswer(str) {
    if (!str) return "";
    let normalized = str.trim().replace(/[\u30a1-\u30f6]/g, function(match) {
        var chr = match.charCodeAt(0) - 0x60;
        return String.fromCharCode(chr);
    });
    return normalized;
}

function isMatch(student, correctString) {
    const s = normalizeAnswer(student);
    const options = normalizeAnswer(correctString).split('|'); 
    return options.some(opt => opt === s);
}

window.checkMultiAnswer = function(id) {
    const problem = transcribedProblems.find(p => p.id === id);
    if (!problem) return;

    const inputs = document.querySelectorAll(`.multi-input-${id}`);
    const userValues = Array.from(inputs).map(input => input.value);
    
    problem.student_answer = userValues.join(",");
    
    const correctList = String(problem.correct_answer || "").split(/,|、/);
    
    if (userValues.length !== correctList.length) {
        problem.is_correct = false;
    } else {
        const usedIndices = new Set();
        let matchCount = 0;

        for (const uVal of userValues) {
            for (let i = 0; i < correctList.length; i++) {
                if (!usedIndices.has(i)) {
                    if (isMatch(uVal, correctList[i])) {
                        usedIndices.add(i);
                        matchCount++;
                        break; 
                    }
                }
            }
        }
        problem.is_correct = (matchCount === correctList.length);
    }
    
    updateMarkDisplay(id, problem.is_correct);
    if (currentMode === 'grade') updateGradingMessage();
};

window.checkAnswerDynamically = function(id, inputElem) { 
    const newVal = inputElem.value; 
    const problem = transcribedProblems.find(p => p.id === id); 
    if (!problem) return; 
    
    problem.student_answer = String(newVal); 
    const isCorrect = isMatch(newVal, String(problem.correct_answer || ""));
    
    problem.is_correct = isCorrect; 
    updateMarkDisplay(id, isCorrect);
    if (currentMode === 'grade') updateGradingMessage(); 
};

window.checkOneProblem = function(id) {
    const problem = transcribedProblems.find(p => p.id === id);
    if (!problem) return;

    const correctList = String(problem.correct_answer || "").split(/,|、/);
    let userValues = [];

    if (correctList.length > 1) {
        const inputs = document.querySelectorAll(`.multi-input-${id}`);
        userValues = Array.from(inputs).map(i => i.value);
    } else {
        const input = document.getElementById(`single-input-${id}`);
        if(input) userValues = [input.value];
    }

    let isCorrect = true;
    if (userValues.length !== correctList.length) {
        isCorrect = false;
    } else {
        const usedIndices = new Set();
        let matchCount = 0;
        for (const uVal of userValues) {
            for (let i = 0; i < correctList.length; i++) {
                if (!usedIndices.has(i)) {
                    if (isMatch(uVal, correctList[i])) {
                        usedIndices.add(i);
                        matchCount++;
                        break;
                    }
                }
            }
        }
        isCorrect = (matchCount === correctList.length);
    }

    const markElem = document.getElementById(`mark-${id}`);
    const container = document.getElementById(`grade-item-${id}`);
    
    if (markElem && container) {
        if (isCorrect) {
            markElem.innerText = "⭕";
            markElem.style.color = "#ff5252";
            container.style.backgroundColor = "#fff5f5";
            updateNellMessage("正解だにゃ！すごいにゃ！", "excited");
        } else {
            markElem.innerText = "❌";
            markElem.style.color = "#4a90e2";
            container.style.backgroundColor = "#f0f8ff";
            updateNellMessage("おしい！もう一回考えてみて！", "gentle");
        }
    }
};

function updateMarkDisplay(id, isCorrect) {
    const container = document.getElementById(`grade-item-${id}`); 
    const markElem = document.getElementById(`mark-${id}`); 
    if (container && markElem) { 
        if (isCorrect) { 
            markElem.innerText = "⭕"; 
            markElem.style.color = "#ff5252"; 
            container.style.backgroundColor = "#fff5f5"; 
        } else { 
            markElem.innerText = "❌"; 
            markElem.style.color = "#4a90e2"; 
            container.style.backgroundColor = "#f0f8ff"; 
        } 
    }
}

window.updateGradingMessage = function() { 
    let correctCount = 0; 
    transcribedProblems.forEach(p => { 
        if (p.is_correct) correctCount++; 
    }); 
    const scoreRate = correctCount / (transcribedProblems.length || 1); 
    if (scoreRate === 1.0) updateNellMessage(`全問正解だにゃ！天才だにゃ〜！！`, "excited"); 
    else if (scoreRate >= 0.5) updateNellMessage(`あと${transcribedProblems.length - correctCount}問！直してみるにゃ！`, "happy"); 
    else updateNellMessage(`間違ってても大丈夫！入力し直してみて！`, "gentle"); 
};

// ... (以下略、変更なし)
window.backToProblemSelection = function() { document.getElementById('final-view').classList.add('hidden'); document.getElementById('hint-detail-container').classList.add('hidden'); document.getElementById('chalkboard').classList.add('hidden'); document.getElementById('answer-display-area').classList.add('hidden'); if (currentMode === 'grade') showGradingView(); else { renderProblemSelection(); updateNellMessage("他も見るにゃ？", "normal"); } const backBtn = document.getElementById('main-back-btn'); if(backBtn) { backBtn.classList.remove('hidden'); backBtn.onclick = backToLobby; } };
window.pressThanks = function() { window.backToProblemSelection(); };
window.finishGrading = async function(btnElement) { if(btnElement) { btnElement.disabled = true; btnElement.innerText = "採点完了！"; } if (currentUser) { currentUser.karikari += 100; saveAndSync(); updateMiniKarikari(); showKarikariEffect(100); } await updateNellMessage("よくがんばったにゃ！カリカリ100個あげる！", "excited"); setTimeout(() => { if(typeof backToLobby === 'function') backToLobby(true); }, 3000); };
window.pressAllSolved = function(btnElement) { if(btnElement) { btnElement.disabled = true; btnElement.innerText = "すごい！"; } if (currentUser) { currentUser.karikari += 100; saveAndSync(); showKarikariEffect(100); updateMiniKarikari(); updateNellMessage("よくがんばったにゃ！カリカリ100個あげるにゃ！", "excited").then(() => { setTimeout(() => { if(typeof backToLobby === 'function') backToLobby(true); }, 3000); }); } };
window.renderMistakeSelection = function() { if (!currentUser.mistakes || currentUser.mistakes.length === 0) { updateNellMessage("ノートは空っぽにゃ！", "happy"); setTimeout(backToLobby, 2000); return; } transcribedProblems = currentUser.mistakes; renderProblemSelection(); updateNellMessage("復習するにゃ？", "excited"); };
window.giveLunch = function() { if (currentUser.karikari < 1) return updateNellMessage("カリカリがないにゃ……", "thinking"); updateNellMessage("もぐもぐ……", "normal"); currentUser.karikari--; if(typeof saveAndSync === 'function') saveAndSync(); updateMiniKarikari(); showKarikariEffect(-1); lunchCount++; fetch('/lunch-reaction', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count: lunchCount, name: currentUser.name }) }).then(r => r.json()).then(d => { setTimeout(() => { updateNellMessage(d.reply || "おいしいにゃ！", d.isSpecial ? "excited" : "happy"); }, 1500); }).catch(e => { setTimeout(() => { updateNellMessage("おいしいにゃ！", "happy"); }, 1500); }); };
window.showGame = function() { switchScreen('screen-game'); document.getElementById('mini-karikari-display').classList.remove('hidden'); updateMiniKarikari(); initGame(); fetchGameComment("start"); const startBtn = document.getElementById('start-game-btn'); if (startBtn) { const newBtn = startBtn.cloneNode(true); startBtn.parentNode.replaceChild(newBtn, startBtn); newBtn.onclick = () => { if (!gameRunning) { initGame(); gameRunning = true; newBtn.disabled = true; drawGame(); } }; } };
function fetchGameComment(type, score=0) { fetch('/game-reaction', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, name: currentUser.name, score }) }).then(r=>r.json()).then(d=>{ updateNellMessage(d.reply, d.mood || "excited"); }).catch(e=>{}); }
function initGame() { gameCanvas = document.getElementById('game-canvas'); if(!gameCanvas) return; ctx = gameCanvas.getContext('2d'); paddle = { w: 80, h: 10, x: 120, speed: 7 }; ball = { x: 160, y: 350, dx: 3, dy: -3, r: 8 }; score = 0; document.getElementById('game-score').innerText = score; bricks = []; for(let c=0; c<5; c++) for(let r=0; r<4; r++) bricks.push({ x: c*64+10, y: r*35+40, status: 1 }); gameCanvas.removeEventListener("mousemove", movePaddle); gameCanvas.removeEventListener("touchmove", touchPaddle); gameCanvas.addEventListener("mousemove", movePaddle, false); gameCanvas.addEventListener("touchmove", touchPaddle, { passive: false }); }
function movePaddle(e) { const rect = gameCanvas.getBoundingClientRect(); const scaleX = gameCanvas.width / rect.width; const rx = (e.clientX - rect.left) * scaleX; if(rx > 0 && rx < gameCanvas.width) paddle.x = rx - paddle.w/2; }
function touchPaddle(e) { e.preventDefault(); const rect = gameCanvas.getBoundingClientRect(); const scaleX = gameCanvas.width / rect.width; const rx = (e.touches[0].clientX - rect.left) * scaleX; if(rx > 0 && rx < gameCanvas.width) paddle.x = rx - paddle.w/2; }
function drawGame() { if (!gameRunning) return; ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height); ctx.font = "20px serif"; bricks.forEach(b => { if(b.status === 1) ctx.fillText("🍖", b.x + 10, b.y + 20); }); ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI*2); ctx.fillStyle = "#ff85a1"; ctx.fill(); ctx.closePath(); ctx.fillStyle = "#4a90e2"; ctx.fillRect(paddle.x, gameCanvas.height - paddle.h - 10, paddle.w, paddle.h); bricks.forEach(b => { if(b.status === 1 && ball.x>b.x && ball.x<b.x+40 && ball.y>b.y && ball.y<b.y+30){ ball.dy*=-1; b.status=0; score++; document.getElementById('game-score').innerText=score; try { sfxHit.currentTime=0; sfxHit.play(); } catch(e){} if (Math.random() > 0.7 && !window.isNellSpeaking) { updateNellMessage(gameHitComments[Math.floor(Math.random() * gameHitComments.length)], "excited"); } if(score===bricks.length) { endGame(true); return; } } }); if(ball.x+ball.dx > gameCanvas.width-ball.r || ball.x+ball.dx < ball.r) ball.dx *= -1; if(ball.y+ball.dy < ball.r) ball.dy *= -1; else if(ball.y+ball.dy > gameCanvas.height - ball.r - 20) { if(ball.x > paddle.x && ball.x < paddle.x + paddle.w) { ball.dy *= -1; ball.dx = (ball.x - (paddle.x+paddle.w/2)) * 0.15; try { sfxPaddle.currentTime = 0; sfxPaddle.play(); } catch(e){} } else if(ball.y+ball.dy > gameCanvas.height-ball.r) { try { sfxOver.currentTime=0; sfxOver.play(); } catch(e){} endGame(false); return; } } ball.x += ball.dx; ball.y += ball.dy; gameAnimId = requestAnimationFrame(drawGame); }
function endGame(c) { gameRunning = false; if(gameAnimId)cancelAnimationFrame(gameAnimId); fetchGameComment("end", score); const s=document.getElementById('start-game-btn'); if(s){s.disabled=false;s.innerText="もう一回！";} setTimeout(()=>{ alert(c?`すごい！全クリだにゃ！\nカリカリ ${score} 個ゲット！`:`おしい！\nカリカリ ${score} 個ゲット！`); if(currentUser&&score>0){currentUser.karikari+=score;if(typeof saveAndSync==='function')saveAndSync();updateMiniKarikari();showKarikariEffect(score);} }, 500); }
async function startLiveChat() { const btn = document.getElementById('mic-btn'); if (liveSocket) { stopLiveChat(); return; } try { updateNellMessage("ネル先生を呼んでるにゃ…", "thinking"); if(btn) btn.disabled = true; chatTranscript = ""; if (window.initAudioContext) await window.initAudioContext(); audioContext = new (window.AudioContext || window.webkitAudioContext)(); await audioContext.resume(); nextStartTime = audioContext.currentTime; const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:'; let savedHistory = []; if (currentUser.isGoogleUser && typeof db !== 'undefined' && db !== null) { try { const doc = await db.collection("memories").doc(currentUser.id).get(); if (doc.exists) savedHistory = doc.data().history || []; } catch(e) {} } if (savedHistory.length === 0) { const memoryKey = `nell_raw_chat_log_${currentUser.id}`; savedHistory = JSON.parse(localStorage.getItem(memoryKey) || '[]'); } const historySummary = savedHistory.slice(-15).map(m => `- ${m.role === 'user' ? 'キミ' : 'ネル'}: ${m.text}`).join('\n'); let statusSummary = `${currentUser.name}さんは今、お話しにきたにゃ。カリカリは${currentUser.karikari}個持ってるにゃ。`; if (historySummary) { statusSummary += `\n【直近の思い出】\n${historySummary}`; } const url = `${wsProto}//${location.host}?grade=${currentUser.grade}&name=${encodeURIComponent(currentUser.name)}&context=${encodeURIComponent(statusSummary)}`; liveSocket = new WebSocket(url); liveSocket.binaryType = "blob"; connectionTimeout = setTimeout(() => { if (liveSocket && liveSocket.readyState !== WebSocket.OPEN) { updateNellMessage("なかなかつながらないにゃ…", "thinking"); stopLiveChat(); } }, 10000); liveSocket.onopen = () => { clearTimeout(connectionTimeout); if(btn) { btn.innerText = "📞 つながった！(終了)"; btn.style.background = "#ff5252"; btn.disabled = false; } updateNellMessage("お待たせ！なんでも話してにゃ！", "happy"); isRecognitionActive = true; startMicrophone(); }; liveSocket.onmessage = async (event) => { try { let data = event.data instanceof Blob ? JSON.parse(await event.data.text()) : JSON.parse(event.data); if (data.serverContent?.modelTurn?.parts) { data.serverContent.modelTurn.parts.forEach(p => { if (p.inlineData) playLivePcmAudio(p.inlineData.data); if (p.text) { saveToNellMemory('nell', p.text); const el = document.getElementById('nell-text'); if(el) el.innerText = p.text; } }); } } catch (e) {} }; liveSocket.onclose = () => stopLiveChat(); liveSocket.onerror = () => stopLiveChat(); } catch (e) { stopLiveChat(); } }
function stopLiveChat() { isRecognitionActive = false; if (connectionTimeout) clearTimeout(connectionTimeout); if (recognition) try{recognition.stop()}catch(e){} if (mediaStream) mediaStream.getTracks().forEach(t=>t.stop()); if (workletNode) { workletNode.port.postMessage('stop'); workletNode.disconnect(); } if (liveSocket) liveSocket.close(); if (audioContext) audioContext.close(); window.isNellSpeaking = false; if(stopSpeakingTimer) clearTimeout(stopSpeakingTimer); if(speakingStartTimer) clearTimeout(speakingStartTimer); const btn = document.getElementById('mic-btn'); if (btn) { btn.innerText = "🎤 おはなしする"; btn.style.background = "#ff85a1"; btn.disabled = false; btn.onclick = startLiveChat; } liveSocket = null; }
async function startMicrophone() { try { if ('webkitSpeechRecognition' in window) { recognition = new webkitSpeechRecognition(); recognition.continuous = true; recognition.interimResults = true; recognition.lang = 'ja-JP'; recognition.onresult = (event) => { let interim = ''; for (let i = event.resultIndex; i < event.results.length; ++i) { if (event.results[i].isFinal) { saveToNellMemory('user', event.results[i][0].transcript); const el = document.getElementById('user-speech-text'); if(el) el.innerText = event.results[i][0].transcript; } else interim += event.results[i][0].transcript; } }; recognition.onend = () => { if (isRecognitionActive && liveSocket && liveSocket.readyState === WebSocket.OPEN) try{recognition.start()}catch(e){} }; recognition.start(); } mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } }); const processorCode = `class PcmProcessor extends AudioWorkletProcessor { constructor() { super(); this.bufferSize = 2048; this.buffer = new Float32Array(this.bufferSize); this.index = 0; } process(inputs, outputs, parameters) { const input = inputs[0]; if (input.length > 0) { const channel = input[0]; for (let i = 0; i < channel.length; i++) { this.buffer[this.index++] = channel[i]; if (this.index >= this.bufferSize) { this.port.postMessage(this.buffer); this.index = 0; } } } return true; } } registerProcessor('pcm-processor', PcmProcessor);`; const blob = new Blob([processorCode], { type: 'application/javascript' }); await audioContext.audioWorklet.addModule(URL.createObjectURL(blob)); const source = audioContext.createMediaStreamSource(mediaStream); workletNode = new AudioWorkletNode(audioContext, 'pcm-processor'); source.connect(workletNode); workletNode.port.onmessage = (event) => { if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) return; const downsampled = downsampleBuffer(event.data, audioContext.sampleRate, 16000); liveSocket.send(JSON.stringify({ base64Audio: arrayBufferToBase64(floatTo16BitPCM(downsampled)) })); }; } catch(e){} }
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