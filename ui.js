// --- ui.js (完全版 v87.0: 出席簿カレンダー化) ---

const sfxChime = new Audio('Jpn_sch_chime.mp3');
const sfxBtn = new Audio('botan1.mp3');

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
    if (typeof renderAttendance === 'function') renderAttendance();
}

// ★修正: 出席簿カレンダー (過去30日分表示)
function renderAttendance() {
    const grid = document.getElementById('attendance-grid');
    if (!grid || !currentUser) return;
    grid.innerHTML = "";
    
    const today = new Date();
    // 過去30日分を表示
    for (let i = 29; i >= 0; i--) {
        const d = new Date(); 
        d.setDate(today.getDate() - i);
        const dateKey = d.toISOString().split('T')[0];
        const hasAttended = currentUser.attendance && currentUser.attendance[dateKey];
        
        const div = document.createElement('div');
        div.className = "day-box";
        
        // 今日の日付を目立たせる
        if (i === 0) {
            div.style.border = "2px solid #ff85a1";
            div.style.fontWeight = "bold";
        }

        div.innerHTML = `
            <div style="font-size: 0.6rem; color:#666;">${d.getMonth()+1}/${d.getDate()}</div>
            <div style="height: 25px; display: flex; align-items: center; justify-content: center;">
                ${hasAttended ? '<img src="nikukyuhanko.png" style="height: 100%; object-fit: contain;">' : '<span style="color:#eee">・</span>'}
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