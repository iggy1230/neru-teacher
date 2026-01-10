// --- user.js (修正版: 画像なりゆき保存対応) ---

let users = JSON.parse(localStorage.getItem('nekoneko_users')) || [];
let currentUser = null;
let modelsLoaded = false;
let enrollFile = null;

const idBase = new Image();
idBase.crossOrigin = "Anonymous"; 
idBase.src = 'student-id-base.png?' + new Date().getTime();

const decoEars = new Image(); 
decoEars.crossOrigin = "Anonymous";
decoEars.src = 'ears.png?' + new Date().getTime();

const decoMuzzle = new Image(); 
decoMuzzle.crossOrigin = "Anonymous";
decoMuzzle.src = 'muzzle.png?' + new Date().getTime();

document.addEventListener('DOMContentLoaded', () => {
    renderUserList();
    loadFaceModels();
    setupEnrollmentPhotoInputs();
    setupTextInputEvents();
    updateIDPreviewText();
});

function setupTextInputEvents() {
    const nameInput = document.getElementById('new-student-name');
    const gradeInput = document.getElementById('new-student-grade');
    if (nameInput) nameInput.oninput = updateIDPreviewText;
    if (gradeInput) gradeInput.onchange = updateIDPreviewText;
}

function updateIDPreviewText() {
    const nameVal = document.getElementById('new-student-name').value;
    const gradeVal = document.getElementById('new-student-grade').value;
    const nameEl = document.querySelector('.id-name-text');
    const gradeEl = document.querySelector('.id-grade-text');
    if (nameEl) nameEl.innerText = nameVal ? nameVal : "";
    if (gradeEl) gradeEl.innerText = gradeVal ? (gradeVal + "年生") : "";
}

function updatePhotoPreview(file) {
    enrollFile = file;
    const slot = document.getElementById('id-photo-slot');
    if (!slot) return;
    slot.innerHTML = '';
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    slot.appendChild(img);
}

function setupEnrollmentPhotoInputs() {
    const handleFile = (file) => {
        if (!file) return;
        updatePhotoPreview(file);
    };
    const webCamBtn = document.getElementById('enroll-webcam-btn');
    if (webCamBtn) webCamBtn.onclick = () => { startEnrollmentWebCamera(handleFile); };
    const camInput = document.getElementById('student-photo-input-camera');
    if (camInput) camInput.onchange = (e) => handleFile(e.target.files[0]);
    const albInput = document.getElementById('student-photo-input-album');
    if (albInput) albInput.onchange = (e) => handleFile(e.target.files[0]);
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
    } catch (e) {
        if(status) status.innerText = "手動モードで入学できるにゃ🐾";
        const btn = document.getElementById('complete-btn');
        if(btn) btn.disabled = false;
    }
}

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

let enrollStream = null;
async function startEnrollmentWebCamera(callback) {
    const modal = document.getElementById('camera-modal');
    const video = document.getElementById('camera-video');
    const shutter = document.getElementById('camera-shutter-btn');
    const cancel = document.getElementById('camera-cancel-btn');
    if (!modal || !video) return;
    try {
        let constraints = { video: { facingMode: "user" } };
        try { enrollStream = await navigator.mediaDevices.getUserMedia(constraints); } 
        catch (e) { enrollStream = await navigator.mediaDevices.getUserMedia({ video: true }); }
        video.srcObject = enrollStream;
        video.setAttribute('playsinline', true); 
        await video.play();
        modal.classList.remove('hidden');
        shutter.onclick = () => {
            const canvas = document.getElementById('camera-canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => {
                if(blob) {
                    const file = new File([blob], "enroll_capture.jpg", { type: "image/jpeg" });
                    closeEnrollCamera();
                    callback(file);
                }
            }, 'image/jpeg', 0.9);
        };
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

// ★修正: 画像なりゆき保存対応
// 元画像のサイズに合わせてCanvasを作成し、座標も比率に合わせて計算する
async function renderForSave() {
    // 1. ベース画像を読み込む
    const img = new Image();
    img.crossOrigin = "Anonymous";
    
    try {
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = 'student-id-base.png?' + new Date().getTime();
        });
    } catch (e) {
        console.error("Base image error:", e);
        return null;
    }

    // 2. Canvasサイズを画像本来のサイズに設定（これで歪まない！）
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');

    // 3. 座標計算用の比率を算出 (基準: 640x400)
    const BASE_W = 640;
    const BASE_H = 400;
    const rx = canvas.width / BASE_W;
    const ry = canvas.height / BASE_H;

    // 背景描画
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // 4. 写真描画（比率に合わせて座標変換）
    if (enrollFile) {
        try {
            const photoImg = new Image();
            photoImg.src = URL.createObjectURL(enrollFile);
            await new Promise(r => photoImg.onload = r);

            // 基準座標(640x400用)
            // 枠: x35, y143, w195, h180
            const destX = 35 * rx;
            const destY = 143 * ry;
            const destW = 195 * rx;
            const destH = 180 * ry;
            
            // アスペクト比維持のためのクロップ計算
            const scale = Math.max(destW / photoImg.width, destH / photoImg.height);
            const cropW = destW / scale;
            const cropH = destH / scale;
            const cropX = (photoImg.width - cropW) / 2;
            const cropY = (photoImg.height - cropH) / 2;

            ctx.save();
            ctx.beginPath();
            // 角丸も比率に合わせて少し調整
            ctx.roundRect(destX, destY, destW, destH, 2 * rx);
            ctx.clip(); 
            ctx.drawImage(photoImg, cropX, cropY, cropW, cropH, destX, destY, destW, destH);
            ctx.restore();

            // 猫化AI (座標変換あり)
            if (modelsLoaded) {
                const aiImg = await resizeForAI(photoImg);
                const detection = await faceapi.detectSingleFace(aiImg).withFaceLandmarks();
                if (detection) {
                    const landmarks = detection.landmarks;
                    const nose = landmarks.getNose()[3];
                    const leftEyeBrow = landmarks.getLeftEyeBrow()[2];
                    const rightEyeBrow = landmarks.getRightEyeBrow()[2];
                    const aiScale = photoImg.width / aiImg.width;
                    
                    try {
                        if (decoMuzzle.complete) {
                            // 鼻位置計算
                            const nX = destX + (nose.x * aiScale - cropX) * scale;
                            const nY = destY + (nose.y * aiScale - cropY) * scale;
                            // マズルサイズ計算
                            const faceW = detection.detection.box.width * aiScale * scale;
                            const muzW = faceW * 0.8;
                            const muzH = muzW * 0.8;
                            ctx.drawImage(decoMuzzle, nX - muzW/2, nY - muzH/2.5, muzW, muzH);
                        }
                        if (decoEars.complete) {
                            // 耳位置計算
                            const browX = ((leftEyeBrow.x + rightEyeBrow.x)/2) * aiScale;
                            const browY = ((leftEyeBrow.y + rightEyeBrow.y)/2) * aiScale;
                            const eX = destX + (browX - cropX) * scale;
                            const eY = destY + (browY - cropY) * scale;
                            const faceW = detection.detection.box.width * aiScale * scale;
                            const earW = faceW * 2.2;
                            const earH = earW * 0.7;
                            ctx.drawImage(decoEars, eX - earW/2, eY - earH + (10 * ry), earW, earH);
                        }
                    } catch(ex) {}
                }
            }
        } catch(e) { console.error(e); }
    }

    // 5. テキスト描画（比率に合わせて座標とフォントサイズ変換）
    const nameVal = document.getElementById('new-student-name').value;
    const gradeVal = document.getElementById('new-student-grade').value;
    
    ctx.fillStyle = "#333"; 
    // フォントサイズも画像の幅に合わせてスケール (基準32px)
    const fontSize = 32 * rx;
    ctx.font = `bold ${fontSize}px 'M PLUS Rounded 1c', sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    // テキスト基準座標
    const textX = 346 * rx;
    
    // Y座標調整済み: 168, 231
    if (gradeVal) ctx.fillText(gradeVal + "年生", textX, 168 * ry); 
    if (nameVal) ctx.fillText(nameVal, textX, 231 * ry);

    try {
        return canvas.toDataURL('image/png');
    } catch (e) {
        console.error("Canvas export failed:", e);
        return null;
    }
}

async function processAndCompleteEnrollment() {
    const name = document.getElementById('new-student-name').value;
    const grade = document.getElementById('new-student-grade').value;
    const btn = document.getElementById('complete-btn');

    if(!name || !grade) return alert("お名前と学年を入れてにゃ！");
    
    btn.disabled = true;
    btn.innerText = "作成中にゃ...";
    await new Promise(r => setTimeout(r, 100));

    // 画像生成を実行
    const photoData = await renderForSave();

    let finalPhoto = photoData;
    if (!finalPhoto) {
        alert("画像の保存に失敗しちゃったけど、入学手続きは進めるにゃ！");
        finalPhoto = "student-id-base.png"; 
    }

    try {
        const newUser = { 
            id: Date.now(), name, grade, 
            photo: finalPhoto, 
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
            alert("データがいっぱいです。古い学生証を削除してください。");
        } else {
            alert("エラーが発生したにゃ……\n" + err.message);
        }
    } finally {
        btn.disabled = false;
        btn.innerText = "入学する！";
    }
}

function renderUserList() { const list = document.getElementById('user-list'); if(!list) return; list.innerHTML = users.length ? "" : "<p style='text-align:right; font-size:0.75rem; opacity:0.5;'>入学してにゃ</p>"; users.forEach(user => { const div = document.createElement('div'); div.className = "user-card"; div.innerHTML = `<img src="${user.photo}"><div class="card-karikari-badge">🍖${user.karikari || 0}</div><button class="delete-student-btn" onclick="deleteUser(event, ${user.id})">×</button>`; div.onclick = () => login(user); list.appendChild(div); }); }
function login(user) { currentUser = user; if (!currentUser.attendance) currentUser.attendance = {}; if (!currentUser.memory) currentUser.memory = ""; const avatar = document.getElementById('current-student-avatar'); if (avatar) avatar.src = user.photo; const karikari = document.getElementById('karikari-count'); if (karikari) karikari.innerText = user.karikari || 0; const today = new Date().toISOString().split('T')[0]; let isBonus = false; if (!currentUser.attendance[today]) { currentUser.attendance[today] = true; let streak = 1; let d = new Date(); while (true) { d.setDate(d.getDate() - 1); const key = d.toISOString().split('T')[0]; if (currentUser.attendance[key]) streak++; else break; } if (streak >= 3) { currentUser.karikari += 100; isBonus = true; } saveAndSync(); } switchScreen('screen-lobby'); if (isBonus) { updateNellMessage("連続出席ボーナス！カリカリ100個プレゼントだにゃ！", "excited"); showKarikariEffect(100); updateMiniKarikari(); } else { updateNellMessage(`おかえり、${user.name}さん！`, "happy"); } }
function deleteUser(e, id) { e.stopPropagation(); if(confirm("この生徒手帳を削除するにゃ？")) { users = users.filter(u => u.id !== id); try { localStorage.setItem('nekoneko_users', JSON.stringify(users)); renderUserList(); } catch(err) {} } }
function saveAndSync() { if (!currentUser) return; const idx = users.findIndex(u => u.id === currentUser.id); if (idx !== -1) users[idx] = currentUser; try { localStorage.setItem('nekoneko_users', JSON.stringify(users)); } catch(err) {} const kCounter = document.getElementById('karikari-count'); if (kCounter) kCounter.innerText = currentUser.karikari; }