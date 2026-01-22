// --- memory.js (完全版 v230.0: 図鑑データ対応版) ---

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
            last_topic: "",
            collection: [] // ★追加: 図鑑データ
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

        // 配列リカバリー
        if (Array.isArray(profile)) {
            profile = profile[0];
        }

        // ★追加: 既存ユーザーにcollectionがない場合の補完
        const defaultProfile = Memory.createEmptyProfile();
        if (!profile) return defaultProfile;
        if (!profile.collection) profile.collection = [];

        return profile;
    };

    // プロフィールを保存
    Memory.saveUserProfile = async function(userId, profile) {
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

    // サーバー更新用（変更なし）
    Memory.updateProfileFromChat = async function(userId, chatLog) {
        if (!chatLog || chatLog.length < 10) return;
        const currentProfile = await Memory.getUserProfile(userId);
        try {
            const res = await fetch('/update-memory', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentProfile, chatLog })
            });
            if (res.ok) {
                let newProfile = await res.json();
                if (Array.isArray(newProfile)) newProfile = newProfile[0];
                
                // ★重要: サーバーはcollectionを知らないので、上書きされないように復元する
                newProfile.collection = currentProfile.collection || [];
                
                await Memory.saveUserProfile(userId, newProfile);
            }
        } catch(e) {}
    };

    // コンテキスト生成
    Memory.generateContextString = async function(userId) {
        const p = await Memory.getUserProfile(userId);
        let context = "";
        if (p.nickname) context += `・あだ名: ${p.nickname}\n`;
        if (p.birthday) context += `・誕生日: ${p.birthday}\n`; 
        if (p.likes && p.likes.length > 0) context += `・好きなもの: ${p.likes.join(", ")}\n`;
        
        // ★追加: 直近のコレクション情報をAIに教える
        if (p.collection && p.collection.length > 0) {
            // 直近3つのコレクションを教える
            const recentItems = p.collection.slice(0, 3).map(i => i.name).join(", ");
            context += `・最近見せてくれたもの図鑑: ${recentItems}\n`;
        }
        
        return context;
    };

    // ★追加: 図鑑にアイテムを追加する関数
    Memory.addToCollection = async function(userId, itemName, imageBase64) {
        try {
            const profile = await Memory.getUserProfile(userId);
            if (!profile.collection) profile.collection = [];
            
            // 重複チェック: 同じ名前があれば更新、なければ先頭に追加
            const existingIndex = profile.collection.findIndex(i => i.name === itemName);
            
            const newItem = {
                name: itemName,
                image: imageBase64,
                date: new Date().toISOString()
            };

            if (existingIndex !== -1) {
                // 既存のものを更新して先頭に移動させるか、単に更新するか
                // ここでは単純に更新
                profile.collection[existingIndex] = newItem;
            } else {
                profile.collection.unshift(newItem); // 先頭に追加
            }

            // 容量制限（画像のBase64は重いので、最新30件くらいに制限）
            if (profile.collection.length > 30) {
                profile.collection = profile.collection.slice(0, 30);
            }

            await Memory.saveUserProfile(userId, profile);
            console.log(`[Memory] Collection updated: ${itemName}`);
        } catch (e) {
            console.error("[Memory] Add Collection Error:", e);
        }
    };

    global.NellMemory = Memory;
})(window);