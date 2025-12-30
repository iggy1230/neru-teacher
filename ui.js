function switchScreen(to) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    const target = document.getElementById(to);
    if (target) {
        target.classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'instant' });
    }
}

function updateProgress(p) {
    const bar = document.getElementById('progress-bar');
    if (bar) bar.style.width = p + '%';
    const txt = document.getElementById('progress-percent');
    if (txt) txt.innerText = Math.floor(p);
}

function drawHanamaru() {
    const c = document.getElementById('hanamaru-canvas');
    if (!c) return;
    c.width = window.innerWidth; c.height = window.innerHeight;
    const ctx = c.getContext('2d');
    ctx.strokeStyle = '#ff5252'; ctx.lineWidth = 10;
    let t = 0;
    function anim() {
        ctx.clearRect(0,0,c.width,c.height);
        ctx.beginPath(); ctx.arc(c.width/2, c.height/2, 100, 0, t);
        ctx.stroke();
        t += 0.2;
        if(t < 6.5) requestAnimationFrame(anim);
        else setTimeout(() => ctx.clearRect(0,0,c.width,c.height), 2000);
    }
    anim();
}

function switchView(id) {
    document.getElementById('problem-selection-view').classList.add('hidden');
    document.getElementById('final-view').classList.add('hidden');
    document.getElementById('grade-sheet-container').classList.add('hidden');
    document.getElementById('hint-detail-container').classList.add('hidden');
    document.getElementById(id).classList.remove('hidden');
}

// --- ui.js の既存コードの下に追加してください ---

// 「入学するにゃ」ボタンから呼ばれる関数
function showEnrollment() {
    switchScreen('screen-enrollment');
    // 入学画面に移動したら、顔認識モデルの読み込みを開始する
    loadFaceModels();
}

// 「もどる」「帰宅する」ボタン用
function backToGate() {
    switchScreen('screen-gate');
}

// 「教室にもどる」ボタン用
function backToLobby() {
    switchScreen('screen-lobby');
}

// 問題選択画面に戻る用（「ありがとう」ボタンなどから）
function backToProblemSelection() {
    // 画面を戻す
    switchView('problem-selection-view');
    // 必要ならメッセージをリセット
    updateNellMessage("次はどの問題にするにゃ？", "normal");
}

// 出席簿画面を表示
function showAttendance() {
    switchScreen('screen-attendance');
    renderAttendance();
}

// 出席簿の中身を描画する関数（簡易実装）
function renderAttendance() {
    const grid = document.getElementById('attendance-grid');
    if (!grid || !currentUser) return;
    grid.innerHTML = "";
    
    // currentUser.attendance が { "2025-01-01": true, ... } のようになっていると仮定
    // ここではデモとして直近の日付を表示する例
    const today = new Date();
    for (let i = 0; i < 14; i++) {
        const d = new Date();
        d.setDate(today.getDate() - i);
        const dateKey = d.toISOString().split('T')[0];
        const hasAttended = currentUser.attendance && currentUser.attendance[dateKey];
        
        const div = document.createElement('div');
        div.className = "day-box";
        div.style.background = hasAttended ? "#e3f2fd" : "#f9f9f9";
        div.style.borderColor = hasAttended ? "#2196f3" : "#eee";
        div.innerHTML = `
            <div>${d.getMonth()+1}/${d.getDate()}</div>
            <div style="font-size:1.2rem; margin-top:5px;">${hasAttended ? '💮' : '-'}</div>
        `;
        grid.appendChild(div);
    }
}