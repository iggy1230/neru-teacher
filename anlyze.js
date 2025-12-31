// --- anlyze.js (ヒント・給食・マイク修正版) ---

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
let processor = null;
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
    
    stopLiveChat();

    const icon = document.querySelector('.nell-avatar-wrap img');
    if(icon) icon.src = defaultIcon;

    document.getElementById('mini-karikari-display').classList.remove('hidden');
    updateMiniKarikari();

    if (m === 'review') {
        renderMistakeSelection();
    } else if (m === 'chat') {
        document.getElementById('chat-view').classList.remove('hidden');
        updateNellMessage("「おはなしする」を押してね！", "gentle");
        const btn = document.getElementById('mic-btn');
        btn.innerText = "🎤 おはなしする";
        btn.disabled = false;
        btn.style.background = "#ff85a1";
        document.getElementById('user-speech-text').innerText = "（リアルタイム対話）";
    } else if (m === 'lunch') {
        document.getElementById('lunch-view').classList.remove('hidden');
        lunchCount = 0;
        updateNellMessage("お腹ペコペコだにゃ……", "thinking");
    } else {
        document.getElementById('subject-selection-view').classList.remove('hidden');
        updateNellMessage("どの教科にするのかにゃ？", "normal");
    }
}

// 2. Live Chat機能 (接続・マイク・再生)
async function startLiveChat() {
    const btn = document.getElementById('mic-btn');
    if (liveSocket) { stopLiveChat(); return; }

    try {
        updateNellMessage("接続してるにゃ……", "thinking");
        btn.disabled = true;

        // AudioContext作成
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioCtx();
        // ★重要：ユーザー操作のタイミングで確実にResumeする
        await audioContext.resume();
        nextStartTime = audioContext.currentTime;

        // WebSocket接続
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        liveSocket = new WebSocket(`${wsProtocol}//${window.location.host}`);

        liveSocket.onopen = async () => {
            btn.innerText = "📞 通話中 (押すと終了)";
            btn.style.background = "#ff5252";
            btn.disabled = false;
            updateNellMessage("つながったにゃ！話しかけてみて！", "happy");
            // 接続確立後にマイクを開始
            await startMicrophone();
        };

        liveSocket.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            if (data.serverContent?.modelTurn?.parts?.[0]?.inlineData) {
                playPcmAudio(data.serverContent.modelTurn.parts[0].inlineData.data);
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
    if (processor) { processor.disconnect(); processor = null; }
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

async function startMicrophone() {
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ 
            audio: { 
                sampleRate: 16000, 
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true
            } 
        });
        
        const source = audioContext.createMediaStreamSource(mediaStream);
        // バッファサイズを調整 (2048 or 4096)
        processor = audioContext.createScriptProcessor(2048, 1, 1);
        
        source.connect(processor);
        processor.connect(audioContext.destination);

        processor.onaudioprocess = (e) => {
            if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) return;
            
            const input = e.inputBuffer.getChannelData(0);
            
            // 音量チェック（無音に近い場合は送らないことで反応精度を上げる工夫も可だが、今回は常時送信）
            
            // ダウンサンプリング (Contextレート -> 16000Hz)
            const downsampled = downsampleBuffer(input, audioContext.sampleRate, 16000);
            const pcm16 = floatTo16BitPCM(downsampled);
            const base64 = arrayBufferToBase64(pcm16);
            
            liveSocket.send(JSON.stringify({ 
                realtime_input: { 
                    media_chunks: [{ 
                        mime_type: "audio/pcm;rate=16000", 
                        data: base64 
                    }] 
                } 
            }));
        };
    } catch(e) {
        console.error("Mic Error:", e);
        updateNellMessage("マイクが使えないにゃ……", "thinking");
    }
}

// 3. おいしい給食（★セリフ強化版）
function giveLunch() {
    if (currentUser.karikari < 1) return updateNellMessage("カリカリがないにゃ……", "thinking");
    
    currentUser.karikari--; 
    saveAndSync(); 
    updateMiniKarikari(); 
    showKarikariEffect(-1); 
    
    lunchCount++;
    
    // セリフの出し分けロジック
    let msg = "";
    let mood = "happy";

    // 1〜9個：ランダム
    const normalTalks = ["おいしいにゃ！", "もぐもぐ……", "カリカリ最高！", "おかわり！"];
    // 10個目：中レベル褒め
    const midPraise = `すごい！${currentUser.name}さんは太っ腹だにゃ！大好きにゃ！`;
    // 20個目：強レベル褒め
    const highPraise = `神様！仏様！${currentUser.name}様！一生ついていくにゃー！！`;
    // 30個目：熱く語る
    const passionTalk = "いいかい？カリカリというのは単なる食事じゃないにゃ。猫と人をつなぐ魂の架け橋なんだにゃ！！";

    if (lunchCount === 10) {
        mood = "excited";
        msg = midPraise;
    } else if (lunchCount === 20) {
        mood = "excited";
        msg = highPraise;
    } else if (lunchCount === 30) {
        mood = "gentle"; // 真面目に語る
        msg = passionTalk;
    } else {
        // 通常ランダム
        msg = normalTalks[Math.floor(Math.random() * normalTalks.length)];
        // 食べた数が増えるとテンションが上がる演出
        if (lunchCount > 15) mood = "excited";
    }
    
    updateNellMessage(msg, mood);
}

// 4. 分析
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
            if (currentMode === 'explain' || currentMode === 'review') {
                renderProblemSelection(); 
                updateNellMessage("問題が読めたにゃ！", "happy");
            } else { 
                showGradingView(); 
                const total = transcribedProblems.length;
                const correctCount = transcribedProblems.filter(p => p.status === 'correct').length;
                const rate = correctCount / total;

                if (correctCount === total) {
                    currentUser.karikari += 100; 
                    saveAndSync(); updateMiniKarikari(); showKarikariEffect(100);
                    updateNellMessage("全問正解！ご褒美100個にゃ！✨", "excited");
                    drawHanamaru();
                } else if (rate >= 0.8) {
                    currentUser.karikari += 50; 
                    saveAndSync(); updateMiniKarikari(); showKarikariEffect(50);
                    updateNellMessage("ほとんど正解！50個あげるにゃ🐾", "happy");
                } else {
                    updateNellMessage("採点したにゃ。間違えた所は「教えて」ボタンを使ってね。", "gentle");
                }
            }
        }, 800);
    } catch (err) { clearInterval(timer); document.getElementById('thinking-view').classList.add('hidden'); document.getElementById('upload-controls').classList.remove('hidden'); updateNellMessage("エラーだにゃ", "thinking"); } finally { isAnalyzing = false; }
});

// 5. ヒント機能（★文言修正・アイコン修正）
function startHint(id) {
    selectedProblem = transcribedProblems.find(p => p.id == id); 
    if (!selectedProblem) return updateNellMessage("データが見つからないにゃ……", "thinking");

    document.getElementById('problem-selection-view').classList.add('hidden'); 
    document.getElementById('grade-sheet-container').classList.add('hidden'); 
    document.getElementById('final-view').classList.remove('hidden'); 
    document.getElementById('hint-detail-container').classList.remove('hidden'); 
    
    document.getElementById('chalkboard').innerText = selectedProblem.question; 
    document.getElementById('chalkboard').classList.remove('hidden'); 
    document.getElementById('answer-display-area').classList.add('hidden');
    
    hintIndex = 0;
    
    // ★修正：初期メッセージ変更
    updateNellMessage("カリカリをくれたらヒントを出してあげてもいいにゃ🐾", "thinking");
    document.getElementById('hint-step-label').innerText = "考え中...";
    
    const nextBtn = document.getElementById('next-hint-btn'); 
    const revealBtn = document.getElementById('reveal-answer-btn');
    
    // ★修正：アイコンを🍖に変更
    nextBtn.innerText = "🍖 ネル先生にカリカリを5個あげてヒントをもらう";
    nextBtn.classList.remove('hidden');
    revealBtn.classList.add('hidden');
    
    nextBtn.onclick = showNextHint;
}

function showNextHint() {
    let cost = 0;
    if (hintIndex === 0) cost = 5;      
    else if (hintIndex === 1) cost = 5; 
    else if (hintIndex === 2) cost = 10;

    if (currentUser.karikari < cost) {
        return updateNellMessage(`カリカリが足りないにゃ……あと${cost}個必要にゃ。`, "thinking");
    }

    currentUser.karikari -= cost; 
    saveAndSync(); 
    updateMiniKarikari(); 
    showKarikariEffect(-cost);

    let hints = selectedProblem.hints;
    if (!hints || hints.length === 0) hints = ["よく読んでみてにゃ", "式を立てるにゃ", "先生と解くにゃ"];
    
    const currentHintText = hints[hintIndex] || "……";
    updateNellMessage(currentHintText, "thinking");
    
    document.getElementById('hint-step-label').innerText = `ヒント ${hintIndex + 1}`;
    hintIndex++; 
    
    const nextBtn = document.getElementById('next-hint-btn'); 
    const revealBtn = document.getElementById('reveal-answer-btn');

    // ★修正：アイコンと文言変更
    if (hintIndex === 1) {
        nextBtn.innerText = "🍖 さらにカリカリを5個あげてヒントをもらう";
    } else if (hintIndex === 2) {
        nextBtn.innerText = "🍖 さらにカリカリを10個あげてヒントをもらう";
    } else {
        nextBtn.classList.add('hidden');
        revealBtn.classList.remove('hidden');
        revealBtn.innerText = "答えを見る";
    }
}

// --- その他の関数 ---
function revealAnswer() { document.getElementById('final-answer-text').innerText = selectedProblem.correct_answer; document.getElementById('answer-display-area').classList.remove('hidden'); document.getElementById('reveal-answer-btn').classList.add('hidden'); updateNellMessage("答えだにゃ", "gentle"); }
function renderProblemSelection() { document.getElementById('problem-selection-view').classList.remove('hidden'); const l=document.getElementById('transcribed-problem-list'); l.innerHTML=""; transcribedProblems.forEach(p=>{ l.innerHTML += `<div class="prob-card"><div><span class="q-label">${p.label||'?'}</span>${p.question.substring(0,20)}...</div><button class="main-btn blue-btn" style="width:auto;padding:10px" onclick="startHint(${p.id})">教えて</button></div>`; }); }
function showGradingView() { document.getElementById('final-view').classList.remove('hidden'); document.getElementById('grade-sheet-container').classList.remove('hidden'); renderWorksheet(); }
function renderWorksheet() { const l=document.getElementById('problem-list-grade'); l.innerHTML=""; transcribedProblems.forEach((p,i)=>{ l.innerHTML+=`<div class="problem-row"><div><span class="q-label">${p.label||'?'}</span>${p.question}</div><div style="display:flex;gap:5px"><input class="student-ans-input" value="${p.student_answer}" onchange="updateAns(${i},this.value)"><div class="judgment-mark ${p.status}">${p.status==='correct'?'⭕️':p.status==='incorrect'?'❌':''}</div><button class="mini-teach-btn" onclick="startHint(${p.id})">教えて</button></div></div>`; }); }
function updateAns(i,v) { transcribedProblems[i].student_answer=v; saveAndSync(); renderWorksheet(); }
function pressAllSolved() { currentUser.karikari+=100; saveAndSync(); backToLobby(); showKarikariEffect(100); }
function pressThanks() { if(currentMode==='grade') showGradingView(); else backToProblemSelection(); }
function setSubject(s) { currentSubject = s; if(currentUser){currentUser.history[s]=(currentUser.history[s]||0)+1; saveAndSync();} const icon = document.querySelector('.nell-avatar-wrap img'); if(icon&&subjectImages[s]){icon.src=subjectImages[s];icon.onerror=()=>{icon.src=defaultIcon;};} document.getElementById('subject-selection-view').classList.add('hidden'); document.getElementById('upload-controls').classList.remove('hidden'); updateNellMessage(`${currentSubject}の問題をみせてにゃ！`, "happy"); }
async function shrinkImage(file) { return new Promise((r)=>{ const reader=new FileReader(); reader.readAsDataURL(file); reader.onload=e=>{ const img=new Image(); img.onload=()=>{ const c=document.createElement('canvas'); let w=img.width,h=img.height; if(w>1600||h>1600){if(w>h){h*=1600/w;w=1600}else{w*=1600/h;h=1600}} c.width=w;c.height=h; c.getContext('2d').drawImage(img,0,0,w,h); r(c.toDataURL('image/jpeg',0.9).split(',')[1]); }; img.src=e.target.result; }; }); }
function renderMistakeSelection() { if (!currentUser.mistakes || currentUser.mistakes.length === 0) { updateNellMessage("ノートは空っぽにゃ！", "happy"); setTimeout(backToLobby, 2000); return; } transcribedProblems = currentUser.mistakes; renderProblemSelection(); updateNellMessage("復習するにゃ？", "excited"); }
function updateMiniKarikari() { if(currentUser) { document.getElementById('mini-karikari-count').innerText = currentUser.karikari; document.getElementById('karikari-count').innerText = currentUser.karikari; } }
function showKarikariEffect(amount) { const container = document.querySelector('.nell-avatar-wrap'); if(container) { const floatText = document.createElement('div'); floatText.className = 'floating-text'; if (amount > 0) { floatText.innerText = `+${amount}`; floatText.style.color = '#ff9100'; } else { floatText.innerText = `${amount}`; floatText.style.color = '#ff5252'; } floatText.style.right = '0px'; floatText.style.top = '0px'; container.appendChild(floatText); setTimeout(() => floatText.remove(), 1500); } const heartCont = document.getElementById('heart-container'); if(heartCont) { for(let i=0; i<8; i++) { const heart = document.createElement('div'); heart.className = 'heart-particle'; heart.innerText = amount > 0 ? '✨' : '💗'; heart.style.left = (Math.random()*80 + 10) + '%'; heart.style.top = (Math.random()*50 + 20) + '%'; heart.style.animationDelay = (Math.random()*0.5) + 's'; heartCont.appendChild(heart); setTimeout(() => heart.remove(), 1500); } } }

// Audio util
function downsampleBuffer(buffer, sampleRate, outSampleRate) { if (outSampleRate >= sampleRate) return buffer; const ratio = sampleRate / outSampleRate; const newLength = Math.round(buffer.length / ratio); const result = new Float32Array(newLength); let offsetResult = 0, offsetBuffer = 0; while (offsetResult < result.length) { const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio); let accum = 0, count = 0; for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) { accum += buffer[i]; count++; } result[offsetResult] = accum / count; offsetResult++; offsetBuffer = nextOffsetBuffer; } return result; }
function floatTo16BitPCM(input) { const output = new Int16Array(input.length); for (let i = 0; i < input.length; i++) { const s = Math.max(-1, Math.min(1, input[i])); output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF; } return output.buffer; }
function arrayBufferToBase64(buffer) { let binary = ''; const bytes = new Uint8Array(buffer); for (let i = 0; i < bytes.byteLength; i++) { binary += String.fromCharCode(bytes[i]); } return window.btoa(binary); }
function playPcmAudio(base64) { if (!audioContext) return; const binary = window.atob(base64); const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); const float32 = new Float32Array(bytes.length / 2); const view = new DataView(bytes.buffer); for (let i = 0; i < float32.length; i++) float32[i] = view.getInt16(i * 2, true) / 32768.0; const buffer = audioContext.createBuffer(1, float32.length, 24000); buffer.copyToChannel(float32, 0); const source = audioContext.createBufferSource(); source.buffer = buffer; source.connect(audioContext.destination); const now = audioContext.currentTime; if (nextStartTime < now) nextStartTime = now; source.start(nextStartTime); nextStartTime += buffer.duration; }