// --- js/ui/sticker.js (v2.7: ドラッグ座標ズレ修正版) ---

window.showStickerBook = function(targetUserId = null) {
    window.switchScreen('screen-sticker-book');
    window.updateNellMessage("シール帳だにゃ！自由に貼って遊ぶにゃ！", "happy");
    
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

    // 演出開始
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
        const url = await window.fireStorage.ref(randomItem.fullPath).getDownloadURL();

        // 初期配置を 'newArea'（新規シール置き場）に設定
        const newSticker = {
            id: 'st_' + Date.now() + '_' + Math.floor(Math.random()*1000),
            src: url,
            location: 'newArea', 
            // 枠内からはみ出さないようにマージンを持たせる
            x: 20 + Math.random() * 60, 
            y: 20 + Math.random() * 40, 
            rotation: (Math.random() * 40 - 20),
            scale: 1.0,
            zIndex: 100 
        };

        if (!currentUser.stickers) currentUser.stickers = [];
        currentUser.stickers.push(newSticker);
        
        if (typeof window.saveAndSync === 'function') window.saveAndSync();
        
        alert(`🎉 おめでとう！\n特製シールをゲットしたにゃ！\n画面の下の「あたらしいシール」に置いておいたにゃ！`);

    } catch (error) {
        console.error("Firebase Sticker Error:", error);
        alert("シールの取得に失敗したにゃ…。\n(" + error.message + ")");
    }
};

window.loadAndRenderStickers = async function(userId) {
    const board = document.getElementById('sticker-board');
    const newArea = document.getElementById('new-sticker-area'); 
    if (!board || !newArea) return;
    
    board.innerHTML = '';
    newArea.innerHTML = '<div class="new-sticker-title">あたらしいシール</div>';

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
        if (db) {
            try {
                const doc = await db.collection("users").doc(String(userId)).get();
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
    
    img.onerror = () => { 
        img.src = 'assets/images/items/nikukyuhanko.png'; 
    };
    
    div.appendChild(img);

    if (editable) {
        window.attachStickerEvents(div, data);
    } else {
        div.style.cursor = 'default';
    }

    return div;
};

// ★修正: ドラッグ処理のロジック (スクロール対応)
window.attachStickerEvents = function(el, data) {
    let isDragging = false;
    let startX, startY;
    let initialLeft, initialTop; // 画面上の絶対座標(中心)
    let moved = false;
    
    const trash = document.getElementById('sticker-trash');
    const board = document.getElementById('sticker-board');
    const newArea = document.getElementById('new-sticker-area');

    const isOverTrash = (element) => {
        if (!trash) return false;
        const r1 = element.getBoundingClientRect();
        const r2 = trash.getBoundingClientRect();
        const c1 = { x: r1.left + r1.width / 2, y: r1.top + r1.height / 2 };
        return (c1.x >= r2.left && c1.x <= r2.right && c1.y >= r2.top && c1.y <= r2.bottom);
    };

    const startDrag = (e) => {
        if (e.target.closest('.main-btn')) return; 
        e.preventDefault();
        e.stopPropagation();

        isDragging = true;
        moved = false;
        
        // タッチ/マウス座標の取得
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        startX = clientX;
        startY = clientY;

        // 現在の矩形情報を取得
        const rect = el.getBoundingClientRect();
        
        // ★重要修正: スクロール量(window.scrollX/Y)を加算する
        // CSSで translate(-50%, -50%) しているため、left/top は「要素の中心座標」に合わせる
        initialLeft = rect.left + rect.width / 2 + window.scrollX;
        initialTop = rect.top + rect.height / 2 + window.scrollY;

        // body直下に移動させて、親要素のoverflowなどの影響を受けないようにする
        document.body.appendChild(el);
        el.style.zIndex = 9999;
        
        // 座標を固定値(px)に変換してセット
        el.style.left = initialLeft + 'px';
        el.style.top = initialTop + 'px';

        if (trash) trash.classList.add('active');
    };

    const onDrag = (e) => {
        if (!isDragging) return;
        e.preventDefault();
        
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        
        const dx = clientX - startX;
        const dy = clientY - startY;
        
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;

        // 追従
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

    const endDrag = (e) => {
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

        // --- ドロップ位置の判定と親要素への戻し ---
        const stickerRect = el.getBoundingClientRect();
        const newAreaRect = newArea.getBoundingClientRect();
        
        // シールの中心Y座標
        const stickerCenterY = stickerRect.top + stickerRect.height / 2;

        let targetParent;
        // 「新規エリア」の上端より上なら「シール帳(board)」とみなす
        if (stickerCenterY < newAreaRect.top) {
            targetParent = board;
            data.location = 'board';
        } else {
            targetParent = newArea;
            data.location = 'newArea';
        }

        // 親要素内での相対座標(%)を計算
        const parentRect = targetParent.getBoundingClientRect();
        const stickerCenterX = stickerRect.left + stickerRect.width / 2;
        // stickerCenterY は上で計算済み

        let finalX = (stickerCenterX - parentRect.left) / parentRect.width * 100;
        let finalY = (stickerCenterY - parentRect.top) / parentRect.height * 100;
        
        // 画面外に行き過ぎないように制限 (-20% ~ 120% 程度は許容)
        finalX = Math.max(-20, Math.min(120, finalX));
        finalY = Math.max(-20, Math.min(120, finalY));

        // DOMツリーを正しい親に戻す
        targetParent.appendChild(el);
        
        el.style.left = finalX + '%';
        el.style.top = finalY + '%';
        el.style.zIndex = data.zIndex || 10;
        el.style.opacity = '1';
        
        // データ更新
        data.x = finalX;
        data.y = finalY;

        // タップ（移動なし）の場合は回転
        if (!moved) {
            data.rotation = (data.rotation || 0) + 45;
            el.style.transform = `translate(-50%, -50%) rotate(${data.rotation}deg) scale(${data.scale || 1})`;
            if (window.sfxBtn) window.safePlay(window.sfxBtn);
        } else {
            // 移動した場合はZ-Indexを更新して手前に
            data.zIndex = 10 + Math.floor(Math.random() * 50); 
            el.style.zIndex = data.zIndex;
        }
        
        if (typeof window.saveAndSync === 'function') window.saveAndSync();
    };

    el.addEventListener('mousedown', startDrag);
    el.addEventListener('touchstart', startDrag, { passive: false });
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('touchmove', onDrag, { passive: false });
    window.addEventListener('mouseup', endDrag);
    window.addEventListener('touchend', endDrag);
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
    
    if (!db) {
        listContainer.innerHTML = '<p style="text-align:center; color:red;">データベースにつながってないにゃ...</p>';
        return;
    }

    try {
        const snapshot = await db.collection("users").orderBy("lastLogin", "desc").limit(20).get();
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