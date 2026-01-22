// --- ui.js (完全版 v240.0: 図鑑コメント表示対応版) ---

const sfxChime = new Audio('Jpn_sch_chime.mp3');
const sfxBtn = new Audio('botan1.mp3');

// カレンダー表示用の現在月管理
let currentCalendarDate = new Date();

// ★最重要: 画面切り替え関数
window.switchScreen = function(to) {
    // 全ての画面(.screen)を隠す
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    
    // 指定された画面だけ表示する
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
    // 戻ったときに一言
    const shouldGreet = (typeof suppressGreeting === 'boolean') ? !suppressGreeting : true;
    if (shouldGreet && typeof currentUser !== 'undefined' && currentUser) {
        if (typeof updateNellMessage === 'function') {
            updateNellMessage(`おかえり、${currentUser.name}さん！`, "happy");
        }
    }
};

// 出席簿画面へ
window.showAttendance = function() {
    switchScreen('screen-attendance');
    renderAttendance();
};

// カレンダー描画
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
    
    // ヘッダー（月移動）
    const header = document.createElement('div');
    header.style = "grid-column: span 7; display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; font-weight: bold; font-size: 1rem; padding: 0 5px;";
    header.innerHTML = `<button onclick="changeCalendarMonth(-1)" class="mini-teach-btn" style="width:30px; height:30px; font-size:1rem; margin:0; display:flex; align-items:center; justify-content:center;">◀</button><span style="flex: 1; text-align: center;">${year}年 ${month + 1}月</span><button onclick="changeCalendarMonth(1)" class="mini-teach-btn" style="width:30px; height:30px; font-size:1rem; margin:0; display:flex; align-items:center; justify-content:center;">▶</button>`;
    grid.appendChild(header);
    
    // 曜日
    const weekDays = ['日', '月', '火', '水', '木', '金', '土'];
    weekDays.forEach(day => { 
        const dayEl = document.createElement('div'); 
        dayEl.innerText = day; 
        dayEl.style = "font-size: 0.7rem; color: #888; text-align: center; font-weight:bold; padding-bottom: 2px;"; 
        grid.appendChild(dayEl); 
    });
    
    // 空白マス
    for (let i = 0; i < firstDay; i++) grid.appendChild(document.createElement('div'));
    
    const todayStr = new Date().toISOString().split('T')[0];
    
    // 日付マス
    for (let day = 1; day <= daysInMonth; day++) {
        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const hasAttended = currentUser.attendance && currentUser.attendance[dateKey];
        
        const div = document.createElement('div');
        div.className = "day-box";
        
        let borderStyle = "1px solid #f0f0f0"; 
        let bgStyle = "#fff";
        if (dateKey === todayStr) { 
            borderStyle = "2px solid #ff85a1"; 
            bgStyle = "#fff0f3"; 
        }
        
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

window.changeCalendarMonth = function(diff) { 
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + diff); 
    renderAttendance(); 
};

window.updateProgress = function(p) { 
    const bar = document.getElementById('progress-bar'); 
    if (bar) bar.style.width = p + '%'; 
    const txt = document.getElementById('progress-percent'); 
    if (txt) txt.innerText = Math.floor(p); 
};

// ★修正: 図鑑表示ロジック (コメント表示追加)
window.showCollection = async function() {
    if (!currentUser) return;
    const modal = document.getElementById('collection-modal');
    const grid = document.getElementById('collection-grid');
    if (!modal || !grid) return;

    modal.classList.remove('hidden');
    grid.innerHTML = '<p style="width:100%; text-align:center;">読み込み中にゃ...</p>';

    // データ取得
    const profile = await window.NellMemory.getUserProfile(currentUser.id);
    const collection = profile.collection || [];

    grid.innerHTML = '';
    
    if (collection.length === 0) {
        grid.innerHTML = '<p style="width:100%; text-align:center; color:#888;">まだ何もないにゃ。<br>「個別指導」でカメラを見せてにゃ！</p>';
        return;
    }

    collection.forEach(item => {
        const div = document.createElement('div');
        div.style.cssText = "background:white; border-radius:10px; padding:8px; box-shadow:0 2px 5px rgba(0,0,0,0.1); text-align:center; border:2px solid #fff176; display:flex; flex-direction:column; align-items:center;";
        
        const img = document.createElement('img');
        img.src = item.image;
        img.style.cssText = "width:80px; height:80px; object-fit:cover; border-radius:5px; margin-bottom:5px; background:#f5f5f5;";
        
        const name = document.createElement('div');
        name.innerText = item.name;
        name.style.cssText = "font-size:0.9rem; font-weight:900; color:#333; word-break:break-all; line-height:1.2; margin-bottom:3px;";
        
        // ★コメント表示
        const desc = document.createElement('div');
        desc.innerText = item.description || "";
        desc.style.cssText = "font-size:0.75rem; color:#666; word-break:break-all; line-height:1.3; background:#fff9c4; padding:4px; border-radius:5px; width:100%; margin-top:2px;";

        const date = document.createElement('div');
        try {
            date.innerText = new Date(item.date).toLocaleDateString();
        } catch(e) { date.innerText = ""; }
        date.style.cssText = "font-size:0.6rem; color:#aaa; margin-top:5px; align-self:flex-end;";

        div.appendChild(img);
        div.appendChild(name);
        if (item.description) div.appendChild(desc);
        div.appendChild(date);
        grid.appendChild(div);
    });
};

window.closeCollection = function() {
    const modal = document.getElementById('collection-modal');
    if (modal) modal.classList.add('hidden');
};

// 効果音 & AudioContext初期化
document.addEventListener('click', () => { 
    if (window.initAudioContext) window.initAudioContext().catch(e => console.log("Audio Init:", e)); 
}, { once: true });

document.addEventListener('click', (e) => { 
    if (e.target.classList && e.target.classList.contains('main-btn') && !e.target.disabled) { 
        if (!e.target.classList.contains('title-start-btn') && !e.target.onclick?.toString().includes('null')) { 
            try { sfxBtn.currentTime = 0; sfxBtn.play(); } catch(err) {} 
        } 
    } 
});