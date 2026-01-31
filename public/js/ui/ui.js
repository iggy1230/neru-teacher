// --- js/ui/ui.js (完全版 v305.0: 足あとマップ実装版) ---

// カレンダー表示用の現在月管理
let currentCalendarDate = new Date();

// ==========================================
// 音量管理 (直接操作)
// ==========================================

window.toggleMuteDirect = function() {
    window.isMuted = !window.isMuted;
    window.applyVolumeToAll();
    window.updateVolumeUI();
};

window.changeVolumeDirect = function(slider) {
    window.appVolume = slider.value / 100;
    if (window.appVolume > 0 && window.isMuted) {
        window.isMuted = false; // スライダー操作でミュート解除
    }
    window.applyVolumeToAll();
    window.updateVolumeUI();
};

window.updateVolumeUI = function() {
    const btn = document.getElementById('mute-btn');
    const slider = document.getElementById('direct-volume-slider');
    
    if (btn) {
        btn.innerText = window.isMuted ? "🔇" : "🔊";
    }
    if (slider) {
        slider.value = window.appVolume * 100;
        slider.style.opacity = window.isMuted ? "0.5" : "1.0";
    }
};

window.applyVolumeToAll = function() {
    const targetVol = window.isMuted ? 0 : window.appVolume;
    
    // 1. Audio Elements (constants.jsで定義された効果音たち)
    if (window.audioList) {
        window.audioList.forEach(audio => {
            if (audio === window.sfxBunseki) {
                audio.volume = targetVol * 0.1; 
            } else {
                audio.volume = targetVol;
            }
        });
    }
    
    // 2. Web Audio API Master Gain (TTS & Realtime Chat)
    if (window.masterGainNode && window.audioCtx) {
        // 現在時刻で即座に変更
        window.masterGainNode.gain.setValueAtTime(targetVol, window.audioCtx.currentTime);
    }
};

// ==========================================
// 画面切り替え・基本ナビゲーション
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
    window.updateVolumeUI(); // 画面遷移時にUI状態を確認
};

window.startApp = async function() {
    if (window.initAudioContext) {
        await window.initAudioContext();
    }
    if (window.sfxChime) {
        window.safePlay(window.sfxChime);
    }
    switchScreen('screen-gate');
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
    
    if (typeof window.stopAlwaysOnListening === 'function') window.stopAlwaysOnListening();
    if (typeof window.stopLiveChat === 'function') window.stopLiveChat();
    if (typeof window.stopPreviewCamera === 'function') window.stopPreviewCamera();
    if (typeof window.cancelNellSpeech === 'function') window.cancelNellSpeech();

    if (window.isAnalyzing !== undefined) window.isAnalyzing = false;

    const shouldGreet = (typeof suppressGreeting === 'boolean') ? !suppressGreeting : true;
    if (shouldGreet && typeof currentUser !== 'undefined' && currentUser) {
        if (typeof updateNellMessage === 'function') {
            updateNellMessage(`おかえり、${currentUser.name}さん！`, "happy");
        }
    }
    const icon = document.querySelector('.nell-avatar-wrap img'); 
    if(icon) icon.src = "assets/images/characters/nell-normal.png"; 
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
            stamp.src = "assets/images/items/nikukyuhanko.png";
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
// プログレスバー
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
    if (!modal) return;
    
    modal.innerHTML = `
        <div class="memory-modal-content" style="max-width: 600px; background:#fff9c4; height: 80vh; display: flex; flex-direction: column;">
            <h3 style="text-align:center; margin:0 0 15px 0; color:#f57f17; flex-shrink: 0;">📖 お宝図鑑</h3>
            <div id="collection-grid" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap:10px; flex: 1; overflow-y:auto; padding:5px;">
                <p style="width:100%; text-align:center;">読み込み中にゃ...</p>
            </div>
            <div style="text-align:center; margin-top:15px; flex-shrink: 0;">
                <button onclick="closeCollection()" class="main-btn gray-btn" style="width:auto; padding:10px 30px;">閉じる</button>
            </div>
        </div>
    `;
    modal.classList.remove('hidden');

    const profile = await window.NellMemory.getUserProfile(currentUser.id);
    const collection = profile.collection || [];
    const grid = document.getElementById('collection-grid');
    grid.innerHTML = '';
    
    if (collection.length === 0) {
        grid.innerHTML = '<p style="width:100%; text-align:center; color:#888;">まだ何もないにゃ。<br>「ネル先生のお宝図鑑」でカメラを見せてにゃ！</p>';
        return;
    }

    collection.forEach((item, index) => {
        const div = document.createElement('div');
        div.style.cssText = "background:white; border-radius:12px; padding:8px; box-shadow:0 3px 6px rgba(0,0,0,0.15); text-align:center; border:2px solid #fff176; position:relative; cursor:pointer; display:flex; flex-direction:column; align-items:center; justify-content:center; aspect-ratio: 0.85; transition:transform 0.1s;";
        
        div.onclick = () => window.showCollectionDetail(item, index); 
        div.onmousedown = () => div.style.transform = "scale(0.95)";
        div.onmouseup = () => div.style.transform = "scale(1.0)";

        const img = document.createElement('img');
        img.src = item.image;
        img.style.cssText = "width:100%; height:auto; max-height:75%; object-fit:contain; margin-bottom:5px; filter:drop-shadow(0 2px 2px rgba(0,0,0,0.1));";
        
        const name = document.createElement('div');
        // 図鑑リスト表示でもふりがなを隠す
        name.innerText = item.name.replace(/([一-龠々ヶ]+)[\(（]([ぁ-んァ-ンー]+)[\)）]/g, '$1');
        name.style.cssText = "font-size:0.8rem; font-weight:bold; color:#555; width:100%; line-height:1.2; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;";

        div.appendChild(img);
        div.appendChild(name);
        grid.appendChild(div);
    });
};

window.showCollectionDetail = function(item, index) {
    const modal = document.getElementById('collection-modal');
    if (!modal) return;

    const dateStr = item.date ? new Date(item.date).toLocaleDateString() : "";
    
    // 詳細表示でもふりがなを隠す
    const displayItemName = item.name.replace(/([一-龠々ヶ]+)[\(（]([ぁ-んァ-ンー]+)[\)）]/g, '$1');
    const description = (item.description || "（ネル先生の解説はまだないみたいだにゃ…）").replace(/([一-龠々ヶ]+)[\(（]([ぁ-んァ-ンー]+)[\)）]/g, '$1');
    const realDescription = (item.realDescription || "（まだ情報がないみたいだにゃ…）").replace(/([一-龠々ヶ]+)[\(（]([ぁ-んァ-ンー]+)[\)）]/g, '$1');

    modal.innerHTML = `
        <div class="memory-modal-content" style="max-width: 600px; background:#fff9c4; height: 80vh; display: flex; flex-direction: column;">
            <div style="flex-shrink:0; display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <button onclick="showCollection()" class="mini-teach-btn" style="background:#8d6e63;">← 戻る</button>
                <h3 style="margin:0; color:#f57f17; font-size:1.1rem;">お宝データ</h3>
                <button onclick="deleteCollectionItem(${index})" class="mini-teach-btn" style="background:#ff5252;">削除</button>
            </div>
            
            <div style="flex:1; overflow-y:auto; background:white; border-radius:10px; padding:20px; box-shadow:inset 0 0 10px rgba(0,0,0,0.05);">
                <div style="text-align:center; margin-bottom:15px;">
                    <img src="${item.image}" style="width:100%; max-width:280px; height:auto; object-fit:contain; border-radius:50%; border:5px solid #ffd700; box-shadow:0 4px 10px rgba(0,0,0,0.2);">
                </div>
                
                <div style="font-size:1.6rem; font-weight:900; color:#e65100; text-align:center; margin-bottom:15px; border-bottom:2px dashed #ffcc80; padding-bottom:10px;">
                    ${displayItemName}
                </div>
                
                <div style="background:#fff3e0; padding:15px; border-radius:10px; position:relative; border:2px solid #ffe0b2; margin-bottom: 20px;">
                    <div style="position:absolute; top:-12px; left:15px; background:#ff9800; color:white; font-size:0.8rem; padding:2px 10px; border-radius:15px; font-weight:bold; box-shadow:0 2px 4px rgba(0,0,0,0.1);">ネル先生の解説</div>
                    <p style="margin:10px 0 0 0; font-size:1rem; line-height:1.6; color:#5d4037;">
                        ${description}
                    </p>
                </div>

                <div style="background:#e3f2fd; padding:15px; border-radius:10px; position:relative; border:2px solid #90caf9;">
                    <div style="position:absolute; top:-12px; left:15px; background:#1e88e5; color:white; font-size:0.8rem; padding:2px 10px; border-radius:15px; font-weight:bold; box-shadow:0 2px 4px rgba(0,0,0,0.1);">🎓 ほんとうのこと</div>
                    <p style="margin:10px 0 0 0; font-size:0.95rem; line-height:1.6; color:#0d47a1;">
                        ${realDescription}
                    </p>
                </div>
                
                <div style="text-align:right; font-size:0.7rem; color:#aaa; margin-top:15px;">
                    発見日: ${dateStr}
                </div>
            </div>
            
            <div style="text-align:center; margin-top:10px; flex-shrink:0;">
                <button onclick="closeCollection()" class="main-btn gray-btn" style="width:auto; padding:8px 30px; font-size:0.9rem;">閉じる</button>
            </div>
        </div>
    `;
};

window.deleteCollectionItem = async function(index) {
    if (!confirm("本当にこのお宝を削除するにゃ？")) return;
    if (window.NellMemory && currentUser) {
        await window.NellMemory.deleteFromCollection(currentUser.id, index);
        window.showCollection(); 
    }
};

window.closeCollection = function() {
    const modal = document.getElementById('collection-modal');
    if (modal) modal.classList.add('hidden');
};

// ==========================================
// ★ 足あとマップ (Leaflet)
// ==========================================

window.mapInstance = null;

window.showMap = async function() {
    if (!currentUser) return;
    
    // 現在地情報の更新を試みる
    if (typeof window.startLocationWatch === 'function') {
        window.startLocationWatch();
    }

    switchScreen('screen-map');
    
    // マップ初期化 (初回のみ)
    if (!window.mapInstance) {
        window.mapInstance = L.map('map-container');
        
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(window.mapInstance);
    }
    
    // サイズ再計算 (display:none解除後のお作法)
    setTimeout(() => {
        window.mapInstance.invalidateSize();
        
        // 中心点を決定
        let centerLat = 35.6895; // 東京
        let centerLon = 139.6917;
        
        if (window.currentLocation && window.currentLocation.lat) {
            centerLat = window.currentLocation.lat;
            centerLon = window.currentLocation.lon;
        }
        
        window.mapInstance.setView([centerLat, centerLon], 15);
        
        // ピン立て処理
        window.renderMapMarkers();
    }, 200);
};

window.renderMapMarkers = async function() {
    if (!window.mapInstance || !window.NellMemory || !currentUser) return;
    
    // 既存マーカーを削除 (レイヤーグループを使うのが一般的だが、簡易的に全削除)
    window.mapInstance.eachLayer((layer) => {
        if (layer instanceof L.Marker) {
            window.mapInstance.removeLayer(layer);
        }
    });

    const profile = await window.NellMemory.getUserProfile(currentUser.id);
    const collection = profile.collection || [];
    
    let hasMarkers = false;
    
    collection.forEach(item => {
        if (item.location && item.location.lat && item.location.lon) {
            hasMarkers = true;
            
            // カスタムアイコン (写真を表示)
            const icon = L.divIcon({
                className: 'custom-div-icon',
                html: `<div class="map-pin-icon" style="background-image: url('${item.image}');"></div>`,
                iconSize: [50, 50],
                iconAnchor: [25, 25],
                popupAnchor: [0, -30]
            });
            
            // ふりがな除去
            const displayName = item.name.replace(/([一-龠々ヶ]+)[\(（]([ぁ-んァ-ンー]+)[\)）]/g, '$1');
            const dateStr = item.date ? new Date(item.date).toLocaleDateString() : "";

            const marker = L.marker([item.location.lat, item.location.lon], { icon: icon }).addTo(window.mapInstance);
            
            marker.bindPopup(`
                <div style="text-align:center;">
                    <img src="${item.image}" style="width:100px; height:100px; object-fit:contain; margin-bottom:5px;"><br>
                    <strong>${displayName}</strong><br>
                    <span style="font-size:0.8rem; color:#666;">${dateStr}</span>
                </div>
            `);
        }
    });
    
    if (!hasMarkers && window.currentLocation) {
        L.marker([window.currentLocation.lat, window.currentLocation.lon]).addTo(window.mapInstance)
            .bindPopup("現在はここだにゃ！").openPopup();
    }
};

// ==========================================
// ★ 記憶管理
// ==========================================

window.openMemoryManager = function() {
    if (!currentUser) return;
    const modal = document.getElementById('memory-manager-modal');
    if (modal) {
        modal.classList.remove('hidden');
        switchMemoryTab('profile'); 
    }
};

window.closeMemoryManager = function() {
    const modal = document.getElementById('memory-manager-modal');
    if (modal) modal.classList.add('hidden');
};

window.switchMemoryTab = async function(tab) {
    document.querySelectorAll('.memory-tab').forEach(t => t.classList.remove('active'));
    const activeTabBtn = document.getElementById(`tab-${tab}`);
    if (activeTabBtn) activeTabBtn.classList.add('active');

    document.getElementById('memory-view-profile').classList.add('hidden');
    document.getElementById('memory-view-logs').classList.add('hidden');
    document.getElementById(`memory-view-${tab}`).classList.remove('hidden');

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

// ページ読み込み完了時にUI状態を初期化
document.addEventListener('DOMContentLoaded', () => {
    window.updateVolumeUI();
});

document.addEventListener('click', () => { 
    if (window.initAudioContext) window.initAudioContext().catch(e => console.log("Audio Init:", e)); 
}, { once: true });

document.addEventListener('click', (e) => { 
    if (e.target.classList && e.target.classList.contains('main-btn') && !e.target.disabled) { 
        if (!e.target.classList.contains('title-start-btn') && !e.target.onclick?.toString().includes('null')) { 
            if(window.sfxBtn) window.safePlay(window.sfxBtn);
        } 
    } 
});

// ==========================================
// ★ ログ管理・セッション履歴・UI更新
// ==========================================

// ★修正: サーバーから送られた「筑後市(ちくごし)」などのふりがな付きテキストを、
// 表示用は「筑後市」、音声用は「筑後市(ちくごし)」（サーバー側で読み上げ時にふりがなのみ化）に分ける処理を追加
window.addLogItem = function(role, text) {
    const container = document.getElementById('log-content');
    if (!container) return;
    const div = document.createElement('div');
    div.className = `log-item log-${role}`;
    const name = role === 'user' ? (currentUser ? currentUser.name : 'あなた') : 'ネル先生';
    
    // 表示用に「漢字(ふりがな)」のふりがな部分を削除
    const displayText = text.replace(/([一-龠々ヶ]+)[\(（]([ぁ-んァ-ンー]+)[\)）]/g, '$1');

    div.innerHTML = `<span class="log-role">${name}:</span><span>${displayText}</span>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
};

window.addToSessionHistory = function(role, text) {
    if (!window.chatSessionHistory) window.chatSessionHistory = [];
    window.chatSessionHistory.push({ role: role, text: text });
    if (window.chatSessionHistory.length > 10) {
        window.chatSessionHistory.shift();
    }
};

window.updateNellMessage = async function(t, mood = "normal", saveToMemory = false, speak = true) {
    if (window.liveSocket && window.liveSocket.readyState === WebSocket.OPEN && window.currentMode !== 'chat') {
        speak = false;
    }

    const gameScreen = document.getElementById('screen-game');
    const isGameHidden = gameScreen ? gameScreen.classList.contains('hidden') : true;
    const targetId = isGameHidden ? 'nell-text' : 'nell-text-game';
    const el = document.getElementById(targetId);
    
    // --- 表示用テキストのクリーニング ---
    let cleanText = t || "";

    cleanText = cleanText.split('\n').filter(line => {
        const trimmed = line.trim();
        if (!trimmed) return true;
        if (/^(?:System|User|Model|Assistant|Display|Thinking)[:：]/i.test(trimmed)) return false;
        if (/^\*\*.*\*\*$/.test(trimmed)) return false;
        if (/^\[.*\]$/.test(trimmed)) return false;
        const hasJapanese = /[ぁ-んァ-ン一-龠]/.test(line);
        if (!hasJapanese && /[a-zA-Z]/.test(line)) return false;
        return true;
    }).join('\n');

    cleanText = cleanText.replace(/(?:\[|【)DISPLAY[:：].*?(?:\]|】)/gi, "");
    cleanText = cleanText.replace(/^\s*[\(（【\[].*?[\)）】\]]/gm, ""); 
    cleanText = cleanText.replace(/[\(（【\[].*?[\)）】\]]\s*$/gm, "");
    cleanText = cleanText.trim();
    
    // ★修正: 画面表示用テキスト（ふりがな削除）
    const displayText = cleanText.replace(/([一-龠々ヶ]+)[\(（]([ぁ-んァ-ンー]+)[\)）]/g, '$1');
    
    if (el) el.innerText = displayText;
    
    if (t && t.includes("もぐもぐ")) { if(window.safePlay) window.safePlay(window.sfxBori); }
    
    if (saveToMemory) { window.saveToNellMemory('nell', cleanText); }
    
    // ★修正: 音声合成には元のテキスト（ふりがな付き）を渡す
    // サーバー側で「漢字(ふりがな)」を「ふりがな」に置換して発音するため
    if (speak && typeof speakNell === 'function') {
        let textForSpeech = cleanText.replace(/【.*?】/g, "").replace(/\[.*?\]/g, "").trim();
        textForSpeech = textForSpeech.replace(/🐾/g, "");
        if (textForSpeech.length > 0) {
            await speakNell(textForSpeech, mood);
        }
    }
};

window.sendHttpText = async function(context) {
    let inputId;
    if (context === 'embedded') { inputId = 'embedded-text-input'; }
    else if (context === 'simple') { inputId = 'simple-text-input'; }
    else return;

    const input = document.getElementById(inputId);
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    if (window.isAlwaysListening && window.continuousRecognition) {
        try { window.continuousRecognition.stop(); } catch(e){}
    }
    
    // ★修正: ログ表示もふりがな削除対応
    window.addLogItem('user', text);
    window.addToSessionHistory('user', text);

    try {
        window.updateNellMessage("ん？どれどれ…", "thinking", false, true);
        
        const res = await fetch('/chat-dialogue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                text: text, 
                name: currentUser ? currentUser.name : "生徒",
                history: window.chatSessionHistory,
                location: window.currentLocation,
                address: window.currentAddress
            })
        });

        if(res.ok) {
            const data = await res.json();
            const speechText = data.speech || data.reply || "教えてあげるにゃ！";
            
            // ★修正: ログ表示もふりがな削除対応
            window.addLogItem('nell', speechText);
            window.addToSessionHistory('nell', speechText);
            
            await window.updateNellMessage(speechText, "happy", true, true);
            
            let boardId = (context === 'embedded') ? 'embedded-chalkboard' : 'chalkboard-simple';
            const embedBoard = document.getElementById(boardId);
            if (embedBoard && data.board && data.board.trim() !== "") {
                embedBoard.innerText = data.board;
                embedBoard.classList.remove('hidden');
            }
            input.value = ""; 
        }
    } catch(e) {
        console.error("Text Chat Error:", e);
        window.updateNellMessage("ごめん、ちょっとわからなかったにゃ。", "thinking", false, true);
    } finally {
        if (window.isAlwaysListening) {
             try { window.continuousRecognition.start(); } catch(e){}
        }
    }
};

window.sendEmbeddedText = function() { window.sendHttpText('embedded'); };
window.sendSimpleText = function() { window.sendHttpText('simple'); };