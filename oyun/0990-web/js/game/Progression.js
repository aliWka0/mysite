// ============================================
// Progression — yerel ilerleme: XP / coin / seviye (Faz 15)
// ============================================
// Backend YOK: her şey localStorage'da (Settings deseni; Capacitor WebView'da da
// çalışır). Maç boyunca YEREL İNSANIN (P1) olayları sayılır (pot/knock/pickup/ulti),
// maç bitince finishMatch() XP+coin'i hesaplar, kalıcılaştırır ve ödül ekranının
// çizeceği ÖZETİ döndürür (breakdown satırları + seviye barı animasyon verisi).
//
//   progression.beginMatch(1);          // startGame'de (izlenen oyuncu = P1)
//   progression.addEvent(num, 'pot');   // combo kancalarıyla aynı yerlerden
//   const rewards = progression.finishMatch(humanWon);  // TEK SEFER (idempotent)
//
// Para asla güç vermez — ilerleme gelecekte kozmetik/unlock (Faz 16 skin) açar.
// ============================================
import { PROGRESSION } from '../constants.js';

const KEY = 'pool3d.progress.v1';

const DEFAULTS = {
    xp: 0,
    coins: 0,
    wins: 0,
    matches: 0,
};

export class Progression {
    constructor() {
        this.data = { ...DEFAULTS, ...this._load() };
        this._match = null;   // aktif maç sayaçları | null
    }

    _load() {
        try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
        catch (_) { return {}; }
    }

    _save() {
        try { localStorage.setItem(KEY, JSON.stringify(this.data)); }
        catch (_) { /* private mode — bellek içi devam */ }
    }

    // ---- Seviye eğrisi ----

    /** n → n+1 seviyesi için gereken XP. */
    xpForLevel(n) {
        return PROGRESSION.LEVEL_BASE + (n - 1) * PROGRESSION.LEVEL_STEP;
    }

    /** Toplam XP'den {level, into (seviye içi XP), need (sonraki seviye eşiği)}. */
    levelInfo(totalXp) {
        let level = 1, rest = totalXp;
        while (rest >= this.xpForLevel(level)) {
            rest -= this.xpForLevel(level);
            level++;
        }
        return { level, into: rest, need: this.xpForLevel(level) };
    }

    get level() { return this.levelInfo(this.data.xp).level; }
    get coins() { return this.data.coins; }
    get xp() { return this.data.xp; }

    // ---- Maç takibi ----

    /** Maç başında çağır: izlenen oyuncunun (yerel insan = P1) sayaçlarını sıfırla. */
    beginMatch(trackNum = 1) {
        this._match = { num: trackNum, pot: 0, knock: 0, pickup: 0, ultimate: 0 };
    }

    /** Combo kancalarıyla aynı yerlerden beslenir; yalnız izlenen oyuncu sayılır. */
    addEvent(num, type) {
        if (!this._match || num !== this._match.num) return;
        if (type in this._match) this._match[type]++;
    }

    /**
     * Maç bitti: XP+coin hesapla, kalıcılaştır, ödül özetini döndür. İDEMPOTENT —
     * ikinci çağrı null döner (iki game-over yolu birden tetiklenirse çift ödül olmaz).
     * @param {boolean} won  yerel insan kazandı mı
     */
    finishMatch(won) {
        if (!this._match) return null;
        const m = this._match;
        this._match = null;

        const X = PROGRESSION.XP, C = PROGRESSION.COIN;
        const breakdown = [];
        let xpGain = won ? X.win : X.loss;
        breakdown.push({ label: won ? 'Galibiyet' : 'Maç tamamlandı', count: 0, xp: xpGain });
        if (m.pot) breakdown.push({ label: 'Sokulan top', count: m.pot, xp: m.pot * X.pot });
        if (m.knock) breakdown.push({ label: 'Devirme', count: m.knock, xp: m.knock * X.knock });
        if (m.pickup) breakdown.push({ label: 'Kutu', count: m.pickup, xp: m.pickup * X.pickup });
        if (m.ultimate) breakdown.push({ label: 'Ultimate', count: m.ultimate, xp: m.ultimate * X.ultimate });
        xpGain = breakdown.reduce((s, b) => s + b.xp, 0);

        const coinGain = (won ? C.win : C.loss) + m.pot * C.pot + m.knock * C.knock;

        const before = this.levelInfo(this.data.xp);
        this.data.xp += xpGain;
        this.data.coins += coinGain;
        this.data.matches += 1;
        if (won) this.data.wins += 1;
        this._save();
        const after = this.levelInfo(this.data.xp);

        return {
            won, xpGain, coinGain, breakdown,
            coinsTotal: this.data.coins,
            bar: {
                levelBefore: before.level,
                levelAfter: after.level,
                fromFrac: before.into / before.need,
                toFrac: after.into / after.need,
            },
        };
    }
}
