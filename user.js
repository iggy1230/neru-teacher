// --- user.js (Canvas完全描画版) ---

let users = JSON.parse(localStorage.getItem('nekoneko_users')) || [];
let currentUser = null;
let modelsLoaded = false;
let enrollFile = null;

// 画像の事前読み込み
const idBase = new Image(); 
idBase.crossOrigin = "Anonymous";
idBase.src = 'student-id-base.png';

const decoEars = new Image(); decoEars.src = 'ears.png';
const decoMuzzle = new Image(); decoMuzzle.src = 'muzzle.png';

document.addEventListener('DOMContentLoaded', () => {
    renderUserList();
    loadFaceModels();
    setupEnrollmentPhotoInputs();
    
    // ベース画像が読み込まれたら初回描画
    if(idBase.complete) {
        renderIdCard();
    } else {
        idBase.onload = () => renderIdCard();
    }
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
        document.getElementById('complete-btn').disabled = false;
    } catch (e) {
        if(status) status.innerText = "手動モードで入学できるにゃ🐾";
        document.getElementById('complete-btn').disabled = false;
    }
}

// ユーザー入力が変わったら再描画
function updateIDPreview() {
    renderIdCard();
}
// HTML側でイベントハンドラを設定できるようにグローバル公開、またはイベントリスナー追加
document.getElementById('new-student-name').addEventListener('input', updateIDPreview);
document.getElementById('new-student-grade').addEventListener('change', updateIDPreview);


// ★重要: すべてをCanvasに描画してズレをなくす関数
async function renderIdCard(useAI = false) {
    const canvas = document.getElementById('id-photo-preview-canvas');
    if (!canvas) return;

    // キャンバスサイズを画像本来のサイズ(640x400)に固定
    canvas.width = 640; 
    canvas.height = 400;
    const ctx = canvas.getContext('2d');

    // 1. ベース画像描画
    if (!idBase.complete) return; // まだなら描画しない（onloadで再度呼ばれる）
    ctx.drawImage(idBase, 0, 0, 640, 400);

    // 2. 写真描画 (あれば)
    if (enrollFile) {
        // 画像オブジェクトを生成して描画
        const img = new Image();
        img.src = URL.createObjectURL(enrollFile);
        await new Promise(r => img.onload = r);

        // 枠の座標: 左44px, 上138px, 幅180px, 高さ200px
        const destX = 44, destY = 138, destW = 180, destH = 200;
        
        // トリミング計算 (object-fit: cover 相当)
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
    }

    // 3. テキスト描画 (Canvasに直接書くのでズレない！)
    const nameVal = document.getElementById('new-student-name').value || "なまえ";
    const gradeVal = document.getElementById('new-student-grade').value || "○";
    
    ctx.fillStyle = "#333"; 
    ctx.font = "bold 32px 'M PLUS Rounded 1c', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    // 座標は画像のピクセル数で指定 (640x400の中での位置)
    // 学年: 中央より右 (x=350), 上から半分より少し上 (y=180あたり)
    ctx.fillText(gradeVal + "年生", 350, 185); 
    
    // 名前: 中央より右 (x=350), 上から半分より下 (y=265あたり)
    ctx.fillText(nameVal, 350, 265);
}

function setupEnrollmentPhotoInputs() {
    const handleFile = (file) => {
        if (!file) return;
        enrollFile = file;
        renderIdCard(); // 写真が変わったら再描画
    };

    const webCamBtn = document.getElementById('enroll-webcam-btn');
    if (webCamBtn) {
        webCamBtn.addEventListener('click', () => {
            startEnrollmentWebCamera(handleFile);
        });
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
        // すでにCanvasに描画されているので、それをそのまま画像化して保存
        const canvas = document.getElementById('id-photo-preview-canvas');
        
        // 容量削減のためJPEG品質0.6で保存
        const newUser = { 
            id: Date.now(), name, grade, 
            photo: canvas.toDataURL('image/jpeg', 0.6), 
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
        renderIdCard(); // リセット描画
        
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

// ... (以下は変更なし、そのまま維持) ...
function renderUserList() { const list = document.getElementById('user-list'); if(!list) return; list.innerHTML = users.length ? "" : "<p style='text-align:right; font-size:0.75rem; opacity:0.5;'>入学してにゃ</p>"; users.forEach(user => { const div = document.createElement('div'); div.className = "user-card"; div.innerHTML = `<img src="${user.photo}"><div class="card-karikari-badge">🍖${user.karikari || 0}</div><button class="delete-student-btn" onclick="deleteUser(event, ${user.id})">×</button>`; div.onclick = () => login(user); list.appendChild(div); }); }
function login(user) { currentUser = user; if (!currentUser.attendance) currentUser.attendance = {}; if (!currentUser.memory) currentUser.memory = ""; const avatar = document.getElementById('current-student-avatar'); if (avatar) avatar.src = user.photo; const karikari = document.getElementById('karikari-count'); if (karikari) karikari.innerText = user.karikari || 0; const today = new Date().toISOString().split('T')[0]; let isBonus = false; if (!currentUser.attendance[today]) { currentUser.attendance[today] = true; let streak = 1; let d = new Date(); while (true) { d.setDate(d.getDate() - 1); const key = d.toISOString().split('T')[0]; if (currentUser.attendance[key]) streak++; else break; } if (streak >= 3) { currentUser.karikari += 100; isBonus = true; } saveAndSync(); } switchScreen('screen-lobby'); if (isBonus) { updateNellMessage("連続出席ボーナス！カリカリ100個プレゼントだにゃ！", "excited"); showKarikariEffect(100); updateMiniKarikari(); } else { updateNellMessage(`おかえり、${user.name}さん！`, "happy"); } }
function deleteUser(e, id) { e.stopPropagation(); if(confirm("この生徒手帳を削除するにゃ？")) { users = users.filter(u => u.id !== id); try { localStorage.setItem('nekoneko_users', JSON.stringify(users)); renderUserList(); } catch(err) {} } }
function saveAndSync() { if (!currentUser) return; const idx = users.findIndex(u => u.id === currentUser.id); if (idx !== -1) users[idx] = currentUser; try { localStorage.setItem('nekoneko_users', JSON.stringify(users)); } catch(err) {} const kCounter = document.getElementById('karikari-count'); if (kCounter) kCounter.innerText = currentUser.karikari; }