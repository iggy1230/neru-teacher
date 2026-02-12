// --- js/voice-service.js (v431.0: 常時聞き取り廃止・ボタン送信最適化版) ---

// ==========================================
// 音声再生・停止
// ==========================================
window.stopAudioPlayback = function() {
    window.liveAudioSources.forEach(source => { try { source.stop(); } catch(e){} });
    window.liveAudioSources = [];
    if (window.audioContext && window.audioContext.state === 'running') window.nextStartTime = window.audioContext.currentTime + 0.05;
    window.isNellSpeaking = false;
    if(window.stopSpeakingTimer) clearTimeout(window.stopSpeakingTimer);
    if(window.speakingStartTimer) clearTimeout(window.speakingStartTimer);
    if (window.cancelNellSpeech) window.cancelNellSpeech();
};

function shouldInterrupt(text) {
    if (!text) return false;
    const cleanText = text.trim();
    if (cleanText.length === 0) return false;
    
    let currentNellText = "";
    const nellTextEl = document.getElementById('nell-text') || document.getElementById('nell-text-game') || document.getElementById('nell-text-quiz') || document.getElementById('nell-text-riddle') || document.getElementById('nell-text-minitest');
    if (nellTextEl) {
        currentNellText = nellTextEl.innerText.replace(/\s+/g, "");
    }

    const cleanInput = cleanText.replace(/\s+/g, "");
    if (currentNellText.length > 0 && currentNellText.includes(cleanInput)) {
        return false; 
    }

    const stopKeywords = [
        "違う", "ちがう", "待って", "まって", "ストップ", "やめて", "うるさい", "静か", "しずか",
        "ねえ", "ちょっと", "あの", "先生", "せんせい", "あのね", "stop", "wait"
    ];
    
    const isStopCommand = stopKeywords.some(w => cleanText.includes(w));
    const isLongEnough = cleanText.length >= 15;
    
    return isStopCommand || isLongEnough;
}

function isSelfEcho(text) {
    if (!text) return false;
    let currentNellText = "";
    const ids = ['nell-text', 'nell-text-game', 'nell-text-quiz', 'nell-text-riddle', 'nell-text-minitest'];
    for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.offsetParent !== null) {
            currentNellText = el.innerText.replace(/\s+/g, "");
            break; 
        }
    }
    
    const cleanInput = text.replace(/\s+/g, "");
    if (currentNellText.length > 0) {
        if (currentNellText.includes(cleanInput) || cleanInput.includes(currentNellText)) {
            return true;
        }
    }
    return false;
}

// ==========================================
// 音声入力 (ブラウザ標準STT - 単発聞き取り)
// ==========================================

window.isSpeechRecognitionRunning = false;

// ボタンを押した時だけ呼ばれる音声入力（常時ではない）
window.startVoiceInput = function(context) {
    if (!('webkitSpeechRecognition' in window)) {
        return alert("このブラウザは音声入力に対応していないにゃ。キーボードを使ってにゃ。");
    }
    
    if (window.isSpeechRecognitionRunning) return; // 二重起動防止

    // WebSocketモード中はHTTPチャットのSTTをブロック
    if (window.liveSocket && window.liveSocket.readyState === WebSocket.OPEN) return;

    window.isSpeechRecognitionRunning = true;
    const recognition = new webkitSpeechRecognition();
    recognition.lang = 'ja-JP';
    recognition.interimResults = false; // 確定した結果のみ受け取る
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
        if (typeof window.updateNellMessage === 'function') {
            window.updateNellMessage("聞いてるにゃ！お話ししてにゃ。", "happy", false, false);
        }
    };

    recognition.onresult = async (event) => {
        const text = event.results[0][0].transcript;
        if (!text) return;

        // エコーキャンセルチェック（自分やネル先生の声）
        if (isSelfEcho(text)) return;

        // 入力欄に反映して送信処理へ
        if (context === 'embedded') {
            const input = document.getElementById('embedded-text-input');
            if(input) { input.value = text; window.sendHttpText('embedded'); }
        } else if (context === 'simple') {
            const input = document.getElementById('simple-text-input');
            if(input) { input.value = text; window.sendHttpText('simple'); }
        } else if (window.currentMode === 'quiz' && typeof window.checkQuizAnswer === 'function') {
            // クイズ回答用
            window.checkQuizAnswer(text);
        } else if (window.currentMode === 'kanji' && typeof window.checkKanjiReading === 'function') {
            // 漢字読み回答用
            window.checkKanjiReading(text);
        } else if (window.currentMode === 'riddle' && typeof window.checkRiddleAnswer === 'function') {
            // なぞなぞ回答用
            window.checkRiddleAnswer(text);
        }
    };

    recognition.onend = () => {
        window.isSpeechRecognitionRunning = false;
    };

    recognition.onerror = (event) => {
        console.error("Speech Recognition Error:", event.error);
        window.isSpeechRecognitionRunning = false;
    };

    recognition.start();
};

// ★重要: 古い「常時聞き取り」関数を無効化してコストを節約
window.startAlwaysOnListening = function() {
    // console.log("Always-on listening is disabled for cost optimization.");
    window.isAlwaysListening = false;
    if (window.continuousRecognition) {
        try { window.continuousRecognition.stop(); } catch(e){}
        window.continuousRecognition = null;
    }
};

window.stopAlwaysOnListening = function() {
    window.isAlwaysListening = false;
    if (window.continuousRecognition) {
        try { window.continuousRecognition.stop(); } catch(e){}
        window.continuousRecognition = null;
    }
};

// ==========================================
// リアルタイムチャット (WebSocket - Gemini Realtime API用)
// ※「おはなしする」モード専用。こちらは接続中は音声を送り続けますが、ボタンで切断可能
// ==========================================

window.stopLiveChat = function() {
    if (window.NellMemory && window.chatTranscript && window.chatTranscript.length > 10 && typeof currentUser !== 'undefined') {
        window.NellMemory.updateProfileFromChat(currentUser.id, window.chatTranscript);
    }
    window.isRecognitionActive = false; 
    window.isLiveChatManuallyStopped = true;

    if (window.connectionTimeout) clearTimeout(window.connectionTimeout); 
    
    if (window.mediaStream) window.mediaStream.getTracks().forEach(t=>t.stop()); 
    if (window.workletNode) { 
        try { window.workletNode.port.postMessage('stop'); } catch(e){}
        try { window.workletNode.disconnect(); } catch(e){}
    } 
    if (window.liveSocket) {
        window.liveSocket.close(); 
    }
    if (window.audioContext && window.audioContext.state !== 'closed') {
        window.audioContext.close(); 
    }
    window.audioContext = null;
    window.audioCtx = null; 

    window.isNellSpeaking = false; 
    if(window.stopSpeakingTimer) clearTimeout(window.stopSpeakingTimer); 
    if(window.speakingStartTimer) clearTimeout(window.speakingStartTimer); 
    
    const btn = document.getElementById('mic-btn-free');
    if (btn) { 
        btn.innerText = "🎤 おはなしする"; 
        btn.style.background = "#4db6ac"; 
        btn.disabled = false; 
        btn.onclick = () => window.startLiveChat('free');
    }

    window.liveSocket = null; 
    window.activeChatContext = null;
    window.streamTextBuffer = "";
    window.ttsTextBuffer = "";
    
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

window.startLiveChat = async function(context = 'main') { 
    if (context === 'main' && window.currentMode === 'chat-free') context = 'free';
    if (context !== 'free') return;

    window.stopAlwaysOnListening();
    window.isLiveChatManuallyStopped = false;
    window.activeChatContext = context;
    const btnId = 'mic-btn-free';
    const btn = document.getElementById(btnId);
    
    if (window.liveSocket) { 
        window.liveSocket.close();
    } 
    
    try { 
        if(typeof window.updateNellMessage === 'function') window.updateNellMessage("ネル先生を呼んでるにゃ…", "thinking", false); 
        if(btn) btn.disabled = true; 
        
        let memoryContext = "";
        if (window.NellMemory) {
            memoryContext = await window.NellMemory.generateContextString(currentUser.id);
        }
        
        window.chatTranscript = ""; 
        window.streamTextBuffer = "";
        window.ttsTextBuffer = "";
        
        if (window.initAudioContext) await window.initAudioContext(); 
        
        // ★修正: AudioContext作成時にサンプリングレートを指定（16000Hz推奨）
        if (!window.audioContext) {
             const AudioContext = window.AudioContext || window.webkitAudioContext;
             try {
                 window.audioContext = new AudioContext({ sampleRate: 16000 });
             } catch(e) {
                 // オプション指定がサポートされていない場合のフォールバック
                 window.audioContext = new AudioContext();
             }
        } else if (window.audioContext && window.audioContext.state === 'closed') {
             // 閉じていたら作り直す
             const AudioContext = window.AudioContext || window.webkitAudioContext;
             try {
                 window.audioContext = new AudioContext({ sampleRate: 16000 });
             } catch(e) {
                 window.audioContext = new AudioContext();
             }
        }
        
        if (window.audioContext.state === 'suspended') {
            await window.audioContext.resume(); 
        }
        window.nextStartTime = window.audioContext.currentTime; 
        
        const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:'; 
        let statusSummary = `${currentUser.name}さんは今、お話しにきたにゃ。カリカリは${currentUser.karikari}個持ってるにゃ。`; 
        
        if (window.currentAddress) {
            statusSummary += ` 現在地は${window.currentAddress}だにゃ。`;
        } else if (window.currentLocation) {
            statusSummary += ` 現在地は緯度${window.currentLocation.lat}、経度${window.currentLocation.lon}だにゃ。`;
        }

        let missingInfo = [];
        if (window.NellMemory) {
            try {
                const profile = await window.NellMemory.getUserProfile(currentUser.id);
                if (!profile.birthday) missingInfo.push("誕生日");
                if (!profile.likes || profile.likes.length === 0) missingInfo.push("好きなもの");
                if (!profile.weaknesses || profile.weaknesses.length === 0) missingInfo.push("苦手なもの");
            } catch(e) {}
        }
        if (missingInfo.length > 0) {
            statusSummary += `\n【重要】ユーザーの${missingInfo.join("、")}がまだ分かりません。会話の中で自然に聞いてみてください。`;
        }

        let modeParam = 'chat-free';

        const url = `${wsProto}//${location.host}?grade=${currentUser.grade}&name=${encodeURIComponent(currentUser.name)}&mode=${modeParam}`; 
        
        window.liveSocket = new WebSocket(url); 
        window.liveSocket.binaryType = "blob"; 
        
        window.connectionTimeout = setTimeout(() => { 
            if (window.liveSocket && window.liveSocket.readyState !== WebSocket.OPEN) { 
                if(typeof window.updateNellMessage === 'function') window.updateNellMessage("なかなかつながらないにゃ…", "thinking", false); 
                window.stopLiveChat(); 
            } 
        }, 10000); 
        
        window.lastSentCollectionImage = null;
        window.isLiveImageSending = false;

        window.liveSocket.onopen = () => { 
            window.liveSocket.send(JSON.stringify({
                type: "init",
                name: currentUser.name,
                grade: currentUser.grade,
                context: statusSummary + "\n" + memoryContext,
                mode: modeParam 
            }));
        }; 
        
        window.liveSocket.onmessage = async (event) => { 
            try { 
                let rawData = event.data;
                if (rawData instanceof Blob) rawData = await rawData.text();
                const data = JSON.parse(rawData);

                if (data.type === "gemini_closed") {
                    console.log("Gemini WS closed by server.");
                    return; 
                }

                if (data.type === "server_ready") {
                    clearTimeout(window.connectionTimeout); 
                    if(btn) { 
                        btn.innerText = "📞 つながった！(終了)"; 
                        btn.style.background = "#ff5252"; 
                        btn.disabled = false; 
                        btn.onclick = () => window.stopLiveChat();
                    } 
                    if(typeof window.updateNellMessage === 'function') window.updateNellMessage("お待たせ！なんでも話してにゃ！", "happy", false, false); 
                    window.isRecognitionActive = true; 
                    
                    window.startMicrophone(); 
                    return;
                }
                
                if (data.serverContent?.modelTurn?.parts) { 
                    data.serverContent.modelTurn.parts.forEach(p => { 
                        if (p.text) { 
                            window.streamTextBuffer += p.text;
                            if(typeof window.updateNellMessage === 'function') window.updateNellMessage(window.streamTextBuffer, "normal", false, false); 
                        } 
                        if (p.inlineData) window.playLivePcmAudio(p.inlineData.data); 
                    }); 
                }

                if (data.serverContent && data.serverContent.turnComplete) {
                    if(typeof window.saveToNellMemory === 'function') window.saveToNellMemory('nell', window.streamTextBuffer);
                    window.streamTextBuffer = "";
                }
            } catch (e) {} 
        }; 
        
        window.liveSocket.onclose = () => {
            console.log("WS Closed. Manual Stop:", window.isLiveChatManuallyStopped);
            if (!window.isLiveChatManuallyStopped) {
                if(typeof window.updateNellMessage === 'function') window.updateNellMessage("あれ？切れちゃったにゃ。つなぎ直すにゃ！", "thinking", false, false);
                if (window.mediaStream) window.mediaStream.getTracks().forEach(t=>t.stop());
                setTimeout(() => {
                    if (window.currentMode === 'chat-free') {
                        window.startLiveChat('free');
                    }
                }, 1500);
            } else {
                window.stopLiveChat();
            }
        }; 
        
        window.liveSocket.onerror = (e) => {
            console.error("WS Error:", e);
        }; 
        
    } catch (e) { 
        console.error("Start Live Chat Error:", e);
        window.stopLiveChat(); 
    } 
};

// WebSocketモード用 (Gemini Realtime APIへ音声送信)
window.startMicrophone = async function() { 
    try { 
        console.log("[VoiceService] Starting Microphone for WebSocket...");

        const useVideo = (window.currentMode !== 'chat-free');
        
        const constraints = {
            audio: {
                sampleRate: 16000,
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: useVideo ? { facingMode: "environment" } : false
        };

        window.mediaStream = await navigator.mediaDevices.getUserMedia(constraints); 
        
        if (useVideo) {
            let videoId = 'live-chat-video-free';
            let containerId = 'live-chat-video-container-free';
            const video = document.getElementById(videoId);
            if (video) {
                video.srcObject = window.mediaStream;
                video.play();
                document.getElementById(containerId).style.display = 'block';
            }
        }

        // バッファサイズ 4096 (0.25秒分)
        const processorCode = `
        class PcmProcessor extends AudioWorkletProcessor { 
            constructor() { 
                super(); 
                this.bufferSize = 4096; 
                this.buffer = new Float32Array(this.bufferSize); 
                this.index = 0; 
            } 
            process(inputs, outputs, parameters) { 
                const input = inputs[0]; 
                if (input && input.length > 0) { 
                    const channel = input[0]; 
                    for (let i = 0; i < channel.length; i++) { 
                        this.buffer[this.index++] = channel[i]; 
                        if (this.index >= this.bufferSize) { 
                            this.port.postMessage(this.buffer); 
                            this.index = 0; 
                        } 
                    } 
                } 
                return true; 
            } 
        } 
        registerProcessor('pcm-processor', PcmProcessor);`; 

        const blob = new Blob([processorCode], { type: 'application/javascript' }); 
        await window.audioContext.audioWorklet.addModule(URL.createObjectURL(blob)); 
        const source = window.audioContext.createMediaStreamSource(window.mediaStream); 
        window.workletNode = new AudioWorkletNode(window.audioContext, 'pcm-processor'); 
        source.connect(window.workletNode); 
        
        console.log("[VoiceService] AudioWorklet connected.");

        window.workletNode.port.onmessage = (event) => { 
            if (window.isMicMuted) return;
            if (!window.liveSocket || window.liveSocket.readyState !== WebSocket.OPEN) return; 
            
            if (window.isNellSpeaking) {
                return;
            }

            const float32Data = event.data;
            let sum = 0;
            for (let i = 0; i < float32Data.length; i += 8) { 
                sum += float32Data[i] * float32Data[i];
            }
            const rms = Math.sqrt(sum / (float32Data.length / 8));
            
            // ★ログ: 確認用
            if (Math.random() < 0.05) {
                console.log(`[Mic Input] RMS: ${rms.toFixed(5)}`);
            }

            // ★修正: 閾値を大幅に緩和 (0.005 -> 0.001)
            if (rms < 0.001) return; 

            const downsampled = window.downsampleBuffer(float32Data, window.audioContext.sampleRate, 16000); 
            const pcm16 = window.floatTo16BitPCM(downsampled);
            const base64 = window.arrayBufferToBase64(pcm16);
            
            window.liveSocket.send(JSON.stringify({ base64Audio: base64 })); 
        }; 
    } catch(e) {
        console.warn("Audio/Camera Error:", e);
        if(typeof window.updateNellMessage === 'function') {
            window.updateNellMessage("マイクが使えないみたいだにゃ...", "sad");
        }
    } 
};

window.playLivePcmAudio = function(base64) { 
    if (!window.audioContext || window.ignoreIncomingAudio) return; 
    // ここは再初期化せず、既存のコンテキストを使う
    if (window.audioContext.state === 'suspended') {
        window.audioContext.resume().catch(()=>{});
    }

    const binary = window.atob(base64); 
    const bytes = new Uint8Array(binary.length); 
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); 
    const float32 = new Float32Array(bytes.length / 2); 
    const view = new DataView(bytes.buffer); 
    for (let i = 0; i < float32.length; i++) float32[i] = view.getInt16(i * 2, true) / 32768.0; 
    const buffer = window.audioContext.createBuffer(1, float32.length, 24000); 
    buffer.copyToChannel(float32, 0); 
    const source = window.audioContext.createBufferSource(); 
    source.buffer = buffer; 
    
    if (window.masterGainNode) {
        source.connect(window.masterGainNode);
    } else {
        source.connect(window.audioContext.destination);
    }
    
    window.liveAudioSources.push(source);
    source.onended = () => { window.liveAudioSources = window.liveAudioSources.filter(s => s !== source); };
    const now = window.audioContext.currentTime; 
    if (window.nextStartTime < now) window.nextStartTime = now; 
    source.start(window.nextStartTime); 
    const startDelay = (window.nextStartTime - now) * 1000; 
    const duration = buffer.duration * 1000; 
    if(window.stopSpeakingTimer) clearTimeout(window.stopSpeakingTimer); 
    window.speakingStartTimer = setTimeout(() => { window.isNellSpeaking = true; }, startDelay); 
    window.stopSpeakingTimer = setTimeout(() => { window.isNellSpeaking = false; }, startDelay + duration + 100); 
    window.nextStartTime += buffer.duration; 
};

window.floatTo16BitPCM = function(float32Array) { 
    const buffer = new ArrayBuffer(float32Array.length * 2); 
    const view = new DataView(buffer); 
    let offset = 0; 
    for (let i = 0; i < float32Array.length; i++, offset += 2) { 
        let s = Math.max(-1, Math.min(1, float32Array[i])); 
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true); 
    } 
    return buffer; 
};

window.downsampleBuffer = function(buffer, sampleRate, outSampleRate) { 
    if (outSampleRate >= sampleRate) return buffer; 
    const ratio = sampleRate / outSampleRate; 
    const newLength = Math.round(buffer.length / ratio); 
    const result = new Float32Array(newLength); 
    let offsetResult = 0, offsetBuffer = 0; 
    while (offsetResult < result.length) { 
        const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio); 
        let accum = 0, count = 0; 
        for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) { 
            accum += buffer[i]; 
            count++; 
        } 
        result[offsetResult] = accum / count; 
        offsetResult++; 
        offsetBuffer = nextOffsetBuffer; 
    } 
    return result; 
};

window.arrayBufferToBase64 = function(buffer) { 
    let binary = ''; 
    const bytes = new Uint8Array(buffer); 
    const len = bytes.byteLength;
    const CHUNK_SIZE = 0x8000; 
    for (let i = 0; i < len; i += CHUNK_SIZE) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK_SIZE, len)));
    }
    return window.btoa(binary); 
};