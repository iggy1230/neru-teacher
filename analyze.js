// --- analyze.js (完全版 v272.1: 関数定義漏れ修正・エラー対策版) ---

// グローバル変数
window.isAnalyzing = false;
window.isNellSpeaking = false;
window.transcribedProblems = []; // 宿題分析用
window.selectedProblem = null;
window.currentMode = '';
window.currentSubject = '';
window.lunchCount = 0;

let liveSocket = null;
let audioContext = null;
let mediaStream = null;
let workletNode = null;
let nextStartTime = 0;
let chatTranscript = "";
let subtitleTimer = null;

// 音声再生用キュー・制御
let stopSpeakingTimer = null;
let speakingStartTimer = null;

// ==========================================
// ★重要: ネル先生のメッセージ更新関数 (復活)
// ==========================================
window.updateNellMessage = async function(text, mood = "normal", save = false, speak = true) {
    // 画面の吹き出しを更新
    const el = document.getElementById('nell-text');
    if (el) el.innerText = text;
    
    const gameText = document.getElementById('nell-text-game');
    if (gameText) gameText.innerText = text;

    // Live Chat接続中は、ここでのTTS（読み上げ）は行わない（二重再生防止）
    if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
        speak = false;
    }

    // 必要なら喋らせる
    if (speak && typeof speakNell === 'function') {
        // テキストからタグなどを除去して読み上げ
        let cleanText = text.replace(/【.*?】/g, "").replace(/\[.*?\]/g, "").trim();
        if (cleanText) speakNell(cleanText, mood);
    }
};

// ==========================================
// 1. Live Chat 開始
// ==========================================
window.startLiveChat = async function() {
    const btn = document.getElementById('mic-btn');
    // すでに接続中なら切断処理へ
    if (liveSocket) { 
        window.stopLiveChat(); 
        return; 
    }

    try {
        if (btn) btn.disabled = true;
        window.updateNellMessage("ネル先生を呼んでるにゃ…", "thinking");

        // ★AudioContext 完全リセット
        if (audioContext) { try{ await audioContext.close(); }catch(e){} }
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        await audioContext.resume();
        nextStartTime = audioContext.currentTime;

        // WebSocket接続
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        // currentUserが未定義の場合はデフォルト値を使用
        const uName = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.name : "生徒";
        const uGrade = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.grade : "1";
        
        const url = `${proto}//${location.host}?grade=${uGrade}&name=${encodeURIComponent(uName)}`;
        liveSocket = new WebSocket(url);

        liveSocket.onopen = async () => {
            let context = "";
            if (window.NellMemory && typeof currentUser !== 'undefined' && currentUser) {
                context = await window.NellMemory.generateContextString(currentUser.id);
            }
            liveSocket.send(JSON.stringify({ type: "init", context }));
        };

        // ★最重要: 受信処理
        liveSocket.onmessage = async (event) => {
            try {
                let raw = event.data;
                if (raw instanceof Blob) raw = await raw.text();
                const data = JSON.parse(raw);

                // 接続完了
                if (data.type === "server_ready") {
                    if(btn) {
                        btn.innerText = "🔴 つながった！(終了)";
                        btn.style.background = "#ff5252";
                        btn.disabled = false;
                    }
                    window.updateNellMessage("お待たせ！何でも話してにゃ！", "happy", false, false); // ここではTTSしない
                    startMicrophone(); // マイク開始
                    return;
                }

                // 図鑑登録ツール通知
                if (data.type === "save_to_collection") {
                    if (window.NellMemory && typeof currentUser !== 'undefined' && currentUser) {
                        window.NellMemory.updateLatestCollectionItem(currentUser.id, data.itemName);
                    }
                    showSubtitle(`📖 図鑑に「${data.itemName}」を登録したにゃ！`);
                }

                // コンテンツ受信 (音声 & テキスト)
                const content = data.serverContent;
                if (content && content.modelTurn && content.modelTurn.parts) {
                    for (const part of content.modelTurn.parts) {
                        // A. 音声データ
                        if (part.inlineData && part.inlineData.mimeType.startsWith("audio")) {
                            playPcm(part.inlineData.data);
                        }
                        // B. テキストデータ (字幕)
                        if (part.text) {
                            showSubtitle(part.text);
                            chatTranscript += part.text;
                        }
                    }
                }

                // 割り込み (Interruption)
                if (content && content.interrupted) {
                    stopAudioQueue();
                }

            } catch (e) { console.error("WS Parse Error:", e); }
        };

        liveSocket.onclose = (e) => {
            window.stopLiveChat();
            if (e.code !== 1000) window.updateNellMessage("回線が切れちゃったにゃ。もう一度押してにゃ。", "thinking");
        };

        liveSocket.onerror = (e) => {
            console.error("Socket Error:", e);
            window.stopLiveChat();
        };

    } catch (e) {
        console.error("Connection Error:", e);
        window.stopLiveChat();
    }
};

// 2. 終了処理
window.stopLiveChat = function() {
    if (window.NellMemory && typeof currentUser !== 'undefined' && currentUser && chatTranscript.length > 5) {
        window.NellMemory.updateProfileFromChat(currentUser.id, chatTranscript);
    }
    
    if (liveSocket) { liveSocket.onclose = null; liveSocket.close(); liveSocket = null; }
    if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
    if (workletNode) { workletNode.disconnect(); workletNode = null; }
    if (audioContext) { audioContext.close(); audioContext = null; }

    const btn = document.getElementById('mic-btn');
    if(btn) {
        btn.innerText = "🎤 おはなしする";
        btn.style.background = "#ff85a1";
        btn.disabled = false;
    }
    const btnSimple = document.getElementById('mic-btn-simple');
    if(btnSimple) {
        btnSimple.innerText = "🎤 おはなしする";
        btnSimple.style.background = "#66bb6a";
        btnSimple.disabled = false;
    }

    const vidContainer = document.getElementById('live-chat-video-container');
    if (vidContainer) vidContainer.style.display = 'none';
    
    chatTranscript = "";
    stopAudioQueue();
};

// 3. マイク入力 (AudioWorklet)
async function startMicrophone() {
    try {
        // マイク取得 (エコーキャンセル有効化)
        mediaStream = await navigator.mediaDevices.getUserMedia({ 
            audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true },
            video: (currentMode === 'chat') // チャットモードならカメラも
        });
        
        // カメラ映像表示
        if (currentMode === 'chat') {
            const vid = document.getElementById('live-chat-video');
            const vidContainer = document.getElementById('live-chat-video-container');
            if (vid && vidContainer) {
                vid.srcObject = mediaStream;
                vidContainer.style.display = 'block';
            }
        }

        // Worklet登録 (重複回避)
        try {
            const blob = new Blob([`class P extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(2048);this.i=0}process(i,o,p){const c=i[0];if(c&&c.length>0){for(let j=0;j<c.length;j++){this.b[this.i++]=c[j];if(this.i>=2048){this.port.postMessage(this.b);this.i=0}}}return true}}registerProcessor('p',P)`], {type:'application/javascript'});
            await audioContext.audioWorklet.addModule(URL.createObjectURL(blob));
        } catch(e) {} // 登録済みなら無視

        const source = audioContext.createMediaStreamSource(mediaStream);
        workletNode = new AudioWorkletNode(audioContext, 'p');
        source.connect(workletNode);

        workletNode.port.onmessage = (e) => {
            if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
                // PCM Float32 -> Base64 (16bit PCM)
                const f32 = e.data;
                const i16 = new Int16Array(f32.length);
                for(let i=0; i<f32.length; i++) i16[i] = Math.max(-1, Math.min(1, f32[i])) * 0x7FFF;
                const b64 = btoa(String.fromCharCode(...new Uint8Array(i16.buffer)));
                liveSocket.send(JSON.stringify({ base64Audio: b64 }));
            }
        };
    } catch(e) { 
        alert("マイクが使えないにゃ... 設定を確認してね。"); 
        console.error(e);
        window.stopLiveChat(); 
    }
}

// 4. 音声再生 (PCM)
function playPcm(base64) {
    if (!audioContext) return;
    const bin = atob(base64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    const i16 = new Int16Array(bytes.buffer);
    const f32 = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768.0;

    const buffer = audioContext.createBuffer(1, f32.length, 24000); // 24kHz
    buffer.copyToChannel(f32, 0);

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    
    // スケジューリング
    const now = audioContext.currentTime;
    if (nextStartTime < now) nextStartTime = now;
    source.start(nextStartTime);
    nextStartTime += buffer.duration;

    // 口パク制御
    window.isNellSpeaking = true;
    source.onended = () => {
        if (audioContext && audioContext.currentTime >= nextStartTime - 0.1) {
            window.isNellSpeaking = false;
        }
    };
}

function stopAudioQueue() {
    if(audioContext) nextStartTime = audioContext.currentTime;
    window.isNellSpeaking = false;
}

// 5. 字幕表示 (軽量版)
function showSubtitle(text) {
    // [DISPLAY: ...] などのタグ除去
    let clean = text.replace(/\[.*?\]/g, "").replace(/【.*?】/g, "").trim();
    if (!clean) return;

    let el = document.getElementById('nell-subtitle');
    if (!el) {
        el = document.createElement('div');
        el.id = 'nell-subtitle';
        el.style.cssText = "position:fixed; bottom:130px; left:50%; transform:translateX(-50%); background:rgba(255,255,255,0.95); border:2px solid #ff85a1; color:#333; padding:10px 20px; border-radius:20px; font-weight:bold; font-size:1.1rem; z-index:9999; pointer-events:none; transition:opacity 0.2s; text-align:center; max-width:90%;";
        document.body.appendChild(el);
    }
    el.innerText += clean;
    el.style.opacity = 1;
    
    if (subtitleTimer) clearTimeout(subtitleTimer);
    subtitleTimer = setTimeout(() => {
        el.style.opacity = 0;
        setTimeout(() => el.innerText = "", 300);
    }, 3000);
}

// 6. 画像送信
window.captureAndSendLiveImage = function() {
    if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) return alert("おはなしボタンを押してにゃ！");
    
    const v = document.getElementById('live-chat-video');
    if(!v) return alert("カメラが動いてないにゃ...");

    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    const b64 = c.toDataURL('image/jpeg', 0.6).split(',')[1];

    liveSocket.send(JSON.stringify({ base64Image: b64 }));
    showSubtitle("📷 (じーっ...)");
    
    // 図鑑用に仮保存
    window.lastSentCollectionImage = c.toDataURL('image/jpeg', 0.6);
    if (window.NellMemory && typeof currentUser !== 'undefined' && currentUser) {
        window.NellMemory.addToCollection(currentUser.id, "🔍 解析中...", window.lastSentCollectionImage);
    }
};

// ==========================================
// UI連携・初期化 (エラー対策)
// ==========================================

// ★修正: async関数にしてPromiseを返すように変更 (ui.jsでの.catchエラー対策)
window.initAudioContext = async function() { 
    // ここはダミー定義でOK（startLiveChatで本番を作るため）
    // ユーザー操作時のエラー回避のためにPromise解決だけしておく
    return Promise.resolve(); 
};

// モード切替
window.selectMode = function(m) { 
    currentMode = m;
    window.switchScreen('screen-main');
    
    const chatView = document.getElementById('chat-view');
    const simpleChatView = document.getElementById('simple-chat-view');
    const otherViews = ['subject-selection-view', 'upload-controls', 'thinking-view', 'problem-selection-view', 'final-view', 'chalkboard', 'lunch-view', 'grade-sheet-container', 'hint-detail-container'];

    // 一旦全部隠す
    if(chatView) chatView.classList.add('hidden');
    if(simpleChatView) simpleChatView.classList.add('hidden');
    otherViews.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.classList.add('hidden');
    });

    if(m === 'chat') {
        if(chatView) chatView.classList.remove('hidden');
        window.updateNellMessage("「おはなしする」を押してね！", "happy");
    } else if(m === 'simple-chat') {
        if(simpleChatView) simpleChatView.classList.remove('hidden');
        window.updateNellMessage("今日はお話だけするにゃ？", "happy");
    } else {
        // 他のモード用の表示処理（簡易実装）
        if (m === 'explain' || m === 'grade') {
            const subjView = document.getElementById('subject-selection-view');
            if(subjView) subjView.classList.remove('hidden');
            window.updateNellMessage("どの教科にするのかにゃ？", "normal");
        }
    }
};

// 宿題分析開始 (ダミー)
window.startAnalysis = async function(b64) {
    window.updateNellMessage("まだ準備中だにゃ...", "thinking");
};

// ファイルアップロード (ダミー)
window.handleFileUpload = async function(file) {
    window.updateNellMessage("画像を受け取ったにゃ（準備中）", "happy");
};