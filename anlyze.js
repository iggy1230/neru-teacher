// --- anlyze.js (抜粋: startMicrophoneのみ修正) ---
// ※ファイル全体は長いので、該当関数だけ書き換えてください。

async function startMicrophone() {
    try {
        // 1. Web Speech API (文字起こし用)
        if ('webkitSpeechRecognition' in window) {
            recognition = new webkitSpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = false;
            recognition.lang = 'ja-JP';
            
            isRecognitionActive = true;

            recognition.onresult = (event) => {
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        const transcript = event.results[i][0].transcript;
                        console.log("🎤 認識完了:", transcript); // ブラウザログ
                        
                        if (liveSocket && liveSocket.readyState === WebSocket.OPEN) {
                            console.log("📤 テキスト送信試行:", transcript); // ★送信確認
                            liveSocket.send(JSON.stringify({ type: 'log_text', text: transcript }));
                        } else {
                            console.warn("⚠️ ソケット未接続のため送信不可");
                        }
                    }
                }
            };
            
            recognition.onend = () => {
                if (isRecognitionActive) {
                    console.log("🔄 音声認識再起動");
                    try { recognition.start(); } catch(e) {}
                }
            };
            
            recognition.start();
        } else {
             console.warn("このブラウザは音声認識非対応です");
        }

        // 2. Audio Worklet (音声配信用)
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } });
        const processorCode = `class PcmProcessor extends AudioWorkletProcessor { constructor() { super(); this.bufferSize = 2048; this.buffer = new Float32Array(this.bufferSize); this.index = 0; } process(inputs, outputs, parameters) { const input = inputs[0]; if (input.length > 0) { const channel = input[0]; for (let i = 0; i < channel.length; i++) { this.buffer[this.index++] = channel[i]; if (this.index >= this.bufferSize) { this.port.postMessage(this.buffer); this.index = 0; } } } return true; } } registerProcessor('pcm-processor', PcmProcessor);`;
        const blob = new Blob([processorCode], { type: 'application/javascript' });
        await audioContext.audioWorklet.addModule(URL.createObjectURL(blob));
        const source = audioContext.createMediaStreamSource(mediaStream);
        workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');
        source.connect(workletNode);
        
        workletNode.port.onmessage = (event) => {
            const inputData = event.data;
            let sum = 0; for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
            const volume = Math.sqrt(sum / inputData.length);
            
            const btn = document.getElementById('mic-btn');
            if (btn) btn.style.boxShadow = volume > 0.01 ? `0 0 ${10 + volume * 500}px #ffeb3b` : "none";
            
            // 音声送信 (750ms遅延)
            setTimeout(() => {
                if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) return;
                const downsampled = downsampleBuffer(inputData, audioContext.sampleRate, 16000);
                const pcmBuffer = floatTo16BitPCM(downsampled);
                const base64Audio = arrayBufferToBase64(pcmBuffer);
                liveSocket.send(JSON.stringify({ base64Audio: base64Audio }));
            }, 750);
        };
    } catch(e) { updateNellMessage("マイクエラー", "thinking"); }
}