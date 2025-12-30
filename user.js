// --- user.js 完全版 ---

// 1. データと画像の準備
let users = JSON.parse(localStorage.getItem('nekoneko_users')) || [];
let currentUser = null;

// 学生証の台紙画像を読み込む
const idBase = new Image();
idBase.src = 'student-id-base.png';

// デコレーション用の画像（現在は使っていませんがエラー防止のため残します）
const decoEars = new Image(); decoEars.src = 'ears.png';
const decoMuzzle = new Image(); decoMuzzle.src = 'muzzle.png';


// 2. 初期化と読み込み処理
// 画面ロード時にユーザーリストを表示
document.addEventListener('DOMContentLoaded', () => {
    renderUserList();
});

// 入学画面が開かれたときに呼ばれる関数
// (以前はAIを読み込んでいましたが、今は即座にボタンを有効化します)
async function loadFaceModels() {
    const btn = document.getElementById('complete-btn');
    const status = document.getElementById('loading-models');
    
    if (btn) btn.disabled = false; // ボタンをすぐに押せるようにする
    if (status) status.innerText = ""; // 読み込みメッセージを消す
    
    console.log("入学準備完了にゃ！");
}


// 3. 写真選択時のプレビュー処理
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
                if (!canvas) return;
                
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


// 4. ユーザーリスト表示・ログイン・削除
function renderUserList() {
    const list = document.getElementById('user-list');
    if(!list) return;
    
    list.innerHTML = users.length ? "" : "<p style='text-align:right; font-size:0.75rem; opacity:0.5;'>入学してにゃ</p>";
    
    users.forEach(user => {
        const div = document.createElement('div');
        div.className = "user-card";
        div.innerHTML = `
            <img src="${user.photo}">
            <button class="delete-student-btn" onclick="deleteUser(event, ${user.id})">×</button>
        `;
        div.onclick = () => login(user);
        list.appendChild(div);
    });
}

function login(user) {
    currentUser = user;
    // グローバル変数の初期化（anlyze.jsで使用）
    if (typeof transcribedProblems !== 'undefined') transcribedProblems = [];
    
    // データ補正
    if (!currentUser.history) currentUser.history = {};
    if (!currentUser.mistakes) currentUser.mistakes = [];
    if (!currentUser.attendance) currentUser.attendance = {};

    // 画面更新
    const avatar = document.getElementById('current-student-avatar');
    if (avatar) avatar.src = user.photo;
    
    const karikari = document.getElementById('karikari-count');
    if (karikari) karikari.innerText = user.karikari || 0;
    
    switchScreen('screen-lobby');
    updateNellMessage(getNellGreeting(user), "happy");
}

function getNellGreeting(user) {
    if (!user.history || Object.keys(user.history).length === 0) return `はじめまして、${user.name}さん！🐾`;
    
    let favorite = Object.keys(user.history).reduce((a, b) => user.history[a] > user.history[b] ? a : b, "");
    
    if (user.mistakes && user.mistakes.length > 0) return `おかえり！${user.name}さん。復習もしようにゃ！`;
    if (favorite) return `おかえり！${user.name}さん。今日も「${favorite}」がんばる？`;
    return `おかえり！${user.name}さん！`;
}

function deleteUser(e, id) { 
    e.stopPropagation(); 
    if(confirm("削除する？")) { 
        users = users.filter(u => u.id !== id); 
        localStorage.setItem('nekoneko_users', JSON.stringify(users)); 
        renderUserList(); 
    } 
}


// 5. 入学処理（学生証作成）
async function processAndCompleteEnrollment() {
    const name = document.getElementById('new-student-name').value;
    const grade = document.getElementById('new-student-grade').value;
    
    if(!name || !grade) return alert("お名前と学年を入れてにゃ！");

    // 台紙画像の読み込み完了を待つ
    if (!idBase.complete || idBase.naturalWidth === 0) {
        await new Promise((resolve) => { idBase.onload = resolve; });
    }

    const canvas = document.getElementById('deco-canvas');
    if (!canvas) return;
    
    // 高解像度で学生証を描画
    canvas.width = 800; 
    canvas.height = 800;
    const ctx = canvas.getContext('2d'); 
    
    // 1. 台紙を描画
    ctx.drawImage(idBase, 0, 0, 800, 800);
    
    // 2. プレビューされた写真を合成
    const pCanvas = document.getElementById('id-photo-preview-canvas');
    if (pCanvas) {
        // 台紙の窓枠に合わせて配置（座標は台紙画像に合わせ調整済み）
        ctx.drawImage(pCanvas, 52, 332, 235, 255); 
    }
    
    // 3. 文字を描画
    ctx.fillStyle = "#333"; 
    ctx.font = "bold 42px 'M PLUS Rounded 1c', sans-serif"; 
    
    // 座標調整 (台紙のレイアウトに合わせて配置)
    ctx.fillText(grade + "年生", 475, 375); 
    ctx.fillText(name, 475, 485);
    
    // ユーザーデータ作成
    const newUser = { 
        id: Date.now(), 
        name: name, 
        grade: grade, 
        photo: canvas.toDataURL(), // 生成した画像を保存
        karikari: 100, // 入学祝い
        history: {}, 
        mistakes: [], 
        attendance: {} 
    };
    
    users.push(newUser);
    localStorage.setItem('nekoneko_users', JSON.stringify(users)); 
    
    renderUserList(); 
    
    // 入力欄をクリア
    document.getElementById('new-student-name').value = "";
    document.getElementById('new-student-grade').value = "";
    updateIDPreview();
    
    switchScreen('screen-gate');
    alert("入学おめでとうにゃ！🌸");
}

function saveAndSync() {
    if (!currentUser) return;
    const idx = users.findIndex(u => u.id === currentUser.id);
    if (idx !== -1) users[idx] = currentUser;
    localStorage.setItem('nekoneko_users', JSON.stringify(users));
    
    const kCounter = document.getElementById('karikari-count');
    if (kCounter) kCounter.innerText = currentUser.karikari;
}

function updateIDPreview() { 
    const nameVal = document.getElementById('new-student-name').value;
    const gradeVal = document.getElementById('new-student-grade').value;
    
    document.getElementById('preview-name').innerText = nameVal || "なまえ";
    document.getElementById('preview-grade').innerText = (gradeVal || "○") + "年生";
}