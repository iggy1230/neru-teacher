// --- js/card-generator.js (v360.0: レアリティ別フレーム・肉球描画削除版) ---

window.CardGenerator = {};

// 画像読み込みヘルパー
function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(e);
        img.src = src;
    });
}

// テキストを分割して行の配列を返すヘルパー
function getWrappedLines(ctx, text, maxWidth) {
    const words = text.split('');
    let lines = [];
    let line = '';

    for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n];
        const metrics = ctx.measureText(testLine);
        const testWidth = metrics.width;
        
        if (testWidth > maxWidth && n > 0) {
            lines.push(line);
            line = words[n];
        } else {
            line = testLine;
        }
    }
    lines.push(line);
    return lines;
}

// ★カード生成メイン関数
window.generateTradingCard = async function(photoBase64, itemData, userData, collectionNo = 1) {
    // ★重要: Webフォントの読み込み完了を待つ (iPhoneでのズレ防止)
    await document.fonts.ready;

    const CANVAS_W = 600;
    const CANVAS_H = 880; 
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext('2d');

    // 1. 背景
    ctx.fillStyle = "#ffffff"; 
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // 2. 写真の描画
    try {
        const photoImg = await loadImage("data:image/jpeg;base64," + photoBase64);
        
        const photoX = 85;
        const photoY = 100;
        const photoW = 430;
        const photoH = 260;

        const scale = Math.max(photoW / photoImg.width, photoH / photoImg.height);
        const w = photoImg.width * scale;
        const h = photoImg.height * scale;
        const x = photoX + (photoW - w) / 2;
        const y = photoY + (photoH - h) / 2;
        
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(photoX, photoY, photoW, photoH, 20);
        ctx.clip();
        ctx.drawImage(photoImg, x, y, w, h);
        ctx.restore();

    } catch (e) {
        console.warn("Card Photo Load Error", e);
    }

    // 3. 枠画像の描画 (レアリティ別)
    // レアリティを取得 (1～5の範囲に収める)
    let rarity = itemData.rarity || 1;
    if (rarity < 1) rarity = 1;
    if (rarity > 5) rarity = 5;

    // ★修正: レアリティに応じたファイルパスを生成
    const framePath = `assets/images/ui/card_frame${rarity}.png`;

    try {
        const frameImg = await loadImage(framePath);
        ctx.drawImage(frameImg, 0, 0, CANVAS_W, CANVAS_H);
    } catch (e) {
        console.error(`枠画像(${framePath})の読み込み失敗`, e);
        // フォールバック: card_frame.png があれば使う、なければ枠線
        try {
            const fallbackImg = await loadImage('assets/images/ui/card_frame.png');
            ctx.drawImage(fallbackImg, 0, 0, CANVAS_W, CANVAS_H);
        } catch(e2) {
            ctx.strokeStyle = "gold";
            ctx.lineWidth = 10;
            ctx.strokeRect(0, 0, CANVAS_W, CANVAS_H);
        }
    }

    // --- テキスト描画 ---
    ctx.textBaseline = "middle"; 

    // 4. 登録No. (左上)
    const regNo = "No." + String(collectionNo).padStart(3, '0');
    ctx.fillStyle = "#555"; 
    ctx.font = "bold 18px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(regNo, 50, 45); 

    // 5. 物体名 (2行対応)
    ctx.fillStyle = "#d32f2f"; 
    ctx.textAlign = "center";
    
    const titleMaxWidth = 360; 
    let titleFontSize = 32;
    ctx.font = `bold ${titleFontSize}px 'M PLUS Rounded 1c', sans-serif`;
    
    let titleLines = getWrappedLines(ctx, itemData.itemName, titleMaxWidth);
    
    if (titleLines.length > 1) {
        // ★修正: 2行になる場合はフォントを小さく (28 -> 24)
        titleFontSize = 24;
        ctx.font = `bold ${titleFontSize}px 'M PLUS Rounded 1c', sans-serif`;
        titleLines = getWrappedLines(ctx, itemData.itemName, titleMaxWidth);
        
        const lineHeight = titleFontSize * 1.2;
        // 2行の場合の中心Y座標
        const startY = 65 - (lineHeight / 2); 
        
        titleLines.forEach((line, i) => {
            if (i < 2) {
                ctx.fillText(line, 300, startY + (i * lineHeight));
            }
        });
    } else {
        // 1行の場合
        ctx.fillText(itemData.itemName, 300, 65);
    }

    // 6. レアリティ (左下)
    // ★修正: ベース画像に肉球が含まれているため、ここでの描画は不要になりました
    /*
    const pawX = 260; 
    const pawY = 825;
    ctx.font = "24px sans-serif";
    ctx.textAlign = "left";
    let paws = "";
    for(let i=0; i<rarity; i++) paws += "🐾";
    ctx.fillStyle = "#ff8a80"; 
    ctx.fillText(paws, pawX, pawY);
    */

    // 7. 発見日 (右下)
    const today = new Date();
    const dateStr = `発見日: ${today.getFullYear()}/${today.getMonth()+1}/${today.getDate()}`;
    ctx.fillStyle = "#333";
    ctx.font = "16px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(dateStr, 530, 815); 

    // 本文描画のためベースラインをtopに戻す
    ctx.textBaseline = "top";

    // 8. ネル先生の解説
    const descX = 60;
    const descY = 410;
    const descW = 480;
    
    ctx.fillStyle = "#5d4037"; 
    ctx.font = "16px 'Sawarabi Gothic', sans-serif";
    ctx.textAlign = "left";
    
    let descText = itemData.description || "";
    descText = descText.replace(/[\(（][ぁ-んァ-ンー\s　]+[\)）]/g, ""); 
    
    const descLines = getWrappedLines(ctx, descText, descW);
    descLines.forEach((line, i) => {
        ctx.fillText(line, descX, descY + (i * 24));
    });

    // 9. ほんとうのこと (自動縮小処理)
    const realX = 60;
    const realY = 620;
    const realMaxHeight = 170; 
    
    ctx.fillStyle = "#0d47a1"; 
    let realFontSize = 16;
    let realLineHeight = 24;
    let realText = itemData.realDescription || "";
    realText = realText.replace(/[\(（][ぁ-んァ-ンー\s　]+[\)）]/g, "");
    
    let realLines = [];
    do {
        ctx.font = `${realFontSize}px 'Sawarabi Gothic', sans-serif`;
        realLineHeight = realFontSize * 1.4;
        realLines = getWrappedLines(ctx, realText, descW);
        
        const totalHeight = realLines.length * realLineHeight;
        
        if (totalHeight <= realMaxHeight || realFontSize <= 10) {
            break; 
        }
        realFontSize -= 1; 
    } while (realFontSize > 10);

    realLines.forEach((line, i) => {
        ctx.fillText(line, realX, realY + (i * realLineHeight));
    });

    return canvas.toDataURL("image/jpeg", 0.9);
};