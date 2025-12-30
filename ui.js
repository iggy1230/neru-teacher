// --- ui.js ---

function switchScreen(to) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    const target = document.getElementById(to);
    if (target) {
        target.classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'instant' });
    }
}

function switchView(id) {
    document.getElementById('problem-selection-view').classList.add('hidden');
    document.getElementById('final-view').classList.add('hidden');
    document.getElementById('grade-sheet-container').classList.add('hidden');
    document.getElementById('hint-detail-container').classList.add('hidden');
    document.getElementById('chalkboard').classList.add('hidden');
    
    const target = document.getElementById(id);
    if(target) target.classList.remove('hidden');
}

// --- ボタンアクション ---

// 入学画面へ
function showEnrollment() {
    switchScreen('screen-enrollment');
    if (typeof loadFaceModels === 'function') loadFaceModels();
}

// 校門へ戻る
function backToGate() {
    switchScreen('screen-gate');
}

// ロビー（教室）へ戻る
function backToLobby() {
    switchScreen('screen-lobby');
    if (currentUser) updateNellMessage(getNellGreeting(currentUser), "happy");
}

// 問題選択 または 採点シートへ戻る
function backToProblemSelection() {
    if (typeof currentMode !== 'undefined' && currentMode === 'grade') {
        // 採点モードなら採点シートを再表示
        showGradingView();
        updateNellMessage("他の問題もチェックするにゃ？", "normal");
    } else {
        // 通常モードなら問題リストへ
        switchView('problem-selection-view');
        updateNellMessage("次はどの問題にするにゃ？", "normal");
    }
}

// 出席簿
function showAttendance() {
    switchScreen('screen-attendance');
    if (typeof renderAttendance === 'function') renderAttendance();
}

function renderAttendance() {
    const grid = document.getElementById('attendance-grid');
    if (!grid || !currentUser) return;
    grid.innerHTML = "";
    
    const today = new Date();
    // 過去14日分表示
    for (let i = 13; i >= 0; i--) {
        const d = new Date();
        d.setDate(today.getDate() - i);
        const dateKey = d.toISOString().split('T')[0];
        const hasAttended = currentUser.attendance && currentUser.attendance[dateKey];
        
        const div = document.createElement('div');
        div.className = "day-box";
        div.style.background = hasAttended ? "#e3f2fd" : "#fff";
        div.style.color = hasAttended ? "#1565c0" : "#999";
        div.innerHTML = `<div>${d.getMonth()+1}/${d.getDate()}</div><div style="font-size:1.5rem; line-height:1.5;">${hasAttended ? '🐾' : '・'}</div>`;
        grid.appendChild(div);
    }
    
    // 今日の出席記録
    const todayKey = today.toISOString().split('T')[0];
    if (!currentUser.attendance) currentUser.attendance = {};
    if (!currentUser.attendance[todayKey]) {
        currentUser.attendance[todayKey] = true;
        saveAndSync();
    }
}

// プログレスバー
function updateProgress(p) {
    const bar = document.getElementById('progress-bar');
    if (bar) bar.style.width = p + '%';
    const txt = document.getElementById('progress-percent');
    if (txt) txt.innerText = Math.floor(p);
}