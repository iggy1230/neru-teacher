// --- anlyze.js (マイク・ロボット声修正版) ---

let transcribedProblems = []; 
let selectedProblem = null; 
let hintIndex = 0; 
let isAnalyzing = false; 
let currentSubject = '';
let currentMode = ''; 
let lunchCount = 0; 

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

    const icon = document.querySelector('.nell-avatar-wrap img');
    if(icon) icon.src = defaultIcon;

    document.getElementById('mini-karikari-display').classList.remove('hidden');
    updateMiniKarikari();

    if (m === 'review') {
        renderMistakeSelection();
    } else if (m === 'chat') {
        // ★面談モード初期化
        document.getElementById('chat-view').classList.remove('hidden');
        updateNellMessage("悩み事があるのかにゃ？何でも聞いてあげるにゃ。", "gentle");
        
        // ボタン状態リセット
        const btn = document.getElementById('mic-btn');
        btn.innerText = "🎤 おはなしする";
        btn.disabled = false;
        btn.style.background = "#ff85a1"; // ピンクに戻す
        document.getElementById('user-speech-text').innerText = "...";

    } else if (m === 'lunch') {
        document.getElementById('lunch-view').classList.remove('hidden');
        lunchCount = 0; 
        updateNellMessage("お腹ペコペコだにゃ……カリカリ持ってる？", "thinking");
    } else {
        document.getElementById('subject-selection-view').classList.remove('hidden');
        updateNellMessage("教科を選ぶにゃ", "normal");
    }
}

// 2. ★修正版：音声認識（こじんめんだん）
function startListening() {
    // ブラウザ互換性チェック
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        return alert("ごめんにゃ、このブラウザだとマイクが使えないみたいにゃ……(Chrome推奨)");
    }

    const btn = document.getElementById('mic-btn');
    const txt = document.getElementById('user-speech-text');
    
    // 前回の認識が残っていたら止めるための処理（念のため）
    if (window.currentRecognition) {
        try { window.currentRecognition.stop(); } catch(e){}
    }

    const recognition = new SpeechRecognition();
    window.currentRecognition = recognition; // グローバルに保持

    recognition.lang = 'ja-JP';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    // --- イベントハンドラ設定 ---
    recognition.onstart = () => {
        btn.innerText = "👂 聞いてるにゃ...";
        btn.disabled = true;
        btn.style.background = "#ff5252"; // 赤くして録音中をアピール
        txt.innerText = "（お話ししてね……）";
    };

    recognition.onend = () => {
        btn.innerText = "🎤 おはなしする";
        btn.disabled = false;
        btn.style.background = "#ff85a1"; // 元の色に戻す
    };

    recognition.onerror = (event) => {
        console.error("Speech Error:", event.error);
        btn.innerText = "🎤 おはなしする";
        btn.disabled = false;
        btn.style.background = "#ff85a1";
        
        if (event.error === 'not-allowed') {
            alert("マイクの使用が許可されていないにゃ。ブラウザの設定を見てみてにゃ。");
        } else if (event.error === 'no-speech') {
            updateNellMessage("何も聞こえなかったにゃ……？", "thinking");
        } else {
            updateNellMessage("エラーだにゃ……。", "thinking");
        }
    };

    recognition.onresult = async (event) => {
        const speechResult = event.results[0][0].transcript;
        txt.innerText = "「" + speechResult + "」";
        
        // サーバーへ送信
        try {
            updateNellMessage("考え中にゃ……", "thinking");
            
            const res = await fetch('/chat', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    message: speechResult,
                    grade: currentUser.grade,
                    name: currentUser.name
                })
            });
            
            if (!res.ok) throw new Error("Server Error");
            const data = await res.json();
            
            // ネル先生の返答
            updateNellMessage(data.reply, "gentle");
            
        } catch(e) {
            console.error(e);
            updateNellMessage("通信エラーだにゃ……もう一回言って？", "thinking");
        }
    };

    // --- 録音開始 ---
    try {
        recognition.start();
    } catch(e) {
        console.error("Start Error:", e);
        alert("マイクの起動に失敗したにゃ。ページをリロードしてみてにゃ。");
    }
}

// 3. カリカリ・ハート演出
function updateMiniKarikari() {
    if(currentUser) {
        document.getElementById('mini-karikari-count').innerText = currentUser.karikari;
        const k = document.getElementById('karikari-count');
        if(k) k.innerText = currentUser.karikari;
    }
}

function showKarikariEffect(amount = 5) {
    const container = document.querySelector('.nell-avatar-wrap');
    if(container) {
        const floatText = document.createElement('div');
        floatText.className = 'floating-text';
        floatText.innerText = `-${amount}`;
        floatText.style.right = '0px'; floatText.style.top = '0px';
        container.appendChild(floatText);
        setTimeout(() => floatText.remove(), 1500);
    }
    const heartCont = document.getElementById('heart-container');
    if(heartCont) {
        for(let i=0; i<8; i++) {
            const heart = document.createElement('div');
            heart.className = 'heart-particle';
            heart.innerText = '💗';
            heart.style.left = (Math.random()*80 + 10) + '%';
            heart.style.top = (Math.random()*50 + 20) + '%';
            heart.style.animationDelay = (Math.random()*0.5) + 's';
            heartCont.appendChild(heart);
            setTimeout(() => heart.remove(), 1500);
        }
    }
}

// 4. おいしい給食
function giveLunch() {
    if (currentUser.karikari < 1) {
        return updateNellMessage("カリカリがないにゃ……。", "thinking");
    }
    currentUser.karikari -= 1;
    saveAndSync(); updateMiniKarikari(); showKarikariEffect(1);
    lunchCount++;
    
    let mood = "happy";
    let msg = "";
    if (lunchCount < 3) { msg = "おいしいにゃ！"; } 
    else if (lunchCount < 7) { mood = "excited"; msg = "もっと欲しいにゃ！カリカリ最高にゃ！"; } 
    else {
        mood = "excited";
        const talks = ["うみゃいうみゃい！", "幸せだにゃ〜！", "ネル先生、元気100倍だにゃ！", "もっともっと〜！"];
        msg = talks[Math.floor(Math.random() * talks.length)];
    }
    updateNellMessage(msg, mood);
}

// 5. その他ヘルパー（既存のまま）
function setSubject(s) {
    currentSubject = s; 
    if (currentUser) { currentUser.history[s] = (currentUser.history[s] || 0) + 1; saveAndSync(); }
    const icon = document.querySelector('.nell-avatar-wrap img');
    if(icon && subjectImages[s]) { const img = new Image(); img.src = subjectImages[s]; img.onload = () => { icon.src = subjectImages[s]; }; img.onerror = () => { icon.src = defaultIcon; }; }
    document.getElementById('subject-selection-view').classList.add('hidden');
    document.getElementById('upload-controls').classList.remove('hidden');
    updateNellMessage(`${currentSubject}の問題をみせてにゃ！`, "happy");
}

async function shrinkImage(file) {
    return new Promise((resolve) => {
        const reader = new FileReader(); reader.readAsDataURL(file);
        reader.onload = (e) => {
            const img = new Image(); img.onload = () => {
                const canvas = document.createElement('canvas'); const MAX = 1600;
                let w = img.width, h = img.height;
                if (w > MAX || h > MAX) { if (w > h) { h *= MAX / w; w = MAX; } else { w *= MAX / h; h = MAX; } }
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', 0.9).split(',')[1]);
            }; img.src = e.target.result;
        };
    });
}

document.getElementById('hw-input').addEventListener('change', async (e) => {
    if (isAnalyzing || !e.target.files[0]) return; isAnalyzing = true;
    document.getElementById('upload-controls').classList.add('hidden'); document.getElementById('thinking-view').classList.remove('hidden');
    updateNellMessage("採点とヒントを準備してるにゃ……", "thinking"); updateProgress(0); 
    let p = 0; const timer = setInterval(() => { if (p < 90) { p += 3; updateProgress(p); } }, 500);
    try {
        const b64 = await shrinkImage(e.target.files[0]);
        const res = await fetch('/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: b64, mode: currentMode, grade: currentUser.grade, subject: currentSubject }) });
        if (!res.ok) throw new Error("Server Error"); const data = await res.json();
        transcribedProblems = data.map((prob, index) => {
            const safeId = index + 1; const studentAns = prob.student_answer || "";
            const normalize = (v) => v.toString().replace(/\s/g, '').replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)).replace(/cm|ｍ|ｍｍ|円|個/g, '').replace(/[×＊]/g, '*').replace(/[÷／]/g, '/');
            let status = "unanswered"; if (studentAns !== "") { status = (normalize(studentAns) === normalize(prob.correct_answer)) ? "correct" : "incorrect"; }
            return { ...prob, id: safeId, student_answer: studentAns, status: status };
        });
        clearInterval(timer); updateProgress(100);
        setTimeout(() => { 
            document.getElementById('thinking-view').classList.add('hidden'); 
            if (transcribedProblems.length > 0) { 
                if (currentMode === 'explain' || currentMode === 'review') { renderProblemSelection(); updateNellMessage("問題が読めたにゃ！", "happy"); } 
                else { 
                    showGradingView(); const total = transcribedProblems.length; const correctCount = transcribedProblems.filter(p => p.status === 'correct').length; const rate = correctCount / total;
                    if (correctCount === total) { currentUser.karikari += 100; saveAndSync(); updateMiniKarikari(); updateNellMessage("全問正解！ご褒美100個にゃ！✨", "excited"); drawHanamaru(); } 
                    else if (rate >= 0.8) { currentUser.karikari += 50; saveAndSync(); updateMiniKarikari(); updateNellMessage("ほとんど正解！50個あげるにゃ🐾", "happy"); } 
                    else { updateNellMessage("採点したにゃ。間違えた所は「教えて」ボタンを使ってね。", "gentle"); }
                } 
            } else { updateNellMessage("読めなかったにゃ……", "thinking"); document.getElementById('upload-controls').classList.remove('hidden'); }
        }, 800);
    } catch (err) { 
        console.error(err); clearInterval(timer); updateNellMessage("エラーだにゃ……。", "thinking"); 
        document.getElementById('thinking-view').classList.add('hidden'); document.getElementById('upload-controls').classList.remove('hidden'); 
    } finally { isAnalyzing = false; }
});

function renderMistakeSelection() {
    if (!currentUser.mistakes || currentUser.mistakes.length === 0) { updateNellMessage("ノートは空っぽにゃ！", "happy"); setTimeout(backToLobby, 2000); return; }
    transcribedProblems = currentUser.mistakes; renderProblemSelection(); updateNellMessage("復習するにゃ？", "excited");
}
function startHint(id) {
    if (currentUser.karikari < 5) return updateNellMessage("カリカリが足りないにゃ……。", "thinking");
    selectedProblem = transcribedProblems.find(p => p.id == id); if (!selectedProblem) return; hintIndex = 0;
    currentUser.karikari -= 5; saveAndSync(); updateMiniKarikari(); showKarikariEffect();
    document.getElementById('problem-selection-view').classList.add('hidden'); document.getElementById('grade-sheet-container').classList.add('hidden'); 
    document.getElementById('final-view').classList.remove('hidden'); document.getElementById('hint-detail-container').classList.remove('hidden'); 
    const board = document.getElementById('chalkboard'); board.innerText = (selectedProblem.label || "") + " " + selectedProblem.question; board.classList.remove('hidden');
    document.getElementById('answer-display-area').classList.add('hidden'); showHintStep();
}
function showHintStep() {
    let hints = selectedProblem.hints;
    if (!hints || hints.length === 0) hints = ["よく読んでみてにゃ", "式を立てるにゃ", "先生と解くにゃ"];
    updateNellMessage(hints[hintIndex] || "……", "thinking"); document.getElementById('hint-step-label').innerText = `ヒント ${hintIndex + 1}`;
    const nextBtn = document.getElementById('next-hint-btn'); const revealBtn = document.getElementById('reveal-answer-btn');
    if(hintIndex < 2) { nextBtn.classList.remove('hidden'); revealBtn.classList.add('hidden'); } else { nextBtn.classList.add('hidden'); revealBtn.classList.remove('hidden'); }
}
function showNextHint() {
    if (currentUser.karikari < 5) return updateNellMessage("カリカリが足りないにゃ……。", "thinking");
    currentUser.karikari -= 5; saveAndSync(); updateMiniKarikari(); showKarikariEffect(); hintIndex++; showHintStep();
}
function revealAnswer() {
    document.getElementById('final-answer-text').innerText = selectedProblem.correct_answer; 
    document.getElementById('answer-display-area').classList.remove('hidden'); 
    document.getElementById('reveal-answer-btn').classList.add('hidden');
    updateNellMessage(`答えは……「${selectedProblem.correct_answer}」だにゃ！`, "gentle");
}
function renderProblemSelection() {
    document.getElementById('final-view').classList.add('hidden'); document.getElementById('upload-controls').classList.add('hidden'); document.getElementById('problem-selection-view').classList.remove('hidden');
    const list = document.getElementById('transcribed-problem-list'); list.innerHTML = "";
    transcribedProblems.forEach(p => {
        const div = document.createElement('div'); div.className = "prob-card";
        div.innerHTML = `<div><span class="q-label">${p.label || '?'}</span><span>${p.question ? p.question.substring(0,25) : ""}...</span></div><button class="main-btn blue-btn" style="width:auto; padding:10px;" onclick="startHint(${p.id})">教えて！</button>`;
        list.appendChild(div);
    });
}
function showGradingView() { 
    document.getElementById('chalkboard').classList.add('hidden'); document.getElementById('upload-controls').classList.add('hidden'); document.getElementById('problem-selection-view').classList.add('hidden');
    document.getElementById('final-view').classList.remove('hidden'); document.getElementById('grade-sheet-container').classList.remove('hidden'); document.getElementById('hint-detail-container').classList.add('hidden');
    renderWorksheet(); 
}
function renderWorksheet() {
    const list = document.getElementById('problem-list-grade'); list.innerHTML = "";
    transcribedProblems.forEach((item, idx) => {
        const div = document.createElement('div'); div.className = "problem-row";
        let markHTML = item.status === 'correct' ? '⭕️' : (item.status === 'incorrect' ? '❌' : '');
        div.innerHTML = `
            <div style="flex:1; display:flex; align-items:center;"><span class="q-label">${item.label || '?'}</span><span style="font-size:0.9rem;">${item.question}</span></div>
            <div style="display:flex; align-items:center; gap:5px;"><input type="text" class="student-ans-input" value="${item.student_answer || ''}" onchange="updateAns(${idx}, this.value)" style="color:${item.status==='correct'?'#2e7d32':'#c62828'};"><div class="judgment-mark ${item.status}">${markHTML}</div><button class="mini-teach-btn" onclick="startHint(${item.id})">教えて！</button></div>`;
        list.appendChild(div);
    });
}
function updateAns(idx, val) {
    const itm = transcribedProblems[idx]; itm.student_answer = val;
    const normalize = (v) => v.toString().replace(/\s/g, '').replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)).replace(/cm|ｍ|ｍｍ|円|個/g, '').replace(/[×＊]/g, '*').replace(/[÷／]/g, '/');
    if (normalize(val) === normalize(itm.correct_answer) && val !== "") {
        itm.status = 'correct'; updateNellMessage("正解にゃ！", "happy");
        if (currentUser.mistakes) currentUser.mistakes = currentUser.mistakes.filter(m => m.question !== itm.question);
    } else {
        itm.status = 'incorrect'; updateNellMessage("おしいにゃ……", "thinking");
        if (!currentUser.mistakes.some(m => m.question === itm.question)) currentUser.mistakes.push({...itm, subject: currentSubject});
    }
    saveAndSync(); renderWorksheet();
}
async function pressThanks() { 
    await updateNellMessage("どういたしましてにゃ！", "happy"); 
    if (currentMode === 'grade') showGradingView(); else backToProblemSelection(); 
}
async function pressAllSolved() { 
    await updateNellMessage("ご褒美100個だにゃ🐾", "excited"); 
    if (currentUser) { currentUser.karikari += 100; saveAndSync(); updateMiniKarikari(); }
    backToLobby(); 
}