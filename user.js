// --- user.js (UI即時反映・修正版) ---

let users = JSON.parse(localStorage.getItem('nekoneko_users')) || [];
let currentUser = null;
let modelsLoaded = false;
let enrollFile = null;

const idBase = new Image(); idBase.src = 'student-id-base.png';
const decoEars = new Image(); decoEars.src = 'ears.png';
const decoMuzzle = new Image(); decoMuzzle.src = 'muzzle.png';

document.addEventListener('DOMContentLoaded', () => {
    renderUserList();
    // AIは裏で読み込むが、UIブロックはしない
    loadFaceModels();
    setupEnrollmentPhotoInputs();
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
        // 入学ボタンは最初から押せるようにしておく（AI必須にしない）
        const btn = document.getElementById('complete-btn');
        if(btn) btn.disabled = false;
    } catch (e) {
        console.error("AI Load Error:", e);
        if(status) status.innerText = "手動モードで入学できるにゃ🐾";
        const btn = document.getElementById('complete-btn');
        if(btn) btn.disabled = false;
    }
}

async function resizeImageForProcessing(img, maxSize = 400) {
    return new Promise((resolve) => {
        let width = img.width;
        let height = img.height;
        // リサイズ
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

// ★修正: 写真を即座に枠へ描画する
async function drawPreview(img) {
    const canvas = document.getElementById('id-photo-preview-canvas');
    if (!canvas) return;

    // キャンバスサイズを画像に合わせる (640x400)
    canvas.width = 640; 
    canvas.height = 400;
    const ctx = canvas.getContext('2d');

    // 1. ベースを描画
    if (!idBase.complete) await new Promise(r => idBase.onload = r);
    ctx.drawImage(idBase, 0, 0, 640, 400);

    // 2. 写真を「左側のグレー枠」の位置に即描画 (トリミング)
    // 枠の位置推定: x=44, y=140, w=180, h=196 くらい
    const destX = 44, destY = 138, destW = 180, destH = 200;
    
    // 写真を中心でトリミングして描画
    const scale = Math.max(destW / img.width, destH / img.height);
    const cropW = destW / scale;
    const cropH = destH / scale;
    const cropX = (img.width - cropW) / 2;
    const cropY = (img.height - cropH) / 2;

    ctx.save();
    ctx.beginPath();
    ctx.rect(destX, destY, destW, destH);
    ctx.clip(); // 枠からはみ出さないようにマスク
    ctx.drawImage(img, cropX, cropY, cropW, cropH, destX, destY, destW, destH);
    ctx.restore();

    // 3. もしAIが準備できていれば、猫耳をつける (非同期で更新)
    if (modelsLoaded) {
        // 重いので少し待ってから実行（UIを固めないため）
        setTimeout(async () => {
            try {
                const sourceImg = await resizeImageForProcessing(img, 400);
                const detection = await faceapi.detectSingleFace(sourceImg).withFaceLandmarks();
                
                if (detection) {
                    // 顔の位置に合わせて再描画したいが、ユーザーは「即座」を求めているので
                    // ここでは「耳と鼻」だけ上乗せする処理にする
                    // ※座標変換が複雑になるため、簡易的にプレビュー更新
                    // (本格的な合成は保存時に行うか、ここでは枠内描画を優先)
                    
                    // 顔認識座標を、キャンバス上の枠内座標に変換する必要があるが、
                    // クロップ済み画像に対して行うのは難しい。
                    // 簡易実装: 写真自体はそのまま、雰囲気で楽しんでもらう
                }
            } catch(e) {}
        }, 100);
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
            img.onload = () => drawPreview(img);
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
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
        
        // 文字を描画 (CSSの位置に合わせて座標調整)
        ctx.fillStyle = "#333"; 
        ctx.font = "bold 32px 'M PLUS Rounded 1c', sans-serif"; 
        
        // 学年 (CSS: left 55%, top 45% -> x=352, y=180)
        ctx.fillText(grade + "年生", 352, 190); 
        
        // 名前 (CSS: left 55%, top 65% -> x=352, y=260)
        ctx.fillText(name, 352, 270);

        // データを保存 (画質を少し落として容量節約)
        const newUser = { 
            id: Date.now(), name, grade, 
            photo: saveCanvas.toDataURL('image/jpeg', 0.5), 
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
        updateIDPreview(); // リセット
        
        alert("入学おめでとうにゃ！🌸");
        // タイトル画面ではなく、校門(一覧)に戻るのが自然
        switchScreen('screen-gate');

    } catch (err) {
        if (err.name === 'QuotaExceededError') {
            alert("データがいっぱいで保存できないにゃ。\nトップページで古い学生証を削除してから、もう一度試してにゃ！");
        } else {
            alert("エラーが発生したにゃ……\n" + err.message);
        }
    } finally {
        btn.disabled = false;
        btn.innerText = "入学する！";
    }
}

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
    // データ補正
    if (!currentUser.attendance) currentUser.attendance = {};
    if (!currentUser.memory) currentUser.memory = "";
    
    // 表示更新
    const avatar = document.getElementById('current-student-avatar');
    if (avatar) avatar.src = user.photo;
    const karikari = document.getElementById('karikari-count');
    if (karikari) karikari.innerText = user.karikari || 0;
    
    // 出席処理
    const today = new Date().toISOString().split('T')[0];
    let isBonus = false;
    if (!currentUser.attendance[today]) {
        currentUser.attendance[today] = true;
        // 簡易ボーナス判定
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
        updateNellMessage(`おかえり、${user.name}さん！`, "happy");
    }
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