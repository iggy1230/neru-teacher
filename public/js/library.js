// --- START OF FILE library.js ---

// --- js/library.js (v4.0: 高解像度レンダリング＆図書室対応版) ---

if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
}

let libraryState = {
    tempPdfFile: null,
    tempPdfMeta: {},
    books:[],
    currentBook: null,
    pdfDocument: null,
    pageNum: 1,
    pageRendering: false,
    pageNumPending: null,
    canvas: null,
    ctx: null
};

// Base64 -> Blob 変換ヘルパー
function dataURLtoBlob(dataurl) {
    let arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1],
        bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
    while(n--){ u8arr[n] = bstr.charCodeAt(n); }
    return new Blob([u8arr], {type:mime});
}

// ==========================================
// 1. 親モード: 寄贈 (アップロード) 機能
// ==========================================
window.openPdfImportModal = function() {
    if (!currentUser) return;
    const modal = document.getElementById('pdf-import-modal');
    if (modal) {
        libraryState.tempPdfFile = null;
        libraryState.tempPdfMeta = {};
        document.getElementById('pdf-file-input').value = "";
        document.getElementById('pdf-meta-area').classList.add('hidden');
        const btn = document.getElementById('pdf-upload-btn');
        btn.innerText = "ファイルを選んでにゃ";
        btn.disabled = true;
        modal.classList.remove('hidden');
    }
};

window.closePdfImportModal = function() {
    const modal = document.getElementById('pdf-import-modal');
    if (modal) modal.classList.add('hidden');
};

window.onPdfFileSelected = async function(event) {
    const file = event.target.files[0];
    if(!file) return;
    if (file.type !== "application/pdf") return alert("PDFファイルを選んでにゃ！");

    libraryState.tempPdfFile = file;
    const btn = document.getElementById('pdf-upload-btn');
    btn.innerText = "表紙を作ってるにゃ...";
    btn.disabled = true;
    
    const metaArea = document.getElementById('pdf-meta-area');
    metaArea.classList.remove('hidden');
    document.getElementById('pdf-preview-cover').src = "assets/images/characters/nell-thinking.png"; 

    const defaultTitle = file.name.replace(/\.[^/.]+$/, "");
    document.getElementById('pdf-title-input').value = defaultTitle;
    document.getElementById('pdf-author-input').value = currentUser.name + "の親";

    try {
        const fileReader = new FileReader();
        fileReader.onload = async function() {
            const typedarray = new Uint8Array(this.result);
            try {
                const pdf = await pdfjsLib.getDocument(typedarray).promise;
                const page = await pdf.getPage(1); 
                
                const viewport = page.getViewport({scale: 1.0});
                const scale = 300 / viewport.width;
                const scaledViewport = page.getViewport({scale: scale});

                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.height = scaledViewport.height;
                canvas.width = scaledViewport.width;

                await page.render({canvasContext: context, viewport: scaledViewport}).promise;

                libraryState.tempPdfMeta.coverBase64 = canvas.toDataURL('image/jpeg', 0.8);
                document.getElementById('pdf-preview-cover').src = libraryState.tempPdfMeta.coverBase64;

                btn.innerText = "この本を寄贈する！";
                btn.disabled = false;
            } catch(e) {
                console.error("PDF Render Error:", e);
                document.getElementById('pdf-preview-cover').src = "assets/images/items/student-id-base.png";
                libraryState.tempPdfMeta.coverBase64 = null;
                btn.innerText = "この本を寄贈する！";
                btn.disabled = false;
            }
        };
        fileReader.readAsArrayBuffer(file);
    } catch(e) {
        alert("PDFファイルの読み込みに失敗したにゃ...");
        btn.innerText = "ファイルを選んでにゃ";
        metaArea.classList.add('hidden');
    }
};

window.uploadPdfToFirebase = async function() {
    if(!libraryState.tempPdfFile || !window.fireStorage || !window.db) return;
    const btn = document.getElementById('pdf-upload-btn');
    btn.disabled = true;
    btn.innerText = "アップロード中にゃ...（数分かかるかも！）";

    try {
        const title = document.getElementById('pdf-title-input').value || "タイトルなし";
        const author = document.getElementById('pdf-author-input').value || "作者不明";
        const timestamp = Date.now();
        
        let coverUrl = "";
        if (libraryState.tempPdfMeta.coverBase64) {
            const coverRef = window.fireStorage.ref('library_covers/' + timestamp + '.jpg');
            const coverBlob = dataURLtoBlob(libraryState.tempPdfMeta.coverBase64);
            await coverRef.put(coverBlob);
            coverUrl = await coverRef.getDownloadURL();
        }

        const pdfRef = window.fireStorage.ref('library_pdfs/' + timestamp + '.pdf');
        await pdfRef.put(libraryState.tempPdfFile);
        const pdfUrl = await pdfRef.getDownloadURL();

        await window.db.collection('library_books').add({
            title: title,
            author: author,
            coverUrl: coverUrl,
            pdfUrl: pdfUrl,
            uploadedBy: currentUser.id,
            uploadedByName: currentUser.name,
            createdAt: new Date().toISOString()
        });

        alert("図書室に本を寄贈したにゃ！ありがとうにゃ！");
        window.closePdfImportModal();
        if(window.safePlay && window.sfxHirameku) window.safePlay(window.sfxHirameku);

    } catch(e) {
        console.error(e);
        alert("アップロードに失敗したにゃ...\n" + e.message);
        btn.disabled = false;
        btn.innerText = "この本を寄贈する！";
    }
};

// ==========================================
// 2. 子供モード: 図書室（本棚）表示
// ==========================================
window.showLibrary = async function() {
    if (typeof window.switchScreen === 'function') {
        window.switchScreen('screen-library');
        window.currentMode = 'library';
    }
    
    const container = document.getElementById('library-book-grid');
    container.innerHTML = '<p style="text-align:center; grid-column: span 3;">本を探してるにゃ...</p>';
    
    if(typeof window.updateNellMessage === 'function') {
        window.updateNellMessage("図書室だにゃ！読みたい本を選ぶにゃ！", "happy", false, true);
    }
    
    if (!window.db || !currentUser) {
        container.innerHTML = '<p style="text-align:center; color:red; grid-column: span 3;">データベースにつながってないにゃ。</p>';
        return;
    }
    
    try {
        const snapshot = await window.db.collection('library_books').orderBy('createdAt', 'desc').get();
        libraryState.books = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        container.innerHTML = '';
        if (libraryState.books.length === 0) {
            container.innerHTML = '<p style="text-align:center; color:#888; grid-column: span 3;">まだ本がないにゃ。<br>おうちの人に寄贈してもらってにゃ！</p>';
            return;
        }

        const progress = currentUser.libraryProgress || {};

        libraryState.books.forEach(book => {
            const currentPg = progress[book.id] || 1; 

            const div = document.createElement('div');
            div.className = "library-book-item";
            div.onclick = () => window.openBook(book.id, currentPg);
            
            const coverSrc = book.coverUrl || 'assets/images/items/student-id-base.png';
            
            div.innerHTML = `
                <img src="${coverSrc}" class="library-book-cover" onerror="this.src='assets/images/items/student-id-base.png'">
                <div class="library-book-title">${window.cleanDisplayString(book.title)}</div>
                ${currentPg > 1 ? `<div class="library-book-badge">P.${currentPg}から</div>` : ''}
            `;
            container.appendChild(div);
        });

    } catch (e) {
        console.error("Library Load Error:", e);
        container.innerHTML = '<p style="text-align:center; color:red; grid-column: span 3;">本の読み込みに失敗したにゃ...</p>';
    }
};

// ==========================================
// 3. 子供モード: PDFリーダー (読書画面)
// ==========================================
window.openBook = async function(bookId, startPage = 1) {
    const book = libraryState.books.find(b => b.id === bookId);
    if (!book) return;

    libraryState.currentBook = book;
    libraryState.pageNum = startPage;
    
    document.getElementById('screen-library').classList.add('hidden');
    document.getElementById('screen-library-reader').classList.remove('hidden');
    document.getElementById('pdf-reader-title').innerText = window.cleanDisplayString(book.title);
    
    libraryState.canvas = document.getElementById('pdf-render-canvas');
    libraryState.ctx = libraryState.canvas.getContext('2d');
    
    const ctx = libraryState.ctx;
    libraryState.canvas.width = 300; libraryState.canvas.height = 400;
    ctx.fillStyle = "#555"; ctx.fillRect(0,0,300,400);
    ctx.fillStyle = "white"; ctx.font = "20px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("本を持ってくるにゃ...", 150, 200);
    
    if(typeof window.updateNellMessage === 'function') {
        window.updateNellMessage("面白そうな本だにゃ！準備するにゃ！", "excited", false, true);
    }

    try {
        const loadingTask = pdfjsLib.getDocument(book.pdfUrl);
        libraryState.pdfDocument = await loadingTask.promise;
        window.renderPdfPage(libraryState.pageNum);
    } catch(e) {
        console.error("PDF Open Error:", e);
        alert("本が開けなかったにゃ…。通信エラーかも？");
        window.closeBook(false); 
    }
};

window.renderPdfPage = async function(num) {
    if(!libraryState.pdfDocument) return;
    libraryState.pageRendering = true;
    
    try {
        const page = await libraryState.pdfDocument.getPage(num);
        
        const container = document.getElementById('pdf-reader-container');
        const containerWidth = container.clientWidth - 20; 
        const containerHeight = container.clientHeight - 20;
        
        // ★高解像度レンダリング（文字潰れ解消のキモ）
        const unscaledViewport = page.getViewport({scale: 1.0});
        const baseScale = Math.min(containerWidth / unscaledViewport.width, containerHeight / unscaledViewport.height);
        
        // スマホ画面のピクセル比率（最低でも2倍の解像度で描画する）
        const pixelRatio = Math.max(window.devicePixelRatio || 1, 2);
        
        // キャンバスの物理サイズは高画質にする
        const viewport = page.getViewport({scale: baseScale * pixelRatio});
        libraryState.canvas.height = viewport.height;
        libraryState.canvas.width = viewport.width;
        
        // CSS上の表示サイズは画面にピッタリ収まる大きさに戻す
        libraryState.canvas.style.height = `${viewport.height / pixelRatio}px`;
        libraryState.canvas.style.width = `${viewport.width / pixelRatio}px`;
        
        const renderContext = {
            canvasContext: libraryState.ctx,
            viewport: viewport
        };
        
        await page.render(renderContext).promise;
        
        libraryState.pageRendering = false;
        document.getElementById('pdf-page-info').innerText = `${num} / ${libraryState.pdfDocument.numPages}`;
        
        if (num === libraryState.pdfDocument.numPages && libraryState.pdfDocument.numPages > 1) {
            window.giveReadingReward();
        }

        if (libraryState.pageNumPending !== null) {
            window.renderPdfPage(libraryState.pageNumPending);
            libraryState.pageNumPending = null;
        }
    } catch(e) {
        console.error("Page Render Error:", e);
        libraryState.pageRendering = false;
    }
};

window.queueRenderPage = function(num) {
    if (libraryState.pageRendering) {
        libraryState.pageNumPending = num;
    } else {
        window.renderPdfPage(num);
    }
};

window.prevPdfPage = function() {
    if (libraryState.pageNum <= 1) return;
    if(window.safePlay && window.sfxBtn) window.safePlay(window.sfxBtn);
    libraryState.pageNum--;
    window.queueRenderPage(libraryState.pageNum);
};

window.nextPdfPage = function() {
    if (libraryState.pageNum >= libraryState.pdfDocument.numPages) return;
    if(window.safePlay && window.sfxBtn) window.safePlay(window.sfxBtn);
    libraryState.pageNum++;
    window.queueRenderPage(libraryState.pageNum);
};

// 読破ボーナス
window.giveReadingReward = function() {
    if (!currentUser.booksRead) currentUser.booksRead =[];
    const bookId = libraryState.currentBook.id;
    
    if (!currentUser.booksRead.includes(bookId)) {
        currentUser.booksRead.push(bookId);
        window.giveGameReward(100); 
        
        if(window.safePlay && window.sfxHirameku) window.safePlay(window.sfxHirameku);
        
        if (typeof window.grantRandomSticker === 'function') {
            setTimeout(() => window.grantRandomSticker(true), 1500);
        }
        
        if(typeof window.updateNellMessage === 'function') {
            window.updateNellMessage("最後まで読んだにゃ！すごいにゃ！！ご褒美にカリカリとシールをあげるにゃ！", "excited", false, true);
        }
    }
};

window.closeBook = function(saveProgress = true) {
    if (saveProgress && currentUser && libraryState.currentBook) {
        if (!currentUser.libraryProgress) currentUser.libraryProgress = {};
        
        if (libraryState.pageNum >= libraryState.pdfDocument.numPages) {
            currentUser.libraryProgress[libraryState.currentBook.id] = 1;
        } else {
            currentUser.libraryProgress[libraryState.currentBook.id] = libraryState.pageNum;
        }
        if (typeof window.saveAndSync === 'function') window.saveAndSync();
    }

    document.getElementById('screen-library-reader').classList.add('hidden');
    document.getElementById('screen-library').classList.remove('hidden');
    
    libraryState.pdfDocument = null;
    libraryState.currentBook = null;
    
    window.showLibrary(); 
};