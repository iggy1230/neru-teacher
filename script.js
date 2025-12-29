let users = JSON.parse(localStorage.getItem('nekoneko_users')) || [];
let currentUser = null; let currentMode = ''; let currentSubject = '';
let transcribedProblems = []; let selectedProblem = null;
let hintIndex = 0; let isAnalyzing = false; let currentAudio = null;
const idBase = new Image(); idBase.src = 'student-id-base.png';
const decoEars = new Image(); decoEars.src = 'ears.png';
const decoMuzzle = new Image(); decoMuzzle.src = 'muzzle.png';
let modelsLoaded = false;

window.onload = () => { renderUserList(); loadFaceModels(); };

function switchScreen(to) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    const target = document.getElementById(to);
    if (target) { target.classList.remove('hidden'); window.scrollTo({ top: 0, behavior: 'instant' }); }
}
function showEnrollment() { switchScreen('screen-enrollment'); }
function backToGate() { currentUser = null; switchScreen('screen-gate'); renderUserList(); }
function backToLobby() { document.getElementById('chalkboard').classList.add('hidden'); switchScreen('screen-lobby'); }

function setSubject(s) {
    currentSubject = s;
    document.getElementById('subject-selection-view').classList.add('hidden');
    document.getElementById('upload-controls').classList.remove('hidden');
    updateNellMessage(`${currentSubject}のしゅくだいをみせてにゃ！`, "happy");
}

async function speakNell(text, mood = "normal") {
    if (!text) return;
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    try {
        const res = await fetch('/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, mood }) });
        const data = await res.json();
        currentAudio = new Audio("data:audio/mp3;base64," + data.audioContent);
        return new Promise(resolve => { currentAudio.onended = resolve; currentAudio.play(); });
    } catch (e) {
        return new Promise(resolve => { const u = new SpeechSynthesisUtterance(text); u.lang = 'ja-JP'; u.onend = resolve; window.speechSynthesis.speak(u); });
    }
}
async function updateNellMessage(t, mood = "normal") {
    document.getElementById('nell-text').innerText = t;
    return await speakNell(t, mood);
}

// Face API & 学生証
async function loadFaceModels() {
    const URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';
    try {
        await faceapi.nets.ssdMobilenetv1.loadFromUri(URL); await faceapi.nets.faceLandmark68Net.loadFromUri(URL);
        modelsLoaded = true; document.getElementById('loading-models').innerText = "準備完了だにゃ！🐾"; document.getElementById('complete-btn').disabled = false;
    } catch (e) { console.error("Face API Error."); }
}

document.getElementById('student-photo-input').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file || !modelsLoaded) return;
    const img = await faceapi.bufferToImage(file);
    const det = await faceapi.detectSingleFace(img).withFaceLandmarks();
    const canvas = document.getElementById('id-photo-preview-canvas');
    const ctx = canvas.getContext('2d');
    const targetW = 94, targetH = 102; ctx.clearRect(0,0,targetW,targetH);
    if (det) {
        const box = det.detection.box; const nose = det.landmarks.getNose()[3];
        const aspect = targetW / targetH; let cropW = box.width * 2.8; let cropH = cropW / aspect;
        let sX = box.x + box.width / 2 - cropW / 2; let sY = box.y + box.height / 2 - cropH * 0.45;
        ctx.drawImage(img, sX, sY, cropW, cropH, 0, 0, targetW, targetH);
        const scale = targetW / cropW; 
        const nX = (nose.x - sX) * scale; const nY = (nose.y - sY) * scale; 
        const headTopY = (box.y - sY) * scale;
        const earW = targetW * 1.0;
        ctx.drawImage(decoEars, (targetW - earW)/2, headTopY - (earW * 0.45), earW, earW);
        ctx.drawImage(decoMuzzle, nX-(targetW*0.65)/2, nY-(targetW*0.65)/3.5, targetW*0.65, targetW*0.65 * 0.8);
        ctx.strokeStyle = '#333'; ctx.lineWidth = 1.2;
        for(let i=-1; i<=1; i++) {
            ctx.beginPath(); ctx.moveTo(nX - 10, nY + 10 + i*5); ctx.lineTo(nX - 45, nY + 5 + i*12); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(nX + 10, nY + 10 + i*5); ctx.lineTo(nX + 45, nY + 5 + i*12); ctx.stroke();
        }
    } else { ctx.drawImage(img, 0,0, img.width, img.height, 0,0, targetW, targetH); }
});

function processAndCompleteEnrollment() {
    const name = document.getElementById('new-student-name').value;
    const grade = document.getElementById('new-student-grade').value;
    if(!name || !grade) return alert("お名前と学年を入れてにゃ！");
    const canvas = document.getElementById('deco-canvas'); canvas.width=800; canvas.height=800;
    const ctx = canvas.getContext('2d'); ctx.drawImage(idBase, 0, 0, 800, 800);
    const pCanvas = document.getElementById('id-photo-preview-canvas');
    ctx.drawImage(pCanvas, 21*2.5, 133*2.5, 94*2.5, 102*2.5);
    ctx.fillStyle="#333"; ctx.font="bold 42px 'M PLUS Rounded 1c'"; 
    ctx.fillText(grade+"年生", 190*2.5, 137*2.5+32); 
    ctx.fillText(name, 190*2.5, 177*2.5+42);
    const newUser = { id: Date.now(), name, grade, photo: canvas.toDataURL(), karikari: 0, attendance: {} };
    users.push(newUser); localStorage.setItem('nekoneko_users', JSON.stringify(users)); login(newUser);
}

// ％表示ロジック
function updateProgress(p) {
    const bar = document.getElementById('progress-bar');
    if (bar) bar.style.width = p + '%'; // ゲージを動かす
    const txt = document.getElementById('progress-percent');
    if (txt) txt.innerText = Math.floor(p);
}

async function shrinkImage(file) {
    return new Promise((resolve) => {
        const reader = new FileReader(); reader.readAsDataURL(file);
        reader.onload = (e) => {
            const img = new Image(); img.onload = () => {
                const canvas = document.createElement('canvas'); const MAX = 1600;
                let w = img.width, h = img.height;
                if (w > MAX || h > MAX) { if (w > h) { h *= MAX / w; w = MAX; } else { w *= MAX / h; h = MAX; } }
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', 0.9).split(',')[1]);
            }; img.src = e.target.result;
        };
    });
}

document.getElementById('hw-input').addEventListener('change', async (e) => {
    if (isAnalyzing || !e.target.files[0]) return;
    isAnalyzing = true;
    document.getElementById('upload-controls').classList.add('hidden');
    document.getElementById('thinking-view').classList.remove('hidden');
    document.getElementById('problem-selection-view').classList.add('hidden');
    updateProgress(0); 
    updateNellMessage("どれどれ……ネル先生がじっくり見てあげるにゃ。……", "thinking");

    let p = 0; 
    const pTimer = setInterval(() => { if (p < 90) { p += 3; updateProgress(p); } }, 500);

    try {
        const b64 = await shrinkImage(e.target.files[0]);
        const res = await fetch('/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: b64, mode: currentMode, grade: currentUser.grade, subject: currentSubject }) });
        transcribedProblems = await res.json();
        clearInterval(pTimer); 
        updateProgress(100);
        
        setTimeout(() => {
            document.getElementById('thinking-view').classList.add('hidden');
            if (transcribedProblems.length > 0) { if (currentMode === 'explain') renderProblemSelection(); else showGradingView(); }
        }, 800);
    } catch (err) { updateNellMessage("制限エラーだにゃ🐾"); document.getElementById('upload-controls').classList.remove('hidden');
    } finally { isAnalyzing = false; }
});

function renderUserList() {
    const list = document.getElementById('user-list'); if(!list) return;
    list.innerHTML = users.length ? "" : "<p style='text-align:right; font-size:0.75rem; opacity:0.5;'>入学してにゃ</p>";
    users.forEach(user => {
        const div = document.createElement('div'); div.className = "user-card";
        div.innerHTML = `<img src="${user.photo}"><div class="user-card-info">${user.grade}年生 ${user.name}</div><button class="delete-student-btn" onclick="deleteUser(event, ${user.id})">×</button>`;
        div.onclick = () => login(user); list.appendChild(div);
    });
}
function deleteUser(e, id) { e.stopPropagation(); if(confirm("削除する？")) { users = users.filter(u => u.id !== id); localStorage.setItem('nekoneko_users', JSON.stringify(users)); renderUserList(); } }
function login(user) { currentUser = user; transcribedProblems = []; document.getElementById('current-student-avatar').src = user.photo; document.getElementById('karikari-count').innerText = user.karikari || 0; switchScreen('screen-lobby'); updateNellMessage(`おかえり、${user.name}さん！`, "happy"); }
function selectMode(m) { currentMode = m; switchScreen('screen-main'); document.getElementById('subject-selection-view').classList.remove('hidden'); }

function renderProblemSelection() {
    document.getElementById('problem-selection-view').classList.remove('hidden');
    const list = document.getElementById('transcribed-problem-list'); list.innerHTML = "";
    transcribedProblems.forEach(p => {
        const div = document.createElement('div'); div.className = "prob-card";
        div.innerHTML = `<div><span class="q-label">${p.label || '?'}</span><span>${p.question.substring(0,25)}...</span></div><button class="main-btn blue-btn" style="width:auto; padding:10px;" onclick="startHint(${p.id})">教えて！</button>`;
        list.appendChild(div);
    });
}
function startHint(id) { selectedProblem = transcribedProblems.find(p => p.id === id); hintIndex = 0; switchView('final-view'); document.getElementById('hint-detail-container').classList.remove('hidden'); document.getElementById('chalkboard').innerHTML = (selectedProblem.label || "") + " " + selectedProblem.question; document.getElementById('chalkboard').classList.remove('hidden'); document.getElementById('answer-display-area').classList.add('hidden'); showHintStep(); }
function showHintStep() {
    const labels = ["考え方", "式の作り方", "計算"]; document.getElementById('hint-step-label').innerText = labels[hintIndex];
    updateNellMessage(selectedProblem.hints[hintIndex], "thinking");
    const next = document.getElementById('next-hint-btn'); const reveal = document.getElementById('reveal-answer-btn');
    if(hintIndex < 2) { next.classList.remove('hidden'); reveal.classList.add('hidden'); } else { next.classList.add('hidden'); reveal.classList.remove('hidden'); }
}
function showNextHint() { hintIndex++; showHintStep(); }
function revealAnswer() { const ans = selectedProblem.correct_answer; document.getElementById('final-answer-text').innerText = ans; document.getElementById('answer-display-area').classList.remove('hidden'); document.getElementById('reveal-answer-btn').classList.add('hidden'); updateNellMessage(`答えは……「${ans}」だにゃ！`, "gentle"); }
async function pressThanks() { await updateNellMessage("よくがんばったにゃ！えらいにゃ〜！", "happy"); backToProblemSelection(); }

async function pressAllSolved() {
    await updateNellMessage("宿題ぜんぶ終わったにゃ！すごすぎるにゃ🐾ご褒美のカリカリをあげるにゃ！", "excited");
    currentUser.karikari += 10;
    const today = new Date().toISOString().split('T')[0];
    if(!currentUser.attendance) currentUser.attendance = {};
    currentUser.attendance[today] = 'red';
    saveAndSync();
    backToLobby();
}

function backToProblemSelection() { document.getElementById('final-view').classList.add('hidden'); document.getElementById('problem-selection-view').classList.remove('hidden'); document.getElementById('chalkboard').classList.add('hidden'); }
function showGradingView() { switchView('final-view'); document.getElementById('grade-sheet-container').classList.remove('hidden'); renderWorksheet(); }
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