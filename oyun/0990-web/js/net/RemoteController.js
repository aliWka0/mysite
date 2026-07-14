// ============================================
// RemoteController — host tarafında uzaktaki oyuncuyu (istemci) sürer
// ============================================
// BotController ile AYNI yüzeyi sunar (`moveInput`, `forward`) → host'un oyun
// döngüsü botu bununla değiştirebilir: players[2].update(dt, rc.moveInput, rc.forward).
// Fark: kararları AI değil, ağdan gelen istemci girdisi üretir (NetSession.onInput).
// Atış/item olayları "mandal" (latch) olarak tutulur; host döngüsü her kare tüketir.
import * as THREE from 'three';

export class RemoteController {
    constructor() {
        this.moveInput = { x: 0, y: 0 };
        this.forward = new THREE.Vector3(0, 0, 1);
        this._pendingShoot = null;   // {aim, power} | null
        this._pendingItem = null;    // {role} | null  (N2)
        this._pendingShield = false; // (N2)
        this._lastInputAt = 0;       // bağlantı sağlığı (gerekirse)
    }

    /** NetSession.onInput → her kare girdi (mv: joystick, fwd: kamera ileri XZ). */
    applyInput(obj) {
        if (obj.mv) { this.moveInput.x = obj.mv[0] || 0; this.moveInput.y = obj.mv[1] || 0; }
        if (obj.fwd) {
            const x = obj.fwd[0], z = obj.fwd[1];
            if (Math.hypot(x, z) > 1e-4) this.forward.set(x, 0, z).normalize();
        }
        this._lastInputAt = performance.now();
    }

    /** NetSession.onShoot → istemci kendi sırasında atışı bıraktı. */
    queueShoot(obj) { this._pendingShoot = { aim: obj.aim || 0, power: obj.power || 0.5 }; }
    queueItem(obj) { this._pendingItem = { role: obj.role || 'saboteur' }; }       // N2
    queueShield() { this._pendingShield = true; }                                  // N2

    /** Host döngüsü her kare: bekleyen atış varsa al (ve temizle). */
    consumeShoot() { const s = this._pendingShoot; this._pendingShoot = null; return s; }
    consumeItem() { const i = this._pendingItem; this._pendingItem = null; return i; }   // N2
    consumeShield() { const s = this._pendingShield; this._pendingShield = false; return s; } // N2

    /** Tur/kontrol devri: hareketi sıfırla (istemci durunca karakter kaymasın). */
    reset() {
        this.moveInput = { x: 0, y: 0 };
        this._pendingShoot = null;
        this._pendingItem = null;
        this._pendingShield = false;
    }
}
