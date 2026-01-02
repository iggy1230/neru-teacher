// --- anlyze.js (記憶機能実装版) ---

let transcribedProblems = []; 
let selectedProblem = null; 
let hintIndex = 0; 
let isAnalyzing = false; 
let currentSubject = '';
let currentMode = ''; 
let lunchCount = 0; 
let recognition = null;

// ★会話ログ・記憶用
let chatLog = [];

// Game
let gameCanvas, ctx, ball, paddle, bricks, score, gameRunning = false, gameAnimId = null;

const subjectImages = {
    'こくご': 'nell-kokugo.png', 'さんすう': 'nell-sansu.png',
    'りか': 'nell-rika.png', 'しゃかい': 'nell-shakai.png'
};
const defaultIcon = 'nell-icon.png';
const talkIcon = 'nell-talk.png';

// 口パク
function startMouthAnimation() {
    let toggle = false;
    setInterval(() => {
        const img = document.querySelector('.nell-avatar-wrap img');
        if (!img) return;
        if (window.isNellSpeaking) {
            toggle = !toggle;
            img.src = toggle ? talkIcon : (currentSubject && subjectImages[currentSubject] && currentMode !== 'chat' ? subjectImages[currentSubject] : defaultIcon);
        } else {
            if (img.src.includes('nell-talk')) img.src = (currentSubject && subjectImages[currentSubject] && currentMode !== 'chat' ? subjectImages[currentSubject] : defaultIcon);
        }
    }, 150);
}
startMouthAnimation();

// 1. モード選択
function selectMode(m) {
    // 前のモードがチャットなら記憶を保存して終了
    if (currentMode === 'chat') finishChatSession();
    
    currentMode = m; 
    switchScreen('screen-main'); 
    
    const ids = ['subject-selection-view', 'upload-controls', 'thinking-view', 'problem-selection-view', 'final-view', 'chalkboard', 'chat-view', 'lunch-view'];
    ids.forEach(id => document.getElementById(id).classList.add('hidden'));
    
    stopChatMode(); // マイク停止
    gameRunning = false;
    chatLog = []; // ログリセット

    const icon = document.querySelector('.nell-avatar-wrap img');
    if(icon) icon.src = defaultIcon;

    document.getElementById('mini-karikari-display').classList.remove('hidden');
    updateMiniKarikari();

    if (m === 'chat') {
        document.getElementById('chat-view').classList.remove('hidden');
        // ★記憶があれば挨拶を変える
        const greeting = currentUser.memory ? `また会えたにゃ！${currentUser.memory}` : "悩み事があるのかにゃ？何でも聞いてあげるにゃ。";
        updateNellMessage(greeting, "gentle");
        
        const btn = document.getElementById('mic-btn');
        btn.innerText = "🎤 おはなしする";
        btn.onclick = startConversation;
        btn.disabled = false;
        btn.style.background = "#ff85a1";
        document.getElementById('user-speech-text').innerText = "（マイクを使ってお話します）";

    } else if (m === 'lunch') {
        document.getElementById('lunch-view').classList.remove('hidden');
        updateNellMessage("お腹ペコペコだにゃ……カリカリ持ってる？", "thinking");
    } else if (m === 'review') {
        renderMistakeSelection();
    } else {
        document.getElementById('subject-selection-view').classList.remove('hidden');
        updateNellMessage("どの教科にするのかにゃ？", "normal");
    }
}

// ★記憶の保存処理
async function finishChatSession() {
    if (chatLog.length < 2) return; // 会話が少なければ保存しない
    
    try {
        // 直近の数往復だけ送る
        const recentLog = chatLog.slice(-6);
        const res = await fetch('/summarize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ history: recentLog })
        });
        const data = await res.json();
        if (data.memory) {
            currentUser.memory = data.memory;
            saveAndSync();
            console.log("Memory saved:", data.memory);
        }
    } catch(e) { console.error("Memory save failed", e); }
}

// 2. こじんめんだん (SpeechRecognition + Memory)
function startConversation() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return alert("Chromeを使ってにゃ");

    if (recognition) { 
        stopChatMode(); 
        // 停止時に記憶保存
        finishChatSession();
        return; 
    }
    if (typeof initAudioEngine === 'function') initAudioEngine();

    recognition = new SpeechRecognition();
    recognition.lang = 'ja-JP';
    recognition.maxAlternatives = 1;

    const btn = document.getElementById('mic-btn');
    const txt = document.getElementById('user-speech-text');

    recognition.onstart = () => {
        btn.innerText = "👂 聞いてるにゃ...";
        btn.style.background = "#ff5252";
        btn.disabled = true;
        startVisualizer();
    };
    recognition.onend = () => { if (btn.innerText.includes("聞いてる")) stopChatMode(); };
    
    recognition.onresult = async (event) => {
        const text = event.results[0][0].transcript;
        txt.innerText = `「${text}」`;
        stopVisualizer();
        btn.innerText = "🤔 考え中にゃ...";
        btn.style.background = "#ffb74d";
        
        // ★ログに追加
        chatLog.push({ role: "student", text: text });

        try {
            const res = await fetch('/chat', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    message: text, 
                    grade: currentUser.grade, 
                    name: currentUser.name,
                    memory: currentUser.memory // ★記憶を送る
                })
            });
            const data = await res.json();
            const reply = data.reply;
            
            // ★ログに追加
            chatLog.push({ role: "nell", text: reply });
            
            await updateNellMessage(reply, "gentle");
        } catch (e) { updateNellMessage("通信エラーだにゃ……", "thinking"); } 
        finally { stopChatMode(); }
    };
    try { recognition.start(); } catch(e) { stopChatMode(); }
}

function stopChatMode() {
    if (recognition) { try { recognition.stop(); } catch(e){} recognition = null; }
    stopVisualizer();
    const btn = document.getElementById('mic-btn');
    if (btn) {
        btn.innerText = "🎤 おはなしする";
        btn.style.background = "#ff85a1";
        btn.style.boxShadow = "none";
        btn.disabled = false;
        btn.onclick = startConversation;
    }
}

// (Live Chat WebSocket版の関数も念のため残す場合は、URLにmemoryパラメータを追加します)
// const url = `ws://${window.location.host}?grade=${currentUser.grade}&memory=${encodeURIComponent(currentUser.memory||"")}`;

// ... (以下、ビジュアライザー、給食、ゲーム、分析などの関数は変更なし) ...
let visCtx, visStream, visAnalyser, visFrame;
async function startVisualizer() { try { if (!navigator.mediaDevices) return; visStream = await navigator.mediaDevices.getUserMedia({ audio: true }); const AudioCtx = window.AudioContext || window.webkitAudioContext; visCtx = new AudioCtx(); const source = visCtx.createMediaStreamSource(visStream); visAnalyser = visCtx.createAnalyser(); visAnalyser.fftSize = 32; source.connect(visAnalyser); const dataArray = new Uint8Array(visAnalyser.frequencyBinCount); const btn = document.getElementById('mic-btn'); const draw = () => { if (!visAnalyser) return; visAnalyser.getByteFrequencyData(dataArray); let sum = 0; for(let i=0; i<dataArray.length; i++) sum += dataArray[i]; const avg = sum / dataArray.length; if (avg > 10 && btn) { const scale = 1 + (avg / 255) * 0.2; btn.style.transform = `scale(${scale})`; btn.style.boxShadow = `0 0 ${avg/5}px #ffeb3b`; } else if (btn) { btn.style.transform = "scale(1)"; btn.style.boxShadow = "none"; } visFrame = requestAnimationFrame(draw); }; draw(); } catch (e) {} }
function stopVisualizer() { if (visFrame) cancelAnimationFrame(visFrame); if (visStream) visStream.getTracks().forEach(t => t.stop()); if (visCtx) visCtx.close(); visStream = null; visCtx = null; visAnalyser = null; }
function giveLunch() { if (currentUser.karikari < 1) return updateNellMessage("カリカリがないにゃ……", "thinking"); currentUser.karikari--; saveAndSync(); updateMiniKarikari(); showKarikariEffect(-1); lunchCount++; updateNellMessage("もぐもぐ……", "normal"); fetch('/lunch-reaction', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count: lunchCount, name: currentUser.name }) }).then(r=>r.json()).then(d=>{ updateNellMessage(d.reply || "おいしいにゃ！", d.isSpecial ? "excited" : "happy"); }).catch(e=>{ updateNellMessage("おいしいにゃ！", "happy"); }); }
function showGame() { switchScreen('screen-game'); document.getElementById('mini-karikari-display').classList.remove('hidden'); updateMiniKarikari(); initGame(); const s=document.getElementById('start-game-btn'); if(s) s.onclick = ()=>{ if(!gameRunning){ initGame(); gameRunning=true; s.disabled=true; drawGame(); } }; }
function initGame() { gameCanvas=document.getElementById('game-canvas'); if(!gameCanvas)return; ctx=gameCanvas.getContext('2d'); paddle={w:80,h:10,x:120,speed:7}; ball={x:160,y:350,dx:3,dy:-3,r:8}; score=0; const s=document.getElementById('game-score'); if(s)s.innerText=score; bricks=[]; for(let c=0;c<5;c++)for(let r=0;r<4;r++)bricks.push({x:c*64+10,y:r*35+40,status:1}); gameCanvas.removeEventListener("mousemove",movePaddle); gameCanvas.removeEventListener("touchmove",touchPaddle); gameCanvas.addEventListener("mousemove",movePaddle,false); gameCanvas.addEventListener("touchmove",touchPaddle,{passive:false}); }
function movePaddle(e) { const r=gameCanvas.getBoundingClientRect(), rx=e.clientX-r.left; if(rx>0&&rx<gameCanvas.width) paddle.x=rx-paddle.w/2; }
function touchPaddle(e) { e.preventDefault(); const r=gameCanvas.getBoundingClientRect(), rx=e.touches[0].clientX-r.left; if(rx>0&&rx<gameCanvas.width) paddle.x=rx-paddle.w/2; }
function drawGame() { if(!gameRunning)return; ctx.clearRect(0,0,gameCanvas.width,gameCanvas.height); ctx.font="20px serif"; bricks.forEach(b=>{if(b.status===1)ctx.fillText("🍖",b.x+10,b.y+20)}); ctx.beginPath(); ctx.arc(ball.x,ball.y,ball.r,0,Math.PI*2); ctx.fillStyle="#ff85a1"; ctx.fill(); ctx.closePath(); ctx.fillStyle="#4a90e2"; ctx.fillRect(paddle.x,gameCanvas.height-paddle.h-10,paddle.w,paddle.h); bricks.forEach(b=>{ if(b.status===1 && ball.x>b.x && ball.x<b.x+40 && ball.y>b.y && ball.y<b.y+30){ ball.dy*=-1; b.status=0; score++; document.getElementById('game-score').innerText=score; if(score===bricks.length)endGame(true); } }); if(ball.x+ball.dx>gameCanvas.width-ball.r||ball.x+ball.dx<ball.r)ball.dx*=-1; if(ball.y+ball.dy<ball.r)ball.dy*=-1; else if(ball.y+ball.dy>gameCanvas.height-ball.r-20){ if(ball.x>paddle.x&&ball.x<paddle.x+paddle.w){ ball.dy*=-1; ball.dx=(ball.x-(paddle.x+paddle.w/2))*0.15; } else if(ball.y+ball.dy>gameCanvas.height-ball.r) { endGame(false); return; } } ball.x+=ball.dx; ball.y+=ball.dy; gameAnimId=requestAnimationFrame(drawGame); }
function endGame(c) { gameRunning=false; if(gameAnimId)cancelAnimationFrame(gameAnimId); const s=document.getElementById('start-game-btn'); if(s){s.disabled=false;s.innerText="もう一回！";} alert(c?`すごい！全クリだにゃ！\nカリカリ ${score} 個ゲット！`:`おしい！\nカリカリ ${score} 個ゲット！`); if(currentUser&&score>0){currentUser.karikari+=score;saveAndSync();updateMiniKarikari();showKarikariEffect(score);} }
document.getElementById('hw-input').addEventListener('change', async (e) => { if (isAnalyzing || !e.target.files[0]) return; isAnalyzing = true; const up = document.getElementById('upload-controls'); if(up) up.classList.add('hidden'); const th = document.getElementById('thinking-view'); if(th) th.classList.remove('hidden'); updateNellMessage("準備中……", "thinking"); updateProgress(0); let p = 0; const timer = setInterval(() => { if (p < 90) { p += 3; updateProgress(p); } }, 500); try { const b64 = await shrinkImage(e.target.files[0]); const res = await fetch('/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: b64, mode: currentMode, grade: currentUser.grade, subject: currentSubject }) }); if (!res.ok) throw new Error("Err"); const data = await res.json(); transcribedProblems = data.map((prob, index) => ({ ...prob, id: index + 1, student_answer: prob.student_answer || "", status: "unanswered" })); transcribedProblems.forEach(p => { const n = v => v.toString().replace(/\s|[０-９]|cm|ｍ/g, s => s==='cm'||s==='ｍ'?'':String.fromCharCode(s.charCodeAt(0)-0xFEE0)).replace(/×/g,'*').replace(/÷/g,'/'); if(p.student_answer && n(p.student_answer) === n(p.correct_answer)) p.status = 'correct'; else if(p.student_answer) p.status = 'incorrect'; }); clearInterval(timer); updateProgress(100); setTimeout(() => { if(th) th.classList.add('hidden'); if (currentMode === 'explain' || currentMode === 'review') { renderProblemSelection(); updateNellMessage("問題が読めたにゃ！", "happy"); } else { showGradingView(); const total = transcribedProblems.length; const correct = transcribedProblems.filter(p => p.status === 'correct').length; const rate = correct / total; if (correct === total) { currentUser.karikari += 100; saveAndSync(); updateMiniKarikari(); showKarikariEffect(100); updateNellMessage("全問正解！ご褒美100個にゃ！✨", "excited"); drawHanamaru(); } else if (rate >= 0.8) { currentUser.karikari += 50; saveAndSync(); updateMiniKarikari(); showKarikariEffect(50); updateNellMessage("ほとんど正解！50個あげるにゃ🐾", "happy"); } else { updateNellMessage("採点したにゃ。間違えた所は「教えて」ボタンを使ってね。", "gentle"); } } }, 800); } catch (err) { clearInterval(timer); if(th) th.classList.add('hidden'); if(up) up.classList.remove('hidden'); updateNellMessage("エラーだにゃ", "thinking"); } finally { isAnalyzing = false; e.target.value=''; } });
function startHint(id) { selectedProblem = transcribedProblems.find(p => p.id == id); if (!selectedProblem) return updateNellMessage("データなし", "thinking"); document.getElementById('problem-selection-view').classList.add('hidden'); document.getElementById('grade-sheet-container').classList.add('hidden'); document.getElementById('final-view').classList.remove('hidden'); document.getElementById('hint-detail-container').classList.remove('hidden'); document.getElementById('chalkboard').innerText = selectedProblem.question; document.getElementById('chalkboard').classList.remove('hidden'); document.getElementById('answer-display-area').classList.add('hidden'); hintIndex = 0; updateNellMessage("カリカリをくれたらヒントを出してあげてもいいにゃ🐾", "thinking"); document.getElementById('hint-step-label').innerText = "考え中..."; const nextBtn = document.getElementById('next-hint-btn'); const revealBtn = document.getElementById('reveal-answer-btn'); nextBtn.innerText = "🍖 ネル先生にカリカリを5個あげてヒントをもらう"; nextBtn.classList.remove('hidden'); revealBtn.classList.add('hidden'); nextBtn.onclick = showNextHint; }
function showNextHint() { let cost = 0; if (hintIndex === 0) cost = 5; else if (hintIndex === 1) cost = 5; else if (hintIndex === 2) cost = 10; if (currentUser.karikari < cost) return updateNellMessage(`カリカリが足りないにゃ……あと${cost}個必要にゃ。`, "thinking"); currentUser.karikari -= cost; saveAndSync(); updateMiniKarikari(); showKarikariEffect(-cost); let hints = selectedProblem.hints; if (!hints || hints.length === 0) hints = ["よく読んでみてにゃ", "式を立てるにゃ", "先生と解くにゃ"]; updateNellMessage(hints[hintIndex] || "……", "thinking"); document.getElementById('hint-step-label').innerText = `ヒント ${hintIndex + 1}`; hintIndex++; const nextBtn = document.getElementById('next-hint-btn'); const revealBtn = document.getElementById('reveal-answer-btn'); if (hintIndex === 1) nextBtn.innerText = "🍖 さらにカリカリを5個あげてヒントをもらう"; else if (hintIndex === 2) nextBtn.innerText = "🍖 さらにカリカリを10個あげてヒントをもらう"; else { nextBtn.classList.add('hidden'); revealBtn.classList.remove('hidden'); revealBtn.innerText = "答えを見る"; } }
function renderWorksheet() { const l=document.getElementById('problem-list-grade'); if(!l)return; l.innerHTML=""; transcribedProblems.forEach((p,i)=>{ l.innerHTML+=`<div class="problem-row"><div><span class="q-label">${p.label||'?'}</span>${p.question}</div><div style="display:flex;gap:5px"><input class="student-ans-input" value="${p.student_answer}" onchange="updateAns(${i},this.value)"><div class="judgment-mark ${p.status}">${p.status==='correct'?'⭕️':p.status==='incorrect'?'❌':''}</div><button class="mini-teach-btn" onclick="startHint(${p.id})">教えて</button></div></div>`; }); const f=document.createElement('div'); f.style.textAlign="center"; f.style.marginTop="20px"; f.innerHTML=`<button onclick="finishGrading()" class="main-btn orange-btn">✨ 全部わかった！</button>`; l.appendChild(f); }
function updateAns(i,v) { transcribedProblems[i].student_answer=v; const n = v => v.toString().replace(/\s/g, '').replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)).replace(/cm|ｍ|ｍｍ|円|個/g, '').replace(/[×＊]/g, '*').replace(/[÷／]/g, '/'); if (n(v) === n(transcribedProblems[i].correct_answer) && v !== "") { transcribedProblems[i].status = 'correct'; updateNellMessage("正解にゃ！修正ありがとうにゃ。", "happy"); if (currentUser.mistakes) currentUser.mistakes = currentUser.mistakes.filter(m => m.question !== transcribedProblems[i].question); } else { transcribedProblems[i].status = 'incorrect'; updateNellMessage("まだ違うみたいだにゃ……", "thinking"); if (!currentUser.mistakes.some(m => m.question === transcribedProblems[i].question)) currentUser.mistakes.push({...transcribedProblems[i], subject: currentSubject}); } saveAndSync(); renderWorksheet(); }