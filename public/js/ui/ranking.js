// --- js/ui/ranking.js (v468.3: ランキング単位統一版) ---

window.showRanking = async function(rankingType = 'karikari', title = '🏆 カリカリランキング') {
    window.switchScreen('screen-ranking');
    const container = document.getElementById('ranking-list-container');
    const titleEl = document.getElementById('ranking-subtitle');
    const myScoreEl = document.getElementById('ranking-myscore');
    
    if (!container) return;

    if (titleEl) titleEl.innerText = title;
    if (myScoreEl) myScoreEl.innerText = '';

    container.innerHTML = '<p style="text-align:center; padding:20px; color:#666;">集計中にゃ...</p>';

    if (!db) {
        container.innerHTML = '<p style="text-align:center; color:red;">データベースにつながってないにゃ...</p>';
        return;
    }

    try {
        let snapshot;
        let query;

        // クエリ分岐
        if (rankingType === 'karikari') {
            // 既存のカリカリランキング
            query = db.collection("users").orderBy("karikari", "desc").limit(30);
        } else {
            // ゲーム別ランキング (highscoresコレクションを使用)
            query = db.collection("highscores")
                      .where("gameKey", "==", rankingType)
                      .orderBy("score", "desc")
                      .limit(3); // 3位まで
        }

        try {
            snapshot = await query.get();
        } catch (e) {
            console.error("Firestore Query Error:", e);
            if (e.code === 'permission-denied') {
                throw new Error("PERMISSION_DENIED");
            }
            if (e.code === 'failed-precondition') {
                container.innerHTML = '<p style="text-align:center; padding:20px;">ランキングの準備中だにゃ...<br><span style="font-size:0.8rem;">(管理者がインデックスを作成中かも)</span></p>';
                return;
            }
            throw e;
        }

        container.innerHTML = ""; // クリア

        if (snapshot.empty) {
            container.innerHTML = '<p style="text-align:center; padding:20px;">まだ誰もいないにゃ...</p>';
            return;
        }

        let rank = 1;
        let myRankData = null;

        snapshot.forEach(doc => {
            const data = doc.data();
            // ゲームランキングの場合、userデータ構造に変換して渡す
            let userData = data;
            
            if (rankingType !== 'karikari') {
                userData = {
                    id: data.userId,
                    name: data.userName,
                    photo: data.userPhoto,
                    grade: data.userGrade,
                    // 表示用スコアとして渡す
                    displayScore: data.score 
                };
                
                // 自分のデータかチェック
                if (currentUser && data.userId === currentUser.id) {
                    myRankData = { rank: rank, score: data.score };
                }
            } else {
                if (currentUser && data.id === currentUser.id) {
                    myRankData = { rank: rank, score: data.karikari };
                }
            }

            const el = createRankingItem(rank, userData, rankingType);
            container.appendChild(el);
            rank++;
        });

        // 自分のランク表示
        if (rankingType !== 'karikari' && currentUser && !myRankData) {
            const localScore = localStorage.getItem(`nell_highscore_${rankingType}_${currentUser.id}`);
            if (localScore) {
                // ★修正: 単位をカリカリ(🍖)に変更
                myScoreEl.innerText = `あなたのハイスコア: 🍖 ${localScore}`;
            } else {
                myScoreEl.innerText = "まだ記録がないにゃ。";
            }
        } else if (myRankData) {
            // ★修正: 単位をカリカリ(🍖)に統一
            myScoreEl.innerText = `あなたは ${myRankData.rank}位 (🍖 ${myRankData.score}) だにゃ！`;
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

window.createRankingItem = function(rank, user, rankingType) {
    const div = document.createElement('div');
    div.className = `ranking-item rank-${rank}`;
    if (rank <= 3) div.classList.add('top-rank');

    // 現在のユーザーならハイライト
    if (currentUser && user.id === currentUser.id) {
        div.classList.add('current-user-rank');
    }

    const iconSrc = user.photo || 'assets/images/characters/nell-normal.png';
    const name = user.name || "ななしの猫";
    const grade = user.grade ? (user.grade.includes('年') ? user.grade : `${user.grade}年生`) : "";
    
    // スコアの取得元を分岐
    let score = 0;
    if (user.displayScore !== undefined) {
        score = user.displayScore;
    } else {
        score = user.karikari !== undefined ? user.karikari : 0;
    }

    // 順位バッジ
    let rankBadge = `<span class="rank-num">${rank}</span>`;
    if (rank === 1) rankBadge = `<span class="rank-medal">🥇</span>`;
    else if (rank === 2) rankBadge = `<span class="rank-medal">🥈</span>`;
    else if (rank === 3) rankBadge = `<span class="rank-medal">🥉</span>`;

    // 数値フォーマットと単位
    const formattedScore = score.toLocaleString();
    
    // ★修正: 常に「🍖」を表示するように変更（点数表記を廃止）
    const scoreDisplay = `🍖 ${formattedScore}`;

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

// ロビーに戻る
window.closeRanking = function() {
    window.backToLobby();
};