// --- memory.js (完全版 v276.1: 図鑑保存数修正版) ---

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
            collection: [] // 図鑑データ
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

        // 既存ユーザーにcollectionがない場合の補完
        const defaultProfile = Memory.createEmptyProfile();
        if (!profile) return defaultProfile;
        if (!Array.isArray(profile.collection)) profile.collection = []; // 配列であることを保証

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

    // サーバー更新用
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
                
                // サーバーはcollectionを知らないので復元する
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
        
        if (p.collection && p.collection.length > 0) {
            const recentItems = p.collection.slice(0, 3).map(i => i.name).join(", ");
            context += `・最近見せてくれたもの図鑑: ${recentItems}\n`;
        }
        
        return context;
    };

    // 図鑑にアイテムを追加
    Memory.addToCollection = async function(userId, itemName, imageBase64, description = "") {
        console.log(`[Memory] addToCollection: ${itemName}`);
        try {
            const profile = await Memory.getUserProfile(userId);
            
            // 配列の再確認
            if (!Array.isArray(profile.collection)) {
                profile.collection = [];
            }
            
            const newItem = {
                name: itemName,
                image: imageBase64,
                date: new Date().toISOString(),
                description: description 
            };

            // 先頭に追加
            profile.collection.unshift(newItem); 

            // 容量制限（50件まで保持）
            if (profile.collection.length > 50) {
                profile.collection = profile.collection.slice(0, 50);
            }

            await Memory.saveUserProfile(userId, profile);
            console.log(`[Memory] Collection added. Total items: ${profile.collection.length}`);
        } catch (e) {
            console.error("[Memory] Add Collection Error:", e);
        }
    };
    
    // アイテム削除
    Memory.deleteFromCollection = async function(userId, index) {
        try {
            const profile = await Memory.getUserProfile(userId);
            if (profile.collection && profile.collection[index]) {
                const deletedName = profile.collection[index].name;
                profile.collection.splice(index, 1);
                await Memory.saveUserProfile(userId, profile);
                console.log(`[Memory] Deleted item: ${deletedName}`);
            }
        } catch(e) { console.error("[Memory] Delete Error:", e); }
    };
    
    Memory.updateLatestCollectionItem = async function(userId, newName) {};

    global.NellMemory = Memory;
})(window);