// ============================================
// BotController — Yapay zeka rakip (M1: bilardo AI)
// ============================================
// Botun sırasında karakteri cue topun arkasına yürütür, ghost-ball ile hedef
// top→cep nişanı hesaplar ve atışı tetikler. Karakteri DOĞRUDAN sürmez; her kare
// bir moveInput/forward üretir, main.js bunları botPlayer.update'e besler (tek
// güncelleme yolu → animasyon donmaz). Atış anı `onShoot(aimAngle, power)` ile
// main'deki ortak `commitShot`'a gider. Sabotaj AI'ı M2'de eklenecek.
//
// aimAngle konvansiyonu: XZ düzleminde atan2(z, x) — impuls (cos a, 0, sin a)
// yönünde gider (bkz. ShotManager.calculateImpulse).
import * as THREE from 'three';
import { BALL, BOT } from '../constants.js';

export class BotController {
    constructor({ gameManager, ballPhysics, pocketDetector, onShoot, onUseItem, getItem, getNearestBox }) {
        this.gm = gameManager;
        this.ballPhysics = ballPhysics;
        this.pockets = pocketDetector.pockets;
        this.onShoot = onShoot;            // (aimAngle, power) => void
        this.onUseItem = onUseItem || null;// () => void — slottaki item'i kullan (sabotaj rolü)
        this.getItem = getItem || null;    // (num) => itemDef|null — botun slotundaki item tanımı (aiMode okunur)
        this.getNearestBox = getNearestBox || null; // (x,z) => {x,z}|null — en yakın aktif kutu

        this.role = 'idle';                // idle | billiards | sabotage
        this.player = null;                // botun Player'ı
        this.target = null;                // sabotaj hedefi (insan nişancı)
        this.phase = 'idle';               // billiards alt-durumu: think|approach|settle|shoot
        this.timer = 0;
        this.trapTimer = 0;
        this.plan = null;
        this._needReplan = false;          // devrildikten sonra yeniden planla
        this._saboBackoff = 0;             // kurbanı devirdikten sonra geri çekilme sayacı

        // main.js her kare okur:
        this.moveInput = { x: 0, y: 0 };
        this.forward = new THREE.Vector3(0, 0, 1);
    }

    /** Bilardo sırası: atış planla, yürümeye geç. */
    startBilliards(botPlayer) {
        this.role = 'billiards';
        this.player = botPlayer;
        this.plan = this._planShot();
        this.phase = 'think';
        this.timer = 0;
        this._needReplan = false;
    }

    /** Sabotaj rolü: insan nişancıyı kovala + ara sıra tuzak bırak (dengeli). */
    startSabotage(botPlayer, target) {
        this.role = 'sabotage';
        this.player = botPlayer;
        this.target = target;
        this.trapTimer = BOT.SABO_TRAP_INTERVAL;
        this._saboBackoff = 0;
        this._targetWasRagdoll = false;
        this.moveInput = { x: 0, y: 0 };
    }

    stop() {
        this.role = 'idle';
        this.phase = 'idle';
        this.player = null;
        this.target = null;
        this.moveInput = { x: 0, y: 0 };
    }

    /**
     * Her karede (vsbot, sabotaj penceresi) çağrılır. moveInput/forward'ı günceller,
     * sırası gelince onShoot/onUseItem'i tetikler. player.update'i ÇAĞIRMAZ.
     */
    update(dt) {
        this.moveInput = { x: 0, y: 0 };
        if (!this.player) return;
        if (this.role === 'billiards') this._updateBilliards(dt);
        else if (this.role === 'sabotage') this._updateSabotage(dt);
    }

    _updateBilliards(dt) {
        if (!this.plan) return;
        // Sabotaja uğrayıp devrildiyse → dur; kalkınca yeniden planla.
        if (this.player.isRagdoll) { this._needReplan = true; return; }
        if (this._needReplan) {
            this.plan = this._planShot();
            this.phase = 'think';
            this.timer = 0;
            this._needReplan = false;
        }

        const botPos = this.player.mesh.position;

        if (this.phase === 'think') {
            this.timer += dt;
            if (this.timer >= BOT.THINK_DELAY) { this.phase = 'approach'; this.timer = 0; }
            return;
        }

        if (this.phase === 'approach') {
            const sx = this.plan.stand.x - botPos.x;
            const sz = this.plan.stand.z - botPos.z;
            const d = Math.hypot(sx, sz);
            this.timer += dt;
            if (d < BOT.KICK_RANGE || this.timer >= BOT.APPROACH_TIMEOUT) {
                this.phase = 'settle'; this.timer = 0;
                return;
            }
            this.forward.set(sx, 0, sz).normalize();
            this.moveInput = { x: 0, y: BOT.APPROACH_MAG };
            return;
        }

        if (this.phase === 'settle') {
            // aim yönüne dön (kickAnimation da çevirir; erken dönmek doğal görünür)
            this.player.mesh.rotation.y = this.plan.aimAngle + Math.PI / 2;
            this.timer += dt;
            if (this.timer >= BOT.SETTLE_DELAY) this.phase = 'shoot';
            return;
        }

        if (this.phase === 'shoot') {
            this.phase = 'idle';
            this.role = 'idle';   // atış yapıldı → boşa geç (tur sonucu beklenecek)
            if (this.onShoot) this.onShoot(this.plan.aimAngle, this.plan.power);
            return;
        }
    }

    // Dengeli sabotaj: yalnız nişancı atış yapmaya çalışırken (cue topa yakın) bastır;
    // devirdikten sonra geri çekil (üst üste vurma); enerji yoksa mesafede bekle.
    _updateSabotage(dt) {
        const me = this.player, target = this.target;
        this.moveInput = { x: 0, y: 0 };
        if (!target || me.isRagdoll) return;

        // Kurban devrildiyse: üstüne gitme, geri çekilmeyi başlat.
        if (target.isRagdoll) {
            this._targetWasRagdoll = true;
            this._saboBackoff = BOT.SABO_BACKOFF;
            this._retreat(target);
            return;
        }
        // Kurban yeni kalktı → kısa süre geri çekil (pencere ver).
        if (this._saboBackoff > 0) {
            this._saboBackoff -= dt;
            this._retreat(target);
            return;
        }
        this._targetWasRagdoll = false;

        const me2 = me.mesh.position;
        const tp = target.mesh.position;
        const dTar = Math.hypot(tp.x - me2.x, tp.z - me2.z);
        const def = this.getItem ? this.getItem(me.owner) : null;
        const aiMode = def && def.aiMode ? def.aiMode : null;  // yalnız SALDIRI item'larında var

        // Saldırı item'ı YOK → boş slot ise en yakın kutuya koş; elinde KALKAN (savunma)
        // varsa kendi sırasına sakla (harcama) ve orta mesafede gez.
        if (!aiMode) {
            if (!def) {
                const box = this.getNearestBox ? this.getNearestBox(me2.x, me2.z) : null;
                if (box) { this._steerTo(box.x, box.z, BOT.SABO_MAG); return; }
            }
            if (dTar > BOT.SABO_KEEP_DIST) this._steerTo(tp.x, tp.z, 0.35);
            return;
        }

        const cfg = BOT.ITEM_AI[aiMode] || BOT.ITEM_AI.melee;

        // Menzilli (yay/bomba): yapışmaya gerek yok — uygun mesafeyi koru, hedefe dönüp fırlat.
        if (aiMode === 'ranged') {
            if (dTar > cfg.useRange) {
                this._steerTo(tp.x, tp.z, cfg.approachMag);          // uzaksa biraz yaklaş
            } else if (dTar < (cfg.minRange || 0)) {
                this._retreat(target);                               // çok yakın → bir adım aç
            } else {
                this._faceTarget(target);                            // iyi mesafe → dön, bekle
            }
            this.trapTimer -= dt;
            if (this.trapTimer <= 0 && dTar <= cfg.useRange && this.onUseItem) {
                this._faceTarget(target);   // bomba bu yöne yuvarlanır; yay homing
                this.onUseItem();
                this.trapTimer = BOT.SABO_TRAP_INTERVAL;
            }
            return;
        }

        // Yakın dövüş / tuzak (dash/turbo/muz): nişancı cue topa yakınken bastır + yapışınca kullan.
        if (this._shooterNearCue(target)) {
            this._steerTo(tp.x, tp.z, cfg.approachMag);
            this.trapTimer -= dt;
            if (this.trapTimer <= 0 && dTar < cfg.useRange && this.onUseItem) {
                this.onUseItem();   // muz → yoluna bırak; dash/turbo → üstüne lunge
                this.trapTimer = BOT.SABO_TRAP_INTERVAL;
            }
        } else if (dTar > BOT.SABO_KEEP_DIST) {
            this._steerTo(tp.x, tp.z, 0.35);
        }
    }

    /** Bir noktaya doğru yönel + ilerle (forward = hedef yönü). */
    _steerTo(x, z, mag) {
        const fx = x - this.player.mesh.position.x;
        const fz = z - this.player.mesh.position.z;
        if (Math.hypot(fx, fz) > 1e-4) this.forward.set(fx, 0, fz).normalize();
        this.moveInput = { x: 0, y: mag };
    }

    /** Yerinde dur, yalnız hedefe DÖN (menzilli item'i nişanlamak için; moveInput 0 kalır). */
    _faceTarget(target) {
        const fx = target.mesh.position.x - this.player.mesh.position.x;
        const fz = target.mesh.position.z - this.player.mesh.position.z;
        if (Math.hypot(fx, fz) > 1e-4) this.forward.set(fx, 0, fz).normalize();
    }

    /** Hedeften uzağa yürü (devirme sonrası pencere ver). */
    _retreat(target) {
        const ax = this.player.mesh.position.x - target.mesh.position.x;
        const az = this.player.mesh.position.z - target.mesh.position.z;
        if (Math.hypot(ax, az) > 1e-4) this.forward.set(ax, 0, az).normalize();
        this.moveInput = { x: 0, y: 0.6 };
    }

    /** Nişancı cue topa yakın mı? (atış yapmaya çalışıyor → bastırmaya değer) */
    _shooterNearCue(target) {
        const cue = this.ballPhysics.getPositions().get(0);
        if (!cue) return true;
        const d = Math.hypot(target.mesh.position.x - cue.x, target.mesh.position.z - cue.z);
        return d < BOT.SABO_PRESS_CUE_NEAR;
    }

    /** Hedef top + cep seç, ghost-ball ile aimAngle/güç/duruş noktası hesapla. */
    _planShot() {
        const positions = this.ballPhysics.getPositions();
        const cue = positions.get(0);
        const R = BALL.RADIUS;
        if (!cue) return { aimAngle: 0, power: 0.6, stand: { x: 0, z: 0 } };

        const cueV = new THREE.Vector2(cue.x, cue.z);
        const targets = this.gm.getValidTargetBalls().filter((id) => positions.has(id));

        let best = null;
        for (const id of targets) {
            const tp = positions.get(id);
            const tV = new THREE.Vector2(tp.x, tp.z);
            for (const pk of this.pockets) {
                const pV = new THREE.Vector2(pk.x, pk.z);
                const tToP = pV.clone().sub(tV);
                const tToPLen = tToP.length();
                if (tToPLen < 1e-4) continue;
                tToP.normalize();
                // Ghost top: cue'nun temas anındaki merkezi — hedefin cebin TERSİ
                // tarafında, 2R uzakta.
                const ghost = tV.clone().sub(tToP.clone().multiplyScalar(2 * R));
                const aim = ghost.clone().sub(cueV);
                const aimLen = aim.length();
                if (aimLen < 1e-4) continue;
                aim.normalize();
                // Kesim hizası: cue geliş yönü ile topun gideceği yön (1=düz, 0=90°).
                const align = aim.dot(tToP);
                if (align < 0.25) continue;              // çok ince kesim → atla
                const score = (aimLen + tToPLen) / Math.max(0.2, align);  // düşük=iyi
                if (!best || score < best.score) best = { score, aim, aimLen, tToPLen };
            }
        }

        let aimDir, totalDist;
        if (best) {
            aimDir = best.aim;
            totalDist = best.aimLen + best.tToPLen;
        } else if (targets.length) {
            // Makul atış yok → en yakın hedefe düz nişan (en azından temas, faul olmasın).
            let nearest = null, nd = Infinity;
            for (const id of targets) {
                const tp = positions.get(id);
                const dd = Math.hypot(tp.x - cue.x, tp.z - cue.z);
                if (dd < nd) { nd = dd; nearest = tp; }
            }
            aimDir = new THREE.Vector2(nearest.x - cue.x, nearest.z - cue.z).normalize();
            totalDist = nd;
        } else {
            // Hiç hedef yok (olmamalı) → masa merkezine orta güç.
            aimDir = new THREE.Vector2(-cue.x, -cue.z);
            if (aimDir.length() < 1e-4) aimDir.set(1, 0);
            aimDir.normalize();
            totalDist = 0.8;
        }

        let aimAngle = Math.atan2(aimDir.y, aimDir.x);          // (x, z) düzleminde açı
        aimAngle += (Math.random() - 0.5) * 2 * BOT.AIM_ERROR;  // zorluk gürültüsü

        const tNorm = Math.min(1, totalDist / 1.6);
        const power = BOT.MIN_POWER + tNorm * (BOT.MAX_POWER - BOT.MIN_POWER);

        const stand = {
            x: cue.x - Math.cos(aimAngle) * BOT.STAND_OFFSET,
            z: cue.z - Math.sin(aimAngle) * BOT.STAND_OFFSET,
        };

        return { aimAngle, power, stand };
    }
}
