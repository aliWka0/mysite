// ============================================
// SoundManager — Örnek-tabanlı SFX + prosedürel yedek (Web Audio API)
// ============================================
// public/sfx/*.mp3 (ElevenLabs üretimi, bkz. SES_PROMPTLARI.md) fetch+decodeAudioData
// ile önden yüklenir. Her public fonksiyon ÖNCE örneği dener; dosya yoksa/yüklenemediyse
// ESKİ prosedürel sentez YEDEK olarak çalar (eksik dosya oyunu bozmaz).
// Loop'lar: loop=true BufferSource + gain sürme (setRoll deseni). Tekrar hissi
// varyasyon dosyası yerine hafif pitch/volume oynatmasıyla kırılır (bilinçli).
// EKSİK olduğu bilinen dosyalar da kayıtlıdır (ball-clack-1, win-fanfare, lose-sting,
// shield-down) — üretilip public/sfx'e konunca kod değişmeden kendiliğinden devreye girer.

const SFX_BASE = 'sfx/';
const MASTER_GAIN = 0.6;

// Kayıt: ad → { loop } (URL = sfx/<ad>.mp3). Yorumdakiler ŞU AN public/sfx'te YOK.
const SFX = {
    'ui-move': {}, 'ui-confirm': {},
    'cue-strike-soft': {}, 'cue-strike-med': {}, 'cue-strike-hard': {},
    'ball-clack-1': {},                    // EKSİK (beğenilmedi, yeniden üretilecek)
    'rail-thud-1': {}, 'pocket-drop-1': {},
    'ball-roll-loop': { loop: true },
    'footstep-walk-1': {}, 'footstep-run-1': {},
    'dash-whoosh-1': {},
    'knock-impact-1': {}, 'body-fall': {}, 'banana-slip': {},
    'item-pickup': {}, 'banana-drop': {}, 'bow-shot': {},
    'projectile-loop': { loop: true }, 'bomb-roll-loop': { loop: true }, 'bomb-explosion': {},
    'shield-up': {}, 'shield-down': {},    // shield-down EKSİK
    'combo-pop': {}, 'ulti-ready': {}, 'ulti-shockwave': {},
    'beam-charge': {}, 'beam-fire': {},
    'event-ice': {}, 'event-heavy': {}, 'event-bouncy': {}, 'event-giant': {},
    'giant-roll-loop': { loop: true },
    'tension-loop': { loop: true },
    'finisher-blackhole-loop': { loop: true }, 'finisher-cyclone-loop': { loop: true },
    'finisher-boom': {}, 'finisher-meteor': {}, 'finisher-freeze': {},
    'foul-buzz': {}, 'danger-sting': {},
    'coin-tick-loop': { loop: true }, 'xp-fill': {}, 'level-up': {},
    'menu-ambience-loop': { loop: true },
    'win-fanfare': {}, 'lose-sting': {},   // EKSİK
};

export class SoundManager {
    constructor() {
        this.ctx = null;
        this.master = null;
        this._enabled = true;
        this._noiseBuffer = null;
        this._buffers = {};          // ad → AudioBuffer (yüklenenler)
        this._preloadStarted = false;
        // Throttle: avoid sound spam from many simultaneous collisions
        this._lastClack = 0;
        this._lastRail = 0;
        this._lastStep = 0;
        this._hum = null;         // { kind:'sample', h } | { kind:'synth', osc1, osc2, g }
        this._roll = null;        // top yuvarlanma (Faz 9): sample handle veya synth düğümleri
        this._tensionNode = null; // final-evresi gerilim drone'u (Faz 10)
        this._ambience = null;    // menü ambiyans loop handle'ı
        this._ambienceWanted = false;
    }

    // Settings 'sound' anahtarı `sound.enabled = bool` yazar: master'ı yumuşakça
    // susturur/açar → çalan loop'lar dahil HER ŞEY anında sessizleşir.
    get enabled() { return this._enabled; }
    set enabled(v) {
        this._enabled = !!v;
        if (this.master) {
            const t = this._now();
            this.master.gain.cancelScheduledValues(t);
            this.master.gain.setTargetAtTime(this._enabled ? MASTER_GAIN : 0.0001, t, 0.05);
        }
    }

    /**
     * Lazily create / resume the AudioContext.
     * MUST be called from within a user gesture (e.g. pointer down)
     * or browsers will keep the context suspended.
     */
    ensure() {
        if (!this._enabled) return;
        if (!this.ctx) this._initCtx();
        if (!this.ctx) return;
        this.preload();
        if (this.ctx.state === 'suspended') {
            const p = this.ctx.resume();
            // Menü ambiyansı istenmişse ilk jestte (resume başarınca) başlat.
            if (p && p.then) p.then(() => this._tryAmbience()).catch(() => {});
        }
    }

    _initCtx() {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { this._enabled = false; return; }
        this.ctx = new AC();   // jest öncesi 'suspended' kalabilir — decode yine çalışır
        this.master = this.ctx.createGain();
        this.master.gain.value = this._enabled ? MASTER_GAIN : 0.0001;
        this.master.connect(this.ctx.destination);
        this._buildNoiseBuffer();
    }

    /**
     * Tüm örnekleri arka planda indir + çöz (init'te çağrılabilir; jest GEREKMEZ —
     * decodeAudioData suspended context'te de çalışır). Eksik/bozuk dosya sessizce
     * atlanır → o ses prosedürel yedeğiyle çalmaya devam eder.
     */
    preload() {
        if (this._preloadStarted) return;
        this._preloadStarted = true;
        if (!this.ctx) this._initCtx();
        if (!this.ctx) return;
        for (const name of Object.keys(SFX)) {
            fetch(SFX_BASE + name + '.mp3')
                .then((r) => { if (!r.ok) throw new Error('404'); return r.arrayBuffer(); })
                .then((ab) => this.ctx.decodeAudioData(ab))
                .then((buf) => {
                    this._buffers[name] = buf;
                    if (name === 'menu-ambience-loop') this._tryAmbience();
                })
                .catch(() => { /* dosya yok/çözülemedi → prosedürel yedek */ });
        }
    }

    _buildNoiseBuffer() {
        const len = Math.floor(this.ctx.sampleRate * 0.3);
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        this._noiseBuffer = buf;
    }

    _now() {
        return this.ctx ? this.ctx.currentTime : 0;
    }

    // ---- Örnek çalar çekirdeği ----

    /**
     * Tek atımlık örnek çal. delay = ses saatinde ileri planla (s); maxDur = dosyanın
     * yalnız BAŞINI çal (s, kısa söndürmeyle keser — uzun kuyruklu / birden çok vuruş
     * içeren dosyalar üst üste binip "yankı" yapmasın); offset = dosyanın İÇİNDEN başla
     * (s — baştaki giriş/sessizliği atla, transient tetik anına otursun). true = çaldı.
     */
    _play(name, { gain = 1, rate = 1, delay = 0, maxDur = 0, offset = 0 } = {}) {
        if (!this._enabled || !this.ctx) return false;
        const buf = this._buffers[name];
        if (!buf) return false;
        const t0 = this._now() + Math.max(0, delay);
        const off = Math.min(Math.max(0, offset), Math.max(0, buf.duration - 0.05));
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = rate;
        const g = this.ctx.createGain();
        g.gain.value = gain;
        src.connect(g);
        g.connect(this.master);
        if (maxDur > 0 && (buf.duration - off) / rate > maxDur) {
            g.gain.setValueAtTime(gain, t0 + maxDur * 0.7);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + maxDur);
            src.start(t0, off);
            src.stop(t0 + maxDur + 0.02);
        } else {
            src.start(t0, off);
        }
        return true;
    }

    /**
     * Döngülü örnek başlat → handle { src, g, setGain(v), stop(fade) } veya null
     * (buffer hazır değil). Çağıran null'ı umursamaz — yedek/sessizlik kabul.
     */
    _loop(name, { gain = 1, rate = 1, fadeIn = 0 } = {}) {
        if (!this._enabled || !this.ctx) return null;
        const buf = this._buffers[name];
        if (!buf) return null;
        const t = this._now();
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        src.playbackRate.value = rate;
        const g = this.ctx.createGain();
        if (fadeIn > 0) {
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), t + fadeIn);
        } else {
            g.gain.value = gain;
        }
        src.connect(g);
        g.connect(this.master);
        src.start(t);
        const self = this;
        return {
            src, g,
            setGain(v, tc = 0.08) { g.gain.setTargetAtTime(v, self._now(), tc); },
            stop(fade = 0.2) {
                const tt = self._now();
                g.gain.cancelScheduledValues(tt);
                g.gain.setTargetAtTime(0.0001, tt, Math.max(0.01, fade / 3));
                try { src.stop(tt + fade + 0.1); } catch (_) { /* yok say */ }
            },
        };
    }

    /** Genel amaçlı: adıyla örnek çal (finisher def'leri gibi veri-güdümlü yerler için).
     *  opts → _play seçenekleri (rate/offset/maxDur/delay). */
    playSample(name, gain = 1, opts = {}) {
        this.ensure();
        return this._play(name, { gain, ...opts });
    }

    /** Genel amaçlı döngü başlat (mermi/bomba/dev top yuvarlanması vb.) → handle | null. */
    startLoop(name, opts = {}) {
        this.ensure();
        return this._loop(name, opts);
    }

    /** ±frac rastgele pitch oynaması (tekrar hissini kırar). */
    _jitter(frac = 0.05) {
        return 1 + (Math.random() * 2 - 1) * frac;
    }

    // ---- Prosedürel yedek yapı taşları ----

    /** Short filtered noise burst — the percussive "tick" component. */
    _noiseBurst({ duration = 0.06, freq = 2500, q = 1, gain = 0.4, type = 'bandpass' }) {
        if (!this._enabled || !this.ctx) return;
        const t = this._now();
        const src = this.ctx.createBufferSource();
        src.buffer = this._noiseBuffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = type;
        filter.frequency.value = freq;
        filter.Q.value = q;

        const g = this.ctx.createGain();
        g.gain.setValueAtTime(gain, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + duration);

        src.connect(filter);
        filter.connect(g);
        g.connect(this.master);
        src.start(t);
        src.stop(t + duration + 0.02);
    }

    /** Quick sine/triangle tone — the tonal "thud" or melodic component. */
    _tone({ freq = 200, duration = 0.15, gain = 0.3, type = 'sine', slideTo = null }) {
        if (!this._enabled || !this.ctx) return;
        const t = this._now();
        const osc = this.ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);
        if (slideTo !== null) {
            osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + duration);
        }

        const g = this.ctx.createGain();
        g.gain.setValueAtTime(gain, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + duration);

        osc.connect(g);
        g.connect(this.master);
        osc.start(t);
        osc.stop(t + duration + 0.02);
    }

    // ---- Public SFX ----

    /** Soft UI blip for menu navigation. kind: 'move' | 'confirm' */
    playUI(kind = 'move') {
        this.ensure();
        if (!this.ctx) return;
        if (kind === 'confirm') {
            if (this._play('ui-confirm', { gain: 0.5 })) return;
            this._tone({ freq: 440, duration: 0.12, gain: 0.16, type: 'triangle', slideTo: 880 });
        } else {
            if (this._play('ui-move', { gain: 0.35 })) return;
            this._tone({ freq: 660, duration: 0.045, gain: 0.08, type: 'sine' });
        }
    }

    /** Cue stick striking the ball. power: 0..1 → soft/med/hard örneği + güçle gain. */
    playStrike(power = 0.5) {
        this.ensure();
        if (!this.ctx) return;
        const p = Math.max(0.1, Math.min(1, power));
        const name = p < 0.34 ? 'cue-strike-soft' : p < 0.7 ? 'cue-strike-med' : 'cue-strike-hard';
        // maxDur: soft dosyası ~8s ve birden çok vuruş içeriyor — yalnız İLK vuruş çalsın
        // (sonraki vuruşlar toplar yuvarlanırken hayalet "çarpma" gibi duyuluyordu).
        if (this._play(name, { gain: 0.55 + p * 0.45, rate: this._jitter(0.04), maxDur: 1.2 })) return;
        // Yedek: sharp wooden tick + low thump that scales with power
        this._noiseBurst({ duration: 0.05, freq: 1800 + p * 1200, q: 1.2, gain: 0.35 + p * 0.25 });
        this._tone({ freq: 140 + p * 60, duration: 0.12, gain: 0.25 + p * 0.2, type: 'triangle', slideTo: 80 });
    }

    /** Ball-to-ball click. vol: 0..1 (impact strength) */
    playClack(vol = 0.5) {
        this.ensure();
        if (!this.ctx) return;
        const t = performance.now();
        if (t - this._lastClack < 18) return; // throttle bursts
        this._lastClack = t;
        const v = Math.max(0.08, Math.min(1, vol));
        if (this._play('ball-clack-1', { gain: 0.15 + v * 0.85, rate: this._jitter(0.08) })) return;
        // YER TUTUCU (ball-clack-1 henüz üretilmedi): isteka vuruşunun BAŞI tizleştirilerek
        // top-topa "klak" olarak çalınır — prosedürel synth duyulmasın (kullanıcı isteği).
        // Gerçek ball-clack-1.mp3 konunca üstteki satır devreye girer, bu yol ölür.
        if (this._play('cue-strike-med', { gain: 0.15 + v * 0.75, rate: 1.5 * this._jitter(0.08), maxDur: 0.15 })) return;
        // Yedek: ceramic click — high bandpass noise + short bright tone
        this._noiseBurst({ duration: 0.035, freq: 3200 + v * 2500, q: 2.0, gain: 0.18 + v * 0.35 });
        this._tone({ freq: 1400 + v * 900, duration: 0.05, gain: 0.06 + v * 0.12, type: 'sine' });
    }

    /** Ball hitting a cushion/rail. vol: 0..1 */
    playRail(vol = 0.5) {
        this.ensure();
        if (!this.ctx) return;
        const t = performance.now();
        if (t - this._lastRail < 25) return;
        this._lastRail = t;
        const v = Math.max(0.08, Math.min(1, vol));
        if (this._play('rail-thud-1', { gain: 0.2 + v * 0.8, rate: this._jitter(0.07) })) return;
        // Yedek: softer, duller thud
        this._noiseBurst({ duration: 0.07, freq: 600 + v * 400, q: 0.8, gain: 0.12 + v * 0.22, type: 'lowpass' });
        this._tone({ freq: 110, duration: 0.09, gain: 0.05 + v * 0.1, type: 'sine' });
    }

    /** Ball dropping into a pocket (düşüş + cep içi tıkırtı tek dosyada). */
    playPocket() {
        this.ensure();
        if (!this.ctx) return;
        if (this._play('pocket-drop-1', { gain: 0.9, rate: this._jitter(0.04) })) return;
        // Yedek: descending "plop" + rattle + gecikmeli cep yankısı
        this._tone({ freq: 520, duration: 0.18, gain: 0.28, type: 'sine', slideTo: 160 });
        this._noiseBurst({ duration: 0.12, freq: 900, q: 0.6, gain: 0.12, type: 'lowpass' });
        setTimeout(() => this._tone({ freq: 240, duration: 0.12, gain: 0.07, type: 'sine', slideTo: 110 }), 90);
        setTimeout(() => this._tone({ freq: 180, duration: 0.10, gain: 0.035, type: 'sine', slideTo: 90 }), 200);
    }

    /**
     * Finisher build uğultusu. loopName (ör. 'finisher-blackhole-loop' /
     * 'finisher-cyclone-loop') verilirse o örnek loop döner (yavaş pitch yükselişiyle
     * gerilim); yoksa/yüklenmediyse prosedürel bas drone (yükselen).
     */
    startHum(loopName = null) {
        this.ensure();
        if (!this.ctx || this._hum) return;
        if (loopName) {
            const h = this._loop(loopName, { gain: 0.55, fadeIn: 1.2 });
            if (h) {
                const t = this._now();
                h.src.playbackRate.setValueAtTime(0.92, t);
                h.src.playbackRate.linearRampToValueAtTime(1.15, t + 4.5);
                this._hum = { kind: 'sample', h };
                return;
            }
        }
        const t = this._now();
        const osc1 = this.ctx.createOscillator();
        osc1.type = 'sine'; osc1.frequency.value = 48;
        const osc2 = this.ctx.createOscillator();
        osc2.type = 'sawtooth'; osc2.frequency.value = 36;
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 180;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.32, t + 1.2);
        // slow rising pitch = building tension
        osc1.frequency.exponentialRampToValueAtTime(120, t + 4.5);
        osc2.frequency.exponentialRampToValueAtTime(90, t + 4.5);
        osc1.connect(lp); osc2.connect(lp); lp.connect(g); g.connect(this.master);
        osc1.start(t); osc2.start(t);
        this._hum = { kind: 'synth', osc1, osc2, g };
    }

    stopHum(release = 0.4) {
        if (!this.ctx || !this._hum) return;
        if (this._hum.kind === 'sample') {
            this._hum.h.stop(release);
            this._hum = null;
            return;
        }
        const t = this._now();
        const { osc1, osc2, g } = this._hum;
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + release);
        osc1.stop(t + release + 0.05);
        osc2.stop(t + release + 0.05);
        this._hum = null;
    }

    /** Massive cosmic detonation boom (finisher). */
    playBoom() {
        this.ensure();
        if (!this.ctx) return;
        if (this._play('finisher-boom', { gain: 1.0 })) return;
        // Yedek: sub-bass drop + explosion noise body
        this._tone({ freq: 160, duration: 1.1, gain: 0.6, type: 'sine', slideTo: 28 });
        this._tone({ freq: 90, duration: 0.9, gain: 0.4, type: 'triangle', slideTo: 24 });
        this._noiseBurst({ duration: 0.7, freq: 800, q: 0.4, gain: 0.5, type: 'lowpass' });
        this._noiseBurst({ duration: 0.35, freq: 4000, q: 0.5, gain: 0.25, type: 'highpass' });
    }

    /** Bomb detonation — compact low boom + bright crack (Faz 4 item). */
    playExplosion() {
        this.ensure();
        if (!this.ctx) return;
        if (this._play('bomb-explosion', { gain: 0.85 })) return;
        // Yedek: kısa sub-bas düşüş + parlak gürültü çıtırtısı
        this._tone({ freq: 130, duration: 0.4, gain: 0.4, type: 'sine', slideTo: 32 });
        this._noiseBurst({ duration: 0.28, freq: 700, q: 0.4, gain: 0.32, type: 'lowpass' });
        this._noiseBurst({ duration: 0.12, freq: 3600, q: 0.5, gain: 0.16, type: 'highpass' });
    }

    // ---- Faz 9: aksiyon ses katmanları (ayak/dash/pickup/top yuvarlanma) ----

    /**
     * Ayak sesi. vol: 0..1 (gain). running: karakterin GERÇEK yürüyüşü (Player.running /
     * animasyonla birebir) — verilirse örnek seçimi budur; null ise eski hız eşiği (yedek).
     */
    playFootstep(vol = 0.5, running = null) {
        this.ensure();
        if (!this.ctx) return;
        const t = performance.now();
        const v = Math.max(0.1, Math.min(1, vol));
        const isRun = running != null ? !!running : v > 0.62;
        const name = isRun ? 'footstep-run-1' : 'footstep-walk-1';
        if (this._buffers[name]) {
            // Örnek dosyalar ~1.3s (tek "tık" değil — kuyruk/ikinci adım içeriyor):
            // yalnız BAŞINI çal (maxDur) + adım aralığını gerçekçi tut (150ms) —
            // yoksa üst üste binip "ikili/yankılı" duyuluyor.
            if (t - this._lastStep < 150) return;
            this._lastStep = t;
            this._play(name, { gain: 0.25 + v * 0.5, rate: this._jitter(0.1), maxDur: 0.28 });
            return;
        }
        if (t - this._lastStep < 70) return;   // aşırı tetiklemeyi engelle
        this._lastStep = t;
        // Yedek: düşük frekanslı kısa gövde + çok kısa yüksek gürültü
        this._tone({ freq: 90 + v * 30, duration: 0.06, gain: 0.05 + v * 0.07, type: 'sine', slideTo: 55 });
        this._noiseBurst({ duration: 0.035, freq: 2600, q: 0.7, gain: 0.025 + v * 0.04, type: 'highpass' });
    }

    /** Dash/turbo fırlayışı (rocket/turbo item'ları). */
    playWhoosh(vol = 0.6) {
        this.ensure();
        if (!this.ctx) return;
        const v = Math.max(0.2, Math.min(1, vol));
        if (this._play('dash-whoosh-1', { gain: 0.35 + v * 0.45, rate: this._jitter(0.06) })) return;
        this._noiseBurst({ duration: 0.22, freq: 900 + v * 700, q: 0.9, gain: 0.1 + v * 0.14, type: 'bandpass' });
        this._tone({ freq: 320, duration: 0.18, gain: 0.05 + v * 0.06, type: 'sine', slideTo: 140 });
    }

    /** Eşya kutusu toplama çını (pozitif geri bildirim). */
    playPickup() {
        this.ensure();
        if (!this.ctx) return;
        if (this._play('item-pickup', { gain: 0.6 })) return;
        this._tone({ freq: 660, duration: 0.10, gain: 0.12, type: 'triangle', slideTo: 990 });
        this._tone({ freq: 990, duration: 0.14, gain: 0.10, type: 'sine', slideTo: 1320 });
    }

    /** Top yuvarlanma sesi BAŞLAT — loop örneği (yedek: filtreli gürültü); setRoll sürer. */
    startRoll() {
        this.ensure();
        if (!this.ctx || this._roll) return;
        const h = this._loop('ball-roll-loop', { gain: 0.0001 });
        if (h) { this._roll = { kind: 'sample', h }; return; }
        const t = this._now();
        const src = this.ctx.createBufferSource();
        src.buffer = this._noiseBuffer;
        src.loop = true;
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 320;
        const g = this.ctx.createGain();
        g.gain.value = 0.0001;
        src.connect(lp); lp.connect(g); g.connect(this.master);
        src.start(t);
        this._roll = { kind: 'synth', src, lp, g };
    }

    /** Top yuvarlanma seviyesi (0..1, en hızlı topun hızına göre) — yumuşak takip. */
    setRoll(level) {
        if (!this._roll) return;
        const t = this._now();
        const v = Math.max(0, Math.min(1, level));
        if (this._roll.kind === 'sample') {
            this._roll.h.g.gain.setTargetAtTime(v * 0.55, t, 0.08);
            this._roll.h.src.playbackRate.setTargetAtTime(0.85 + v * 0.35, t, 0.1);
            return;
        }
        this._roll.g.gain.setTargetAtTime(v * 0.10, t, 0.08);
        this._roll.lp.frequency.setTargetAtTime(220 + v * 460, t, 0.1);
    }

    /** Top yuvarlanma sesini DURDUR (söndür + kaynağı kapat). */
    stopRoll() {
        if (!this.ctx || !this._roll) return;
        const r = this._roll;
        this._roll = null;
        if (r.kind === 'sample') { r.h.stop(0.3); return; }
        const t = this._now();
        r.g.gain.cancelScheduledValues(t);
        r.g.gain.setTargetAtTime(0.0001, t, 0.12);
        setTimeout(() => { try { r.src.stop(); } catch (_) { /* yok say */ } }, 320);
    }

    // ---- Faz 10: 8-top "Final Evresi" gerilim drone'u ----

    /** Gerilim drone'u BAŞLAT — loop örneği (yedek: tremolo'lu alçak bas). */
    startTension() {
        this.ensure();
        if (!this.ctx || this._tensionNode) return;
        const h = this._loop('tension-loop', { gain: 0.42, fadeIn: 1.4 });
        if (h) { this._tensionNode = { kind: 'sample', h }; return; }
        const t = this._now();
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth'; osc.frequency.value = 55;
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 150;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.11, t + 1.4);
        // Tremolo (gerilim titreşimi): LFO → gain param'a EKLENİR.
        const lfo = this.ctx.createOscillator();
        lfo.type = 'sine'; lfo.frequency.value = 2.4;
        const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 0.045;
        lfo.connect(lfoGain); lfoGain.connect(g.gain);
        osc.connect(lp); lp.connect(g); g.connect(this.master);
        osc.start(t); lfo.start(t);
        this._tensionNode = { kind: 'synth', osc, lfo, g };
    }

    /** Gerilim drone'unu DURDUR (söndür + kaynakları kapat). */
    stopTension(release = 0.6) {
        if (!this.ctx || !this._tensionNode) return;
        const n = this._tensionNode;
        this._tensionNode = null;
        if (n.kind === 'sample') { n.h.stop(release); return; }
        const t = this._now();
        const { osc, lfo, g } = n;
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + release);
        osc.stop(t + release + 0.05);
        lfo.stop(t + release + 0.05);
    }

    // ---- Faz 13: mini-olay duyuru sesi ----

    /** Mini-olay başlangıç çını. variant ∈ 'ice' | 'heavy' | 'bouncy' | 'giant'. */
    playEventCue(variant = 'ice') {
        this.ensure();
        if (!this.ctx) return;
        if (this._play('event-' + variant, { gain: 0.7 })) return;
        // Yedek: prosedürel çınlar
        if (variant === 'giant') {
            this._tone({ freq: 90, duration: 0.7, gain: 0.34, type: 'sine', slideTo: 50 });
            this._tone({ freq: 140, duration: 0.5, gain: 0.18, type: 'triangle', slideTo: 60 });
            this._noiseBurst({ duration: 0.6, freq: 260, q: 0.4, gain: 0.16, type: 'lowpass' });
        } else if (variant === 'heavy') {
            this._tone({ freq: 220, duration: 0.4, gain: 0.22, type: 'triangle', slideTo: 70 });
            this._noiseBurst({ duration: 0.18, freq: 400, q: 0.5, gain: 0.14, type: 'lowpass' });
        } else if (variant === 'bouncy') {
            this._tone({ freq: 300, duration: 0.14, gain: 0.16, type: 'sine', slideTo: 720 });
            setTimeout(() => this._tone({ freq: 420, duration: 0.16, gain: 0.13, type: 'sine', slideTo: 980 }), 110);
        } else {
            this._tone({ freq: 1320, duration: 0.22, gain: 0.10, type: 'sine', slideTo: 1980 });
            this._noiseBurst({ duration: 0.3, freq: 6000, q: 0.6, gain: 0.05, type: 'highpass' });
        }
    }

    /** Win fanfare (örnek EKSİK — üretilince devreye girer; yedek: kısa arpej). */
    playWin() {
        this.ensure();
        if (!this.ctx) return;
        if (this._play('win-fanfare', { gain: 0.8 })) return;
        const notes = [523.25, 659.25, 783.99, 1046.5]; // C E G C
        notes.forEach((f, i) => {
            setTimeout(() => this._tone({ freq: f, duration: 0.22, gain: 0.25, type: 'triangle' }), i * 110);
        });
    }

    /** Kaybetme müziği (örnek EKSİK — üretilince devreye girer; yedeksiz = sessiz). */
    playLose() {
        this.ensure();
        this._play('lose-sting', { gain: 0.8 });
    }

    // ---- Sabotaj / item olayları (örnek-öncelikli; eski yer tutucular yedek) ----

    /** Muz tuzağı bırakma "plop"u. */
    playBananaDrop() {
        this.ensure();
        if (!this.ctx) return;
        if (this._play('banana-drop', { gain: 0.6 })) return;
        this.playUI('move');
    }

    /** Yay/ok fırlatma. */
    playBowShot() {
        this.ensure();
        if (!this.ctx) return;
        if (this._play('bow-shot', { gain: 0.7 })) return;
        this.playUI('confirm');
    }

    /** Kalkan açılışı. */
    playShieldUp() {
        this.ensure();
        if (!this.ctx) return;
        if (this._play('shield-up', { gain: 0.6 })) return;
        this.playUI('confirm');
    }

    /** Kalkan sönüşü (örnek EKSİK — üretilince devreye girer; yedeksiz = sessiz). */
    playShieldDown() {
        this.ensure();
        this._play('shield-down', { gain: 0.5 });
    }

    /** Body-check/devirme darbesi + gecikmeli yere düşüş. */
    playKnock() {
        this.ensure();
        if (!this.ctx) return;
        if (this._play('knock-impact-1', { gain: 0.8, rate: this._jitter(0.06) })) {
            setTimeout(() => this._play('body-fall', { gain: 0.55, rate: this._jitter(0.06) }), 280);
            return;
        }
        this.playClack(0.8);   // eski yer tutucu yedek
    }

    /** Muzda kayma (slip) + gecikmeli yere düşüş. */
    playSlip() {
        this.ensure();
        if (!this.ctx) return;
        if (this._play('banana-slip', { gain: 0.7 })) {
            setTimeout(() => this._play('body-fall', { gain: 0.5, rate: this._jitter(0.06) }), 380);
            return;
        }
        this.playClack(0.8);   // eski yer tutucu yedek
    }

    // ---- Kombo & Ultimate ----

    /** "COMBO xN" pop'u — N arttıkça pitch yükselir. */
    playCombo(n = 2) {
        this.ensure();
        this._play('combo-pop', { gain: 0.55, rate: 1 + Math.min(0.6, (n - 2) * 0.09) });
    }

    /** Ultimate barı doldu ("ULTI HAZIR"). */
    playUltiReady() {
        this.ensure();
        this._play('ulti-ready', { gain: 0.7 });
    }

    /** Şok Dalgası ultisi (EMP). */
    playShockwave() {
        this.ensure();
        if (!this.ctx) return;
        if (this._play('ulti-shockwave', { gain: 0.95 })) return;
        this.playExplosion();
    }

    /**
     * Enerji Dalgası — plazma topu şarjı. duration = BEAM.CHARGE (s): örnek (~2s)
     * hafif yavaşlatılır + kalan boşluk başa gecikme olur → şarj TEPESİ tam
     * ateşleme anına düşer.
     */
    playBeamCharge(duration = 3.5) {
        this.ensure();
        if (!this.ctx) return;
        const buf = this._buffers['beam-charge'];
        if (buf) {
            const rate = Math.max(0.75, Math.min(1.25, buf.duration / duration));
            const delay = Math.max(0, duration - buf.duration / rate);
            this._play('beam-charge', { gain: 0.8, rate, delay });
            return;
        }
        this.startHum();   // yedek: prosedürel yükselen drone (playBeamFire söndürür)
    }

    /** Enerji Dalgası — ateşleme + sürekli ışın. */
    playBeamFire() {
        this.ensure();
        if (!this.ctx) return;
        this.stopHum(0.1);   // yedek şarj drone'u çalıyorsa sustur
        if (this._play('beam-fire', { gain: 0.95 })) return;
        this.playExplosion();
    }

    // ---- UI/meta (bildirim + ödül ekranı) ----

    /** Faul/uyarı bildirimi vızıltısı. */
    playFoul(gain = 0.6) {
        this.ensure();
        this._play('foul-buzz', { gain });
    }

    /** Tehlike vurgusu (sabote edildin — kırmızı glow anı). */
    playDanger() {
        this.ensure();
        this._play('danger-sting', { gain: 0.7 });
    }

    /** Ödül ekranı: XP barı dolum süpürmesi. */
    playXpFill() {
        this.ensure();
        this._play('xp-fill', { gain: 0.5 });
    }

    /** Ödül ekranı: seviye atlama çını. */
    playLevelUp() {
        this.ensure();
        this._play('level-up', { gain: 0.75 });
    }

    // ---- Ana menü ambiyansı ----

    /**
     * Menü ambiyans loop'unu başlatmak İSTE. AudioContext jest gerektirdiğinden
     * hemen başlayamayabilir — istek bayrağı tutulur, ilk jestte (ensure→resume)
     * veya buffer decode olunca kendiliğinden başlar. İdempotent.
     */
    startAmbience() {
        this._ambienceWanted = true;
        this.ensure();
        this._tryAmbience();
    }

    _tryAmbience() {
        if (!this._ambienceWanted || this._ambience) return;
        if (!this._enabled || !this.ctx || this.ctx.state !== 'running') return;
        const h = this._loop('menu-ambience-loop', { gain: 0.3, fadeIn: 1.5 });
        if (h) this._ambience = h;
    }

    stopAmbience() {
        this._ambienceWanted = false;
        if (this._ambience) { this._ambience.stop(0.8); this._ambience = null; }
    }
}
