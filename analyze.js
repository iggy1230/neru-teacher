// --- analyze.js (完全版 v276.2: クロップ画面表示修正・全機能統合版) ---

// ==========================================
// 1. 最重要：UI操作・モード選択関数
// ==========================================

// グローバル変数の定義
window.currentMode = ''; 
window.currentSubject = '';
window.isAnalyzing = false;
window.transcribedProblems = []; 
window.selectedProblem = null; 
window.hintIndex = 0; 
window.lunchCount = 0; 
window.analysisType = 'precision';
window.gradingTimer = null; 
window.isComposing = false;

// 音声・Socket関連変数
let liveSocket = null;
let audioContext = null;
let mediaStream = null;
let workletNode = null;
let stopSpeakingTimer = null;
let speakingStartTimer = null;
let currentTtsSource = null;
let chatTranscript = ""; 
let nextStartTime = 0;
let connectionTimeout = null;
let recognition = null;
let isRecognitionActive = false;
let liveAudioSources = []; 
let ignoreIncomingAudio = false;
let currentLiveAudioSource = null;
window.isLiveImageSending = false;
window.isMicMuted = false;
window.lastSentCollectionImage = null;
let activeChatContext = null; 
let streamTextBuffer = "";
let ttsTextBuffer = "";
let latestDetectedName = null;

// 常時聞き取り用のフラグ
let isAlwaysListening = false;
let continuousRecognition = null;

// ゲーム・Cropper関連
let gameCanvas, ctx, ball, paddle, bricks, score, gameRunning = false, gameAnimId = null;
let cropImg = new Image();
let cropPoints = [];
let activeHandle = -1;
let analysisTimers = [];
let homeworkStream = null;

// タイマー関連
let studyTimerValue = 0;
let studyTimerInterval = null;
let studyTimerRunning = false;
let studyTimerCheck = 0; 

// プレビューカメラ用 (お宝図鑑専用)
let previewStream = null;

// ★ selectMode
window.selectMode = function(m) {
    try {
        console.log(`[UI] selectMode called: ${m}`);
        currentMode = m; 
        
        // 画面切り替え
        if (typeof window.switchScreen === 'function') {
            window.switchScreen('screen-main'); 
        } else {
            document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
            document.getElementById('screen-main').classList.remove('hidden');
        }

        // 各種ビューの表示リセット
        const ids = ['subject-selection-view', 'upload-controls', 'thinking-view', 'problem-selection-view', 'final-view', 'chalkboard', 'chat-view', 'simple-chat-view', 'lunch-view', 'grade-sheet-container', 'hint-detail-container', 'embedded-chat-section'];
        ids.forEach(id => { 
            const el = document.getElementById(id); 
            if (el) el.classList.add('hidden'); 
        });
        
        const backBtn = document.getElementById('main-back-btn');
        if (backBtn) { backBtn.classList.remove('hidden'); backBtn.onclick = window.backToLobby; }
        
        // モード切り替え時は既存の接続/カメラをクリア
        stopAlwaysOnListening();
        if (typeof window.stopLiveChat === 'function') window.stopLiveChat();
        stopPreviewCamera(); 
        
        gameRunning = false;
        const icon = document.querySelector('.nell-avatar-wrap img'); 
        if(icon) icon.src = "nell-normal.png";
        
        const miniKarikari = document.getElementById('mini-karikari-display');
        if(miniKarikari) miniKarikari.classList.remove('hidden');
        if(typeof updateMiniKarikari === 'function') updateMiniKarikari();
        
        // --- モード別表示制御 ---
        if (m === 'chat') { 
            // お宝図鑑モード
            document.getElementById('chat-view').classList.remove('hidden'); 
            window.updateNellMessage("お宝を見せてにゃ！お話もできるにゃ！", "excited", false); 
            startPreviewCamera();
            startAlwaysOnListening(); 
        } 
        else if (m === 'simple-chat') {
            document.getElementById('simple-chat-view').classList.remove('hidden');
            window.updateNellMessage("今日はお話だけするにゃ？", "gentle", false);
        }
        else if (m === 'lunch') { 
            document.getElementById('lunch-view').classList.remove('hidden'); 
            window.updateNellMessage("お腹ペコペコだにゃ……", "thinking", false); 
        } 
        else if (m === 'review') { 
            renderMistakeSelection(); 
            document.getElementById('embedded-chat-section').classList.remove('hidden'); 
        } 
        else { 
            // explain, grade
            const subjectView = document.getElementById('subject-selection-view'); 
            if (subjectView) subjectView.classList.remove('hidden'); 
            window.updateNellMessage("どの教科にするのかにゃ？", "normal", false); 
            if (m === 'explain' || m === 'grade') {
                document.getElementById('embedded-chat-section').classList.remove('hidden');
            }
        }
    } catch (e) {
        console.error("[UI] selectMode Error:", e);
        alert("エラーが発生したにゃ。再読み込みしてにゃ。");
    }
};

// ==========================================
// 2. お宝図鑑専用 (HTTPベース)
// ==========================================

async function startPreviewCamera() {
    const video = document.getElementById('live-chat-video');
    const container = document.getElementById('live-chat-video-container');
    if (!video || !container) return;

    try {
        if (previewStream) {
            previewStream.getTracks().forEach(t => t.stop());
        }
        
        try {
            previewStream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: "environment" },
                audio: false 
            });
        } catch(e) {
            previewStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
        
        video.srcObject = previewStream;
        await video.play();
        container.style.display = 'block';

    } catch (e) {
        console.warn("[Preview] Camera init failed:", e);
        alert("カメラが使えないにゃ…。");
    }
}

function stopPreviewCamera() {
    if (previewStream) {
        previewStream.getTracks().forEach(t => t.stop());
        previewStream = null;
    }
    const video = document.getElementById('live-chat-video');
    if (video) video.srcObject = null;
    const container = document.getElementById('live-chat-video-container');
    if (container) container.style.display = 'none';
}

function createTreasureImage(sourceCanvas) {
    const size = Math.min(sourceCanvas.width, sourceCanvas.height);
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 320;
    const ctx = canvas.getContext('2d');
    
    const sx = (sourceCanvas.width - size) / 2;
    const sy = (sourceCanvas.height - size) / 2;
    
    ctx.fillStyle = "#ffffff";
    ctx.save();
    ctx.beginPath();
    ctx.arc(160, 160, 160, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    
    ctx.drawImage(sourceCanvas, sx, sy, size, size, 0, 0, 320, 320);
    ctx.restore();
    
    ctx.save();
    ctx.beginPath();
    ctx.arc(160, 160, 155, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffd700'; 
    ctx.lineWidth = 10;
    ctx.stroke();
    ctx.restore();
    
    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.beginPath();
    ctx.arc(64, 64, 16, 0, Math.PI*2);
    ctx.fill();
    
    return canvas.toDataURL('image/jpeg', 0.8);
}

window.captureAndIdentifyItem = async function() {
    if (window.isLiveImageSending) return;
    
    if (isAlwaysListening && continuousRecognition) {
        try { continuousRecognition.stop(); } catch(e){}
    }

    const video = document.getElementById('live-chat-video');
    if (!video || !video.srcObject || !video.srcObject.active) {
        return alert("カメラが動いてないにゃ...。");
    }

    window.isLiveImageSending = true;
    const btn = document.getElementById('live-camera-btn');
    const originalBtnText = btn ? btn.innerHTML : "";
    if (btn) {
        btn.innerHTML = "<span>📡</span> 解析中にゃ...";
        btn.style.backgroundColor = "#ccc";
        btn.disabled = true;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const base64Data = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
    const treasureDataUrl = createTreasureImage(canvas);

    const flash = document.createElement('div');
    flash.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:white; opacity:0.8; z-index:9999; pointer-events:none; transition:opacity 0.3s;";
    document.body.appendChild(flash);
    setTimeout(() => { flash.style.opacity = 0; setTimeout(() => flash.remove(), 300); }, 50);

    try {
        window.updateNellMessage("ん？どれどれ…", "thinking", false, true);

        const res = await fetch('/identify-item', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                image: base64Data,
                name: currentUser ? currentUser.name : "生徒"
            })
        });

        if (!res.ok) throw new Error("Server response not ok");

        const data = await res.json();
        
        if (data.speechText) {
            await window.updateNellMessage(data.speechText, "happy", true, true);
        } else if (data.text) {
            await window.updateNellMessage(data.text, "happy", true, true); 
        }

        if (data.itemName && window.NellMemory) {
            console.log(`[Collection] Registering: ${data.itemName}`);
            const description = data.description || "（解説はないにゃ）";
            await window.NellMemory.addToCollection(currentUser.id, data.itemName, treasureDataUrl, description);
            
            const notif = document.createElement('div');
            notif.innerText = `📖 図鑑に「${data.itemName}」を登録したにゃ！`;
            notif.style.cssText = "position:fixed; top:20%; left:50%; transform:translateX(-50%); background:rgba(255,255,255,0.95); border:4px solid #00bcd4; color:#006064; padding:15px 25px; border-radius:30px; font-weight:900; z-index:10000; animation: popIn 0.5s ease; box-shadow:0 10px 25px rgba(0,0,0,0.3);";
            document.body.appendChild(notif);
            setTimeout(() => notif.remove(), 4000);
            try { sfxHirameku.currentTime=0; sfxHirameku.play(); } catch(e){}
        }

    } catch (e) {
        console.error("Identify Error:", e);
        window.updateNellMessage("よく見えなかったにゃ…もう一回お願いにゃ！", "thinking", false, true);
    } finally {
        window.isLiveImageSending = false;
        if (btn) {
            btn.innerHTML = originalBtnText;
            btn.style.backgroundColor = "#ff85a1"; 
            btn.disabled = false;
        }
        if (isAlwaysListening && currentMode === 'chat') {
            try { continuousRecognition.start(); } catch(e){}
        }
    }
};

// ==========================================
// 3. 常時聞き取り機能 (HTTPチャット用)
// ==========================================

function startAlwaysOnListening() {
    if (!('webkitSpeechRecognition' in window)) {
        console.warn("Speech Recognition not supported.");
        return;
    }

    if (continuousRecognition) {
        try { continuousRecognition.stop(); } catch(e){}
    }

    isAlwaysListening = true;
    continuousRecognition = new webkitSpeechRecognition();
    continuousRecognition.lang = 'ja-JP';
    continuousRecognition.interimResults = false;
    continuousRecognition.maxAlternatives = 1;

    continuousRecognition.onresult = async (event) => {
        if (window.isNellSpeaking) {
            console.log("Ignored user input while Nell is speaking.");
            return;
        }

        const text = event.results[0][0].transcript;
        if (!text || text.trim() === "") return;
        
        console.log(`[User Said] ${text}`);
        continuousRecognition.stop();

        try {
            const res = await fetch('/chat-dialogue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text, name: currentUser ? currentUser.name : "生徒" })
            });
            
            if(res.ok) {
                const data = await res.json();
                await window.updateNellMessage(data.reply, "normal", true, true);
            }
        } catch(e) {
            console.error("Chat Error:", e);
        } finally {
            if (isAlwaysListening && currentMode === 'chat') {
                try { continuousRecognition.start(); } catch(e){}
            }
        }
    };

    continuousRecognition.onend = () => {
        if (isAlwaysListening && currentMode === 'chat' && !window.isNellSpeaking) {
            try { continuousRecognition.start(); } catch(e){}
        }
    };

    continuousRecognition.onerror = (e) => {
        console.error("Rec Error:", e);
        if (isAlwaysListening && currentMode === 'chat') {
            setTimeout(() => {
                try { continuousRecognition.start(); } catch(e){}
            }, 1000);
        }
    };

    try { continuousRecognition.start(); } catch(e) { console.log("Rec start failed", e); }
}

function stopAlwaysOnListening() {
    isAlwaysListening = false;
    if (continuousRecognition) {
        try { continuousRecognition.stop(); } catch(e){}
        continuousRecognition = null;
    }
}

// updateNellMessage
window.updateNellMessage = async function(t, mood = "normal", saveToMemory = false, speak = true) {
    if (liveSocket && liveSocket.readyState === WebSocket.OPEN && currentMode !== 'chat') {
        speak = false;
    }

    const gameScreen = document.getElementById('screen-game');
    const isGameHidden = gameScreen ? gameScreen.classList.contains('hidden') : true;
    const targetId = isGameHidden ? 'nell-text' : 'nell-text-game';
    const el = document.getElementById(targetId);
    
    let displayText = t.replace(/(?:\[|\【)?DISPLAY[:：]\s*(.+?)(?:\]|\】)?/gi, "");
    
    if (el) el.innerText = displayText;
    
    if (t && t.includes("もぐもぐ")) { try { sfxBori.currentTime = 0; sfxBori.play(); } catch(e){} }
    
    if (saveToMemory) { saveToNellMemory('nell', t); }
    
    if (speak && typeof speakNell === 'function') {
        let textForSpeech = displayText.replace(/【.*?】/g, "").trim();
        textForSpeech = textForSpeech.replace(/🐾/g, "");
        if (textForSpeech.length > 0) {
            await speakNell(textForSpeech, mood);
        }
    }
};

// ==========================================
// 4. その他共通機能
// ==========================================

const sfxBori = new Audio('boribori.mp3');
const sfxHit = new Audio('cat1c.mp3');
const sfxPaddle = new Audio('poka02.mp3'); 
const sfxOver = new Audio('gameover.mp3');
const sfxBunseki = new Audio('bunseki.mp3'); 
sfxBunseki.volume = 0.05; 
const sfxHirameku = new Audio('hirameku.mp3'); 
const sfxMaru = new Audio('maru.mp3');
const sfxBatu = new Audio('batu.mp3');
const gameHitComments = ["うまいにゃ！", "すごいにゃ！", "さすがにゃ！", "がんばれにゃ！"];

const subjectImages = {
    'こくご': { base: 'nell-kokugo.png', talk: 'nell-kokugo-talk.png' },
    'さんすう': { base: 'nell-sansu.png', talk: 'nell-sansu-talk.png' },
    'りか': { base: 'nell-rika.png', talk: 'nell-rika-talk.png' },
    'しゃかい': { base: 'nell-shakai.png', talk: 'nell-shakai-talk.png' },
    'おはなし': { base: 'nell-normal.png', talk: 'nell-talk.png' }
};
const defaultIcon = 'nell-normal.png'; 
const talkIcon = 'nell-talk.png';

function startMouthAnimation() {
    let toggle = false;
    setInterval(() => {
        const img = document.getElementById('nell-face') || document.querySelector('.nell-avatar-wrap img');
        if (!img) return;
        let baseImg = defaultIcon;
        let talkImg = talkIcon;
        if (currentSubject && subjectImages[currentSubject] && 
           (currentMode === 'explain' || currentMode === 'grade' || currentMode === 'review')) {
            baseImg = subjectImages[currentSubject].base;
            talkImg = subjectImages[currentSubject].talk;
        }
        if (window.isNellSpeaking) img.src = toggle ? talkImg : baseImg;
        else img.src = baseImg;
        toggle = !toggle;
    }, 150);
}
startMouthAnimation();

window.addEventListener('DOMContentLoaded', () => {
    const camIn = document.getElementById('hw-input-camera'); 
    const albIn = document.getElementById('hw-input-album'); 
    if(camIn) camIn.addEventListener('change', (e) => { handleFileUpload(e.target.files[0]); e.target.value=''; });
    if(albIn) albIn.addEventListener('change', (e) => { handleFileUpload(e.target.files[0]); e.target.value=''; });
    const startCamBtn = document.getElementById('start-webcam-btn');
    if (startCamBtn) startCamBtn.onclick = startHomeworkWebcam;
});

// 宿題用カメラ機能
async function startHomeworkWebcam() {
    const modal = document.getElementById('camera-modal');
    const video = document.getElementById('camera-video');
    const shutter = document.getElementById('camera-shutter-btn');
    const cancel = document.getElementById('camera-cancel-btn');
    if (!modal || !video) return;
    try {
        let constraints = { video: { facingMode: "environment" } };
        try { homeworkStream = await navigator.mediaDevices.getUserMedia(constraints); } 
        catch (e) { homeworkStream = await navigator.mediaDevices.getUserMedia({ video: true }); }
        video.srcObject = homeworkStream;
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
                    closeHomeworkCamera();
                    handleFileUpload(file);
                }
            }, 'image/jpeg', 0.9);
        };
        cancel.onclick = closeHomeworkCamera;
    } catch (err) { alert("カメラエラー: " + err.message); closeHomeworkCamera(); }
}
function closeHomeworkCamera() {
    const modal = document.getElementById('camera-modal');
    const video = document.getElementById('camera-video');
    if (homeworkStream) { homeworkStream.getTracks().forEach(t => t.stop()); homeworkStream = null; }
    if (video) video.srcObject = null;
    if (modal) modal.classList.add('hidden');
}

// 記憶・メッセージ管理
async function saveToNellMemory(role, text) {
    if (!currentUser || !currentUser.id) return;
    const trimmed = text.trim();
    if (trimmed.length <= 1) return;
    
    chatTranscript += `${role === 'user' ? '生徒' : 'ネル'}: ${trimmed}\n`;
    const newItem = { role: role, text: trimmed, time: new Date().toISOString() };
    try {
        const memoryKey = `nell_raw_chat_log_${currentUser.id}`;
        let history = JSON.parse(localStorage.getItem(memoryKey) || '[]');
        if (history.length > 0 && history[history.length - 1].text === trimmed) return;
        history.push(newItem);
        if (history.length > 50) history.shift(); 
        localStorage.setItem(memoryKey, JSON.stringify(history));
    } catch(e) {}
}

window.setSubject = function(s) { 
    currentSubject = s; 
    const icon = document.querySelector('.nell-avatar-wrap img'); if(icon&&subjectImages[s]){icon.src=subjectImages[s].base; icon.onerror=()=>{icon.src=defaultIcon;};} 
    document.getElementById('subject-selection-view').classList.add('hidden'); 
    document.getElementById('upload-controls').classList.remove('hidden'); 
    updateNellMessage(`${currentSubject}の問題をみせてにゃ！`, "happy", false); 
    const btnFast = document.getElementById('mode-btn-fast');
    const btnPrec = document.getElementById('mode-btn-precision');
    if (btnFast) { btnFast.innerText = "📷 ネル先生に宿題を見せる"; btnFast.className = "main-btn"; btnFast.style.background = "#ff85a1"; btnFast.style.width = "100%"; btnFast.onclick = null; }
    if (btnPrec) btnPrec.style.display = "none";
};

window.setAnalyzeMode = function(type) { analysisType = 'precision'; };

// ==========================================
// ★ タイマー関連
// ==========================================

window.openTimerModal = function() {
    document.getElementById('timer-modal').classList.remove('hidden');
    updateTimerDisplay(); 
};
window.closeTimerModal = function() {
    document.getElementById('timer-modal').classList.add('hidden');
};
window.setTimer = function(minutes) {
    if (studyTimerRunning) return;
    studyTimerValue += minutes * 60;
    updateTimerDisplay();
};
window.resetTimer = function() {
    if (studyTimerRunning) {
        clearInterval(studyTimerInterval);
        studyTimerRunning = false;
        document.getElementById('timer-toggle-btn').innerText = "スタート！";
        document.getElementById('timer-toggle-btn').className = "main-btn pink-btn";
    }
    studyTimerValue = 0;
    studyTimerCheck = 0;
    updateTimerDisplay();
    document.getElementById('mini-timer-display').classList.add('hidden');
};
window.toggleTimer = function() {
    if (studyTimerRunning) {
        clearInterval(studyTimerInterval);
        studyTimerRunning = false;
        document.getElementById('timer-toggle-btn').innerText = "再開する";
        document.getElementById('timer-toggle-btn').className = "main-btn blue-btn";
    } else {
        if (studyTimerValue <= 0) return alert("時間をセットしてにゃ！");
        studyTimerRunning = true;
        studyTimerCheck = 0;
        document.getElementById('timer-toggle-btn').innerText = "一時停止";
        document.getElementById('timer-toggle-btn').className = "main-btn gray-btn";
        document.getElementById('mini-timer-display').classList.remove('hidden');
        closeTimerModal();
        studyTimerInterval = setInterval(() => {
            if (studyTimerValue > 0) {
                studyTimerValue--;
                studyTimerCheck++;
                updateTimerDisplay();
                if (studyTimerValue === 600) window.updateNellMessage("10分前だにゃ〜。お茶でも飲んで落ち着くにゃ。", "gentle", false, true);
                else if (studyTimerValue === 300) window.updateNellMessage("あと5分。一歩ずつ、一歩ずつだにゃ〜。", "normal", false, true);
                else if (studyTimerValue === 180) window.updateNellMessage("3分前。深呼吸して、もうひと踏ん張りだにゃ。", "excited", false, true);
                else if (studyTimerValue === 60) window.updateNellMessage("あと1分だにゃ。最後までボクが見守ってるにゃ。", "excited", false, true);
            } else {
                clearInterval(studyTimerInterval);
                studyTimerRunning = false;
                document.getElementById('timer-toggle-btn').innerText = "スタート！";
                document.getElementById('timer-toggle-btn').className = "main-btn pink-btn";
                try { sfxChime.play(); } catch(e){}
                window.updateNellMessage("時間だにゃ！お疲れ様だにゃ〜。さ、ゆっくり休むにゃ。", "happy", false, true);
                document.getElementById('mini-timer-display').classList.add('hidden');
                openTimerModal();
            }
        }, 1000);
    }
};
function updateTimerDisplay() {
    const m = Math.floor(studyTimerValue / 60).toString().padStart(2, '0');
    const s = (studyTimerValue % 60).toString().padStart(2, '0');
    const timeStr = `${m}:${s}`;
    const modalDisplay = document.getElementById('modal-timer-display');
    if(modalDisplay) modalDisplay.innerText = timeStr;
    const miniDisplay = document.getElementById('mini-timer-text');
    if(miniDisplay) miniDisplay.innerText = timeStr;
}
function sendSilentPrompt(text) {
    if (!liveSocket) return;
    liveSocket.send(JSON.stringify({ 
        clientContent: { turns: [{ role: "user", parts: [{ text: `（システム指示: ${text}）` }] }], turnComplete: true } 
    }));
}

// ==========================================
// ★ WebSocket (simple-chat/embedded用)
// ==========================================

function stopAudioPlayback() {
    liveAudioSources.forEach(source => { try { source.stop(); } catch(e){} });
    liveAudioSources = [];
    if (audioContext && audioContext.state === 'running') nextStartTime = audioContext.currentTime + 0.05;
    window.isNellSpeaking = false;
    if(stopSpeakingTimer) clearTimeout(stopSpeakingTimer);
    if(speakingStartTimer) clearTimeout(speakingStartTimer);
    if (window.cancelNellSpeech) window.cancelNellSpeech();
}

window.captureAndSendLiveImage = function(context = 'main') {
    if (context === 'main') {
        if (currentMode === 'simple-chat') context = 'simple';
        else if (activeChatContext === 'embedded') context = 'embedded';
    }
    if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) {
        return alert("まずは「おはなしする」でネル先生とつながってにゃ！");
    }
    if (window.isLiveImageSending) return; 
    let videoId = 'live-chat-video-simple';
    if (context === 'embedded') videoId = 'live-chat-video-embedded';
    const video = document.getElementById(videoId);
    if (!video || !video.srcObject || !video.srcObject.active) return alert("カメラが動いてないにゃ...");

    stopAudioPlayback();
    ignoreIncomingAudio = true; 
    window.isLiveImageSending = true;
    
    let btnId = 'live-camera-btn-simple';
    if (context === 'embedded') btnId = 'live-camera-btn-embedded';
    const btn = document.getElementById(btnId);
    if (btn) {
        btn.innerHTML = "<span>📡</span> 送信中にゃ...";
        btn.style.backgroundColor = "#ccc";
    }
    window.isMicMuted = true;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const notif = document.createElement('div');
    notif.innerText = `📝 問題を送ったにゃ！`;
    notif.style.cssText = "position:fixed; top:20%; left:50%; transform:translateX(-50%); background:rgba(255,255,255,0.95); border:4px solid #8bc34a; color:#558b2f; padding:10px 20px; border-radius:30px; font-weight:bold; z-index:10000; animation: popIn 0.5s ease; box-shadow:0 4px 10px rgba(0,0,0,0.2);";
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 2000);
    const base64Data = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
    
    const flash = document.createElement('div');
    flash.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:white; opacity:0.8; z-index:9999; pointer-events:none; transition:opacity 0.3s;";
    document.body.appendChild(flash);
    setTimeout(() => { flash.style.opacity = 0; setTimeout(() => flash.remove(), 300); }, 50);

    let containerId = 'live-chat-video-container-simple';
    if (context === 'embedded') containerId = 'live-chat-video-container-embedded';
    const videoContainer = document.getElementById(containerId);
    if (videoContainer) {
        const oldPreview = document.getElementById('snapshot-preview-overlay');
        if(oldPreview) oldPreview.remove();
        const previewImg = document.createElement('img');
        previewImg.id = 'snapshot-preview-overlay';
        previewImg.src = canvas.toDataURL('image/jpeg', 0.8);
        previewImg.style.cssText = "position:absolute; top:0; left:0; width:100%; height:100%; object-fit:cover; z-index:10; border:4px solid #ffeb3b; box-sizing:border-box; animation: fadeIn 0.2s;";
        videoContainer.style.position = "relative"; 
        videoContainer.appendChild(previewImg);
        setTimeout(() => { if(previewImg && previewImg.parentNode) previewImg.remove(); }, 3000);
    }

    updateNellMessage("ん？どれどれ…", "thinking", false, false);
    if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
        let promptText = "（ユーザーが勉強の問題や画像を見せました）この画像の内容を詳しく、子供にもわかるように丁寧に教えてください。図鑑登録は不要です。";
        liveSocket.send(JSON.stringify({ 
            clientContent: { 
                turns: [{ role: "user", parts: [ { text: promptText }, { inlineData: { mime_type: "image/jpeg", data: base64Data } } ] }],
                turnComplete: true 
            } 
        }));
    }

    setTimeout(() => {
        window.isLiveImageSending = false;
        window.isMicMuted = false;
        if (btn) {
             btn.innerHTML = "<span>📝</span> 問題をみせて教えてもらう";
             if(context==='embedded') btn.innerHTML = "<span>📝</span> 画面を見せて質問";
             btn.style.backgroundColor = (context === 'simple') ? "#8bc34a" : "#66bb6a";
        }
    }, 3000);
    setTimeout(() => { ignoreIncomingAudio = false; }, 300);
};

window.stopLiveChat = function() {
    if (window.NellMemory && chatTranscript && chatTranscript.length > 10) {
        window.NellMemory.updateProfileFromChat(currentUser.id, chatTranscript);
    }
    isRecognitionActive = false; 
    if (connectionTimeout) clearTimeout(connectionTimeout); 
    if (recognition) try{recognition.stop()}catch(e){} 
    if (mediaStream) mediaStream.getTracks().forEach(t=>t.stop()); 
    if (workletNode) { workletNode.port.postMessage('stop'); workletNode.disconnect(); } 
    if (liveSocket) liveSocket.close(); 
    if (audioContext && audioContext.state !== 'closed') audioContext.close(); 
    window.isNellSpeaking = false; 
    if(stopSpeakingTimer) clearTimeout(stopSpeakingTimer); 
    if(speakingStartTimer) clearTimeout(speakingStartTimer); 
    
    ['mic-btn-simple', 'mic-btn-embedded'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) { 
            btn.innerText = (id === 'mic-btn-embedded') ? "🎤 質問する" : "🎤 おはなしする"; 
            btn.style.background = (id === 'mic-btn-embedded') ? "#8bc34a" : "#66bb6a"; 
            btn.disabled = false; 
            if (id === 'mic-btn-simple') btn.onclick = () => startLiveChat('simple');
            else if (id === 'mic-btn-embedded') btn.onclick = () => startLiveChat('embedded');
        } 
    });

    liveSocket = null; 
    activeChatContext = null;
    streamTextBuffer = "";
    ttsTextBuffer = "";
    
    // カメラボタンリセット
    const camBtnSimple = document.getElementById('live-camera-btn-simple');
    if (camBtnSimple) { camBtnSimple.innerHTML = "<span>📝</span> 問題をみせて教えてもらう"; camBtnSimple.style.backgroundColor = "#8bc34a"; }
    const camBtnEmbedded = document.getElementById('live-camera-btn-embedded');
    if (camBtnEmbedded) { camBtnEmbedded.innerHTML = "<span>📝</span> 画面を見せて質問"; camBtnEmbedded.style.backgroundColor = "#66bb6a"; }

    window.isLiveImageSending = false;
    window.isMicMuted = false; 

    const videoSimple = document.getElementById('live-chat-video-simple');
    if(videoSimple) videoSimple.srcObject = null;
    document.getElementById('live-chat-video-container-simple').style.display = 'none';

    const videoEmbedded = document.getElementById('live-chat-video-embedded');
    if(videoEmbedded) videoEmbedded.srcObject = null;
    document.getElementById('live-chat-video-container-embedded').style.display = 'none';
};

async function startLiveChat(context = 'main') { 
    if (context === 'main') {
        if (currentMode === 'simple-chat') context = 'simple';
        else if (!document.getElementById('embedded-chat-section').classList.contains('hidden')) context = 'embedded';
    }
    activeChatContext = context;

    let btnId = 'mic-btn-simple';
    if (context === 'embedded') btnId = 'mic-btn-embedded';

    const btn = document.getElementById(btnId);
    if (liveSocket) { window.stopLiveChat(); return; } 
    
    try { 
        updateNellMessage("ネル先生を呼んでるにゃ…", "thinking", false); 
        if(btn) btn.disabled = true; 
        
        let memoryContext = "";
        if (window.NellMemory) {
            memoryContext = await window.NellMemory.generateContextString(currentUser.id);
        }
        
        chatTranscript = ""; 
        streamTextBuffer = "";
        ttsTextBuffer = "";
        
        if (window.initAudioContext) await window.initAudioContext(); 
        audioContext = new (window.AudioContext || window.webkitAudioContext)(); 
        await audioContext.resume(); 
        nextStartTime = audioContext.currentTime; 
        
        const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:'; 
        let statusSummary = `${currentUser.name}さんは今、お話しにきたにゃ。カリカリは${currentUser.karikari}個持ってるにゃ。`; 
        let modeParam = 'simple-chat';

        const url = `${wsProto}//${location.host}?grade=${currentUser.grade}&name=${encodeURIComponent(currentUser.name)}&mode=${modeParam}`; 
        
        liveSocket = new WebSocket(url); 
        liveSocket.binaryType = "blob"; 
        connectionTimeout = setTimeout(() => { if (liveSocket && liveSocket.readyState !== WebSocket.OPEN) { updateNellMessage("なかなかつながらないにゃ…", "thinking", false); window.stopLiveChat(); } }, 10000); 
        
        window.lastSentCollectionImage = null;
        window.isLiveImageSending = false;

        liveSocket.onopen = () => { 
            liveSocket.send(JSON.stringify({
                type: "init",
                name: currentUser.name,
                grade: currentUser.grade,
                context: statusSummary + "\n" + memoryContext,
                mode: modeParam 
            }));
        }; 
        
        liveSocket.onmessage = async (event) => { 
            try { 
                let rawData = event.data;
                if (rawData instanceof Blob) rawData = await rawData.text();
                const data = JSON.parse(rawData);

                if (data.type === "server_ready") {
                    clearTimeout(connectionTimeout); 
                    if(btn) { btn.innerText = "📞 つながった！(終了)"; btn.style.background = "#ff5252"; btn.disabled = false; } 
                    updateNellMessage("お待たせ！なんでも話してにゃ！", "happy", false, false); 
                    isRecognitionActive = true; 
                    startMicrophone(); 
                    return;
                }
                
                if (data.serverContent?.modelTurn?.parts) { 
                    data.serverContent.modelTurn.parts.forEach(p => { 
                        if (p.text) { 
                            streamTextBuffer += p.text;
                            let txtId = 'user-speech-text-simple';
                            if (activeChatContext === 'embedded') txtId = 'user-speech-text-embedded';
                            // Nellの発言は吹き出しへ
                            updateNellMessage(streamTextBuffer, "normal", false, false); 
                        } 
                        if (p.inlineData) playLivePcmAudio(p.inlineData.data); 
                    }); 
                }

                if (data.serverContent && data.serverContent.turnComplete) {
                    saveToNellMemory('nell', streamTextBuffer);
                    streamTextBuffer = "";
                }
            } catch (e) {} 
        }; 
        liveSocket.onclose = () => window.stopLiveChat(); 
        liveSocket.onerror = () => window.stopLiveChat(); 
    } catch (e) { window.stopLiveChat(); } 
}

async function startMicrophone() { 
    try { 
        if ('webkitSpeechRecognition' in window) { 
            recognition = new webkitSpeechRecognition(); 
            recognition.continuous = true; 
            recognition.interimResults = true; 
            recognition.lang = 'ja-JP'; 
            
            recognition.onresult = (event) => { 
                let currentText = "";
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    currentText += event.results[i][0].transcript;
                }
                const cleanText = currentText.trim();
                const stopKeywords = ["違う", "ちがう", "待って", "まって", "ストップ", "やめて", "うるさい", "静か", "しずか"];
                if (window.isNellSpeaking && cleanText.length > 0) {
                    const isLongEnough = cleanText.length >= 10;
                    const isStopCommand = stopKeywords.some(w => cleanText.includes(w));
                    if (isLongEnough || isStopCommand) stopAudioPlayback();
                }
                for (let i = event.resultIndex; i < event.results.length; ++i) { 
                    if (event.results[i].isFinal) { 
                        const userText = event.results[i][0].transcript;
                        saveToNellMemory('user', userText); 
                        streamTextBuffer = ""; 
                        let txtId = 'user-speech-text-simple';
                        if (activeChatContext === 'embedded') txtId = 'user-speech-text-embedded';
                        const el = document.getElementById(txtId); 
                        if(el) el.innerText = userText; 
                    }
                } 
            }; 
            recognition.onend = () => { if (isRecognitionActive && liveSocket && liveSocket.readyState === WebSocket.OPEN) try{recognition.start()}catch(e){} }; 
            recognition.start(); 
        } 
        
        const useVideo = true;
        mediaStream = await navigator.mediaDevices.getUserMedia({ 
            audio: { sampleRate: 16000, channelCount: 1 }, 
            video: useVideo ? { facingMode: "environment" } : false 
        }); 
        
        if (useVideo) {
            let videoId = 'live-chat-video-simple';
            let containerId = 'live-chat-video-container-simple';
            if (activeChatContext === 'embedded') {
                videoId = 'live-chat-video-embedded';
                containerId = 'live-chat-video-container-embedded';
            }
            const video = document.getElementById(videoId);
            if (video) {
                video.srcObject = mediaStream;
                video.play();
                document.getElementById(containerId).style.display = 'block';
            }
        }

        const processorCode = `class PcmProcessor extends AudioWorkletProcessor { constructor() { super(); this.bufferSize = 2048; this.buffer = new Float32Array(this.bufferSize); this.index = 0; } process(inputs, outputs, parameters) { const input = inputs[0]; if (input.length > 0) { const channel = input[0]; for (let i = 0; i < channel.length; i++) { this.buffer[this.index++] = channel[i]; if (this.index >= this.bufferSize) { this.port.postMessage(this.buffer); this.index = 0; } } } return true; } } registerProcessor('pcm-processor', PcmProcessor);`; 
        const blob = new Blob([processorCode], { type: 'application/javascript' }); 
        await audioContext.audioWorklet.addModule(URL.createObjectURL(blob)); 
        const source = audioContext.createMediaStreamSource(mediaStream); 
        workletNode = new AudioWorkletNode(audioContext, 'pcm-processor'); 
        source.connect(workletNode); 
        workletNode.port.onmessage = (event) => { 
            if (window.isMicMuted) return;
            if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) return; 
            const downsampled = downsampleBuffer(event.data, audioContext.sampleRate, 16000); 
            liveSocket.send(JSON.stringify({ base64Audio: arrayBufferToBase64(floatTo16BitPCM(downsampled)) })); 
        }; 
    } catch(e) {
        console.warn("Audio/Camera Error:", e);
    } 
}

function playLivePcmAudio(base64) { 
    if (!audioContext || ignoreIncomingAudio) return; 
    const binary = window.atob(base64); 
    const bytes = new Uint8Array(binary.length); 
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); 
    const float32 = new Float32Array(bytes.length / 2); 
    const view = new DataView(bytes.buffer); 
    for (let i = 0; i < float32.length; i++) float32[i] = view.getInt16(i * 2, true) / 32768.0; 
    const buffer = audioContext.createBuffer(1, float32.length, 24000); 
    buffer.copyToChannel(float32, 0); 
    const source = audioContext.createBufferSource(); 
    source.buffer = buffer; 
    source.connect(audioContext.destination); 
    liveAudioSources.push(source);
    source.onended = () => { liveAudioSources = liveAudioSources.filter(s => s !== source); };
    const now = audioContext.currentTime; 
    if (nextStartTime < now) nextStartTime = now; 
    source.start(nextStartTime); 
    const startDelay = (nextStartTime - now) * 1000; 
    const duration = buffer.duration * 1000; 
    if(stopSpeakingTimer) clearTimeout(stopSpeakingTimer); 
    speakingStartTimer = setTimeout(() => { window.isNellSpeaking = true; }, startDelay); 
    stopSpeakingTimer = setTimeout(() => { window.isNellSpeaking = false; }, startDelay + duration + 100); 
    nextStartTime += buffer.duration; 
}
function floatTo16BitPCM(float32Array) { const buffer = new ArrayBuffer(float32Array.length * 2); const view = new DataView(buffer); let offset = 0; for (let i = 0; i < float32Array.length; i++, offset += 2) { let s = Math.max(-1, Math.min(1, float32Array[i])); view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true); } return buffer; }
function downsampleBuffer(buffer, sampleRate, outSampleRate) { if (outSampleRate >= sampleRate) return buffer; const ratio = sampleRate / outSampleRate; const newLength = Math.round(buffer.length / ratio); const result = new Float32Array(newLength); let offsetResult = 0, offsetBuffer = 0; while (offsetResult < result.length) { const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio); let accum = 0, count = 0; for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) { accum += buffer[i]; count++; } result[offsetResult] = accum / count; offsetResult++; offsetBuffer = nextOffsetBuffer; } return result; }
function arrayBufferToBase64(buffer) { let binary = ''; const bytes = new Uint8Array(buffer); for (let i = 0; i < bytes.byteLength; i++) { binary += String.fromCharCode(bytes[i]); } return window.btoa(binary); }
function updateMiniKarikari() { if(currentUser) { const el = document.getElementById('mini-karikari-count'); if(el) el.innerText = currentUser.karikari; const el2 = document.getElementById('karikari-count'); if(el2) el2.innerText = currentUser.karikari; } }
function showKarikariEffect(amount) { const container = document.querySelector('.nell-avatar-wrap'); if(container) { const floatText = document.createElement('div'); floatText.className = 'floating-text'; floatText.innerText = amount > 0 ? `+${amount}` : `${amount}`; floatText.style.color = amount > 0 ? '#ff9100' : '#ff5252'; floatText.style.right = '0px'; floatText.style.top = '0px'; container.appendChild(floatText); setTimeout(() => floatText.remove(), 1500); } }

// ==========================================
// 7. 宿題・ゲーム・Cropper関連
// ==========================================
// 宿題分析
window.startAnalysis = async function(b64) {
    if (isAnalyzing) return;
    isAnalyzing = true; 
    document.getElementById('cropper-modal').classList.add('hidden'); 
    document.getElementById('thinking-view').classList.remove('hidden'); 
    document.getElementById('upload-controls').classList.add('hidden'); 
    const backBtn = document.getElementById('main-back-btn'); if(backBtn) backBtn.classList.add('hidden');
    
    try { 
        sfxHirameku.volume = 0; sfxHirameku.play().then(() => { sfxHirameku.pause(); sfxHirameku.currentTime = 0; sfxHirameku.volume = 1; }).catch(e => {});
        sfxBunseki.currentTime = 0; sfxBunseki.play(); sfxBunseki.loop = true; 
    } catch(e){}
    
    let p = 0; 
    const timer = setInterval(() => { if (!isAnalyzing) { clearInterval(timer); return; } if (p < 30) p += 1; else if (p < 80) p += 0.4; else if (p < 95) p += 0.1; updateProgress(p); }, 300);
    
    // --- 解析中のセリフ ---
    const performAnalysisNarration = async () => {
        const msgs = [
            { text: "じーっと見て、問題を書き写してるにゃ…", mood: "thinking" },
            { text: "肉球がちょっとじゃまだにゃ…", mood: "thinking" },
            { text: "ふむふむ…この問題、なかなか手強いにゃ…", mood: "thinking" },
            { text: "今、ネル先生の天才的な頭脳で解いてるからにゃね…", mood: "thinking" },
            { text: "この問題、どこかで見たことあるにゃ…えーっと…", mood: "thinking" },
            { text: "しっぽの先まで集中して考え中だにゃ…", mood: "thinking" },
            { text: "ネル先生のピピピッ！と光るヒゲが、正解をバッチリ受信してるにゃ！", mood: "thinking" },
            { text: "にゃるほど…だいたい分かってきたにゃ…", mood: "thinking" },
            { text: "あとちょっとで、ネル先生の脳みそが『ピコーン！』って鳴るにゃ！", mood: "thinking" }
        ];
        for (const item of msgs) { 
            if (!isAnalyzing) return; 
            await updateNellMessage(item.text, item.mood, false); 
            if (!isAnalyzing) return; 
            await new Promise(r => setTimeout(r, 1500)); 
        }
    };
    performAnalysisNarration();

    try {
        const res = await fetch('/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: b64, mode: currentMode, grade: currentUser.grade, subject: currentSubject, name: currentUser.name }) });
        if (!res.ok) throw new Error("Server Error"); 
        
        const data = await res.json();
        
        if (!data || !Array.isArray(data) || data.length === 0) {
            throw new Error("データが空か、正しい形式ではありませんでした。");
        }
        
        transcribedProblems = data.map((prob, index) => {
            let studentArr = Array.isArray(prob.student_answer) ? prob.student_answer : (prob.student_answer ? [prob.student_answer] : []);
            let correctArr = Array.isArray(prob.correct_answer) ? prob.correct_answer : (prob.correct_answer ? [prob.correct_answer] : []);
            
            return { 
                ...prob, 
                id: index + 1, 
                student_answer: studentArr, 
                correct_answer: correctArr, 
                status: (studentArr.length > 0 && studentArr[0] !== "") ? "answered" : "unanswered", 
                currentHintLevel: 1, 
                maxUnlockedHintLevel: 0 
            };
        });

        isAnalyzing = false; clearInterval(timer); updateProgress(100); cleanupAnalysis();
        try { sfxHirameku.currentTime = 0; sfxHirameku.play().catch(e=>{}); } catch(e){}
        setTimeout(() => { document.getElementById('thinking-view').classList.add('hidden'); const doneMsg = "読めたにゃ！"; if (currentMode === 'grade') { showGradingView(true); updateNellMessage(doneMsg, "happy", false).then(() => setTimeout(updateGradingMessage, 1500)); } else { renderProblemSelection(); updateNellMessage(doneMsg, "happy", false); } }, 1500); 
    } catch (err) { 
        console.error("Analysis Error:", err);
        isAnalyzing = false; cleanupAnalysis(); clearInterval(timer); 
        document.getElementById('thinking-view').classList.add('hidden'); 
        document.getElementById('upload-controls').classList.remove('hidden'); 
        if(backBtn) backBtn.classList.remove('hidden'); 
        updateNellMessage("うまく読めなかったにゃ…もう一度お願いにゃ！", "thinking", false); 
    }
};

function cleanupAnalysis() { isAnalyzing = false; sfxBunseki.pause(); if(typeof analysisTimers !== 'undefined' && analysisTimers) { analysisTimers.forEach(t => clearTimeout(t)); analysisTimers = []; } }

// ヒント・採点UI
window.startHint = function(id) {
    if (window.initAudioContext) window.initAudioContext().catch(e=>{});
    selectedProblem = transcribedProblems.find(p => p.id == id); 
    if (!selectedProblem) return updateNellMessage("データエラーだにゃ", "thinking", false);
    if (!selectedProblem.currentHintLevel) selectedProblem.currentHintLevel = 1;
    if (selectedProblem.maxUnlockedHintLevel === undefined) selectedProblem.maxUnlockedHintLevel = 0;
    ['problem-selection-view', 'grade-sheet-container', 'answer-display-area', 'chalkboard'].forEach(i => { const el = document.getElementById(i); if(el) el.classList.add('hidden'); });
    document.getElementById('final-view').classList.remove('hidden'); document.getElementById('hint-detail-container').classList.remove('hidden');
    const board = document.getElementById('chalkboard'); if(board) { board.innerText = selectedProblem.question; board.classList.remove('hidden'); }
    document.getElementById('main-back-btn').classList.add('hidden');
    updateNellMessage("ヒントを見るにゃ？", "thinking", false);
    renderHintUI();
};
function renderHintUI() {
    const p = selectedProblem;
    const maxUnlocked = p.maxUnlockedHintLevel;
    const hintBtnsContainer = document.querySelector('.hint-btns');
    hintBtnsContainer.innerHTML = `<div class="hint-step-badge" id="hint-step-label">考え方</div>`;

    let nextCost = 0, nextLabel = "";
    let nextLevel = maxUnlocked + 1;
    if (nextLevel === 1) { nextCost = 5; nextLabel = "カリカリ(×5)でヒントをもらう"; }
    else if (nextLevel === 2) { nextCost = 5; nextLabel = "カリカリ(×5)でさらにヒントをもらう"; }
    else if (nextLevel === 3) { nextCost = 10; nextLabel = "カリカリ(×10)で大ヒントをもらう"; }

    if (nextLevel <= 3) {
        const unlockBtn = document.createElement('button');
        unlockBtn.className = "main-btn blue-btn";
        unlockBtn.innerText = nextLabel;
        unlockBtn.onclick = () => unlockNextHint(nextLevel, nextCost);
        hintBtnsContainer.appendChild(unlockBtn);
    } else {
        const revealBtn = document.createElement('button');
        revealBtn.className = "main-btn orange-btn";
        revealBtn.innerText = "答えを見る";
        revealBtn.onclick = window.revealAnswer;
        hintBtnsContainer.appendChild(revealBtn);
    }
    
    if (maxUnlocked > 0) {
        const reviewContainer = document.createElement('div');
        reviewContainer.style.display = "flex";
        reviewContainer.style.gap = "5px";
        reviewContainer.style.marginTop = "10px";
        reviewContainer.style.flexWrap = "wrap";
        for (let i = 1; i <= maxUnlocked; i++) {
            const btn = document.createElement('button');
            btn.className = "main-btn gray-btn";
            btn.style.fontSize = "0.9rem";
            btn.style.padding = "8px";
            btn.style.flex = "1";
            btn.innerText = `ヒント${i}を見る`;
            btn.onclick = () => showHintText(i);
            reviewContainer.appendChild(btn);
        }
        hintBtnsContainer.appendChild(reviewContainer);
    }
    
    const ansDiv = document.createElement('div');
    ansDiv.id = "answer-display-area";
    ansDiv.className = "answer-box hidden";
    ansDiv.innerHTML = `ネル先生の答え：<br><span id="final-answer-text"></span>`;
    hintBtnsContainer.appendChild(ansDiv);
}
window.unlockNextHint = function(level, cost) {
    if (window.initAudioContext) window.initAudioContext();
    if (currentUser.karikari < cost) return updateNellMessage(`カリカリが足りないにゃ…あと${cost}個！`, "thinking", false);
    currentUser.karikari -= cost; saveAndSync(); updateMiniKarikari(); showKarikariEffect(-cost);
    selectedProblem.maxUnlockedHintLevel = level;
    showHintText(level); renderHintUI();
};
window.showHintText = function(level) {
    const hints = selectedProblem.hints || [];
    const text = hints[level - 1] || "ヒントが見つからないにゃ...";
    updateNellMessage(text, "thinking", false);
    const hl = document.getElementById('hint-step-label'); if(hl) hl.innerText = `ヒント Lv.${level}`; 
};
window.revealAnswer = function() {
    const ansArea = document.getElementById('answer-display-area'); const finalTxt = document.getElementById('final-answer-text');
    const correctArr = Array.isArray(selectedProblem.correct_answer) ? selectedProblem.correct_answer : [selectedProblem.correct_answer];
    let displayAnswer = correctArr.map(part => part.split('|')[0]).join(', ');
    if (ansArea && finalTxt) { finalTxt.innerText = displayAnswer; ansArea.classList.remove('hidden'); ansArea.style.display = "block"; }
    const btns = document.querySelectorAll('.hint-btns button.orange-btn'); btns.forEach(b => b.classList.add('hidden'));
    updateNellMessage(`答えは「${displayAnswer}」だにゃ！`, "gentle", false); 
};

// リスト生成 (配列対応版)
function createProblemItem(p, mode) {
    const isGradeMode = (mode === 'grade');
    let markHtml = "", bgStyle = "background:white;";
    let correctList = Array.isArray(p.correct_answer) ? p.correct_answer : [String(p.correct_answer)];
    correctList = correctList.map(s => String(s).trim()).filter(s => s !== ""); 
    let studentList = Array.isArray(p.student_answer) ? p.student_answer : [String(p.student_answer)];
    if (isGradeMode) {
        let isCorrect = p.is_correct;
        if (isCorrect === undefined) { 
            if (correctList.length !== studentList.length) isCorrect = false;
            else {
                isCorrect = true;
                for(let i=0; i<correctList.length; i++) {
                    if (!isMatch(studentList[i] || "", correctList[i])) { isCorrect = false; break; }
                }
            }
        }
        const mark = isCorrect ? "⭕" : "❌"; const markColor = isCorrect ? "#ff5252" : "#4a90e2"; bgStyle = isCorrect ? "background:#fff5f5;" : "background:#f0f8ff;";
        markHtml = `<div id="mark-${p.id}" style="font-weight:900; color:${markColor}; font-size:2rem; width:50px; text-align:center; flex-shrink:0;">${mark}</div>`;
    } else {
        markHtml = `<div id="mark-${p.id}" style="font-weight:900; color:#4a90e2; font-size:2rem; width:50px; text-align:center; flex-shrink:0;"></div>`;
    }
    let inputHtml = "";
    if (correctList.length > 1) {
        inputHtml = `<div style="display:grid; grid-template-columns: 1fr 1fr; gap:5px; width:100%;">`;
        for (let i = 0; i < correctList.length; i++) {
            let val = studentList[i] || "";
            const onInput = isGradeMode ? `oninput="checkMultiAnswer(${p.id}, event)"` : "";
            inputHtml += `<input type="text" value="${val}" class="multi-input-${p.id}" ${onInput} style="width:100%; padding:8px; border:2px solid #ddd; border-radius:8px; font-size:1rem; font-weight:bold; color:#333; min-width:0; box-sizing:border-box;">`;
        }
        inputHtml += `</div>`;
    } else {
        const val = studentList[0] || "";
        const onInput = isGradeMode ? `oninput="checkAnswerDynamically(${p.id}, this, event)"` : "";
        const idAttr = isGradeMode ? "" : `id="single-input-${p.id}"`;
        inputHtml = `<div style="width:100%;"><input type="text" ${idAttr} value="${val}" ${onInput} style="width:100%; padding:8px; border:2px solid #ddd; border-radius:8px; font-size:1rem; font-weight:bold; color:#333; box-sizing:border-box;"></div>`;
    }
    let buttonsHtml = "";
    if (isGradeMode) {
        buttonsHtml = `<div style="display:flex; flex-direction:column; gap:5px; width:80px; flex-shrink:0; justify-content:center; margin-left:auto;"><button class="mini-teach-btn" onclick="startHint(${p.id})" style="width:100%;">教えて</button></div>`;
    } else {
        buttonsHtml = `<div style="display:flex; flex-direction:column; gap:5px; width:80px; flex-shrink:0; margin-left:auto;"><button class="mini-teach-btn" onclick="checkOneProblem(${p.id})" style="background:#ff85a1; width:100%;">採点</button><button class="mini-teach-btn" onclick="startHint(${p.id})" style="width:100%;">教えて</button></div>`;
    }
    const div = document.createElement('div'); div.className = "grade-item"; div.id = `grade-item-${p.id}`; div.style.cssText = `border-bottom:1px solid #eee; padding:15px; margin-bottom:10px; border-radius:10px; ${bgStyle}`; 
    div.innerHTML = `<div style="display:flex; align-items:center; width:100%;">${markHtml}<div style="flex:1; margin-left:10px; display:flex; flex-direction:column; min-width:0;"><div style="font-size:0.9rem; color:#888; margin-bottom:4px;">${p.label || '問'}</div><div style="font-weight:bold; font-size:0.9rem; margin-bottom:8px; width:100%; word-break:break-all;">${p.question}</div><div style="display:flex; gap:10px; align-items:flex-start; width:100%; justify-content:space-between;"><div style="flex:1; min-width:0; margin-right:5px;">${inputHtml}<div style="font-size:0.7rem; color:#666; margin-top:4px;">キミの答え (直せるよ)</div></div>${buttonsHtml}</div></div></div>`; 
    return div;
}

window.showGradingView = function(silent = false) { 
    document.getElementById('problem-selection-view').classList.add('hidden'); 
    document.getElementById('final-view').classList.remove('hidden'); 
    document.getElementById('grade-sheet-container').classList.remove('hidden'); 
    document.getElementById('hint-detail-container').classList.add('hidden'); 
    const container = document.getElementById('problem-list-grade'); 
    container.innerHTML = ""; 
    transcribedProblems.forEach(p => { container.appendChild(createProblemItem(p, 'grade')); }); 
    const btnDiv = document.createElement('div'); btnDiv.style.textAlign = "center"; btnDiv.style.marginTop = "20px"; btnDiv.innerHTML = `<button onclick="finishGrading(this)" class="main-btn orange-btn">💯 採点おわり！</button>`; container.appendChild(btnDiv); 
    if (!silent) { updateGradingMessage(); } 
};
window.renderProblemSelection = function() { 
    document.getElementById('problem-selection-view').classList.remove('hidden'); 
    const l = document.getElementById('transcribed-problem-list'); l.innerHTML = ""; 
    transcribedProblems.forEach(p => { l.appendChild(createProblemItem(p, 'explain')); }); 
    const btn = document.querySelector('#problem-selection-view button.orange-btn'); if (btn) { btn.disabled = false; btn.innerText = "✨ ぜんぶわかったにゃ！"; } 
};

// 採点ロジック
function normalizeAnswer(str) { if (!str) return ""; let normalized = str.trim().replace(/[\u30a1-\u30f6]/g, m => String.fromCharCode(m.charCodeAt(0) - 0x60)); return normalized; }
function isMatch(student, correctString) { const s = normalizeAnswer(student); const options = normalizeAnswer(correctString).split('|'); return options.some(opt => opt === s); }
window.checkMultiAnswer = function(id, event) {
    if (window.isComposing) return;
    const problem = transcribedProblems.find(p => p.id === id);
    if (problem) {
        const inputs = document.querySelectorAll(`.multi-input-${id}`);
        const userValues = Array.from(inputs).map(input => input.value);
        problem.student_answer = userValues;
    }
    if(window.gradingTimer) clearTimeout(window.gradingTimer);
    window.gradingTimer = setTimeout(() => { _performCheckMultiAnswer(id); }, 1000);
};
function _performCheckMultiAnswer(id) {
    const problem = transcribedProblems.find(p => p.id === id); if (!problem) return;
    const userValues = problem.student_answer; 
    const correctList = Array.isArray(problem.correct_answer) ? problem.correct_answer : [problem.correct_answer];
    let allCorrect = false;
    if (userValues.length === correctList.length) {
        const usedIndices = new Set(); let matchCount = 0;
        for (const uVal of userValues) {
            for (let i = 0; i < correctList.length; i++) {
                if (!usedIndices.has(i)) { if (isMatch(uVal, correctList[i])) { usedIndices.add(i); matchCount++; break; } }
            }
        }
        allCorrect = (matchCount === correctList.length);
    }
    problem.is_correct = allCorrect;
    updateMarkDisplay(id, allCorrect);
    if (currentMode === 'grade') updateGradingMessage();
    if (allCorrect) { try { sfxMaru.currentTime = 0; sfxMaru.play(); } catch(e){} } 
    else if (userValues.some(v => v.trim().length > 0)) { try { sfxBatu.currentTime = 0; sfxBatu.play(); } catch(e){} }
}
window.checkAnswerDynamically = function(id, inputElem, event) { 
    if (window.isComposing) return;
    const problem = transcribedProblems.find(p => p.id === id);
    if(problem) problem.student_answer = [inputElem.value];
    const val = inputElem.value;
    if(window.gradingTimer) clearTimeout(window.gradingTimer);
    window.gradingTimer = setTimeout(() => { _performCheckAnswerDynamically(id, val); }, 1000);
};
function _performCheckAnswerDynamically(id, val) {
    const problem = transcribedProblems.find(p => p.id === id); if (!problem) return;
    const correctVal = Array.isArray(problem.correct_answer) ? problem.correct_answer[0] : problem.correct_answer;
    const isCorrect = isMatch(val, String(correctVal));
    problem.is_correct = isCorrect; 
    updateMarkDisplay(id, isCorrect);
    if (currentMode === 'grade') updateGradingMessage(); 
    if (isCorrect) { try { sfxMaru.currentTime = 0; sfxMaru.play(); } catch(e){} } 
    else if (val.trim().length > 0) { try { sfxBatu.currentTime = 0; sfxBatu.play(); } catch(e){} }
}
window.checkOneProblem = function(id) { 
    const problem = transcribedProblems.find(p => p.id === id); if (!problem) return; 
    const correctList = Array.isArray(problem.correct_answer) ? problem.correct_answer : [problem.correct_answer];
    let userValues = []; 
    if (correctList.length > 1) { 
        const inputs = document.querySelectorAll(`.multi-input-${id}`); 
        userValues = Array.from(inputs).map(i => i.value); 
    } else { 
        const input = document.getElementById(`single-input-${id}`); 
        if(input) userValues = [input.value]; 
    } 
    let isCorrect = false; 
    if (userValues.length === correctList.length) { 
        const usedIndices = new Set(); let matchCount = 0; 
        for (const uVal of userValues) { 
            for (let i = 0; i < correctList.length; i++) { 
                if (!usedIndices.has(i)) { if (isMatch(uVal, correctList[i])) { usedIndices.add(i); matchCount++; break; } } 
            } 
        } 
        isCorrect = (matchCount === correctList.length); 
    } 
    if (isCorrect) { try { sfxMaru.currentTime = 0; sfxMaru.play(); } catch(e){} } else { try { sfxBatu.currentTime = 0; sfxBatu.play(); } catch(e){} } 
    const markElem = document.getElementById(`mark-${id}`); const container = document.getElementById(`grade-item-${id}`); 
    if (markElem && container) { 
        if (isCorrect) { markElem.innerText = "⭕"; markElem.style.color = "#ff5252"; container.style.backgroundColor = "#fff5f5"; updateNellMessage("正解だにゃ！すごいにゃ！", "excited", false); } 
        else { markElem.innerText = "❌"; markElem.style.color = "#4a90e2"; container.style.backgroundColor = "#f0f8ff"; updateNellMessage("おしい！もう一回考えてみて！", "gentle", false); } 
    } 
};
function updateMarkDisplay(id, isCorrect) { const container = document.getElementById(`grade-item-${id}`); const markElem = document.getElementById(`mark-${id}`); if (container && markElem) { if (isCorrect) { markElem.innerText = "⭕"; markElem.style.color = "#ff5252"; container.style.backgroundColor = "#fff5f5"; } else { markElem.innerText = "❌"; markElem.style.color = "#4a90e2"; container.style.backgroundColor = "#f0f8ff"; } } }
window.updateGradingMessage = function() { let correctCount = 0; transcribedProblems.forEach(p => { if (p.is_correct) correctCount++; }); const scoreRate = correctCount / (transcribedProblems.length || 1); if (scoreRate === 1.0) updateNellMessage(`全問正解だにゃ！天才だにゃ〜！！`, "excited", false); else if (scoreRate >= 0.5) updateNellMessage(`あと${transcribedProblems.length - correctCount}問！直してみるにゃ！`, "happy", false); else updateNellMessage(`間違ってても大丈夫！入力し直してみて！`, "gentle", false); };

// スクロール復元
window.backToProblemSelection = function() { 
    document.getElementById('final-view').classList.add('hidden'); 
    document.getElementById('hint-detail-container').classList.add('hidden'); 
    document.getElementById('chalkboard').classList.add('hidden'); 
    document.getElementById('answer-display-area').classList.add('hidden'); 
    if (currentMode === 'grade') showGradingView(); else { renderProblemSelection(); updateNellMessage("他も見るにゃ？", "normal", false); } 
    const backBtn = document.getElementById('main-back-btn'); 
    if(backBtn) { backBtn.classList.remove('hidden'); backBtn.onclick = backToLobby; } 
    if (selectedProblem && selectedProblem.id) {
        setTimeout(() => {
            const targetId = `grade-item-${selectedProblem.id}`;
            const targetElement = document.getElementById(targetId);
            if (targetElement) {
                targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                const originalBg = targetElement.style.backgroundColor;
                targetElement.style.transition = "background-color 0.3s";
                targetElement.style.backgroundColor = "#fff9c4"; 
                setTimeout(() => { targetElement.style.backgroundColor = originalBg; }, 800);
            }
        }, 100);
    }
};

window.pressThanks = function() { window.backToProblemSelection(); };
window.finishGrading = async function(btnElement) { if(btnElement) { btnElement.disabled = true; btnElement.innerText = "採点完了！"; } if (currentUser) { currentUser.karikari += 100; saveAndSync(); updateMiniKarikari(); showKarikariEffect(100); } await updateNellMessage("よくがんばったにゃ！カリカリ100個あげる！", "excited", false); setTimeout(() => { if(typeof backToLobby === 'function') backToLobby(true); }, 3000); };
window.pressAllSolved = function(btnElement) { if(btnElement) { btnElement.disabled = true; btnElement.innerText = "すごい！"; } if (currentUser) { currentUser.karikari += 100; saveAndSync(); showKarikariEffect(100); updateMiniKarikari(); updateNellMessage("よくがんばったにゃ！カリカリ100個あげるにゃ！", "excited", false).then(() => { setTimeout(() => { if(typeof backToLobby === 'function') backToLobby(true); }, 3000); }); } };
window.renderMistakeSelection = function() { if (!currentUser.mistakes || currentUser.mistakes.length === 0) { updateNellMessage("ノートは空っぽにゃ！", "happy", false); setTimeout(backToLobby, 2000); return; } transcribedProblems = currentUser.mistakes; renderProblemSelection(); updateNellMessage("復習するにゃ？", "excited", false); };
window.giveLunch = function() { if (currentUser.karikari < 1) return updateNellMessage("カリカリがないにゃ……", "thinking", false); updateNellMessage("もぐもぐ……", "normal", false); currentUser.karikari--; if(typeof saveAndSync === 'function') saveAndSync(); updateMiniKarikari(); showKarikariEffect(-1); lunchCount++; fetch('/lunch-reaction', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count: lunchCount, name: currentUser.name }) }).then(r => r.json()).then(d => { setTimeout(() => { updateNellMessage(d.reply || "おいしいにゃ！", d.isSpecial ? "excited" : "happy", true); }, 1500); }).catch(e => { setTimeout(() => { updateNellMessage("おいしいにゃ！", "happy", false); }, 1500); }); }; 
window.showGame = function() { switchScreen('screen-game'); document.getElementById('mini-karikari-display').classList.remove('hidden'); updateMiniKarikari(); initGame(); fetchGameComment("start"); const startBtn = document.getElementById('start-game-btn'); if (startBtn) { const newBtn = startBtn.cloneNode(true); startBtn.parentNode.replaceChild(newBtn, startBtn); newBtn.onclick = () => { if (!gameRunning) { initGame(); gameRunning = true; newBtn.disabled = true; drawGame(); } }; } };
function fetchGameComment(type, score=0) { fetch('/game-reaction', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, name: currentUser.name, score }) }).then(r=>r.json()).then(d=>{ updateNellMessage(d.reply, d.mood || "excited", true); }).catch(e=>{}); }

// ゲーム機能
function initGame() { gameCanvas = document.getElementById('game-canvas'); if(!gameCanvas) return; ctx = gameCanvas.getContext('2d'); paddle = { w: 80, h: 10, x: 120, speed: 7 }; ball = { x: 160, y: 350, dx: 3, dy: -3, r: 8 }; score = 0; document.getElementById('game-score').innerText = score; bricks = []; for(let c=0; c<5; c++) for(let r=0; r<4; r++) bricks.push({ x: c*64+10, y: r*35+40, status: 1 }); gameCanvas.removeEventListener("mousemove", movePaddle); gameCanvas.removeEventListener("touchmove", touchPaddle); gameCanvas.addEventListener("mousemove", movePaddle, false); gameCanvas.addEventListener("touchmove", touchPaddle, { passive: false }); }
function movePaddle(e) { const rect = gameCanvas.getBoundingClientRect(); const scaleX = gameCanvas.width / rect.width; const rx = (e.clientX - rect.left) * scaleX; if(rx > 0 && rx < gameCanvas.width) paddle.x = rx - paddle.w/2; }
function touchPaddle(e) { e.preventDefault(); const rect = gameCanvas.getBoundingClientRect(); const scaleX = gameCanvas.width / rect.width; const rx = (e.touches[0].clientX - rect.left) * scaleX; if(rx > 0 && rx < gameCanvas.width) paddle.x = rx - paddle.w/2; }
function drawGame() { if (!gameRunning) return; ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height); ctx.font = "20px serif"; bricks.forEach(b => { if(b.status === 1) ctx.fillText("🍖", b.x + 10, b.y + 20); }); ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI*2); ctx.fillStyle = "#ff85a1"; ctx.fill(); ctx.closePath(); ctx.fillStyle = "#4a90e2"; ctx.fillRect(paddle.x, gameCanvas.height - paddle.h - 10, paddle.w, paddle.h); bricks.forEach(b => { if(b.status === 1 && ball.x>b.x && ball.x<b.x+40 && ball.y>b.y && ball.y<b.y+30){ ball.dy*=-1; b.status=0; score++; document.getElementById('game-score').innerText=score; try { sfxHit.currentTime=0; sfxHit.play(); } catch(e){} if (Math.random() > 0.7 && !window.isNellSpeaking) { updateNellMessage(gameHitComments[Math.floor(Math.random() * gameHitComments.length)], "excited", false); } if(score===bricks.length) { endGame(true); return; } } }); if(ball.x+ball.dx > gameCanvas.width-ball.r || ball.x+ball.dx < ball.r) ball.dx *= -1; if(ball.y+ball.dy < ball.r) ball.dy *= -1; else if(ball.y+ball.dy > gameCanvas.height - ball.r - 20) { if(ball.x > paddle.x && ball.x < paddle.x + paddle.w) { ball.dy *= -1; ball.dx = (ball.x - (paddle.x+paddle.w/2)) * 0.15; try { sfxPaddle.currentTime = 0; sfxPaddle.play(); } catch(e){} } else if(ball.y+ball.dy > gameCanvas.height-ball.r) { try { sfxOver.currentTime=0; sfxOver.play(); } catch(e){} endGame(false); return; } } ball.x += ball.dx; ball.y += ball.dy; gameAnimId = requestAnimationFrame(drawGame); }
function endGame(c) { gameRunning = false; if(gameAnimId)cancelAnimationFrame(gameAnimId); fetchGameComment("end", score); const s=document.getElementById('start-game-btn'); if(s){s.disabled=false;s.innerText="もう一回！";} setTimeout(()=>{ alert(c?`すごい！全クリだにゃ！\nカリカリ ${score} 個ゲット！`:`おしい！\nカリカリ ${score} 個ゲット！`); if(currentUser&&score>0){currentUser.karikari+=score;if(typeof saveAndSync==='function')saveAndSync();updateMiniKarikari();showKarikariEffect(score);} }, 500); }

// Cropper
function initCustomCropper() { const modal = document.getElementById('cropper-modal'); modal.classList.remove('hidden'); const canvas = document.getElementById('crop-canvas'); const MAX_CANVAS_SIZE = 2500; let w = cropImg.width; let h = cropImg.height; if (w > MAX_CANVAS_SIZE || h > MAX_CANVAS_SIZE) { const scale = Math.min(MAX_CANVAS_SIZE / w, MAX_CANVAS_SIZE / h); w *= scale; h *= scale; cropPoints = cropPoints.map(p => ({ x: p.x * scale, y: p.y * scale })); } canvas.width = w; canvas.height = h; canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.objectFit = 'contain'; const ctx = canvas.getContext('2d'); ctx.drawImage(cropImg, 0, 0, w, h); updateCropUI(canvas); const handles = ['handle-tl', 'handle-tr', 'handle-br', 'handle-bl']; handles.forEach((id, idx) => { const el = document.getElementById(id); const startDrag = (e) => { e.preventDefault(); activeHandle = idx; }; el.onmousedown = startDrag; el.ontouchstart = startDrag; }); const move = (e) => { if (activeHandle === -1) return; e.preventDefault(); const rect = canvas.getBoundingClientRect(); const imgRatio = canvas.width / canvas.height; const rectRatio = rect.width / rect.height; let drawX, drawY, drawW, drawH; if (imgRatio > rectRatio) { drawW = rect.width; drawH = rect.width / imgRatio; drawX = 0; drawY = (rect.height - drawH) / 2; } else { drawH = rect.height; drawW = rect.height * imgRatio; drawY = 0; drawX = (rect.width - drawW) / 2; } const clientX = e.touches ? e.touches[0].clientX : e.clientX; const clientY = e.touches ? e.touches[0].clientY : e.clientY; let relX = (clientX - rect.left - drawX) / drawW; let relY = (clientY - rect.top - drawY) / drawH; relX = Math.max(0, Math.min(1, relX)); relY = Math.max(0, Math.min(1, relY)); cropPoints[activeHandle] = { x: relX * canvas.width, y: relY * canvas.height }; updateCropUI(canvas); }; const end = () => { activeHandle = -1; }; window.onmousemove = move; window.ontouchmove = move; window.onmouseup = end; window.ontouchend = end; document.getElementById('cropper-cancel-btn').onclick = () => { modal.classList.add('hidden'); window.onmousemove = null; window.ontouchmove = null; document.getElementById('upload-controls').classList.remove('hidden'); }; document.getElementById('cropper-ok-btn').onclick = () => { modal.classList.add('hidden'); window.onmousemove = null; window.ontouchmove = null; const croppedBase64 = performPerspectiveCrop(canvas, cropPoints); startAnalysis(croppedBase64); }; }
function updateCropUI(canvas) { const handles = ['handle-tl', 'handle-tr', 'handle-br', 'handle-bl']; const rect = canvas.getBoundingClientRect(); const imgRatio = canvas.width / canvas.height; const rectRatio = rect.width / rect.height; let drawX, drawY, drawW, drawH; if (imgRatio > rectRatio) { drawW = rect.width; drawH = rect.width / imgRatio; drawX = 0; drawY = (rect.height - drawH) / 2; } else { drawH = rect.height; drawW = rect.height * imgRatio; drawY = 0; drawX = (rect.width - drawW) / 2; } const toScreen = (p) => ({ x: (p.x / canvas.width) * drawW + drawX + canvas.offsetLeft, y: (p.y / canvas.height) * drawH + drawY + canvas.offsetTop }); const screenPoints = cropPoints.map(toScreen); handles.forEach((id, i) => { const el = document.getElementById(id); el.style.left = screenPoints[i].x + 'px'; el.style.top = screenPoints[i].y + 'px'; }); const svg = document.getElementById('crop-lines'); svg.style.left = canvas.offsetLeft + 'px'; svg.style.top = canvas.offsetTop + 'px'; svg.style.width = canvas.offsetWidth + 'px'; svg.style.height = canvas.offsetHeight + 'px'; const toSvg = (p) => ({ x: (p.x / canvas.width) * drawW + drawX, y: (p.y / canvas.height) * drawH + drawY }); const svgPts = cropPoints.map(toSvg); const ptsStr = svgPts.map(p => `${p.x},${p.y}`).join(' '); svg.innerHTML = `<polyline points="${ptsStr} ${svgPts[0].x},${svgPts[0].y}" style="fill:rgba(255,255,255,0.2);stroke:#ff4081;stroke-width:2;stroke-dasharray:5" />`; }
function processImageForAI(sourceCanvas) { const MAX_WIDTH = 1600; let w = sourceCanvas.width; let h = sourceCanvas.height; if (w > MAX_WIDTH || h > MAX_WIDTH) { if (w > h) { h *= MAX_WIDTH / w; w = MAX_WIDTH; } else { w *= MAX_WIDTH / h; h = MAX_WIDTH; } } const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; const ctx = canvas.getContext('2d'); ctx.drawImage(sourceCanvas, 0, 0, w, h); return canvas.toDataURL('image/jpeg', 0.9); }
function performPerspectiveCrop(sourceCanvas, points) { const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x)); const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y)); let w = maxX - minX, h = maxY - minY; if (w < 1) w = 1; if (h < 1) h = 1; const tempCv = document.createElement('canvas'); tempCv.width = w; tempCv.height = h; const ctx = tempCv.getContext('2d'); ctx.drawImage(sourceCanvas, minX, minY, w, h, 0, 0, w, h); return processImageForAI(tempCv).split(',')[1]; }
window.handleFileUpload = async (file) => { if (isAnalyzing || !file) return; document.getElementById('upload-controls').classList.add('hidden'); document.getElementById('cropper-modal').classList.remove('hidden'); const canvas = document.getElementById('crop-canvas'); canvas.style.opacity = '0'; const reader = new FileReader(); reader.onload = async (e) => { cropImg = new Image(); cropImg.onload = async () => { const w = cropImg.width; const h = cropImg.height; cropPoints = [ { x: w * 0.1, y: h * 0.1 }, { x: w * 0.9, y: h * 0.1 }, { x: w * 0.9, y: h * 0.9 }, { x: w * 0.1, y: h * 0.9 } ]; canvas.style.opacity = '1'; updateNellMessage("ここを読み取るにゃ？", "normal"); initCustomCropper(); }; cropImg.src = e.target.result; }; reader.readAsDataURL(file); };