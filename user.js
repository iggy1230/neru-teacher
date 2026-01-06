// --- user.js (完全版: v13.0 座標修正・機能統合済) ---

let users = JSON.parse(localStorage.getItem('nekoneko_users')) || [];
let currentUser = null;
let modelsLoaded = false;
let enrollFile = null; // 入学用画像の一時保持

const idBase = new Image(); idBase.src = 'student-id-base.png';
const decoEars = new Image(); decoEars.src = 'ears.png';
const decoMuzzle = new Image(); decoMuzzle.src = 'muzzle.png';

// 初期化処理
document.addEventListener('DOMContentLoaded', () => {
    renderUserList();
    loadFaceModels();
    setupEnrollmentPhotoInputs();
});

// 顔認識モデル読み込み
async function loadFaceModels() {
    if (modelsLoaded) return;
    const status = document.getElementById('loading-models');
    if(status) status.innerText = "猫化AIを準備中にゃ... 📷";
    try {
        const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';
        // Android負荷対策: SSDを使用しつつタイムアウトで制御
        await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        modelsLoaded = true;
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

// Androidメモリ不足対策: 画像リサイズ (400pxまで縮小)
async function resizeImageForProcessing(img, maxSize = 400) {
    return new Promise((resolve) => {
        let width = img.width;
        let height = img.height;
        if (width > maxSize || height > maxSize) {
            if (width > height) { height *= maxSize / width; width = maxSize; }
            else { width *= maxSize / height; height = maxSize; }
        } else { return resolve(img); }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const resizedImg = new Image();
        resizedImg.onload = () => resolve(resizedImg);
        // 容量削減のため画質を0.5に
        resizedImg.src = canvas.toDataURL('image/jpeg', 0.5);
    });
}

// プレビュー描画 (CSSでの表示用)
function drawPreview(img) {
    const canvas = document.getElementById('id-photo-preview-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = Math.min(img.width, img.height);
    const sx = (img.width - size) / 2;
    const sy = (img.height - size) / 2;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, sx, sy, size, size, 0, 0, canvas.width, canvas.height);
}

// 入学用写真入力の設定 (3つのボタン対応)
function setupEnrollmentPhotoInputs() {
    const handleFile = (file) => {
        if (!file) return;
        enrollFile = file;
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => drawPreview(img);
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    };

    // 1. Webカメラ (アプリ内)
    const webCamBtn = document.getElementById('enroll-webcam-btn');
    if (webCamBtn) {
        webCamBtn.addEventListener('click', () => {
            startEnrollmentWebCamera(handleFile);
        });
    }
    // 2. 標準カメラ
    const camInput = document.getElementById('student-photo-input-camera');
    if (camInput) camInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
    // 3. アルバム
    const albInput = document.getElementById('student-photo-input-album');
    if (albInput) albInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
    
    // 旧互換
    const oldInput = document.getElementById('student-photo-input');
    if (oldInput) oldInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
}

// 入学用Webカメラ処理
let enrollStream = null;
async function startEnrollmentWebCamera(callback) {
    const modal = document.getElementById('camera-modal');
    const video = document.getElementById('camera-video');
    const shutter = document.getElementById('camera-shutter-btn');
    const cancel = document.getElementById('camera-cancel-btn');
    
    if (!modal || !video) return;

    try {
        // 自撮り優先
        const constraints = { video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } };
        enrollStream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = enrollStream;
        video.onloadedmetadata = () => { video.play(); };
        modal.classList.remove('hidden');

        const takePic = () => {
            const canvas = document.getElementById('camera-canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.getContext('2d').drawImage(video, 0, 0);
            canvas.toBlob((blob) => {
                const file = new File([blob], "enroll_capture.jpg", { type: "image/jpeg" });
                closeEnrollCamera();
                callback(file);
            }, 'image/jpeg', 0.9);
        };

        shutter.onclick = takePic;
        cancel.onclick = closeEnrollCamera;

    } catch (err) {
        alert("カメラ起動エラー: " + err.message);
        closeEnrollCamera();
    }
}

function closeEnrollCamera() {
    const modal = document.getElementById('camera-modal');
    const video = document.getElementById('camera-video');
    if (enrollStream) {
        enrollStream.getTracks().forEach(t => t.stop());
        enrollStream = null;
    }
    if (video) video.srcObject = null;
    if (modal) modal.classList.add('hidden');
}

// ★入学手続き実行 (座標修正済み)
async function processAndCompleteEnrollment() {
    const name = document.getElementById('new-student-name').value;
    const grade = document.getElementById('new-student-grade').value;
    const btn = document.getElementById('complete-btn');

    if(!name || !grade) return alert("お名前と学年を入れてにゃ！");
    if(!enrollFile && !document.getElementById('id-photo-preview-canvas')) return alert("写真を選んでにゃ！");
    
    btn.disabled = true;
    btn.innerText = "作成中にゃ...";
    await new Promise(r => setTimeout(r, 100)); // UI更新待ち

    try {
        if (!idBase.complete) await new Promise(r => idBase.onload = r);
        
        // 画像の取得
        let originalImg = new Image();
        if (enrollFile) {
            originalImg.src = URL.createObjectURL(enrollFile);
        } else {
            originalImg.src = document.getElementById('id-photo-preview-canvas').toDataURL();
        }
        await new Promise(r => originalImg.onload = r);

        // リサイズ (400px)
        const sourceImg = await resizeImageForProcessing(originalImg, 400);

        let sx = 0, sy = 0, sWidth = sourceImg.width, sHeight = sourceImg.height;
        let detection = null;

        // 顔認識 (タイムアウト3秒)
        if (modelsLoaded) {
            try {
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 3000));
                const detectionPromise = faceapi.detectSingleFace(sourceImg).withFaceLandmarks();
                detection = await Promise.race([detectionPromise, timeoutPromise]);
                
                if (detection) {
                    const box = detection.detection.box;
                    const faceCenterX = box.x + (box.width / 2);
                    const faceCenterY = box.y + (box.height / 2);
                    const cropSize = Math.max(box.width, box.height) * 1.8;
                    sx = faceCenterX - (cropSize / 2);
                    sy = faceCenterY - (cropSize / 2);
                    sWidth = cropSize; sHeight = cropSize;
                } else {
                     const size = Math.min(sourceImg.width, sourceImg.height) * 0.8;
                     sx = (sourceImg.width - size) / 2; sy = (sourceImg.height - size) / 2;
                     sWidth = size; sHeight = size;
                }
            } catch (e) {
                 const size = Math.min(sourceImg.width, sourceImg.height) * 0.8;
                 sx = (sourceImg.width - size) / 2; sy = (sourceImg.height - size) / 2;
                 sWidth = size; sHeight = size;
            }
        }

        // 合成用キャンバス (640x400)
        const canvas = document.getElementById('deco-canvas');
        canvas.width = 640; canvas.height = 400;
        const ctx = canvas.getContext('2d');
        
        // ベース画像を全体に描画
        ctx.drawImage(idBase, 0, 0, 640, 400);
        
        // ★修正: 写真の描画位置 (CSSのプレビュー位置に合わせて計算)
        // CSS: top 70px, left 20px, w 90px, h 98px (320x200 scale)
        // Canvas: top 140px, left 40px, w 180px, h 196px (640x400 scale)
        const destX = 40, destY = 140, destW = 180, destH = 196;
        
        ctx.save();
        ctx.beginPath();
        ctx.rect(destX, destY, destW, destH);
        ctx.clip();
        ctx.drawImage(sourceImg, sx, sy, sWidth, sHeight, destX, destY, destW, destH);
        ctx.restore();

        // 猫耳合成
        if (detection) {
            const scale = destW / sWidth;
            const landmarks = detection.landmarks;
            const nose = landmarks.getNose()[3];
            const leftEyeBrow = landmarks.getLeftEyeBrow()[2];
            const rightEyeBrow = landmarks.getRightEyeBrow()[2];
            
            const noseX = (nose.x - sx) * scale + destX;
            const noseY = (nose.y - sy) * scale + destY;
            const muzW = detection.detection.box.width * 0.8 * scale;
            const muzH = muzW * 0.8;
            if (decoMuzzle.complete) ctx.drawImage(decoMuzzle, noseX - (muzW/2), noseY - (muzH/2.5), muzW, muzH);
            
            const browX = ((leftEyeBrow.x + rightEyeBrow.x) / 2 - sx) * scale + destX;
            const browY = ((leftEyeBrow.y + rightEyeBrow.y) / 2 - sy) * scale + destY;
            const earW = detection.detection.box.width * 2.2 * scale;
            const earH = earW * 0.7;
            if (decoEars.complete) ctx.drawImage(decoEars, browX - (earW/2), browY - earH + 10, earW, earH);
        }

        // ★修正: テキスト描画位置 (CSSに合わせて調整)
        ctx.fillStyle = "#333"; 
        ctx.font = "bold 32px 'M PLUS Rounded 1c', sans-serif"; 
        
        // 学年: CSS(top 85px, left 185px) -> Canvas(y 170px, x 370px)
        ctx.fillText(grade + "年生", 370, 170 + 24); // baseline調整(+24)
        
        // 氏名: CSS(top 125px, left 185px) -> Canvas(y 250px, x 370px)
        ctx.fillText(name, 370, 250 + 24); // baseline調整(+24)

        const newUser = { 
            id: Date.now(), name, grade, 
            photo: canvas.toDataURL('image/jpeg', 0.5), // 容量削減
            karikari: 100, 
            history: {}, mistakes: [], attendance: {},
            memory: "今日初めて会ったにゃ。よろしくにゃ！" 
        };
        
        users.push(newUser);
        try {
            localStorage.setItem('nekoneko_users', JSON.stringify(users)); 
            renderUserList(); 
            
            document.getElementById('new-student-name').value = "";
            document.getElementById('new-student-grade').value = "";
            enrollFile = null;
            updateIDPreview();
            
            alert(detection ? "入学おめでとうにゃ！🌸" : "入学おめでとうにゃ！🌸\n(お顔が見つからなかったから猫耳はなしだにゃ)");
            switchScreen('screen-gate');
        } catch (e) {
            // 容量オーバー時
            users.pop(); // 追加失敗したので配列から戻す
            throw e;
        }

    } catch (err) {
        if (err.name === 'QuotaExceededError') {
            alert("データがいっぱいで保存できないにゃ。\nトップページで古い学生証の「×」ボタンを押して削除してから、もう一度試してにゃ！");
        } else {
            alert("エラーが発生したにゃ……\n" + err.message);
        }
    } finally {
        btn.disabled = false;
        btn.innerText = "入学する！";
    }
}

// ユーザーリスト描画 (カリカリ表示付き)
function renderUserList() {
    const list = document.getElementById('user-list');
    if(!list) return;
    list.innerHTML = users.length ? "" : "<p style='text-align:right; font-size:0.75rem; opacity:0.5;'>入学してにゃ</p>";
    users.forEach(user => {
        const div = document.createElement('div');
        div.className = "user-card";
        div.innerHTML = `
            <img src="${user.photo}">
            <div class="card-karikari-badge">🍖${user.karikari || 0}</div>
            <button class="delete-student-btn" onclick="deleteUser(event, ${user.id})">×</button>
        `;
        div.onclick = () => login(user);
        list.appendChild(div);
    });
}

function login(user) {
    currentUser = user;
    if (!currentUser.attendance) currentUser.attendance = {};
    if (!currentUser.memory) currentUser.memory = "";
    if (typeof transcribedProblems !== 'undefined') transcribedProblems = [];
    if (!currentUser.history) currentUser.history = {};
    if (!currentUser.mistakes) currentUser.mistakes = [];

    const avatar = document.getElementById('current-student-avatar');
    if (avatar) avatar.src = user.photo;
    const karikari = document.getElementById('karikari-count');
    if (karikari) karikari.innerText = user.karikari || 0;
    
    // 出席ボーナス
    const today = new Date().toISOString().split('T')[0];
    let isBonus = false;

    if (!currentUser.attendance[today]) {
        currentUser.attendance[today] = true;
        let streak = 1;
        let d = new Date();
        while (true) {
            d.setDate(d.getDate() - 1);
            const key = d.toISOString().split('T')[0];
            if (currentUser.attendance[key]) streak++;
            else break;
        }
        if (streak >= 3) {
            currentUser.karikari += 100;
            isBonus = true;
        }
        saveAndSync();
    }

    switchScreen('screen-lobby');
    
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
    if (user.karikari >= 100 && Math.random() > 0.3) {
        return [`お腹すいたにゃ～...給食まだかにゃ？`, `カリカリ${user.karikari}個もあるにゃ！給食行こうにゃ～`][Math.floor(Math.random()*2)];
    }
    if (mem && mem.length > 5 && !mem.includes("初めて") && Math.random() > 0.4) {
        return `おかえりにゃ！${mem}`;
    }
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