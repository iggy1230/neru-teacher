let users = JSON.parse(localStorage.getItem('nekoneko_users')) || [];
let currentUser = null; let currentMode = ''; let transcribedProblems = []; let selectedProblem = null;
let hintIndex = 0; let isAnalyzing = false; let currentAudio = null;
const idBase = new Image(); idBase.src = 'student-id-base.png';
const decoEars = new Image(); decoEars.src = 'ears.png';
const decoMuzzle = new Image(); decoMuzzle.src = 'muzzle.png';
let modelsLoaded = false;

window.onload = () => { renderUserList(); loadFaceModels(); };

// --- 画面管理 ---
function switchScreen(to) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    const target = document.getElementById(to);
    if (target) { target.classList.remove('hidden'); window.scrollTo(0, 0); }
}
function showEnrollment() { switchScreen('screen-enrollment'); }
function backToGate() { currentUser = null; switchScreen('screen-gate'); renderUserList(); }
function backToLobby() { switchScreen('screen-lobby'); }

// --- 高品質音声合成 ---
async function speakNell(text, mood = "normal") {
    if (!text) return;
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    try {
        const res = await fetch('http://localhost:3000/synthesize', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, mood })
        });
        const data = await res.json();
        currentAudio = new Audio("data:audio/mp3;base64," + data.audioContent);
        // 音声の終了を待機できるプロミスを作成にゃ
        return new Promise(resolve => {
            currentAudio.onended = resolve;
            currentAudio.play();
        });
    } catch (e) {
        return new Promise(resolve => {
            const u = new SpeechSynthesisUtterance(text); u.lang = 'ja-JP';
            u.onend = resolve;
            window.speechSynthesis.speak(u);
        });
    }
}
async function updateNellMessage(t, mood = "normal") {
    document.getElementById('nell-text').innerText = t;
    await speakNell(t, mood);
}

// --- Face API & 学生証合成 ---
async function loadFaceModels() {
    const URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';
    try {
        await faceapi.nets.ssdMobilenetv1.loadFromUri(URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(URL);
        modelsLoaded = true;
        document.getElementById('loading-models').innerText = "準備OKにゃ！🐾";
        document.getElementById('complete-btn').disabled = false;
    } catch (e) { console.error("Face API Error"); }
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
        const scale = targetW / cropW; 
        const nX = (nose.x - sX) * scale; const nY = (nose.y - sY) * scale; 
        const fY = (box.y - sY) * scale; // 顔のてっぺん
        
        // 猫耳の位置調整（fYからさらにおでこの上へ）
        const earW = targetW * 0.9;
        ctx.drawImage(decoEars, (targetW - earW)/2, fY - (earW * 0.4), earW, earW);
        ctx.drawImage(decoMuzzle, nX-(targetW*0.6)/2, nY-(targetW*0.6)/3, targetW*0.6, targetW*0.6*0.8);
    } else { ctx.drawImage(img, 0,0, img.width, img.height, 0,0, targetW, targetH); }
});

function processAndCompleteEnrollment() {
    const name = document.getElementById('new-student-name').value;
    const grade = document.getElementById('new-student-grade').value;
    if(!name || !grade) return alert("全部入れてにゃ！");
    const canvas = document.getElementById('deco-canvas'); canvas.width=800; canvas.height=800;
    const ctx = canvas.getContext('2d'); ctx.drawImage(idBase, 0, 0, 800, 800);
    const pCanvas = document.getElementById('id-photo-preview-canvas');
    ctx.drawImage(pCanvas, 21*2.5, 133*2.5, 94*2.5, 102*2.5);
    ctx.fillStyle="#333"; ctx.font="bold 42px Kiwi Maru"; ctx.fillText(grade+"年生", 190*2.5, 136*2.5+32); ctx.fillText(name, 190*2.5, 175*2.5+42);
    const newUser = { id: Date.now(), name, grade, photo: canvas.toDataURL(), karikari: 0, attendance: {} };
    users.push(newUser); localStorage.setItem('nekoneko_users', JSON.stringify(users)); login(newUser);
}

// --- 解析ロジック ---
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
    document.getElementById('progress-bar').style.width = "0%";
    let p = 0; const pBar = document.getElementById('progress-bar'); const pTxt = document.getElementById('progress-percent');
    const timer = setInterval(() => { if (p < 90) { p += 4; pBar.style.width = p+'%'; pTxt.innerText = p; } }, 500);

    try {
        updateNellMessage("どれどれ……。じっくり見るにゃ。……", "thinking");
        const b64 = await shrinkImage(e.target.files[0]);
        const res = await fetch('http://localhost:3000/analyze', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: b64, mode: currentMode, grade: currentUser.grade })
        });
        transcribedProblems = await res.json();
        clearInterval(timer); pBar.style.width = '100%'; pTxt.innerText = '100';
        setTimeout(() => {
            document.getElementById('thinking-view').classList.add('hidden');
            if (currentMode === 'explain') renderProblemSelection(); else showGradingView();
        }, 500);
    } catch (err) { updateNellMessage("制限エラーだにゃ🐾"); document.getElementById('upload-controls').classList.remove('hidden');
    } finally { isAnalyzing = false; }
});

// --- UIレンダリング ---
function renderUserList() {
    const list = document.getElementById('user-list'); if(!list) return;
    list.innerHTML = users.length ? "" : "<p style='text-align:right'>生徒手帳を作ってにゃ</p>";
    users.forEach(user => {
        const div = document.createElement('div'); div.className = "user-card";
        div.innerHTML = `<img src="${user.photo}"><button class="delete-student-btn" onclick="deleteUser(event, ${user.id})">×</button>`;
        div.onclick = () => login(user); list.appendChild(div);
    });
}
function deleteUser(e, id) { e.stopPropagation(); if(confirm("削除する？")) { users = users.filter(u => u.id !== id); localStorage.setItem('nekoneko_users', JSON.stringify(users)); renderUserList(); } }
function login(user) { currentUser = user; document.getElementById('current-student-avatar').src = user.photo; document.getElementById('karikari-count').innerText = user.karikari || 0; switchScreen('screen-lobby'); updateNellMessage(`おかえり、${user.name}さん！`, "happy"); }
function selectMode(m) { currentMode = m; switchScreen('screen-main'); document.getElementById('mode-badge-text').innerText = (m==='explain'?'教えてモード':'採点モード'); updateNellMessage("宿題をみせてにゃ！", "happy"); }

function renderProblemSelection() {
    document.getElementById('problem-selection-view').classList.remove('hidden');
    const list = document.getElementById('transcribed-problem-list'); list.innerHTML = "";
    transcribedProblems.forEach(p => {
        const div = document.createElement('div'); div.className = "prob-card";
        div.innerHTML = `<div class="q-label">${p.label || '?'}</div><span>${p.question}</span><button class="main-btn blue-btn" style="width:auto; padding:10px;" onclick="startHint(${p.id})">教えて！</button>`;
        list.appendChild(div);
    });
    updateNellMessage("どの問題をおしえてほしいかにゃ？", "happy");
}

function startHint(id) { selectedProblem = transcribedProblems.find(p => p.id === id); hintIndex = 0; switchView('hint-detail-container'); document.getElementById('chalkboard').innerHTML = selectedProblem.question; document.getElementById('chalkboard').classList.remove('hidden'); showHintStep(); }
function showHintStep() {
    const labels = ["考え方", "式の作り方", "計算"];
    document.getElementById('hint-step-label').innerText = labels[hintIndex];
    updateNellMessage(selectedProblem.hints[hintIndex], "thinking");
    const next = document.getElementById('next-hint-btn'); const reveal = document.getElementById('reveal-answer-btn');
    if(hintIndex < 2) { next.classList.remove('hidden'); reveal.classList.add('hidden'); } else { next.classList.add('hidden'); reveal.classList.remove('hidden'); }
}
function showNextHint() { hintIndex++; showHintStep(); }
function revealAnswer() { 
    const ans = selectedProblem.correct_answer; document.getElementById('final-answer-text').innerText = ans; document.getElementById('answer-display-area').classList.remove('hidden'); document.getElementById('reveal-answer-btn').classList.add('hidden'); document.getElementById('thanks-btn').classList.remove('hidden'); 
    updateNellMessage(`答えは……「${ans}」だにゃ！`, "gentle"); 
}

// ありがとうボタン：ブツ切り防止に await を使うにゃ
async function pressThanks() {
    const praiseMsgs = ["すごいにゃ！納得（なっとく）できたにゃ？", "その調子だにゃ！えらいにゃ〜！", "ネル先生も嬉しいにゃ！"];
    const msg = praiseMsgs[Math.floor(Math.random() * praiseMsgs.length)];
    
    // 褒め言葉を最後まで喋らせるにゃ
    await updateNellMessage(msg, "happy");
    
    // 喋り終わったら戻るにゃ
    backToProblemSelection();
}

function backToProblemSelection() { document.getElementById('final-view').classList.add('hidden'); document.getElementById('problem-selection-view').classList.remove('hidden'); document.getElementById('chalkboard').classList.add('hidden'); updateNellMessage("どの問題をおしえてほしいかにゃ？", "happy"); }
function showGradingView() { switchView('grade-sheet-container'); renderWorksheet(); }
function renderWorksheet() {
    const list = document.getElementById('problem-list-grade'); list.innerHTML = "";
    transcribedProblems.forEach((item, idx) => {
        const div = document.createElement('div'); div.className = "problem-row";
        div.innerHTML = `<div><span class="q-label">${item.label || '?'}</span><span>${item.question}</span></div><input type="text" class="student-ans-input" value="${item.student_answer || ''}" onchange="updateAns(${idx}, this.value)"><div class="${item.status==='correct'?'correct':'incorrect'}">${item.status==='correct'?'⭕️':'❌'}</div>`;
        list.appendChild(div);
    });
}
function updateAns(idx, val) { const itm = transcribedProblems[idx]; itm.student_answer = val; if (val.trim() === String(itm.correct_answer)) { itm.status = 'correct'; updateNellMessage("正解にゃ！", "happy"); } renderWorksheet(); }
function switchView(id) { document.getElementById('problem-selection-view').classList.add('hidden'); document.getElementById('final-view').classList.remove('hidden'); document.getElementById('grade-sheet-container').classList.add('hidden'); document.getElementById('hint-detail-container').classList.add('hidden'); document.getElementById(id).classList.remove('hidden'); }
function saveAndSync() { const idx = users.findIndex(u => u.id === currentUser.id); if (idx !== -1) users[idx] = currentUser; localStorage.setItem('nekoneko_users', JSON.stringify(users)); document.getElementById('karikari-count').innerText = currentUser.karikari; }
function updateIDPreview() { document.getElementById('preview-name').innerText = document.getElementById('new-student-name').value || "なまえ"; document.getElementById('preview-grade').innerText = (document.getElementById('new-student-grade').value || "○") + "年生"; }