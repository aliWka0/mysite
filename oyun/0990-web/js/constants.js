// ============================================
// 8-BALL POOL — SHARED CONSTANTS
// ============================================

// ------ Platform Detection ------
// Tek kaynaklı dokunmatik tespiti. Masaüstü kontrolleri (pointer-lock/WASD/fare)
// ile dokunmatik kontroller (joystick/sürükle-nişan/ateş butonu) arasında
// dallanmak için her yerde bunu kullan.
//
// Sadece `pointer: coarse` (birincil işaretçi parmak/kalem) bakılır. `ontouchstart`
// veya `maxTouchPoints` kullanmıyoruz: dokunmatik EKRANLI dizüstüler bunları true
// döndürür ama birincil girişleri faredir — o kullanıcıları masaüstü modunda
// tutmak isteriz. Android WebView (Capacitor APK) `pointer: coarse` raporlar.
export const IS_TOUCH = (typeof window !== 'undefined')
    && (typeof window.matchMedia === 'function')
    && window.matchMedia('(pointer: coarse)').matches;

// ------ Table Dimensions (meters) ------
export const TABLE = {
    LENGTH:         2.54,       // Long axis (X direction)
    WIDTH:          1.27,       // Short axis (Z direction)
    HEIGHT:         0.80,       // Playing surface height from ground
    RAIL_HEIGHT:    0.05,       // Cushion rail height above surface
    RAIL_WIDTH:     0.07,       // Outer rail/frame top width
    FRAME_WIDTH:    0.15,       // Wooden frame width
    FRAME_HEIGHT:   0.10,       // Frame depth below surface
    POCKET_RADIUS:  0.058,      // Pocket opening radius
    CUSHION_WIDTH:  0.04,       // Rubber cushion depth from rail inner edge
};

// ------ Ball Properties ------
export const BALL = {
    RADIUS:          0.028575,  // Standard pool ball radius (57.15mm dia)
    MASS:            1,         // Normalized mass (Unity-style)
    FRICTION:        0.2,       // Dynamic & static friction
    RESTITUTION:     0.4,       // Bounciness (moderate — not too bouncy)
    LINEAR_DAMPING:  0.4,       // Drag — simulates felt surface friction
    ANGULAR_DAMPING: 0.05,      // Angular drag — balls spin freely
    STOP_THRESHOLD:  0.01,      // Velocity below this -> ball is "stopped"
};

// ------ Ball Types ------
export const BALL_TYPES = {
    CUE:    'cue',
    SOLID:  'solid',
    STRIPE: 'stripe',
    EIGHT:  'eight',
};

// ------ Ball Data ------
export const BALL_DATA = [
    { id: 0,  number: 0,  color: '#FFFFFF', type: BALL_TYPES.CUE,    name: 'Cue Ball'  },
    { id: 1,  number: 1,  color: '#FDD835', type: BALL_TYPES.SOLID,  name: '1 Ball'     },
    { id: 2,  number: 2,  color: '#1565C0', type: BALL_TYPES.SOLID,  name: '2 Ball'     },
    { id: 3,  number: 3,  color: '#C62828', type: BALL_TYPES.SOLID,  name: '3 Ball'     },
    { id: 4,  number: 4,  color: '#6A1B9A', type: BALL_TYPES.SOLID,  name: '4 Ball'     },
    { id: 5,  number: 5,  color: '#E65100', type: BALL_TYPES.SOLID,  name: '5 Ball'     },
    { id: 6,  number: 6,  color: '#2E7D32', type: BALL_TYPES.SOLID,  name: '6 Ball'     },
    { id: 7,  number: 7,  color: '#8D6E63', type: BALL_TYPES.SOLID,  name: '7 Ball'     },
    { id: 8,  number: 8,  color: '#212121', type: BALL_TYPES.EIGHT,  name: '8 Ball'     },
    { id: 9,  number: 9,  color: '#FDD835', type: BALL_TYPES.STRIPE, name: '9 Ball'     },
    { id: 10, number: 10, color: '#1565C0', type: BALL_TYPES.STRIPE, name: '10 Ball'    },
    { id: 11, number: 11, color: '#C62828', type: BALL_TYPES.STRIPE, name: '11 Ball'    },
    { id: 12, number: 12, color: '#6A1B9A', type: BALL_TYPES.STRIPE, name: '12 Ball'    },
    { id: 13, number: 13, color: '#E65100', type: BALL_TYPES.STRIPE, name: '13 Ball'    },
    { id: 14, number: 14, color: '#2E7D32', type: BALL_TYPES.STRIPE, name: '14 Ball'    },
    { id: 15, number: 15, color: '#8D6E63', type: BALL_TYPES.STRIPE, name: '15 Ball'    },
];

// ------ Pocket Positions (relative to table center) ------
export function getPocketPositions() {
    const hl = TABLE.LENGTH / 2;
    const hw = TABLE.WIDTH / 2;
    return [
        { x: -hl, z: -hw, type: 'corner' },
        { x: -hl, z:  hw, type: 'corner' },
        { x:   0, z: -hw, type: 'side'   },
        { x:   0, z:  hw, type: 'side'   },
        { x:  hl, z: -hw, type: 'corner' },
        { x:  hl, z:  hw, type: 'corner' },
    ];
}

// ------ Rack Configuration ------
// 15-ball triangle, index → ball ID
// 8-ball is at index 4 (center of 3rd row)
export const RACK_ORDER = [1, 9, 2, 10, 8, 3, 11, 4, 14, 6, 13, 12, 7, 15, 5];

// Compute starting rack positions
export function getRackPositions() {
    const footSpotX = TABLE.LENGTH / 4;
    const d = BALL.RADIUS * 2;
    const rowSpacing = d * Math.sin(Math.PI / 3); // d × √3/2
    const positions = [];
    let idx = 0;

    for (let row = 0; row < 5; row++) {
        for (let col = 0; col <= row; col++) {
            positions.push({
                ballId: RACK_ORDER[idx],
                x: footSpotX + row * rowSpacing,
                y: TABLE.HEIGHT + BALL.RADIUS,
                z: (col - row / 2) * d,
            });
            idx++;
        }
    }
    return positions;
}

// ------ Cue Ball Start Position ------
export const CUE_BALL_START = {
    x: -TABLE.LENGTH / 4,
    y: TABLE.HEIGHT + BALL.RADIUS,
    z: 0,
};

// ------ Karakter başlangıç konumları (masa düzleminde, XZ) ------
// P1 (insan) cue topu ucunda; P2 (rakip/bot) rack ucunda, hafif yana kaydırılmış —
// ikisi de görünür ve çakışmaz. Oyun içinde serbest yürürler.
export const PLAYER_START = {
    1: { x: -TABLE.LENGTH / 4 - 0.18, z:  0.12, face:  Math.PI / 2 },
    2: { x:  TABLE.LENGTH / 4 + 0.10, z: -0.12, face: -Math.PI / 2 },
};

// ------ Bot (yapay zeka) ayarları ------
export const BOT = {
    AIM_ERROR:      0.06,   // rad — nişan gürültüsü (orta zorluk); 0 = kusursuz
    APPROACH_MAG:   0.95,   // cue topa yürürken joystick büyüklüğü (0..1)
    STAND_OFFSET:   0.07,   // cue topun aim'in TERSİ yönünde bu kadar arkasında durur (m)
    KICK_RANGE:     0.10,   // duruş noktasına bu kadar yaklaşınca tekme atılır (m)
    MIN_POWER:      0.45,   // 0..1 atış gücü alt sınırı
    MAX_POWER:      0.90,   // üst sınır
    THINK_DELAY:    0.55,   // s — yürümeden önce kısa "düşünme" beklemesi
    SETTLE_DELAY:   0.30,   // s — varınca tekmeden önce kısa duraklama
    APPROACH_TIMEOUT: 9.0,  // s — takılırsa/uzaksa zorla atış yap (atış konumdan bağımsız çalışır)
    // Sabotaj rolü (bot insanın sırasında — "dengeli": bastır/geri çekil):
    SABO_MAG:         1.0,  // bastırırken hareket büyüklüğü (hız → çarpma)
    SABO_TRAP_INTERVAL: 3.5,// s — bot ara sıra tuzak bırakır
    SABO_BACKOFF:     1.6,  // s — kurbanı devirdikten sonra bot bu kadar geri çekilir
    SABO_KEEP_DIST:   0.22, // m — bastırmazken hedeften bu mesafede bekler (çarpma menzili dışı)
    SABO_PRESS_CUE_NEAR: 0.55, // m — nişancı cue topa bu kadar yakınsa bot saldırıya geçer
    SABO_USE_RANGE:   0.16, // m — item'i ancak nişancıya bu kadar yakınken kullanır (isabet etsin)
    SHIELD_THREAT:    0.14, // m — bot NİŞANCIYKEN sabotajcı bu kadar yakınsa kalkanını açar (Faz 4 savunma)
    // Faz 5: bot item AI — slottaki saldırı item'inin TİPİNE göre nasıl kullanılır.
    // mode (ItemSystem.aiMode): 'melee'=yaklaş+çarp (dash/turbo) · 'trap'=yoluna bırak (muz) ·
    // 'ranged'=uzaktan fırlat (yay/bomba; yapışmaya gerek yok, mesafeyi koru).
    ITEM_AI: {
        melee:  { approachMag: 1.0,  useRange: 0.16 },                 // çarpmak için yapış (≈SABO_USE_RANGE)
        trap:   { approachMag: 0.9,  useRange: 0.22 },                 // önüne bırak (üstüne gelsin)
        ranged: { approachMag: 0.55, useRange: 0.60, minRange: 0.18 }, // uzaktan; çok yaklaşma
    },
};

// ------ Faz 5: Momentum (lastik-bant) — geride kalana hafif daha güçlü item şansı ------
// Skor farkına göre kutu drop ağırlığı: geride olan oyuncu güçlü item'leri daha SIK görür.
// Simetrik (insan da bot da). Para asla güç vermez; bu yalnız kapanış/heyecan içindir.
export const MOMENTUM = {
    ENABLED:   true,
    SCALE:     4,     // rakibe bu kadar grup-top fark atınca "tam geride" (boost zirvesi)
    MAX_BOOST: 2.0,   // tam gerideyken güçlü item ağırlığı ×2
    STRONG:    ['bomb', 'bow', 'turbo', 'blackhole'],  // underdog'a ağırlığı artan item'lar
};

// ------ Sabotaj mekaniği ayarları (çarpma + tuzak fiziği + koruma) ------
// NOT (Faz 1): "ne zaman sabotaj" artık ItemSystem'de (elinde item varsa). Burada yalnız
// mekanik sabitler. Çarpma yalnız sabotajcı DASH'teyken devirir (Faz 3); Faz 1'de tuzak yeter.
export const SABOTAGE = {
    BODYCHECK_RANGE:    0.07,  // m — dash'teyken sabotajcı nişancıya bu kadar yaklaşırsa
    BODYCHECK_SPEED:    0.12,  // m/s — ve bu hızın üstündeyse → çarpma (devirme)
    BODYCHECK_COOLDOWN: 1.6,   // s — ardışık çarpmalar arası
    RAGDOLL_SCALE:      0.35,  // sabotaj devirmesi top çarpmasından nazik (uçup gitmesin)
    RAGDOLL_RECOVERY:   0.9,   // s — devrilen oyuncu bu süre sonra kendiliğinden kalkar (hızlı)
    TRAP_RADIUS:        0.032, // m — tuzağın üstüne gelen kayar
    TRAP_LIFETIME:      9.0,   // s — tuzak bu süre sonra kaybolur
    TRAP_MAX:           3,     // aynı anda sahada en fazla tuzak (sahip başına)
    // Muz "ayak kayması": gerçek slip hissi — yatay kayar ama AZ uçar (düşük vert),
    // sonra YERDE uzun kalır (2.5 sn). Diğer devirmelerden ayrı tunlanır.
    SLIP_SCALE:         0.55,  // yatay kayma şiddeti (kayıp gitsin ama uçmasın)
    SLIP_VERT:          0.18,  // dikey itme çarpanı (≈0 → yerden kalkmaz, kayar)
    SLIP_RECOVERY:      2.5,   // s — muzda yerde kalma süresi

    // --- Koruma pencereleri (adalet) ---
    KNOCK_IMMUNITY:     3.0,   // s — devrilip KALKTIKTAN sonra tekrar devrilemezsin
    TURN_GRACE:         4.0,   // s — tur başında nişancı dokunulmaz (yaklaşma penceresi)
    // NOT: nişancı ŞARJ ederken (POWER) de dokunulmaz — başlanan atış asla iptal olmaz
    // (bkz. main.js sabotageManager.update shooterCharging).
};

// ------ Eşya kutuları (Faz 2 — Mario Kart kalbi) ------
export const ITEMBOX = {
    SIZE:          0.045,      // m — kutu kenarı (karaktere yakın boy, görünür)
    HEIGHT:        0.045,      // m — masa üstünde merkez yüksekliği (havada süzülür)
    PICKUP_RADIUS: 0.08,       // m — oyuncu merkezi bu mesafedeyse toplar (joystick'e toleranslı)
    RESPAWN:       7.0,        // s — toplandıktan sonra yeniden doğma süresi
    COLOR:         0x4dd2ff,   // parlak camgöbeği "?" kutusu hissi
    // Masa üstünde sabit doğuş noktaları (X uzun eksen, Z kısa eksen). Köşe ceplerinden
    // ve rack/cue hattından uzak, hareketi teşvik eden iç noktalar.
    SPAWN_POINTS: [
        { x: -0.80, z:  0.32 },
        { x: -0.80, z: -0.32 },
        { x:  0.80, z:  0.32 },
        { x:  0.80, z: -0.32 },
    ],
};

// ------ Hareket item'ları (Faz 3: katmanlı çarpışma) ------
// Sabotajcı item'i kullanınca kısa süre hız patlaması + `isDashing` → o pencerede rakibe
// çarparsa devirir. Tier: ROCKET (sprint, hafif=yuvarla) < TURBO (sert=devir).
export const MOVEMENT = {
    ROCKET: { DURATION: 0.6, SPEED_MUL: 2.6, KNOCK_SCALE: 0.35 },  // hızlı atılış → yuvarlanma
    TURBO:  { DURATION: 2.5, SPEED_MUL: 1.9, KNOCK_SCALE: 0.75 },  // süreli hız → sert devirme
};

// ------ Faz 4: Saldırı + savunma item'ları ------
// Menzilli mermi (yay/roket), gecikmeli bomba, savunma kalkanı. Hepsi ITEM_DEFS'te
// tanımlı; mekanik SabotageManager'da (tuzak/çarpma/knock ile aynı yerde — knock
// koruması grace/dokunulmazlık/şarj hepsi için ortak geçerli). Yalnız nişancı devrilir.

// Menzilli mermi (yay/ok): sabotajcı fırlatır, nişancıyı OTOMATİK TAKİP eder (homing).
// Adalet: yalnız 3 sn yaşar + sınırlı dönüş hızı → nişancı kaçabilir/jukelayabilir.
export const PROJECTILE = {
    SPEED:       0.72,   // m/s — yatay hız (kaçılabilir olsun diye ölçülü)
    LIFETIME:    3.0,    // s — homing süresi; sonra söner (adalet)
    TURN_RATE:   2.6,    // rad/s — hedefe dönüş hızı (homing; düşük=kaçılabilir)
    HIT_RADIUS:  0.055,  // m — nişancıya bu kadar yaklaşınca isabet (cömert)
    RADIUS:      0.012,  // m — görsel küre yarıçapı
    KNOCK_SCALE: 0.50,   // isabette devirme şiddeti
    COLOR:       0xff5a3c,
};

// Bomba: artık BOWLING gibi yuvarlanan fırlatma. Baktığın/aim yönünde yuvarlanır,
// 4 sn ilerler, sonra (veya nişancıya değince/sınıra varınca) BÜYÜK yarıçapta patlar.
// Tutturması zor olduğundan hasar yarıçapı geniş.
export const BOMB = {
    SPEED:       0.62,   // m/s — yuvarlanma hızı
    TRAVEL:      4.0,    // s — bu süre yuvarlanır, sonra patlar
    CONTACT:     0.045,  // m — nişancıya bu kadar yaklaşırsa ERKEN patlar (direkt isabet)
    RADIUS:      0.22,   // m — patlama (alan-etki devirme) yarıçapı — GENİŞ
    KNOCK_SCALE: 0.85,   // alan devirme şiddeti (güçlü)
    SIZE:        0.019,  // m — görsel küre yarıçapı (yuvarlanan top)
    COLOR:       0x222222,
    FLASH:       0xff7a18,
};

// Kalkan: nişancı savunması. Kısa süre dokunulmazlık (mevcut `immune` altyapısı) +
// görsel kabuk. Nişancı zaten devrilebilen taraf olduğundan immune onu korur.
export const SHIELD = {
    DURATION: 4.0,       // s — dokunulmazlık + kabuk süresi
    COLOR:    0x4dd2ff,
};

// ------ Faz 7: Ultimate (jenerik "Şok Dalgası") ------
// Kombo enerjisi (ComboSystem) dolunca tetiklenir. EMP gibi: sahadaki TÜM tuzak/mermi/
// bombayı siler, RAKİBİ devirir (korumaları DELER — maç boyu biriken nadir ödül) ve
// kullanana kısa kalkan verir. Görsel: genişleyen mor şok halkası + patlama + sarsıntı.
export const ULTIMATE = {
    KNOCK_SCALE: 1.0,    // güçlü devirme (rakibi sertçe savur)
    RECOVERY:    1.7,    // s — kurban yerde kalma süresi (uzun → belirgin payoff)
    COLOR:       0xb06bff, // mor şok dalgası rengi (HUD/glow ile uyumlu)
    RING_R:      0.85,   // m — şok halkasının genişleme yarıçapı (masayı kaplar)
};

// "Enerji Dalgası" ultimate'ı (insan P1 varsayılanı) — Dragon Ball tarzı: karakter
// kilitlenir, önünde enerji topu şarj olur (kamerayla YÖN verilir), sonra lazer aim
// yönüne ateşler. Görsel referans: _assets_src/ulti_ball.html (kırmızı-turuncu plazma).
export const BEAM = {
    CHARGE:      3.5,    // s — top şarj süresi (karakter kilitli, yön verilebilir)
    FIRE:        2.6,    // s — lazer süresi (aim ile süpürülebilir; beam-fire sesi ~3s → uyumlu + tempolu)
    FADE:        0.5,    // s — sönüş (FIRE+FADE ≈ 3.1s ≈ ses)
    CAM_SIDE:    0.07,   // m — kanal boyunca kamera SAĞA kayar (karakter solda kalır — anime çerçevesi)
    RANGE:       2.6,    // m — lazer menzili (masayı boydan aşar)
    WIDTH:       0.22,   // m — çarpma koridoru yarı-genişliği (görsel lazer kalınlığıyla uyumlu)
    BALL_R:      0.064,  // m — enerji topu maks yarıçapı (karakterden BÜYÜK — gösteriş ×2)
    BEAM_R:      0.04,   // m — lazer çekirdek yarıçapı (×2)
    KNOCK_SCALE: 1.1,    // devirme şiddeti (ulti — korumaları deler)
    RECOVERY:    1.7,    // s — kurban yerde kalma
    Y_OFF:       0.06,   // m — topun masa yüzeyinden yüksekliği (büyük top keçeye gömülmesin)
    AHEAD:       0.1,    // m — topun karakterin önündeki mesafesi (büyük top karakteri yutmasın)
};

// ------ Faz 15: Yerel ilerleme (XP / coin / seviye — localStorage, backend YOK) ------
// Maç sonunda insan oyuncunun (P1) performansından XP+coin hesaplanır; ödül ekranında
// animasyonla gösterilir. Para asla güç vermez — ilerleme yalnız kozmetik/unlock için.
export const PROGRESSION = {
    XP: {
        win: 120,       // maç kazanma
        loss: 40,       // kaybetsen de birikir ("bir maç daha" hissi)
        pot: 10,        // soktuğun her nesne topu
        knock: 12,      // rakibi her devirme
        pickup: 4,      // her kutu toplama
        ultimate: 25,   // her ultimate kullanımı
    },
    COIN: {
        win: 50,
        loss: 15,
        pot: 2,
        knock: 3,
    },
    // Seviye eğrisi: n → n+1 için gereken XP = LEVEL_BASE + (n-1) * LEVEL_STEP.
    LEVEL_BASE: 100,
    LEVEL_STEP: 50,
};

// Ağırlıklı eşya havuzu (kutu rastgele item verir). Burada TÜM planlanan item'lar var
// (tasarım referansı); ItemBoxManager yalnız ITEM_DEFS'te TANIMLI olanları havuza alır →
// yeni item ekledikçe (Faz 3/4) otomatik katılır. Faz 2'de yalnız `banana` tanımlı.
export const ITEM_DROP_TABLE = {
    banana:    25,
    turbo:     20,
    bow:       15,
    rocket:    12,
    bomb:      10,
    shield:    10,
    blackhole:  8,
};

// ------ Faz 6: Kombo → Ultimate enerjisi ------
// Aksiyon yaptıkça (top sok / rakibi devir / kutu al) kombo artar; her olay enerji
// barını doldurur (çarpan kombo kademesiyle büyür). Bar dolunca ultimate HAZIR
// (Faz 7 tetikler). Kombo penceresi içinde yeni aksiyon zinciri sürdürür; pencere
// dolunca kombo sıfırlanır (enerji KALIR — ultimate meta-kaynağı, maç boyu birikir).
export const COMBO = {
    WINDOW:    5.0,    // s — yeni aksiyon bu süre içinde gelirse kombo sürer
    MULT_STEP: 0.5,    // her kombo kademesi enerji çarpanını bu kadar artırır
    MAX_MULT:  4.0,    // çarpan tavanı
    WEIGHTS: {         // olay başına taban enerji katkısı (1.0 = dolu bar)
        pot:    0.18,  // top sokmak en değerli
        knock:  0.10,  // rakibi devirmek (sabotaj)
        pickup: 0.05,  // eşya kutusu toplamak
    },
};

// ------ Faz 13: Maç içi mini olaylar (EventManager) ------
// Mario Kart "her maç farklı" hissi: oyun sırasında ara ara çevre değişir. v1
// olayları FİZİK-GÜVENLİ ve SİMETRİK (bot da insan da aynı etkilenir, FOUL üretmez,
// ekstra fizik adımı gerektirmez) — yalnız top↔masa/bant fizik parametrelerini geçici
// ölçekler. Daha "fiziksel" olaylar (dev top, cep değişimi, kenar çökme) sonraki alt-faz.
// Olay tanımları (etki fonksiyonları) EventManager.js EVENT_DEFS'te; burada yalnız tunable.
export const EVENTS = {
    ENABLED:      true,
    FIRST_DELAY:  20,   // s — maç başından İLK olaya kadar (ısınma süresi)
    INTERVAL_MIN: 22,   // s — bir olay bitince sonrakine en az bu kadar
    INTERVAL_MAX: 38,   // s — en fazla bu kadar (rastgele aralık)

    // ❄️ Buz: top sürtünmesi düşer → toplar UZAK kayar (kontrol zor). DAMPING_MUL<1.
    ICE:    { DURATION: 13, DAMPING_MUL: 0.30, WEIGHT: 1, ICON: '❄️',  NAME: 'BUZ',
              SUB: 'Toplar kayıyor!',     COLOR: '#7fdfff', SOUND: 'ice' },
    // 🪵 Ağır masa: sürtünme artar → toplar ÇABUK durur (kısa mesafe). DAMPING_MUL>1.
    HEAVY:  { DURATION: 12, DAMPING_MUL: 1.95, WEIGHT: 1, ICON: '🪵',  NAME: 'AĞIR MASA',
              SUB: 'Toplar ağırlaştı',    COLOR: '#c08a45', SOUND: 'heavy' },
    // 🎈 Zıpzıp bantlar: bant sekmesi artar → toplar bantlardan sertçe sekriri (kaos).
    BOUNCY: { DURATION: 12, RESTITUTION_MUL: 1.45, WEIGHT: 1, ICON: '🎈', NAME: 'ZIPZIP BANTLAR',
              SUB: 'Bantlar fırlatıyor',  COLOR: '#ff5ad0', SOUND: 'bouncy' },

    // 🪩 Dev top (Faz 13b — FİZİKSEL olay): masadan geçen kinematik DEV küre topları
    // dağıtır. Oyun donar (karakterler idle, atış kilitli); yalnız toplar + dev küre
    // hareket eder → tek fizik penceresi. Cep güvenliği: geçiş sonrası cep ağzında kalan
    // top içeri itilir (sıra-dışı pot/foul yok). Yalnız WALKING + toplar durmuş + break
    // değil + ragdoll yokken tetiklenir (EventManager `canPhysical`).
    GIANT: {
        PHYSICAL:   true,   // fizik-aktif olay (oyun donar, ekstra step)
        DURATION:   8.0,    // s — geçiş sert zaman aşımı (normalde masadan çıkınca biter)
        SETTLE_MAX: 2.5,    // s — geçiş sonrası topların durması için en fazla bu kadar beklenir
        SPEED:      0.85,   // m/s — yatay yuvarlanma hızı (≈3.5s'de masayı geçer)
        RADIUS:     0.12,   // m — dev kürenin yarıçapı (≈4× normal top → geniş süpürme)
        WEIGHT:     1,      // drop ağırlığı (diğer olaylarla eşit ≈ %25)
        ICON: '🪩',  NAME: 'DEV TOP', SUB: 'Dağılın!', COLOR: '#ffd24a', SOUND: 'giant',
    },
};

// ------ Game States ------
export const GAME_STATES = {
    LOADING:      'LOADING',
    MENU:         'MENU',        // Ana menü — canlı 3D backdrop, kamera yörüngede
    WALKING:      'WALKING',
    AIMING:       'AIMING',
    POWER:        'POWER',
    SHOOTING:     'SHOOTING',
    BALLS_MOVING: 'BALLS_MOVING',
    EVALUATING:   'EVALUATING',
    BALL_IN_HAND: 'BALL_IN_HAND',
    GAME_OVER:    'GAME_OVER',
};

// ------ Physics Configuration ------
export const PHYSICS = {
    TIMESTEP:             1 / 120,
    MAX_SUB_STEPS:        3,
    SOLVER_ITERATIONS:    10,
    GRAVITY:              0,       // ❌ Gravity OFF — critical for billiards!
    TABLE_FRICTION:       0.3,     // Felt surface friction
    TABLE_RESTITUTION:    0.2,     // Low bounce off table surface
    CUSHION_FRICTION:     0.2,     // Cushion rubber friction
    CUSHION_RESTITUTION:  0.6,     // Good bounce off cushions
};

// ------ Shot Configuration ------
export const SHOT = {
    MIN_FORCE:    1,
    MAX_FORCE:    8,         // Reduced max force to prevent balls flying over cushions
    CHARGE_SPEED: 1.2,   // Power units per second
};

// ------ Camera Configuration ------
export const CAMERA = {
    DEFAULT_DISTANCE: 0.45,             // TPS: character visible with surroundings
    MIN_DISTANCE:     0.15,             // Don't allow too close
    MAX_DISTANCE:     2.0,              // Max zoom out
    DEFAULT_POLAR:    Math.PI / 2 - 0.15,// Slightly above horizontal (TPS over-shoulder)
    MIN_POLAR:        0.1,
    MAX_POLAR:        Math.PI / 2 - 0.01,
    SMOOTH_SPEED:     5,
    ROTATE_SPEED:     0.003,

    // ------ Faz 8: kamera juice (his / "tok hareket") ------
    // Koşu bob'u: takip edilen karakterin hızına göre kamerayı hafifçe sallar.
    BOB_REF_SPEED:    0.30,  // m/s — bu hızda bob TAM şiddet (≈ Player.walkSpeed)
    BOB_FREQ:         9.0,   // rad/s — bob temel frekansı (adım hissi)
    BOB_VERT:         0.006, // m — dikey bob genliği (tam hızda)
    BOB_LAT:          0.004, // m — yanal salınım genliği (tam hızda)
    // Yaklaşma zoom'u: insan nişancı cue topa yaklaşınca kamera hafifçe içeri girer.
    APPROACH_NEAR:    0.16,  // m — bu mesafede tam zoom
    APPROACH_FAR:     0.55,  // m — bu mesafeden uzakta zoom yok
    APPROACH_ZOOM:    0.12,  // m — yaklaşınca efektif mesafe azaltımı (hafif)
    TENSION_ZOOM:     0.14,  // m — Faz 10 final evresinde sürekli gerilim zoom'u (içeri)
    CHARGE_ZOOM:      0.10,  // m — güç şarjında içeri dalış (power salındıkça kamera nefes alır)

    // ------ TPS çerçevesi (2026-07-10): karakter SOLDA, crosshair ortada ------
    // Kamera + bakış noktası bakışa DİK sağa kayar (omuz-üstü çerçeve). Kayma efektif
    // kamera MESAFESİYLE ORANTILI → her zoom seviyesinde karakter aynı ekran konumunda.
    TPS_SIDE:         0.12,  // mesafe oranı (0=kapalı; 0.12 ≈ karakter crosshair'e çok yakın)

    // ------ Atış mesafe sınırı ------
    SHOOT_RANGE:      0.30,  // m — cue topa bu mesafeden uzaksa atış yapılamaz
    AIM_LINE_RANGE:   0.45,  // m — nişan çizgisi bu mesafeye kadar görünür
};

// ------ Faz 11: Postprocessing (yalnız "Yüksek" grafik kalitesinde) ------
// EffectComposer ile Bloom + Vignette. SceneManager.setQuality 'high' iken kurar/açar,
// 'low'da tamamen kapatır (mobil-perf: düşük kalitede ek render maliyeti yok). Bloom
// lambaların/emissive'lerin/eklemeli partiküllerin ışımasını verir; vignette kenar karartısı.
export const POST = {
    BLOOM_STRENGTH:  0.45,   // ışıma şiddeti (ölçülü → washout yok)
    BLOOM_RADIUS:    0.42,   // ışıma yayılımı
    BLOOM_THRESHOLD: 0.82,   // bu parlaklığın üstü ışır (yalnız gerçekten parlak yerler)
    VIGNETTE_OFFSET: 1.15,   // vignette ne kadar dışarıda başlar (büyük = daha az)
    VIGNETTE_DARK:   0.85,   // kenar karartı şiddeti
};
