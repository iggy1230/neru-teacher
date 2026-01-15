// --- ui.js (完全版 v109.0: 安定化) ---

const sfxChime = new Audio('Jpn_sch_chime.mp3');
const sfxBtn = new Audio('botan1.mp3');

// カレンダー表示用の現在月管理
let currentCalendarDate = new Date();

// グローバルに定義 (anlyze.jsから呼べるように)
window.switchScreen = function(to) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    const target = document.getElementById(to);
    if (target) {
        target.classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'instant' });
    } else {
        console.error(`Screen not found: ${to}`);
    }
};

window.startApp = function() {
    try { sfxChime.currentTime = 0; sfxChime.play(); } catch(e){}
    switchScreen('screen-gate');
    if (window.initAudioContext) window.initAudioContext();
};

window.backToTitle = async function() {
    // ★追加: ログアウト処理があれば実行
    if (typeof window.logoutProcess === 'function') {
        await window.logoutProcess();
    }
    switchScreen('screen-title');
};

window.backToGate = function() {
    switchScreen('screen-gate');
};

window.backToLobby = function(suppressGreeting = false) {
    switchScreen('screen-lobby');
    const shouldGreet = (typeof suppressGreeting === 'boolean') ? !suppressGreeting : true;
    if (shouldGreet && typeof currentUser !== 'undefined' && currentUser) {
        if (typeof updateNellMessage === 'function') {
            updateNellMessage(`おかえり、${currentUser.name}さん！`, "happy");
        }
    }
};

window.showEnrollment = function() {
    switchScreen('screen-enrollment');
    if (typeof window.showEnrollment === 'function') {
        // user.jsの関数（名前が同じなので再帰に注意、user.js側でフラグリセット等してるならOK）
        // ここでは単純に画面切り替えのみ行う
    }
};

window.showAttendance = function() {
    switchScreen('screen-attendance');
    if (typeof renderAttendance === 'function') renderAttendance();
};

window.renderAttendance = function() {
    const grid = document.getElementById('attendance-grid');
    if (!grid || !currentUser) return;
    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth(); 
    const firstDay = new Date(year, month, 1).getDay(); 
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    grid.innerHTML = ""; 
    const header = document.createElement('div');
    header.style = "grid-column: span 7; display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; font-weight: bold; font-size: 1.2rem; padding: 0 10px;";
    header.innerHTML = `<button onclick="changeCalendarMonth(-1)" class="mini-teach-btn" style="width:40px; height:40px; font-size:1.2rem; margin:0; display:flex; align-items:center; justify-content:center;">◀</button><span style="flex: 1; text-align: center;">${year}年 ${month + 1}月</span><button onclick="changeCalendarMonth(1)" class="mini-teach-btn" style="width:40px; height:40px; font-size:1.2rem; margin:0; display:flex; align-items:center; justify-content:center;">▶</button>`;
    grid.appendChild(header);
    const weekDays = ['日', '月', '火', '水', '木', '金', '土'];
    weekDays.forEach(day => { const dayEl = document.createElement('div'); dayEl.innerText = day; dayEl.style = "font-size: 0.8rem; color: #888; text-align: center; font-weight:bold; padding-bottom: 5px;"; grid.appendChild(dayEl); });
    for (let i = 0; i < firstDay; i++) grid.appendChild(document.createElement('div'));
    const todayStr = new Date().toISOString().split('T')[0];
    for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const hasAttended = currentUser.attendance && currentUser.attendance[dateKey];
        const div = document.createElement('div');
        div.className = "day-box";
        let borderStyle = "1px solid #f0f0f0"; let bgStyle = "#fff";
        if (dateKey === todayStr) { borderStyle = "2px solid #ff85a1"; bgStyle = "#fff0f3"; }
        div.style = `aspect-ratio: 1/1; display: flex; flex-direction: column; align-items: center; justify-content: center; border: ${borderStyle}; background-color: ${bgStyle}; border-radius: 5px; position: relative; font-size: 0.8rem;`;
        div.innerHTML = `<div style="font-size: 0.7rem; position: absolute; top: 2px; left: 4px; color:#555;">${day}</div><div style="height: 60%; width: 60%; display: flex; align-items: center; justify-content: center;">${hasAttended ? '<img src="nikukyuhanko.png" style="width: 100%; height: 100%; object-fit: contain;">' : ''}</div>`;
        grid.appendChild(div);
    }
};

window.changeCalendarMonth = function(diff) { currentCalendarDate.setMonth(currentCalendarDate.getMonth() + diff); renderAttendance(); };
window.updateProgress = function(p) { const bar = document.getElementById('progress-bar'); if (bar) bar.style.width = p + '%'; const txt = document.getElementById('progress-percent'); if (txt) txt.innerText = Math.floor(p); };

document.addEventListener('click', () => { if (window.initAudioContext) window.initAudioContext().catch(e => console.log("Audio Init:", e)); }, { once: true });
document.addEventListener('click', (e) => { if (e.target.classList && e.target.classList.contains('main-btn') && !e.target.disabled) { if (!e.target.classList.contains('title-start-btn') && !e.target.onclick?.toString().includes('null')) { try { sfxBtn.currentTime = 0; sfxBtn.play(); } catch(err) {} } } });