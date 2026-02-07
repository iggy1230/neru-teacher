// --- js/game-engine.js (完全版 v384.0: 画像パス修正・キャッシュ対策版) ---

// ==========================================
// 共通ヘルパー: レーベンシュタイン距離 (編集距離)
// ==========================================
function levenshteinDistance(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // 置換
                    Math.min(
                        matrix[i][j - 1] + 1, // 挿入
                        matrix[i - 1][j] + 1  // 削除
                    )
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

function fuzzyContains(userText, targetText, maxDistance = 1) {
    if (!userText || !targetText) return false;
    const u = userText.replace(/\s+/g, ""); 
    const t = targetText.replace(/\s+/g, "");
    
    if (u.includes(t)) return true;
    
    const len = t.length;
    for (let i = 0; i < u.length - len + 2; i++) {
        for (let diff = -1; diff <= 1; diff++) {
            const subLen = len + diff;
            if (subLen < 1) continue;
            const sub = u.substr(i, subLen);
            if (levenshteinDistance(sub, t) <= maxDistance) {
                return true;
            }
        }
    }
    return false;
}

// ==========================================
// 1. カリカリキャッチ
// ==========================================
window.showGame = function() { 
    if (typeof window.switchScreen === 'function') {
        window.switchScreen('screen-game'); 
    } else {
        document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
        document.getElementById('screen-game').classList.remove('hidden');
    }
    document.getElementById('mini-karikari-display').classList.remove('hidden'); 
    if(typeof window.updateMiniKarikari === 'function') window.updateMiniKarikari(); 
    window.initGame(); 
    window.fetchGameComment("start"); 
    const startBtn = document.getElementById('start-game-btn'); 
    if (startBtn) { 
        const newBtn = startBtn.cloneNode(true); 
        startBtn.parentNode.replaceChild(newBtn, startBtn); 
        newBtn.onclick = () => { 
            if (!window.gameRunning) { 
                window.initGame(); 
                window.gameRunning = true; 
                newBtn.disabled = true; 
                window.drawGame(); 
            } 
        }; 
    } 
};

window.fetchGameComment = function(type, score=0) { 
    if (!currentUser) return;
    fetch('/game-reaction', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ type, name: currentUser.name, score }) 
    })
    .then(r => r.json())
    .then(d => { 
        if(typeof window.updateNellMessage === 'function') {
            window.updateNellMessage(d.reply, d.mood || "excited", true); 
        }
    })
    .catch(e => { console.error("Game Comment Error:", e); }); 
};

window.initGame = function() {
    window.gameCanvas = document.getElementById('game-canvas');
    if(!window.gameCanvas) return;
    window.ctx = window.gameCanvas.getContext('2d');
    window.paddle = { x: window.gameCanvas.width / 2 - 40, y: window.gameCanvas.height - 30, w: 80, h: 10 };
    window.ball = { x: window.gameCanvas.width / 2, y: window.gameCanvas.height - 40, r: 8, dx: 4, dy: -4 };
    window.score = 0;
    const scoreEl = document.getElementById('game-score');
    if(scoreEl) scoreEl.innerText = window.score;
    window.bricks = [];
    for(let c = 0; c < 5; c++) {
        for(let r = 0; r < 4; r++) {
            window.bricks.push({ x: 30 + (c * 55), y: 30 + (r * 30), w: 40, h: 20, status: 1 });
        }
    }
    const movePaddle = (e) => {
        const rect = window.gameCanvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        let relativeX = clientX - rect.left;
        if(relativeX > 0 && relativeX < window.gameCanvas.width) {
            window.paddle.x = relativeX - window.paddle.w/2;
        }
    };
    window.gameCanvas.onmousemove = movePaddle;
    window.gameCanvas.ontouchmove = (e) => { e.preventDefault(); movePaddle(e); };
};

window.giveGameReward = function(amount) {
    if (amount <= 0 || !currentUser) return;
    currentUser.karikari += amount;
    if(typeof window.saveAndSync === 'function') window.saveAndSync();
    if(typeof window.updateMiniKarikari === 'function') window.updateMiniKarikari();
    if(typeof window.showKarikariEffect === 'function') window.showKarikariEffect(amount);
};

window.drawGame = function() {
    if(!window.gameRunning) return;
    window.ctx.clearRect(0, 0, window.gameCanvas.width, window.gameCanvas.height);
    window.ctx.beginPath(); window.ctx.arc(window.ball.x, window.ball.y, window.ball.r, 0, Math.PI*2); window.ctx.fillStyle = "#ff5722"; window.ctx.fill(); window.ctx.closePath();
    window.ctx.beginPath(); window.ctx.rect(window.paddle.x, window.paddle.y, window.paddle.w, window.paddle.h); window.ctx.fillStyle = "#8d6e63"; window.ctx.fill(); window.ctx.closePath();
    window.bricks.forEach(b => {
        if(b.status === 1) {
            window.ctx.beginPath(); window.ctx.font = "20px sans-serif"; window.ctx.textAlign = "center"; window.ctx.textBaseline = "middle"; window.ctx.fillText("🍖", b.x + b.w/2, b.y + b.h/2); window.ctx.closePath();
        }
    });
    window.ball.x += window.ball.dx; window.ball.y += window.ball.dy;
    if(window.ball.x + window.ball.dx > window.gameCanvas.width - window.ball.r || window.ball.x + window.ball.dx < window.ball.r) window.ball.dx = -window.ball.dx;
    if(window.ball.y + window.ball.dy < window.ball.r) window.ball.dy = -window.ball.dy;
    if(window.ball.y + window.ball.dy > window.gameCanvas.height - window.ball.r - 30) {
        if(window.ball.x > window.paddle.x && window.ball.x < window.paddle.x + window.paddle.w) {
            window.ball.dy = -window.ball.dy; if(window.safePlay) window.safePlay(window.sfxPaddle);
        } else if(window.ball.y + window.ball.dy > window.gameCanvas.height - window.ball.r) {
            window.gameRunning = false; if(window.safePlay) window.safePlay(window.sfxOver);
            if (window.score > 0) { window.giveGameReward(window.score); if(typeof window.updateNellMessage === 'function') window.updateNellMessage(`あ〜あ、落ちちゃったにゃ…。でも${window.score}個ゲットだにゃ！`, "sad"); } else { if(typeof window.updateNellMessage === 'function') window.updateNellMessage("あ〜あ、落ちちゃったにゃ…", "sad"); }
            window.fetchGameComment("end", window.score);
            const startBtn = document.getElementById('start-game-btn'); if(startBtn) { startBtn.disabled = false; startBtn.innerText = "もう一回！"; }
            return;
        }
    }
    let allCleared = true;
    window.bricks.forEach(b => {
        if(b.status === 1) {
            allCleared = false;
            if(window.ball.x > b.x && window.ball.x < b.x + b.w && window.ball.y > b.y && window.ball.y < b.y + b.h) {
                window.ball.dy = -window.ball.dy; b.status = 0; window.score += 10;
                const scoreEl = document.getElementById('game-score'); if(scoreEl) scoreEl.innerText = window.score;
                if(window.safePlay) window.safePlay(window.sfxHit);
            }
        }
    });
    if (allCleared) {
        window.gameRunning = false; window.giveGameReward(window.score);
        if(typeof window.updateNellMessage === 'function') window.updateNellMessage(`全部取ったにゃ！すごいにゃ！！${window.score}個ゲットだにゃ！`, "excited");
        window.fetchGameComment("end", window.score);
        const startBtn = document.getElementById('start-game-btn'); if(startBtn) { startBtn.disabled = false; startBtn.innerText = "もう一回！"; }
        return;
    }
    window.gameAnimId = requestAnimationFrame(window.drawGame);
};

// ==========================================
// 2. VS ロボット掃除機 (画像対応・ライフ制版)
// ==========================================
// ★修正: ルート相対パスに変更
const DANMAKU_ASSETS_PATH = '/assets/images/game/souji/';

const danmakuImages = {
    player: new Image(),
    boss: new Image(),
    goods: [],
    bads: []
};

// Goodアイテム定義
const goodItemsDef = [
    { file: 'kari1_dot.png', score: 10, weight: 60 },
    { file: 'kari100_dot.png', score: 50, weight: 30 },
    { file: 'churu_dot.png', score: 100, weight: 10 }
];
// Badアイテム定義
const badItemsDef = [
    'soccerball_dot.png', 'baseball_dot.png', 'coffee_dot.png',
    'can_dot.png', 'mouse_dot.png', 'konchu_dot.png', 'choco_dot.png'
];

let areDanmakuImagesLoaded = false;

function loadDanmakuImages() {
    if (areDanmakuImagesLoaded) return;
    
    // ★キャッシュ対策のタイムスタンプを追加
    const ts = new Date().getTime();
    
    danmakuImages.player.crossOrigin = "Anonymous";
    danmakuImages.player.src = DANMAKU_ASSETS_PATH + 'neru_dot.png?v=' + ts;
    
    danmakuImages.boss.crossOrigin = "Anonymous";
    danmakuImages.boss.src = DANMAKU_ASSETS_PATH + 'runba_dot.png?v=' + ts;
    
    // Goodアイテム読み込み
    danmakuImages.goods = goodItemsDef.map(def => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = DANMAKU_ASSETS_PATH + def.file + '?v=' + ts;
        return { img: img, score: def.score, weight: def.weight };
    });

    // Badアイテム読み込み
    danmakuImages.bads = badItemsDef.map(file => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = DANMAKU_ASSETS_PATH + file + '?v=' + ts;
        return img;
    });

    areDanmakuImagesLoaded = true;
}

let danmakuState = { 
    running: false, 
    ctx: null, 
    canvas: null, 
    width: 0, 
    height: 0, 
    score: 0, 
    life: 3, 
    frame: 0, 
    invincibleTimer: 0, 
    player: { x: 0, y: 0, w: 40, h: 40 }, 
    boss: { x: 0, y: 0, w: 60, h: 60, angle: 0 }, 
    bullets: [], 
    touching: false 
};

window.showDanmakuGame = function() {
    window.switchScreen('screen-danmaku'); 
    document.getElementById('mini-karikari-display').classList.remove('hidden');
    if(typeof window.updateMiniKarikari === 'function') window.updateMiniKarikari();
    
    loadDanmakuImages(); 

    const canvas = document.getElementById('danmaku-canvas'); 
    danmakuState.canvas = canvas; 
    danmakuState.ctx = canvas.getContext('2d'); 
    danmakuState.width = canvas.width; 
    danmakuState.height = canvas.height;
    
    danmakuState.running = false; 
    danmakuState.score = 0; 
    danmakuState.life = 3;
    document.getElementById('danmaku-score').innerText = "0";
    
    const startBtn = document.getElementById('start-danmaku-btn'); 
    startBtn.disabled = false; 
    startBtn.innerText = "スタート！";
    
    window.updateNellMessage("ロボット掃除機をよけてアイテムを集めるにゃ！3回ぶつかるとゲームオーバーだにゃ！", "excited", false);
    
    const moveHandler = (e) => { 
        if (!danmakuState.running) return; 
        e.preventDefault(); 
        const rect = canvas.getBoundingClientRect(); 
        const clientX = e.touches ? e.touches[0].clientX : e.clientX; 
        const clientY = e.touches ? e.touches[0].clientY : e.clientY; 
        let x = clientX - rect.left; 
        let y = clientY - rect.top; 
        x = Math.max(danmakuState.player.w/2, Math.min(danmakuState.width - danmakuState.player.w/2, x)); 
        y = Math.max(danmakuState.player.h/2, Math.min(danmakuState.height - danmakuState.player.h/2, y)); 
        danmakuState.player.x = x; 
        danmakuState.player.y = y; 
    };
    canvas.onmousedown = (e) => { danmakuState.touching = true; moveHandler(e); }; 
    canvas.onmousemove = (e) => { if(danmakuState.touching) moveHandler(e); }; 
    canvas.onmouseup = () => { danmakuState.touching = false; }; 
    canvas.onmouseleave = () => { danmakuState.touching = false; }; 
    canvas.ontouchstart = (e) => { danmakuState.touching = true; moveHandler(e); }; 
    canvas.ontouchmove = moveHandler; 
    canvas.ontouchend = () => { danmakuState.touching = false; };
    
    initDanmakuEntities(); 
    drawDanmakuFrame();
};

function initDanmakuEntities() { 
    danmakuState.player.x = danmakuState.width / 2; 
    danmakuState.player.y = danmakuState.height - 60; 
    danmakuState.boss.x = danmakuState.width / 2; 
    danmakuState.boss.y = 80; 
    danmakuState.bullets = []; 
    danmakuState.frame = 0; 
    danmakuState.life = 3;
    danmakuState.invincibleTimer = 0;
}

window.startDanmakuGame = function() { 
    if (danmakuState.running) return; 
    initDanmakuEntities(); 
    danmakuState.score = 0; 
    document.getElementById('danmaku-score').innerText = "0"; 
    danmakuState.running = true; 
    document.getElementById('start-danmaku-btn').disabled = true; 
    loopDanmakuGame(); 
};

window.stopDanmakuGame = function() { 
    danmakuState.running = false; 
};

function loopDanmakuGame() { 
    if (!danmakuState.running) return; 
    updateDanmaku(); 
    drawDanmakuFrame(); 
    requestAnimationFrame(loopDanmakuGame); 
}

function updateDanmaku() {
    danmakuState.frame++; 
    
    danmakuState.boss.x = (danmakuState.width / 2) + Math.sin(danmakuState.frame * 0.02) * (danmakuState.width / 3); 
    
    let spawnRate = Math.max(15, 60 - Math.floor(danmakuState.score / 100)); 
    if (danmakuState.frame % spawnRate === 0) spawnBullet();
    
    if (danmakuState.invincibleTimer > 0) danmakuState.invincibleTimer--;

    for (let i = danmakuState.bullets.length - 1; i >= 0; i--) {
        let b = danmakuState.bullets[i]; 
        b.x += b.vx; 
        b.y += b.vy;
        
        if (b.y > danmakuState.height + 30 || b.x < -30 || b.x > danmakuState.width + 30 || b.y < -30) { 
            danmakuState.bullets.splice(i, 1); 
            continue; 
        }
        
        let itemRadius = 16;
        let playerRadius = 12; 
        
        let dx = b.x - danmakuState.player.x; 
        let dy = b.y - danmakuState.player.y; 
        let dist = Math.sqrt(dx*dx + dy*dy);
        
        if (dist < playerRadius + itemRadius) {
            if (b.type === 'good') { 
                danmakuState.score += b.scoreVal; 
                document.getElementById('danmaku-score').innerText = danmakuState.score; 
                if(window.safePlay) window.safePlay(window.sfxHit); 
                danmakuState.bullets.splice(i, 1); 
            } else { 
                if (danmakuState.invincibleTimer <= 0) {
                    danmakuState.life--;
                    if(window.safePlay) window.safePlay(window.sfxBatu); 
                    danmakuState.invincibleTimer = 60; 
                    
                    if (danmakuState.life <= 0) {
                        gameOverDanmaku(); 
                        return;
                    }
                }
            }
        }
    }
}

function spawnBullet() {
    let type = Math.random() < 0.4 ? 'good' : 'bad'; 
    let bulletObj = {};
    
    if (type === 'good') {
        const rand = Math.random() * 100;
        let cumulative = 0;
        let selected = danmakuImages.goods[0];
        for (let g of danmakuImages.goods) {
            cumulative += g.weight;
            if (rand < cumulative) {
                selected = g;
                break;
            }
        }
        bulletObj = { type: 'good', img: selected.img, scoreVal: selected.score };
    } else {
        const randIdx = Math.floor(Math.random() * danmakuImages.bads.length);
        bulletObj = { type: 'bad', img: danmakuImages.bads[randIdx], scoreVal: 0 };
    }

    let angle = Math.atan2(danmakuState.player.y - danmakuState.boss.y, danmakuState.player.x - danmakuState.boss.x); 
    angle += (Math.random() - 0.5) * 0.8; 
    
    let speed = 2 + Math.random() * 3 + (danmakuState.score / 1000); 
    
    danmakuState.bullets.push({ 
        x: danmakuState.boss.x, 
        y: danmakuState.boss.y, 
        vx: Math.cos(angle) * speed, 
        vy: Math.sin(angle) * speed, 
        ...bulletObj
    });
}

function gameOverDanmaku() {
    danmakuState.running = false; 
    if(window.safePlay) window.safePlay(window.sfxOver);
    
    if (danmakuState.score > 0) { 
        window.giveGameReward(danmakuState.score); 
        window.updateNellMessage(`あぶにゃい！ぶつかったにゃ！でも${danmakuState.score}個ゲットだにゃ！`, "sad"); 
    } else { 
        window.updateNellMessage("すぐにぶつかっちゃったにゃ…", "sad"); 
    }
    const startBtn = document.getElementById('start-danmaku-btn'); 
    startBtn.disabled = false; 
    startBtn.innerText = "もう一回！";
}

function drawDanmakuFrame() {
    const ctx = danmakuState.ctx; 
    const w = danmakuState.width; 
    const h = danmakuState.height; 
    
    ctx.clearRect(0, 0, w, h);
    
    ctx.fillStyle = "#fff9c4"; 
    ctx.fillRect(0, 0, w, h); 
    
    ctx.strokeStyle = "#ffe082"; 
    ctx.lineWidth = 2; 
    for(let i=0; i<h; i+=40) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke(); }
    
    // Boss (Robot Cleaner)
    if (danmakuImages.boss.complete && danmakuImages.boss.naturalWidth > 0) {
        ctx.drawImage(danmakuImages.boss, danmakuState.boss.x - 30, danmakuState.boss.y - 30, 60, 60);
    } else {
        // Fallback: Gray circle
        ctx.fillStyle = "gray"; ctx.beginPath(); ctx.arc(danmakuState.boss.x, danmakuState.boss.y, 30, 0, Math.PI*2); ctx.fill();
    }

    if (danmakuState.invincibleTimer > 0 && Math.floor(danmakuState.frame / 4) % 2 === 0) {
        // 無敵時間中の点滅（描画スキップ）
    } else {
        // Player (Nelu)
        if (danmakuImages.player.complete && danmakuImages.player.naturalWidth > 0) {
            ctx.drawImage(danmakuImages.player, danmakuState.player.x - 20, danmakuState.player.y - 20, 40, 40);
        } else {
            // Fallback: Orange circle
            ctx.fillStyle = "orange"; ctx.beginPath(); ctx.arc(danmakuState.player.x, danmakuState.player.y, 20, 0, Math.PI*2); ctx.fill();
        }
    }

    // Bullets (Items)
    danmakuState.bullets.forEach(b => {
        if (b.img && b.img.complete && b.img.naturalWidth > 0) {
            ctx.drawImage(b.img, b.x - 16, b.y - 16, 32, 32);
        } else {
            // Fallback
            ctx.fillStyle = b.type === 'good' ? "blue" : "red";
            ctx.beginPath(); ctx.arc(b.x, b.y, 10, 0, Math.PI*2); ctx.fill();
        }
    });

    // Life
    ctx.textAlign = "left"; 
    ctx.textBaseline = "top"; 
    ctx.font = "20px sans-serif"; 
    ctx.fillStyle = "#ff5252";
    let lifeStr = "❤️".repeat(Math.max(0, danmakuState.life));
    ctx.fillText("LIFE: " + lifeStr, 10, 10);
}

// ==========================================
// 3. ウルトラクイズ
// ==========================================

let quizState = {
    currentQuestionIndex: 0,
    maxQuestions: 5,
    score: 0,
    currentQuizData: null,
    nextQuizData: null,
    genre: "全ジャンル",
    level: 1, 
    isFinished: false,
    history: [] 
};

async function fetchQuizData(genre, level = 1) {
    const res = await fetch('/generate-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            grade: currentUser ? currentUser.grade : "1",
            genre: genre,
            level: level 
        })
    });
    return await res.json();
}

window.showQuizGame = function() {
    window.switchScreen('screen-quiz');
    window.currentMode = 'quiz';
    
    const levels = (currentUser && currentUser.quizLevels) ? currentUser.quizLevels : {};
    const genres = ["全ジャンル", "一般知識", "雑学", "芸能・スポーツ", "歴史・地理・社会", "ゲーム", "マインクラフト", "ロブロックス", "ポケモン"];
    const idMap = {
        "全ジャンル": "btn-quiz-all",
        "一般知識": "btn-quiz-general",
        "雑学": "btn-quiz-trivia",
        "芸能・スポーツ": "btn-quiz-entertainment",
        "歴史・地理・社会": "btn-quiz-history",
        "ゲーム": "btn-quiz-game",
        "マインクラフト": "btn-quiz-minecraft",
        "ロブロックス": "btn-quiz-roblox",
        "ポケモン": "btn-quiz-pokemon"
    };

    genres.forEach(g => {
        const btn = document.getElementById(idMap[g]);
        if (btn) {
            const lv = levels[g] || 1;
            btn.innerText = `${g} (Lv.${lv})`;
        }
    });

    document.getElementById('quiz-genre-select').classList.remove('hidden');
    document.getElementById('quiz-level-select').classList.add('hidden'); 
    document.getElementById('quiz-game-area').classList.add('hidden');
    window.updateNellMessage("どのジャンルに挑戦するにゃ？", "normal");
};

window.showLevelSelection = function(genre) {
    const currentMaxLevel = (currentUser && currentUser.quizLevels && currentUser.quizLevels[genre]) || 1;
    
    if (currentMaxLevel === 1) {
        startQuizSet(genre, 1);
        return;
    }

    document.getElementById('quiz-genre-select').classList.add('hidden');
    document.getElementById('quiz-level-select').classList.remove('hidden');
    
    const container = document.getElementById('level-buttons-container');
    container.innerHTML = "";
    
    for (let i = 1; i <= currentMaxLevel; i++) {
        const btn = document.createElement('button');
        btn.className = "main-btn";
        btn.innerText = `レベル ${i}`;
        if (i === 1) btn.classList.add('blue-btn');
        else if (i === 2) btn.classList.add('green-btn');
        else if (i === 3) btn.classList.add('orange-btn');
        else if (i === 4) btn.classList.add('pink-btn');
        else btn.classList.add('purple-btn'); 

        btn.onclick = () => startQuizSet(genre, i);
        container.appendChild(btn);
    }
};

window.backToQuizGenre = function() {
    document.getElementById('quiz-level-select').classList.add('hidden');
    document.getElementById('quiz-genre-select').classList.remove('hidden');
};

window.startQuizSet = async function(genre, level) {
    quizState.genre = genre;
    quizState.level = level; 
    quizState.currentQuestionIndex = 0;
    quizState.score = 0;
    quizState.isFinished = false;
    quizState.currentQuizData = null;
    quizState.nextQuizData = null;
    quizState.history = []; 

    document.getElementById('quiz-genre-select').classList.add('hidden');
    document.getElementById('quiz-level-select').classList.add('hidden');
    document.getElementById('quiz-game-area').classList.remove('hidden');
    
    document.getElementById('quiz-genre-label').innerText = `${genre} Lv.${level}`;

    if(typeof window.startAlwaysOnListening === 'function') window.startAlwaysOnListening();

    window.nextQuiz();
};

window.nextQuiz = async function() {
    if (quizState.currentQuestionIndex >= quizState.maxQuestions) {
        window.finishQuizSet();
        return;
    }

    quizState.currentQuestionIndex++;
    document.getElementById('quiz-progress').innerText = `${quizState.currentQuestionIndex}/${quizState.maxQuestions} 問目`;
    
    const qText = document.getElementById('quiz-question-text');
    const controls = document.getElementById('quiz-controls');
    const nextBtn = document.getElementById('next-quiz-btn');
    const ansDisplay = document.getElementById('quiz-answer-display');
    const micStatus = document.getElementById('quiz-mic-status');
    const optionsContainer = document.getElementById('quiz-options-container');

    qText.innerText = "問題を作ってるにゃ…";
    window.updateNellMessage("問題を作ってるにゃ…", "thinking");
    micStatus.innerText = "";
    ansDisplay.classList.add('hidden');
    controls.style.display = 'none';
    nextBtn.classList.add('hidden');
    optionsContainer.innerHTML = ""; 
    
    let quizData = null;
    let retryCount = 0;
    const MAX_RETRIES = 3;

    while (retryCount < MAX_RETRIES) {
        if (quizState.nextQuizData) {
            quizData = quizState.nextQuizData;
            quizState.nextQuizData = null;
        } else {
            try {
                quizData = await fetchQuizData(quizState.genre, quizState.level);
            } catch (e) {
                console.error(e);
                break;
            }
        }

        if (quizData && quizData.answer) {
            const isDuplicate = quizState.history.some(h => h === quizData.answer);
            if (!isDuplicate) {
                break;
            } else {
                console.log("Duplicate quiz detected. Retrying...", quizData.answer);
                quizData = null; 
                retryCount++;
            }
        } else {
            break; 
        }
    }

    if (!quizData) {
        qText.innerText = "問題が作れなかったにゃ…";
        setTimeout(() => window.showQuizGame(), 2000);
        return;
    }

    if (quizData && quizData.question) {
        quizState.history.push(quizData.answer);
        if (quizState.history.length > 5) quizState.history.shift();

        window.currentQuiz = quizData; 
        quizState.currentQuizData = quizData;
        
        qText.innerText = quizData.question;
        window.updateNellMessage(quizData.question, "normal", false, true);
        
        if (quizData.options && Array.isArray(quizData.options)) {
            const shuffledOptions = [...quizData.options].sort(() => Math.random() - 0.5);
            shuffledOptions.forEach(opt => {
                const btn = document.createElement('button');
                btn.className = "quiz-option-btn";
                btn.innerText = opt;
                btn.onclick = () => window.checkQuizAnswer(opt, true); 
                optionsContainer.appendChild(btn);
            });
        }
        
        if (quizData.actual_genre && quizData.actual_genre !== quizState.genre) {
             const baseLabel = `${quizState.genre} Lv.${quizState.level}`;
             document.getElementById('quiz-genre-label').innerText = `${baseLabel} (${quizData.actual_genre})`;
        } else {
             document.getElementById('quiz-genre-label').innerText = `${quizState.genre} Lv.${quizState.level}`;
        }

        controls.style.display = 'flex';
        
        fetchQuizData(quizState.genre, quizState.level).then(data => { quizState.nextQuizData = data; }).catch(err => console.warn("Pre-fetch failed", err));
    } else {
        qText.innerText = "エラーだにゃ…";
    }
};

window.checkQuizAnswer = function(userAnswer, isButton = false) {
    if (!window.currentQuiz || window.currentMode !== 'quiz') return false; 
    if (!document.getElementById('quiz-answer-display').classList.contains('hidden')) return false;

    const correct = window.currentQuiz.answer;
    const accepted = window.currentQuiz.accepted_answers || [];
    
    const buttons = document.querySelectorAll('.quiz-option-btn');
    if (isButton) {
        buttons.forEach(b => b.disabled = true);
    }

    const cleanUserAnswer = userAnswer.trim();
    let isCorrect = false;
    if (cleanUserAnswer.includes(correct) || accepted.some(a => cleanUserAnswer.includes(a))) {
        isCorrect = true;
    } else if (fuzzyContains(cleanUserAnswer, correct)) {
        isCorrect = true;
    }
    
    const status = document.getElementById('quiz-mic-status');
    status.innerText = `「${cleanUserAnswer}」？`;
    
    if (isCorrect) {
        if(window.safePlay) window.safePlay(window.sfxMaru);
        window.updateNellMessage(`ピンポン！正解だにゃ！答えは「${correct}」！`, "excited", false, true);
        quizState.score += 20; 
        
        if (isButton) {
            buttons.forEach(b => {
                if (b.innerText === cleanUserAnswer) b.classList.add('quiz-correct');
            });
        } else {
            buttons.forEach(b => {
                if (b.innerText === correct) b.classList.add('quiz-correct');
            });
        }

        window.showQuizResult(true);
        return true; 
    } else {
        if (isButton) {
            if(window.safePlay) window.safePlay(window.sfxBatu);
            window.updateNellMessage(`残念！正解は「${correct}」だったにゃ。`, "gentle", false, true);
            buttons.forEach(b => {
                if (b.innerText === cleanUserAnswer) b.classList.add('quiz-wrong');
                if (b.innerText === correct) b.classList.add('quiz-correct');
            });
            window.showQuizResult(false);
            return true;
        }
    }
    return false; 
};

window.requestQuizHint = function() {
    if (!window.currentQuiz) return;
    window.sendHttpTextInternal("ヒントを教えて");
};

window.giveUpQuiz = function() {
    if (!window.currentQuiz) return;
    if(window.safePlay) window.safePlay(window.sfxBatu);
    window.updateNellMessage(`残念だにゃ～。正解は「${window.currentQuiz.answer}」だったにゃ！`, "gentle", false, true);
    window.showQuizResult(false);
};

window.showQuizResult = function(isWin) {
    const controls = document.getElementById('quiz-controls');
    const nextBtn = document.getElementById('next-quiz-btn');
    const ansDisplay = document.getElementById('quiz-answer-display');
    const ansText = document.getElementById('quiz-answer-text');

    const btns = controls.querySelectorAll('button:not(#next-quiz-btn)');
    btns.forEach(b => b.classList.add('hidden'));
    
    nextBtn.classList.remove('hidden');
    controls.style.display = 'flex';

    if (window.currentQuiz) {
        ansText.innerText = window.currentQuiz.answer;
        ansDisplay.classList.remove('hidden');
    }
};

window.finishQuizSet = function() {
    quizState.isFinished = true;
    window.currentQuiz = null;

    let msg = "";
    let mood = "normal";
    
    let isLevelUp = false;
    let newLevel = 1;

    if (quizState.score === 100) {
        if (currentUser) {
            if (!currentUser.quizLevels) currentUser.quizLevels = {};
            const currentMaxLevel = currentUser.quizLevels[quizState.genre] || 1;
            
            if (quizState.level === currentMaxLevel && currentMaxLevel < 5) {
                newLevel = currentMaxLevel + 1;
                currentUser.quizLevels[quizState.genre] = newLevel;
                isLevelUp = true;
                if(typeof window.saveAndSync === 'function') window.saveAndSync();
            }
        }

        if (isLevelUp) {
            msg = `全問正解！すごいにゃ！${quizState.genre}のレベルが${newLevel}に上がったにゃ！！カリカリ100個あげるにゃ！`;
        } else {
            msg = "全問正解！天才だにゃ！！カリカリ100個あげるにゃ！";
        }
        mood = "excited";
        window.giveGameReward(100);
    } else if (quizState.score >= 60) {
        msg = `${quizState.score}点！よくがんばったにゃ！カリカリ${quizState.score}個あげるにゃ！`;
        mood = "happy";
        window.giveGameReward(quizState.score);
    } else {
        msg = `${quizState.score}点だったにゃ。次はもっとがんばるにゃ！カリカリ10個あげるにゃ。`;
        mood = "gentle";
        window.giveGameReward(10);
    }

    window.updateNellMessage(msg, mood, false, true);
    alert(msg);
    
    window.showQuizGame();
};

// ==========================================
// 4. ★新規: ネル先生のなぞなぞ (修正版)
// ==========================================

let riddleState = {
    currentRiddle: null,
    nextRiddle: null,
    isFinished: false
};

async function fetchRiddleData() {
    const res = await fetch('/generate-riddle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            grade: currentUser ? currentUser.grade : "1"
        })
    });
    return await res.json();
}

window.showRiddleGame = function() {
    if (typeof window.switchScreen === 'function') {
        window.switchScreen('screen-riddle');
    } else {
        document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
        document.getElementById('screen-riddle').classList.remove('hidden');
    }
    
    window.currentMode = 'riddle';
    
    const ids = ['subject-selection-view', 'upload-controls', 'thinking-view', 'problem-selection-view', 'final-view', 'chalkboard', 'chat-view', 'simple-chat-view', 'chat-free-view', 'lunch-view', 'grade-sheet-container', 'hint-detail-container', 'embedded-chat-section'];
    ids.forEach(id => { 
        const el = document.getElementById(id); 
        if (el) el.classList.add('hidden'); 
    });
    const convoLog = document.getElementById('conversation-log');
    if(convoLog) convoLog.classList.add('hidden');
    
    document.getElementById('riddle-question-text').innerText = "スタートボタンを押してにゃ！";
    document.getElementById('riddle-controls').style.display = 'none';
    const startBtn = document.getElementById('start-riddle-btn');
    if(startBtn) startBtn.style.display = 'inline-block';
    
    document.getElementById('riddle-answer-display').classList.add('hidden');
    document.getElementById('riddle-mic-status').innerText = "";
    
    if(typeof window.updateNellMessage === 'function') {
        window.updateNellMessage("なぞなぞで遊ぶにゃ！", "excited", false);
    }
    
    if(typeof window.stopAlwaysOnListening === 'function') window.stopAlwaysOnListening();
};

window.startRiddle = async function() {
    const startBtn = document.getElementById('start-riddle-btn');
    startBtn.style.display = 'none';
    
    document.getElementById('riddle-controls').style.display = 'flex';
    document.getElementById('riddle-answer-display').classList.add('hidden');
    
    if(typeof window.startAlwaysOnListening === 'function') window.startAlwaysOnListening();
    
    window.nextRiddle();
};

window.nextRiddle = async function() {
    const qText = document.getElementById('riddle-question-text');
    const controls = document.getElementById('riddle-controls');
    const nextBtn = document.getElementById('next-riddle-btn');
    const ansDisplay = document.getElementById('riddle-answer-display');
    const micStatus = document.getElementById('riddle-mic-status');
    const giveUpBtn = controls.querySelector('button.gray-btn');

    qText.innerText = "なぞなぞを考えてるにゃ…";
    window.updateNellMessage("なぞなぞを考えてるにゃ…", "thinking");
    micStatus.innerText = "";
    ansDisplay.classList.add('hidden');
    nextBtn.classList.add('hidden');
    if(giveUpBtn) giveUpBtn.classList.remove('hidden');
    
    let riddleData = null;
    if (riddleState.nextRiddle) {
        riddleData = riddleState.nextRiddle;
        riddleState.nextRiddle = null;
    } else {
        try {
            riddleData = await fetchRiddleData();
        } catch (e) {
            console.error(e);
            qText.innerText = "なぞなぞが作れなかったにゃ…";
            setTimeout(() => {
                document.getElementById('start-riddle-btn').style.display = 'inline-block';
                controls.style.display = 'none';
            }, 2000);
            return;
        }
    }

    if (riddleData && riddleData.question) {
        riddleState.currentRiddle = riddleData;
        window.currentRiddle = riddleData; 
        
        qText.innerText = riddleData.question;
        window.updateNellMessage(riddleData.question, "normal", false, true);
        
        fetchRiddleData().then(data => { riddleState.nextRiddle = data; }).catch(err => console.warn("Pre-fetch failed", err));
    } else {
        qText.innerText = "エラーだにゃ…";
    }
};

window.checkRiddleAnswer = function(userSpeech) {
    if (!riddleState.currentRiddle || window.currentMode !== 'riddle') return false; 
    
    if (!document.getElementById('riddle-answer-display').classList.contains('hidden')) return false;

    const correct = riddleState.currentRiddle.answer;
    const accepted = riddleState.currentRiddle.accepted_answers || [];
    const userAnswer = userSpeech.trim();
    
    const status = document.getElementById('riddle-mic-status');
    status.innerText = `「${userAnswer}」？`;
    
    let isCorrect = false;
    if (fuzzyContains(userAnswer, correct)) isCorrect = true;
    else {
        for (const ans of accepted) {
            if (fuzzyContains(userAnswer, ans)) {
                isCorrect = true;
                break;
            }
        }
    }
    
    if (isCorrect) {
        if(window.safePlay) window.safePlay(window.sfxMaru);
        window.updateNellMessage(`大正解だにゃ！答えは「${correct}」！カリカリ20個あげるにゃ！`, "excited", false, true);
        window.giveGameReward(20);
        window.showRiddleResult(true);
        return true; 
    } 
    return false; 
};

window.giveUpRiddle = function() {
    if (!riddleState.currentRiddle) return;
    if(window.safePlay) window.safePlay(window.sfxBatu);
    window.updateNellMessage(`答えは「${riddleState.currentRiddle.answer}」だったにゃ！`, "gentle", false, true);
    window.showRiddleResult(false);
};

window.showRiddleResult = function(isWin) {
    const controls = document.getElementById('riddle-controls');
    const nextBtn = document.getElementById('next-riddle-btn');
    const ansDisplay = document.getElementById('riddle-answer-display');
    const ansText = document.getElementById('riddle-answer-text');
    const giveUpBtn = controls.querySelector('button.gray-btn');

    if(giveUpBtn) giveUpBtn.classList.add('hidden');
    nextBtn.classList.remove('hidden');

    if (riddleState.currentRiddle) {
        ansText.innerText = riddleState.currentRiddle.answer;
        ansDisplay.classList.remove('hidden');
    }
};

// ==========================================
// 5. ネル先生の漢字ドリル
// ==========================================
let kanjiState = { data: null, canvas: null, ctx: null, isDrawing: false, mode: 'writing', questionCount: 0, maxQuestions: 5 };

window.showKanjiMenu = function() {
    window.switchScreen('screen-kanji');
    document.getElementById('kanji-menu-container').classList.remove('hidden');
    document.getElementById('kanji-game-container').classList.add('hidden');
    document.getElementById('kanji-menu-container').style.display = 'block';
};

window.startKanjiSet = function(mode) {
    window.currentMode = 'kanji';
    kanjiState.mode = mode;
    kanjiState.questionCount = 0;
    document.getElementById('kanji-menu-container').style.display = 'none';
    document.getElementById('kanji-game-container').classList.remove('hidden');
    const canvas = document.getElementById('kanji-canvas');
    kanjiState.canvas = canvas; kanjiState.ctx = canvas.getContext('2d');
    kanjiState.ctx.lineCap = 'round'; kanjiState.ctx.lineJoin = 'round'; kanjiState.ctx.lineWidth = 12; kanjiState.ctx.strokeStyle = '#000000';
    const startDraw = (e) => { kanjiState.isDrawing = true; const pos = getPos(e); kanjiState.ctx.beginPath(); kanjiState.ctx.moveTo(pos.x, pos.y); e.preventDefault(); };
    const draw = (e) => { if (!kanjiState.isDrawing) return; const pos = getPos(e); kanjiState.ctx.lineTo(pos.x, pos.y); kanjiState.ctx.stroke(); e.preventDefault(); };
    const endDraw = () => { kanjiState.isDrawing = false; };
    const getPos = (e) => { const rect = canvas.getBoundingClientRect(); const clientX = e.touches ? e.touches[0].clientX : e.clientX; const clientY = e.touches ? e.touches[0].clientY : e.clientY; return { x: clientX - rect.left, y: clientY - rect.top }; };
    canvas.onmousedown = startDraw; canvas.onmousemove = draw; canvas.onmouseup = endDraw;
    canvas.ontouchstart = startDraw; canvas.ontouchmove = draw; canvas.ontouchend = endDraw;
    if(typeof window.startAlwaysOnListening === 'function') window.startAlwaysOnListening();
    window.nextKanjiQuestion();
};

window.nextKanjiQuestion = async function() {
    if (kanjiState.questionCount >= kanjiState.maxQuestions) {
        window.updateNellMessage("5問クリア！よくがんばったにゃ！", "excited", false, true);
        setTimeout(() => { alert("おつかれさま！メニューに戻るにゃ。"); window.showKanjiMenu(); }, 2000);
        return;
    }
    kanjiState.questionCount++;
    document.getElementById('kanji-progress').innerText = `${kanjiState.questionCount}/${kanjiState.maxQuestions} 問目`;
    document.getElementById('kanji-controls').style.display = 'none';
    document.getElementById('next-kanji-btn').style.display = 'none';
    document.getElementById('kanji-answer-display').classList.add('hidden');
    const qText = document.getElementById('kanji-question-text');
    qText.innerText = "問題を探してるにゃ…";
    window.updateNellMessage("問題を探してるにゃ…", "thinking");
    try {
        const res = await fetch('/generate-kanji', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ grade: currentUser ? currentUser.grade : "1", mode: kanjiState.mode })
        });
        const data = await res.json();
        if (data && data.kanji) {
            kanjiState.data = data;
            window.currentMinitest = data; 
            
            qText.innerHTML = data.question_display;
            window.updateNellMessage(data.question_speech, "normal", false, true);
            const cvs = document.getElementById('kanji-canvas');
            const mic = document.getElementById('kanji-mic-container');
            const checkBtn = document.getElementById('check-kanji-btn');
            const clearBtn = document.getElementById('clear-kanji-btn');
            if (data.type === 'writing') {
                cvs.classList.remove('hidden'); mic.classList.add('hidden'); checkBtn.style.display = 'inline-block'; clearBtn.style.display = 'inline-block'; window.clearKanjiCanvas();
            } else {
                cvs.classList.add('hidden'); mic.classList.remove('hidden'); checkBtn.style.display = 'none'; clearBtn.style.display = 'none';
            }
            document.getElementById('kanji-controls').style.display = 'flex';
        } else { throw new Error("Invalid Kanji Data"); }
    } catch (e) {
        console.error(e); qText.innerText = "問題が出せないにゃ…"; window.updateNellMessage("ごめん、問題が出せないにゃ…", "sad");
    }
};

window.clearKanjiCanvas = function() {
    if (!kanjiState.ctx) return;
    kanjiState.ctx.clearRect(0, 0, kanjiState.canvas.width, kanjiState.canvas.height);
    kanjiState.ctx.save();
    kanjiState.ctx.strokeStyle = '#eee'; kanjiState.ctx.lineWidth = 2; kanjiState.ctx.setLineDash([5, 5]);
    kanjiState.ctx.beginPath(); kanjiState.ctx.moveTo(150, 0); kanjiState.ctx.lineTo(150, 300); kanjiState.ctx.moveTo(0, 150); kanjiState.ctx.lineTo(300, 150); kanjiState.ctx.stroke();
    kanjiState.ctx.restore();
};

window.checkKanji = async function() {
    if (!kanjiState.data || kanjiState.data.type !== 'writing') return;
    window.updateNellMessage("採点するにゃ…じーっ…", "thinking");
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = kanjiState.canvas.width; tempCanvas.height = kanjiState.canvas.height;
    const tCtx = tempCanvas.getContext('2d');
    tCtx.fillStyle = '#ffffff'; tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    tCtx.drawImage(kanjiState.canvas, 0, 0);
    const dataUrl = tempCanvas.toDataURL('image/png');
    const base64 = dataUrl.split(',')[1];
    try {
        const res = await fetch('/check-kanji', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: base64, targetKanji: kanjiState.data.kanji })
        });
        const data = await res.json();
        window.updateNellMessage(data.comment, data.is_correct ? "happy" : "gentle", false, true);
        if (data.is_correct) {
            if(window.safePlay) window.safePlay(window.sfxMaru);
            window.giveGameReward(10);
            document.getElementById('kanji-controls').style.display = 'none';
            document.getElementById('next-kanji-btn').style.display = 'inline-block';
            document.getElementById('kanji-answer-display').classList.remove('hidden');
            document.getElementById('kanji-answer-text').innerText = kanjiState.data.kanji;
            window.currentMinitest = null; 
        } else {
            if(window.safePlay) window.safePlay(window.sfxBatu);
        }
    } catch(e) { window.updateNellMessage("よくわからなかったにゃ…", "thinking"); }
};

window.checkKanjiReading = function(text) {
    if (!kanjiState.data || kanjiState.data.type !== 'reading') return false;
    const correctHiragana = kanjiState.data.reading;
    const correctKanji = kanjiState.data.kanji;
    const correctKatakana = correctHiragana.replace(/[\u3041-\u3096]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60));
    const user = text.trim();
    
    let isCorrect = false;
    if (fuzzyContains(user, correctHiragana) || fuzzyContains(user, correctKanji) || fuzzyContains(user, correctKatakana)) {
        isCorrect = true;
    }

    if (isCorrect) {
        if(window.safePlay) window.safePlay(window.sfxMaru);
        window.updateNellMessage(`正解だにゃ！「${correctHiragana}」だにゃ！カリカリ10個あげるにゃ！`, "excited", false, true);
        window.giveGameReward(10);
        document.getElementById('kanji-controls').style.display = 'none';
        document.getElementById('next-kanji-btn').style.display = 'inline-block';
        document.getElementById('kanji-answer-display').classList.remove('hidden');
        document.getElementById('kanji-answer-text').innerText = correctHiragana;
        window.currentMinitest = null; 
        return true;
    }
    return false;
};

window.giveUpKanji = function() {
    if (!kanjiState.data) return;
    let ans = kanjiState.data.type === 'writing' ? kanjiState.data.kanji : kanjiState.data.reading;
    window.updateNellMessage(`正解は「${ans}」だにゃ。次は頑張るにゃ！`, "gentle", false, true);
    if(window.safePlay) window.safePlay(window.sfxBatu);
    document.getElementById('kanji-controls').style.display = 'none';
    document.getElementById('next-kanji-btn').style.display = 'inline-block';
    document.getElementById('kanji-answer-display').classList.remove('hidden');
    document.getElementById('kanji-answer-text').innerText = ans;
    window.currentMinitest = null; 
};

window.sendHttpTextInternal = function(text) {
    fetch('/chat-dialogue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text, name: currentUser ? currentUser.name : "生徒", history: window.chatSessionHistory, location: window.currentLocation, currentQuizData: window.currentQuiz })
    }).then(res => res.json()).then(data => {
        const speechText = data.speech || data.reply;
        if(typeof window.updateNellMessage === 'function') { window.updateNellMessage(speechText, "normal", true, true); }
    });
};

// ==========================================
// 6. ネル先生のミニテスト
// ==========================================

let minitestState = {
    currentQuestionIndex: 0,
    maxQuestions: 5,
    currentQuestionData: null,
    subject: null,
    score: 0
};

window.showMinitestMenu = function() {
    window.switchScreen('screen-minitest');
    window.currentMode = 'minitest';
    document.getElementById('minitest-subject-select').classList.remove('hidden');
    document.getElementById('minitest-game-area').classList.add('hidden');
};

window.startMinitest = function(subject) {
    minitestState.subject = subject;
    minitestState.currentQuestionIndex = 0;
    minitestState.score = 0;
    
    document.getElementById('minitest-subject-select').classList.add('hidden');
    document.getElementById('minitest-game-area').classList.remove('hidden');
    
    window.updateNellMessage(`${subject}のテストだにゃ！がんばるにゃ！`, "excited");
    
    if(typeof window.startAlwaysOnListening === 'function') window.startAlwaysOnListening();

    window.nextMinitestQuestion();
};

window.nextMinitestQuestion = async function() {
    if (minitestState.currentQuestionIndex >= minitestState.maxQuestions) {
        const resultMsg = `${minitestState.score}点だったにゃ！おつかれさま！`;
        window.updateNellMessage(resultMsg, "happy", false, true);
        alert(resultMsg);
        window.currentMinitest = null; 
        window.showMinitestMenu();
        return;
    }

    minitestState.currentQuestionIndex++;
    document.getElementById('minitest-progress').innerText = `${minitestState.currentQuestionIndex} / ${minitestState.maxQuestions} 問目`;
    
    const qText = document.getElementById('minitest-question');
    const optionsDiv = document.getElementById('minitest-options');
    const explanationArea = document.getElementById('minitest-explanation-area');
    
    qText.innerText = "問題を作成中にゃ...";
    optionsDiv.innerHTML = "";
    explanationArea.classList.add('hidden');
    
    try {
        const res = await fetch('/generate-minitest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                grade: currentUser ? currentUser.grade : "1",
                subject: minitestState.subject 
            })
        });
        const data = await res.json();
        
        if (data.question && data.options) {
            minitestState.currentQuestionData = data;
            window.currentMinitest = data; 
            
            qText.innerText = data.question;
            window.updateNellMessage("さあ、どっちが正解かにゃ？", "normal", false, true); 
            
            const shuffledOptions = [...data.options].sort(() => Math.random() - 0.5);
            
            shuffledOptions.forEach(opt => {
                const btn = document.createElement('button');
                btn.className = "minitest-option-btn";
                btn.innerText = opt;
                btn.onclick = () => window.checkMinitestAnswer(opt, btn);
                optionsDiv.appendChild(btn);
            });
            
        } else {
            throw new Error("Invalid Minitest Data");
        }
    } catch (e) {
        console.error(e);
        qText.innerText = "エラーが発生したにゃ。";
    }
};

window.checkMinitestAnswer = function(selectedAnswer, btnElement) {
    const buttons = document.querySelectorAll('.minitest-option-btn');
    buttons.forEach(b => b.disabled = true);
    
    const correct = minitestState.currentQuestionData.answer;
    const isCorrect = (selectedAnswer === correct);
    
    if (isCorrect) {
        btnElement.classList.add('minitest-correct');
        if(window.safePlay) window.safePlay(window.sfxMaru);
        window.updateNellMessage("正解だにゃ！すごいにゃ！", "excited", false, true);
        minitestState.score += 20; 
        window.giveGameReward(10);
    } else {
        btnElement.classList.add('minitest-wrong');
        buttons.forEach(b => {
            if (b.innerText === correct) b.classList.add('minitest-correct');
        });
        if(window.safePlay) window.safePlay(window.sfxBatu);
        window.updateNellMessage("残念...正解はこっちだにゃ。", "gentle", false, true);
    }
    
    const expArea = document.getElementById('minitest-explanation-area');
    const expText = document.getElementById('minitest-explanation-text');
    if (minitestState.currentQuestionData.explanation) {
        expText.innerText = minitestState.currentQuestionData.explanation;
        expArea.classList.remove('hidden');
    } else {
        expText.innerText = ""; 
        expArea.classList.remove('hidden');
    }
};