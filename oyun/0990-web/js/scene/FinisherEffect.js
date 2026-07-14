// ============================================
// FinisherEffect — cinematic win celebration (variant host)
// ============================================
// A self-contained, 6-phase cinematic played when a player wins (legal 8-ball
// pot). It takes over the camera + render for ~9s, then calls onComplete() so
// the normal game-over screen can appear.
//
// Faz 14: the effect is now data-driven. This class owns the shared skeleton —
// timeline, camera choreography, shockwaves, detonation burst, stardust, title
// text, sound and screen FX — while the CENTERPIECE (black hole / cyclone /
// meteor / freeze) comes from FINISHER_DEFS (FinisherDefs.js). play() receives
// the variant id; the winner's selected finisher plays.
//
// Nothing here touches game physics or the normal render path — when
// `active` is false the module is completely inert.
//
// Postprocessing (bloom + lens distortion + chromatic aberration) is loaded
// via dynamic import with a safe fallback: if it fails to load, all in-scene
// effects still play, just without screen-space FX.
// ============================================
import * as THREE from 'three';
import { FINISHER_DEFS, T, FREEZE_START, FREEZE_HOLD, clamp, smooth, lerp, makeSoftSprite } from './FinisherDefs.js';

export class FinisherEffect {
    constructor({ scene, camera, renderer, cameraController, balls, player, sound }) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.cameraController = cameraController;
        this.balls = balls;
        this.player = player;
        this.sound = sound;

        this.active = false;
        this.t = 0;
        this.group = null;
        this.composer = null;
        this._lensPass = null;
        this._bloomPass = null;
        this._sprite = makeSoftSprite();
        this._onComplete = null;
        this._hole = new THREE.Vector3();
        this._ballState = [];
        this._textEl = null;
        this._styleEl = null;
        this.def = FINISHER_DEFS.blackhole;
        this.v = null;   // variant scratch state (fresh per play)
    }

    // =====================================================
    // Public: start the sequence
    // =====================================================
    play(holeWorldPos, winner, onComplete, variantId) {
        if (this.active) return;
        this.active = true;
        this.t = 0;
        this.winner = winner || 1;
        this.def = FINISHER_DEFS[variantId] || FINISHER_DEFS.blackhole;
        this.v = {};
        this._onComplete = onComplete;
        this._completed = false;
        this._hole.copy(holeWorldPos);

        this.group = new THREE.Group();
        this.scene.add(this.group);

        this.def.build(this);
        this._captureBalls();
        this._shockwaves = [];
        this._burst = null;
        this._stardust = null;
        this._launched = false;
        this._detonated = false;
        this._humStarted = false;
        this._oneshotPlayed = false;   // varyantın zamanlanmış tek-atım sesi (meteor/freeze)
        this._freezeReal = 0;

        // Save camera start
        this._camStart = this.camera.position.clone();
        this._camFov = this.camera.fov;

        // Hide gameplay HUD/crosshair during the show
        this._toggleHud(false);

        // Build postprocessing asynchronously (safe fallback if it fails)
        this._initComposer();

        // First shockwave + impact sound
        this._spawnShockwave(this.def.shock[0], 0.05);
        if (this.sound) this.sound.playPocket();
    }

    // =====================================================
    // Build helpers
    // =====================================================
    _captureBalls() {
        this._ballState = [];
        if (!this.balls || !this.balls.meshes) return;
        this.balls.meshes.forEach((mesh) => {
            const p = mesh.position;
            const dx = p.x - this._hole.x, dz = p.z - this._hole.z;
            this._ballState.push({
                mesh,
                start: p.clone(),
                angle: Math.atan2(dz, dx),
                radius: Math.hypot(dx, dz),
                baseRadius: Math.hypot(dx, dz),
                launchVel: null,
                y0: p.y,
            });
        });
    }

    async _initComposer() {
        try {
            const base = 'three/addons/postprocessing/';
            const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { ShaderPass }] = await Promise.all([
                import(base + 'EffectComposer.js'),
                import(base + 'RenderPass.js'),
                import(base + 'UnrealBloomPass.js'),
                import(base + 'ShaderPass.js'),
            ]);
            if (!this.active) return; // sequence already ended
            const size = new THREE.Vector2();
            this.renderer.getSize(size);

            const composer = new EffectComposer(this.renderer);
            composer.addPass(new RenderPass(this.scene, this.camera));

            const bloom = new UnrealBloomPass(size, 0.6, 0.7, 0.85);
            composer.addPass(bloom);
            this._bloomPass = bloom;

            const lens = new ShaderPass({
                uniforms: {
                    tDiffuse: { value: null },
                    center: { value: new THREE.Vector2(0.5, 0.5) },
                    strength: { value: 0.0 },
                    chroma: { value: 0.0 },
                },
                vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
                fragmentShader: `
                    uniform sampler2D tDiffuse; uniform vec2 center;
                    uniform float strength; uniform float chroma; varying vec2 vUv;
                    void main(){
                        vec2 d = vUv - center;
                        float r = length(d);
                        float f = 1.0 - strength * exp(-r * r * 16.0);
                        vec2 uv = center + d * f;
                        vec2 off = normalize(d + 1e-5) * chroma * r;
                        float cr = texture2D(tDiffuse, uv + off).r;
                        float cg = texture2D(tDiffuse, uv).g;
                        float cb = texture2D(tDiffuse, uv - off).b;
                        gl_FragColor = vec4(cr, cg, cb, 1.0);
                    }
                `,
            });
            lens.renderToScreen = true;
            composer.addPass(lens);
            this._lensPass = lens;
            this.composer = composer;
        } catch (err) {
            console.warn('Finisher postprocessing unavailable, using plain render:', err?.message || err);
            this.composer = null;
        }
    }

    // =====================================================
    // Per-frame update (called from the game loop while active)
    // =====================================================
    update(dt) {
        if (!this.active) return;
        // Internal pacing: briefly pin time at the freeze moment ("split second
        // of silence"), holding for FREEZE_HOLD real seconds, then resume.
        if (this.t >= FREEZE_START && this._freezeReal < FREEZE_HOLD) {
            this._freezeReal += dt;
            this.t = FREEZE_START;
        } else {
            this.t += dt;
        }
        const t = this.t;

        this.def.update(this, t, dt);
        this._updateBalls(t, dt);
        this._updateShockwaves(dt);
        this._updateBurst(dt);
        this._updateStardust(dt);
        this._updateCamera(t, dt);
        this._updateSound(t);
        this._updateScreenFX(t);
        this._updateText(t);

        // Phase triggers
        if (!this._detonated && t >= T.P4) this._detonate();

        // Finish
        if (t >= T.P6 && !this._completed) {
            this._completed = true;
            this._finish();
        }

        this._render();
    }

    _updateBalls(t, dt) {
        if (!this._launched) {
            // Pre-detonation choreography belongs to the variant
            this.def.balls(this, t, dt);
            return;
        }
        // Launched outward on detonation (shared flight)
        for (const b of this._ballState) {
            if (!b.mesh.parent || !b.launchVel) continue;
            b.mesh.position.addScaledVector(b.launchVel, dt);
            b.launchVel.y -= 2.5 * dt; // gravity arc
            b.mesh.rotation.x += dt * 8; b.mesh.rotation.z += dt * 9;
        }
    }

    _spawnShockwave(color, startScale) {
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.9, 1.0, 64),
            new THREE.MeshBasicMaterial({
                color, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending, depthWrite: false,
            })
        );
        ring.position.copy(this._hole);
        ring.position.y += 0.02;
        ring.rotation.x = -Math.PI / 2;
        ring.scale.setScalar(startScale);
        this.group.add(ring);
        this._shockwaves.push({ ring, life: 0, maxScale: 3.5 + Math.random() });
    }

    _updateShockwaves(dt) {
        for (let i = this._shockwaves.length - 1; i >= 0; i--) {
            const s = this._shockwaves[i];
            s.life += dt;
            const p = s.life / 0.9;
            s.ring.scale.setScalar(lerp(0.1, s.maxScale, smooth(0, 1, p)));
            s.ring.material.opacity = (1 - p) * 0.9;
            if (p >= 1) {
                this.group.remove(s.ring);
                s.ring.geometry.dispose(); s.ring.material.dispose();
                this._shockwaves.splice(i, 1);
            }
        }
    }

    _detonate() {
        this._detonated = true;
        this._launched = true;

        // Big shockwaves in the variant's colors
        this._spawnShockwave(this.def.shock[1], 0.1);
        this._spawnShockwave(this.def.shock[2], 0.1);

        // Launch remaining balls outward
        for (const b of this._ballState) {
            if (!b.mesh.parent) continue;
            const a = Math.random() * Math.PI * 2;
            const speed = 2.5 + Math.random() * 3.5;
            b.launchVel = new THREE.Vector3(Math.cos(a) * speed, 3 + Math.random() * 4, Math.sin(a) * speed);
        }

        // Push the player back
        if (this.player && this.player.body) {
            const away = new THREE.Vector3(
                this.player.body.position.x - this._hole.x, 0,
                this.player.body.position.z - this._hole.z
            );
            if (away.lengthSq() < 1e-4) away.set(-1, 0, 0);
            away.normalize();
            this._playerPush = away.multiplyScalar(0.6);
        }

        // Variant hook (extra impact visuals) + cosmic burst + stardust
        if (this.def.detonate) this.def.detonate(this);
        this._spawnBurst();
        this._spawnStardust();

        if (this.sound) { this.sound.stopHum(0.1); this.sound.playBoom(); this.sound.playWin(); }
    }

    _spawnBurst() {
        const N = 2600;
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(N * 3);
        const col = new Float32Array(N * 3);
        this._burstVel = [];
        const palette = this.def.burstPalette;
        for (let i = 0; i < N; i++) {
            pos[i * 3] = this._hole.x; pos[i * 3 + 1] = this._hole.y; pos[i * 3 + 2] = this._hole.z;
            // random direction in a hemisphere-ish sphere
            const a = Math.random() * Math.PI * 2;
            const u = Math.random() * 2 - 1;
            const s = Math.sqrt(1 - u * u);
            const sp = 1.5 + Math.random() * 7;
            this._burstVel.push(new THREE.Vector3(Math.cos(a) * s * sp, Math.abs(u) * sp * 0.9 + 0.5, Math.sin(a) * s * sp));
            const c = palette[(Math.random() * palette.length) | 0];
            col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        this._burstGeo = geo;
        this._burst = new THREE.Points(geo, new THREE.PointsMaterial({
            size: 0.06, map: this._sprite, vertexColors: true, transparent: true,
            blending: THREE.AdditiveBlending, depthWrite: false, opacity: 1,
        }));
        this.group.add(this._burst);
        this._burstLife = 0;
    }

    _updateBurst(dt) {
        if (!this._burst) return;
        this._burstLife += dt;
        const arr = this._burstGeo.attributes.position.array;
        for (let i = 0; i < this._burstVel.length; i++) {
            const v = this._burstVel[i];
            arr[i * 3] += v.x * dt; arr[i * 3 + 1] += v.y * dt; arr[i * 3 + 2] += v.z * dt;
            v.multiplyScalar(0.96); v.y -= 1.5 * dt;
        }
        this._burstGeo.attributes.position.needsUpdate = true;
        this._burst.material.opacity = clamp(1 - this._burstLife / 2.4, 0, 1);
    }

    _spawnStardust() {
        const N = 700;
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(N * 3);
        this._dustVel = [];
        for (let i = 0; i < N; i++) {
            pos[i * 3] = this._hole.x + (Math.random() - 0.5) * 6;
            pos[i * 3 + 1] = this._hole.y + 1.5 + Math.random() * 3;
            pos[i * 3 + 2] = this._hole.z + (Math.random() - 0.5) * 6;
            this._dustVel.push(0.1 + Math.random() * 0.25);
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        this._dustGeo = geo;
        this._stardust = new THREE.Points(geo, new THREE.PointsMaterial({
            size: 0.035, map: this._sprite, color: this.def.dustColor, transparent: true,
            blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
        }));
        this.group.add(this._stardust);
    }

    _updateStardust(dt) {
        if (!this._stardust) return;
        this._stardust.material.opacity = clamp((this.t - T.P5) / 0.6, 0, 0.9);
        const arr = this._dustGeo.attributes.position.array;
        for (let i = 0; i < this._dustVel.length; i++) {
            arr[i * 3 + 1] -= this._dustVel[i] * dt;
            arr[i * 3] += Math.sin(this.t * 1.5 + i) * 0.002;
            if (arr[i * 3 + 1] < this._hole.y) arr[i * 3 + 1] = this._hole.y + 3 + Math.random() * 2;
        }
        this._dustGeo.attributes.position.needsUpdate = true;
    }

    _updateCamera(t, dt) {
        const cam = this.camera;
        const hole = this._hole;

        // Focus point: hole (or variant override) through P5, shifts to player in P6
        const focus = hole.clone();
        if (t < T.P5 && this.def.focus) {
            const alt = this.def.focus(this, t);
            if (alt) focus.copy(alt);
        }
        if (t >= T.P5 && this.player) {
            const f = smooth(T.P5, T.P5 + 0.8, t);
            focus.lerp(this.player.mesh.position, f);
        }

        let basePos = new THREE.Vector3();
        let shake = 0;

        if (t < T.P1) {
            // Rapid zoom toward the pocket
            const g = smooth(0, T.P1, t);
            const from = this._camStart;
            const to = new THREE.Vector3(hole.x, hole.y + 0.5, hole.z + 0.9);
            basePos.lerpVectors(from, to, g * g);
            cam.fov = lerp(this._camFov, 38, g);
            shake = g * 0.01;
        } else if (t < T.P4) {
            // Slow orbit + dolly in, growing shake
            const g = smooth(T.P1, T.P4, t);
            const ang = -Math.PI / 2 + g * 1.6;
            const dist = lerp(1.0, 0.55, g);
            const h = lerp(0.5, 0.28, g);
            basePos.set(hole.x + Math.cos(ang) * dist, hole.y + h, hole.z + Math.sin(ang) * dist);
            cam.fov = lerp(38, 50, g);
            shake = 0.006 + g * 0.02;
            if (t >= FREEZE_START) shake = 0.001; // freeze = stillness
        } else if (t < T.P5) {
            // Detonation: jolt camera back
            const g = smooth(T.P4, T.P5, t);
            const ang = -Math.PI / 2 + 1.6;
            const dist = lerp(0.55, 2.2, g * g);
            basePos.set(hole.x + Math.cos(ang) * dist, hole.y + lerp(0.28, 1.0, g), hole.z + Math.sin(ang) * dist);
            cam.fov = lerp(50, 60, g);
            shake = (1 - g) * 0.05 + 0.01;
        } else {
            // Finale: cinematic 360 orbit around the player
            const g = smooth(T.P5, T.P6, t);
            const ang = g * Math.PI * 2 + Math.PI / 2;
            const dist = lerp(2.2, 1.6, g);
            basePos.set(focus.x + Math.cos(ang) * dist, focus.y + lerp(1.0, 0.7, g) + 0.2, focus.z + Math.sin(ang) * dist);
            cam.fov = lerp(60, 50, g);
            shake = 0.004 * (1 - g);
        }

        // Apply shake
        if (shake > 0) {
            basePos.x += (Math.random() - 0.5) * shake;
            basePos.y += (Math.random() - 0.5) * shake;
            basePos.z += (Math.random() - 0.5) * shake;
        }
        cam.position.copy(basePos);
        cam.lookAt(focus);
        cam.updateProjectionMatrix();

        // Player push integration (after detonation)
        if (this._playerPush && this.player && this.player.body) {
            this.player.body.position.x += this._playerPush.x * dt;
            this.player.body.position.z += this._playerPush.z * dt;
            this._playerPush.multiplyScalar(0.92);
        }
    }

    _updateSound(t) {
        if (!this.sound) return;
        // Varyant sesleri def.sfx'ten (FinisherDefs): loop = build uğultusu örneği
        // (yoksa prosedürel drone), oneshot = zamanlanmış tek-atım (`at` def'te —
        // meteor: görsel çarpma anı T.P4; donma: sub-düşüş FREEZE'e denk).
        const sfx = this.def.sfx || {};
        if (!this._humStarted && t >= T.P1 * 0.6) {
            this._humStarted = true;
            this.sound.startHum(sfx.loop || null);
        }
        if (sfx.oneshot && !this._oneshotPlayed && t >= (sfx.at || 0)) {
            this._oneshotPlayed = true;
            if (this.sound.playSample) this.sound.playSample(sfx.oneshot, 0.9, { offset: sfx.skip || 0 });
        }
    }

    _updateScreenFX(t) {
        if (!this.composer) return;
        // Project hole to screen for lens center
        const v = this._hole.clone().project(this.camera);
        this._lensPass.uniforms.center.value.set((v.x + 1) / 2, (v.y + 1) / 2);

        let strength = 0, chroma = 0, bloom = 0.4;
        if (t < T.P4) {
            const g = smooth(T.P2, T.P4, t);
            strength = g * 0.55;
            chroma = g * 0.012;
            bloom = 0.5 + g * 0.8;
        } else if (t < T.P5) {
            const g = smooth(T.P4, T.P5, t);
            strength = lerp(0.55, 0.0, g);
            chroma = lerp(0.012, 0.03, g) * (1 - g);
            bloom = lerp(1.3, 1.8, g);
        } else {
            const g = smooth(T.P5, T.P6, t);
            strength = 0;
            chroma = 0.004 * (1 - g);
            bloom = lerp(1.8, 0.6, g);
        }
        // The gravitational lens warp is the black hole's signature; other
        // variants only get a hint of it.
        this._lensPass.uniforms.strength.value = strength * (this.def.lens ?? 1);
        this._lensPass.uniforms.chroma.value = chroma;
        if (this._bloomPass) this._bloomPass.strength = bloom;
    }

    _updateText(t) {
        if (t >= T.P5 && !this._textEl) {
            this._injectText();
        }
    }

    _injectText() {
        const d = this.def;
        this._styleEl = document.createElement('style');
        this._styleEl.textContent = `
            @keyframes finText { 0%{opacity:0; transform:translate(-50%,-50%) scale(0.6); letter-spacing:0.5em;}
                60%{opacity:1;} 100%{opacity:1; transform:translate(-50%,-50%) scale(1); letter-spacing:0.18em;} }
            #finisher-text{ position:fixed; left:50%; top:42%; transform:translate(-50%,-50%);
                font-family:'Outfit',sans-serif; font-weight:800; font-size:clamp(32px,7vw,86px);
                text-align:center; pointer-events:none; z-index:50; animation:finText 1s ease-out forwards;
                background:${d.textGrad};
                background-size:200% auto; -webkit-background-clip:text; background-clip:text; color:transparent;
                text-shadow:${d.textGlow};
                filter:drop-shadow(0 0 18px rgba(140,200,255,0.6)); }
            #finisher-text small{ display:block; font-size:0.32em; font-weight:600; letter-spacing:0.4em;
                color:#bcd9ff; -webkit-text-fill-color:#bcd9ff; margin-top:0.4em; opacity:0.9; }
        `;
        document.head.appendChild(this._styleEl);
        this._textEl = document.createElement('div');
        this._textEl.id = 'finisher-text';
        this._textEl.innerHTML = `${d.title}<small>PLAYER ${this.winner} WINS</small>`;
        document.body.appendChild(this._textEl);
    }

    _toggleHud(show) {
        ['hud-top', 'crosshair', 'controls-help', 'power-bar-container'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('hidden', !show);
        });
    }

    _render() {
        if (this.composer) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }
    }

    _finish() {
        // Restore camera fov, hand control back, then notify
        this.camera.fov = this._camFov;
        this.camera.updateProjectionMatrix();
        if (this._onComplete) this._onComplete();
        this._cleanup();
    }

    _cleanup() {
        this.active = false;
        if (this.sound) this.sound.stopHum(0.2);

        // Remove text
        if (this._textEl) { this._textEl.remove(); this._textEl = null; }
        if (this._styleEl) { this._styleEl.remove(); this._styleEl = null; }

        // Dispose 3D objects (includes everything the variant built)
        if (this.group) {
            this.group.traverse((o) => {
                if (o.geometry) o.geometry.dispose();
                if (o.material) {
                    if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
                    else o.material.dispose();
                }
            });
            this.scene.remove(this.group);
            this.group = null;
        }
        if (this.composer) { this.composer.dispose?.(); this.composer = null; }
        this._lensPass = null; this._bloomPass = null;
        this.v = null;

        // HUD stays hidden — the game-over screen takes over. It is restored on restart.
    }
}
