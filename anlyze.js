// --- anlyze.js ---

let transcribedProblems = []; 
let selectedProblem = null; 
let hintIndex = 0; 
let isAnalyzing = false; 
let currentSubject = '';
let currentMode = ''; 

// 1. モード選択と画面リセット
function selectMode(m) {
    currentMode = m; 
    switchScreen('screen-main'); 

    // 要素を一旦すべて隠す
    const ids = ['subject-selection-view', 'upload-controls', 'thinking-view', 'problem-selection-view', 'final-view', 'chalkboard'];
    ids.forEach(id => document.getElementById(id).classList.add('hidden'));

    if (m === 'review') {
        renderMistakeSelection();
    } else {
        document.getElementById('subject-selection-view').classList.remove('hidden');
        updateNellMessage("どの科目のお勉強をする？", "normal");
    }
}

// 2. 科目選択
function setSubject(s) {
    currentSubject = s; 
    if (currentUser) {
        currentUser.history[s] = (currentUser.history[s] || 0) + 1; 
        saveAndSync();
    }
    document.getElementById('subject-selection-view').classList.add('hidden');
    document.getElementById('upload-controls').classList.remove('hidden');
    updateNellMessage(`${currentSubject}の問題をみせてにゃ！`, "happy");
}

// 3. 復習ノートモード
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

// 4. 画像処理
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

// 5. アップロード・分析・自動採点
document.getElementById('hw-input').addEventListener('change', async (e) => {
    if (isAnalyzing || !e.target.files[0]) return;
    
    isAnalyzing = true;
    document.getElementById('upload-controls').classList.add('hidden');
    document.getElementById('thinking-view').classList.remove('hidden');
    updateNellMessage("答えも合ってるか見てあげるにゃ……", "thinking");
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
        
        // データの正規化と自動採点
        transcribedProblems = data.map(prob => {
            const studentAns = prob.student_answer || "";
            // 正規化: 空白削除, 全角→半角, 単位削除
            const normalize = (v) => v.toString().replace(/\s/g, '').replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)).replace(/cm|ｍ|ｍｍ|円|個/g, '').replace(/[×＊]/g, '*').replace(/[÷／]/g, '/');
            
            let status = "unanswered";
            if (studentAns !== "") {
                status = (normalize(studentAns) === normalize(prob.correct_answer)) ? "correct" : "incorrect";
            }
            return { ...prob, student_answer: studentAns, status: status };
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
                    // 採点モード
                    showGradingView(); 
                    const allCorrect = transcribedProblems.every(p => p.status === 'correct');
                    if(allCorrect) updateNellMessage("すごい！全部正解にゃ！✨", "excited");
                    else updateNellMessage("採点したにゃ。読み間違いは直してね。", "gentle");
                } 
            } else {
                updateNellMessage("文字が読めなかったにゃ……", "thinking");
                document.getElementById('upload-controls').classList.remove('hidden');
            }
        }, 800);

    } catch (err) { 
        console.error(err);
        clearInterval(timer);
        updateNellMessage("エラーだにゃ……。", "thinking"); 
        document.getElementById('thinking-view').classList.add('hidden');
        document.getElementById('upload-controls').classList.remove('hidden');
    } finally { 
        isAnalyzing = false; 
    }
});

// 6. 問題リスト表示（教えてモード用）
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
            <div>
                <span class="q-label">${p.label || '?'}</span>
                <span>${p.question ? p.question.substring(0,25) : ""}...</span>
            </div>
            <button class="main-btn blue-btn" style="width:auto; padding:10px;" onclick="startHint(${p.id})">教えて！</button>
        `;
        list.appendChild(div);
    });
}

// 7. ヒント開始
function startHint(id) {
    if (currentUser.karikari < 5) return updateNellMessage("カリカリが足りないにゃ……。", "thinking");
    
    selectedProblem = transcribedProblems.find(p => p.id === id); 
    hintIndex = 0;
    currentUser.karikari -= 5; 
    saveAndSync();
    
    // 画面切り替え
    document.getElementById('problem-selection-view').classList.add('hidden');
    document.getElementById('final-view').classList.remove('hidden');
    
    // 採点シートを隠してヒントを表示
    document.getElementById('grade-sheet-container').classList.add('hidden');
    document.getElementById('hint-detail-container').classList.remove('hidden');
    
    const board = document.getElementById('chalkboard');
    board.innerText = (selectedProblem.label || "") + " " + selectedProblem.question;
    board.classList.remove('hidden');
    
    document.getElementById('answer-display-area').classList.add('hidden');
    showHintStep();
}

function showHintStep() {
    let hints = selectedProblem.hints;
    // 採点モードなどでヒントがない場合のフォールバック
    if (!hints || hints.length === 0) {
        hints = ["まずは問題をよく読んでみてにゃ", "正解と見比べてみるにゃ", "先生と一緒に解くにゃ？"];
    }

    updateNellMessage(hints[hintIndex], "thinking");
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
    currentUser.karikari -= 5; 
    saveAndSync(); 
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

// 8. 採点ビュー表示
function showGradingView() { 
    document.getElementById('chalkboard').classList.add('hidden'); 
    document.getElementById('upload-controls').classList.add('hidden');
    document.getElementById('problem-selection-view').classList.add('hidden');

    document.getElementById('final-view').classList.remove('hidden');
    document.getElementById('grade-sheet-container').classList.remove('hidden');
    document.getElementById('hint-detail-container').classList.add('hidden');
    
    renderWorksheet(); 
}

// 9. 採点シート描画（修正機能・教えてボタン付）
function renderWorksheet() {
    const list = document.getElementById('problem-list-grade'); 
    list.innerHTML = "";
    
    transcribedProblems.forEach((item, idx) => {
        const div = document.createElement('div'); 
        div.className = "problem-row";
        
        let markHTML = '';
        if (item.status === 'correct') markHTML = '⭕️';
        else if (item.status === 'incorrect') markHTML = '❌';
        
        div.innerHTML = `
            <div style="flex:1; display:flex; align-items:center;">
                <span class="q-label">${item.label || '?'}</span>
                <span style="font-size:0.9rem;">${item.question}</span>
            </div>
            <div style="display:flex; align-items:center; gap:5px;">
                <input type="text" class="student-ans-input" 
                       value="${item.student_answer || ''}" 
                       onchange="updateAns(${idx}, this.value)"
                       style="color:${item.status==='correct'?'#2e7d32':'#c62828'};">
                <div class="judgment-mark ${item.status}">
                    ${markHTML}
                </div>
                <button class="mini-teach-btn" onclick="startHint(${item.id})">教えて！</button>
            </div>`;
        list.appendChild(div);
    });
}

// 10. 答えの修正と再判定
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
    // 戻り先分岐
    if (currentMode === 'grade') {
        showGradingView();
    } else {
        backToProblemSelection();
    }
}

async function pressAllSolved() { 
    await updateNellMessage("全部終わったにゃ！ご褒美カリカリ100個だにゃ🐾", "excited"); 
    if (currentUser) {
        currentUser.karikari += 100; 
        saveAndSync(); 
    }
    backToLobby(); 
}