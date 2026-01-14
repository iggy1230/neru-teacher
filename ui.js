// --- ui.js (完全版 v88.0: カレンダー機能実装・月切り替え対応) ---

const sfxChime = new Audio('Jpn_sch_chime.mp3');
const sfxBtn = new Audio('botan1.mp3');

// カレンダー表示用の現在月管理
let currentCalendarDate = new Date();

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

function startApp() {
    try { sfxChime.currentTime = 0; sfxChime.play(); } catch(e){}
    switchScreen('screen-gate');
    if (window.initAudioContext) window.initAudioContext();
}

function backToTitle() {
    switchScreen('screen-title');
}

function backToGate() {
    switchScreen('screen-gate');
}

function backToLobby(suppressGreeting = false) {
    switchScreen('screen-lobby');
    const shouldGreet = (typeof suppressGreeting === 'boolean') ? !suppressGreeting : true;
    if (shouldGreet && typeof currentUser !== 'undefined' && currentUser) {
        if (typeof updateNellMessage === 'function') {
            updateNellMessage(`おかえり、${currentUser.name}さん！`, "happy");
        } else {
            const el = document.getElementById('nell-text');
            if(el) el.innerText = `おかえり、${currentUser.name}さん！`;
        }
    }
}

function showEnrollment() {
    switchScreen('screen-enrollment');
    if (typeof loadFaceModels === 'function') loadFaceModels();
}

function showAttendance() {
    switchScreen('screen-attendance');
    // 開くたびに今月にリセットする場合はここを有効化
    // currentCalendarDate = new Date(); 
    if (typeof renderAttendance === 'function') renderAttendance();
}

// ★修正: カレンダー描画ロジック (1ヶ月表示・月切り替え)
// グローバルスコープに関数として登録 (HTMLのonclickから呼べるようにwindowに紐づけ)
window.renderAttendance = function() {
    const grid = document.getElementById('attendance-grid');
    if (!grid || !currentUser) return;

    // --- ① カレンダーの準備 ---
    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth(); // 0-11
    
    // 月の初めの日と、月の日数を計算
    const firstDay = new Date(year, month, 1).getDay(); // 0(日)〜6(土)
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    grid.innerHTML = ""; // 一旦空にする
    
    // --- ② ヘッダー（○月 ＋ ボタン）を作る ---
    const header = document.createElement('div');
    header.style = "grid-column: span 7; display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; font-weight: bold; font-size: 1.2rem; padding: 5px;";
    header.innerHTML = `
        <button onclick="changeCalendarMonth(-1)" class="mini-teach-btn" style="width:40px; font-size:1.2rem;">◀</button>
        <span>${year}年 ${month + 1}月</span>
        <button onclick="changeCalendarMonth(1)" class="mini-teach-btn" style="width:40px; font-size:1.2rem;">▶</button>
    `;
    grid.appendChild(header);

    // --- ③ 曜日（日〜土）を表示 ---
    const weekDays = ['日', '月', '火', '水', '木', '金', '土'];
    weekDays.forEach(day => {
        const dayEl = document.createElement('div');
        dayEl.innerText = day;
        dayEl.style = "font-size: 0.8rem; color: #888; text-align: center; font-weight:bold; padding-bottom: 5px;";
        grid.appendChild(dayEl);
    });

    // --- ④ 空白（1日より前のマス）を作る ---
    for (let i = 0; i < firstDay; i++) {
        grid.appendChild(document.createElement('div'));
    }

    // --- ⑤ 日付のマスを作る ---
    const todayStr = new Date().toISOString().split('T')[0];

    for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const hasAttended = currentUser.attendance && currentUser.attendance[dateKey];
        
        const div = document.createElement('div');
        div.className = "day-box";
        
        // CSSはstyle.cssでも調整するが、動的なスタイルはここで適用
        let borderStyle = "1px solid #f0f0f0";
        let bgStyle = "#fff";
        
        // 今日なら枠をピンクにする
        if (dateKey === todayStr) {
            borderStyle = "2px solid #ff85a1";
            bgStyle = "#fff0f3";
        }

        div.style = `
            aspect-ratio: 1/1; 
            display: flex; 
            flex-direction: column; 
            align-items: center; 
            justify-content: center; 
            border: ${borderStyle}; 
            background-color: ${bgStyle};
            border-radius: 5px; 
            position: relative; 
            font-size: 0.8rem;
        `;
        
        div.innerHTML = `
            <div style="font-size: 0.7rem; position: absolute; top: 2px; left: 4px; color:#555;">${day}</div>
            <div style="height: 60%; width: 60%; display: flex; align-items: center; justify-content: center;">
                ${hasAttended ? '<img src="nikukyuhanko.png" style="width: 100%; height: 100%; object-fit: contain;">' : ''}
            </div>
        `;
        grid.appendChild(div);
    }
};

// ★追加: 月切り替え関数
window.changeCalendarMonth = function(diff) {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + diff);
    renderAttendance();
};

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

document.addEventListener('click', (e) => {
    if (e.target.classList && e.target.classList.contains('main-btn') && !e.target.disabled) {
        if (!e.target.classList.contains('title-start-btn')) {
            try { 
                sfxBtn.currentTime = 0; 
                sfxBtn.play(); 
            } catch(err) {}
        }
    }
});