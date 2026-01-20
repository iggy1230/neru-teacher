// --- memory.js (v219.0: データ構造自動修復版) ---

(function(global) {
    const Memory = {};

    // 空のプロフィールを作成
    Memory.createEmptyProfile = function() {
        return {
            nickname: "",
            birthday: "", 
            likes: [],
            weaknesses: [],
            achievements: [],
            last_topic: ""
        };
    };

    // プロフィールを取得
    Memory.getUserProfile = async function(userId) {
        let profile = null;

        // 1. Firestoreから取得
        if (typeof db !== 'undefined' && db !== null) {
            try {
                const doc = await db.collection("users").doc(userId).get();
                if (doc.exists && doc.data().profile) {
                    profile = doc.data().profile;
                }
            } catch(e) { console.error("Firestore Profile Load Error:", e); }
        }

        // 2. なければLocalStorage
        if (!profile) {
            const key = `nell_profile_${userId}`;
            try {
                profile = JSON.parse(localStorage.getItem(key));
            } catch {}
        }

        // ★修正: 配列で保存されてしまっていた場合のリカバリー
        if (Array.isArray(profile)) {
            console.warn("【Memory】配列形式のプロフィールを検出。オブジェクトに変換します。");
            profile = profile[0];
        }

        return profile || Memory.createEmptyProfile();
    };

    // プロフィールを保存
    Memory.saveUserProfile = async function(userId, profile) {
        // ★修正: 保存前に必ずオブジェクトであることを確認
        if (Array.isArray(profile)) {
            profile = profile[0] || Memory.createEmptyProfile();
        }

        localStorage.setItem(`nell_profile_${userId}`, JSON.stringify(profile));

        if (typeof db !== 'undefined' && db !== null) {
            try {
                await db.collection("users").doc(userId).set({ profile: profile }, { merge: true });
            } catch(e) { console.error("Firestore Profile Save Error:", e); }
        }
    };

    // サーバーに要約を依頼して更新する
    Memory.updateProfileFromChat = async function(userId, chatLog) {
        if (!chatLog || chatLog.length < 10) {
            console.log("【Memory】会話が短すぎるため更新スキップ");
            return;
        }

        const currentProfile = await Memory.getUserProfile(userId);

        try {
            console.log("🧠 記憶の更新リクエスト送信中...");
            const res = await fetch('/update-memory', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    currentProfile: currentProfile,
                    chatLog: chatLog
                })
            });

            if (res.ok) {
                let newProfile = await res.json();
                
                // ★重要修正: AIが配列で返してきた場合、中身を取り出す
                if (Array.isArray(newProfile)) {
                    console.log("【Memory】AI返答が配列でした。オブジェクトに修正します。");
                    newProfile = newProfile[0];
                }

                await Memory.saveUserProfile(userId, newProfile);
                console.log("✨ 記憶が更新されたにゃ！", newProfile);
            }
        } catch(e) {
            console.error("Memory Update Failed:", e);
        }
    };

    // ネル先生に渡す「コンテキスト文字列」を作る
    Memory.generateContextString = async function(userId) {
        const p = await Memory.getUserProfile(userId);
        
        console.log("【Memory】ネル先生に渡すプロフィール:", p); // デバッグ用ログ

        let context = "";
        if (p.nickname) context += `・あだ名: ${p.nickname}\n`;
        if (p.birthday) context += `・誕生日: ${p.birthday}\n`; 
        if (p.likes && p.likes.length > 0) context += `・好きなもの: ${p.likes.join(", ")}\n`;
        if (p.weaknesses && p.weaknesses.length > 0) context += `・苦手なこと: ${p.weaknesses.join(", ")} (励まして！)\n`;
        if (p.achievements && p.achievements.length > 0) context += `・最近の頑張り: ${p.achievements.join(", ")} (褒めて！)\n`;
        if (p.last_topic) context += `・前の話題: ${p.last_topic}\n`;
        
        return context;
    };

    global.NellMemory = Memory;
})(window);