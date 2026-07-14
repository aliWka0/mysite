// ============================================
// Projectile — Homing menzilli mermi (Faz 4: yay/ok item'ı)
// ============================================
// Masa düzleminde kinematik ilerleyen küçük parlak küre. Sabotajcı fırlatır;
// nişancıyı OTOMATİK TAKİP eder (homing) ama dönüş hızı sınırlı + ömrü kısa (3 sn),
// böylece nişancı kaçabilir → adil. SabotageManager listede tutar, her kare update +
// isabet testi yapar (knock SabotageManager'da, tuzak/çarpma ile ortak).
// Cannon gövdesi YOK — yerçekimsiz, elle sürülür (özel fizikle uyumlu + perf-dostu).
import * as THREE from 'three';
import { TABLE, PROJECTILE } from '../constants.js';

export class Projectile {
    /**
     * @param {THREE.Scene} scene
     * @param {ParticleSystem|null} particles - iz parıltısı için (opsiyonel)
     * @param {number} x @param {number} z - çıkış konumu (sabotajcı ayağı)
     * @param {Player|null} target - takip edilecek nişancı (homing hedefi)
     * @param {number} owner - fırlatan oyuncu no (kendine değmesin)
     */
    constructor(scene, particles, x, z, target, owner) {
        this.scene = scene;
        this.particles = particles || null;
        this.target = target || null;
        this.owner = owner;
        this.x = x;
        this.z = z;
        this.life = PROJECTILE.LIFETIME;
        this.y = TABLE.HEIGHT + 0.02;
        this._trailT = 0;

        // Başlangıç yönü: hedefe doğru (yoksa +X).
        let ang = 0;
        if (target) ang = Math.atan2(target.mesh.position.z - z, target.mesh.position.x - x);
        this.angle = ang;
        this.dirX = Math.cos(ang);
        this.dirZ = Math.sin(ang);

        const geom = new THREE.SphereGeometry(PROJECTILE.RADIUS, 12, 10);
        const mat = new THREE.MeshBasicMaterial({ color: PROJECTILE.COLOR });
        this.mesh = new THREE.Mesh(geom, mat);
        this.mesh.position.set(x, this.y, z);
        this.mesh.renderOrder = 2;
        scene.add(this.mesh);
    }

    update(dt) {
        this.life -= dt;

        // Homing: mevcut yönü hedefe doğru SINIRLI hızla çevir (kaçılabilir kalsın).
        if (this.target && !this.target.isRagdoll) {
            const desired = Math.atan2(
                this.target.mesh.position.z - this.z,
                this.target.mesh.position.x - this.x,
            );
            let d = desired - this.angle;
            while (d > Math.PI) d -= Math.PI * 2;     // en kısa yöne sar
            while (d < -Math.PI) d += Math.PI * 2;
            const maxTurn = PROJECTILE.TURN_RATE * dt;
            this.angle += Math.max(-maxTurn, Math.min(maxTurn, d));
            this.dirX = Math.cos(this.angle);
            this.dirZ = Math.sin(this.angle);
        }

        this.x += this.dirX * PROJECTILE.SPEED * dt;
        this.z += this.dirZ * PROJECTILE.SPEED * dt;
        this.mesh.position.set(this.x, this.y, this.z);
        this.mesh.rotation.y += dt * 12;

        // İz parıltısı (kuyruk) — ~0.04 sn'de bir küçük spark.
        this._trailT += dt;
        if (this.particles && this._trailT >= 0.04) {
            this._trailT = 0;
            this.particles.createSpark({ x: this.x, y: this.y, z: this.z }, PROJECTILE.COLOR);
        }
    }

    dispose() {
        this.scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
    }
}
