// --- anlyze.js (完全版) ---

// 変数の初期化
let transcribedProblems = []; 
let selectedProblem = null; 
let hintIndex = 0; 
let isAnalyzing = false; 
let currentSubject = '';
let currentMode = ''; // これがないとモード選択でエラーになります

// 1. ロビーでモードを選んだとき（教えて・採点・復習）
function selectMode(m) {
    currentMode = m; 
    switchScreen('screen-main'); // 教室画面へ移動

    // モードごとの初期表示設定
    if (m === 'review') {
        // 復習ノートモード
        document.getElementById('subject-selection-view').classList.add('hidden');
        renderMistakeSelection();
    } else {
        // 通常モード（科目選択を表示）
        document.getElementById('subject-selection-view').classList.remove('hidden');
        document.getElementById('upload-controls').classList.add('hidden');
        // 前回の表示が残らないようにリセット
        document.getElementById('chalkboard').classList.add('hidden');
        switchView('problem-selection-view'); 
        // 問題リストを空にしておく
        document.getElementById('transcribed-problem-list').innerHTML = "";
        
        updateNellMessage("どの科目のお勉強をする？", "normal");
    }
}

// 2. 科目を選んだとき
function setSubject(s) {
    currentSubject = s; 
    
    // ユーザーの学習履歴を更新
    if (currentUser) {
        currentUser.history[s] = (currentUser.history[s] || 0) + 1; 
        saveAndSync();
    }

    // アップロード画面を表示
    document.getElementById('subject-selection-view').classList.add('hidden');
    document.getElementById('upload-controls').classList.remove('hidden');
    
    updateNellMessage(`${currentSubject}の問題をみせてにゃ！`, "happy");
}

// 3. 復習ノートの表示処理
function renderMistakeSelection() {
    if (!currentUser.mistakes || currentUser.mistakes.length === 0) {
        updateNellMessage("ノートは空っぽにゃ！完ぺきだにゃ✨", "happy");
        setTimeout(backToLobby, 2000); // 2秒後にロビーに戻る
        return;
    }
    transcribedProblems = currentUser.mistakes; 
    renderProblemSelection();
    updateNellMessage("間違えた問題を復習するにゃ？えらいにゃ！", "excited");
}

// 4. 画像アップロードとAI解析
document.getElementById('hw-input').addEventListener('change', async (e) => {
    if (isAnalyzing || !e.target.files[0]) return;
    
    isAnalyzing = true;
    document.getElementById('upload-controls').classList.add('hidden');
    document.getElementById('thinking-view').classList.remove('hidden');
    
    updateNellMessage("どれどれ……ネル先生がじっくり見てあげるにゃ……", "thinking");
    updateProgress(0); 

    // 進行状況バーのアニメーション（フェイク）
    let p = 0; 
    const timer = setInterval(() => { if (p < 90) { p += 3; updateProgress(p); } }, 500);

    try {
        const b64 = await shrinkImage(e.target.files[0]);
        
        // サーバーに送信
        const res = await fetch('/analyze', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ 
                image: b64, 
                mode: currentMode, 
                grade: currentUser.grade, 
                subject: currentSubject 
            }) 
        });
        
        const data = await res.json();
        
        // 結果を受け取る
        transcribedProblems = data.map(prob => ({ 
            ...prob, 
            student_answer: "", 
            status: "unanswered" 
        }));
        
        clearInterval(timer); 
        updateProgress(100);

        // 少し待ってから画面切り替え
        setTimeout(() => { 
            document.getElementById('thinking-view').classList.add('hidden'); 
            
            if (transcribedProblems.length > 0) { 
                if (currentMode === 'explain') {
                    renderProblemSelection(); 
                    updateNellMessage("問題が読めたにゃ！どれから教えてほしい？", "happy");
                } else { 
                    showGradingView(); 
                    updateNellMessage("採点するにゃ！答えを入力してね。", "gentle");
                } 
            } else {
                // 問題が見つからなかった場合
                updateNellMessage("うーん、文字が読めなかったにゃ……もう一度きれいに撮ってほしいにゃ。", "thinking");
                document.getElementById('upload-controls').classList.remove('hidden');
            }
        }, 800);

    } catch (err) { 
        console.error(err);
        clearInterval(timer);
        updateNellMessage("エラーだにゃ……通信環境を確認してにゃ🐾", "thinking"); 
        document.getElementById('thinking-view').classList.add('hidden');
        document.getElementById('upload-controls').classList.remove('hidden');
    } finally { 
        isAnalyzing = false; 
    }
});

// 画像縮小関数
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

// 5. 問題選択リストの表示（教えてモード用）
function renderProblemSelection() {
    switchView('problem-selection-view');
    const list = document.getElementById('transcribed-problem-list'); 
    list.innerHTML = "";
    
    transcribedProblems.forEach(p => {
        const div = document.createElement('div'); 
        div.className = "prob-card";
        div.innerHTML = `
            <div>
                <span class="q-label">${p.label || '?'}</span>
                <span>${p.question.substring(0,25)}...</span>
            </div>
            <button class="main-btn blue-btn" style="width:auto; padding:10px;" onclick="startHint(${p.id})">教えて！</button>
        `;
        list.appendChild(div);
    });
}

// 6. ヒント開始処理
function startHint(id) {
    if (currentUser.karikari < 5) return updateNellMessage("カリカリが足りないにゃ……お勉強して貯めてね。", "thinking");
    
    selectedProblem = transcribedProblems.find(p => p.id === id); 
    hintIndex = 0;
    
    // カリカリ消費
    currentUser.karikari -= 5; 
    saveAndSync();
    
    switchView('final-view'); 
    document.getElementById('hint-detail-container').classList.remove('hidden');
    
    // 黒板に問題を表示
    const board = document.getElementById('chalkboard');
    board.innerText = (selectedProblem.label || "") + " " + selectedProblem.question;
    board.classList.remove('hidden');
    
    document.getElementById('answer-display-area').classList.add('hidden');
    showHintStep();
}

function showHintStep() {
    // ヒントがあるかチェック
    const hints = selectedProblem.hints || ["ヒントがないにゃ……", "自分で考えてみてにゃ", "答えを見る？"];
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
    currentUser.karikari -= 5; 
    saveAndSync(); 
    hintIndex++; 
    showHintStep();
}

function revealAnswer() {
    const ans = selectedProblem.correct_answer; 
    document.getElementById('final-answer-text').innerText = ans; 
    document.getElementById('answer-display-area').classList.remove('hidden'); 