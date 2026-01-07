// --- ui.js (完全版: タイトル遷移・音声被り防止) ---

function switchScreen(to) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    const target = document.getElementById(to);
    if (target) {
        target.classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'instant' });
    }
}

function switchView(id) {
    const ids = [
        'subject-selection-view', 
        'upload-controls', 
        'thinking-view', 
        'problem-selection-view', 
        'final-view', 
        'grade-sheet-container', 
        'hint-detail-container', 
        'chalkboard', 
        'chat-view', 
        'lunch-view',
        'answer-display-area'
    ];

    ids.forEach(i => {
        const el = document.getElementById(i);
        if(el) el.classList.add('hidden');
    });
    
    if (id) {
        const target = document.getElementById(id);
        if(target) target.classList.remove('hidden');
    }
}

// --- タイトル・ロビー制御 ---

// 1. タイトルから開始
function startApp() {
    switchScreen('screen-gate');
    // BGMがあればここで再生
}

// 2. ゲートに戻る
function backToGate() {
    switchScreen('screen-title'); // ゲートではなくタイトルに戻す仕様に変更
}

// 3. ロビーに戻る (音声制御追加)
function backToLobby(suppressGreeting = false) {
    switchScreen('screen-lobby');
    
    // suppressGreetingが true なら挨拶しない (ぜんぶわかった時など)
    // 指定がなければ挨拶する
    // ただしイベントリスナーなどから呼ばれるとEventオブジェクトが入るので型チェック
    const shouldGreet = (typeof suppressGreeting === 'boolean') ? !suppressGreeting : true;

    if (shouldGreet && currentUser && typeof getNellGreeting === 'function' && typeof updateNellMessage === 'function') {
        updateNellMessage(getNellGreeting(currentUser), "happy");
    }
}

// --- その他ボタンアクション ---

function showEnrollment() {
    switchScreen('screen-enrollment');
    if (typeof loadFaceModels === 'function') loadFaceModels();
}

function backToProblemSelection() {
    if (typeof currentMode !== 'undefined' && currentMode === 'grade') {
        if (typeof showGradingView === 'function') showGradingView();
        if (typeof updateNellMessage === 'function') updateNellMessage("他の問題もチェックするにゃ？", "normal");
    } else {
        switchView('problem-selection-view');
        if (typeof updateNellMessage === 'function') updateNellMessage("次はどの問題にするにゃ？", "normal");
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
        
        div.innerHTML = `
            <div>${d.getMonth()+1}/${d.getDate()}</div>
            <div style="font-size:1.5rem; line-height:1.5; color: ${hasAttended ? '#ff5252' : '#eee'} !important;">
                ${hasAttended ? '🐾' : '・'}
            </div>
        `;
        grid.appendChild(div);
    }
}

function updateProgress(p) {
    const bar = document.getElementById('progress-bar');
    if (bar) bar.style.width = p + '%';
    const txt = document.getElementById('progress-percent');
    if (txt) txt.innerText = Math.floor(p);
}

document.addEventListener('click', () => {
    if (window.initAudioContext) {
        window.initAudioContext().catch(e => console.log("Audio Init:", e));
    }
}, { once: true });