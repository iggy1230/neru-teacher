// --- js/ui/sticker.js (v1.3: 連番26枚対応版) ---

window.showStickerBook = function(targetUserId = null) {
    window.switchScreen('screen-sticker-book');
    window.updateNellMessage("シール帳だにゃ！自由に貼って遊ぶにゃ！", "happy");
    
    // ターゲットユーザー（自分 or 他人）
    const userId = targetUserId || (currentUser ? currentUser.id : null);
    if (!userId) return;

    // 読み込みと描画
    window.loadAndRenderStickers(userId);
};

window.grantRandomSticker = function(fromLunch = false) {
    if (!currentUser) return;
    
    // ★修正: シールの総数を26に設定
    const TOTAL_STICKERS = 26;
    
    // 1 から TOTAL_STICKERS までのランダムな整数を生成
    const num = Math.floor(Math.random() * TOTAL_STICKERS) + 1;
    
    // 3桁の文字列に変換 (例: 5 -> "005")
    const numStr = String(num).padStart(3, '0');
    const filePath = `assets/images/sticker/sticker${numStr}.png`;
    
    // 新しいシールデータ作成
    // 初期位置を台紙の「右側の枠外」に設定 (x: 115%)
    const newSticker = {
        id: 'st_' + Date.now() + '_' + Math.floor(Math.random()*1000),
        src: filePath,
        x: 115, 
        y: 10 + (Math.random() * 30), // 上の方に少し散らす
        rotation: (Math.random() * 40 - 20),
        scale: 1.0,
        zIndex: 100 // 最前面へ
    };

    if (!currentUser.stickers) currentUser.stickers = [];
    currentUser.stickers.push(newSticker);
    
    // 保存
    if (typeof window.saveAndSync === 'function') window.saveAndSync();

    // 演出
    if(window.safePlay) window.safePlay(window.sfxHirameku);
    
    // アラート表示
    const img = new Image();
    img.onload = () => {
        alert(`🎉 おめでとう！\n特製シールをゲットしたにゃ！\nシール帳の右側に置いておいたにゃ！`);
    };
    img.onerror = () => {
        // 画像がない場合のアラート
        alert(`🎉 おめでとう！\n特製シールをゲットしたにゃ！\n(画像が見つからなかったときは肉球になるにゃ)`);
    };
    img.src = filePath;
};

window.loadAndRenderStickers = async function(userId) {
    const board = document.getElementById('sticker-board');
    if (!board) return;
    board.innerHTML = ''; // クリア
    
    // バインダーのリング（装飾）
    const ring = document.createElement('div');
    ring.className = 'binder-ring';
    board.appendChild(ring);
    
    // バインダーの留め具（装飾）
    const clasp = document.createElement('div');
    clasp.className = 'binder-clasp';
    const container = document.getElementById('sticker-board-container');
    if (container) {
        // 留め具はcontainerに追加
        const oldClasp = container.querySelector('.binder-clasp');
        if (oldClasp) oldClasp.remove();
        container.appendChild(clasp);
    }
    
    // ガイドテキスト
    const guide = document.createElement('div');
    guide.id = 'sticker-guide-text';
    guide.style.cssText = "position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); color:rgba(0,0,0,0.1); font-weight:bold; pointer-events:none; font-size:2rem; white-space:nowrap;";
    guide.innerText = "STICKER BOOK";
    board.appendChild(guide);

    // ユーザーデータ取得
    let stickers = [];
    
    // 自分かどうか判定
    const isMe = (currentUser && currentUser.id === userId);

    // ゴミ箱の表示制御 (自分のみ)
    const trash = document.getElementById('sticker-trash');
    if (trash) {
        if (isMe) trash.classList.remove('hidden');
        else trash.classList.add('hidden');
    }

    if (isMe) {
        stickers = currentUser.stickers || [];
    } else {
        // 他人のデータはFirestoreから取得
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
        const el = window.createStickerElement(s, isMe); // isMeを渡す（編集可否制御のため）
        board.appendChild(el);
    });
};

window.createStickerElement = function(data, editable = true) {
    const div = document.createElement('div');
    div.className = 'sticker-item';
    div.id = data.id;
    
    // 初期配置
    div.style.left = data.x + '%';
    div.style.top = data.y + '%';
    div.style.transform = `translate(-50%, -50%) rotate(${data.rotation || 0}deg) scale(${data.scale || 1})`;
    div.style.zIndex = data.zIndex || 1;

    // 画像
    const img = document.createElement('img');
    // data.src があればそれを使う
    if (data.src) {
        img.src = data.src;
    } else if (window.STICKER_TYPES) {
        // 古いデータ形式の互換性
        const typeDef = window.STICKER_TYPES.find(t => t.id === data.typeId);
        if (typeDef && typeDef.src) img.src = typeDef.src;
        else img.src = 'assets/images/items/nikukyuhanko.png'; // fallback
    } else {
        img.src = 'assets/images/items/nikukyuhanko.png';
    }
    
    img.className = 'sticker-img';
    
    // 画像読み込みエラー時の処理
    img.onerror = () => {
        img.src = 'assets/images/items/nikukyuhanko.png'; // デフォルト画像
    };
    
    div.appendChild(img);

    // イベントリスナー登録 (操作ロジック) - 自分のシール帳のみ操作可能
    if (editable) {
        window.attachStickerEvents(div, data);
    } else {
        div.style.cursor = 'default';
    }

    return div;
};

// 操作ロジック（ドラッグ＆回転 & ゴミ箱）
window.attachStickerEvents = function(el, data) {
    let isDragging = false;
    let startX, startY;
    let initialLeft, initialTop;
    let moved = false;
    const trash = document.getElementById('sticker-trash');

    // ゴミ箱判定ロジック (中心点判定)
    const isOverTrash = (element) => {
        if (!trash) return false;
        const r1 = element.getBoundingClientRect(); // シール
        const r2 = trash.getBoundingClientRect();   // ゴミ箱
        
        // シールの中心点
        const c1 = { x: r1.left + r1.width / 2, y: r1.top + r1.height / 2 };
        
        // 中心点がゴミ箱の矩形内にあるか
        return (c1.x >= r2.left && c1.x <= r2.right && c1.y >= r2.top && c1.y <= r2.bottom);
    };

    // ドラッグ開始
    const startDrag = (e) => {
        if (e.target.closest('.main-btn')) return; 
        e.preventDefault();
        e.stopPropagation();

        isDragging = true;
        moved = false;
        
        // 最前面へ
        el.style.zIndex = 999;
        
        // ゴミ箱をアクティブ表示
        if (trash) trash.classList.add('active');
        
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        
        startX = clientX;
        startY = clientY;
        
        initialLeft = parseFloat(el.style.left);
        initialTop = parseFloat(el.style.top);
    };

    // ドラッグ中
    const onDrag = (e) => {
        if (!isDragging) return;
        e.preventDefault();
        
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        
        const dx = clientX - startX;
        const dy = clientY - startY;
        
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;

        const parentRect = el.parentElement.getBoundingClientRect();
        
        const dxPercent = (dx / parentRect.width) * 100;
        const dyPercent = (dy / parentRect.height) * 100;
        
        let newX = initialLeft + dxPercent;
        let newY = initialTop + dyPercent;
        
        // はみ出し制限を緩和 (枠外配置用)
        newX = Math.max(-50, Math.min(150, newX));
        newY = Math.max(-50, Math.min(150, newY));

        el.style.left = newX + '%';
        el.style.top = newY + '%';
        
        // ゴミ箱の上にあるか判定してスタイル変更
        if (trash) {
            if (isOverTrash(el)) {
                trash.classList.add('hover');
                el.style.opacity = '0.5'; // 消える予兆
            } else {
                trash.classList.remove('hover');
                el.style.opacity = '1';
            }
        }
    };

    // ドラッグ終了
    const endDrag = (e) => {
        if (!isDragging) return;
        isDragging = false;
        
        // ゴミ箱のリセット
        if (trash) {
            trash.classList.remove('active');
            trash.classList.remove('hover');
        }
        
        // ゴミ箱判定
        if (moved && trash && isOverTrash(el)) {
            // 削除実行
            if (window.sfxBatu) window.safePlay(window.sfxBatu); 
            
            // DOM削除
            el.remove();
            
            // データ削除
            if (currentUser && currentUser.stickers) {
                currentUser.stickers = currentUser.stickers.filter(s => s.id !== data.id);
                if (typeof window.saveAndSync === 'function') window.saveAndSync();
            }
            return; // 終了
        }
        
        // 削除されなかった場合の位置調整
        el.style.opacity = '1';

        // データ更新
        data.x = parseFloat(el.style.left);
        data.y = parseFloat(el.style.top);

        if (!moved) {
            // タップ回転
            data.rotation = (data.rotation || 0) + 45;
            el.style.transform = `translate(-50%, -50%) rotate(${data.rotation}deg) scale(${data.scale || 1})`;
            if (window.sfxBtn) window.safePlay(window.sfxBtn);
        } else {
            // zIndex確定
            data.zIndex = 10 + Math.floor(Math.random() * 50); 
            el.style.zIndex = data.zIndex;
        }
        
        // 保存
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

// ==========================================
// ★ みんなのシール帳 (ユーザー選択モーダル)
// ==========================================

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
        const snapshot = await db.collection("users")
            .orderBy("lastLogin", "desc")
            .limit(20)
            .get();
            
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
            div.onclick = () => {
                window.closeStickerUserList();
                window.showStickerBook(user.id);
            };
            
            const iconSrc = user.photo || 'assets/images/characters/nell-normal.png';
            const stickerCount = (user.stickers && Array.isArray(user.stickers)) ? user.stickers.length : 0;
            
            div.innerHTML = `
                <img src="${iconSrc}" style="width:40px; height:40px; border-radius:50%; object-fit:cover; margin-right:10px; border:1px solid #ddd;">
                <div style="flex:1;">
                    <div style="font-weight:bold; color:#333;">${window.cleanDisplayString(user.name)}</div>
                    <div style="font-size:0.7rem; color:#888;">シール: ${stickerCount}枚</div>
                </div>
                <button class="mini-teach-btn" style="background:#e91e63;">みる</button>
            `;
            listContainer.appendChild(div);
        });
        
    } catch(e) {
        console.error("User List Error:", e);
        listContainer.innerHTML = '<p style="text-align:center; color:red;">読み込めなかったにゃ...</p>';
    }
};

window.closeStickerUserList = function() {
    const modal = document.getElementById('sticker-user-modal');
    if (modal) modal.classList.add('hidden');
};