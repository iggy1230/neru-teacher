// --- js/state/memory.js (v381.0: メモリ最適化版) ---

(function(global) {
    const Memory = {};

    function base64ToBlob(base64, mimeType = 'image/jpeg') {
        const parts = base64.split(';base64,');
        const raw = window.atob(parts.length > 1 ? parts[1] : base64);
        const rawLength = raw.length;
        const uInt8Array = new Uint8Array(rawLength);
        for (let i = 0; i < rawLength; ++i) {
            uInt8Array[i] = raw.charCodeAt(i);
        }
        return new Blob([uInt8Array], { type: mimeType });
    }

    async function deleteImageFromStorage(url) {
        if (!window.fireStorage || !url) return;
        try {
            const ref = window.fireStorage.refFromURL(url);
            await ref.delete();
            console.log("Deleted old image from Storage:", url);
        } catch(e) {
            console.warn("Storage Delete Failed (Ignored):", e);
        }
    }

    Memory.createEmptyProfile = function() {
        return {
            nickname: "",
            birthday: "", 
            likes: [],
            weaknesses: [],
            achievements: [],
            last_topic: "",
            collection: []
        };
    };

    Memory.getUserProfile = async function(userId) {
        let profile = null;
        if (typeof db !== 'undefined' && db !== null) {
            try {
                const doc = await db.collection("users").doc(userId).get();
                if (doc.exists && doc.data().profile) {
                    profile = doc.data().profile;
                }
            } catch(e) { console.error("Firestore Profile Load Error:", e); }
        }
        if (!profile) {
            const key = `nell_profile_${userId}`;
            try { profile = JSON.parse(localStorage.getItem(key)); } catch {}
        }
        if (Array.isArray(profile)) profile = profile[0];
        const defaultProfile = Memory.createEmptyProfile();
        if (!profile) return defaultProfile;
        if (!Array.isArray(profile.collection)) profile.collection = []; 
        return profile;
    };

    Memory.saveUserProfile = async function(userId, profile) {
        if (Array.isArray(profile)) profile = profile[0] || Memory.createEmptyProfile();
        
        // ★最適化: プロフィール保存後に変数を解放
        const profileStr = JSON.stringify(profile);
        localStorage.setItem(`nell_profile_${userId}`, profileStr);
        
        if (typeof db !== 'undefined' && db !== null) {
            try {
                await db.collection("users").doc(userId).set({ profile: profile }, { merge: true });
            } catch(e) { console.error("Firestore Profile Save Error:", e); }
        }
    };

    Memory.updateProfileFromChat = async function(userId, chatLog) {
        if (!chatLog || chatLog.length < 10) return;
        const currentProfile = await Memory.getUserProfile(userId);
        
        // ★最適化: コレクションデータは重いので更新チェックから除外して送信サイズを減らす
        const { collection, ...profileForAnalysis } = currentProfile;
        
        try {
            const res = await fetch('/update-memory', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentProfile: profileForAnalysis, chatLog })
            });
            
            if (res.ok) {
                const data = await res.json();
                let newProfile = data.profile || data; 
                if (Array.isArray(newProfile)) newProfile = newProfile[0];
                
                const updatedProfile = {
                    ...newProfile,
                    collection: collection || [] // 元のコレクションを戻す
                };
                
                await Memory.saveUserProfile(userId, updatedProfile);

                if (data.summary_text && data.summary_text.length > 0 && data.summary_text !== "（更新なし）") {
                    window.saveToNellMemory('nell', `【会話のまとめ】 ${data.summary_text}`);
                }
            }
        } catch(e) {
            console.warn("Profile update failed, keeping existing data.", e);
        }
    };

    Memory.generateContextString = async function(userId) {
        const p = await Memory.getUserProfile(userId);
        let context = "";
        if (p.nickname) context += `・あだ名: ${p.nickname}\n`;
        if (p.birthday) context += `・誕生日: ${p.birthday}\n`; 
        if (p.likes && p.likes.length > 0) context += `・好きなもの: ${p.likes.join(", ")}\n`;
        if (p.weaknesses && p.weaknesses.length > 0) context += `・苦手なもの: ${p.weaknesses.join(", ")}\n`;
        
        if (p.collection && p.collection.length > 0) {
            const recentItems = p.collection.slice(0, 3).map(i => i.name).join(", ");
            context += `・最近見せてくれたもの図鑑: ${recentItems}\n`;
        }
        return context;
    };

    // ★修正: rarity 引数を追加
    Memory.addToCollection = async function(userId, itemName, imageBase64, description = "", realDescription = "", location = null, rarity = 1) {
        console.log(`[Memory] addToCollection: ${itemName}, Rarity: ${rarity}`);
        try {
            const profile = await Memory.getUserProfile(userId);
            if (!Array.isArray(profile.collection)) profile.collection = [];
            
            let imageUrl = imageBase64; 
            if (window.fireStorage && typeof db !== 'undefined' && db !== null) {
                try {
                    const blob = base64ToBlob(imageBase64);
                    const timestamp = Date.now();
                    const storagePath = `user_images/${userId}/${timestamp}.jpg`;
                    const storageRef = window.fireStorage.ref().child(storagePath);
                    const snapshot = await storageRef.put(blob);
                    imageUrl = await snapshot.ref.getDownloadURL(); 
                    console.log("Image uploaded to Storage:", imageUrl);
                } catch (uploadError) {
                    console.warn("Storage upload failed, falling back to Base64", uploadError);
                }
            }

            const newItem = {
                name: itemName,
                image: imageUrl, 
                date: new Date().toISOString(),
                description: description,
                realDescription: realDescription,
                location: location,
                rarity: rarity
            };

            profile.collection.unshift(newItem); 
            const maxLimit = (imageUrl.startsWith('http')) ? 500 : 30;

            if (profile.collection.length > maxLimit) {
                const removedItems = profile.collection.splice(maxLimit, profile.collection.length - maxLimit);
                for (const item of removedItems) {
                    if (item.image && item.image.startsWith('http')) {
                        await deleteImageFromStorage(item.image);
                    }
                }
            }
            await Memory.saveUserProfile(userId, profile);
            
            // ★最適化: 処理が終わったら変数を解放
            imageUrl = null;
            imageBase64 = null;
            
        } catch (e) {
            console.error("[Memory] Add Collection Error:", e);
        }
    };
    
    Memory.deleteFromCollection = async function(userId, index) {
        try {
            const profile = await Memory.getUserProfile(userId);
            if (profile.collection && profile.collection[index]) {
                const item = profile.collection[index];
                if (item.image && item.image.startsWith('http')) {
                    await deleteImageFromStorage(item.image);
                }
                profile.collection.splice(index, 1);
                await Memory.saveUserProfile(userId, profile);
            }
        } catch(e) { console.error("[Memory] Delete Error:", e); }
    };
    
    Memory.deleteRawChatLogs = async function(userId, indicesToDelete) {
        const memoryKey = `nell_raw_chat_log_${userId}`;
        let history = [];
        try { history = JSON.parse(localStorage.getItem(memoryKey) || '[]'); } catch(e) {}
        indicesToDelete.sort((a, b) => b - a).forEach(index => {
            if (index >= 0 && index < history.length) {
                history.splice(index, 1);
            }
        });
        localStorage.setItem(memoryKey, JSON.stringify(history));
    };

    Memory.deleteProfileItem = async function(userId, category, itemContent) {
        const profile = await Memory.getUserProfile(userId);
        if (category === 'birthday' || category === 'nickname' || category === 'last_topic') {
            profile[category] = "";
        } else if (Array.isArray(profile[category])) {
            profile[category] = profile[category].filter(i => i !== itemContent);
        }
        await Memory.saveUserProfile(userId, profile);
    };

    global.NellMemory = Memory;
})(window);