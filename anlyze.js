// --- anlyze.js (完全版 v20.0: ハイブリッド音声認識) ---

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

// --- 記憶システム (クライアント側はバックアップのみ) ---
function saveToNellMemory(role, text) {
    let history = JSON.parse(localStorage.getItem('nell_memory') || '[]');
    history.push({ role: role, text: text, time: new Date().toISOString() });
    if (history.length > 50) history.shift();
    localStorage.setItem('nell_memory', JSON.stringify(history));
}

async function updateNellMessage(t, mood = "normal") {
    let targetId = document.getElementById('screen-game').classList.contains('hidden') ? 'nell-text' : 'nell-text-game';
    const el = document.getElementById(targetId);
    
    if (!audioContext) { audioContext = new (window.AudioContext || window.webkitAudioContext)(); }
    if (audioContext.state === 'suspended') await audioContext.resume().catch(()=>{});
    
    if (currentTtsSource) { try { currentTtsSource.stop(); } catch(e){} currentTtsSource = null; }
    window.isNellSpeaking = false;

    if (t && t.includes("もぐもぐ")) { try { sfxBori.currentTime = 0; sfxBori.play(); } catch(e){} }
    if (!t || t.includes("ちょっと待ってて") || t.includes("もぐもぐ")) { if(el) el.innerText = t; return; }
    
    if (t && t.length > 0) saveToNellMemory('nell', t);

    try {
        const response = await fetch('/synthesize', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: t, mood: mood })
        });
        const data = await response.json();
        const binaryString = window.atob(data.audioContent);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
        const decodedBuffer = await audioContext.decodeAudioData(bytes.buffer);
        
        if (el) el.innerText = t;
        const source = audioContext.createBufferSource();
        source.buffer = decodedBuffer;
        source.connect(audioContext.destination);
        currentTtsSource = source;
        window.isNellSpeaking = true;
        source.start(0);
        source.onended = () => { setTimeout(() => { window.isNellSpeaking = false; }, 200); currentTtsSource = null; };
    } catch (e) { if(el) el.innerText = t; window.isNellSpeaking = false; }
}

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
    } else if (m === 'review') { renderMistakeSelection(); } 
    else { document.getElementById('subject-selection-view').classList.remove('hidden'); updateNellMessage("どの教科にするのかにゃ？", "normal"); }
}

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
    if(currentUser){currentUser.history[s]=(currentUser.history[s]||0)+1; saveAndSync();} 
    const icon = document.querySelector('.nell-avatar-wrap img'); if(icon&&subjectImages[s]){icon.src=subjectImages[s].base; icon.onerror=()=>{icon.src=defaultIcon;};} 
    document.getElementById('subject-selection-view').classList.add('hidden'); 
    document.getElementById('upload-controls').classList.remove('hidden'); 
    updateNellMessage(`${currentSubject}の問題をみせてにゃ！`, "happy"); 
};

window.giveLunch = function() {
    if (currentUser.karikari < 1) return updateNellMessage("カリカリがないにゃ……", "thinking");
    updateNellMessage("もぐもぐ……", "normal");
    currentUser.karikari--; saveAndSync(); updateMiniKarikari(); showKarikariEffect(-1); lunchCount++;
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
    setTimeout(()=>{ alert(c?`すごい！全クリだにゃ！\nカリカリ ${score} 個ゲット！`:`おしい！\nカリカリ ${score} 個ゲット！`); if(currentUser&&score>0){currentUser.karikari+=score;saveAndSync();updateMiniKarikari();showKarikariEffect(score);} }, 500);
}

const handleFileUpload = async (file) => {
    if (isAnalyzing || !file) return;
    document.getElementById('upload-controls').classList.add('hidden');
    const modal = document.getElementById('cropper-modal');
    modal.classList.remove('hidden');
    const wrapper = document.querySelector('.cropper-wrapper');
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
        wrapper.appendChild(loader);
    }
    loader.style.display = 'block';
    const reader = new FileReader();
    reader.onload = async (e) => {
        const rawBase64 = e.target.result;
        cropImg = new Image();
        cropImg.onload = async () => {
            const lowResBase64 = resizeImageForDetect(cropImg, 1000);
            try {
                const res = await fetch('/detect-document', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image: lowResBase64.split(',')[1] })
                });
                const data = await res.json();
                if (data.points && data.points.length === 4) {
                    const w = cropImg.width;
                    const h = cropImg.height;
                    cropPoints = data.points.map(p => ({ x: (p.x / 100) * w, y: (p.y / 100) * h }));
                } else {
                    const w = cropImg.width;
                    const h = cropImg.height;
                    cropPoints = [{x: w*0.1, y: h*0.1}, {x: w*0.9, y: h*0.1}, {x: w*0.9, y: h*0.9}, {x: w*0.1, y: h*0.9}];
                }
            } catch(err) {
                console.error("Detect failed", err);
                const w = cropImg.width;
                const h = cropImg.height;
                cropPoints = [{x: w*0.1, y: h*0.1}, {x: w*0.9, y: h*0.1}, {x: w*0.9, y: h*0.9}, {x: w*0.1, y: h*0.9}];
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
    const w = maxX - minX;
    const h = maxY - minY;
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
        transcribedProblems = data.map((prob, index) => ({ ...prob, id: index + 1, student_answer: prob.student_answer || "", status: "unanswered" }));
        transcribedProblems.forEach(p => {
             const n = v => v.toString().replace(/\s/g, '').replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
             if (p.student_answer && n(p.student_answer) === n(p.correct_answer)) p.status = 'correct'; else if (p.student_answer) p.status = 'incorrect';
        });
        clearInterval(timer); updateProgress(100);
        setTimeout(() => { 
            document.getElementById('thinking-view').classList.add('hidden'); 
            document.getElementById('main-back-btn').classList.remove('hidden');
            if (currentMode === 'explain' || currentMode === 'review') { 
                renderProblemSelection(); 
                updateNellMessage("読めたにゃ！", "happy"); 
            } else { 
                showGradingView(); 
                updateNellMessage("読めたにゃ！", "happy"); 
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

// --- Live Chat (修正: タイムアウト処理 & 音声認識連携) ---
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
        // URLに記憶を含めない (サーバー側で読み込むため)
        const url = `${wsProto}//${location.host}?grade=${currentUser.grade}&name=${encodeURIComponent(currentUser.name)}`;
        
        liveSocket = new WebSocket(url);
        liveSocket.binaryType = "blob";
        
        // タイムアウト設定
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

                if (data.type === "server_ready") {
                    clearTimeout(connectionTimeout); 
                    if(btn) { btn.innerText = "📞 つながった！(終了)"; btn.style.background = "#ff5252"; btn.disabled = false; }
                    updateNellMessage("お待たせ！なんでも話してにゃ！", "happy");
                    await startMicrophone();
                }

                // サーバーから音声が来た場合
                if (data.serverContent?.modelTurn?.parts) {
                    data.serverContent.modelTurn.parts.forEach(p => {
                        // クライアント側では音声再生のみ (テキスト保存はしない)
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
    // 音声認識停止
    if (recognition) {
        try { recognition.stop(); } catch(e) {}
        recognition = null;
    }
    
    if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
    if (workletNode) { workletNode.port.postMessage('stop'); workletNode.disconnect(); workletNode = null; }
    if (liveSocket) { liveSocket.close(); liveSocket = null; }
    if (audioContext) { audioContext.close(); audioContext = null; }
    window.isNellSpeaking = false;
    const btn = document.getElementById('mic-btn');
    if (btn) { btn.innerText = "🎤 おはなしする"; btn.style.background = "#ff85a1"; btn.disabled = false; btn.onclick = startLiveChat; btn.style.boxShadow = "none"; }
    // 記憶保存はここでは行わない (クライアント側localStorageのみ)
}

async function startMicrophone() {
    try {
        // 1. Web Speech API (文字起こし用)
        if ('webkitSpeechRecognition' in window) {
            recognition = new webkitSpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = false;
            recognition.lang = 'ja-JP';

            recognition.onresult = (event) => {
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        const transcript = event.results[i][0].transcript;
                        // 文字ログをサーバーへ送信
                        if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
                            liveSocket.send(JSON.stringify({ type: 'log_text', text: transcript }));
                        }
                    }
                }
            };
            recognition.start();
        }

        // 2. Audio Worklet (音声配信用)
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } });
        const processorCode = `class PcmProcessor extends AudioWorkletProcessor { constructor() { super(); this.bufferSize = 2048; this.buffer = new Float32Array(this.bufferSize); this.index = 0; } process(inputs, outputs, parameters) { const input = inputs[0]; if (input.length > 0) { const channel = input[0]; for (let i = 0; i < channel.length; i++) { this.buffer[this.index++] = channel[i]; if (this.index >= this.bufferSize) { this.port.postMessage(this.buffer); this.index = 0; } } } return true; } } registerProcessor('pcm-processor', PcmProcessor);`;
        const blob = new Blob([processorCode], { type: 'application/javascript' });
        await audioContext.audioWorklet.addModule(URL.createObjectURL(blob));
        const source = audioContext.createMediaStreamSource(mediaStream);
        workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');
        source.connect(workletNode);
        
        // ユーザー発話フラグ (保存用)
        window.userIsSpeakingNow = false;

        workletNode.port.onmessage = (event) => {
            const inputData = event.data;
            let sum = 0; for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
            const volume = Math.sqrt(sum / inputData.length);
            
            const btn = document.getElementById('mic-btn');
            if (btn) btn.style.boxShadow = volume > 0.01 ? `0 0 ${10 + volume * 500}px #ffeb3b` : "none";
            
            // ユーザー発話検知＆記憶保存
            if (volume > 0.05 && !window.userIsSpeakingNow) {
                saveToNellMemory('user', '（お話し中...）');
                window.userIsSpeakingNow = true;
                setTimeout(() => { window.userIsSpeakingNow = false; }, 5000);
            }

            setTimeout(() => {
                if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) return;
                const downsampled = downsampleBuffer(inputData, audioContext.sampleRate, 16000);
                const pcmBuffer = floatTo16BitPCM(downsampled);
                const base64Audio = arrayBufferToBase64(pcmBuffer);
                liveSocket.send(base64Audio);
            }, 250);
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
    const buffer = audioContext.createBuffer(1, float32.length, 24000); buffer.copyToChannel(float32, 0); const source = audioContext.createBufferSource(); source.buffer = buffer; source.connect(audioContext.destination); const now = audioContext.currentTime; if (nextStartTime < now) nextStartTime = now; source.start(nextStartTime); nextStartTime += buffer.duration; 
    window.isNellSpeaking = true; if (stopSpeakingTimer) clearTimeout(stopSpeakingTimer); source.onended = () => { stopSpeakingTimer = setTimeout(() => { window.isNellSpeaking = false; }, 250); }; 
}

function floatTo16BitPCM(float32Array) { const buffer = new ArrayBuffer(float32Array.length * 2); const view = new DataView(buffer); let offset = 0; for (let i = 0; i < float32Array.length; i++, offset += 2) { let s = Math.max(-1, Math.min(1, float32Array[i])); view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true); } return buffer; }
function downsampleBuffer(buffer, sampleRate, outSampleRate) { if (outSampleRate >= sampleRate) return buffer; const ratio = sampleRate / outSampleRate; const newLength = Math.round(buffer.length / ratio); const result = new Float32Array(newLength); let offsetResult = 0, offsetBuffer = 0; while (offsetResult < result.length) { const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio); let accum = 0, count = 0; for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) { accum += buffer[i]; count++; } result[offsetResult] = accum / count; offsetResult++; offsetBuffer = nextOffsetBuffer; } return result; }
function arrayBufferToBase64(buffer) { let binary = ''; const bytes = new Uint8Array(buffer); for (let i = 0; i < bytes.byteLength; i++) { binary += String.fromCharCode(bytes[i]); } return window.btoa(binary); }
function updateMiniKarikari() { if(currentUser) { document.getElementById('mini-karikari-count').innerText = currentUser.karikari; document.getElementById('karikari-count').innerText = currentUser.karikari; } }
function showKarikariEffect(amount) { const container = document.querySelector('.nell-avatar-wrap'); if(container) { const floatText = document.createElement('div'); floatText.className = 'floating-text'; floatText.innerText = amount > 0 ? `+${amount}` : `${amount}`; floatText.style.color = amount > 0 ? '#ff9100' : '#ff5252'; floatText.style.right = '0px'; floatText.style.top = '0px'; container.appendChild(floatText); setTimeout(() => floatText.remove(), 1500); } const heartCont = document.getElementById('heart-container'); if(heartCont) { for(let i=0; i<8; i++) { const heart = document.createElement('div'); heart.innerText = amount > 0 ? '✨' : '💗'; heart.style.position = 'absolute'; heart.style.fontSize = (Math.random() * 1.5 + 1) + 'rem'; heart.style.left = (Math.random() * 100) + '%'; heart.style.top = (Math.random() * 100) + '%'; heart.style.pointerEvents = 'none'; heartCont.appendChild(heart); heart.animate([{ transform: 'scale(0) translateY(0)', opacity: 0 }, { transform: 'scale(1) translateY(-20px)', opacity: 1, offset: 0.2 }, { transform: 'scale(1.2) translateY(-100px)', opacity: 0 }], { duration: 1000 + Math.random() * 1000, easing: 'ease-out', fill: 'forwards' }).onfinish = () => heart.remove(); } } }

function renderProblemSelection() { if (!currentUser.mistakes || currentUser.mistakes.length === 0) { updateNellMessage("ノートは空っぽにゃ！", "happy"); setTimeout(backToLobby, 2000); return; } transcribedProblems = currentUser.mistakes; renderProblemSelection(); updateNellMessage("復習するにゃ？", "excited"); }--- START OF FILE style.css ---

/* --- style.css (最終版: ガイド枠変更・テキスト位置修正済・画像なりゆき維持) --- */

body {
    font-family: 'M PLUS Rounded 1c', "Sawarabi Gothic", sans-serif;
    margin: 0;
    padding: 0;
    width: 100%;
    min-height: 100vh;
    background-color: #fce4ec;
    background-image: url('classroom-bg.png');
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
    background-attachment: fixed;
    color: #333;
    -webkit-font-smoothing: antialiased;
    box-sizing: border-box;
    padding-top: 0;
    overflow-x: hidden;
}

button { font-family: inherit; }
.hidden { display: none !important; }

#app-container {
    max-width: 600px;
    margin: 0 auto;
    min-height: 100vh;
    position: relative;
    padding-bottom: 40px;
}

/* タイトル画面 */
.title-screen {
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background-image: url('neru-title-bg.png');
    background-size: cover;
    background-position: center;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: center;
    z-index: 2000;
}
.main-title {
    margin-top: 80px; font-size: 3rem; color: #d81b60;
    text-shadow: 4px 4px 0 #fff, -2px -2px 0 #fff;
    text-align: center; font-weight: 900;
    animation: floatingTitle 3s ease-in-out infinite;
}
@keyframes floatingTitle { 0% { transform: translateY(0); } 50% { transform: translateY(-15px); } 100% { transform: translateY(0); } }
.title-btn-container { margin-bottom: 200px; width: 100%; display: flex; justify-content: center; }
.title-start-btn {
    background: #ff5252; color: white; font-size: 1.3rem; padding: 15px 40px;
    border-radius: 50px; border: 4px solid #fff;
    box-shadow: 0 6px 0 #d32f2f, 0 10px 10px rgba(0,0,0,0.3);
    width: fit-content; min-width: auto; animation: pulse 2s infinite;
}
@keyframes pulse { 0% { transform: scale(1); } 50% { transform: scale(1.05); } 100% { transform: scale(1); } }
.version-tag {
    position: absolute; bottom: 10px; left: 0; width: 100%;
    text-align: center; font-size: 0.7rem; color: rgba(0, 0, 0, 0.4); pointer-events: none;
}

/* 共通ボタン */
.main-btn {
    display: block; width: 90%; margin: 10px auto; padding: 15px;
    border: none; border-radius: 30px; font-size: 1.1rem; font-weight: bold;
    color: white; cursor: pointer; box-shadow: 0 4px 0 rgba(0,0,0,0.1);
    transition: transform 0.1s; text-align: center; text-decoration: none;
}
.main-btn:active { transform: translateY(2px); box-shadow: none; }
.pink-btn { background: #ff85a1; box-shadow: 0 4px 0 #d15d7d; }
.blue-btn { background: #4fc3f7; box-shadow: 0 4px 0 #29b6f6; }
.orange-btn { background: #ffb74d; box-shadow: 0 4px 0 #f57c00; }
.yellow-btn { background: #ffd54f; box-shadow: 0 4px 0 #ffca28; color: #5d4037; }
.gray-btn { background: #b0bec5; box-shadow: 0 4px 0 #78909c; }

.screen { padding: 20px 10px; animation: fadeIn 0.3s ease; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

#main-back-btn {
    position: absolute; top: 10px; left: 10px;
    width: auto !important; margin: 0 !important; padding: 8px 20px !important;
    z-index: 100; font-size: 1rem; box-shadow: 0 2px 0 #78909c;
}

/* 校門・ユーザーリスト */
.section-title {
    text-align: center; font-size: 1.5rem; color: white;
    text-shadow: 2px 2px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000; margin: 20px 0; font-weight: 900;
}
.gate-layout { display: flex; justify-content: center; align-items: flex-start; gap: 10px; min-height: 300px; margin-top: 20px; }
.right-user-list { width: 100%; display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 15px; padding: 10px; }
.user-card { background: transparent; padding: 0; text-align: center; cursor: pointer; position: relative; transition: transform 0.1s; }
.user-card:active { transform: scale(0.95); }
.user-card img {
    width: 100%; height: auto; object-fit: contain;
    border-radius: 8px; background-color: transparent !important;
    filter: drop-shadow(0 4px 4px rgba(0,0,0,0.3));
    display: block;
}
.card-karikari-badge {
    position: absolute; bottom: 5px; left: 5px;
    background: rgba(255, 255, 255, 0.95); color: #d84315;
    font-size: 0.8rem; font-weight: bold; padding: 2px 8px;
    border-radius: 10px; border: 1px solid #ffab91; pointer-events: none;
}
.delete-student-btn {
    position: absolute; top: -5px; right: -5px; width: 28px; height: 28px;
    border-radius: 50%; background: #ff5252; color: white; border: 2px solid white;
    font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center;
    box-shadow: 0 2px 4px rgba(0,0,0,0.2); z-index: 10;
}

/* 学生証レイアウト */
.id-card-wrap {
    position: relative;
    width: 100%;
    max-width: 320px;
    height: auto; 
    margin: 0 auto 20px;
    background-color: transparent;
    box-shadow: 0 4px 10px rgba(0,0,0,0.3);
    border-radius: 12px;
    overflow: hidden;
}
.id-base-img { 
    display: block !important; width: 100%; height: auto !important; position: relative !important; z-index: 1;
}
#id-photo-slot {
    display: block !important; position: absolute; z-index: 2;
    top: 35.75%; left: 5.5%; width: 30.5%; height: 45%; 
    background-color: #ddd; border-radius: 2px; overflow: hidden;
}
#id-photo-slot img { width: 100%; height: 100%; object-fit: cover !important; display: block; }
#id-photo-preview-canvas { display: none; }
.id-text-overlay { 
    display: block !important; position: absolute; color: #333; font-weight: bold; 
    font-family: 'M PLUS Rounded 1c', sans-serif; pointer-events: none; z-index: 3;
    white-space: nowrap; text-align: left; line-height: 1;
}
.id-grade-text { top: 38.5%; left: 56%; font-size: 1.3rem; }
.id-name-text { top: 54.25%; left: 56%; font-size: 1.3rem; }
@media (max-width: 350px) { .id-grade-text, .id-name-text { font-size: 1.1rem; } }

.styled-input, .styled-select { width: 80%; padding: 12px; margin: 10px auto; display: block; border: 2px solid #ff85a1; border-radius: 10px; font-size: 1rem; }

/* ロビー・その他 */
.lobby-top { text-align: center; margin: 20px 0; }
.mini-id { transform: scale(0.8); margin-bottom: 0; transform-origin: top center; }
.karikari-counter {
    text-align: center; font-size: 1.2rem; font-weight: bold;
    color: #d84315; background: #fff3e0; padding: 5px 15px;
    border-radius: 20px; display: inline-block; margin-bottom: 15px;
    position: relative; left: 50%; transform: translateX(-50%);
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}
.lobby-menu { display: grid; gap: 12px; padding: 0 15px; }
.operation-layout { margin-top: 50px; }
.nell-chat { display: flex; align-items: flex-end; margin-bottom: 15px; padding: 0 10px; }
.nell-avatar-wrap { position: relative; width: 100px; height: 100px; flex-shrink: 0; }
.nell-img { width: 100%; height: 100%; object-fit: contain; }
.chat-bubble {
    background: white; border-radius: 20px 20px 20px 0; padding: 15px;
    margin-left: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); position: relative; flex-grow: 1;
}
.chat-bubble::after {
    content: ''; position: absolute; bottom: 0; left: -10px;
    border-width: 10px 10px 0 0; border-style: solid; border-color: white transparent transparent transparent;
}
.chat-bubble p { margin: 0; font-size: 1rem; line-height: 1.5; }
.chalkboard {
    background: #2e7d32; color: white; padding: 15px; border: 8px solid #a1887f;
    border-radius: 5px; margin: 10px; font-family: 'Kiwi Maru', serif; min-height: 100px;
    box-shadow: inset 0 0 20px rgba(0,0,0,0.2);
}
.work-area { background: rgba(255,255,255,0.8); border-radius: 20px; padding: 15px; margin: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.05); }
.camera-btn-large {
    display: block; width: 100%; padding: 30px 0; background: #66bb6a;
    color: white; font-weight: bold; font-size: 1.2rem; border-radius: 15px;
    text-align: center; cursor: pointer; box-shadow: 0 6px 0 #388e3c; margin-bottom: 10px;
}
.camera-btn-large:active { transform: translateY(2px); box-shadow: 0 2px 0 #388e3c; }
.upload-buttons-container { display: flex; flex-direction: column; gap: 10px; width: 100%; }
.answer-box {
    background: #fff3e0; border: 3px solid #ffb74d; border-radius: 10px;
    padding: 15px; margin-top: 15px; text-align: center; font-size: 1.2rem;
    color: #e65100; font-weight: bold; animation: popIn 0.3s ease;
}
@keyframes popIn { 0% { transform: scale(0.8); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
.game-container { display: flex; flex-direction: column; justify-content: center; align-items: center; width: 100%; }
#game-canvas { border: 4px solid #8d6e63; border-radius: 10px; background: #fffde7; box-shadow: 0 4px 0 rgba(0,0,0,0.1); }
.game-ui { text-align: center; margin-top: 10px; }
.game-ui p { font-size: 1.2rem; font-weight: bold; color: #d84315; }
.problem-selection-card { height: 400px; display: flex; flex-direction: column; }
.problem-scroll-area { flex: 1; overflow-y: auto; padding: 5px; }
.prob-card {
    background: white; border-left: 5px solid #ff85a1; padding: 10px;
    margin-bottom: 10px; border-radius: 5px; display: flex; justify-content: space-between; align-items: center;
    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
}
.q-label { font-weight: bold; color: #e91e63; margin-right: 5px; }
.problem-row { background: #fff; padding: 10px; margin-bottom: 8px; border-radius: 8px; border-bottom: 2px solid #eee; }
.student-ans-input { font-size: 1rem; padding: 5px; width: 100px; border: 2px solid #ddd; border-radius: 5px; }
.judgment-mark { font-size: 1.5rem; margin-left: 5px; }
.mini-teach-btn { background: #2196f3; color: white; border: none; border-radius: 15px; padding: 5px 10px; font-size: 0.8rem; margin-left: auto; }
.mini-karikari-display {
    position: fixed; top: 10px; right: 10px; background: rgba(255,255,255,0.95);
    padding: 5px 10px; border-radius: 20px; font-weight: bold; color: #d84315;
    box-shadow: 0 2px 5px rgba(0,0,0,0.2); z-index: 100; display: flex; align-items: center; gap: 5px;
}
.glass-card { background: rgba(255,255,255,0.9); border-radius: 15px; padding: 15px; }
.attendance-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; }
.day-box { background: white; border-radius: 5px; padding: 5px; text-align: center; font-size: 0.8rem; aspect-ratio: 1; display: flex; flex-direction: column; justify-content: center; }
.loader-inspect-img { width: 200px; display: block; margin: 0 auto; animation: bounce 1s infinite alternate; }
.progress-bar { height: 10px; background: #ff85a1; width: 0%; transition: width 0.3s; border-radius: 5px; }
.progress-container { width: 80%; background: #eee; height: 10px; border-radius: 5px; margin: 10px auto; overflow: hidden; }
.camera-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: #000; z-index: 9999; display: flex; flex-direction: column; align-items: center; justify-content: space-between; }
.camera-container { position: relative; width: 100%; flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; }
#camera-video, #cropper-img { width: 100%; height: 100%; object-fit: contain; }

/* カメラガイド枠 (縦長幅広) */
.camera-guide-box { 
    position: absolute; 
    width: 85%; 
    aspect-ratio: 3/4; 
    border: 3px solid rgba(255, 255, 255, 0.8); 
    border-radius: 10px; 
    pointer-events: none; 
}

.camera-guide-box p { color: white; background: rgba(0,0,0,0.5); padding: 5px 10px; border-radius: 15px; margin-top: -40px; font-weight: bold; }
.camera-controls { width: 100%; height: 120px; background: #222; display: flex; align-items: center; justify-content: space-around; padding-bottom: 20px; }
.camera-shutter-btn { width: 70px; height: 70px; border-radius: 50%; background: white; border: 5px solid #ccc; cursor: pointer; }
.camera-shutter-btn:active { transform: scale(0.9); background: #ff5252; }
.cropper-wrapper { position: relative; width: 100%; flex: 1; background: #222; display: flex; justify-content: center; align-items: center; overflow: hidden; touch-action: none; }
#crop-canvas { max-width: 95%; max-height: 80vh; box-shadow: 0 0 20px rgba(0,0,0,0.5); }
.crop-handle { position: absolute; width: 40px; height: 40px; background: rgba(255, 255, 255, 0.4); border: 3px solid #ff4081; border-radius: 50%; transform: translate(-50%, -50%); z-index: 100; touch-action: none; }
.crop-handle:active { background: #ff4081; transform: translate(-50%, -50%) scale(1.2); }
#crop-lines polyline { fill: none; stroke: #ff4081; stroke-width: 3; stroke-dasharray: 5; }--- START OF FILE index.html ---

<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>🐾猫後市立ねこづか小学校</title>
    <link rel="stylesheet" href="style.css">
    <link href="https://fonts.googleapis.com/css2?family=Sawarabi+Gothic&family=M+PLUS+Rounded+1c:wght@700;900&family=Kiwi+Maru:wght@900&display=swap" rel="stylesheet">
    <!-- 顔認識ライブラリ -->
    <script defer src="https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js"></script>
    <!-- クロップ用ライブラリ (今回は独自実装を使用するためCDN不要ですが念のため残します) -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.5.13/cropper.min.js"></script>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.5.13/cropper.min.css" rel="stylesheet">
</head>
<body>
    <canvas id="hanamaru-canvas"></canvas>
    <canvas id="deco-canvas" style="display:none;"></canvas>
    
    <div id="mini-karikari-display" class="mini-karikari-display hidden"><span>🍖</span><span id="mini-karikari-count">0</span></div>

    <div id="app-container">
        <!-- 0. タイトル画面 -->
        <section id="screen-title" class="screen title-screen">
            <h1 class="main-title">猫後市立<br>ねこづか小学校</h1>
            <div class="title-btn-container">
                <button onclick="startApp()" class="main-btn title-start-btn">ねこづか小学校に行くにゃ</button>
            </div>
            <div class="version-tag">Build: v16.1.0-CropFix</div>
        </section>

        <!-- 1. 校門 -->
        <section id="screen-gate" class="screen hidden">
            <h2 class="section-title">登校する生徒を選んでにゃ</h2>
            <div class="gate-layout"><div id="user-list" class="right-user-list"></div></div>
            <button onclick="showEnrollment()" class="main-btn pink-btn">🐾 新しく入学するにゃ</button>
            <button onclick="backToTitle()" class="main-btn gray-btn">タイトルに戻る</button>
        </section>

        <!-- 2. 入学手続き -->
        <section id="screen-enrollment" class="screen hidden">
            <h2 class="section-title">🎒 入学手続き</h2>
            <div class="id-card-wrap">
                <img src="student-id-base.png" class="id-base-img" id="id-base-preview">
                <div id="id-photo-slot"><canvas id="id-photo-preview-canvas"></canvas></div>
                <div class="id-text-overlay id-grade-text" id="preview-grade">○年生</div>
                <div class="id-text-overlay id-name-text" id="preview-name">なまえ</div>
            </div>
            
            <p style="text-align:center; margin-bottom:5px;">写真を選んでにゃ！</p>
            
            <div class="upload-buttons-container">
                <button id="enroll-webcam-btn" class="camera-btn-large" style="background:#ff9800; box-shadow:0 6px 0 #e65100; font-size:1rem; padding:10px;">
                    📹 アプリで撮影
                </button>
                <div style="display:flex; gap:10px;">
                    <label class="camera-btn-large" style="flex:1; font-size:0.9rem; padding:10px;">
                        📷 標準カメラ
                        <input type="file" id="student-photo-input-camera" accept="image/*" style="display:none;">
                    </label>
                    <label class="camera-btn-large" style="flex:1; font-size:0.9rem; padding:10px; background:#4a90e2; box-shadow:0 6px 0 #2c5f96;">
                        📁 アルバム
                        <input type="file" id="student-photo-input-album" accept="image/*" style="display:none;">
                    </label>
                </div>
            </div>

            <input type="text" id="new-student-name" class="styled-input" placeholder="おなまえ" oninput="updateIDPreviewText()">
            <select id="new-student-grade" class="styled-select" onchange="updateIDPreviewText()">
                <option value="" disabled selected>学年</option>
                <option value="1">1年生</option><option value="2">2年生</option><option value="3">3年生</option>
                <option value="4">4年生</option><option value="5">5年生</option><option value="6">6年生</option>
            </select>
            <button onclick="processAndCompleteEnrollment()" id="complete-btn" class="main-btn pink-btn" disabled>入学する！</button>
            <button onclick="backToGate()" class="main-btn gray-btn">もどる</button>
            <div id="loading-models" style="text-align:center; font-size:0.7rem; margin-top:5px;">AI準備中...</div>
        </section>

        <!-- 3. ロビー -->
        <section id="screen-lobby" class="screen hidden">
            <div class="lobby-top"><div class="id-card-wrap mini-id"><img id="current-student-avatar" class="id-base-img"></div></div>
            <div class="karikari-counter">🍖 カリカリ: <span id="karikari-count">0</span></div>
            <div class="lobby-menu">
                <button onclick="selectMode('explain')" class="main-btn blue-btn">💡 教えてネル先生</button>
                <button onclick="selectMode('grade')" class="main-btn pink-btn">💯 採点ネル先生</button>
                <button onclick="selectMode('review')" class="main-btn orange-btn">🔥 復習ノート</button>
                <button onclick="showGame()" class="main-btn yellow-btn">🎮 カリカリ・キャッチ</button>
                <button onclick="selectMode('chat')" class="main-btn blue-btn">🎤 こじんめんだん</button>
                <button onclick="selectMode('lunch')" class="main-btn pink-btn">🍽️ おいしい給食</button>
                <button onclick="showAttendance()" class="main-btn gray-btn">📅 出席簿をみる</button>
                <button onclick="backToGate()" class="main-btn gray-btn">👋 帰宅する</button>
            </div>
        </section>

        <!-- 4. 教室 -->
        <section id="screen-main" class="screen hidden">
            <header>
                <button id="main-back-btn" onclick="backToLobby()" class="main-btn gray-btn" style="width:auto; padding:10px 20px;">←</button>
            </header>
            
            <div class="operation-layout">
                <div class="nell-chat">
                    <div class="nell-avatar-wrap">
                        <img src="nell-normal.png" class="nell-img" id="nell-face">
                        <div id="heart-container" style="position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none;"></div>
                    </div>
                    <div class="chat-bubble"><p id="nell-text"></p></div>
                </div>

                <div id="subject-selection-view" class="hidden">
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                        <button onclick="setSubject('こくご')" class="main-btn pink-btn">こくご</button>
                        <button onclick="setSubject('さんすう')" class="main-btn blue-btn">さんすう</button>
                        <button onclick="setSubject('りか')" class="main-btn orange-btn">りか</button>
                        <button onclick="setSubject('しゃかい')" class="main-btn gray-btn">しゃかい</button>
                    </div>
                </div>

                <div id="chalkboard" class="chalkboard hidden"></div>

                <div class="work-area">
                    <div id="upload-controls" class="hidden">
                        <p style="text-align:center; margin-bottom:10px;">宿題をみせてね！</p>
                        
                        <!-- ★復活: 読み取りモード選択ボタン -->
                        <div style="display:flex; justify-content:center; gap:10px; margin-bottom:15px;">
                            <button id="mode-btn-fast" onclick="setAnalyzeMode('fast')" class="main-btn pink-btn" style="width:45%; margin:0; font-size:0.9rem; padding:10px;">🚀 サクサク</button>
                            <button id="mode-btn-precision" onclick="setAnalyzeMode('precision')" class="main-btn gray-btn" style="width:45%; margin:0; font-size:0.9rem; padding:10px;">🧐 じっくり</button>
                        </div>

                        <div class="upload-buttons-container">
                            <button id="start-webcam-btn" class="camera-btn-large" style="background:#ff9800; box-shadow:0 6px 0 #e65100; font-size:1rem; padding:10px;">
                                📹 アプリで撮影
                            </button>
                            <div style="display:flex; gap:10px;">
                                <label class="camera-btn-large" style="flex:1; font-size:0.9rem; padding:10px;">
                                    📷 標準カメラ
                                    <input type="file" id="hw-input-camera" accept="image/*" style="display:none;">
                                </label>
                                <label class="camera-btn-large" style="flex:1; font-size:0.9rem; padding:10px; background:#4a90e2; box-shadow:0 6px 0 #2c5f96;">
                                    📁 アルバム
                                    <input type="file" id="hw-input-album" accept="image/*" style="display:none;">
                                </label>
                            </div>
                        </div>
                    </div>

                    <div id="thinking-view" class="hidden">
                        <img src="nell-inspect.png" class="loader-inspect-img">
                        <div class="progress-container"><div id="progress-bar" class="progress-bar"></div></div>
                        <p id="thinking-status">考え中... <span id="progress-percent">0</span>%</p>
                    </div>

                    <div id="problem-selection-view" class="hidden">
                        <div class="problem-selection-card">
                            <div class="problem-scroll-area" id="transcribed-problem-list"></div>
                            <button onclick="pressAllSolved()" class="main-btn orange-btn">✨ ぜんぶわかったにゃ！</button>
                        </div>
                    </div>

                    <div id="final-view" class="hidden">
                        <div id="grade-sheet-container" class="hidden">
                            <div class="glass-card" id="problem-list-grade" style="background:white; border-radius:15px; padding:10px;"></div>
                        </div>
                        <div id="hint-detail-container" class="hidden">
                            <div class="hint-btns">
                                <div class="hint-step-badge" id="hint-step-label">考え方</div>
                                <button onclick="showNextHint()" id="next-hint-btn" class="main-btn blue-btn">次のヒント！</button>
                                <button onclick="revealAnswer()" id="reveal-answer-btn" class="main-btn orange-btn hidden">答えを見る🐾</button>
                                <div id="answer-display-area" class="answer-box hidden">ネル先生の答え：<br><span id="final-answer-text"></span></div>
                            </div>
                            <button onclick="pressThanks()" class="main-btn pink-btn">✨ ありがとう！</button>
                        </div>
                    </div>

                    <div id="chat-view" class="hidden">
                        <div class="glass-card" style="text-align:center; padding:20px;">
                            <p style="font-size:0.9rem; color:#666;">マイクを押して話しかけてね</p>
                            <button id="mic-btn" class="camera-btn-large" style="background:#ff85a1; box-shadow:none;">🎤 おはなしする</button>
                            <p id="user-speech-text" style="margin-top:15px; font-weight:bold; min-height:1.5em;">...</p>
                        </div>
                    </div>

                    <div id="lunch-view" class="hidden">
                        <div class="glass-card" style="text-align:center; padding:20px;">
                            <p style="font-size:1.2rem; font-weight:900;">ネル先生にお給食をあげる？</p>
                            <div style="font-size:4rem; margin:10px;">🍽️</div>
                            <button onclick="giveLunch()" class="camera-btn-large" style="background:#ffb74d; box-shadow:0 8px 0 #f57c00;">🐟 カリカリをあげる</button>
                            <p style="margin-top:10px; font-size:0.8rem;">（カリカリが1つ減ります）</p>
                        </div>
                    </div>
                </div>
            </div>
        </section>
        
        <!-- 5. ゲーム -->
        <section id="screen-game" class="screen hidden">
            <div class="nell-chat">
                <div class="nell-avatar-wrap">
                    <img src="nell-normal.png" class="nell-img" id="nell-face-game">
                </div>
                <div class="chat-bubble"><p id="nell-text-game">カリカリキャッチで遊ぶにゃ！</p></div>
            </div>
            <h2 class="section-title" style="margin-top:10px;">🍖 カリカリ・キャッチ</h2>
            <div class="game-container">
                <canvas id="game-canvas" width="320" height="400"></canvas>
                <div class="game-ui">
                    <p>スコア: <span id="game-score">0</span></p>
                    <button id="start-game-btn" class="main-btn pink-btn" style="width: auto;">スタート！</button>
                </div>
            </div>
            <button onclick="backToLobby()" class="main-btn gray-btn" style="margin-top:20px;">ロビーにもどる</button>
        </section>

        <!-- 6. 出席簿 -->
        <section id="screen-attendance" class="screen hidden">
            <h2 class="section-title">📅 出席簿</h2>
            <div class="glass-card">
                <div id="attendance-grid" class="attendance-grid"></div>
            </div>
            <button onclick="backToLobby()" class="main-btn pink-btn mt-20">教室にもどる</button>
        </section>
    </div>

    <!-- カメラ撮影モーダル (宿題読み取り用 & 学生証用 兼用) -->
    <div id="camera-modal" class="camera-modal hidden">
        <div class="camera-container">
            <video id="camera-video" autoplay playsinline></video>
            <div class="camera-guide-box"><p>枠に合わせてにゃ</p></div>
        </div>
        <div class="camera-controls">
            <button id="camera-cancel-btn" class="main-btn gray-btn" style="width:100px;">やめる</button>
            <button id="camera-shutter-btn" class="camera-shutter-btn"></button>
        </div>
        <canvas id="camera-canvas" style="display:none;"></canvas>
    </div>

    <!-- ★修正: クロップモーダル (高解像度対応UI) -->
    <div id="cropper-modal" class="camera-modal hidden">
        <div class="cropper-wrapper">
            <canvas id="crop-canvas"></canvas>
            <svg id="crop-lines" style="position:absolute; top:0; left:0; pointer-events:none; width:100%; height:100%;">
                <!-- 補助線はJSで描画 -->
            </svg>
            <div id="handle-tl" class="crop-handle" style="top:0; left:0;"></div>
            <div id="handle-tr" class="crop-handle" style="top:0; right:0;"></div>
            <div id="handle-br" class="crop-handle" style="bottom:0; right:0;"></div>
            <div id="handle-bl" class="crop-handle" style="bottom:0; left:0;"></div>
        </div>
        <div class="camera-controls">
            <button id="cropper-cancel-btn" class="main-btn gray-btn" style="width:100px;">やめる</button>
            <button id="cropper-ok-btn" class="main-btn pink-btn" style="width:120px;">決定！</button>
        </div>
    </div>

    <script src="audio.js"></script>
    <script src="ui.js"></script>
    <script src="user.js"></script>
    <script src="anlyze.js"></script>
</body>
</html>--- START OF FILE user.js ---

// --- user.js (修正版: 猫耳サイズ1.7 & 位置微調整0.35) ---

let users = JSON.parse(localStorage.getItem('nekoneko_users')) || [];
let currentUser = null;
let modelsLoaded = false;
let enrollFile = null;

// 画像リソース
const idBase = new Image();
idBase.crossOrigin = "Anonymous"; 
idBase.src = 'student-id-base.png?' + new Date().getTime();

const decoEars = new Image(); 
decoEars.crossOrigin = "Anonymous";
decoEars.src = 'ears.png?' + new Date().getTime();

const decoMuzzle = new Image(); 
decoMuzzle.crossOrigin = "Anonymous";
decoMuzzle.src = 'muzzle.png?' + new Date().getTime();

document.addEventListener('DOMContentLoaded', () => {
    renderUserList();
    loadFaceModels(); 
    setupEnrollmentPhotoInputs();
    setupTextInputEvents();
    updateIDPreviewText();
});

function setupTextInputEvents() {
    const nameInput = document.getElementById('new-student-name');
    const gradeInput = document.getElementById('new-student-grade');
    if (nameInput) nameInput.oninput = updateIDPreviewText;
    if (gradeInput) gradeInput.onchange = updateIDPreviewText;
}

function updateIDPreviewText() {
    const nameVal = document.getElementById('new-student-name').value;
    const gradeVal = document.getElementById('new-student-grade').value;
    const nameEl = document.querySelector('.id-name-text');
    const gradeEl = document.querySelector('.id-grade-text');
    if (nameEl) nameEl.innerText = nameVal ? nameVal : "";
    if (gradeEl) gradeEl.innerText = gradeVal ? (gradeVal + "年生") : "";
}

// AIモデル読み込み
async function loadFaceModels() {
    if (modelsLoaded) return;
    const status = document.getElementById('loading-models');
    const btn = document.getElementById('complete-btn');

    if(status) status.innerText = "猫化AIを準備中にゃ... 📷";
    if(btn) btn.disabled = true;

    try {
        const MODEL_URL = 'https://cdn.jsdelivr.net/gh/cgarciagl/face-api.js@0.22.2/weights';
        await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        
        modelsLoaded = true;
        console.log("FaceAPI Models Loaded!");
        
        if(status) status.innerText = "AI準備完了にゃ！";
        if(btn) btn.disabled = false;
        
        if(enrollFile) updatePhotoPreview(enrollFile);

    } catch (e) {
        console.error("Model Load Error:", e);
        if(status) status.innerText = "AIの準備に失敗したにゃ…(手動モード)";
        if(btn) btn.disabled = false;
    }
}

// AI用リサイズ (800pxで認識精度維持)
async function resizeForAI(img, maxSize = 800) {
    return new Promise(resolve => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        if (width > height) {
            if (width > maxSize) { height *= maxSize / width; width = maxSize; }
        } else {
            if (height > maxSize) { width *= maxSize / height; height = maxSize; }
        }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas);
    });
}

// 顔中心トリミング計算
function calculateFaceCrop(imgW, imgH, detection, targetRatioW_H) {
    if (!detection) {
        let cropW = imgW;
        let cropH = cropW / targetRatioW_H;
        if (cropH > imgH) {
            cropH = imgH;
            cropW = cropH * targetRatioW_H;
        }
        return {
            x: (imgW - cropW) / 2,
            y: (imgH - cropH) / 2,
            w: cropW,
            h: cropH
        };
    }

    const box = detection.detection.box;
    const faceCX = box.x + box.width / 2;
    const faceCY = box.y + box.height / 2;

    const FACE_SCALE_TARGET = 0.55;
    
    let cropW = box.width / FACE_SCALE_TARGET;
    let cropH = cropW / targetRatioW_H;

    if (cropW > imgW) {
        cropW = imgW;
        cropH = cropW / targetRatioW_H;
    }
    if (cropH > imgH) {
        cropH = imgH;
        cropW = cropH * targetRatioW_H;
    }

    let sx = faceCX - cropW / 2;
    let sy = faceCY - cropH / 2;

    if (sx < 0) sx = 0;
    if (sy < 0) sy = 0;
    if (sx + cropW > imgW) sx = imgW - cropW;
    if (sy + cropH > imgH) sy = imgH - cropH;

    return { x: sx, y: sy, w: cropW, h: cropH };
}

// プレビュー更新
async function updatePhotoPreview(file) {
    enrollFile = file;
    const slot = document.getElementById('id-photo-slot');
    if (!slot) return;

    slot.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#666;font-size:0.8rem;font-weight:bold;">🐱 顔を探してるにゃ...</div>';

    const img = new Image();
    img.src = URL.createObjectURL(file);
    await new Promise(r => img.onload = r);

    let detection = null;
    let aiImg = null;
    
    if (modelsLoaded) {
        try {
            aiImg = await resizeForAI(img);
            // minConfidence: 0.3 で端の顔も認識
            const options = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 });
            detection = await faceapi.detectSingleFace(aiImg, options).withFaceLandmarks();
        } catch (e) { console.error(e); }
    }

    const slotRect = slot.getBoundingClientRect();
    const targetAspect = slotRect.width / slotRect.height || 0.68;

    const aiScale = aiImg ? (img.width / aiImg.width) : 1;
    
    let scaledDetection = null;
    if (detection) {
        const box = detection.detection.box;
        scaledDetection = {
            detection: {
                box: {
                    x: box.x * aiScale,
                    y: box.y * aiScale,
                    width: box.width * aiScale,
                    height: box.height * aiScale
                }
            }
        };
    }

    const crop = calculateFaceCrop(img.width, img.height, scaledDetection, targetAspect);

    const canvas = document.createElement('canvas');
    canvas.width = slotRect.width * 2;
    canvas.height = slotRect.height * 2;
    
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.objectFit = 'contain';
    
    const ctx = canvas.getContext('2d');
    
    ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height);
    
    slot.innerHTML = '';
    slot.appendChild(canvas);

    if (detection) {
        const landmarks = detection.landmarks;
        const nose = landmarks.getNose()[3];
        const leftEyeBrow = landmarks.getLeftEyeBrow()[2];
        const rightEyeBrow = landmarks.getRightEyeBrow()[2];

        const drawScale = canvas.width / crop.w;

        const transX = (x) => (x * aiScale - crop.x) * drawScale;
        const transY = (y) => (y * aiScale - crop.y) * drawScale;
        const transW = (w) => (w * aiScale) * drawScale;

        if (decoMuzzle.complete) {
            const nX = transX(nose.x);
            const nY = transY(nose.y);
            const faceW = transW(detection.detection.box.width);
            const muzW = faceW * 0.8;
            const muzH = muzW * 0.8;
            ctx.drawImage(decoMuzzle, nX - muzW/2, nY - muzH/2.5, muzW, muzH);
        }

        if (decoEars.complete) {
            const browX = transX((leftEyeBrow.x + rightEyeBrow.x)/2);
            const browY = transY((leftEyeBrow.y + rightEyeBrow.y)/2);
            const faceW = transW(detection.detection.box.width);
            
            // ★修正: 耳サイズ係数 1.9 -> 1.7
            const earW = faceW * 1.7;
            const earH = earW * 0.7;
            
            // ★修正: オフセット係数 0.45 -> 0.35 (浅く被る)
            const earOffset = earH * 0.35; 
            
            ctx.drawImage(decoEars, browX - earW/2, browY - earH + earOffset, earW, earH);
        }
    }
}

function setupEnrollmentPhotoInputs() {
    const handleFile = (file) => {
        if (!file) return;
        updatePhotoPreview(file);
    };
    const webCamBtn = document.getElementById('enroll-webcam-btn');
    if (webCamBtn) webCamBtn.onclick = () => { startEnrollmentWebCamera(handleFile); };
    const camInput = document.getElementById('student-photo-input-camera');
    if (camInput) camInput.onchange = (e) => handleFile(e.target.files[0]);
    const albInput = document.getElementById('student-photo-input-album');
    if (albInput) albInput.onchange = (e) => handleFile(e.target.files[0]);
}

let enrollStream = null;
async function startEnrollmentWebCamera(callback) {
    const modal = document.getElementById('camera-modal');
    const video = document.getElementById('camera-video');
    const shutter = document.getElementById('camera-shutter-btn');
    const cancel = document.getElementById('camera-cancel-btn');
    if (!modal || !video) return;
    try {
        let constraints = { video: { facingMode: "user" } };
        try { enrollStream = await navigator.mediaDevices.getUserMedia(constraints); } 
        catch (e) { enrollStream = await navigator.mediaDevices.getUserMedia({ video: true }); }
        video.srcObject = enrollStream;
        video.setAttribute('playsinline', true); 
        await video.play();
        modal.classList.remove('hidden');
        shutter.onclick = () => {
            const canvas = document.getElementById('camera-canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => {
                if(blob) {
                    const file = new File([blob], "enroll_capture.jpg", { type: "image/jpeg" });
                    closeEnrollCamera();
                    callback(file);
                }
            }, 'image/jpeg', 0.9);
        };
        cancel.onclick = closeEnrollCamera;
    } catch (err) {
        alert("カメラエラー: " + err.message);
        closeEnrollCamera();
    }
}

function closeEnrollCamera() {
    const modal = document.getElementById('camera-modal');
    const video = document.getElementById('camera-video');
    if (enrollStream) {
        enrollStream.getTracks().forEach(t => t.stop());
        enrollStream = null;
    }
    if (video) video.srcObject = null;
    if (modal) modal.classList.add('hidden');
}

// 保存処理: 顔オートズーム＆合成対応
async function renderForSave() {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    
    try {
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = 'student-id-base.png?' + new Date().getTime();
        });
    } catch (e) { return null; }

    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');

    const BASE_W = 640;
    const BASE_H = 400;
    const rx = canvas.width / BASE_W;
    const ry = canvas.height / BASE_H;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    if (enrollFile) {
        try {
            const photoImg = new Image();
            photoImg.src = URL.createObjectURL(enrollFile);
            await new Promise(r => photoImg.onload = r);

            const destX = 35 * rx;
            const destY = 143 * ry;
            const destW = 195 * rx;
            const destH = 180 * ry;
            
            const targetAspect = destW / destH;

            let detection = null;
            let aiImg = null;
            let aiScale = 1;

            if (modelsLoaded) {
                // 保存時も800px & 0.3
                aiImg = await resizeForAI(photoImg);
                const options = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 });
                detection = await faceapi.detectSingleFace(aiImg, options).withFaceLandmarks();
                aiScale = photoImg.width / aiImg.width;
            }

            let scaledDetection = null;
            if (detection) {
                const box = detection.detection.box;
                scaledDetection = {
                    detection: {
                        box: {
                            x: box.x * aiScale,
                            y: box.y * aiScale,
                            width: box.width * aiScale,
                            height: box.height * aiScale
                        }
                    }
                };
            }

            const crop = calculateFaceCrop(photoImg.width, photoImg.height, scaledDetection, targetAspect);

            ctx.save();
            ctx.beginPath();
            ctx.roundRect(destX, destY, destW, destH, 2 * rx);
            ctx.clip(); 
            ctx.drawImage(photoImg, crop.x, crop.y, crop.w, crop.h, destX, destY, destW, destH);
            ctx.restore();

            if (detection) {
                const landmarks = detection.landmarks;
                const nose = landmarks.getNose()[3];
                const leftEyeBrow = landmarks.getLeftEyeBrow()[2];
                const rightEyeBrow = landmarks.getRightEyeBrow()[2];

                const drawScale = destW / crop.w;

                const transX = (x) => (x * aiScale - crop.x) * drawScale + destX;
                const transY = (y) => (y * aiScale - crop.y) * drawScale + destY;
                const transW = (w) => (w * aiScale) * drawScale;

                if (decoMuzzle.complete) {
                    const nX = transX(nose.x);
                    const nY = transY(nose.y);
                    const faceW = transW(detection.detection.box.width);
                    const muzW = faceW * 0.8;
                    const muzH = muzW * 0.8;
                    ctx.drawImage(decoMuzzle, nX - muzW/2, nY - muzH/2.5, muzW, muzH);
                }
                
                if (decoEars.complete) {
                    const browX = transX((leftEyeBrow.x + rightEyeBrow.x)/2);
                    const browY = transY((leftEyeBrow.y + rightEyeBrow.y)/2);
                    const faceW = transW(detection.detection.box.width);
                    
                    // ★修正: サイズ1.7
                    const earW = faceW * 1.7;
                    const earH = earW * 0.7;

                    // ★修正: オフセット0.35
                    const earOffset = earH * 0.35;

                    ctx.drawImage(decoEars, browX - earW/2, browY - earH + earOffset, earW, earH);
                }
            }
        } catch(e) { console.error(e); }
    }

    const nameVal = document.getElementById('new-student-name').value;
    const gradeVal = document.getElementById('new-student-grade').value;
    
    ctx.fillStyle = "#333"; 
    const fontSize = 32 * rx;
    ctx.font = `bold ${fontSize}px 'M PLUS Rounded 1c', sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const textX = 346 * rx;
    if (gradeVal) ctx.fillText(gradeVal + "年生", textX, 168 * ry); 
    if (nameVal) ctx.fillText(nameVal, textX, 231 * ry);

    try {
        return canvas.toDataURL('image/png');
    } catch (e) {
        console.error("Canvas export failed:", e);
        return null;
    }
}

async function processAndCompleteEnrollment() {
    const name = document.getElementById('new-student-name').value;
    const grade = document.getElementById('new-student-grade').value;
    const btn = document.getElementById('complete-btn');

    if(!name || !grade) return alert("お名前と学年を入れてにゃ！");
    
    btn.disabled = true;
    btn.innerText = "作成中にゃ...";
    await new Promise(r => setTimeout(r, 100));

    const photoData = await renderForSave();

    let finalPhoto = photoData;
    if (!finalPhoto) {
        alert("画像の保存に失敗しちゃったけど、入学手続きは進めるにゃ！");
        finalPhoto = "student-id-base.png"; 
    }

    try {
        const newUser = { 
            id: Date.now(), name, grade, 
            photo: finalPhoto, 
            karikari: 100, 
            history: {}, mistakes: [], attendance: {},
            memory: "" 
        };
        
        users.push(newUser);
        localStorage.setItem('nekoneko_users', JSON.stringify(users)); 
        renderUserList(); 
        
        document.getElementById('new-student-name').value = "";
        document.getElementById('new-student-grade').value = "";
        enrollFile = null;
        updateIDPreviewText();
        const slot = document.getElementById('id-photo-slot');
        if(slot) slot.innerHTML = '';
        
        alert("入学おめでとうにゃ！🌸");
        switchScreen('screen-gate');

    } catch (err) {
        if (err.name === 'QuotaExceededError') {
            alert("データがいっぱいです。古い学生証を削除してください。");
        } else {
            alert("エラーが発生したにゃ……\n" + err.message);
        }
    } finally {
        btn.disabled = false;
        btn.innerText = "入学する！";
    }
}

function renderUserList() { const list = document.getElementById('user-list'); if(!list) return; list.innerHTML = users.length ? "" : "<p style='text-align:right; font-size:0.75rem; opacity:0.5;'>入学してにゃ</p>"; users.forEach(user => { const div = document.createElement('div'); div.className = "user-card"; div.innerHTML = `<img src="${user.photo}"><div class="card-karikari-badge">🍖${user.karikari || 0}</div><button class="delete-student-btn" onclick="deleteUser(event, ${user.id})">×</button>`; div.onclick = () => login(user); list.appendChild(div); }); }
function login(user) { currentUser = user; if (!currentUser.attendance) currentUser.attendance = {}; if (!currentUser.memory) currentUser.memory = ""; const avatar = document.getElementById('current-student-avatar'); if (avatar) avatar.src = user.photo; const karikari = document.getElementById('karikari-count'); if (karikari) karikari.innerText = user.karikari || 0; const today = new Date().toISOString().split('T')[0]; let isBonus = false; if (!currentUser.attendance[today]) { currentUser.attendance[today] = true; let streak = 1; let d = new Date(); while (true) { d.setDate(d.getDate() - 1); const key = d.toISOString().split('T')[0]; if (currentUser.attendance[key]) streak++; else break; } if (streak >= 3) { currentUser.karikari += 100; isBonus = true; } saveAndSync(); } switchScreen('screen-lobby'); if (isBonus) { updateNellMessage("連続出席ボーナス！カリカリ100個プレゼントだにゃ！", "excited"); showKarikariEffect(100); updateMiniKarikari(); } else { updateNellMessage(`おかえり、${user.name}さん！`, "happy"); } }
function deleteUser(e, id) { e.stopPropagation(); if(confirm("この生徒手帳を削除するにゃ？")) { users = users.filter(u => u.id !== id); try { localStorage.setItem('nekoneko_users', JSON.stringify(users)); renderUserList(); } catch(err) {} } }
function saveAndSync() { if (!currentUser) return; const idx = users.findIndex(u => u.id === currentUser.id); if (idx !== -1) users[idx] = currentUser; try { localStorage.setItem('nekoneko_users', JSON.stringify(users)); } catch(err) {} const kCounter = document.getElementById('karikari-count'); if (kCounter) kCounter.innerText = currentUser.karikari; }