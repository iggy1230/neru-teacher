// --- anlyze.js (完全版 v16.2: 全機能統合済) ---

let transcribedProblems = []; 
let selectedProblem = null; 
let hintIndex = 0; 
let isAnalyzing = false; 
let currentSubject = '';
let currentMode = ''; 
let lunchCount = 0; 

// ★分析モード (fast / precision)
let analysisType = 'fast';

// Live Chat Variables
let liveSocket = null;
let audioContext = null;
let mediaStream = null;
let workletNode = null;
let stopSpeakingTimer = null;
let currentTtsSource = null;
let chatTranscript = ""; 

// Game Variables
let gameCanvas, ctx, ball, paddle, bricks, score, gameRunning = false, gameAnimId = null;

// Cropper & Camera Variables
let cropImg = new Image();
let cropPoints = [];
let activeHandle = -1;
let videoStream = null;

// 効果音
const sfxBori = new Audio('boribori.mp3');
const sfxHit = new Audio('cat1c.mp3');
const sfxOver = new Audio('gameover.mp3');

const gameHitComments = ["うまいにゃ！", "すごいにゃ！", "さすがにゃ！", "がんばれにゃ！"];

// 教科ごとの画像
const subjectImages = {
    'こくご': { base: 'nell-kokugo.png', talk: 'nell-kokugo-talk.png' },
    'さんすう': { base: 'nell-sansu.png', talk: 'nell-sansu-talk.png' },
    'りか': { base: 'nell-rika.png', talk: 'nell-rika-talk.png' },
    'しゃかい': { base: 'nell-shakai.png', talk: 'nell-shakai-talk.png' }
};
const defaultIcon = 'nell-normal.png'; 
const talkIcon = 'nell-talk.png';

// --- 口パクアニメーション ---
function startMouthAnimation() {
    let toggle = false;
    setInterval(() => {
        const img = document.getElementById('nell-face') || document.querySelector('.nell-avatar-wrap img');
        if (!img) return;

        let baseImg = defaultIcon;
        let talkImg = talkIcon;

        // 教科モードなら画像を切り替える
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

// --- メッセージ更新 (TTS/SE) ---
async function updateNellMessage(t, mood = "normal") {
    let targetId = document.getElementById('screen-game').classList.contains('hidden') ? 'nell-text' : 'nell-text-game';
    const el = document.getElementById(targetId);
    
    if (!audioContext) { audioContext = new (window.AudioContext || window.webkitAudioContext)(); }
    if (audioContext.state === 'suspended') await audioContext.resume().catch(()=>{});
    
    if (currentTtsSource) { try { currentTtsSource.stop(); } catch(e){} currentTtsSource = null; }
    window.isNellSpeaking = false;

    // もぐもぐ音
    if (t && t.includes("もぐもぐ")) { try { sfxBori.currentTime = 0; sfxBori.play(); } catch(e){} }
    
    // TTSスキップ
    if (!t || t.includes("ちょっと待ってて") || t.includes("もぐもぐ")) { if(el) el.innerText = t; return; }

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

// --- 1. モード選択 ---
function selectMode(m) {
    currentMode = m; 
    switchScreen('screen-main'); 
    
    // UIリセット
    const ids = ['subject-selection-view', 'upload-controls', 'thinking-view', 'problem-selection-view', 'final-view', 'chalkboard', 'chat-view', 'lunch-view'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
    
    // ロビーに戻るボタン表示
    const backBtn = document.getElementById('main-back-btn');
    if (backBtn) { backBtn.classList.remove('hidden'); backBtn.onclick = backToLobby; }
    
    stopLiveChat(); gameRunning = false;
    const icon = document.querySelector('.nell-avatar-wrap img'); if(icon) icon.src = defaultIcon;
    document.getElementById('mini-karikari-display').classList.remove('hidden'); updateMiniKarikari();

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

// --- 分析モード切替 ---
window.setAnalyzeMode = function(type) {
    analysisType = type;
    const btnFast = document.getElementById('mode-btn-fast');
    const btnPrec = document.getElementById('mode-btn-precision');
    
    if (type === 'fast') {
        btnFast.className = "main-btn pink-btn";
        btnPrec.className = "main-btn gray-btn";
        updateNellMessage("サクサク解くモードだにゃ！", "happy");
    } else {
        btnFast.className = "main-btn gray-btn";
        btnPrec.className = "main-btn pink-btn";
        updateNellMessage("じっくり考えるモードだにゃ！", "thinking");
    }
};

// --- 独自4点クロップ機能 ---
const handleFileUpload = async (file) => {
    if (isAnalyzing || !file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        cropImg = new Image();
        cropImg.onload = () => { initCustomCropper(); };
        cropImg.src = e.target.result;
    };
    reader.readAsDataURL(file);
};

function initCustomCropper() {
    const modal = document.getElementById('cropper-modal');
    modal.classList.remove('hidden');
    
    const canvas = document.getElementById('crop-canvas');
    const container = document.querySelector('.cropper-wrapper');
    
    // 画面に収まるサイズに調整
    const maxWidth = container.clientWidth * 0.95;
    const maxHeight = container.clientHeight * 0.8;
    let w = cropImg.width;
    let h = cropImg.height;
    const scale = Math.min(maxWidth / w, maxHeight / h);
    w *= scale; h *= scale;
    
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(cropImg, 0, 0, w, h);
    
    // ハンドル初期位置
    cropPoints = [
        {x: w*0.1, y: h*0.1}, {x: w*0.9, y: h*0.1},
        {x: w*0.9, y: h*0.9}, {x: w*0.1, y: h*0.9}
    ];
    updateCropUI(canvas);
    
    // タッチ移動イベント
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
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        let x = Math.max(0, Math.min(clientX - rect.left, canvas.width));
        let y = Math.max(0, Math.min(clientY - rect.top, canvas.height));
        cropPoints[activeHandle] = {x, y};
        updateCropUI(canvas);
    };
    const end = () => { activeHandle = -1; };
    
    window.onmousemove = move; window.ontouchmove = move;
    window.onmouseup = end; window.ontouchend = end;

    document.getElementById('cropper-cancel-btn').onclick = () => {
        modal.classList.add('hidden');
        window.onmousemove = null; window.ontouchmove = null;
    };
    document.getElementById('cropper-ok-btn').onclick = () => {
        modal.classList.add('hidden');
        window.onmousemove = null; window.ontouchmove = null;
        const croppedBase64 = performPerspectiveCrop(cropImg, cropPoints, canvas.width, canvas.height);
        startAnalysis(croppedBase64);
    };
}

function updateCropUI(canvas) {
    const handles = ['handle-tl', 'handle-tr', 'handle-br', 'handle-bl'];
    handles.forEach((id, i) => {
        const el = document.getElementById(id);
        el.style.left = (cropPoints[i].x + canvas.offsetLeft) + 'px';
        el.style.top = (cropPoints[i].y + canvas.offsetTop) + 'px';
    });
    const svg = document.getElementById('crop-lines');
    svg.style.left = canvas.offsetLeft + 'px';
    svg.style.top = canvas.offsetTop + 'px';
    svg.style.width = canvas.width + 'px';
    svg.style.height = canvas.height + 'px';
    const pts = cropPoints.map(p => `${p.x},${p.y}`).join(' ');
    svg.innerHTML = `<polyline points="${pts} ${cropPoints[0].x},${cropPoints[0].y}" style="fill:rgba(255,255,255,0.2);stroke:#ff4081;stroke-width:3;stroke-dasharray:5" />`;
}

// 簡易台形補正（切り抜いて引き伸ばす）
function performPerspectiveCrop(image, points, displayW, displayH) {
    const scaleX = image.width / displayW;
    const scaleY = image.height / displayH;
    const srcPts = points.map(p => ({ x: p.x * scaleX, y: p.y * scaleY }));
    
    const minX = Math.min(...srcPts.map(p => p.x));
    const minY = Math.min(...srcPts.map(p => p.y));
    const maxX = Math.max(...srcPts.map(p => p.x));
    const maxY = Math.max(...srcPts.map(p => p.y));
    
    const cropW = maxX - minX;
    const cropH = maxY - minY;
    
    const canvas = document.createElement('canvas');
    // 最大幅1536px制限
    const maxW = 1536;
    let outW = cropW; let outH = cropH;
    if (outW > maxW) { outH *= maxW / outW; outW = maxW; }

    canvas.width = outW; canvas.height = outH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, minX, minY, cropW, cropH, 0, 0, outW, outH);
    
    return canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
}

// --- 5. 分析開始 ---
async function startAnalysis(b64) {
    isAnalyzing = true;
    const up = document.getElementById('upload-controls'); if(up) up.classList.add('hidden');
    const th = document.getElementById('thinking-view'); if(th) th.classList.remove('hidden');
    const backBtn = document.getElementById('main-back-btn'); if(backBtn) backBtn.classList.add('hidden');
    
    let msg = `ちょっと待っててにゃ…\nふむふむ…\n${currentUser.grade}年生の${currentSubject}の問題だにゃ…`;
    updateNellMessage(msg, "thinking"); 
    updateProgress(0); 
    let p = 0; const timer = setInterval(() => { if (p < 90) { p += 3; updateProgress(p); } }, 500);

    try {
        const res = await fetch('/analyze', { 
            method: 'POST', headers: { 'Content-Type': 'application/json' }, 
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
            if(th) th.classList.add('hidden'); if(backBtn) backBtn.classList.add('hidden');
            if (currentMode === 'explain' || currentMode === 'review') { renderProblemSelection(); updateNellMessage("問題が読めたにゃ！", "happy"); } else { showGradingView(); }
        }, 800);
    } catch (err) { 
        clearInterval(timer); document.getElementById('thinking-view').classList.add('hidden'); document.getElementById('upload-controls').classList.remove('hidden'); if(backBtn) backBtn.classList.remove('hidden');
        updateNellMessage("エラーだにゃ…", "thinking"); 
    } finally { isAnalyzing = false; }
}

// 宿題アップロードボタンのリスナー
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
    
    // UI切り替え
    const uiIds = ['problem-selection-view', 'grade-sheet-container', 'final-view', 'hint-detail-container', 'chalkboard', 'answer-display-area'];
    uiIds.forEach(i => { const el = document.getElementById(i); if(el) el.classList.add('hidden'); });
    document.getElementById('final-view').classList.remove('hidden'); 
    document.getElementById('hint-detail-container').classList.remove('hidden');
    const board = document.getElementById('chalkboard'); if(board) { board.innerText = selectedProblem.question; board.classList.remove('hidden'); }
    const ansArea = document.getElementById('answer-display-area'); if(ansArea) ansArea.classList.add('hidden');
    
    const backBtn = document.getElementById('main-back-btn');
    if (backBtn) {
        backBtn.classList.remove('hidden');
        backBtn.onclick = () => {
            if (currentMode === 'grade') showGradingView(); else renderProblemSelection();
            document.getElementById('final-view').classList.add('hidden'); document.getElementById('hint-detail-container').classList.add('hidden'); document.getElementById('chalkboard').classList.add('hidden');
            backBtn.classList.add('hidden'); updateNellMessage("他の問題も見るにゃ？", "normal");
        };
    }
    hintIndex = 0; updateNellMessage("カリカリをくれたらヒントを出してあげてもいいにゃ🐾", "thinking"); 
    const nextBtn = document.getElementById('next-hint-btn'); const revealBtn = document.getElementById('reveal-answer-btn');
    if(nextBtn) { nextBtn.innerText = "🍖 ネル先生にカリカリを5個あげてヒントをもらう"; nextBtn.classList.remove('hidden'); nextBtn.onclick = showNextHint; }
    if(revealBtn) revealBtn.classList.add('hidden');
}

function showNextHint() {
    if (window.initAudioContext) window.initAudioContext();
    let cost = 0; if (hintIndex === 0) cost = 5; else if (hintIndex === 1) cost = 5; else if (hintIndex === 2) cost = 10;
    if (currentUser.karikari < cost) return updateNellMessage(`カリカリが足りないにゃ……あと${cost}個必要にゃ。`, "thinking");
    currentUser.karikari -= cost; saveAndSync(); updateMiniKarikari(); showKarikariEffect(-cost);
    let hints = selectedProblem.hints || [];
    updateNellMessage(hints[hintIndex] || "……", "thinking"); 
    const hl = document.getElementById('hint-step-label'); if(hl) hl.innerText = `ヒント ${hintIndex + 1}`; hintIndex++; 
    const nextBtn = document.getElementById('next-hint-btn'); const revealBtn = document.getElementById('reveal-answer-btn');
    if (hintIndex === 1) nextBtn.innerText = "🍖 さらにカリカリを5個あげてヒントをもらう";
    else if (hintIndex === 2) nextBtn.innerText = "🍖 さらにカリカリを10個あげてヒントをもらう";
    else { if(nextBtn) nextBtn.classList.add('hidden'); if(revealBtn) { revealBtn.classList.remove('hidden'); revealBtn.innerText = "答えを見る"; } }
}

// 答え表示（吹き出し）
function revealAnswer() {
    const ansArea = document.getElementById('answer-display-area');
    if(ansArea) {
        document.getElementById('final-answer-text').innerText = selectedProblem.correct_answer;
        ansArea.classList.remove('hidden');
    }
    document.getElementById('reveal-answer-btn').classList.add('hidden');
    updateNellMessage(`答えは「${selectedProblem.correct_answer}」だにゃ！`, "gentle");
}

// --- 2. Live Chat (記憶機能) ---
async function startLiveChat() {
    const btn = document.getElementById('mic-btn');
    if (liveSocket) { stopLiveChat(); return; }
    try {
        updateNellMessage("ネル先生を呼んでるにゃ……", "thinking");
        if(btn) btn.disabled = true;
        chatTranscript = "";

        if (window.initAudioContext) await window.initAudioContext();
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        await audioContext.resume();

        const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const grade = currentUser ? currentUser.grade : "1";
        const name = currentUser ? encodeURIComponent(currentUser.name) : "";
        const mem = currentUser ? encodeURIComponent(currentUser.memory || "") : "";
        
        liveSocket = new WebSocket(`${wsProto}//${location.host}?grade=${grade}&name=${name}&memory=${mem}`);
        liveSocket.binaryType = "blob";

        liveSocket.onopen = () => { console.log("WS Open"); };
        liveSocket.onmessage = async (event) => {
            let data;
            if (event.data instanceof Blob) { data = JSON.parse(await event.data.text()); } 
            else { data = JSON.parse(event.data); }
            
            if (data.type === "server_ready") {
                if(btn) { btn.innerText = "📞 つながった！(終了)"; btn.style.background = "#ff5252"; btn.disabled = false; }
                updateNellMessage("お待たせ！なんでも話してにゃ！", "happy");
                await startMicrophone();
            }
            if (data.serverContent?.modelTurn?.parts) {
                data.serverContent.modelTurn.parts.forEach(p => {
                    if (p.text) chatTranscript += `ネル: ${p.text}\n`;
                    if (p.inlineData) playLivePcmAudio(p.inlineData.data);
                });
            }
        };
        liveSocket.onclose = () => { stopLiveChat(); if(btn) btn.innerText = "接続切れちゃった…"; };
    } catch (e) { alert("エラー: " + e.message); stopLiveChat(); }
}

function stopLiveChat() {
    if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
    if (workletNode) { workletNode.port.postMessage('stop'); workletNode.disconnect(); workletNode = null; }
    if (liveSocket) { liveSocket.close(); liveSocket = null; }
    if (audioContext) { audioContext.close(); audioContext = null; }
    window.isNellSpeaking = false;
    const btn = document.getElementById('mic-btn');
    if (btn) { btn.innerText = "🎤 おはなしする"; btn.style.background = "#ff85a1"; btn.disabled = false; btn.onclick = startLiveChat; btn.style.boxShadow = "none"; }
    
    if (chatTranscript.length > 20 && currentUser) {
        fetch('/summarize-chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript: chatTranscript })
        }).then(r => r.json()).then(d => {
            if (d.summary) {
                currentUser.memory = (currentUser.memory || "") + "\n" + d.summary;
                if(currentUser.memory.length > 1000) currentUser.memory = currentUser.memory.slice(-1000);
                saveAndSync();
            }
        });
    }
}

async function startMicrophone() {
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } });
        const processorCode = `class PcmProcessor extends AudioWorkletProcessor { constructor() { super(); this.bufferSize = 2048; this.buffer = new Float32Array(this.bufferSize); this.index = 0; } process(inputs, outputs, parameters) { const input = inputs[0]; if (input.length > 0) { const channel = input[0]; for (let i = 0; i < channel.length; i++) { this.buffer[this.index++] = channel[i]; if (this.index >= this.bufferSize) { this.port.postMessage(this.buffer); this.index = 0; } } } return true; } } registerProcessor('pcm-processor', PcmProcessor);`;
        const blob = new Blob([processorCode], { type: 'application/javascript' });
        await audioContext.audioWorklet.addModule(URL.createObjectURL(blob));
        const source = audioContext.createMediaStreamSource(mediaStream);
        workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');
        source.connect(workletNode);
        
        workletNode.port.onmessage = (event) => {
            const inputData = event.data;
            let sum = 0; for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
            const volume = Math.sqrt(sum / inputData.length);
            const btn = document.getElementById('mic-btn');
            if (btn) btn.style.boxShadow = volume > 0.01 ? `0 0 ${10 + volume * 500}px #ffeb3b` : "none";
            
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

// --- 3. 給食 ---
function giveLunch() {
    if (currentUser.karikari < 1) return updateNellMessage("カリカリがないにゃ……", "thinking");
    updateNellMessage("もぐもぐ……", "normal");
    currentUser.karikari--; saveAndSync(); updateMiniKarikari(); showKarikariEffect(-1); lunchCount++;
    fetch('/lunch-reaction', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: lunchCount, name: currentUser.name })
    }).then(r=>r.json()).then(d=>{
        setTimeout(() => { updateNellMessage(d.reply || "おいしいにゃ！", d.isSpecial ? "excited" : "happy"); }, 1500);
    }).catch(e=>{ setTimeout(() => { updateNellMessage("おいしいにゃ！", "happy"); }, 1500); });
}

// --- 4. ゲーム ---
function showGame() {
    switchScreen('screen-game'); document.getElementById('mini-karikari-display').classList.remove('hidden'); updateMiniKarikari(); initGame(); fetchGameComment("start"); 
    const startBtn = document.getElementById('start-game-btn');
    startBtn.onclick = () => { if (!gameRunning) { initGame(); gameRunning = true; startBtn.disabled = true; drawGame(); } };
}
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

// 宿題カメラ (anlyze.js内)
async function startWebCamera() {
    const modal = document.getElementById('camera-modal');
    const video = document.getElementById('camera-video');
    if (!modal || !video) return;
    try {
        const constraints = { video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } };
        videoStream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = videoStream;
        video.onloadedmetadata = () => { video.play(); };
        modal.classList.remove('hidden');
        updateNellMessage("枠の中に宿題を入れて、ボタンを押してにゃ！", "normal");
        const shutter = document.getElementById('camera-shutter-btn');
        const cancel = document.getElementById('camera-cancel-btn');
        shutter.onclick = takePicture;
        cancel.onclick = closeWebCamera;
    } catch (err) {
        alert("カメラを起動できなかったにゃ…");
        closeWebCamera();
    }
}
function closeWebCamera() {
    const modal = document.getElementById('camera-modal');
    const video = document.getElementById('camera-video');
    if (videoStream) { videoStream.getTracks().forEach(track => track.stop()); videoStream = null; }
    if (video) video.srcObject = null;
    if (modal) modal.classList.add('hidden');
}
function takePicture() {
    const video = document.getElementById('camera-video');
    const canvas = document.getElementById('camera-canvas');
    if (!video || !canvas || !videoStream) return;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
        if (blob) {
            const file = new File([blob], "webcam_capture.jpg", { type: "image/jpeg" });
            closeWebCamera();
            handleFileUpload(file);
        }
    }, 'image/jpeg', 0.9);
}
const startWebcamBtn = document.getElementById('start-webcam-btn');
if (startWebcamBtn) startWebcamBtn.addEventListener('click', startWebCamera);

// Utils
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
function downsampleBuffer(buffer, sampleRate, outSampleRate) { if (outSampleRate >= sampleRate) return buffer; const ratio = sampleRate / outSampleRate; const newLength = Math.round(buffer.length / ratio); const result = new Float32Array(newLength); let offsetResult = 0, offsetBuffer = 0; while (offsetResult < result.length) { const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio); let accum = 0, count = 0; for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) { accum += buffer[i]; count++; } result[offsetResult] = accum / count; offsetResult++; offsetBuffer = nextOffsetBuffer; } return result; }
function arrayBufferToBase64(buffer) { let binary = ''; const bytes = new Uint8Array(buffer); for (let i = 0; i < bytes.byteLength; i++) { binary += String.fromCharCode(bytes[i]); } return window.btoa(binary); }
function updateMiniKarikari() { if(currentUser) { document.getElementById('mini-karikari-count').innerText = currentUser.karikari; document.getElementById('karikari-count').innerText = currentUser.karikari; } }
function showKarikariEffect(amount) { const container = document.querySelector('.nell-avatar-wrap'); if(container) { const floatText = document.createElement('div'); floatText.className = 'floating-text'; floatText.innerText = amount > 0 ? `+${amount}` : `${amount}`; floatText.style.color = amount > 0 ? '#ff9100' : '#ff5252'; floatText.style.right = '0px'; floatText.style.top = '0px'; container.appendChild(floatText); setTimeout(() => floatText.remove(), 1500); } const heartCont = document.getElementById('heart-container'); if(heartCont) { for(let i=0; i<8; i++) { const heart = document.createElement('div'); heart.className = 'heart-particle'; heart.innerText = amount > 0 ? '✨' : '💗'; heart.style.left = (Math.random()*80 + 10) + '%'; heart.style.top = (Math.random()*50 + 20) + '%'; heart.style.animationDelay = (Math.random()*0.5) + 's'; heartCont.appendChild(heart); setTimeout(() => heart.remove(), 1500); } } }
function revealAnswer() { 
    const ansArea = document.getElementById('answer-display-area'); 
    if(ansArea) { document.getElementById('final-answer-text').innerText = selectedProblem.correct_answer; ansArea.classList.remove('hidden'); }
    document.getElementById('reveal-answer-btn').classList.add('hidden'); 
    updateNellMessage(`答えは「${selectedProblem.correct_answer}」だにゃ！`, "gentle"); 
}
function renderProblemSelection() { document.getElementById('problem-selection-view').classList.remove('hidden'); const l=document.getElementById('transcribed-problem-list'); l.innerHTML=""; transcribedProblems.forEach(p=>{ l.innerHTML += `<div class="prob-card"><div><span class="q-label">${p.label||'?'}</span>${p.question.substring(0,20)}...</div><button class="main-btn blue-btn" style="width:auto;padding:10px" onclick="startHint(${p.id})">教えて</button></div>`; }); }
function showGradingView() { document.getElementById('grade-sheet-container').classList.remove('hidden'); document.getElementById('final-view').classList.remove('hidden'); const backBtn = document.getElementById('main-back-btn'); if(backBtn) backBtn.classList.add('hidden'); renderWorksheet(); }
function renderWorksheet() { const l=document.getElementById('problem-list-grade'); if(!l)return; l.innerHTML=""; transcribedProblems.forEach((p,i)=>{ l.innerHTML+=`<div class="problem-row"><div><span class="q-label">${p.label||'?'}</span>${p.question}</div><div style="display:flex;gap:5px"><input class="student-ans-input" value="${p.student_answer}" onchange="updateAns(${i},this.value)"><div class="judgment-mark ${p.status}">${p.status==='correct'?'⭕️':p.status==='incorrect'?'❌':''}</div><button class="mini-teach-btn" onclick="startHint(${p.id})">教えて</button></div></div>`; }); const f=document.createElement('div'); f.style.textAlign="center"; f.style.marginTop="20px"; f.innerHTML=`<button onclick="finishGrading()" class="main-btn orange-btn">✨ ぜんぶわかったにゃ！</button>`; l.appendChild(f); }
function updateAns(i, v) { transcribedProblems[i].student_answer = v; const n = val => val.toString().replace(/\s/g, '').replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)).replace(/cm|ｍ|ｍｍ|円|個|L/g, '').replace(/[×＊]/g, '*').replace(/[÷／]/g, '/'); if (n(v) === n(transcribedProblems[i].correct_answer) && v !== "") { transcribedProblems[i].status = 'correct'; updateNellMessage("正解にゃ！修正ありがとうにゃ。", "happy"); if (currentUser.mistakes) { currentUser.mistakes = currentUser.mistakes.filter(m => m.question !== transcribedProblems[i].question); } } else { transcribedProblems[i].status = 'incorrect'; updateNellMessage("まだ違うみたいだにゃ……", "thinking"); if (!currentUser.mistakes.some(m => m.question === transcribedProblems[i].question)) { currentUser.mistakes.push({...transcribedProblems[i], subject: currentSubject}); } } saveAndSync(); renderWorksheet(); }
window.finishGrading = async function() { const btn = document.querySelector('button.main-btn.orange-btn'); if(btn) btn.disabled = true; await updateNellMessage("よくがんばったにゃ！カリカリ100個あげるにゃ！", "excited"); if (currentUser) { currentUser.karikari += 100; saveAndSync(); updateMiniKarikari(); showKarikariEffect(100); } setTimeout(() => { if(typeof backToLobby === 'function') backToLobby(true); }, 3000); };
window.pressAllSolved = function() { const btn = document.querySelector('button.main-btn.orange-btn'); if(btn) btn.disabled = true; if (currentUser) { currentUser.karikari += 100; saveAndSync(); showKarikariEffect(100); updateNellMessage("よくがんばったにゃ！カリカリ100個あげるにゃ！", "excited").then(() => { setTimeout(() => { if(typeof backToLobby === 'function') backToLobby(true); }, 3000); }); } };
function pressThanks() { if(currentMode==='grade') showGradingView(); else backToProblemSelection(); }
function setSubject(s) { currentSubject = s; if(currentUser){currentUser.history[s]=(currentUser.history[s]||0)+1; saveAndSync();} const icon = document.querySelector('.nell-avatar-wrap img'); if(icon&&subjectImages[s]){icon.src=subjectImages[s].base; icon.onerror=()=>{icon.src=defaultIcon;};} document.getElementById('subject-selection-view').classList.add('hidden'); document.getElementById('upload-controls').classList.remove('hidden'); updateNellMessage(`${currentSubject}の問題をみせてにゃ！`, "happy"); }
async function shrinkImage(file, maxSize = 1600) { return new Promise((r)=>{ const reader=new FileReader(); reader.readAsDataURL(file); reader.onload=e=>{ const img=new Image(); img.onload=()=>{ const c=document.createElement('canvas'); let w=img.width,h=img.height; if(w>maxSize || h>maxSize){ if(w>h){ h*=maxSize/w; w=maxSize; } else{ w*=maxSize/h; h=maxSize; } } c.width=w;c.height=h; c.getContext('2d').drawImage(img,0,0,w,h); r(c.toDataURL('image/jpeg',0.9).split(',')[1]); }; img.src=e.target.result; }; }); }
function renderMistakeSelection() { if (!currentUser.mistakes || currentUser.mistakes.length === 0) { updateNellMessage("ノートは空っぽにゃ！", "happy"); setTimeout(backToLobby, 2000); return; } transcribedProblems = currentUser.mistakes; renderProblemSelection(); updateNellMessage("復習するにゃ？", "excited"); }