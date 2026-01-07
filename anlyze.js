// --- anlyze.js (完全版: v15.0) ---

let transcribedProblems = []; 
let selectedProblem = null; 
let hintIndex = 0; 
let isAnalyzing = false; 
let currentSubject = '';
let currentMode = ''; 
let lunchCount = 0; 

// Live Chat / Memory
let liveSocket = null;
let audioContext = null;
let mediaStream = null;
let workletNode = null;
let stopSpeakingTimer = null;
let currentTtsSource = null;
let chatTranscript = ""; // 会話内容の一時保存

let gameCanvas, ctx, ball, paddle, bricks, score, gameRunning = false, gameAnimId = null;

// Cropper
let cropper = null;

const sfxBori = new Audio('boribori.mp3');
const sfxHit = new Audio('cat1c.mp3');
const sfxOver = new Audio('gameover.mp3');

const gameHitComments = ["うまいにゃ！", "すごいにゃ！", "さすがにゃ！", "がんばれにゃ！"];
const subjectImages = { 'こくご': 'nell-kokugo.png', 'さんすう': 'nell-sansu.png', 'りか': 'nell-rika.png', 'しゃかい': 'nell-shakai.png' };
const defaultIcon = 'nell-normal.png'; 
const talkIcon = 'nell-talk.png';

// 口パク
function startMouthAnimation() {
    let toggle = false;
    setInterval(() => {
        const img = document.getElementById('nell-face') || document.querySelector('.nell-avatar-wrap img');
        if (!img) return;
        let base = defaultIcon;
        if (currentSubject && subjectImages[currentSubject] && (currentMode === 'explain' || currentMode === 'grade' || currentMode === 'review')) base = subjectImages[currentSubject];
        if (window.isNellSpeaking) img.src = toggle ? talkIcon : base;
        else img.src = base;
        toggle = !toggle;
    }, 150);
}
startMouthAnimation();

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

// 1. モード選択
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

// 2. Live Chat (記憶機能付き)
async function startLiveChat() {
    const btn = document.getElementById('mic-btn');
    if (liveSocket) { stopLiveChat(); return; }
    try {
        updateNellMessage("ネル先生を呼んでるにゃ……", "thinking");
        if(btn) btn.disabled = true;
        chatTranscript = ""; // 会話記録リセット

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
            // サーバーからのテキスト応答を蓄積
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
    
    // ★記憶の保存
    if (chatTranscript.length > 20 && currentUser) {
        fetch('/summarize-chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript: chatTranscript })
        }).then(r => r.json()).then(d => {
            if (d.summary) {
                currentUser.memory = (currentUser.memory || "") + "\n" + d.summary;
                // 古い記憶を消す処理（簡易）
                if(currentUser.memory.length > 500) currentUser.memory = currentUser.memory.slice(-500);
                saveAndSync();
                console.log("Memory updated:", d.summary);
            }
        });
    }
}

async function startMicrophone() {
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } });
        const processorCode = `class PcmProcessor extends AudioWorkletProcessor { constructor() { super(); this.bufferSize = 4096; this.buffer = new Float32Array(this.bufferSize); this.index = 0; } process(inputs, outputs, parameters) { const input = inputs[0]; if (input.length > 0) { const channel = input[0]; for (let i = 0; i < channel.length; i++) { this.buffer[this.index++] = channel[i]; if (this.index >= this.bufferSize) { this.port.postMessage(this.buffer.slice(0, this.bufferSize)); this.index = 0; } } } return true; } } registerProcessor('pcm-processor', PcmProcessor);`;
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
                const pcm16 = floatTo16BitPCM(downsampled);
                const base64 = arrayBufferToBase64(pcm16);
                liveSocket.send(JSON.stringify({ type: 'audio', data: base64 }));
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

// 3. 給食 (高速化)
function giveLunch() {
    if (currentUser.karikari < 1) return updateNellMessage("カリカリがないにゃ……", "thinking");
    updateNellMessage("もぐもぐ……", "normal");
    currentUser.karikari--; saveAndSync(); updateMiniKarikari(); showKarikariEffect(-1); lunchCount++;
    fetch('/lunch-reaction', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: lunchCount, name: currentUser.name })
    }).then(r=>r.json()).then(d=>{
        updateNellMessage(d.reply || "おいしいにゃ！", d.isSpecial ? "excited" : "happy");
    }).catch(e=>{ updateNellMessage("おいしいにゃ！", "happy"); });
}

// 4. ゲーム (中央配置)
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

// 5. 分析・ヒント (Cropper統合)
const handleFileUpload = async (file) => {
    if (isAnalyzing || !file) return; 
    
    // クロップモーダル表示
    const modal = document.getElementById('cropper-modal');
    const imgEl = document.getElementById('cropper-img');
    const reader = new FileReader();
    
    reader.onload = (e) => {
        imgEl.src = e.target.result;
        modal.classList.remove('hidden');
        if (cropper) cropper.destroy();
        cropper = new Cropper(imgEl, { viewMode: 1, autoCropArea: 0.9 });
    };
    reader.readAsDataURL(file);

    document.getElementById('cropper-cancel-btn').onclick = () => { modal.classList.add('hidden'); };
    document.getElementById('cropper-ok-btn').onclick = () => {
        const canvas = cropper.getCroppedCanvas();
        // ★修正: 送信前リサイズ (1536px, quality 0.6)
        const resized = document.createElement('canvas');
        const max = 1536;
        let w = canvas.width, h = canvas.height;
        if(w>max||h>max) { if(w>h){h*=max/w;w=max}else{w*=max/h;h=max} }
        resized.width=w; resized.height=h;
        resized.getContext('2d').drawImage(canvas,0,0,w,h);
        
        const b64 = resized.toDataURL('image/jpeg', 0.6).split(',')[1];
        modal.classList.add('hidden');
        startAnalysis(b64);
    };
};

// 分析実行
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
        const res = await fetch('/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: b64, mode: currentMode, grade: currentUser.grade, subject: currentSubject }) });
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

function startHint(id) {
    if (window.initAudioContext) window.initAudioContext().catch(e=>{});
    selectedProblem = transcribedProblems.find(p => p.id == id); 
    if (!selectedProblem) { return updateNellMessage("データエラーだにゃ", "thinking"); }
    const uiIds = ['problem-selection-view', 'grade-sheet-container', 'final-view', 'hint-detail-container', 'chalkboard', 'answer-display-area'];
    uiIds.forEach(i => { const el = document.getElementById(i); if(el) el.classList.add('hidden'); });
    document.getElementById('final-view').classList.remove('hidden'); document.getElementById('hint-detail-container').classList.remove('hidden');
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

// Utils (サイズ変更なし)
function downsampleBuffer(buffer, sampleRate, outSampleRate) { if (outSampleRate >= sampleRate) return buffer; const ratio = sampleRate / outSampleRate; const newLength = Math.round(buffer.length / ratio); const result = new Float32Array(newLength); let offsetResult = 0, offsetBuffer = 0; while (offsetResult < result.length) { const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio); let accum = 0, count = 0; for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) { accum += buffer[i]; count++; } result[offsetResult] = accum / count; offsetResult++; offsetBuffer = nextOffsetBuffer; } return result; }
function floatTo16BitPCM(input) { const output = new Int16Array(input.length); for (let i = 0; i < input.length; i++) { const s = Math.max(-1, Math.min(1, input[i])); output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF; } return output.buffer; }
function arrayBufferToBase64(buffer) { let binary = ''; const bytes = new Uint8Array(buffer); for (let i = 0; i < bytes.byteLength; i++) { binary += String.fromCharCode(bytes[i]); } return window.btoa(binary); }
function updateMiniKarikari() { if(currentUser) { document.getElementById('mini-karikari-count').innerText = currentUser.karikari; document.getElementById('karikari-count').innerText = currentUser.karikari; } }
function showKarikariEffect(amount) { const container = document.querySelector('.nell-avatar-wrap'); if(container) { const floatText = document.createElement('div'); floatText.className = 'floating-text'; floatText.innerText = amount > 0 ? `+${amount}` : `${amount}`; floatText.style.color = amount > 0 ? '#ff9100' : '#ff5252'; floatText.style.right = '0px'; floatText.style.top = '0px'; container.appendChild(floatText); setTimeout(() => floatText.remove(), 1500); } const heartCont = document.getElementById('heart-container'); if(heartCont) { for(let i=0; i<8; i++) { const heart = document.createElement('div'); heart.className = 'heart-particle'; heart.innerText = amount > 0 ? '✨' : '💗'; heart.style.left = (Math.random()*80 + 10) + '%'; heart.style.top = (Math.random()*50 + 20) + '%'; heart.style.animationDelay = (Math.random()*0.5) + 's'; heartCont.appendChild(heart); setTimeout(() => heart.remove(), 1500); } } }
function revealAnswer() { document.getElementById('final-answer-text').innerText = selectedProblem.correct_answer; document.getElementById('answer-display-area').classList.remove('hidden'); document.getElementById('reveal-answer-btn').classList.add('hidden'); updateNellMessage("答えだにゃ", "gentle"); }
function renderProblemSelection() { document.getElementById('problem-selection-view').classList.remove('hidden'); const l=document.getElementById('transcribed-problem-list'); l.innerHTML=""; transcribedProblems.forEach(p=>{ l.innerHTML += `<div class="prob-card"><div><span class="q-label">${p.label||'?'}</span>${p.question.substring(0,20)}...</div><button class="main-btn blue-btn" style="width:auto;padding:10px" onclick="startHint(${p.id})">教えて</button></div>`; }); }
function showGradingView() { document.getElementById('grade-sheet-container').classList.remove('hidden'); document.getElementById('final-view').classList.remove('hidden'); const backBtn = document.getElementById('main-back-btn'); if(backBtn) backBtn.classList.add('hidden'); renderWorksheet(); }
function renderWorksheet() { const l=document.getElementById('problem-list-grade'); if(!l)return; l.innerHTML=""; transcribedProblems.forEach((p,i)=>{ l.innerHTML+=`<div class="problem-row"><div><span class="q-label">${p.label||'?'}</span>${p.question}</div><div style="display:flex;gap:5px"><input class="student-ans-input" value="${p.student_answer}" onchange="updateAns(${i},this.value)"><div class="judgment-mark ${p.status}">${p.status==='correct'?'⭕️':p.status==='incorrect'?'❌':''}</div><button class="mini-teach-btn" onclick="startHint(${p.id})">教えて</button></div></div>`; }); const f=document.createElement('div'); f.style.textAlign="center"; f.style.marginTop="20px"; f.innerHTML=`<button onclick="finishGrading()" class="main-btn orange-btn">✨ ぜんぶわかったにゃ！</button>`; l.appendChild(f); }

function updateAns(i, v) { 
    transcribedProblems[i].student_answer = v; 
    const n = val => val.toString().replace(/\s/g, '').replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)).replace(/cm|ｍ|ｍｍ|円|個|L/g, '').replace(/[×＊]/g, '*').replace(/[÷／]/g, '/');
    if (n(v) === n(transcribedProblems[i].correct_answer) && v !== "") { 
        transcribedProblems[i].status = 'correct'; 
        updateNellMessage("正解にゃ！修正ありがとうにゃ。", "happy"); 
        if (currentUser.mistakes) { currentUser.mistakes = currentUser.mistakes.filter(m => m.question !== transcribedProblems[i].question); }
    } else { 
        transcribedProblems[i].status = 'incorrect'; 
        updateNellMessage("まだ違うみたいだにゃ……", "thinking"); 
        if (!currentUser.mistakes.some(m => m.question === transcribedProblems[i].question)) { currentUser.mistakes.push({...transcribedProblems[i], subject: currentSubject}); }
    } 
    saveAndSync(); 
    renderWorksheet(); 
}

// ★修正: 1回押したらボタン無効化 + ロビー遷移
async function finishGrading() { 
    const btn = document.querySelector('button[onclick="finishGrading()"]');
    if(btn) btn.disabled = true;
    await updateNellMessage("よくがんばったにゃ！カリカリ100個あげるにゃ！", "excited"); 
    if (currentUser) { currentUser.karikari += 100; saveAndSync(); updateMiniKarikari(); showKarikariEffect(100); } 
    setTimeout(() => { backToLobby(true); }, 3000); 
}

// ★修正: 1回押したらボタン無効化 + ロビー遷移
function pressAllSolved() { 
    const btn = document.querySelector('button[onclick="pressAllSolved()"]');
    if(btn) btn.disabled = true;
    if (currentUser) {
        currentUser.karikari += 100; saveAndSync(); showKarikariEffect(100);
        updateNellMessage("よくがんばったにゃ！カリカリ100個あげるにゃ！", "excited")
        .then(() => { setTimeout(() => { backToLobby(true); }, 3000); });
    }
}
function pressThanks() { if(currentMode==='grade') showGradingView(); else backToProblemSelection(); }
function setSubject(s) { 
    currentSubject = s; 
    if(currentUser){currentUser.history[s]=(currentUser.history[s]||0)+1; saveAndSync();} 
    const icon = document.querySelector('.nell-avatar-wrap img'); if(icon&&subjectImages[s]){icon.src=subjectImages[s];icon.onerror=()=>{icon.src=defaultIcon;};} 
    document.getElementById('subject-selection-view').classList.add('hidden'); 
    document.getElementById('upload-controls').classList.remove('hidden'); 
    updateNellMessage(`${currentSubject}の問題をみせてにゃ！`, "happy"); 
}

// Webカメラ関連 (anlyze.js内の宿題撮影用は削除し、user.jsと競合しないようにするか、もしくは共通関数として切り出す)
// 今回は宿題撮影用のカメラロジックをここに書く
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
    } catch (err) {
        alert("カメラを起動できなかったにゃ…設定を確認してにゃ。");
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
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
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
// イベントリスナー (宿題用)
const startWebcamBtn = document.getElementById('start-webcam-btn');
if (startWebcamBtn) startWebcamBtn.addEventListener('click', startWebCamera);
// 共通シャッター・キャンセルボタンはここで設定するとuser.jsと競合するため、
// user.js側で入学用、こちらで宿題用と使い分けるか、IDを分ける必要がある。
// 今回のHTMLではIDが共通なので、フラグで制御するか、イベントを上書きする。
// 簡単のため、startWebCamera時にonclickを上書きする方式をとる。
// (startWebCamera関数内でonclickを設定)

// ★修正: startWebCamera内でボタンイベントを上書き
async function startWebCamera_Safe() {
    const modal = document.getElementById('camera-modal');
    const video = document.getElementById('camera-video');
    const shutter = document.getElementById('camera-shutter-btn');
    const cancel = document.getElementById('camera-cancel-btn');

    if (!modal || !video) return;

    try {
        const constraints = { video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } };
        videoStream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = videoStream;
        video.onloadedmetadata = () => { video.play(); };
        modal.classList.remove('hidden');
        updateNellMessage("枠の中に宿題を入れて、ボタンを押してにゃ！", "normal");

        // 宿題撮影用の処理を割り当て
        shutter.onclick = takePicture;
        cancel.onclick = closeWebCamera;

    } catch (err) {
        alert("カメラを起動できなかったにゃ…");
        closeWebCamera();
    }
}
if (startWebcamBtn) startWebcamBtn.onclick = startWebCamera_Safe; // addEventListenerではなく上書き

function renderMistakeSelection() { if (!currentUser.mistakes || currentUser.mistakes.length === 0) { updateNellMessage("ノートは空っぽにゃ！", "happy"); setTimeout(backToLobby, 2000); return; } transcribedProblems = currentUser.mistakes; renderProblemSelection(); updateNellMessage("復習するにゃ？", "excited"); }