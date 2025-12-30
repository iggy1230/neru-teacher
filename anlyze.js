let transcribedProblems = []; let selectedProblem = null; let hintIndex = 0; let isAnalyzing = false; let currentSubject = '';

function setSubject(s) {
    currentSubject = s; currentUser.history[s] = (currentUser.history[s] || 0) + 1; saveAndSync();
    document.getElementById('subject-selection-view').classList.add('hidden');
    document.getElementById('upload-controls').classList.remove('hidden');
    updateNellMessage(`${currentSubject}の問題をみせてにゃ！`, "happy");
}

function selectMode(m) {
    currentMode = m; switchScreen('screen-main');
    if (m === 'review') {
        document.getElementById('subject-selection-view').classList.add('hidden');
        renderMistakeSelection();
    } else {
        document.getElementById('subject-selection-view').classList.remove('hidden');
        document.getElementById('upload-controls').classList.add('hidden');
    }
}

function renderMistakeSelection() {
    if (!currentUser.mistakes || currentUser.mistakes.length === 0) {
        updateNellMessage("ノートは空っぽにゃ！完ぺきだにゃ✨", "happy");
        backToLobby(); return;
    }
    transcribedProblems = currentUser.mistakes; renderProblemSelection();
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
    if (isAnalyzing || !e.target.files[0]) return;
    isAnalyzing = true;
    document.getElementById('upload-controls').classList.add('hidden');
    document.getElementById('thinking-view').classList.remove('hidden');
    updateProgress(0); updateNellMessage("どれどれ……ネル先生がじっくり見てあげるにゃ。……", "thinking");
    let p = 0; const timer = setInterval(() => { if (p < 90) { p += 3; updateProgress(p); } }, 500);
    try {
        const b64 = await shrinkImage(e.target.files[0]);
        const res = await fetch('/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: b64, mode: currentMode, grade: currentUser.grade, subject: currentSubject }) });
        const data = await res.json();
        transcribedProblems = data.map(p => ({ ...p, student_answer: "", status: "unanswered" }));
        clearInterval(timer); updateProgress(100);
        setTimeout(() => { document.getElementById('thinking-view').classList.add('hidden'); if (transcribedProblems.length > 0) { if (currentMode === 'explain') renderProblemSelection(); else showGradingView(); } }, 800);
    } catch (err) { updateNellMessage("制限エラーだにゃ🐾"); document.getElementById('upload-controls').classList.remove('hidden');
    } finally { isAnalyzing = false; }
});

function renderProblemSelection() {
    switchView('problem-selection-view');
    const list = document.getElementById('transcribed-problem-list'); list.innerHTML = "";
    transcribedProblems.forEach(p => {
        const div = document.createElement('div'); div.className = "prob-card";
        div.innerHTML = `<div><span class="q-label">${p.label || '?'}</span><span>${p.question.substring(0,25)}...</span></div><button class="main-btn blue-btn" style="width:auto; padding:10px;" onclick="startHint(${p.id})">教えて！</button>`;
        list.appendChild(div);
    });
}

function startHint(id) {
    if (currentUser.karikari < 5) return updateNellMessage("カリカリが足りないにゃ……。", "thinking");
    selectedProblem = transcribedProblems.find(p => p.id === id); hintIndex = 0;
    currentUser.karikari -= 5; saveAndSync();
    switchView('final-view'); document.getElementById('hint-detail-container').classList.remove('hidden');
    document.getElementById('chalkboard').innerHTML = (selectedProblem.label || "") + " " + selectedProblem.question;
    document.getElementById('chalkboard').classList.remove('hidden');
    document.getElementById('answer-display-area').classList.add('hidden');
    showHintStep();
}

function showHintStep() {
    updateNellMessage(selectedProblem.hints[hintIndex], "thinking");
    document.getElementById('hint-step-label').innerText = `ヒント ${hintIndex + 1}`;
    const next = document.getElementById('next-hint-btn'); const reveal = document.getElementById('reveal-answer-btn');
    if(hintIndex < 2) { next.classList.remove('hidden'); reveal.classList.add('hidden'); } else { next.classList.add('hidden'); reveal.classList.remove('hidden'); }
}

function showNextHint() {
    if (currentUser.karikari < 5) return updateNellMessage("カリカリが足りないにゃ……。", "thinking");
    currentUser.karikari -= 5; saveAndSync(); hintIndex++; showHintStep();
}

function revealAnswer() {
    const ans = selectedProblem.correct_answer; document.getElementById('final-answer-text').innerText = ans; document.getElementById('answer-display-area').classList.remove('hidden'); document.getElementById('reveal-answer-btn').classList.add('hidden');
    updateNellMessage(`答えは……「${ans}」だにゃ！`, "gentle");
}

function showGradingView() { document.getElementById('chalkboard').classList.add('hidden'); switchView('final-view'); document.getElementById('grade-sheet-container').classList.remove('hidden'); renderWorksheet(); }

function renderWorksheet() {
    const list = document.getElementById('problem-list-grade'); list.innerHTML = "";
    transcribedProblems.forEach((item, idx) => {
        const div = document.createElement('div'); div.className = "problem-row";
        div.innerHTML = `
            <div style="flex:1; display:flex; align-items:center;">
                <span class="q-label">${item.label || '?'}</span>
                <span style="font-size:0.9rem;">${item.question}</span>
            </div>
            <div style="display:flex; align-items:center; gap:5px;">
                <input type="text" class="student-ans-input" value="${item.student_answer || ''}" onchange="updateAns(${idx}, this.value)">
                <div class="judgment-mark ${item.status==='correct'?'correct':'incorrect'}">
                    ${item.status==='correct'?'⭕️':(item.status==='unanswered'?'':'❌')}
                </div>
                <button class="mini-teach-btn" onclick="startHint(${item.id})">教えて！</button>
            </div>`;
        list.appendChild(div);
    });
}

function updateAns(idx, val) {
    const itm = transcribedProblems[idx]; itm.student_answer = val;
    const normalize = (v) => v.toString().replace(/\s/g, '').replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)).replace(/cm|ｍ|ｍｍ/g, '').replace(/[×＊]/g, '*').replace(/[÷／]/g, '/');
    if (normalize(val) === normalize(itm.correct_answer) && val !== "") {
        itm.status = 'correct'; updateNellMessage("正解にゃ！", "happy");
        if (currentUser.mistakes) currentUser.mistakes = currentUser.mistakes.filter(m => m.question !== itm.question);
    } else {
        itm.status = 'incorrect'; updateNellMessage("おしいにゃ……ノートに書いておくね。", "thinking");
        if (!currentUser.mistakes.some(m => m.question === itm.question)) currentUser.mistakes.push({...itm, subject: currentSubject});
    }
    saveAndSync(); renderWorksheet();
}

async function pressThanks() { await updateNellMessage("よくがんばったにゃ！", "happy"); backToProblemSelection(); }
async function pressAllSolved() { await updateNellMessage("全部終わったにゃ！ご褒美カリカリ100個だにゃ🐾", "excited"); currentUser.karikari += 100; saveAndSync(); backToLobby(); }