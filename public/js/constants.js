// --- js/constants.js (v470.2: シール設定修正版) ---

// ==========================================
// グローバル変数・状態フラグ
// ==========================================
window.currentMode = '';
window.currentSubject = '';
window.isAnalyzing = false;
window.lastAnalysisTime = 0; 
window.transcribedProblems = [];
window.selectedProblem = null;
window.hintIndex = 0;
window.lunchCount = 0;
window.analysisType = 'precision';
window.gradingTimer = null;
window.isComposing = false;
// 履歴用配列
window.chatSessionHistory = [];

// ==========================================
// 音量設定
// ==========================================
window.appVolume = 0.5; // 初期音量 50%
window.isMuted = false;

// ==========================================
// リソース定義 (Audio, Images)
// ==========================================

// 効果音を一括管理するためのリスト
window.audioList = [];

function createAudio(path) {
    const audio = new Audio(path);
    audio.volume = window.isMuted ? 0 : window.appVolume;
    window.audioList.push(audio);
    return audio;
}

// システム音
window.sfxChime = createAudio('assets/sounds/system/Jpn_sch_chime.mp3');
window.sfxBtn = createAudio('assets/sounds/ui/botan1.mp3'); 
window.sfxOver = createAudio('assets/sounds/system/gameover.mp3');
window.sfxBunseki = createAudio('assets/sounds/system/bunseki.mp3');
window.sfxBunseki.volume = 0.05; 

// UI/アクション音
window.sfxBori = createAudio('assets/sounds/ui/boribori.mp3');
window.sfxHit = createAudio('assets/sounds/voice/cat1c.mp3');
window.sfxPaddle = createAudio('assets/sounds/ui/poka02.mp3');
window.sfxHirameku = createAudio('assets/sounds/voice/hirameku.mp3');
window.sfxMaru = createAudio('assets/sounds/ui/maru.mp3');
window.sfxBatu = createAudio('assets/sounds/ui/batu.mp3');
window.sfxDoor = createAudio('assets/sounds/system/class_door1.mp3');

// ★追加: カウントダウン音声 (1.wav ～ 10.wav)
window.sfxCountdown = {};
for (let i = 1; i <= 10; i++) {
    window.sfxCountdown[i] = createAudio(`assets/sounds/voice/${i}.wav`);
}

// ゲーム用コメント
window.gameHitComments = ["うまいにゃ！", "すごいにゃ！", "さすがにゃ！", "がんばれにゃ！"];

// 画像リソース
window.subjectImages = {
    'こくご': { base: 'assets/images/characters/nell-kokugo.png', talk: 'assets/images/characters/nell-kokugo-talk.png' },
    'さんすう': { base: 'assets/images/characters/nell-sansu.png', talk: 'assets/images/characters/nell-sansu-talk.png' },
    'りか': { base: 'assets/images/characters/nell-rika.png', talk: 'assets/images/characters/nell-rika-talk.png' },
    'しゃかい': { base: 'assets/images/characters/nell-shakai.png', talk: 'assets/images/characters/nell-shakai-talk.png' },
    'おはなし': { base: 'assets/images/characters/nell-normal.png', talk: 'assets/images/characters/nell-talk.png' }
};
window.defaultIcon = 'assets/images/characters/nell-normal.png';
window.talkIcon = 'assets/images/characters/nell-talk.png';

// ★修正: シール設定
// ユーザーが画像を2枚(001, 002)置くとのことなので、MAX_COUNTを2にします。
window.STICKER_FILE_MAX_COUNT = 2; 

window.STICKER_TYPES = [
    // 固定シールが必要ならここに記述
    { id: 'paw_red', src: 'assets/images/items/nikukyuhanko.png', name: '赤肉球' },
    { id: 'paw_gold', text: '🐾', color: '#ffd700', name: '金肉球' }
];

// ==========================================
// 音声・通信・認識関連
// ==========================================
window.liveSocket = null;
window.audioContext = null;
window.mediaStream = null;
window.workletNode = null;
window.stopSpeakingTimer = null;
window.speakingStartTimer = null;
window.currentTtsSource = null;
window.chatTranscript = "";
window.nextStartTime = 0;
window.connectionTimeout = null;
window.recognition = null;
window.isRecognitionActive = false;
window.liveAudioSources = [];
window.ignoreIncomingAudio = false;
window.currentLiveAudioSource = null;
window.isLiveImageSending = false;
window.isMicMuted = false;
window.lastSentCollectionImage = null;
window.activeChatContext = null;
window.streamTextBuffer = "";
window.ttsTextBuffer = "";
window.latestDetectedName = null;
// 常時聞き取り用
window.isAlwaysListening = false;
window.continuousRecognition = null;

// ==========================================
// ゲーム・Cropper・タイマー関連
// ==========================================
// ゲーム
window.gameCanvas = null;
window.ctx = null;
window.ball = null;
window.paddle = null;
window.bricks = null;
window.score = 0;
window.gameRunning = false;
window.gameAnimId = null;
// Cropper
window.cropImg = new Image();
window.cropPoints = [];
window.activeHandle = -1;
window.analysisTimers = [];
window.homeworkStream = null;
// タイマー
window.studyTimerValue = 0;
window.studyTimerInterval = null;
window.studyTimerRunning = false;
window.studyTimerCheck = 0;
// プレビューカメラ
window.previewStream = null;

// ==========================================
// 共通ヘルパー関数
// ==========================================
window.safePlay = function(audioObj) {
    if (!audioObj) return Promise.resolve();
    try {
        const targetVol = window.isMuted ? 0 : window.appVolume;
        
        if (audioObj === window.sfxBunseki) {
             audioObj.volume = targetVol * 0.1;
        } else {
             audioObj.volume = targetVol;
        }

        audioObj.currentTime = 0;
        const playPromise = audioObj.play();
        if (playPromise !== undefined) {
            return playPromise.catch(error => {
                console.warn("Audio play failed (ignored):", error);
            });
        }
    } catch (e) { console.warn("Audio error:", e); }
    return Promise.resolve();
};