// --- user.js (完全版 v87.0: 制限解除・位置修正) ---

let users = JSON.parse(localStorage.getItem('nekoneko_users')) || [];
let currentUser = null;
let modelsLoaded = false;
let enrollFile = null;

const sfxDoor = new Audio('class_door1.mp3');

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
        if(status) status.innerText = "AI準備完了にゃ！";
        if(btn) btn.disabled = false;
        
        if(enrollFile) updatePhotoPreview(enrollFile);

    } catch (e) {
        console.error("Model Load Error:", e);
        if(status) status.innerText = "AIの準備に失敗したにゃ…(手動モード)";
        if(btn) btn.disabled = false;
    }
}

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

async function updatePhotoPreview(file) {
    enrollFile = file;
    const slot = document.getElementById('id-photo-slot');
    if (!slot) return;

    slot.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#666;font-size:0.8rem;font-weight:bold;">🐱 加工中にゃ...</div>';

    const img = new Image();
    img.src = URL.createObjectURL(file);
    await new Promise(r => img.onload = r);

    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.objectFit = 'cover'; 
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    
    slot.innerHTML = '';
    slot.appendChild(canvas);

    if (modelsLoaded) {
        try {
            const aiImg = await resizeForAI(img);
            const options = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 });
            const detection = await faceapi.detectSingleFace(aiImg, options).withFaceLandmarks();
            
            if (detection) {
                const landmarks = detection.landmarks;
                const nose = landmarks.getNose()[3];
                const leftEyeBrow = landmarks.getLeftEyeBrow()[2];
                const rightEyeBrow = landmarks.getRightEyeBrow()[2];

                const scale = img.width / aiImg.width;

                if (decoMuzzle.complete) {
                    const nX = nose.x * scale;
                    const nY = nose.y * scale;
                    const faceW = detection.detection.box.width * scale;
                    const muzW = faceW * 0.8;
                    const muzH = muzW * 0.8;
                    ctx.drawImage(decoMuzzle, nX - muzW/2, nY - muzH/2.5, muzW, muzH);
                }

                if (decoEars.complete) {
                    const browX = ((leftEyeBrow.x + rightEyeBrow.x)/2) * scale;
                    const browY = ((leftEyeBrow.y + rightEyeBrow.y)/2) * scale;
                    const faceW = detection.detection.box.width * scale;
                    
                    const earW = faceW * 1.7;
                    const earH = earW * 0.7;
                    const earOffset = earH * 0.35; 
                    
                    ctx.drawImage(decoEars, browX - earW/2, browY - earH + earOffset, earW, earH);
                }
            }
        } catch (e) {
            console.error("Preview AI Error:", e);
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
            
            const scale = Math.max(destW / photoImg.width, destH / photoImg.height);
            const cropW = destW / scale;
            const cropH = destH / scale;
            const cropX = (photoImg.width - cropW) / 2;
            const cropY = (photoImg.height - cropH) / 2;

            ctx.save();
            ctx.beginPath();
            ctx.roundRect(destX, destY, destW, destH, 2 * rx);
            ctx.clip(); 
            ctx.drawImage(photoImg, cropX, cropY, cropW, cropH, destX, destY, destW, destH);
            ctx.restore();

            if (modelsLoaded) {
                const aiImg = await resizeForAI(photoImg);
                const options = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 });
                const detection = await faceapi.detectSingleFace(aiImg, options).withFaceLandmarks();
                
                if (detection) {
                    const landmarks = detection.landmarks;
                    const nose = landmarks.getNose()[3];
                    const leftEyeBrow = landmarks.getLeftEyeBrow()[2];
                    const rightEyeBrow = landmarks.getRightEyeBrow()[2];
                    const aiScale = photoImg.width / aiImg.width;

                    const transX = (val) => (val - cropX) * scale + destX;
                    const transY = (val) => (val - cropY) * scale + destY;
                    const transS = (val) => val * scale;

                    if (decoMuzzle.complete) {
                        const nX = transX(nose.x * aiScale);
                        const nY = transY(nose.y * aiScale);
                        const faceW = transS(detection.detection.box.width * aiScale);
                        const muzW = faceW * 0.8;
                        const muzH = muzW * 0.8;
                        ctx.drawImage(decoMuzzle, nX - muzW/2, nY - muzH/2.5, muzW, muzH);
                    }
                    
                    if (decoEars.complete) {
                        const browX = transX(((leftEyeBrow.x + rightEyeBrow.x)/2) * aiScale);
                        const browY = transY(((leftEyeBrow.y + rightEyeBrow.y)/2) * aiScale);
                        const faceW = transS(detection.detection.box.width * aiScale);
                        
                        const earW = faceW * 1.7;
                        const earH = earW * 0.7;
                        const earOffset = earH * 0.35;

                        ctx.drawImage(decoEars, browX - earW/2, browY - earH + earOffset, earW, earH);
                    }
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

    // ★修正: テキスト位置微調整
    const textX = 346 * rx;
    if (gradeVal) ctx.fillText(gradeVal + "年生", textX, 168 * ry + 1); // +1px
    if (nameVal) ctx.fillText(nameVal, textX, 231 * ry + 2); // +2px

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
    let finalPhoto = photoData || "student-id-base.png"; 

    try {
        const newUser = { 
            id: Date.now(), name, grade, 
            photo: finalPhoto, 
            karikari: 100, 
            history: {}, mistakes: [], attendance: {},
            memory: "" 
        };
        
        // ★修正: 制限解除 (ただしブラウザ容量制限は避けられない)
        users.push(newUser);
        localStorage.setItem('nekoneko_users', JSON.stringify(users)); 
        
        window.justEnrolledId = newUser.id;
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
        alert("エラーが発生したにゃ……\n" + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = "入学する！";
    }
}

function renderUserList() { 
    const list = document.getElementById('user-list'); 
    if(!list) return; 
    list.innerHTML = users.length ? "" : "<p style='text-align:center; width:100%; color:white; font-weight:bold; opacity:0.8;'>まだ誰もいないにゃ</p>"; 
    
    users.forEach(user => { 
        const div = document.createElement('div'); 
        div.className = "user-card"; 
        div.innerHTML = `<img src="${user.photo}"><div class="card-karikari-badge">🍖${user.karikari || 0}</div><button class="delete-student-btn" onclick="deleteUser(event, ${user.id})">×</button>`; 
        div.onclick = () => login(user); 
        list.appendChild(div); 
    }); 
}

function login(user) { 
    try { sfxDoor.currentTime = 0; sfxDoor.play(); } catch(e){}

    currentUser = user; 
    if (!currentUser.attendance) currentUser.attendance = {}; 
    const avatar = document.getElementById('current-student-avatar'); 
    if (avatar) avatar.src = user.photo; 
    const karikari = document.getElementById('karikari-count'); 
    if (karikari) karikari.innerText = user.karikari || 0; 
    
    const today = new Date().toISOString().split('T')[0]; 
    let isBonus = false; 
    if (!currentUser.attendance[today]) { 
        currentUser.attendance[today] = true; 
        saveAndSync(); 
    } 
    
    switchScreen('screen-lobby'); 
    
    if (window.justEnrolledId === user.id) {
        updateNellMessage(`${user.name}さん、入学おめでとうだにゃ！`, "excited");
        window.justEnrolledId = null; 
    } else { 
        updateNellMessage(`おかえり、${user.name}さん！`, "happy"); 
    } 
}

function deleteUser(e, id) { e.stopPropagation(); if(confirm("この生徒手帳を削除するにゃ？")) { users = users.filter(u => u.id !== id); try { localStorage.setItem('nekoneko_users', JSON.stringify(users)); renderUserList(); } catch(err) {} } }
function saveAndSync() { if (!currentUser) return; const idx = users.findIndex(u => u.id === currentUser.id); if (idx !== -1) users[idx] = currentUser; try { localStorage.setItem('nekoneko_users', JSON.stringify(users)); } catch(err) {} const kCounter = document.getElementById('karikari-count'); if (kCounter) kCounter.innerText = currentUser.karikari; }