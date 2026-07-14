import * as THREE from 'three';
import { TABLE } from '../constants.js';

export class ParticleSystem {
    constructor(scene) {
        this.scene = scene;
        this.explosions = [];
        this.decals = [];   // yere yapışan izler (ayak izi vb.): { mesh, age, maxAge, baseOpacity }
        this.rings = [];     // genişleyen şok dalgası halkaları: { mesh, age, maxAge, fromR, toR, mat }

        // Simple circle texture for particles
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        ctx.beginPath();
        ctx.arc(16, 16, 14, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        this.particleTexture = new THREE.CanvasTexture(canvas);

        // Paylaşımlı geometriler (ayak izi/parıltı/halka): her karede yeni geometri
        // allocate etmemek için (mobilde GC hitch'i önler). Yalnız materyaller örnek-bazlı
        // (opaklık animasyonu için) → silinir; bu geometriler paylaşımlı, asla silinmez.
        this._footGeom = new THREE.CircleGeometry(0.009, 10);
        this._sparkGeom = new THREE.SphereGeometry(0.006, 6, 5);
        this._ringGeom = new THREE.RingGeometry(0.78, 1.0, 24);
    }

    createFirework(position, colorHex) {
        const particleCount = 60;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const velocities = [];
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);

        const baseColor = new THREE.Color(colorHex);

        for (let i = 0; i < particleCount; i++) {
            // Start at explosion center
            positions[i * 3] = position.x;
            positions[i * 3 + 1] = position.y;
            positions[i * 3 + 2] = position.z;

            // Cone-shaped explosion upwards (like a fountain from the pocket)
            const angle = Math.random() * Math.PI * 2;
            const spread = Math.random() * 0.3; // Increased spread for wider explosion
            const speed = 0.4 + Math.random() * 0.6; // Slower speed for slow-motion

            velocities.push({
                x: Math.cos(angle) * spread * speed,
                y: speed * 1.5, // Strong upwards force
                z: Math.sin(angle) * spread * speed
            });

            // Randomize color slightly around base color
            const c = baseColor.clone();
            c.offsetHSL(Math.random() * 0.1 - 0.05, Math.random() * 0.2, Math.random() * 0.2);
            colors[i * 3] = c.r;
            colors[i * 3 + 1] = c.g;
            colors[i * 3 + 2] = c.b;

            sizes[i] = Math.random() * 2.0 + 1.0;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.PointsMaterial({
            size: 0.05,
            map: this.particleTexture,
            vertexColors: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            transparent: true,
            opacity: 1.0
        });

        const points = new THREE.Points(geometry, material);
        this.scene.add(points);

        this.explosions.push({
            mesh: points,
            velocities: velocities,
            age: 0,
            maxAge: 3.0, // 3 seconds slow motion
            gravity: 0.4,
        });
    }

    /**
     * Bomba patlaması (Faz 4 VFX): sıcak renkli radyal patlama + yere genişleyen
     * şok-dalgası halkası. createFirework'ten daha hızlı/sert/aşağı-yerleşik.
     */
    createExplosion(position, colorHex = 0xff7a18) {
        const particleCount = 64;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const velocities = [];
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);
        const base = new THREE.Color(colorHex);

        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = position.x;
            positions[i * 3 + 1] = position.y;
            positions[i * 3 + 2] = position.z;

            // Yarı-küresel radyal saçılma (hafif yukarı eğilimli).
            const ang = Math.random() * Math.PI * 2;
            const up = Math.random();
            const horiz = Math.sqrt(1 - up * up);
            const speed = 0.5 + Math.random() * 1.2;
            velocities.push({
                x: Math.cos(ang) * horiz * speed,
                y: (0.25 + up) * speed,
                z: Math.sin(ang) * horiz * speed,
            });

            const c = base.clone();
            c.offsetHSL((Math.random() - 0.5) * 0.06, 0, Math.random() * 0.3); // turuncu→sarı
            colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
            sizes[i] = Math.random() * 2 + 1.5;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.PointsMaterial({
            size: 0.06, map: this.particleTexture, vertexColors: true,
            blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 1,
        });
        const points = new THREE.Points(geometry, material);
        this.scene.add(points);
        this.explosions.push({ mesh: points, velocities, age: 0, maxAge: 1.0, gravity: 1.4 });

        // Yere genişleyen şok halkası.
        this._spawnRing(position, colorHex, 0.02, 0.26, 0.5);
    }

    /** Ayak izi: keçeye yapışan küçük koyu iz; ~1.2 sn'de söner (dash izi). */
    spawnFootprint(x, z) {
        const mat = new THREE.MeshBasicMaterial({
            color: 0x070707, transparent: true, opacity: 0.45, depthWrite: false,
        });
        const fp = new THREE.Mesh(this._footGeom, mat);
        fp.rotation.x = -Math.PI / 2;
        fp.position.set(x, TABLE.HEIGHT + 0.0015, z);
        fp.renderOrder = 1;
        this.scene.add(fp);
        this.decals.push({ mesh: fp, mat, age: 0, maxAge: 1.2, baseOpacity: 0.45, rise: 0 });
    }

    /** Dash toz patlaması: ayağın altında hızla genişleyip sönen açık halka. */
    createDashPuff(x, z) {
        this._spawnRing({ x, y: TABLE.HEIGHT + 0.004, z }, 0xcdeeff, 0.01, 0.045, 0.32);
    }

    /** Mermi izi parıltısı: küçük, hızlı sönen ek-ışıklı küre (homing ok kuyruğu). */
    createSpark(position, colorHex = 0xff5a3c) {
        const mat = new THREE.MeshBasicMaterial({
            color: colorHex, transparent: true, opacity: 0.85,
            blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const s = new THREE.Mesh(this._sparkGeom, mat);
        s.position.set(position.x, position.y, position.z);
        s.renderOrder = 2;
        this.scene.add(s);
        this.decals.push({ mesh: s, mat, age: 0, maxAge: 0.28, baseOpacity: 0.85, rise: 0 });
    }

    /**
     * Ultimate "Şok Dalgası" (Faz 7): masayı kaplayan BÜYÜK genişleyen mor halka +
     * iç beyaz halka + merkezde patlama parıltısı. createExplosion'dan daha geniş/yavaş.
     */
    createShockwave(x, z, colorHex = 0xb06bff, radius = 0.85) {
        const y = TABLE.HEIGHT + 0.006;
        this._spawnRing({ x, y, z }, colorHex, 0.04, radius, 0.6);
        this._spawnRing({ x, y, z }, 0xffffff, 0.02, radius * 0.7, 0.42);
        try { this.createExplosion({ x, y: TABLE.HEIGHT + 0.03, z }, colorHex); } catch (_) { /* yok say */ }
    }

    /** Eşya toplama parıltısı (Faz 9): yukarı sıçrayan ek-ışıklı kıvılcımlar + küçük halka. */
    createPickupSparkle(x, z, colorHex = 0x4dd2ff) {
        const y = TABLE.HEIGHT + 0.012;
        for (let i = 0; i < 8; i++) {
            const mat = new THREE.MeshBasicMaterial({
                color: colorHex, transparent: true, opacity: 0.9,
                blending: THREE.AdditiveBlending, depthWrite: false,
            });
            const s = new THREE.Mesh(this._sparkGeom, mat);
            const ang = (i / 8) * Math.PI * 2 + Math.random() * 0.4;
            const r = 0.008 + Math.random() * 0.018;
            s.position.set(x + Math.cos(ang) * r, y + Math.random() * 0.01, z + Math.sin(ang) * r);
            s.renderOrder = 2;
            this.scene.add(s);
            this.decals.push({
                mesh: s, mat, age: 0, maxAge: 0.4 + Math.random() * 0.2,
                baseOpacity: 0.9, rise: 0.08 + Math.random() * 0.06,
            });
        }
        this._spawnRing({ x, y, z }, colorHex, 0.01, 0.06, 0.35);
    }

    /** Çarpışma/devirme tozu (Faz 9): yere yayılan toprak rengi halka + alçak toz zerreleri. */
    createDust(x, z) {
        this._spawnRing({ x, y: TABLE.HEIGHT + 0.004, z }, 0xc9b48a, 0.012, 0.06, 0.4);
        for (let i = 0; i < 4; i++) {
            const mat = new THREE.MeshBasicMaterial({
                color: 0xd8c9a8, transparent: true, opacity: 0.5, depthWrite: false,
            });
            const s = new THREE.Mesh(this._sparkGeom, mat);
            const ang = Math.random() * Math.PI * 2;
            const r = 0.008 + Math.random() * 0.02;
            s.position.set(x + Math.cos(ang) * r, TABLE.HEIGHT + 0.006, z + Math.sin(ang) * r);
            this.scene.add(s);
            this.decals.push({ mesh: s, mat, age: 0, maxAge: 0.35, baseOpacity: 0.5, rise: 0.03 });
        }
    }

    /** Genişleyen yatay şok-dalgası halkası (patlama/dash ortak). */
    _spawnRing(position, colorHex, fromR, toR, life) {
        const mat = new THREE.MeshBasicMaterial({
            color: colorHex, transparent: true, opacity: 0.8, side: THREE.DoubleSide,
            depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const ring = new THREE.Mesh(this._ringGeom, mat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(position.x, position.y + 0.002, position.z);
        ring.scale.setScalar(fromR);
        ring.renderOrder = 3;
        this.scene.add(ring);
        this.rings.push({ mesh: ring, mat, age: 0, maxAge: life, fromR, toR });
    }

    update(dt) {
        // --- Point patlamaları (havai fişek + bomba) ---
        for (let i = this.explosions.length - 1; i >= 0; i--) {
            const exp = this.explosions[i];
            exp.age += dt;

            if (exp.age >= exp.maxAge) {
                this.scene.remove(exp.mesh);
                exp.mesh.geometry.dispose();
                exp.mesh.material.dispose();
                this.explosions.splice(i, 1);
                continue;
            }

            const positions = exp.mesh.geometry.attributes.position.array;
            const g = exp.gravity != null ? exp.gravity : 0.4;
            for (let p = 0; p < exp.velocities.length; p++) {
                exp.velocities[p].y -= g * dt;
                positions[p * 3] += exp.velocities[p].x * dt;
                positions[p * 3 + 1] += exp.velocities[p].y * dt;
                positions[p * 3 + 2] += exp.velocities[p].z * dt;
            }
            exp.mesh.geometry.attributes.position.needsUpdate = true;

            const progress = exp.age / exp.maxAge;
            exp.mesh.material.opacity = 1.0 - (progress * progress);
        }

        // --- Yere yapışan/sönen meshler (ayak izi, parıltı) ---
        // Geometri PAYLAŞIMLI → silme; yalnız örnek materyalini sil.
        for (let i = this.decals.length - 1; i >= 0; i--) {
            const d = this.decals[i];
            d.age += dt;
            if (d.age >= d.maxAge) {
                this.scene.remove(d.mesh);
                d.mat.dispose();
                this.decals.splice(i, 1);
                continue;
            }
            const k = d.age / d.maxAge;
            d.mat.opacity = d.baseOpacity * (1 - k);
            if (d.rise) d.mesh.position.y += d.rise * dt;
        }

        // --- Genişleyen şok halkaları (geometri paylaşımlı → yalnız materyal silinir) ---
        for (let i = this.rings.length - 1; i >= 0; i--) {
            const r = this.rings[i];
            r.age += dt;
            if (r.age >= r.maxAge) {
                this.scene.remove(r.mesh);
                r.mat.dispose();
                this.rings.splice(i, 1);
                continue;
            }
            const k = r.age / r.maxAge;
            const ease = 1 - (1 - k) * (1 - k);              // hızlı çık, yavaşla
            r.mesh.scale.setScalar(r.fromR + (r.toR - r.fromR) * ease);
            r.mat.opacity = 0.8 * (1 - k);
        }
    }
}
