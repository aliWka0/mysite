// ============================================
// ComboSystem — Kombo zinciri → Ultimate enerjisi (Faz 6)
// ============================================
// Aksiyon olayları (top sok / rakibi devir / kutu al) bir kombo sayacını artırır;
// her olay ultimate enerjisini doldurur (çarpan kombo kademesiyle büyür). Kombo
// penceresi (COMBO.WINDOW) içinde yeni olay zinciri sürdürür; pencere dolunca kombo
// SIFIRLANIR ama enerji KALIR (ultimate meta-kaynağı, maç boyu birikir). Faz 7 ultimate'ı
// `consumeUlt` ile harcar. Veri-güdümlü: olay ağırlıkları/çarpan `constants.js COMBO`.
import { COMBO } from '../constants.js';

export class ComboSystem {
    constructor() {
        this.combo = { 1: 0, 2: 0 };    // ardışık aksiyon sayacı (pencere içinde)
        this.timer = { 1: 0, 2: 0 };    // kombo penceresi geri sayımı (s)
        this.energy = { 1: 0, 2: 0 };   // ultimate enerjisi 0..1
        this._pop = { 1: 0, 2: 0 };     // HUD pop'u: son olaydaki kombo sayısı (HUD tüketir)
    }

    /**
     * Aksiyon olayı işle. kind ∈ 'pot' | 'knock' | 'pickup'. Verilen oyuncuya kombo
     * + (çarpanlı) enerji ekler. Bilinmeyen/0 ağırlıklı olay yok sayılır.
     */
    addEvent(num, kind) {
        if (num !== 1 && num !== 2) return;
        const w = COMBO.WEIGHTS[kind] || 0;
        if (w <= 0) return;
        // Pencere açıksa zinciri sürdür; kapalıysa 1'den başla.
        this.combo[num] = (this.timer[num] > 0 ? this.combo[num] : 0) + 1;
        this.timer[num] = COMBO.WINDOW;
        const mult = Math.min(COMBO.MAX_MULT, 1 + (this.combo[num] - 1) * COMBO.MULT_STEP);
        this.energy[num] = Math.min(1, this.energy[num] + w * mult);
        this._pop[num] = this.combo[num];
    }

    /** Her kare: kombo pencerelerini ilerlet (dolunca kombo sıfırla, enerji KORUNUR). */
    update(dt) {
        for (const n of [1, 2]) {
            if (this.timer[n] > 0) {
                this.timer[n] -= dt;
                if (this.timer[n] <= 0) { this.timer[n] = 0; this.combo[n] = 0; }
            }
        }
    }

    getCombo(num) { return this.combo[num] || 0; }
    getEnergy(num) { return this.energy[num] || 0; }
    /** Kombo penceresi kalan oran (0..1) — HUD halka/ipucu için. */
    getComboFrac(num) { return this.timer[num] > 0 ? this.timer[num] / COMBO.WINDOW : 0; }
    isUltReady(num) { return this.energy[num] >= 1; }

    /** Faz 7: ultimate kullanılınca enerjiyi boşalt (dolu değilse reddet). */
    consumeUlt(num) {
        if (this.energy[num] < 1) return false;
        this.energy[num] = 0;
        this.combo[num] = 0; this.timer[num] = 0;
        return true;
    }

    /** HUD: yeni "xN" pop'u var mı? Varsa kombo sayısını döndürür + tüketir (0 = yok). */
    consumePop(num) { const p = this._pop[num]; this._pop[num] = 0; return p; }

    /** Maç/restart: hepsini sıfırla. */
    reset() {
        this.combo = { 1: 0, 2: 0 };
        this.timer = { 1: 0, 2: 0 };
        this.energy = { 1: 0, 2: 0 };
        this._pop = { 1: 0, 2: 0 };
    }
}
