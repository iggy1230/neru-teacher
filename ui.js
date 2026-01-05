// --- ui.js (完全版: スタンプ赤色化) ---

function switchScreen(to) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    const target = document.getElementById(to);
    if (target) {
        target.classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'instant' });
    }
}

function switchView(id) {
    const ids = ['problem-selection-view', 'final-view', 'grade-sheet-container', 'hint-detail-container', 'chalkboard'];
    ids.forEach(i => {
        const el = document.getElementById(i);
        if(el) el.classList.add('hidden');
    });
    
    const target = document.getElementById(id);
    if(target) target.classList.remove('hidden');
}

// --- ボタンアクション ---

function showEnrollment() {
    switchScreen('screen-enrollment');
    if (typeof loadFaceModels === 'function') loadFaceModels();
}

function backToGate() {
    switchScreen('screen-gate');
}

function backToLobby() {
    switchScreen('screen-lobby');
    if (currentUser && typeof getNellGreeting === 'function') {
        updateNellMessage(getNellGreeting(currentUser), "happy");
    }
}

function backToProblemSelection() {
    if (typeof currentMode !== 'undefined' && currentMode === 'grade') {
        showGradingView();
        updateNellMessage("他の問題もチェックするにゃ？", "normal");
    } else {
        switchView('problem-selection-view');
        updateNellMessage("次はどの問題にするにゃ？", "normal");
    }
}

function showAttendance() {
    switchScreen('screen-attendance');
    if (typeof renderAttendance === 'function') renderAttendance();
}

function renderAttendance() {
    const grid = document.getElementById('attendance-grid');
    if (!grid || !currentUser) return;
    grid.innerHTML = "";
    const today = new Date();
    
    for (let i = 13; i >= 0; i--) {
        const d = new Date(); 
        d.setDate(today.getDate() - i);
        const dateKey = d.toISOString().split('T')[0];
        const hasAttended = currentUser.attendance && currentUser.attendance[dateKey];
        
        const div = document.createElement('div');
        div.className = "day-box";
        div.style.background = hasAttended ? "#e3f2fd" : "#fff";
        div.style.color = hasAttended ? "#1565c0" : "#999";
        // ★修正: スタンプを赤色に
        div.innerHTML = `<div>${d.getMonth()+1}/${d.getDate()}</div><div style="font-size:1.5rem; line-height:1.5; color:#ff5252;">${hasAttended ? '🐾' : '・'}</div>`;
        grid.appendChild(div);
    }
}

function updateProgress(p) {
    const bar = document.getElementById('progress-bar');
    if (bar) bar.style.width = p + '%';
    const txt = document.getElementById('progress-percent');
    if (txt) txt.innerText = Math.floor(p);
}

// 音声再生ブロック防止
document.addEventListener('click', () => {
    if (window.initAudioContext) {
        window.initAudioContext().catch(e => console.log("Audio Init:", e));
    }
}, { once: true });