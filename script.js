// ==========================================
// 🐾 猫後市立ねこづか小学校：フロントエンドシステム
// ==========================================

let users = JSON.parse(localStorage.getItem('nekoneko_users')) || [];
let currentUser = null; 
let currentMode = ''; 
let transcribedProblems = []; 
let selectedProblem = null;
let hintIndex = 0; 
let isAnalyzing = false; 
let currentAudio = null;

// 画像アセット
const idBase = new Image(); idBase.src = 'student-id-base.png';
const decoEars = new Image(); decoEars.src = 'ears.png';
const decoMuzzle = new Image(); decoMuzzle.src = 'muzzle.png';
let modelsLoaded = false;

window.onload = () => {
    console.log("🏫 ねこづか小学校 起動にゃ");
    renderUserList();
    loadFaceModels();
};

// ==========================================
// 🔊 音声合成 (Google Cloud TTS 連携)
// ==========================================
async function speakNell(text, mood = "normal") {
    if (!text || text === "undefined") return;
    
    // 前の音声を止める
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }

    try {
        const res = await fetch('/synthesize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, mood })
        });
        
        if (!res.ok) throw new Error("TTSサーバーに繋がらないにゃ");

        const data = await res.json();
        currentAudio = new Audio("data:audio/mp3;base64," + data.audioContent);
        await currentAudio.play();
    } catch (e) {
        console.warn("高品質音声に失敗したため、ブラウザ音声を使いますにゃ");
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'ja-JP';
        window.speechSynthesis.speak(u);
    }
}

function updateNellMessage(t, mood = "normal") {
    const el = document.getElementById('nell-text');
    if (el) el.innerText = t;
    speakNell(t, mood);
}

// ==========================================
// 📸 顔認識 & 学生証合成
// ==========================================
async function loadFaceModels() {
    const URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';
    try {
        await faceapi.nets.ssdMobilenetv1.loadFromUri(URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(URL);
        modelsLoaded = true;
        const msg = document.getElementById('loading-models');
        if(msg) msg.innerText = "ネル先生の準備OKだにゃ！🐾";
        const btn = document.getElementById('complete-btn');
        if(btn) btn.disabled = false;
    } catch (e) { console.error("Face API load failed."); }
}

document.getElementById('student-photo-input').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file || !modelsLoaded) return;
    const img = await faceapi.bufferToImage(file);
    const detection = await faceapi.detectSingleFace(img).withFaceLandmarks();
    const canvas = document.getElementById('id-photo-preview-canvas');
    const ctx = canvas.getContext('2d');
    const targetW = 94, targetH = 102; ctx.clearRect(0,0,targetW,targetH);

    if (detection) {
        const box = detection.detection.box; const nose = detection.landmarks.getNose()[3];
        const aspect = targetW / targetH; let cropW = box.width * 2.5; let cropH = cropW / aspect;
        let sX = box.x + box.width / 2 - cropW / 2; let sY = box.y + box.height / 2 - cropH * 0.45;
        ctx.drawImage(img, sX, sY, cropW, cropH, 0, 0, targetW, targetH);
        const scale = targetW / cropW; const nX = (nose.x - sX) * scale; const nY = (nose.y - sY) * scale; const fY = (box.y - sY) * scale;
        ctx.drawImage(decoEars, (targetW-targetW*0.9)/2, fY-(targetW*0.9*0.3), targetW*0.9, targetW*0.9);
        ctx.drawImage(decoMuzzle, nX-(targetW*0.6)/2, nY-(targetW*0.6)/3, targetW*0.6, targetW*0.6*0.8);
    } else { ctx.drawImage(img, 0,0, img.width, img.height, 0,0, targetW, targetH); }
});

function processAndCompleteEnrollment() {
    const name = document.getElementById('new-student-name').value;
    const grade = document.getElementById('new-student-grade').value;
    if(!name || !grade) return alert("お名前と学年を入れてにゃ！");
    
    const canvas = document.getElementById('deco-canvas'); canvas.width=800; canvas.height=800;
    const ctx = canvas.getContext('2d'); 
    ctx.drawImage(idBase, 0, 0, 800, 800);
    const pCanvas = document.getElementById('id-photo-preview-canvas');
    ctx.drawImage(pCanvas, 21*2.5, 133*2.5, 94*2.5, 102*2.5);
    ctx.fillStyle="#333"; ctx.font="bold 42px Kiwi Maru"; 
    ctx.fillText(grade+"年生", 190*2.5, 136*2.5+32); 
    ctx.fillText(name, 190*2.5, 175*2.5+42);
    
    const newUser = { id: Date.now(), name, grade, photo: canvas.toDataURL(), karikari: 0, attendance: {} };
    users.push(newUser); 
    localStorage.setItem('nekoneko_users', JSON.stringify(users)); 
    login(newUser);
}

// ==========================================
// 🤖 解析ロジック (リサイズ & エラーガード)
// ==========================================
async function shrinkImage(file) {
    return new Promise((resolve) => {
        const reader = new FileReader(); reader.readAsDataURL(file);
        reader.onload = (e) => {
            const img = new Image(); img.onload = () => {
                const canvas = document.createElement('canvas'); 
                const MAX = 800; // サーバー負荷軽減
                let w = img.width, h = img.height;
                if (w > MAX || h > MAX) { if (w > h) { h *= MAX / w; w = MAX; } else { w *= MAX / h; h = MAX; } }
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', 0.7).split(',')[1]);
            }; img.src = e.target.result;
        };
    });
}

document.getElementById('hw-input').addEventListener('change', async (e) => {
    if (isAnalyzing || !e.target.files[0]) return;
    isAnalyzing = true;
    
    document.getElementById('upload-controls').classList.add('hidden');
    document.getElementById('thinking-view').classList.remove('hidden');
    document.getElementById('progress-bar').style.width = "0%";
    document.getElementById('progress-percent').innerText = "0";

    updateNellMessage("どれどれ……。じっくり見るにゃ。……", "thinking");

    let progress = 0;
    const timer = setInterval(() => { 
        if (progress < 90) { 
            progress += 3; 
            document.getElementById('progress-bar').style.width = progress + '%';
            document.getElementById('progress-percent').innerText = progress;
        } 
    }, 400);

    try {
        const b64 = await shrinkImage(e.target.files[0]);
        const res = await fetch('/analyze', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: b64, mode: currentMode, grade: currentUser.grade })
        });
        
        if(!res.ok) throw new Error("Google先生が制限エラーだにゃ🐾 1分まってにゃ。");

        const data = await res.json();
        
        // 【重要】データのバリデーション（配列でない場合の対策）
        if (!Array.isArray(data)) throw new Error("AIが答えられなかったにゃ。撮り直してにゃ。");

        transcribedProblems = data.map(pr => {
            let labels = ["【考え方】", "【式の作り方】", "【計算】"];
            let safeHints = ["問題をゆっくり読んでにゃ","言葉の式を書いてみるにゃ","ネル先生と計算にゃ！"];
            if (pr.hints && Array.isArray(pr.hints)) {
                for(let i=0; i<3; i++) if(pr.hints[i]) safeHints[i] = labels[i] + " " + pr.hints[i];
            }
            pr.hints = safeHints;
            return pr;
        });

        clearInterval(timer);
        document.getElementById('progress-bar').style.width = "100%";
        document.getElementById('progress-percent').innerText = "100";

        setTimeout(() => {
            document.getElementById('thinking-view').classList.add('hidden');
            if (currentMode === 'explain') renderProblemSelection(); else showGradingView();
        }, 500);

    } catch (err) {
        clearInterval(timer);
        updateNellMessage(err.message, "thinking");
        document.getElementById('upload-controls').classList.remove('hidden');
        document.getElementById('thinking-view').classList.add('hidden');
    } finally {
        isAnalyzing = false;
        e.target.value = "";
    }
});

// ==========================================
// 📋 表示・レンダリング
// ==========================================
function switchView(id) {
    document.getElementById('problem-selection-view').classList.add('hidden');
    document.getElementById('final-view').classList.add('hidden');
    document.getElementById('grade-sheet-container').classList.add('hidden');
    document.getElementById('hint-detail-container').classList.add('hidden');
    document.getElementById(id).classList.remove('hidden');
}

function renderUserList() {
    const list = document.getElementById('user-list'); if(!list) return;
    list.innerHTML = users.length ? "" : "<p style='text-align:center; opacity:0.6;'>生徒手帳を作ってにゃ</p>";
    users.forEach(user => {
        const div = document.createElement('div'); div.className = "user-card";
        div.innerHTML = `<img src="${user.photo}"><div style="margin-left:15px"><small>${user.grade}年</small><br><strong>${user.name}</strong></div><button class="delete-student-btn" onclick="deleteUser(event, ${user.id})">×</button>`;
        div.onclick = () => login(user); list.appendChild(div);
    });
}

function deleteUser(e, id) { 
    e.stopPropagation(); if(confirm("削除するにゃ？")) { 
        users = users.filter(u => u.id !== id); 
        localStorage.setItem('nekoneko_users', JSON.stringify(users)); renderUserList(); 
    } 
}

function login(user) { 
    currentUser = user; 
    const today = new Date().toISOString().split('T')[0];
    if(!currentUser.attendance) currentUser.attendance = {};
    if(!currentUser.attendance[today]) currentUser.attendance[today] = 'blue';
    document.getElementById('current-student-avatar').src = user.photo; 
    document.getElementById('karikari-count').innerText = user.karikari || 0; 
    switchScreen('screen-lobby'); 
    updateNellMessage(`おかえり、${user.name}さん！……準備はいいかにゃ？`, "happy"); 
}

function selectMode(m) { 
    currentMode = m; switchScreen('screen-main'); 
    const badge = document.getElementById('mode-badge-text');
    if(badge) badge.innerText = (m==='explain'?'教えてモード':'採点モード');
    document.getElementById('upload-controls').classList.remove('hidden');
    document.getElementById('problem-selection-view').classList.add('hidden');
    document.getElementById('final-view').classList.add('hidden');
    document.getElementById('chalkboard').classList.add('hidden');
    updateNellMessage("宿題をみせてにゃ！……ネル先生がんばるにゃ。", "happy"); 
}

function renderProblemSelection() {
    switchView('problem-selection-view');
    const list = document.getElementById('transcribed-problem-list'); list.innerHTML = "";
    transcribedProblems.forEach(p => {
        const div = document.createElement('div'); div.className = "prob-card";
        div.innerHTML = `<div><span class="q-label">${p.label || '?'}</span><span>${p.question}</span></div><button class="main-btn blue-btn" style="width:auto; padding:10px;" onclick="startHint(${p.id})">教えて！</button>`;
        list.appendChild(div);
    });
    updateNellMessage("書き起こしが終わったにゃ！……どの問題をおしえてほしいかにゃ？", "happy");
}

function startHint(id) { 
    selectedProblem = transcribedProblems.find(p => p.id === id); 
    hintIndex = 0; 
    switchView('final-view');
    document.getElementById('hint-detail-container').classList.remove('hidden');
    document.getElementById('chalkboard').innerHTML = selectedProblem.question; 
    document.getElementById('chalkboard').classList.remove('hidden'); 
    document.getElementById('answer-display-area').classList.add('hidden');
    showHintStep(); 
}

function showHintStep() { 
    const h = selectedProblem.hints[hintIndex] || "がんばってにゃ！"; 
    updateNellMessage(h, "thinking"); 
    document.getElementById('hint-step-label').innerText = ["考え方", "式の作り方", "計算"][hintIndex]; 
    const next = document.getElementById('next-hint-btn'); 
    const reveal = document.getElementById('reveal-answer-btn'); 
    const thanks = document.getElementById('thanks-btn');
    if(hintIndex < 2) { next.classList.remove('hidden'); reveal.classList.add('hidden'); thanks.classList.add('hidden'); } 
    else { next.classList.add('hidden'); reveal.classList.remove('hidden'); thanks.classList.remove('hidden'); } 
}

function showNextHint() { hintIndex++; showHintStep(); }

function revealAnswer() { 
    const ans = selectedProblem.correct_answer; 
    document.getElementById('final-answer-text').innerText = ans; 
    document.getElementById('answer-display-area').classList.remove('hidden'); 
    document.getElementById('reveal-answer-btn').classList.add('hidden'); 
    const speechAns = ans.toString().replace(/-/g, 'と');
    updateNellMessage(`こたえは……「${ans}」だにゃ！……よくがんばったにゃ！`, "gentle"); 
}

function backToProblemSelection() { 
    switchView('problem-selection-view');
    document.getElementById('chalkboard').classList.add('hidden'); 
    updateNellMessage("どの問題をおしえてほしいかにゃ？", "happy"); 
}

function showGradingView() { 
    switchView('final-view');
    document.getElementById('grade-sheet-container').classList.remove('hidden');
    renderWorksheet(); 
}

function renderWorksheet() {
    const list = document.getElementById('problem-list-grade'); list.innerHTML = "";
    transcribedProblems.forEach((item, idx) => {
        const div = document.createElement('div'); div.className = "problem-row";
        div.innerHTML = `<div><span class="q-label">${item.label || '?'}</span><span>${item.question}</span></div><input type="text" class="student-ans-input" value="${item.student_answer || ''}" onchange="updateAns(${idx}, this.value)"><div class="${item.status==='correct'?'correct':'incorrect'}">${item.status==='correct'?'⭕️':'❌'}</div>`;
        list.appendChild(div);
    });
    if(transcribedProblems.every(d => d.status==='correct')) document.getElementById('thanks-btn').classList.remove('hidden');
}

function updateAns(idx, val) { 
    const itm = transcribedProblems[idx]; itm.student_answer = val; 
    if (val.trim() === String(itm.correct_answer)) { itm.status = 'correct'; updateNellMessage("正解にゃ！……すごいにゃ！", "happy"); } 
    renderWorksheet(); 
}

function pressThanks() { 
    const today = new Date().toISOString().split('T')[0]; 
    currentUser.karikari = (currentUser.karikari || 0) + 5; 
    currentUser.attendance[today] = 'red'; 
    saveAndSync(); alert("🍖5個ゲット！……またあしたも待ってるにゃ🐾"); backToLobby(); 
}

function saveAndSync() { 
    const idx = users.findIndex(u => u.id === currentUser.id); 
    if (idx !== -1) users[idx] = currentUser; 
    localStorage.setItem('nekoneko_users', JSON.stringify(users)); 
    const el = document.getElementById('karikari-count');
    if(el) el.innerText = currentUser.karikari; 
}

function showAttendance() {
    switchScreen('screen-attendance');
    const grid = document.getElementById('attendance-grid'); grid.innerHTML = "";
    for(let i=0; i<12; i++) {
        const d = new Date(); d.setDate(d.getDate() - i); const dateStr = d.toISOString().split('T')[0];
        const status = currentUser.attendance ? currentUser.attendance[dateStr] : null;
        grid.innerHTML += `<div class="day-box">${d.getDate()}日<br>${status==='red'?'🐾赤':(status==='blue'?'🐾青':'ー')}</div>`;
    }
}

function updateIDPreview() { 
    const g = document.getElementById('preview-grade'); if(g) g.innerText = (document.getElementById('new-student-grade').value || "○") + "年生"; 
    const n = document.getElementById('preview-name'); if(n) n.innerText = document.getElementById('new-student-name').value || "なまえ"; 
}