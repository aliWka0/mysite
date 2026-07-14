// ============================================
// ItemBoxManager — Eşya kutusu orkestrasyonu (Faz 2)
// ============================================
// Sabit doğuş noktalarında kutular yaratır; her kare animasyon + toplama (overlap)
// + yeniden doğma yönetir. Toplayan oyuncuya ItemSystem üzerinden rastgele item verir
// (yalnız slotu boşsa). Drop havuzu yalnız ITEM_DEFS'te TANIMLI item'lardan kurulur →
// yeni item ekledikçe (Faz 3/4) otomatik katılır.
import { ITEMBOX, ITEM_DROP_TABLE, MOMENTUM } from '../constants.js';
import { ITEM_DEFS } from './ItemSystem.js';
import { ItemBox } from '../scene/ItemBox.js';

export class ItemBoxManager {
    constructor({ scene, itemSystem, particles, sound, onPickup, getBehind } = {}) {
        this.itemSystem = itemSystem;
        this.particles = particles || null;
        this.sound = sound || null;
        this.onPickup = onPickup || null;   // (playerNum, itemId) → toplama geri bildirimi (UI)
        this.getBehind = getBehind || null; // (playerNum) => 0..1 — momentum (geride olma faktörü)

        this.boxes = ITEMBOX.SPAWN_POINTS.map((p) => new ItemBox(scene, p.x, p.z));

        // Ağırlıklı havuz: yalnız tanımlı item'lar (id ITEM_DEFS'te varsa).
        this._pool = Object.entries(ITEM_DROP_TABLE)
            .filter(([id]) => ITEM_DEFS[id])
            .map(([id, w]) => ({ id, w }));
        this._totalW = this._pool.reduce((s, e) => s + e.w, 0);
    }

    /** vsbot açık/kapalı: kutuları göster/gizle. */
    setShown(shown) {
        for (const b of this.boxes) b.setShown(shown);
    }

    /** Maç/restart: tüm kutuları yeniden doğur. */
    reset() {
        for (const b of this.boxes) b.activate();
    }

    /**
     * Her kare (oyun içi). players = sürülen Player'lar; üstünden geçen toplar.
     */
    update(dt, players) {
        for (const box of this.boxes) {
            box.update(dt);
            if (!box.active || !box._shown) continue;

            for (const p of players) {
                if (!p || p.isRagdoll) continue;
                const dx = p.mesh.position.x - box.x;
                const dz = p.mesh.position.z - box.z;
                if (Math.hypot(dx, dz) > ITEMBOX.PICKUP_RADIUS) continue;

                // Slotu boşsa item ver; doluysa kutu durur (başka oyuncuya kalır).
                const itemId = this._roll(p.owner);
                if (itemId && this.itemSystem.pickup(p.owner, itemId)) {
                    box.collect();
                    this._pickupFx(box.x, box.z);
                    if (this.onPickup) this.onPickup(p.owner, itemId);
                }
                break;  // bu kutu için bir oyuncu yeter
            }
        }
    }

    /** Bottun aradığı en yakın AKTİF kutu (sabotaj rolünde item toplamak için). */
    getNearestActiveBox(x, z) {
        let best = null, bd = Infinity;
        for (const b of this.boxes) {
            if (!b.active || !b._shown) continue;
            const d = Math.hypot(b.x - x, b.z - z);
            if (d < bd) { bd = d; best = b; }
        }
        return best ? { x: best.x, z: best.z } : null;
    }

    // ---- iç ----

    /**
     * Ağırlıklı rastgele item id (havuz boşsa null). Faz 5 momentum: toplayan oyuncu
     * geride ise (`getBehind` 0..1) güçlü item'lerin (`MOMENTUM.STRONG`) ağırlığı
     * orantılı artar → underdog daha sık güçlü item görür (simetrik, lastik-bant).
     */
    _roll(num) {
        if (!this._pool.length) return null;
        const behind = (MOMENTUM.ENABLED && this.getBehind && num != null) ? this.getBehind(num) : 0;
        if (behind <= 0) {
            let r = Math.random() * this._totalW;
            for (const e of this._pool) { r -= e.w; if (r <= 0) return e.id; }
            return this._pool[0].id;
        }
        const boost = 1 + behind * (MOMENTUM.MAX_BOOST - 1);
        let total = 0;
        const weights = this._pool.map((e) => {
            const w = MOMENTUM.STRONG.includes(e.id) ? e.w * boost : e.w;
            total += w;
            return w;
        });
        let r = Math.random() * total;
        for (let i = 0; i < this._pool.length; i++) { r -= weights[i]; if (r <= 0) return this._pool[i].id; }
        return this._pool[0].id;
    }

    _pickupFx(x, z) {
        if (this.particles) {
            try { this.particles.createFirework({ x, y: 0.80 + ITEMBOX.HEIGHT, z }, ITEMBOX.COLOR); }
            catch (_) { /* yok say */ }
        }
        // Toplama çını main.js onItemPickup'ta çalar (playPickup, yalnız insan) —
        // buradaki eski playUI('confirm') yer tutucusu kaldırıldı (çift ses olmasın).
    }
}
