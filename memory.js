// --- memory.js (記憶システム) ---

(function(global) {
    const Memory = {};

    // --- 初期構造 ---
    Memory.createEmptyMemory = function() {
        return {
            profile: { nickname: null },
            studyHabits: {},    // 例: math_weak: 2
            personalLikes: {},  // 例: pokemon: 2
            episodes: []        // 最大10件
        };
    };

    // --- Load / Save ---
    Memory.loadMemory = function(studentId) {
        const key = `neruMemory_${studentId}`;
        const raw = localStorage.getItem(key);
        if (!raw) return Memory.createEmptyMemory();
        try {
            return JSON.parse(raw);
        } catch {
            return Memory.createEmptyMemory();
        }
    };

    Memory.saveMemory = function(studentId, memory) {
        localStorage.setItem(`neruMemory_${studentId}`, JSON.stringify(memory));
    };

    // --- AI要約結果の反映 (分類ロジック) ---
    Memory.applySummarizedNotes = function(studentId, summarizedLines) {
        const memory = Memory.loadMemory(studentId);
        
        summarizedLines.forEach(line => {
            applySingleLine(memory, line);
        });

        trimEpisodes(memory);
        Memory.saveMemory(studentId, memory);
        console.log("📝 記憶を更新しました:", memory);
    };

    function applySingleLine(memory, text) {
        if (!text) return;

        // 学習傾向
        if (contains(text, ["算数", "数学", "計算"])) {
            increase(memory.studyHabits, "math_weak"); // 文脈問わず話題に出たらカウント(簡易化)
            addEpisode(memory, text);
            return;
        }
        if (contains(text, ["国語", "漢字", "本"])) {
            increase(memory.studyHabits, "japanese_interest");
            addEpisode(memory, text);
            return;
        }

        // 趣味・好き
        if (contains(text, ["ポケモン", "ピカチュウ"])) {
            increase(memory.personalLikes, "pokemon");
            return;
        }
        if (contains(text, ["マリオ", "ゲーム"])) {
            increase(memory.personalLikes, "game");
            return;
        }
        if (contains(text, ["スプラ", "イカ"])) {
            increase(memory.personalLikes, "splatoon");
            return;
        }
        if (contains(text, ["猫", "ねこ", "ネコ"])) {
            increase(memory.personalLikes, "cat");
            return;
        }

        // プロフィール（呼び方指定など）
        if (text.includes("呼んで")) {
            const name = extractNickname(text);
            if (name) memory.profile.nickname = name;
            return;
        }

        // その他エピソード
        addEpisode(memory, text);
    }

    // --- ユーティリティ ---
    function increase(obj, key) {
        obj[key] = (obj[key] || 0) + 1;
    }

    function addEpisode(memory, text) {
        // 重複チェック
        if (!memory.episodes.includes(text)) {
            memory.episodes.push(text);
        }
    }

    function trimEpisodes(memory) {
        if (memory.episodes.length > 10) {
            memory.episodes = memory.episodes.slice(-10);
        }
    }

    function contains(text, keywords) {
        return keywords.some(k => text.includes(k));
    }

    function extractNickname(text) {
        // "〇〇って呼んで" から〇〇を抽出
        const match = text.match(/「?(.+?)」?って呼んで/);
        return match ? match[1].trim() : null;
    }

    // --- コンテキストに応じた記憶の選択 (1つだけ) ---
    Memory.pickMemoryForContext = function(studentId, scene) {
        const memory = Memory.loadMemory(studentId);
        const candidates = [];

        // シーン別優先度
        if (scene === "chat") {
            // 好きなものの話題
            if ((memory.personalLikes.pokemon || 0) >= 2) candidates.push("この子はポケモンが大好きだにゃ。");
            if ((memory.personalLikes.game || 0) >= 2) candidates.push("この子はゲームが大好きだにゃ。");
            if ((memory.personalLikes.cat || 0) >= 1) candidates.push("この子は猫が大好きだにゃ。");
            
            // 呼び方
            if (memory.profile.nickname) candidates.push(`呼び方は「${memory.profile.nickname}」にしてほしいみたいだにゃ。`);
            
            // 最近のエピソード(ランダム)
            if (memory.episodes.length > 0) {
                const latest = memory.episodes[memory.episodes.length - 1];
                candidates.push(`そういえば「${latest}」という話があったにゃ。`);
            }
        }

        // 勉強モード
        if (scene === "study" || scene === "math" || scene === "kokugo") {
             if ((memory.studyHabits.math_weak || 0) >= 2) candidates.push("算数に少し苦手意識があるかもしれないにゃ。優しくしてにゃ。");
        }

        if (candidates.length === 0) return null;

        // ランダムに1つ返す
        return candidates[Math.floor(Math.random() * candidates.length)];
    };

    global.NellMemory = Memory;

})(window);