// --- ui.js (最終完全版: ボタン動作・画面遷移) ---

// 画面を切り替える基本関数
function switchScreen(to) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    const target = document.getElementById(to);
    if (target) {
        target.classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'instant' });
    }
}

// 教室内のビュー（黒板や問題など）を切り替える関数
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

// --- ボタンから呼ばれる関数群 ---

// タイトル画面 -> 校門へ
function startApp() {
    switchScreen('screen-gate');
    // 音声コンテキストの初期化（ブラウザ制限対策）
    if (window.initAudioContext) window.initAudioContext();
}

// 校門/ロビー -> タイトルへ
function backToTitle() {
    switchScreen('screen-title');
}

// 入学/ロビー -> 校門へ
function backToGate() {
    switchScreen('screen-gate');
}

// 教室/ゲーム -> ロビーへ
function backToLobby(suppressGreeting = false) {
    switchScreen('screen-lobby');
    
    // 挨拶をするかどうか判定
    const shouldGreet = (typeof suppressGreeting === 'boolean') ? !suppressGreeting : true;

    if (shouldGreet && typeof currentUser !== 'undefined' && currentUser) {
        // anlyze.jsの関数があれば呼ぶ、なければDOM直接操作
        if (typeof updateNellMessage === 'function') {
            updateNellMessage(`おかえり、${currentUser.name}さん！`, "happy");
        } else {
            const el = document.getElementById('nell-text');
            if(el) el.innerText = `おかえり、${currentUser.name}さん！`;
        }
    }
}

// 入学手続き画面へ
function showEnrollment() {
    switchScreen('screen-enrollment');
    if (typeof loadFaceModels === 'function') loadFaceModels();
}

// 出席簿画面へ
function showAttendance() {
    switchScreen('screen-attendance');
    if (typeof renderAttendance === 'function') renderAttendance();
}

// 出席簿の描画ロジック
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

// プログレスバー更新
function updateProgress(p) {
    const bar = document.getElementById('progress-bar');
    if (bar) bar.style.width = p + '%';
    const txt = document.getElementById('progress-percent');
    if (txt) txt.innerText = Math.floor(p);
}

// グローバルクリックイベント（音声再生許可のため）
document.addEventListener('click', () => {
    if (window.initAudioContext) {
        window.initAudioContext().catch(e => console.log("Audio Init:", e));
    }
}, { once: true });