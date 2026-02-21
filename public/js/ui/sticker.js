// --- js/ui/sticker.js (v3.0: 起動エラー修正・完全版) ---

window.showStickerBook = function(targetUserId = null) {
    window.switchScreen('screen-sticker-book');
    window.updateNellMessage("シール帳だにゃ！シールをタップすると回転できるにゃ！", "happy");
    
    const userId = targetUserId || (currentUser ? currentUser.id : null);
    if (!userId) return;

    window.loadAndRenderStickers(userId);
};

// ★Firebase Storageからランダムに取得する
window.grantRandomSticker = async function(fromLunch = false) {
    if (!currentUser) return;
    if (!window.fireStorage) {
        console.error("Storage not initialized.");
        return;
    }

    if(window.safePlay) window.safePlay(window.sfxHirameku);

    try {
        const listRef = window.fireStorage.ref('stickers');
        const res = await listRef.listAll();

        if (res.items.length === 0) {
            console.warn("No stickers found.");
            alert("まだシールがないみたいだにゃ…。");
            return;
        }

        const randomIndex = Math.floor(Math.random() * res.items.length);
        const randomItem = res.items[randomIndex];
        // パスから参照を作ってダウンロードURLを取得
        const url = await window.fireStorage.ref(randomItem.fullPath).getDownloadURL();

        // 初期配置を 'newArea'（新規シール置き場）に設定
        const newSticker = {
            id: 'st_' + Date.now() + '_' + Math.floor(Math.random()*1000),
            src: url,
            location: 'newArea', 
            x: 20 + Math.random() * 60, 
            y: 20 + Math.random() * 40, 
            rotation: 0,
            scale: 1.0,
            zIndex: 100 
        };

        if (!currentUser.stickers) currentUser.stickers = [];
        currentUser.stickers.push(newSticker);
        
        if (typeof window.saveAndSync === 'function') window.saveAndSync();
        
        alert(`🎉 おめでとう！\n特製シールをゲットしたにゃ！\n画面の下の「あたらしいシール」に置いておいたにゃ！`);

        // 自分のページを開いているなら即座に再描画
        const board = document.getElementById('sticker-board');
        if (board && !board.classList.contains('hidden') && (!window.currentStickerUserId || window.currentStickerUserId === currentUser.id)) {
             window.loadAndRenderStickers(currentUser.id);
        }

    } catch (error) {
        console.error("Firebase Sticker Error:", error);
        alert("シールの取得に失敗したにゃ…。\n(" + error.message + ")");
    }
};

window.loadAndRenderStickers = async function(userId) {
    // 現在表示中のユーザーIDを保持（更新判定用）
    window.currentStickerUserId = userId;

    const board = document.getElementById('sticker-board');
    const newArea = document.getElementById('new-sticker-area'); 
    if (!board || !newArea) return;
    
    board.innerHTML = '';
    newArea.innerHTML = '<div class="new-sticker-title">あたらしいシール</div>';

    // 背景クリックで選択解除
    const deselectAll = (e) => {
        // ハンドルやシール自体をクリックした場合は解除しない
        if (e.target.closest('.sticker-item')) return;
        document.querySelectorAll('.sticker-item.selected').forEach(el => el.classList.remove('selected'));
    };
    // クリックイベントの伝播順序に注意（キャプチャフェーズなど）
    board.onclick = deselectAll;
    newArea.onclick = deselectAll;

    // 装飾
    const ring = document.createElement('div'); 
    ring.className = 'binder-ring'; 
    board.appendChild(ring);
    
    const container = document.getElementById('sticker-board-container');
    if (container) {
        const oldClasp = container.querySelector('.binder-clasp'); 
        if (oldClasp) oldClasp.remove();
        const clasp = document.createElement('div'); 
        clasp.className = 'binder-clasp'; 
        container.appendChild(clasp);
    }
    
    const guide = document.createElement('div'); 
    guide.id = 'sticker-guide-text';
    guide.style.cssText = "position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); color:rgba(0,0,0,0.1); font-weight:bold; pointer-events:none; font-size:2rem; white-space:nowrap;";
    guide.innerText = "STICKER BOOK"; 
    board.appendChild(guide);

    let stickers = [];
    const isMe = (currentUser && currentUser.id === userId);
    const trash = document.getElementById('sticker-trash');
    if (trash) { 
        isMe ? trash.classList.remove('hidden') : trash.classList.add('hidden'); 
    }

    if (isMe) {
        stickers = currentUser.stickers || [];
    } else {
        if (window.db) {
            try {
                const doc = await window.db.collection("users").doc(String(userId)).get();
                if (doc.exists) {
                    const data = doc.data();
                    stickers = data.stickers || [];
                    window.updateNellMessage(`${data.name}さんのシール帳だにゃ！`, "happy");
                }
            } catch (e) { 
                console.error("Sticker Fetch Error:", e); 
            }
        }
    }

    stickers.forEach(s => {
        const parentEl = (s.location === 'newArea') ? newArea : board;
        const el = window.createStickerElement(s, isMe);
        parentEl.appendChild(el);
    });
};

window.createStickerElement = function(data, editable = true) {
    const div = document.createElement('div');
    div.className = 'sticker-item';
    div.id = data.id;
    
    div.style.left = data.x + '%';
    div.style.top = data.y + '%';
    div.style.transform = `translate(-50%, -50%) rotate(${data.rotation || 0}deg) scale(${data.scale || 1})`;
    div.style.zIndex = data.zIndex || 1;

    const img = document.createElement('img');
    img.src = data.src || 'assets/images/items/nikukyuhanko.png';
    img.className = 'sticker-img';
    img.crossOrigin = "anonymous";
    img.draggable = false; // 画像ドラッグ禁止
    
    img.onerror = () => { 
        img.src = 'assets/images/items/nikukyuhanko.png'; 
    };
    div.appendChild(img);

    // 編集モードなら回転ハンドルを追加
    if (editable) {
        const handle = document.createElement('div');
        handle.className = 'sticker-rotate-handle';
        // ハンドルのイベント伝播を止める（親のドラッグ移動を発火させないため）
        const stopProp = (e) => e.stopPropagation();
        handle.addEventListener('mousedown', stopProp);
        handle.addEventListener('touchstart', stopProp);
        
        div.appendChild(handle);

        window.attachStickerEvents(div, handle, data);
    } else {
        div.style.cursor = 'default';
    }

    return div;
};

window.attachStickerEvents = function(el, handle, data) {
    let isDragging = false;
    let isRotating = false;
    
    // 移動用
    let startX, startY;
    let initialLeft, initialTop;
    let moved = false;

    // 回転用
    let boxCenter = { x: 0, y: 0 };
    let startAngle = 0;
    let initialRotation = 0;
    
    const trash = document.getElementById('sticker-trash');
    const board = document.getElementById('sticker-board');
    const newArea = document.getElementById('new-sticker-area');

    const getClientPos = (e) => {
        const t = e.touches ? e.touches[0] : e;
        return { x: t.clientX, y: t.clientY };
    };

    const isOverTrash = (element) => {
        if (!trash) return false;
        const r1 = element.getBoundingClientRect();
        const r2 = trash.getBoundingClientRect();
        const c1 = { x: r1.left + r1.width / 2, y: r1.top + r1.height / 2 };
        return (c1.x >= r2.left && c1.x <= r2.right && c1.y >= r2.top && c1.y <= r2.bottom);
    };

    // --- 移動ロジック ---
    const startMove = (e) => {
        if (e.target.closest('.main-btn')) return;
        if (e.target === handle) return; // ハンドルクリックは無視

        e.preventDefault(); // スクロール防止等

        // 選択状態の切り替え
        document.querySelectorAll('.sticker-item.selected').forEach(item => {
            if (item !== el) item.classList.remove('selected');
        });
        el.classList.add('selected');

        isDragging = true;
        moved = false;
        
        const pos = getClientPos(e);
        startX = pos.x;
        startY = pos.y;

        const rect = el.getBoundingClientRect();
        // スクロール分を加算して絶対位置を計算
        initialLeft = rect.left + rect.width / 2 + window.scrollX;
        initialTop = rect.top + rect.height / 2 + window.scrollY;

        // body直下へ移動（オーバーフロー対策）
        document.body.appendChild(el);
        el.style.zIndex = 9999;
        el.style.left = initialLeft + 'px';
        el.style.top = initialTop + 'px';

        if (trash) trash.classList.add('active');
    };

    const onMove = (e) => {
        if (!isDragging) return;
        e.preventDefault();
        
        const pos = getClientPos(e);
        const dx = pos.x - startX;
        const dy = pos.y - startY;
        
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;

        el.style.left = (initialLeft + dx) + 'px';
        el.style.top = (initialTop + dy) + 'px';
        
        if (trash) {
            if (isOverTrash(el)) {
                trash.classList.add('hover');
                el.style.opacity = '0.5';
            } else {
                trash.classList.remove('hover');
                el.style.opacity = '1';
            }
        }
    };

    const endMove = (e) => {
        if (!isDragging) return;
        isDragging = false;
        
        if (trash) {
            trash.classList.remove('active');
            trash.classList.remove('hover');
        }
        
        // ゴミ箱処理
        if (moved && trash && isOverTrash(el)) {
            if (window.sfxBatu) window.safePlay(window.sfxBatu); 
            el.remove();
            if (currentUser && currentUser.stickers) {
                currentUser.stickers = currentUser.stickers.filter(s => s.id !== data.id);
                if (typeof window.saveAndSync === 'function') window.saveAndSync();
            }
            alert("シールを捨てたにゃ！🗑️");
            return;
        }

        // 配置場所の判定
        const stickerRect = el.getBoundingClientRect();
        const newAreaRect = newArea.getBoundingClientRect();
        const stickerCenterY = stickerRect.top + stickerRect.height / 2;

        let targetParent;
        if (stickerCenterY < newAreaRect.top) {
            targetParent = board;
            data.location = 'board';
        } else {
            targetParent = newArea;
            data.location = 'newArea';
        }

        const parentRect = targetParent.getBoundingClientRect();
        // 親要素内での相対位置(%)
        let finalX = ((stickerRect.left + stickerRect.width / 2) - parentRect.left) / parentRect.width * 100;
        let finalY = ((stickerRect.top + stickerRect.height / 2) - parentRect.top) / parentRect.height * 100;
        
        finalX = Math.max(-20, Math.min(120, finalX));
        finalY = Math.max(-20, Math.min(120, finalY));

        targetParent.appendChild(el);
        el.style.left = finalX + '%';
        el.style.top = finalY + '%';
        el.style.zIndex = data.zIndex || 10;
        el.style.opacity = '1';
        
        data.x = finalX;
        data.y = finalY;

        // タップのみの場合は手前に持ってくる
        if (!moved) {
            data.zIndex = 100 + Math.floor(Math.random() * 50); 
            el.style.zIndex = data.zIndex;
        } else {
            data.zIndex = 10 + Math.floor(Math.random() * 50); 
            el.style.zIndex = data.zIndex;
        }
        
        if (typeof window.saveAndSync === 'function') window.saveAndSync();
    };

    // --- 回転ロジック ---
    const startRotate = (e) => {
        e.preventDefault();
        // 親への伝播は上のリスナーで止めているが念のため
        isRotating = true;
        
        const rect = el.getBoundingClientRect();
        boxCenter = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };

        const pos = getClientPos(e);
        startAngle = Math.atan2(pos.y - boxCenter.y, pos.x - boxCenter.x);
        initialRotation = data.rotation || 0;
    };

    const onRotate = (e) => {
        if (!isRotating) return;
        e.preventDefault();

        const pos = getClientPos(e);
        const currentAngle = Math.atan2(pos.y - boxCenter.y, pos.x - boxCenter.x);
        
        // 角度差分 (ラジアン -> 度)
        const deg = (currentAngle - startAngle) * (180 / Math.PI);
        let newRotation = initialRotation + deg;
        
        el.style.transform = `translate(-50%, -50%) rotate(${newRotation}deg) scale(${data.scale || 1})`;
        data.rotation = newRotation;
    };

    const endRotate = (e) => {
        if (!isRotating) return;
        isRotating = false;
        if (typeof window.saveAndSync === 'function') window.saveAndSync();
    };

    // イベント登録
    el.addEventListener('mousedown', startMove);
    el.addEventListener('touchstart', startMove, { passive: false });

    handle.addEventListener('mousedown', startRotate);
    handle.addEventListener('touchstart', startRotate, { passive: false });

    // Window全体でドラッグ/回転を監視
    window.addEventListener('mousemove', (e) => {
        if (isDragging) onMove(e);
        if (isRotating) onRotate(e);
    });
    window.addEventListener('touchmove', (e) => {
        if (isDragging) onMove(e);
        if (isRotating) onRotate(e);
    }, { passive: false });

    window.addEventListener('mouseup', (e) => {
        if (isDragging) endMove(e);
        if (isRotating) endRotate(e);
    });
    window.addEventListener('touchend', (e) => {
        if (isDragging) endMove(e);
        if (isRotating) endRotate(e);
    });
};

window.saveStickers = function() {
    if (!currentUser) return;
    if (typeof window.saveAndSync === 'function') {
        window.saveAndSync();
        alert("シール帳を保存したにゃ！");
    }
};

window.openStickerUserList = async function() {
    const modal = document.getElementById('sticker-user-modal');
    const listContainer = document.getElementById('sticker-user-list');
    if (!modal || !listContainer) return;
    modal.classList.remove('hidden');
    listContainer.innerHTML = '<p style="text-align:center; padding:20px;">読み込み中にゃ...</p>';
    
    if (!window.db) {
        listContainer.innerHTML = '<p style="text-align:center; color:red;">データベースにつながってないにゃ...</p>';
        return;
    }

    try {
        const snapshot = await window.db.collection("users").orderBy("lastLogin", "desc").limit(20).get();
        listContainer.innerHTML = "";
        if (snapshot.empty) {
            listContainer.innerHTML = '<p style="text-align:center;">まだ誰もいないにゃ。</p>';
            return;
        }
        snapshot.forEach(doc => {
            const user = doc.data();
            const div = document.createElement('div');
            div.className = "memory-item"; 
            div.style.alignItems = "center";
            div.style.cursor = "pointer";
            div.onclick = () => { window.closeStickerUserList(); window.showStickerBook(user.id); };
            const iconSrc = user.photo || 'assets/images/characters/nell-normal.png';
            const stickerCount = (user.stickers && Array.isArray(user.stickers)) ? user.stickers.length : 0;
            div.innerHTML = `<img src="${iconSrc}" style="width:40px; height:40px; border-radius:50%; object-fit:cover; margin-right:10px; border:1px solid #ddd;"><div style="flex:1;"><div style="font-weight:bold; color:#333;">${window.cleanDisplayString(user.name)}</div><div style="font-size:0.7rem; color:#888;">シール: ${stickerCount}枚</div></div><button class="mini-teach-btn" style="background:#e91e63;">みる</button>`;
            listContainer.appendChild(div);
        });
    } catch(e) {
        listContainer.innerHTML = '<p style="text-align:center; color:red;">読み込めなかったにゃ...</p>';
    }
};

window.closeStickerUserList = function() {
    const modal = document.getElementById('sticker-user-modal');
    if (modal) modal.classList.add('hidden');
};