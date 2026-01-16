// --- anlyze.js (完全版 v118.0: 動作修復 & サーバー連携修正) ---

// グローバル変数の初期化
window.transcribedProblems = []; 
window.selectedProblem = null; 
window.hintIndex = 0; 
window.isAnalyzing = false; 
window.currentSubject = '';
window.currentMode = ''; 
window.lunchCount = 0; 
window.analysisType = 'precision';

// 変数定義
let liveSocket = null;
let audioContext = null;
let mediaStream = null;
let workletNode = null;
let isRecognitionActive = false;
let recognition = null;
let connectionTimeout = null;

// ゲーム用変数
let gameCanvas, ctx, ball, paddle, bricks, score, gameRunning = false, gameAnimId = null;
const gameHitComments = ["うまいにゃ！", "すごいにゃ！", "さすがにゃ！", "がんばれにゃ！"];

// クロップ用変数
let cropImg = new Image();
let cropPoints = [];
let activeHandle = -1;

// 効果音
const sfxBori = new Audio('boribori.mp3');
const sfxHit = new Audio('cat1c.mp3');
const sfxPaddle = new Audio('poka02.mp3'); 
const sfxOver = new Audio('gameover.mp3');
const sfxBunseki = new Audio('bunseki.mp3'); 
sfxBunseki.volume = 0.1;
sfxBunseki.loop = true;
const bgmApp = new Audio('bgm.mp3'); 
bgmApp.loop = true; 
bgmApp.volume = 0.2;

// 画像アセット
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

// --- 記憶システム (断捨離フィルター) ---
async function saveToNellMemory(role, text) {
    if (!currentUser || !currentUser.id) return;

    const trimmed = text.trim();
    const ignoreWords = ["あー", "えーと", "うーん", "あのー", "はい", "へぇ", "にゃ", "にゃー", "ネル先生", "。"];
    
    // 2文字以下、または相槌リストに含まれるなら覚えない
    if (trimmed.length <= 2 || ignoreWords.includes(trimmed)) return;

    const newItem = { role, text: trimmed, time: new Date().toISOString() };
    const memoryKey = `nell_raw_chat_log_${currentUser.id}`;
    let history = JSON.parse(localStorage.getItem(memoryKey) || '[]');
    
    // 重複チェック
    if (history.length > 0 && history[history.length - 1].text === trimmed) return;

    history.push(newItem);
    if (history.length > 50) history.shift();
    localStorage.setItem(memoryKey, JSON.stringify(history));

    if (currentUser.isGoogleUser && typeof db !== 'undefined') {
        try {
            await db.collection("memories").doc(currentUser.id).set({ history, lastUpdated: new Date().toISOString() }, { merge: true });
        } catch(e) { console.error(e); }
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
    if (!t || t.includes("ちょっと待ってて") || t.includes("もぐもぐ")) return;

    saveToNellMemory('nell', t);

    // 音声合成
    if (typeof fetch === 'function') {
        try {
            // server.js v117.0 の /synthesize を呼ぶ
            const res = await fetch('/synthesize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: t.replace(/🐾/g, ""), mood })
            });
            if(res.ok) {
                const data = await res.json();
                playAudioBase64(data.audioContent);
            }
        } catch(e) {}
    }
};

function playAudioBase64(base64) {
    if (!window.audioContext) window.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    window.audioContext.decodeAudioData(bytes.buffer, buffer => {
        const source = window.audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(window.audioContext.destination);
        source.start(0);
        window.isNellSpeaking = true;
        source.onended = () => { window.isNellSpeaking = false; };
    });
}

// --- モード選択 (画面遷移) ---
window.selectMode = function(m) {
    console.log("selectMode:", m);
    currentMode = m; 
    
    if (typeof switchScreen === 'function') switchScreen('screen-main'); 
    
    // 画面初期化
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
        const btn = document.getElementById('mic-btn');
        if(btn) { btn.innerText = "🎤 おはなしする"; btn.onclick = startLiveChat; btn.disabled = false; btn.style.background = "#ff85a1"; btn.style.boxShadow = "none"; }
    } else if (m === 'lunch') {
        document.getElementById('lunch-view').classList.remove('hidden'); 
        updateNellMessage("お腹ペコペコだにゃ……", "thinking");
    } else if (m === 'review') { 
        renderMistakeSelection(); 
    } else { 
        // 教えて・採点
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
        btnFast.onclick = () => window.handleFileUploadClick();
        
        // 既存のイベントリスナー削除のためクローン
        const newBtn = btnFast.cloneNode(true);
        btnFast.parentNode.replaceChild(newBtn, btnFast);
        newBtn.onclick = () => document.getElementById('hw-input-camera').click();
    }
    if (btnPrec) btnPrec.style.display = "none";
};

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
    })
    .then(r => r.json())
    .then(d => { setTimeout(() => { updateNellMessage(d.reply, d.isSpecial ? "excited" : "happy"); }, 1500); })
    .catch(e => {});
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

// --- 分析処理 (v117対応: 高速&高精度) ---
window.handleFileUpload = async (file) => {
    if (isAnalyzing || !file) return;
    
    // UI準備
    document.getElementById('upload-controls').classList.add('hidden');
    const cropperModal = document.getElementById('cropper-modal');
    cropperModal.classList.remove('hidden');
    
    const canvas = document.getElementById('crop-canvas'); 
    if(canvas) canvas.style.opacity = '0';
    
    // ローダー表示
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

// --- クロップ機能 ---
function initCustomCropper() {
    const modal = document.getElementById('cropper-modal');
    const canvas = document.getElementById('crop-canvas');
    
    const MAX_CANVAS_SIZE = 2500;
    let w = cropImg.width;
    let h = cropImg.height;
    if (w > MAX_CANVAS_SIZE || h > MAX_CANVAS_SIZE) {
        const scale = Math.min(MAX_CANVAS_SIZE / w, MAX_CANVAS_SIZE / h);
        w *= scale; h *= scale;
        cropPoints = cropPoints.map(p => ({ x: p.x * scale, y: p.y * scale }));
    }
    canvas.width = w; 
    canvas.height = h; 
    canvas.style.width = '100%'; 
    canvas.style.height = '100%'; 
    canvas.style.objectFit = 'contain';
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(cropImg, 0, 0, w, h);
    updateCropUI(canvas);
    
    // イベント登録
    const setupHandlers = () => {
        const handles = ['handle-tl', 'handle-tr', 'handle-br', 'handle-bl'];
        handles.forEach((id, idx) => {
            const el = document.getElementById(id);
            const startDrag = (e) => { e.preventDefault(); activeHandle = idx; };
            el.onmousedown = startDrag; el.ontouchstart = startDrag;
        });
    };
    setupHandlers();

    const move = (e) => {
        if (activeHandle === -1) return;
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const imgRatio = canvas.width / canvas.height;
        const rectRatio = rect.width / rect.height;
        let drawX, drawY, drawW, drawH;
        if (imgRatio > rectRatio) {
            drawW = rect.width; drawH = rect.width / imgRatio; drawX = 0; drawY = (rect.height - drawH) / 2;
        } else {
            drawH = rect.height; drawW = rect.height * imgRatio; drawY = 0; drawX = (rect.width - drawW) / 2;
        }
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        let relX = (clientX - rect.left - drawX) / drawW;
        let relY = (clientY - rect.top - drawY) / drawH;
        relX = Math.max(0, Math.min(1, relX));
        relY = Math.max(0, Math.min(1, relY));
        cropPoints[activeHandle] = { x: relX * canvas.width, y: relY * canvas.height };
        updateCropUI(canvas);
    };
    
    const end = () => { activeHandle = -1; };
    window.onmousemove = move; window.ontouchmove = move;
    window.onmouseup = end; window.ontouchend = end;

    document.getElementById('cropper-cancel-btn').onclick = () => {
        modal.classList.add('hidden');
        document.getElementById('upload-controls').classList.remove('hidden');
    };
    document.getElementById('cropper-ok-btn').onclick = () => {
        modal.classList.add('hidden');
        const croppedBase64 = performPerspectiveCrop(canvas, cropPoints);
        startAnalysis(croppedBase64);
    };
}

function updateCropUI(canvas) {
    const toScreen = (p) => {
        const rect = canvas.getBoundingClientRect();
        const imgRatio = canvas.width / canvas.height;
        const rectRatio = rect.width / rect.height;
        let drawX, drawY, drawW, drawH;
        if (imgRatio > rectRatio) {
            drawW = rect.width; drawH = rect.width / imgRatio; drawX = 0; drawY = (rect.height - drawH) / 2;
        } else {
            drawH = rect.height; drawW = rect.height * imgRatio; drawY = 0; drawX = (rect.width - drawW) / 2;
        }
        return {
            x: (p.x / canvas.width) * drawW + drawX + canvas.offsetLeft,
            y: (p.y / canvas.height) * drawH + drawY + canvas.offsetTop
        };
    };
    
    const screenPoints = cropPoints.map(toScreen);
    const handles = ['handle-tl', 'handle-tr', 'handle-br', 'handle-bl'];
    handles.forEach((id, i) => {
        const el = document.getElementById(id);
        el.style.left = screenPoints[i].x + 'px';
        el.style.top = screenPoints[i].y + 'px';
    });
    
    const svg = document.getElementById('crop-lines');
    // SVGの描画は簡易的に省略せず実装
    const ptsStr = screenPoints.map(p => `${p.x - canvas.offsetLeft},${p.y - canvas.offsetTop}`).join(' ');
    svg.innerHTML = `<polyline points="${ptsStr} ${screenPoints[0].x - canvas.offsetLeft},${screenPoints[0].y - canvas.offsetTop}" style="fill:rgba(255,255,255,0.2);stroke:#ff4081;stroke-width:2;stroke-dasharray:5" />`;
}

function performPerspectiveCrop(sourceCanvas, points) {
    // 簡易的な矩形切り出し（パースペクティブ補正は複雑なため矩形で代用）
    const minX = Math.min(...points.map(p => p.x));
    const minY = Math.min(...points.map(p => p.y));
    const width = Math.max(...points.map(p => p.x)) - minX;
    const height = Math.max(...points.map(p => p.y)) - minY;
    
    const tempCv = document.createElement('canvas');
    tempCv.width = width;
    tempCv.height = height;
    const ctx = tempCv.getContext('2d');
    ctx.drawImage(sourceCanvas, minX, minY, width, height, 0, 0, width, height);
    return tempCv.toDataURL('image/jpeg', 0.85).split(',')[1];
}

// --- 分析実行 ---
async function startAnalysis(b64) {
    isAnalyzing = true;
    document.getElementById('thinking-view').classList.remove('hidden');
    
    // BGM & 演出
    try { sfxBunseki.currentTime = 0; sfxBunseki.play(); } catch(e){}
    bgmApp.play().catch(()=>{});
    
    updateNellMessage("じーっと見て、問題を書き写してるにゃ...", "thinking");
    updateProgress(0);
    
    // プログレスバー
    let p = 0;
    const timer = setInterval(() => { if(p < 95) { p+=1; updateProgress(p); } }, 100);

    try {
        const res = await fetch('/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image: b64,
                grade: currentUser.grade,
                name: currentUser.name,
                subject: currentSubject,
                mode: currentMode
            })
        });
        
        if (!res.ok) throw new Error("Server Error");
        const data = await res.json();
        
        // サーバーv117のレスポンス形式に対応 (problems配列)
        transcribedProblems = (data.problems || []).map(p => ({
            id: p.id,
            label: p.label,
            question: p.question,
            correct_answer: p.correctAnswer, // camelCase対応
            student_answer: p.studentAnswer || "", 
            hints: [p.hint1, p.hint2, p.hint3].filter(h=>h),
            isCorrect: p.isCorrect
        }));

        clearInterval(timer);
        updateProgress(100);
        
        setTimeout(() => {
            document.getElementById('thinking-view').classList.add('hidden');
            sfxBunseki.pause();
            
            if (transcribedProblems.length > 0) {
                if (currentMode === 'grade') showGradingView(true);
                else renderProblemSelection();
                updateNellMessage("読めたにゃ！", "happy");
            } else {
                updateNellMessage("うまく読めなかったにゃ...", "sad");
                document.getElementById('upload-controls').classList.remove('hidden');
            }
        }, 1000);

    } catch (e) {
        clearInterval(timer);
        sfxBunseki.pause();
        updateNellMessage("エラーだにゃ...", "sad");
        document.getElementById('thinking-view').classList.add('hidden');
        document.getElementById('upload-controls').classList.remove('hidden');
        console.error(e);
    } finally {
        isAnalyzing = false;
    }
}

// --- リスト表示 (共通) ---
function renderProblemSelection() {
    document.getElementById('problem-selection-view').classList.remove('hidden');
    const l = document.getElementById('transcribed-problem-list');
    l.innerHTML = "";
    
    transcribedProblems.forEach(p => {
        const div = document.createElement('div');
        div.className = "grade-item";
        div.style.cssText = `border-bottom:1px solid #eee; padding:15px; margin-bottom:10px; border-radius:10px; background:white; box-shadow: 0 2px 5px rgba(0,0,0,0.05);`;
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div style="font-weight:900; color:#4a90e2; font-size:1.5rem; width:50px; text-align:center;">${p.label}</div>
                <div style="flex:1; margin-left:10px;">
                    <div style="font-weight:bold; font-size:0.9rem; margin-bottom:8px; color:#333;">${p.question}</div>
                    <div style="display:flex; justify-content:flex-end; align-items:center; gap:10px; width:100%;">
                        <div style="flex:1;"><input type="text" placeholder="メモ" value="${p.student_answer}" style="width:100%; padding:8px; border:2px solid #f0f0f0; border-radius:8px; font-size:0.9rem;"></div>
                        <div style="width:80px; text-align:right; flex-shrink:0;"><button class="mini-teach-btn" onclick="startHint(${p.id})">教えて</button></div>
                    </div>
                </div>
            </div>`;
        l.appendChild(div);
    });
}

function showGradingView(silent = false) {
    document.getElementById('grade-sheet-container').classList.remove('hidden');
    document.getElementById('final-view').classList.remove('hidden');
    const container = document.getElementById('problem-list-grade');
    container.innerHTML = "";
    
    transcribedProblems.forEach(p => {
        const mark = p.isCorrect ? "⭕" : "❌";
        const color = p.isCorrect ? "#ff5252" : "#4a90e2";
        const div = document.createElement('div');
        div.className = "grade-item";
        div.innerHTML = `
            <div style="display:flex; align-items:center;">
                <div style="font-weight:900; color:${color}; font-size:2rem; width:50px; text-align:center;">${mark}</div>
                <div style="flex:1; margin-left:10px;">
                    <div style="font-size:0.9rem; font-weight:bold;">${p.question}</div>
                    <div style="display:flex; gap:10px; margin-top:5px;">
                        <div style="flex:1; color:#666;">キミの答え: <b>${p.student_answer}</b></div>
                        <button class="mini-teach-btn" onclick="startHint(${p.id})">教えて</button>
                    </div>
                </div>
            </div>`;
        container.appendChild(div);
    });
    
    if(!silent) updateNellMessage("採点完了だにゃ！", "excited");
}

// --- ヒント機能 ---
window.startHint = function(id) {
    selectedProblem = transcribedProblems.find(p => p.id == id);
    if (!selectedProblem) return;
    
    ['problem-selection-view', 'grade-sheet-container', 'chalkboard'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.classList.add('hidden');
    });
    
    document.getElementById('final-view').classList.remove('hidden');
    document.getElementById('hint-detail-container').classList.remove('hidden');
    const board = document.getElementById('chalkboard');
    if(board) { board.innerText = selectedProblem.question; board.classList.remove('hidden'); }
    
    hintIndex = 0;
    updateNellMessage("ヒントを出すにゃ！", "thinking");
    
    const nextBtn = document.getElementById('next-hint-btn');
    nextBtn.classList.remove('hidden');
    nextBtn.innerText = "ヒント1を見る";
    nextBtn.onclick = window.showNextHint;
    
    document.getElementById('reveal-answer-btn').classList.add('hidden');
    document.getElementById('answer-display-area').classList.add('hidden');
};

window.showNextHint = function() {
    if(!selectedProblem) return;
    const hints = selectedProblem.hints || [];
    if(hintIndex < hints.length) {
        updateNellMessage(hints[hintIndex], "thinking");
        hintIndex++;
        const nextBtn = document.getElementById('next-hint-btn');
        if(hintIndex >= hints.length) {
            nextBtn.classList.add('hidden');
            const revBtn = document.getElementById('reveal-answer-btn');
            revBtn.classList.remove('hidden');
            revBtn.innerText = "答えを見る";
            revBtn.onclick = window.revealAnswer;
        } else {
            nextBtn.innerText = `ヒント${hintIndex+1}を見る`;
        }
    }
};

window.revealAnswer = function() {
    const ansArea = document.getElementById('answer-display-area');
    const txt = document.getElementById('final-answer-text');
    txt.innerText = selectedProblem.correct_answer;
    ansArea.classList.remove('hidden');
    document.getElementById('reveal-answer-btn').classList.add('hidden');
    updateNellMessage(`正解は「${selectedProblem.correct_answer}」だにゃ！`, "gentle");
};

// --- その他イベントリスナー ---
window.addEventListener('DOMContentLoaded', () => {
    const camIn = document.getElementById('hw-input-camera');
    const albIn = document.getElementById('hw-input-album');
    if(camIn) camIn.addEventListener('change', (e) => handleFileUpload(e.target.files[0]));
    if(albIn) albIn.addEventListener('change', (e) => handleFileUpload(e.target.files[0]));
});

// Helper
window.updateProgress = function(p) {
    const bar = document.getElementById('progress-bar');
    if (bar) bar.style.width = p + '%';
    const txt = document.getElementById('progress-percent');
    if (txt) txt.innerText = Math.floor(p);
};