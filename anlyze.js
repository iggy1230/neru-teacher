// --- anlyze.js (完全版: 戻るボタン制御修正済み) ---

let transcribedProblems = []; 
let selectedProblem = null; 
let hintIndex = 0; 
let isAnalyzing = false; 
let currentSubject = '';
let currentMode = ''; 
let lunchCount = 0; 

let liveSocket = null;
let audioContext = null;
let mediaStream = null;
let workletNode = null;
let nextStartTime = 0;
let stopSpeakingTimer = null;

let gameCanvas, ctx, ball, paddle, bricks, score, gameRunning = false, gameAnimId = null;

const gameHitComments = [
    "うまいにゃ！", "すごいにゃ！", "さすがにゃ！", "がんばれにゃ！", 
    "その調子にゃ！", "ナイスにゃ！", "お見事にゃ！", "いい音だにゃ！"
];

const subjectImages = {
    'こくご': 'nell-kokugo.png', 'さんすう': 'nell-sansu.png',
    'りか': 'nell-rika.png', 'しゃかい': 'nell-shakai.png'
};
const defaultIcon = 'nell-normal.png'; 
const talkIcon = 'nell-talk.png';

function startMouthAnimation() {
    let toggle = false;
    setInterval(() => {
        const img = document.getElementById('nell-face') || document.querySelector('.nell-avatar-wrap img');
        if (!img) return;

        let base = defaultIcon;
        if (currentSubject && subjectImages[currentSubject] && (currentMode === 'explain' || currentMode === 'grade' || currentMode === 'review')) {
            base = subjectImages[currentSubject];
        }
        let talk = base.replace('.png', '-talk.png');
        if (base === defaultIcon) talk = talkIcon;

        if (window.isNellSpeaking) {
            toggle = !toggle;
            const target = toggle ? talk : base;
            if (!img.src.endsWith(target)) img.src = target;
        } else {
            if (!img.src.endsWith(base)) img.src = base;
        }
    }, 150);
}
startMouthAnimation();

async function updateNellMessage(t, mood = "normal") {
    let targetId = 'nell-text';
    if (!document.getElementById('screen-game').classList.contains('hidden')) {
        targetId = 'nell-text-game';
    }
    const el = document.getElementById(targetId);
    if (el) el.innerText = t;
    return await speakNell(t, mood);
}

// 1. モード選択
function selectMode(m) {
    currentMode = m; 
    switchScreen('screen-main'); 
    
    // UIリセット
    const ids = ['subject-selection-view', 'upload-controls', 'thinking-view', 'problem-selection-view', 'final-view', 'chalkboard', 'chat-view', 'lunch-view'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
    
    // ★重要: モード選択直後は「ロビーに戻る」ボタンとして機能させる
    const backBtn = document.getElementById('main-back-btn');
    if (backBtn) {
        backBtn.classList.remove('hidden');
        backBtn.onclick = backToLobby; // デフォルト動作
    }

    stopLiveChat();
    gameRunning = false;

    const icon = document.querySelector('.nell-avatar-wrap img');
    if(icon) icon.src = defaultIcon;

    document.getElementById('mini-karikari-display').classList.remove('hidden');
    updateMiniKarikari();

    if (m === 'chat') {
        document.getElementById('chat-view').classList.remove('hidden');
        updateNellMessage("「おはなしする」を押してね！", "gentle");
        const btn = document.getElementById('mic-btn');
        if(btn) { 
            btn.innerText = "🎤 おはなしする"; 
            btn.onclick = startLiveChat; 
            btn.disabled = false; 
            btn.style.background = "#ff85a1"; 
            btn.style.boxShadow = "none";
        }
        const txt = document.getElementById('user-speech-text'); if(txt) txt.innerText = "（リアルタイム対話）";
    } else if (m === 'lunch') {
        document.getElementById('lunch-view').classList.remove('hidden');
        lunchCount = 0; updateNellMessage("お腹ペコペコだにゃ……", "thinking");
    } else if (m === 'review') {
        renderMistakeSelection();
    } else {
        document.getElementById('subject-selection-view').classList.remove('hidden');
        updateNellMessage("どの教科にするのかにゃ？", "normal");
    }
}

// ... (Live Chat, Game, Lunch Functions は省略。変更なし) ...
// ※実際にはここに startLiveChat, giveLunch, showGame などの関数が入ります

// 5. 分析・ヒント (ここを修正)
document.getElementById('hw-input').addEventListener('change', async (e) => {
    if (isAnalyzing || !e.target.files[0]) return; isAnalyzing = true;
    const up = document.getElementById('upload-controls'); if(up) up.classList.add('hidden');
    const th = document.getElementById('thinking-view'); if(th) th.classList.remove('hidden');
    
    // ★解析中は戻るボタンを隠す
    const backBtn = document.getElementById('main-back-btn');
    if(backBtn) backBtn.classList.add('hidden');

    let loadingMessage = "ちょっと待っててにゃ…ふむふむ…";
    if (currentUser && currentSubject) {
        loadingMessage = `ちょっと待っててにゃ…ふむふむ…${currentUser.grade}年生の${currentSubject}の問題だにゃ…`;
    }
    updateNellMessage(loadingMessage, "thinking"); 
    
    updateProgress(0); 
    let p = 0; const timer = setInterval(() => { if (p < 90) { p += 3; updateProgress(p); } }, 500);
    try {
        const b64 = await shrinkImage(e.target.files[0]);
        const res = await fetch('/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: b64, mode: currentMode, grade: currentUser.grade, subject: currentSubject }) });
        
        if (!res.ok) {
            const errText = await res.json().catch(() => ({error: "不明なエラー"}));
            throw new Error(errText.error || "サーバーエラー");
        }
        
        const data = await res.json();
        transcribedProblems = data.map((prob, index) => ({ ...prob, id: index + 1, student_answer: prob.student_answer || "", status: "unanswered" }));
        
        transcribedProblems.forEach(p => {
             const n = v => v.toString().replace(/\s/g, '').replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
             if (p.student_answer && n(p.student_answer) === n(p.correct_answer)) p.status = 'correct';
             else if (p.student_answer) p.status = 'incorrect';
        });

        clearInterval(timer); updateProgress(100);
        setTimeout(() => { 
            if(th) th.classList.add('hidden'); 
            
            // ★重要: 書き起こし完了（問題リスト表示）時は「戻るボタン」を隠す（ご要望通り）
            if(backBtn) backBtn.classList.add('hidden');

            if (currentMode === 'explain' || currentMode === 'review') { renderProblemSelection(); updateNellMessage("問題が読めたにゃ！", "happy"); } 
            else { showGradingView(); }
        }, 800);
    } catch (err) { 
        clearInterval(timer); 
        document.getElementById('thinking-view').classList.add('hidden'); 
        document.getElementById('upload-controls').classList.remove('hidden'); 
        // エラー時は戻るボタンを復活させる
        if(backBtn) backBtn.classList.remove('hidden');
        updateNellMessage("エラーだにゃ…もう一回試してにゃ", "thinking"); 
    } finally { isAnalyzing = false; e.target.value=''; }
});

function startHint(id) {
    if (window.initAudioContext) window.initAudioContext().catch(e=>{});
    selectedProblem = transcribedProblems.find(p => p.id == id); 
    if (!selectedProblem) {
        return updateNellMessage("データエラーだにゃ", "thinking");
    }

    const uiIds = ['problem-selection-view', 'grade-sheet-container', 'final-view', 'hint-detail-container', 'chalkboard', 'answer-display-area'];
    uiIds.forEach(i => { const el = document.getElementById(i); if(el) el.classList.add('hidden'); });

    const fv = document.getElementById('final-view'); if(fv) fv.classList.remove('hidden');
    const hv = document.getElementById('hint-detail-container'); if(hv) hv.classList.remove('hidden');
    const board = document.getElementById('chalkboard'); if(board) { board.innerText = selectedProblem.question; board.classList.remove('hidden'); }
    const ansArea = document.getElementById('answer-display-area'); if(ansArea) ansArea.classList.add('hidden');

    // ★重要: ヒント画面では「戻るボタン」を表示し、クリックで「問題リスト」に戻るように上書き
    const backBtn = document.getElementById('main-back-btn');
    if (backBtn) {
        backBtn.classList.remove('hidden');
        backBtn.onclick = () => {
            // 現在のモードに応じて戻るべきリスト画面を表示
            if (currentMode === 'explain' || currentMode === 'review') {
                renderProblemSelection();
            } else {
                showGradingView();
            }
            
            // ヒント画面の要素を隠す
            document.getElementById('final-view').classList.add('hidden');
            document.getElementById('hint-detail-container').classList.add('hidden');
            document.getElementById('chalkboard').classList.add('hidden');
            
            // ★リスト画面に戻ったら、また「戻るボタン」を隠す（ご要望通り）
            backBtn.classList.add('hidden');
            
            updateNellMessage("他の問題も見るにゃ？", "normal");
        };
    }

    hintIndex = 0; updateNellMessage("カリカリをくれたらヒントを出してあげてもいいにゃ🐾", "thinking"); 
    const hl = document.getElementById('hint-step-label'); if(hl) hl.innerText = "考え中...";
    const nextBtn = document.getElementById('next-hint-btn'); const revealBtn = document.getElementById('reveal-answer-btn');
    if(nextBtn) { nextBtn.innerText = "🍖 ネル先生にカリカリを5個あげてヒントをもらう"; nextBtn.classList.remove('hidden'); nextBtn.onclick = showNextHint; }
    if(revealBtn) revealBtn.classList.add('hidden');
}

// ... (showNextHint, Utils, updateAns 等の後半部分はそのまま) ...