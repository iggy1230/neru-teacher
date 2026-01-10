// --- user.js (修正版: 猫耳サイズ1.7 & 位置微調整0.35) ---

let users = JSON.parse(localStorage.getItem('nekoneko_users')) || [];
let currentUser = null;
let modelsLoaded = false;
let enrollFile = null;

// 画像リソース
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

// AIモデル読み込み
async function loadFaceModels() {
    if (modelsLoaded) return;
    const status = document.getElementById('loading-models');
    const btn = document.getElementById('complete-btn');

    if(status) status.innerText = "猫化AIを準備中にゃ... 📷";
    if(btn) btn.disabled = true;

    try {
        const MODEL_URL = 'https://cdn.jsdelivr.net/gh/cgarciagl/face-api.js@0.22.2/weights';
        await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        
        modelsLoaded = true;
        console.log("FaceAPI Models Loaded!");
        
        if(status) status.innerText = "AI準備完了にゃ！";
        if(btn) btn.disabled = false;
        
        if(enrollFile) updatePhotoPreview(enrollFile);

    } catch (e) {
        console.error("Model Load Error:", e);
        if(status) status.innerText = "AIの準備に失敗したにゃ…(手動モード)";
        if(btn) btn.disabled = false;
    }
}

// AI用リサイズ (800pxで認識精度維持)
async function resizeForAI(img, maxSize = 800) {
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
        resolve(canvas);
    });
}

// 顔中心トリミング計算
function calculateFaceCrop(imgW, imgH, detection, targetRatioW_H) {
    if (!detection) {
        let cropW = imgW;
        let cropH = cropW / targetRatioW_H;
        if (cropH > imgH) {
            cropH = imgH;
            cropW = cropH * targetRatioW_H;
        }
        return {
            x: (imgW - cropW) / 2,
            y: (imgH - cropH) / 2,
            w: cropW,
            h: cropH
        };
    }

    const box = detection.detection.box;
    const faceCX = box.x + box.width / 2;
    const faceCY = box.y + box.height / 2;

    const FACE_SCALE_TARGET = 0.55;
    
    let cropW = box.width / FACE_SCALE_TARGET;
    let cropH = cropW / targetRatioW_H;

    if (cropW > imgW) {
        cropW = imgW;
        cropH = cropW / targetRatioW_H;
    }
    if (cropH > imgH) {
        cropH = imgH;
        cropW = cropH * targetRatioW_H;
    }

    let sx = faceCX - cropW / 2;
    let sy = faceCY - cropH / 2;

    if (sx < 0) sx = 0;
    if (sy < 0) sy = 0;
    if (sx + cropW > imgW) sx = imgW - cropW;
    if (sy + cropH > imgH) sy = imgH - cropH;

    return { x: sx, y: sy, w: cropW, h: cropH };
}

// プレビュー更新
async function updatePhotoPreview(file) {
    enrollFile = file;
    const slot = document.getElementById('id-photo-slot');
    if (!slot) return;

    slot.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#666;font-size:0.8rem;font-weight:bold;">🐱 顔を探してるにゃ...</div>';

    const img = new Image();
    img.src = URL.createObjectURL(file);
    await new Promise(r => img.onload = r);

    let detection = null;
    let aiImg = null;
    
    if (modelsLoaded) {
        try {
            aiImg = await resizeForAI(img);
            // minConfidence: 0.3 で端の顔も認識
            const options = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 });
            detection = await faceapi.detectSingleFace(aiImg, options).withFaceLandmarks();
        } catch (e) { console.error(e); }
    }

    const slotRect = slot.getBoundingClientRect();
    const targetAspect = slotRect.width / slotRect.height || 0.68;

    const aiScale = aiImg ? (img.width / aiImg.width) : 1;
    
    let scaledDetection = null;
    if (detection) {
        const box = detection.detection.box;
        scaledDetection = {
            detection: {
                box: {
                    x: box.x * aiScale,
                    y: box.y * aiScale,
                    width: box.width * aiScale,
                    height: box.height * aiScale
                }
            }
        };
    }

    const crop = calculateFaceCrop(img.width, img.height, scaledDetection, targetAspect);

    const canvas = document.createElement('canvas');
    canvas.width = slotRect.width * 2;
    canvas.height = slotRect.height * 2;
    
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.objectFit = 'contain';
    
    const ctx = canvas.getContext('2d');
    
    ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height);
    
    slot.innerHTML = '';
    slot.appendChild(canvas);

    if (detection) {
        const landmarks = detection.landmarks;
        const nose = landmarks.getNose()[3];
        const leftEyeBrow = landmarks.getLeftEyeBrow()[2];
        const rightEyeBrow = landmarks.getRightEyeBrow()[2];

        const drawScale = canvas.width / crop.w;

        const transX = (x) => (x * aiScale - crop.x) * drawScale;
        const transY = (y) => (y * aiScale - crop.y) * drawScale;
        const transW = (w) => (w * aiScale) * drawScale;

        if (decoMuzzle.complete) {
            const nX = transX(nose.x);
            const nY = transY(nose.y);
            const faceW = transW(detection.detection.box.width);
            const muzW = faceW * 0.8;
            const muzH = muzW * 0.8;
            ctx.drawImage(decoMuzzle, nX - muzW/2, nY - muzH/2.5, muzW, muzH);
        }

        if (decoEars.complete) {
            const browX = transX((leftEyeBrow.x + rightEyeBrow.x)/2);
            const browY = transY((leftEyeBrow.y + rightEyeBrow.y)/2);
            const faceW = transW(detection.detection.box.width);
            
            // ★修正: 耳サイズ係数 1.9 -> 1.7
            const earW = faceW * 1.7;
            const earH = earW * 0.7;
            
            // ★修正: オフセット係数 0.45 -> 0.35 (浅く被る)
            const earOffset = earH * 0.35; 
            
            ctx.drawImage(decoEars, browX - earW/2, browY - earH + earOffset, earW, earH);
        }
    }
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

// 保存処理: 顔オートズーム＆合成対応
async function renderForSave() {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    
    try {
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = 'student-id-base.png?' + new Date().getTime();
        });
    } catch (e) { return null; }

    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');

    const BASE_W = 640;
    const BASE_H = 400;
    const rx = canvas.width / BASE_W;
    const ry = canvas.height / BASE_H;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    if (enrollFile) {
        try {
            const photoImg = new Image();
            photoImg.src = URL.createObjectURL(enrollFile);
            await new Promise(r => photoImg.onload = r);

            const destX = 35 * rx;
            const destY = 143 * ry;
            const destW = 195 * rx;
            const destH = 180 * ry;
            
            const targetAspect = destW / destH;

            let detection = null;
            let aiImg = null;
            let aiScale = 1;

            if (modelsLoaded) {
                // 保存時も800px & 0.3
                aiImg = await resizeForAI(photoImg);
                const options = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 });
                detection = await faceapi.detectSingleFace(aiImg, options).withFaceLandmarks();
                aiScale = photoImg.width / aiImg.width;
            }

            let scaledDetection = null;
            if (detection) {
                const box = detection.detection.box;
                scaledDetection = {
                    detection: {
                        box: {
                            x: box.x * aiScale,
                            y: box.y * aiScale,
                            width: box.width * aiScale,
                            height: box.height * aiScale
                        }
                    }
                };
            }

            const crop = calculateFaceCrop(photoImg.width, photoImg.height, scaledDetection, targetAspect);

            ctx.save();
            ctx.beginPath();
            ctx.roundRect(destX, destY, destW, destH, 2 * rx);
            ctx.clip(); 
            ctx.drawImage(photoImg, crop.x, crop.y, crop.w, crop.h, destX, destY, destW, destH);
            ctx.restore();

            if (detection) {
                const landmarks = detection.landmarks;
                const nose = landmarks.getNose()[3];
                const leftEyeBrow = landmarks.getLeftEyeBrow()[2];
                const rightEyeBrow = landmarks.getRightEyeBrow()[2];

                const drawScale = destW / crop.w;

                const transX = (x) => (x * aiScale - crop.x) * drawScale + destX;
                const transY = (y) => (y * aiScale - crop.y) * drawScale + destY;
                const transW = (w) => (w * aiScale) * drawScale;

                if (decoMuzzle.complete) {
                    const nX = transX(nose.x);
                    const nY = transY(nose.y);
                    const faceW = transW(detection.detection.box.width);
                    const muzW = faceW * 0.8;
                    const muzH = muzW * 0.8;
                    ctx.drawImage(decoMuzzle, nX - muzW/2, nY - muzH/2.5, muzW, muzH);
                }
                
                if (decoEars.complete) {
                    const browX = transX((leftEyeBrow.x + rightEyeBrow.x)/2);
                    const browY = transY((leftEyeBrow.y + rightEyeBrow.y)/2);
                    const faceW = transW(detection.detection.box.width);
                    
                    // ★修正: サイズ1.7
                    const earW = faceW * 1.7;
                    const earH = earW * 0.7;

                    // ★修正: オフセット0.35
                    const earOffset = earH * 0.35;

                    ctx.drawImage(decoEars, browX - earW/2, browY - earH + earOffset, earW, earH);
                }
            }
        } catch(e) { console.error(e); }
    }

    const nameVal = document.getElementById('new-student-name').value;
    const gradeVal = document.getElementById('new-student-grade').value;
    
    ctx.fillStyle = "#333"; 
    const fontSize = 32 * rx;
    ctx.font = `bold ${fontSize}px 'M PLUS Rounded 1c', sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const textX = 346 * rx;
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