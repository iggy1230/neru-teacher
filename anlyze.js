// --- anlyze.js (給食undefined対策版) ---

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
let processor = null;
let nextStartTime = 0;

const subjectImages = {
    'こくご': 'nell-kokugo.png', 'さんすう': 'nell-sansu.png',
    'りか': 'nell-rika.png', 'しゃかい': 'nell-shakai.png'
};
const defaultIcon = 'nell-icon.png';

// 1. モード選択
function selectMode(m) {
    currentMode = m; 
    switchScreen('screen-main'); 
    
    const ids = ['subject-selection-view', 'upload-controls', 'thinking-view', 'problem-selection-view', 'final-view', 'chalkboard', 'chat-view', 'lunch-view'];
    ids.forEach(id => document.getElementById(id).classList.add('hidden'));
    
    stopLiveChat();

    const icon = document.querySelector('.nell-avatar-wrap img');
    if(icon) icon.src = defaultIcon;

    document.getElementById('mini-karikari-display').classList.remove('hidden');
    updateMiniKarikari();

    if (m === 'review') {
        renderMistakeSelection();
    } else if (m === 'chat') {
        document.getElementById('chat-view').classList.remove('hidden');
        updateNellMessage("「おはなしする」を押してね！", "gentle");
        const btn = document.getElementById('mic-btn');
        btn.innerText = "🎤 おはなしする";
        btn.disabled = false;
        btn.style.background = "#ff85a1";
        document.getElementById('user-speech-text').innerText = "（リアルタイム対話）";
    } else if (m === 'lunch') {
        document.getElementById('lunch-view').classList.remove('hidden');
        lunchCount = 0;
        updateNellMessage("お腹ペコペコだにゃ……", "thinking");
    } else {
        document.getElementById('subject-selection-view').classList.remove('hidden');
        updateNellMessage("どの教科にするのかにゃ？", "normal");
    }
}

// 2. ★給食機能 (undefined対策強化)
async function giveLunch() {
    if (currentUser.karikari < 1) {
        return updateNellMessage("カリカリがないにゃ……", "thinking");
    }
    
    currentUser.karikari--; 
    saveAndSync(); 
    updateMiniKarikari(); 
    showKarikariEffect(-1); 
    
    lunchCount++;
    
    // 待機メッセージ
    updateNellMessage("もぐもぐ……", "normal");

    try {
        const res = await fetch('/lunch-reaction', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                count: lunchCount, 
                name: currentUser.name 
            })
        });

        if (!res.ok) throw new Error("API Error");
        const data = await res.json();
        
        // ★安全装置：データがなければデフォルトを入れる
        const replyText = data.reply || "おいしいにゃ！";
        const mood = data.isSpecial ? "excited" : "happy";
        
        updateNellMessage(replyText, mood);

    } catch (e) {
        console.error(e);
        updateNellMessage("おいしいにゃ！", "happy");
    }
}

// 3. Live Chat (SpeechRecognition)
function startListening() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return alert("Chromeを使ってにゃ");

    const recognition = new SpeechRecognition();
    recognition.lang = 'ja-JP';
    recognition.maxAlternatives = 1;

    const btn = document.getElementById('mic-btn');
    const txt = document.getElementById('user-speech-text');

    recognition.onstart = () => {
        btn.disabled = true; btn.innerText = "👂 聞いてるにゃ..."; btn.style.background = "#ff5252";
        if (typeof initAudioEngine === 'function') initAudioEngine();
    };
    recognition.onend = () => {
        btn.disabled = false; btn.innerText = "🎤 おはなしする"; btn.style.background = "#ff85a1";
    };
    recognition.onresult = async (event) => {
        const text = event.results[0][0].transcript;
        txt.innerText = `「${text}」`;
        try {
            updateNellMessage("ふむふむ……", "thinking");
            const res = await fetch('/chat', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text, grade: currentUser.grade, name: currentUser.name })
            });
            const data = await res.json();
            updateNellMessage(data.reply || "にゃあ？", "gentle");
        } catch (e) { updateNellMessage("エラーだにゃ……", "thinking"); }
    };
    recognition.start();
}

function stopLiveChat() { /* Unused in this mode but kept for compatibility */ }

// 4. 分析
document.getElementById('hw-input').addEventListener('change', async (e) => {
    if (isAnalyzing || !e.target.files[0]) return; isAnalyzing = true;
    document.getElementById('upload-controls').classList.add('hidden'); document.getElementById('thinking-view').classList.remove('hidden');
    updateNellMessage("準備中……", "thinking"); updateProgress(0); 
    let p = 0; const timer = setInterval(() => { if (p < 90) { p += 3; updateProgress(p); } }, 500);
    try {
        const b64 = await shrinkImage(e.target.files[0]);
        const res = await fetch('/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: b64, mode: currentMode, grade: currentUser.grade, subject: currentSubject }) });
        if (!res.ok) throw new Error("Err"); const data = await res.json();
        transcribedProblems = data.map((prob, index) => ({ ...prob, id: index + 1, student_answer: prob.student_answer || "", status: "unanswered" }));
        transcribedProblems.forEach(p => {
            const n = v => v.toString().replace(/\s|[０-９]|cm|ｍ/g, s => s==='cm'||s==='ｍ'?'':String.fromCharCode(s.charCodeAt(0)-0xFEE0)).replace(/×/g,'*').replace(/÷/g,'/');
            if(p.student_answer && n(p.student_answer) === n(p.correct_answer)) p.status = 'correct';
            else if(p.student_answer) p.status = 'incorrect';
        });
        clearInterval(timer); updateProgress(100);
        setTimeout(() => { 
            document.getElementById('thinking-view').classList.add('hidden'); 
            if (currentMode === 'explain' || currentMode === 'review') { renderProblemSelection(); updateNellMessage("問題が読めたにゃ！", "happy"); } 
            else { 
                showGradingView(); 
                const total = transcribedProblems.length; const correct = transcribedProblems.filter(p => p.status === 'correct').length; const rate = correct / total;
                if (correct === total) { currentUser.karikari += 100; saveAndSync(); updateMiniKarikari(); showKarikariEffect(100); updateNellMessage("全問正解！ご褒美100個にゃ！✨", "excited"); drawHanamaru(); } 
                else if (rate >= 0.8) { currentUser.karikari += 50; saveAndSync(); updateMiniKarikari(); showKarikariEffect(50); updateNellMessage("ほとんど正解！50個あげるにゃ🐾", "happy"); } 
                else { updateNellMessage("採点したにゃ。間違えた所は「教えて」ボタンを使ってね。", "gentle"); }
            }
        }, 800);
    } catch (err) { clearInterval(timer); document.getElementById('thinking-view').classList.add('hidden'); document.getElementById('upload-controls').classList.remove('hidden'); updateNellMessage("エラーだにゃ", "thinking"); } finally { isAnalyzing = false; }
});

// 5. ヒント機能
function startHint(id) {
    selectedProblem = transcribedProblems.find(p => p.id == id); if (!selectedProblem) return updateNellMessage("データが見つからないにゃ……", "thinking");
    document.getElementById('problem-selection-view').classList.add('hidden'); document.getElementById('grade-sheet-container').classList.add('hidden'); document.getElementById('final-view').classList.remove('hidden'); document.getElementById('hint-detail-container').classList.remove('hidden'); 
    document.getElementById('chalkboard').innerText = selectedProblem.question; document.getElementById('chalkboard').classList.remove('hidden'); document.getElementById('answer-display-area').classList.add('hidden');
    hintIndex = 0;
    updateNellMessage("カリカリをくれたらヒントを出してあげてもいいにゃ🐾", "thinking");
    document.getElementById('hint-step-label').innerText = "考え中...";
    const nextBtn = document.getElementById('next-hint-btn'); const revealBtn = document.getElementById('reveal-answer-btn');
    nextBtn.innerText = "🍖 ネル先生にカリカリを5個あげてヒントをもらう"; nextBtn.classList.remove('hidden'); revealBtn.classList.add('hidden');
    nextBtn.onclick = showNextHint;
}

function showNextHint() {
    let cost = 0;
    if (hintIndex === 0) cost = 5; else if (hintIndex === 1) cost = 5; else if (hintIndex === 2) cost = 10;
    if (currentUser.karikari < cost) return updateNellMessage(`カリカリが足りないにゃ……あと${cost}個必要にゃ。`, "thinking");
    currentUser.karikari -= cost; saveAndSync(); updateMiniKarikari(); showKarikariEffect(-cost);
    let hints = selectedProblem.hints; if (!hints || hints.length === 0) hints = ["よく読んでみてにゃ", "式を立てるにゃ", "先生と解くにゃ"];
    updateNellMessage(hints[hintIndex] || "……", "thinking");
    document.getElementById('hint-step-label').innerText = `ヒント ${hintIndex + 1}`;
    hintIndex++; 
    const nextBtn = document.getElementById('next-hint-btn'); const revealBtn = document.getElementById('reveal-answer-btn');
    if (hintIndex === 1) nextBtn.innerText = "🍖 さらにカリカリを5個あげてヒントをもらう";
    else if (hintIndex === 2) nextBtn.innerText = "🍖 さらにカリカリを10個あげてヒントをもらう";
    else { nextBtn.classList.add('hidden'); revealBtn.classList.remove('hidden'); revealBtn.innerText = "答えを見る"; }
}

// Helper Functions
function updateMiniKarikari() { if(currentUser) { document.getElementById('mini-karikari-count').innerText = currentUser.karikari; document.getElementById('karikari-count').innerText = currentUser.karikari; } }
function showKarikariEffect(amount) { const container = document.querySelector('.nell-avatar-wrap'); if(container) { const floatText = document.createElement('div'); floatText.className = 'floating-text'; floatText.innerText = amount > 0 ? `+${amount}` : `${amount}`; floatText.style.color = amount > 0 ? '#ff9100' : '#ff5252'; floatText.style.right = '0px'; floatText.style.top = '0px'; container.appendChild(floatText); setTimeout(() => floatText.remove(), 1500); } const heartCont = document.getElementById('heart-container'); if(heartCont) { for(let i=0; i<8; i++) { const heart = document.createElement('div'); heart.className = 'heart-particle'; heart.innerText = amount > 0 ? '✨' : '💗'; heart.style.left = (Math.random()*80 + 10) + '%'; heart.style.top = (Math.random()*50 + 20) + '%'; heart.style.animationDelay = (Math.random()*0.5) + 's'; heartCont.appendChild(heart); setTimeout(() => heart.remove(), 1500); } } }
function revealAnswer() { document.getElementById('final-answer-text').innerText = selectedProblem.correct_answer; document.getElementById('answer-display-area').classList.remove('hidden'); document.getElementById('reveal-answer-btn').classList.add('hidden'); updateNellMessage("答えだにゃ", "gentle"); }
function renderProblemSelection() { document.getElementById('problem-selection-view').classList.remove('hidden'); const l=document.getElementById('transcribed-problem-list'); l.innerHTML=""; transcribedProblems.forEach(p=>{ l.innerHTML += `<div class="prob-card"><div><span class="q-label">${p.label||'?'}</span>${p.question.substring(0,20)}...</div><button class="main-btn blue-btn" style="width:auto;padding:10px" onclick="startHint(${p.id})">教えて</button></div>`; }); }
function showGradingView() { document.getElementById('final-view').classList.remove('hidden'); document.getElementById('grade-sheet-container').classList.remove('hidden'); renderWorksheet(); }
function renderWorksheet() { const l=document.getElementById('problem-list-grade'); l.innerHTML=""; transcribedProblems.forEach((p,i)=>{ l.innerHTML+=`<div class="problem-row"><div><span class="q-label">${p.label||'?'}</span>${p.question}</div><div style="display:flex;gap:5px"><input class="student-ans-input" value="${p.student_answer}" onchange="updateAns(${i},this.value)"><div class="judgment-mark ${p.status}">${p.status==='correct'?'⭕️':p.status==='incorrect'?'❌':''}</div><button class="mini-teach-btn" onclick="startHint(${p.id})">教えて</button></div></div>`; }); }
function updateAns(i,v) { transcribedProblems[i].student_answer=v; saveAndSync(); renderWorksheet(); }
function pressAllSolved() { currentUser.karikari+=100; saveAndSync(); backToLobby(); showKarikariEffect(100); }
function pressThanks() { if(currentMode==='grade') showGradingView(); else backToProblemSelection(); }
function setSubject(s) { currentSubject = s; if(currentUser){currentUser.history[s]=(currentUser.history[s]||0)+1; saveAndSync();} const icon = document.querySelector('.nell-avatar-wrap img'); if(icon&&subjectImages[s]){icon.src=subjectImages[s];icon.onerror=()=>{icon.src=defaultIcon;};} document.getElementById('subject-selection-view').classList.add('hidden'); document.getElementById('upload-controls').classList.remove('hidden'); updateNellMessage(`${currentSubject}の問題をみせてにゃ！`, "happy"); }
async function shrinkImage(file) { return new Promise((r)=>{ const reader=new FileReader(); reader.readAsDataURL(file); reader.onload=e=>{ const img=new Image(); img.onload=()=>{ const c=document.createElement('canvas'); let w=img.width,h=img.height; if(w>1600||h>1600){if(w>h){h*=1600/w;w=1600}else{w*=1600/h;h=1600}} c.width=w;c.height=h; c.getContext('2d').drawImage(img,0,0,w,h); r(c.toDataURL('image/jpeg',0.9).split(',')[1]); }; img.src=e.target.result; }; }); }
function renderMistakeSelection() { if (!currentUser.mistakes || currentUser.mistakes.length === 0) { updateNellMessage("ノートは空っぽにゃ！", "happy"); setTimeout(backToLobby, 2000); return; } transcribedProblems = currentUser.mistakes; renderProblemSelection(); updateNellMessage("復習するにゃ？", "excited"); }

// Audio Utils (Live Chat用は削除しましたが互換性のため残す場合はここ)
function startLiveChat() { startListening(); } // 互換性