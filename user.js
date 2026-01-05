// --- user.js (完全版: Android対策 + 出席ボーナス) ---

let users = JSON.parse(localStorage.getItem('nekoneko_users')) || [];
let currentUser = null;
let modelsLoaded = false;

const idBase = new Image(); idBase.src = 'student-id-base.png';
const decoEars = new Image(); decoEars.src = 'ears.png';
const decoMuzzle = new Image(); decoMuzzle.src = 'muzzle.png';

document.addEventListener('DOMContentLoaded', () => {
    renderUserList();
    loadFaceModels();
});

// 顔認識モデルの読み込み
async function loadFaceModels() {
    if (modelsLoaded) return;
    const status = document.getElementById('loading-models');
    if(status) status.innerText = "猫化AIを準備中にゃ... 📷";
    try {
        const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';
        await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        modelsLoaded = true;
        console.log("AI Models Loaded");
        if(status) status.innerText = "準備完了にゃ！";
        const btn = document.getElementById('complete-btn');
        if(btn) btn.disabled = false;
    } catch (e) {
        console.error("AI Load Error:", e);
        if(status) status.innerText = "手動モードで入学できるにゃ🐾";
        const btn = document.getElementById('complete-btn');
        if(btn) btn.disabled = false;
    }
}

// Androidメモリ不足対策: 画像リサイズ処理
async function resizeImageForProcessing(img, maxSize = 1024) {
    return new Promise((resolve) => {
        let width = img.width;
        let height = img.height;
        // サイズが大きい場合のみ縮小
        if (width > maxSize || height > maxSize) {
            if (width > height) {
                height *= maxSize / width;
                width = maxSize;
            } else {
                width *= maxSize / height;
                height = maxSize;
            }
        } else {
            return resolve(img);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        const resizedImg = new Image();
        resizedImg.onload = () => resolve(resizedImg);
        resizedImg.src = canvas.toDataURL('image/jpeg', 0.8);
    });
}

// 写真選択時のプレビュー
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

// 入学手続き（画像生成・保存）
async function processAndCompleteEnrollment() {
    const name = document.getElementById('new-student-name').value;
    const grade = document.getElementById('new-student-grade').value;
    const btn = document.getElementById('complete-btn');
    const photoInput = document.getElementById('student-photo-input');

    if(!name || !grade) return alert("お名前と学年を入れてにゃ！");
    btn.disabled = true;
    btn.innerText = "作成中にゃ(ちょっと待ってね)...";

    try {
        if (!idBase.complete) await new Promise(r => idBase.onload = r);
        
        let originalImg = null;
        if (photoInput.files && photoInput.files[0]) {
            originalImg = await new Promise((resolve, reject) => {
                const img = new Image();
                const reader = new FileReader();
                reader.onload = (e) => { img.src = e.target.result; };
                img.onload = () => resolve(img);
                img.onerror = reject;
                reader.readAsDataURL(photoInput.files[0]);
            });
        } else {
            const pCanvas = document.getElementById('id-photo-preview-canvas');
            originalImg = new Image();
            originalImg.src = pCanvas.toDataURL();
            await new Promise(r => originalImg.onload = r);
        }

        // ★リサイズ実行
        const sourceImg = await resizeImageForProcessing(originalImg, 1024);

        let sx = 0, sy = 0, sWidth = sourceImg.width, sHeight = sourceImg.height;
        let detection = null;

        if (modelsLoaded) {
            try {
                detection = await faceapi.detectSingleFace(sourceImg).withFaceLandmarks();
                if (detection) {
                    const box = detection.detection.box;
                    const faceCenterX = box.x + (box.width / 2);
                    const faceCenterY = box.y + (box.height / 2);
                    const cropSize = Math.max(box.width, box.height) * 1.8;
                    sx = faceCenterX - (cropSize / 2);
                    sy = faceCenterY - (cropSize / 2);
                    sWidth = cropSize;
                    sHeight = cropSize;
                } else {
                    // 顔が見つからない場合は中央クロップ
                    const size = Math.min(sourceImg.width, sourceImg.height) * 0.8;
                    sx = (sourceImg.width - size) / 2;
                    sy = (sourceImg.height - size) / 2;
                    sWidth = size;
                    sHeight = size;
                }
            } catch (e) {
                console.warn("Face detection fallback", e);
                const size = Math.min(sourceImg.width, sourceImg.height) * 0.8;
                sx = (sourceImg.width - size) / 2;
                sy = (sourceImg.height - size) / 2;
                sWidth = size;
                sHeight = size;
            }
        }

        const canvas = document.getElementById('deco-canvas');
        canvas.width = 800; canvas.height = 800;
        const ctx = canvas.getContext('2d');
        
        ctx.drawImage(idBase, 0, 0, 800, 800);
        
        const destX = 52, destY = 332, destW = 235, destH = 255;
        ctx.save();
        ctx.beginPath();
        ctx.rect(destX, destY, destW, destH);
        ctx.clip();
        ctx.drawImage(sourceImg, sx, sy, sWidth, sHeight, destX, destY, destW, destH);
        ctx.restore();

        if (detection) {
            const scale = destW / sWidth;
            const landmarks = detection.landmarks;
            const nose = landmarks.getNose()[3];
            const leftEyeBrow = landmarks.getLeftEyeBrow()[2];
            const rightEyeBrow = landmarks.getRightEyeBrow()[2];
            
            const noseX = (nose.x - sx) * scale + destX;
            const noseY = (nose.y - sy) * scale + destY;
            const muzW = detection.detection.box.width * 0.6 * scale;
            const muzH = muzW * 0.8;
            if (decoMuzzle.complete) ctx.drawImage(decoMuzzle, noseX - (muzW/2), noseY - (muzH/2.5), muzW, muzH);
            
            const browX = ((leftEyeBrow.x + rightEyeBrow.x) / 2 - sx) * scale + destX;
            const browY = ((leftEyeBrow.y + rightEyeBrow.y) / 2 - sy) * scale + destY;
            const earW = detection.detection.box.width * 1.8 * scale;
            const earH = earW * 0.7;
            if (decoEars.complete) ctx.drawImage(decoEars, browX - (earW/2), browY - earH + 10, earW, earH);
        }

        ctx.fillStyle = "#333"; 
        ctx.font = "bold 42px 'M PLUS Rounded 1c', sans-serif"; 
        ctx.fillText(grade + "年生", 475, 375); 
        ctx.fillText(name, 475, 485);

        const newUser = { 
            id: Date.now(), name, grade, 
            photo: canvas.toDataURL('image/jpeg', 0.7), 
            karikari: 100, 
            history: {}, mistakes: [], attendance: {},
            memory: "今日初めて会ったにゃ。よろしくにゃ！" 
        };
        
        users.push(newUser);
        localStorage.setItem('nekoneko_users', JSON.stringify(users)); 
        renderUserList(); 
        
        document.getElementById('new-student-name').value = "";
        document.getElementById('new-student-grade').value = "";
        updateIDPreview();
        
        alert(detection ? "入学おめでとうにゃ！🌸\n猫耳がついた学生証ができたにゃ！" : "入学おめでとうにゃ！🌸");
        switchScreen('screen-gate');

    } catch (err) {
        console.error("Enrollment Error:", err);
        if (err.name === 'QuotaExceededError') alert("データがいっぱいで保存できなかったにゃ。古い生徒手帳を消してにゃ。");
        else alert("エラーが発生したにゃ……\n" + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = "入学する！";
    }
}

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
    // データ初期化
    if (!currentUser.memory) currentUser.memory = "";
    if (typeof transcribedProblems !== 'undefined') transcribedProblems = [];
    if (!currentUser.history) currentUser.history = {};
    if (!currentUser.mistakes) currentUser.mistakes = [];
    if (!currentUser.attendance) currentUser.attendance = {};

    const avatar = document.getElementById('current-student-avatar');
    if (avatar) avatar.src = user.photo;
    const karikari = document.getElementById('karikari-count');
    if (karikari) karikari.innerText = user.karikari || 0;
    
    // --- ★出席・ボーナスロジック ---
    const today = new Date().toISOString().split('T')[0];
    let isBonus = false;

    // 今日まだ出席していない場合
    if (!currentUser.attendance[today]) {
        currentUser.attendance[today] = true;
        
        // 連続日数（Streak）を計算
        let streak = 1; // 今日分
        let d = new Date();
        while (true) {
            d.setDate(d.getDate() - 1); // 前日へ
            const key = d.toISOString().split('T')[0];
            if (currentUser.attendance[key]) {
                streak++;
            } else {
                break;
            }
        }

        // 3日以上連続ならボーナス
        if (streak >= 3) {
            currentUser.karikari += 100;
            isBonus = true;
        }
        saveAndSync();
    }
    // ----------------------------

    switchScreen('screen-lobby');
    
    // ボーナスがある場合は特別なメッセージ、なければ通常挨拶
    if (isBonus) {
        updateNellMessage("連続出席ボーナス！カリカリ100個プレゼントだにゃ！", "excited");
        showKarikariEffect(100);
        updateMiniKarikari();
    } else {
        updateNellMessage(getNellGreeting(user), "happy");
    }
}

function getNellGreeting(user) {
    const mem = user.memory || "";
    // カリカリ100個以上でおねだり
    if (user.karikari >= 100 && Math.random() > 0.3) {
        return ["お腹すいたにゃ～...給食まだかにゃ？", "カリカリ100個もあるにゃ！給食行こうにゃ～"][Math.floor(Math.random()*2)];
    }
    // 記憶があれば優先
    if (mem && mem.length > 5 && !mem.includes("初めて") && Math.random() > 0.4) {
        return `おかえりにゃ！${mem}`;
    }
    // 勉強履歴
    const hist = user.history || {};
    if (Object.keys(hist).length > 0) {
        const favSub = Object.keys(hist).reduce((a, b) => hist[a] > hist[b] ? a : b);
        return `おかえり！${user.name}さん。今日も「${favSub}」がんばる？`;
    }
    return `はじめまして、${user.name}さん！一緒に勉強するにゃ！`;
}

function deleteUser(e, id) { 
    e.stopPropagation(); 
    if(confirm("この生徒手帳を削除するにゃ？")) { 
        users = users.filter(u => u.id !== id); 
        try { localStorage.setItem('nekoneko_users', JSON.stringify(users)); renderUserList(); } catch(err) {}
    } 
}

function saveAndSync() {
    if (!currentUser) return;
    const idx = users.findIndex(u => u.id === currentUser.id);
    if (idx !== -1) users[idx] = currentUser;
    try { localStorage.setItem('nekoneko_users', JSON.stringify(users)); } catch(err) {}
    const kCounter = document.getElementById('karikari-count');
    if (kCounter) kCounter.innerText = currentUser.karikari;
}

function updateIDPreview() { 
    const nameVal = document.getElementById('new-student-name').value;
    const gradeVal = document.getElementById('new-student-grade').value;
    document.getElementById('preview-name').innerText = nameVal || "なまえ";
    document.getElementById('preview-grade').innerText = (gradeVal || "○") + "年生";
}