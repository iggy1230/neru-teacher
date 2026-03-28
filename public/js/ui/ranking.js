// --- START OF FILE ranking.js ---

// --- js/ui/ranking.js (v470.16: 構文エラー修正・自習室対応版) ---

const QUIZ_GENRES =[
    "一般知識", "雑学", "芸能・スポーツ", "歴史・地理・社会", "ゲーム", 
    "マインクラフト", "ロブロックス", "ポケモン", "魔法陣グルグル", 
    "ジョジョの奇妙な冒険", "STPR", "夏目友人帳"
];

const RANKING_TYPES =[
    { id: 'karikari', label: '🍖 カリカリ所持数' },
    { id: 'lunch_total', label: '🍽️ 給食番長' },
    { id: 'karikari_catch', label: '🎾 キャッチ' },
    { id: 'vs_robot', label: '🤖 VS掃除機' },
    { id: 'memory_match', label: '🃏 神経衰弱' },
    { id: 'minitest_total', label: '📝 ミニテスト' },
    { id: 'kanji_drill', label: '✍️ 漢字ドリル' },
    { id: 'map_master', label: '🗾 地図マスター' },
    { id: 'self_study', label: '✏️ 自習マスター' }
];

// クイズジャンルを追加
QUIZ_GENRES.forEach(g => {
    RANKING_TYPES.push({ id: `quiz_${g}`, label: `🎤 Q:${g}` });
});

window.showRanking = async function(rankingType = 'karikari', title = '🏆 カリカリランキング') {
    window.switchScreen('screen-ranking');
    
    if (title === '🏆 カリカリランキング') {
        const typeObj = RANKING_TYPES.find(t => t.id === rankingType);
        if (typeObj) title = `🏆 ${typeObj.label} ランキング`;
    }

    const container = document.getElementById('ranking-list-container');
    const titleEl = document.getElementById('ranking-subtitle');
    const myScoreEl = document.getElementById('ranking-myscore');
    
    if (!container) return;

    if (titleEl) titleEl.innerText = title;
    if (myScoreEl) myScoreEl.innerText = '';

    window.renderRankingMenu(rankingType);

    container.innerHTML = '<p style="text-align:center; padding:20px; color:#666;">集計中にゃ...</p>';

    if (!db) {
        container.innerHTML = '<p style="text-align:center; color:red;">データベースにつながってないにゃ...</p>';
        return;
    }

    try {
        let snapshot;
        let query;

        if (rankingType === 'karikari') {
            query = db.collection("users").orderBy("karikari", "desc").limit(30);
        } else if (rankingType === 'lunch_total') {
            query = db.collection("users").orderBy("totalLunchGiven", "desc").limit(30);
        } else {
            query = db.collection("highscores")
                      .where("gameKey", "==", rankingType)
                      .orderBy("score", "desc")
                      .limit(30);
        }

        try {
            snapshot = await query.get();
        } catch (e) {
            console.error("Firestore Query Error:", e);
            if (e.code === 'permission-denied') { throw new Error("PERMISSION_DENIED"); }
            if (e.code === 'failed-precondition') {
                container.innerHTML = '<p style="text-align:center; padding:20px;">ランキングの準備中だにゃ...<br><span style="font-size:0.8rem;">(管理者がインデックスを作成中かも)</span></p>';
                return;
            }
            throw e;
        }

        container.innerHTML = ""; 

        if (snapshot.empty) {
            container.innerHTML = '<p style="text-align:center; padding:20px;">まだ誰もいないにゃ...</p>';
            return;
        }

        let rank = 1;
        let myRankData = null;

        snapshot.forEach(doc => {
            const data = doc.data();
            let userData = data;
            
            if (rankingType !== 'karikari' && rankingType !== 'lunch_total') {
                userData = {
                    id: data.userId,
                    name: data.userName,
                    photo: data.userPhoto,
                    grade: data.userGrade,
                    displayScore: data.score 
                };
                if (currentUser && data.userId === currentUser.id) {
                    myRankData = { rank: rank, score: data.score };
                }
            } else {
                let targetScore = 0;
                if (rankingType === 'karikari') targetScore = data.karikari;
                if (rankingType === 'lunch_total') targetScore = data.totalLunchGiven || 0;

                userData.displayScore = targetScore;

                if (currentUser && data.id === currentUser.id) {
                    myRankData = { rank: rank, score: targetScore };
                }
            }

            const el = createRankingItem(rank, userData, rankingType);
            container.appendChild(el);
            rank++;
        });

        if (myRankData) {
            let unit = rankingType === 'self_study' ? '回' : '🍖'; 
            myScoreEl.innerText = `あなたは ${myRankData.rank}位 (${myRankData.score.toLocaleString()} ${unit}) だにゃ！`;
        } else if (rankingType !== 'karikari' && rankingType !== 'lunch_total' && currentUser) {
            const localScore = localStorage.getItem(`nell_highscore_${rankingType}_${currentUser.id}`);
            if (localScore) {
                 let unit = rankingType === 'self_study' ? '回' : '🍖';
                myScoreEl.innerText = `あなたのハイスコア: ${parseInt(localScore).toLocaleString()} ${unit}`;
            } else {
                myScoreEl.innerText = "まだ記録がないにゃ。";
            }
        } else if (currentUser) {
            let currentScore = 0;
            if (rankingType === 'karikari') currentScore = currentUser.karikari;
            if (rankingType === 'lunch_total') currentScore = currentUser.totalLunchGiven || 0;
            if (rankingType === 'self_study') currentScore = currentUser.selfStudyCount || 0;
            let unit = rankingType === 'self_study' ? '回' : '🍖';
            myScoreEl.innerText = `あなたは 圏外 (${currentScore.toLocaleString()} ${unit}) だにゃ...`;
        }

    } catch (e) {
        console.error("Ranking fetch error:", e);
        if (e.message === "PERMISSION_DENIED" || e.code === 'permission-denied') {
            container.innerHTML = '<p style="text-align:center; color:#d32f2f; padding:20px;">ランキングが見れないにゃ。<br><span style="font-size:0.8rem;">(Firebaseのルール設定が必要です)</span></p>';
        } else {
            container.innerHTML = '<p style="text-align:center; color:red;">ランキングが見れないにゃ...<br>(インターネットの調子が悪いかも？)</p>';
        }
    }
};

window.renderRankingMenu = function(currentType) {
    const menu = document.getElementById('ranking-menu');
    if (!menu) return;
    
    menu.innerHTML = "";
    
    RANKING_TYPES.forEach(type => {
        const btn = document.createElement('button');
        btn.className = `ranking-tab-btn ${type.id === currentType ? 'active' : ''}`;
        btn.innerText = type.label;
        btn.onclick = () => window.showRanking(type.id);
        menu.appendChild(btn);
    });
};

window.createRankingItem = function(rank, user, rankingType) {
    const div = document.createElement('div');
    div.className = `ranking-item rank-${rank}`;
    if (rank <= 3) div.classList.add('top-rank');

    if (currentUser && user.id === currentUser.id) {
        div.classList.add('current-user-rank');
    }

    const iconSrc = user.photo || 'assets/images/characters/nell-normal.png';
    const name = user.name || "ななしの猫";
    const grade = user.grade ? (user.grade.includes('年') ? user.grade : `${user.grade}年生`) : "";
    
    let score = 0;
    if (user.displayScore !== undefined) {
        score = user.displayScore;
    } else {
        score = user.karikari !== undefined ? user.karikari : 0;
    }

    let rankBadge = `<span class="rank-num">${rank}</span>`;
    if (rank === 1) rankBadge = `<span class="rank-medal">🥇</span>`;
    else if (rank === 2) rankBadge = `<span class="rank-medal">🥈</span>`;
    else if (rank === 3) rankBadge = `<span class="rank-medal">🥉</span>`;

    const formattedScore = score.toLocaleString();
    const unit = rankingType === 'self_study' ? '回' : '🍖';
    const scoreDisplay = `${formattedScore} ${unit}`;

    div.innerHTML = `
        <div class="rank-left">
            <div class="rank-position">${rankBadge}</div>
            <img src="${iconSrc}" class="rank-icon" loading="lazy">
            <div class="rank-info">
                <div class="rank-name">${window.cleanDisplayString(name)}</div>
                <div class="rank-grade">${grade}</div>
            </div>
        </div>
        <div class="rank-right">
            <span class="rank-score">${scoreDisplay}</span>
        </div>
    `;

    return div;
}

window.closeRanking = function() {
    window.backToLobby();
};