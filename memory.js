// --- memory.js (記憶システム v3.0: キーワード完全網羅版) ---

(function(global) {
    const Memory = {};

    Memory.createEmptyMemory = function() {
        return {
            profile: { nickname: null },
            studyHabits: {},    
            personalLikes: {},  
            episodes: []        
        };
    };

    Memory.loadMemory = function(studentId) {
        const key = `neruMemory_${studentId}`;
        const raw = localStorage.getItem(key);
        if (!raw) return Memory.createEmptyMemory();
        try { return JSON.parse(raw); } catch { return Memory.createEmptyMemory(); }
    };

    Memory.saveMemory = function(studentId, memory) {
        localStorage.setItem(`neruMemory_${studentId}`, JSON.stringify(memory));
        console.log("💾 記憶保存:", memory);
    };

    Memory.applySummarizedNotes = function(studentId, summarizedLines) {
        console.log("🧠 受信メモ:", summarizedLines);
        const memory = Memory.loadMemory(studentId);
        let updated = false;

        summarizedLines.forEach(line => {
            if (line && typeof line === 'string') {
                applySingleLine(memory, line);
                updated = true;
            }
        });

        if (updated) {
            // エピソードは最新10件まで
            if (memory.episodes.length > 10) memory.episodes = memory.episodes.slice(-10);
            Memory.saveMemory(studentId, memory);
        }
    };

    function applySingleLine(memory, text) {
        // プロフィール
        if (text.match(/呼んで|あだ名|呼び方|名前/)) {
            const match = text.match(/「(.+?)」/);
            if (match) { memory.profile.nickname = match[1]; return; }
        }

        // 学習傾向
        if (contains(text, ["算数", "数学", "計算"])) { increase(memory.studyHabits, "math_weak"); addEpisode(memory, text); return; }
        if (contains(text, ["国語", "漢字", "本", "読書"])) { increase(memory.studyHabits, "japanese_interest"); addEpisode(memory, text); return; }
        if (contains(text, ["理科", "実験", "観察"])) { increase(memory.studyHabits, "science_interest"); addEpisode(memory, text); return; }
        if (contains(text, ["社会", "地図", "歴史"])) { increase(memory.studyHabits, "social_interest"); addEpisode(memory, text); return; }

        // 趣味・好き (★ここを最大限強化)
        if (contains(text, ["サッカー", "野球", "バスケ", "テニス", "水泳", "ダンス", "スポーツ", "運動"])) {
            increase(memory.personalLikes, "sports");
            console.log("✅ スポーツ好き記録");
            return;
        }
        if (contains(text, ["ポケモン", "ピカチュウ"])) { increase(memory.personalLikes, "pokemon"); return; }
        if (contains(text, ["マリオ", "ゲーム", "スイッチ", "Switch", "マイクラ", "スプラ"])) { increase(memory.personalLikes, "game"); return; }
        if (contains(text, ["猫", "ねこ", "ネコ", "犬", "いぬ", "動物"])) { increase(memory.personalLikes, "animal"); return; }
        if (contains(text, ["絵", "お絵かき", "図工", "工作"])) { increase(memory.personalLikes, "art"); return; }
        if (contains(text, ["YouTube", "動画", "アニメ", "テレビ"])) { increase(memory.personalLikes, "media"); return; }
        if (contains(text, ["ハンバーグ", "カレー", "寿司", "お肉", "給食", "食べ物"])) { increase(memory.personalLikes, "food"); return; }

        // その他
        addEpisode(memory, text);
    }

    function increase(obj, key) { obj[key] = (obj[key] || 0) + 1; }
    function addEpisode(memory, text) { if (!memory.episodes.includes(text)) memory.episodes.push(text); }
    function contains(text, keywords) { return keywords.some(k => text.includes(k)); }

    Memory.pickMemoryForContext = function(studentId, scene) {
        const memory = Memory.loadMemory(studentId);
        const candidates = [];

        if (scene === "chat") {
            if (memory.profile.nickname) candidates.push(`呼び方は「${memory.profile.nickname}」だにゃ。`);
            
            // 好きカテゴリー
            if ((memory.personalLikes.sports || 0) >= 1) candidates.push("この子はスポーツが好きだにゃ。サッカーや野球の話を振ってみて。");
            if ((memory.personalLikes.pokemon || 0) >= 1) candidates.push("この子はポケモンが好きだにゃ。");
            if ((memory.personalLikes.game || 0) >= 1) candidates.push("この子はゲームが好きだにゃ。");
            if ((memory.personalLikes.animal || 0) >= 1) candidates.push("この子は動物が好きだにゃ。");
            if ((memory.personalLikes.art || 0) >= 1) candidates.push("この子は絵を描くのが好きだにゃ。");
            
            // エピソード
            if (memory.episodes.length > 0) {
                const latest = memory.episodes[memory.episodes.length - 1];
                candidates.push(`前回の話：「${latest}」。`);
            }
        }
        
        if (candidates.length === 0) return null;
        return candidates[Math.floor(Math.random() * candidates.length)];
    };

    global.NellMemory = Memory;
})(window);