// --- analyze.js (完全版 v285.0: バグ修正版) ---

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

// 履歴用配列の初期化 (最重要)
window.chatSessionHistory = [];

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

// プレビューカメラ用
let previewStream = null;

// ★ selectMode
window.selectMode = function(m) {
    try {
        console.log(`[UI] selectMode called: ${m}`);
        currentMode = m; 
        
        // 履歴をリセット
        window.chatSessionHistory = [];

        // 画面切り替え (ui.jsの関数)
        if (typeof window.switchScreen === 'function') {
            window.switchScreen('screen-main'); 
        } else {
            document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
            document.getElementById('screen-main').classList.remove('hidden');
        }

        // 各種ビューの表示リセット
        const ids = ['subject-selection-view', 'upload-controls', 'thinking-view', 'problem-selection-view', 'final-view', 'chalkboard', 'chat-view', 'simple-chat-view', 'chat-free-view', 'lunch-view', 'grade-sheet-container', 'hint-detail-container', 'embedded-chat-section'];
        ids.forEach(id => { 
            const el = document.getElementById(id); 
            if (el) el.classList.add('hidden'); 
        });
        
        // ログエリア
        document.getElementById('conversation-log').classList.add('hidden');
        document.getElementById('log-content').innerHTML = "";
        
        // 黒板リセット
        ['embedded-chalkboard', 'chalkboard-simple', 'chalkboard-free'].forEach(bid => {
            const embedBoard = document.getElementById(bid);
            if (embedBoard) {
                embedBoard.innerText = "";
                embedBoard.classList.add('hidden');
            }
        });

        // テキスト入力欄リセット
        ['embedded-text-input', 'simple-text-input', 'free-text-input'].forEach(iid => {
            const embedInput = document.getElementById(iid);
            if(embedInput) embedInput.value = "";
        });

        // 戻るボタン
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
            // ログ表示
            document.getElementById('conversation-log').classList.remove('hidden');
            startAlwaysOnListening();
        } 
        else if (m === 'simple-chat') {
            // ★ネル先生の個別指導 (HTTPモード)
            document.getElementById('simple-chat-view').classList.remove('hidden');
            window.updateNellMessage("今日はお話だけするにゃ？", "gentle", false);
            document.getElementById('conversation-log').classList.remove('hidden');
            startAlwaysOnListening();
        }
        else if (m === 'chat-free') {
            // ★放課後おしゃべりタイム (WebSocketモード)
            document.getElementById('chat-free-view').classList.remove('hidden');
            window.updateNellMessage("何でも話していいにゃ！", "happy", false);
            // WebSocketは常時聞き取りしない（マイクボタンで開始）
        }
        else if (m === 'lunch') { 
            document.getElementById('lunch-view').classList.remove('hidden'); 
            window.updateNellMessage("お腹ペコペコだにゃ……", "thinking", false); 
        } 
        else if (m === 'review') { 
            renderMistakeSelection(); 
            document.getElementById('embedded-chat-section').classList.remove('hidden'); 
            document.getElementById('conversation-log').classList.remove('hidden');
            startAlwaysOnListening();
        } 
        else { 
            const subjectView = document.getElementById('subject-selection-view'); 
            if (subjectView) subjectView.classList.remove('hidden'); 
            window.updateNellMessage("どの教科にするのかにゃ？", "normal", false); 
            if (m === 'explain' || m === 'grade') {
                document.getElementById('embedded-chat-section').classList.remove('hidden');
                document.getElementById('conversation-log').classList.remove('hidden');
                startAlwaysOnListening();
            }
        }
    } catch (e) {
        console.error("[UI] selectMode Error:", e);
        alert("エラーが発生したにゃ。再読み込みしてにゃ。");
    }
};

// ==========================================
// ★ 常時聞き取り機能 (HTTPチャット用)
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
        const text = event.results[0][0].transcript;
        if (!text || text.trim() === "") return;

        // ★割り込み判定
        const stopKeywords = ["違う", "ちがう", "待って", "まって", "ストップ", "やめて", "うるさい", "静か", "しずか"];
        const isStopCommand = stopKeywords.some(w => text.includes(w));
        const isLongEnough = text.length >= 10;

        if (window.isNellSpeaking) {
            if (isLongEnough || isStopCommand) {
                console.log("[Interruption] Stopping audio.");
                if (typeof window.cancelNellSpeech === 'function') window.cancelNellSpeech();
                // 停止命令自体は送信しない
                if (isStopCommand) return; 
            } else {
                return;
            }
        }
        
        console.log(`[User Said] ${text}`);
        continuousRecognition.stop();
        
        // 音声認識結果を表示（各モード対応）
        let targetId = 'user-speech-text-embedded';
        if (currentMode === 'simple-chat') targetId = 'user-speech-text-simple';
        
        const embeddedText = document.getElementById(targetId);
        if (embeddedText) embeddedText.innerText = text;

        // ログに追加
        addLogItem('user', text);
        // 履歴に追加
        addToSessionHistory('user', text);

        try {
            const res = await fetch('/chat-dialogue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    text: text, 
                    name: currentUser ? currentUser.name : "生徒",
                    history: window.chatSessionHistory 
                })
            });
            
            if(res.ok) {
                const data = await res.json();
                
                const speechText = data.speech || data.reply || "ごめんにゃ、よくわからなかったにゃ"; 
                addLogItem('nell', speechText);
                addToSessionHistory('nell', speechText);
                
                await window.updateNellMessage(speechText, "normal", true, true);
                
                // 黒板表示
                let boardId = 'embedded-chalkboard';
                if (currentMode === 'simple-chat') boardId = 'chalkboard-simple';
                const embedBoard = document.getElementById(boardId);
                
                if (embedBoard) {
                    if (data.board && data.board.trim() !== "") {
                        embedBoard.innerText = data.board;
                        embedBoard.classList.remove('hidden');
                    }
                }
            }
        } catch(e) {
            console.error("Chat Error:", e);
        } finally {
            // 対象モードなら再開
            if (isAlwaysListening && (currentMode === 'chat' || currentMode === 'explain' || currentMode === 'grade' || currentMode === 'review' || currentMode === 'simple-chat')) {
                try { continuousRecognition.start(); } catch(e){}
            }
        }
    };

    continuousRecognition.onend = () => {
        if (isAlwaysListening && (currentMode === 'chat' || currentMode === 'explain' || currentMode === 'grade' || currentMode === 'review' || currentMode === 'simple-chat') && !window.isNellSpeaking) {
            try { continuousRecognition.start(); } catch(e){}
        }
    };

    continuousRecognition.onerror = (event) => {
        if (event.error !== 'no-speech') {
            console.error("Rec Error:", event);
        }
        if (isAlwaysListening) {
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

// ログ管理
function addLogItem(role, text) {
    const container = document.getElementById('log-content');
    if (!container) return;
    const div = document.createElement('div');
    div.className = `log-item log-${role}`;
    const name = role === 'user' ? (currentUser ? currentUser.name : 'あなた') : 'ネル先生';
    div.innerHTML = `<span class="log-role">${name}:</span><span>${text}</span>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// ★修正: 履歴追加時の安全装置を追加
window.addToSessionHistory = function(role, text) {
    if (!window.chatSessionHistory) window.chatSessionHistory = []; // 安全装置
    window.chatSessionHistory.push({ role: role, text: text });
    if (window.chatSessionHistory.length > 10) {
        window.chatSessionHistory.shift();
    }
};

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
// 2. カメラ機能 (プレビュー・HTTP送信共通)
// ==========================================

// 引数でIDを指定できるように拡張
window.startPreviewCamera = async function(videoId = 'live-chat-video', containerId = 'live-chat-video-container') {
    const video = document.getElementById(videoId);
    const container = document.getElementById(containerId);
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
};

window.stopPreviewCamera = function() {
    if (previewStream) {
        previewStream.getTracks().forEach(t => t.stop());
        previewStream = null;
    }
    // 全ての可能性のあるビデオ要素を停止
    ['live-chat-video', 'live-chat-video-embedded', 'live-chat-video-simple', 'live-chat-video-free'].forEach(vid => {
        const v = document.getElementById(vid);
        if(v) v.srcObject = null;
    });
    ['live-chat-video-container', 'live-chat-video-container-embedded', 'live-chat-video-container-simple', 'live-chat-video-container-free'].forEach(cid => {
        const c = document.getElementById(cid);
        if(c) c.style.display = 'none';
    });
};

// 汎用テキスト送信
window.sendHttpText = async function(context) {
    let inputId, btnClass;
    if (context === 'embedded') { inputId = 'embedded-text-input'; btnClass = '.text-question-btn'; }
    else if (context === 'simple') { inputId = 'simple-text-input'; btnClass = '.text-question-btn'; }
    else return;

    const input = document.getElementById(inputId);
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    if (isAlwaysListening && continuousRecognition) {
        try { continuousRecognition.stop(); } catch(e){}
    }
    
    addLogItem('user', text);
    addToSessionHistory('user', text);

    try {
        window.updateNellMessage("ん？どれどれ…", "thinking", false, true);
        
        const res = await fetch('/chat-dialogue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                text: text, 
                name: currentUser ? currentUser.name : "生徒",
                history: window.chatSessionHistory
            })
        });

        if(res.ok) {
            const data = await res.json();
            const speechText = data.speech || data.reply || "教えてあげるにゃ！";
            addLogItem('nell', speechText);
            addToSessionHistory('nell', speechText);
            await window.updateNellMessage(speechText, "happy", true, true);
            
            let boardId = (context === 'embedded') ? 'embedded-chalkboard' : 'chalkboard-simple';
            const embedBoard = document.getElementById(boardId);
            if (embedBoard && data.board && data.board.trim() !== "") {
                embedBoard.innerText = data.board;
                embedBoard.classList.remove('hidden');
            }
            input.value = ""; 
        }
    } catch(e) {
        console.error("Text Chat Error:", e);
        window.updateNellMessage("ごめん、ちょっとわからなかったにゃ。", "thinking", false, true);
    } finally {
        if (isAlwaysListening) {
             try { continuousRecognition.start(); } catch(e){}
        }
    }
};

window.sendEmbeddedText = function() { sendHttpText('embedded'); }
window.sendSimpleText = function() { sendHttpText('simple'); }

// 汎用カメラトグル
window.toggleHttpCamera = function(context) {
    let videoId, containerId, btnId, activeColor;
    if (context === 'embedded') {
        videoId = 'live-chat-video-embedded'; containerId = 'live-chat-video-container-embedded'; btnId = 'live-camera-btn-embedded'; activeColor = '#66bb6a';
    } else if (context === 'simple') {
        videoId = 'live-chat-video-simple'; containerId = 'live-chat-video-container-simple'; btnId = 'live-camera-btn-simple'; activeColor = '#66bb6a';
    } else return;

    const btn = document.getElementById(btnId);
    
    if (previewStream && previewStream.active) {
        captureAndSendLiveImageHttp(context);
    } else {
        startPreviewCamera(videoId, containerId).then(() => {
            if (btn) {
                btn.innerHTML = "<span>📸</span> 撮影して送信";
                btn.style.backgroundColor = "#ff5252"; 
            }
        });
    }
};

window.toggleEmbeddedCamera = function() { toggleHttpCamera('embedded'); }
window.toggleSimpleCamera = function() { toggleHttpCamera('simple'); }

// ★追加: お宝カメラのトグル処理
window.toggleTreasureCamera = function() {
    const videoId = 'live-chat-video';
    const containerId = 'live-chat-video-container';
    const btnId = 'live-camera-btn';
    const btn = document.getElementById(btnId);
    
    if (previewStream && previewStream.active) {
        captureAndIdentifyItem();
    } else {
        startPreviewCamera(videoId, containerId).then(() => {
            if (btn) {
                btn.innerHTML = "<span>📸</span> 撮影する";
                btn.style.backgroundColor = "#ff5252"; 
            }
        });
    }
};

// ★修正: お宝画像加工処理（サイズ縮小 320px & JPEG圧縮）
function createTreasureImage(sourceCanvas) {
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
        
        stopPreviewCamera(); 
        if (btn) {
            btn.innerHTML = "<span>📷</span> お宝を見せる（図鑑登録）";
            btn.style.backgroundColor = "#ff85a1"; 
            btn.disabled = false;
        }
        
        if (isAlwaysListening && currentMode === 'chat') {
            try { continuousRecognition.start(); } catch(e){}
        }
    }
};

// ==========================================
// 3. その他共通機能
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
    // 宿題アップロード用のIDに合わせたリスナー設定
    const camIn = document.getElementById('hw-input-camera'); 
    const albIn = document.getElementById('hw-input-album'); 
    if(camIn) camIn.addEventListener('change', (e) => { handleFileUpload(e.target.files[0]); e.target.value=''; });
    if(albIn) albIn.addEventListener('change', (e) => { handleFileUpload(e.target.files[0]); e.target.value=''; });
    const startCamBtn = document.getElementById('start-webcam-btn');
    if (startCamBtn) startCamBtn.onclick = startHomeworkWebcam;
});

// 宿題用カメラ機能 (変更なし)
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
        
        window.updateNellMessage("今からネル先生が時間を計ってやるにゃ", "normal", false, true);

        studyTimerInterval = setInterval(() => {
            if (studyTimerValue > 0) {
                studyTimerValue--;
                studyTimerCheck++;
                updateTimerDisplay();
                
                if (studyTimerValue === 600) window.updateNellMessage("10分前だにゃ〜。お茶でも飲んで落ち着くにゃ。", "gentle", false, true);
                else if (studyTimerValue === 300) window.updateNellMessage("あと5分。一歩ずつ、一歩ずつだにゃ〜。", "normal", false, true);
                else if (studyTimerValue === 180) window.updateNellMessage("3分前。深呼吸して、もうひと踏ん張りだにゃ。", "excited", false, true);
                else if (studyTimerValue === 60) window.updateNellMessage("あと1分だにゃ。最後までネル先生が見守ってるにゃ。", "excited", false, true);
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

// ==========================================
// ★ WebSocket (chat-free用)
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
        if (currentMode === 'chat-free') context = 'free';
        else if (activeChatContext === 'embedded') context = 'embedded';
        else if (currentMode === 'simple-chat') context = 'simple';
    }
    
    // embedded/simpleモードの場合はWebSocketではなくHTTP送信
    if (context === 'embedded' || context === 'simple') {
        captureAndSendLiveImageHttp(context);
        return;
    }

    // chat-free (WebSocket) 用の処理
    if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) {
        return alert("まずは「おはなしする」でネル先生とつながってにゃ！");
    }
    if (window.isLiveImageSending) return; 
    let videoId = 'live-chat-video-free';
    const video = document.getElementById(videoId);
    if (!video || !video.srcObject || !video.srcObject.active) return alert("カメラが動いてないにゃ...");

    stopAudioPlayback();
    ignoreIncomingAudio = true; 
    window.isLiveImageSending = true;
    
    const btn = document.getElementById('live-camera-btn-free');
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

    const videoContainer = document.getElementById('live-chat-video-container-free');
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
             btn.innerHTML = "<span>📷</span> 写真を見せてお話";
             btn.style.backgroundColor = "#009688";
        }
    }, 3000);
    setTimeout(() => { ignoreIncomingAudio = false; }, 300);
};

// ★追加: 埋め込みチャット用 HTTP画像送信 (黒板表示対応)
async function captureAndSendLiveImageHttp(context = 'embedded') {
    if (window.isLiveImageSending) return;
    
    // 一時的に聞き取り停止
    if (isAlwaysListening && continuousRecognition) {
        try { continuousRecognition.stop(); } catch(e){}
    }
    
    let videoId, btnId, activeColor;
    if (context === 'embedded') { videoId = 'live-chat-video-embedded'; btnId = 'live-camera-btn-embedded'; activeColor = '#66bb6a'; }
    else if (context === 'simple') { videoId = 'live-chat-video-simple'; btnId = 'live-camera-btn-simple'; activeColor = '#66bb6a'; }

    const video = document.getElementById(videoId);
    if (!video || !video.srcObject || !video.srcObject.active) return alert("カメラが動いてないにゃ...");
    
    window.isLiveImageSending = true;
    const btn = document.getElementById(btnId);
    if (btn) {
        btn.innerHTML = "<span>📡</span> 送信中にゃ...";
        btn.style.backgroundColor = "#ccc";
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const base64Data = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
    
    // フラッシュ効果
    const flash = document.createElement('div');
    flash.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:white; opacity:0.8; z-index:9999; pointer-events:none; transition:opacity 0.3s;";
    document.body.appendChild(flash);
    setTimeout(() => { flash.style.opacity = 0; setTimeout(() => flash.remove(), 300); }, 50);

    // ログ記録
    addLogItem('user', '（画像送信）');

    try {
        window.updateNellMessage("ん？どれどれ…", "thinking", false, true);

        const res = await fetch('/chat-dialogue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                image: base64Data,
                text: "この問題を教えてください。", // 質問コンテキストを明確化
                name: currentUser ? currentUser.name : "生徒",
                history: window.chatSessionHistory
            })
        });

        if (!res.ok) throw new Error("Server response not ok");
        const data = await res.json();
        
        const speechText = data.speech || data.reply || "教えてあげるにゃ！";
        addLogItem('nell', speechText);
        addToSessionHistory('nell', speechText);
        await window.updateNellMessage(speechText, "happy", true, true);
        
        // 黒板に回答テキストを表示
        let boardId = (context === 'embedded') ? 'embedded-chalkboard' : 'chalkboard-simple';
        const embedBoard = document.getElementById(boardId);
        if (embedBoard && data.board && data.board.trim() !== "") {
            embedBoard.innerText = data.board;
            embedBoard.classList.remove('hidden');
        }

    } catch(e) {
        console.error("HTTP Image Error:", e);
        window.updateNellMessage("よく見えなかったにゃ…もう一回お願いにゃ！", "thinking", false, true);
    } finally {
        window.isLiveImageSending = false;
        
        stopPreviewCamera(); 
        if (btn) {
            btn.innerHTML = "<span>📷</span> カメラで見せて質問";
            btn.style.backgroundColor = activeColor;
        }
        
        // 聞き取り再開
        if (isAlwaysListening) {
             try { continuousRecognition.start(); } catch(e){}
        }
    }
}

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
    
    // chat-free用ボタンリセット
    const btn = document.getElementById('mic-btn-free');
    if (btn) { 
        btn.innerText = "🎤 おはなしする"; 
        btn.style.background = "#4db6ac"; 
        btn.disabled = false; 
        btn.onclick = () => startLiveChat('free');
    }

    liveSocket = null; 
    activeChatContext = null;
    streamTextBuffer = "";
    ttsTextBuffer = "";
    
    // カメラボタンリセット
    const camBtnSimple = document.getElementById('live-camera-btn-simple');
    if (camBtnSimple) { camBtnSimple.innerHTML = "<span>📷</span> カメラで見せて質問"; camBtnSimple.style.backgroundColor = "#66bb6a"; }
    const camBtnEmbedded = document.getElementById('live-camera-btn-embedded');
    if (camBtnEmbedded) { camBtnEmbedded.innerHTML = "<span>📷</span> カメラで見せて質問"; camBtnEmbedded.style.backgroundColor = "#66bb6a"; }
    const camBtnFree = document.getElementById('live-camera-btn-free');
    if (camBtnFree) { camBtnFree.innerHTML = "<span>📷</span> 写真を見せてお話"; camBtnFree.style.backgroundColor = "#009688"; }

    window.isLiveImageSending = false;
    window.isMicMuted = false; 

    const videoFree = document.getElementById('live-chat-video-free');
    if(videoFree) videoFree.srcObject = null;
    document.getElementById('live-chat-video-container-free').style.display = 'none';
};

async function startLiveChat(context = 'main') { 
    // chat-freeのみWebSocketを使用
    if (context === 'main' && currentMode === 'chat-free') context = 'free';
    
    if (context !== 'free') return;

    activeChatContext = context;
    const btnId = 'mic-btn-free';
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
        let modeParam = 'chat-free';

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
                        const el = document.getElementById('user-speech-text-free'); 
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
            let videoId = 'live-chat-video-free';
            let containerId = 'live-chat-video-container-free';
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

// Cropper
function initCustomCropper() { const modal = document.getElementById('cropper-modal'); modal.classList.remove('hidden'); const canvas = document.getElementById('crop-canvas'); const MAX_CANVAS_SIZE = 2500; let w = cropImg.width; let h = cropImg.height; if (w > MAX_CANVAS_SIZE || h > MAX_CANVAS_SIZE) { const scale = Math.min(MAX_CANVAS_SIZE / w, MAX_CANVAS_SIZE / h); w *= scale; h *= scale; cropPoints = cropPoints.map(p => ({ x: p.x * scale, y: p.y * scale })); } canvas.width = w; canvas.height = h; canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.objectFit = 'contain'; const ctx = canvas.getContext('2d'); ctx.drawImage(cropImg, 0, 0, w, h); updateCropUI(canvas); const handles = ['handle-tl', 'handle-tr', 'handle-br', 'handle-bl']; handles.forEach((id, idx) => { const el = document.getElementById(id); const startDrag = (e) => { e.preventDefault(); activeHandle = idx; }; el.onmousedown = startDrag; el.ontouchstart = startDrag; }); const move = (e) => { if (activeHandle === -1) return; e.preventDefault(); const rect = canvas.getBoundingClientRect(); const imgRatio = canvas.width / canvas.height; const rectRatio = rect.width / rect.height; let drawX, drawY, drawW, drawH; if (imgRatio > rectRatio) { drawW = rect.width; drawH = rect.width / imgRatio; drawX = 0; drawY = (rect.height - drawH) / 2; } else { drawH = rect.height; drawW = rect.height * imgRatio; drawY = 0; drawX = (rect.width - drawW) / 2; } const clientX = e.touches ? e.touches[0].clientX : e.clientX; const clientY = e.touches ? e.touches[0].clientY : e.clientY; let relX = (clientX - rect.left - drawX) / drawW; let relY = (clientY - rect.top - drawY) / drawH; relX = Math.max(0, Math.min(1, relX)); relY = Math.max(0, Math.min(1, relY)); cropPoints[activeHandle] = { x: relX * canvas.width, y: relY * canvas.height }; updateCropUI(canvas); }; const end = () => { activeHandle = -1; }; window.onmousemove = move; window.ontouchmove = move; window.onmouseup = end; window.ontouchend = end; document.getElementById('cropper-cancel-btn').onclick = () => { modal.classList.add('hidden'); window.onmousemove = null; window.ontouchmove = null; document.getElementById('upload-controls').classList.remove('hidden'); }; document.getElementById('cropper-ok-btn').onclick = () => { modal.classList.add('hidden'); window.onmousemove = null; window.ontouchmove = null; const croppedBase64 = performPerspectiveCrop(canvas, cropPoints); startAnalysis(croppedBase64); }; }
function updateCropUI(canvas) { const handles = ['handle-tl', 'handle-tr', 'handle-br', 'handle-bl']; const rect = canvas.getBoundingClientRect(); const imgRatio = canvas.width / canvas.height; const rectRatio = rect.width / rect.height; let drawX, drawY, drawW, drawH; if (imgRatio > rectRatio) { drawW = rect.width; drawH = rect.width / imgRatio; drawX = 0; drawY = (rect.height - drawH) / 2; } else { drawH = rect.height; drawW = rect.height * imgRatio; drawY = 0; drawX = (rect.width - drawW) / 2; } const toScreen = (p) => ({ x: (p.x / canvas.width) * drawW + drawX + canvas.offsetLeft, y: (p.y / canvas.height) * drawH + drawY + canvas.offsetTop }); const screenPoints = cropPoints.map(toScreen); handles.forEach((id, i) => { const el = document.getElementById(id); el.style.left = screenPoints[i].x + 'px'; el.style.top = screenPoints[i].y + 'px'; }); const svg = document.getElementById('crop-lines'); svg.style.left = canvas.offsetLeft + 'px'; svg.style.top = canvas.offsetTop + 'px'; svg.style.width = canvas.offsetWidth + 'px'; svg.style.height = canvas.offsetHeight + 'px'; const toSvg = (p) => ({ x: (p.x / canvas.width) * drawW + drawX, y: (p.y / canvas.height) * drawH + drawY }); const svgPts = cropPoints.map(toSvg); const ptsStr = svgPts.map(p => `${p.x},${p.y}`).join(' '); svg.innerHTML = `<polyline points="${ptsStr} ${svgPts[0].x},${svgPts[0].y}" style="fill:rgba(255,255,255,0.2);stroke:#ff4081;stroke-width:2;stroke-dasharray:5" />`; }
function processImageForAI(sourceCanvas) { const MAX_WIDTH = 1600; let w = sourceCanvas.width; let h = sourceCanvas.height; if (w > MAX_WIDTH || h > MAX_WIDTH) { if (w > h) { h *= MAX_WIDTH / w; w = MAX_WIDTH; } else { w *= MAX_WIDTH / h; h = MAX_WIDTH; } } const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; const ctx = canvas.getContext('2d'); ctx.drawImage(sourceCanvas, 0, 0, w, h); return canvas.toDataURL('image/jpeg', 0.9); }
function performPerspectiveCrop(sourceCanvas, points) { const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x)); const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y)); let w = maxX - minX, h = maxY - minY; if (w < 1) w = 1; if (h < 1) h = 1; const tempCv = document.createElement('canvas'); tempCv.width = w; tempCv.height = h; const ctx = tempCv.getContext('2d'); ctx.drawImage(sourceCanvas, minX, minY, w, h, 0, 0, w, h); return processImageForAI(tempCv).split(',')[1]; }
window.handleFileUpload = async (file) => { if (isAnalyzing || !file) return; document.getElementById('upload-controls').classList.add('hidden'); document.getElementById('cropper-modal').classList.remove('hidden'); const canvas = document.getElementById('crop-canvas'); canvas.style.opacity = '0'; const reader = new FileReader(); reader.onload = async (e) => { cropImg = new Image(); cropImg.onload = async () => { const w = cropImg.width; const h = cropImg.height; cropPoints = [ { x: w * 0.1, y: h * 0.1 }, { x: w * 0.9, y: h * 0.1 }, { x: w * 0.9, y: h * 0.9 }, { x: w * 0.1, y: h * 0.9 } ]; canvas.style.opacity = '1'; updateNellMessage("ここを読み取るにゃ？", "normal"); initCustomCropper(); }; cropImg.src = e.target.result; }; reader.readAsDataURL(file); };