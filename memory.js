// --- memory.js (v5.0: 保存条件緩和版) ---

(function(global) {
    const Memory = {};

    // 空のプロフィールを作成
    Memory.createEmptyProfile = function() {
        return {
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

        return profile || Memory.createEmptyProfile();
    };

    // プロフィールを保存
    Memory.saveUserProfile = async function(userId, profile) {
        localStorage.setItem(`nell_profile_${userId}`, JSON.stringify(profile));

        if (typeof db !== 'undefined' && db !== null) {
            try {
                await db.collection("users").doc(userId).set({ profile: profile }, { merge: true });
            } catch(e) { console.error("Firestore Profile Save Error:", e); }
        }
    };

    // サーバーに要約を依頼して更新する
    Memory.updateProfileFromChat = async function(userId, chatLog) {
        // ★修正: 10文字あれば記憶するように条件を緩和（テスト用）
        if (!chatLog || chatLog.length < 10) {
            console.log("会話が短すぎるので記憶しないにゃ。");
            return;
        }

        const currentProfile = await Memory.getUserProfile(userId);

        try {
            console.log("🧠 記憶の更新を開始するにゃ...");
            const res = await fetch('/update-memory', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    currentProfile: currentProfile,
                    chatLog: chatLog
                })
            });

            if (res.ok) {
                const newProfile = await res.json();
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
        
        let context = "";
        if (p.likes && p.likes.length > 0) context += `・好きなもの: ${p.likes.join(", ")}\n`;
        if (p.weaknesses && p.weaknesses.length > 0) context += `・苦手なこと: ${p.weaknesses.join(", ")} (励まして！)\n`;
        if (p.achievements && p.achievements.length > 0) context += `・最近の頑張り: ${p.achievements.join(", ")} (褒めて！)\n`;
        if (p.last_topic) context += `・前の話題: ${p.last_topic}\n`;
        
        return context;
    };

    global.NellMemory = Memory;
})(window);