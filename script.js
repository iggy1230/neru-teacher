// ==========================================
// 🐾 猫後市立ねこづか小学校：フロントエンド完全版
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
// 🚀 画面を切り替える大事な命令 (switchScreen)
// ==========================================
function switchScreen(to) {
    console.log("画面を切り替えるにゃ：" + to);
    // すべてのスクリーンを隠す
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    // 行きたいスクリーンだけ表示する
    const target = document.getElementById(to);
    if (target) {
        target.classList.remove('hidden');
        window.scrollTo(0, 0); // 画面の一番上に戻すにゃ
    } else {
        console.error("エラー：ID '" + to + "' の画面が見つからないにゃ！");
    }
}

// ボタンから呼ばれるショートカット命令
function showEnrollment() { switchScreen('screen-enrollment'); }
function backToGate() { currentUser = null; switchScreen('screen-gate'); renderUserList(); }
function backToLobby() { switchScreen('screen-lobby'); }

// ==========================================
// 🔊 音声合成 (Google Cloud TTS 連携)
// ==========================================
async function speakNell(text, mood = "normal") {
    if (!text || text === "undefined") return;
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    try {
        const res = await fetch('/synthesize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, mood })
        });
        const data = await res.json();
        currentAudio = new Audio("data:audio/mp3;base64," + data.audioContent);
        await currentAudio.play();
    } catch (e) {
        console.warn("TTSエラー：標準音声を使いますにゃ");
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
        document.getElementById('loading-models').innerText = "ネル先生の準備OKだにゃ！🐾";
        document.getElementById('complete-btn').disabled = false;
    } catch (e) { console.error("Face API Error."); }
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
    if(!name || !grade) return alert("全部いれてにゃ！");
    const canvas = document.getElementById('deco-canvas'); canvas.width=800; canvas.height=800;
    const ctx = canvas.getContext('2d'); ctx.drawImage(idBase, 0, 0, 800, 800);
    const pCanvas = document.getElementById('id-photo-preview-canvas');
    ctx.drawImage(pCanvas, 21*2.5, 133*2.5, 94*2.5, 102*2.5);
    ctx.fillStyle="#333"; ctx.font="bold 42px Kiwi Maru"; ctx.fillText(grade+"年生", 190*2.5, 136*2.5+32); ctx.fillText(name, 190*2.5, 175*2.5+42);
    const newUser = { id: Date.now(), name, grade, photo: canvas.toDataURL(), karikari: 0, attendance: {} };
    users.push(newUser); localStorage.setItem('nekoneko_users', JSON.stringify(users)); login(newUser);
}

// ==========================================
// 🤖 解析ロジック
// ==========================================
async function shrinkImage(file) {
    return new Promise((resolve) => {
        const reader = new FileReader(); reader.readAsDataURL(file);
        reader.onload = (e) => {
            const img = new Image(); img.onload = () => {
                const canvas = document.createElement('canvas'); const MAX = 800;
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
    let p = 0; const pBar = document.getElementById('progress-bar');
    const timer = setInterval(() => { if (p < 90) { p += 3; if(pBar) pBar.style.width = p+'%'; document.getElementById('progress-percent').innerText = p; } }, 400);

    try {
        updateNellMessage("どれどれ……。じっくり見るにゃ。……", "thinking");
        const b64 = await shrinkImage(e.target.files[0]);
        const res = await fetch('/analyze', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: b64, mode: currentMode, grade: currentUser.grade })
        });
        const data = await res.json();
        transcribedProblems = data.map(pr => {
            if(!pr.hints || pr.hints.length < 3) pr.hints = ["考えてにゃ","式に注目にゃ","計算してにゃ"];
            return pr;
        });
        clearInterval(timer); document.getElementById('progress-bar').style.width = '100%'; document.getElementById('progress-percent').innerText = '100';
        setTimeout(() => {
            document.getElementById('thinking-view').classList.add('hidden');
            if (currentMode === 'explain') renderProblemSelection(); else showGradingView();
        }, 500);
    } catch (err) { updateNellMessage("エラーだにゃ🐾 1分まってにゃ。"); document.getElementById('upload-controls').classList.remove('hidden');
    } finally { isAnalyzing = false; }
});

// ==========================================
// 📋 表示ロジック
// ==========================================
function renderUserList() {
    const list = document.getElementById('user-list'); if(!list) return;
    list.innerHTML = users.length ? "" : "<p style='text-align:center'>名簿が空だにゃ</p>";
    users.forEach(user => {
        const div = document.createElement('div'); div.className = "user-card";
        div.innerHTML = `<img src="${user.photo}"><div style="margin-left:15px"><small>${user.grade}年</small><br><strong>${user.name}</strong></div><button class="delete-student-btn" onclick="deleteUser(event, ${user.id})">×</button>`;
        div.onclick = () => login(user); list.appendChild(div);
    });
}

function deleteUser(e, id) {
    e.stopPropagation(); if(confirm("削除するにゃ？")) { users = users.filter(u => u.id !== id); localStorage.setItem('nekoneko_users', JSON.stringify(users)); renderUserList(); }
}

function login(user) {
    currentUser = user;
    const today = new Date().toISOString().split('T')[0];
    if(!currentUser.attendance) currentUser.attendance = {};
    if(!currentUser.attendance[today]) currentUser.attendance[today] = 'blue';
    document.getElementById('current-student-avatar').src = user.photo;
    document.getElementById('karikari-count').innerText = user.karikari || 0;
    switchScreen('screen-lobby'); // ここでエラーが出てたのを修正したにゃ！
    updateNellMessage(`おかえり、${user.name}さん！`, "happy");
}

function selectMode(m) { 
    currentMode = m; switchScreen('screen-main'); 
    document.getElementById('mode-badge-text').innerText = (m==='explain'?'教えてモード':'採点モード');
    document.getElementById('upload-controls').classList.remove('hidden');
    document.getElementById('problem-selection-view').classList.add('hidden');
    document.getElementById('final-view').classList.add('hidden');
    document.getElementById('chalkboard').classList.add('hidden');
    updateNellMessage("宿題をみせてにゃ！", "happy"); 
}

function renderProblemSelection() {
    document.getElementById('problem-selection-view').classList.remove('hidden');
    const list = document.getElementById('transcribed-problem-list'); list.innerHTML = "";
    transcribedProblems.forEach(p => {
        const div = document.createElement('div'); div.className = "prob-card";
        div.innerHTML = `<div><span class="q-label">${p.label || '?'}</span><span>${p.question}</span></div><button class="main-btn blue-btn" style="width:auto; padding:10px;" onclick="startHint(${p.id})">教えて！</button>`;
        list.appendChild(div);
    });
    updateNellMessage("どの問題をおしえてほしいかにゃ？", "happy");
}

function startHint(id) {
    selectedProblem = transcribedProblems.find(p => p.id === id); hintIndex = 0;
    document.getElementById('problem-selection-view').classList.add('hidden');
    document.getElementById('final-view').classList.remove('hidden');
    document.getElementById('grade-sheet-container').classList.add('hidden');
    document.getElementById('hint-detail-container').classList.remove('hidden');
    document.getElementById('chalkboard').innerHTML = selectedProblem.question;
    document.getElementById('chalkboard').classList.remove('hidden');
    document.getElementById('answer-display-area').classList.add('hidden');
    showHintStep();
}

function showHintStep() {
    const h = selectedProblem.hints[hintIndex]; updateNellMessage(h, "thinking");
    document.getElementById('hint-step-label').innerText = ["考え方", "式の作り方", "計算"][hintIndex];
    const next = document.getElementById('next-hint-btn'); const reveal = document.getElementById('reveal-answer-btn');
    if(hintIndex < 2) { next.classList.remove('hidden'); reveal.classList.add('hidden'); } else { next.classList.add('hidden'); reveal.classList.remove('hidden'); }
}

function showNextHint() { hintIndex++; showHintStep(); }

function revealAnswer() { 
    const ans = selectedProblem.correct_answer; document.getElementById('final-answer-text').innerText = ans; document.getElementById('answer-display-area').classList.remove('hidden'); document.getElementById('reveal-answer-btn').classList.add('hidden'); document.getElementById('thanks-btn').classList.remove('hidden'); 
    updateNellMessage(`答えは……「${ans}」だにゃ！`, "gentle"); 
}

function showGradingView() {
    document.getElementById('final-view').classList.remove('hidden');
    document.getElementById('grade-sheet-container').classList.remove('hidden');
    document.getElementById('hint-detail-container').classList.add('hidden');
    renderWorksheet();
}

function renderWorksheet() {
    const list = document.getElementById('problem-list-grade'); list.innerHTML = "";
    transcribedProblems.forEach((item, idx) => {
        const div = document.createElement('div'); div.className = "problem-row";
        div.innerHTML = `<div><span class="q-label">${item.label || '?'}</span><span>${item.question}</span></div><input type="text" class="student-ans-input" value="${item.student_answer || ''}" onchange="updateAns(${idx}, this.value)"><div class="${item.status==='correct'?'correct':'incorrect'}">${item.status==='correct'?'⭕️':'❌'}</div>`;
        list.appendChild(div);
    });
}

function updateAns(idx, val) { const itm = transcribedProblems[idx]; itm.student_answer = val; if (val.trim() === String(itm.correct_answer)) { itm.status = 'correct'; updateNellMessage("正解にゃ！", "happy"); } renderWorksheet(); }
function pressThanks() { const today = new Date().toISOString().split('T')[0]; currentUser.attendance[today] = 'red'; currentUser.karikari += 5; saveAndSync(); switchScreen('screen-lobby'); }
function saveAndSync() { const idx = users.findIndex(u => u.id === currentUser.id); if (idx !== -1) users[idx] = currentUser; localStorage.setItem('nekoneko_users', JSON.stringify(users)); document.getElementById('karikari-count').innerText = currentUser.karikari; }
function updateIDPreview() { document.getElementById('preview-name').innerText = document.getElementById('new-student-name').value || "なまえ"; document.getElementById('preview-grade').innerText = (document.getElementById('new-student-grade').value || "○") + "年生"; }

function showAttendance() {
    switchScreen('screen-attendance');
    const grid = document.getElementById('attendance-grid'); grid.innerHTML = "";
    for(let i=0; i<12; i++) {
        const d = new Date(); d.setDate(d.getDate() - i); const dateStr = d.toISOString().split('T')[0];
        const status = currentUser.attendance ? currentUser.attendance[dateStr] : null;
        grid.innerHTML += `<div class="day-box">${d.getDate()}日<br>${status==='red'?'🐾赤':(status==='blue'?'🐾青':'ー')}</div>`;
    }
}