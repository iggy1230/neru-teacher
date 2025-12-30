let users = JSON.parse(localStorage.getItem('nekoneko_users')) || [];
let currentUser = null;
let modelsLoaded = false;
const idBase = new Image(); idBase.src = 'student-id-base.png';
const decoEars = new Image(); decoEars.src = 'ears.png';
const decoMuzzle = new Image(); decoMuzzle.src = 'muzzle.png';

loadFaceModels

function renderUserList() {
    const list = document.getElementById('user-list');
    if(!list) return;
    list.innerHTML = users.length ? "" : "<p style='text-align:right; font-size:0.75rem; opacity:0.5;'>入学してにゃ</p>";
    users.forEach(user => {
        const div = document.createElement('div');
        div.className = "user-card";
        div.innerHTML = `<img src="${user.photo}"><button class="delete-student-btn" onclick="deleteUser(event, ${user.id})">×</button>`;
        div.onclick = () => login(user);
        list.appendChild(div);
    });
}

function login(user) {
    currentUser = user;
    transcribedProblems = [];
    if (!currentUser.history) currentUser.history = {};
    if (!currentUser.mistakes) currentUser.mistakes = [];

    document.getElementById('current-student-avatar').src = user.photo;
    document.getElementById('karikari-count').innerText = user.karikari || 0;
    
    switchScreen('screen-lobby');
    updateNellMessage(getNellGreeting(user), "happy");
}

function getNellGreeting(user) {
    if (!user.history || Object.keys(user.history).length === 0) return `はじめまして、${user.name}さん！🐾`;
    let favorite = Object.keys(user.history).reduce((a, b) => user.history[a] > user.history[b] ? a : b);
    if (user.mistakes && user.mistakes.length > 0) return `おかえり！${user.name}さん。復習もしようにゃ！`;
    return `おかえり！${user.name}さん。今日も「${favorite}」がんばる？`;
}

function deleteUser(e, id) { e.stopPropagation(); if(confirm("削除する？")) { users = users.filter(u => u.id !== id); localStorage.setItem('nekoneko_users', JSON.stringify(users)); renderUserList(); } }

async function processAndCompleteEnrollment() {
    const name = document.getElementById('new-student-name').value;
    const grade = document.getElementById('new-student-grade').value;
    if(!name || !grade) return alert("お名前と学年を入れてにゃ！");
    const canvas = document.getElementById('deco-canvas'); canvas.width=800; canvas.height=800;
    const ctx = canvas.getContext('2d'); ctx.drawImage(idBase, 0, 0, 800, 800);
    const pCanvas = document.getElementById('id-photo-preview-canvas');
    ctx.drawImage(pCanvas, 21*2.5, 133*2.5, 94*2.5, 102*2.5);
    ctx.fillStyle="#333"; ctx.font="bold 42px 'M PLUS Rounded 1c'"; 
    ctx.fillText(grade+"年生", 190*2.5, 137*2.5+32); ctx.fillText(name, 190*2.5, 177*2.5+42);
    users.push({ id: Date.now(), name, grade, photo: canvas.toDataURL(), karikari: 100, history: {}, mistakes: [], attendance: {} });
    localStorage.setItem('nekoneko_users', JSON.stringify(users)); renderUserList(); switchScreen('screen-gate');
}

function saveAndSync() {
    const idx = users.findIndex(u => u.id === currentUser.id);
    if (idx !== -1) users[idx] = currentUser;
    localStorage.setItem('nekoneko_users', JSON.stringify(users));
    document.getElementById('karikari-count').innerText = currentUser.karikari;
}

function updateIDPreview() { 
    document.getElementById('preview-name').innerText = document.getElementById('new-student-name').value || "なまえ";
    document.getElementById('preview-grade').innerText = (document.getElementById('new-student-grade').value || "○") + "年生";
}

// --- user.js の末尾に追加 ---

// 学生証の写真選択処理
const photoInput = document.getElementById('student-photo-input');
if (photoInput) {
    photoInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.getElementById('id-photo-preview-canvas');
                const ctx = canvas.getContext('2d');
                // キャンバスサイズに合わせて正方形にトリミングして描画
                const size = Math.min(img.width, img.height);
                const sx = (img.width - size) / 2;
                const sy = (img.height - size) / 2;
                
                // 一旦クリアしてから描画
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, sx, sy, size, size, 0, 0, canvas.width, canvas.height);
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    });
}