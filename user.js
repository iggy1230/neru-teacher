// --- user.js (写真即時反映版) ---

let users = JSON.parse(localStorage.getItem('nekoneko_users')) || [];
let currentUser = null;
let modelsLoaded = false;
let enrollFile = null;

// 画像の事前読み込み
const idBase = new Image(); 
idBase.crossOrigin = "Anonymous"; // エラー防止
idBase.src = 'student-id-base.png';

const decoEars = new Image(); decoEars.src = 'ears.png';
const decoMuzzle = new Image(); decoMuzzle.src = 'muzzle.png';

document.addEventListener('DOMContentLoaded', () => {
    renderUserList();
    loadFaceModels();
    setupEnrollmentPhotoInputs();
    
    // ページを開いた時点で一旦空の学生証を描画しておく
    if(idBase.complete) {
        drawPreview(null);
    } else {
        idBase.onload = () => drawPreview(null);
    }
});

async function loadFaceModels() {
    if (modelsLoaded) return;
    const status = document.getElementById('loading-models');
    if(status) status.innerText = "猫化AIを準備中にゃ... 📷";
    try {
        // モデル読み込み（バックグラウンド）
        const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';
        await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        modelsLoaded = true;
        if(status) status.innerText = "準備完了にゃ！";
        document.getElementById('complete-btn').disabled = false;
    } catch (e) {
        if(status) status.innerText = "手動モードで入学できるにゃ🐾";
        document.getElementById('complete-btn').disabled = false;
    }
}

// 画像のリサイズ処理
async function resizeImageForProcessing(img, maxSize = 400) {
    return new Promise((resolve) => {
        let width = img.width;
        let height = img.height;
        if (width > maxSize || height > maxSize) {
            if (width > height) { height *= maxSize / width; width = maxSize; }
            else { width *= maxSize / height; height = maxSize; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const resizedImg = new Image();
        resizedImg.onload = () => resolve(resizedImg);
        resizedImg.src = canvas.toDataURL('image/jpeg', 0.8);
    });
}

// ★修正: 写真を即座に枠へ描画する (imgがnullならベースのみ描画)
async function drawPreview(userPhotoImg) {
    const canvas = document.getElementById('id-photo-preview-canvas');
    if (!canvas) return;

    // キャンバスサイズを学生証画像の元サイズ(640x400)に固定
    canvas.width = 640; 
    canvas.height = 400;
    const ctx = canvas.getContext('2d');

    // 1. ベースを描画
    // 画像がまだロードされていなければロードを待つ
    if (!idBase.complete) {
        await new Promise(r => idBase.onload = r);
    }
    ctx.drawImage(idBase, 0, 0, 640, 400);

    // 写真がない場合はここで終了（ベースのみ表示）
    if (!userPhotoImg) return;

    // 2. 写真を「左側のグレー枠」の位置に即描画 (トリミング)
    // 枠の座標: 左44px, 上138px, 幅180px, 高さ200px (640x400スケール時)
    const destX = 44, destY = 138, destW = 180, destH = 200;
    
    // 写真を中心でトリミングして描画する計算
    const scale = Math.max(destW / userPhotoImg.width, destH / userPhotoImg.height);
    const cropW = destW / scale;
    const cropH = destH / scale;
    const cropX = (userPhotoImg.width - cropW) / 2;
    const cropY = (userPhotoImg.height - cropH) / 2;

    ctx.save();
    ctx.beginPath();
    ctx.rect(destX, destY, destW, destH); // 枠の形でくり抜く
    ctx.clip(); 
    // 写真を描画
    ctx.drawImage(userPhotoImg, cropX, cropY, cropW, cropH, destX, destY, destW, destH);
    ctx.restore();

    // 3. AIによる猫耳合成 (バックグラウンドで実行・完了したら再描画)
    if (modelsLoaded) {
        // UIを止めないよう少し遅延させる
        setTimeout(async () => {
            try {
                const sourceImg = await resizeImageForProcessing(userPhotoImg, 400);
                const detection = await faceapi.detectSingleFace(sourceImg).withFaceLandmarks();
                
                if (detection) {
                    // ここで本格的な合成処理を入れることも可能ですが、
                    // 「即座に反映」が最優先なので、枠内に写真が出ればOKとします
                    // 余裕があればここにCanvasへの上書き処理を追加
                }
            } catch(e) {}
        }, 50);
    }
}

// テキスト更新 (HTMLオーバーレイを更新)
function updateIDPreview() {
    const nameVal = document.getElementById('new-student-name').value;
    const gradeVal = document.getElementById('new-student-grade').value;
    
    const nameEl = document.getElementById('preview-name');
    const gradeEl = document.getElementById('preview-grade');
    
    if(nameEl) nameEl.innerText = nameVal || "なまえ";
    if(gradeEl) gradeEl.innerText = (gradeVal || "○") + "年生";
}

function setupEnrollmentPhotoInputs() {
    const handleFile = (file) => {
        if (!file) return;
        enrollFile = file;
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => drawPreview(img); // 画像読み込み完了後に描画
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    };

    // アプリ内カメラボタン
    const webCamBtn = document.getElementById('enroll-webcam-btn');
    if (webCamBtn) {
        webCamBtn.addEventListener('click', () => {
            startEnrollmentWebCamera(handleFile);
        });
    }
    // 標準カメラ/アルバム入力
    const camInput = document.getElementById('student-photo-input-camera');
    if (camInput) camInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
    const albInput = document.getElementById('student-photo-input-album');
    if (albInput) albInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
}

let enrollStream = null;
async function startEnrollmentWebCamera(callback) {
    const modal = document.getElementById('camera-modal');
    const video = document.getElementById('camera-video');
    const shutter = document.getElementById('camera-shutter-btn');
    const cancel = document.getElementById('camera-cancel-btn');
    
    if (!modal || !video) return;

    try {
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
        alert("カメラエラー: " + err.message);
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

async function processAndCompleteEnrollment() {
    const name = document.getElementById('new-student-name').value;
    const grade = document.getElementById('new-student-grade').value;
    const btn = document.getElementById('complete-btn');

    if(!name || !grade) return alert("お名前と学年を入れてにゃ！");
    
    btn.disabled = true;
    btn.innerText = "作成中にゃ...";
    await new Promise(r => setTimeout(r, 100));

    try {
        // 保存用にキャンバスの状態を画像化
        const finalCanvas = document.getElementById('id-photo-preview-canvas');
        
        // テキストをキャンバスに焼き付ける（保存用）
        const saveCanvas = document.createElement('canvas');
        saveCanvas.width = 640;
        saveCanvas.height = 400;
        const ctx = saveCanvas.getContext('2d');
        
        // プレビュー画像（ベース+写真）を描画
        ctx.drawImage(finalCanvas, 0, 0);
        
        // 文字を描画 (CSSの位置に合わせて座標調整して焼き付け)
        ctx.fillStyle = "#333"; 
        ctx.font = "bold 32px 'M PLUS Rounded 1c', sans-serif"; 
        
        // CSSでの位置(left:175px, top:84px/126px) は320x200スケールでの値。
        // 保存用キャンバスは640x400なので、座標を2倍にする必要があります。
        ctx.fillText(grade + "年生", 175 * 2, 84 * 2 + 24); // Y座標はベースライン調整
        ctx.fillText(name, 175 * 2, 126 * 2 + 24);

        // データを保存
        const newUser = { 
            id: Date.now(), name, grade, 
            photo: saveCanvas.toDataURL('image/jpeg', 0.6), 
            karikari: 100, 
            history: {}, mistakes: [], attendance: {},
            memory: "" 
        };
        
        users.push(newUser);
        localStorage.setItem('nekoneko_users', JSON.stringify(users)); 
        renderUserList(); 
        
        document.getElementById('new-student-name').value = "";
        document.getElementById('new-student-grade').value = "";
        enrollFile = null;
        updateIDPreview();
        
        alert("入学おめでとうにゃ！🌸");
        switchScreen('screen-gate');

    } catch (err) {
        if (err.name === 'QuotaExceededError') {
            alert("データがいっぱいで保存できないにゃ。古い学生証を削除してにゃ！");
        } else {
            alert("エラーが発生したにゃ……\n" + err.message);
        }
    } finally {
        btn.disabled = false;
        btn.innerText = "入学する！";
    }
}

// ... (renderUserList, login, deleteUser, saveAndSync は変更なし) ...
function renderUserList() { const list = document.getElementById('user-list'); if(!list) return; list.innerHTML = users.length ? "" : "<p style='text-align:right; font-size:0.75rem; opacity:0.5;'>入学してにゃ</p>"; users.forEach(user => { const div = document.createElement('div'); div.className = "user-card"; div.innerHTML = `<img src="${user.photo}"><div class="card-karikari-badge">🍖${user.karikari || 0}</div><button class="delete-student-btn" onclick="deleteUser(event, ${user.id})">×</button>`; div.onclick = () => login(user); list.appendChild(div); }); }
function login(user) { currentUser = user; if (!currentUser.attendance) currentUser.attendance = {}; if (!currentUser.memory) currentUser.memory = ""; const avatar = document.getElementById('current-student-avatar'); if (avatar) avatar.src = user.photo; const karikari = document.getElementById('karikari-count'); if (karikari) karikari.innerText = user.karikari || 0; const today = new Date().toISOString().split('T')[0]; let isBonus = false; if (!currentUser.attendance[today]) { currentUser.attendance[today] = true; let streak = 1; let d = new Date(); while (true) { d.setDate(d.getDate() - 1); const key = d.toISOString().split('T')[0]; if (currentUser.attendance[key]) streak++; else break; } if (streak >= 3) { currentUser.karikari += 100; isBonus = true; } saveAndSync(); } switchScreen('screen-lobby'); if (isBonus) { updateNellMessage("連続出席ボーナス！カリカリ100個プレゼントだにゃ！", "excited"); showKarikariEffect(100); updateMiniKarikari(); } else { updateNellMessage(`おかえり、${user.name}さん！`, "happy"); } }
function deleteUser(e, id) { e.stopPropagation(); if(confirm("この生徒手帳を削除するにゃ？")) { users = users.filter(u => u.id !== id); try { localStorage.setItem('nekoneko_users', JSON.stringify(users)); renderUserList(); } catch(err) {} } }
function saveAndSync() { if (!currentUser) return; const idx = users.findIndex(u => u.id === currentUser.id); if (idx !== -1) users[idx] = currentUser; try { localStorage.setItem('nekoneko_users', JSON.stringify(users)); } catch(err) {} const kCounter = document.getElementById('karikari-count'); if (kCounter) kCounter.innerText = currentUser.karikari; }