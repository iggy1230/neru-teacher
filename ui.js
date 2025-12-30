// --- ui.js (完全版) ---

function switchScreen(to) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    const target = document.getElementById(to);
    if (target) {
        target.classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'instant' });
    }
}

function updateProgress(p) {
    const bar = document.getElementById('progress-bar');
    if (bar) bar.style.width = p + '%';
    const txt = document.getElementById('progress-percent');
    if (txt) txt.innerText = Math.floor(p);
}

function drawHanamaru() {
    const c = document.getElementById('hanamaru-canvas');
    if (!c) return;
    c.width = window.innerWidth; c.height = window.innerHeight;
    const ctx = c.getContext('2d');
    ctx.strokeStyle = '#ff5252'; ctx.lineWidth = 10;
    let t = 0;
    function anim() {
        ctx.clearRect(0,0,c.width,c.height);
        ctx.beginPath(); ctx.arc(c.width/2, c.height/2, 100, 0, t);
        ctx.stroke();
        t += 0.2;
        if(t < 6.5) requestAnimationFrame(anim);
        else setTimeout(() => ctx.clearRect(0,0,c.width,c.height), 2000);
    }
    anim();
}

function switchView(id) {
    document.getElementById('problem-selection-view').classList.add('hidden');
    document.getElementById('final-view').classList.add('hidden');
    document.getElementById('grade-sheet-container').classList.add('hidden');
    document.getElementById('hint-detail-container').classList.add('hidden');
    
    const target = document.getElementById(id);
    if(target) target.classList.remove('hidden');
}

// --- 以下、ボタンアクション用関数 ---

// トップ画面：「新しく入学するにゃ」ボタン
function showEnrollment() {
    switchScreen('screen-enrollment');
    // 顔認識モデルの読み込み開始
    loadFaceModels(); 
}

// 入学画面・ロビー画面：「もどる」「帰宅する」ボタン
function backToGate() {
    switchScreen('screen-gate');
}

// 教室・出席簿画面：「←」「教室にもどる」ボタン
// モード選択画面や出席簿からロビーに戻る際に使用
function backToLobby() {
    switchScreen('screen-lobby');
    // メッセージをリセット
    if(currentUser) updateNellMessage(getNellGreeting(currentUser), "happy");
}

// 教室画面：「他の問題へ」ボタンなど
function backToProblemSelection() {
    switchView('problem-selection-view');
    updateNellMessage("次はどの問題にするにゃ？", "normal");
}

// ロビー画面：「出席簿をみる」ボタン
function showAttendance() {
    switchScreen('screen-attendance');
    renderAttendance();
}

// 出席簿の描画（簡易版）
function renderAttendance() {
    const grid = document.getElementById('attendance-grid');
    if (!grid || !currentUser) return;
    grid.innerHTML = "";
    
    // 過去14日分を表示するロジック
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
        const d = new Date();
        d.setDate(today.getDate() - i);
        const dateKey = d.toISOString().split('T')[0];
        
        // currentUser.attendance にデータがあれば「出席」扱い
        // (データ構造: { "2025-10-01": true })
        const hasAttended = currentUser.attendance && currentUser.attendance[dateKey];
        
        const div = document.createElement('div');
        div.className = "day-box";
        div.style.background = hasAttended ? "#e3f2fd" : "#fff";
        div.style.color = hasAttended ? "#1565c0" : "#999";
        
        div.innerHTML = `
            <div>${d.getMonth()+1}/${d.getDate()}</div>
            <div style="font-size:1.5rem; line-height:1.5;">${hasAttended ? '🐾' : '・'}</div>
        `;
        grid.appendChild(div);
    }
    
    // 今日の出席を記録（ロビーに入った時点で記録しても良いが、ここで確認）
    const todayKey = today.toISOString().split('T')[0];
    if (!currentUser.attendance) currentUser.attendance = {};
    if (!currentUser.attendance[todayKey]) {
        currentUser.attendance[todayKey] = true;
        saveAndSync();
    }
}