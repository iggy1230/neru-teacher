// --- START OF FILE self-study.js ---

// --- js/self-study.js (v1.4: 管理機能搭載版) ---

let selfStudyState = {
    drills:[],
    currentDrill: null,
    currentPage: null
};

// ==========================================
// 0. 共通音声再生
// ==========================================
function playSelfStudyVoice(text, mood = "normal") {
    if (typeof window.updateNellMessage === 'function') {
        window.updateNellMessage(text, mood, false, true);
    }
}

// ==========================================
// 1. 親モード: ドリル管理
// ==========================================
window.showDrillManagement = function() {
    window.switchScreen('screen-drill-management');
    playSelfStudyVoice("登録したドリルを管理するにゃ！", "normal");

    const container = document.getElementById('drill-management-list');
    container.innerHTML = '';
    
    if (!currentUser || !currentUser.custom_drills || currentUser.custom_drills.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:#888;">まだドリルが登録されてないにゃ。</p>';
        return;
    }

    // 新しい順にソート
    const sortedDrills = [...currentUser.custom_drills].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    sortedDrills.forEach(drill => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'drill-manage-item';

        itemDiv.innerHTML = `
            <div class="drill-manage-item-title">${window.cleanDisplayString(drill.title)}</div>
            <div class="drill-manage-buttons">
                <button onclick="renameDrill('${drill.id}')" class="mini-teach-btn drill-edit-btn">名前変更</button>
                <button onclick="deleteDrill('${drill.id}')" class="mini-teach-btn drill-delete-btn">削除</button>
            </div>
        `;
        container.appendChild(itemDiv);
    });
};

window.renameDrill = async function(drillId) {
    if (!currentUser || !currentUser.custom_drills) return;
    
    const drill = currentUser.custom_drills.find(d => d.id === drillId);
    if (!drill) return;

    const newTitle = prompt("新しいドリルの名前を入力してにゃ！", drill.title);
    if (newTitle && newTitle.trim() !== "" && newTitle !== drill.title) {
        drill.title = newTitle.trim();
        
        if (typeof window.saveAndSync === 'function') {
            await window.saveAndSync();
            alert("名前を変更したにゃ！");
            window.showDrillManagement(); // リストを再描画
        }
    }
};

window.deleteDrill = async function(drillId) {
    if (!currentUser || !currentUser.custom_drills) return;
    
    const drill = currentUser.custom_drills.find(d => d.id === drillId);
    if (!drill) return;

    if (confirm(`本当に「${drill.title}」を削除するにゃ？\nこの操作は元に戻せないにゃ！`)) {
        currentUser.custom_drills = currentUser.custom_drills.filter(d => d.id !== drillId);

        if (typeof window.saveAndSync === 'function') {
            await window.saveAndSync();
            alert("ドリルを削除したにゃ！");
            window.showDrillManagement(); // リストを再描画
        }
    }
};

// JSONのインポート用
window.openDrillImportModal = function() {
    if (!currentUser) return;
    const modal = document.getElementById('drill-import-modal');
    if (modal) {
        document.getElementById('drill-json-input').value = "";
        modal.classList.remove('hidden');
    }
};

window.closeDrillImportModal = function() {
    const modal = document.getElementById('drill-import-modal');
    if (modal) modal.classList.add('hidden');
};

window.importDrillJson = async function() {
    if (!currentUser) return alert("生徒を選んでログインしてにゃ！");
    const jsonStr = document.getElementById('drill-json-input').value.trim();
    if (!jsonStr) return alert("JSONデータを貼り付けてにゃ！");

    const btn = document.getElementById('drill-import-btn');
    btn.disabled = true;
    btn.innerText = "登録中...";

    try {
        let cleanStr = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
        const drillData = JSON.parse(cleanStr);

        if (!drillData.title || !drillData.pages) {
            throw new Error("フォーマットが違うみたいだにゃ（titleとpagesが必要）");
        }

        if (!currentUser.custom_drills) {
            currentUser.custom_drills =[];
        }

        const newDrillId = "drill_" + Date.now() + "_" + Math.floor(Math.random()*1000);
        const dataToSave = {
            ...drillData,
            id: newDrillId,
            createdAt: new Date().toISOString()
        };

        currentUser.custom_drills.push(dataToSave);
        
        if (typeof window.saveAndSync === 'function') {
            await window.saveAndSync();
        }
        
        alert("ドリルを登録したにゃ！");
        window.closeDrillImportModal();
        window.showDrillManagement(); // 登録後、管理リストを再描画

    } catch (e) {
        console.error("Import Error:", e);
        let errMsg = e.message;
        if (errMsg.includes("JSON")) errMsg = "JSONの形式がおかしいみたいだにゃ。コピーミスがないか確認してにゃ！";
        alert("登録エラーだにゃ...\n" + errMsg);
    } finally {
        btn.disabled = false;
        btn.innerText = "登録する！";
    }
};

// ==========================================
// 2. 子供モード: 自習室UI
// ==========================================
window.showSelfStudyMenu = async function() {
    window.switchScreen('screen-self-study');
    window.currentMode = 'self-study';
    
    document.getElementById('self-study-list-view').classList.remove('hidden');
    document.getElementById('self-study-play-view').classList.add('hidden');
    
    playSelfStudyVoice("自習室だにゃ！どのドリルをやるにゃ？", "normal");
    
    const container = document.getElementById('self-study-drill-list');
    container.innerHTML = '';
    
    if (!currentUser) return;
    
    selfStudyState.drills = currentUser.custom_drills ||[];
    
    if (selfStudyState.drills.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:#888;">まだドリルが登録されてないにゃ。<br>おうちの人に登録してもらってにゃ！</p>';
        return;
    }
    
    const sortedDrills = [...selfStudyState.drills].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    sortedDrills.forEach(data => {
        const btn = document.createElement('button');
        btn.className = "main-btn";
        btn.style.cssText = "background: white; color: #333; border: 2px solid #4db6ac; text-align: left; margin-bottom: 10px; box-shadow: 0 4px 0 #b2dfdb; display: flex; justify-content: space-between; align-items: center;";
        
        let icon = "📚";
        if (data.subject === "さんすう") icon = "🔢";
        if (data.subject === "こくご") icon = "📖";
        if (data.subject === "りか") icon = "🔬";
        if (data.subject === "しゃかい") icon = "🌍";
        
        btn.innerHTML = `<span style="font-size:1.1rem; font-weight:bold;">${icon} ${window.cleanDisplayString(data.title)}</span><span style="font-size:0.8rem; color:#888;">${data.pages.length}ページ</span>`;
        btn.onclick = () => window.openDrillDetail(data.id);
        container.appendChild(btn);
    });
};

window.openDrillDetail = function(drillId) {
    const drill = selfStudyState.drills.find(d => d.id === drillId);
    if (!drill) return;
    
    selfStudyState.currentDrill = drill;
    
    document.getElementById('self-study-list-view').classList.add('hidden');
    document.getElementById('self-study-play-view').classList.remove('hidden');
    document.getElementById('drill-play-title').innerText = drill.title;
    
    playSelfStudyVoice("どのページをやるにゃ？", "excited");
    
    const container = document.getElementById('drill-page-container');
    container.innerHTML = '';
    
    drill.pages.forEach((page, pageIndex) => {
        const btn = document.createElement('button');
        btn.className = "main-btn blue-btn";
        btn.style.marginBottom = "10px";
        btn.innerText = `📄 ${page.page_number} (${page.questions.length}問)`;
        btn.onclick = () => window.startDrillPage(pageIndex);
        container.appendChild(btn);
    });
};

window.backToDrillList = function() {
    selfStudyState.currentDrill = null;
    selfStudyState.currentPage = null;
    document.getElementById('self-study-list-view').classList.remove('hidden');
    document.getElementById('self-study-play-view').classList.add('hidden');
    playSelfStudyVoice("自習室だにゃ！どのドリルをやるにゃ？", "normal");
};

// ==========================================
// 3. ページプレイ画面（ヒントと答え合わせ）
// ==========================================
window.startDrillPage = function(pageIndex) {
    const page = selfStudyState.currentDrill.pages[pageIndex];
    selfStudyState.currentPage = page;
    
    const playArea = document.getElementById('drill-page-container');
    playArea.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
            <button onclick="window.openDrillDetail('${selfStudyState.currentDrill.id}')" class="mini-teach-btn" style="background:#78909c; width:auto; font-size:1rem; padding:8px 15px;">← ページ選択へ</button>
            <span style="font-weight:bold; color:#00796b; font-size:1.2rem;">${page.page_number}</span>
        </div>
        <p style="text-align:center; font-size:0.9rem; color:#666; margin-bottom:15px;">紙のドリルを解きながら、わからない問題のボタンを押してにゃ！</p>
        <div id="drill-questions-grid" style="display:flex; flex-direction:column; gap:10px;"></div>
        <button onclick="window.finishDrillPage()" class="main-btn orange-btn" style="margin-top:20px;">🎉 このページおわり！</button>
    `;
    
    const qGrid = document.getElementById('drill-questions-grid');
    
    page.questions.forEach((q, qIndex) => {
        q.currentState = 0; 
        
        const card = document.createElement('div');
        card.className = "grade-item";
        card.style.flexDirection = "column";
        card.style.alignItems = "flex-start";
        
        const header = document.createElement('div');
        header.style.cssText = "display:flex; justify-content:space-between; width:100%; align-items:center; margin-bottom:10px;";
        header.innerHTML = `<span style="font-size:1.2rem; font-weight:bold; color:#333;">第 ${q.q_number} 問</span>`;
        
        const btnArea = document.createElement('div');
        btnArea.style.cssText = "display:flex; gap:10px; width:100%;";
        
        const hintBtn = document.createElement('button');
        hintBtn.className = "main-btn green-btn";
        hintBtn.style.flex = "1";
        hintBtn.style.margin = "0";
        hintBtn.style.padding = "10px";
        hintBtn.innerText = "💡 ヒント";
        
        const ansBtn = document.createElement('button');
        ansBtn.className = "main-btn pink-btn";
        ansBtn.style.flex = "1";
        ansBtn.style.margin = "0";
        ansBtn.style.padding = "10px";
        ansBtn.innerText = "⭕ 答え";
        
        const speechArea = document.createElement('div');
        speechArea.id = `q-speech-${qIndex}`;
        speechArea.style.cssText = "width:100%; margin-top:10px; padding:10px; background:#e0f2f1; border-radius:8px; color:#00695c; font-size:1rem; font-weight:bold; display:none;";
        
        hintBtn.onclick = () => {
            let hintText = "";
            if (q.currentState === 0) {
                hintText = q.hints[0] || "ヒントはないみたいだにゃ。";
                q.currentState = 1;
                hintBtn.innerText = "💡 もっとヒント！";
            } else if (q.currentState === 1 || q.currentState === 2) {
                hintText = q.hints[1] || q.hints[0] || "これが最大のヒントだにゃ！";
                q.currentState = 2;
                hintBtn.disabled = true;
                hintBtn.style.background = "#ccc";
                hintBtn.style.boxShadow = "none";
            }
            speechArea.style.display = "block";
            speechArea.innerText = hintText;
            
            playSelfStudyVoice(hintText, "thinking");
        };
        
        ansBtn.onclick = () => {
            const ansText = `正解は「${q.answer}」だにゃ！`;
            q.currentState = 3;
            speechArea.style.display = "block";
            speechArea.style.background = "#fff3e0";
            speechArea.style.color = "#e65100";
            speechArea.style.fontSize = "1.2rem";
            speechArea.innerText = ansText;
            
            playSelfStudyVoice(ansText, "happy");
        };
        
        btnArea.appendChild(hintBtn);
        btnArea.appendChild(ansBtn);
        
        card.appendChild(header);
        card.appendChild(btnArea);
        card.appendChild(speechArea);
        qGrid.appendChild(card);
    });
    
    playSelfStudyVoice(`「${page.page_number}」をはじめるにゃ！`, "excited");
};

window.finishDrillPage = function() {
    const reward = 50; 
    window.giveGameReward(reward);
    
    if (!currentUser.selfStudyCount) currentUser.selfStudyCount = 0;
    currentUser.selfStudyCount++;
    if (typeof window.saveAndSync === 'function') window.saveAndSync();
    
    if (typeof window.saveHighScore === 'function') {
        window.saveHighScore('self_study', currentUser.selfStudyCount);
    }
    
    playSelfStudyVoice(`よくがんばったにゃ！えらいにゃ！！ご褒美にカリカリ${reward}個あげるにゃ！`, "excited");
    
    if(window.safePlay && window.sfxHirameku) window.safePlay(window.sfxHirameku);
    
    setTimeout(() => {
        window.openDrillDetail(selfStudyState.currentDrill.id);
    }, 3000);
};