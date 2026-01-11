// --- ui.js (完全版: 画面遷移・ボタン制御) ---

function switchScreen(to) {
    // すべてのスクリーンを隠す
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    
    // ターゲットを表示
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

// --- 画面遷移関数 ---

// 1. タイトルから開始 -> 校門へ
function startApp() {
    switchScreen('screen-gate');
    // BGMがあればここで再生
}

// 2. タイトルに戻る
function backToTitle() {
    switchScreen('screen-title');
}

// 3. 校門に戻る
function backToGate() {
    switchScreen('screen-gate');
}

// 4. ロビーに戻る
function backToLobby(suppressGreeting = false) {
    switchScreen('screen-lobby');
    
    // 挨拶をするかどうか
    const shouldGreet = (typeof suppressGreeting === 'boolean') ? !suppressGreeting : true;

    // currentUserが存在するか確認してから挨拶
    if (shouldGreet && typeof currentUser !== 'undefined' && currentUser && typeof updateNellMessage === 'function') {
        updateNellMessage(`おかえり、${currentUser.name}さん！`, "happy");
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

// 最初のクリックでオーディオコンテキストを初期化（ブラウザ制限対策）
document.addEventListener('click', () => {
    if (window.initAudioContext) {
        window.initAudioContext().catch(e => console.log("Audio Init:", e));
    }
}, { once: true });