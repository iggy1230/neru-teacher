// --- ui.js (完全版) ---

// 画面を切り替える基本関数
function switchScreen(to) {
    // 全ての画面を隠す
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    
    // 指定された画面だけ表示する
    const target = document.getElementById(to);
    if (target) {
        target.classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'instant' });
    }
}

// 教室内の表示切り替え（問題選択、解説、採点結果など）
function switchView(id) {
    document.getElementById('problem-selection-view').classList.add('hidden');
    document.getElementById('final-view').classList.add('hidden');
    document.getElementById('grade-sheet-container').classList.add('hidden');
    document.getElementById('hint-detail-container').classList.add('hidden');
    document.getElementById('chalkboard').classList.add('hidden'); // 黒板も一旦隠す
    
    const target = document.getElementById(id);
    if(target) target.classList.remove('hidden');
}

// --- ボタン用アクション ---

// トップ画面：「新しく入学するにゃ」ボタン
function showEnrollment() {
    switchScreen('screen-enrollment');
    // user.jsにある関数を呼び出して準備完了状態にする
    if (typeof loadFaceModels === 'function') {
        loadFaceModels();
    }
}

// 入学・ロビー：「もどる」「帰宅する」ボタン
function backToGate() {
    switchScreen('screen-gate');
}

// 教室・出席簿：「教室にもどる」ボタン
function backToLobby() {
    switchScreen('screen-lobby');
    // ネル先生のメッセージをリセット
    if (currentUser) {
        updateNellMessage(getNellGreeting(currentUser), "happy");
    }
}

// ロビー：「出席簿をみる」ボタン
function showAttendance() {
    switchScreen('screen-attendance');
    if (typeof renderAttendance === 'function') {
        renderAttendance();
    }
}

// 教室：「他の問題へ」ボタン
function backToProblemSelection() {
    switchView('problem-selection-view');
    updateNellMessage("次はどの問題にするにゃ？", "normal");
}

// プログレスバーの更新
function updateProgress(p) {
    const bar = document.getElementById('progress-bar');
    if (bar) bar.style.width = p + '%';
    const txt = document.getElementById('progress-percent');
    if (txt) txt.innerText = Math.floor(p);
}