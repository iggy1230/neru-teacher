// --- ui.js (完全版: ビュー管理強化) ---

// 画面切り替え（校門、ロビー、教室など）
function switchScreen(to) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    const target = document.getElementById(to);
    if (target) {
        target.classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'instant' });
    }
}

// 教室内のビュー切り替え（一元管理）
function switchView(id) {
    // 教室画面内の切り替わる要素IDをすべてリストアップ
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

    // 一旦すべて隠す
    ids.forEach(i => {
        const el = document.getElementById(i);
        if(el) el.classList.add('hidden');
    });
    
    // 指定されたIDのみ表示する
    if (id) {
        const target = document.getElementById(id);
        if(target) target.classList.remove('hidden');
    }
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
    // ロビーに戻った時にネル先生が挨拶する
    if (currentUser && typeof getNellGreeting === 'function' && typeof updateNellMessage === 'function') {
        updateNellMessage(getNellGreeting(currentUser), "happy");
    }
}

function backToProblemSelection() {
    if (typeof currentMode !== 'undefined' && currentMode === 'grade') {
        // 採点モードの場合は採点結果画面へ
        if (typeof showGradingView === 'function') showGradingView();
        if (typeof updateNellMessage === 'function') updateNellMessage("他の問題もチェックするにゃ？", "normal");
    } else {
        // それ以外は問題リストへ
        switchView('problem-selection-view');
        if (typeof updateNellMessage === 'function') updateNellMessage("次はどの問題にするにゃ？", "normal");
    }
}

function showAttendance() {
    switchScreen('screen-attendance');
    if (typeof renderAttendance === 'function') renderAttendance();
}

// 出席簿の描画
function renderAttendance() {
    const grid = document.getElementById('attendance-grid');
    if (!grid || !currentUser) return;
    grid.innerHTML = "";
    const today = new Date();
    
    // 過去14日分を表示
    for (let i = 13; i >= 0; i--) {
        const d = new Date(); 
        d.setDate(today.getDate() - i);
        const dateKey = d.toISOString().split('T')[0];
        const hasAttended = currentUser.attendance && currentUser.attendance[dateKey];
        
        const div = document.createElement('div');
        div.className = "day-box";
        
        // 出席済みなら青背景、未出席なら白背景
        div.style.background = hasAttended ? "#e3f2fd" : "#fff";
        div.style.color = hasAttended ? "#1565c0" : "#999";
        
        // スタンプ部分(🐾)を赤くする
        div.innerHTML = `
            <div>${d.getMonth()+1}/${d.getDate()}</div>
            <div style="font-size:1.5rem; line-height:1.5; color: ${hasAttended ? '#ff5252' : '#eee'} !important;">
                ${hasAttended ? '🐾' : '・'}
            </div>
        `;
        grid.appendChild(div);
    }
}

// 解析中のプログレスバー更新
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