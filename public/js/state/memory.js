// --- js/state/memory.js (v421.0: ID型エラー修正版) ---

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
        // ★修正: userIdを必ずStringにする (数値IDによるエラー回避)
        const safeId = String(userId);

        if (typeof db !== 'undefined' && db !== null) {
            try {
                const doc = await db.collection("users").doc(safeId).get();
                if (doc.exists && doc.data().profile) {
                    profile = doc.data().profile;
                }
            } catch(e) { 
                console.error("Firestore Profile Load Error:", e); 
            }
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
        // ★修正: userIdを必ずStringにする
        const safeId = String(userId);
        
        const profileStr = JSON.stringify(profile);
        localStorage.setItem(`nell_profile_${userId}`, profileStr);
        
        if (typeof db !== 'undefined' && db !== null) {
            try {
                await db.collection("users").doc(safeId).set({ profile: profile }, { merge: true });
            } catch(e) { console.error("Firestore Profile Save Error:", e); }
        }
    };

    Memory.updateProfileFromChat = async function(userId, chatLog) {
        if (!chatLog || chatLog.length < 10) return;
        const currentProfile = await Memory.getUserProfile(userId);
        
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
                    collection: collection || [] 
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

    Memory.addToCollection = async function(userId, itemName, imageBase64, description = "", realDescription = "", location = null, rarity = 1) {
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
                } catch (uploadError) {
                    console.warn("Storage upload failed", uploadError);
                }
            }

            const newItem = {
                name: itemName,
                image: imageUrl, 
                date: new Date().toISOString(),
                description: description,
                realDescription: realDescription,
                location: location,
                rarity: rarity,
                isShared: false
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

    Memory.shareToPublicCollection = async function(userId, itemIndex, discovererName) {
        if (!db) throw new Error("Database not connected");
        
        const profile = await Memory.getUserProfile(userId);
        if (!profile.collection || !profile.collection[itemIndex]) throw new Error("Item not found");
        
        const item = profile.collection[itemIndex];
        if (item.isShared) return "ALREADY_SHARED";

        await db.collection("public_collection").add({
            name: item.name,
            image: item.image,
            description: item.description,
            realDescription: item.realDescription,
            location: item.location,
            rarity: item.rarity,
            discovererName: discovererName,
            discovererId: String(userId), // String化
            sharedAt: new Date().toISOString()
        });

        item.isShared = true;
        await Memory.saveUserProfile(userId, profile);

        return "SUCCESS";
    };

    Memory.getPublicCollection = async function() {
        if (!db) return [];
        try {
            const snapshot = await db.collection("public_collection")
                .orderBy("sharedAt", "desc")
                .limit(50)
                .get();
            
            if (snapshot.empty) return [];

            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch (e) {
            console.error("Fetch Public Collection Error:", e);
            if (e.code === 'failed-precondition') {
                 try {
                     const snap2 = await db.collection("public_collection").limit(50).get();
                     return snap2.docs.map(d => ({id:d.id, ...d.data()}));
                 } catch(e2) { return []; }
            }
            return [];
        }
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