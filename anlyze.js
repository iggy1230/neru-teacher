// --- anlyze.js (完全版 v16.3: 音声遅延修正) ---

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
let nextStartTime = 0; 
let stopSpeakingTimer = null;
let currentTtsSource = null;
let chatTranscript = ""; 

let gameCanvas, ctx, ball, paddle, bricks, score, gameRunning = false, gameAnimId = null;

let cropImg = new Image();
let cropPoints = [];
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

// 口パク
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

// メッセージ更新
async function updateNellMessage(t, mood = "normal") {
    let targetId = document.getElementById('screen-game').classList.contains('hidden') ? 'nell-text' : 'nell-text-game';
    const el = document.getElementById(targetId);
    
    if (!audioContext) { audioContext = new (window.AudioContext || window.webkitAudioContext)(); }
    if (audioContext.state === 'suspended') await audioContext.resume().catch(()=>{});
    
    if (currentTtsSource) { try { currentTtsSource.stop(); } catch(e){} currentTtsSource = null; }
    window.isNellSpeaking = false;

    if (t && t.includes("もぐもぐ")) { try { sfxBori.currentTime = 0; sfxBori.play(); } catch(e){} }
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

function selectMode(m) {
    currentMode = m; 
    switchScreen('screen-main'); 
    const ids = ['subject-selection-view', 'upload-controls', 'thinking-view', 'problem-selection-view', 'final-view', 'chalkboard', 'chat-view', 'lunch-view'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
    
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
    const maxWidth = container.clientWidth * 0.95;
    const maxHeight = container.clientHeight * 0.8;
    let w = cropImg.width; let h = cropImg.height;
    const scale = Math.min(maxWidth / w, maxHeight / h);
    w *= scale; h *= scale;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(cropImg, 0, 0, w, h);
    cropPoints = [{x: w*0.1, y: h*0.1}, {x: w*0.9, y: h*0.1}, {x: w*0.9, y: h*0.9}, {x: w*0.1, y: h*0.9}];
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
    document.getElementById('cropper-cancel-btn').onclick = () => { modal.classList.add('hidden'); window.onmousemove = null; window.ontouchmove = null; };
    document.getElementById('cropper-ok-btn').onclick = () => {
        modal.classList.add('hidden'); window.onmousemove = null; window.ontouchmove = null;
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
    svg.style.left = canvas.offsetLeft + 'px'; svg.style.top = canvas.offsetTop + 'px';
    svg.style.width = canvas.width + 'px'; svg.style.height = canvas.height + 'px';
    const pts = cropPoints.map(p => `${p.x},${p.y}`).join(' ');
    svg.innerHTML = `<polyline points="${pts} ${cropPoints[0].x},${cropPoints[0].y}" style="fill:rgba(255,255,255,0.2);stroke:#ff4081;stroke-width:3;stroke-dasharray:5" />`;
}

function performPerspectiveCrop(image, points, displayW, displayH) {
    const scaleX = image.width / displayW; const scaleY = image.height / displayH;
    const srcPts = points.map(p => ({ x: p.x * scaleX, y: p.y * scaleY }));
    const minX = Math.min(...srcPts.map(p => p.x)); const minY = Math.min(...srcPts.map(p => p.y));
    const maxX = Math.max(...srcPts.map(p => p.x)); const maxY = Math.max(...srcPts.map(p => p.y));
    const cropW = maxX - minX; const cropH = maxY - minY;
    const canvas = document.createElement('canvas');
    const maxW = 1536;
    let outW = cropW; let outH = cropH;
    if (outW > maxW) { outH *= maxW / outW; outW = maxW; }
    canvas.width = outW; canvas.height = outH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, minX, minY, cropW, cropH, 0, 0, outW, outH);
    return canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
}

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

const camIn = document.getElementById('hw-input-camera');
if(camIn) camIn.addEventListener('change', (e) => { handleFileUpload(e.target.files[0]); e.target.value=''; });
const albIn = document.getElementById('hw-input-album');
if(albIn) albIn.addEventListener('change', (e) => { handleFileUpload(e.target.files[0]); e.target.value=''; });
const oldIn = document.getElementById('hw-input');
if(oldIn) oldIn.addEventListener('change', (e) => { handleFileUpload(e.target.files[0]); e.target.value=''; });

// Webカメラ起動ボタン
const startWebcamBtn = document.getElementById('start-webcam-btn');
if (startWebcamBtn) startWebcamBtn.addEventListener('click', startWebCamera);

// Live Chat (記憶 + 音切れ対策)
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
        nextStartTime = audioContext.currentTime;

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
            
            // ★修正: 500ms遅延
            setTimeout(() => {
                if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) return;
                const downsampled = downsampleBuffer(inputData, audioContext.sampleRate, 16000);
                const pcmBuffer = floatTo16BitPCM(downsampled);
                const base64Audio = arrayBufferToBase64(pcmBuffer);
                liveSocket.send(base64Audio);
            }, 500);
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

// 3. server.js (Live API 言語設定)
// ※server.jsの修正も必要です。`speech_config` に `language_code: "ja-JP"` を追加してください。
// ここではanlyze.jsのみ提示します。