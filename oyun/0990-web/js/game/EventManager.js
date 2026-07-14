// ============================================
// EventManager — Maç içi mini olaylar (Faz 13)
// ============================================
// "Her maç farklı" hissi (Mario Kart): oyun sırasında ara ara çevre değişir.
//
// İKİ TÜR olay:
//  • ÇEVRESEL (13a, fizik-güvenli): yalnız top↔masa/bant fizik PARAMETRESİNİ geçici
//    ölçekler (buz=kayar, ağır=durur, zıpzıp=sekriri). Bot da insan da aynı etkilenir →
//    adil; FOUL üretmez; ekstra fizik adımı GEREKTİRMEZ (atış çözümünde hissedilir).
//  • FİZİKSEL (13b, `physical:true`): topları gerçekten HAREKET ettirir (dev top). Oyun
//    DONAR (karakterler idle, atış kilitli), yalnız toplar + olay nesnesi hareket eder →
//    main.js ayrı bir "fizik penceresi" adımı sürer (needsPhysicsStep). Cep güvenliği:
//    geçiş sonrası cep ağzında kalan top içeri itilir → sıra-dışı pot/foul YOK. Yalnız
//    güvenli anda tetiklenir (ctx.canPhysical: WALKING + toplar durmuş + break değil + ragdoll yok).
//
// Veri-güdümlü: ayarlar constants.js EVENTS, etki/yaşam fonksiyonları aşağıdaki EVENT_DEFS'te.
// Zamanlama: maç başından FIRST_DELAY sonra ilk olay; her olay bitince INTERVAL_MIN..MAX bekler.
import { EVENTS, BALL } from '../constants.js';
import { GiantBall } from '../scene/GiantBall.js';

// Olay tanımları. Çevresel olaylar: start(ctx)/end(ctx) (end DAİMA start'ın tersi, idempotent).
// Fiziksel olaylar: physical:true → yaşam döngüsü manager'ın _startGiant/_updateGiant'ında.
export const EVENT_DEFS = [
    {
        id: 'ice', cfg: EVENTS.ICE,
        start: (ctx) => ctx.ballPhysics.setDampingMul(EVENTS.ICE.DAMPING_MUL),
        end:   (ctx) => ctx.ballPhysics.setDampingMul(1),
    },
    {
        id: 'heavy', cfg: EVENTS.HEAVY,
        start: (ctx) => ctx.ballPhysics.setDampingMul(EVENTS.HEAVY.DAMPING_MUL),
        end:   (ctx) => ctx.ballPhysics.setDampingMul(1),
    },
    {
        id: 'bouncy', cfg: EVENTS.BOUNCY,
        start: (ctx) => ctx.physicsWorld.setCushionRestitutionMul(EVENTS.BOUNCY.RESTITUTION_MUL),
        end:   (ctx) => ctx.physicsWorld.setCushionRestitutionMul(1),
    },
    {
        id: 'giant', cfg: EVENTS.GIANT, physical: true,
        // start/update/end manager'da (_startGiant/_updateGiant/_disposeGiant) — fizik gövdesi yönetir.
    },
];

// Zamanlayıcının yeni olay başlatabileceği durumlar (yalnız aktif oyun, atış arası).
const SCHEDULE_STATES = new Set(['WALKING', 'POWER']);
// Aktif olayı ANINDA bitirmesi gereken durumlar (menü/oyun sonu/yükleme).
const TERMINAL_STATES = new Set(['MENU', 'LOADING', 'GAME_OVER']);

export class EventManager {
    /**
     * @param {object} ctx { ballPhysics, physicsWorld, balls, scene, pocketDetector,
     *                        ui, sound, camera, canPhysical }
     *   canPhysical(): fiziksel olay (dev top) ŞU AN güvenli mi? (WALKING + toplar durmuş +
     *   break değil + ragdoll yok) — main.js sağlar.
     */
    constructor(ctx) {
        this.ctx = ctx;
        this.enabled = false;
        this.active = null;       // o an çalışan EVENT_DEFS girdisi (yoksa null)
        this._remaining = 0;      // aktif ÇEVRESEL olayın kalan süresi (s)
        this._nextIn = 0;         // sonraki olaya kalan zamanlayıcı (s)
        this._pool = EVENT_DEFS.filter(d => d.cfg && (d.cfg.WEIGHT || 0) > 0);

        // --- Fiziksel olay (dev top) durumu ---
        this.physicsActive = false;   // fizik penceresi açık mı (main.js step + atış kilidi)
        this.shotLocked = false;      // atış kilitli mi (insan + bot)
        this._giant = null;           // GiantBall örneği
        this._giantSfx = null;        // dev top yuvarlanma loop handle'ı
        this._giantPhase = null;      // 'crossing' | 'settling'
        this._giantTimeout = 0;       // geçiş sert zaman aşımı
        this._settleTimeout = 0;      // settle sert zaman aşımı
        this._settleFrames = 0;       // ardışık "toplar durdu" kare sayacı
    }

    /** Modda etkin mi (vsbot/local2p/practice → açık; LAN → kapalı). Kapatınca temizler. */
    setEnabled(on) {
        this.enabled = !!on && EVENTS.ENABLED;
        if (!this.enabled) this._endActive();
        else this._nextIn = EVENTS.FIRST_DELAY;
    }

    /** Maç/restart/menü: aktif olayı geri al + zamanlayıcıyı baştan kur. */
    reset() {
        this._endActive();
        this._nextIn = this.enabled ? EVENTS.FIRST_DELAY : 0;
    }

    /** Fizik penceresi açık mı → main.js bu kare topları kendisi step+sync eder, atış kilitli. */
    needsPhysicsStep() { return this.physicsActive; }
    /** Atış kilitli mi (dev top geçişi boyunca insan + bot vuramaz). */
    isShotLocked() { return this.shotLocked; }

    /**
     * Her kare. state = GAME_STATES değeri (string). Çevresel aktif olay süresini her
     * durumda ilerletir (etki şutu kapsasın); fiziksel olayda yaşam döngüsünü sürer;
     * yeni olayı yalnız SCHEDULE_STATES'te planlar.
     */
    update(dt, state) {
        if (!this.enabled) return;

        // Terminal duruma geçildiyse (menü/oyun sonu) aktif olayı anında temizle.
        if (TERMINAL_STATES.has(state)) { this._endActive(); return; }

        // Fiziksel olay (dev top) açıksa: yaşam döngüsünü sür (geçiş → settle → temizle).
        if (this.physicsActive) { this._updateGiant(dt); return; }

        // Çevresel aktif olay: süreyi say, dolunca geri al + sonraki aralığı kur.
        if (this.active) {
            this._remaining -= dt;
            if (this._remaining <= 0) {
                this._endActive();
                this._nextIn = this._randInterval();
            }
            return;
        }

        // Aktif olay yok: yalnız oyun aktifken (atış arası) sonraki olayı geri say.
        if (!SCHEDULE_STATES.has(state)) return;
        this._nextIn -= dt;
        if (this._nextIn <= 0) this._trigger();
    }

    // ---- iç: ortak ----

    _randInterval() {
        return EVENTS.INTERVAL_MIN + Math.random() * (EVENTS.INTERVAL_MAX - EVENTS.INTERVAL_MIN);
    }

    /** Şu an seçilebilir olay havuzu: fiziksel olay güvenli değilse onu dışla. */
    _availablePool() {
        if (this.ctx.canPhysical && !this.ctx.canPhysical())
            return this._pool.filter(d => !d.physical);
        return this._pool;
    }

    _pickWeighted(pool) {
        let total = 0;
        for (const d of pool) total += d.cfg.WEIGHT;
        if (total <= 0) return null;
        let r = Math.random() * total;
        for (const d of pool) {
            r -= d.cfg.WEIGHT;
            if (r <= 0) return d;
        }
        return pool[pool.length - 1];
    }

    /** Ağırlıklı rastgele bir olay seç ve başlat. */
    _trigger() {
        const def = this._pickWeighted(this._availablePool());
        if (!def) { this._nextIn = this._randInterval(); return; }
        this.active = def;

        if (def.physical) { this._startGiant(def); return; }

        // --- Çevresel olay ---
        this._remaining = def.cfg.DURATION;
        try { def.start(this.ctx); } catch (e) { console.error('Event start error:', e); }
        this._announce(def, 0.7, 0.014);
    }

    /** Üst toast + kenar glow + ekran tinti + ses + sarsıntı (ortak juice). */
    _announce(def, glowStrength, shakeAmt) {
        const { ui, sound, camera } = this.ctx;
        if (ui) {
            ui.showNotification(def.cfg.NAME, {
                icon: def.cfg.ICON, subtext: def.cfg.SUB, type: 'warning', duration: 2200,
                glow: { color: def.cfg.COLOR, strength: glowStrength },
            });
            if (ui.setEventTint) ui.setEventTint(def.cfg.COLOR);
        }
        if (sound && sound.playEventCue) sound.playEventCue(def.cfg.SOUND);
        if (camera) camera.shake(shakeAmt, 0.3);
    }

    /** Aktif olayı (çevresel VEYA fiziksel) geri al + görsel tinti kapat. İdempotent. */
    _endActive() {
        if (this.active) {
            if (this.active.physical) this._disposeGiant();
            else { try { this.active.end(this.ctx); } catch (e) { console.error('Event end error:', e); } }
        } else {
            this._disposeGiant();   // güvenlik: olası sızıntı
        }
        this.active = null;
        this._remaining = 0;
        if (this.ctx.ui && this.ctx.ui.setEventTint) this.ctx.ui.setEventTint(null);
    }

    // ---- iç: fiziksel olay (dev top) ----

    _startGiant(def) {
        this._giant = new GiantBall(this.ctx.scene, this.ctx.physicsWorld);
        this.physicsActive = true;
        this.shotLocked = true;
        this._giantPhase = 'crossing';
        this._giantTimeout = def.cfg.DURATION;
        // Derin yuvarlanma uğultusu — geçiş boyunca döner (_disposeGiant söndürür).
        const { sound } = this.ctx;
        this._giantSfx = (sound && sound.startLoop)
            ? sound.startLoop('giant-roll-loop', { gain: 0.7, fadeIn: 0.5 }) : null;
        this._announce(def, 1.0, 0.03);   // dev top daha sert glow + sarsıntı
    }

    /**
     * Dev top yaşam döngüsü (main.js zaten bu kare physicsWorld.step + balls.sync yaptı):
     * 'crossing' (masadan çıkana/zaman aşımına kadar) → 'settling' (toplar durana kadar) →
     * cep güvenliği temizliği → bitir + sonraki olayı planla.
     */
    _updateGiant(dt) {
        this._giantTimeout -= dt;

        if (this._giantPhase === 'crossing') {
            const exited = this._giant ? this._giant.update(dt) : true;
            if (exited || this._giantTimeout <= 0) {
                // Dev küreyi kaldır (artık itmiyor) + mesh'i sahneden al.
                this._disposeGiant(true);   // keepFlags: fizik penceresi settle'da AÇIK kalır
                this._giantPhase = 'settling';
                this._settleTimeout = EVENTS.GIANT.SETTLE_MAX;
                this._settleFrames = 0;
            }
            return;
        }

        // settling: toplar durana (ya da sert zaman aşımına) kadar bekle.
        this._settleTimeout -= dt;
        if (this.ctx.ballPhysics.areAllStopped()) this._settleFrames++;
        else this._settleFrames = 0;

        if (this._settleFrames > 12 || this._settleTimeout <= 0) {
            this.ctx.ballPhysics.forceStopAll();
            this._cleanupPockets();
            const { balls, ballPhysics } = this.ctx;
            if (balls) balls.syncWithPhysics(ballPhysics.getPositions(), ballPhysics.getQuaternions());
            // Bitir: fizik penceresini kapat + kilidi aç + tint sön + sonraki olayı planla.
            this.physicsActive = false;
            this.shotLocked = false;
            this._giantPhase = null;
            this._endActive();
            this._nextIn = this._randInterval();
        }
    }

    /**
     * Cep güvenliği: dev top sonrası cep AĞZINDA duran topu, cepten masa içine doğru
     * güvenli mesafeye iter → sonraki normal atışta sıra-dışı düşme/foul olmaz.
     */
    _cleanupPockets() {
        const { ballPhysics, pocketDetector } = this.ctx;
        if (!pocketDetector) return;
        const pockets = pocketDetector.pockets;
        const BR = BALL.RADIUS;

        for (const [, body] of ballPhysics.bodies) {
            for (const pk of pockets) {
                const dx = body.position.x - pk.x;
                const dz = body.position.z - pk.z;
                const dist = Math.hypot(dx, dz);
                const radius = pk.type === 'corner' ? pocketDetector.cornerRadius : pocketDetector.sideRadius;
                if (dist < radius * 1.3) {
                    // Cepten masa MERKEZİNE doğru (kenar cepleri için güvenilir iç yön).
                    const inx = pk.x === 0 ? 0 : -Math.sign(pk.x);
                    const inz = pk.z === 0 ? 0 : -Math.sign(pk.z);
                    const safe = radius + BR * 2.2;
                    body.position.x = pk.x + inx * safe;
                    body.position.z = pk.z + inz * safe;
                    body.velocity.setZero();
                    body.angularVelocity.setZero();
                    break;
                }
            }
        }
    }

    /** Dev küreyi dispose et + (keepFlags yoksa) fizik penceresi bayraklarını sıfırla. */
    _disposeGiant(keepFlags = false) {
        if (this._giantSfx) { this._giantSfx.stop(0.6); this._giantSfx = null; }
        if (this._giant) { this._giant.dispose(); this._giant = null; }
        if (!keepFlags) {
            this.physicsActive = false;
            this.shotLocked = false;
            this._giantPhase = null;
        }
    }
}
