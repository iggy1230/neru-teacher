// --- js/camera-service.js (v432.1: ファイルアップロード引数修正版) ---

// ==========================================
// プレビューカメラ制御 (共通)
// ==========================================

window.startPreviewCamera = async function(videoId = 'live-chat-video', containerId = 'live-chat-video-container') {
    const video = document.getElementById(videoId);
    const container = document.getElementById(containerId);
    if (!video || !container) return;

    document.body.classList.add('camera-active');

    try {
        if (window.previewStream) {
            window.previewStream.getTracks().forEach(t => t.stop());
        }
        try {
            // iPhone負荷軽減: VGA 15fps
            window.previewStream = await navigator.mediaDevices.getUserMedia({ 
                video: { 
                    facingMode: "environment", 
                    width: { ideal: 640 }, 
                    height: { ideal: 480 },
                    frameRate: { ideal: 15 }
                },
                audio: false 
            });
        } catch(e) {
            window.previewStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
        video.srcObject = window.previewStream;
        video.setAttribute('playsinline', true);
        await video.play();
        container.style.display = 'block';

    } catch (e) {
        console.warn("[Preview] Camera init failed:", e);
        document.body.classList.remove('camera-active'); 
        alert("カメラが使えないにゃ…。");
    }
};

window.stopPreviewCamera = function() {
    document.body.classList.remove('camera-active');

    if (window.previewStream) {
        // ★最適化: トラックを完全に停止し、参照を切る
        window.previewStream.getTracks().forEach(t => {
            t.stop();
            t.enabled = false;
        });
        window.previewStream = null;
    }
    ['live-chat-video', 'live-chat-video-embedded', 'live-chat-video-simple', 'live-chat-video-free'].forEach(vid => {
        const v = document.getElementById(vid);
        if(v) {
            v.pause();
            v.srcObject = null;
            v.load(); // ★重要: メモリ解放のためにload()を呼ぶ
        }
    });
    ['live-chat-video-container', 'live-chat-video-container-embedded', 'live-chat-video-container-simple', 'live-chat-video-container-free'].forEach(cid => {
        const c = document.getElementById(cid);
        if(c) c.style.display = 'none';
    });
};

window.toggleHttpCamera = function(context) {
    let videoId, containerId, btnId;
    if (context === 'embedded') {
        videoId = 'live-chat-video-embedded'; containerId = 'live-chat-video-container-embedded'; btnId = 'live-camera-btn-embedded';
    } else if (context === 'simple') {
        videoId = 'live-chat-video-simple'; containerId = 'live-chat-video-container-simple'; btnId = 'live-camera-btn-simple';
    } else return;

    const btn = document.getElementById(btnId);
    
    if (window.previewStream && window.previewStream.active) {
        if(typeof window.captureAndSendLiveImageHttp === 'function') window.captureAndSendLiveImageHttp(context);
    } else {
        window.startPreviewCamera(videoId, containerId).then(() => {
            if (btn) {
                btn.innerHTML = "<span>📸</span> 撮影して送信";
                btn.style.backgroundColor = "#ff5252"; 
            }
        });
    }
};

window.toggleEmbeddedCamera = function() { window.toggleHttpCamera('embedded'); }
window.toggleSimpleCamera = function() { window.toggleHttpCamera('simple'); }

// ==========================================
// お宝図鑑カメラ・解析
// ==========================================

window.toggleTreasureCamera = function() {
    const videoId = 'live-chat-video';
    const containerId = 'live-chat-video-container';
    const btnId = 'live-camera-btn';
    const btn = document.getElementById(btnId);
    
    if (window.previewStream && window.previewStream.active) {
        window.captureAndIdentifyItem();
    } else {
        window.startPreviewCamera(videoId, containerId).then(() => {
            if (btn) {
                btn.innerHTML = "<span>📸</span> 撮影する";
                btn.style.backgroundColor = "#ff5252"; 
            }
        });
    }
};

window.uploadTreasureImage = function() {
    const fileInput = document.getElementById('treasure-upload-input');
    if (fileInput) fileInput.click();
};

function convertDMSToDD(degrees, minutes, seconds, direction) {
    let dd = degrees + minutes / 60 + seconds / (60 * 60);
    if (direction == "S" || direction == "W") {
        dd = dd * -1;
    }
    return dd;
}

function getGpsFromExif(file) {
    return new Promise((resolve) => {
        if (typeof EXIF === 'undefined') {
            console.warn("EXIF-js not loaded.");
            resolve(null);
            return;
        }
        EXIF.getData(file, function() {
            const lat = EXIF.getTag(this, "GPSLatitude");
            const lon = EXIF.getTag(this, "GPSLongitude");
            const latRef = EXIF.getTag(this, "GPSLatitudeRef");
            const lonRef = EXIF.getTag(this, "GPSLongitudeRef");
            if (lat && lon && latRef && lonRef) {
                const decimalLat = convertDMSToDD(lat[0], lat[1], lat[2], latRef);
                const decimalLon = convertDMSToDD(lon[0], lon[1], lon[2], lonRef);
                resolve({ lat: decimalLat, lon: decimalLon, accuracy: 20 });
            } else {
                resolve(null);
            }
        });
    });
}

// 座標から住所文字列を取得する関数 (Nominatim API)
async function getAddressFromCoords(lat, lon) {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&accept_language=ja&zoom=18&addressdetails=1`;
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            const addr = data.address;
            let fullAddress = "";

            // 1. 都道府県
            if (addr.province) fullAddress += addr.province;
            else if (addr.prefecture) fullAddress += addr.prefecture;
            
            // 2. 市区町村・郡
            if (addr.city) fullAddress += addr.city;
            if (addr.county) fullAddress += addr.county;
            if (addr.town) fullAddress += addr.town;
            if (addr.village) fullAddress += addr.village;
            
            // 3. 区・町名・字 (詳細地域名)
            if (addr.ward) fullAddress += addr.ward;
            if (addr.quarter) fullAddress += addr.quarter;
            if (addr.neighbourhood) fullAddress += addr.neighbourhood;
            if (addr.hamlet) fullAddress += addr.hamlet;
            if (addr.suburb) fullAddress += addr.suburb;

            // 4. 道路・番地
            if (addr.road) fullAddress += ` ${addr.road}`;
            if (addr.house_number) fullAddress += ` ${addr.house_number}`;

            // 5. 建物名・施設名
            const specificLocation = addr.amenity || addr.shop || addr.tourism || addr.historic || addr.leisure || addr.building || addr.office;
            if (specificLocation) {
                fullAddress += ` (${specificLocation})`;
            }
            
            console.log("Resolved Address:", fullAddress);
            return fullAddress;
        }
    } catch (e) {
        console.warn("Reverse Geocoding failed:", e);
    }
    return null;
}

// ★修正: HTMLから FileList が渡されるので、配列から最初のファイルを取り出す
window.handleTreasureFile = async function(files) {
    if (!files || files.length === 0) return;
    const file = files[0];
    
    const btn = document.getElementById('upload-treasure-btn');
    if (btn) {
        btn.innerHTML = "<span>📡</span> 解析中...";
        btn.style.backgroundColor = "#ccc";
        btn.disabled = true;
    }
    let locationData = null;
    try { locationData = await getGpsFromExif(file); } catch(e) {}
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        const img = new Image();
        img.onload = async () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 800;
            const scale = Math.min(1, MAX_WIDTH / img.width);
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.6);
            const base64Data = compressedDataUrl.split(',')[1];
            await window.analyzeTreasureImage(base64Data, locationData);
            if (btn) {
                btn.innerHTML = "<span>📁</span> アルバム";
                btn.style.backgroundColor = "#4a90e2"; 
                btn.disabled = false;
            }
            const fileInput = document.getElementById('treasure-upload-input');
            if(fileInput) fileInput.value = '';
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
};

window.createTreasureImage = function(sourceCanvas) {
    const OUTPUT_SIZE = 300; 
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext('2d');
    const size = Math.min(sourceCanvas.width, sourceCanvas.height);
    const sx = (sourceCanvas.width - size) / 2;
    const sy = (sourceCanvas.height - size) / 2;
    ctx.drawImage(sourceCanvas, sx, sy, size, size, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    sourceCanvas.width = 1;
    sourceCanvas.height = 1;
    return canvas.toDataURL('image/jpeg', 0.7);
};

window.processImageForAI = function(sourceCanvas) { 
    // ★宿題分析モード（explain, grade, review）の場合は精度向上のため設定を上げる
    let MAX_WIDTH = 800;
    let QUALITY = 0.6;

    if (window.currentMode === 'explain' || window.currentMode === 'grade' || window.currentMode === 'review') {
        MAX_WIDTH = 1024;
        QUALITY = 0.8;
        console.log("Homework Mode: Processing High Resolution (1024px, Q0.8)");
    }

    let w = sourceCanvas.width; 
    let h = sourceCanvas.height; 
    if (w > MAX_WIDTH || h > MAX_WIDTH) { 
        if (w > h) { h *= MAX_WIDTH / w; w = MAX_WIDTH; } else { w *= MAX_WIDTH / h; h = MAX_WIDTH; } 
    } 
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; 
    const ctx = canvas.getContext('2d'); ctx.drawImage(sourceCanvas, 0, 0, w, h); 
    const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);
    canvas.width = 1; canvas.height = 1;
    sourceCanvas.width = 1; sourceCanvas.height = 1;
    return dataUrl; 
};

const getLocation = () => {
    return new Promise((resolve) => {
        if (!navigator.geolocation) return resolve(null);
        const timeoutId = setTimeout(() => { resolve(null); }, 5000); 
        navigator.geolocation.getCurrentPosition(
            (pos) => { clearTimeout(timeoutId); resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy }); },
            (err) => { clearTimeout(timeoutId); resolve(null); },
            { timeout: 5000, enableHighAccuracy: false }
        );
    });
};

window.analyzeTreasureImage = async function(base64Data, providedLocation = null) {
    // 制限追加: 前回の分析から30秒以内なら実行しない
    const now = Date.now();
    if (window.lastAnalysisTime && (now - window.lastAnalysisTime < 30000)) {
         if(typeof window.updateNellMessage === 'function') {
             window.updateNellMessage("ちょっと待ってにゃ、目が回っちゃうにゃ…少し休ませてにゃ。", "thinking", false, true);
         }
         return;
    }
    window.lastAnalysisTime = now;

    if (typeof window.stopAlwaysOnListening === 'function') { window.stopAlwaysOnListening(); }
    
    if (window.initAudioContext) { window.initAudioContext().catch(e => console.warn("AudioContext init error:", e)); }
    if (window.sfxHirameku) { const originalVol = window.sfxHirameku.volume; window.sfxHirameku.volume = 0; window.sfxHirameku.play().then(() => { window.sfxHirameku.pause(); window.sfxHirameku.currentTime = 0; window.sfxHirameku.volume = originalVol; }).catch(e => {}); }

    const flash = document.createElement('div');
    flash.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:white; opacity:0.8; z-index:9999; pointer-events:none; transition:opacity 0.3s;";
    document.body.appendChild(flash);
    setTimeout(() => { flash.style.opacity = 0; setTimeout(() => flash.remove(), 300); }, 50);

    if(typeof window.updateNellMessage === 'function') { window.updateNellMessage("詳しい場所を調べてるにゃ…", "thinking", false, true); }

    let addressToSend = null;
    let locationData = providedLocation;
    
    if (providedLocation && providedLocation.lat && providedLocation.lon) {
         addressToSend = await getAddressFromCoords(providedLocation.lat, providedLocation.lon);
         if (!addressToSend) {
             addressToSend = `緯度${providedLocation.lat}, 経度${providedLocation.lon}`;
         }
    } else {
         if (!window.currentLocation) {
             try { window.currentLocation = await getLocation(); } catch(e) {}
         }
         locationData = window.currentLocation;
         addressToSend = window.currentAddress;
    }

    if(typeof window.updateNellMessage === 'function') { window.updateNellMessage("ん？何を見つけたのかにゃ…？", "thinking", false, true); }

    try {
        const res = await fetch('/identify-item', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                image: base64Data, 
                name: currentUser ? currentUser.name : "生徒", 
                location: locationData, 
                address: addressToSend 
            })
        });
        if (!res.ok) throw new Error("サーバー通信エラーだにゃ");
        const data = await res.json();
        let speech = "";
        if(typeof window.updateNellMessage === 'function') {
            if (data.speechText) { speech = data.speechText; await window.updateNellMessage(data.speechText, "happy", true, true); } else if (data.text) { speech = data.text; await window.updateNellMessage(data.text, "happy", true, true); }
        }
        if (speech && typeof window.addToSessionHistory === 'function') { window.addToSessionHistory('user', `（写真を撮影しました。${data.itemName}を見せています）`); window.addToSessionHistory('nell', speech); }

        if (data.itemName && window.NellMemory && window.generateTradingCard) {
            let collectionCount = 0;
            try { const profile = await window.NellMemory.getUserProfile(currentUser.id); if (profile && Array.isArray(profile.collection)) { collectionCount = profile.collection.length; } } catch (e) {}
            const nextNo = collectionCount + 1;
            let cardDataUrl = null;
            try { cardDataUrl = await window.generateTradingCard(base64Data, data, currentUser, nextNo); } catch (genErr) { cardDataUrl = "data:image/jpeg;base64," + base64Data; }
            await window.NellMemory.addToCollection(currentUser.id, data.itemName, cardDataUrl, data.description, data.realDescription, locationData, data.rarity || 1);
            const notif = document.createElement('div');
            const cleanName = data.itemName.replace(/([一-龠々ヶ]+)[\(（]([ぁ-んァ-ンー]+)[\)）]/g, '$1');
            notif.innerText = `📖 図鑑に「${cleanName}」を登録したにゃ！`;
            notif.style.cssText = "position:fixed; top:20%; left:50%; transform:translateX(-50%); background:rgba(255,255,255,0.95); border:4px solid #00bcd4; color:#006064; padding:15px 25px; border-radius:30px; font-weight:900; z-index:10000; animation: popIn 0.5s ease; box-shadow:0 10px 25px rgba(0,0,0,0.3);";
            document.body.appendChild(notif);
            setTimeout(() => notif.remove(), 4000);
            if(window.safePlay) window.safePlay(window.sfxHirameku);
        }
    } catch (e) {
        if(typeof window.updateNellMessage === 'function') { window.updateNellMessage(`エラーだにゃ…: ${e.message || "解析失敗"}`, "thinking", false, true); }
    } finally {
        if (window.currentMode === 'chat') { 
            // 常時対話は再開しない
        }
    }
};

window.captureAndIdentifyItem = async function() {
    if (window.isLiveImageSending) return;
    const video = document.getElementById('live-chat-video');
    if (!video || !video.srcObject || !video.srcObject.active) { return alert("カメラが動いてないにゃ...。"); }
    window.isLiveImageSending = true;
    const btn = document.getElementById('live-camera-btn');
    if (btn) { btn.innerHTML = "<span>📡</span> 写真を準備中にゃ..."; btn.style.backgroundColor = "#ccc"; btn.disabled = true; }
    try {
        const canvas = document.createElement('canvas'); canvas.width = video.videoWidth || 640; canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        let compressedDataUrl = window.processImageForAI(canvas); let base64Data = compressedDataUrl.split(',')[1];
        await window.analyzeTreasureImage(base64Data, null);
    } catch (e) { console.error("Capture Error:", e); } finally {
        window.isLiveImageSending = false; window.stopPreviewCamera(); 
        if (btn) { btn.innerHTML = "<span>📷</span> 撮影"; btn.style.backgroundColor = "#ff85a1"; btn.disabled = false; }
    }
};

// ==========================================
// ★放課後おしゃべりタイム (WebSocket) 用のアルバム送信機能
// ==========================================

window.uploadFreeChatImage = function() {
    if (!window.liveSocket || window.liveSocket.readyState !== WebSocket.OPEN) {
        return alert("まずは「おはなしする」ボタンを押して、ネル先生とつながってにゃ！");
    }
    const input = document.getElementById('free-chat-image-upload');
    if (input) input.click();
};

// ★修正: FileList引数対応
window.handleFreeChatImageFile = async function(files) {
    if (!files || files.length === 0) return;
    const file = files[0];
    
    if (!window.liveSocket || window.liveSocket.readyState !== WebSocket.OPEN) {
        return alert("接続が切れちゃってるにゃ。もう一度「おはなしする」を押してにゃ。");
    }

    const btn = document.getElementById('upload-free-btn');
    const originalText = btn ? btn.innerText : "📁 アルバム";
    if (btn) {
        btn.innerText = "📡 送信中...";
        btn.style.backgroundColor = "#ccc";
        btn.disabled = true;
    }

    let locationInfo = "";
    try {
        const loc = await getGpsFromExif(file);
        if (loc) {
            locationInfo = `（この写真の位置情報: 緯度${loc.lat}, 経度${loc.lon}）`;
        }
    } catch (e) {}

    const reader = new FileReader();
    reader.onload = async (e) => {
        const img = new Image();
        img.onload = async () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 800;
            const scale = Math.min(1, MAX_WIDTH / img.width);
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.6);
            const base64Data = compressedDataUrl.split(',')[1];

            const flash = document.createElement('div');
            flash.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:white; opacity:0.8; z-index:9999; pointer-events:none; transition:opacity 0.3s;";
            document.body.appendChild(flash);
            setTimeout(() => { flash.style.opacity = 0; setTimeout(() => flash.remove(), 300); }, 50);

            const notif = document.createElement('div');
            notif.innerText = `📝 写真を送ったにゃ！`;
            notif.style.cssText = "position:fixed; top:20%; left:50%; transform:translateX(-50%); background:rgba(255,255,255,0.95); border:4px solid #8bc34a; color:#558b2f; padding:10px 20px; border-radius:30px; font-weight:bold; z-index:10000; animation: popIn 0.5s ease; box-shadow:0 4px 10px rgba(0,0,0,0.2);";
            document.body.appendChild(notif);
            setTimeout(() => notif.remove(), 2000);

            if (window.liveSocket && window.liveSocket.readyState === WebSocket.OPEN) {
                let promptText = `（ユーザーが画像を見せました${locationInfo}）この画像の内容について、子供にもわかるように楽しくおしゃべりしてください。`;
                window.liveSocket.send(JSON.stringify({ 
                    clientContent: { 
                        turns: [{ 
                            role: "user", 
                            parts: [ 
                                { text: promptText }, 
                                { inlineData: { mime_type: "image/jpeg", data: base64Data } } 
                            ] 
                        }], 
                        turnComplete: true 
                    } 
                }));
            }

            if(typeof window.updateNellMessage === 'function') window.updateNellMessage("ん？どれどれ…", "thinking", false, false);

            if (btn) {
                btn.innerText = originalText;
                btn.style.backgroundColor = "#4a90e2";
                btn.disabled = false;
            }
            const input = document.getElementById('free-chat-image-upload');
            if(input) input.value = '';
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
};

// ==========================================
// 宿題カメラ
// ==========================================

window.startHomeworkWebcam = async function() {
    const modal = document.getElementById('camera-modal'); const video = document.getElementById('camera-video'); const shutter = document.getElementById('camera-shutter-btn'); const cancel = document.getElementById('camera-cancel-btn');
    if (!modal || !video) return;
    document.body.classList.add('camera-active');
    try {
        let constraints = { video: { facingMode: "environment" } }; try { window.homeworkStream = await navigator.mediaDevices.getUserMedia(constraints); } catch (e) { window.homeworkStream = await navigator.mediaDevices.getUserMedia({ video: true }); }
        video.srcObject = window.homeworkStream; video.setAttribute('playsinline', true); await video.play(); modal.classList.remove('hidden');
        shutter.onclick = () => { const canvas = document.getElementById('camera-canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight; const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0, canvas.width, canvas.height); canvas.toBlob((blob) => { if(blob) { const file = new File([blob], "homework_capture.jpg", { type: "image/jpeg" }); window.closeHomeworkCamera(); window.handleFileUpload(file); } }, 'image/jpeg', 0.9); };
        cancel.onclick = window.closeHomeworkCamera;
    } catch (err) { alert("カメラエラー: " + err.message); window.closeHomeworkCamera(); }
};

window.closeHomeworkCamera = function() {
    const modal = document.getElementById('camera-modal'); const video = document.getElementById('camera-video');
    document.body.classList.remove('camera-active');
    if (window.homeworkStream) { window.homeworkStream.getTracks().forEach(t => t.stop()); window.homeworkStream = null; }
    if (video) { video.srcObject = null; video.load(); }
    if (modal) modal.classList.add('hidden');
};

window.handleFileUpload = async function(file) { 
    if (window.isAnalyzing || !file) return; 
    document.getElementById('upload-controls').classList.add('hidden'); 
    document.getElementById('cropper-modal').classList.remove('hidden'); 
    const canvas = document.getElementById('crop-canvas'); canvas.style.opacity = '0'; 
    const reader = new FileReader(); reader.onload = async (e) => { window.cropImg = new Image(); window.cropImg.onload = async () => { const w = window.cropImg.width; const h = window.cropImg.height; window.cropPoints = [ { x: w * 0.1, y: h * 0.1 }, { x: w * 0.9, y: h * 0.1 }, { x: w * 0.9, y: h * 0.9 }, { x: w * 0.1, y: h * 0.9 } ]; canvas.style.opacity = '1'; if(typeof window.updateNellMessage === 'function') window.updateNellMessage("ここを読み取るにゃ？", "normal"); window.initCustomCropper(); }; window.cropImg.src = e.target.result; }; reader.readAsDataURL(file); 
};

window.initCustomCropper = function() { 
    const modal = document.getElementById('cropper-modal'); modal.classList.remove('hidden'); const canvas = document.getElementById('crop-canvas'); const MAX_CANVAS_SIZE = 2500; let w = window.cropImg.width; let h = window.cropImg.height; if (w > MAX_CANVAS_SIZE || h > MAX_CANVAS_SIZE) { const scale = Math.min(MAX_CANVAS_SIZE / w, MAX_CANVAS_SIZE / h); w *= scale; h *= scale; window.cropPoints = window.cropPoints.map(p => ({ x: p.x * scale, y: p.y * scale })); } canvas.width = w; canvas.height = h; canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.objectFit = 'contain'; const ctx = canvas.getContext('2d'); ctx.drawImage(window.cropImg, 0, 0, w, h); window.updateCropUI(canvas); 
    const handles = ['handle-tl', 'handle-tr', 'handle-br', 'handle-bl']; handles.forEach((id, idx) => { const el = document.getElementById(id); const startDrag = (e) => { e.preventDefault(); window.activeHandle = idx; }; el.onmousedown = startDrag; el.ontouchstart = startDrag; }); 
    const move = (e) => { if (window.activeHandle === -1) return; e.preventDefault(); const rect = canvas.getBoundingClientRect(); const imgRatio = canvas.width / canvas.height; const rectRatio = rect.width / rect.height; let drawX, drawY, drawW, drawH; if (imgRatio > rectRatio) { drawW = rect.width; drawH = rect.width / imgRatio; drawX = 0; drawY = (rect.height - drawH) / 2; } else { drawH = rect.height; drawW = rect.height * imgRatio; drawY = 0; drawX = (rect.width - drawW) / 2; } const clientX = e.touches ? e.touches[0].clientX : e.clientX; const clientY = e.touches ? e.touches[0].clientY : e.clientY; let relX = (clientX - rect.left - drawX) / drawW; let relY = (clientY - rect.top - drawY) / drawH; relX = Math.max(0, Math.min(1, relX)); relY = Math.max(0, Math.min(1, relY)); window.cropPoints[window.activeHandle] = { x: relX * canvas.width, y: relY * canvas.height }; window.updateCropUI(canvas); }; 
    const end = () => { window.activeHandle = -1; }; window.onmousemove = move; window.ontouchmove = move; window.onmouseup = end; window.ontouchend = end; 
    document.getElementById('cropper-cancel-btn').onclick = () => { modal.classList.add('hidden'); window.onmousemove = null; window.ontouchmove = null; document.getElementById('upload-controls').classList.remove('hidden'); }; 
    document.getElementById('cropper-ok-btn').onclick = () => { if (window.sfxHirameku) { const originalVol = window.sfxHirameku.volume; window.sfxHirameku.volume = 0; window.sfxHirameku.play().then(() => { window.sfxHirameku.pause(); window.sfxHirameku.currentTime = 0; window.sfxHirameku.volume = originalVol; }).catch(e => {}); } if (window.initAudioContext) { window.initAudioContext().catch(()=>{}); } modal.classList.add('hidden'); window.onmousemove = null; window.ontouchmove = null; const croppedBase64 = window.performPerspectiveCrop(canvas, window.cropPoints); window.startAnalysis(croppedBase64); }; 
};

window.updateCropUI = function(canvas) { 
    const handles = ['handle-tl', 'handle-tr', 'handle-br', 'handle-bl']; const rect = canvas.getBoundingClientRect(); const imgRatio = canvas.width / canvas.height; const rectRatio = rect.width / rect.height; let drawX, drawY, drawW, drawH; if (imgRatio > rectRatio) { drawW = rect.width; drawH = rect.width / imgRatio; drawX = 0; drawY = (rect.height - drawH) / 2; } else { drawH = rect.height; drawW = rect.height * imgRatio; drawY = 0; drawX = (rect.width - drawW) / 2; } const toScreen = (p) => ({ x: (p.x / canvas.width) * drawW + drawX + canvas.offsetLeft, y: (p.y / canvas.height) * drawH + drawY + canvas.offsetTop }); const screenPoints = window.cropPoints.map(toScreen); handles.forEach((id, i) => { const el = document.getElementById(id); el.style.left = screenPoints[i].x + 'px'; el.style.top = screenPoints[i].y + 'px'; }); const svg = document.getElementById('crop-lines'); svg.style.left = canvas.offsetLeft + 'px'; svg.style.top = canvas.offsetTop + 'px'; svg.style.width = canvas.offsetWidth + 'px'; svg.style.height = canvas.offsetHeight + 'px'; const toSvg = (p) => ({ x: (p.x / canvas.width) * drawW + drawX, y: (p.y / canvas.height) * drawH + drawY }); const svgPts = window.cropPoints.map(toSvg); const ptsStr = svgPts.map(p => `${p.x},${p.y}`).join(' '); svg.innerHTML = `<polyline points="${ptsStr} ${svgPts[0].x},${svgPts[0].y}" style="fill:rgba(255,255,255,0.2);stroke:#ff4081;stroke-width:2;stroke-dasharray:5" />`; 
};

window.performPerspectiveCrop = function(sourceCanvas, points) { 
    const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x)); const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y)); let w = maxX - minX, h = maxY - minY; if (w < 1) w = 1; if (h < 1) h = 1; const tempCv = document.createElement('canvas'); tempCv.width = w; tempCv.height = h; const ctx = tempCv.getContext('2d'); ctx.drawImage(sourceCanvas, minX, minY, w, h, 0, 0, w, h); const result = window.processImageForAI(tempCv).split(',')[1]; tempCv.width = 1; tempCv.height = 1; return result; 
};

window.startAnalysis = async function(b64) {
    const now = Date.now();
    if (window.lastAnalysisTime && (now - window.lastAnalysisTime < 30000)) {
         if(typeof window.updateNellMessage === 'function') {
             window.updateNellMessage("ちょっと待ってにゃ、目が回っちゃうにゃ…少し休ませてにゃ。", "thinking", false, true);
         }
         document.getElementById('cropper-modal').classList.add('hidden'); 
         document.getElementById('upload-controls').classList.remove('hidden'); 
         return;
    }
    window.lastAnalysisTime = now;

    if (window.isAnalyzing) return;
    if (typeof window.stopAlwaysOnListening === 'function') window.stopAlwaysOnListening();
    
    window.isAnalyzing = true; 
    document.getElementById('cropper-modal').classList.add('hidden'); 
    document.getElementById('thinking-view').classList.remove('hidden'); 
    document.getElementById('upload-controls').classList.add('hidden'); 
    const backBtn = document.getElementById('main-back-btn'); 
    if(backBtn) backBtn.classList.add('hidden'); 
    
    try { 
        window.sfxBunseki.currentTime = 0; 
        window.sfxBunseki.loop = true; 
        if(window.safePlay) window.safePlay(window.sfxBunseki); 
    } catch(e){}
    
    let p = 0; 
    const timer = setInterval(() => { 
        if (!window.isAnalyzing) { clearInterval(timer); return; } 
        if (p < 30) p += 1; else if (p < 80) p += 0.4; else if (p < 95) p += 0.1; 
        if(typeof window.updateProgress === 'function') window.updateProgress(p); 
    }, 300);

    const performAnalysisNarration = async () => { 
        const msgs = [ 
            { text: "じーっと見て、問題を書き写してるにゃ…", mood: "thinking" }, 
            { text: "肉球がちょっとじゃまだにゃ…", mood: "thinking" }, 
            { text: "ふむふむ…この問題、なかなか手強いにゃ…", mood: "thinking" }, 
            { text: "今、ネル先生の天才的な頭脳で解いてるからにゃね…", mood: "thinking" }, 
            { text: "この問題、どこかで見たことあるにゃ…えーっと…", mood: "thinking" }, 
            { text: "しっぽの先まで集中して考え中だにゃ…", mood: "thinking" }, 
            { text: "この問題は手強いにゃ…。でも大丈夫、ネル先生のピピピッ！と光るヒゲが、正解をバッチリ受信してるにゃ！", mood: "thinking" }, 
            { text: "にゃるほど…だいたい分かってきたにゃ…", mood: "thinking" }, 
            { text: "あとちょっとで、ネル先生の脳みそが『ピコーン！』って鳴るにゃ！", mood: "thinking" } 
        ]; 
        
        for (const item of msgs) { 
            if (!window.isAnalyzing) return; 
            if(typeof window.updateNellMessage === 'function') {
                await window.updateNellMessage(item.text, item.mood, false, true);
            }
            if (!window.isAnalyzing) return; 
            
            const waitTime = Math.max(3000, item.text.length * 250); 
            await new Promise(r => setTimeout(r, waitTime)); 
        } 
    }; 
    
    performAnalysisNarration();

    try { 
        const res = await fetch('/analyze', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ image: b64, mode: window.currentMode, grade: currentUser.grade, subject: window.currentSubject, name: currentUser.name }) 
        }); 
        
        if (!res.ok) throw new Error("Server Error"); 
        const data = await res.json(); 
        if (!data || !Array.isArray(data) || data.length === 0) throw new Error("データが空か、正しい形式ではありませんでした。"); 
        
        window.transcribedProblems = data.map((prob, index) => { 
            let studentArr = Array.isArray(prob.student_answer) ? prob.student_answer : (prob.student_answer ? [prob.student_answer] : []); 
            let correctArr = Array.isArray(prob.correct_answer) ? prob.correct_answer : (prob.correct_answer ? [prob.correct_answer] : []); 
            return { ...prob, id: index + 1, student_answer: studentArr, correct_answer: correctArr, status: (studentArr.length > 0 && studentArr[0] !== "") ? "answered" : "unanswered", currentHintLevel: 1, maxUnlockedHintLevel: 0 }; 
        }); 
        
        window.isAnalyzing = false; 
        clearInterval(timer); 
        if(typeof window.updateProgress === 'function') window.updateProgress(100); 
        
        window.cleanupAnalysis(); 
        
        if(window.safePlay) window.safePlay(window.sfxHirameku); 
        
        setTimeout(() => { 
            document.getElementById('thinking-view').classList.add('hidden'); 
            const doneMsg = "読めたにゃ！"; 
            if (window.currentMode === 'grade') { 
                if(typeof window.showGradingView === 'function') window.showGradingView(true); 
                if(typeof window.updateNellMessage === 'function') window.updateNellMessage(doneMsg, "happy", false).then(() => { if(typeof window.updateGradingMessage === 'function') setTimeout(window.updateGradingMessage, 1500); }); 
            } else { 
                if(typeof window.renderProblemSelection === 'function') window.renderProblemSelection(); 
                if(typeof window.updateNellMessage === 'function') window.updateNellMessage(doneMsg, "happy", false); 
            } 
            if (window.currentMode === 'explain' || window.currentMode === 'grade' || window.currentMode === 'review') { 
                if(typeof window.startAlwaysOnListening === 'function') window.startAlwaysOnListening(); 
            } 
        }, 1500); 
    } catch (err) { 
        console.error("Analysis Error:", err); 
        window.isAnalyzing = false; 
        window.cleanupAnalysis(); 
        clearInterval(timer); 
        document.getElementById('thinking-view').classList.add('hidden'); 
        document.getElementById('upload-controls').classList.remove('hidden'); 
        if(backBtn) backBtn.classList.remove('hidden'); 
        if(typeof window.updateNellMessage === 'function') window.updateNellMessage("うまく読めなかったにゃ…もう一度お願いにゃ！", "thinking", false); 
        if (window.currentMode === 'explain' || window.currentMode === 'grade' || window.currentMode === 'review') { 
            if(typeof window.startAlwaysOnListening === 'function') window.startAlwaysOnListening(); 
        } 
    }
};

window.cleanupAnalysis = function() { 
    window.isAnalyzing = false; 
    window.sfxBunseki.pause(); 
    if(typeof window.cancelNellSpeech === 'function') window.cancelNellSpeech();
    
    if(typeof window.analysisTimers !== 'undefined' && window.analysisTimers) { 
        window.analysisTimers.forEach(t => clearTimeout(t)); 
        window.analysisTimers = []; 
    } 
};

// ★修正: FileList引数対応
window.uploadChatImage = function(context = 'embedded') {
    let inputId; if(context === 'embedded') inputId = 'embedded-image-upload'; else if(context === 'simple') inputId = 'simple-image-upload';
    const input = document.getElementById(inputId); if(input) input.click();
};

window.handleChatImageFile = async function(files, context = 'embedded') {
    if (!files || files.length === 0) return;
    const file = files[0];
    
    let btnId; if(context === 'embedded') btnId = 'upload-embedded-btn'; else if(context === 'simple') btnId = 'upload-simple-btn';
    const btn = document.getElementById(btnId);
    if(btn) { btn.innerHTML = "<span>📡</span> 解析中..."; btn.style.backgroundColor = "#ccc"; btn.disabled = true; }
    
    let imageLocation = null;
    try { imageLocation = await getGpsFromExif(file); } catch(e) {}

    const reader = new FileReader();
    reader.onload = async (e) => {
        const img = new Image();
        img.onload = async () => {
            const canvas = document.createElement('canvas'); const MAX_WIDTH = 800; const scale = Math.min(1, MAX_WIDTH / img.width); canvas.width = img.width * scale; canvas.height = img.height * scale;
            const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.6); const base64Data = compressedDataUrl.split(',')[1];
            
            await window.sendImageToChatAPI(base64Data, context, imageLocation);
            
            if(btn) { btn.innerHTML = "<span>📁</span> アルバム"; btn.style.backgroundColor = "#4a90e2"; btn.disabled = false; }
            let inputId; if(context === 'embedded') inputId = 'embedded-image-upload'; else if(context === 'simple') inputId = 'simple-image-upload';
            const input = document.getElementById(inputId); if(input) input.value = '';
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
};

window.sendImageToChatAPI = async function(base64Data, context, imageLocation = null) {
    if(typeof window.addLogItem === 'function') window.addLogItem('user', '（画像送信）');
    let memoryContext = ""; if (window.NellMemory && currentUser) { try { memoryContext = await window.NellMemory.generateContextString(currentUser.id); } catch(e) {} }
    
    const useImageLocation = !!imageLocation;
    const finalLocation = imageLocation || window.currentLocation;
    const finalAddress = useImageLocation ? null : window.currentAddress;

    try {
        if(typeof window.updateNellMessage === 'function') window.updateNellMessage("ん？どれどれ…", "thinking", false, true);
        const res = await fetch('/chat-dialogue', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                image: base64Data, 
                text: "この写真に写っているものについて解説してください", 
                name: currentUser ? currentUser.name : "生徒", 
                history: window.chatSessionHistory, 
                location: finalLocation, 
                address: finalAddress,   
                memoryContext: memoryContext 
            })
        });
        if (!res.ok) throw new Error("Server response not ok"); const data = await res.json();
        const speechText = data.speech || data.reply || "教えてあげるにゃ！";
        if(typeof window.addLogItem === 'function') window.addLogItem('nell', speechText); if(typeof window.addToSessionHistory === 'function') window.addToSessionHistory('nell', speechText);
        if(typeof window.updateNellMessage === 'function') await window.updateNellMessage(speechText, "happy", true, true);
        let boardId = (context === 'embedded') ? 'embedded-chalkboard' : 'chalkboard-simple'; const embedBoard = document.getElementById(boardId); if (embedBoard && data.board && data.board.trim() !== "") { embedBoard.innerText = data.board; embedBoard.classList.remove('hidden'); }
    } catch(e) {
        console.error("HTTP Image Error:", e); if(typeof window.updateNellMessage === 'function') window.updateNellMessage("よく見えなかったにゃ…もう一回お願いにゃ！", "thinking", false, true);
    }
};