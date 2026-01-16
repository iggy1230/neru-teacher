// --- ui.js (完全版 v119.0: 画面遷移安定化) ---

const sfxChime = new Audio('Jpn_sch_chime.mp3');
const sfxBtn = new Audio('botan1.mp3');

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
        // user.js側の同名関数がある場合のフック（必要に応じて）
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
    
    grid.style.gap = "2px";
    grid.style.padding = "5px";
    
    grid.innerHTML = ""; 
    const header = document.createElement('div');
    header.style = "grid-column: span 7; display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; font-weight: bold; font-size: 1rem; padding: 0 5px;";
    header.innerHTML = `<button onclick="changeCalendarMonth(-1)" class="mini-teach-btn" style="width:30px; height:30px; font-size:1rem; margin:0; display:flex; align-items:center; justify-content:center;">◀</button><span style="flex: 1; text-align: center;">${year}年 ${month + 1}月</span><button onclick="changeCalendarMonth(1)" class="mini-teach-btn" style="width:30px; height:30px; font-size:1rem; margin:0; display:flex; align-items:center; justify-content:center;">▶</button>`;
    grid.appendChild(header);
    
    const weekDays = ['日', '月', '火', '水', '木', '金', '土'];
    weekDays.forEach(day => { const dayEl = document.createElement('div'); dayEl.innerText = day; dayEl.style = "font-size: 0.7rem; color: #888; text-align: center; font-weight:bold; padding-bottom: 2px;"; grid.appendChild(dayEl); });
    
    for (let i = 0; i < firstDay; i++) grid.appendChild(document.createElement('div'));
    const todayStr = new Date().toISOString().split('T')[0];
    
    for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const hasAttended = currentUser.attendance && currentUser.attendance[dateKey];
        const div = document.createElement('div');
        div.className = "day-box";
        let borderStyle = "1px solid #f0f0f0"; let bgStyle = "#fff";
        if (dateKey === todayStr) { borderStyle = "2px solid #ff85a1"; bgStyle = "#fff0f3"; }
        div.style = `height: 40px; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; border: ${borderStyle}; background-color: ${bgStyle}; border-radius: 4px; position: relative; font-size: 0.7rem; overflow: hidden;`;
        div.innerHTML = `<div style="font-size: 0.6rem; color:#555; margin-top:2px;">${day}</div>`;
        if (hasAttended) {
            const stamp = document.createElement('img');
            stamp.src = "nikukyuhanko.png";
            stamp.style.cssText = "position:absolute; bottom:2px; width:70%; height:auto; object-fit:contain; opacity:0.8;";
            div.appendChild(stamp);
        }
        grid.appendChild(div);
    }
};

window.changeCalendarMonth = function(diff) { currentCalendarDate.setMonth(currentCalendarDate.getMonth() + diff); renderAttendance(); };
window.updateProgress = function(p) { const bar = document.getElementById('progress-bar'); if (bar) bar.style.width = p + '%'; const txt = document.getElementById('progress-percent'); if (txt) txt.innerText = Math.floor(p); };

document.addEventListener('click', () => { if (window.initAudioContext) window.initAudioContext().catch(e => console.log("Audio Init:", e)); }, { once: true });
document.addEventListener('click', (e) => { if (e.target.classList && e.target.classList.contains('main-btn') && !e.target.disabled) { if (!e.target.classList.contains('title-start-btn') && !e.target.onclick?.toString().includes('null')) { try { sfxBtn.currentTime = 0; sfxBtn.play(); } catch(err) {} } } });