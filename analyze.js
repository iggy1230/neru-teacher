// --- analyze.js (完全版 v272.0: テキスト表示・TTS読み上げ・名称抽出対応) ---

// ==========================================
// 1. 最重要：UI操作・モード選択関数 (必ず最初に定義)
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

// ★追加: ストリーミングテキスト処理用変数
let streamTextBuffer = ""; // 表示用の累積テキスト
let ttsTextBuffer = "";    // TTS送信用の一時バッファ
let latestDetectedName = null; // 抽出された物体名

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

// selectModeを最優先で定義
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

        const ids = ['subject-selection-view', 'upload-controls', 'thinking-view', 'problem-selection-view', 'final-view', 'chalkboard', 'chat-view', 'simple-chat-view', 'lunch-view', 'grade-sheet-container', 'hint-detail-container', 'embedded-chat-section'];
        ids.forEach(id => { 
            const el = document.getElementById(id); 
            if (el) el.classList.add('hidden'); 
        });
        
        const backBtn = document.getElementById('main-back-btn');
        if (backBtn) { backBtn.classList.remove('hidden'); backBtn.onclick = window.backToLobby; }
        
        if (typeof window.stopLiveChat === 'function') {
            window.stopLiveChat();
        }
        
        gameRunning = false;
        const icon = document.querySelector('.nell-avatar-wrap img'); 
        if(icon) icon.src = "nell-normal.png";
        
        const miniKarikari = document.getElementById('mini-karikari-display');
        if(miniKarikari) miniKarikari.classList.remove('hidden');
        if(typeof updateMiniKarikari === 'function') updateMiniKarikari();
        
        // モード別表示制御
        if (m === 'chat') { 
            document.getElementById('chat-view').classList.remove('hidden'); 
            window.updateNellMessage("お宝を見せてにゃ！", "excited", false); 
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
// 2. 音声・Socket・カメラ関連関数
// ==========================================

// 効果音定義
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

// 画像リソース
const subjectImages = {
    'こくご': { base: 'nell-kokugo.png', talk: 'nell-kokugo-talk.png' },
    'さんすう': { base: 'nell-sansu.png', talk: 'nell-sansu-talk.png' },
    'りか': { base: 'nell-rika.png', talk: 'nell-rika-talk.png' },
    'しゃかい': { base: 'nell-shakai.png', talk: 'nell-shakai-talk.png' },
    'おはなし': { base: 'nell-normal.png', talk: 'nell-talk.png' }
};
const defaultIcon = 'nell-normal.png'; 
const talkIcon = 'nell-talk.png';

// 口パクアニメーション
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
    console.log("[System] analyze.js DOMContentLoaded");
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

window.updateNellMessage = async function(t, mood = "normal", saveToMemory = false, speak = true) {
    // chatモード（お宝図鑑）はTTS(speakNell)を使うので抑制しない
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
        if (textForSpeech.length > 0) await speakNell(textForSpeech, mood);
    }
};

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
                
                if (studyTimerValue === 600) {
                    window.updateNellMessage("10分前だにゃ〜。お茶でも飲んで落ち着くにゃ。", "gentle", false, true);
                } else if (studyTimerValue === 300) {
                    window.updateNellMessage("あと5分。一歩ずつ、一歩ずつだにゃ〜。", "normal", false, true);
                } else if (studyTimerValue === 180) {
                    window.updateNellMessage("3分前。深呼吸して、もうひと踏ん張りだにゃ。", "excited", false, true);
                } else if (studyTimerValue === 60) {
                    window.updateNellMessage("あと1分だにゃ。最後までボクが見守ってるにゃ。", "excited", false, true);
                }

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
        clientContent: { 
            turns: [{ role: "user", parts: [{ text: `（システム指示: ${text}）` }] }],
            turnComplete: true 
        } 
    }));
}

// ==========================================
// ★ Live Chat & Camera (大幅改修)
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
    
    let videoId = 'live-chat-video';
    if (context === 'simple') videoId = 'live-chat-video-simple';
    else if (context === 'embedded') videoId = 'live-chat-video-embedded';
    
    const video = document.getElementById(videoId);

    if (!video || !video.srcObject || !video.srcObject.active) {
        return alert("カメラが動いてないにゃ...。一度「おはなしする」を終了して、もう一度つなぎ直してみてにゃ。");
    }

    stopAudioPlayback();
    ignoreIncomingAudio = true; 
    
    window.isLiveImageSending = true;
    
    let btnId = 'live-camera-btn';
    if (context === 'simple') btnId = 'live-camera-btn-simple';
    else if (context === 'embedded') btnId = 'live-camera-btn-embedded';
    
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
    
    // 図鑑登録用の先行保存処理（通常モードのみ）
    if (context !== 'simple' && context !== 'embedded') {
        const thumbCanvas = document.createElement('canvas');
        const thumbSize = 150; 
        let tw = canvas.width, th = canvas.height;
        if (tw > th) { th *= thumbSize / tw; tw = thumbSize; }
        else { tw *= thumbSize / th; th = thumbSize; }
        thumbCanvas.width = tw; thumbCanvas.height = th;
        thumbCanvas.getContext('2d').drawImage(canvas, 0, 0, tw, th);
        window.lastSentCollectionImage = thumbCanvas.toDataURL('image/jpeg', 0.7);

        if (window.NellMemory) {
            const timestamp = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const tempName = `🔍 解析中... (${timestamp})`;
            try {
                window.NellMemory.addToCollection(currentUser.id, tempName, window.lastSentCollectionImage);
                const notif = document.createElement('div');
                notif.innerText = `📸 写真を撮ったにゃ！`;
                notif.style.cssText = "position:fixed; top:20%; left:50%; transform:translateX(-50%); background:rgba(255,255,255,0.95); border:4px solid #4caf50; color:#2e7d32; padding:10px 20px; border-radius:30px; font-weight:bold; z-index:10000; animation: popIn 0.5s ease; box-shadow:0 4px 10px rgba(0,0,0,0.2);";
                document.body.appendChild(notif);
                setTimeout(() => notif.remove(), 2000);
                try{ sfxHirameku.currentTime=0; sfxHirameku.play(); } catch(e){}
            } catch(e) { console.error("[Collection] ❌ Pre-save failed:", e); }
        }
    } else {
        const notif = document.createElement('div');
        notif.innerText = `📝 問題を送ったにゃ！`;
        notif.style.cssText = "position:fixed; top:20%; left:50%; transform:translateX(-50%); background:rgba(255,255,255,0.95); border:4px solid #8bc34a; color:#558b2f; padding:10px 20px; border-radius:30px; font-weight:bold; z-index:10000; animation: popIn 0.5s ease; box-shadow:0 4px 10px rgba(0,0,0,0.2);";
        document.body.appendChild(notif);
        setTimeout(() => notif.remove(), 2000);
    }

    const base64Data = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
    
    const flash = document.createElement('div');
    flash.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:white; opacity:0.8; z-index:9999; pointer-events:none; transition:opacity 0.3s;";
    document.body.appendChild(flash);
    setTimeout(() => { flash.style.opacity = 0; setTimeout(() => flash.remove(), 300); }, 50);

    let containerId = 'live-chat-video-container';
    if (context === 'simple') containerId = 'live-chat-video-container-simple';
    else if (context === 'embedded') containerId = 'live-chat-video-container-embedded';
    
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

        setTimeout(() => {
            if(previewImg && previewImg.parentNode) previewImg.remove();
        }, 3000);
    }

    updateNellMessage("ん？どれどれ…", "thinking", false, false);
    
    if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
        console.log(`[Collection] 🚀 Sending image. Context: ${context}`);
        
        let promptText = "";
        
        if (context === 'simple' || context === 'embedded') {
            promptText = "（ユーザーが勉強の問題や画像を見せました）この画像の内容を詳しく、子供にもわかるように丁寧に教えてください。図鑑登録は不要です。";
        } else {
            promptText = "（ユーザーが画像を見せました）これなぁに？ この画像に写っている一番はっきりした物体を特定して。必ず `register_collection_item` ツールを実行して名前を登録してください。";
        }

        liveSocket.send(JSON.stringify({ 
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

    setTimeout(() => {
        window.isLiveImageSending = false;
        window.isMicMuted = false;
        
        if (btn) {
            if (context === 'simple' || context === 'embedded') {
                btn.innerHTML = "<span>📝</span> 問題をみせて教えてもらう";
                btn.style.backgroundColor = "#8bc34a";
            } else {
                btn.innerHTML = "<span>📷</span> お宝を見せる（図鑑登録）";
                btn.style.backgroundColor = "#4a90e2";
            }
        }
    }, 3000);
    
    setTimeout(() => { ignoreIncomingAudio = false; }, 300);
};

// ==========================================
// ★ WebSocket (Live Chat) - 修正版
// ==========================================

window.stopLiveChat = function() {
    if (window.NellMemory) {
        if (chatTranscript && chatTranscript.length > 10) {
            console.log(`【Memory】更新開始 (ログ長: ${chatTranscript.length})`);
            window.NellMemory.updateProfileFromChat(currentUser.id, chatTranscript);
        }
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
    
    // 全ボタンのリセット
    const btnIds = ['mic-btn', 'mic-btn-simple', 'mic-btn-embedded'];
    btnIds.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) { 
            btn.innerText = "🎤 おはなしする"; 
            if(id === 'mic-btn-embedded') btn.innerText = "🎤 質問する"; 
            btn.style.background = (id === 'mic-btn') ? "#ff85a1" : "#66bb6a"; 
            if(id === 'mic-btn-embedded') btn.style.background = "#8bc34a";
            btn.disabled = false; 
            if (id === 'mic-btn') btn.onclick = () => startLiveChat('main');
            else if (id === 'mic-btn-simple') btn.onclick = () => startLiveChat('simple');
            else if (id === 'mic-btn-embedded') btn.onclick = () => startLiveChat('embedded');
        } 
    });

    liveSocket = null; 
    activeChatContext = null;
    
    // バッファ初期化
    streamTextBuffer = "";
    ttsTextBuffer = "";
    latestDetectedName = null;
    
    // カメラボタンのリセット
    const camBtn = document.getElementById('live-camera-btn');
    if (camBtn) {
        camBtn.innerHTML = "<span>📷</span> お宝を見せる（図鑑登録）";
        camBtn.style.backgroundColor = "#4a90e2";
    }
    // ... 他のカメラボタンもリセット ... (省略なし版では全部書く)
    const camBtnSimple = document.getElementById('live-camera-btn-simple');
    if (camBtnSimple) {
        camBtnSimple.innerHTML = "<span>📝</span> 問題をみせて教えてもらう";
        camBtnSimple.style.backgroundColor = "#8bc34a";
    }
    const camBtnEmbedded = document.getElementById('live-camera-btn-embedded');
    if (camBtnEmbedded) {
        camBtnEmbedded.innerHTML = "<span>📝</span> 画面を見せて質問";
        camBtnEmbedded.style.backgroundColor = "#66bb6a";
    }

    window.isLiveImageSending = false;
    window.isMicMuted = false; 

    // ビデオ要素のリセット
    const video = document.getElementById('live-chat-video');
    if(video) video.srcObject = null;
    document.getElementById('live-chat-video-container').style.display = 'none';

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

    let btnId = 'mic-btn';
    if (context === 'simple') btnId = 'mic-btn-simple';
    else if (context === 'embedded') btnId = 'mic-btn-embedded';

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
        latestDetectedName = null;
        
        if (window.initAudioContext) await window.initAudioContext(); 
        audioContext = new (window.AudioContext || window.webkitAudioContext)(); 
        await audioContext.resume(); 
        nextStartTime = audioContext.currentTime; 
        
        const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:'; 
        let statusSummary = `${currentUser.name}さんは今、お話しにきたにゃ。カリカリは${currentUser.karikari}個持ってるにゃ。`; 
        
        let modeParam = currentMode;
        if (context === 'embedded') {
            modeParam = 'simple-chat'; 
        }

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

                // ツール呼び出し検出
                if (data.type === "save_to_collection") {
                    console.log(`[Collection] 📥 Tool Call detected: ${data.itemName}`);
                    latestDetectedName = data.itemName;
                }
                
                // コンテンツ受信 (テキスト or 音声)
                if (data.serverContent?.modelTurn?.parts) { 
                    data.serverContent.modelTurn.parts.forEach(p => { 
                        // ★修正: テキストストリーミング処理
                        if (p.text) { 
                            console.log(`[Gemini Raw Text] ${p.text}`);
                            
                            const chunk = p.text;
                            streamTextBuffer += chunk;
                            ttsTextBuffer += chunk;

                            // ホワイトボード検出
                            const match = chunk.match(/(?:\[|\【)?DISPLAY[:：]\s*(.+?)(?:\]|\】)?/i);
                            if (match) {
                                const content = match[1].trim();
                                document.getElementById('inline-whiteboard').classList.remove('hidden');
                                document.getElementById('whiteboard-content').innerText = content;
                            }
                            
                            // 物体名抽出 (バックアップ)
                            if (currentMode === 'chat') {
                                const patterns = [
                                    /これは(.+?)だにゃ/,
                                    /これは(.+?)にゃ/,
                                    /正解は(.+?)だにゃ/,
                                    /正解は(.+?)にゃ/
                                ];
                                for (let pattern of patterns) {
                                    const m = streamTextBuffer.match(pattern); // 全体から検索
                                    if (m && m[1]) {
                                        const name = m[1].replace(/[:。！？]/g, "").trim();
                                        if (name.length > 0 && name.length < 20) {
                                            console.log(`[Collection] 🔍 Text analysis detected: ${name}`);
                                            latestDetectedName = name;
                                        }
                                    }
                                }
                            }

                            // 1. 吹き出し更新 (累積テキストを表示)
                            const el = document.getElementById(activeChatContext === 'embedded' ? 'nell-text' : 'nell-text'); // IDは共通の可能性が高いが念のため
                            if(el) el.innerText = streamTextBuffer;
                            // 通常のupdateNellMessageを呼ぶと上書きされるので、DOM直接操作推奨だが、
                            // ID分岐が複雑なので、ここでは共通の場所 'nell-text' を更新
                            const mainEl = document.getElementById('nell-text');
                            const gameEl = document.getElementById('nell-text-game');
                            if(mainEl) mainEl.innerText = streamTextBuffer;
                            if(gameEl) gameEl.innerText = streamTextBuffer;

                            // 2. TTS読み上げ (chatモードのみ, 句読点区切り)
                            if (currentMode === 'chat' && !window.isMicMuted && /[。！？\n]/.test(ttsTextBuffer)) {
                                speakNell(ttsTextBuffer, "normal");
                                ttsTextBuffer = ""; // 読んだ分はクリア
                            }
                        } 
                        
                        // 音声データ (simple-chatモードなど)
                        if (p.inlineData) playLivePcmAudio(p.inlineData.data); 
                    }); 
                }

                // ターン完了時に確定処理
                if (data.serverContent && data.serverContent.turnComplete) {
                    saveToNellMemory('nell', streamTextBuffer); // メモリには全文保存
                    
                    // 残りのTTSバッファがあれば読む
                    if (currentMode === 'chat' && ttsTextBuffer.length > 0 && !window.isMicMuted) {
                        speakNell(ttsTextBuffer, "normal");
                        ttsTextBuffer = "";
                    }

                    if (latestDetectedName && window.NellMemory && currentMode === 'chat') {
                        console.log(`[Collection] 🔄 Turn Complete. Committing name: ${latestDetectedName}`);
                        window.NellMemory.updateLatestCollectionItem(currentUser.id, latestDetectedName);
                        
                        const notif = document.createElement('div');
                        notif.innerText = `📖 図鑑に「${latestDetectedName}」として登録したにゃ！`;
                        notif.style.cssText = "position:fixed; top:20%; left:50%; transform:translateX(-50%); background:rgba(255,255,255,0.95); border:4px solid #00bcd4; color:#006064; padding:15px 25px; border-radius:30px; font-weight:900; z-index:10000; box-shadow:0 10px 25px rgba(0,0,0,0.3); font-size:1.2rem; animation: popIn 0.5s ease;";
                        document.body.appendChild(notif);
                        setTimeout(() => notif.remove(), 4000);
                        try{ sfxHirameku.currentTime=0; sfxHirameku.play(); } catch(e){} 
                        latestDetectedName = null;
                    }
                    
                    // 次のターンのためにバッファクリア (会話履歴としては残すべきだが、表示上は次の発話でクリアされることが多い)
                    // ここではクリアせず、次の発話開始時(user発話時など)にクリアするのが自然だが、
                    // Geminiの仕様上、turnComplete後にUser発話を待つ。
                    // ユーザー発話認識時に streamTextBuffer = "" するのが良さそう。(startMicrophone内)
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
                
                // ユーザーが喋り始めたら、AIの表示バッファをクリアする準備
                // ただし、確定前(interim)で消すとチラつくので、確定(isFinal)時にクリアするか、
                // あるいはAIが喋り終わっているならクリアして良い。
                
                if (window.isNellSpeaking && cleanText.length > 0) {
                    const isLongEnough = cleanText.length >= 10;
                    const isStopCommand = stopKeywords.some(w => cleanText.includes(w));
                    if (isLongEnough || isStopCommand) stopAudioPlayback();
                }
                for (let i = event.resultIndex; i < event.results.length; ++i) { 
                    if (event.results[i].isFinal) { 
                        const userText = event.results[i][0].transcript;
                        saveToNellMemory('user', userText); 
                        
                        // ユーザー発話が確定したら、次回のAI応答のためにバッファをリセットしておく
                        streamTextBuffer = ""; 
                        ttsTextBuffer = "";

                        let txtId = 'user-speech-text';
                        if (activeChatContext === 'simple') txtId = 'user-speech-text-simple';
                        else if (activeChatContext === 'embedded') txtId = 'user-speech-text-embedded';
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
            let videoId = 'live-chat-video';
            let containerId = 'live-chat-video-container';
            if (activeChatContext === 'simple') {
                videoId = 'live-chat-video-simple';
                containerId = 'live-chat-video-container-simple';
            } else if (activeChatContext === 'embedded') {
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
function initCustomCropper() { const modal = document.getElementById('cropper-modal'); modal.classList.remove('hidden'); const canvas = document.getElementById('crop-canvas'); const MAX_CANVAS_SIZE = 2500; let w = cropImg.width; let h = cropImg.height; if (w > MAX_CANVAS_SIZE || h > MAX_CANVAS_SIZE) { const scale = Math.min(MAX_CANVAS_SIZE / w, MAX_CANVAS_SIZE / h); w *= scale; h *= scale; cropPoints = cropPoints.map(p => ({ x: p.x * scale, y: p.y * scale })); } canvas.width = w; canvas.height = h; canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.objectFit = 'contain'; const ctx = canvas.getContext('2d'); ctx.drawImage(cropImg, 0, 0, w, h); updateCropUI(canvas); const handles = ['handle-tl', 'handle-tr', 'handle-br', 'handle-bl']; handles.forEach((id, idx) => { const el = document.getElementById(id); const startDrag = (e) => { e.preventDefault(); activeHandle = idx; }; el.onmousedown = startDrag; el.ontouchstart = startDrag; }); const move = (e) => { if (activeHandle === -1) return; e.preventDefault(); const rect = canvas.getBoundingClientRect(); const imgRatio = canvas.width / canvas.height; const rectRatio = rect.width / rect.height; let drawX, drawY, drawW, drawH; if (imgRatio > rectRatio) { drawW = rect.width; drawH = rect.width / imgRatio; drawX = 0; drawY = (rect.height - drawH) / 2; } else { drawH = rect.height; drawW = rect.height * imgRatio; drawY = 0; drawX = (rect.width - drawW) / 2; } const clientX = e.touches ? e.touches[0].clientX : e.clientX; const clientY = e.touches ? e.touches[0].clientY : e.clientY; let relX = (clientX - rect.left - drawX) / drawW; let relY = (clientY - rect.top - drawY) / drawH; relX = Math.max(0, Math.min(1, relX)); relY = Math.max(0, Math.min(1, relY)); cropPoints[activeHandle] = { x: relX * canvas.width, y: relY * canvas.height }; updateCropUI(canvas); }; const end = () => { activeHandle = -1; }; window.onmousemove = move; window.ontouchmove = move; window.onmouseup = end; window.ontouchend = end; document.getElementById('cropper-cancel-btn').onclick = () => { modal.classList.add('hidden'); window.onmousemove = null; window.ontouchmove = null; document.getElementById('upload-controls').classList.remove('hidden'); }; document.getElementById('cropper-ok-btn').onclick = () => { modal.classList.add('hidden'); window.onmousemove = null; window.ontouchmove = null; const croppedBase64 = performPerspectiveCrop(canvas, cropPoints); startAnalysis(croppedBase64); }; }
function updateCropUI(canvas) { const handles = ['handle-tl', 'handle-tr', 'handle-br', 'handle-bl']; const rect = canvas.getBoundingClientRect(); const imgRatio = canvas.width / canvas.height; const rectRatio = rect.width / rect.height; let drawX, drawY, drawW, drawH; if (imgRatio > rectRatio) { drawW = rect.width; drawH = rect.width / imgRatio; drawX = 0; drawY = (rect.height - drawH) / 2; } else { drawH = rect.height; drawW = rect.height * imgRatio; drawY = 0; drawX = (rect.width - drawW) / 2; } const toScreen = (p) => ({ x: (p.x / canvas.width) * drawW + drawX + canvas.offsetLeft, y: (p.y / canvas.height) * drawH + drawY + canvas.offsetTop }); const screenPoints = cropPoints.map(toScreen); handles.forEach((id, i) => { const el = document.getElementById(id); el.style.left = screenPoints[i].x + 'px'; el.style.top = screenPoints[i].y + 'px'; }); const svg = document.getElementById('crop-lines'); svg.style.left = canvas.offsetLeft + 'px'; svg.style.top = canvas.offsetTop + 'px'; svg.style.width = canvas.offsetWidth + 'px'; svg.style.height = canvas.offsetHeight + 'px'; const toSvg = (p) => ({ x: (p.x / canvas.width) * drawW + drawX, y: (p.y / canvas.height) * drawH + drawY }); const svgPts = cropPoints.map(toSvg); const ptsStr = svgPts.map(p => `${p.x},${p.y}`).join(' '); svg.innerHTML = `<polyline points="${ptsStr} ${svgPts[0].x},${svgPts[0].y}" style="fill:rgba(255,255,255,0.2);stroke:#ff4081;stroke-width:2;stroke-dasharray:5" />`; }
function processImageForAI(sourceCanvas) { const MAX_WIDTH = 1600; let w = sourceCanvas.width; let h = sourceCanvas.height; if (w > MAX_WIDTH || h > MAX_WIDTH) { if (w > h) { h *= MAX_WIDTH / w; w = MAX_WIDTH; } else { w *= MAX_WIDTH / h; h = MAX_WIDTH; } } const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; const ctx = canvas.getContext('2d'); ctx.drawImage(sourceCanvas, 0, 0, w, h); return canvas.toDataURL('image/jpeg', 0.9); }
function performPerspectiveCrop(sourceCanvas, points) { const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x)); const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y)); let w = maxX - minX, h = maxY - minY; if (w < 1) w = 1; if (h < 1) h = 1; const tempCv = document.createElement('canvas'); tempCv.width = w; tempCv.height = h; const ctx = tempCv.getContext('2d'); ctx.drawImage(sourceCanvas, minX, minY, w, h, 0, 0, w, h); return processImageForAI(tempCv).split(',')[1]; }
window.handleFileUpload = async (file) => { if (isAnalyzing || !file) return; document.getElementById('upload-controls').classList.add('hidden'); document.getElementById('cropper-modal').classList.remove('hidden'); const canvas = document.getElementById('crop-canvas'); canvas.style.opacity = '0'; const reader = new FileReader(); reader.onload = async (e) => { cropImg = new Image(); cropImg.onload = async () => { const w = cropImg.width; const h = cropImg.height; cropPoints = [ { x: w * 0.1, y: h * 0.1 }, { x: w * 0.9, y: h * 0.1 }, { x: w * 0.9, y: h * 0.9 }, { x: w * 0.1, y: h * 0.9 } ]; canvas.style.opacity = '1'; updateNellMessage("ここを読み取るにゃ？", "normal"); initCustomCropper(); }; cropImg.src = e.target.result; }; reader.readAsDataURL(file); };