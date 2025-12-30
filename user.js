// --- user.js (顔認識・自動トリミング・デコレーション完全版) ---

let users = JSON.parse(localStorage.getItem('nekoneko_users')) || [];
let currentUser = null;
let modelsLoaded = false;

// 画像素材の定義
const idBase = new Image(); idBase.src = 'student-id-base.png';
const decoEars = new Image(); decoEars.src = 'ears.png';
const decoMuzzle = new Image(); decoMuzzle.src = 'muzzle.png';

// 1. 初期化
document.addEventListener('DOMContentLoaded', () => {
    renderUserList();
});

// 2. AIモデルの読み込み
async function loadFaceModels() {
    const status = document.getElementById('loading-models');
    const btn = document.getElementById('complete-btn');
    
    if (modelsLoaded) {
        if(btn) btn.disabled = false;
        if(status) status.innerText = "";
        return;
    }

    if(status) status.innerText = "猫化AIを準備中にゃ... 📷";
    
    try {
        const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';
        await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        
        modelsLoaded = true;
        console.log("AI Models Loaded");
        
        if(status) status.innerText = "準備完了にゃ！";
        if(btn) btn.disabled = false; 
    } catch (e) {
        console.error("AI Load Error:", e);
        if(status) status.innerText = "手動モードで入学できるにゃ🐾";
        if(btn) btn.disabled = false;
    }
}

// 3. 写真選択時のプレビュー（簡易表示）
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
                // とりあえず真ん中で正方形トリミングして表示
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

// 4. 入学処理（顔検出・トリミング・合成のメイン処理）
async function processAndCompleteEnrollment() {
    const name = document.getElementById('new-student-name').value;
    const grade = document.getElementById('new-student-grade').value;
    const btn = document.getElementById('complete-btn');
    const photoInput = document.getElementById('student-photo-input');

    if(!name || !grade) return alert("お名前と学年を入れてにゃ！");
    
    // ボタンをロック
    btn.disabled = true;
    btn.innerText = "発行中にゃ...";

    try {
        // 画像リソースの読み込み待ち
        if (!idBase.complete) await new Promise(r => idBase.onload = r);

        // 入力された写真を取得
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
            // 写真がない場合はプレビューキャンバスから無理やり取得（またはデフォルト）
            const pCanvas = document.getElementById('id-photo-preview-canvas');
            sourceImg = new Image();
            sourceImg.src = pCanvas.toDataURL();
            await new Promise(r => sourceImg.onload = r);
        }

        // --- 顔検出 & トリミング計算 ---
        let sx = 0, sy = 0, sWidth = sourceImg.width, sHeight = sourceImg.height;
        let detection = null;

        if (modelsLoaded) {
            // 顔検出実行
            detection = await faceapi.detectSingleFace(sourceImg).withFaceLandmarks();
            
            if (detection) {
                // 顔が見つかったら、顔を中心にズーム（トリミング）する計算
                const box = detection.detection.box;
                const faceCenterX = box.x + (box.width / 2);
                const faceCenterY = box.y + (box.height / 2);
                
                // 切り抜くサイズ（顔の幅の約1.8倍の正方形にする）
                const cropSize = Math.max(box.width, box.height) * 1.8;
                
                sx = faceCenterX - (cropSize / 2);
                sy = faceCenterY - (cropSize / 2);
                sWidth = cropSize;
                sHeight = cropSize;
            } else {
                // 顔が見つからない場合は画像の中心を正方形にトリミング
                const size = Math.min(sourceImg.width, sourceImg.height);
                sx = (sourceImg.width - size) / 2;
                sy = (sourceImg.height - size) / 2;
                sWidth = size;
                sHeight = size;
            }
        }

        // --- 学生証の描画 ---
        const canvas = document.getElementById('deco-canvas');
        canvas.width = 800; canvas.height = 800;
        const ctx = canvas.getContext('2d');

        // 1. 台紙
        ctx.drawImage(idBase, 0, 0, 800, 800);

        // 2. 写真（計算したエリアを切り抜いて配置）
        // 学生証の写真エリア: x=52, y=332, w=235, h=255
        const destX = 52, destY = 332, destW = 235, destH = 255;
        
        ctx.save();
        // 写真エリアからはみ出さないようにクリッピング
        ctx.beginPath();
        ctx.rect(destX, destY, destW, destH);
        ctx.clip();
        
        // 画像を描画
        ctx.drawImage(sourceImg, sx, sy, sWidth, sHeight, destX, destY, destW, destH);
        ctx.restore();

        // 3. デコレーション（猫耳・マズル）
        if (detection) {
            // 座標変換比率（元の画像 → 配置先の画像）
            const scale = destW / sWidth;
            
            const landmarks = detection.landmarks;
            const nose = landmarks.getNose()[3]; // 鼻の頭
            const leftEyeBrow = landmarks.getLeftEyeBrow()[2];
            const rightEyeBrow = landmarks.getRightEyeBrow()[2];

            // --- マズル ---
            // 元画像上の座標から、切り抜き(sx,sy)を引いて、倍率(scale)を掛け、配置位置(dest)を足す
            const noseX = (nose.x - sx) * scale + destX;
            const noseY = (nose.y - sy) * scale + destY;
            
            const muzW = detection.detection.box.width * 0.6 * scale;
            const muzH = muzW * 0.8;
            
            if (decoMuzzle.complete) {
                ctx.drawImage(decoMuzzle, noseX - (muzW/2), noseY - (muzH/2.5), muzW, muzH);
            }

            // --- 猫耳 ---
            // 眉毛の間を中心に
            const browX = ((leftEyeBrow.x + rightEyeBrow.x) / 2 - sx) * scale + destX;
            const browY = ((leftEyeBrow.y + rightEyeBrow.y) / 2 - sy) * scale + destY;
            
            const earW = detection.detection.box.width * 1.8 * scale; // 顔幅より少し広く
            const earH = earW * 0.7;

            if (decoEars.complete) {
                // 眉毛より少し上(-earH)に配置
                ctx.drawImage(decoEars, browX - (earW/2), browY - earH + 10, earW, earH);
            }
        }

        // 4. 文字情報
        ctx.fillStyle = "#333"; 
        ctx.font = "bold 42px 'M PLUS Rounded 1c', sans-serif"; 
        ctx.fillText(grade + "年生", 475, 375); 
        ctx.fillText(name, 475, 485);

        // 5. データ保存
        const newUser = { 
            id: Date.now(), 
            name, 
            grade, 
            photo: canvas.toDataURL(), 
            karikari: 100, 
            history: {}, 
            mistakes: [], 
            attendance: {} 
        };
        
        users.push(newUser);
        localStorage.setItem('nekoneko_users', JSON.stringify(users)); 
        
        renderUserList(); 
        
        // 入力クリア
        document.getElementById('new-student-name').value = "";
        document.getElementById('new-student-grade').value = "";
        updateIDPreview();
        
        // 完了メッセージ
        alert("入学おめでとうにゃ！🌸\n猫耳学生証が完成したにゃ！");
        switchScreen('screen-gate');

    } catch (err) {
        console.error("Enrollment Error:", err);
        alert("エラーが発生したにゃ……もう一度試してほしいにゃ。\n" + err.message);
    } finally {
        // どんなエラーが起きてもボタンは復活させる
        btn.disabled = false;
        btn.innerText = "入学する！";
    }
}

// 5. ユーザーリスト表示
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
    // 既存データをクリア
    if (typeof transcribedProblems !== 'undefined') transcribedProblems = [];
    
    // データ補正
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