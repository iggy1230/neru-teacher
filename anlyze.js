// --- anlyze.js (完全版 v38.0: 音声バッファ1.0秒・全機能統合) ---

let transcribedProblems = []; 
let selectedProblem = null; 
let hintIndex = 0; 
let isAnalyzing = false; 
let currentSubject = '';
let currentMode = ''; 
let lunchCount = 0; 
let analysisType = 'fast';

let liveSocket = null;
let audioContext = null;
let mediaStream = null;
let workletNode = null;
let stopSpeakingTimer = null;
let currentTtsSource = null;
let chatTranscript = ""; 
let nextStartTime = 0;
let nellSpeechAccumulator = ""; 
let connectionTimeout = null;

// 音声認識用
let recognition = null;
let isRecognitionActive = false;

let gameCanvas, ctx, ball, paddle, bricks, score, gameRunning = false, gameAnimId = null;

let cropImg = new Image();
let cropPoints = [{x:0,y:0}, {x:100,y:0}, {x:100,y:100}, {x:0,y:100}];
let activeHandle = -1;
let videoStream = null;

const sfxBori = new Audio('boribori.mp3');
const sfxHit = new Audio('cat1c.mp3');
const sfxOver = new Audio('gameover.mp3');
const gameHitComments = ["うまいにゃ！", "すごいにゃ！", "さすがにゃ！", "がんばれにゃ！"];

const subjectImages = {
    'こくご': { base: 'nell-kokugo.png', talk: 'nell-kokugo-talk.png' },
    'さんすう': { base: 'nell-sansu.png', talk: 'nell-sansu-talk.png' },
    'りか': { base: 'nell-rika.png', talk: 'nell-rika-talk.png' },
    'しゃかい': { base: 'nell-shakai.png', talk: 'nell-shakai-talk.png' }
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

// --- 記憶システム (クライアント側バックアップ) ---
function saveToNellMemory(role, text) {
    let history = JSON.parse(localStorage.getItem('nell_memory') || '[]');
    history.push({ role: role, text: text, time: new Date().toISOString() });
    if (history.length > 50) history.shift();
    localStorage.setItem('nell_memory', JSON.stringify(history));
}

// --- メッセージ更新 & 音声再生 ---
async function updateNellMessage(t, mood = "normal") {
    let targetId = document.getElementById('screen-game').classList.contains('hidden') ? 'nell-text' : 'nell-text-game';
    const el = document.getElementById(targetId);
    if (el) el.innerText = t;

    if (t && t.includes("もぐもぐ")) { try { sfxBori.currentTime = 0; sfxBori.play(); } catch(e){} }
    if (!t || t.includes("ちょっと待ってて") || t.includes("もぐもぐ")) return;
    
    saveToNellMemory('nell', t);

    // audio.js の speakNell を使用
    if (typeof speakNell === 'function') {
        await speakNell(t, mood);
    }
}

// --- グローバル関数 (ボタン操作用) ---
window.selectMode = function(m) {
    currentMode = m; 
    switchScreen('screen-main'); 
    const ids = ['subject-selection-view', 'upload-controls', 'thinking-view', 'problem-selection-view', 'final-view', 'chalkboard', 'chat-view', 'lunch-view'];
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
        document.getElementById('lunch-view').classList.remove('hidden'); lunchCount = 0; updateNellMessage("お腹ペコペコだにゃ……", "thinking");
    } else if (m === 'review') { 
        renderMistakeSelection(); 
    } else { 
        document.getElementById('subject-selection-view').classList.remove('hidden'); 
        updateNellMessage("どの教科にするのかにゃ？", "normal"); 
    }
};

window.setAnalyzeMode = function(type) {
    analysisType = type;
    const btnFast = document.getElementById('mode-btn-fast');
    const btnPrec = document.getElementById('mode-btn-precision');
    if (type === 'fast') {
        btnFast.className = "main-btn pink-btn"; btnPrec.className = "main-btn gray-btn";
        updateNellMessage("サクサク解くモードだにゃ！", "happy");
    } else {
        btnFast.className = "main-btn gray-btn"; btnPrec.className = "main-btn pink-btn";
        updateNellMessage("じっくり考えるモードだにゃ！", "thinking");
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
};

window.giveLunch = function() {
    if (currentUser.karikari < 1) return updateNellMessage("カリカリがないにゃ……", "thinking");
    updateNellMessage("もぐもぐ……", "normal");
    currentUser.karikari--; 
    if(typeof saveAndSync === 'function') saveAndSync(); 
    updateMiniKarikari(); showKarikariEffect(-1); lunchCount++;
    fetch('/lunch-reaction', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: lunchCount, name: currentUser.name })
    }).then(r=>r.json()).then(d=>{
        setTimeout(() => { updateNellMessage(d.reply || "おいしいにゃ！", d.isSpecial ? "excited" : "happy"); }, 1500);
    }).catch(e=>{ setTimeout(() => { updateNellMessage("おいしいにゃ！", "happy"); }, 1500); });
};

window.showGame = function() {
    switchScreen('screen-game'); document.getElementById('mini-karikari-display').classList.remove('hidden'); updateMiniKarikari(); initGame(); fetchGameComment("start"); 
    const startBtn = document.getElementById('start-game-btn');
    startBtn.onclick = () => { if (!gameRunning) { initGame(); gameRunning = true; startBtn.disabled = true; drawGame(); } };
};

// ... (他ヘルパー関数) ...
function fetchGameComment(type, score=0) {
    fetch('/game-reaction', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, name: currentUser.name, score }) }).then(r=>r.json()).then(d=>{ updateNellMessage(d.reply, d.mood || "excited"); }).catch(e=>{});
}
function initGame() { gameCanvas = document.getElementById('game-canvas'); if(!gameCanvas) return; ctx = gameCanvas.getContext('2d'); paddle = { w: 80, h: 10, x: 120, speed: 7 }; ball = { x: 160, y: 350, dx: 3, dy: -3, r: 8 }; score = 0; document.getElementById('game-score').innerText = score; bricks = []; for(let c=0; c<5; c++) for(let r=0; r<4; r++) bricks.push({ x: c*64+10, y: r*35+40, status: 1 }); gameCanvas.removeEventListener("mousemove", movePaddle); gameCanvas.removeEventListener("touchmove", touchPaddle); gameCanvas.addEventListener("mousemove", movePaddle, false); gameCanvas.addEventListener("touchmove", touchPaddle, { passive: false }); }
function movePaddle(e) { const r=gameCanvas.getBoundingClientRect(), rx=e.clientX-r.left; if(rx>0&&rx<gameCanvas.width) paddle.x=rx-paddle.w/2; }
function touchPaddle(e) { e.preventDefault(); const r=gameCanvas.getBoundingClientRect(), rx=e.touches[0].clientX-r.left; if(rx>0&&rx<gameCanvas.width) paddle.x=rx-paddle.w/2; }
function drawGame() {
    if (!gameRunning) return;
    ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height); ctx.font = "20px serif"; bricks.forEach(b => { if(b.status === 1) ctx.fillText("🍖", b.x + 10, b.y + 20); });
    ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI*2); ctx.fillStyle = "#ff85a1"; ctx.fill(); ctx.closePath(); ctx.fillStyle = "#4a90e2"; ctx.fillRect(paddle.x, gameCanvas.height - paddle.h - 10, paddle.w, paddle.h);
    bricks.forEach(b => {
        if(b.status === 1 && ball.x>b.x && ball.x<b.x+40 && ball.y>b.y && ball.y<b.y+30){
            ball.dy*=-1; b.status=0; score++; document.getElementById('game-score').innerText=score;
            try { sfxHit.currentTime=0; sfxHit.play(); } catch(e){}
            if (Math.random() > 0.7 && !window.isNellSpeaking) { updateNellMessage(gameHitComments[Math.floor(Math.random() * gameHitComments.length)], "excited"); }
            if(score===bricks.length) { endGame(true); return; }
        }
    });
    if(ball.x+ball.dx > gameCanvas.width-ball.r || ball.x+ball.dx < ball.r) ball.dx *= -1;
    if(ball.y+ball.dy < ball.r) ball.dy *= -1;
    else if(ball.y+ball.dy > gameCanvas.height - ball.r - 20) {
        if(ball.x > paddle.x && ball.x < paddle.x + paddle.w) { ball.dy *= -1; ball.dx = (ball.x - (paddle.x+paddle.w/2)) * 0.15; } 
        else if(ball.y+ball.dy > gameCanvas.height-ball.r) { try { sfxOver.currentTime=0; sfxOver.play(); } catch(e){} endGame(false); return; }
    }
    ball.x += ball.dx; ball.y += ball.dy; gameAnimId = requestAnimationFrame(drawGame);
}
function endGame(c) {
    gameRunning = false; if(gameAnimId)cancelAnimationFrame(gameAnimId); fetchGameComment("end", score); 
    const s=document.getElementById('start-game-btn'); if(s){s.disabled=false;s.innerText="もう一回！";}
    setTimeout(()=>{ alert(c?`すごい！全クリだにゃ！\nカリカリ ${score} 個ゲット！`:`おしい！\nカリカリ ${score} 個ゲット！`); if(currentUser&&score>0){currentUser.karikari+=score;if(typeof saveAndSync==='function')saveAndSync();updateMiniKarikari();showKarikariEffect(score);} }, 500);
}

// --- クロップ & 分析 ---
const handleFileUpload = async (file) => {
    if (isAnalyzing || !file) return;
    document.getElementById('upload-controls').classList.add('hidden');
    const modal = document.getElementById('cropper-modal');
    modal.classList.remove('hidden');
    
    // Canvasリセット
    const canvas = document.getElementById('crop-canvas');
    canvas.style.opacity = '0';
    
    let loader = document.getElementById('crop-loader');
    if (!loader) {
        loader = document.createElement('div');
        loader.id = 'crop-loader';
        loader.style.position = 'absolute';
        loader.style.top = '50%';
        loader.style.left = '50%';
        loader.style.transform = 'translate(-50%, -50%)';
        loader.style.color = 'white';
        loader.style.fontWeight = 'bold';
        loader.innerText = '📷 画像を読み込んでるにゃ...';
        document.querySelector('.cropper-wrapper').appendChild(loader);
    }
    loader.style.display = 'block';

    const reader = new FileReader();
    reader.onload = async (e) => {
        const rawBase64 = e.target.result;
        cropImg = new Image();
        cropImg.onload = async () => {
            const w = cropImg.width;
            const h = cropImg.height;

            // デフォルト座標設定 (10%パディング)
            cropPoints = [
                {x: w*0.1, y: h*0.1}, {x: w*0.9, y: h*0.1},
                {x: w*0.9, y: h*0.9}, {x: w*0.1, y: h*0.9}
            ];

            const lowResBase64 = resizeImageForDetect(cropImg, 1000);
            try {
                const res = await fetch('/detect-document', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image: lowResBase64.split(',')[1] })
                });
                const data = await res.json();
                
                if (data.points && data.points.length === 4) {
                    const detectedPoints = data.points.map(p => ({
                        x: Math.max(0, Math.min(w, (p.x / 100) * w)),
                        y: Math.max(0, Math.min(h, (p.y / 100) * h))
                    }));

                    const minX = Math.min(...detectedPoints.map(p => p.x));
                    const maxX = Math.max(...detectedPoints.map(p => p.x));
                    const minY = Math.min(...detectedPoints.map(p => p.y));
                    const maxY = Math.max(...detectedPoints.map(p => p.y));
                    
                    // 安全策: 小さすぎる場合は無視
                    if ((maxX - minX) > w * 0.2 && (maxY - minY) > h * 0.2) {
                        cropPoints = detectedPoints;
                    }
                }
            } catch(err) {
                console.error("Detect failed, using default points", err);
            }

            loader.style.display = 'none';
            canvas.style.opacity = '1';
            updateNellMessage("ここを読み取るにゃ？", "normal");
            initCustomCropper();
        };
        cropImg.src = rawBase64;
    };
    reader.readAsDataURL(file);
};

function resizeImageForDetect(img, maxLen) {
    const canvas = document.createElement('canvas');
    let w = img.width, h = img.height;
    if (w > h) { if (w > maxLen) { h *= maxLen/w; w = maxLen; } } 
    else { if (h > maxLen) { w *= maxLen/h; h = maxLen; } }
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.filter = 'contrast(1.2) brightness(1.1) grayscale(1)'; 
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.6);
}

function initCustomCropper() {
    const modal = document.getElementById('cropper-modal');
    modal.classList.remove('hidden');
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
    const handles = ['handle-tl', 'handle-tr', 'handle-br', 'handle-bl'];
    handles.forEach((id, idx) => {
        const el = document.getElementById(id);
        const startDrag = (e) => { e.preventDefault(); activeHandle = idx; };
        el.onmousedown = startDrag; el.ontouchstart = startDrag;
    });
    const move = (e) => {
        if (activeHandle === -1) return;
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const imgRatio = canvas.width / canvas.height;
        const rectRatio = rect.width / rect.height;
        let drawX, drawY, drawW, drawH;
        if (imgRatio > rectRatio) {
            drawW = rect.width;
            drawH = rect.width / imgRatio;
            drawX = 0;
            drawY = (rect.height - drawH) / 2;
        } else {
            drawH = rect.height;
            drawW = rect.height * imgRatio;
            drawY = 0;
            drawX = (rect.width - drawW) / 2;
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
        window.onmousemove = null; window.ontouchmove = null;
        document.getElementById('upload-controls').classList.remove('hidden');
    };
    document.getElementById('cropper-ok-btn').onclick = () => {
        modal.classList.add('hidden');
        window.onmousemove = null; window.ontouchmove = null;
        const croppedBase64 = performPerspectiveCrop(canvas, cropPoints);
        startAnalysis(croppedBase64);
    };
}

function updateCropUI(canvas) {
    const handles = ['handle-tl', 'handle-tr', 'handle-br', 'handle-bl'];
    const rect = canvas.getBoundingClientRect();
    const imgRatio = canvas.width / canvas.height;
    const rectRatio = rect.width / rect.height;
    let drawX, drawY, drawW, drawH;
    if (imgRatio > rectRatio) {
        drawW = rect.width;
        drawH = rect.width / imgRatio;
        drawX = 0;
        drawY = (rect.height - drawH) / 2;
    } else {
        drawH = rect.height;
        drawW = rect.height * imgRatio;
        drawY = 0;
        drawX = (rect.width - drawW) / 2;
    }
    const toScreen = (p) => ({
        x: (p.x / canvas.width) * drawW + drawX + canvas.offsetLeft,
        y: (p.y / canvas.height) * drawH + drawY + canvas.offsetTop
    });
    const screenPoints = cropPoints.map(toScreen);
    handles.forEach((id, i) => {
        const el = document.getElementById(id);
        el.style.left = screenPoints[i].x + 'px';
        el.style.top = screenPoints[i].y + 'px';
    });
    const svg = document.getElementById('crop-lines');
    svg.style.left = canvas.offsetLeft + 'px'; 
    svg.style.top = canvas.offsetTop + 'px';
    svg.style.width = canvas.offsetWidth + 'px'; 
    svg.style.height = canvas.offsetHeight + 'px';
    const toSvg = (p) => ({
        x: (p.x / canvas.width) * drawW + drawX,
        y: (p.y / canvas.height) * drawH + drawY
    });
    const svgPts = cropPoints.map(toSvg);
    const ptsStr = svgPts.map(p => `${p.x},${p.y}`).join(' ');
    svg.innerHTML = `<polyline points="${ptsStr} ${svgPts[0].x},${svgPts[0].y}" style="fill:rgba(255,255,255,0.2);stroke:#ff4081;stroke-width:2;stroke-dasharray:5" />`;
}

function performPerspectiveCrop(sourceCanvas, points) {
    const minX = Math.min(...points.map(p => p.x));
    const maxX = Math.max(...points.map(p => p.x));
    const minY = Math.min(...points.map(p => p.y));
    const maxY = Math.max(...points.map(p => p.y));
    let w = maxX - minX;
    let h = maxY - minY;
    
    // 安全策
    if (w < 1) w = 1;
    if (h < 1) h = 1;

    const tempCv = document.createElement('canvas');
    const MAX_OUT = 1536;
    let outW = w, outH = h;
    if (outW > MAX_OUT || outH > MAX_OUT) {
        const s = Math.min(MAX_OUT/outW, MAX_OUT/outH);
        outW *= s; outH *= s;
    }
    
    tempCv.width = outW;
    tempCv.height = outH;
    
    const ctx = tempCv.getContext('2d');
    ctx.drawImage(sourceCanvas, minX, minY, w, h, 0, 0, outW, outH);
    
    return tempCv.toDataURL('image/jpeg', 0.85).split(',')[1];
}

async function startAnalysis(b64) {
    isAnalyzing = true;
    document.getElementById('cropper-modal').classList.add('hidden');
    document.getElementById('thinking-view').classList.remove('hidden');
    document.getElementById('upload-controls').classList.add('hidden');
    document.getElementById('main-back-btn').classList.add('hidden');
    let msg = `ふむふむ…\n${currentUser.grade}年生の${currentSubject}の問題だにゃ…`;
    updateNellMessage(msg, "thinking"); 
    updateProgress(0); 
    let p = 0; const timer = setInterval(() => { if (p < 90) { p += 3; updateProgress(p); } }, 500);
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
             updateNellMessage("問題が見つからなかったにゃ…\nもう一度写真を撮ってみて！", "thinking");
             setTimeout(() => {
                document.getElementById('thinking-view').classList.add('hidden'); 
                document.getElementById('upload-controls').classList.remove('hidden');
                if(document.getElementById('main-back-btn')) document.getElementById('main-back-btn').classList.remove('hidden');
             }, 3000);
             clearInterval(timer); isAnalyzing = false;
             return;
        }

        transcribedProblems = data.map((prob, index) => ({ ...prob, id: index + 1, student_answer: prob.student_answer || "", status: "unanswered" }));
        
        clearInterval(timer); updateProgress(100);
        
        setTimeout(() => { 
            document.getElementById('thinking-view').classList.add('hidden'); 
            document.getElementById('main-back-btn').classList.remove('hidden');
            
            const doneMsg = "読めたにゃ！";
            
            // 正しく分岐して関数呼び出し
            if (currentMode === 'grade') {
                showGradingView(); 
                updateNellMessage(doneMsg, "happy"); 
            } else { 
                renderProblemSelection(); 
                updateNellMessage(doneMsg, "happy"); 
            }
        }, 800);
    } catch (err) { 
        clearInterval(timer); 
        document.getElementById('thinking-view').classList.add('hidden'); 
        document.getElementById('upload-controls').classList.remove('hidden'); 
        if(document.getElementById('main-back-btn')) document.getElementById('main-back-btn').classList.remove('hidden');
        updateNellMessage("エラーだにゃ…", "thinking"); 
    } finally { isAnalyzing = false; }
}

const camIn = document.getElementById('hw-input-camera');
if(camIn) camIn.addEventListener('change', (e) => { handleFileUpload(e.target.files[0]); e.target.value=''; });
const albIn = document.getElementById('hw-input-album');
if(albIn) albIn.addEventListener('change', (e) => { handleFileUpload(e.target.files[0]); e.target.value=''; });
const oldIn = document.getElementById('hw-input');
if(oldIn) oldIn.addEventListener('change', (e) => { handleFileUpload(e.target.files[0]); e.target.value=''; });

function startHint(id) {
    if (window.initAudioContext) window.initAudioContext().catch(e=>{});
    selectedProblem = transcribedProblems.find(p => p.id == id); 
    if (!selectedProblem) { return updateNellMessage("データエラーだにゃ", "thinking"); }
    const uiIds = ['subject-selection-view', 'upload-controls', 'problem-selection-view', 'grade-sheet-container', 'final-view', 'hint-detail-container', 'chalkboard', 'answer-display-area'];
    uiIds.forEach(i => { const el = document.getElementById(i); if(el) el.classList.add('hidden'); });
    document.getElementById('final-view').classList.remove('hidden'); document.getElementById('hint-detail-container').classList.remove('hidden');
    const board = document.getElementById('chalkboard'); if(board) { board.innerText = selectedProblem.question; board.classList.remove('hidden'); }
    const ansArea = document.getElementById('answer-display-area'); if(ansArea) ansArea.classList.add('hidden');
    const backBtn = document.getElementById('main-back-btn');
    if (backBtn) {
        backBtn.classList.remove('hidden');
        backBtn.onclick = () => {
            if (currentMode === 'grade') showGradingView(); else renderProblemSelection();
            document.getElementById('final-view').classList.add('hidden'); 
            document.getElementById('hint-detail-container').classList.add('hidden'); 
            document.getElementById('chalkboard').classList.add('hidden');
            backBtn.classList.add('hidden'); 
            updateNellMessage("他も見るにゃ？", "normal");
        };
    }
    hintIndex = 0; updateNellMessage("カリカリをくれたらヒントだすにゃ🐾", "thinking"); 
    const nextBtn = document.getElementById('next-hint-btn'); const revealBtn = document.getElementById('reveal-answer-btn');
    if(nextBtn) { nextBtn.innerText = "🍖 ネル先生にカリカリを5個あげてヒントをもらう"; nextBtn.classList.remove('hidden'); nextBtn.onclick = showNextHint; }
    if(revealBtn) revealBtn.classList.add('hidden');
}

function showNextHint() {
    if (window.initAudioContext) window.initAudioContext();
    let cost = 0; if (hintIndex === 0) cost = 5; else if (hintIndex === 1) cost = 5; else if (hintIndex === 2) cost = 10;
    if (currentUser.karikari < cost) return updateNellMessage(`カリカリが足りないにゃ…あと${cost}個！`, "thinking");
    currentUser.karikari -= cost; saveAndSync(); updateMiniKarikari(); showKarikariEffect(-cost);
    let hints = selectedProblem.hints || [];
    updateNellMessage(hints[hintIndex] || "……", "thinking"); 
    const hl = document.getElementById('hint-step-label'); if(hl) hl.innerText = `ヒント ${hintIndex + 1}`; hintIndex++; 
    const nextBtn = document.getElementById('next-hint-btn'); const revealBtn = document.getElementById('reveal-answer-btn');
    if (hintIndex === 1) nextBtn.innerText = "🍖 さらに5個あげてヒント！";
    else if (hintIndex === 2) nextBtn.innerText = "🍖 さらに10個あげてヒント！";
    else { if(nextBtn) nextBtn.classList.add('hidden'); if(revealBtn) { revealBtn.classList.remove('hidden'); revealBtn.innerText = "答えを見る"; } }
}

function revealAnswer() {
    const ansArea = document.getElementById('answer-display-area');
    const finalTxt = document.getElementById('final-answer-text');
    const revealBtn = document.getElementById('reveal-answer-btn');
    if (ansArea && finalTxt) { finalTxt.innerText = selectedProblem.correct_answer; ansArea.classList.remove('hidden'); ansArea.style.display = "block"; }
    if (revealBtn) { revealBtn.classList.add('hidden'); }
    updateNellMessage(`答えは「${selectedProblem.correct_answer}」だにゃ！`, "gentle"); 
}

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
        const url = `${wsProto}//${location.host}?grade=${currentUser.grade}&name=${encodeURIComponent(currentUser.name)}`;
        
        liveSocket = new WebSocket(url);
        liveSocket.binaryType = "blob";
        
        connectionTimeout = setTimeout(() => {
            if (liveSocket && liveSocket.readyState !== WebSocket.OPEN) {
                updateNellMessage("なかなかつながらないにゃ…", "thinking");
                stopLiveChat();
            }
        }, 10000);
        
        liveSocket.onopen = () => { console.log("WS Open"); };
        
        liveSocket.onmessage = async (event) => {
            let data;
            try {
                if (event.data instanceof Blob) {
                    data = JSON.parse(await event.data.text());
                } else {
                    data = JSON.parse(event.data);
                }

                if (data.type === "error") {
                    console.error("Server Error:", data.message);
                    updateNellMessage("エラーが発生したにゃ…", "thinking");
                    stopLiveChat();
                    return;
                }

                if (data.type === "server_ready") {
                    clearTimeout(connectionTimeout); 
                    if(btn) { btn.innerText = "📞 つながった！(終了)"; btn.style.background = "#ff5252"; btn.disabled = false; }
                    updateNellMessage("お待たせ！なんでも話してにゃ！", "happy");
                    await startMicrophone();
                }

                if (data.serverContent?.modelTurn?.parts) {
                    data.serverContent.modelTurn.parts.forEach(p => {
                        if (p.inlineData) playLivePcmAudio(p.inlineData.data);
                    });
                }
            } catch (e) { console.error("WS Message Error:", e); }
        };
        
        liveSocket.onclose = () => { stopLiveChat(); if(btn) btn.innerText = "接続切れちゃった…"; };
        liveSocket.onerror = (e) => { 
            console.error("WS Error:", e);
            stopLiveChat(); 
            updateNellMessage("エラーが発生したにゃ…", "thinking");
        };

    } catch (e) { alert("エラー: " + e.message); stopLiveChat(); }
}

function stopLiveChat() {
    if (connectionTimeout) clearTimeout(connectionTimeout);
    if (recognition) { try { recognition.stop(); } catch(e) {} recognition = null; }
    if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
    if (workletNode) { workletNode.port.postMessage('stop'); workletNode.disconnect(); workletNode = null; }
    if (liveSocket) { liveSocket.close(); liveSocket = null; }
    if (audioContext) { audioContext.close(); audioContext = null; }
    window.isNellSpeaking = false;
    const btn = document.getElementById('mic-btn');
    if (btn) { btn.innerText = "🎤 おはなしする"; btn.style.background = "#ff85a1"; btn.disabled = false; btn.onclick = startLiveChat; btn.style.boxShadow = "none"; }
}

// ★復活: 音声認識 & 送信処理
async function startMicrophone() {
    try {
        if ('webkitSpeechRecognition' in window) {
            recognition = new webkitSpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = false;
            recognition.lang = 'ja-JP';

            recognition.onresult = (event) => {
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        const transcript = event.results[i][0].transcript;
                        console.log("🎤 認識:", transcript);
                        if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
                            liveSocket.send(JSON.stringify({ type: 'log_text', text: transcript }));
                        }
                    }
                }
            };
            recognition.start();
        }

        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } });
        const processorCode = `class PcmProcessor extends AudioWorkletProcessor { constructor() { super(); this.bufferSize = 2048; this.buffer = new Float32Array(this.bufferSize); this.index = 0; } process(inputs, outputs, parameters) { const input = inputs[0]; if (input.length > 0) { const channel = input[0]; for (let i = 0; i < channel.length; i++) { this.buffer[this.index++] = channel[i]; if (this.index >= this.bufferSize) { this.port.postMessage(this.buffer); this.index = 0; } } } return true; } } registerProcessor('pcm-processor', PcmProcessor);`;
        const blob = new Blob([processorCode], { type: 'application/javascript' });
        await audioContext.audioWorklet.addModule(URL.createObjectURL(blob));
        const source = audioContext.createMediaStreamSource(mediaStream);
        workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');
        source.connect(workletNode);
        
        workletNode.port.onmessage = (event) => {
            const inputData = event.data;
            
            // ★改良: 750ms遅延
            setTimeout(() => {
                if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) return;
                const downsampled = downsampleBuffer(inputData, audioContext.sampleRate, 16000);
                const pcmBuffer = floatTo16BitPCM(downsampled);
                const base64Audio = arrayBufferToBase64(pcmBuffer);
                liveSocket.send(JSON.stringify({ base64Audio: base64Audio }));
            }, 750);
        };
    } catch(e) { updateNellMessage("マイクエラー", "thinking"); }
}

function playLivePcmAudio(base64) { 
    if (!audioContext) return; 
    const binary = window.atob(base64); 
    const bytes = new Uint8Array(binary.length); 
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); 
    const float32 = new Float32Array(bytes.length / 2); 
    const view = new DataView(bytes.buffer); 
    for (let i = 0; i < float32.length; i++) float32[i] = view.getInt16(i * 2, true) / 32768.0; 
    const buffer = audioContext.createBuffer(1, float32.length, 24000); buffer.copyToChannel(float32, 0); const source = audioContext.createBufferSource(); source.buffer = buffer; source.connect(audioContext.destination); 
    const now = audioContext.currentTime; 
    
    // ★改良: 1.0秒バッファで頭切れ防止
    if (nextStartTime < now) nextStartTime = now + 1.0; 
    
    source.start(nextStartTime); nextStartTime += buffer.duration; 
    window.isNellSpeaking = true; if (stopSpeakingTimer) clearTimeout(stopSpeakingTimer); source.onended = () => { stopSpeakingTimer = setTimeout(() => { window.isNellSpeaking = false; }, 250); }; 
}

function floatTo16BitPCM(float32Array) { const buffer = new ArrayBuffer(float32Array.length * 2); const view = new DataView(buffer); let offset = 0; for (let i = 0; i < float32Array.length; i++, offset += 2) { let s = Math.max(-1, Math.min(1, float32Array[i])); view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true); } return buffer; }
function downsampleBuffer(buffer, sampleRate, outSampleRate) { if (outSampleRate >= sampleRate) return buffer; const ratio = sampleRate / outSampleRate; const newLength = Math.round(buffer.length / ratio); const result = new Float32Array(newLength); let offsetResult = 0, offsetBuffer = 0; while (offsetResult < result.length) { const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio); let accum = 0, count = 0; for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) { accum += buffer[i]; count++; } result[offsetResult] = accum / count; offsetResult++; offsetBuffer = nextOffsetBuffer; } return result; }
function arrayBufferToBase64(buffer) { let binary = ''; const bytes = new Uint8Array(buffer); for (let i = 0; i < bytes.byteLength; i++) { binary += String.fromCharCode(bytes[i]); } return window.btoa(binary); }
function updateMiniKarikari() { if(currentUser) { document.getElementById('mini-karikari-count').innerText = currentUser.karikari; document.getElementById('karikari-count').innerText = currentUser.karikari; } }
function showKarikariEffect(amount) { const container = document.querySelector('.nell-avatar-wrap'); if(container) { const floatText = document.createElement('div'); floatText.className = 'floating-text'; floatText.innerText = amount > 0 ? `+${amount}` : `${amount}`; floatText.style.color = amount > 0 ? '#ff9100' : '#ff5252'; floatText.style.right = '0px'; floatText.style.top = '0px'; container.appendChild(floatText); setTimeout(() => floatText.remove(), 1500); } const heartCont = document.getElementById('heart-container'); if(heartCont) { for(let i=0; i<8; i++) { const heart = document.createElement('div'); heart.innerText = amount > 0 ? '✨' : '💗'; heart.style.position = 'absolute'; heart.style.fontSize = (Math.random() * 1.5 + 1) + 'rem'; heart.style.left = (Math.random() * 100) + '%'; heart.style.top = (Math.random() * 100) + '%'; heart.style.pointerEvents = 'none'; heartCont.appendChild(heart); heart.animate([{ transform: 'scale(0) translateY(0)', opacity: 0 }, { transform: 'scale(1) translateY(-20px)', opacity: 1, offset: 0.2 }, { transform: 'scale(1.2) translateY(-100px)', opacity: 0 }], { duration: 1000 + Math.random() * 1000, easing: 'ease-out', fill: 'forwards' }).onfinish = () => heart.remove(); } } }

// --- リスト表示修正 ---
function renderProblemSelection() { 
    document.getElementById('problem-selection-view').classList.remove('hidden'); 
    const l=document.getElementById('transcribed-problem-list'); l.innerHTML=""; 
    transcribedProblems.forEach(p=>{ 
        // ★修正: mini-teach-btnクラスで右寄せ
        l.innerHTML += `<div class="prob-card"><div><span class="q-label">${p.label||'?'}</span>${p.question.substring(0,20)}...</div><button class="mini-teach-btn" onclick="startHint(${p.id})">教えて</button></div>`; 
    }); 
}

function renderMistakeSelection() { 
    if (!currentUser.mistakes || currentUser.mistakes.length === 0) { 
        updateNellMessage("ノートは空っぽにゃ！", "happy"); 
        setTimeout(backToLobby, 2000); 
        return; 
    } 
    transcribedProblems = currentUser.mistakes; 
    renderProblemSelection(); 
    updateNellMessage("復習するにゃ？", "excited"); 
}