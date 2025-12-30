// --- user.js (容量対策・顔認識修正版) ---

let users = JSON.parse(localStorage.getItem('nekoneko_users')) || [];
let currentUser = null;
let modelsLoaded = false;

// 画像素材
const idBase = new Image(); idBase.src = 'student-id-base.png';
const decoEars = new Image(); decoEars.src = 'ears.png';
const decoMuzzle = new Image(); decoMuzzle.src = 'muzzle.png';

// 1. 初期化とAIロード開始
document.addEventListener('DOMContentLoaded', () => {
    renderUserList();
    // 画面を開いたらすぐにAIの準備を始める
    loadFaceModels();
});

// 2. AIモデル読み込み
async function loadFaceModels() {
    if (modelsLoaded) return;
    
    // 読み込み状況を表示する要素があれば更新
    const status = document.getElementById('loading-models');
    if(status) status.innerText = "猫化AIを準備中にゃ... 📷";
    
    try {
        const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';
        await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        
        modelsLoaded = true;
        console.log("AI Models Loaded");
        
        if(status) status.innerText = "準備完了にゃ！";
        
        // 入学画面のボタンを有効化
        const btn = document.getElementById('complete-btn');
        if(btn) btn.disabled = false;
        
    } catch (e) {
        console.error("AI Load Error:", e);
        if(status) status.innerText = "AIの準備に失敗したにゃ（手動モード）";
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
                
                // プレビュー用に中心をトリミング
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

// 4. 入学処理（メイン）
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
        // 画像読み込み待ち
        if (!idBase.complete) await new Promise(r => idBase.onload = r);

        // 写真データの取得
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
            // プレビューから取得
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
                // 顔が見つかった場合：顔を中心にズーム
                const box = detection.detection.box;
                const faceCenterX = box.x + (box.width / 2);
                const faceCenterY = box.y + (box.height / 2);
                
                // 切り抜くサイズ（顔の幅の約1.8倍）
                const cropSize = Math.max(box.width, box.height) * 1.8;
                
                sx = faceCenterX - (cropSize / 2);
                sy = faceCenterY - (cropSize / 2);
                sWidth = cropSize;
                sHeight = cropSize;
            } else {
                // 顔が見つからない場合：画像の中心を少しズームして切り抜く
                const size = Math.min(sourceImg.width, sourceImg.height) * 0.8;
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

        // 2. 写真配置（学生証の枠：x52, y332, w235, h255）
        const destX = 52, destY = 332, destW = 235, destH = 255;
        
        ctx.save();
        ctx.beginPath();
        ctx.rect(destX, destY, destW, destH);
        ctx.clip(); // 枠からはみ出ないように
        ctx.drawImage(sourceImg, sx, sy, sWidth, sHeight, destX, destY, destW, destH);
        ctx.restore();

        // 3. デコレーション（猫耳・マズル）
        if (detection) {
            const scale = destW / sWidth; // 縮尺率
            const landmarks = detection.landmarks;
            const nose = landmarks.getNose()[3];
            const leftEyeBrow = landmarks.getLeftEyeBrow()[2];
            const rightEyeBrow = landmarks.getRightEyeBrow()[2];

            // マズル
            const noseX = (nose.x - sx) * scale + destX;
            const noseY = (nose.y - sy) * scale + destY;
            const muzW = detection.detection.box.width * 0.6 * scale;
            const muzH = muzW * 0.8;
            
            if (decoMuzzle.complete) {
                ctx.drawImage(decoMuzzle, noseX - (muzW/2), noseY - (muzH/2.5), muzW, muzH);
            }

            // 猫耳
            const browX = ((leftEyeBrow.x + rightEyeBrow.x) / 2 - sx) * scale + destX;
            const browY = ((leftEyeBrow.y + rightEyeBrow.y) / 2 - sy) * scale + destY;
            const earW = detection.detection.box.width * 1.8 * scale;
            const earH = earW * 0.7;

            if (decoEars.complete) {
                ctx.drawImage(decoEars, browX - (earW/2), browY - earH + 10, earW, earH);
            }
        }

        // 4. 文字情報
        ctx.fillStyle = "#333"; 
        ctx.font = "bold 42px 'M PLUS Rounded 1c', sans-serif"; 
        ctx.fillText(grade + "年生", 475, 375); 
        ctx.fillText(name, 475, 485);

        // 5. データ保存（★ここが重要：JPEG圧縮して容量削減）
        const photoData = canvas.toDataURL('image/jpeg', 0.7);

        const newUser = { 
            id: Date.now(), 
            name, grade, 
            photo: photoData, 
            karikari: 100, 
            history: {}, mistakes: [], attendance: {} 
        };
        
        users.push(newUser);
        localStorage.setItem('nekoneko_users', JSON.stringify(users)); 
        
        renderUserList(); 
        
        // 入力クリア
        document.getElementById('new-student-name').value = "";
        document.getElementById('new-student-grade').value = "";
        updateIDPreview();
        
        const msg = detection 
            ? "入学おめでとうにゃ！🌸\n猫耳がついた学生証ができたにゃ！" 
            : "入学おめでとうにゃ！🌸\n（お顔が見つからなかったから、そのままの写真で作ったにゃ）";
            
        alert(msg);
        switchScreen('screen-gate');

    } catch (err) {
        console.error("Enrollment Error:", err);
        
        // 容量オーバーエラーの場合のメッセージ
        if (err.name === 'QuotaExceededError' || err.message.includes('quota')) {
            alert("ごめんにゃ、データがいっぱいで保存できなかったにゃ。\n使っていない生徒さんを削除してから、もう一度試してほしいにゃ！");
        } else {
            alert("エラーが発生したにゃ……\n" + err.message);
        }
    } finally {
        // ボタン復活
        btn.disabled = false;
        btn.innerText = "入学する！";
    }
}

// 5. ユーザー管理系（表示・削除・ログイン）
function renderUserList() {
    const list = document.getElementById('user-list');
    if(!list) return;
    list.innerHTML = users.length ? "" : "<p style='text-align:right; font-size:0.75rem; opacity:0.5;'>入学してにゃ</p>";
    users.forEach(user => {
        const div = document.createElement('div');
        div.className = "user-card";
        // 写真表示
        div.innerHTML = `<img src="${user.photo}"><button class="delete-student-btn" onclick="deleteUser(event, ${user.id})">×</button>`;
        div.onclick = () => login(user);
        list.appendChild(div);
    });
}

function login(user) {
    currentUser = user;
    if (typeof transcribedProblems !== 'undefined') transcribedProblems = [];
    
    // データ整合性補正
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
    if(confirm("この生徒手帳を削除するにゃ？（データは戻せないにゃ）")) { 
        users = users.filter(u => u.id !== id); 
        try {
            localStorage.setItem('nekoneko_users', JSON.stringify(users)); 
            renderUserList(); 
        } catch(err) {
            alert("削除中にエラーが起きたにゃ");
        }
    } 
}

function saveAndSync() {
    if (!currentUser) return;
    const idx = users.findIndex(u => u.id === currentUser.id);
    if (idx !== -1) users[idx] = currentUser;
    
    try {
        localStorage.setItem('nekoneko_users', JSON.stringify(users));
    } catch(err) {
        console.error("Save Error:", err);
        // カリカリの保存などで頻繁に出ると困るので、ここではログのみにするか
        // ユーザーに警告するか検討。いったんログのみ。
    }
    
    const kCounter = document.getElementById('karikari-count');
    if (kCounter) kCounter.innerText = currentUser.karikari;
}

function updateIDPreview() { 
    const nameVal = document.getElementById('new-student-name').value;
    const gradeVal = document.getElementById('new-student-grade').value;
    document.getElementById('preview-name').innerText = nameVal || "なまえ";
    document.getElementById('preview-grade').innerText = (gradeVal || "○") + "年生";
}