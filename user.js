// --- user.js (決定版: 座標微調整) ---

let users = JSON.parse(localStorage.getItem('nekoneko_users')) || [];
let currentUser = null;
let modelsLoaded = false;
let enrollFile = null;

const idBase = new Image();
idBase.src = 'student-id-base.png';

const decoEars = new Image(); decoEars.src = 'ears.png';
const decoMuzzle = new Image(); decoMuzzle.src = 'muzzle.png';

document.addEventListener('DOMContentLoaded', () => {
    renderUserList();
    loadFaceModels();
    setupEnrollmentPhotoInputs();
    
    // 入力イベント設定
    const nameInput = document.getElementById('new-student-name');
    const gradeInput = document.getElementById('new-student-grade');
    if(nameInput) nameInput.addEventListener('input', updateIDPreviewText);
    if(gradeInput) gradeInput.addEventListener('change', updateIDPreviewText);

    updateIDPreviewText();
});

function updateIDPreviewText() {
    const nameVal = document.getElementById('new-student-name').value || "なまえ";
    const gradeVal = document.getElementById('new-student-grade').value || "○";
    
    const nameEl = document.querySelector('.id-name-text');
    const gradeEl = document.querySelector('.id-grade-text');
    
    if(nameEl) nameEl.innerText = nameVal;
    if(gradeEl) gradeEl.innerText = gradeVal + "年生";
}

function updatePhotoPreview(file) {
    enrollFile = file;
    const slot = document.getElementById('id-photo-slot');
    if(!slot) return;

    slot.innerHTML = '';
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover'; // これで縦横比維持しつつ埋める
    slot.appendChild(img);
}

async function loadFaceModels() {
    if (modelsLoaded) return;
    const status = document.getElementById('loading-models');
    if(status) status.innerText = "猫化AIを準備中にゃ... 📷";
    try {
        const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';
        await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        modelsLoaded = true;
        if(status) status.innerText = "準備完了にゃ！";
        const btn = document.getElementById('complete-btn');
        if(btn) btn.disabled = false;
        // 猫耳処理などは一旦省略し、表示優先
    } catch (e) {
        if(status) status.innerText = "手動モードで入学できるにゃ🐾";
        const btn = document.getElementById('complete-btn');
        if(btn) btn.disabled = false;
    }
}

// AI用リサイズ
async function resizeForAI(img, maxSize = 600) {
    return new Promise(resolve => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        if (width > height) {
            if (width > maxSize) { height *= maxSize / width; width = maxSize; }
        } else {
            if (height > maxSize) { width *= maxSize / height; height = maxSize; }
        }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const i = new Image();
        i.onload = () => resolve(i);
        i.src = canvas.toDataURL();
    });
}

function setupEnrollmentPhotoInputs() {
    const handleFile = (file) => {
        if (!file) return;
        updatePhotoPreview(file);
    };

    const webCamBtn = document.getElementById('enroll-webcam-btn');
    if (webCamBtn) {
        const newBtn = webCamBtn.cloneNode(true);
        webCamBtn.parentNode.replaceChild(newBtn, webCamBtn);
        newBtn.addEventListener('click', () => startEnrollmentWebCamera(handleFile));
    }
    
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

        const newShutter = shutter.cloneNode(true);
        shutter.parentNode.replaceChild(newShutter, shutter);
        newShutter.onclick = () => {
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

        const newCancel = cancel.cloneNode(true);
        cancel.parentNode.replaceChild(newCancel, cancel);
        newCancel.onclick = closeEnrollCamera;

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

// ★保存用: 裏でCanvasに全部描画する (座標修正済み)
async function renderForSave() {
    const canvas = document.createElement('canvas');
    canvas.width = 640; 
    canvas.height = 400;
    const ctx = canvas.getContext('2d');

    // 1. ベース
    if (!idBase.complete) {
        await new Promise(r => { idBase.onload = r; idBase.onerror = r; });
    }
    ctx.drawImage(idBase, 0, 0, 640, 400);

    // 2. 写真
    if (enrollFile) {
        try {
            const img = new Image();
            img.src = URL.createObjectURL(enrollFile);
            await new Promise(r => img.onload = r);

            // 枠の座標
            const destX = 44, destY = 138, destW = 180, destH = 200;
            
            // クロップ計算 (object-fit: cover 相当)
            const scale = Math.max(destW / img.width, destH / img.height);
            const cropW = destW / scale;
            const cropH = destH / scale;
            const cropX = (img.width - cropW) / 2;
            const cropY = (img.height - cropH) / 2;

            ctx.save();
            ctx.beginPath();
            ctx.rect(destX, destY, destW, destH);
            ctx.clip(); 
            ctx.drawImage(img, cropX, cropY, cropW, cropH, destX, destY, destW, destH);
            ctx.restore();

            // 猫化AI (保存時に一発合成)
            if (modelsLoaded) {
                const aiImg = await resizeForAI(img);
                const detection = await faceapi.detectSingleFace(aiImg).withFaceLandmarks();
                if (detection) {
                    const landmarks = detection.landmarks;
                    const nose = landmarks.getNose()[3];
                    const leftEyeBrow = landmarks.getLeftEyeBrow()[2];
                    const rightEyeBrow = landmarks.getRightEyeBrow()[2];
                    const aiScale = img.width / aiImg.width;

                    if (decoMuzzle.complete) {
                        const nX = destX + (nose.x * aiScale - cropX) * scale;
                        const nY = destY + (nose.y * aiScale - cropY) * scale;
                        const faceW = detection.detection.box.width * aiScale * scale;
                        const muzW = faceW * 0.8;
                        const muzH = muzW * 0.8;
                        ctx.drawImage(decoMuzzle, nX - muzW/2, nY - muzH/2.5, muzW, muzH);
                    }
                    if (decoEars.complete) {
                        const browX = ((leftEyeBrow.x + rightEyeBrow.x)/2) * aiScale;
                        const browY = ((leftEyeBrow.y + rightEyeBrow.y)/2) * aiScale;
                        const eX = destX + (browX - cropX) * scale;
                        const eY = destY + (browY - cropY) * scale;
                        const faceW = detection.detection.box.width * aiScale * scale;
                        const earW = faceW * 2.2;
                        const earH = earW * 0.7;
                        ctx.drawImage(decoEars, eX - earW/2, eY - earH + 10, earW, earH);
                    }
                }
            }
        } catch(e) { console.error(e); }
    }

    // 3. テキスト (CSSの位置に合わせて座標を修正)
    const nameVal = document.getElementById('new-student-name').value || "なまえ";
    const gradeVal = document.getElementById('new-student-grade').value || "○";
    
    ctx.fillStyle = "#333"; 
    ctx.font = "bold 32px 'M PLUS Rounded 1c', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    // 学年: CSS(46%) -> 400 * 0.46 = 184 (Y=185あたり)
    ctx.fillText(gradeVal + "年生", 350, 190); 
    
    // 名前: CSS(60%) -> 400 * 0.60 = 240 (Y=245あたり)
    ctx.fillText(nameVal, 350, 250);

    return canvas;
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
        const saveCanvas = await renderForSave();
        
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
        updateIDPreviewText();
        const slot = document.getElementById('id-photo-slot');
        if(slot) slot.innerHTML = '';
        
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

// 既存関数
function renderUserList() { const list = document.getElementById('user-list'); if(!list) return; list.innerHTML = users.length ? "" : "<p style='text-align:right; font-size:0.75rem; opacity:0.5;'>入学してにゃ</p>"; users.forEach(user => { const div = document.createElement('div'); div.className = "user-card"; div.innerHTML = `<img src="${user.photo}"><div class="card-karikari-badge">🍖${user.karikari || 0}</div><button class="delete-student-btn" onclick="deleteUser(event, ${user.id})">×</button>`; div.onclick = () => login(user); list.appendChild(div); }); }
function login(user) { currentUser = user; if (!currentUser.attendance) currentUser.attendance = {}; if (!currentUser.memory) currentUser.memory = ""; const avatar = document.getElementById('current-student-avatar'); if (avatar) avatar.src = user.photo; const karikari = document.getElementById('karikari-count'); if (karikari) karikari.innerText = user.karikari || 0; const today = new Date().toISOString().split('T')[0]; let isBonus = false; if (!currentUser.attendance[today]) { currentUser.attendance[today] = true; let streak = 1; let d = new Date(); while (true) { d.setDate(d.getDate() - 1); const key = d.toISOString().split('T')[0]; if (currentUser.attendance[key]) streak++; else break; } if (streak >= 3) { currentUser.karikari += 100; isBonus = true; } saveAndSync(); } switchScreen('screen-lobby'); if (isBonus) { updateNellMessage("連続出席ボーナス！カリカリ100個プレゼントだにゃ！", "excited"); showKarikariEffect(100); updateMiniKarikari(); } else { updateNellMessage(`おかえり、${user.name}さん！`, "happy"); } }
function deleteUser(e, id) { e.stopPropagation(); if(confirm("この生徒手帳を削除するにゃ？")) { users = users.filter(u => u.id !== id); try { localStorage.setItem('nekoneko_users', JSON.stringify(users)); renderUserList(); } catch(err) {} } }
function saveAndSync() { if (!currentUser) return; const idx = users.findIndex(u => u.id === currentUser.id); if (idx !== -1) users[idx] = currentUser; try { localStorage.setItem('nekoneko_users', JSON.stringify(users)); } catch(err) {} const kCounter = document.getElementById('karikari-count'); if (kCounter) kCounter.innerText = currentUser.karikari; }