// --- js/state/user.js (v452.2: グローバル変数公開修正版) ---

// Firebase初期化
let app, auth, db, storage;
if (typeof firebaseConfig === 'undefined') {
    console.warn("firebase-config.js が読み込まれていないか、設定されていません。");
} else {
    if (typeof firebase !== 'undefined' && !firebase.apps.length) {
        app = firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        db = firebase.firestore();
        storage = firebase.storage();
    } else if (typeof firebase !== 'undefined') {
        app = firebase.app();
        auth = firebase.auth();
        db = firebase.firestore();
        storage = firebase.storage();
    }
}

// ★修正: データベースと認証情報を他のファイルからも使えるようにする
window.fireStorage = storage;
window.db = db;
window.auth = auth;

let users = JSON.parse(localStorage.getItem('nekoneko_users')) || [];
let currentUser = null;
let modelsLoaded = false;
let enrollFile = null;

window.isEditMode = false;
window.isEditingInitialized = false;
window.isGoogleEnrollment = false;

// 画像リソース
const sfxDoor = new Audio('assets/sounds/system/class_door1.mp3');
const idBase = new Image(); idBase.crossOrigin = "Anonymous"; 
idBase.src = 'assets/images/items/student-id-base.png?' + new Date().getTime();
const decoEars = new Image(); decoEars.crossOrigin = "Anonymous"; 
decoEars.src = 'assets/images/items/ears.png?' + new Date().getTime();
const decoMuzzle = new Image(); decoMuzzle.crossOrigin = "Anonymous"; 
decoMuzzle.src = 'assets/images/items/muzzle.png?' + new Date().getTime();

// ヘルパー関数
function loadImageWithTimeout(src, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        const timer = setTimeout(() => { img.src = ""; reject(new Error("Image load timeout")); }, timeout);
        img.onload = () => { clearTimeout(timer); resolve(img); };
        img.onerror = (err) => { clearTimeout(timer); reject(err); };
        img.src = src;
    });
}

document.addEventListener('DOMContentLoaded', () => {
    renderUserList();
    if(typeof loadFaceModels === 'function') loadFaceModels();
    setupEnrollmentPhotoInputs();
    setupTextInputEvents();
    updateIDPreviewText();
    
    if (auth) {
        auth.onAuthStateChanged(async (user) => {
            if (user) {
                const doc = await db.collection("users").doc(user.uid).get();
                if (doc.exists) {
                    const userData = doc.data();
                    updateLocalUserList(userData);
                    if (!currentUser) {
                        currentUser = userData;
                        if (currentUser.isGoogleUser === undefined) currentUser.isGoogleUser = !user.isAnonymous;
                        if (!currentUser.quizLevels) currentUser.quizLevels = { "全ジャンル": 1 };
                        if (!currentUser.savedQuizzes) currentUser.savedQuizzes = [];
                        if (currentUser.totalLunchGiven === undefined) currentUser.totalLunchGiven = 0;
                        login(currentUser, true); 
                    }
                }
            }
        });
    }
});

function updateLocalUserList(userData) {
    const idx = users.findIndex(u => u.id === userData.id);
    if (idx !== -1) users[idx] = userData; else users.push(userData);
    localStorage.setItem('nekoneko_users', JSON.stringify(users));
    renderUserList();
}

window.logoutProcess = async function() {
    if (auth && currentUser) { try { await auth.signOut(); } catch(e) { console.error("Logout Error:", e); } }
    currentUser = null;
};

window.startGoogleLogin = function() {
    if (!auth) return alert("Firebaseの設定ファイルが見つからないにゃ！");
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).then(async (result) => {
        const user = result.user;
        const doc = await db.collection("users").doc(user.uid).get();
        if (doc.exists) {
            currentUser = doc.data();
            currentUser.isGoogleUser = true; 
            if (!currentUser.quizLevels) currentUser.quizLevels = { "全ジャンル": 1 };
            if (!currentUser.savedQuizzes) currentUser.savedQuizzes = [];
            if (currentUser.totalLunchGiven === undefined) currentUser.totalLunchGiven = 0;
            login(currentUser, true);
        } else {
            currentUser = { 
                id: user.uid, 
                isGoogleUser: true, 
                quizLevels: { "全ジャンル": 1 },
                savedQuizzes: [],
                totalLunchGiven: 0 
            };
            window.isGoogleEnrollment = true;
            alert("はじめましてだにゃ！\nGoogleアカウントで入学手続きをするにゃ！");
            showEnrollment();
        }
    }).catch((error) => { alert("ログインに失敗したにゃ...\n" + error.message); });
};

function setupTextInputEvents() {
    const nameInput = document.getElementById('new-student-name');
    const gradeInput = document.getElementById('new-student-grade');
    if (nameInput) nameInput.oninput = () => { resetPreviewForEditing(); updateIDPreviewText(); };
    if (gradeInput) gradeInput.onchange = () => { resetPreviewForEditing(); updateIDPreviewText(); };
}

function resetPreviewForEditing() {
    if (!window.isEditMode || window.isEditingInitialized) return;
    window.isEditingInitialized = true;
    const baseImg = document.getElementById('id-base-preview');
    if (baseImg) baseImg.src = 'assets/images/items/student-id-base.png';
    const nameEl = document.querySelector('.id-name-text');
    const gradeEl = document.querySelector('.id-grade-text');
    if (nameEl) nameEl.style.display = 'block';
    if (gradeEl) gradeEl.style.display = 'block';
    const slot = document.getElementById('id-photo-slot');
    if (slot) {
        slot.style.display = 'block';
        if (!enrollFile && currentUser && currentUser.photo) {
            slot.innerHTML = "";
            const img = document.createElement('img');
            img.src = currentUser.photo;
            img.style.position = "absolute";
            img.style.width = "327.87%"; img.style.height = "222.22%"; 
            img.style.left = "-18.03%"; img.style.top = "-79.44%";    
            img.style.maxWidth = "none"; img.style.maxHeight = "none"; img.style.objectFit = "fill"; 
            slot.appendChild(img);
        } else if (!enrollFile) {
            slot.innerHTML = "";
        }
    }
}

function updateIDPreviewText() {
    const nameVal = document.getElementById('new-student-name').value;
    const gradeVal = document.getElementById('new-student-grade').value;
    const nameEl = document.querySelector('.id-name-text');
    const gradeEl = document.querySelector('.id-grade-text');
    if (nameEl) nameEl.innerText = nameVal ? nameVal : "";
    if (gradeEl) gradeEl.innerText = gradeVal ? (gradeVal + "年生") : "";
}

window.showEnrollment = function() {
    window.isEditMode = false; window.isEditingInitialized = true; switchScreen('screen-enrollment'); if (typeof loadFaceModels === 'function') loadFaceModels();
    const title = document.getElementById('enroll-title'); const btn = document.getElementById('complete-btn'); const delBtn = document.getElementById('delete-user-btn'); 
    const nameInput = document.getElementById('new-student-name'); const gradeInput = document.getElementById('new-student-grade');
    const slot = document.getElementById('id-photo-slot'); const baseImg = document.getElementById('id-base-preview');
    if (title) title.innerText = "🎒 入学手続き"; if (btn) btn.innerText = "入学する！"; if (delBtn) delBtn.classList.add('hidden'); 
    if (nameInput) nameInput.value = ""; if (gradeInput) gradeInput.value = "";
    if (slot) { slot.innerHTML = ""; slot.style.display = 'block'; } 
    if (baseImg) baseImg.src = "assets/images/items/student-id-base.png";
    const nameEl = document.querySelector('.id-name-text'); const gradeEl = document.querySelector('.id-grade-text');
    if (nameEl) nameEl.style.display = 'block'; if (gradeEl) gradeEl.style.display = 'block'; enrollFile = null; updateIDPreviewText();
    if(btn) btn.disabled = false;
};

window.startEditProfile = function() {
    if (!currentUser) return; window.isEditMode = true; window.isEditingInitialized = false; switchScreen('screen-enrollment'); if (typeof loadFaceModels === 'function') loadFaceModels();
    const title = document.getElementById('enroll-title'); const btn = document.getElementById('complete-btn'); const delBtn = document.getElementById('delete-user-btn');
    const nameInput = document.getElementById('new-student-name'); const gradeInput = document.getElementById('new-student-grade');
    const slot = document.getElementById('id-photo-slot'); const baseImg = document.getElementById('id-base-preview');
    if (title) title.innerText = "✏️ 学生証の編集"; if (btn) btn.innerText = "更新する！"; if (delBtn) delBtn.classList.remove('hidden'); 
    if (nameInput) nameInput.value = currentUser.name; if (gradeInput) gradeInput.value = currentUser.grade;
    if (baseImg) baseImg.src = currentUser.photo; if (slot) { slot.style.display = 'none'; slot.innerHTML = ""; }
    const nameEl = document.querySelector('.id-name-text'); const gradeEl = document.querySelector('.id-grade-text');
    if (nameEl) nameEl.style.display = 'none'; if (gradeEl) gradeEl.style.display = 'none'; enrollFile = null; updateIDPreviewText();
    if(btn) btn.disabled = false;
};

window.deleteCurrentUser = async function() {
    if (!currentUser) return;
    if (confirm(`本当に${currentUser.name}さんの学生証を削除するにゃ？\n（復元できないにゃ）`)) {
        const uid = String(currentUser.id);
        if (db) { try { await db.collection("users").doc(uid).delete(); if (auth && auth.currentUser) await auth.signOut(); } catch(e) { console.error("Firestore Delete Error:", e); } }
        users = users.filter(u => String(u.id) !== uid);
        try { localStorage.setItem('nekoneko_users', JSON.stringify(users)); renderUserList(); } catch(err) {}
        currentUser = null; alert("削除したにゃ..."); switchScreen('screen-gate');
    }
};

async function loadFaceModels() {
    if (modelsLoaded) return;
    const status = document.getElementById('loading-models'); const btn = document.getElementById('complete-btn');
    if(status) status.innerText = "猫化AIを準備中にゃ... 📷"; 
    try {
        const MODEL_URL = 'https://cdn.jsdelivr.net/gh/cgarciagl/face-api.js@0.22.2/weights';
        await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL); await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
        modelsLoaded = true; if(status) status.innerText = "AI準備完了にゃ！"; if(enrollFile) updatePhotoPreview(enrollFile);
    } catch (e) { if(status) status.innerText = "AIの準備に失敗したにゃ…(手動モード)"; }
    if(btn) btn.disabled = false;
}

async function resizeForAI(img, maxSize = 480) {
    return new Promise(resolve => {
        const canvas = document.createElement('canvas'); let width = img.width; let height = img.height;
        if (width > height) { if (width > maxSize) { height *= maxSize / width; width = maxSize; } } 
        else { if (height > maxSize) { width *= maxSize / height; height = maxSize; } }
        canvas.width = width; canvas.height = height; canvas.getContext('2d').drawImage(img, 0, 0, width, height); resolve(canvas);
    });
}

async function updatePhotoPreview(file) {
    window.isEditingInitialized = false; window.isEditMode = true; resetPreviewForEditing(); enrollFile = file;
    const slot = document.getElementById('id-photo-slot'); if (!slot) return;
    slot.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#666;font-size:0.8rem;font-weight:bold;">🐱 加工中にゃ...</div>';
    const blobUrl = URL.createObjectURL(file);
    try {
        const img = await loadImageWithTimeout(blobUrl);
        const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
        canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.objectFit = 'cover';
        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0); 
        slot.innerHTML = ''; slot.appendChild(canvas);
        if (modelsLoaded) {
            try {
                await new Promise(r => setTimeout(r, 50));
                const aiImg = await resizeForAI(img, 480); 
                const options = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 });
                const detection = await faceapi.detectSingleFace(aiImg, options).withFaceLandmarks();
                if (detection) {
                    const landmarks = detection.landmarks;
                    const nose = landmarks.getNose()[3]; const leftEyeBrow = landmarks.getLeftEyeBrow()[2]; const rightEyeBrow = landmarks.getRightEyeBrow()[2];
                    const aiScale = img.width / aiImg.width; 
                    const transX = (val) => val * aiScale; const transY = (val) => val * aiScale; const transS = (val) => val * aiScale;
                    if (decoMuzzle.complete) { const nX = transX(nose.x); const nY = transY(nose.y); const faceW = transS(detection.detection.box.width); const muzW = faceW * 0.8; const muzH = muzW * 0.8; ctx.drawImage(decoMuzzle, nX - muzW/2, nY - muzH/2.5, muzW, muzH); }
                    if (decoEars.complete) { const browX = transX((leftEyeBrow.x + rightEyeBrow.x)/2); const browY = transY((leftEyeBrow.y + rightEyeBrow.y)/2); const faceW = transS(detection.detection.box.width); const earW = faceW * 1.7; const earH = earW * 0.7; const earOffset = earH * 0.35; ctx.drawImage(decoEars, browX - earW/2, browY - earH + earOffset, earW, earH); }
                }
            } catch (e) { console.error("Preview AI Error:", e); }
        }
    } catch (e) { slot.innerHTML = '<div style="color:red; font-size:0.8rem;">画像の読み込みに失敗したにゃ...</div>'; } finally { URL.revokeObjectURL(blobUrl); }
}

function setupEnrollmentPhotoInputs() {
    const handleFile = (file) => { if (!file) return; updatePhotoPreview(file); };
    const webCamBtn = document.getElementById('enroll-webcam-btn'); if (webCamBtn) webCamBtn.onclick = () => { startEnrollmentWebCamera(handleFile); };
    const camInput = document.getElementById('student-photo-input-camera'); if (camInput) camInput.onchange = (e) => handleFile(e.target.files[0]);
    const albInput = document.getElementById('student-photo-input-album'); if (albInput) albInput.onchange = (e) => handleFile(e.target.files[0]);
}

let enrollStream = null;
async function startEnrollmentWebCamera(callback) {
    const modal = document.getElementById('camera-modal'); const video = document.getElementById('camera-video'); const shutter = document.getElementById('camera-shutter-btn'); const cancel = document.getElementById('camera-cancel-btn');
    if (!modal || !video) return;
    try {
        let constraints = { video: { facingMode: "user" } }; try { enrollStream = await navigator.mediaDevices.getUserMedia(constraints); } catch (e) { enrollStream = await navigator.mediaDevices.getUserMedia({ video: true }); }
        video.srcObject = enrollStream; video.setAttribute('playsinline', true); await video.play();
        modal.classList.remove('hidden');
        shutter.onclick = () => { const canvas = document.getElementById('camera-canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight; const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0, canvas.width, canvas.height); canvas.toBlob((blob) => { if(blob) { const file = new File([blob], "enroll_capture.jpg", { type: "image/jpeg" }); closeEnrollCamera(); callback(file); } }, 'image/jpeg', 0.9); };
        cancel.onclick = closeEnrollCamera;
    } catch (err) { alert("カメラエラー: " + err.message); closeEnrollCamera(); }
}

function closeEnrollCamera() { const modal = document.getElementById('camera-modal'); const video = document.getElementById('camera-video'); if (enrollStream) { enrollStream.getTracks().forEach(t => t.stop()); enrollStream = null; } if (video) video.srcObject = null; if (modal) modal.classList.add('hidden'); }

async function renderForSave() {
    try {
        const img = await loadImageWithTimeout('assets/images/items/student-id-base.png?' + new Date().getTime());
        const BASE_W = 300; const scaleFactor = BASE_W / img.width; const canvas = document.createElement('canvas'); canvas.width = BASE_W; canvas.height = img.height * scaleFactor; 
        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, canvas.width, canvas.height); 
        const rx = canvas.width / 640; const ry = canvas.height / 400;
        if (enrollFile) {
            const blobUrl = URL.createObjectURL(enrollFile);
            try {
                const photoImg = await loadImageWithTimeout(blobUrl);
                const destX = 35 * rx; const destY = 143 * ry; const destW = 195 * rx; const destH = 180 * ry; 
                const scale = Math.max(destW / photoImg.width, destH / photoImg.height); 
                const cropW = destW / scale; const cropH = destH / scale; const cropX = (photoImg.width - cropW) / 2; const cropY = (photoImg.height - cropH) / 2;
                ctx.save(); ctx.beginPath(); ctx.roundRect(destX, destY, destW, destH, 2 * rx); ctx.clip(); ctx.drawImage(photoImg, cropX, cropY, cropW, cropH, destX, destY, destW, destH); ctx.restore();
                if (modelsLoaded) { try { const aiImg = await resizeForAI(photoImg, 480); const options = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }); const detection = await faceapi.detectSingleFace(aiImg, options).withFaceLandmarks(); if (detection) { const landmarks = detection.landmarks; const nose = landmarks.getNose()[3]; const leftEyeBrow = landmarks.getLeftEyeBrow()[2]; const rightEyeBrow = landmarks.getRightEyeBrow()[2]; const aiScale = photoImg.width / aiImg.width; const transX = (val) => (val - cropX) * scale + destX; const transY = (val) => (val - cropY) * scale + destY; const transS = (val) => val * scale; if (decoMuzzle.complete) { const nX = transX(nose.x * aiScale); const nY = transY(nose.y * aiScale); const faceW = transS(detection.detection.box.width * aiScale); const muzW = faceW * 0.8; const muzH = muzW * 0.8; ctx.drawImage(decoMuzzle, nX - muzW/2, nY - muzH/2.5, muzW, muzH); } if (decoEars.complete) { const browX = transX(((leftEyeBrow.x + rightEyeBrow.x)/2) * aiScale); const browY = transY(((leftEyeBrow.y + rightEyeBrow.y)/2) * aiScale); const faceW = transS(detection.detection.box.width * aiScale); const earW = faceW * 1.7; const earH = earW * 0.7; const earOffset = earH * 0.35; ctx.drawImage(decoEars, browX - earW/2, browY - earH + earOffset, earW, earH); } } } catch(aiErr) { console.error("AI Decoration Failed:", aiErr); } }
            } catch(e) { console.error(e); } finally { URL.revokeObjectURL(blobUrl); }
        } else if (window.isEditMode && currentUser) { try { const currentImg = await loadImageWithTimeout(currentUser.photo); const sX = currentImg.width * 0.055; const sY = currentImg.height * 0.3575; const sW = currentImg.width * 0.305; const sH = currentImg.height * 0.45; const dX = 35 * rx; const dY = 143 * ry; const dW = 195 * rx; const dH = 180 * ry; ctx.drawImage(currentImg, sX, sY, sW, sH, dX, dY, dW, dH); } catch(e) {} }
        const nameVal = document.getElementById('new-student-name').value; const gradeVal = document.getElementById('new-student-grade').value; ctx.fillStyle = "#333"; const fontSize = 32 * rx; ctx.font = `bold ${fontSize}px 'M PLUS Rounded 1c', sans-serif`; ctx.textAlign = "left"; ctx.textBaseline = "middle"; const textX = 346 * rx; if (gradeVal) ctx.fillText(gradeVal + "年生", textX, 168 * ry + 1); if (nameVal) ctx.fillText(nameVal, textX, 231 * ry + 3);
        return canvas.toDataURL('image/png');
    } catch(e) { console.error("Render Failed:", e); return null; }
}

async function processAndCompleteEnrollment() {
    const name = document.getElementById('new-student-name').value; const grade = document.getElementById('new-student-grade').value; const btn = document.getElementById('complete-btn');
    if(!name || !grade) return alert("お名前と学年を入れてにゃ！");
    btn.disabled = true; btn.innerText = window.isEditMode ? "更新中にゃ..." : "作成中にゃ..."; await new Promise(r => setTimeout(r, 100)); 

    try {
        let finalPhoto = await renderForSave(); 
        if (!finalPhoto) finalPhoto = (window.isEditMode && currentUser) ? currentUser.photo : "assets/images/items/student-id-base.png";
        
        const defaultQuizLevels = { "全ジャンル": 1 };
        let userToSave = null;
        let userUid = null;

        if (window.isGoogleEnrollment) {
             if (auth.currentUser) userUid = auth.currentUser.uid;
        } else if (currentUser && currentUser.id && auth.currentUser) {
             userUid = currentUser.id;
        } else {
             if (auth) { const cred = await auth.signInAnonymously(); userUid = cred.user.uid; }
        }
        
        userToSave = { 
            id: userUid || String(Date.now()), 
            name, grade, photo: finalPhoto, 
            karikari: (currentUser && currentUser.karikari) || 100, 
            history: (currentUser && currentUser.history) || {}, 
            mistakes: (currentUser && currentUser.mistakes) || [], 
            attendance: (currentUser && currentUser.attendance) || {}, 
            memory: (currentUser && currentUser.memory) || "", 
            lastLogin: (currentUser && currentUser.lastLogin) || "", 
            streak: (currentUser && currentUser.streak) || 0,
            quizLevels: (currentUser && currentUser.quizLevels) || defaultQuizLevels,
            savedQuizzes: (currentUser && currentUser.savedQuizzes) || [],
            totalLunchGiven: (currentUser && currentUser.totalLunchGiven) || 0,
            isGoogleUser: !!(auth && auth.currentUser && !auth.currentUser.isAnonymous) 
        };

        if (db && userUid) { await db.collection("users").doc(userUid).set(userToSave, { merge: true }); }
        updateLocalUserList(userToSave);
        currentUser = userToSave; window.isGoogleEnrollment = false; 
        updateNellMessage(window.isEditMode ? `${currentUser.name}さんの情報を更新したにゃ！` : `${currentUser.name}さん、入学おめでとうだにゃ！`, "excited"); 
        switchScreen('screen-lobby');
        document.getElementById('new-student-name').value = ""; document.getElementById('new-student-grade').value = ""; enrollFile = null; updateIDPreviewText(); const slot = document.getElementById('id-photo-slot'); if(slot) slot.innerHTML = '';

    } catch (err) { alert("エラーが発生したにゃ……\n" + err.message); console.error(err); } 
    finally { btn.disabled = false; btn.innerText = window.isEditMode ? "更新する！" : "入学する！"; }
}

function renderUserList() { const list = document.getElementById('user-list'); if(!list) return; list.innerHTML = users.length ? "" : "<p style='text-align:center; width:100%; color:white; font-weight:bold; opacity:0.8;'>まだ誰もいないにゃ</p>"; users.forEach(user => { const div = document.createElement('div'); div.className = "user-card"; div.innerHTML = `<img src="${user.photo}"><div class="card-karikari-badge">🍖${user.karikari || 0}</div>`; div.onclick = () => login(user, false); list.appendChild(div); }); }

async function login(user, isGoogle = false) { 
    try { sfxDoor.currentTime = 0; sfxDoor.play(); } catch(e){}
    currentUser = user; 
    if (!currentUser.attendance) currentUser.attendance = {}; 
    if (!currentUser.quizLevels) currentUser.quizLevels = { "全ジャンル": 1 }; 
    if (!currentUser.savedQuizzes) currentUser.savedQuizzes = []; 
    if (currentUser.totalLunchGiven === undefined) currentUser.totalLunchGiven = 0;

    if (typeof user.id === 'number' && auth) {
         try {
             const cred = await auth.signInAnonymously(); const newUid = cred.user.uid; users = users.filter(u => u.id !== user.id); currentUser.id = newUid; currentUser.isGoogleUser = false; await db.collection("users").doc(newUid).set(currentUser, { merge: true }); updateLocalUserList(currentUser);
         } catch(e) { console.error("Migration failed:", e); }
    }
    
    const today = new Date().toISOString().split('T')[0]; 
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    if (currentUser.lastLogin !== today) {
        if (currentUser.lastLogin === yesterday) currentUser.streak = (currentUser.streak || 0) + 1; else currentUser.streak = 1;
        currentUser.lastLogin = today; currentUser.attendance[today] = true;
        if (currentUser.streak >= 3) { currentUser.karikari += 100; setTimeout(() => { alert(`㊗️ ${currentUser.streak}日連続出席！\nボーナスでカリカリ100個ゲットだにゃ！🍖✨`); showKarikariEffect(100); }, 1000); }
        saveAndSync(); 
    }
    const avatar = document.getElementById('current-student-avatar'); if (avatar) avatar.src = user.photo; 
    const karikari = document.getElementById('karikari-count'); if (karikari) karikari.innerText = user.karikari || 0; 
    switchScreen('screen-lobby'); 
    if (window.justEnrolledId === user.id) { updateNellMessage(`${user.name}さん、入学おめでとうだにゃ！`, "excited"); window.justEnrolledId = null; } else { updateNellMessage(`おかえり、${user.name}さん！`, "happy"); } 
}

async function saveAndSync() { 
    if (!currentUser) return; 
    const kCounter = document.getElementById('karikari-count'); if (kCounter) kCounter.innerText = currentUser.karikari;
    const miniKCounter = document.getElementById('mini-karikari-count'); if (miniKCounter) miniKCounter.innerText = currentUser.karikari;
    if (typeof currentUser.id === 'string' && db) { try { await db.collection("users").doc(currentUser.id).set(currentUser, { merge: true }); } catch(e) { console.error("Firestore sync error:", e); } }
    updateLocalUserList(currentUser);
}