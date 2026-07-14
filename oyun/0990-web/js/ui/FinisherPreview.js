// ============================================
// FinisherPreview — live 3D preview stage for the Finishers menu (Faz 14.1)
// ============================================
// A tiny self-contained THREE scene (own canvas + renderer, independent from
// the game's SceneManager) that plays a finisher variant in a loop so the
// player can SEE what each one does before selecting it.
//
// It reuses the real FINISHER_DEFS hooks (build/update/balls/detonate/focus)
// against a faked "fx" surface: a dark mini-cloth disc, a pocket dot and a
// handful of prop balls stand in for the table. The heavier host-side finale
// (burst) is reproduced in a lightweight form; screen FX / text are skipped.
// SES çalar (kullanıcı isteği): host'un zamanlamasıyla build uğultusu
// (def.sfx.loop / prosedürel) + varyant one-shot'ı + detonasyonda boom —
// zafer fanfarı/pocket sesi menüde atlanır.
//
// Lifecycle: MainMenu lazily creates one instance on first open of the
// Finishers panel, then start(id)/stop() as the panel/menu shows and hides.
// The loop resets shortly after the detonation beat (~7s per cycle).
// ============================================
import * as THREE from 'three';
import { FINISHER_DEFS, T, makeSoftSprite, lerp } from '../scene/FinisherDefs.js';

const SPEED = 1.25;              // preview runs slightly fast (shorter loop)
const LOOP_END = T.P5 + 0.7;     // restart after the detonation has bloomed

// Prop balls: classic pool colors, fixed layout (stable, readable loop)
const PROP_BALLS = [
    { c: 0xf4f0e8, x: 0.34, z: 0.12 },   // cue
    { c: 0xf6c443, x: -0.28, z: 0.24 },
    { c: 0x2b5cff, x: 0.10, z: -0.36 },
    { c: 0xd0342c, x: -0.42, z: -0.14 },
    { c: 0x7b2fbe, x: 0.48, z: -0.26 },
    { c: 0xef8632, x: -0.12, z: 0.44 },
    { c: 0x111111, x: 0.22, z: 0.32 },   // the 8
];
const BALL_R = 0.045;

export class FinisherPreview {
    constructor(canvas, sound = null) {
        this.canvas = canvas;
        this.sound = sound;          // SoundManager (menü ambiyansının üstünde çalar)
        this._humStarted = false;
        this._oneshotPlayed = false;
        this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
        this.renderer.setClearColor(0x000000, 0);   // panel CSS provides the backdrop
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.05, 30);
        this.camera.position.set(1.15, 0.8, 1.15);
        this._look = new THREE.Vector3(0, 0.25, 0);
        this._lookTarget = new THREE.Vector3(0, 0.25, 0);

        this._sprite = makeSoftSprite();
        this._running = false;
        this._raf = null;
        this._last = 0;
        this._t = 0;
        this._launched = false;
        this._shock = [];
        this._burst = null;

        // ---- Static mini stage: cloth disc + pocket dot ----
        const cloth = new THREE.Mesh(
            new THREE.CircleGeometry(1.6, 48),
            new THREE.MeshBasicMaterial({ color: 0x0d2c20 })
        );
        cloth.rotation.x = -Math.PI / 2;
        this.scene.add(cloth);
        const pocket = new THREE.Mesh(
            new THREE.CircleGeometry(0.07, 32),
            new THREE.MeshBasicMaterial({ color: 0x000000 })
        );
        pocket.rotation.x = -Math.PI / 2;
        pocket.position.y = 0.002;
        this.scene.add(pocket);

        // ---- Prop balls (persist across loops; positions reset each cycle) ----
        this._balls = PROP_BALLS.map(({ c, x, z }) => {
            const m = new THREE.Mesh(
                new THREE.SphereGeometry(BALL_R, 16, 12),
                new THREE.MeshBasicMaterial({ color: c })
            );
            m.position.set(x, BALL_R, z);
            this.scene.add(m);
            return m;
        });

        // ---- Faked host surface the defs run against ----
        this.fx = {
            _hole: new THREE.Vector3(0, 0, 0),
            _sprite: this._sprite,
            group: null,
            v: {},
            _ballState: [],
            _spawnShockwave: (color, s) => this._spawnShockwave(color, s),
        };
        this.def = FINISHER_DEFS.blackhole;
    }

    /** Switch the previewed variant (rebuilds the loop from t=0). */
    setVariant(id) {
        this.def = FINISHER_DEFS[id] || FINISHER_DEFS.blackhole;
        this._resetLoop();
    }

    start(id) {
        this.setVariant(id);
        if (this._running) return;
        this._running = true;
        this._last = performance.now();
        const tick = (now) => {
            if (!this._running) return;
            this._frame(now);
            this._raf = requestAnimationFrame(tick);
        };
        this._raf = requestAnimationFrame(tick);
    }

    stop() {
        this._running = false;
        if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
        if (this.sound) this.sound.stopHum(0.3);   // sayfa kapanınca uğultu sussun
    }

    // =====================================================
    // Loop internals
    // =====================================================
    _resetLoop() {
        // Drop everything the previous variant built
        if (this.fx.group) {
            this.fx.group.traverse((o) => {
                if (o.geometry) o.geometry.dispose();
                if (o.material) {
                    if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
                    else o.material.dispose();
                }
            });
            this.scene.remove(this.fx.group);
        }
        this._clearFinale();

        this.fx.group = new THREE.Group();
        this.scene.add(this.fx.group);
        this.fx.v = {};

        // Reset props + fresh ball state (mirrors FinisherEffect._captureBalls)
        this.fx._ballState = this._balls.map((mesh, i) => {
            mesh.position.set(PROP_BALLS[i].x, BALL_R, PROP_BALLS[i].z);
            mesh.rotation.set(0, 0, 0);
            const dx = mesh.position.x, dz = mesh.position.z;
            return {
                mesh,
                start: mesh.position.clone(),
                angle: Math.atan2(dz, dx),
                radius: Math.hypot(dx, dz),
                baseRadius: Math.hypot(dx, dz),
                launchVel: null,
                y0: BALL_R,
            };
        });

        this._t = 0;
        this._launched = false;
        this._look.set(0, 0.25, 0);
        // Ses döngüsü baştan: kalan uğultuyu sustur + faz bayraklarını sıfırla.
        if (this.sound) this.sound.stopHum(0.15);
        this._humStarted = false;
        this._oneshotPlayed = false;
        this.def.build(this.fx);
    }

    _clearFinale() {
        for (const s of this._shock) {
            this.scene.remove(s.ring);
            s.ring.geometry.dispose(); s.ring.material.dispose();
        }
        this._shock = [];
        if (this._burst) {
            this.scene.remove(this._burst.pts);
            this._burst.pts.geometry.dispose(); this._burst.pts.material.dispose();
            this._burst = null;
        }
    }

    _frame(now) {
        const dt = Math.min(0.05, (now - this._last) / 1000) * SPEED;
        this._last = now;
        this._t += dt;
        const t = this._t;

        this._resize();

        // Ses: host FinisherEffect._updateSound'un aynısı (t-uzayı ortak) —
        // uğultu T.P1*0.6'da (def.sfx.loop örneği ya da prosedürel drone),
        // varyant one-shot'ı (meteor düşüşü / donma) def.sfx.at anında.
        if (this.sound) {
            const sfx = this.def.sfx || {};
            if (!this._humStarted && t >= T.P1 * 0.6) {
                this._humStarted = true;
                this.sound.startHum(sfx.loop || null);
            }
            if (sfx.oneshot && !this._oneshotPlayed && t >= (sfx.at || 0)) {
                this._oneshotPlayed = true;
                if (this.sound.playSample) this.sound.playSample(sfx.oneshot, 0.7, { offset: sfx.skip || 0 });
            }
        }

        this.def.update(this.fx, t, dt);

        if (!this._launched) {
            this.def.balls(this.fx, t, dt);
            if (t >= T.P4) this._detonate();
        } else {
            for (const b of this.fx._ballState) {
                if (!b.launchVel) continue;
                b.mesh.position.addScaledVector(b.launchVel, dt);
                b.launchVel.y -= 2.5 * dt;
                b.mesh.rotation.x += dt * 8; b.mesh.rotation.z += dt * 9;
            }
        }

        this._updateShock(dt);
        this._updateBurst(dt);

        // Camera: gentle drift; variants may steer the look-at (meteor tracks the rock)
        const alt = (!this._launched && this.def.focus) ? this.def.focus(this.fx, t) : null;
        if (alt) this._lookTarget.copy(alt); else this._lookTarget.set(0, 0.25, 0);
        this._look.lerp(this._lookTarget, Math.min(1, dt * 4));
        const sway = Math.sin(now * 0.0004) * 0.12;
        this.camera.position.set(1.15 + sway, 0.8, 1.15 - sway);
        this.camera.lookAt(this._look);

        this.renderer.render(this.scene, this.camera);

        if (t >= LOOP_END) this._resetLoop();
    }

    _detonate() {
        this._launched = true;
        // Detonasyon sesi: uğultuyu kes + boom (menüde biraz kısık; fanfar YOK).
        if (this.sound) {
            this.sound.stopHum(0.1);
            if (!this.sound.playSample || !this.sound.playSample('finisher-boom', 0.7)) {
                if (this.sound.playBoom) this.sound.playBoom();
            }
        }
        this._spawnShockwave(this.def.shock[1], 0.1);
        this._spawnShockwave(this.def.shock[2], 0.1);
        if (this.def.detonate) this.def.detonate(this.fx);

        for (const b of this.fx._ballState) {
            const a = Math.random() * Math.PI * 2;
            const speed = 1.5 + Math.random() * 2;
            b.launchVel = new THREE.Vector3(Math.cos(a) * speed, 2 + Math.random() * 2, Math.sin(a) * speed);
        }
        this._spawnBurst();
    }

    _spawnShockwave(color, startScale) {
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.9, 1.0, 48),
            new THREE.MeshBasicMaterial({
                color, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending, depthWrite: false,
            })
        );
        ring.position.y = 0.02;
        ring.rotation.x = -Math.PI / 2;
        ring.scale.setScalar(startScale);
        this.scene.add(ring);
        this._shock.push({ ring, life: 0 });
    }

    _updateShock(dt) {
        for (let i = this._shock.length - 1; i >= 0; i--) {
            const s = this._shock[i];
            s.life += dt;
            const p = Math.min(1, s.life / 0.9);
            s.ring.scale.setScalar(lerp(0.1, 2.6, p * p * (3 - 2 * p)));
            s.ring.material.opacity = (1 - p) * 0.9;
            if (p >= 1) {
                this.scene.remove(s.ring);
                s.ring.geometry.dispose(); s.ring.material.dispose();
                this._shock.splice(i, 1);
            }
        }
    }

    // Lightweight version of the host's detonation burst
    _spawnBurst() {
        const N = 420;
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(N * 3);
        const col = new Float32Array(N * 3);
        const vel = [];
        const palette = this.def.burstPalette;
        for (let i = 0; i < N; i++) {
            const a = Math.random() * Math.PI * 2;
            const u = Math.random() * 2 - 1;
            const s = Math.sqrt(1 - u * u);
            const sp = 0.8 + Math.random() * 3.2;
            vel.push(new THREE.Vector3(Math.cos(a) * s * sp, Math.abs(u) * sp * 0.9 + 0.3, Math.sin(a) * s * sp));
            const c = palette[(Math.random() * palette.length) | 0];
            col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const pts = new THREE.Points(geo, new THREE.PointsMaterial({
            size: 0.05, map: this._sprite, vertexColors: true, transparent: true,
            blending: THREE.AdditiveBlending, depthWrite: false, opacity: 1,
        }));
        this.scene.add(pts);
        this._burst = { pts, geo, vel, life: 0 };
    }

    _updateBurst(dt) {
        if (!this._burst) return;
        const b = this._burst;
        b.life += dt;
        const arr = b.geo.attributes.position.array;
        for (let i = 0; i < b.vel.length; i++) {
            const v = b.vel[i];
            arr[i * 3] += v.x * dt; arr[i * 3 + 1] += v.y * dt; arr[i * 3 + 2] += v.z * dt;
            v.multiplyScalar(0.96); v.y -= 1.2 * dt;
        }
        b.geo.attributes.position.needsUpdate = true;
        b.pts.material.opacity = Math.max(0, 1 - b.life / 1.6);
    }

    _resize() {
        const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
        if (!w || !h) return;
        if (this._w !== w || this._h !== h) {
            this._w = w; this._h = h;
            this.renderer.setSize(w, h, false);
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
        }
    }
}
