// ============================================
// GiantBall — Dev Top mini olayı (Faz 13b)
// ============================================
// Masanın bir kısa kenarından girip diğerine YUVARLANAN kinematik DEV küre. Geçerken
// bilardo toplarını (grup-1) fiziksel olarak iter → masa dağılır (Mario Kart kaosu).
// KİNEMATİK (mass 0, sabit hız): yerçekimsiz dünyada y'si sabit kalır, world.step ile
// x'te ilerler ve değdiği DİNAMİK topları savurur (ballMaterial teması). Kasa/bant gibi
// statik gövdelerle çözülmez → raylardan serbest geçer (dışarıdan girer). Karakterlerle
// ÇARPIŞMAZ (grup-1/mask-1) → tur/ragdoll mekaniğini bozmaz; yalnız top dağıtıcı.
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { TABLE, EVENTS } from '../constants.js';

export class GiantBall {
    constructor(scene, physicsWorld) {
        this.scene = scene;
        this.physicsWorld = physicsWorld;
        const R = EVENTS.GIANT.RADIUS;
        this.R = R;

        const hl = TABLE.LENGTH / 2;
        this.startX = -hl - R - 0.08;        // sol kısa raylın hemen dışı
        this.exitX = hl + R + 0.08;          // sağ kısa raylın hemen dışı
        const y = TABLE.HEIGHT + R;          // masa üstünde yuvarlanır

        // Kinematik fizik gövdesi: topları iten asıl unsur. ballMaterial → mevcut
        // ballBall temas materyali (restitution 0.4) geçerli. grup-1/mask-1: yalnız
        // toplar/masa/bant ile filtrelenir, karakterlerle (grup-2/4) ÇARPIŞMAZ.
        this.body = new CANNON.Body({
            type: CANNON.Body.KINEMATIC,
            mass: 0,
            material: physicsWorld.ballMaterial,
            shape: new CANNON.Sphere(R),
            position: new CANNON.Vec3(this.startX, y, 0),
            collisionFilterGroup: 1,
            collisionFilterMask: 1,
            linearDamping: 0,   // sabit hız (kinematik gövdeye de damping uygulanır → kapat)
        });
        this.body.velocity.set(EVENTS.GIANT.SPEED, 0, 0);
        physicsWorld.addBody(this.body);
        this._bodyRemoved = false;

        // Görsel: parlayan yarı saydam altın küre.
        const geom = new THREE.SphereGeometry(R, 28, 20);
        const mat = new THREE.MeshStandardMaterial({
            color: EVENTS.GIANT.COLOR,
            emissive: EVENTS.GIANT.COLOR,
            emissiveIntensity: 0.45,
            roughness: 0.3,
            metalness: 0.15,
            transparent: true,
            opacity: 0.92,
        });
        this.mesh = new THREE.Mesh(geom, mat);
        this.mesh.position.set(this.startX, y, 0);
        this.mesh.castShadow = true;
        scene.add(this.mesh);
    }

    /** Mesh'i gövdeye senkronla + yuvarlanma dönüşü. Masadan ÇIKTI mı döndürür. */
    update(dt) {
        if (this._bodyRemoved) return true;
        const p = this.body.position;
        this.mesh.position.set(p.x, p.y, p.z);
        this.mesh.rotation.z -= (EVENTS.GIANT.SPEED / this.R) * dt;   // yuvarlanma görseli
        return p.x > this.exitX;
    }

    /** Gövdeyi dünyadan çıkar (topları itmeyi bırakır) — settle fazına geçişte. */
    removeBody() {
        if (this.body && !this._bodyRemoved) {
            this.physicsWorld.removeBody(this.body);
            this._bodyRemoved = true;
        }
    }

    dispose() {
        this.removeBody();
        this.scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
    }
}
