// --- START OF FILE ui.js ---

// --- js/ui/ui.js (v470.40: 構文エラー完全修正版) ---

let currentCalendarDate = new Date();
window.collectionSortMode = 'desc'; 
window.collectionTabMode = 'mine';
window.collectionRenderId = null;

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
        window.isMuted = false;
    }
    window.applyVolumeToAll();
    window.updateVolumeUI();
};

window.updateVolumeUI = function() {
    const btn = document.getElementById('mute-btn');
    const slider = document.getElementById('direct-volume-slider');
    
    if (btn) btn.innerText = window.isMuted ? "🔇" : "🔊";
    if (slider) {
        slider.value = window.appVolume * 100;
        slider.style.opacity = window.isMuted ? "0.5" : "1.0";
    }
};

window.applyVolumeToAll = function() {
    const targetVol = window.isMuted ? 0 : window.appVolume;
    
    if (window.audioList) {
        window.audioList.forEach(audio => {
            if (audio === window.sfxBunseki) audio.volume = targetVol * 0.1; 
            else audio.volume = targetVol;
        });
    }
    
    if (window.masterGainNode && window.audioCtx) {
        window.masterGainNode.gain.setValueAtTime(targetVol, window.audioCtx.currentTime);
    }
};

// ==========================================
// Helper Functions
// ==========================================
window.cleanDisplayString = function(text) {
    if (!text) return "";
    let clean = text;
    clean = clean.replace(/\*\*/g, "");
    clean = clean.replace(/[\(（][ぁ-んァ-ンー\s　]+[\)）]/g, "");
    return clean;
};

window.generateRarityString = function(rarity) {
    const r = rarity || 1;
    const imgPath = "assets/images/effects/nikukyurea.png";
    let images = "";
    for(let i=0; i<r; i++) {
        images += `<img src="${imgPath}" class="rarity-img" alt="🐾">`;
    }
    return `<div class="rarity-mark rarity-${r}">${images}</div>`;
};

window.formatCollectionNumber = function(num) {
    return "No." + String(num).padStart(3, '0');
};

// ==========================================
// 画面切り替え・基本ナビゲーション
// ==========================================
window.switchScreen = function(to) {
    document.querySelectorAll('.screen').forEach(s => {
        s.classList.add('hidden');
    });

    const target = document.getElementById(to);
    if (target) {
        target.classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'instant' });
        
        if (to === 'screen-playground') {
            window.updateNellMessage("運動の時間だにゃ！", "excited", false);
        }

        const miniKarikari = document.getElementById('mini-karikari-display');
        if (miniKarikari) {
            const hideList =['screen-title', 'screen-gate', 'screen-enrollment'];
            if (hideList.includes(to)) {
                miniKarikari.classList.add('hidden');
            } else {
                miniKarikari.classList.remove('hidden');
                if (typeof window.updateMiniKarikari === 'function') {
                    window.updateMiniKarikari();
                }
            }
        }

    } else {
        console.error(`Screen not found: ${to}`);
    }
    window.updateVolumeUI(); 
};

window.startApp = async function() {
    if (window.initAudioContext) await window.initAudioContext();
    if (window.sfxChime) window.safePlay(window.sfxChime);
    switchScreen('screen-gate');
};

window.backToTitle = async function() {
    if (typeof window.logoutProcess === 'function') await window.logoutProcess();
    switchScreen('screen-title');
};

window.backToGate = function() {
    switchScreen('screen-gate');
};

window.backToLobby = function(suppressGreeting = false) {
    if (typeof window.stopAudioPlayback === 'function') window.stopAudioPlayback();
    if (typeof window.cancelNellSpeech === 'function') window.cancelNellSpeech();
    if (typeof window.stopAlwaysOnListening === 'function') window.stopAlwaysOnListening();
    if (typeof window.stopLiveChat === 'function') window.stopLiveChat();
    if (typeof window.stopPreviewCamera === 'function') window.stopPreviewCamera();
    if (typeof window.closeHomeworkCamera === 'function') window.closeHomeworkCamera();
    if (typeof window.stopDanmakuGame === 'function') window.stopDanmakuGame();
    if (typeof window.cleanupAnalysis === 'function') window.cleanupAnalysis();
    
    if (window.currentMode === 'quiz' && typeof window.persistQuizSession === 'function') {
        window.persistQuizSession();
    }
    
    window.gameRunning = false; 
    window.isAnalyzing = false;
    
    if (typeof window.stopLocationWatch === 'function') window.stopLocationWatch();

    if (window.quizState) {
        window.quizState.sessionId = Date.now(); 
        window.quizState.questionQueue =[]; 
        window.quizState.isFinished = true;
    }

    window.currentMode = null;

    switchScreen('screen-lobby');

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
    
    const weekDays =['日', '月', '火', '水', '木', '金', '土'];
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
window.switchCollectionTab = function(tab) {
    window.collectionTabMode = tab;
    
    const btnMine = document.getElementById('col-tab-mine');
    const btnPublic = document.getElementById('col-tab-public');
    if (btnMine && btnPublic) {
        if (tab === 'mine') {
            btnMine.classList.add('active-tab');
            btnPublic.classList.remove('active-tab');
        } else {
            btnMine.classList.remove('active-tab');
            btnPublic.classList.add('active-tab');
        }
    }
    
    window.renderCollectionList();
};

window.openCollectionDetailByIndex = function(index) {
    if (!window.NellMemory || !currentUser) return;

    if (window.collectionTabMode === 'mine') {
        window.NellMemory.getUserProfile(currentUser.id).then(profile => {
            if (profile && profile.collection && profile.collection[index]) {
                const modal = document.getElementById('collection-modal');
                if (modal && modal.classList.contains('hidden')) modal.classList.remove('hidden');
                
                const item = profile.collection[index];
                const totalCount = profile.collection.length;
                window.showCollectionDetail(item, index, totalCount, true);
            }
        });
    } else {
        if (window.publicCollectionCache && window.publicCollectionCache[index]) {
            const item = window.publicCollectionCache[index];
            const modal = document.getElementById('collection-modal');
            if (modal && modal.classList.contains('hidden')) modal.classList.remove('hidden');
            
            const totalCount = window.publicCollectionCache.length;
            window.showCollectionDetail(item, index, totalCount, false);
        }
    }
};

window.changeCollectionSort = function(select) {
    window.collectionSortMode = select.value;
    window.renderCollectionList(); 
};

window.showCollection = async function(keepTab = false) {
    if (!currentUser) return;
    const modal = document.getElementById('collection-modal');
    if (!modal) return;
    
    modal.innerHTML = `
        <div class="memory-modal-content" style="max-width: 600px; background:#fff9c4; height: 85vh; display: flex; flex-direction: column;">
            <h3 style="text-align:center; margin:0 0 10px 0; color:#f57f17; flex-shrink: 0;">📖 お宝図鑑</h3>
            
            <div style="display:flex; gap:10px; margin-bottom:10px; flex-shrink:0;">
                <button id="col-tab-mine" onclick="switchCollectionTab('mine')" class="memory-tab active-tab" style="flex:1; border-radius:10px; border:2px solid #f57f17; background:#fff; color:#f57f17;">じぶんの</button>
                <button id="col-tab-public" onclick="switchCollectionTab('public')" class="memory-tab" style="flex:1; border-radius:10px; border:2px solid #8d6e63; background:#fff; color:#8d6e63;">みんなの</button>
            </div>

            <div style="flex-shrink:0; display:flex; flex-direction:column; gap:8px; margin-bottom:10px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                     <button onclick="closeCollection(); showMap();" class="main-btn" style="width:auto; margin:0; padding:8px 15px; font-size:0.85rem; background:#29b6f6; box-shadow: 0 3px 0 #0288d1;">🗺️ 足あとマップ</button>
                     <div id="collection-count-badge" style="background:#fff; padding:5px 10px; border-radius:15px; font-weight:bold; color:#555; border:1px solid #ccc; font-size:0.9rem;">読み込み中...</div>
                </div>
                
                <div id="collection-sort-area" style="display:flex; align-items:center; gap:5px; justify-content:flex-end;">
                    <span style="font-size:0.8rem; font-weight:bold; color:#666;">並び替え:</span>
                    <select onchange="changeCollectionSort(this)" style="padding:5px; border-radius:5px; border:1px solid #ccc; font-size:0.8rem;">
                        <option value="desc" ${window.collectionSortMode === 'desc' ? 'selected' : ''}>新しい順</option>
                        <option value="asc" ${window.collectionSortMode === 'asc' ? 'selected' : ''}>古い順</option>
                        <option value="rarity" ${window.collectionSortMode === 'rarity' ? 'selected' : ''}>レアリティ順</option>
                    </select>
                </div>
            </div>

            <div id="collection-grid" style="display:grid; grid-template-columns: repeat(3, 1fr); grid-auto-rows: max-content; gap:12px; flex: 1; overflow-y:auto; padding:5px; align-content: start;">
                <p style="width:100%; text-align:center; grid-column: span 3;">読み込み中にゃ...</p>
            </div>
            
            <div style="text-align:center; margin-top:15px; flex-shrink: 0;"><button onclick="closeCollection()" class="main-btn gray-btn" style="width:auto; padding:10px 30px;">閉じる</button></div>
        </div>
    `;
    modal.classList.remove('hidden');

    if (!keepTab) {
        window.collectionTabMode = 'mine';
    } else {
        window.switchCollectionTab(window.collectionTabMode);
        return; 
    }

    window.renderCollectionList();
};

window.renderCollectionList = async function() {
    if (window.collectionRenderId) {
        cancelAnimationFrame(window.collectionRenderId);
        window.collectionRenderId = null;
    }

    const grid = document.getElementById('collection-grid');
    const countBadge = document.getElementById('collection-count-badge');
    const sortArea = document.getElementById('collection-sort-area');
    
    if (!grid) return;

    grid.innerHTML = '<p style="width:100%; text-align:center; grid-column: span 3;">読み込み中にゃ...</p>';
    
    let items =[];

    if (window.collectionTabMode === 'mine') {
        if (sortArea) sortArea.style.display = 'flex';
        const profile = await window.NellMemory.getUserProfile(currentUser.id);
        const collection = profile.collection ||[];
        
        items = collection.map((item, index) => ({
            ...item,
            originalIndex: index,
            number: collection.length - index
        }));

        if (window.collectionSortMode === 'asc') {
            items.sort((a, b) => a.number - b.number);
        } else if (window.collectionSortMode === 'desc') {
            items.sort((a, b) => b.number - a.number);
        } else if (window.collectionSortMode === 'rarity') {
            items.sort((a, b) => {
                const rA = a.rarity || 1;
                const rB = b.rarity || 1;
                if (rA !== rB) return rB - rA;
                return b.number - a.number;
            });
        }

    } else {
        if (sortArea) sortArea.style.display = 'none'; 
        const publicItems = await window.NellMemory.getPublicCollection();
        window.publicCollectionCache = publicItems; 
        
        items = publicItems.map((item, index) => ({
            ...item,
            originalIndex: index 
        }));
    }

    if (countBadge) countBadge.innerText = `全 ${items.length} 件`;
    grid.innerHTML = '';

    if (items.length === 0) {
        grid.innerHTML = '<p style="width:100%; text-align:center; color:#888; grid-column: span 3;">まだ何もないにゃ。</p>';
        return;
    }

    const CHUNK_SIZE = 12;
    let currentIndex = 0;

    function renderChunk() {
        if (!document.getElementById('collection-grid')) return;

        const fragment = document.createDocumentFragment();
        const chunk = items.slice(currentIndex, currentIndex + CHUNK_SIZE);

        chunk.forEach(item => {
            const div = document.createElement('div');
            div.className = "collection-grid-item"; 
            
            div.style.cssText = `
                background: white;
                border-radius: 8px;
                box-shadow: 0 2px 5px rgba(0,0,0,0.15);
                border: 1px solid #ddd;
                cursor: pointer;
                position: relative !important;
                overflow: hidden;
                aspect-ratio: 0.68;
                width: 100%;
                display: flex;
                flex-direction: column;
                margin: 0 !important;
                transform: none !important;
                top: auto !important;
                left: auto !important;
                float: none !important;
            `;
            
            div.onclick = () => window.openCollectionDetailByIndex(item.originalIndex); 

            const img = document.createElement('img');
            img.src = item.image;
            img.loading = "lazy";
            img.decoding = "async";
            img.style.cssText = "width:100%; height:100%; object-fit:contain; display:block; background-color: #f9f9f9;";
            
            const badge = document.createElement('div');
            badge.className = "info-badge";
            if (window.collectionTabMode === 'public') {
                badge.innerText = `${window.cleanDisplayString(item.discovererName || "誰か")}さん`;
            } else {
                badge.innerText = window.cleanDisplayString(item.name || "名称未設定");
            }
            div.appendChild(badge);

            div.appendChild(img);
            fragment.appendChild(div);
        });

        grid.appendChild(fragment);
        currentIndex += CHUNK_SIZE;

        if (currentIndex < items.length) {
            window.collectionRenderId = requestAnimationFrame(renderChunk);
        } else {
            window.collectionRenderId = null;
        }
    }

    renderChunk();
};

window.showCollectionDetail = function(item, originalIndex, totalCount, isMine) {
    const modal = document.getElementById('collection-modal');
    if (!modal) return;
    
    modal.classList.remove('hidden');

    let mapBtnHtml = "";
    if (item.location && item.location.lat && item.location.lon) {
        mapBtnHtml = `<button onclick="window.closeCollection(); window.showMap(${item.location.lat}, ${item.location.lon});" class="mini-teach-btn" style="background:#29b6f6; width:auto; margin-left:10px;">🗺️ 地図で見る</button>`;
    }

    let shareBtnHtml = "";
    if (isMine) {
        if (!item.isShared) {
            shareBtnHtml = `<button onclick="shareCollectionItem(${originalIndex})" class="mini-teach-btn" style="background:#ff9800; width:auto;">✨ みんなに公開する</button>`;
        } else {
            shareBtnHtml = `
                <div style="display:flex; flex-direction:column; align-items:center; gap:5px;">
                    <span style="font-size:0.8rem; color:#ff9800; font-weight:bold;">みんなに公開中だにゃ！</span>
                    <button onclick="unshareCollectionItem(${originalIndex})" class="mini-teach-btn" style="background:#78909c; width:auto;">🔒 非公開に戻す</button>
                </div>`;
        }
    } else {
        shareBtnHtml = `
            <div style="display:flex; flex-direction:column; align-items:center; gap:5px;">
                <span style="font-size:0.8rem; color:#666;">発見者: <strong>${window.cleanDisplayString(item.discovererName || "誰か")}さん</strong></span>
                <button onclick="window.cleanPublicItem('${item.id || ""}')" class="mini-teach-btn" style="background:transparent; border:1px solid #ccc; color:#888; font-size:0.7rem; width:auto; padding:2px 8px; box-shadow:none; margin-top:5px;">
                    ⚠️ データがない場合は削除
                </button>
            </div>`;
    }

    let deleteBtnHtml = "";
    if (isMine) {
        deleteBtnHtml = `<button onclick="deleteCollectionItem(${originalIndex})" class="mini-teach-btn" style="background:#ff5252;">削除</button>`;
    }

    let nameDisplayHtml = "";
    if (isMine) {
        const currentName = window.cleanDisplayString(item.name || "名称未設定");
        nameDisplayHtml = `
            <div style="display:flex; align-items:center; justify-content:center; margin-bottom:5px;">
                <h3 style="margin:0; color:#555; max-width:80%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${currentName}</h3>
                <button onclick="window.renameCollectionItem(${originalIndex}, '${currentName.replace(/'/g, "\\'")}')" 
                    style="background:none; border:none; cursor:pointer; font-size:1.2rem; margin-left:5px;">✏️</button>
            </div>
        `;
    } else {
        nameDisplayHtml = `<h3 style="text-align:center; margin:0 0 5px 0; color:#555;">${window.cleanDisplayString(item.name || "名称未設定")}</h3>`;
    }

    let leftBtnHtml = "";
    if (originalIndex > 0) {
        leftBtnHtml = `
            <button onclick="window.openCollectionDetailByIndex(${originalIndex - 1})" 
                style="position:absolute; left:10px; top:50%; transform:translateY(-50%); 
                width:40px; height:40px; border-radius:50%; border:none; background:rgba(255,255,255,0.8); 
                font-size:1.5rem; color:#555; box-shadow:0 2px 5px rgba(0,0,0,0.2); cursor:pointer; z-index:10;">
                ◀
            </button>
        `;
    }

    let rightBtnHtml = "";
    if (originalIndex < totalCount - 1) {
        rightBtnHtml = `
            <button onclick="window.openCollectionDetailByIndex(${originalIndex + 1})" 
                style="position:absolute; right:10px; top:50%; transform:translateY(-50%); 
                width:40px; height:40px; border-radius:50%; border:none; background:rgba(255,255,255,0.8); 
                font-size:1.5rem; color:#555; box-shadow:0 2px 5px rgba(0,0,0,0.2); cursor:pointer; z-index:10;">
                ▶
            </button>
        `;
    }

    modal.innerHTML = `
        <div class="memory-modal-content" style="max-width: 600px; background:#fff9c4; height: 90vh; display: flex; flex-direction: column;">
            <div style="flex-shrink:0; display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                <div style="display:flex; gap:5px; align-items:center;">
                    <button onclick="showCollection(true)" class="mini-teach-btn" style="background:#8d6e63;">← 一覧</button>
                    ${mapBtnHtml}
                </div>
                ${deleteBtnHtml}
            </div>
            
            ${nameDisplayHtml}
            
            <div style="flex:1; overflow-y:auto; background:transparent; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:5px; position:relative;">
                ${leftBtnHtml}
                <img src="${item.image}" decoding="async" style="width:auto; max-width:100%; height:auto; max-height:100%; object-fit:contain; border-radius:15px; box-shadow:0 10px 25px rgba(0,0,0,0.4);">
                ${rightBtnHtml}
            </div>
            
            <div style="text-align:center; margin-top:5px; flex-shrink:0;">
                ${shareBtnHtml}
                <br><br>
                <button onclick="closeCollection()" class="main-btn gray-btn" style="width:auto; padding:8px 30px; font-size:0.9rem;">閉じる</button>
            </div>
        </div>
    `;
};

window.cleanPublicItem = async function(docId) {
    if (!docId) return;
    if (!db) return;
    if (!confirm("画像が表示されないなどの問題がある場合、この公開データを削除できるにゃ。\n実行するにゃ？")) return;

    try {
        await db.collection("public_collection").doc(docId).delete();
        alert("公開データを削除したにゃ！スッキリしたにゃ！");
        window.showCollection(true); 
    } catch(e) {
        console.error("Public Clean Error:", e);
        alert("削除に失敗したにゃ。");
    }
};

window.renameCollectionItem = async function(index, currentName) {
    const newName = prompt("新しい名前を入れるにゃ！", currentName);
    if (newName && newName.trim() !== "" && newName !== currentName) {
        if (!currentUser || !window.NellMemory) return;
        
        try {
            await window.NellMemory.renameCollectionItem(currentUser.id, index, newName);
            window.openCollectionDetailByIndex(index);
        } catch(e) {
            alert("名前を変更できなかったにゃ...");
        }
    }
};

window.shareCollectionItem = async function(index) {
    if (!currentUser || !window.NellMemory) return;
    if (!confirm("このお宝をみんなの図鑑に公開するにゃ？\n（名前が表示されます）")) return;
    
    try {
        const result = await window.NellMemory.shareToPublicCollection(currentUser.id, index, currentUser.name);
        if (result === "SUCCESS") {
            alert("公開したにゃ！みんなが見れるようになったにゃ！");
            window.openCollectionDetailByIndex(index);
        } else if (result === "ALREADY_SHARED") {
            alert("もう公開済みだにゃ！");
        }
    } catch(e) {
        console.error(e);
        alert("公開できなかったにゃ...通信エラーかも？");
    }
};

window.unshareCollectionItem = async function(index) {
    if (!currentUser || !window.NellMemory) return;
    if (!confirm("「みんなの図鑑」から削除して、非公開に戻すにゃ？")) return;
    
    try {
        const result = await window.NellMemory.unshareFromPublicCollection(currentUser.id, index);
        if (result === "SUCCESS") {
            alert("非公開に戻したにゃ！");
            window.openCollectionDetailByIndex(index);
        } else if (result === "NOT_SHARED") {
            alert("まだ公開されてないみたいだにゃ。");
        }
    } catch(e) {
        console.error(e);
        alert("エラーが発生したにゃ...");
    }
};

window.deleteCollectionItem = async function(index) {
    if (!confirm("本当にこのお宝を削除するにゃ？")) return;
    if (window.NellMemory && currentUser) {
        await window.NellMemory.deleteFromCollection(currentUser.id, index);
        window.showCollection(true); 
    }
};

window.closeCollection = function() {
    const modal = document.getElementById('collection-modal');
    if (modal) {
        modal.classList.add('hidden');
        setTimeout(() => {
            if (modal.classList.contains('hidden')) {
                modal.innerHTML = "";
            }
        }, 300);
    }
};

// ==========================================
// ★ 足あとマップ (Leaflet)
// ==========================================
window.mapInstance = null;

window.showMap = async function(targetLat, targetLon) {
    if (!currentUser) return;
    
    if (typeof window.startLocationWatch === 'function') {
        window.startLocationWatch();
    }

    switchScreen('screen-map');
    
    if (!window.mapInstance) {
        window.mapInstance = L.map('map-container');
        
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(window.mapInstance);
    }
    
    setTimeout(() => {
        window.mapInstance.invalidateSize();
        
        let centerLat = 35.6895; 
        let centerLon = 139.6917;
        let zoomLevel = 15;
        
        if (targetLat && targetLon) {
            centerLat = targetLat;
            centerLon = targetLon;
            zoomLevel = 18;
        } else if (window.currentLocation && window.currentLocation.lat) {
            centerLat = window.currentLocation.lat;
            centerLon = window.currentLocation.lon;
        }
        
        window.mapInstance.setView([centerLat, centerLon], zoomLevel);
        window.renderMapMarkers();
    }, 200);
};

window.renderMapMarkers = async function() {
    if (!window.mapInstance || !window.NellMemory || !currentUser) return;
    
    window.mapInstance.eachLayer((layer) => {
        if (layer instanceof L.Marker) {
            window.mapInstance.removeLayer(layer);
        }
    });

    const profile = await window.NellMemory.getUserProfile(currentUser.id);
    const collection = profile.collection ||[];
    
    let hasMarkers = false;
    const displayCollection = collection.slice(0, 50);
    
    displayCollection.forEach((item, index) => {
        if (item.location && item.location.lat && item.location.lon) {
            hasMarkers = true;
            
            const icon = L.divIcon({
                className: 'custom-div-icon',
                html: `<div class="map-pin-icon" style="background-image: url('${item.image}');"></div>`,
                iconSize:[50, 50],
                iconAnchor: [25, 25],
                popupAnchor:[0, -30]
            });
            
            const displayName = window.cleanDisplayString(item.name);
            const dateStr = item.date ? new Date(item.date).toLocaleDateString() : "";
            
            const marker = L.marker([item.location.lat, item.location.lon], { icon: icon }).addTo(window.mapInstance);
            
            marker.bindPopup(`
                <div style="text-align:center; width: 150px;">
                    <img src="${item.image}" loading="lazy" style="width:100%; height:auto; border-radius:5px; margin-bottom:5px; box-shadow:0 2px 5px rgba(0,0,0,0.2);">
                    <strong>${displayName}</strong><br>
                    <span style="font-size:0.8rem; color:#666;">${dateStr}</span><br>
                    <button onclick="window.collectionTabMode='mine'; window.openCollectionDetailByIndex(${index})" class="mini-teach-btn" style="margin-top:5px; background:#ff85a1;">📖 詳しく見る</button>
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
// ★ 記憶管理 (プロフィール)
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

    const createSection = (title, items, categoryName, isArray = false) => {
        const div = document.createElement('div');
        div.className = 'profile-section';
        div.style.cssText = "background: white; padding: 10px; border-radius: 8px; margin-bottom: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); position:relative;";
        
        const h4 = document.createElement('h4');
        h4.className = 'profile-title';
        h4.innerText = title;
        div.appendChild(h4);

        if (isArray) {
            const tagsDiv = document.createElement('div');
            tagsDiv.className = 'profile-tags';
            if (!items || items.length === 0) {
                tagsDiv.innerHTML = '<span style="color:#aaa; font-size:0.8rem;">(まだ教えてもらってないにゃ)</span>';
            } else {
                items.forEach(item => {
                    const tag = document.createElement('span');
                    tag.className = 'profile-tag';
                    tag.innerHTML = `${window.cleanDisplayString(item)} <button onclick="deleteProfileItem('${categoryName}', '${item}')" class="profile-tag-delete">×</button>`;
                    tagsDiv.appendChild(tag);
                });
            }
            div.appendChild(tagsDiv);
        } else {
            const p = document.createElement('p');
            p.style.fontSize = '0.9rem';
            p.style.margin = '0';
            p.style.paddingLeft = '5px';
            p.style.display = 'flex';
            p.style.justifyContent = 'space-between';
            
            const textContent = items ? window.cleanDisplayString(items) : '(まだ教えてもらってないにゃ)';
            let deleteBtn = '';
            if (items) {
                deleteBtn = `<button onclick="deleteProfileItem('${categoryName}', '')" class="profile-tag-delete" style="margin-left:10px;">×</button>`;
            }
            p.innerHTML = `<span>${textContent}</span>${deleteBtn}`;
            div.appendChild(p);
        }
        return div;
    };

    container.appendChild(createSection('👤 あだ名', profile.nickname, 'nickname'));
    container.appendChild(createSection('🎂 お誕生日', profile.birthday, 'birthday'));
    
    const likesContainer = document.createElement('div');
    likesContainer.style.display = "flex";
    likesContainer.style.gap = "5px";
    
    const likesSec = createSection('❤️ 好きなもの', profile.likes, 'likes', true);
    likesSec.style.flex = "1";
    
    const dislikesSec = createSection('💔 苦手なもの', profile.weaknesses, 'weaknesses', true);
    dislikesSec.style.flex = "1";
    
    likesContainer.appendChild(likesSec);
    likesContainer.appendChild(dislikesSec);
    container.appendChild(likesContainer);

    container.appendChild(createSection('🏆 頑張ったこと', profile.achievements, 'achievements', true));
    
    if (profile.last_topic) {
         const div = document.createElement('div');
         div.className = 'profile-section';
         div.style.cssText = "background: #e3f2fd; padding: 10px; border-radius: 8px; margin-bottom: 10px; border: 1px solid #90caf9;";
         div.innerHTML = `<h4 class="profile-title" style="color:#1565c0;">💬 最後のお話</h4><p style="font-size:0.8rem; color:#333;">${window.cleanDisplayString(profile.last_topic)}</p>`;
         container.appendChild(div);
    }

    if (profile.collection && profile.collection.length > 0) {
        const recents = profile.collection.slice(0, 3);
        const div = document.createElement('div');
        div.className = 'profile-section';
        div.style.cssText = "background: #fff3e0; padding: 10px; border-radius: 8px; margin-bottom: 10px; border: 1px solid #ffe0b2;";
        div.innerHTML = `<h4 class="profile-title" style="color:#e65100;">📍 最近見つけたもの</h4>`;
        
        const listDiv = document.createElement('div');
        listDiv.style.display = "flex";
        listDiv.style.gap = "8px";
        listDiv.style.overflowX = "auto";
        listDiv.style.paddingBottom = "5px";
        
        recents.forEach(item => {
            const itemDiv = document.createElement('div');
            itemDiv.style.cssText = "flex-shrink: 0; width: 60px; text-align: center; font-size: 0.7rem;";
            const cleanName = window.cleanDisplayString(item.name);
            itemDiv.innerHTML = `
                <img src="${item.image}" loading="lazy" style="width:100%; height:auto; object-fit:cover; border-radius:4px; border:1px solid #ffb74d; aspect-ratio:0.68;">
                <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; width:100%; margin-top:2px;">${cleanName}</div>
            `;
            listDiv.appendChild(itemDiv);
        });
        
        div.appendChild(listDiv);
        container.appendChild(div);
    }
}

window.deleteProfileItem = async function(category, itemContent) {
    if (!currentUser) return;
    if (!confirm("この情報を忘れさせるにゃ？")) return;
    
    if (window.NellMemory) {
        await window.NellMemory.deleteProfileItem(currentUser.id, category, itemContent);
        const container = document.getElementById('profile-container');
        const profile = await window.NellMemory.getUserProfile(currentUser.id);
        renderProfileView(container, profile);
    }
};

function renderLogView(container) {
    container.innerHTML = '';
    const memoryKey = `nell_raw_chat_log_${currentUser.id}`;
    let history =[];
    try {
        history = JSON.parse(localStorage.getItem(memoryKey) || '[]');
    } catch(e) {}

    if (history.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:#888;">まだ会話してないにゃ。</p>';
        return;
    }

    const ctrlDiv = document.createElement('div');
    ctrlDiv.style.cssText = "margin-bottom:10px; text-align:right;";
    ctrlDiv.innerHTML = `
        <span style="font-size:0.8rem; color:#666; float:left;">新しい順</span>
        <button onclick="deleteSelectedLogs()" class="mini-teach-btn" style="background:#ff5252; color:white;">選択したログを削除</button>
    `;
    container.appendChild(ctrlDiv);

    const displayHistory = [...history].reverse().slice(0, 50);

    displayHistory.forEach((item, index) => {
        const originalIndex = history.length - 1 - index;
        
        const div = document.createElement('div');
        div.className = 'memory-item';
        div.style.display = 'flex';
        div.style.alignItems = 'flex-start';
        
        const isUser = (item.role === 'user');
        const roleColor = isUser ? '#2196f3' : '#ff85a1';
        const roleName = isUser ? 'あなた' : 'ネル先生';
        
        let timeStr = '';
        try { 
            const d = new Date(item.time);
            timeStr = `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
        } catch(e){}

        div.innerHTML = `
            <div style="padding-right:10px;">
                <input type="checkbox" class="log-delete-checkbox" value="${originalIndex}" style="transform:scale(1.3);">
            </div>
            <div style="width:100%;">
                <div class="memory-meta" style="color:${roleColor}; font-weight:bold; display:flex; justify-content:space-between;">
                    <span>${roleName}</span>
                    <span style="color:#ccc; font-weight:normal; font-size:0.7rem;">${timeStr}</span>
                </div>
                <div class="memory-text" style="margin-top:2px;">${window.cleanDisplayString(item.text)}</div>
            </div>
        `;
        container.appendChild(div);
    });
}

window.deleteSelectedLogs = function() {
    if (!currentUser) return;
    const checkboxes = document.querySelectorAll('.log-delete-checkbox:checked');
    if (checkboxes.length === 0) return alert("削除するものを選んでにゃ！");
    
    if (!confirm(`${checkboxes.length}件の会話ログを削除するにゃ？`)) return;
    
    const indicesToDelete = Array.from(checkboxes).map(cb => parseInt(cb.value)).sort((a, b) => b - a); 
    
    if (window.NellMemory) {
        window.NellMemory.deleteRawChatLogs(currentUser.id, indicesToDelete);
        const container = document.getElementById('memory-list-container');
        renderLogView(container);
    }
};

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
window.addLogItem = function(role, text) {
    const container = document.getElementById('log-content');
    if (!container) return;
    
    if (container.children.length > 50) {
        container.removeChild(container.firstChild);
    }

    const div = document.createElement('div');
    div.className = `log-item log-${role}`;
    const name = role === 'user' ? (currentUser ? currentUser.name : 'あなた') : 'ネル先生';
    const displayText = window.cleanDisplayString(text);
    div.innerHTML = `<span class="log-role">${name}:</span><span>${displayText}</span>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
};

window.addToSessionHistory = function(role, text) {
    if (!window.chatSessionHistory) window.chatSessionHistory =[];
    window.chatSessionHistory.push({ role: role, text: text });
    if (window.chatSessionHistory.length > 10) {
        window.chatSessionHistory.shift();
    }
};

window.updateNellMessage = async function(t, mood = "normal", saveToMemory = false, speak = true) {
    if (speak && typeof window.cancelNellSpeech === 'function') {
        window.cancelNellSpeech();
    }

    if (window.liveSocket && window.liveSocket.readyState === WebSocket.OPEN && window.currentMode !== 'chat') {
        speak = false;
    }

    let targetId = null;
    const idsToSearch =['nell-text', 'nell-text-game', 'nell-text-quiz', 'nell-text-riddle', 'nell-text-minitest', 'nell-text-map', 'nell-text-self-study', 'nell-text-danmaku', 'nell-text-kanji', 'nell-text-memory', 'nell-text-slot'];
    for(const id of idsToSearch) {
        const el = document.getElementById(id);
        if (el && el.offsetParent !== null) { 
            targetId = id;
            break;
        }
    }
    
    if (!targetId) targetId = 'nell-text';

    const el = document.getElementById(targetId);
    
    let cleanText = t || "";
    cleanText = cleanText.split('\n').filter(line => {
        const trimmed = line.trim();
        if (!trimmed) return true;
        if (/^(?:System|User|Model|Assistant|Thinking|Display)[:：]/i.test(trimmed)) return false;
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
    
    const displayText = window.cleanDisplayString(cleanText);
    
    if (el) el.innerText = displayText;
    
    if (t && t.includes("もぐもぐ")) { if(window.safePlay) window.safePlay(window.sfxBori); }
    
    if (saveToMemory) { window.saveToNellMemory('nell', cleanText); }
    
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
    
    window.addLogItem('user', text);
    window.addToSessionHistory('user', text);

    let missingInfo =[];
    let memoryContext = "";
    
    if (window.NellMemory && currentUser) {
        try {
            const profile = await window.NellMemory.getUserProfile(currentUser.id);
            if (!profile.birthday) missingInfo.push("誕生日");
            if (!profile.likes || profile.likes.length === 0) missingInfo.push("好きなもの");
            if (!profile.weaknesses || profile.weaknesses.length === 0) missingInfo.push("苦手なもの");
            
            memoryContext = await window.NellMemory.generateContextString(currentUser.id);
        } catch(e) {
            console.warn("Memory access error:", e);
        }
    }

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
                address: window.currentAddress,
                missingInfo: missingInfo,
                memoryContext: memoryContext 
            })
        });

        if(res.ok) {
            const data = await res.json();
            const speechText = data.speech || data.reply || "教えてあげるにゃ！";
            
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