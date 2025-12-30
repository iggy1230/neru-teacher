// --- anlyze.js (演出・報酬・常時表示対応版) ---

let transcribedProblems = []; 
let selectedProblem = null; 
let hintIndex = 0; 
let isAnalyzing = false; 
let currentSubject = '';
let currentMode = ''; 

const subjectImages = {
    'こくご': 'nell-kokugo.png', 'さんすう': 'nell-sansu.png',
    'りか': 'nell-rika.png', 'しゃかい': 'nell-shakai.png'
};
const defaultIcon = 'nell-icon.png';

// 1. モード選択
function selectMode(m) {
    currentMode = m; 
    switchScreen('screen-main'); 

    // UIリセット
    const ids = ['subject-selection-view', 'upload-controls', 'thinking-view', 'problem-selection-view', 'final-view', 'chalkboard'];
    ids.forEach(id => document.getElementById(id).classList.add('hidden'));

    // ネル先生アイコンリセット
    const icon = document.querySelector('.nell-avatar-wrap img');
    if(icon) icon.src = defaultIcon;

    // ★カリカリ常時表示ON
    document.getElementById('mini-karikari-display').classList.remove('hidden');
    updateMiniKarikari();

    if (m === 'review') {
        renderMistakeSelection();
    } else {
        document.getElementById('subject-selection-view').classList.remove('hidden');
        updateNellMessage("どの教科にするのかにゃ？", "normal");
    }
}

// 2. カリカリ常時表示更新
function updateMiniKarikari() {
    if(currentUser) {
        document.getElementById('mini-karikari-count').innerText = currentUser.karikari;
        // ロビーの表示も同期
        const k = document.getElementById('karikari-count');
        if(k) k.innerText = currentUser.karikari;
    }
}

// 3. ハート演出 & カリカリ消費演出
function showKarikariEffect() {
    // 1. 数値が減る演出
    const container = document.querySelector('.nell-avatar-wrap');
    if(container) {
        const floatText = document.createElement('div');
        floatText.className = 'floating-text';
        floatText.innerText = '-5';
        floatText.style.right = '0px';
        floatText.style.top = '0px';
        container.appendChild(floatText);
        setTimeout(() => floatText.remove(), 1500);
    }
    
    // 2. ハート演出
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

// 4. 科目選択
function setSubject(s) {
    currentSubject = s; 
    if (currentUser) {
        currentUser.history[s] = (currentUser.history[s] || 0) + 1; 
        saveAndSync();
    }
    
    const icon = document.querySelector('.nell-avatar-wrap img');
    if(icon && subjectImages[s]) {
        const img = new Image();
        img.src = subjectImages[s];
        img.onload = () => { icon.src = subjectImages[s]; };
        img.onerror = () => { icon.src = defaultIcon; };
    }

    document.getElementById('subject-selection-view').classList.add('hidden');
    document.getElementById('upload-controls').classList.remove('hidden');
    updateNellMessage(`${currentSubject}の問題をみせてにゃ！`, "happy");
}

function renderMistakeSelection() {
    if (!currentUser.mistakes || currentUser.mistakes.length === 0) {
        updateNellMessage("ノートは空っぽにゃ！完ぺきだにゃ✨", "happy");
        setTimeout(backToLobby, 2000);
        return;
    }
    transcribedProblems = currentUser.mistakes; 
    renderProblemSelection();
    updateNellMessage("復習するにゃ？えらいにゃ！", "excited");
}

async function shrinkImage(file) {
    return new Promise((resolve) => {
        const reader = new FileReader(); 
        reader.readAsDataURL(file);
        reader.onload = (e) => {
            const img = new Image(); 
            img.onload = () => {
                const canvas = document.createElement('canvas'); 
                const MAX = 1600;
                let w = img.width, h = img.height;
                if (w > MAX || h > MAX) { 
                    if (w > h) { h *= MAX / w; w = MAX; } 
                    else { w *= MAX / h; h = MAX; } 
                }
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', 0.9).split(',')[1]);
            }; 
            img.src = e.target.result;
        };
    });
}

// 5. 分析 & 報酬ロジック
document.getElementById('hw-input').addEventListener('change', async (e) => {
    if (isAnalyzing || !e.target.files[0]) return;
    
    isAnalyzing = true;
    document.getElementById('upload-controls').classList.add('hidden');
    document.getElementById('thinking-view').classList.remove('hidden');
    updateNellMessage("採点とヒントを準備してるにゃ……", "thinking");
    updateProgress(0); 

    let p = 0; 
    const timer = setInterval(() => { if (p < 90) { p += 3; updateProgress(p); } }, 500);

    try {
        const b64 = await shrinkImage(e.target.files[0]);
        const res = await fetch('/analyze', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ 
                image: b64, mode: currentMode, grade: currentUser.grade, subject: currentSubject 
            }) 
        });
        
        if (!res.ok) throw new Error("Server Error");
        const data = await res.json();
        
        // データ処理
        transcribedProblems = data.map((prob, index) => {
            const safeId = index + 1; 
            const studentAns = prob.student_answer || "";
            const normalize = (v) => v.toString().replace(/\s/g, '').replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)).replace(/cm|ｍ|ｍｍ|円|個/g, '').replace(/[×＊]/g, '*').replace(/[÷／]/g, '/');
            
            let status = "unanswered";
            if (studentAns !== "") {
                status = (normalize(studentAns) === normalize(prob.correct_answer)) ? "correct" : "incorrect";
            }
            return { ...prob, id: safeId, student_answer: studentAns, status: status };
        });
        
        clearInterval(timer); 
        updateProgress(100);

        setTimeout(() => { 
            document.getElementById('thinking-view').classList.add('hidden'); 
            
            if (transcribedProblems.length > 0) { 
                if (currentMode === 'explain' || currentMode === 'review') {
                    renderProblemSelection(); 
                    updateNellMessage("問題が読めたにゃ！", "happy");
                } else { 
                    // 採点モード：報酬計算
                    showGradingView(); 
                    
                    const total = transcribedProblems.length;
                    const correctCount = transcribedProblems.filter(p => p.status === 'correct').length;
                    const rate = correctCount / total;

                    if (correctCount === total) {
                        // 全問正解
                        currentUser.karikari += 100;
                        saveAndSync();
                        updateMiniKarikari();
                        updateNellMessage("すごーい！！全問正解だにゃ！\nご褒美のカリカリ100個あげるにゃ！✨", "excited");
                        drawHanamaru(); // 花丸描画
                    } else if (rate >= 0.8) {
                        // 8割以上
                        currentUser.karikari += 50;
                        saveAndSync();
                        updateMiniKarikari();
                        updateNellMessage("がんばったにゃ！ほとんど正解だにゃ！\nカリカリ50個あげるにゃ🐾", "happy");
                    } else {
                        updateNellMessage("採点したにゃ。間違えたところは「教えて」ボタンを使ってね。", "gentle");
                    }
                } 
            } else {
                updateNellMessage("文字が読めなかったにゃ……", "thinking");
                document.getElementById('upload-controls').classList.remove('hidden');
            }
        }, 800);

    } catch (err) { 
        console.error(err);
        clearInterval(timer);
        updateNellMessage("通信エラーだにゃ……。", "thinking"); 
        document.getElementById('thinking-view').classList.add('hidden');
        document.getElementById('upload-controls').classList.remove('hidden');
    } finally { 
        isAnalyzing = false; 
    }
});

function startHint(id) {
    if (currentUser.karikari < 5) return updateNellMessage("カリカリが足りないにゃ……。", "thinking");
    
    selectedProblem = transcribedProblems.find(p => p.id == id); 
    if (!selectedProblem) return updateNellMessage("データが見つからないにゃ……", "thinking");

    hintIndex = 0;
    
    // ★カリカリ消費 & 演出
    currentUser.karikari -= 5; 
    saveAndSync();
    updateMiniKarikari();
    showKarikariEffect();

    document.getElementById('problem-selection-view').classList.add('hidden');
    document.getElementById('grade-sheet-container').classList.add('hidden'); 
    document.getElementById('final-view').classList.remove('hidden');
    document.getElementById('hint-detail-container').classList.remove('hidden'); 
    
    const board = document.getElementById('chalkboard');
    board.innerText = (selectedProblem.label || "") + " " + selectedProblem.question;
    board.classList.remove('hidden');
    
    document.getElementById('answer-display-area').classList.add('hidden');
    showHintStep();
}

function showHintStep() {
    let hints = selectedProblem.hints;
    if (!hints || !Array.isArray(hints) || hints.length === 0) {
        hints = ["問題をよく読んでみてにゃ。", "式を立ててみるにゃ。", "先生と一緒に解くにゃ？"];
    }

    updateNellMessage(hints[hintIndex] || "……", "thinking");
    document.getElementById('hint-step-label').innerText = `ヒント ${hintIndex + 1}`;
    
    const nextBtn = document.getElementById('next-hint-btn'); 
    const revealBtn = document.getElementById('reveal-answer-btn');
    
    if(hintIndex < 2) { 
        nextBtn.classList.remove('hidden'); 
        revealBtn.classList.add('hidden'); 
    } else { 
        nextBtn.classList.add('hidden'); 
        revealBtn.classList.remove('hidden'); 
    }
}

function showNextHint() {
    if (currentUser.karikari < 5) return updateNellMessage("カリカリが足りないにゃ……。", "thinking");
    
    // ★次のヒントもカリカリ消費 & 演出
    currentUser.karikari -= 5; 
    saveAndSync(); 
    updateMiniKarikari();
    showKarikariEffect();

    hintIndex++; 
    showHintStep();
}

function revealAnswer() {
    const ans = selectedProblem.correct_answer; 
    document.getElementById('final-answer-text').innerText = ans; 
    document.getElementById('answer-display-area').classList.remove('hidden'); 
    document.getElementById('reveal-answer-btn').classList.add('hidden');
    updateNellMessage(`答えは……「${ans}」だにゃ！`, "gentle");
}

function renderProblemSelection() {
    document.getElementById('final-view').classList.add('hidden');
    document.getElementById('upload-controls').classList.add('hidden');
    document.getElementById('problem-selection-view').classList.remove('hidden');

    const list = document.getElementById('transcribed-problem-list'); 
    list.innerHTML = "";
    transcribedProblems.forEach(p => {
        const div = document.createElement('div'); 
        div.className = "prob-card";
        div.innerHTML = `
            <div><span class="q-label">${p.label || '?'}</span><span>${p.question ? p.question.substring(0,25) : ""}...</span></div>
            <button class="main-btn blue-btn" style="width:auto; padding:10px;" onclick="startHint(${p.id})">教えて！</button>
        `;
        list.appendChild(div);
    });
}

function showGradingView() { 
    document.getElementById('chalkboard').classList.add('hidden'); 
    document.getElementById('upload-controls').classList.add('hidden');
    document.getElementById('problem-selection-view').classList.add('hidden');
    document.getElementById('final-view').classList.remove('hidden');
    document.getElementById('grade-sheet-container').classList.remove('hidden');
    document.getElementById('hint-detail-container').classList.add('hidden');
    renderWorksheet(); 
}

function renderWorksheet() {
    const list = document.getElementById('problem-list-grade'); 
    list.innerHTML = "";
    transcribedProblems.forEach((item, idx) => {
        const div = document.createElement('div'); 
        div.className = "problem-row";
        let markHTML = item.status === 'correct' ? '⭕️' : (item.status === 'incorrect' ? '❌' : '');
        div.innerHTML = `
            <div style="flex:1; display:flex; align-items:center;">
                <span class="q-label">${item.label || '?'}</span>
                <span style="font-size:0.9rem;">${item.question}</span>
            </div>
            <div style="display:flex; align-items:center; gap:5px;">
                <input type="text" class="student-ans-input" value="${item.student_answer || ''}" onchange="updateAns(${idx}, this.value)" style="color:${item.status==='correct'?'#2e7d32':'#c62828'};">
                <div class="judgment-mark ${item.status}">${markHTML}</div>
                <button class="mini-teach-btn" onclick="startHint(${item.id})">教えて！</button>
            </div>`;
        list.appendChild(div);
    });
}

function updateAns(idx, val) {
    const itm = transcribedProblems[idx]; 
    itm.student_answer = val;
    const normalize = (v) => v.toString().replace(/\s/g, '').replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)).replace(/cm|ｍ|ｍｍ|円|個/g, '').replace(/[×＊]/g, '*').replace(/[÷／]/g, '/');
    
    if (normalize(val) === normalize(itm.correct_answer) && val !== "") {
        itm.status = 'correct'; 
        updateNellMessage("正解にゃ！", "happy");
        if (currentUser.mistakes) currentUser.mistakes = currentUser.mistakes.filter(m => m.question !== itm.question);
    } else {
        itm.status = 'incorrect'; 
        updateNellMessage("おしいにゃ……ノートに書いておくね。", "thinking");
        if (!currentUser.mistakes.some(m => m.question === itm.question)) {
            currentUser.mistakes.push({...itm, subject: currentSubject});
        }
    }
    saveAndSync(); 
    renderWorksheet();
}

async function pressThanks() { 
    await updateNellMessage("どういたしましてにゃ！", "happy"); 
    if (currentMode === 'grade') showGradingView(); 
    else backToProblemSelection(); 
}

async function pressAllSolved() { 
    await updateNellMessage("全部終わったにゃ！ご褒美カリカリ100個だにゃ🐾", "excited"); 
    if (currentUser) {
        currentUser.karikari += 100; 
        saveAndSync(); 
        updateMiniKarikari();
    }
    backToLobby(); 
}