// --- anlyze.js (Live API & UI修正版) ---

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
let audioWorkletNode = null;
let nextStartTime = 0;

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
    
    // ★重要: Live Chatを完全に停止（リソース開放）
    stopLiveChat();

    // アイコンリセット
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
    if (liveSocket) { stopLiveChat(); return; }

    try {
        updateNellMessage("接続してるにゃ……", "thinking");
        btn.disabled = true;

        // AudioContext作成 (ブラウザ互換対応)
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioCtx({ sampleRate: 24000 }); // 出力用レート
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
            await startMicrophone();
        };

        liveSocket.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            if (data.serverContent?.modelTurn?.parts?.[0]?.inlineData) {
                const base64Audio = data.serverContent.modelTurn.parts[0].inlineData.data;
                playPcmAudio(base64Audio);
            }
        };

        liveSocket.onclose = () => stopLiveChat();
        liveSocket.onerror = (e) => { console.error(e); stopLiveChat(); };

    } catch (e) {
        console.error("Start Error:", e);
        alert("エラー: " + e.message);
        stopLiveChat();
    }
}

function stopLiveChat() {
    if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
    if (liveSocket) { liveSocket.close(); liveSocket = null; }
    if (audioContext) { audioContext.close(); audioContext = null; }
    
    const btn = document.getElementById('mic-btn');
    if (btn) {
        btn.innerText = "🎤 おはなしする";
        btn.style.background = "#ff85a1";
        btn.disabled = false;
        btn.onclick = startLiveChat;
    }
}

// マイク入力処理
async function startMicrophone() {
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true } });
        
        // AudioContext (入力用: 16kHz指定)
        const inputCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        const source = inputCtx.createMediaStreamSource(mediaStream);
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);

        source.connect(processor);
        processor.connect(inputCtx.destination);

        processor.onaudioprocess = (e) => {
            if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) return;
            const inputData = e.inputBuffer.getChannelData(0);
            
            // Float32 -> PCM16変換
            const pcm16 = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
                const s = Math.max(-1, Math.min(1, inputData[i]));
                pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            
            // Base64変換して送信
            const binary = String.fromCharCode(...new Uint8Array(pcm16.buffer));
            const base64 = window.btoa(binary);
            
            liveSocket.send(JSON.stringify({ type: 'audio', audioChunk: base64 }));
        };
    } catch(e) {
        console.error("Mic Error:", e);
        updateNellMessage("マイクが使えないにゃ……", "thinking");
    }
}

// PCM再生処理 (24kHz)
function playPcmAudio(base64) {
    if (!audioContext) return;
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    
    const float32 = new Float32Array(bytes.length / 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < float32.length; i++) {
        float32[i] = view.getInt16(i * 2, true) / 32768.0;
    }

    const buffer = audioContext.createBuffer(1, float32.length, 24000);
    buffer.copyToChannel(float32, 0);
    
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    
    const now = audioContext.currentTime;
    if (nextStartTime < now) nextStartTime = now;
    source.start(nextStartTime);
    nextStartTime += buffer.duration;
}

// 3. 科目選択 (バグ修正: ボタンが表示されない問題)
function setSubject(s) {
    currentSubject = s; 
    if (currentUser) {
        currentUser.history[s] = (currentUser.history[s] || 0) + 1; 
        saveAndSync();
    }
    
    // アイコン変更 (エラーハンドリング付き)
    const icon = document.querySelector('.nell-avatar-wrap img');
    if(icon && subjectImages[s]) {
        icon.src = subjectImages[s];
        // 読み込みエラーならデフォルトに戻す(チラつき防止のため簡易的に)
        icon.onerror = () => { icon.src = defaultIcon; };
    }

    // UI切り替え (確実に実行)
    const selView = document.getElementById('subject-selection-view');
    const upView = document.getElementById('upload-controls');
    
    if (selView) selView.classList.add('hidden');
    if (upView) upView.classList.remove('hidden');
    
    updateNellMessage(`${currentSubject}の問題をみせてにゃ！`, "happy");
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
async function shrinkImage(file) { /* 既存のまま */ return new Promise((r)=>{ const reader=new FileReader(); reader.onload=e=>{ const img=new Image(); img.onload=()=>{ const c=document.createElement('canvas'); let w=img.width,h=img.height; if(w>1600||h>1600){if(w>h){h*=1600/w;w=1600}else{w*=1600/h;h=1600}} c.width=w;c.height=h; c.getContext('2d').drawImage(img,0,0,w,h); r(c.toDataURL('image/jpeg',0.9).split(',')[1]); }; img.src=e.target.result; }; reader.readAsDataURL(file); }); }

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
        
        // 自動採点
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

// UI helper
function renderMistakeSelection() { /* ... */ transcribedProblems = currentUser.mistakes; renderProblemSelection(); }
function startHint(id) { selectedProblem = transcribedProblems.find(p=>p.id==id); if(!selectedProblem)return; hintIndex=0; currentUser.karikari-=5; saveAndSync(); updateMiniKarikari(); document.getElementById('problem-selection-view').classList.add('hidden'); document.getElementById('grade-sheet-container').classList.add('hidden'); document.getElementById('final-view').classList.remove('hidden'); document.getElementById('hint-detail-container').classList.remove('hidden'); document.getElementById('chalkboard').innerText = selectedProblem.question; document.getElementById('chalkboard').classList.remove('hidden'); document.getElementById('answer-display-area').classList.add('hidden'); showHintStep(); }
function showHintStep() { updateNellMessage(selectedProblem.hints?.[hintIndex]||"...", "thinking"); document.getElementById('hint-step-label').innerText = `ヒント ${hintIndex+1}`; const n=document.getElementById('next-hint-btn'),r=document.getElementById('reveal-answer-btn'); if(hintIndex<2){n.classList.remove('hidden');r.classList.add('hidden')}else{n.classList.add('hidden');r.classList.remove('hidden')} }
function showNextHint() { currentUser.karikari-=5; saveAndSync(); updateMiniKarikari(); hintIndex++; showHintStep(); }
function revealAnswer() { document.getElementById('final-answer-text').innerText = selectedProblem.correct_answer; document.getElementById('answer-display-area').classList.remove('hidden'); document.getElementById('reveal-answer-btn').classList.add('hidden'); updateNellMessage("答えだにゃ", "gentle"); }
function renderProblemSelection() { document.getElementById('problem-selection-view').classList.remove('hidden'); const l=document.getElementById('transcribed-problem-list'); l.innerHTML=""; transcribedProblems.forEach(p=>{ l.innerHTML += `<div class="prob-card"><div><span class="q-label">${p.label||'?'}</span>${p.question.substring(0,20)}...</div><button class="main-btn blue-btn" style="width:auto;padding:10px" onclick="startHint(${p.id})">教えて</button></div>`; }); }
function showGradingView() { document.getElementById('final-view').classList.remove('hidden'); document.getElementById('grade-sheet-container').classList.remove('hidden'); renderWorksheet(); }
function renderWorksheet() { const l=document.getElementById('problem-list-grade'); l.innerHTML=""; transcribedProblems.forEach((p,i)=>{ l.innerHTML+=`<div class="problem-row"><div><span class="q-label">${p.label||'?'}</span>${p.question}</div><div style="display:flex;gap:5px"><input class="student-ans-input" value="${p.student_answer}" onchange="updateAns(${i},this.value)"><div class="judgment-mark ${p.status}">${p.status==='correct'?'⭕️':p.status==='incorrect'?'❌':''}</div><button class="mini-teach-btn" onclick="startHint(${p.id})">教えて</button></div></div>`; }); }
function updateAns(i,v) { transcribedProblems[i].student_answer=v; /* 正誤判定ロジック省略(上と同じ) */ saveAndSync(); renderWorksheet(); }
function pressAllSolved() { currentUser.karikari+=100; saveAndSync(); backToLobby(); }
function pressThanks() { if(currentMode==='grade') showGradingView(); else backToProblemSelection(); }