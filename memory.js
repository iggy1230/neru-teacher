// --- memory.js (記憶システム v2.1: キーワード拡充版) ---

(function(global) {
    const Memory = {};

    // --- 初期構造 ---
    Memory.createEmptyMemory = function() {
        return {
            profile: { nickname: null },
            studyHabits: {},    // 例: math_weak: 2
            personalLikes: {},  // 例: pokemon: 2, sports: 1
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
        console.log("💾 記憶を保存しました:", memory);
    };

    // --- AI要約結果の反映 (分類ロジック) ---
    Memory.applySummarizedNotes = function(studentId, summarizedLines) {
        console.log("🧠 AI要約を受信:", summarizedLines);
        const memory = Memory.loadMemory(studentId);
        let updated = false;

        summarizedLines.forEach(line => {
            if (line && typeof line === 'string') {
                applySingleLine(memory, line);
                updated = true;
            }
        });

        if (updated) {
            trimEpisodes(memory);
            Memory.saveMemory(studentId, memory);
        }
    };

    function applySingleLine(memory, text) {
        console.log("🔍 分析中:", text);

        // プロフィール（呼び方指定）
        if (text.match(/呼んで|あだ名|呼び方|名前/)) {
            const name = extractNickname(text);
            if (name) {
                memory.profile.nickname = name;
                console.log("✅ ニックネーム登録:", name);
                return;
            }
        }

        // 学習傾向
        if (contains(text, ["算数", "数学", "計算", "足し算", "引き算", "掛け算", "割り算", "数字"])) {
            increase(memory.studyHabits, "math_weak");
            addEpisode(memory, text);
            return;
        }
        if (contains(text, ["国語", "漢字", "本", "読書", "音読", "作文", "文字"])) {
            increase(memory.studyHabits, "japanese_interest");
            addEpisode(memory, text);
            return;
        }
        if (contains(text, ["理科", "実験", "観察", "虫", "植物"])) {
            increase(memory.studyHabits, "science_interest");
            addEpisode(memory, text);
            return;
        }
        if (contains(text, ["社会", "地図", "歴史", "昔", "地域"])) {
            increase(memory.studyHabits, "social_interest");
            addEpisode(memory, text);
            return;
        }

        // 趣味・好き (★ここを強化)
        if (contains(text, ["サッカー", "野球", "バスケ", "スポーツ", "運動", "ドッジボール", "水泳", "ダンス"])) {
            increase(memory.personalLikes, "sports");
            console.log("✅ スポーツ好きとして記録");
            return;
        }
        if (contains(text, ["ポケモン", "ピカチュウ", "ポケットモンスター"])) {
            increase(memory.personalLikes, "pokemon");
            return;
        }
        if (contains(text, ["マリオ", "ゲーム", "スイッチ", "Switch", "マイクラ", "スプラ", "ゼルダ"])) {
            increase(memory.personalLikes, "game");
            return;
        }
        if (contains(text, ["猫", "ねこ", "ネコ", "ぬこ", "にゃんこ"])) {
            increase(memory.personalLikes, "cat");
            return;
        }
        if (contains(text, ["犬", "いぬ", "イヌ", "わんこ"])) {
            increase(memory.personalLikes, "dog");
            return;
        }
        if (contains(text, ["絵", "お絵かき", "イラスト", "図工", "工作"])) {
            increase(memory.personalLikes, "art");
            return;
        }
        if (contains(text, ["YouTube", "ユーチューブ", "動画", "アニメ", "テレビ"])) {
            increase(memory.personalLikes, "media");
            return;
        }
        if (contains(text, ["ハンバーグ", "カレー", "寿司", "お肉", "お菓子", "給食"])) {
            increase(memory.personalLikes, "food");
            return;
        }

        // その他エピソード
        addEpisode(memory, text);
        console.log("✅ 一般エピソードとして記録");
    }

    // --- ユーティリティ ---
    function increase(obj, key) {
        obj[key] = (obj[key] || 0) + 1;
    }

    function addEpisode(memory, text) {
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
        let match = text.match(/「(.+?)」って呼んで/);
        if (!match) match = text.match(/「(.+?)」が良い/);
        if (!match) match = text.match(/あだ名は「?(.+?)」?です/);
        if (!match) match = text.match(/呼び方は「?(.+?)」?がいい/);
        if (!match) match = text.match(/(.+?)って呼んで/);
        return match ? match[1].trim() : null;
    }

    // --- コンテキストに応じた記憶の選択 (1つだけ) ---
    Memory.pickMemoryForContext = function(studentId, scene) {
        const memory = Memory.loadMemory(studentId);
        const candidates = [];

        console.log("🤔 記憶検索中... ID:", studentId, "Scene:", scene);

        if (scene === "chat") {
            if (memory.profile.nickname) {
                candidates.push(`この子の呼び方は「${memory.profile.nickname}」だにゃ。名前を呼んであげてにゃ。`);
            }

            // 好きなもの (回数が1回以上なら候補に入れる)
            if ((memory.personalLikes.sports || 0) >= 1) candidates.push("この子はスポーツが好きみたいだにゃ。サッカーや野球の話を振ってみてにゃ。");
            if ((memory.personalLikes.pokemon || 0) >= 1) candidates.push("この子はポケモンが大好きだにゃ。ポケモンの話を振ってみてにゃ。");
            if ((memory.personalLikes.game || 0) >= 1) candidates.push("この子はゲームが大好きだにゃ。最近やってるゲームを聞いてみてにゃ。");
            if ((memory.personalLikes.cat || 0) >= 1) candidates.push("この子は猫が大好きだにゃ。猫トークで盛り上がるにゃ。");
            if ((memory.personalLikes.dog || 0) >= 1) candidates.push("この子は犬派かもしれないにゃ。犬の話を聞いてあげてにゃ。");
            if ((memory.personalLikes.art || 0) >= 1) candidates.push("この子は絵を描くのが好きみたいだにゃ。");
            if ((memory.personalLikes.media || 0) >= 1) candidates.push("YouTubeやアニメの話が好きみたいだにゃ。");
            if ((memory.personalLikes.food || 0) >= 1) candidates.push("食べ物の話が好きみたいだにゃ。好きな給食を聞いてみてにゃ。");
            
            // 最近のエピソード
            if (memory.episodes.length > 0) {
                const latest = memory.episodes[memory.episodes.length - 1];
                candidates.push(`前回の面談で「${latest}」という話をしていたにゃ。その続きを聞いてみてにゃ。`);
            }
        }

        // 勉強モード時
        if (scene === "study" || scene === "math" || scene === "kokugo") {
             if ((memory.studyHabits.math_weak || 0) >= 1) candidates.push("算数に少し苦手意識があるかもしれないにゃ。とことん優しく教えてあげてにゃ。");
             if ((memory.studyHabits.japanese_interest || 0) >= 1) candidates.push("国語や漢字には興味があるみたいだにゃ。褒めて伸ばすにゃ。");
        }

        if (candidates.length === 0) {
            console.log("⚪ 特筆すべき記憶なし");
            return null;
        }

        const selected = candidates[Math.floor(Math.random() * candidates.length)];
        console.log("💡 選ばれた記憶:", selected);
        return selected;
    };

    global.NellMemory = Memory;

})(window);