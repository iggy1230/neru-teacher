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