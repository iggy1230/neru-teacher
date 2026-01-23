// --- analyze.js (v272.0: リセット＆字幕・音声両立版) ---

// グローバル
window.isAnalyzing = false;
window.isNellSpeaking = false;
let liveSocket = null;
let audioContext = null;
let mediaStream = null;
let workletNode = null;
let nextStartTime = 0;
let chatTranscript = "";
let subtitleTimer = null;

// 音声再生用キュー
let audioQueue = [];
let isPlayingQueue = false;

// 1. Live Chat 開始
window.startLiveChat = async function() {
    const btn = document.getElementById('mic-btn');
    if (liveSocket) { window.stopLiveChat(); return; }

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
        const url = `${proto}//${location.host}?grade=${currentUser.grade}&name=${encodeURIComponent(currentUser.name)}`;
        liveSocket = new WebSocket(url);

        liveSocket.onopen = async () => {
            const context = await window.NellMemory.generateContextString(currentUser.id);
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
                    window.updateNellMessage("お待たせ！何でも話してにゃ！", "happy");
                    startMicrophone(); // マイク開始
                    return;
                }

                // 図鑑登録ツール
                if (data.type === "save_to_collection") {
                    window.NellMemory.updateLatestCollectionItem(currentUser.id, data.itemName);
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
            if (e.code !== 1000) alert("回線が切れちゃったにゃ。もう一度押してにゃ。");
        };

    } catch (e) {
        console.error("Connection Error:", e);
        window.stopLiveChat();
    }
};

// 2. 終了処理
window.stopLiveChat = function() {
    if (chatTranscript.length > 5) window.NellMemory.updateProfileFromChat(currentUser.id, chatTranscript);
    
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
    document.getElementById('live-chat-video-container').style.display = 'none';
    chatTranscript = "";
    stopAudioQueue();
};

// 3. マイク入力 (AudioWorklet)
async function startMicrophone() {
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } });
        
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
                // PCM Float32 -> Base64
                const f32 = e.data;
                const i16 = new Int16Array(f32.length);
                for(let i=0; i<f32.length; i++) i16[i] = Math.max(-1, Math.min(1, f32[i])) * 0x7FFF;
                const b64 = btoa(String.fromCharCode(...new Uint8Array(i16.buffer)));
                liveSocket.send(JSON.stringify({ base64Audio: b64 }));
            }
        };
    } catch(e) { alert("マイクが使えないにゃ..."); window.stopLiveChat(); }
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
    let el = document.getElementById('nell-subtitle');
    if (!el) {
        el = document.createElement('div');
        el.id = 'nell-subtitle';
        el.style.cssText = "position:fixed; bottom:130px; left:50%; transform:translateX(-50%); background:rgba(255,255,255,0.95); border:2px solid #ff85a1; color:#333; padding:10px 20px; border-radius:20px; font-weight:bold; font-size:1.1rem; z-index:9999; pointer-events:none; transition:opacity 0.2s; text-align:center; max-width:90%;";
        document.body.appendChild(el);
    }
    el.innerText += text;
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
    if(!v) return;

    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    const b64 = c.toDataURL('image/jpeg', 0.6).split(',')[1];

    liveSocket.send(JSON.stringify({ base64Image: b64 }));
    showSubtitle("📷 (じーっ...)");
};

// 7. 初期化
window.startAnalysis = async function(b64) { /* 従来通り */ }; // 必要なら既存コードを維持
window.selectMode = function(m) { /* 既存コード維持 */ 
    currentMode = m;
    window.switchScreen('screen-main');
    if(m === 'chat') {
        document.getElementById('chat-view').classList.remove('hidden');
        window.updateNellMessage("「おはなしする」を押してね！", "happy");
    } else {
        // 他のモードの表示処理
        document.getElementById('chat-view').classList.add('hidden');
    }
};

// カメラ起動
window.initAudioContext = function() { /* 空定義（startLiveChat内でやるので） */ };