// --- js/camera-service.js (v308.0: 図鑑撮影時位置情報待機版) ---

// ==========================================
// プレビューカメラ制御 (共通)
// ==========================================

window.startPreviewCamera = async function(videoId = 'live-chat-video', containerId = 'live-chat-video-container') {
    const video = document.getElementById(videoId);
    const container = document.getElementById(containerId);
    if (!video || !container) return;

    try {
        if (window.previewStream) {
            window.previewStream.getTracks().forEach(t => t.stop());
        }
        try {
            window.previewStream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: "environment" },
                audio: false 
            });
        } catch(e) {
            window.previewStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
        video.srcObject = window.previewStream;
        await video.play();
        container.style.display = 'block';

    } catch (e) {
        console.warn("[Preview] Camera init failed:", e);
        alert("カメラが使えないにゃ…。");
    }
};

window.stopPreviewCamera = function() {
    if (window.previewStream) {
        window.previewStream.getTracks().forEach(t => t.stop());
        window.previewStream = null;
    }
    ['live-chat-video', 'live-chat-video-embedded', 'live-chat-video-simple', 'live-chat-video-free'].forEach(vid => {
        const v = document.getElementById(vid);
        if(v) v.srcObject = null;
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

window.createTreasureImage = function(sourceCanvas) {
    const OUTPUT_SIZE = 320; 
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext('2d');
    
    const size = Math.min(sourceCanvas.width, sourceCanvas.height);
    const sx = (sourceCanvas.width - size) / 2;
    const sy = (sourceCanvas.height - size) / 2;
    
    ctx.fillStyle = "#ffffff";
    ctx.save();
    ctx.beginPath();
    ctx.arc(OUTPUT_SIZE/2, OUTPUT_SIZE/2, OUTPUT_SIZE/2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(sourceCanvas, sx, sy, size, size, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    ctx.restore();
    
    ctx.save();
    ctx.beginPath();
    ctx.arc(OUTPUT_SIZE/2, OUTPUT_SIZE/2, OUTPUT_SIZE/2 - 5, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffd700'; 
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.restore();
    
    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.beginPath();
    ctx.arc(OUTPUT_SIZE*0.2, OUTPUT_SIZE*0.2, OUTPUT_SIZE*0.05, 0, Math.PI*2);
    ctx.fill();
    
    return canvas.toDataURL('image/jpeg', 0.8);
};

// GPS取得ヘルパー (フォールバック用: 高精度)
const getLocation = () => {
    return new Promise((resolve) => {
        if (!navigator.geolocation) return resolve(null);
        
        const timeoutId = setTimeout(() => {
            console.warn("GPS Timeout (Fallback)");
            resolve(null);
        }, 10000); // 10秒待つ

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                clearTimeout(timeoutId);
                resolve({ 
                    lat: pos.coords.latitude, 
                    lon: pos.coords.longitude, 
                    accuracy: pos.coords.accuracy 
                });
            },
            (err) => { 
                clearTimeout(timeoutId);
                console.warn("GPS Error (Fallback):", err); 
                resolve(null); 
            },
            { timeout: 10000, enableHighAccuracy: true } // ★高精度
        );
    });
};

window.captureAndIdentifyItem = async function() {
    if (window.isLiveImageSending) return;
    
    if (window.isAlwaysListening && window.continuousRecognition) {
        try { window.continuousRecognition.stop(); } catch(e){}
    }

    const video = document.getElementById('live-chat-video');
    if (!video || !video.srcObject || !video.srcObject.active) {
        return alert("カメラが動いてないにゃ...。");
    }

    window.isLiveImageSending = true;
    const btn = document.getElementById('live-camera-btn');
    if (btn) {
        btn.innerHTML = "<span>📡</span> 場所と物を解析中にゃ...";
        btn.style.backgroundColor = "#ccc";
        btn.disabled = true;
    }

    // ★追加: 位置情報の精度チェックと待機
    let locationData = window.currentLocation;
    
    // 位置情報がない、または精度が悪い(1000m以上ズレている)場合は、少し待ってみる
    if (!locationData || locationData.accuracy > 1000) {
        console.log("位置情報の精度向上を待機中...");
        if(typeof window.updateNellMessage === 'function') {
            window.updateNellMessage("ん？詳しい場所を調べてるにゃ…ちょっと待ってにゃ…", "thinking", false, true);
        }
        
        // 3秒間だけ待つループ（0.5秒ごとにチェック）
        for (let i = 0; i < 6; i++) {
            await new Promise(r => setTimeout(r, 500));
            if (window.currentLocation && window.currentLocation.accuracy <= 1000) {
                locationData = window.currentLocation;
                break;
            }
        }
    }
    
    // 最終的に取得できたデータを使用 (待ってもダメならあるもので行く)
    locationData = window.currentLocation;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const base64Data = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
    const treasureDataUrl = window.createTreasureImage(canvas);

    const flash = document.createElement('div');
    flash.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:white; opacity:0.8; z-index:9999; pointer-events:none; transition:opacity 0.3s;";
    document.body.appendChild(flash);
    setTimeout(() => { flash.style.opacity = 0; setTimeout(() => flash.remove(), 300); }, 50);

    if(typeof window.updateNellMessage === 'function') {
        window.updateNellMessage("ん？何を見つけたのかにゃ…？", "thinking", false, true);
    }

    // 位置情報がまだnullならフォールバックを実行
    if (!locationData) {
        console.log("Using fallback GPS...");
        try {
            locationData = await getLocation();
        } catch(e) {
            console.warn("Fallback GPS failed");
        }
    } else {
        console.log("Using cached GPS:", locationData);
    }

    try {
        const res = await fetch('/identify-item', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                image: base64Data,
                name: currentUser ? currentUser.name : "生徒",
                location: locationData // 位置情報
            })
        });

        if (!res.ok) throw new Error("Server response not ok");

        const data = await res.json();
        
        let speech = "";
        if(typeof window.updateNellMessage === 'function') {
            if (data.speechText) {
                speech = data.speechText;
                await window.updateNellMessage(data.speechText, "happy", true, true);
            } else if (data.text) {
                speech = data.text;
                await window.updateNellMessage(data.text, "happy", true, true); 
            }
        }
        
        if (speech && typeof window.addToSessionHistory === 'function') {
            window.addToSessionHistory('user', `（写真を撮影しました。${data.itemName}を見せています）`);
            window.addToSessionHistory('nell', speech);
        }

        if (data.itemName && window.NellMemory) {
            const description = data.description || "（解説はないにゃ）";
            const realDescription = data.realDescription || "";
            await window.NellMemory.addToCollection(currentUser.id, data.itemName, treasureDataUrl, description, realDescription);
            
            const notif = document.createElement('div');
            notif.innerText = `📖 図鑑に「${data.itemName}」を登録したにゃ！`;
            notif.style.cssText = "position:fixed; top:20%; left:50%; transform:translateX(-50%); background:rgba(255,255,255,0.95); border:4px solid #00bcd4; color:#006064; padding:15px 25px; border-radius:30px; font-weight:900; z-index:10000; animation: popIn 0.5s ease; box-shadow:0 10px 25px rgba(0,0,0,0.3);";
            document.body.appendChild(notif);
            setTimeout(() => notif.remove(), 4000);
            if(window.safePlay) window.safePlay(window.sfxHirameku);
        }

    } catch (e) {
        console.error("Identify Error:", e);
        if(typeof window.updateNellMessage === 'function') window.updateNellMessage("よく見えなかったにゃ…もう一回見せてにゃ？", "thinking", false, true);
    } finally {
        window.isLiveImageSending = false;
        
        window.stopPreviewCamera(); 
        if (btn) {
            btn.innerHTML = "<span>📷</span> お宝を見せる（図鑑登録）";
            btn.style.backgroundColor = "#ff85a1"; 
            btn.disabled = false;
        }
        
        if (window.isAlwaysListening && window.currentMode === 'chat') {
            try { window.continuousRecognition.start(); } catch(e){}
        }
    }
};

window.startHomeworkWebcam = async function() {
    const modal = document.getElementById('camera-modal');
    const video = document.getElementById('camera-video');
    const shutter = document.getElementById('camera-shutter-btn');
    const cancel = document.getElementById('camera-cancel-btn');
    if (!modal || !video) return;
    try {
        let constraints = { video: { facingMode: "environment" } };
        try { window.homeworkStream = await navigator.mediaDevices.getUserMedia(constraints); } 
        catch (e) { window.homeworkStream = await navigator.mediaDevices.getUserMedia({ video: true }); }
        video.srcObject = window.homeworkStream;
        video.setAttribute('playsinline', true); 
        await video.play();
        modal.classList.remove('hidden');
        shutter.onclick = () => {
            const canvas = document.getElementById('camera-canvas');
            canvas.width = video.videoWidth; canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => {
                if(blob) {
                    const file = new File([blob], "homework_capture.jpg", { type: "image/jpeg" });
                    window.closeHomeworkCamera();
                    window.handleFileUpload(file);
                }
            }, 'image/jpeg', 0.9);
        };
        cancel.onclick = window.closeHomeworkCamera;
    } catch (err) { alert("カメラエラー: " + err.message); window.closeHomeworkCamera(); }
};

window.closeHomeworkCamera = function() {
    const modal = document.getElementById('camera-modal');
    const video = document.getElementById('camera-video');
    if (window.homeworkStream) { window.homeworkStream.getTracks().forEach(t => t.stop()); window.homeworkStream = null; }
    if (video) video.srcObject = null;
    if (modal) modal.classList.add('hidden');
};

window.handleFileUpload = async function(file) { 
    if (window.isAnalyzing || !file) return; 
    document.getElementById('upload-controls').classList.add('hidden'); 
    document.getElementById('cropper-modal').classList.remove('hidden'); 
    const canvas = document.getElementById('crop-canvas'); 
    canvas.style.opacity = '0'; 
    const reader = new FileReader(); 
    reader.onload = async (e) => { 
        window.cropImg = new Image(); 
        window.cropImg.onload = async () => { 
            const w = window.cropImg.width; 
            const h = window.cropImg.height; 
            window.cropPoints = [ { x: w * 0.1, y: h * 0.1 }, { x: w * 0.9, y: h * 0.1 }, { x: w * 0.9, y: h * 0.9 }, { x: w * 0.1, y: h * 0.9 } ]; 
            canvas.style.opacity = '1'; 
            if(typeof window.updateNellMessage === 'function') window.updateNellMessage("ここを読み取るにゃ？", "normal"); 
            window.initCustomCropper(); 
        }; 
        window.cropImg.src = e.target.result; 
    }; 
    reader.readAsDataURL(file); 
};

window.initCustomCropper = function() { 
    const modal = document.getElementById('cropper-modal'); 
    modal.classList.remove('hidden'); 
    const canvas = document.getElementById('crop-canvas'); 
    const MAX_CANVAS_SIZE = 2500; 
    let w = window.cropImg.width; 
    let h = window.cropImg.height; 
    if (w > MAX_CANVAS_SIZE || h > MAX_CANVAS_SIZE) { 
        const scale = Math.min(MAX_CANVAS_SIZE / w, MAX_CANVAS_SIZE / h); 
        w *= scale; h *= scale; 
        window.cropPoints = window.cropPoints.map(p => ({ x: p.x * scale, y: p.y * scale })); 
    } 
    canvas.width = w; canvas.height = h; 
    canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.objectFit = 'contain'; 
    const ctx = canvas.getContext('2d'); 
    ctx.drawImage(window.cropImg, 0, 0, w, h); 
    window.updateCropUI(canvas); 
    const handles = ['handle-tl', 'handle-tr', 'handle-br', 'handle-bl']; 
    handles.forEach((id, idx) => { 
        const el = document.getElementById(id); 
        const startDrag = (e) => { e.preventDefault(); window.activeHandle = idx; }; 
        el.onmousedown = startDrag; el.ontouchstart = startDrag; 
    }); 
    const move = (e) => { 
        if (window.activeHandle === -1) return; 
        e.preventDefault(); 
        const rect = canvas.getBoundingClientRect(); 
        const imgRatio = canvas.width / canvas.height; 
        const rectRatio = rect.width / rect.height; 
        let drawX, drawY, drawW, drawH; 
        if (imgRatio > rectRatio) { 
            drawW = rect.width; drawH = rect.width / imgRatio; drawX = 0; drawY = (rect.height - drawH) / 2; 
        } else { 
            drawH = rect.height; drawW = rect.height * imgRatio; drawY = 0; drawX = (rect.width - drawW) / 2; 
        } 
        const clientX = e.touches ? e.touches[0].clientX : e.clientX; 
        const clientY = e.touches ? e.touches[0].clientY : e.clientY; 
        let relX = (clientX - rect.left - drawX) / drawW; 
        let relY = (clientY - rect.top - drawY) / drawH; 
        relX = Math.max(0, Math.min(1, relX)); relY = Math.max(0, Math.min(1, relY)); 
        window.cropPoints[window.activeHandle] = { x: relX * canvas.width, y: relY * canvas.height }; 
        window.updateCropUI(canvas); 
    }; 
    const end = () => { window.activeHandle = -1; }; 
    window.onmousemove = move; window.ontouchmove = move; window.onmouseup = end; window.ontouchend = end; 
    document.getElementById('cropper-cancel-btn').onclick = () => { 
        modal.classList.add('hidden'); 
        window.onmousemove = null; window.ontouchmove = null; 
        document.getElementById('upload-controls').classList.remove('hidden'); 
    }; 
    document.getElementById('cropper-ok-btn').onclick = () => { 
        modal.classList.add('hidden'); 
        window.onmousemove = null; window.ontouchmove = null; 
        const croppedBase64 = window.performPerspectiveCrop(canvas, window.cropPoints); 
        window.startAnalysis(croppedBase64); 
    }; 
};

window.updateCropUI = function(canvas) { 
    const handles = ['handle-tl', 'handle-tr', 'handle-br', 'handle-bl']; 
    const rect = canvas.getBoundingClientRect(); 
    const imgRatio = canvas.width / canvas.height; 
    const rectRatio = rect.width / rect.height; 
    let drawX, drawY, drawW, drawH; 
    if (imgRatio > rectRatio) { 
        drawW = rect.width; drawH = rect.width / imgRatio; drawX = 0; drawY = (rect.height - drawH) / 2; 
    } else { 
        drawH = rect.height; drawW = rect.height * imgRatio; drawY = 0; drawX = (rect.width - drawW) / 2; 
    } 
    const toScreen = (p) => ({ x: (p.x / canvas.width) * drawW + drawX + canvas.offsetLeft, y: (p.y / canvas.height) * drawH + drawY + canvas.offsetTop }); 
    const screenPoints = window.cropPoints.map(toScreen); 
    handles.forEach((id, i) => { 
        const el = document.getElementById(id); 
        el.style.left = screenPoints[i].x + 'px'; el.style.top = screenPoints[i].y + 'px'; 
    }); 
    const svg = document.getElementById('crop-lines'); 
    svg.style.left = canvas.offsetLeft + 'px'; svg.style.top = canvas.offsetTop + 'px'; svg.style.width = canvas.offsetWidth + 'px'; svg.style.height = canvas.offsetHeight + 'px'; 
    const toSvg = (p) => ({ x: (p.x / canvas.width) * drawW + drawX, y: (p.y / canvas.height) * drawH + drawY }); 
    const svgPts = window.cropPoints.map(toSvg); 
    const ptsStr = svgPts.map(p => `${p.x},${p.y}`).join(' '); 
    svg.innerHTML = `<polyline points="${ptsStr} ${svgPts[0].x},${svgPts[0].y}" style="fill:rgba(255,255,255,0.2);stroke:#ff4081;stroke-width:2;stroke-dasharray:5" />`; 
};

window.processImageForAI = function(sourceCanvas) { 
    const MAX_WIDTH = 1600; 
    let w = sourceCanvas.width; let h = sourceCanvas.height; 
    if (w > MAX_WIDTH || h > MAX_WIDTH) { 
        if (w > h) { h *= MAX_WIDTH / w; w = MAX_WIDTH; } else { w *= MAX_WIDTH / h; h = MAX_WIDTH; } 
    } 
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; 
    const ctx = canvas.getContext('2d'); ctx.drawImage(sourceCanvas, 0, 0, w, h); 
    return canvas.toDataURL('image/jpeg', 0.9); 
};

window.performPerspectiveCrop = function(sourceCanvas, points) { 
    const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x)); 
    const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y)); 
    let w = maxX - minX, h = maxY - minY; 
    if (w < 1) w = 1; if (h < 1) h = 1; 
    const tempCv = document.createElement('canvas'); tempCv.width = w; tempCv.height = h; 
    const ctx = tempCv.getContext('2d'); ctx.drawImage(sourceCanvas, minX, minY, w, h, 0, 0, w, h); 
    return window.processImageForAI(tempCv).split(',')[1]; 
};

// ==========================================
// 宿題分析 (AI API連携)
// ==========================================

window.startAnalysis = async function(b64) {
    if (window.isAnalyzing) return;
    window.isAnalyzing = true; 
    document.getElementById('cropper-modal').classList.add('hidden'); 
    document.getElementById('thinking-view').classList.remove('hidden'); 
    document.getElementById('upload-controls').classList.add('hidden'); 
    const backBtn = document.getElementById('main-back-btn'); if(backBtn) backBtn.classList.add('hidden');
    
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
            if(typeof window.updateNellMessage === 'function') await window.updateNellMessage(item.text, item.mood, false); 
            if (!window.isAnalyzing) return; 
            await new Promise(r => setTimeout(r, 2000));
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
        
        window.isAnalyzing = false; clearInterval(timer); 
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
        }, 1500); 
    } catch (err) { 
        console.error("Analysis Error:", err); 
        window.isAnalyzing = false; window.cleanupAnalysis(); clearInterval(timer); 
        document.getElementById('thinking-view').classList.add('hidden'); document.getElementById('upload-controls').classList.remove('hidden'); 
        if(backBtn) backBtn.classList.remove('hidden'); 
        if(typeof window.updateNellMessage === 'function') window.updateNellMessage("うまく読めなかったにゃ…もう一度お願いにゃ！", "thinking", false); 
    }
};

window.cleanupAnalysis = function() { 
    window.isAnalyzing = false; 
    window.sfxBunseki.pause(); 
    if(typeof window.analysisTimers !== 'undefined' && window.analysisTimers) { 
        window.analysisTimers.forEach(t => clearTimeout(t)); 
        window.analysisTimers = []; 
    } 
};