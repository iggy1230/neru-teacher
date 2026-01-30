// --- js/analyze.js (v308.0: 位置情報高精度化版) ---
// 音声機能 -> voice-service.js
// カメラ・解析機能 -> camera-service.js
// ゲーム機能 -> game-engine.js

// グローバル変数: 現在位置情報
window.currentLocation = null;

// 位置情報取得ヘルパー
window.fetchCurrentLocation = function() {
    if (!navigator.geolocation) return;
    console.log("Fetching location (High Accuracy)...");
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            window.currentLocation = { lat: pos.coords.latitude, lon: pos.coords.longitude };
            console.log("Location fetched:", window.currentLocation);
        },
        (err) => {
            console.warn("Location fetch failed:", err);
            // 失敗してもnullのままにしておく
            window.currentLocation = null;
        },
        // ★修正: 高精度モードをON (enableHighAccuracy: true)
        { timeout: 15000, enableHighAccuracy: true } 
    );
};

// ==========================================
// 1. UI操作・モード選択関数
// ==========================================

// ★ selectMode
window.selectMode = function(m) {
    try {
        window.currentMode = m; 
        window.chatSessionHistory = [];

        if (typeof window.switchScreen === 'function') {
            window.switchScreen('screen-main'); 
        } else {
            document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
            document.getElementById('screen-main').classList.remove('hidden');
        }

        // 画面要素のリセット
        const ids = ['subject-selection-view', 'upload-controls', 'thinking-view', 'problem-selection-view', 'final-view', 'chalkboard', 'chat-view', 'simple-chat-view', 'chat-free-view', 'lunch-view', 'grade-sheet-container', 'hint-detail-container', 'embedded-chat-section'];
        ids.forEach(id => { 
            const el = document.getElementById(id); 
            if (el) el.classList.add('hidden'); 
        });
        
        document.getElementById('conversation-log').classList.add('hidden');
        document.getElementById('log-content').innerHTML = "";
        
        ['embedded-chalkboard', 'chalkboard-simple'].forEach(bid => {
            const embedBoard = document.getElementById(bid);
            if (embedBoard) {
                embedBoard.innerText = "";
                embedBoard.classList.add('hidden');
            }
        });

        ['embedded-text-input', 'simple-text-input'].forEach(iid => {
            const embedInput = document.getElementById(iid);
            if(embedInput) embedInput.value = "";
        });

        const backBtn = document.getElementById('main-back-btn');
        if (backBtn) { backBtn.classList.remove('hidden'); backBtn.onclick = window.backToLobby; }
        
        // 既存の機能を停止
        if(typeof window.stopAlwaysOnListening === 'function') window.stopAlwaysOnListening();
        if (typeof window.stopLiveChat === 'function') window.stopLiveChat();
        if(typeof window.stopPreviewCamera === 'function') window.stopPreviewCamera(); 
        
        window.gameRunning = false;
        const icon = document.querySelector('.nell-avatar-wrap img'); 
        if(icon) icon.src = "assets/images/characters/nell-normal.png";
        
        const miniKarikari = document.getElementById('mini-karikari-display');
        if(miniKarikari) miniKarikari.classList.remove('hidden');
        if(typeof window.updateMiniKarikari === 'function') window.updateMiniKarikari();
        
        // モードごとの初期化
        if (m === 'chat') { 
            // お宝図鑑モード
            document.getElementById('chat-view').classList.remove('hidden'); 
            window.updateNellMessage("お宝を見せてにゃ！お話もできるにゃ！", "excited", false); 
            document.getElementById('conversation-log').classList.remove('hidden');
            if(typeof window.startAlwaysOnListening === 'function') window.startAlwaysOnListening();
            
            // 図鑑モードでも位置情報を事前に取得しておく
            window.fetchCurrentLocation();
        } 
        else if (m === 'simple-chat') {
            document.getElementById('simple-chat-view').classList.remove('hidden');
            window.updateNellMessage("今日はお話だけするにゃ？", "gentle", false);
            document.getElementById('conversation-log').classList.remove('hidden');
            if(typeof window.startAlwaysOnListening === 'function') window.startAlwaysOnListening();
            
            // 個別指導モードでも位置情報を取得
            window.fetchCurrentLocation();
        }
        else if (m === 'chat-free') {
            document.getElementById('chat-free-view').classList.remove('hidden');
            window.updateNellMessage("何でも話していいにゃ！", "happy", false);
        }
        else if (m === 'lunch') { 
            document.getElementById('lunch-view').classList.remove('hidden'); 
            window.updateNellMessage("お腹ペコペコだにゃ……", "thinking", false); 
        } 
        else if (m === 'review') { 
            if(typeof window.renderMistakeSelection === 'function') window.renderMistakeSelection(); 
            document.getElementById('embedded-chat-section').classList.remove('hidden'); 
            document.getElementById('conversation-log').classList.remove('hidden');
            if(typeof window.startAlwaysOnListening === 'function') window.startAlwaysOnListening();
        } 
        else { 
            const subjectView = document.getElementById('subject-selection-view'); 
            if (subjectView) subjectView.classList.remove('hidden'); 
            window.updateNellMessage("どの教科にするのかにゃ？", "normal", false); 
            if (m === 'explain' || m === 'grade') {
                document.getElementById('embedded-chat-section').classList.remove('hidden');
                document.getElementById('conversation-log').classList.remove('hidden');
                if(typeof window.startAlwaysOnListening === 'function') window.startAlwaysOnListening();
            }
        }
    } catch (e) {
        console.error("selectMode Error:", e);
        alert("エラーが発生したにゃ。再読み込みしてにゃ。");
    }
};

// ==========================================
// ログ管理
// ==========================================

window.addLogItem = function(role, text) {
    const container = document.getElementById('log-content');
    if (!container) return;
    const div = document.createElement('div');
    div.className = `log-item log-${role}`;
    const name = role === 'user' ? (currentUser ? currentUser.name : 'あなた') : 'ネル先生';
    div.innerHTML = `<span class="log-role">${name}:</span><span>${text}</span>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
};

window.addToSessionHistory = function(role, text) {
    if (!window.chatSessionHistory) window.chatSessionHistory = [];
    window.chatSessionHistory.push({ role: role, text: text });
    if (window.chatSessionHistory.length > 10) {
        window.chatSessionHistory.shift();
    }
};

window.updateNellMessage = async function(t, mood = "normal", saveToMemory = false, speak = true) {
    if (window.liveSocket && window.liveSocket.readyState === WebSocket.OPEN && window.currentMode !== 'chat') {
        speak = false;
    }

    const gameScreen = document.getElementById('screen-game');
    const isGameHidden = gameScreen ? gameScreen.classList.contains('hidden') : true;
    const targetId = isGameHidden ? 'nell-text' : 'nell-text-game';
    const el = document.getElementById(targetId);
    
    // --- 表示用テキストのクリーニング ---
    let cleanText = t || "";

    cleanText = cleanText.split('\n').filter(line => {
        const trimmed = line.trim();
        if (!trimmed) return true;
        if (/^(?:System|User|Model|Assistant|Display|Thinking)[:：]/i.test(trimmed)) return false;
        if (/^\*\*.*\*\*$/.test(trimmed)) return false;
        if (/^\[.*\]$/.test(trimmed)) return false;
        const hasJapanese = /[ぁ-んァ-ン一-龠]/.test(line);
        if (!hasJapanese && /[a-zA-Z]/.test(line)) return false;
        return true;
    }).join('\n');

    cleanText = cleanText.replace(/(?:\[|【)DISPLAY[:：].*?(?:\]|】)/gi, "");
    cleanText = cleanText.replace(/^\s*[\(（【\[].*?[\)）】\]]/gm, ""); 
    cleanText = cleanText.replace(/[\(（【\[].*?[\)）】\]]\s*$/gm, "");
    cleanText = cleanText.trim();
    
    if (el) el.innerText = cleanText;
    
    if (t && t.includes("もぐもぐ")) { if(window.safePlay) window.safePlay(window.sfxBori); }
    
    if (saveToMemory) { window.saveToNellMemory('nell', cleanText); }
    
    if (speak && typeof speakNell === 'function') {
        let textForSpeech = cleanText.replace(/【.*?】/g, "").replace(/\[.*?\]/g, "").trim();
        textForSpeech = textForSpeech.replace(/🐾/g, "");
        if (textForSpeech.length > 0) {
            await speakNell(textForSpeech, mood);
        }
    }
};

// ==========================================
// 汎用テキスト送信
// ==========================================

window.sendHttpText = async function(context) {
    let inputId;
    if (context === 'embedded') { inputId = 'embedded-text-input'; }
    else if (context === 'simple') { inputId = 'simple-text-input'; }
    else return;

    const input = document.getElementById(inputId);
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    if (window.isAlwaysListening && window.continuousRecognition) {
        try { window.continuousRecognition.stop(); } catch(e){}
    }
    
    window.addLogItem('user', text);
    window.addToSessionHistory('user', text);

    try {
        window.updateNellMessage("ん？どれどれ…", "thinking", false, true);
        
        const res = await fetch('/chat-dialogue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                text: text, 
                name: currentUser ? currentUser.name : "生徒",
                history: window.chatSessionHistory,
                location: window.currentLocation 
            })
        });

        if(res.ok) {
            const data = await res.json();
            const speechText = data.speech || data.reply || "教えてあげるにゃ！";
            window.addLogItem('nell', speechText);
            window.addToSessionHistory('nell', speechText);
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
        if (window.isAlwaysListening) {
             try { window.continuousRecognition.start(); } catch(e){}
        }
    }
};

window.sendEmbeddedText = function() { window.sendHttpText('embedded'); };
window.sendSimpleText = function() { window.sendHttpText('simple'); };

// ==========================================
// 3. その他共通機能
// ==========================================

window.startMouthAnimation = function() {
    let toggle = false;
    setInterval(() => {
        const img = document.getElementById('nell-face') || document.querySelector('.nell-avatar-wrap img');
        if (!img) return;
        let baseImg = window.defaultIcon;
        let talkImg = window.talkIcon;
        if (window.currentSubject && window.subjectImages[window.currentSubject] && 
           (window.currentMode === 'explain' || window.currentMode === 'grade' || window.currentMode === 'review')) {
            baseImg = window.subjectImages[window.currentSubject].base;
            talkImg = window.subjectImages[window.currentSubject].talk;
        }
        if (window.isNellSpeaking) img.src = toggle ? talkImg : baseImg;
        else img.src = baseImg;
        toggle = !toggle;
    }, 150);
};
window.startMouthAnimation();

// ページロード時にも位置情報取得を試みる
window.addEventListener('DOMContentLoaded', () => {
    window.fetchCurrentLocation(); 

    // DOMContentLoaded でのイベント設定
    const camIn = document.getElementById('hw-input-camera'); 
    const albIn = document.getElementById('hw-input-album'); 
    if(camIn) camIn.addEventListener('change', (e) => { if(window.handleFileUpload) window.handleFileUpload(e.target.files[0]); e.target.value=''; });
    if(albIn) albIn.addEventListener('change', (e) => { if(window.handleFileUpload) window.handleFileUpload(e.target.files[0]); e.target.value=''; });
    const startCamBtn = document.getElementById('start-webcam-btn');
    if (startCamBtn && window.startHomeworkWebcam) startCamBtn.onclick = window.startHomeworkWebcam;
});

window.saveToNellMemory = function(role, text) {
    if (!currentUser || !currentUser.id) return;
    const trimmed = text.trim();
    if (trimmed.length <= 1) return;
    
    window.chatTranscript += `${role === 'user' ? '生徒' : 'ネル'}: ${trimmed}\n`;
    const newItem = { role: role, text: trimmed, time: new Date().toISOString() };
    try {
        const memoryKey = `nell_raw_chat_log_${currentUser.id}`;
        let history = JSON.parse(localStorage.getItem(memoryKey) || '[]');
        if (history.length > 0 && history[history.length - 1].text === trimmed) return;
        history.push(newItem);
        if (history.length > 50) history.shift(); 
        localStorage.setItem(memoryKey, JSON.stringify(history));
    } catch(e) {}
};

window.setSubject = function(s) { 
    window.currentSubject = s; 
    const icon = document.querySelector('.nell-avatar-wrap img'); if(icon&&window.subjectImages[s]){icon.src=window.subjectImages[s].base; icon.onerror=()=>{icon.src=window.defaultIcon;};} 
    document.getElementById('subject-selection-view').classList.add('hidden'); 
    document.getElementById('upload-controls').classList.remove('hidden'); 
    window.updateNellMessage(`${window.currentSubject}の問題をみせてにゃ！`, "happy", false); 
    const btnFast = document.getElementById('mode-btn-fast');
    const btnPrec = document.getElementById('mode-btn-precision');
    if (btnFast) { btnFast.innerText = "📷 ネル先生に宿題を見せる"; btnFast.className = "main-btn"; btnFast.style.background = "#ff85a1"; btnFast.style.width = "100%"; btnFast.onclick = null; }
    if (btnPrec) btnPrec.style.display = "none";
};

window.setAnalyzeMode = function(type) { window.analysisType = 'precision'; };

// ==========================================
// ★ タイマー関連
// ==========================================

window.openTimerModal = function() {
    document.getElementById('timer-modal').classList.remove('hidden');
    window.updateTimerDisplay(); 
};
window.closeTimerModal = function() {
    document.getElementById('timer-modal').classList.add('hidden');
};
window.setTimer = function(minutes) {
    if (window.studyTimerRunning) return;
    window.studyTimerValue += minutes * 60;
    window.updateTimerDisplay();
};
window.resetTimer = function() {
    if (window.studyTimerRunning) {
        clearInterval(window.studyTimerInterval);
        window.studyTimerRunning = false;
        document.getElementById('timer-toggle-btn').innerText = "スタート！";
        document.getElementById('timer-toggle-btn').className = "main-btn pink-btn";
    }
    window.studyTimerValue = 0;
    window.studyTimerCheck = 0;
    window.updateTimerDisplay();
    document.getElementById('mini-timer-display').classList.add('hidden');
};
window.toggleTimer = function() {
    if (window.studyTimerRunning) {
        clearInterval(window.studyTimerInterval);
        window.studyTimerRunning = false;
        document.getElementById('timer-toggle-btn').innerText = "再開する";
        document.getElementById('timer-toggle-btn').className = "main-btn blue-btn";
    } else {
        if (window.studyTimerValue <= 0) return alert("時間をセットしてにゃ！");
        window.studyTimerRunning = true;
        window.studyTimerCheck = 0;
        document.getElementById('timer-toggle-btn').innerText = "一時停止";
        document.getElementById('timer-toggle-btn').className = "main-btn gray-btn";
        document.getElementById('mini-timer-display').classList.remove('hidden');
        window.closeTimerModal();
        
        window.updateNellMessage("今からネル先生が時間を計ってやるにゃ", "normal", false, true);
        
        window.studyTimerInterval = setInterval(() => {
            if (window.studyTimerValue > 0) {
                window.studyTimerValue--;
                window.studyTimerCheck++;
                window.updateTimerDisplay();
                
                if (window.studyTimerValue === 600) window.updateNellMessage("10分前だにゃ〜。お茶でも飲んで落ち着くにゃ。", "gentle", false, true);
                else if (window.studyTimerValue === 300) window.updateNellMessage("あと5分。一歩ずつ、一歩ずつだにゃ〜。", "normal", false, true);
                else if (window.studyTimerValue === 180) window.updateNellMessage("3分前。深呼吸して、もうひと踏ん張りだにゃ。", "excited", false, true);
                else if (window.studyTimerValue === 60) window.updateNellMessage("あと1分だにゃ。最後までネル先生が見守ってるにゃ。", "excited", false, true);
            } else {
                clearInterval(window.studyTimerInterval);
                window.studyTimerRunning = false;
                document.getElementById('timer-toggle-btn').innerText = "スタート！";
                document.getElementById('timer-toggle-btn').className = "main-btn pink-btn";
                if(window.safePlay) window.safePlay(window.sfxChime); 
                window.updateNellMessage("時間だにゃ！お疲れ様だにゃ〜。さ、ゆっくり休むにゃ。", "happy", false, true);
                document.getElementById('mini-timer-display').classList.add('hidden');
                window.openTimerModal();
            }
        }, 1000);
    }
};
window.updateTimerDisplay = function() {
    const m = Math.floor(window.studyTimerValue / 60).toString().padStart(2, '0');
    const s = (window.studyTimerValue % 60).toString().padStart(2, '0');
    const timeStr = `${m}:${s}`;
    const modalDisplay = document.getElementById('modal-timer-display');
    if(modalDisplay) modalDisplay.innerText = timeStr;
    const miniDisplay = document.getElementById('mini-timer-text');
    if(miniDisplay) miniDisplay.innerText = timeStr;
};

window.updateMiniKarikari = function() { if(currentUser) { const el = document.getElementById('mini-karikari-count'); if(el) el.innerText = currentUser.karikari; const el2 = document.getElementById('karikari-count'); if(el2) el2.innerText = currentUser.karikari; } };
window.showKarikariEffect = function(amount) { const container = document.querySelector('.nell-avatar-wrap'); if(container) { const floatText = document.createElement('div'); floatText.className = 'floating-text'; floatText.innerText = amount > 0 ? `+${amount}` : `${amount}`; floatText.style.color = amount > 0 ? '#ff9100' : '#ff5252'; floatText.style.right = '0px'; floatText.style.top = '0px'; container.appendChild(floatText); setTimeout(() => floatText.remove(), 1500); } };

window.giveLunch = function() { 
    if (currentUser.karikari < 1) return window.updateNellMessage("カリカリがないにゃ……", "thinking", false); 
    
    // まず「もぐもぐ」を表示・発話
    window.updateNellMessage("もぐもぐ……", "normal", false); 
    
    currentUser.karikari--; 
    if(typeof saveAndSync === 'function') saveAndSync(); 
    window.updateMiniKarikari(); 
    window.showKarikariEffect(-1); 
    window.lunchCount++; 
    
    fetch('/lunch-reaction', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ count: window.lunchCount, name: currentUser.name }) })
        .then(r => r.json())
        .then(d => { 
            // サーバーからのレスポンスが返ったら即座に反映
            window.updateNellMessage(d.reply || "おいしいにゃ！", d.isSpecial ? "excited" : "happy", true); 
        })
        .catch(e => { 
            window.updateNellMessage("おいしいにゃ！", "happy", false); 
        }); 
}; 

// ※ ゲームロジックは js/game-engine.js に移動済み

window.renderMistakeSelection = function() { 
    if (!currentUser.mistakes || currentUser.mistakes.length === 0) { 
        window.updateNellMessage("ノートは空っぽにゃ！", "happy", false); 
        setTimeout(window.backToLobby, 2000); 
        return; 
    } 
    window.transcribedProblems = currentUser.mistakes; 
    window.renderProblemSelection(); 
    window.updateNellMessage("復習するにゃ？", "excited", false); 
};

// ==========================================
// 4. ヒント・採点UI関連
// ==========================================

window.startHint = function(id) {
    if (window.initAudioContext) window.initAudioContext().catch(e=>{});
    window.selectedProblem = window.transcribedProblems.find(p => p.id == id); 
    if (!window.selectedProblem) return window.updateNellMessage("データエラーだにゃ", "thinking", false);
    if (!window.selectedProblem.currentHintLevel) window.selectedProblem.currentHintLevel = 1;
    if (window.selectedProblem.maxUnlockedHintLevel === undefined) window.selectedProblem.maxUnlockedHintLevel = 0;
    ['problem-selection-view', 'grade-sheet-container', 'answer-display-area', 'chalkboard'].forEach(i => { const el = document.getElementById(i); if(el) el.classList.add('hidden'); });
    document.getElementById('final-view').classList.remove('hidden'); document.getElementById('hint-detail-container').classList.remove('hidden');
    const board = document.getElementById('chalkboard'); if(board) { board.innerText = window.selectedProblem.question; board.classList.remove('hidden'); }
    document.getElementById('main-back-btn').classList.add('hidden');
    window.updateNellMessage("ヒントを見るにゃ？", "thinking", false);
    window.renderHintUI();
    window.scrollTo({ top: 0, behavior: 'instant' });
};
window.renderHintUI = function() {
    const p = window.selectedProblem; const maxUnlocked = p.maxUnlockedHintLevel;
    const hintBtnsContainer = document.querySelector('.hint-btns');
    hintBtnsContainer.innerHTML = `<div class="hint-step-badge" id="hint-step-label">考え方</div>`;
    let nextCost = 0, nextLabel = ""; let nextLevel = maxUnlocked + 1;
    if (nextLevel === 1) { nextCost = 5; nextLabel = "カリカリ(×5)でヒントをもらう"; }
    else if (nextLevel === 2) { nextCost = 5; nextLabel = "カリカリ(×5)でさらにヒントをもらう"; }
    else if (nextLevel === 3) { nextCost = 10; nextLabel = "カリカリ(×10)で大ヒントをもらう"; }
    if (nextLevel <= 3) {
        const unlockBtn = document.createElement('button'); unlockBtn.className = "main-btn blue-btn"; unlockBtn.innerText = nextLabel; unlockBtn.onclick = () => window.unlockNextHint(nextLevel, nextCost); hintBtnsContainer.appendChild(unlockBtn);
    } else {
        const revealBtn = document.createElement('button'); revealBtn.className = "main-btn orange-btn"; revealBtn.innerText = "答えを見る"; revealBtn.onclick = window.revealAnswer; hintBtnsContainer.appendChild(revealBtn);
    }
    if (maxUnlocked > 0) {
        const reviewContainer = document.createElement('div'); reviewContainer.style.display = "flex"; reviewContainer.style.gap = "5px"; reviewContainer.style.marginTop = "10px"; reviewContainer.style.flexWrap = "wrap";
        for (let i = 1; i <= maxUnlocked; i++) { const btn = document.createElement('button'); btn.className = "main-btn gray-btn"; btn.style.fontSize = "0.9rem"; btn.style.padding = "8px"; btn.style.flex = "1"; btn.innerText = `ヒント${i}を見る`; btn.onclick = () => window.showHintText(i); reviewContainer.appendChild(btn); }
        hintBtnsContainer.appendChild(reviewContainer);
    }
    const ansDiv = document.createElement('div'); ansDiv.id = "answer-display-area"; ansDiv.className = "answer-box hidden"; ansDiv.innerHTML = `ネル先生の答え：<br><span id="final-answer-text"></span>`; hintBtnsContainer.appendChild(ansDiv);
};
window.unlockNextHint = function(level, cost) {
    if (window.initAudioContext) window.initAudioContext();
    if (currentUser.karikari < cost) return window.updateNellMessage(`カリカリが足りないにゃ…あと${cost}個！`, "thinking", false);
    currentUser.karikari -= cost; saveAndSync(); window.updateMiniKarikari(); window.showKarikariEffect(-cost);
    window.selectedProblem.maxUnlockedHintLevel = level;
    window.showHintText(level); window.renderHintUI();
};
window.showHintText = function(level) {
    const hints = window.selectedProblem.hints || []; const text = hints[level - 1] || "ヒントが見つからないにゃ...";
    window.updateNellMessage(text, "thinking", false);
    const hl = document.getElementById('hint-step-label'); if(hl) hl.innerText = `ヒント Lv.${level}`; 
};
window.revealAnswer = function() {
    const ansArea = document.getElementById('answer-display-area'); const finalTxt = document.getElementById('final-answer-text');
    const correctArr = Array.isArray(window.selectedProblem.correct_answer) ? window.selectedProblem.correct_answer : [window.selectedProblem.correct_answer];
    let displayAnswer = correctArr.map(part => part.split('|')[0]).join(', ');
    if (ansArea && finalTxt) { finalTxt.innerText = displayAnswer; ansArea.classList.remove('hidden'); ansArea.style.display = "block"; }
    const btns = document.querySelectorAll('.hint-btns button.orange-btn'); btns.forEach(b => b.classList.add('hidden'));
    window.updateNellMessage(`答えは「${displayAnswer}」だにゃ！`, "gentle", false); 
};
function createProblemItem(p, mode) {
    const isGradeMode = (mode === 'grade'); let markHtml = "", bgStyle = "background:white;";
    let correctList = Array.isArray(p.correct_answer) ? p.correct_answer : [String(p.correct_answer)];
    correctList = correctList.map(s => String(s).trim()).filter(s => s !== ""); 
    let studentList = Array.isArray(p.student_answer) ? p.student_answer : [String(p.student_answer)];
    if (isGradeMode) {
        let isCorrect = p.is_correct;
        if (isCorrect === undefined) { if (correctList.length !== studentList.length) isCorrect = false; else { isCorrect = true; for(let i=0; i<correctList.length; i++) { if (!window.isMatch(studentList[i] || "", correctList[i])) { isCorrect = false; break; } } } }
        const mark = isCorrect ? "⭕" : "❌"; const markColor = isCorrect ? "#ff5252" : "#4a90e2"; bgStyle = isCorrect ? "background:#fff5f5;" : "background:#f0f8ff;";
        markHtml = `<div id="mark-${p.id}" style="font-weight:900; color:${markColor}; font-size:2rem; width:50px; text-align:center; flex-shrink:0;">${mark}</div>`;
    } else { markHtml = `<div id="mark-${p.id}" style="font-weight:900; color:#4a90e2; font-size:2rem; width:50px; text-align:center; flex-shrink:0;"></div>`; }
    let inputHtml = "";
    if (correctList.length > 1) {
        inputHtml = `<div style="display:grid; grid-template-columns: 1fr 1fr; gap:5px; width:100%;">`;
        for (let i = 0; i < correctList.length; i++) { let val = studentList[i] || ""; const onInput = isGradeMode ? `oninput="window.checkMultiAnswer(${p.id}, event)"` : ""; inputHtml += `<input type="text" value="${val}" class="multi-input-${p.id}" ${onInput} style="width:100%; padding:8px; border:2px solid #ddd; border-radius:8px; font-size:1rem; font-weight:bold; color:#333; min-width:0; box-sizing:border-box;">`; }
        inputHtml += `</div>`;
    } else {
        const val = studentList[0] || ""; const onInput = isGradeMode ? `oninput="window.checkAnswerDynamically(${p.id}, this, event)"` : ""; const idAttr = isGradeMode ? "" : `id="single-input-${p.id}"`;
        inputHtml = `<div style="width:100%;"><input type="text" ${idAttr} value="${val}" ${onInput} style="width:100%; padding:8px; border:2px solid #ddd; border-radius:8px; font-size:1rem; font-weight:bold; color:#333; box-sizing:border-box;"></div>`;
    }
    let buttonsHtml = "";
    if (isGradeMode) { buttonsHtml = `<div style="display:flex; flex-direction:column; gap:5px; width:80px; flex-shrink:0; justify-content:center; margin-left:auto;"><button class="mini-teach-btn" onclick="window.startHint(${p.id})" style="width:100%;">教えて</button></div>`; } 
    else { buttonsHtml = `<div style="display:flex; flex-direction:column; gap:5px; width:80px; flex-shrink:0; margin-left:auto;"><button class="mini-teach-btn" onclick="window.checkOneProblem(${p.id})" style="background:#ff85a1; width:100%;">採点</button><button class="mini-teach-btn" onclick="window.startHint(${p.id})" style="width:100%;">教えて</button></div>`; }
    const div = document.createElement('div'); div.className = "grade-item"; div.id = `grade-item-${p.id}`; div.style.cssText = `border-bottom:1px solid #eee; padding:15px; margin-bottom:10px; border-radius:10px; ${bgStyle}`; 
    div.innerHTML = `<div style="display:flex; align-items:center; width:100%;">${markHtml}<div style="flex:1; margin-left:10px; display:flex; flex-direction:column; min-width:0;"><div style="font-size:0.9rem; color:#888; margin-bottom:4px;">${p.label || '問'}</div><div style="font-weight:bold; font-size:0.9rem; margin-bottom:8px; width:100%; word-break:break-all;">${p.question}</div><div style="display:flex; gap:10px; align-items:flex-start; width:100%; justify-content:space-between;"><div style="flex:1; min-width:0; margin-right:5px;">${inputHtml}<div style="font-size:0.7rem; color:#666; margin-top:4px;">キミの答え (直せるよ)</div></div>${buttonsHtml}</div></div></div>`; 
    return div;
}

window.showGradingView = function(silent = false) { 
    document.getElementById('problem-selection-view').classList.add('hidden'); document.getElementById('final-view').classList.remove('hidden'); document.getElementById('grade-sheet-container').classList.remove('hidden'); document.getElementById('hint-detail-container').classList.add('hidden'); 
    const container = document.getElementById('problem-list-grade'); container.innerHTML = ""; 
    window.transcribedProblems.forEach(p => { container.appendChild(createProblemItem(p, 'grade')); }); 
    const btnDiv = document.createElement('div'); btnDiv.style.textAlign = "center"; btnDiv.style.marginTop = "20px"; btnDiv.innerHTML = `<button onclick="window.finishGrading(this)" class="main-btn orange-btn">💯 採点おわり！</button>`; container.appendChild(btnDiv); 
    if (!silent) { window.updateGradingMessage(); } 
};
window.renderProblemSelection = function() { 
    document.getElementById('problem-selection-view').classList.remove('hidden'); 
    const l = document.getElementById('transcribed-problem-list'); l.innerHTML = ""; 
    window.transcribedProblems.forEach(p => { l.appendChild(createProblemItem(p, 'explain')); }); 
    const btn = document.querySelector('#problem-selection-view button.orange-btn'); if (btn) { btn.disabled = false; btn.innerText = "✨ ぜんぶわかったにゃ！"; } 
};
window.normalizeAnswer = function(str) { if (!str) return ""; let normalized = str.trim().replace(/[\u30a1-\u30f6]/g, m => String.fromCharCode(m.charCodeAt(0) - 0x60)); return normalized; };
window.isMatch = function(student, correctString) { const s = window.normalizeAnswer(student); const options = window.normalizeAnswer(correctString).split('|'); return options.some(opt => opt === s); };
window.checkMultiAnswer = function(id, event) {
    if (window.isComposing) return; const problem = window.transcribedProblems.find(p => p.id === id);
    if (problem) { const inputs = document.querySelectorAll(`.multi-input-${id}`); const userValues = Array.from(inputs).map(input => input.value); problem.student_answer = userValues; }
    if(window.gradingTimer) clearTimeout(window.gradingTimer); window.gradingTimer = setTimeout(() => { window._performCheckMultiAnswer(id); }, 1000);
};
window._performCheckMultiAnswer = function(id) {
    const problem = window.transcribedProblems.find(p => p.id === id); if (!problem) return;
    const userValues = problem.student_answer; const correctList = Array.isArray(problem.correct_answer) ? problem.correct_answer : [problem.correct_answer];
    let allCorrect = false;
    if (userValues.length === correctList.length) { const usedIndices = new Set(); let matchCount = 0; for (const uVal of userValues) { for (let i = 0; i < correctList.length; i++) { if (!usedIndices.has(i)) { if (window.isMatch(uVal, correctList[i])) { usedIndices.add(i); matchCount++; break; } } } } allCorrect = (matchCount === correctList.length); }
    problem.is_correct = allCorrect; window.updateMarkDisplay(id, allCorrect); if (window.currentMode === 'grade') window.updateGradingMessage();
    if (allCorrect) { if(window.safePlay) window.safePlay(window.sfxMaru); } else if (userValues.some(v => v.trim().length > 0)) { if(window.safePlay) window.safePlay(window.sfxBatu); }
};
window.checkAnswerDynamically = function(id, inputElem, event) { 
    if (window.isComposing) return; const problem = window.transcribedProblems.find(p => p.id === id); if(problem) problem.student_answer = [inputElem.value]; const val = inputElem.value;
    if(window.gradingTimer) clearTimeout(window.gradingTimer); window.gradingTimer = setTimeout(() => { window._performCheckAnswerDynamically(id, val); }, 1000);
};
window._performCheckAnswerDynamically = function(id, val) {
    const problem = window.transcribedProblems.find(p => p.id === id); if (!problem) return;
    const correctVal = Array.isArray(problem.correct_answer) ? problem.correct_answer[0] : problem.correct_answer;
    const isCorrect = window.isMatch(val, String(correctVal)); problem.is_correct = isCorrect; window.updateMarkDisplay(id, isCorrect); if (window.currentMode === 'grade') window.updateGradingMessage();
    if (isCorrect) { if(window.safePlay) window.safePlay(window.sfxMaru); } else if (val.trim().length > 0) { if(window.safePlay) window.safePlay(window.sfxBatu); }
};
window.checkOneProblem = function(id) { 
    const problem = window.transcribedProblems.find(p => p.id === id); if (!problem) return; 
    const correctList = Array.isArray(problem.correct_answer) ? problem.correct_answer : [problem.correct_answer];
    let userValues = []; 
    if (correctList.length > 1) { const inputs = document.querySelectorAll(`.multi-input-${id}`); userValues = Array.from(inputs).map(i => i.value); } else { const input = document.getElementById(`single-input-${id}`); if(input) userValues = [input.value]; } 
    let isCorrect = false; 
    if (userValues.length === correctList.length) { const usedIndices = new Set(); let matchCount = 0; for (const uVal of userValues) { for (let i = 0; i < correctList.length; i++) { if (!usedIndices.has(i)) { if (window.isMatch(uVal, correctList[i])) { usedIndices.add(i); matchCount++; break; } } } } isCorrect = (matchCount === correctList.length); } 
    if (isCorrect) { if(window.safePlay) window.safePlay(window.sfxMaru); } else { if(window.safePlay) window.safePlay(window.sfxBatu); } 
    const markElem = document.getElementById(`mark-${id}`); const container = document.getElementById(`grade-item-${id}`); 
    if (markElem && container) { if (isCorrect) { markElem.innerText = "⭕"; markElem.style.color = "#ff5252"; container.style.backgroundColor = "#fff5f5"; window.updateNellMessage("正解だにゃ！すごいにゃ！", "excited", false); } else { markElem.innerText = "❌"; markElem.style.color = "#4a90e2"; container.style.backgroundColor = "#f0f8ff"; window.updateNellMessage("おしい！もう一回考えてみて！", "gentle", false); } } 
};
window.updateMarkDisplay = function(id, isCorrect) { const container = document.getElementById(`grade-item-${id}`); const markElem = document.getElementById(`mark-${id}`); if (container && markElem) { if (isCorrect) { markElem.innerText = "⭕"; markElem.style.color = "#ff5252"; container.style.backgroundColor = "#fff5f5"; } else { markElem.innerText = "❌"; markElem.style.color = "#4a90e2"; container.style.backgroundColor = "#f0f8ff"; } } };

// ★修正箇所: 正解数カウントの初期値を0にし、満点判定を修正
window.updateGradingMessage = function() { 
    let correctCount = 0; 
    window.transcribedProblems.forEach(p => { if (p.is_correct) correctCount++; }); 
    
    const total = window.transcribedProblems.length || 1;
    
    if (correctCount === window.transcribedProblems.length) {
        window.updateNellMessage(`全問正解だにゃ！天才だにゃ〜！！`, "excited", false); 
    } else if (correctCount >= total * 0.5) {
        window.updateNellMessage(`あと${total - correctCount}問！直してみるにゃ！`, "happy", false); 
    } else {
        window.updateNellMessage(`間違ってても大丈夫！入力し直してみて！`, "gentle", false); 
    }
};

window.backToProblemSelection = function() { 
    document.getElementById('final-view').classList.add('hidden'); document.getElementById('hint-detail-container').classList.add('hidden'); document.getElementById('chalkboard').classList.add('hidden'); document.getElementById('answer-display-area').classList.add('hidden'); 
    if (window.currentMode === 'grade') window.showGradingView(); else { window.renderProblemSelection(); window.updateNellMessage("他も見るにゃ？", "normal", false); } 
    const backBtn = document.getElementById('main-back-btn'); if(backBtn) { backBtn.classList.remove('hidden'); backBtn.onclick = window.backToLobby; } 
    if (window.selectedProblem && window.selectedProblem.id) { setTimeout(() => { const targetId = `grade-item-${window.selectedProblem.id}`; const targetElement = document.getElementById(targetId); if (targetElement) { targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' }); const originalBg = targetElement.style.backgroundColor; targetElement.style.transition = "background-color 0.3s"; targetElement.style.backgroundColor = "#fff9c4"; setTimeout(() => { targetElement.style.backgroundColor = originalBg; }, 800); } }, 100); }
};
window.pressThanks = function() { window.backToProblemSelection(); };
window.finishGrading = async function(btnElement) { if(btnElement) { btnElement.disabled = true; btnElement.innerText = "採点完了！"; } if (currentUser) { currentUser.karikari += 100; saveAndSync(); window.updateMiniKarikari(); window.showKarikariEffect(100); } await window.updateNellMessage("よくがんばったにゃ！カリカリ100個あげる！", "excited", false); setTimeout(() => { if(typeof window.backToLobby === 'function') window.backToLobby(true); }, 3000); };
window.pressAllSolved = function(btnElement) { if(btnElement) { btnElement.disabled = true; btnElement.innerText = "すごい！"; } if (currentUser) { currentUser.karikari += 100; saveAndSync(); window.showKarikariEffect(100); window.updateMiniKarikari(); window.updateNellMessage("よくがんばったにゃ！カリカリ100個あげるにゃ！", "excited", false).then(() => { setTimeout(() => { if(typeof window.backToLobby === 'function') window.backToLobby(true); }, 3000); }); } };