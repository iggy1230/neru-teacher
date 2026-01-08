// --- user.js (完全修正版: ハイブリッド描画) ---

let users = JSON.parse(localStorage.getItem('nekoneko_users')) || [];
let currentUser = null;
let modelsLoaded = false;
let enrollFile = null;

// 画像オブジェクト (念のためJSでも保持)
const idBase = new Image();
idBase.src = 'student-id-base.png';

const decoEars = new Image(); decoEars.src = 'ears.png';
const decoMuzzle = new Image(); decoMuzzle.src = 'muzzle.png';

document.addEventListener('DOMContentLoaded', () => {
    renderUserList();
    loadFaceModels();
    setupEnrollmentPhotoInputs();
    
    // 入力イベントリスナー
    const nameInput = document.getElementById('new-student-name');
    const gradeInput = document.getElementById('new-student-grade');
    if(nameInput) nameInput.addEventListener('input', () => renderIdCard(false));
    if(gradeInput) gradeInput.addEventListener('change', () => renderIdCard(false));

    // 初回描画
    renderIdCard(false);
});

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

// ★描画関数 (forSave=trueのときは背景も含めて描画して返す)
async function renderIdCard(forSave = false) {
    let canvas;
    if (forSave) {
        canvas = document.createElement('canvas'); // 保存用の一時キャンバス
    } else {
        canvas = document.getElementById('id-photo-preview-canvas'); // 表示用
    }
    if (!canvas) return;

    // サイズ固定
    canvas.width = 640; 
    canvas.height = 400;
    const ctx = canvas.getContext('2d');

    // --- 1. 背景の処理 ---
    if (forSave) {
        // 保存時は背景画像もCanvasに描く
        if (idBase.complete && idBase.naturalWidth > 0) {
            ctx.drawImage(idBase, 0, 0, 640, 400);
        } else {
            // 画像ロード待ち
            await new Promise(r => { idBase.onload = r; idBase.onerror = r; });
            ctx.drawImage(idBase, 0, 0, 640, 400);
        }
    } else {
        // プレビュー時は背景を透明にする (HTMLのimgタグが見えるように)
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    // --- 2. 写真の描画 ---
    if (enrollFile) {
        try {
            const img = new Image();
            img.src = URL.createObjectURL(enrollFile);
            await new Promise(r => img.onload = r);

            // 枠の座標: 左44px, 上138px, 幅180px, 高さ200px
            const destX = 44, destY = 138, destW = 180, destH = 200;
            
            // トリミング計算
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
        } catch(e) { console.error(e); }
    } else if (!forSave) {
        // プレビューで写真がない時は、枠部分を半透明グレーにしてわかりやすくする
        ctx.fillStyle = "rgba(200, 200, 200, 0.5)";
        ctx.fillRect(44, 138, 180, 200);
    }

    // --- 3. テキスト描画 ---
    const nameVal = document.getElementById('new-student-name').value || "なまえ";
    const gradeVal = document.getElementById('new-student-grade').value || "○";
    
    ctx.fillStyle = "#333"; 
    ctx.font = "bold 32px 'M PLUS Rounded 1c', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    // 座標調整 (Canvas内での絶対座標)
    ctx.fillText(gradeVal + "年生", 350, 185); 
    ctx.fillText(nameVal, 350, 265);

    return canvas;
}

function setupEnrollmentPhotoInputs() {
    const handleFile = (file) => {
        if (!file) return;
        enrollFile = file;
        renderIdCard(false);
    };

    const webCamBtn = document.getElementById('enroll-webcam-btn');
    if (webCamBtn) {
        // イベント重複防止
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

async function processAndCompleteEnrollment() {
    const name = document.getElementById('new-student-name').value;
    const grade = document.getElementById('new-student-grade').value;
    const btn = document.getElementById('complete-btn');

    if(!name || !grade) return alert("お名前と学年を入れてにゃ！");
    
    btn.disabled = true;
    btn.innerText = "作成中にゃ...";
    await new Promise(r => setTimeout(r, 100));

    try {
        // 保存用に背景込みでCanvas生成
        const saveCanvas = await renderIdCard(true);
        
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
        renderIdCard(false);
        
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

// ... (以下変更なし) ...
function renderUserList() { const list = document.getElementById('user-list'); if(!list) return; list.innerHTML = users.length ? "" : "<p style='text-align:right; font-size:0.75rem; opacity:0.5;'>入学してにゃ</p>"; users.forEach(user => { const div = document.createElement('div'); div.className = "user-card"; div.innerHTML = `<img src="${user.photo}"><div class="card-karikari-badge">🍖${user.karikari || 0}</div><button class="delete-student-btn" onclick="deleteUser(event, ${user.id})">×</button>`; div.onclick = () => login(user); list.appendChild(div); }); }
function login(user) { currentUser = user; if (!currentUser.attendance) currentUser.attendance = {}; if (!currentUser.memory) currentUser.memory = ""; const avatar = document.getElementById('current-student-avatar'); if (avatar) avatar.src = user.photo; const karikari = document.getElementById('karikari-count'); if (karikari) karikari.innerText = user.karikari || 0; const today = new Date().toISOString().split('T')[0]; let isBonus = false; if (!currentUser.attendance[today]) { currentUser.attendance[today] = true; let streak = 1; let d = new Date(); while (true) { d.setDate(d.getDate() - 1); const key = d.toISOString().split('T')[0]; if (currentUser.attendance[key]) streak++; else break; } if (streak >= 3) { currentUser.karikari += 100; isBonus = true; } saveAndSync(); } switchScreen('screen-lobby'); if (isBonus) { updateNellMessage("連続出席ボーナス！カリカリ100個プレゼントだにゃ！", "excited"); showKarikariEffect(100); updateMiniKarikari(); } else { updateNellMessage(`おかえり、${user.name}さん！`, "happy"); } }
function deleteUser(e, id) { e.stopPropagation(); if(confirm("この生徒手帳を削除するにゃ？")) { users = users.filter(u => u.id !== id); try { localStorage.setItem('nekoneko_users', JSON.stringify(users)); renderUserList(); } catch(err) {} } }
function saveAndSync() { if (!currentUser) return; const idx = users.findIndex(u => u.id === currentUser.id); if (idx !== -1) users[idx] = currentUser; try { localStorage.setItem('nekoneko_users', JSON.stringify(users)); } catch(err) {} const kCounter = document.getElementById('karikari-count'); if (kCounter) kCounter.innerText = currentUser.karikari; }