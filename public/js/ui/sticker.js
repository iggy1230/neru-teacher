// --- js/ui/sticker.js (v3.7: リアルタイム同期完全対応版 - リストも同期) ---

// ★追加: 戻り先画面IDを保存する変数 (初期値: ロビー)
let stickerReturnScreen = 'screen-lobby';
// ★追加: リアルタイムリスナーの解除用関数
window.stickerUnsubscribe = null;
window.stickerListUnsubscribe = null; // リスト画面用

window.showStickerBook = function(targetUserId = null, returnTo = 'screen-lobby') {
    // 戻り先を保存
    if (arguments.length > 1) {
        stickerReturnScreen = returnTo;
    } else {
        stickerReturnScreen = 'screen-lobby'; 
    }

    window.switchScreen('screen-sticker-book');
    window.updateNellMessage("シール帳だにゃ！シールをタップすると回転できるにゃ！", "happy");
    
    const userId = targetUserId || (currentUser ? currentUser.id : null);
    if (!userId) return;

    window.loadAndRenderStickers(userId);
};

// ★修正: シール帳を閉じる際にリスナーを解除する
window.closeStickerBook = function() {
    if (window.stickerUnsubscribe) {
        window.stickerUnsubscribe();
        window.stickerUnsubscribe = null;
    }

    if (stickerReturnScreen && document.getElementById(stickerReturnScreen)) {
        window.switchScreen(stickerReturnScreen);
    } else {
        window.backToLobby();
    }
};

// ★Firebase Storageからランダムに取得する
window.grantRandomSticker = async function(fromLunch = false) {
    if (!currentUser) return;
    // ローカルユーザー等でStorageが未初期化の場合は、ローカルアセットを使うフォールバックへ
    if (!window.fireStorage) {
        window.grantLocalFallbackSticker();
        return;
    }

    // 演出開始（効果音再生）
    if(window.safePlay) window.safePlay(window.sfxHirameku);

    try {
        const listRef = window.fireStorage.ref('stickers');
        const res = await listRef.listAll();

        if (res.items.length === 0) {
            console.warn("No stickers found in storage. Using fallback.");
            window.grantLocalFallbackSticker();
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
            x: 20 + Math.random() * 60, 
            y: 20 + Math.random() * 40, 
            rotation: 0,
            scale: 1.0,
            zIndex: 100 
        };

        if (!currentUser.stickers) currentUser.stickers = [];
        currentUser.stickers.push(newSticker);
        
        if (typeof window.saveAndSync === 'function') window.saveAndSync();
        window.showStickerNotification();

    } catch (error) {
        console.error("Firebase Sticker Error:", error);
        window.grantLocalFallbackSticker();
    }
};

// ★新規: ローカルフォールバック用シール付与
window.grantLocalFallbackSticker = function() {
    const localStickers = [
        'assets/images/items/nikukyuhanko.png',
        'assets/images/items/student-id-base.png', 
        'assets/images/characters/nell-normal.png'
    ];
    const randomSrc = localStickers[Math.floor(Math.random() * localStickers.length)];
    
    const newSticker = {
        id: 'st_' + Date.now() + '_' + Math.floor(Math.random()*1000),
        src: randomSrc,
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
    window.showStickerNotification();
};

window.showStickerNotification = function() {
    const notif = document.createElement('div');
    notif.innerHTML = "🎉 特製シールをゲットしたにゃ！<br>シール帳に貼るにゃ！";
    notif.style.cssText = "position:fixed; top:20%; left:50%; transform:translateX(-50%); background:rgba(255,255,255,0.95); border:4px solid #ff9800; color:#e65100; padding:15px 25px; border-radius:30px; font-weight:900; z-index:10000; animation: popIn 0.5s ease; box-shadow:0 10px 25px rgba(0,0,0,0.3); text-align:center; width: 85%; max-width: 400px;";
    document.body.appendChild(notif);
    setTimeout(() => { if(notif && notif.parentNode) notif.remove(); }, 4000);
};

// ★修正: リアルタイムリスナー (onSnapshot) を使用してシールを読み込む
window.loadAndRenderStickers = function(userId) {
    window.currentStickerUserId = userId;

    // 既存のリスナーがあれば解除
    if (window.stickerUnsubscribe) {
        window.stickerUnsubscribe();
        window.stickerUnsubscribe = null;
    }

    const board = document.getElementById('sticker-board');
    const newArea = document.getElementById('new-sticker-area'); 
    if (!board || !newArea) return;
    
    // ロード中表示
    board.innerHTML = '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#aaa;">読み込み中...</div>';

    const isMe = (currentUser && currentUser.id === userId);

    // DB接続がない場合のフォールバック (自分のみ)
    if (!window.db) {
        if (isMe) {
            renderStickers(currentUser.stickers || [], true);
        } else {
            board.innerHTML = '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:red;">データベースにつながってないにゃ...</div>';
        }
        return;
    }

    // ★重要: リアルタイムリスナーを設定
    window.stickerUnsubscribe = window.db.collection("users").doc(String(userId))
        .onSnapshot((doc) => {
            if (doc.exists) {
                const data = doc.data();
                const stickers = data.stickers || [];
                
                // 自分のデータならローカルcurrentUserも更新して同期を保つ
                if (isMe) {
                    currentUser.stickers = stickers;
                }

                // 描画実行
                renderStickers(stickers, isMe);
            } else {
                board.innerHTML = '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#aaa;">データがないにゃ...</div>';
            }
        }, (error) => {
            console.error("Sticker Sync Error:", error);
            board.innerHTML = '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:red;">読み込めなかったにゃ...</div>';
        });
};

// ★新規: 描画ロジックを分離 (リスナーから呼ばれる)
function renderStickers(stickers, isMe) {
    const board = document.getElementById('sticker-board');
    const newArea = document.getElementById('new-sticker-area'); 
    
    if (!board || !newArea) return;

    // 盤面のクリアと初期化
    board.innerHTML = '';
    newArea.innerHTML = '<div class="new-sticker-title">あたらしいシール</div>';

    // 背景クリックで選択解除
    const deselectAll = (e) => {
        if (e.target.closest('.sticker-item')) return;
        document.querySelectorAll('.sticker-item.selected').forEach(el => el.classList.remove('selected'));
    };
    board.onclick = deselectAll;
    newArea.onclick = deselectAll;

    // バインダーのリング描画
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

    // ゴミ箱の表示切り替え
    const trash = document.getElementById('sticker-trash');
    if (trash) { 
        isMe ? trash.classList.remove('hidden') : trash.classList.add('hidden'); 
    }

    // シール要素の生成と配置
    stickers.forEach(s => {
        const parentEl = (s.location === 'newArea') ? newArea : board;
        const el = window.createStickerElement(s, isMe);
        parentEl.appendChild(el);
    });
}

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
    img.draggable = false; 
    
    img.onerror = () => { 
        img.src = 'assets/images/items/nikukyuhanko.png'; 
    };
    div.appendChild(img);

    if (editable) {
        const handle = document.createElement('div');
        handle.className = 'sticker-rotate-handle';
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
    
    let startX, startY;
    let initialLeft, initialTop;
    let moved = false;

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

    const startMove = (e) => {
        if (e.target.closest('.main-btn')) return;
        if (e.target === handle) return;

        e.preventDefault(); 

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
        initialLeft = rect.left + rect.width / 2 + window.scrollX;
        initialTop = rect.top + rect.height / 2 + window.scrollY;

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
        
        if (moved && trash && isOverTrash(el)) {
            if (window.sfxBatu) window.safePlay(window.sfxBatu); 
            el.remove();
            if (currentUser && currentUser.stickers) {
                currentUser.stickers = currentUser.stickers.filter(s => s.id !== data.id);
                if (typeof window.saveAndSync === 'function') window.saveAndSync();
            }
            return;
        }

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

        if (!moved) {
            data.zIndex = 100 + Math.floor(Math.random() * 50); 
            el.style.zIndex = data.zIndex;
        } else {
            data.zIndex = 10 + Math.floor(Math.random() * 50); 
            el.style.zIndex = data.zIndex;
        }
        
        if (typeof window.saveAndSync === 'function') window.saveAndSync();
    };

    const startRotate = (e) => {
        e.preventDefault();
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

    el.addEventListener('mousedown', startMove);
    el.addEventListener('touchstart', startMove, { passive: false });

    handle.addEventListener('mousedown', startRotate);
    handle.addEventListener('touchstart', startRotate, { passive: false });

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

window.openStickerUserList = function() {
    const modal = document.getElementById('sticker-user-modal');
    const listContainer = document.getElementById('sticker-user-list');
    if (!modal || !listContainer) return;
    modal.classList.remove('hidden');
    listContainer.innerHTML = '<p style="text-align:center; padding:20px;">読み込み中にゃ...</p>';
    
    if (!window.db) {
        listContainer.innerHTML = '<p style="text-align:center; color:red;">データベースにつながってないにゃ...</p>';
        return;
    }

    // ★重要: ユーザーリストもリアルタイム同期 (onSnapshot) にする
    if (window.stickerListUnsubscribe) {
        window.stickerListUnsubscribe();
        window.stickerListUnsubscribe = null;
    }

    window.stickerListUnsubscribe = window.db.collection("users").orderBy("lastLogin", "desc").limit(20)
        .onSnapshot((snapshot) => {
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
        }, (error) => {
            console.error("List Sync Error:", error);
            listContainer.innerHTML = '<p style="text-align:center; color:red;">読み込めなかったにゃ...</p>';
        });
};

window.closeStickerUserList = function() {
    const modal = document.getElementById('sticker-user-modal');
    if (modal) modal.classList.add('hidden');
    // リストの監視を解除
    if (window.stickerListUnsubscribe) {
        window.stickerListUnsubscribe();
        window.stickerListUnsubscribe = null;
    }
};