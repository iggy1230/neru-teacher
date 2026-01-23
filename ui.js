// --- ui.js (完全版 v272.0: UIロジック・図鑑・記憶管理) ---

const sfxChime = new Audio('Jpn_sch_chime.mp3');
const sfxBtn = new Audio('botan1.mp3');

// カレンダー表示用の現在月管理
let currentCalendarDate = new Date();

// ==========================================
// 画面切り替え & 共通処理
// ==========================================

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
    // ブラウザの自動再生ポリシー対策（ユーザー操作時にAudioContextを一度触っておく）
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
    
    // Live Chatなどが動いていたら停止
    if (typeof window.stopLiveChat === 'function') {
        window.stopLiveChat();
    }

    const shouldGreet = (typeof suppressGreeting === 'boolean') ? !suppressGreeting : true;
    if (shouldGreet && typeof currentUser !== 'undefined' && currentUser) {
        if (typeof updateNellMessage === 'function') {
            updateNellMessage(`おかえり、${currentUser.name}さん！`, "happy");
        }
    }
};

// ==========================================
// 出席簿 (Attendance)
// ==========================================

window.showAttendance = function() {
    switchScreen('screen-attendance');
    renderAttendance();
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
    
    // ヘッダー（月切り替え）
    const header = document.createElement('div');
    header.style = "grid-column: span 7; display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; font-weight: bold; font-size: 1rem; padding: 0 5px;";
    header.innerHTML = `<button onclick="changeCalendarMonth(-1)" class="mini-teach-btn" style="width:30px; height:30px; font-size:1rem; margin:0; display:flex; align-items:center; justify-content:center;">◀</button><span style="flex: 1; text-align: center;">${year}年 ${month + 1}月</span><button onclick="changeCalendarMonth(1)" class="mini-teach-btn" style="width:30px; height:30px; font-size:1rem; margin:0; display:flex; align-items:center; justify-content:center;">▶</button>`;
    grid.appendChild(header);
    
    const weekDays = ['日', '月', '火', '水', '木', '金', '土'];
    weekDays.forEach(day => { 
        const dayEl = document.createElement('div'); 
        dayEl.innerText = day; 
        dayEl.style = "font-size: 0.7rem; color: #888; text-align: center; font-weight:bold; padding-bottom: 2px;"; 
        grid.appendChild(dayEl); 
    });
    
    for (let i = 0; i < firstDay; i++) grid.appendChild(document.createElement('div'));
    
    const todayStr = new Date().toISOString().split('T')[0];
    
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

// ==========================================
// プログレスバー (宿題分析用)
// ==========================================

window.updateProgress = function(p) { 
    const bar = document.getElementById('progress-bar'); 
    if (bar) bar.style.width = p + '%'; 
    const txt = document.getElementById('progress-percent'); 
    if (txt) txt.innerText = Math.floor(p); 
};

// ==========================================
// 図鑑 (Collection)
// ==========================================

window.showCollection = async function() {
    if (!currentUser) return;
    const modal = document.getElementById('collection-modal');
    const grid = document.getElementById('collection-grid');
    if (!modal || !grid) return;

    modal.classList.remove('hidden');
    grid.innerHTML = '<p style="width:100%; text-align:center;">読み込み中にゃ...</p>';

    // Memory.js から最新データを取得
    const profile = await window.NellMemory.getUserProfile(currentUser.id);
    const collection = profile.collection || [];

    grid.innerHTML = '';
    
    if (collection.length === 0) {
        grid.innerHTML = '<p style="width:100%; text-align:center; color:#888;">まだ何もないにゃ。<br>「個別指導」でカメラを見せてにゃ！</p>';
        return;
    }

    collection.forEach((item, index) => {
        const div = document.createElement('div');
        div.style.cssText = "background:white; border-radius:10px; padding:8px; box-shadow:0 2px 5px rgba(0,0,0,0.1); text-align:center; border:2px solid #fff176; position:relative;";
        
        // 削除ボタン (×)
        const delBtn = document.createElement('button');
        delBtn.innerText = "×";
        delBtn.style.cssText = "position:absolute; top:-8px; right:-8px; background:#ff5252; color:white; border:2px solid white; border-radius:50%; width:24px; height:24px; font-weight:bold; cursor:pointer; font-size:14px; line-height:1; padding:0; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 4px rgba(0,0,0,0.2);";
        delBtn.onclick = (e) => {
            e.stopPropagation();
            window.deleteCollectionItem(index);
        };
        div.appendChild(delBtn);

        const img = document.createElement('img');
        img.src = item.image;
        img.style.cssText = "width:100%; aspect-ratio:1; object-fit:contain; border-radius:5px; margin-bottom:5px; background:#f5f5f5;";
        
        const name = document.createElement('div');
        name.innerText = item.name;
        name.style.cssText = "font-size:0.8rem; font-weight:bold; color:#555; word-break:break-all; line-height:1.2; min-height:1.2em;";
        
        const date = document.createElement('div');
        try {
            date.innerText = new Date(item.date).toLocaleDateString();
        } catch(e) { date.innerText = ""; }
        date.style.cssText = "font-size:0.6rem; color:#aaa; margin-top:2px;";

        div.appendChild(img);
        div.appendChild(name);
        div.appendChild(date);
        grid.appendChild(div);
    });
};

window.deleteCollectionItem = async function(index) {
    if (!confirm("本当にこの写真を削除するにゃ？")) return;
    await window.NellMemory.deleteFromCollection(currentUser.id, index);
    // 削除後に再描画
    window.showCollection();
};

window.closeCollection = function() {
    const modal = document.getElementById('collection-modal');
    if (modal) modal.classList.add('hidden');
};

// ==========================================
// 記憶管理 (Memory Manager)
// ==========================================

window.openMemoryManager = function() {
    if (!currentUser) return;
    const modal = document.getElementById('memory-manager-modal');
    if (modal) {
        modal.classList.remove('hidden');
        switchMemoryTab('profile'); // デフォルトはプロフィールタブ
    }
};

window.closeMemoryManager = function() {
    const modal = document.getElementById('memory-manager-modal');
    if (modal) modal.classList.add('hidden');
};

window.switchMemoryTab = async function(tab) {
    // UIのタブ切り替え
    document.querySelectorAll('.memory-tab').forEach(t => t.classList.remove('active'));
    const activeTabBtn = document.getElementById(`tab-${tab}`);
    if (activeTabBtn) activeTabBtn.classList.add('active');

    // 表示エリアの切り替え
    document.getElementById('memory-view-profile').classList.add('hidden');
    document.getElementById('memory-view-logs').classList.add('hidden');
    document.getElementById(`memory-view-${tab}`).classList.remove('hidden');

    // データの読み込み
    const container = (tab === 'profile') ? document.getElementById('profile-container') : document.getElementById('memory-list-container');
    if (container) {
        container.innerHTML = '<p style="text-align:center; padding:20px; color:#888;">読み込み中にゃ...</p>';
        
        if (tab === 'profile') {
            const profile = await window.NellMemory.getUserProfile(currentUser.id);
            renderProfileView(container, profile);
        } else {
            renderLogView(container);
        }
    }
};

function renderProfileView(container, profile) {
    container.innerHTML = '';
    if (!profile) {
        container.innerHTML = '<p style="text-align:center;">まだ記憶がないにゃ。</p>';
        return;
    }

    // セクション作成ヘルパー
    const createSection = (title, items, isArray = false) => {
        const div = document.createElement('div');
        div.className = 'profile-section';
        const h4 = document.createElement('h4');
        h4.className = 'profile-title';
        h4.innerText = title;
        div.appendChild(h4);

        if (isArray) {
            const tagsDiv = document.createElement('div');
            tagsDiv.className = 'profile-tags';
            if (!items || items.length === 0) {
                tagsDiv.innerHTML = '<span style="color:#aaa; font-size:0.8rem;">(まだないにゃ)</span>';
            } else {
                items.forEach(item => {
                    const tag = document.createElement('span');
                    tag.className = 'profile-tag';
                    tag.innerText = item;
                    tagsDiv.appendChild(tag);
                });
            }
            div.appendChild(tagsDiv);
        } else {
            const p = document.createElement('p');
            p.style.fontSize = '0.9rem';
            p.style.margin = '0';
            p.style.paddingLeft = '5px';
            p.innerText = items || '(まだわかんないにゃ)';
            div.appendChild(p);
        }
        return div;
    };

    container.appendChild(createSection('あだ名', profile.nickname));
    container.appendChild(createSection('お誕生日', profile.birthday));
    container.appendChild(createSection('好きなもの', profile.likes, true));
    container.appendChild(createSection('苦手なこと', profile.weaknesses, true));
    container.appendChild(createSection('頑張ったこと', profile.achievements, true));
    
    // 最終トピック
    if (profile.last_topic) {
         const div = document.createElement('div');
         div.className = 'profile-section';
         div.innerHTML = `<h4 class="profile-title">最後のお話</h4><p style="font-size:0.8rem; color:#666;">${profile.last_topic}</p>`;
         container.appendChild(div);
    }
}

function renderLogView(container) {
    container.innerHTML = '';
    const memoryKey = `nell_raw_chat_log_${currentUser.id}`;
    let history = [];
    try {
        history = JSON.parse(localStorage.getItem(memoryKey) || '[]');
    } catch(e) {}

    if (history.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:#888;">まだ会話してないにゃ。</p>';
        return;
    }

    // 新しい順に表示 (最新50件)
    [...history].reverse().forEach(item => {
        const div = document.createElement('div');
        div.className = 'memory-item';
        
        const isUser = (item.role === 'user');
        const roleColor = isUser ? '#2196f3' : '#ff85a1';
        const roleName = isUser ? 'あなた' : 'ネル先生';
        
        let timeStr = '';
        try { 
            const d = new Date(item.time);
            timeStr = `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
        } catch(e){}

        div.innerHTML = `
            <div style="width:100%;">
                <div class="memory-meta" style="color:${roleColor}; font-weight:bold; display:flex; justify-content:space-between;">
                    <span>${roleName}</span>
                    <span style="color:#ccc; font-weight:normal; font-size:0.7rem;">${timeStr}</span>
                </div>
                <div class="memory-text" style="margin-top:2px;">${item.text}</div>
            </div>
        `;
        container.appendChild(div);
    });
}

// ==========================================
// ボタンクリック時のSE設定
// ==========================================
document.addEventListener('click', (e) => { 
    // 音声コンテキストの初期化（ポリシー対策）
    if (window.initAudioContext) window.initAudioContext().catch(e => console.log("Audio Init:", e));

    if (e.target.classList && e.target.classList.contains('main-btn') && !e.target.disabled) { 
        if (!e.target.classList.contains('title-start-btn') && !e.target.onclick?.toString().includes('null')) { 
            try { sfxBtn.currentTime = 0; sfxBtn.play(); } catch(err) {} 
        } 
    } 
});