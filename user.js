// --- user.js (挨拶修正版) ---

let users = JSON.parse(localStorage.getItem('nekoneko_users')) || [];
let currentUser = null;
let modelsLoaded = false;

const idBase = new Image(); idBase.src = 'student-id-base.png';
const decoEars = new Image(); decoEars.src = 'ears.png';
const decoMuzzle = new Image(); decoMuzzle.src = 'muzzle.png';

// 1. 初期化
document.addEventListener('DOMContentLoaded', () => {
    renderUserList();
    // 画面を開いたらすぐにAIの準備を始める（高速化）
    loadFaceModels();
});

// 2. AIモデル読み込み
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
        if(status) status.innerText = "AIの準備に失敗したにゃ（手動モード）";
        const btn = document.getElementById('complete-btn');
        if(btn) btn.disabled = false;
    }
}

// 3. 写真プレビュー
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

// 4. 入学処理
async function processAndCompleteEnrollment() {
    const name = document.getElementById('new-student-name').value;
    const grade = document.getElementById('new-student-grade').value;
    const btn = document.getElementById('complete-btn');
    const photoInput = document.getElementById('student-photo-input');

    if(!name || !grade) return alert("お名前と学年を入れてにゃ！");
    
    btn.disabled = true;
    btn.innerText = "発行中にゃ...";

    try {
        if (!idBase.complete) await new Promise(r => idBase.onload = r);

        let sourceImg = null;
        if (photoInput.files && photoInput.files[0]) {
            sourceImg = await new Promise((resolve, reject) => {
                const img = new Image();
                const reader = new FileReader();
                reader.onload = (e) => { img.src = e.target.result; };
                img.onload = () => resolve(img);
                img.onerror = reject;
                reader.readAsDataURL(photoInput.files[0]);
            });
        } else {
            const pCanvas = document.getElementById('id-photo-preview-canvas');
            sourceImg = new Image();
            sourceImg.src = pCanvas.toDataURL();
            await new Promise(r => sourceImg.onload = r);
        }

        // 顔検出
        let sx = 0, sy = 0, sWidth = sourceImg.width, sHeight = sourceImg.height;
        let detection = null;

        if (modelsLoaded) {
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
                const size = Math.min(sourceImg.width, sourceImg.height) * 0.8;
                sx = (sourceImg.width - size) / 2;
                sy = (sourceImg.height - size) / 2;
                sWidth = size;
                sHeight = size;
            }
        }

        // 描画
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

        // データ保存
        const newUser = { 
            id: Date.now(), 
            name, grade, 
            photo: canvas.toDataURL('image/jpeg', 0.7), 
            karikari: 100, 
            history: {}, mistakes: [], attendance: {},
            memory: "" // ★初期値は空文字にする（これで初対面判定を正確に）
        };
        
        users.push(newUser);
        localStorage.setItem('nekoneko_users', JSON.stringify(users)); 
        renderUserList(); 
        
        document.getElementById('new-student-name').value = "";
        document.getElementById('new-student-grade').value = "";
        updateIDPreview();
        
        const msg = detection ? "入学おめでとうにゃ！🌸\n猫耳がついた学生証ができたにゃ！" : "入学おめでとうにゃ！🌸";
        alert(msg);
        switchScreen('screen-gate');

    } catch (err) {
        console.error("Enrollment Error:", err);
        if (err.name === 'QuotaExceededError' || err.message.includes('quota')) {
            alert("ごめんにゃ、データがいっぱいで保存できなかったにゃ。\n使っていない生徒さんを削除してから、もう一度試してほしいにゃ！");
        } else {
            alert("エラーが発生したにゃ……\n" + err.message);
        }
    } finally {
        btn.disabled = false;
        btn.innerText = "入学する！";
    }
}

// 5. ログイン・挨拶・データ管理
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
    // 古いデータとの互換性確保
    if (typeof transcribedProblems !== 'undefined') transcribedProblems = [];
    if (!currentUser.history) currentUser.history = {};
    if (!currentUser.mistakes) currentUser.mistakes = [];
    if (!currentUser.attendance) currentUser.attendance = {};
    if (!currentUser.memory) currentUser.memory = ""; // 未定義なら空文字

    const avatar = document.getElementById('current-student-avatar');
    if (avatar) avatar.src = user.photo;
    
    const karikari = document.getElementById('karikari-count');
    if (karikari) karikari.innerText = user.karikari || 0;
    
    switchScreen('screen-lobby');
    // ★ここが挨拶生成
    updateNellMessage(getNellGreeting(user), "happy");
}

// ★修正：賢い挨拶生成ロジック
function getNellGreeting(user) {
    const mem = user.memory || "";
    const hist = user.history || {};
    const mistakes = user.mistakes || [];

    // 優先順位1: こじんめんだんの記憶がある場合（かつ「今日初めて〜」ではない）
    if (mem && mem.length > 5 && !mem.includes("初めて") && Math.random() > 0.4) {
        return `おかえりにゃ！${mem}`;
    }

    // 優先順位2: 勉強した履歴がある場合
    if (Object.keys(hist).length > 0) {
        // 一番多く勉強した科目を探す
        const favSub = Object.keys(hist).reduce((a, b) => hist[a] > hist[b] ? a : b);
        return `おかえり！${user.name}さん。今日も「${favSub}」がんばる？`;
    }

    // 優先順位3: 復習ノートがある場合
    if (mistakes.length > 0) {
        return `おかえり！${user.name}さん。復習ノートを確認しようにゃ！`;
    }

    // 優先順位4: 何も履歴がない（本当に初対面）
    return `はじめまして、${user.name}さん！一緒に勉強するにゃ！`;
}

function deleteUser(e, id) { 
    e.stopPropagation(); 
    if(confirm("この生徒手帳を削除するにゃ？（データは戻せないにゃ）")) { 
        users = users.filter(u => u.id !== id); 
        try {
            localStorage.setItem('nekoneko_users', JSON.stringify(users)); 
            renderUserList(); 
        } catch(err) { alert("削除中にエラーが起きたにゃ"); }
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