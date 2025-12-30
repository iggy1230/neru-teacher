// --- user.js (顔認識AI復活版) ---

let users = JSON.parse(localStorage.getItem('nekoneko_users')) || [];
let currentUser = null;
let modelsLoaded = false;

// 画像素材
const idBase = new Image(); idBase.src = 'student-id-base.png';
const decoEars = new Image(); decoEars.src = 'ears.png';
const decoMuzzle = new Image(); decoMuzzle.src = 'muzzle.png';

// 1. 初期化
document.addEventListener('DOMContentLoaded', () => {
    renderUserList();
});

// 2. AIモデルの読み込み（入学画面が開くと呼ばれる）
async function loadFaceModels() {
    const status = document.getElementById('loading-models');
    const btn = document.getElementById('complete-btn');
    
    if (modelsLoaded) {
        if(btn) btn.disabled = false;
        if(status) status.innerText = "";
        return;
    }

    if(status) status.innerText = "猫化AIを準備中にゃ... (ちょっと待ってね)";
    
    try {
        // face-apiのモデルを読み込む
        const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';
        await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        
        modelsLoaded = true;
        console.log("AI Models Loaded");
        
        if(status) status.innerText = "準備完了にゃ！";
        if(btn) btn.disabled = false; // 読み込み完了でボタン有効化
        
    } catch (e) {
        console.error("AI Load Error:", e);
        if(status) status.innerText = "AIの準備に失敗したにゃ。でも入学はできるよ！";
        if(btn) btn.disabled = false; // エラーでも入学はできるようにする
    }
}

// 3. 写真選択とプレビュー
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
                
                // 正方形にトリミング表示
                const size = Math.min(img.width, img.height);
                const sx = (img.width - size) / 2;
                const sy = (img.height - size) / 2;
                
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, sx, sy, size, size, 0, 0, canvas.width, canvas.height);
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// 4. 入学処理とAI合成
async function processAndCompleteEnrollment() {
    const name = document.getElementById('new-student-name').value;
    const grade = document.getElementById('new-student-grade').value;
    
    if(!name || !grade) return alert("お名前と学年を入れてにゃ！");

    // ボタンを一時無効化（連打防止）
    const btn = document.getElementById('complete-btn');
    btn.disabled = true;
    btn.innerText = "発行中にゃ...";

    // 1. 合成用キャンバス準備
    const canvas = document.getElementById('deco-canvas');
    canvas.width = 800; canvas.height = 800;
    const ctx = canvas.getContext('2d');

    // 2. 台紙描画
    if (!idBase.complete) await new Promise(r => idBase.onload = r);
    ctx.drawImage(idBase, 0, 0, 800, 800);

    // 3. 写真の取得と顔認識
    const pCanvas = document.getElementById('id-photo-preview-canvas');
    const photoImg = new Image();
    photoImg.src = pCanvas.toDataURL();
    await new Promise(r => photoImg.onload = r);

    // 写真を台紙の枠に合わせて描画 (座標: x52, y332, w235, h255)
    ctx.drawImage(photoImg, 52, 332, 235, 255);

    // ★顔認識とデコレーション処理★
    if (modelsLoaded) {
        try {
            // キャンバス上の写真部分から顔を探す
            // (認識精度を上げるため、一度写真だけの別キャンバスを作る)
            const detectCanvas = document.createElement('canvas');
            detectCanvas.width = photoImg.width; 
            detectCanvas.height = photoImg.height;
            detectCanvas.getContext('2d').drawImage(photoImg, 0, 0);
            
            const detection = await faceapi.detectSingleFace(detectCanvas).withFaceLandmarks();

            if (detection) {
                const landmarks = detection.landmarks;
                const nose = landmarks.getNose()[3]; // 鼻の頭
                const leftEye = landmarks.getLeftEye()[0];
                const rightEye = landmarks.getRightEye()[3];
                const jaw = landmarks.getJawOutline();
                
                // 座標変換係数（プレビューcanvasサイズ(94px)から、学生証canvasサイズ(235px)への比率）
                const scale = 235 / 94; 
                // オフセット
                const offsetX = 52; 
                const offsetY = 332;

                // --- 猫耳合成 ---
                // 額のあたり（眉毛の上）を計算
                const leftEyebrow = landmarks.getLeftEyeBrow()[2];
                const rightEyebrow = landmarks.getRightEyeBrow()[2];
                const earY = (leftEyebrow.y + rightEyebrow.y) / 2 - 60; // 少し上に
                const earX = (leftEyebrow.x + rightEyebrow.x) / 2;
                
                const earW = detection.detection.box.width * 1.5 * scale;
                const earH = earW * 0.8; // 比率調整

                // 座標変換して描画
                ctx.drawImage(decoEars, 
                    (earX * scale) + offsetX - (earW / 2), 
                    (earY * scale) + offsetY, 
                    earW, earH
                );

                // --- マズル合成 ---
                const noseX = nose.x;
                const noseY = nose.y;
                const muzW = detection.detection.box.width * 0.6 * scale;
                const muzH = muzW * 0.8;

                ctx.drawImage(decoMuzzle, 
                    (noseX * scale) + offsetX - (muzW / 2), 
                    (noseY * scale) + offsetY - (muzH / 3), 
                    muzW, muzH
                );
            }
        } catch (e) {
            console.warn("Face Detection Failed:", e);
            // 失敗してもエラーにせず、デコなしで進む
        }
    }

    // 4. 文字入れ
    ctx.fillStyle = "#333"; 
    ctx.font = "bold 42px 'M PLUS Rounded 1c', sans-serif"; 
    ctx.fillText(grade + "年生", 475, 375); 
    ctx.fillText(name, 475, 485);

    // 5. 保存
    users.push({ 
        id: Date.now(), name, grade, photo: canvas.toDataURL(), 
        karikari: 100, history: {}, mistakes: [], attendance: {} 
    });
    localStorage.setItem('nekoneko_users', JSON.stringify(users)); 
    
    renderUserList(); 
    document.getElementById('new-student-name').value = "";
    document.getElementById('new-student-grade').value = "";
    updateIDPreview();
    
    btn.disabled = false;
    btn.innerText = "入学する！";
    switchScreen('screen-gate');
    alert("入学おめでとうにゃ！🌸\n猫耳がついた学生証ができたにゃ！");
}

// 5. ユーザー管理系
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
    if (typeof transcribedProblems !== 'undefined') transcribedProblems = [];
    if (!currentUser.history) currentUser.history = {};
    if (!currentUser.mistakes) currentUser.mistakes = [];
    if (!currentUser.attendance) currentUser.attendance = {};

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