// --- js/game-engine.js (v470.7: 漢字音声AI判定 & 完全版) ---

console.log("Game Engine Loading...");

// ==========================================
// 共通ヘルパー: 文字列類似度判定
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
                    matrix[i - 1][j - 1] + 1,
                    Math.min(
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
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

function generateDocIdFromText(text) {
    let hash = 0, i, chr;
    if (text.length === 0) return "empty_quiz";
    for (i = 0; i < text.length; i++) {
        chr = text.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0; 
    }
    return "qz_" + Math.abs(hash).toString(16) + text.length;
}

// ==========================================
// ★ ランキング保存ヘルパー
// ==========================================
window.saveHighScore = async function(gameKey, score) {
    if (!currentUser || !db) return;
    
    const userId = currentUser.id;
    const storageKey = `nell_highscore_${gameKey}_${userId}`;
    let currentHigh = parseInt(localStorage.getItem(storageKey) || "0");
    
    // スコア更新時のみ保存
    if (score > currentHigh) {
        localStorage.setItem(storageKey, score);
        try {
            const docId = `${userId}_${gameKey}`;
            await db.collection("highscores").doc(docId).set({
                gameKey: gameKey,
                score: score,
                userId: userId,
                userName: currentUser.name,
                userPhoto: currentUser.photo,
                userGrade: currentUser.grade,
                updatedAt: new Date().toISOString()
            }, { merge: true });
            console.log(`[Ranking] Highscore saved for ${gameKey}: ${score}`);
        } catch (e) {
            console.error("[Ranking] Save failed:", e);
        }
    }
};

// ==========================================
// 1. カリカリキャッチ (showGame)
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
        newBtn.disabled = false;
        newBtn.innerText = "スタート！";
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
    
    window.ctx.beginPath(); window.ctx.arc(window.ball.x, window.ball.y, window.ball.r, 0, Math.PI*2); 
    window.ctx.fillStyle = "#ff5722"; window.ctx.fill(); window.ctx.closePath();
    
    window.ctx.beginPath(); window.ctx.rect(window.paddle.x, window.paddle.y, window.paddle.w, window.paddle.h); 
    window.ctx.fillStyle = "#8d6e63"; window.ctx.fill(); window.ctx.closePath();
    
    window.bricks.forEach(b => {
        if(b.status === 1) {
            window.ctx.beginPath(); window.ctx.font = "20px sans-serif"; window.ctx.textAlign = "center"; 
            window.ctx.textBaseline = "middle"; window.ctx.fillText("🍖", b.x + b.w/2, b.y + b.h/2); window.ctx.closePath();
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
            if (window.score > 0) { 
                window.giveGameReward(window.score); 
                window.saveHighScore('karikari_catch', window.score);
                if(typeof window.updateNellMessage === 'function') window.updateNellMessage(`あ〜あ、落ちちゃったにゃ…。でも${window.score}個ゲットだにゃ！`, "sad"); 
            } else { 
                if(typeof window.updateNellMessage === 'function') window.updateNellMessage("あ〜あ、落ちちゃったにゃ…", "sad"); 
            }
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
        window.gameRunning = false; 
        window.giveGameReward(window.score);
        window.saveHighScore('karikari_catch', window.score);
        
        if(typeof window.updateNellMessage === 'function') window.updateNellMessage(`全部取ったにゃ！すごいにゃ！！${window.score}個ゲットだにゃ！`, "excited");
        window.fetchGameComment("end", window.score);
        const startBtn = document.getElementById('start-game-btn'); if(startBtn) { startBtn.disabled = false; startBtn.innerText = "もう一回！"; }
        return;
    }
    
    window.gameAnimId = requestAnimationFrame(window.drawGame);
};

// ==========================================
// 2. VS ロボット掃除機 (showDanmakuGame)
// ==========================================
const DANMAKU_ASSETS_PATH = '/assets/images/game/souji/';

const danmakuImages = { player: new Image(), boss: new Image(), goods: [], bads: [] };

const goodItemsDef = [
    { file: 'kari1_dot.png', score: 10, weight: 60 },
    { file: 'kari100_dot.png', score: 50, weight: 30 },
    { file: 'churu_dot.png', score: 100, weight: 10 }
];
const badItemsDef = [
    'soccerball_dot.png', 'baseball_dot.png', 'coffee_dot.png',
    'can_dot.png', 'mouse_dot.png', 'konchu_dot.png', 'choco_dot.png'
];

let areDanmakuImagesLoaded = false;

function loadDanmakuImages() {
    if (areDanmakuImagesLoaded) return;
    const ts = new Date().getTime();
    danmakuImages.player.crossOrigin = "Anonymous";
    danmakuImages.player.src = DANMAKU_ASSETS_PATH + 'neru_dot.png?v=' + ts;
    danmakuImages.boss.crossOrigin = "Anonymous";
    danmakuImages.boss.src = DANMAKU_ASSETS_PATH + 'runba_dot.png?v=' + ts;
    
    danmakuImages.goods = goodItemsDef.map(def => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = DANMAKU_ASSETS_PATH + def.file + '?v=' + ts;
        return { img: img, score: def.score, weight: def.weight };
    });

    danmakuImages.bads = badItemsDef.map(file => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = DANMAKU_ASSETS_PATH + file + '?v=' + ts;
        return img;
    });

    areDanmakuImagesLoaded = true;
}

let danmakuState = { 
    running: false, ctx: null, canvas: null, width: 0, height: 0, score: 0, life: 3, frame: 0, invincibleTimer: 0, 
    player: { x: 0, y: 0, w: 40, h: 40 }, boss: { x: 0, y: 0, w: 60, h: 60, angle: 0 }, bullets: [], touching: false 
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
    if(startBtn) {
        startBtn.disabled = false; 
        startBtn.innerText = "スタート！";
    }
    
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
        b.x += b.vx; b.y += b.vy;
        
        if (b.y > danmakuState.height + 30 || b.x < -30 || b.x > danmakuState.width + 30 || b.y < -30) { 
            danmakuState.bullets.splice(i, 1); continue; 
        }
        
        let itemRadius = 16; let playerRadius = 12; 
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
                    if (danmakuState.life <= 0) { gameOverDanmaku(); return; }
                }
            }
        }
    }
}

function spawnBullet() {
    let type = Math.random() < 0.4 ? 'good' : 'bad'; 
    let bulletObj = {};
    if (type === 'good') {
        const rand = Math.random() * 100; let cumulative = 0; let selected = danmakuImages.goods[0];
        for (let g of danmakuImages.goods) { cumulative += g.weight; if (rand < cumulative) { selected = g; break; } }
        bulletObj = { type: 'good', img: selected.img, scoreVal: selected.score };
    } else {
        const randIdx = Math.floor(Math.random() * danmakuImages.bads.length);
        bulletObj = { type: 'bad', img: danmakuImages.bads[randIdx], scoreVal: 0 };
    }
    let angle = Math.atan2(danmakuState.player.y - danmakuState.boss.y, danmakuState.player.x - danmakuState.boss.x); 
    angle += (Math.random() - 0.5) * 0.8; 
    let speed = 2 + Math.random() * 3 + (danmakuState.score / 1000); 
    danmakuState.bullets.push({ x: danmakuState.boss.x, y: danmakuState.boss.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, ...bulletObj });
}

function gameOverDanmaku() { 
    danmakuState.running = false; 
    if(window.safePlay) window.safePlay(window.sfxOver);
    
    const reward = danmakuState.score;
    window.saveHighScore('vs_robot', reward);

    if (reward > 0) { 
        window.giveGameReward(reward); 
        window.updateNellMessage(`あぶにゃい！ぶつかったにゃ！でも${reward}個ゲットだにゃ！`, "sad"); 
    } else { 
        window.updateNellMessage("すぐにぶつかっちゃったにゃ…", "sad"); 
    }
    
    const startBtn = document.getElementById('start-danmaku-btn'); 
    startBtn.disabled = false; startBtn.innerText = "もう一回！";
}

function drawDanmakuFrame() {
    const ctx = danmakuState.ctx; 
    const w = danmakuState.width; 
    const h = danmakuState.height; 
    
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#fff9c4"; ctx.fillRect(0, 0, w, h); 
    ctx.strokeStyle = "#ffe082"; ctx.lineWidth = 2; 
    for(let i=0; i<h; i+=40) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke(); }
    
    // Boss
    if (danmakuImages.boss.complete && danmakuImages.boss.naturalWidth > 0) {
        ctx.drawImage(danmakuImages.boss, danmakuState.boss.x - 30, danmakuState.boss.y - 30, 60, 60);
    } else {
        ctx.fillStyle = "gray"; ctx.beginPath(); ctx.arc(danmakuState.boss.x, danmakuState.boss.y, 30, 0, Math.PI*2); ctx.fill();
    }

    if (danmakuState.invincibleTimer > 0 && Math.floor(danmakuState.frame / 4) % 2 === 0) {
        // Blink
    } else {
        // Player
        if (danmakuImages.player.complete && danmakuImages.player.naturalWidth > 0) {
            ctx.drawImage(danmakuImages.player, danmakuState.player.x - 20, danmakuState.player.y - 20, 40, 40);
        } else {
            ctx.fillStyle = "orange"; ctx.beginPath(); ctx.arc(danmakuState.player.x, danmakuState.player.y, 20, 0, Math.PI*2); ctx.fill();
        }
    }

    // Bullets
    danmakuState.bullets.forEach(b => {
        if (b.img && b.img.complete && b.img.naturalWidth > 0) {
            ctx.drawImage(b.img, b.x - 16, b.y - 16, 32, 32);
        } else {
            ctx.fillStyle = b.type === 'good' ? "blue" : "red";
            ctx.beginPath(); ctx.arc(b.x, b.y, 10, 0, Math.PI*2); ctx.fill();
        }
    });

    // Life
    ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.font = "20px sans-serif"; ctx.fillStyle = "#ff5252";
    let lifeStr = "❤️".repeat(Math.max(0, danmakuState.life));
    ctx.fillText("LIFE: " + lifeStr, 10, 10);
}

// ==========================================
// 3. ウルトラクイズ (showQuizGame)
// ==========================================
let quizState = {
    currentQuestionIndex: 0, maxQuestions: 5, score: 0, currentQuizData: null, questionQueue: [], sessionQuizzes: [], 
    genre: "全ジャンル", level: 1, isFinished: false, history: [], sessionId: 0 
};

window.showQuizGame = function() {
    window.switchScreen('screen-quiz');
    window.currentMode = 'quiz';
    
    const levels = (currentUser && currentUser.quizLevels) ? currentUser.quizLevels : {};
    const genres = ["全ジャンル", "一般知識", "雑学", "芸能・スポーツ", "歴史・地理・社会", "ゲーム", "マインクラフト", "ロブロックス", "ポケモン", "魔法陣グルグル", "ジョジョの奇妙な冒険", "STPR", "夏目友人帳"];
    const idMap = {
        "全ジャンル": "btn-quiz-all", "一般知識": "btn-quiz-general", "雑学": "btn-quiz-trivia", "芸能・スポーツ": "btn-quiz-entertainment",
        "歴史・地理・社会": "btn-quiz-history", "ゲーム": "btn-quiz-game", "マインクラフト": "btn-quiz-minecraft", "ロブロックス": "btn-quiz-roblox",
        "ポケモン": "btn-quiz-pokemon", "魔法陣グルグル": "btn-quiz-guruguru", "ジョジョの奇妙な冒険": "btn-quiz-jojo", "STPR": "btn-quiz-stpr", "夏目友人帳": "btn-quiz-natsume"
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

        btn.onclick = () => window.startQuizSet(genre, i);
        container.appendChild(btn);
    }
    
    // ★ランキングボタン
    const rankBtn = document.getElementById('quiz-ranking-btn');
    if (rankBtn) {
        rankBtn.onclick = () => window.showRanking(`quiz_${genre}`, `🏆 ${genre} ランキング`);
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
    quizState.questionQueue = []; 
    quizState.sessionQuizzes = []; 
    quizState.history = []; 
    quizState.sessionId = Date.now(); 

    document.getElementById('quiz-genre-select').classList.add('hidden');
    document.getElementById('quiz-level-select').classList.add('hidden');
    document.getElementById('quiz-game-area').classList.remove('hidden');
    document.getElementById('quiz-genre-label').innerText = `${genre} Lv.${level}`;

    backgroundQuizFetcher(genre, level, quizState.sessionId);
    window.nextQuiz();
};

async function generateValidQuiz(genre, level, sessionId) {
    let quizData = null;
    try {
        const res = await fetch('/generate-quiz', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ grade: currentUser ? currentUser.grade : "1", genre: genre, level: level })
        });
        if (res.ok) { quizData = await res.json(); }
    } catch (e) { console.error("Fetch Error:", e); }
    
    if (quizState.sessionId !== sessionId) return null;
    if (quizData && quizData.question && quizData.answer) {
         const isDuplicate = quizState.history.some(h => h === quizData.answer);
         if (!isDuplicate) return quizData;
    } 
    return null;
}

async function backgroundQuizFetcher(genre, level, sessionId) {
    const TOTAL_REQ = 5;
    while (quizState.history.length + quizState.questionQueue.length < TOTAL_REQ) {
        if (quizState.sessionId !== sessionId || quizState.isFinished) return;
        if (quizState.questionQueue.length >= 3) { await new Promise(r => setTimeout(r, 2000)); continue; }
        let newQuiz = await generateValidQuiz(genre, level, sessionId);
        if (quizState.sessionId !== sessionId) return;
        if (newQuiz) quizState.questionQueue.push(newQuiz);
        else await new Promise(r => setTimeout(r, 2000));
    }
}

window.nextQuiz = async function() {
    if (quizState.currentQuestionIndex >= quizState.maxQuestions) {
        window.finishQuizSet();
        return;
    }
    const currentSessionId = quizState.sessionId;
    quizState.currentQuestionIndex++;
    document.getElementById('quiz-progress').innerText = `${quizState.currentQuestionIndex}/${quizState.maxQuestions} 問目`;
    
    const qText = document.getElementById('quiz-question-text');
    const controls = document.getElementById('quiz-controls');
    const nextBtn = document.getElementById('next-quiz-btn');
    const ansDisplay = document.getElementById('quiz-answer-display');
    const micStatus = document.getElementById('quiz-mic-status');
    const optionsContainer = document.getElementById('quiz-options-container');
    const micBtn = document.getElementById('quiz-mic-btn');

    qText.innerText = "問題を一生懸命作って、チェックしてるにゃ…";
    window.updateNellMessage("問題を一生懸命作って、チェックしてるにゃ…", "thinking");
    if(micStatus) micStatus.innerText = "";
    ansDisplay.classList.add('hidden');
    controls.style.display = 'none';
    nextBtn.classList.add('hidden');
    optionsContainer.innerHTML = ""; 
    
    if(micBtn) {
        micBtn.disabled = false;
        micBtn.innerHTML = '<span style="font-size:1.5rem;">🎤</span> 声で答える';
        micBtn.style.background = "#4db6ac";
    }
    
    let quizData = null;
    if (quizState.questionQueue.length > 0) {
        quizData = quizState.questionQueue.shift();
    } else {
        let waitCount = 0;
        while (waitCount < 10) {
            if (quizState.sessionId !== currentSessionId) return; 
            if (quizState.questionQueue.length > 0) { quizData = quizState.questionQueue.shift(); break; }
            await new Promise(r => setTimeout(r, 1000));
            waitCount++;
            if (waitCount === 5) window.updateNellMessage("うーん、まだ確認中だにゃ…もうちょっと待ってにゃ！", "thinking");
        }
    }

    if (!quizData) {
        window.updateNellMessage("お待たせ！今すぐ持ってくるにゃ！", "excited");
        quizData = await generateValidQuiz(quizState.genre, quizState.level, currentSessionId);
    }
    
    if (quizState.sessionId !== currentSessionId) return;

    if (quizData && quizData.question) {
        quizState.history.push(quizData.answer);
        if (quizState.history.length > 10) quizState.history.shift(); 
        quizState.sessionQuizzes.push({ ...quizData, shouldSave: true });
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
        controls.style.display = 'flex';
    } else {
        qText.innerText = "問題が作れなかったにゃ…ごめんにゃ。";
        const backBtn = document.createElement('button');
        backBtn.className = "main-btn gray-btn";
        backBtn.innerText = "戻る";
        backBtn.onclick = window.showQuizGame;
        optionsContainer.appendChild(backBtn);
    }
};

window.checkQuizAnswer = function(userAnswer, isButton = false) {
    if (!window.currentQuiz || window.currentMode !== 'quiz') return false; 
    if (!document.getElementById('quiz-answer-display').classList.contains('hidden')) return false;

    const correct = window.currentQuiz.answer;
    if (isButton) {
        const buttons = document.querySelectorAll('.quiz-option-btn');
        buttons.forEach(b => b.disabled = true);
    }

    const cleanUserAnswer = userAnswer.trim();
    const cleanCorrect = correct.trim();
    let isCorrect = false;

    if (isButton) {
        if (cleanUserAnswer === cleanCorrect) isCorrect = true;
    } else {
        if (cleanUserAnswer.includes(cleanCorrect) || fuzzyContains(cleanUserAnswer, cleanCorrect)) isCorrect = true;
    }
    
    const status = document.getElementById('quiz-mic-status');
    if (status) status.innerText = `「${cleanUserAnswer}」？`;
    
    if (isCorrect) {
        if(window.safePlay) window.safePlay(window.sfxMaru);
        window.updateNellMessage(`ピンポン！正解だにゃ！答えは「${correct}」！`, "excited", false, true);
        quizState.score += 20; 
        const buttons = document.querySelectorAll('.quiz-option-btn');
        buttons.forEach(b => { if (b.innerText === correct) b.classList.add('quiz-correct'); });
        window.showQuizResult(true);
        return true; 
    } else {
        if (isButton) {
            if(window.safePlay) window.safePlay(window.sfxBatu);
            window.updateNellMessage(`残念！正解は「${correct}」だったにゃ。`, "gentle", false, true);
            const buttons = document.querySelectorAll('.quiz-option-btn');
            buttons.forEach(b => {
                if (b.innerText === cleanUserAnswer) b.classList.add('quiz-wrong');
                if (b.innerText === correct) b.classList.add('quiz-correct');
            });
            window.showQuizResult(false);
            return true;
        }
        return false;
    }
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
    const micBtn = document.getElementById('quiz-mic-btn');

    if(micBtn) micBtn.parentElement.style.display = 'none';

    const btns = controls.querySelectorAll('button:not(#next-quiz-btn)');
    btns.forEach(b => b.classList.remove('hidden')); 
    
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
    
    const correctCount = Math.floor(quizState.score / 20);
    const currentLevel = quizState.level || 1;
    let rewardPerCorrect = 50; 
    let totalReward = correctCount * rewardPerCorrect;
    if (correctCount === 0) totalReward = 10;

    // ★修正: ランキングには「獲得カリカリ数(totalReward)」を保存
    window.saveHighScore(`quiz_${quizState.genre}`, totalReward);

    let msg = "";
    let mood = "normal";
    
    // レベルアップ判定
    let isLevelUp = false;
    let newLevel = 1;

    if (correctCount === 5) {
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
        msg = isLevelUp ? 
            `全問正解！すごいにゃ！レベル${newLevel}に上がったにゃ！！カリカリ${totalReward}個あげるにゃ！` : 
            `全問正解！天才だにゃ！！カリカリ${totalReward}個あげるにゃ！`;
        mood = "excited";
    } else if (correctCount >= 3) {
        msg = `${correctCount}問正解！よくがんばったにゃ！カリカリ${totalReward}個あげるにゃ！`;
        mood = "happy";
    } else {
        msg = correctCount > 0 ? `${correctCount}問正解だったにゃ。` : `難しかったかにゃ？参加賞でカリカリ${totalReward}個あげるにゃ。`;
        mood = "gentle";
    }

    window.giveGameReward(totalReward);
    window.updateNellMessage(msg, mood, false, true);
    alert(msg);
    
    const micArea = document.getElementById('quiz-mic-area');
    if (micArea) micArea.style.display = 'block';

    window.showQuizGame();
};

window.startQuizVoiceInput = function() {
    const micBtn = document.getElementById('quiz-mic-btn');
    const status = document.getElementById('quiz-mic-status');
    if (micBtn) { micBtn.disabled = true; micBtn.innerHTML = '<span style="font-size:1.5rem;">👂</span> 聞いてるにゃ...'; micBtn.style.background = "#ff5252"; }
    if (status) status.innerText = "お話してにゃ！";
    if(typeof window.cancelNellSpeech === 'function') window.cancelNellSpeech();
    if (typeof window.startOneShotRecognition === 'function') {
        window.startOneShotRecognition(
            (transcript) => {
                const answered = window.checkQuizAnswer(transcript, false);
                if (!answered) window.stopQuizVoiceInput(true);
            },
            () => { window.stopQuizVoiceInput(); }
        );
    } else {
        alert("音声認識が使えないにゃ...");
        window.stopQuizVoiceInput();
    }
};

window.stopQuizVoiceInput = function(keepStatus = false) {
    const micBtn = document.getElementById('quiz-mic-btn');
    const status = document.getElementById('quiz-mic-status');
    if (micBtn) { micBtn.disabled = false; micBtn.innerHTML = '<span style="font-size:1.5rem;">🎤</span> 声で答える'; micBtn.style.background = "#4db6ac"; }
    if (status && !keepStatus) status.innerText = "";
};

window.reportQuizError = async function() {
    alert("機能未実装だにゃ！ごめんにゃ！");
};

// ==========================================
// 4. ネル先生のなぞなぞ (showRiddleGame)
// ==========================================
let riddleState = {
    currentRiddle: null, nextRiddle: null, isFinished: false, score: 0, questionCount: 0, maxQuestions: 5
};

async function fetchRiddleData() {
    const res = await fetch('/generate-riddle', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grade: currentUser ? currentUser.grade : "1" })
    });
    return await res.json();
}

window.showRiddleGame = function() {
    if (typeof window.switchScreen === 'function') { window.switchScreen('screen-riddle'); } 
    else { document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden')); document.getElementById('screen-riddle').classList.remove('hidden'); }
    window.currentMode = 'riddle';
    document.getElementById('riddle-question-text').innerText = "スタートボタンを押してにゃ！";
    document.getElementById('riddle-controls').style.display = 'none';
    const startBtn = document.getElementById('start-riddle-btn');
    if(startBtn) startBtn.style.display = 'inline-block';
    document.getElementById('riddle-answer-display').classList.add('hidden');
    document.getElementById('riddle-mic-status').innerText = "";
    document.getElementById('riddle-mic-area').style.display = 'none';
    document.getElementById('riddle-progress').innerText = "";
    window.updateNellMessage("なぞなぞで遊ぶにゃ！", "excited", false);
};

window.startRiddle = async function() {
    document.getElementById('start-riddle-btn').style.display = 'none';
    riddleState.score = 0; riddleState.questionCount = 0;
    document.getElementById('riddle-controls').style.display = 'flex';
    document.getElementById('riddle-answer-display').classList.add('hidden');
    document.getElementById('riddle-mic-area').style.display = 'block';
    window.nextRiddle();
};

window.nextRiddle = async function() {
    if (riddleState.questionCount >= riddleState.maxQuestions) {
        const reward = riddleState.score * 100;
        let msg = "";
        if (riddleState.score === 5) msg = `全問正解！すごいにゃ！カリカリ${reward}個あげるにゃ！`;
        else if (riddleState.score > 0) msg = `${riddleState.score}問正解！カリカリ${reward}個あげるにゃ！`;
        else msg = `残念、全問不正解だにゃ…。次はがんばるにゃ！`;
        
        // ★修正: なぞなぞにもランキングがあればここで reward を保存する
        // window.saveHighScore('riddle', reward); 
        
        window.giveGameReward(reward);
        window.updateNellMessage(msg, "happy", false, true);
        alert(msg);
        window.showRiddleGame();
        return;
    }
    riddleState.questionCount++;
    document.getElementById('riddle-progress').innerText = `${riddleState.questionCount} / ${riddleState.maxQuestions} 問目`;
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
        riddleData = riddleState.nextRiddle; riddleState.nextRiddle = null;
    } else {
        try { riddleData = await fetchRiddleData(); } catch (e) {
            console.error(e); qText.innerText = "なぞなぞが作れなかったにゃ…"; return;
        }
    }
    if (riddleData && riddleData.question) {
        riddleState.currentRiddle = riddleData;
        window.currentRiddle = riddleData; 
        qText.innerText = riddleData.question;
        window.updateNellMessage(riddleData.question, "normal", false, true);
        fetchRiddleData().then(data => { riddleState.nextRiddle = data; }).catch(err => console.warn("Pre-fetch failed", err));
    } else { qText.innerText = "エラーだにゃ…"; }
};

window.startRiddleVoiceInput = function() {
    const micBtn = document.getElementById('riddle-mic-btn');
    const status = document.getElementById('riddle-mic-status');
    if (micBtn) { micBtn.disabled = true; micBtn.innerHTML = '<span style="font-size:1.5rem;">👂</span> 聞いてるにゃ...'; micBtn.style.background = "#ff5252"; }
    if (status) status.innerText = "お話してにゃ！";
    if(typeof window.cancelNellSpeech === 'function') window.cancelNellSpeech();
    if (typeof window.startOneShotRecognition === 'function') {
        window.startOneShotRecognition((transcript) => { window.checkRiddleAnswer(transcript); window.stopRiddleVoiceInput(true); }, () => { window.stopRiddleVoiceInput(); });
    } else { alert("音声認識が使えないにゃ..."); window.stopRiddleVoiceInput(); }
};

window.stopRiddleVoiceInput = function(keepStatus = false) {
    const micBtn = document.getElementById('riddle-mic-btn');
    const status = document.getElementById('riddle-mic-status');
    if (micBtn) { micBtn.disabled = false; micBtn.innerHTML = '<span style="font-size:1.5rem;">🎤</span> 声で答える'; micBtn.style.background = "#4db6ac"; }
    if (status && !keepStatus) status.innerText = "";
};

window.checkRiddleAnswer = function(userSpeech) {
    if (!riddleState.currentRiddle || window.currentMode !== 'riddle') return false; 
    if (!document.getElementById('riddle-answer-display').classList.contains('hidden')) return false;
    const correct = riddleState.currentRiddle.answer;
    const accepted = riddleState.currentRiddle.accepted_answers || [];
    const userAnswer = userSpeech.trim();
    const status = document.getElementById('riddle-mic-status');
    if(status) status.innerText = `「${userAnswer}」？`;
    let isCorrect = false;
    if (fuzzyContains(userAnswer, correct)) isCorrect = true;
    else { for (const ans of accepted) { if (fuzzyContains(userAnswer, ans)) { isCorrect = true; break; } } }
    if (isCorrect) {
        if(window.safePlay) window.safePlay(window.sfxMaru);
        window.updateNellMessage(`大正解だにゃ！答えは「${correct}」！`, "excited", false, true);
        riddleState.score++;
        window.showRiddleResult(true);
        return true; 
    } else {
        window.updateNellMessage("違うにゃ〜。もう一回考えてみてにゃ！", "gentle");
        return false;
    }
};

window.giveUpRiddle = function() {
    if (!riddleState.currentRiddle) return;
    if(window.safePlay) window.safePlay(window.sfxBatu);
    window.updateNellMessage(`残念だにゃ～。正解は「${riddleState.currentRiddle.answer}」だったにゃ！`, "gentle", false, true);
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
let kanjiState = { 
    data: null, canvas: null, ctx: null, 
    isDrawing: false, mode: 'writing', 
    questionCount: 0, maxQuestions: 5, correctCount: 0,
    guideVisible: false 
};

window.showKanjiMenu = function() {
    window.switchScreen('screen-kanji');
    const menu = document.getElementById('kanji-menu-container');
    if(menu) { menu.classList.remove('hidden'); menu.style.display = 'block'; }
    const content = document.getElementById('kanji-game-content');
    if(content) content.classList.add('hidden');
};

window.startKanjiSet = function(mode) {
    window.currentMode = 'kanji';
    kanjiState.mode = mode;
    kanjiState.questionCount = 0;
    kanjiState.correctCount = 0;
    document.getElementById('kanji-menu-container').style.display = 'none';
    const content = document.getElementById('kanji-game-content');
    if(content) content.classList.remove('hidden');
    const canvas = document.getElementById('kanji-canvas');
    kanjiState.canvas = canvas; kanjiState.ctx = canvas.getContext('2d');
    kanjiState.ctx.lineCap = 'round'; kanjiState.ctx.lineJoin = 'round'; kanjiState.ctx.lineWidth = 12; kanjiState.ctx.strokeStyle = '#000000';
    const startDraw = (e) => { kanjiState.isDrawing = true; const pos = getPos(e); kanjiState.ctx.beginPath(); kanjiState.ctx.moveTo(pos.x, pos.y); e.preventDefault(); };
    const draw = (e) => { if (!kanjiState.isDrawing) return; const pos = getPos(e); kanjiState.ctx.lineTo(pos.x, pos.y); kanjiState.ctx.stroke(); e.preventDefault(); };
    const endDraw = () => { kanjiState.isDrawing = false; };
    const getPos = (e) => { const rect = canvas.getBoundingClientRect(); const clientX = e.touches ? e.touches[0].clientX : e.clientX; const clientY = e.touches ? e.touches[0].clientY : e.clientY; return { x: clientX - rect.left, y: clientY - rect.top }; };
    canvas.onmousedown = startDraw; canvas.onmousemove = draw; canvas.onmouseup = endDraw;
    canvas.ontouchstart = startDraw; canvas.ontouchmove = draw; canvas.ontouchend = endDraw;
    window.nextKanjiQuestion();
};

window.nextKanjiQuestion = async function() {
    if (kanjiState.questionCount >= kanjiState.maxQuestions) {
        const reward = kanjiState.correctCount * 100;
        let msg = "";
        if (kanjiState.correctCount === 5) msg = `全問正解！すごいにゃ！カリカリ${reward}個あげるにゃ！`;
        else if (kanjiState.correctCount > 0) msg = `${kanjiState.correctCount}問正解！カリカリ${reward}個あげるにゃ！`;
        else msg = `残念、全問不正解だにゃ…。次はがんばるにゃ！`;
        window.giveGameReward(reward);
        window.updateNellMessage(msg, "happy", false, true);
        alert(msg);
        window.showKanjiMenu(); 
        return;
    }
    kanjiState.questionCount++;
    
    kanjiState.guideVisible = false;
    const hanamaru = document.getElementById('kanji-hanamaru');
    if(hanamaru) { hanamaru.innerText = ""; hanamaru.style.display = 'none'; }

    document.getElementById('kanji-hint-readings').style.display = 'none';
    document.getElementById('guide-kanji-btn').innerText = "うすく表示";
    document.getElementById('kanji-progress').innerText = `${kanjiState.questionCount}/${kanjiState.maxQuestions} 問目`;
    document.getElementById('kanji-answer-display').classList.add('hidden');
    document.getElementById('next-kanji-btn').style.display = 'none';
    
    const micStatus = document.getElementById('kanji-mic-status');
    if(micStatus) micStatus.innerText = "";

    const qText = document.getElementById('kanji-question-text');
    qText.innerText = "問題を探してるにゃ…";
    window.updateNellMessage("問題を探してるにゃ…", "thinking");

    let targetKanji = null;
    const grade = currentUser ? currentUser.grade : "1";
    if (window.KANJI_DATA && window.KANJI_DATA[grade]) {
        const list = window.KANJI_DATA[grade];
        if (list && list.length > 0) targetKanji = list[Math.floor(Math.random() * list.length)];
    }

    try {
        const res = await fetch('/generate-kanji', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ grade: grade, mode: kanjiState.mode, targetKanji: targetKanji })
        });
        const data = await res.json();
        if (data && data.kanji) {
            kanjiState.data = data;
            qText.innerHTML = data.question_display;
            const strokesEl = document.getElementById('kanji-hint-strokes');
            if(strokesEl) strokesEl.innerText = data.kakusu ? `画数: ${data.kakusu}` : "";
            const hintDiv = document.getElementById('kanji-hint-readings');
            if (hintDiv) {
                let hints = [];
                if(data.onyomi) hints.push(`音: ${data.onyomi}`);
                if(data.kunyomi) hints.push(`訓: ${data.kunyomi}`);
                hintDiv.innerText = hints.join(' / ');
                hintDiv.style.display = 'none';
            }
            window.updateNellMessage(data.question_speech, "normal", false, true);
            
            const cvs = document.getElementById('kanji-canvas');
            const mic = document.getElementById('kanji-mic-container');
            const controls = document.getElementById('kanji-controls');
            const giveupBtn = document.getElementById('giveup-kanji-btn');
            
            // ★UI切り替えロジック
            if (data.type === 'writing') {
                cvs.classList.remove('hidden'); 
                mic.classList.add('hidden'); 
                controls.style.display = 'flex'; // 書き取り用ボタン表示
                giveupBtn.style.display = 'inline-block';
                window.clearKanjiCanvas();
            } else {
                cvs.classList.add('hidden'); 
                mic.classList.remove('hidden'); // マイクボタン表示
                controls.style.display = 'none'; // 書き取り用ボタン非表示
                giveupBtn.style.display = 'inline-block';
                
                // マイクボタン初期化
                const micBtn = document.getElementById('kanji-mic-btn');
                if (micBtn) { micBtn.disabled = false; micBtn.innerHTML = '<span style="font-size:1.5rem;">🎤</span> 声で答える'; micBtn.style.background = "#4db6ac"; }
            }
        } else { throw new Error("Invalid Kanji Data"); }
    } catch (e) { console.error(e); qText.innerText = "問題が出せないにゃ…"; window.updateNellMessage("ごめん、問題が出せないにゃ…", "sad"); }
};

window.startKanjiVoiceInput = function() {
    const micBtn = document.getElementById('kanji-mic-btn');
    const status = document.getElementById('kanji-mic-status');
    if (micBtn) { micBtn.disabled = true; micBtn.innerHTML = '<span style="font-size:1.5rem;">👂</span> 聞いてるにゃ...'; micBtn.style.background = "#ff5252"; }
    if (status) status.innerText = "お話してにゃ！";
    if(typeof window.cancelNellSpeech === 'function') window.cancelNellSpeech();
    if (typeof window.startOneShotRecognition === 'function') {
        window.startOneShotRecognition((transcript) => { window.checkKanjiVoiceAnswer(transcript); window.stopKanjiVoiceInput(true); }, () => { window.stopKanjiVoiceInput(); });
    } else { alert("音声認識が使えないにゃ..."); window.stopKanjiVoiceInput(); }
};

window.stopKanjiVoiceInput = function(keepStatus = false) {
    const micBtn = document.getElementById('kanji-mic-btn');
    const status = document.getElementById('kanji-mic-status');
    if (micBtn) { micBtn.disabled = false; micBtn.innerHTML = '<span style="font-size:1.5rem;">🎤</span> 声で答える'; micBtn.style.background = "#4db6ac"; }
    if (status && !keepStatus) status.innerText = "";
};

window.checkKanjiVoiceAnswer = async function(transcript) {
    const status = document.getElementById('kanji-mic-status');
    if(status) status.innerText = `「${transcript}」？`;
    
    // 1. クライアントサイドでの簡易判定
    if (window.checkKanjiReadingLocal(transcript)) return;

    // 2. 失敗したらサーバーのAIに判定を依頼
    if(typeof window.updateNellMessage === 'function') window.updateNellMessage("ん？合ってるかにゃ…？", "thinking");
    
    try {
        const res = await fetch('/check-kanji', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                userText: transcript, 
                targetKanji: kanjiState.data.kanji,
                targetReading: kanjiState.data.reading 
            })
        });
        const data = await res.json();
        
        if (data.is_correct) {
            window.processKanjiSuccess(data.comment || "正解だにゃ！");
        } else {
            window.updateNellMessage(data.comment || "違うにゃ〜。もう一回！", "gentle");
        }
    } catch(e) {
        console.error("AI Check Error:", e);
        window.updateNellMessage("ごめん、よく聞こえなかったにゃ。", "sad");
    }
};

window.checkKanjiReadingLocal = function(text) {
    if (!kanjiState.data || kanjiState.data.type !== 'reading') return false;
    const correctHiragana = kanjiState.data.reading;
    const correctKanji = kanjiState.data.kanji;
    const correctKatakana = correctHiragana.replace(/[\u3041-\u3096]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60));
    const user = text.trim();
    
    if (fuzzyContains(user, correctHiragana) || fuzzyContains(user, correctKanji) || fuzzyContains(user, correctKatakana)) {
        window.processKanjiSuccess(`正解だにゃ！「${correctHiragana}」だにゃ！`);
        return true;
    }
    return false;
};

window.processKanjiSuccess = function(comment) {
    if(window.safePlay) window.safePlay(window.sfxMaru);
    window.updateNellMessage(comment, "excited", false, true);
    kanjiState.correctCount++;
    
    // UI更新: 完了状態へ
    document.getElementById('kanji-controls').style.display = 'none';
    document.getElementById('kanji-mic-container').classList.add('hidden');
    document.getElementById('giveup-kanji-btn').style.display = 'none';
    document.getElementById('next-kanji-btn').style.display = 'inline-block';
    
    const ansDisplay = document.getElementById('kanji-answer-display');
    ansDisplay.classList.remove('hidden');
    document.getElementById('kanji-answer-text').innerText = kanjiState.data.kanji;
    const detailText = document.getElementById('kanji-answer-detail');
    if(detailText) detailText.innerHTML = `音読み: ${kanjiState.data.onyomi || "-"} / 訓読み: ${kanjiState.data.kunyomi || "-"} / 画数: ${kanjiState.data.kakusu || "-"}画`;
    
    // 花丸表示
    const hanamaru = document.getElementById('kanji-hanamaru');
    if (hanamaru) { hanamaru.innerText = "○"; hanamaru.style.display = 'flex'; }
};

window.clearKanjiCanvas = function(forceClear = false) {
    if (!kanjiState.ctx) return;
    kanjiState.ctx.clearRect(0, 0, 300, 300);
    if (!forceClear && kanjiState.guideVisible && kanjiState.data) {
        kanjiState.ctx.save();
        kanjiState.ctx.font = "240px 'Klee One', 'Zen Kurenaido', sans-serif";
        kanjiState.ctx.textAlign = "center"; kanjiState.ctx.textBaseline = "middle"; kanjiState.ctx.fillStyle = "rgba(200, 200, 200, 0.5)";
        kanjiState.ctx.fillText(kanjiState.data.kanji, 150, 160);
        kanjiState.ctx.restore();
    }
};

window.toggleKanjiGuide = function() {
    if (!kanjiState.ctx || !kanjiState.data) return;
    kanjiState.guideVisible = !kanjiState.guideVisible;
    const btn = document.getElementById('guide-kanji-btn');
    if(btn) btn.innerText = kanjiState.guideVisible ? "お手本を消す" : "お手本を表示";
    const currentImage = kanjiState.ctx.getImageData(0, 0, kanjiState.canvas.width, kanjiState.canvas.height);
    window.clearKanjiCanvas(true); 
    if (kanjiState.guideVisible) {
        kanjiState.ctx.save();
        kanjiState.ctx.font = "240px 'Klee One', 'Zen Kurenaido', sans-serif";
        kanjiState.ctx.textAlign = "center"; kanjiState.ctx.textBaseline = "middle"; kanjiState.ctx.fillStyle = "rgba(200, 200, 200, 0.5)";
        kanjiState.ctx.fillText(kanjiState.data.kanji, 150, 160);
        kanjiState.ctx.restore();
    }
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = 300; tempCanvas.height = 300;
    tempCanvas.getContext('2d').putImageData(currentImage, 0, 0);
    kanjiState.ctx.drawImage(tempCanvas, 0, 0);
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
        if (data.is_correct) {
            window.processKanjiSuccess(data.comment || "正解だにゃ！");
        } else {
            window.updateNellMessage(data.comment, "gentle", false, true);
            if(window.safePlay) window.safePlay(window.sfxBatu);
        }
    } catch(e) { window.updateNellMessage("よくわからなかったにゃ…", "thinking"); }
};

window.giveUpKanji = function() {
    if (!kanjiState.data) return;
    let ans = kanjiState.data.type === 'writing' ? kanjiState.data.kanji : kanjiState.data.reading;
    window.updateNellMessage(`正解は「${ans}」だにゃ。次は頑張るにゃ！`, "gentle", false, true);
    if(window.safePlay) window.safePlay(window.sfxBatu);
    
    document.getElementById('kanji-controls').style.display = 'none';
    document.getElementById('kanji-mic-container').classList.add('hidden');
    document.getElementById('giveup-kanji-btn').style.display = 'none';
    document.getElementById('next-kanji-btn').style.display = 'inline-block';
    
    document.getElementById('kanji-answer-display').classList.remove('hidden');
    document.getElementById('kanji-answer-text').innerText = ans;
    const detailText = document.getElementById('kanji-answer-detail');
    if(detailText && kanjiState.data) {
        detailText.innerHTML = `音読み: ${kanjiState.data.onyomi || "-"}<br>訓読み: ${kanjiState.data.kunyomi || "-"}<br>画数: ${kanjiState.data.kakusu || "-"}画`;
    }
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
// 6. お宝神経衰弱 (showMemoryGame)
// ==========================================
let memoryGameState = {
    cards: [], flippedCards: [], nellMemory: {}, turn: 'player', difficulty: 'weak', scores: { player: 0, nell: 0 }, isProcessing: false,
    settings: {
        weak: { memoryRate: 0.1, errorRate: 0.5, reward: 10 },
        normal: { memoryRate: 0.5, errorRate: 0.2, reward: 20 },
        strong: { memoryRate: 0.9, errorRate: 0.05, reward: 50 }
    }
};

window.showMemoryGame = function() {
    window.switchScreen('screen-memory-game');
    document.getElementById('memory-difficulty-select').classList.remove('hidden');
    document.getElementById('memory-game-board').classList.add('hidden');
    window.updateNellMessage("お宝図鑑のカードで神経衰弱勝負にゃ！強さを選んでにゃ！", "excited");
    document.getElementById('memory-match-modal').classList.add('hidden');
};

window.startMemoryGame = async function(difficulty) {
    if (!currentUser) return;
    const playerName = currentUser.name || "ユーザー";
    const nameEl = document.getElementById('memory-name-player');
    if(nameEl) nameEl.innerText = `${playerName}さん`;

    memoryGameState.difficulty = difficulty;
    memoryGameState.scores = { player: 0, nell: 0 };
    memoryGameState.turn = 'player';
    memoryGameState.isProcessing = false;
    memoryGameState.flippedCards = [];
    memoryGameState.nellMemory = {};
    
    document.getElementById('memory-difficulty-select').classList.add('hidden');
    document.getElementById('memory-game-board').classList.remove('hidden');
    document.getElementById('memory-score-player').innerText = '0';
    document.getElementById('memory-score-nell').innerText = '0';
    document.getElementById('memory-turn-indicator').innerText = `${playerName}さんの番だにゃ！`;
    
    window.updateNellMessage("カードを配るにゃ！", "normal");
    await window.createCardDeck();
};

window.createCardDeck = async function() {
    const grid = document.getElementById('memory-grid');
    grid.innerHTML = '';
    
    let collection = [];
    if (window.NellMemory) {
        const profile = await window.NellMemory.getUserProfile(currentUser.id);
        if (profile && profile.collection) collection = profile.collection;
    }

    let publicCollection = [];
    if (window.NellMemory && typeof window.NellMemory.getPublicCollection === 'function') {
        try { publicCollection = await window.NellMemory.getPublicCollection(); } catch (e) {}
    }
    
    const normalizedPublic = publicCollection.map(p => ({ name: p.name, image: p.image, description: p.description }));
    let rawCandidates = [...collection, ...normalizedPublic];
    
    const uniqueMap = new Map();
    rawCandidates.forEach(item => { if (!item.image) return; if (!uniqueMap.has(item.image)) uniqueMap.set(item.image, item); });
    let allCandidates = Array.from(uniqueMap.values());
    allCandidates.sort(() => Math.random() - 0.5);
    
    let selectedItems = [];
    const dummyImages = [
        'assets/images/characters/nell-normal.png', 'assets/images/characters/nell-happy.png', 'assets/images/characters/nell-thinking.png',
        'assets/images/characters/nell-excited.png', 'assets/images/items/student-id-base.png', 'assets/images/characters/nell-kokugo.png',
        'assets/images/characters/nell-sansu.png', 'assets/images/characters/nell-rika.png', 'assets/images/characters/nell-shakai.png'
    ];
    
    for (let i = 0; i < 8; i++) {
        let item;
        if (i < allCandidates.length) {
            item = allCandidates[i];
        } else {
            const dummyIdx = i % dummyImages.length;
            item = { name: `お宝(仮)${i+1}`, image: dummyImages[dummyIdx], description: "まだ見つけていないお宝だにゃ。", dummy: true };
        }
        selectedItems.push({ ...item, id: i });
        selectedItems.push({ ...item, id: i });
    }
    selectedItems.sort(() => Math.random() - 0.5);
    
    memoryGameState.cards = selectedItems.map((item, index) => ({ ...item, index: index, matched: false, flipped: false }));
    
    memoryGameState.cards.forEach(card => {
        const cardEl = document.createElement('div');
        cardEl.className = 'memory-card';
        cardEl.id = `memory-card-${card.index}`;
        cardEl.addEventListener('click', () => { window.flipCard(card.index); });
        const imgSrc = card.image || 'assets/images/characters/nell-normal.png';
        
        cardEl.innerHTML = `
            <div class="memory-card-inner">
                <div class="memory-card-front">
                    <div class="memory-card-img-container"><img src="${imgSrc}" class="memory-card-img" onerror="this.src='assets/images/characters/nell-normal.png'"></div>
                    <div class="memory-card-name">${card.name}</div>
                </div>
                <div class="memory-card-back">🐾</div>
            </div>`;
        grid.appendChild(cardEl);
    });
};

window.flipCard = function(index) {
    if (memoryGameState.isProcessing) return;
    if (memoryGameState.turn !== 'player') return;
    const card = memoryGameState.cards[index];
    if (card.flipped || card.matched) return;
    window.performFlip(index);
    if (memoryGameState.flippedCards.length === 2) window.checkMatch();
};

window.performFlip = function(index) {
    const card = memoryGameState.cards[index];
    card.flipped = true;
    const el = document.getElementById(`memory-card-${index}`);
    if (el) el.classList.add('flipped');
    memoryGameState.flippedCards.push(card);
    if(window.safePlay) window.safePlay(window.sfxBtn);
    const settings = memoryGameState.settings[memoryGameState.difficulty];
    if (Math.random() < settings.memoryRate) memoryGameState.nellMemory[index] = card.id;
};

window.checkMatch = async function() {
    memoryGameState.isProcessing = true;
    const [card1, card2] = memoryGameState.flippedCards;
    const playerName = currentUser ? currentUser.name : 'ユーザー';
    
    if (card1.id === card2.id) {
        card1.matched = true; card2.matched = true;
        if (window.safePlay) window.safePlay(window.sfxHirameku);
        
        if (memoryGameState.turn === 'player') {
            memoryGameState.scores.player++;
            document.getElementById('memory-score-player').innerText = memoryGameState.scores.player;
            window.updateNellMessage(`「${card1.name}」をゲットだにゃ！${playerName}さんすごいにゃ！`, "happy");
        } else {
            memoryGameState.scores.nell++;
            document.getElementById('memory-score-nell').innerText = memoryGameState.scores.nell;
            window.updateNellMessage(`ネル先生が「${card1.name}」をゲットしたにゃ！`, "excited");
        }
        await window.showMatchModal(card1);
        memoryGameState.flippedCards = [];
        
        const allMatched = memoryGameState.cards.every(c => c.matched);
        if (allMatched) {
            window.endMemoryGame();
        } else {
            memoryGameState.isProcessing = false;
            if (memoryGameState.turn === 'nell') setTimeout(window.nellTurn, 1000);
        }
    } else {
        if (window.safePlay) window.safePlay(window.sfxBatu);
        setTimeout(() => {
            const el1 = document.getElementById(`memory-card-${card1.index}`);
            const el2 = document.getElementById(`memory-card-${card2.index}`);
            if(el1) el1.classList.remove('flipped'); if(el2) el2.classList.remove('flipped');
            card1.flipped = false; card2.flipped = false;
            memoryGameState.flippedCards = [];
            memoryGameState.turn = (memoryGameState.turn === 'player') ? 'nell' : 'player';
            const indicator = document.getElementById('memory-turn-indicator');
            if (memoryGameState.turn === 'nell') {
                indicator.innerText = "ネル先生の番だにゃ...";
                window.updateNellMessage("次はネル先生の番だにゃ。", "normal");
                memoryGameState.isProcessing = false;
                setTimeout(window.nellTurn, 1000);
            } else {
                indicator.innerText = `${playerName}さんの番だにゃ！`;
                window.updateNellMessage(`${playerName}さんの番だにゃ。`, "normal");
                memoryGameState.isProcessing = false;
            }
        }, 3000);
    }
};

window.nellTurn = function() {
    if (memoryGameState.turn !== 'nell') return;
    memoryGameState.isProcessing = true;
    const availableCards = memoryGameState.cards.filter(c => !c.matched);
    if (availableCards.length === 0) return;
    
    const settings = memoryGameState.settings[memoryGameState.difficulty];
    let pairToFlip = null;
    const knownIndices = Object.keys(memoryGameState.nellMemory).map(Number).filter(idx => !memoryGameState.cards[idx].matched);
    
    for (let i = 0; i < knownIndices.length; i++) {
        for (let j = i + 1; j < knownIndices.length; j++) {
            const idx1 = knownIndices[i]; const idx2 = knownIndices[j];
            if (memoryGameState.cards[idx1].id === memoryGameState.cards[idx2].id) {
                if (Math.random() > settings.errorRate) pairToFlip = [idx1, idx2];
                break;
            }
        }
        if (pairToFlip) break;
    }
    
    let firstIndex;
    if (pairToFlip) {
        firstIndex = pairToFlip[0];
    } else {
        const unknownCards = availableCards.filter(c => !knownIndices.includes(c.index));
        firstIndex = (unknownCards.length > 0) ? unknownCards[Math.floor(Math.random() * unknownCards.length)].index : availableCards[Math.floor(Math.random() * availableCards.length)].index;
    }
    window.performFlip(firstIndex);
    
    setTimeout(() => {
        let secondIndex;
        if (pairToFlip) {
            secondIndex = pairToFlip[1];
        } else {
            const firstCard = memoryGameState.cards[firstIndex];
            const matchInMemory = knownIndices.find(idx => idx !== firstIndex && memoryGameState.cards[idx].id === firstCard.id);
            if (matchInMemory && Math.random() > settings.errorRate) {
                secondIndex = matchInMemory;
            } else {
                const others = availableCards.filter(c => c.index !== firstIndex);
                secondIndex = others[Math.floor(Math.random() * others.length)].index;
            }
        }
        window.performFlip(secondIndex);
        window.checkMatch();
    }, 1000);
};

window.showMatchModal = function(card) {
    return new Promise((resolve) => {
        const modal = document.getElementById('memory-match-modal');
        const img = document.getElementById('memory-match-img');
        img.src = card.image;
        modal.classList.remove('hidden');
        const textToSpeak = `「${card.name}」ゲットだにゃ！ ${card.description}`;
        window.skipMemoryExplanation = () => {
            window.cancelNellSpeech();
            modal.classList.add('hidden');
            resolve();
            window.skipMemoryExplanation = null;
        };
        window.updateNellMessage(textToSpeak, "happy", false, true);
    });
};

window.endMemoryGame = function() {
    const pScore = memoryGameState.scores.player;
    const nScore = memoryGameState.scores.nell;
    const settings = memoryGameState.settings[memoryGameState.difficulty];
    const playerName = currentUser ? currentUser.name : 'ユーザー';
    
    let msg = "";
    let mood = "normal";
    
    // 報酬計算（先に計算）
    let reward = 0;
    if (pScore > nScore) {
        reward = pScore * settings.reward;
    } else {
        // 負け・引き分け時の参加賞
        reward = 10;
        if (pScore === nScore) reward = pScore * settings.reward; // 引き分けでもスコア分あげる
    }

    // ★修正: ランキングには「獲得カリカリ数(reward)」を保存
    window.saveHighScore('memory_match', reward);

    if (pScore > nScore) {
        msg = `${playerName}さんの勝ちだにゃ！すごいにゃ！報酬としてカリカリ${reward}個あげるにゃ！`;
        mood = "excited";
        window.giveGameReward(reward);
    } else if (pScore < nScore) {
        msg = `ネル先生の勝ちだにゃ！まだまだだにゃ〜。参加賞でカリカリ${reward}個あげるにゃ。`;
        mood = "happy";
        window.giveGameReward(reward);
    } else {
        msg = `引き分けだにゃ！いい勝負だったにゃ！カリカリ${reward}個あげるにゃ！`;
        mood = "happy";
        window.giveGameReward(reward);
    }
    
    window.updateNellMessage(msg, mood, false, true);
    alert(msg);
    window.showMemoryGame(); 
};

// ★後方互換性ラッパー: 古いキャッシュのHTMLから呼ばれたとき用
window.showGameRanking = function(gameKey, title) {
    if (window.showRanking) {
        window.showRanking(gameKey, title);
    } else {
        console.error("showRanking is missing!");
    }
};