// --- anlyze.js (ダウンサンプリング対応版) ---

let transcribedProblems = []; 
let selectedProblem = null; 
let hintIndex = 0; 
let isAnalyzing = false; 
let currentSubject = '';
let currentMode = ''; 
let lunchCount = 0; 

// Live Chat Variables
let liveSocket = null;
let audioContext = null;
let mediaStream = null;
let nextStartTime = 0;
let processorNode = null;

const subjectImages = {
    'こくご': 'nell-kokugo.png', 'さんすう': 'nell-sansu.png',
    'りか': 'nell-rika.png', 'しゃかい': 'nell-shakai.png'
};
const defaultIcon = 'nell-icon.png';

// 1. モード選択
function selectMode(m) {
    currentMode = m; 
    switchScreen('screen-main'); 
    
    // UIリセット
    const ids = ['subject-selection-view', 'upload-controls', 'thinking-view', 'problem-selection-view', 'final-view', 'chalkboard', 'chat-view', 'lunch-view'];
    ids.forEach(id => document.getElementById(id).classList.add('hidden'));
    
    // Live Chat停止
    stopLiveChat();

    const icon = document.querySelector('.nell-avatar-wrap img');
    if(icon) icon.src = defaultIcon;

    document.getElementById('mini-karikari-display').classList.remove('hidden');
    updateMiniKarikari();

    if (m === 'chat') {
        document.getElementById('chat-view').classList.remove('hidden');
        updateNellMessage("「おはなしする」を押すとつながるにゃ！", "normal");
        
        const btn = document.getElementById('mic-btn');
        btn.innerText = "🎤 おはなしする";
        btn.onclick = startLiveChat;
        btn.disabled = false;
        btn.style.background = "#ff85a1";
        document.getElementById('user-speech-text').innerText = "（リアルタイム対話）";

    } else if (m === 'lunch') {
        document.getElementById('lunch-view').classList.remove('hidden');
        lunchCount = 0;
        updateNellMessage("お腹ペコペコだにゃ……", "thinking");
    } else if (m === 'review') {
        renderMistakeSelection();
    } else {
        document.getElementById('subject-selection-view').classList.remove('hidden');
        updateNellMessage("どの教科にするのかにゃ？", "normal");
    }
}

// 2. ★Live Chat 機能 (Web Audio API)
async function startLiveChat() {
    const btn = document.getElementById('mic-btn');
    
    // 接続中なら切断
    if (liveSocket) { stopLiveChat(); return; }

    try {
        updateNellMessage("接続してるにゃ……", "thinking");
        btn.disabled = true;

        // AudioContext作成 (出力用: 24kHz推奨だがブラウザネイティブに任せる)
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioCtx();
        await audioContext.resume();
        nextStartTime = audioContext.currentTime;

        // WebSocket接続
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        liveSocket = new WebSocket(`${wsProtocol}//${window.location.host}`);

        liveSocket.onopen = async () => {
            console.log("WS Open");
            btn.innerText = "📞 通話中 (押すと終了)";
            btn.style.background = "#ff5252";
            btn.disabled = false;
            updateNellMessage("つながったにゃ！話しかけてみて！", "happy");
            
            // マイク入力開始
            await startMicrophone();
        };

        liveSocket.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            // サーバーからの音声データ (PCM 24kHz) を再生
            if (data.serverContent?.modelTurn?.parts?.[0]?.inlineData) {
                const base64Audio = data.serverContent.modelTurn.parts[0].inlineData.data;
                playPcmAudio(base64Audio);
            }
        };

        liveSocket.onclose = () => {
            console.log("WS Closed");
            stopLiveChat();
        };
        
        liveSocket.onerror = (e) => {
            console.error(e);
            stopLiveChat();
        };

    } catch (e) {
        console.error("Start Error:", e);
        alert("エラー: " + e.message);
        stopLiveChat();
    }
}

function stopLiveChat() {
    if (mediaStream) { 
        mediaStream.getTracks().forEach(t => t.stop()); 
        mediaStream = null; 
    }
    if (processorNode) {
        processorNode.disconnect();
        processorNode = null;
    }
    if (liveSocket) { 
        liveSocket.close(); 
        liveSocket = null; 
    }
    if (audioContext) { 
        audioContext.close(); 
        audioContext = null; 
    }
    
    const btn = document.getElementById('mic-btn');
    if (btn) {
        btn.innerText = "🎤 おはなしする";
        btn.style.background = "#ff85a1";
        btn.disabled = false;
        btn.onclick = startLiveChat;
    }
    updateNellMessage("またお話しようね！", "happy");
}

// ★マイク入力処理 (ダウンサンプリング強化版)
async function startMicrophone() {
    try {
        // エコーキャンセルを有効にしてマイク取得
        mediaStream = await navigator.mediaDevices.getUserMedia({ 
            audio: { 
                channelCount: 1, 
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            } 
        });
        
        const source = audioContext.createMediaStreamSource(mediaStream);
        
        // ScriptProcessor作成 (バッファサイズ4096)
        processorNode = audioContext.createScriptProcessor(4096, 1, 1);

        source.connect(processorNode);
        processorNode.connect(audioContext.destination); // 録音を継続させるため接続（音は出ない）

        processorNode.onaudioprocess = (e) => {
            if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) return;

            const inputData = e.inputBuffer.getChannelData(0);
            
            // ★重要：ダウンサンプリング (ブラウザのレート -> 16000Hz)
            const downsampledData = downsampleBuffer(inputData, audioContext.sampleRate, 16000);
            
            // Int16 (PCM) に変換
            const pcm16 = floatTo16BitPCM(downsampledData);
            
            // Base64変換して送信
            const base64Audio = arrayBufferToBase64(pcm16);
            
            // 送信
            liveSocket.send(JSON.stringify({ type: 'audio', audioChunk: base64Audio }));
            
            // 視覚フィードバック（音量があればボタンを点滅）
            const maxVal = Math.max(...inputData);
            const btn = document.getElementById('mic-btn');
            if(maxVal > 0.1 && btn) {
                btn.style.opacity = (btn.style.opacity === '0.8' ? '1' : '0.8');
            }
        };
    } catch(e) {
        console.error("Mic Error:", e);
        updateNellMessage("マイクが使えないにゃ……", "thinking");
    }
}

// --- 音声変換ユーティリティ ---

// サンプリングレート変換 (例: 48000 -> 16000)
function downsampleBuffer(buffer, sampleRate, outSampleRate) {
    if (outSampleRate === sampleRate) {
        return buffer;
    }
    if (outSampleRate > sampleRate) {
        return buffer; // アップサンプリングは非対応（今回は不要）
    }
    const sampleRateRatio = sampleRate / outSampleRate;
    const newLength = Math.round(buffer.length / sampleRateRatio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    
    while (offsetResult < result.length) {
        const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
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
}

// Float32 -> Int16 PCM
function floatTo16BitPCM(input) {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return output.buffer;
}

// ArrayBuffer -> Base64
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

// ★PCM再生 (受信した24kHz音声を再生)
function playPcmAudio(base64String) {
    if (!audioContext) return;
    
    const binaryString = window.atob(base64String);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    
    // Int16 -> Float32
    const float32 = new Float32Array(len / 2);
    const view = new DataView(bytes.buffer);
    
    for (let i = 0; i < float32.length; i++) {
        const int16 = view.getInt16(i * 2, true); // Little Endian
        float32[i] = int16 / 32768.0;
    }

    // Gemini Live APIは通常 24000Hz で返してくる
    const buffer = audioContext.createBuffer(1, float32.length, 24000);
    buffer.copyToChannel(float32, 0);
    
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    
    const now = audioContext.currentTime;
    // スケジューリング（途切れないように次の再生時間を管理）
    const startTime = nextStartTime < now ? now : nextStartTime;
    source.start(startTime);
    nextStartTime = startTime + buffer.duration;
}

// 4. カリカリ・給食・その他（変更なし）
function updateMiniKarikari() { if(currentUser) { document.getElementById('mini-karikari-count').innerText = currentUser.karikari; document.getElementById('karikari-count').innerText = currentUser.karikari; } }
function showKarikariEffect(n=5) { /* 既存のまま */ }
function giveLunch() {
    if (currentUser.karikari < 1) return updateNellMessage("カリカリがないにゃ……", "thinking");
    currentUser.karikari--; saveAndSync(); updateMiniKarikari(); lunchCount++;
    let m = "happy", t = "おいしいにゃ！";
    if (lunchCount > 3) { m = "excited"; t = "もっと欲しいにゃ！"; }
    updateNellMessage(t, m);
}

// 画像処理・分析
async function shrinkImage(file) { return new Promise((r)=>{ const reader=new FileReader(); reader.onload=e=>{ const img=new Image(); img.onload=()=>{ const c=document.createElement('canvas'); let w=img.width,h=img.height; if(w>1600||h>1600){if(w>h){h*=1600/w;w=1600}else{w*=1600/h;h=1600}} c.width=w;c.height=h; c.getContext('2d').drawImage(img,0,0,w,h); r(c.toDataURL('image/jpeg',0.9).split(',')[1]); }; img.src=e.target.result; }; reader.readAsDataURL(file); }); }

document.getElementById('hw-input').addEventListener('change', async (e) => {
    if (isAnalyzing || !e.target.files[0]) return; isAnalyzing = true;
    document.getElementById('upload-controls').classList.add('hidden'); document.getElementById('thinking-view').classList.remove('hidden');
    updateNellMessage("準備中……", "thinking"); updateProgress(0); 
    let p = 0; const timer = setInterval(() => { if (p < 90) { p += 3; updateProgress(p); } }, 500);
    try {
        const b64 = await shrinkImage(e.target.files[0]);
        const res = await fetch('/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: b64, mode: currentMode, grade: currentUser.grade, subject: currentSubject }) });
        if (!res.ok) throw new Error("Err"); const data = await res.json();
        transcribedProblems = data.map((prob, index) => ({ ...prob, id: index + 1, student_answer: prob.student_answer || "", status: "unanswered" }));
        transcribedProblems.forEach(p => {
            const n = v => v.toString().replace(/\s|[０-９]|cm|ｍ/g, s => s==='cm'||s==='ｍ'?'':String.fromCharCode(s.charCodeAt(0)-0xFEE0)).replace(/×/g,'*').replace(/÷/g,'/');
            if(p.student_answer && n(p.student_answer) === n(p.correct_answer)) p.status = 'correct';
            else if(p.student_answer) p.status = 'incorrect';
        });
        clearInterval(timer); updateProgress(100);
        setTimeout(() => { 
            document.getElementById('thinking-view').classList.add('hidden'); 
            if (currentMode === 'explain' || currentMode === 'review') renderProblemSelection(); 
            else showGradingView();
            updateNellMessage("終わったにゃ！", "happy");
        }, 800);
    } catch (err) { clearInterval(timer); document.getElementById('thinking-view').classList.add('hidden'); document.getElementById('upload-controls').classList.remove('hidden'); updateNellMessage("エラーだにゃ", "thinking"); } finally { isAnalyzing = false; }
});

function renderMistakeSelection() { if (!currentUser.mistakes || currentUser.mistakes.length === 0) { updateNellMessage("ノートは空っぽにゃ！", "happy"); setTimeout(backToLobby, 2000); return; } transcribedProblems = currentUser.mistakes; renderProblemSelection(); updateNellMessage("復習するにゃ？", "excited"); }
function startHint(id) { selectedProblem = transcribedProblems.find(p=>p.id==id); if(!selectedProblem)return; hintIndex=0; currentUser.karikari-=5; saveAndSync(); updateMiniKarikari(); document.getElementById('problem-selection-view').classList.add('hidden'); document.getElementById('grade-sheet-container').classList.add('hidden'); document.getElementById('final-view').classList.remove('hidden'); document.getElementById('hint-detail-container').classList.remove('hidden'); document.getElementById('chalkboard').innerText = selectedProblem.question; document.getElementById('chalkboard').classList.remove('hidden'); document.getElementById('answer-display-area').classList.add('hidden'); showHintStep(); }
function showHintStep() { updateNellMessage(selectedProblem.hints?.[hintIndex]||"...", "thinking"); document.getElementById('hint-step-label').innerText = `ヒント ${hintIndex+1}`; const n=document.getElementById('next-hint-btn'),r=document.getElementById('reveal-answer-btn'); if(hintIndex<2){n.classList.remove('hidden');r.classList.add('hidden')}else{n.classList.add('hidden');r.classList.remove('hidden')} }
function showNextHint() { currentUser.karikari-=5; saveAndSync(); updateMiniKarikari(); hintIndex++; showHintStep(); }
function revealAnswer() { document.getElementById('final-answer-text').innerText = selectedProblem.correct_answer; document.getElementById('answer-display-area').classList.remove('hidden'); document.getElementById('reveal-answer-btn').classList.add('hidden'); updateNellMessage("答えだにゃ", "gentle"); }
function renderProblemSelection() { document.getElementById('problem-selection-view').classList.remove('hidden'); const l=document.getElementById('transcribed-problem-list'); l.innerHTML=""; transcribedProblems.forEach(p=>{ l.innerHTML += `<div class="prob-card"><div><span class="q-label">${p.label||'?'}</span>${p.question.substring(0,20)}...</div><button class="main-btn blue-btn" style="width:auto;padding:10px" onclick="startHint(${p.id})">教えて</button></div>`; }); }
function showGradingView() { document.getElementById('final-view').classList.remove('hidden'); document.getElementById('grade-sheet-container').classList.remove('hidden'); renderWorksheet(); }
function renderWorksheet() { const l=document.getElementById('problem-list-grade'); l.innerHTML=""; transcribedProblems.forEach((p,i)=>{ l.innerHTML+=`<div class="problem-row"><div><span class="q-label">${p.label||'?'}</span>${p.question}</div><div style="display:flex;gap:5px"><input class="student-ans-input" value="${p.student_answer}" onchange="updateAns(${i},this.value)"><div class="judgment-mark ${p.status}">${p.status==='correct'?'⭕️':p.status==='incorrect'?'❌':''}</div><button class="mini-teach-btn" onclick="startHint(${p.id})">教えて</button></div></div>`; }); }
function updateAns(i,v) { transcribedProblems[i].student_answer=v; saveAndSync(); renderWorksheet(); }
function pressAllSolved() { currentUser.karikari+=100; saveAndSync(); backToLobby(); }
function pressThanks() { if(currentMode==='grade') showGradingView(); else backToProblemSelection(); }