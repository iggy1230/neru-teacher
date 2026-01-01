// --- anlyze.js (口パクアニメーション完全実装版) ---

let transcribedProblems = []; 
let selectedProblem = null; 
let hintIndex = 0; 
let isAnalyzing = false; 
let currentSubject = '';
let currentMode = ''; 
let lunchCount = 0; 

// Live Chat Variables
let liveSocket = null;
let audioContext = null;
let mediaStream = null;
let workletNode = null;
let nextStartTime = 0;

// 口パク制御用カウンタ（Live Chatの重複再生対策）
let activeAudioCount = 0;

// ゲーム用
let gameCanvas, ctx, ball, paddle, bricks, score, gameRunning = false, gameAnimId = null;

const subjectImages = {
    'こくご': 'nell-kokugo.png', 'さんすう': 'nell-sansu.png',
    'りか': 'nell-rika.png', 'しゃかい': 'nell-shakai.png'
};
const defaultIcon = 'nell-normal.png'; // ★デフォルトを口閉じ画像に

// ==========================================
// ★口パクアニメーションループ
// ==========================================
function startMouthAnimation() {
    setInterval(() => {
        const img = document.querySelector('.nell-avatar-wrap img');
        if (!img) return;

        // グローバル変数が true なら口パク
        if (window.isNellSpeaking) {
            // 画像名を取得して切り替え
            const currentSrc = img.src.split('/').pop();
            if (currentSrc.includes('nell-normal')) {
                // 教科別画像などが設定されている場合はそちらの「口開き版」があれば良いが、
                // ここではシンプルに基本の口パク画像に切り替える
                img.src = 'nell-talk.png';
            } else {
                // 元の画像（教科別 or ノーマル）に戻す必要があるが、
                // 簡易的に currentSubject に応じた画像 or ノーマルに戻す
                if (currentSubject && subjectImages[currentSubject] && currentMode !== 'chat' && currentMode !== 'lunch') {
                    img.src = subjectImages[currentSubject];
                } else {
                    img.src = 'nell-normal.png';
                }
            }
        } else {
            // 喋っていない時は口を閉じる（教科画像 or ノーマル）
            const currentSrc = img.src.split('/').pop();
            if (currentSrc.includes('nell-talk')) {
                if (currentSubject && subjectImages[currentSubject] && currentMode !== 'chat' && currentMode !== 'lunch') {
                    img.src = subjectImages[currentSubject];
                } else {
                    img.src = 'nell-normal.png';
                }
            }
        }
    }, 150); // 0.15秒間隔でパカパカ
}

// 起動時にアニメーション監視を開始
startMouthAnimation();


// ==========================================
// 1. モード選択
// ==========================================
function selectMode(m) {
    currentMode = m; 
    switchScreen('screen-main'); 
    
    const ids = ['subject-selection-view', 'upload-controls', 'thinking-view', 'problem-selection-view', 'final-view', 'chalkboard', 'chat-view', 'lunch-view'];
    ids.forEach(id => document.getElementById(id).classList.add('hidden'));
    
    stopLiveChat();
    gameRunning = false;

    const icon = document.querySelector('.nell-avatar-wrap img');
    if(icon) icon.src = defaultIcon;

    document.getElementById('mini-karikari-display').classList.remove('hidden');
    updateMiniKarikari();

    if (m === 'chat') {
        document.getElementById('chat-view').classList.remove('hidden');
        updateNellMessage("「おはなしする」を押してね！", "gentle");
        const btn = document.getElementById('mic-btn');
        btn.innerText = "🎤 おはなしする";
        btn.onclick = startLiveChat;
        btn.disabled = false;
        btn.style.background = "#ff85a1";
        document.getElementById('user-speech-text').innerText = "（リアルタイム対話）";
    } else if (m === 'lunch') {
        document.getElementById('lunch-view').classList.remove('hidden');
        lunchCount = 0;
        updateNellMessage("お腹ペコペコだにゃ……", "thinking");
    } else if (m === 'review') {
        renderMistakeSelection();
    } else {
        document.getElementById('subject-selection-view').classList.remove('hidden');
        updateNellMessage("どの教科にするのかにゃ？", "normal");
    }
}

// ==========================================
// 2. Live Chat (AudioWorklet + 接続待機)
// ==========================================
async function startLiveChat() {
    const btn = document.getElementById('mic-btn');
    if (liveSocket) { stopLiveChat(); return; }

    try {
        updateNellMessage("ネル先生を呼んでるにゃ……", "thinking");
        btn.disabled = true;

        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioCtx();
        await audioContext.resume();
        nextStartTime = audioContext.currentTime;

        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        liveSocket = new WebSocket(`${wsProtocol}//${window.location.host}`);
        liveSocket.binaryType = "blob";

        liveSocket.onopen = () => { console.log("WS Open"); };

        liveSocket.onmessage = async (event) => {
            let data;
            if (event.data instanceof Blob) {
                const text = await event.data.text();
                try { data = JSON.parse(text); } catch(e){ return; }
            } else {
                try { data = JSON.parse(event.data); } catch(e){ return; }
            }

            if (data.type === "server_ready") {
                btn.innerText = "📞 つながった！(終了)";
                btn.style.background = "#ff5252";
                btn.disabled = false;
                updateNellMessage("お待たせ！なんでも話してにゃ！", "happy");
                await startMicrophone();
            }

            if (data.serverContent?.modelTurn?.parts?.[0]?.inlineData) {
                // ★口パク連動再生
                playPcmAudio(data.serverContent.modelTurn.parts[0].inlineData.data);
            }
        };

        liveSocket.onclose = () => stopLiveChat();
        liveSocket.onerror = (e) => { console.error(e); stopLiveChat(); };

    } catch (e) {
        console.error("Start Error:", e);
        alert("エラー: " + e.message);
        stopLiveChat();
    }
}

function stopLiveChat() {
    if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
    if (workletNode) { workletNode.port.postMessage('stop'); workletNode.disconnect(); workletNode = null; }
    if (liveSocket) { liveSocket.close(); liveSocket = null; }
    if (audioContext) { audioContext.close(); audioContext = null; }
    
    // ★停止時に口パクも強制停止
    window.isNellSpeaking = false;
    activeAudioCount = 0;

    const btn = document.getElementById('mic-btn');
    if (btn) {
        btn.innerText = "🎤 おはなしする";
        btn.style.background = "#ff85a1";
        btn.disabled = false;
        btn.onclick = startLiveChat;
    }
}

async function startMicrophone() {
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ 
            audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true } 
        });

        const processorCode = `
            class PcmProcessor extends AudioWorkletProcessor {
                constructor() { super(); this.bufferSize = 4096; this.buffer = new Float32Array(this.bufferSize); this.index = 0; }
                process(inputs, outputs, parameters) {
                    const input = inputs[0];
                    if (input.length > 0) {
                        const channel = input[0];
                        for (let i = 0; i < channel.length; i++) {
                            this.buffer[this.index++] = channel[i];
                            if (this.index >= this.bufferSize) {
                                this.port.postMessage(this.buffer.slice(0, this.bufferSize));
                                this.index = 0;
                            }
                        }
                    }
                    return true;
                }
            }
            registerProcessor('pcm-processor', PcmProcessor);
        `;
        
        const blob = new Blob([processorCode], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        await audioContext.audioWorklet.addModule(url);

        const source = audioContext.createMediaStreamSource(mediaStream);
        workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');
        source.connect(workletNode);

        workletNode.port.onmessage = (event) => {
            if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) return;
            const inputData = event.data;
            const downsampled = downsampleBuffer(inputData, audioContext.sampleRate, 16000);
            const pcm16 = floatTo16BitPCM(downsampled);
            const base64 = arrayBufferToBase64(pcm16);
            liveSocket.send(JSON.stringify({ type: 'audio', data: base64 }));
        };
    } catch(e) {
        console.error("Mic Error:", e);
        updateNellMessage("マイク設定エラーだにゃ……", "thinking");
    }
}

// ★口パク対応 PCM再生
function playPcmAudio(base64) { 
    if (!audioContext) return; 
    const binary = window.atob(base64); 
    const bytes = new Uint8Array(binary.length); 
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); 
    const float32 = new Float32Array(bytes.length / 2); 
    const view = new DataView(bytes.buffer); 
    for (let i = 0; i < float32.length; i++) float32[i] = view.getInt16(i * 2, true) / 32768.0; 
    
    const buffer = audioContext.createBuffer(1, float32.length, 24000); 
    buffer.copyToChannel(float32, 0); 
    const source = audioContext.createBufferSource(); 
    source.buffer = buffer; 
    source.connect(audioContext.destination); 
    
    const now = audioContext.currentTime; 
    if (nextStartTime < now) nextStartTime = now; 
    source.start(nextStartTime); 
    nextStartTime += buffer.duration; 

    // ★口パク開始
    window.isNellSpeaking = true;
    activeAudioCount++;

    source.onended = () => {
        activeAudioCount--;
        // 他に再生中の音声がなければ口パク終了
        if (activeAudioCount <= 0) {
            activeAudioCount = 0;
            window.isNellSpeaking = false;
        }
    };
}

// 3. 給食 & ゲーム & その他
function giveLunch() {
    if (currentUser.karikari < 1) return updateNellMessage("カリカリがないにゃ……", "thinking");
    currentUser.karikari--; saveAndSync(); updateMiniKarikari(); showKarikariEffect(-1); lunchCount++;
    updateNellMessage("もぐもぐ……", "normal");
    fetch('/lunch-reaction', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: lunchCount, name: currentUser.name })
    }).then(r=>r.json()).then(d=>{
        updateNellMessage(d.reply || "おいしいにゃ！", d.isSpecial ? "excited" : "happy");
    }).catch(e=>{ updateNellMessage("おいしいにゃ！", "happy"); });
}

function showGame() {
    switchScreen('screen-game');
    document.getElementById('mini-karikari-display').classList.remove('hidden');
    updateMiniKarikari();
    initGame();
    const startBtn = document.getElementById('start-game-btn');
    startBtn.onclick = () => {
        if (!gameRunning) { initGame(); gameRunning = true; startBtn.disabled = true; drawGame(); }
    };
}
function initGame() {
    gameCanvas = document.getElementById('game-canvas'); if(!gameCanvas) return;
    ctx = gameCanvas.getContext('2d');
    paddle = { w: 80, h: 10, x: 120, speed: 7 };
    ball = { x: 160, y: 350, dx: 3, dy: -3, r: 8 };
    score = 0; document.getElementById('game-score').innerText = score;
    bricks = []; const cols = 5, rows = 4, padding = 10, brickW = (gameCanvas.width - (padding * (cols + 1))) / cols;
    for(let c=0; c<cols; c++) for(let r=0; r<rows; r++) bricks.push({ x: c*(brickW+padding)+padding, y: r*(25+padding)+40, status: 1 });
    gameCanvas.removeEventListener("mousemove", movePaddle); gameCanvas.removeEventListener("touchmove", touchPaddle);
    gameCanvas.addEventListener("mousemove", movePaddle, false); gameCanvas.addEventListener("touchmove", touchPaddle, { passive: false });
}
function movePaddle(e) { const r = gameCanvas.getBoundingClientRect(), rx = e.clientX - r.left; if(rx>0 && rx<gameCanvas.width) paddle.x = rx - paddle.w/2; }
function touchPaddle(e) { e.preventDefault(); const r = gameCanvas.getBoundingClientRect(), rx = e.touches[0].clientX - r.left; if(rx>0 && rx<gameCanvas.width) paddle.x = rx - paddle.w/2; }
function drawGame() {
    if (!gameRunning) return;
    ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
    ctx.font = "20px serif";
    bricks.forEach(b => { if(b.status === 1) ctx.fillText("🍖", b.x + 10, b.y + 20); });
    ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI*2); ctx.fillStyle = "#ff85a1"; ctx.fill(); ctx.closePath();
    ctx.fillStyle = "#4a90e2"; ctx.fillRect(paddle.x, gameCanvas.height - paddle.h - 10, paddle.w, paddle.h);
    bricks.forEach(b => { if(b.status === 1 && ball.x > b.x && ball.x < b.x + 40 && ball.y > b.y && ball.y < b.y + 30) { ball.dy *= -1; b.status = 0; score++; document.getElementById('game-score').innerText = score; if(score === bricks.length) endGame(true); } });
    if(ball.x + ball.dx > gameCanvas.width - ball.r || ball.x + ball.dx < ball.r) ball.dx *= -1; if(ball.y + ball.dy < ball.r) ball.dy *= -1; else if(ball.y + ball.dy > gameCanvas.height - ball.r - 20) { if(ball.x > paddle.x && ball.x < paddle.x + paddle.w) { ball.dy *= -1; ball.dx = (ball.x - (paddle.x + paddle.w/2)) * 0.15; } else if(ball.y + ball.dy > gameCanvas.height - ball.r) { endGame(false); return; } } ball.x += ball.dx; ball.y += ball.dy; gameAnimId = requestAnimationFrame(drawGame);
}
function endGame(c) { gameRunning=false; if(gameAnimId)cancelAnimationFrame(gameAnimId); const s=document.getElementById('start-game-btn'); if(s){s.disabled=false;s.innerText="もう一回！";} alert(c ? `すごい！全クリ！\n+${score}個` : `おしい！\n+${score}個`); if(currentUser&&score>0){currentUser.karikari+=score;saveAndSync();updateMiniKarikari();showKarikariEffect(score);} }

// Utils & Helpers
function updateMiniKarikari() { if(currentUser) { document.getElementById('mini-karikari-count').innerText = currentUser.karikari; document.getElementById('karikari-count').innerText = currentUser.karikari; } }
function showKarikariEffect(amount) { const container = document.querySelector('.nell-avatar-wrap'); if(container) { const floatText = document.createElement('div'); floatText.className = 'floating-text'; floatText.innerText = amount > 0 ? `+${amount}` : `${amount}`; floatText.style.color = amount > 0 ? '#ff9100' : '#ff5252'; floatText.style.right = '0px'; floatText.style.top = '0px'; container.appendChild(floatText); setTimeout(() => floatText.remove(), 1500); } const heartCont = document.getElementById('heart-container'); if(heartCont) { for(let i=0; i<8; i++) { const heart = document.createElement('div'); heart.className = 'heart-particle'; heart.innerText = amount > 0 ? '✨' : '💗'; heart.style.left = (Math.random()*80 + 10) + '%'; heart.style.top = (Math.random()*50 + 20) + '%'; heart.style.animationDelay = (Math.random()*0.5) + 's'; heartCont.appendChild(heart); setTimeout(() => heart.remove(), 1500); } } }
function revealAnswer() { document.getElementById('final-answer-text').innerText = selectedProblem.correct_answer; document.getElementById('answer-display-area').classList.remove('hidden'); document.getElementById('reveal-answer-btn').classList.add('hidden'); updateNellMessage("答えだにゃ", "gentle"); }
function renderProblemSelection() { document.getElementById('problem-selection-view').classList.remove('hidden'); const l=document.getElementById('transcribed-problem-list'); l.innerHTML=""; transcribedProblems.forEach(p=>{ l.innerHTML += `<div class="prob-card"><div><span class="q-label">${p.label||'?'}</span>${p.question.substring(0,20)}...</div><button class="main-btn blue-btn" style="width:auto;padding:10px" onclick="startHint(${p.id})">教えて</button></div>`; }); }
function showGradingView() { document.getElementById('final-view').classList.remove('hidden'); document.getElementById('grade-sheet-container').classList.remove('hidden'); renderWorksheet(); }
function renderWorksheet() { const l=document.getElementById('problem-list-grade'); l.innerHTML=""; transcribedProblems.forEach((p,i)=>{ l.innerHTML+=`<div class="problem-row"><div><span class="q-label">${p.label||'?'}</span>${p.question}</div><div style="display:flex;gap:5px"><input class="student-ans-input" value="${p.student_answer}" onchange="updateAns(${i},this.value)"><div class="judgment-mark ${p.status}">${p.status==='correct'?'⭕️':p.status==='incorrect'?'❌':''}</div><button class="mini-teach-btn" onclick="startHint(${p.id})">教えて</button></div></div>`; }); const f=document.createElement('div'); f.style.textAlign="center"; f.style.marginTop="20px"; f.innerHTML=`<button onclick="finishGrading()" class="main-btn orange-btn">✨ 全部わかった！</button>`; l.appendChild(f); }
function updateAns(i,v) { transcribedProblems[i].student_answer=v; const n = v => v.toString().replace(/\s/g, '').replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)).replace(/cm|ｍ|ｍｍ|円|個/g, '').replace(/[×＊]/g, '*').replace(/[÷／]/g, '/'); if (n(v) === n(transcribedProblems[i].correct_answer) && v !== "") { transcribedProblems[i].status = 'correct'; updateNellMessage("正解にゃ！", "happy"); if (currentUser.mistakes) currentUser.mistakes = currentUser.mistakes.filter(m => m.question !== transcribedProblems[i].question); } else { transcribedProblems[i].status = 'incorrect'; updateNellMessage("まだ違うにゃ……", "thinking"); if (!currentUser.mistakes.some(m => m.question === transcribedProblems[i].question)) currentUser.mistakes.push({...transcribedProblems[i], subject: currentSubject}); } saveAndSync(); renderWorksheet(); }
async function finishGrading() { await updateNellMessage("よくがんばったにゃ！お疲れさまにゃ✨", "excited"); if (currentUser) { currentUser.karikari += 100; saveAndSync(); updateMiniKarikari(); showKarikariEffect(100); } setTimeout(backToLobby, 2000); }
function pressAllSolved() { currentUser.karikari+=100; saveAndSync(); backToLobby(); showKarikariEffect(100); }
function pressThanks() { if(currentMode==='grade') showGradingView(); else backToProblemSelection(); }
function setSubject(s) { currentSubject = s; if(currentUser){currentUser.history[s]=(currentUser.history[s]||0)+1; saveAndSync();} const icon = document.querySelector('.nell-avatar-wrap img'); if(icon&&subjectImages[s]){icon.src=subjectImages[s];icon.onerror=()=>{icon.src=defaultIcon;};} document.getElementById('subject-selection-view').classList.add('hidden'); document.getElementById('upload-controls').classList.remove('hidden'); updateNellMessage(`${currentSubject}の問題をみせてにゃ！`, "happy"); }
async function shrinkImage(file) { return new Promise((r)=>{ const reader=new FileReader(); reader.readAsDataURL(file); reader.onload=e=>{ const img=new Image(); img.onload=()=>{ const c=document.createElement('canvas'); let w=img.width,h=img.height; if(w>1600||h>1600){if(w>h){h*=1600/w;w=1600}else{w*=1600/h;h=1600}} c.width=w;c.height=h; c.getContext('2d').drawImage(img,0,0,w,h); r(c.toDataURL('image/jpeg',0.9).split(',')[1]); }; img.src=e.target.result; }; }); }
function renderMistakeSelection() { if (!currentUser.mistakes || currentUser.mistakes.length === 0) { updateNellMessage("ノートは空っぽにゃ！", "happy"); setTimeout(backToLobby, 2000); return; } transcribedProblems = currentUser.mistakes; renderProblemSelection(); updateNellMessage("復習するにゃ？", "excited"); }

// Audio Utils
function downsampleBuffer(buffer, sampleRate, outSampleRate) { if (outSampleRate >= sampleRate) return buffer; const ratio = sampleRate / outSampleRate; const newLength = Math.round(buffer.length / ratio); const result = new Float32Array(newLength); let offsetResult = 0, offsetBuffer = 0; while (offsetResult < result.length) { const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio); let accum = 0, count = 0; for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) { accum += buffer[i]; count++; } result[offsetResult] = accum / count; offsetResult++; offsetBuffer = nextOffsetBuffer; } return result; }
function floatTo16BitPCM(input) { const output = new Int16Array(input.length); for (let i = 0; i < input.length; i++) { const s = Math.max(-1, Math.min(1, input[i])); output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF; } return output.buffer; }
function arrayBufferToBase64(buffer) { let binary = ''; const bytes = new Uint8Array(buffer); for (let i = 0; i < bytes.byteLength; i++) { binary += String.fromCharCode(bytes[i]); } return window.btoa(binary); }