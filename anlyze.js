// --- anlyze.js (完全版 v120.0: 音声エラー回避 & 安定化) ---

window.transcribedProblems = [];
window.isAnalyzing = false;
window.analysisType = 'precision';
window.selectedProblem = null;

// 音声ファイル (エラーが出ても止まらないように設定)
const sfxBunseki = new Audio('bunseki.mp3'); sfxBunseki.loop = true; sfxBunseki.volume = 0.1;
const bgmApp = new Audio('bgm.mp3'); bgmApp.loop = true; bgmApp.volume = 0.2;
const sfxBori = new Audio('boribori.mp3');

// 音声再生ヘルパー (エラーを握りつぶす)
function safePlay(audio) {
    if (audio) {
        audio.currentTime = 0;
        audio.play().catch(e => console.log("Audio play skipped:", e.message));
    }
}
function safeStop(audio) {
    if (audio) {
        audio.pause();
        try { audio.currentTime = 0; } catch(e){}
    }
}

// --- 記憶の断捨離フィルター ---
async function saveToNellMemory(role, text) {
    if (!currentUser || !currentUser.id) return;
    const trimmed = text.trim();
    const ignoreWords = ["あー", "えーと", "うーん", "あのー", "はい", "へぇ", "にゃ", "にゃー", "ネル先生", "。"];
    if (trimmed.length <= 2 || ignoreWords.includes(trimmed)) return;

    const newItem = { role, text: trimmed, time: new Date().toISOString() };
    const memoryKey = `nell_chat_log_${currentUser.id}`;
    let history = JSON.parse(localStorage.getItem(memoryKey) || '[]');
    
    if (history.length > 0 && history[history.length - 1].text === trimmed) return;

    history.push(newItem);
    history = history.slice(-50); 
    localStorage.setItem(memoryKey, JSON.stringify(history));

    if (currentUser.isGoogleUser && typeof db !== 'undefined') {
        try {
            await db.collection("memories").doc(currentUser.id).set({ history, lastUpdated: new Date().toISOString() }, { merge: true });
        } catch(e) { console.error(e); }
    }
}

// --- メッセージ更新 ---
window.updateNellMessage = async function(t, mood = "normal") {
    const gameScreen = document.getElementById('screen-game');
    const isGameHidden = gameScreen ? gameScreen.classList.contains('hidden') : true;
    const targetId = isGameHidden ? 'nell-text' : 'nell-text-game';
    const el = document.getElementById(targetId);
    if (el) el.innerText = t;

    if (t && t.includes("もぐもぐ")) safePlay(sfxBori);
    if (!t || t.includes("ちょっと待ってて")) return;

    saveToNellMemory('nell', t);

    if (window.audioContext || typeof window.AudioContext !== 'undefined') {
        try {
             const res = await fetch('/synthesize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: t.replace(/🐾/g, ""), mood })
            });
            const data = await res.json();
            if (data.audioContent) playAudioBase64(data.audioContent);
        } catch(e) {}
    }
};

function playAudioBase64(base64) {
    if (!window.audioContext) window.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    window.audioContext.decodeAudioData(bytes.buffer, buffer => {
        const source = window.audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(window.audioContext.destination);
        source.start(0);
    });
}

// --- 分析処理 ---
window.handleFileUpload = async (file) => {
    if (window.isAnalyzing || !file) return;
    window.isAnalyzing = true;
    
    // UI切り替え
    const uploadControls = document.getElementById('upload-controls');
    const thinkingView = document.getElementById('thinking-view');
    const cropperModal = document.getElementById('cropper-modal');
    
    // クロップ画面はスキップして直接解析へ（簡易化）
    // もしクロップが必要ならここを戻しますが、まずはエラー解消のためシンプルに
    if(uploadControls) uploadControls.classList.add('hidden');
    if(thinkingView) thinkingView.classList.remove('hidden');

    // BGM再生 (エラーが出ても止まらない)
    safePlay(sfxBunseki);
    safePlay(bgmApp);

    updateNellMessage("問題をじーっと見てるにゃ！ちょっと待っててにゃ！", "thinking");

    try {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = async () => {
            const b64 = reader.result.split(',')[1];
            
            const res = await fetch('/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image: b64,
                    grade: currentUser.grade,
                    name: currentUser.name
                })
            });

            if (!res.ok) throw new Error("Server Error");
            const data = await res.json();
            window.transcribedProblems = data.problems || [];
            
            safeStop(sfxBunseki);

            if (window.transcribedProblems.length > 0) {
                if(thinkingView) thinkingView.classList.add('hidden');
                showProblemList(); 
                updateNellMessage("読めたにゃ！", "happy");
            } else {
                updateNellMessage("うまく読めなかったにゃ。もう一回見せてにゃ。", "sad");
                setTimeout(() => {
                    if(thinkingView) thinkingView.classList.add('hidden');
                    if(uploadControls) uploadControls.classList.remove('hidden');
                }, 3000);
            }
            window.isAnalyzing = false;
        };
    } catch (e) {
        console.error(e);
        safeStop(sfxBunseki);
        updateNellMessage("エラーだにゃ。もう一回試してにゃ！", "sad");
        if(thinkingView) thinkingView.classList.add('hidden');
        if(uploadControls) uploadControls.classList.remove('hidden');
        window.isAnalyzing = false;
    }
};

// --- リスト表示 ---
function showProblemList() {
    const container = document.getElementById('transcribed-problem-list') || document.getElementById('problem-list-container');
    const view = document.getElementById('problem-selection-view');
    if (!container || !view) return;

    view.classList.remove('hidden');
    container.innerHTML = '';
    const isGradeMode = (window.analysisType === 'grade');

    window.transcribedProblems.forEach(p => {
        const div = document.createElement('div');
        div.className = 'grade-item';
        div.style.cssText = `border-bottom:1px solid #eee; padding:15px; margin-bottom:10px; border-radius:10px; background:white; box-shadow: 0 2px 5px rgba(0,0,0,0.05);`;
        
        let markHtml = '';
        if (isGradeMode) {
            const mark = p.isCorrect ? '◯' : '×';
            const color = p.isCorrect ? '#ff4d4d' : '#4d79ff';
            markHtml = `<div style="font-weight:900; color:${color}; font-size:2.5rem; width:50px; text-align:center;">${mark}</div>`;
        }

        div.innerHTML = `
            <div style="display:flex; align-items:center;">
                ${markHtml}
                <div style="flex:1; margin-left:10px;">
                    <div style="font-size:0.8rem; color:#888;">${p.label}</div>
                    <div style="font-weight:bold; margin-bottom:5px;">${p.question}</div>
                    <div style="display:flex; gap:10px; align-items:center;">
                        <div style="flex:1;">
                            <div style="font-size:0.7rem; color:#666;">答え</div>
                            <input type="text" value="${p.studentAnswer || ''}" 
                                style="width:100%; padding:5px; border:2px solid #eee; border-radius:8px; font-weight:bold;">
                        </div>
                        <button class="mini-teach-btn" onclick="startHint(${p.id})">教えて</button>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(div);
    });
}

// ヒント開始
window.startHint = function(id) {
    window.selectedProblem = window.transcribedProblems.find(p => p.id == id);
    if (!window.selectedProblem) return;
    
    // 画面切り替え
    const problemView = document.getElementById('problem-selection-view');
    const finalView = document.getElementById('final-view');
    const hintContainer = document.getElementById('hint-detail-container');
    const board = document.getElementById('chalkboard');
    
    if(problemView) problemView.classList.add('hidden');
    if(finalView) finalView.classList.remove('hidden');
    if(hintContainer) hintContainer.classList.remove('hidden');
    if(board) { board.innerText = window.selectedProblem.question; board.classList.remove('hidden'); }
    
    window.hintIndex = 0;
    updateNellMessage(window.selectedProblem.hint1 || "ヒントだにゃ", "thinking");
};

// DOM Ready
window.addEventListener('DOMContentLoaded', () => {
    const camIn = document.getElementById('hw-input-camera'); 
    const albIn = document.getElementById('hw-input-album'); 
    if(camIn) camIn.addEventListener('change', (e) => { window.handleFileUpload(e.target.files[0]); e.target.value=''; });
    if(albIn) albIn.addEventListener('change', (e) => { window.handleFileUpload(e.target.files[0]); e.target.value=''; });
});