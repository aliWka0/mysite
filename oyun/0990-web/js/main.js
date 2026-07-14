// ============================================
// main.js — Game Entry Point & Game Loop
// ============================================
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GAME_STATES, TABLE, BALL, BALL_DATA, BALL_TYPES, CUE_BALL_START, PLAYER_START, IS_TOUCH, BOT, MOMENTUM, CAMERA, BEAM } from './constants.js';
import { SceneManager } from './scene/SceneManager.js';
import { Table } from './scene/Table.js';
import { TableModel } from './scene/TableModel.js';
import { Balls } from './scene/Balls.js';
import { CueStick } from './scene/CueStick.js';
import { PhysicsWorld } from './physics/PhysicsWorld.js';
import { BallPhysics } from './physics/BallPhysics.js';
import { PocketDetector } from './physics/PocketDetector.js';
import { CameraController } from './controls/CameraController.js';
import { AimController } from './controls/AimController.js';
import { InputManager } from './controls/InputManager.js';
import { PowerBar } from './controls/PowerBar.js';
import { TouchControls } from './controls/TouchControls.js';
import { GameManager } from './game/GameManager.js';
import { RuleEngine } from './game/RuleEngine.js';
import { ShotManager } from './game/ShotManager.js';
import { BotController } from './game/BotController.js';
import { SabotageManager } from './game/SabotageManager.js';
import { ItemSystem } from './game/ItemSystem.js';
import { ItemBoxManager } from './game/ItemBoxManager.js';
import { ComboSystem } from './game/ComboSystem.js';
import { EventManager } from './game/EventManager.js';
import { Settings } from './game/Settings.js';
import { Progression } from './game/Progression.js';
import { UIManager } from './ui/UIManager.js';
import { MainMenu } from './ui/MainMenu.js';
import { Player } from './scene/Player.js';
import { ParticleSystem } from './scene/ParticleSystem.js';
import { SoundManager } from './audio/SoundManager.js';
import { FinisherEffect } from './scene/FinisherEffect.js';
import { NetSession } from './net/NetSession.js';
import { RemoteController } from './net/RemoteController.js';
import { Matchmaker } from './net/Matchmaker.js';
import { buildSnapshot, applySnapshot, applySnapshotLerp, applyBallCorrections } from './net/NetSync.js';
import { MSG, SNAP_HZ, INPUT_HZ } from './net/NetProtocol.js';
import { DEFAULT_PORT } from './net/NetTransport.js';
import { LanMenu } from './ui/LanMenu.js';

window.addEventListener('error', (event) => {
    console.error('Runtime error:', event.message, 'at', `${event.filename}:${event.lineno}`);
});
window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
});

// ---- Globals ----
let sceneManager, table, tableModel, balls, cueStick, player, particleSystem;
let physicsWorld, ballPhysics, pocketDetector;
let cameraController, aimController, inputManager, powerBar, touchControls;
let gameManager, ruleEngine, shotManager, uiManager, mainMenu;
let sound, finisher, settings;
let clock;

// İki kalıcı karakter: players[1] (insan), players[2] (rakip/bot). `player`
// her zaman AKTİF nişancıyı (sıradaki oyuncu) işaret eden takma addır — mevcut
// kodun çoğu bunu kullanır; tur değişince syncActivePlayer() ile yeniden bağlanır.
let players = {};
let botController;
let sabotageManager;
let itemSystem;
let itemBoxManager;
let comboSystem;
let eventManager;
let progression;   // Faz 15: yerel XP/coin/seviye (localStorage)

// ---- LAN çok-oyunculu (host-otoriter) ----
let netSession, lanMenu, remoteController;
let netRole = null;          // null | 'host' | 'client'
let myPlayerNum = 1;         // host bu cihazda players[1]'i, istemci players[2]'yi sürer
let _lastSnap = null;        // istemci: en son alınan snapshot (st/cp okumaları için)
let _snapBuf = [];           // istemci: [{t, snap}] interpolasyon tamponu (jitter yutar)
const INTERP_DELAY = 0.20;   // s — render bu kadar geriden (rakip interpolasyonu için pürüzsüz tampon)
let _clientBallsMoving = false; // istemci: toplar hareket halinde mi (yerel fizik çalıştırılacak)
let _snapAccum = 0;          // host: snapshot gönderim biriktirici (SNAP_HZ)
let _inputAccum = 0;         // istemci: girdi gönderim biriktirici (INPUT_HZ)
let _clientCharging = false; // istemci: kendi sırasında güç şarjı açık mı
let _clientCamNum = 0;       // istemci: kameranın takip ettiği oyuncu (değişince yeniden bağla)
let _origShowNote = null;    // host: net modda sarılan orijinal bildirim fonksiyonları
let _origShowOver = null;

// İdle güncellemeleri için tekrar kullanılan sabitler (her karede yeni Vector3 üretme).
const ZERO_MOVE = { x: 0, y: 0 };
const FORWARD_Z = new THREE.Vector3(0, 0, 1);

// Sıcak döngü geçicileri (GC diyeti): kare başına çalışan yollarda `new` YOK —
// Android WebView'de düzenli çöp toplama duraklaması "mikro kasma" olarak hissedilir.
const _camDir = new THREE.Vector3();        // gameLoop: kamera bakış yönü (kare başı 1×)
const _camFwdXZ = new THREE.Vector3();      // gameLoop: yatay kamera ileri vektörü
const _aimDir = new THREE.Vector3();        // updateAimLine / netClientFrame yön geçicisi
const _bihRaycaster = new THREE.Raycaster();            // BALL_IN_HAND / placeCueBall
const _bihPointer = new THREE.Vector2();
const _bihPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _bihHit = new THREE.Vector3();

// Dash izi (ayak izi + toz) durumu: oyuncu no → { t: bir sonraki ize kalan, side: sol/sağ ayak, lx/lz: önceki konum }.
const _dashFx = { 1: { t: 0, side: 1, lx: null, lz: null }, 2: { t: 0, side: 1, lx: null, lz: null } };

// Position of the pocket where the last ball dropped (for the finisher)
let lastFinisherPocket = null;

// Ball-in-hand state
let ballInHandActive = false;
let ghostCueBall = null;

// Pause (2026-07-03): yalnız yerel modlarda (LAN'da host durursa istemci donar → kapalı).
// paused iken gameLoop yalnız render eder (dünya donar); overlay #pause-menu.
let paused = false;

// Input tracking for drag vs click detection
let pointerDownTime = 0;
let pointerDragDistance = 0;
const CLICK_THRESHOLD = 8; // pixels — below this, it's a click not a drag
const CLICK_TIME_THRESHOLD = 300; // ms

// ---- Initialize ----
async function init() {
    const canvas = document.getElementById('gameCanvas');
    clock = new THREE.Clock();

    // Scene
    sceneManager = new SceneManager(canvas);
    table = new Table(sceneManager.scene);
    balls = new Balls(sceneManager.scene);
    cueStick = new CueStick(sceneManager.scene);
    particleSystem = new ParticleSystem(sceneManager.scene);

    // UI early so the loading bar can show real asset-download progress.
    uiManager = new UIManager();
    uiManager.setLoadingProgress(0);

    // Physics
    physicsWorld = new PhysicsWorld();
    physicsWorld.addCushions(table.getCushionData());
    ballPhysics = new BallPhysics(physicsWorld);
    pocketDetector = new PocketDetector();

    // Audio — örnek-tabanlı SFX (public/sfx) + prosedürel yedek. Wire collision sounds.
    sound = new SoundManager();
    sound.preload();               // mp3'leri arka planda indir/çöz (jest gerekmez)
    uiManager.sound = sound;       // UI olay sesleri (ulti-hazır/kombo/foul/ödül paneli)
    ballPhysics.onSound = (type, vol) => {
        if (type === 'clack') sound.playClack(vol);
        else if (type === 'rail') sound.playRail(vol);
    };

    // Create all balls (visual + physics)
    balls.createAllBalls();
    ballPhysics.createAllBalls();

    // Real loading progress: the two heavy GLB downloads, weighted by file size
    // (table ≈11 MB, character ≈3.7 MB). They load sequentially, so the bar fills
    // the table segment, then the character segment.
    const loadFrac = { table: 0, char: 0 };
    const W = { table: 0.7, char: 0.3 };
    const updateLoading = () =>
        uiManager.setLoadingProgress(loadFrac.table * W.table + loadFrac.char * W.char);

    // Kalıcı ayarlar ERKEN kurulur (bind daha sonra): masa GLB seçimi kaliteye bakar
    // (low → mobil varyant). Kurucu saf — yalnız localStorage okur.
    settings = new Settings();

    // Load the high-detail GLB table (visual only) and fit it to the physics
    // play area. If it loads, hide the procedural table's visuals — physics
    // (cushions/pockets) keep coming from `table`.
    tableModel = new TableModel(sceneManager.scene, sceneManager.renderer, settings.get('quality'));
    await tableModel.init((e) => { if (e && e.total) loadFrac.table = e.loaded / e.total; updateLoading(); });
    loadFrac.table = 1; updateLoading();
    if (tableModel.loaded) {
        table.setVisible(false);
    }

    // İki karakter: players[1] = insan (mor halka), players[2] = rakip/bot (amber halka).
    // İkisi de aynı GLB'yi yükler; ikincisi tarayıcı önbelleğinden gelir (tek indirme,
    // iki parse). `player` = aktif nişancı takma adı.
    players[1] = new Player(sceneManager.scene, physicsWorld.world, { owner: 1, ringColor: 0x8a4bff });
    await players[1].init((e) => { if (e && e.total) loadFrac.char = e.loaded / e.total; updateLoading(); });
    loadFrac.char = 1; updateLoading();
    players[2] = new Player(sceneManager.scene, physicsWorld.world, { owner: 2, ringColor: 0xff9a4e });
    await players[2].init();
    player = players[1];

    // Controls
    cameraController = new CameraController(sceneManager.camera, sceneManager.renderer.domElement);
    aimController = new AimController(sceneManager.scene);
    inputManager = new InputManager(canvas);
    powerBar = new PowerBar();

    // Touch HUD (joystick + shoot + zoom) — only on touch devices.
    if (IS_TOUCH) {
        touchControls = new TouchControls();
        touchControls.onShootPress(onTouchShootPress);
        touchControls.onShootRelease(onTouchShootRelease);
        touchControls.onZoom((delta) => cameraController.handleZoom(delta));
    }

    // Game
    gameManager = new GameManager();
    ruleEngine = new RuleEngine();
    shotManager = new ShotManager();

    // Sabotaj mekaniği (çarpma + tuzak fiziği). Nişancı devrildiğinde
    // onShooterKnocked → insan şarjı iptal (FOUL üretmez).
    sabotageManager = new SabotageManager({
        scene: sceneManager.scene,
        sound,
        particles: particleSystem,   // bomba patlama tozu (Faz 4)
        onShooterKnocked,
        // Bomba patlayınca (vur/vurmasın): turuncu kenar glow + kamera sarsıntısı.
        onExplosion: () => {
            cameraController.shake(0.03, 0.42);
            if (uiManager) uiManager.flashEdge('#ff7a18', 0.85, 550);
        },
        // Enerji Dalgası ATEŞLEME anı: bombadan sert sinema — büyük sarsıntı +
        // zoom punch "geri tepme" + mor kenar flaşı (güç filtresi gameLoop'ta sürülür).
        onBeamFire: () => {
            cameraController.shake(0.045, 0.6);
            cameraController.punch(0.22, 0.55);
            if (uiManager) uiManager.flashEdge('#b06bff', 1.0, 900);
        },
    });

    // Eşya sistemi (Faz 1 omurga): slot + cooldown + item etkinleştirme.
    itemSystem = new ItemSystem({ sabotage: sabotageManager, sound, scene: sceneManager.scene, players });
    // İnsanın (P1) ultisi = "Enerji Dalgası" (şarj + yönlendirilebilir lazer);
    // bot jenerik Şok Dalgası'nda kalır (nişan alamadığı alan etkisi ona daha uygun).
    itemSystem.setUltimate(1, 'ultimate_beam');

    // Eşya kutuları (Faz 2): masada doğan kutular → rastgele item kaynağı.
    itemBoxManager = new ItemBoxManager({
        scene: sceneManager.scene,
        itemSystem,
        particles: particleSystem,
        sound,
        onPickup: (num) => onItemPickup(num),   // insanın toplaması → üst toast + glow
        getBehind: (num) => momentumBehind(num),// Faz 5 momentum: geride kalana güçlü item ağırlığı
    });

    // Kombo → ultimate enerjisi (Faz 6): pot/knock/pickup olayları enerji barını doldurur.
    comboSystem = new ComboSystem();

    // Yerel ilerleme (Faz 15): XP/coin/seviye — maç olaylarını sayar, maç sonunda
    // ödül ekranını besler, localStorage'a yazar. Menü profili de buradan okur.
    progression = new Progression();

    // Maç içi mini olaylar (Faz 13): ara ara çevre değişir (buz/ağır masa/zıpzıp bantlar).
    // Fizik-güvenli + simetrik (top↔masa/bant parametresini geçici ölçekler). LAN'da kapalı (N2).
    eventManager = new EventManager({
        ballPhysics, physicsWorld, balls, scene: sceneManager.scene, pocketDetector,
        ui: uiManager, sound, camera: cameraController,
        // Faz 13b: dev top (fiziksel olay) yalnız GÜVENLİ anda tetiklenir.
        canPhysical: () =>
            gameManager.getState() === GAME_STATES.WALKING &&
            !ballInHandActive && !gameManager.isBreakShot &&
            !players[1].isRagdoll && !players[2].isRagdoll &&
            ballPhysics.areAllStopped(),
    });

    // Bot AI (vs-Bot modunda P2'yi sürer). onShoot → ortak commitShot;
    // onUseItem → bot sabotajcıyken slottaki item'i kullanır; getNearestBox → item topla.
    botController = new BotController({
        gameManager,
        ballPhysics,
        pocketDetector,
        onShoot: (aimAngle, power) => botShoot(aimAngle, power),
        onUseItem: () => useItemAt(2, 'saboteur'),
        getItem: (num) => itemSystem.getItem(num),   // Faz 5: aiMode → menzilli/yakın/tuzak kararı
        getNearestBox: (x, z) => itemBoxManager.getNearestActiveBox(x, z),
    });

    // Win celebration ("Singularity Shot" black-hole finisher)
    finisher = new FinisherEffect({
        scene: sceneManager.scene,
        camera: sceneManager.camera,
        renderer: sceneManager.renderer,
        cameraController,
        balls,
        player,
        sound,
    });

    // Persistent player settings (sound / sensitivity / invert-Y / quality / fps).
    // bind() applies the stored values live to camera, renderer and sound.
    // (Kurulum yukarıda, masa yüklemesinden önce — kalite masa GLB'sini seçer.)
    settings.bind({ camera: cameraController, scene: sceneManager, sound, players, ui: uiManager });

    // Main menu (Rocket League–style live-backdrop menu). PLAY → startGame().
    mainMenu = new MainMenu({ sound, settings, progression });
    mainMenu.onPlay(startGame);
    mainMenu.onLan(openLanMenu);

    // LAN (iki cihaz) — host-otoriter çok-oyunculu altyapısı.
    netSession = new NetSession();
    remoteController = new RemoteController();
    lanMenu = new LanMenu({ sound });
    lanMenu.onHost(startLanHost).onJoin(startLanJoin).onStart(hostStartMatch).onBack(leaveLan);
    wireNetSession();

    // Setup callbacks
    setupInputCallbacks();

    // Start auto matchmaking instead of menu
    startMatchmaking();

    // Start game loop
    requestAnimationFrame(gameLoop);
}

// ---- Menu ↔ Game Transitions ----

/** Show the main menu with the orbiting-camera live backdrop. */
let matchmaker = null;

async function startMatchmaking() {
    uiManager.hideLoading();
    gameManager.setState(GAME_STATES.MENU);
    if (eventManager) eventManager.setEnabled(false);

    paused = false;
    const pm = document.getElementById('pause-menu');
    if (pm) pm.classList.add('hidden');
    setPauseButton(false);

    player = players[1];
    players[1].setVisible(true);
    players[2].setVisible(false);

    player.body.position.set(0, TABLE.HEIGHT + player.fullHeight / 2, 0);
    player.mesh.rotation.y = Math.PI / 2;
    player._syncMesh();

    const c = player.mesh.position;
    cameraController.setFollowTarget(null);
    cameraController.setTarget({ x: c.x, y: c.y + 0.02, z: c.z });
    cameraController.setAimAngle(0);
    cameraController.setMode('menu');

    uiManager.showNotification('Lobiye Bağlanılıyor...', { icon: '⚙️', duration: 0 });

    try {
        const addr = await netSession.host();
        const myId = addr.addr || addr.ip || 'Host';
        
        uiManager.showNotification('Oyuncu Aranıyor... (' + myId.substr(0,4) + ')', { icon: '🔍', duration: 0 });
        
        matchmaker = new Matchmaker(myId);
        matchmaker.findMatch((result) => {
            netSession.close();
            uiManager.showNotification('Rakip Bulundu! Bağlanıyor...', { icon: '🤝', type: 'success', duration: 0 });
            startLanJoin(result.hostId);
        }, () => {
            netSession.close();
            uiManager.showNotification('Eşleşme bulunamadı. Bot başlıyor.', { icon: '🤖', duration: 3000 });
            startGame('vsbot');
        });
        
    } catch(e) {
        console.error(e);
        startGame('vsbot');
    }
}

/**
 * Start a game from the menu.
 * @param {'local2p'|'practice'} [mode] reserved — both start the same game for
 *        now; 'practice'/'vs bot' branching comes later (M4+).
 */
function startGame(mode = 'local2p') {
    mainMenu.hide();
    gameManager.setMode(mode);
    gameManager.currentPlayer = 1;

    // İki karakteri masaya yerleştir + görünür yap (menüde P2 gizliydi).
    players[1].placeAt(PLAYER_START[1].x, PLAYER_START[1].z, PLAYER_START[1].face);
    players[2].placeAt(PLAYER_START[2].x, PLAYER_START[2].z, PLAYER_START[2].face);
    players[1].setVisible(true);
    players[2].setVisible(true);
    player = players[1];

    uiManager.showHUD();
    if (touchControls) touchControls.show();
    uiManager.updateTurn(1, true);
    uiManager.showNotification(mode === 'vsbot' ? 'vs BOT' : 'START', {
        icon: '🚶‍♂️',
        subtext: IS_TOUCH
            ? 'Joystick ile yürü · beyaz topa yaklaş · ATEŞ ile vur'
            : 'Walk to the white ball and click to shoot',
        type: 'success',
        duration: 3500,
    });

    // Camera glides slowly from the close menu shot around to behind player 1.
    cameraController.setFollowTarget(players[myPlayerNum].mesh);
    cameraController.setMode('free');
    cameraController._targetAzimuth = Math.PI; // sweep around to behind the character
    cameraController.slowTransition(1.5);
    gameManager.setState(GAME_STATES.WALKING);

    // İlk tur insan (P1 break). vsbot'ta bot HEMEN sabotaj rolüne girer (insanı
    // kovalar); local2p/practice'te bot boşta. USE-ITEM/SHOOT butonu rolüne göre ayarlanır.
    if (itemSystem) itemSystem.reset();
    if (sabotageManager) sabotageManager.clearAll();   // önceki maçtan kalan yetenekleri temizle
    if (comboSystem) { comboSystem.reset(); uiManager.updateUltimate(0, false); }
    if (itemBoxManager) {
        itemBoxManager.setShown(mode === 'vsbot');   // kutular yalnız vsbot'ta
        itemBoxManager.reset();
    }
    if (eventManager) {
        eventManager.setEnabled(netRole === null);   // mini olaylar tek-cihaz modlarda (LAN'da N2)
        eventManager.reset();
    }
    // Faz 15: maç sayaçlarını başlat — yerel insan profili DAİMA P1'in performansını izler.
    if (progression) progression.beginMatch(1);
    applyTurnRoles();

    const crosshair = document.getElementById('crosshair');
    if (crosshair) crosshair.classList.remove('hidden');

    const controlsHelp = document.getElementById('controls-help');
    if (controlsHelp) controlsHelp.classList.remove('hidden');

    setPauseButton(true);   // yerel maç: ⏸ görünür (LAN startNetGame'de kapalı)
}

// ============================================
// LAN (iki cihaz) — host-otoriter çok-oyunculu (N1: sıra-tabanlı bilardo)
// ============================================
// Host = otoriter simülasyon (mevcut local2p döngüsü; players[2] uzak girdiyle sürülür).
// İstemci = fizik YOK; girdi yollar + host snapshot'ını çizer. Sabotaj/item = N2.

/** Menüden "İki Cihaz (LAN)" → bağlanma ekranını aç. */
function openLanMenu() {
    mainMenu.hide();
    lanMenu.show();
}

/** Net oturum callback'lerini bağla (host: istemci girdisi · istemci: snapshot/olay). */
function wireNetSession() {
    netSession.onError = (r) => {
        if (netSession.isClient()) lanMenu.setJoinStatus('Hata: ' + r, 'err');
        else lanMenu.setHostStatus('Hata: ' + r, 'err');
    };
    netSession.onPeerOpen = () => {
        uiManager.hideLoading();
        uiManager.showNotification('Rakip Bağlandı! Maç Başlıyor...', { type: 'success', duration: 2000 });
        if (netSession.isHost()) {
            hostStartMatch();
        }
    };
    netSession.onPeerClose = () => onNetDisconnect();
    // Host tarafı: istemci girdisi
    netSession.onInput = (obj) => remoteController.applyInput(obj);
    netSession.onShoot = (obj) => remoteController.queueShoot(obj);
    // İstemci tarafı: host akışı
    netSession.onStart = () => { lanMenu.hide(); startNetGame('client'); };
    netSession.onSnap = (obj) => {
        _lastSnap = obj;
        _snapBuf.push({ t: performance.now() / 1000, snap: obj });
        if (_snapBuf.length > 30) _snapBuf.shift();   // ~1s pencere (internet jitter için)
        // İstemci fizik tahmini: her snapshot'ta top hızlarını ve pozisyon düzeltmelerini uygula
        if (netRole === 'client' && ballPhysics) {
            applyBallCorrections(obj, ballPhysics);
            // Toplar hareket halindeyse yerel fizik motoru açılsın
            const st = obj.st ? obj.st.s : null;
            _clientBallsMoving = (st === GAME_STATES.BALLS_MOVING || st === GAME_STATES.SHOOTING);
        }
    };
    netSession.onEvent = (obj) => onNetEvent(obj);
    netSession.onBye = () => onNetDisconnect();
}

/** Host: sunucuyu başlat, LAN adresini göster (istemciye verilecek). */
async function startLanHost() {
    if (!NetSession.canHost()) {
        lanMenu.setHostAddress(null);
        lanMenu.setHostStatus('Bu cihaz sunucu olamaz (yalnız APK\'da çalışır).', 'err');
        return;
    }
    try {
        const addr = await netSession.host(DEFAULT_PORT);
        lanMenu.setHostAddress(addr);
        lanMenu.setHostStatus('İstemci bekleniyor…');
    } catch (e) {
        lanMenu.setHostStatus('Sunucu başlatılamadı: ' + (e.message || e), 'err');
    }
}

/** İstemci: host'un ws adresine bağlan (IP girişinden). */
function startLanJoin(ip) {
    netSession.join(`ws://${ip}:${DEFAULT_PORT}`);
}

/** Host: "BAŞLAT" → istemciye START yolla, maçı kur. */
function hostStartMatch() {
    if (!netSession.connected) return;
    netSession.send({ t: MSG.START, youAre: 2 });
    lanMenu.hide();
    startNetGame('host');
}

/** Net maçı kur (host ve istemci ortak). */
function startNetGame(role) {
    netRole = role;
    myPlayerNum = role === 'host' ? 1 : 2;
    _lastSnap = null; _snapBuf = []; _snapAccum = 0; _inputAccum = 0; _clientCharging = false; _clientCamNum = 0;
    remoteController.reset();
    if (eventManager) eventManager.setEnabled(false);   // LAN: mini olaylar kapalı (senkron N2)

    // Temiz başlangıç (menüden dönülmüş olabilir): topları yeniden diz.
    balls.removeAll();
    if (role === 'host') {
        ballPhysics.getAllActiveBallIds().forEach((id) => ballPhysics.removeBall(id));
        ballPhysics.createAllBalls();
    }
    balls.createAllBalls();

    // N1: net oyun = sıra-tabanlı bilardo → sabotaj/kutu KAPALI (mode local2p).
    gameManager.reset();
    gameManager.setMode('local2p');
    gameManager.currentPlayer = 1;
    gameManager.isBreakShot = true;
    if (itemSystem) itemSystem.reset();
    if (sabotageManager) sabotageManager.clearAll();
    if (comboSystem) { comboSystem.reset(); uiManager.updateUltimate(0, false); }
    if (itemBoxManager) itemBoxManager.setShown(false);   // kutular net modda yok (N1)
    if (progression) progression.beginMatch(1);   // Faz 15: LAN host da XP kazanır (host = P1)
    uiManager.updatePlayerTypes(null, null);
    uiManager.updatePlayerBalls([], [], [], []);

    if (role === 'host') installHostNetTaps();   // bildirimleri istemciye yansıt
    setPauseButton(false);   // LAN'da pause yok (host durursa istemci donar)

    players[1].placeAt(PLAYER_START[1].x, PLAYER_START[1].z, PLAYER_START[1].face);
    players[2].placeAt(PLAYER_START[2].x, PLAYER_START[2].z, PLAYER_START[2].face);
    players[1].setVisible(true); players[2].setVisible(true);
    player = players[myPlayerNum];   // bu cihazın sürdüğü karakter

    uiManager.showHUD();
    if (touchControls) { touchControls.show(); touchControls.setRole('shooter'); }
    uiManager.updateTurn(1, true);
    uiManager.showNotification(role === 'host' ? 'SUNUCU · BREAK' : 'BAĞLANDI', {
        icon: '🎱',
        subtext: role === 'host' ? 'Sen Player 1 (host)' : 'Sen Player 2',
        type: 'success', duration: 3000,
    });

    const crosshair = document.getElementById('crosshair');
    if (crosshair) crosshair.classList.remove('hidden');

    if (role === 'host') {
        botController.stop();
        cameraController.setFollowTarget(players[myPlayerNum].mesh);
        cameraController.setMode('free');
        cameraController._targetAzimuth = Math.PI;
        cameraController.slowTransition(1.5);
        gameManager.setState(GAME_STATES.WALKING);
    } else {
        cameraController.setFollowTarget(players[myPlayerNum].mesh);
        cameraController.setMode('free');
        _clientCamNum = myPlayerNum;
    }
}

/** Host: bildirim + game-over çağrılarını istemciye de yolla (sar). */
function installHostNetTaps() {
    if (_origShowNote) return;
    _origShowNote = uiManager.showNotification.bind(uiManager);
    _origShowOver = uiManager.showGameOver.bind(uiManager);
    uiManager.showNotification = (text, opts = {}) => {
        if (netSession && netSession.isHost()) netSession.send({ t: MSG.EVENT, kind: 'note', text, opts });
        return _origShowNote(text, opts);
    };
    uiManager.showGameOver = (w, r, rw) => {
        // Ödüller (Faz 15) YEREL kalır — istemciye yalnız kazanan/sebep gider.
        if (netSession && netSession.isHost()) netSession.send({ t: MSG.EVENT, kind: 'over', w, r });
        return _origShowOver(w, r, rw);
    };
}
function removeHostNetTaps() {
    if (_origShowNote) { uiManager.showNotification = _origShowNote; _origShowNote = null; }
    if (_origShowOver) { uiManager.showGameOver = _origShowOver; _origShowOver = null; }
}

/** İstemci: host olayları (bildirim/game-over/yeniden diz). */
function onNetEvent(obj) {
    if (obj.kind === 'note') uiManager.showNotification(obj.text, obj.opts || {});
    else if (obj.kind === 'over') { if (touchControls) touchControls.hide(); uiManager.showGameOver(obj.w, obj.r); }
    else if (obj.kind === 'rerack') netClientRerack();
}

/** İstemci: host yeniden başlattı → topları yeniden diz + HUD sıfırla. */
function netClientRerack() {
    balls.removeAll();
    balls.createAllBalls();
    uiManager.hideGameOver();
    uiManager.hideNotification();
    uiManager.showHUD();
    if (touchControls) touchControls.show();
    uiManager.updateTurn(1, true);
    uiManager.updatePlayerTypes(null, null);
}

/** Lobi'de bağlantıyı iptal et (seçim ekranında kal). */
function cancelNetConnect() {
    removeHostNetTaps();
    if (netSession) netSession.close();
    netRole = null; _lastSnap = null; remoteController.reset();
    lanMenu.setHostStatus('İstemci bekleniyor…');
    lanMenu.setJoinStatus('');
}

/** LAN ekranından ana menüye dön. */
function exitLanToMenu() {
    cancelNetConnect();
    lanMenu.hide();
    mainMenu.show();
}

/** Maç sırasında bağlantı koptu → menüye dön. */
function endNetMatch(reason) {
    removeHostNetTaps();
    if (netSession) netSession.close();
    netRole = null; _lastSnap = null; remoteController.reset();
    if (touchControls) touchControls.hide();
    uiManager.hideGameOver();
    uiManager.hideHUD();
    const crosshair = document.getElementById('crosshair');
    if (crosshair) crosshair.classList.add('hidden');
    enterMenu();
    if (reason) uiManager.showNotification(reason, { icon: '🔌', type: 'foul', duration: 2500 });
}

function leaveLan() { exitLanToMenu(); }   // LanMenu.onBack (seçim ekranından çıkış)

function onNetDisconnect() {
    const inMatch = netRole && gameManager.getState() !== GAME_STATES.MENU;
    if (inMatch) { endNetMatch('Bağlantı koptu'); return; }
    if (netSession.isHost()) lanMenu.setHostStatus('İstemci ayrıldı, tekrar bekleniyor…');
    else if (netSession.isClient()) lanMenu.setJoinStatus('Bağlantı kapandı.', 'err');
}

/** Host: her kare karakter güncellemesi (yerel = P1, uzak = P2). */
function hostUpdateChars(dt, state, camFwd) {
    const active = gameManager.currentPlayer;   // 1 = host(yerel), 2 = istemci(uzak)
    const walkStates = state === GAME_STATES.WALKING ||
        state === GAME_STATES.BALLS_MOVING || state === GAME_STATES.SHOOTING;

    // Her iki oyuncu da her zaman yürüyebilir! (ZERO_MOVE dondurması kaldırıldı)
    const inp1 = (walkStates && !players[1].isRagdoll) ? readHumanMoveInput() : ZERO_MOVE;
    players[1].update(dt, inp1, camFwd);

    const inp2 = (walkStates && !players[2].isRagdoll) ? remoteController.moveInput : ZERO_MOVE;
    players[2].update(dt, inp2, remoteController.forward);

    // İstemci atışı: yalnız kendi sırasında + WALKING + tekme atmıyorken.
    if (active === 2 && state === GAME_STATES.WALKING && !players[2].isKicking) {
        const s = remoteController.consumeShoot();
        if (s) botShoot(s.aim, s.power);
    }
}

/** İstemci kare: simülasyon yok — snapshot çiz + girdi yolla + kamera + render. */
function netClientFrame(dt, dx, dy, scroll) {
    const st = _lastSnap && _lastSnap.st ? _lastSnap.st : null;
    const cp = st ? st.cp : 1;
    const sState = st ? st.s : GAME_STATES.WALKING;

    // ---- KENDİ KARAKTERİMİZ YEREL TAHMİN (Client-Side Prediction) ----
    // Sunucudan gelen snapshot'ı beklemeden yerel olarak 60 FPS'de hareket et.
    const canWalk = sState === GAME_STATES.WALKING || sState === GAME_STATES.BALLS_MOVING || sState === GAME_STATES.SHOOTING;
    let mv = ZERO_MOVE;
    let fwd = FORWARD_Z;
    if (canWalk && !_clientCharging && !players[myPlayerNum].isRagdoll) {
        mv = readHumanMoveInput();
        sceneManager.camera.getWorldDirection(_aimDir);
        fwd = _camFwdXZ.set(_aimDir.x, 0, _aimDir.z);
        if (fwd.lengthSq() > 1e-6) fwd.normalize();
        // Karakterimizi yerel olarak hareket ettiriyoruz
        players[myPlayerNum].update(dt, mv, fwd);
    } else {
        // Hareket yoksa veya ragdoll ise sadece animasyon/durum güncelle
        players[myPlayerNum].update(dt, ZERO_MOVE, FORWARD_Z);
    }

    // ---- SUNUCU İLE YUMUŞAK EŞİTLEME (Kendi Karakterimiz) ----
    // Karakterimizin konumu sunucudan gelen son snapshot ile yumuşakça eşlenir (desync önlenir).
    if (_lastSnap && _lastSnap.pl) {
        const mySnap = _lastSnap.pl[myPlayerNum - 1];
        if (mySnap && !players[myPlayerNum].isRagdoll) {
            const body = players[myPlayerNum].body;
            const sx = mySnap.p[0], sy = mySnap.p[1], sz = mySnap.p[2];
            const dx = sx - body.position.x;
            const dz = sz - body.position.z;
            const distSq = dx * dx + dz * dz;

            if (distSq > 0.25) {
                // Büyük fark → doğrudan eşitle
                body.position.set(sx, sy, sz);
            } else {
                // Küçük fark → yumuşak çek (%10)
                body.position.x += dx * 0.10;
                body.position.z += dz * 0.10;
            }
            body.position.y = sy;
            // Animasyon durumunu sunucudan eşitle
            players[myPlayerNum].isKicking = (mySnap.a === 3);
        }
    }

    // ---- TOP HAREKETİ: Hız ekstrapolasyonu (CANNON fiziği YOK) ----
    if (_clientBallsMoving && _lastSnap && _lastSnap.b) {
        for (const it of _lastSnap.b) {
            const id = it[0];
            const vx = it[4] || 0, vz = it[5] || 0;
            if (Math.abs(vx) < 0.001 && Math.abs(vz) < 0.001) continue;
            const body = ballPhysics.getBallBody(id);
            if (!body) continue;
            body.position.x += vx * dt;
            body.position.z += vz * dt;
        }
        const positions = ballPhysics.getPositions();
        const quaternions = ballPhysics.getQuaternions();
        balls.syncWithPhysics(positions, quaternions);
    }

    // ---- RAKİP OYUNCU İNTERPOLASYONU ----
    // Diğer oyuncuyu pürüzsüz interpolasyon ile hareket ettir.
    const renderT = performance.now() / 1000 - INTERP_DELAY;
    let s0 = null, s1 = null;
    for (let i = _snapBuf.length - 1; i >= 1; i--) {
        if (_snapBuf[i - 1].t <= renderT && _snapBuf[i].t >= renderT) {
            s0 = _snapBuf[i - 1]; s1 = _snapBuf[i]; break;
        }
    }
    if (s0 && s1) {
        const span = s1.t - s0.t;
        const alpha = span > 1e-4 ? Math.min(1, Math.max(0, (renderT - s0.t) / span)) : 1;
        
        // Sadece rakip oyuncuyu interpolasyonla güncelle
        if (s0.snap.pl && s1.snap.pl) {
            const otherPlayerNum = myPlayerNum === 1 ? 2 : 1;
            const e0 = s0.snap.pl[otherPlayerNum - 1];
            const e1 = s1.snap.pl[otherPlayerNum - 1];
            const p = players[otherPlayerNum];

            if (e0 && e1) {
                const rag = !!e1.g;
                const x = e0.p[0] + (e1.p[0] - e0.p[0]) * alpha;
                const y = e0.p[1] + (e1.p[1] - e0.p[1]) * alpha;
                const z = e0.p[2] + (e1.p[2] - e0.p[2]) * alpha;
                let dd = e1.r - e0.r;
                while (dd > Math.PI) dd -= 2 * Math.PI;
                while (dd < -Math.PI) dd += 2 * Math.PI;
                const ry = e0.r + dd * alpha;
                p.applyNet(dt, x, y, z, ry, e1.a, rag, e1.q);
            }
        }
        // Toplar duruyorsa snapshot interpolasyonu kullan
        if (!_clientBallsMoving && s1.snap.b) {
            const m0 = new Map();
            if (s0.snap.b) for (const it of s0.snap.b) m0.set(it[0], it);
            const map = new Map();
            const present = new Set();
            for (const it1 of s1.snap.b) {
                const id = it1[0]; present.add(id);
                const it0 = m0.get(id) || it1;
                map.set(id, {
                    x: it0[1] + (it1[1] - it0[1]) * alpha,
                    y: it0[2] + (it1[2] - it0[2]) * alpha,
                    z: it0[3] + (it1[3] - it0[3]) * alpha,
                });
            }
            balls.syncWithPhysics(map);
            for (const id of balls.getAllActiveBallIds()) if (!present.has(id)) balls.removeBall(id);
        }
    } else if (_lastSnap) {
        // Tampon yetersizse rakip verilerini doğrudan uygula
        const otherPlayerNum = myPlayerNum === 1 ? 2 : 1;
        if (_lastSnap.pl) {
            const opp = _lastSnap.pl[otherPlayerNum - 1];
            if (opp) players[otherPlayerNum].applyNet(dt, opp.p[0], opp.p[1], opp.p[2], opp.r, opp.a, !!opp.g, opp.q);
        }
        if (!_clientBallsMoving && _lastSnap.b) {
            const map = new Map();
            const present = new Set();
            for (const it of _lastSnap.b) { map.set(it[0], { x: it[1], y: it[2], z: it[3] }); present.add(it[0]); }
            balls.syncWithPhysics(map);
            for (const id of balls.getAllActiveBallIds()) if (!present.has(id)) balls.removeBall(id);
        }
    }

    if (st) {
        uiManager.updateTurn(cp, false);
        if (st.t1) uiManager.updatePlayerTypes(st.t1, st.t2);
    }

    // Kamera DAİMA istemcinin KENDİ karakterini (myPlayerNum) takip eder.
    const camTargetNum = myPlayerNum;
    if (camTargetNum !== _clientCamNum) {
        _clientCamNum = camTargetNum;
        cameraController.setFollowTarget(players[camTargetNum].mesh);
        cameraController.setMode('free');
    }
    if (inputManager.isPointerLocked() || IS_TOUCH) cameraController.handleRotation(dx, dy);
    if (scroll) cameraController.handleZoom(scroll);
    cameraController.setTarget(players[camTargetNum].mesh.position);

    // Yerel girdi → host (sıra şartı KALKTI, her zaman hareket edebilir)
    const myTurn = cp === myPlayerNum;
    _inputAccum += dt;
    if (_inputAccum >= 1 / INPUT_HZ) {
        _inputAccum = 0;
        const canWalk = sState === GAME_STATES.WALKING || sState === GAME_STATES.BALLS_MOVING || sState === GAME_STATES.SHOOTING;
        const mv = (!_clientCharging && canWalk) ? readHumanMoveInput() : ZERO_MOVE;
        sceneManager.camera.getWorldDirection(_aimDir);
        const f = _camFwdXZ.set(_aimDir.x, 0, _aimDir.z);
        if (f.lengthSq() > 1e-6) f.normalize();
        netSession.send({ t: MSG.INPUT, mv: [mv.x, mv.y], fwd: [f.x, f.z] });
    }

    // Şarj / nişan çizgisi.
    if (_clientCharging) {
        powerBar.update(dt);
        updateAimLine(true);
    } else if (myTurn && sState === GAME_STATES.WALKING) {
        updateAimLine(false);
    } else {
        aimController.hide();
    }

    // Şarj kamera nefesi istemcide de (kendi telefonunda atış hissi).
    cameraController.setCharge(_clientCharging ? powerBar.getPower() : 0);
    cameraController.setSideFrac(CAMERA.TPS_SIDE);   // TPS çerçevesi istemcide de
    cameraController.update(dt);
    sceneManager.render();
}

/** İstemci: şarjı başlat (kendi sırasında + cue topa yakınken). */
function clientTryCharge() {
    if (netRole !== 'client' || _clientCharging) return;
    const cp = _lastSnap && _lastSnap.st ? _lastSnap.st.cp : 1;
    if (cp !== myPlayerNum) return;
    const cue = balls.getCueBall();
    if (!cue) return;
    if (players[2].mesh.position.distanceTo(cue.position) < CAMERA.SHOOT_RANGE) {
        _clientCharging = true;
        powerBar.startCharging();
        uiManager.showPowerBar();
        if (touchControls && touchControls._shootBtn) touchControls._shootBtn.classList.add('charging');
        const crosshair = document.getElementById('crosshair');
        if (crosshair) crosshair.classList.add('charging');
    } else {
        uiManager.showNotification('TOO FAR', { subtext: 'Beyaz topa yaklaş', type: 'foul', duration: 1500 });
    }
}

/** İstemci: şarjı bırak → atışı (aim+power) host'a yolla. */
function clientReleaseShot() {
    if (!_clientCharging) return;
    _clientCharging = false;
    const power = powerBar.stopCharging();
    uiManager.hidePowerBar();
    aimController.hide();
    const crosshair = document.getElementById('crosshair');
    if (crosshair) crosshair.classList.remove('charging');
    if (touchControls && touchControls._shootBtn) touchControls._shootBtn.classList.remove('charging');
    const camDir = new THREE.Vector3();
    sceneManager.camera.getWorldDirection(camDir);
    const aim = Math.atan2(camDir.z, camDir.x);
    netSession.send({ t: MSG.SHOOT, aim, power });
}

// ---- Turn / Shot Helpers (iki karakter + bot) ----

/** `player` takma adını sıradaki oyuncuya bağla. */
function syncActivePlayer() {
    player = players[gameManager.currentPlayer];
}

/**
 * Kameranın/insan kontrolünün odağındaki karakter. vsbot'ta DAİMA players[1]
 * (insan) — kendi sırasında nişancı, rakip sırasında sabotajcı; ikisinde de insan
 * players[1]'i sürer ve kamera onu takip eder. Diğer modlarda aktif oyuncu.
 */
function focusCharacter() {
    // Multiplayer'da sıra kime geçerse geçsin herkes kendi kamerasını (oyuncusunu) izler.
    return players[myPlayerNum];
}

/**
 * Kamera juice (Faz 8): her kare bir kez — takip edilen karakterin hızını koşu bob'una,
 * insan nişancının cue topa yakınlığını yaklaşma zoom'una besler. (CameraController
 * ikisini de yumuşatır + yalnız hareket modlarında uygular.) MENU/yükleme dışında çağrılır.
 */
let _camFocusLast = null;
let _stepAccum = 0;   // Faz 9: ayak sesi için kat edilen mesafe biriktirici
const STEP_DIST = 0.065;   // m — bu mesafede bir ayak sesi (hız arttıkça sıklaşır)
function updateCameraJuice(dt, state) {
    const focus = focusCharacter();
    if (!focus || !focus.mesh) {
        cameraController.setMoveIntensity(0);
        cameraController.setApproach(0);
        cameraController.setCharge(0);
        cameraController.setSideOffset(0);
        cameraController.setSideFrac(0);
        return;
    }
    const p = focus.mesh.position;

    // "Enerji Dalgası" sineması: kanal boyunca kamera hafif SAĞA süzülür (karakter
    // solda kalır — anime çerçevesi, top+lazer sahneyi doldurur); ATEŞ fazında mor
    // "güç filtresi" ekranda (SabotageManager.isBeamFiring → UIManager.setUltiTint).
    const beamCh = sabotageManager && sabotageManager.isBeamChanneling(gameManager.humanPlayer);
    cameraController.setSideOffset(beamCh ? BEAM.CAM_SIDE : 0);

    // TPS çerçevesi (2026-07-10): oyun içinde karakter ekranın SOLUNDA, crosshair ortada
    // (omuz-üstü). Menü/yükleme yakın çekimi bozulmasın diye yalnız oyun state'lerinde.
    const tpsOn = state !== GAME_STATES.MENU && state !== GAME_STATES.LOADING;
    cameraController.setSideFrac(tpsOn ? CAMERA.TPS_SIDE : 0);
    if (uiManager && uiManager.setUltiTint) {
        uiManager.setUltiTint(!!(sabotageManager && sabotageManager.isBeamFiring()));
    }

    // Koşu bob şiddeti: takip edilen karakterin yatay hızı / referans (walkSpeed).
    let intensity = 0;
    if (_camFocusLast && dt > 0) {
        const moved = Math.hypot(p.x - _camFocusLast.x, p.z - _camFocusLast.z);
        const sp = moved / dt;
        intensity = Math.min(1, sp / CAMERA.BOB_REF_SPEED);

        // Faz 9: ayak sesi — kat edilen mesafeyle adım at (hız arttıkça sıklaşır), devrilmişken yok.
        // Walk/run SEÇİMİ + koşu stride'ı karakterin GERÇEK yürüyüşüne bağlı (`Player.running`,
        // animasyonla aynı histerezisli _gait) — hız eşiğiyle seçim yürürken araya koşu sesi
        // karıştırıyordu. Koşuda adım (stride) ×1.8 → ses ayak vuruşlarına oturur.
        if (!focus.isRagdoll && intensity > 0.12) {
            _stepAccum += moved;
            const running = !!focus.running;
            const stride = STEP_DIST * (running ? 1.8 : 1);
            if (_stepAccum >= stride) {
                _stepAccum = 0;
                if (sound && sound.playFootstep) sound.playFootstep(0.35 + intensity * 0.45, running);
            }
        } else {
            _stepAccum = STEP_DIST;   // durunca bir sonraki adım hemen tetiklensin
        }
    }
    _camFocusLast = { x: p.x, z: p.z };
    if (focus.isRagdoll) intensity = 0;   // devrilince bob yok
    cameraController.setMoveIntensity(intensity);

    // Yaklaşma zoom'u: yalnız insan NİŞANCI kendi sırasında (WALKING/POWER) cue topa yaklaşırken.
    let approach = 0;
    if (!gameManager.isBotTurn() &&
        (state === GAME_STATES.WALKING || state === GAME_STATES.POWER)) {
        const cue = ballPhysics.getCueBallPosition();
        if (cue && player && player.mesh) {
            const d = player.mesh.position.distanceTo(cue);
            const span = CAMERA.APPROACH_FAR - CAMERA.APPROACH_NEAR;
            approach = 1 - Math.min(1, Math.max(0, (d - CAMERA.APPROACH_NEAR) / span));
        }
    }
    cameraController.setApproach(approach);

    // Güç şarjı kamera nefesi: POWER'da güç salındıkça kamera hafifçe içeri/dışarı süzülür.
    const charging = state === GAME_STATES.POWER && powerBar && powerBar.isCharging();
    cameraController.setCharge(charging ? powerBar.getPower() : 0);
}

/**
 * 8-top "Final Evresi" (Faz 10): aktif nişancı grubunu temizlediyse (yalnız 8-top kaldı →
 * bu atış maçı bitirebilir) gerilim modunu aç — kırmızı vinyet + sahne kırmızı tinti +
 * kamera gerilim zoom'u + alçak drone + "SON TOP!" toast. Durum değişince efektleri toggle'lar.
 */
let _finalPhase = false;
function updateFinalPhase() {
    const s = gameManager.getState();
    const playable = s !== GAME_STATES.GAME_OVER && s !== GAME_STATES.MENU && s !== GAME_STATES.LOADING;
    const active = playable && gameManager.hasPlayerClearedGroup(gameManager.currentPlayer);
    if (active === _finalPhase) return;
    _finalPhase = active;
    setFinalPhase(active);
}

function setFinalPhase(on) {
    document.body.classList.toggle('final-phase', on);
    cameraController.setTension(on ? 1 : 0);
    if (sceneManager && sceneManager.setTension) sceneManager.setTension(on);
    if (sound) { if (on) sound.startTension && sound.startTension(); else sound.stopTension && sound.stopTension(); }
    if (on) {
        const onEight = gameManager.currentPlayer === gameManager.humanPlayer || gameManager.mode !== 'vsbot';
        uiManager.showNotification('SON TOP!', {
            icon: '🎱',
            subtext: onEight ? '8 numara — final atışı' : 'Rakip 8-topta — dikkat!',
            type: 'danger', duration: 1900,
        });
    }
}

/** İnsanın analog hareket vektörü: joystick (touch) veya WASD (masaüstü). */
function readHumanMoveInput() {
    // Enerji Dalgası kanalı: karakter KİLİTLİ — hareket yok, yalnız kamerayla yön verilir.
    if (sabotageManager && sabotageManager.isBeamChanneling(gameManager.humanPlayer)) return ZERO_MOVE;
    if (IS_TOUCH && touchControls) {
        const v = touchControls.getMoveVector();
        return { x: v.x, y: v.y };
    }
    const k = inputManager.keys;
    return {
        x: (k.d ? 1 : 0) - (k.a ? 1 : 0),
        y: (k.w ? 1 : 0) - (k.s ? 1 : 0),
    };
}

/** İnsan şu an sabotajcı mı? (vsbot + sıra botta + sabotaj penceresi) */
function humanIsSaboteur() {
    return humanActiveRole() === 'saboteur';
}

/** Bu cihazdaki yerel insan ŞU AN atış/şarj yapabilir mi? (LAN'da tur sahipliği). */
function localCanShoot() {
    // Enerji Dalgası kanalı: lazer bitene kadar cue şarjı yok (karakter kilitli).
    if (sabotageManager && sabotageManager.isBeamChanneling(gameManager.humanPlayer)) return false;
    if (netRole === 'host')   return gameManager.currentPlayer === myPlayerNum;  // host = P1
    if (netRole === 'client') return false;   // istemci ayrı yoldan (clientTryCharge)
    return !gameManager.isBotTurn();
}

/**
 * İnsanın sabotaj penceresindeki AKTİF rolü: kendi sırasında 'shooter' (savunma
 * item'ı kullanabilir, ör. kalkan), bot sırasında 'saboteur' (saldırı item'ı). Pencere
 * dışında null (item kullanılamaz). Hangi item'in kullanılabileceğini bu belirler.
 */
function humanActiveRole() {
    const s = gameManager.getState();
    if (s !== GAME_STATES.WALKING && s !== GAME_STATES.POWER) return null;
    return gameManager.currentPlayer === myPlayerNum ? 'shooter' : 'saboteur';
}

/**
 * Tur rollerini uygula: sabotaj durumunu temizle, botu doğru role sok, touch
 * butonunu (SHOOT/TRAP) sıraya göre ayarla. beginTurn ve startGame ortak kullanır.
 */
function applyTurnRoles() {
    if (sabotageManager) sabotageManager.reset();   // tuzakları + devrilenleri temizle

    if (gameManager.mode === 'vsbot') {
        if (gameManager.isBotTurn()) {
            botController.startBilliards(players[2]);          // bot kendi sırası → bilardo
        } else {
            botController.startSabotage(players[2], players[1]); // insan sırası → bot sabotaj
        }
    } else {
        botController.stop();
    }

    // Touch: insan sabotajcıyken USE-ITEM, nişancıyken SHOOT göster.
    if (touchControls) {
        touchControls.setRole(
            gameManager.currentPlayer !== myPlayerNum ? 'saboteur' : 'shooter'
        );
    }
    // Eşya item'ları artık KUTULARDAN gelir (Faz 2); tur başında otomatik verilmez.
    // Slotlar tur boyunca KORUNUR (kendi sıranda kaptığın item'i sonraki sabotaj turunda kullanırsın).
}

/**
 * Yeni tur: aktif oyuncuyu bağla, rolleri uygula, kamerayı odak karaktere çevir,
 * WALKING'e geç. (Asla donmaz; oyun hemen WALKING'e döner.)
 */
function beginTurn() {
    syncActivePlayer();
    gameManager.setState(GAME_STATES.WALKING);
    applyTurnRoles();

    const focus = focusCharacter();   // vsbot → players[1] (insan), aksi → aktif oyuncu
    cameraController.setFollowTarget(focus.mesh);
    cameraController.setMode('free');
    cameraController.setTarget(focus.mesh.position);
}

/** İnsan şarjını iptal et (sabotajlandığında): power bar + aim + crosshair temizle. */
function cancelHumanCharge() {
    powerBar.stopCharging();
    uiManager.hidePowerBar();
    aimController.hide();
    const crosshair = document.getElementById('crosshair');
    if (crosshair) crosshair.classList.remove('charging');
    if (touchControls && touchControls._shootBtn) touchControls._shootBtn.classList.remove('charging');
    gameManager.setState(GAME_STATES.WALKING);
}

/**
 * Nişancı devrildiğinde SabotageManager çağırır. FOUL ÜRETMEZ. Geri bildirim artık
 * dev orta-ekran yazısı DEĞİL: insan devrilince kırmızı kenar glow'u (showNotification
 * type='danger' tetikler) + kamera sarsıntısı + kısa üst toast; bot devrilince yeşil
 * "botu devirdin". (İnsan şarj ederken zaten dokunulmaz; bu yalnız yürürken olur.)
 */
function onShooterKnocked(victimNum) {
    // Kombo (Faz 6): devirmeyi YAPAN (kurbanın rakibi = sabotajcı/sahip) enerji kazanır.
    if (comboSystem) comboSystem.addEvent(victimNum === 1 ? 2 : 1, 'knock');
    if (progression) progression.addEvent(victimNum === 1 ? 2 : 1, 'knock');   // Faz 15: XP

    // Kim devrildi? (SabotageManager kurbanın no'sunu verir — nişancı olmak zorunda değil;
    // tuzak/bomba tur değişse de sahibin rakibini etkiler.)
    const humanKnocked = victimNum === gameManager.humanPlayer;
    if (humanKnocked) {
        if (gameManager.getState() === GAME_STATES.POWER) cancelHumanCharge();
        cameraController.shake(0.024, 0.36);
        uiManager.showNotification('SABOTE EDİLDİN', {
            icon: '💥', type: 'danger', duration: 1300,
        });
    } else {
        cameraController.shake(0.013, 0.26);
        uiManager.showNotification('SABOTAJ!', {
            icon: '😈', subtext: 'Botu devirdin', type: 'success', duration: 1200,
        });
    }
}

/**
 * Bir oyuncunun slotundaki item'i kendi konumunda kullanır (ortak yol: insan + bot).
 * role verilirse item.role ile eşleşmeli (saldırı item'ı yalnız sabotajcı, savunma
 * yalnız nişancı) — yanlış rolde tüketilmez (slot korunur).
 */
function useItemAt(num, role) {
    const p = players[num];
    if (!p || p.isRagdoll) return false;
    const def = itemSystem.getItem(num);
    if (!def) return false;
    if (role && def.role && def.role !== 'any' && def.role !== role) return false;
    return itemSystem.useItem(num, {
        x: p.mesh.position.x, z: p.mesh.position.z,
        aimDir: computeAimDir(num),   // bomba yuvarlama yönü (diğer item'lar yok sayar)
    });
}

/**
 * İtem aim yönü (XZ): insan → kamera bakış yönü (baktığın yere yuvarla); bot →
 * rakibe (nişancıya) doğru. Bomba bunu kullanır; homing mermi kendi takip eder.
 */
function computeAimDir(num) {
    const p = players[num];
    if (!p) return null;
    if (num === gameManager.humanPlayer) {
        const camDir = new THREE.Vector3();
        sceneManager.camera.getWorldDirection(camDir);
        const d = new THREE.Vector3(camDir.x, 0, camDir.z);
        if (d.lengthSq() < 1e-6) return { x: Math.sin(p.mesh.rotation.y), z: Math.cos(p.mesh.rotation.y) };
        d.normalize();
        return { x: d.x, z: d.z };
    }
    const opp = players[num === 1 ? 2 : 1];
    if (!opp) return null;
    const dx = opp.mesh.position.x - p.mesh.position.x;
    const dz = opp.mesh.position.z - p.mesh.position.z;
    const l = Math.hypot(dx, dz) || 1;
    return { x: dx / l, z: dz / l };
}

/**
 * Dash VFX: dash'teyken HAREKET eden karakterin ayağına ardışık ayak izi (sol/sağ) +
 * toz halkası bırakır. Yalnız gerçekten ilerlerken (yerinde dururken iz yok).
 */
function updateDashFx(dt) {
    if (!particleSystem || dt <= 0) return;
    for (const num of [1, 2]) {
        const p = players[num];
        const st = _dashFx[num];
        if (!p || !p.isDashing || p.isRagdoll) { st.t = 0; st.lx = null; continue; }

        const x = p.mesh.position.x, z = p.mesh.position.z;
        const moved = st.lx != null ? Math.hypot(x - st.lx, z - st.lz) : 0;
        st.lx = x; st.lz = z;
        if (moved / dt < 0.05) continue;   // hareket etmiyorsa iz bırakma

        st.t -= dt;
        if (st.t <= 0) {
            st.t = 0.1;   // iz aralığı
            const ang = p.mesh.rotation.y;
            const px = Math.cos(ang), pz = -Math.sin(ang);   // yürüyüş yönüne dik (sol/sağ)
            const off = 0.008 * st.side;
            particleSystem.spawnFootprint(x + px * off, z + pz * off);
            particleSystem.createDashPuff(x, z);
            st.side *= -1;
        }
    }
}

/** İnsan (E tuşu / USE / KALKAN butonu) → aktif rolüne uygun slottaki item'i kullanır. */
function useHumanItem() {
    if (eventManager && eventManager.isShotLocked()) return;   // dev top geçerken aksiyon yok
    const role = humanActiveRole();
    if (!role) return;
    const def = itemSystem.getItem(gameManager.humanPlayer);   // kullanmadan önce yakala
    const used = useItemAt(gameManager.humanPlayer, role);
    // Kalkan açılışı: cam-göbeği kenar glow'u (korunma hissi). Kabuk zaten görünür.
    if (used && def && def.id === 'shield') uiManager.flashEdge('#4dd2ff', 0.5, 500);
}

/**
 * Faz 7 — Ultimate. Yalnız vsbot'ta (enerji HUD'u + bot orada). Enerji doluysa ('Q' /
 * bar dokunması) Şok Dalgası'nı tetikler: sahadaki tehlikeleri siler + rakibi devirir
 * (korumaları deler) + kullanana kalkan. Sonra enerjiyi harca + kısa sinematik.
 * Tetik penceresi WALKING/POWER (item kullanımıyla tutarlı).
 */
function triggerUltimate(num) {
    if (gameManager.mode !== 'vsbot') return false;
    if (eventManager && eventManager.isShotLocked()) return false;   // dev top geçerken ulti yok
    if (!comboSystem || !comboSystem.isUltReady(num)) return false;
    const p = players[num];
    if (!p || p.isRagdoll) return false;
    const s = gameManager.getState();
    if (s !== GAME_STATES.WALKING && s !== GAME_STATES.POWER) return false;
    // Kanallı ulti (Enerji Dalgası): karakteri kilitlediği için cue şarjıyla (POWER)
    // çakışamaz — yalnız WALKING'de tetiklenir. Anlık ultiler (şok dalgası) POWER'da da olur.
    const def = itemSystem.ultimateFor(num);
    if (def && def.channel && s !== GAME_STATES.WALKING) return false;
    if (!itemSystem.useUltimate(num)) return false;
    comboSystem.consumeUlt(num);
    if (progression) progression.addEvent(num, 'ultimate');   // Faz 15: XP
    onUltimateFired(num);
    return true;
}

/** İnsanın ultimate'ı (yerel oyuncu = humanPlayer). */
function triggerHumanUltimate() { triggerUltimate(gameManager.humanPlayer); }

/** Ultimate tetiklenince kısa sinematik: kamera punch + sarsıntı + üst toast + glow. */
function onUltimateFired(num) {
    const human = num === gameManager.humanPlayer;
    const def = itemSystem.ultimateFor(num);
    const channel = !!(def && def.channel);
    // Kanallı ulti (Enerji Dalgası): asıl patlama ateşleme ANINDA gelir (onExplosion) —
    // başlangıçta hafif vuruş yeter. Anlık ulti (şok dalgası) eskisi gibi sert açılır.
    cameraController.punch(channel ? 0.1 : 0.24, channel ? 0.4 : 0.55);
    cameraController.shake(channel ? 0.02 : 0.05, channel ? 0.3 : 0.6);
    const name = def ? def.name.toUpperCase() + '!' : 'ULTİMATE!';
    uiManager.showNotification(human ? name : 'BOT ULTİ!', {
        icon: def ? def.icon : '🌀',
        subtext: human
            ? (channel ? 'Kamerayla yön ver — lazer aim yönüne!' : 'Ultimate!')
            : 'Şok dalgası seni vurdu',
        type: 'ultimate',
        duration: 1700,
    });
    // Bar'ı anında boşalt (sonraki kare zaten 0 yazacak; bu snappy hissi verir).
    if (uiManager) uiManager.updateUltimate(0, false);
}

/**
 * İnsan bir kutudan item topladığında (ItemBoxManager.onPickup): NE aldığını görsün —
 * nişancı modunda üst slot tek göstergesi (alt buton yok), o yüzden kısa üst toast +
 * cam-göbeği kenar glow'u. Bot toplaması sessiz.
 */
function onItemPickup(num) {
    // Kombo (Faz 6): kutu toplamak (insan VEYA bot) toplayana enerji verir.
    if (comboSystem) comboSystem.addEvent(num, 'pickup');
    if (progression) progression.addEvent(num, 'pickup');   // Faz 15: XP

    // Faz 9: toplama parıltısı (insan + bot) — toplayanın ayağının dibinde kıvılcım.
    const picker = players[num];
    if (particleSystem && picker && picker.mesh) {
        particleSystem.createPickupSparkle(picker.mesh.position.x, picker.mesh.position.z, 0x4dd2ff);
    }

    if (num !== gameManager.humanPlayer) return;
    if (sound && sound.playPickup) sound.playPickup();   // Faz 9: toplama "çın"ı (yalnız insan)
    const def = itemSystem.getItem(num);   // pickup slotu yeni doldurdu → elindeki item
    if (!def) return;
    uiManager.showNotification(`${def.name} aldın`, {
        icon: def.icon, type: 'pickup', duration: 1300,
    });
}

/**
 * Faz 5 momentum: bir oyuncunun "geride olma" faktörü (0=eşit/önde .. 1=çok geride).
 * Kendi grubundan soktuğu top sayısı rakibinden ne kadar AZsa o kadar yüksek →
 * ItemBoxManager güçlü item'lerin drop ağırlığını bu kadar artırır (lastik-bant, simetrik).
 * Yalnız vsbot'ta anlamlı (kutular yalnız orada). Grup atanmadan önce iki taraf da 0 → eşit.
 */
function momentumBehind(num) {
    if (!MOMENTUM.ENABLED || gameManager.mode !== 'vsbot') return 0;
    const opp = num === 1 ? 2 : 1;
    const mine = gameManager.getPocketedForPlayer(num).length;
    const theirs = gameManager.getPocketedForPlayer(opp).length;
    const diff = theirs - mine;
    if (diff <= 0) return 0;
    return Math.min(1, diff / MOMENTUM.SCALE);
}

/**
 * Ortak atış işleme: cue topa impuls uygula, nişancıyı tekmelet, BALLS_MOVING'e geç.
 * Hem insan (executeShot) hem bot (botShoot) buraya gelir.
 */
function commitShot(aimAngle, power, impulse, hitPointLocal, shooter) {
    gameManager.prepareNewShot();
    ballPhysics.beginShotTracking();

    shooter.kickAnimation(aimAngle, () => {
        ballPhysics.applyImpulse(0, impulse, hitPointLocal);
        sound.playStrike(power);
        cameraController.shake(0.008 + power * 0.018, 0.22);   // Faz 8: güce göre vuruş sarsıntısı
        cameraController.punch(0.03 + power * 0.05, 0.26);     // bırakış "recoil"i: kısa içeri dalıp açılır
        if (sound && sound.startRoll) sound.startRoll();        // Faz 9: top yuvarlanma sesi başlat
        gameManager.setState(GAME_STATES.BALLS_MOVING);
        // NOT: atışta artık TEPEDEN (action) kameraya geçmiyoruz — kamera olduğu yerde
        // (karakteri takip, oyuncu serbestçe konumlandırır) kalır. Karakter top hareket
        // halindeyken de yürüyebildiği için kamera onu izler.
    });
}

/** Bot atışı: aimAngle+power'dan yatay impuls kurup commitShot'a verir. */
function botShoot(aimAngle, power) {
    const raw = shotManager.calculateImpulse(aimAngle, power); // {x, y:0, z}
    const impulse = new CANNON.Vec3(raw.x, 0, raw.z);
    commitShot(aimAngle, power, impulse, new CANNON.Vec3(0, 0, 0), players[gameManager.currentPlayer]);
}

// ---- Input Callbacks ----
function setupInputCallbacks() {
    inputManager.onPointerDown((x, y) => {
        // First user gesture — unlock/resume the audio context.
        sound.ensure();

        // LAN istemci: kanvas tıklaması = (masaüstü) işaretçi kilidi sonra şarj; touch'ta yok.
        if (netRole === 'client') {
            if (!IS_TOUCH) {
                if (!inputManager.isPointerLocked()) inputManager.lockPointer();
                else clientTryCharge();
            }
            return;
        }

        const state = gameManager.getState();

        // On touch devices, walking taps do nothing: movement is the joystick and
        // shooting is the dedicated button (see onTouchShootPress/Release).
        if (state === GAME_STATES.WALKING && !IS_TOUCH) {
            if (eventManager && eventManager.isShotLocked()) return;   // dev top geçerken atış yok
            if (!localCanShoot()) return;          // sıra sende değilse şarj edemezsin
            if (player.isRagdoll) return;          // sabotajla devrildiyse şarj edemez
            if (!inputManager.isPointerLocked()) {
                inputManager.lockPointer();
            } else {
                // Check distance to cue ball
                const cueBallPos = ballPhysics.getCueBallPosition();
                if (cueBallPos) {
                    const dist = player.mesh.position.distanceTo(cueBallPos);
                    if (dist < CAMERA.SHOOT_RANGE) {
                        // Raycast to see if crosshair is on the cue ball
                        const raycaster = new THREE.Raycaster();
                        raycaster.setFromCamera(new THREE.Vector2(0, 0), sceneManager.camera);
                        const cueBallMesh = balls.getCueBall();
                        
                        if (cueBallMesh) {
                            const intersects = raycaster.intersectObject(cueBallMesh);
                            if (intersects.length > 0) {
                                // Looking at the ball! Start charging!
                                gameManager.setState(GAME_STATES.POWER);
                                powerBar.startCharging();
                                uiManager.showPowerBar();
                                
                                const crosshair = document.getElementById('crosshair');
                                if (crosshair) crosshair.classList.add('charging');
                            } else {
                                uiManager.showNotification('MISSING', { subtext: 'Look directly at the white ball to shoot', type: 'warning', duration: 1500 });
                            }
                        }
                    } else {
                        uiManager.showNotification('TOO FAR', { subtext: 'Get closer to the white ball to shoot', type: 'foul', duration: 1500 });
                    }
                }
            }
            return;
        }

        if (state === GAME_STATES.BALL_IN_HAND) {
            placeCueBall(x, y);
            return;
        }
    });

    inputManager.onPointerUp(() => {
        if (netRole === 'client') { clientReleaseShot(); return; }
        const state = gameManager.getState();

        if (state === GAME_STATES.POWER) {
            executeShot();
        }
    });

    uiManager.onRestartClick(() => {
        restartGame();
    });

    // Masaüstü: 'E' → slottaki item (rol-farkında), 'Q' → ultimate (enerji doluysa),
    // 'P' → duraklat/devam (yalnız yerel modlar; pauseGame kendisi guard'lar).
    window.addEventListener('keydown', (e) => {
        if (e.key === 'e' || e.key === 'E') useHumanItem();
        if (e.key === 'q' || e.key === 'Q') triggerHumanUltimate();
        if (e.key === 'p' || e.key === 'P') togglePause();
    });

    // Pause (2026-07-03): ⏸ butonu + overlay aksiyonları.
    document.getElementById('pause-btn').addEventListener('click', pauseGame);
    document.getElementById('pm-resume').addEventListener('click', resumeGame);
    document.getElementById('pm-restart').addEventListener('click', () => {
        resumeGame();
        restartGame();
    });
    document.getElementById('pm-mainmenu').addEventListener('click', quitToMenu);

    // Ultimate barı: hazırken dokunma/tık ile tetikle (mobil + masaüstü ortak yol).
    uiManager.onUltimateClick(triggerHumanUltimate);

    // Touch: USE-ITEM butonu (sabotajcı) ve KALKAN butonu (nişancı savunması) →
    // ikisi de slottaki item'i aktif role göre kullanır (useHumanItem rolü doğrular).
    if (touchControls) {
        touchControls.onTrapPress(useHumanItem);
        touchControls.onShield(useHumanItem);
        // ULTİ butonu (SHOOT'un yanında, yalnız enerji dolunca görünür).
        touchControls.onUlti(triggerHumanUltimate);
    }

    // TODO(geçici): retarget edilen Quaternius kliplerini önizleme tuşu.
    // 'V' → victory dansı, 'B' → idle'a dön. Doğrulama sonrası kaldırılacak.
    window.addEventListener('keydown', (e) => {
        if (e.key === 'v' || e.key === 'V') player.playVictory();
        if (e.key === 'b' || e.key === 'B') { player.isCelebrating = false; player._fadeToAction('idle', 0.3); }
    });
}

// ---- Touch Shoot (mobile) ----
// The SHOOT button replaces the desktop "look at ball + click" mechanic.
// Press while standing near the cue ball → charge power. Release → fire in the
// current camera heading (the same direction the aim line previews).

function onTouchShootPress() {
    // First user gesture — unlock/resume the audio context.
    sound.ensure();

    if (netRole === 'client') { clientTryCharge(); return; }   // istemci ayrı yoldan
    if (gameManager.getState() !== GAME_STATES.WALKING) return;
    if (eventManager && eventManager.isShotLocked()) return;   // dev top geçerken atış yok
    if (!localCanShoot()) return;          // sıra sende değilse atış yok
    if (player.isRagdoll) return;          // sabotajla devrildiyse şarj edemez

    const cueBallPos = ballPhysics.getCueBallPosition();
    if (!cueBallPos) return;

    const dist = player.mesh.position.distanceTo(cueBallPos);
    if (dist < CAMERA.SHOOT_RANGE) {
        gameManager.setState(GAME_STATES.POWER);
        powerBar.startCharging();
        uiManager.showPowerBar();
        // TPS crosshair'i touch'ta da görünür — şarjda kızarsın (masaüstüyle aynı his).
        const crosshair = document.getElementById('crosshair');
        if (crosshair) crosshair.classList.add('charging');
    } else {
        uiManager.showNotification('TOO FAR', {
            subtext: 'Beyaz topa yaklaş',
            type: 'foul',
            duration: 1500,
        });
    }
}

function onTouchShootRelease() {
    if (netRole === 'client') { clientReleaseShot(); return; }
    if (gameManager.getState() === GAME_STATES.POWER) {
        executeShot();
    }
}

// ---- State Transitions ----

function executeShot() {
    if (netRole === 'client') { clientReleaseShot(); return; }   // istemci host'a yollar
    const power = powerBar.stopCharging();

    uiManager.hidePowerBar();
    aimController.hide();

    const crosshair = document.getElementById('crosshair');
    if (crosshair) crosshair.classList.remove('charging');

    // Raycast exactly where we released the mouse to find impact point on ball
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), sceneManager.camera);
    const cueBallMesh = balls.getCueBall();
    
    let hitPointLocal = new CANNON.Vec3(0, 0, 0); // Default to center

    if (cueBallMesh) {
        const intersects = raycaster.intersectObject(cueBallMesh);
        if (intersects.length > 0) {
            const hitPointWorld = intersects[0].point;
            hitPointLocal.set(
                hitPointWorld.x - cueBallMesh.position.x,
                hitPointWorld.y - cueBallMesh.position.y,
                hitPointWorld.z - cueBallMesh.position.z
            );
        }
    }

    // Direction is the camera's forward vector
    const cameraDir = new THREE.Vector3();
    sceneManager.camera.getWorldDirection(cameraDir);
    // Keep it mostly horizontal to prevent flying, but use camera direction
    const threeImpulseDir = new THREE.Vector3(cameraDir.x, cameraDir.y * 0.1, cameraDir.z).normalize();
    
    // For player kick animation
    const aimAngle = Math.atan2(cameraDir.z, cameraDir.x);

    // Build the final impulse (camera direction × power magnitude) and fire via
    // the shared path — prepareNewShot + tracking + kick happen inside commitShot.
    const rawImpulse = shotManager.calculateImpulse(aimAngle, power);
    const magnitude = Math.sqrt(rawImpulse.x * rawImpulse.x + rawImpulse.z * rawImpulse.z);
    const impulse = new CANNON.Vec3(
        threeImpulseDir.x * magnitude,
        threeImpulseDir.y * magnitude,
        threeImpulseDir.z * magnitude
    );

    commitShot(aimAngle, power, impulse, hitPointLocal, player);
}

/**
 * Faz 14: menüde SEÇİLEN finisher çeşidi oynar (Settings → Finishers).
 * Kazanan kim olursa olsun yerel seçim geçerli — eski "bot kazanırsa rastgele"
 * kuralı seçimle oynatılan çeşidi ayrıştırıp kafa karıştırdığı için kaldırıldı.
 */
function pickFinisher() {
    return settings ? settings.get('finisher') : 'blackhole';
}

function evaluateShot() {
    gameManager.setState(GAME_STATES.EVALUATING);
    if (sound && sound.stopRoll) sound.stopRoll();   // Faz 9: top yuvarlanma sesini kapat

    // Get shot tracking data
    const shotData = ballPhysics.endShotTracking();
    gameManager.setFirstContact(shotData.firstContact);

    // Evaluate with rule engine
    const result = ruleEngine.evaluate(gameManager);

    // Handle game over
    if (result.winner > 0) {
        gameManager.winner = result.winner;
        gameManager.winReason = result.winReason;
        gameManager.setState(GAME_STATES.GAME_OVER);
        if (touchControls) touchControls.hide();
        player.playVictory();   // kazanan karakter zafer dansı (Quaternius retarget)

        // Faz 15: ödülleri ŞİMDİ hesapla (idempotent), finisher bitince ekranda göster.
        const humanWon = result.winner === (gameManager.mode === 'vsbot' ? gameManager.humanPlayer : 1);
        const rewards = progression ? progression.finishMatch(humanWon) : null;

        // Play the winner's finisher, then show the game-over screen.
        const finishPocket = lastFinisherPocket
            || new THREE.Vector3(0, TABLE.HEIGHT, TABLE.WIDTH / 2);
        if (finisher) {
            finisher.play(finishPocket, result.winner, () => {
                uiManager.showGameOver(result.winner, result.winReason, rewards);
            }, pickFinisher());
        } else {
            if (sound) sound.playWin();
            setTimeout(() => {
                uiManager.showGameOver(result.winner, result.winReason, rewards);
            }, 1000);
        }
        return;
    }

    // Handle group assignment
    if (result.assignGroups) {
        gameManager.assignGroups(gameManager.currentPlayer, result.assignGroups);
        uiManager.updatePlayerTypes(gameManager.player1Type, gameManager.player2Type);

        const currentType = gameManager.getPlayerType(gameManager.currentPlayer);
        const typeName = currentType === BALL_TYPES.SOLID ? 'Solids' : 'Stripes';
        uiManager.showNotification(`Player ${gameManager.currentPlayer}: ${typeName}`, {
            type: 'success',
            duration: 2000,
        });
    }

    // Update ball indicators
    updateBallUI();

    // Handle foul
    if (result.foul) {
        cameraController.shake(0.012, 0.26);   // amber kenar glow type'tan gelir
        uiManager.showNotification('FOUL', {
            icon: '⚠️',
            subtext: result.foulReason,
            type: 'foul',
            duration: 2500,
        });
    }

    // Handle cue ball pocketed
    if (result.cueBallPocketed) {
        // Need to place cue ball — ball in hand
        if (result.switchTurn) {
            gameManager.switchTurn();
            uiManager.updateTurn(gameManager.currentPlayer, false);
            uiManager.showNotification(`Player ${gameManager.currentPlayer}'s Turn`, { duration: 1500 });
        }
        gameManager.isBreakShot = false;

        enterBallInHand();
        return;
    }

    // Handle turn switch
    if (result.switchTurn) {
        gameManager.switchTurn();
        uiManager.updateTurn(gameManager.currentPlayer, false);
        
        if (!result.foul) {
            uiManager.showNotification(`Player ${gameManager.currentPlayer}'s Turn`, {
                duration: 1500,
            });
        } else {
            // If foul, show turn after foul notification
            setTimeout(() => {
                uiManager.showNotification(`Player ${gameManager.currentPlayer}'s Turn`, { duration: 1500 });
            }, 2500);
        }
    }
    gameManager.isBreakShot = false;

    // Yeni tur: aktif oyuncuyu bağla, kamerayı çevir, bot sırasıysa botu başlat.
    // (Asla donmaz; oyun hemen WALKING'e döner.)
    beginTurn();
}

function enterBallInHand() {
    // Bot VEYA LAN host: cue topu varsayılan break noktasına koy ve oynamaya devam et
    // (elle yerleştirme yok — LAN'da uzaktan yerleştirme N1 dışı, sadeleştirildi).
    if (gameManager.isBotTurn() || netRole === 'host') {
        const pos = { x: CUE_BALL_START.x, y: TABLE.HEIGHT + BALL.RADIUS, z: CUE_BALL_START.z };
        balls.resetCueBall(pos);
        ballPhysics.resetCueBall(pos);
        beginTurn();
        return;
    }

    gameManager.setState(GAME_STATES.BALL_IN_HAND);
    ballInHandActive = true;

    uiManager.showNotification('BALL IN HAND', {
        icon: '🎯',
        subtext: 'Click on the table to place the cue ball',
        type: 'normal',
        duration: 0, // stay visible
    });

    // Create a ghost cue ball that follows the mouse
    const ghostGeom = new THREE.SphereGeometry(BALL.RADIUS, 16, 12);
    const ghostMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.4,
        wireframe: true,
    });
    ghostCueBall = new THREE.Mesh(ghostGeom, ghostMat);
    ghostCueBall.position.set(0, TABLE.HEIGHT + BALL.RADIUS, 0);
    sceneManager.scene.add(ghostCueBall);

    // Set camera to far mode overlooking the table
    cameraController.setMode('far');
    cameraController.setFollowTarget(null);
    cameraController.setTarget({ x: 0, y: TABLE.HEIGHT, z: 0 });
    cameraController.setAimAngle(Math.PI / 2);
    cameraController._targetPolar = 0.5;
    cameraController._targetDistance = 3.0;
}

function placeCueBall(screenX, screenY) {
    // Raycast from screen position onto the table surface
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2(
        (screenX / window.innerWidth) * 2 - 1,
        -(screenY / window.innerHeight) * 2 + 1
    );
    raycaster.setFromCamera(ndc, sceneManager.camera);

    // Intersect with the table plane (y = TABLE.HEIGHT + BALL.RADIUS)
    const planeY = TABLE.HEIGHT + BALL.RADIUS;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
    const intersection = new THREE.Vector3();
    const hitResult = raycaster.ray.intersectPlane(plane, intersection);

    if (!hitResult) return;

    // Check bounds — must be within the playing surface
    const hl = TABLE.LENGTH / 2 - BALL.RADIUS * 2;
    const hw = TABLE.WIDTH / 2 - BALL.RADIUS * 2;
    if (Math.abs(intersection.x) > hl || Math.abs(intersection.z) > hw) return;

    // Check overlap with other balls
    const positions = ballPhysics.getPositions();
    const minDist = BALL.RADIUS * 2.5;
    for (const [id, pos] of positions) {
        if (id === 0) continue;
        const dx = intersection.x - pos.x;
        const dz = intersection.z - pos.z;
        if (Math.sqrt(dx * dx + dz * dz) < minDist) return;
    }

    // Place the cue ball
    const newPos = { x: intersection.x, y: planeY, z: intersection.z };
    balls.resetCueBall(newPos);
    ballPhysics.resetCueBall(newPos);

    // Remove ghost ball
    if (ghostCueBall) {
        sceneManager.scene.remove(ghostCueBall);
        ghostCueBall.geometry.dispose();
        ghostCueBall.material.dispose();
        ghostCueBall = null;
    }

    ballInHandActive = false;
    uiManager.hideNotification();

    beginTurn();
}

function updateBallUI() {
    if (gameManager.player1Type) {
        const p1Balls = gameManager.getPlayerBallIds(1);
        const p1Pocketed = gameManager.getPocketedForPlayer(1);
        const p2Balls = gameManager.getPlayerBallIds(2);
        const p2Pocketed = gameManager.getPocketedForPlayer(2);
        uiManager.updatePlayerBalls(p1Balls, p1Pocketed, p2Balls, p2Pocketed);
    }
    balls.updateTargetIndicators(gameManager.getValidTargetBalls());
}

function restartGame() {
    if (netRole === 'client') return;   // LAN: yeniden başlatma host-otoriter (istemci bekler)
    if (netRole === 'host') netSession.send({ t: MSG.EVENT, kind: 'rerack' });  // istemci de yeniden dizsin
    if (sound && sound.stopRoll) sound.stopRoll();   // Faz 9: kalan yuvarlanma sesini kapat

    // Remove all existing balls
    balls.removeAll();
    const activeIds = ballPhysics.getAllActiveBallIds();
    activeIds.forEach(id => ballPhysics.removeBall(id));

    // Recreate
    balls.createAllBalls();
    ballPhysics.createAllBalls();

    // Reset game state
    gameManager.reset();

    // Reset UI (restore HUD/crosshair that the finisher hid)
    uiManager.hideGameOver();
    uiManager.hideNotification();
    uiManager.showHUD();
    if (touchControls) touchControls.show();
    const crosshairEl = document.getElementById('crosshair');
    if (crosshairEl) crosshairEl.classList.remove('hidden');
    lastFinisherPocket = null;
    uiManager.updateTurn(1, true);
    uiManager.updatePlayerTypes(null, null);
    uiManager.updatePlayerBalls([], [], [], []);
    balls.updateTargetIndicators(gameManager.getValidTargetBalls());

    uiManager.showNotification('BREAK SHOT', {
        icon: '🎱',
        subtext: 'Player 1 breaks',
        type: 'success',
        duration: 2500,
    });

    // Her iki karakteri ayağa kaldır, başlangıç noktalarına koy, göster.
    player = players[1];
    players[1].reset(); players[2].reset();
    players[1].placeAt(PLAYER_START[1].x, PLAYER_START[1].z, PLAYER_START[1].face);
    players[2].placeAt(PLAYER_START[2].x, PLAYER_START[2].z, PLAYER_START[2].face);
    players[1].setVisible(true); players[2].setVisible(true);
    cameraController.setFollowTarget(players[myPlayerNum].mesh);
    cameraController.setMode('free');
    if (sabotageManager) sabotageManager.clearAll();   // tuzak+mermi+bomba+kalkan tümünü temizle
    if (itemSystem) itemSystem.reset();              // slotları temizle
    if (comboSystem) { comboSystem.reset(); uiManager.updateUltimate(0, false); }   // kombo/enerji sıfırla
    if (itemBoxManager) itemBoxManager.reset();      // kutuları yeniden doğur
    if (eventManager) eventManager.reset();          // aktif mini olayı geri al + zamanlayıcıyı kur
    if (progression) progression.beginMatch(1);      // Faz 15: yeni maç sayaçları
    botController.stop();

    setPauseButton(netRole === null);   // yeni maç: yerelde ⏸ geri gelsin

    setTimeout(() => {
        beginTurn();   // P1 (insan) break; vsbot'ta bot sabotaja girer
    }, 500);
}

// ---- Pause (2026-07-03) ----
// Yalnız yerel modlarda (netRole===null). paused iken gameLoop erken çıkar (render-only).

/** ⏸ butonunu göster/gizle (oyun sırasında görünür; menü/LAN/game-over'da gizli). */
function setPauseButton(on) {
    const btn = document.getElementById('pause-btn');
    if (btn) btn.classList.toggle('hidden', !on);
}

function pauseGame() {
    if (paused || netRole) return;
    const st = gameManager.getState();
    if (st === GAME_STATES.MENU || st === GAME_STATES.LOADING || st === GAME_STATES.GAME_OVER) return;
    paused = true;
    document.getElementById('pause-menu').classList.remove('hidden');
    setPauseButton(false);
    if (touchControls) touchControls.hide();
    if (sound && sound.stopRoll) sound.stopRoll();          // yuvarlanma uğultusu donarken sussun
    if (uiManager.setUltiTint) uiManager.setUltiTint(false); // beam filtresi pause ekranında asılı kalmasın
    if (document.pointerLockElement) document.exitPointerLock();
    if (sound) sound.playUI('move');
}

function resumeGame() {
    if (!paused) return;
    paused = false;
    document.getElementById('pause-menu').classList.add('hidden');
    setPauseButton(true);
    if (touchControls && IS_TOUCH) touchControls.show();
    if (sound) sound.playUI('confirm');
}

function togglePause() { paused ? resumeGame() : pauseGame(); }

/** Pause → Ana Menü: maçı bırak, HUD'u kapat, menü hero çekimine dön. */
function quitToMenu() {
    paused = false;
    document.getElementById('pause-menu').classList.add('hidden');
    setPauseButton(false);
    cancelHumanCharge();
    botController.stop();
    if (sound) { if (sound.stopRoll) sound.stopRoll(); if (sound.stopTension) sound.stopTension(); }
    if (touchControls) touchControls.hide();
    uiManager.hideHUD();
    uiManager.hideNotification();
    const crosshair = document.getElementById('crosshair');
    if (crosshair) crosshair.classList.add('hidden');
    const help = document.getElementById('controls-help');
    if (help) help.classList.add('hidden');
    if (aimController) aimController.hide();
    if (itemBoxManager) itemBoxManager.setShown(false);   // menü arka planında kutu kalmasın
    if (uiManager.setUltiTint) uiManager.setUltiTint(false);  // beam filtresi menüye taşmasın
    cameraController.setSideOffset(0);                        // anime çerçeve kayması sıfırlansın
    cameraController.setSideFrac(0);                          // TPS çerçevesi de (menü yakın çekimi)
    enterMenu();
}

// ---- Aim Line ----
// Shows the predicted cue-ball path (and ghost/contact preview) using the
// camera's horizontal heading — the same direction used to fire the shot.
function updateAimLine(forceShow) {
    const cueBallMesh = balls.getCueBall();
    if (!cueBallMesh) { aimController.hide(); return; }

    sceneManager.camera.getWorldDirection(_aimDir);
    const aimAngle = Math.atan2(_aimDir.z, _aimDir.x);

    const dist = player.mesh.position.distanceTo(cueBallMesh.position);
    // Always show while charging; otherwise only when standing near the cue ball.
    if (forceShow || dist < CAMERA.AIM_LINE_RANGE) {
        // Şarj görseli: retikül + hat güçle kızarır/nabız atar. powerBar yalnız
        // gerçek şarjda aktif (host POWER durumu + LAN istemci şarjı — ikisi de kapsanır).
        aimController.setCharge(powerBar.isCharging() ? powerBar.getPower() : 0);
        aimController.show();
        aimController.update(cueBallMesh.position, aimAngle, balls.meshes);
    } else {
        aimController.hide();
    }
}

// ---- Game Loop ----
let _stoppedFrames = 0;

function gameLoop(time) {
    requestAnimationFrame(gameLoop);

    const dt = Math.min(clock.getDelta(), 0.05); // cap delta to prevent physics explosion
    const state = gameManager.getState();

    // FPS göstergesi (Options → FPS Göster): LAN istemci erken-çıkışından ÖNCE beslenir
    // ki her yolda saysın (kendi saatiyle ölçer — kırpılmış dt kullanmaz).
    uiManager.updateFps();

    // ---- Input Processing ----
    const { dx, dy, scroll } = inputManager.consumeDeltas();

    // ---- Pause: dünya donar, yalnız render (deltalar tüketildi → devamda kamera sıçramaz) ----
    if (paused) { sceneManager.render(); return; }

    // ---- Global Updates ----
    if (particleSystem) {
        try {
            particleSystem.update(dt);
        } catch (err) {
            console.error('Particle update error:', err);
        }
    }

    // ---- LAN İSTEMCİ: simülasyon YOK — snapshot çiz + girdi yolla + render (erken çık) ----
    if (netRole === 'client') { netClientFrame(dt, dx, dy, scroll); return; }

    // ---- Faz 13b: Dev Top FİZİK penceresi — oyun DONAR, yalnız toplar + dev küre ----
    // Bu pencerede karakterler yerinde idle (girdi yok, atış kilitli), tek fizik adımı
    // topları + kinematik dev küreyi ilerletir. PocketDetector ÇALIŞMAZ (sıra-dışı pot yok);
    // cep ağzında kalan toplar EventManager'ın settle temizliğiyle güvene alınır. Erken çıkar
    // → sabotaj/item/kombo/switch atlanır (kaos boyunca oyun beklemede).
    if (eventManager && eventManager.needsPhysicsStep()) {
        players[1].update(dt, ZERO_MOVE, FORWARD_Z);
        players[2].update(dt, ZERO_MOVE, FORWARD_Z);

        physicsWorld.step(dt);
        ballPhysics.clampToSurface();
        balls.syncWithPhysics(ballPhysics.getPositions(), ballPhysics.getQuaternions());

        eventManager.update(dt, state);   // dev küreyi ilerlet + mesh sync + bitince temizle

        cameraController.update(dt);
        sceneManager.render();
        return;
    }

    // ---- Karakter güncellemesi ----
    // Her iki karakter her karede güncellenir ki animasyon donmasın.
    sceneManager.camera.getWorldDirection(_camDir);
    const cameraForwardXZ = _camFwdXZ.set(_camDir.x, 0, _camDir.z).normalize();
    const inSaboWindow = state === GAME_STATES.WALKING || state === GAME_STATES.POWER;

    if (netRole === 'host') {
        // --- LAN host: P1 yerel insan, P2 uzak istemci (sıra-tabanlı) ---
        hostUpdateChars(dt, state, cameraForwardXZ);
    } else if (gameManager.mode === 'vsbot' && inSaboWindow) {
        // --- vsbot sabotaj penceresi ---
        // İnsan DAİMA players[1]'i, bot DAİMA players[2]'yi sürer (sahipler sabit).
        // Nişancı = aktif oyuncu; diğeri sabotajcı. Sabotajcı, nişancı şarj ederken
        // bile dolaşabilir (asıl sabotaj burada olur).
        const humanIsShooter = gameManager.currentPlayer === gameManager.humanPlayer;

        // İnsan: WALKING'de her zaman; POWER'da yalnız sabotajcıyken hareket eder
        // (nişancı şarj ederken yerinde durur). Ragdoll'da Player.update girişi yok sayar.
        const humanMove =
            state === GAME_STATES.WALKING || !humanIsShooter ? readHumanMoveInput() : ZERO_MOVE;
        players[1].update(dt, humanMove, cameraForwardXZ);

        // Bot: kendi sırasında bilardo, insanın sırasında sabotaj (tek güncelleme yolu).
        botController.update(dt);
        players[2].update(dt, botController.moveInput, botController.forward);

        // NOT: sabotaj/yetenek mekaniği + ragdoll fizik adımı artık HER karede ayrı
        // çalışır (aşağıda, state'ten bağımsız) — atış/top hareketi onları dondurmasın.

        // Bot savunması (Faz 4): bot NİŞANCIYKEN (kendi sırası) kalkanı varsa ve insan
        // sabotajcı tehdit menzilindeyse + dokunulmaz değilse kalkanı aç. Basit refleks;
        // akıllı item AI (tehdide göre seçim) Faz 5.
        if (!humanIsShooter && !players[2].isRagdoll) {
            const botItem = itemSystem.getItem(2);
            if (botItem && botItem.role === 'shooter' && itemSystem.canUse(2) &&
                (sabotageManager.immune[2] || 0) <= 0) {
                const d = Math.hypot(
                    players[1].mesh.position.x - players[2].mesh.position.x,
                    players[1].mesh.position.z - players[2].mesh.position.z,
                );
                if (d < BOT.SHIELD_THREAT) useItemAt(2, 'shooter');
            }
        }

        // Bot ultimate (Faz 7, simetri): enerjisi dolduysa, insan ŞARJ ederken (POWER)
        // Şok Dalgası ile atışı bozar — maç boyu biriken nadir ödülün en değerli kullanımı.
        if (humanIsShooter && state === GAME_STATES.POWER &&
            comboSystem && comboSystem.isUltReady(2) && !players[2].isRagdoll) {
            triggerUltimate(2);
        }
    } else if (state === GAME_STATES.WALKING) {
        // --- local2p / practice (M1): aktif oyuncuyu insan veya bot sürer ---
        if (gameManager.isBotTurn()) {
            botController.update(dt);
            player.update(dt, botController.moveInput, botController.forward);
        } else {
            player.update(dt, readHumanMoveInput(), cameraForwardXZ);
        }
        const idleNum = gameManager.currentPlayer === 1 ? 2 : 1;
        if (players[idleNum]) players[idleNum].update(dt, ZERO_MOVE, FORWARD_Z);
    } else if (state === GAME_STATES.BALLS_MOVING || state === GAME_STATES.SHOOTING) {
        // --- Toplar yuvarlanırken karakterler DONMAZ (aksiyon sürsün): insan yürüyebilir. ---
        // (Tekme animasyonu biterken Player.update girişi yok sayar; sonra serbest.)
        const humanNum = gameManager.mode === 'vsbot' ? gameManager.humanPlayer : gameManager.currentPlayer;
        const otherNum = humanNum === 1 ? 2 : 1;
        players[humanNum].update(dt, readHumanMoveInput(), cameraForwardXZ);
        if (players[otherNum]) players[otherNum].update(dt, ZERO_MOVE, FORWARD_Z);
    } else {
        // --- Diğer state'ler (POWER non-vsbot, EVALUATING, GAME_OVER…): herkes idle ---
        player.update(dt, ZERO_MOVE, FORWARD_Z);
        const idleNum = gameManager.currentPlayer === 1 ? 2 : 1;
        if (players[idleNum]) players[idleNum].update(dt, ZERO_MOVE, FORWARD_Z);
    }

    // Dash izi/tozu (Faz 4 VFX): dash'teyken hareket eden karakter ayak izi + toz bırakır.
    updateDashFx(dt);

    // ---- Sabotaj + yetenekler: HER KAREDE (state'ten bağımsız) ----
    // Tuzak/mermi/bomba/kalkan kendi ömürleri boyunca KESİNTİSİZ çalışır — atış olunca
    // (BALLS_MOVING) donmaz/silinmez. Body-check yalnız sabotaj penceresinde (saboWindow).
    if (gameManager.mode === 'vsbot' && state !== GAME_STATES.MENU &&
        state !== GAME_STATES.LOADING && state !== GAME_STATES.GAME_OVER) {
        // Enerji Dalgası yönü: kameranın yatay bakışı (aim ile lazer süpürülür).
        // _camDir yukarıda bu karede dolduruldu (kamera henüz güncellenmedi) — yeniden okuma yok.
        sabotageManager.update(dt, {
            players,
            shooterNum: gameManager.currentPlayer,
            shooterCharging: state === GAME_STATES.POWER,
            saboWindow: inSaboWindow,
            beamYaw: Math.atan2(_camDir.z, _camDir.x),
        });
        // Ragdoll fiziği: BALLS_MOVING/SHOOTING zaten her kare step atıyor (switch'te);
        // diğer state'lerde devrilen varsa burada ilerlet (yoksa ragdoll donar).
        if (state !== GAME_STATES.BALLS_MOVING && state !== GAME_STATES.SHOOTING &&
            (players[1].isRagdoll || players[2].isRagdoll)) {
            physicsWorld.step(dt);
        }
    }

    // ---- Eşya sistemi (Faz 1/2): cooldown + kutular + HUD/touch slot ----
    if (itemSystem) {
        itemSystem.update(dt);

        // Kutular (Faz 2): animasyon + toplama overlap'i (vsbot'ta görünür). Üstünden
        // geçen oyuncuya rastgele item verir (slotu boşsa).
        if (itemBoxManager) itemBoxManager.update(dt, [players[1], players[2]]);

        const inSaboNow = gameManager.mode === 'vsbot' &&
            (state === GAME_STATES.WALKING || state === GAME_STATES.POWER);
        const hNum = gameManager.humanPlayer;
        const humanShooter = gameManager.currentPlayer === hNum;
        const humanItem = itemSystem.getItem(hNum);

        // HUD slotu: insan elinde item TUTARKEN (her iki rolde) üst-orta'da göster —
        // nişancı, aldığı yeteneği ancak buradan görür (alt USE-ITEM butonu yalnız
        // sabotajcı turunda var). Boşken gizli (sabotajcının boş durumu alt butonda).
        const showSlot = inSaboNow && itemSystem.hasItem(hNum);
        if (uiManager) uiManager.updateItemSlot(humanItem, showSlot, itemSystem.cooldownFrac(hNum));

        // Touch: USE-ITEM butonu (sabotajcı saldırı) ve ayrı KALKAN butonu (nişancı
        // savunma item'ı, yalnız WALKING'de — şarj ederken zaten dokunulmaz).
        if (touchControls) {
            touchControls.setItem(humanItem, itemSystem.canUse(hNum));
            const showShield = inSaboNow && humanShooter && state === GAME_STATES.WALKING &&
                humanItem && humanItem.role === 'shooter';
            touchControls.setShield(showShield ? humanItem : null, showShield && itemSystem.canUse(hNum), showShield);
        }
    }

    // ---- Kombo → Ultimate enerjisi (Faz 6) ----
    // Kombo pencerelerini ilerlet + HUD'u yerel insanın enerjisiyle güncelle
    // (vsbot → players[1]; aksi → aktif oyuncu). Faz 7 ultimate'ı bu enerjiyle tetiklenecek.
    if (comboSystem) {
        comboSystem.update(dt);
        const hudNum = gameManager.mode === 'vsbot' ? gameManager.humanPlayer : gameManager.currentPlayer;
        const ultReady = comboSystem.isUltReady(hudNum);
        uiManager.updateUltimate(comboSystem.getEnergy(hudNum), ultReady);
        // Touch ULTİ butonu: yalnız vsbot'ta + enerji doluyken + kanal açık değilken.
        if (touchControls) {
            const showUlti = ultReady && gameManager.mode === 'vsbot' &&
                !sabotageManager.isBeamChanneling(hudNum);
            touchControls.setUlti(itemSystem.ultimateFor(hudNum), showUlti);
        }
        const pop = comboSystem.consumePop(hudNum);
        if (pop >= 2) uiManager.popCombo(pop);
    }

    // ---- Maç içi mini olaylar (Faz 13): zamanlayıcı + aktif olay süresi ----
    // Tek-cihaz modlarda (netRole null); LAN'da kapalı (senkron N2). Manager state'e
    // göre yalnız WALKING/POWER'da yeni olay planlar; aktif olay atışı kapsar.
    if (eventManager && gameManager.mode) eventManager.update(dt, state);

    // ---- Kamera juice (Faz 8): koşu bob'u + topa yaklaşma zoom'u (kare başına bir kez) ----
    updateCameraJuice(dt, state);

    // ---- 8-top "Final Evresi" (Faz 10): nişancı 8-topta mı → gerilim modunu güncelle ----
    updateFinalPhase();

    switch (state) {
        case GAME_STATES.WALKING: {
            // İnsanın bakış kontrolü: kendi sırasında (nişan) veya vsbot'ta her zaman
            // (sabotajcıyken de kamera insanı takip eder ki rakibi kovalayabilesin).
            const humanLook = gameManager.mode === 'vsbot' || !gameManager.isBotTurn();
            if (humanLook) {
                // Desktop pointer-lock ile, touch canvas sürüklemesiyle bakar.
                if (inputManager.isPointerLocked() || IS_TOUCH) {
                    cameraController.handleRotation(dx, dy);
                }
                if (IS_TOUCH && scroll) cameraController.handleZoom(scroll);
            }
            // Nişan çizgisi yalnız insan nişancıyken (kendi sırası) + cue topa yakınken.
            if (!gameManager.isBotTurn()) {
                updateAimLine(false);
            } else {
                aimController.hide();
            }

            // Kamera odak karakteri takip eder (vsbot → players[1], aksi → aktif oyuncu).
            cameraController.setTarget(focusCharacter().mesh.position);
            cameraController.update(dt);
            break;
        }

        case GAME_STATES.POWER: {
            powerBar.update(dt);

            // Şarj ederken etrafa bakabilme.
            if (inputManager.isPointerLocked() || IS_TOUCH) {
                cameraController.handleRotation(dx, dy);
            }
            if (IS_TOUCH && scroll) cameraController.handleZoom(scroll);
            // Kamera odak karakterde (vsbot → insan, aksi → aktif nişancı = aynı).
            cameraController.setTarget(focusCharacter().mesh.position);
            cameraController.update(dt);

            // Şarj boyunca nişan çizgisi.
            updateAimLine(true);
            break;
        }

        case GAME_STATES.SHOOTING:
        case GAME_STATES.BALLS_MOVING: {
            // Step physics
            physicsWorld.step(dt);
            ballPhysics.clampToSurface();

            // Sync visual balls with physics
            const positions = ballPhysics.getPositions();
            const quaternions = ballPhysics.getQuaternions();
            balls.syncWithPhysics(positions, quaternions);

            // Faz 9: top yuvarlanma sesi seviyesi = en hızlı topun hızı (normalize).
            if (sound && sound.setRoll) sound.setRoll(Math.min(1, ballPhysics.getMaxSpeed() / 1.5));

            // Ragdoll physics sync and trigger
            if (player.isRagdoll) {
                player._syncMesh();
            } else {
                // Manual check for ball hitting the player
                for (const [id, ballBody] of ballPhysics.bodies) {
                    const dist = ballBody.position.distanceTo(player.body.position);
                    if (dist < BALL.RADIUS + player.radius + 0.05) {
                        // If hit by a fast moving ball, go ragdoll!
                        if (ballBody.velocity.length() > 0.5) {
                            player.makeRagdoll();
                            break;
                        }
                    }
                }
            }

            // Check for pocketed balls
            const pocketed = pocketDetector.check(positions);
            pocketed.forEach(p => {
                // Get ball color for firework
                const ballData = BALL_DATA.find(b => b.id === p.id);
                const colorHex = ballData ? ballData.color : 0xffffff;
                
                // Pocket drop sound + juice: yeşil kenar glow'u + ufak sarsıntı
                // (havai fişeğe ek; 8-top değilse — o finisher'a bırakılır).
                if (sound) sound.playPocket();
                if (p.id !== 8) {
                    if (uiManager) uiManager.flashEdge('#22c55e', 0.4, 480);
                    cameraController.shake(0.01, 0.2);
                }

                // Remember where this ball dropped (used by the win finisher)
                const _pp = pocketDetector.pockets[p.pocketIndex];
                if (_pp) lastFinisherPocket = new THREE.Vector3(_pp.x, TABLE.HEIGHT, _pp.z);

                // Spawn firework at the pocket location slightly above the table
                try {
                    const pocketPos = pocketDetector.pockets[p.pocketIndex];
                    particleSystem.createFirework(
                        new THREE.Vector3(pocketPos.x, TABLE.HEIGHT - 0.15, pocketPos.z),
                        colorHex
                    );
                } catch (err) {
                    console.error('Firework error:', err);
                }

                // Kombo (Faz 6): nesne topu sokmak nişancıya enerji verir (beyaz/8 hariç).
                if (p.id !== 0 && p.id !== 8 && comboSystem) {
                    comboSystem.addEvent(gameManager.currentPlayer, 'pot');
                    if (progression) progression.addEvent(gameManager.currentPlayer, 'pot');   // Faz 15
                }

                gameManager.recordPocketed(p.id);
                balls.removeBall(p.id);
                ballPhysics.removeBall(p.id);
            });

            // The 8-ball ends the game immediately — don't wait for balls to
            // stop. Fire the finisher the moment it drops into the pocket.
            if (gameManager.eightBallPocketed && gameManager.getState() === GAME_STATES.BALLS_MOVING) {
                const shotData = ballPhysics.endShotTracking();
                gameManager.setFirstContact(shotData.firstContact);
                const result = ruleEngine.evaluate(gameManager);
                if (result.winner > 0) {
                    gameManager.winner = result.winner;
                    gameManager.winReason = result.winReason;
                    gameManager.setState(GAME_STATES.GAME_OVER);
                    if (sound && sound.stopRoll) sound.stopRoll();   // Faz 9: yuvarlanma sesini kapat
                    if (touchControls) touchControls.hide();
                    player.playVictory();   // kazanan karakter zafer dansı (Quaternius retarget)

                    // Faz 15: ödüller (idempotent — evaluateShot yolu da tetiklenirse çift olmaz).
                    const humanWon = result.winner === (gameManager.mode === 'vsbot' ? gameManager.humanPlayer : 1);
                    const rewards = progression ? progression.finishMatch(humanWon) : null;

                    const finishPocket = lastFinisherPocket
                        || new THREE.Vector3(0, TABLE.HEIGHT, TABLE.WIDTH / 2);
                    if (finisher) {
                        finisher.play(finishPocket, result.winner, () => {
                            uiManager.showGameOver(result.winner, result.winReason, rewards);
                        }, pickFinisher());
                    } else {
                        if (sound) sound.playWin();
                        setTimeout(() => uiManager.showGameOver(result.winner, result.winReason, rewards), 800);
                    }
                }
            }

            // Check if all balls stopped
            if (gameManager.getState() === GAME_STATES.BALLS_MOVING && ballPhysics.areAllStopped()) {
                _stoppedFrames++;
                if (_stoppedFrames > 30) {  // Wait for ~0.5s of being stopped
                    _stoppedFrames = 0;
                    ballPhysics.forceStopAll();
                    if (ballPhysics.areAllStopped()) {
                        if (player.isRagdoll) {
                            player.reset();
                        }
                        evaluateShot();
                    }
                }
            } else {
                _stoppedFrames = 0;
            }

            // Camera follows action
            if (scroll) cameraController.handleZoom(scroll);
            if (inputManager.rightDown || IS_TOUCH) {
                cameraController.handleRotation(dx, dy);
            }
            break;
        }

        case GAME_STATES.BALL_IN_HAND: {
            // Update ghost ball position based on mouse (paylaşımlı geçicilerle — kare başı new yok)
            if (ghostCueBall) {
                const ndc = inputManager.getNormalizedPointer();
                _bihRaycaster.setFromCamera(_bihPointer.set(ndc.x, ndc.y), sceneManager.camera);

                const planeY = TABLE.HEIGHT + BALL.RADIUS;
                _bihPlane.constant = -planeY;
                const hitResult = _bihRaycaster.ray.intersectPlane(_bihPlane, _bihHit);

                if (hitResult) {
                    const hl = TABLE.LENGTH / 2 - BALL.RADIUS * 2;
                    const hw = TABLE.WIDTH / 2 - BALL.RADIUS * 2;
                    _bihHit.x = Math.max(-hl, Math.min(hl, _bihHit.x));
                    _bihHit.z = Math.max(-hw, Math.min(hw, _bihHit.z));
                    ghostCueBall.position.set(_bihHit.x, planeY, _bihHit.z);
                }
            }

            // Allow camera rotation
            if (inputManager.rightDown || IS_TOUCH) {
                cameraController.handleRotation(dx, dy);
            }
            cameraController.handleZoom(scroll);
            break;
        }

        case GAME_STATES.GAME_OVER:
            // Nothing to update
            break;
    }

    // ---- LAN HOST: dünyanın anlık görüntüsünü istemciye yolla (~SNAP_HZ) ----
    if (netRole === 'host' && netSession.connected) {
        // Toplar hareket halindeyken snapshot hızını 60Hz'e çıkar (daha hassas düzeltme)
        const state = gameManager.getState();
        const dynamicHz = (state === GAME_STATES.BALLS_MOVING || state === GAME_STATES.SHOOTING)
            ? 60 : SNAP_HZ;
        _snapAccum += dt;
        if (_snapAccum >= 1 / dynamicHz) {
            _snapAccum = 0;
            netSession.send(buildSnapshot(players, ballPhysics, gameManager));
        }
    }

    // ---- Camera Update + Render ----
    // While the finisher is playing it owns the camera and rendering.
    if (finisher && finisher.active) {
        finisher.update(dt);
    } else {
        cameraController.update(dt);
        sceneManager.render();
    }
}

// ---- Start ----
init();
