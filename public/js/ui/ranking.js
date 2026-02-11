// --- js/ui/ranking.js (v1.0: ランキング機能) ---

window.showRanking = async function() {
    window.switchScreen('screen-ranking');
    const container = document.getElementById('ranking-list-container');
    if (!container) return;

    container.innerHTML = '<p style="text-align:center; padding:20px; color:#666;">集計中にゃ...</p>';

    if (!db) {
        container.innerHTML = '<p style="text-align:center; color:red;">データベースにつながってないにゃ...</p>';
        return;
    }

    try {
        // カリカリの多い順に上位30名を取得
        // ※Firestoreで自動的に単一フィールドインデックスが効くはずですが、
        // エラーが出る場合はコンソールのリンクからインデックスを作成してください。
        const snapshot = await db.collection("users")
            .orderBy("karikari", "desc")
            .limit(30)
            .get();

        container.innerHTML = ""; // クリア

        if (snapshot.empty) {
            container.innerHTML = '<p style="text-align:center; padding:20px;">まだ誰もいないにゃ...</p>';
            return;
        }

        let rank = 1;
        snapshot.forEach(doc => {
            const userData = doc.data();
            const el = createRankingItem(rank, userData);
            container.appendChild(el);
            rank++;
        });

        // 自分の順位を表示（簡易的: 上位30位にいればハイライト済み）
        // ※正確な全ユーザー中の順位を出すには別途Cloud Functions等が必要なため、
        // ここではリスト表示のみとします。

    } catch (e) {
        console.error("Ranking fetch error:", e);
        container.innerHTML = '<p style="text-align:center; color:red;">ランキングが見れないにゃ...<br>(インターネットの調子が悪いかも？)</p>';
    }
};

function createRankingItem(rank, user) {
    const div = document.createElement('div');
    div.className = `ranking-item rank-${rank}`;
    if (rank <= 3) div.classList.add('top-rank');

    // 現在のユーザーならハイライト
    if (currentUser && user.id === currentUser.id) {
        div.classList.add('current-user-rank');
    }

    // アイコン（なければデフォルト）
    const iconSrc = user.photo || 'assets/images/characters/nell-normal.png';
    const name = user.name || "ななしの猫";
    const grade = user.grade ? `${user.grade}年生` : "";
    const score = user.karikari || 0;

    // 順位バッジ
    let rankBadge = `<span class="rank-num">${rank}</span>`;
    if (rank === 1) rankBadge = `<span class="rank-medal">🥇</span>`;
    else if (rank === 2) rankBadge = `<span class="rank-medal">🥈</span>`;
    else if (rank === 3) rankBadge = `<span class="rank-medal">🥉</span>`;

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
            <span class="rank-score">🍖 ${score}</span>
        </div>
    `;

    return div;
}

// ロビーに戻る
window.closeRanking = function() {
    window.backToLobby();
};