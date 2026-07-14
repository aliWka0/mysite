// ============================================
// FinisherDefs — data-driven finisher variants (Faz 14)
// ============================================
// The cinematic skeleton (6-phase timeline, camera choreography, shockwaves,
// detonation burst, stardust, title text, sound, screen FX) lives in
// FinisherEffect. Each variant here only supplies the CENTERPIECE — what
// grows at the pocket, how the balls behave before detonation and the
// color/text identity. Purely cosmetic; the winner's selected variant plays.
//
// Variant contract (fx = the running FinisherEffect instance):
//   build(fx)          — create centerpiece objects into fx.group (state → fx.v)
//   update(fx, t, dt)  — animate centerpiece across the shared timeline T
//   balls(fx, t, dt)   — pre-launch ball animation (host handles the launch)
//   detonate(fx)?      — optional extra work at the detonation moment
//   focus(fx, t)?      — optional camera look-at override before P5 (Vector3|null)
//   shock[3]           — shockwave colors: [intro, detonation A, detonation B]
//   burstPalette       — detonation particle colors, dustColor — falling motes
//   lens               — screen-space lens-warp multiplier (black hole = 1)
//   icon/name/desc     — menu card, title/textGrad/textGlow — win text styling
//
// Everything a variant adds to fx.group is disposed by the host's cleanup.
// ============================================
import * as THREE from 'three';

// Shared phase timeline (seconds) — used by the host and every variant.
export const T = {
    P1: 1.3,   // Impact (slow-mo, shockwave, zoom)
    P2: 2.8,   // Centerpiece birth
    P3: 4.8,   // Build-up
    P4: 6.0,   // Maximum power (+ freeze near the end) → detonation
    P5: 7.4,   // Cosmic detonation
    P6: 9.6,   // Celebration finale
};
export const FREEZE_START = 5.65; // brief "everything freezes" moment in P4
export const FREEZE_HOLD = 0.45;  // real seconds to hold the freeze

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;

/** Soft round particle sprite — shared by the finisher host and the menu preview. */
export function makeSoftSprite() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.3, 'rgba(255,255,255,0.7)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

// ---------------------------------------------
// Shader'lı finisher yardımcıları (Apocalypse Meteor portu, Faz 14+)
// Konsept kaynakları: _assets_src/finishers/new_finishers/*.html
// ---------------------------------------------
const easeInC = (t) => t * t * t;
const easeOutC = (t) => 1 - Math.pow(1 - t, 3);
// rate/s → bu karede kaç parçacık doğar (kesirli kısım olasılıkla)
const spawnCount = (rate, dt) => { const x = rate * dt, n = Math.floor(x); return n + (Math.random() < x - n ? 1 : 0); };
const _tmpV = new THREE.Vector3();

// Paylaşımlı GLSL simplex noise + 3-oktav fbm (mobil bütçe: demo 4 oktavdı)
const NOISE_GLSL = `
vec3 mod289(vec3 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0,0.5,1.0,2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0*floor(p*ns.z*ns.z);
  vec4 x_ = floor(j*ns.z);
  vec4 y_ = floor(j - 7.0*x_);
  vec4 x = x_*ns.x + ns.yyyy;
  vec4 y = y_*ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)), 0.0);
  m = m*m;
  return 42.0*dot(m*m, vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){
  float f = 0.0;
  f += 0.5333*snoise(p); p *= 2.01;
  f += 0.2667*snoise(p); p *= 2.02;
  f += 0.1333*snoise(p);
  return f;
}`;

/**
 * Per-parçacık BOYUT + ALFA destekli CPU nokta bulutu (PointsMaterial bunu
 * veremiyor; NormalBlending koyu duman ancak per-parçacık alfayla mümkün).
 * Ring-buffer emit; update(dt, fn) — fn(i, yaş 0..1, dt) renk/boyut evrimi.
 * pts fx.group'a eklenir → host/preview cleanup'ı geo+mat'i dispose eder.
 */
function makeFirePoints(N, sprite, blending) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const siz = new Float32Array(N);
    const alp = new Float32Array(N);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alp, 1));
    const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending, vertexColors: true,
        uniforms: { uTex: { value: sprite }, uScale: { value: 800 } },
        vertexShader: `
            attribute float aSize; attribute float aAlpha;
            varying vec3 vC; varying float vA;
            uniform float uScale;
            void main(){
                vC = color; vA = aAlpha;
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = aSize * (uScale / -mv.z);
                gl_Position = projectionMatrix * mv;
            }`,
        fragmentShader: `
            uniform sampler2D uTex; varying vec3 vC; varying float vA;
            void main(){
                vec4 t = texture2D(uTex, gl_PointCoord);
                float a = t.a * vA;
                if (a < 0.012) discard;
                gl_FragColor = vec4(vC * t.rgb, a);
            }`,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    const s = {
        pts, geo, pos, col, siz, alp, N,
        vel: [], life: new Float32Array(N).fill(-1), max: new Float32Array(N),
        data: new Array(N).fill(null), cursor: 0,
        emit(px, py, pz, vx, vy, vz, life, size, r, g, b, extra) {
            const i = this.cursor; this.cursor = (this.cursor + 1) % this.N;
            this.pos[i * 3] = px; this.pos[i * 3 + 1] = py; this.pos[i * 3 + 2] = pz;
            this.vel[i].set(vx, vy, vz);
            this.life[i] = this.max[i] = life;
            this.siz[i] = size; this.alp[i] = 1;
            this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
            this.data[i] = extra || null;
        },
        update(dt, fn) {
            for (let i = 0; i < this.N; i++) {
                if (this.life[i] < 0) continue;
                this.life[i] -= dt;
                if (this.life[i] < 0) { this.alp[i] = 0; continue; }
                const k = 1 - this.life[i] / this.max[i];
                this.pos[i * 3] += this.vel[i].x * dt;
                this.pos[i * 3 + 1] += this.vel[i].y * dt;
                this.pos[i * 3 + 2] += this.vel[i].z * dt;
                if (fn) fn(i, k, dt);
            }
            this.geo.attributes.position.needsUpdate = true;
            this.geo.attributes.color.needsUpdate = true;
            this.geo.attributes.aSize.needsUpdate = true;
            this.geo.attributes.aAlpha.needsUpdate = true;
        },
    };
    for (let i = 0; i < N; i++) s.vel.push(new THREE.Vector3());
    return s;
}

// Meteor'un kopan/patlayan kaya havuzu (tek InstancedMesh, v.rockState slotları)
function meteorRockSpawn(v, origin, vel, life) {
    for (const s of v.rockState) {
        if (s.alive) continue;
        s.alive = true; s.p.copy(origin); s.v.copy(vel); s.life = life;
        return;
    }
}
function meteorRockUpdate(v, sdt) {
    let idx = 0;
    for (const s of v.rockState) {
        if (s.alive) {
            s.life -= sdt;
            s.p.addScaledVector(s.v, sdt);
            s.v.y -= 4.5 * sdt;
            s.r.x += s.rs * sdt; s.r.y += s.rs * 0.7 * sdt;
            if (s.life < 0 || s.p.y < v.rockFloor) s.alive = false;
        }
        if (s.alive) { v.dummy.position.copy(s.p); v.dummy.scale.setScalar(s.s); }
        else { v.dummy.position.set(0, -999, 0); v.dummy.scale.setScalar(0.0001); }
        v.dummy.rotation.copy(s.r);
        v.dummy.updateMatrix();
        v.rocks.setMatrixAt(idx++, v.dummy.matrix);
    }
    v.rocks.instanceMatrix.needsUpdate = true;
}

// =====================================================
// 🌌 BLACK HOLE — the original "Singularity Shot"
// =====================================================
const blackhole = {
    icon: '🌌',
    name: 'Kara Delik',
    desc: 'Masa tekilliğe çöker — toplar sarmal çizip yutulur.',
    title: 'SINGULARITY SHOT',
    textGrad: 'linear-gradient(90deg,#7dd3ff,#b388ff,#8affff,#ff9ce0,#7dd3ff)',
    textGlow: '0 0 30px rgba(120,180,255,0.7),0 0 60px rgba(160,100,255,0.5)',
    lens: 1.0,
    // Ses (FinisherEffect._updateSound): build boyunca dönen kütleçekim uğultusu.
    sfx: { loop: 'finisher-blackhole-loop' },
    shock: [0xffffff, 0x99ddff, 0xcc88ff],
    burstPalette: [
        [0.4, 0.6, 1.0], [0.8, 0.4, 1.0], [0.4, 1.0, 1.0], [1.0, 1.0, 1.0], [1.0, 0.8, 0.5],
    ],
    dustColor: 0xaad4ff,

    build(fx) {
        const hole = fx._hole, v = fx.v;

        // Event horizon — pure black sphere
        v.core = new THREE.Mesh(
            new THREE.SphereGeometry(0.05, 32, 24),
            new THREE.MeshBasicMaterial({ color: 0x000000 })
        );
        v.core.position.copy(hole);
        v.core.scale.setScalar(0.01);
        fx.group.add(v.core);

        // Accretion disk — swirling additive shader ring
        const diskGeo = new THREE.RingGeometry(0.05, 0.32, 96, 1);
        const diskMat = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
            vertexShader: `
                varying vec2 vUv;
                void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
            `,
            fragmentShader: `
                varying vec2 vUv;
                uniform float uTime; uniform float uOpacity;
                void main(){
                    vec2 p = vUv - 0.5;
                    float ang = atan(p.y, p.x);
                    float rad = length(p) * 2.0;
                    float swirl = sin(ang * 6.0 + uTime * 6.0 - rad * 14.0) * 0.5 + 0.5;
                    float ring = smoothstep(0.0, 0.35, rad) * (1.0 - smoothstep(0.6, 1.0, rad));
                    vec3 cBlue = vec3(0.25, 0.5, 1.0);
                    vec3 cPurple = vec3(0.7, 0.25, 1.0);
                    vec3 cCyan = vec3(0.3, 1.0, 1.0);
                    vec3 col = mix(cPurple, cBlue, swirl);
                    col = mix(col, cCyan, pow(swirl, 3.0) * 0.6);
                    float a = ring * (0.5 + 0.5 * swirl) * uOpacity;
                    gl_FragColor = vec4(col * (1.2 + swirl), a);
                }
            `,
        });
        v.disk = new THREE.Mesh(diskGeo, diskMat);
        v.disk.position.copy(hole);
        v.disk.position.y += 0.01;
        v.disk.rotation.x = -Math.PI / 2 + 0.35; // slight tilt
        v.disk.scale.setScalar(0.01);
        fx.group.add(v.disk);

        // Glowing event-horizon halo (sprite)
        v.halo = new THREE.Sprite(new THREE.SpriteMaterial({
            map: fx._sprite, color: 0x66ccff, transparent: true,
            blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
        }));
        v.halo.position.copy(hole);
        v.halo.scale.setScalar(0.4);
        fx.group.add(v.halo);

        // Orbiting matter particles
        const N = 900;
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(N * 3);
        const col = new Float32Array(N * 3);
        v.orbit = [];
        const palette = [
            [0.3, 0.55, 1.0], [0.7, 0.3, 1.0], [0.35, 1.0, 1.0], [0.9, 0.95, 1.0],
        ];
        for (let i = 0; i < N; i++) {
            const radius = 0.15 + Math.random() * 1.4;
            const angle = Math.random() * Math.PI * 2;
            const yOff = (Math.random() - 0.5) * 0.5;
            const speed = (0.6 + Math.random() * 1.6) * (Math.random() < 0.5 ? 1 : -1);
            v.orbit.push({ radius, angle, yOff, speed, baseR: radius });
            const c = palette[(Math.random() * palette.length) | 0];
            col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        v.orbitGeo = geo;
        v.orbitPts = new THREE.Points(geo, new THREE.PointsMaterial({
            size: 0.045, map: fx._sprite, vertexColors: true, transparent: true,
            blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
        }));
        fx.group.add(v.orbitPts);
    },

    update(fx, t, dt) {
        const v = fx.v;

        // Birth grows the hole; P4 grows it large; P5 collapses it.
        let coreScale, diskScale, diskOp, haloOp;
        if (t < T.P1) {
            coreScale = lerp(0.01, 0.15, smooth(0.2, T.P1, t));
            diskScale = lerp(0.01, 0.3, smooth(0.4, T.P1, t));
            diskOp = smooth(0.4, T.P1, t) * 0.6;
            haloOp = smooth(0.3, T.P1, t) * 0.5;
        } else if (t < T.P4) {
            const g = smooth(T.P1, T.P4, t);
            coreScale = lerp(0.15, 1.0, g);
            diskScale = lerp(0.3, 1.5, g);
            diskOp = 0.9;
            haloOp = 0.8;
        } else if (t < T.P5) {
            // Collapse
            const g = smooth(T.P4, T.P4 + 0.25, t);
            coreScale = lerp(1.0, 0.001, g);
            diskScale = lerp(1.5, 0.001, g);
            diskOp = 1 - g;
            haloOp = 1 - g;
        } else {
            coreScale = diskScale = diskOp = haloOp = 0;
        }
        v.core.scale.setScalar(Math.max(0.001, coreScale));
        v.disk.scale.setScalar(Math.max(0.001, diskScale));
        v.disk.rotation.z += dt * 2.5;
        v.disk.material.uniforms.uTime.value = t;
        v.disk.material.uniforms.uOpacity.value = diskOp;
        v.halo.material.opacity = haloOp;
        v.halo.scale.setScalar(0.4 + diskScale * 0.8 + Math.sin(t * 12) * 0.03);

        // Orbiting matter spirals in as gravity ramps
        const op = (t < T.P5) ? smooth(0.3, T.P1, t) * (1 - smooth(T.P4, T.P5, t)) : 0;
        v.orbitPts.material.opacity = op;
        if (op <= 0) return;
        const pull = smooth(T.P2, T.P4, t);
        const accel = 1 + smooth(T.P3, T.P4, t) * 6;
        const arr = v.orbitGeo.attributes.position.array;
        for (let i = 0; i < v.orbit.length; i++) {
            const o = v.orbit[i];
            o.angle += o.speed * dt * accel;
            o.radius = lerp(o.baseR, 0.06, pull) * (0.9 + 0.1 * Math.sin(t * 5 + i));
            arr[i * 3] = fx._hole.x + Math.cos(o.angle) * o.radius;
            arr[i * 3 + 1] = fx._hole.y + o.yOff * (1 - pull) + 0.05;
            arr[i * 3 + 2] = fx._hole.z + Math.sin(o.angle) * o.radius;
        }
        v.orbitGeo.attributes.position.needsUpdate = true;
    },

    balls(fx, t, dt) {
        const pull = smooth(T.P2, T.P4, t);
        for (const b of fx._ballState) {
            if (!b.mesh.parent) continue;
            if (t < T.P2) {
                // Phase 1: nearby balls lift slightly
                const near = clamp(1 - b.baseRadius / 0.8, 0, 1);
                b.mesh.position.y = b.y0 + Math.sin(t * 8) * 0.02 * near * smooth(0, T.P1, t);
            } else {
                // Pull inward + spiral + sink toward the hole
                b.angle += dt * (1.5 + pull * 8);
                b.radius = lerp(b.baseRadius, 0.08, pull);
                b.mesh.position.x = fx._hole.x + Math.cos(b.angle) * b.radius;
                b.mesh.position.z = fx._hole.z + Math.sin(b.angle) * b.radius;
                b.mesh.position.y = lerp(b.y0, fx._hole.y, pull * 0.7);
                b.mesh.rotation.x += dt * 10; b.mesh.rotation.y += dt * 12;
            }
        }
    },
};

// ---------------------------------------------
// Void Cyclone (cyclone) yardımcıları — mor/mavi/beyaz palet + ucuz 2D noise
// Konsept: _assets_src/finishers/new_finishers/cosmic-tornado_2.html
// ---------------------------------------------
const VC_GLSL = `
vec3 vcPalette(float t){
    vec3 p = vec3(0.61, 0.24, 1.00);
    vec3 b = vec3(0.24, 0.48, 1.00);
    vec3 w = vec3(0.96, 0.93, 1.00);
    return t < 0.5 ? mix(p, b, t*2.0) : mix(b, w, (t-0.5)*2.0);
}
float vcHash(float n){ return fract(sin(n)*43758.5453123); }
float vcNoise(vec2 x){
    vec2 i = floor(x), f = fract(x);
    f = f*f*(3.0-2.0*f);
    float n = i.x + i.y*57.0;
    return mix(mix(vcHash(n), vcHash(n+1.0), f.x),
               mix(vcHash(n+57.0), vcHash(n+58.0), f.x), f.y);
}`;

// Hortumun tüm katmanları aynı parametre setiyle sürülür (v.uni listesine kaydolur)
function makeVoidUniforms() {
    return {
        uTime: { value: 0 }, uHeight: { value: 0 }, uRadius: { value: 0.1 },
        uSpin: { value: 0.4 }, uCollapse: { value: 0 }, uBurst: { value: 0 },
        uDissolve: { value: 0 }, uGlow: { value: 0.5 },
    };
}

// =====================================================
// 🌪️ CYCLONE — a rising vortex sweeps the balls upward
// =====================================================
// Görsel tasarım _assets_src/finishers/new_finishers/cosmic-tornado_2.html
// konseptinden port edildi ("Void Cyclone", mobil bütçeyle). Kamera sistemi
// ESKİ: host faz kamerası + kasırganın focus yükselmesi aynen. Demo akışı
// host'a eşlendi: zemin girdabı → huni doğumu → maksimum dönüş → ÇÖKÜŞ
// (host FREEZE'i = enerji içeri emilmiş halde asılı kalır, donmuş yıldırımlarla)
// → P4'te Void Burst (küresel dalga + halka serisi) → dağılma. Tüm katmanlar
// uTime=t ile GPU-güdümlü → FREEZE'de kendiliğinden donar; CPU birikimleri
// (koni dönüşü/ark ömrü/halka yaşı) sdt ile donar. Ölçek: demo birimleri
// v.g grup ölçeği 0.2 ile masaya oturur (H 7.2→1.44m).
const cyclone = {
    icon: '🌪️',
    name: 'Kasırga',
    desc: 'Cepten kozmik boşluk hortumu yükselir — çöker ve Void Burst ile patlar.',
    title: 'VOID CYCLONE',
    textGrad: 'linear-gradient(90deg,#c9a6ff,#f2ecff,#8a5cff,#ffffff,#c9a6ff)',
    textGlow: '0 0 30px rgba(170,110,255,0.75),0 0 60px rgba(120,60,255,0.5)',
    lens: 0.3,
    // Ses: dönen boşluk hortumu ulumasi (loop, build boyunca).
    sfx: { loop: 'finisher-cyclone-loop' },
    shock: [0xffffff, 0xc9a6ff, 0x8a5cff],
    burstPalette: [
        [0.61, 0.24, 1.0], [0.24, 0.48, 1.0], [0.96, 0.93, 1.0], [0.75, 0.55, 1.0], [1.0, 1.0, 1.0],
    ],
    dustColor: 0xc9b8ff,

    build(fx) {
        const v = fx.v, hole = fx._hole;
        v._lastT = 0;
        v._ringTimer = 0.6;
        v._burstRings = 0;
        v.uni = [];

        // Demo-birimli katmanlar bu grupta; 0.2 ölçek masaya oturtur
        v.g = new THREE.Group();
        v.g.position.copy(hole);
        v.g.scale.setScalar(0.2);
        fx.group.add(v.g);

        // --- KATMAN 1a: pırıltı tozu (spiral akış tamamen vertex shader'da) ---
        {
            const N = 900;
            const pos = new Float32Array(N * 3);
            const seed = new Float32Array(N * 3);
            const size = new Float32Array(N);
            for (let i = 0; i < N; i++) {
                seed[i * 3] = Math.random(); seed[i * 3 + 1] = Math.random(); seed[i * 3 + 2] = Math.random();
                size[i] = 0.35 + Math.random() * 1.15;
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
            geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
            const uni = makeVoidUniforms(); v.uni.push(uni);
            v.dust = new THREE.Points(geo, new THREE.ShaderMaterial({
                uniforms: uni, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
                vertexShader: VC_GLSL + `
                    uniform float uTime, uHeight, uRadius, uSpin, uCollapse, uBurst, uDissolve, uGlow;
                    attribute vec3 aSeed; attribute float aSize;
                    varying vec3 vColor; varying float vAlpha;
                    void main(){
                        float H = 7.2;
                        float baseAng = aSeed.x * 6.28318;
                        float speed = 0.55 + aSeed.y * 2.1;
                        float ang = baseAng + uTime * speed * uSpin * 1.6;
                        float h01 = fract(aSeed.z + uTime * 0.055 * (0.4 + aSeed.y));
                        float coneR = mix(0.5, 2.75, pow(h01, 1.8));   // huni: altta dar, üstte geniş
                        float rJit = 0.55 + 0.75 * fract(aSeed.x * 7.31 + aSeed.z * 3.17);
                        float r = coneR * uRadius * rJit;
                        r += 0.22 * sin(uTime*2.3 + aSeed.x*21.0 + h01*9.0) * uRadius;   // organik nefes
                        float y = h01 * H * uHeight + 0.05;
                        r *= (1.0 - uCollapse * 0.965);                // çöküş: merkeze emilme
                        y *= (1.0 - uCollapse * 0.92);
                        vec3 p = vec3(cos(ang)*r, y, sin(ang)*r);
                        p.x += 0.09 * sin(uTime*3.1 + aSeed.z*33.0) * uRadius;
                        p.z += 0.09 * cos(uTime*2.8 + aSeed.y*29.0) * uRadius;
                        if (uBurst > 0.001) {                          // patlama: küresel dalga
                            float wave = 0.55 + 0.75 * fract(aSeed.z * 5.7);
                            float lift = (aSeed.y - 0.35) * 1.4;
                            vec3 dir = normalize(vec3(cos(baseAng), lift, sin(baseAng)));
                            p = dir * uBurst * 10.5 * wave + vec3(0.0, 1.3, 0.0) * uBurst;
                            p.y += uDissolve * (aSeed.x - 0.5) * 2.0;
                        }
                        vec4 mv = modelViewMatrix * vec4(p, 1.0);
                        gl_Position = projectionMatrix * mv;
                        gl_PointSize = aSize * (0.7 + uGlow) * (14.0 / -mv.z);
                        vColor = mix(vcPalette(fract(aSeed.y * 0.9 + h01 * 0.55)), vec3(1.0), 0.45);
                        float a = 0.5 * smoothstep(0.0, 0.14, uRadius + uBurst);
                        float survivor = step(0.94, aSeed.x);          // %6'sı mor nokta olarak kalır
                        a *= mix(1.0 - uDissolve, 1.0 - uDissolve*0.35, survivor);
                        vAlpha = a;
                    }`,
                fragmentShader: `
                    varying vec3 vColor; varying float vAlpha;
                    void main(){
                        float d = length(gl_PointCoord - 0.5);
                        float a = smoothstep(0.5, 0.02, d) * vAlpha;
                        if (a < 0.003) discard;
                        gl_FragColor = vec4(vColor * (1.0 + smoothstep(0.25, 0.0, d)), a);
                    }`,
            }));
            v.dust.frustumCulled = false;
            v.g.add(v.dust);
        }

        // --- KATMAN 1b: rüzgar iplikleri (spiral yol boyu enerji çizgileri) ---
        {
            const STREAKS = 1200, SEGS = 5, VPS = SEGS * 2;
            const total = STREAKS * VPS;
            const pos = new Float32Array(total * 3);
            const seed = new Float32Array(total * 3);
            const aT = new Float32Array(total);
            for (let i = 0; i < STREAKS; i++) {
                const s0 = Math.random(), s1 = Math.random(), s2 = Math.random();
                for (let k = 0; k < SEGS; k++) {
                    for (let e = 0; e < 2; e++) {
                        const vi = i * VPS + k * 2 + e;
                        seed[vi * 3] = s0; seed[vi * 3 + 1] = s1; seed[vi * 3 + 2] = s2;
                        aT[vi] = (k + e) / SEGS;   // 0 = baş (parlak), 1 = kuyruk (sönük)
                    }
                }
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
            geo.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
            const uni = makeVoidUniforms(); v.uni.push(uni);
            v.streaks = new THREE.LineSegments(geo, new THREE.ShaderMaterial({
                uniforms: uni, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
                vertexShader: `
                    uniform float uTime, uHeight, uRadius, uSpin, uCollapse, uBurst, uDissolve, uGlow;
                    attribute vec3 aSeed; attribute float aT;
                    varying vec3 vColor; varying float vAlpha;
                    vec3 pathPos(float tt, float h01, float bp){
                        float H = 7.2;
                        float baseAng = aSeed.x * 6.28318;
                        float speed = 0.55 + aSeed.y * 2.1;
                        float ang = baseAng + tt * speed * uSpin * 1.6;
                        float coneR = mix(0.5, 2.75, pow(h01, 1.8));
                        float rJit = 0.6 + 0.65 * fract(aSeed.x*7.31 + aSeed.z*3.17);
                        float r = coneR * uRadius * rJit;
                        r += 0.18 * sin(tt*2.3 + aSeed.x*21.0 + h01*9.0) * uRadius;
                        float y = h01 * H * uHeight + 0.05;
                        r *= (1.0 - uCollapse * 0.965);
                        y *= (1.0 - uCollapse * 0.92);
                        vec3 p = vec3(cos(ang)*r, y, sin(ang)*r);
                        if (bp > 0.0001) {   // patlama: iplikler radyal çizgilere dönüşür
                            float wave = 0.55 + 0.75 * fract(aSeed.z * 5.7);
                            float lift = (aSeed.y - 0.35) * 1.4;
                            vec3 dir = normalize(vec3(cos(baseAng), lift, sin(baseAng)));
                            p = dir * bp * 10.5 * wave + vec3(0.0, 1.3, 0.0) * bp;
                        }
                        return p;
                    }
                    void main(){
                        // iplik uzunluğu zaman farkından → dönüş hızlandıkça doğal uzar
                        float trailTime = 0.10 + 0.10 * aSeed.y;
                        float tt = uTime - aT * trailTime;
                        float hRate = 0.05 * (0.4 + aSeed.y);
                        float hRawHead = aSeed.z + uTime * hRate;
                        float hRaw = aSeed.z + tt * hRate;
                        float h01 = fract(hRaw);
                        float bp = max(0.0, uBurst - aT * 0.10);
                        vec3 p = pathPos(tt, h01, bp);
                        vec4 mv = modelViewMatrix * vec4(p, 1.0);
                        gl_Position = projectionMatrix * mv;
                        vec3 mist = vec3(0.86, 0.88, 1.00);
                        vec3 viol = vec3(0.70, 0.52, 1.00);
                        vec3 ice  = vec3(0.52, 0.68, 1.00);
                        float ct = fract(aSeed.y * 1.7 + h01 * 0.4);
                        vec3 base = ct < 0.5 ? mix(viol, ice, ct*2.0) : mix(ice, mist, (ct-0.5)*2.0);
                        vColor = mix(base, vec3(1.0), (1.0 - aT) * 0.30);
                        float a = (1.0 - aT);
                        a *= 0.22 + 0.30 * uGlow;
                        a *= smoothstep(0.0, 0.14, uRadius + uBurst);
                        a *= (1.0 - uDissolve);
                        if (floor(hRawHead) != floor(hRaw)) a = 0.0;   // sarma çizgi hatasını gizle
                        a *= 0.55 + 0.45 * smoothstep(0.05, 0.4, uHeight + uBurst);
                        vAlpha = a;
                    }`,
                fragmentShader: `
                    varying vec3 vColor; varying float vAlpha;
                    void main(){
                        if (vAlpha < 0.004) discard;
                        gl_FragColor = vec4(vColor, vAlpha);
                    }`,
            }));
            v.streaks.frustumCulled = false;
            v.g.add(v.streaks);
        }

        // --- KATMAN 2-3: spiral enerji koni katmanları (çekirdek/orta/dış) ---
        const mkCone = (radiusScale, opacityMul, twistDir, bandCount, speedMul, brightness) => {
            const geo = new THREE.CylinderGeometry(2.55 * radiusScale, 0.5 * radiusScale, 1, 48, 24, true);
            geo.translate(0, 0.5, 0);
            const uni = makeVoidUniforms(); v.uni.push(uni);
            const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
                uniforms: uni, transparent: true, depthWrite: false, side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
                vertexShader: VC_GLSL + `
                    uniform float uTime, uSpin, uRadius, uHeight;
                    varying vec2 vUv; varying vec3 vN, vV;
                    void main(){
                        vUv = uv;
                        vec3 p = position;
                        float ang = atan(p.z, p.x);
                        float wob = 1.0 + 0.09 * sin(ang*3.0 + uv.y*9.0 + uTime*3.2)
                                        + 0.05 * sin(ang*7.0 - uv.y*14.0 - uTime*4.7);
                        float cur = mix(0.5, 2.55, uv.y);              // huni eğrisi: içbükey profil
                        float des = mix(0.45, 2.65, pow(uv.y, 1.8));
                        float funnel = des / cur;
                        p.x *= wob * funnel; p.z *= wob * funnel;
                        vec4 mv = modelViewMatrix * vec4(p, 1.0);
                        vN = normalize(normalMatrix * normal);
                        vV = normalize(-mv.xyz);
                        gl_Position = projectionMatrix * mv;
                    }`,
                fragmentShader: VC_GLSL + `
                    uniform float uTime, uSpin, uGlow, uDissolve, uCollapse;
                    varying vec2 vUv; varying vec3 vN, vV;
                    void main(){
                        float twist = vUv.y * ${(twistDir * 4.0).toFixed(1)};
                        float band = 0.5 + 0.5 * sin((vUv.x * ${bandCount.toFixed(1)} + twist
                                     - uTime * ${speedMul.toFixed(2)} * (0.8 + uSpin)) * 6.28318);
                        float n = vcNoise(vec2(vUv.x*8.0 + uTime*0.6, vUv.y*10.0 - uTime*1.4));
                        float n2 = vcNoise(vec2(vUv.x*16.0 - uTime*1.1, vUv.y*22.0 - uTime*2.2));
                        float e = pow(band, 2.0) * (0.30 + 0.60*n + 0.35*n2);
                        float fres = pow(1.0 - abs(dot(vN, vV)), 2.2);
                        float vert = smoothstep(1.0, 0.75, vUv.y) * smoothstep(0.0, 0.12, vUv.y);
                        vec3 col = mix(vcPalette(clamp(e*0.85 + fres*0.5, 0.0, 1.0)), vec3(1.0), 0.18);
                        float a = (e * 0.60 + fres * 0.50) * vert * ${opacityMul.toFixed(2)} * uGlow * ${brightness.toFixed(2)};
                        a *= (1.0 - uDissolve);
                        gl_FragColor = vec4(col, a);
                    }`,
            }));
            v.g.add(mesh);
            return mesh;
        };
        v.cones = [
            [mkCone(0.42, 1.35, 1.0, 5.0, 2.6, 1.5), 2.6],    // parlak çekirdek sarmalı
            [mkCone(0.78, 0.85, -1.0, 4.0, 1.7, 1.0), -1.55], // orta katman (ters yön)
            [mkCone(1.12, 0.5, 1.0, 3.0, 1.05, 0.8), 0.95],   // şeffaf dış kabuk
        ];

        // --- KATMAN 4: plazma şeritleri (hortum etrafında dönen tüpler) ---
        v.ribbons = [];
        for (let i = 0; i < 4; i++) {
            const pts = [];
            const turns = 2.2 + Math.random() * 1.2;
            const phase = Math.random() * Math.PI * 2;
            for (let j = 0; j <= 60; j++) {
                const tt = j / 60;
                const a = phase + tt * Math.PI * 2 * turns;
                const r = (0.62 + 2.25 * Math.pow(tt, 1.8)) * (1.06 + Math.sin(tt * 9 + phase) * 0.05);
                pts.push(new THREE.Vector3(Math.cos(a) * r, tt * 7.2, Math.sin(a) * r));
            }
            const mesh = new THREE.Mesh(
                new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 100, 0.045 + Math.random() * 0.035, 6, false),
                new THREE.MeshBasicMaterial({
                    color: i % 2 ? 0x7ba3ff : 0xb578ff, transparent: true, opacity: 0,
                    blending: THREE.AdditiveBlending, depthWrite: false,
                })
            );
            mesh.userData = { speed: (0.8 + Math.random() * 1.2) * (i % 2 ? 1 : 1.35) };
            v.g.add(mesh);
            v.ribbons.push(mesh);
        }

        // --- KATMAN 5: elektrik arkları (enerji boyunca gezen yıldırımlar) ---
        v.arcs = [];
        for (let i = 0; i < 6; i++) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12 * 3), 3));
            const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
                color: 0xd9c8ff, transparent: true, opacity: 0,
                blending: THREE.AdditiveBlending, depthWrite: false,
            }));
            line.userData = { life: 0, ttl: 0.001 };
            line.frustumCulled = false;
            v.g.add(line);
            v.arcs.push(line);
        }

        // --- KATMAN 6: enerji içinde dönen kristaller ---
        v.crystals = [];
        for (let i = 0; i < 12; i++) {
            const m = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial({
                color: i % 3 === 0 ? 0xf2ecff : (i % 2 ? 0x9b3dff : 0x3d7bff),
                transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
            }));
            m.userData = {
                ang: Math.random() * Math.PI * 2,
                speed: 0.7 + Math.random() * 1.6,
                h: 0.1 + Math.random() * 0.85,
                size: 0.06 + Math.random() * 0.11,
                burstDir: new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6 - 0.1, Math.random() - 0.5).normalize(),
                burstDist: 5 + Math.random() * 8,
                spin: new THREE.Vector3(Math.random(), Math.random(), Math.random()).multiplyScalar(3),
            };
            v.g.add(m);
            v.crystals.push(m);
        }

        // --- KATMAN 7: şok halkaları havuzu + patlama şok küresi ---
        v.rings = [];
        for (let i = 0; i < 8; i++) {
            const m = new THREE.Mesh(
                new THREE.RingGeometry(0.88, 1.0, 64),
                new THREE.MeshBasicMaterial({
                    color: 0xc9a6ff, side: THREE.DoubleSide, transparent: true, opacity: 0,
                    blending: THREE.AdditiveBlending, depthWrite: false,
                })
            );
            m.rotation.x = -Math.PI / 2;
            m.userData = { active: false, age: 0, ttl: 1, maxR: 5, y: 0.04 };
            v.g.add(m);
            v.rings.push(m);
        }
        v.spawnVRing = (maxR, ttl, y, white) => {
            const r = v.rings.find(x => !x.userData.active);
            if (!r) return;
            r.userData = { ...r.userData, active: true, age: 0, ttl, maxR, y };
            r.material.color.setHex(0x9b3dff).lerp(new THREE.Color(0xffffff), white);
        };
        v.shockSphere = new THREE.Mesh(
            new THREE.SphereGeometry(1, 32, 24),
            new THREE.MeshBasicMaterial({
                color: 0xb794ff, transparent: true, opacity: 0,
                blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
            })
        );
        v.shockSphere.position.y = 1.2;
        v.shockSphere.visible = false;
        v.g.add(v.shockSphere);

        // --- KATMAN 8: glow (merkez kıvılcım + büyük yumuşak parlama + flaş) ---
        v.spark = new THREE.Sprite(new THREE.SpriteMaterial({
            map: fx._sprite, color: 0xd9c2ff, transparent: true,
            blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
        }));
        v.spark.position.y = 0.35;
        v.g.add(v.spark);
        v.bigGlow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: fx._sprite, color: 0x7a45e6, transparent: true,
            blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
        }));
        v.bigGlow.position.y = 2.4;
        v.g.add(v.bigGlow);
        v.flash = new THREE.Sprite(new THREE.SpriteMaterial({
            map: fx._sprite, color: 0xe8dcff, transparent: true,
            blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
        }));
        v.flash.position.y = 1.2;
        v.flash.scale.setScalar(20);
        v.g.add(v.flash);

        v._focus = new THREE.Vector3();
    },

    update(fx, t, dt) {
        const v = fx.v;
        const sdt = Math.max(0, Math.min(t - v._lastT, 0.05));   // FREEZE'de 0
        v._lastT = t;

        // --- parametreler (t'nin saf fonksiyonu; demo getParams eşlemesi) ---
        const collapse = smooth(5.0, 5.9, t);   // FREEZE pini 5.65 → yarı-çökmüş asılı kalır
        const P = {};
        P.height = t < T.P4 ? smooth(T.P1 + 0.2, T.P3, t) : 0;
        P.radius = (0.10 + smooth(0.5, T.P2, t) * 0.42 + smooth(T.P2, T.P3, t) * 0.48) * (1 - collapse * 0.94);
        P.spin = 0.35 + smooth(T.P1, T.P2, t) * 0.8 + smooth(T.P2, T.P3, t) * 0.8
               + smooth(T.P3, 5.0, t) * 1.1 + collapse * 2.2;
        if (t > T.P4) P.spin *= Math.max(0, 1 - (t - T.P4) / 0.8);
        P.collapse = collapse;
        P.burst = t < T.P4 ? 0 : easeOutC(clamp((t - T.P4) / 2.4, 0, 1));
        P.dissolve = smooth(T.P5 + 0.6, T.P6 - 0.4, t);
        const flicker = 0.85 + 0.15 * Math.sin(t * 23.0) * Math.sin(t * 7.7);
        P.glow = (0.45 + smooth(T.P1, T.P3, t) * 0.45 + smooth(T.P3, 5.0, t) * 0.35) * flicker;
        P.glow += (t > T.P4 && t < T.P4 + 0.5) ? (1 - (t - T.P4) / 0.5) * 2.2 : 0;
        P.glow *= (1 - P.dissolve * 0.92);

        for (const u of v.uni) {
            u.uTime.value = t;
            u.uHeight.value = P.height;
            u.uRadius.value = P.radius;
            u.uSpin.value = P.spin;
            u.uCollapse.value = P.collapse;
            u.uBurst.value = P.burst;
            u.uDissolve.value = P.dissolve;
            u.uGlow.value = P.glow;
        }

        // koni katmanları: farklı hızlarda katman katman dönüş (sdt → donar)
        const coneScaleR = P.radius * (1 - P.collapse * 0.96);
        const coneVis = P.height > 0.02 && P.burst < 0.02;
        for (const [cone, mul] of v.cones) {
            cone.visible = coneVis;
            cone.scale.set(Math.max(0.001, coneScaleR), Math.max(0.001, P.height * 7.2), Math.max(0.001, coneScaleR));
            cone.rotation.y += sdt * P.spin * mul;
        }

        // plazma şeritleri
        for (const r of v.ribbons) {
            const vis = P.height * (1 - P.collapse) * (1 - P.dissolve);
            r.visible = vis > 0.02;
            r.material.opacity = 0.5 * vis * Math.min(1, P.glow);
            r.scale.set(Math.max(0.001, coneScaleR), Math.max(0.001, P.height), Math.max(0.001, coneScaleR));
            r.rotation.y += sdt * P.spin * r.userData.speed;
        }

        // elektrik arkları (FREEZE'de ömür durur → DONMUŞ YILDIRIM)
        const arcsOn = (P.glow > 0.55 && P.burst < 0.05 && P.radius > 0.3) || (P.collapse > 0.15 && t < T.P4);
        for (const a of v.arcs) {
            a.userData.life -= sdt;
            if (a.userData.life <= 0) {
                if (arcsOn && Math.random() < 0.5 && sdt > 0) {
                    const h1 = Math.random() * P.height;
                    const h2 = Math.min(1, h1 + 0.15 + Math.random() * 0.3);
                    const a1 = Math.random() * Math.PI * 2;
                    const a2 = a1 + (Math.random() - 0.5) * 2.5;
                    const rAt = (h) => (0.55 + 2.1 * Math.pow(h, 1.8)) * P.radius * (1 - P.collapse * 0.95) * 1.05;
                    const A = new THREE.Vector3(Math.cos(a1) * rAt(h1), h1 * 7.2 * P.height, Math.sin(a1) * rAt(h1));
                    const B = new THREE.Vector3(Math.cos(a2) * rAt(h2), h2 * 7.2 * P.height, Math.sin(a2) * rAt(h2));
                    const attr = a.geometry.attributes.position;
                    for (let j = 0; j < 12; j++) {
                        const k = j / 11;
                        const p = A.clone().lerp(B, k);
                        const jag = Math.sin(k * Math.PI);   // uçlar sabit, orta titrek
                        attr.setXYZ(j,
                            p.x + (Math.random() - 0.5) * 0.45 * jag,
                            p.y + (Math.random() - 0.5) * 0.35 * jag,
                            p.z + (Math.random() - 0.5) * 0.45 * jag);
                    }
                    attr.needsUpdate = true;
                    a.userData.ttl = 0.09 + Math.random() * 0.14;
                    a.userData.life = a.userData.ttl;
                } else {
                    a.userData.life = 0.05 + Math.random() * 0.1;
                    a.material.opacity = 0;
                    continue;
                }
            }
            const k = clamp(a.userData.life / a.userData.ttl, 0, 1);
            a.material.opacity = arcsOn ? k * 0.95 : 0;
        }

        // kristaller
        for (const c of v.crystals) {
            const u = c.userData;
            u.ang += sdt * P.spin * u.speed;
            c.rotation.x += sdt * u.spin.x; c.rotation.y += sdt * u.spin.y; c.rotation.z += sdt * u.spin.z;
            let s = u.size * (0.85 + 0.3 * Math.sin(t * 5 + u.ang));
            let op;
            if (P.burst > 0.001) {   // kristaller dışarı fırlar
                c.position.set(
                    u.burstDir.x * P.burst * u.burstDist,
                    1.2 + u.burstDir.y * P.burst * u.burstDist,
                    u.burstDir.z * P.burst * u.burstDist);
                s *= (1 + P.burst * 1.6) * (1 - P.dissolve);
                op = (1 - P.dissolve) * 0.95;
            } else {
                const rr = (0.6 + 2.0 * Math.pow(u.h, 1.8)) * P.radius * (1 - P.collapse * 0.95) * 1.08;
                const y = u.h * 7.2 * P.height * (1 - P.collapse * 0.9) + 0.15 + 0.15 * Math.sin(t * 2.4 + u.ang * 2.0);
                c.position.set(Math.cos(u.ang) * rr, y, Math.sin(u.ang) * rr);
                op = smooth(0.15, 0.5, P.height) * 0.9;
                s *= (1 - P.collapse * 0.5);
            }
            c.scale.setScalar(Math.max(0.0001, s));
            c.material.opacity = op;
        }

        // şok halkaları: büyürken periyodik; patlamada seri dalga
        v._ringTimer -= sdt;
        if (t > T.P2 + 0.4 && t < 5.0 && P.height > 0.4 && v._ringTimer <= 0 && sdt > 0) {
            v.spawnVRing(3.4 + Math.random() * 1.4, 1.3, 0.05, 0.35);
            v._ringTimer = 1.15 + Math.random() * 0.5;
        }
        if (t >= T.P4) {
            const bt = t - T.P4;
            while (v._burstRings < 6 && bt > v._burstRings * 0.095) {
                const i = v._burstRings++;
                v.spawnVRing(7 + i * 2.2, 1.5 + i * 0.18, 0.05 + i * 0.35, 0.55);
            }
            v.flash.material.opacity = Math.max(0, 1 - bt / 1.1) * 0.85;
        }
        for (const r of v.rings) {
            const u = r.userData;
            if (!u.active) { r.material.opacity = 0; continue; }
            u.age += sdt;
            const k = u.age / u.ttl;
            if (k >= 1) { u.active = false; r.material.opacity = 0; continue; }
            r.scale.setScalar(0.15 + easeOutC(k) * u.maxR);
            r.position.y = u.y;
            r.material.opacity = (1 - k) * 0.85;
        }

        // patlama şok küresi
        if (P.burst > 0.001 && P.burst < 0.995) {
            v.shockSphere.visible = true;
            v.shockSphere.scale.setScalar(0.2 + P.burst * 11);
            v.shockSphere.material.opacity = (1 - P.burst) * 0.35;
        } else v.shockSphere.visible = false;

        // glow katmanı
        const sparkPulse = 0.8 + 0.25 * Math.sin(t * 17) + 0.1 * Math.sin(t * 41);
        let sparkS = 0.7 + smooth(0, T.P1, t) * 0.9 + smooth(T.P1, T.P2, t) * 0.8;
        sparkS *= (1 - P.collapse * 0.4);
        sparkS += P.collapse * 0.9;                     // içine çeken çekirdek parlar
        sparkS *= (1 - smooth(T.P4, T.P4 + 0.4, t));    // patlama anında yok olur
        v.spark.material.opacity = clamp(P.glow * sparkPulse, 0, 1) * (t < T.P4 ? 1 : 0);
        v.spark.scale.setScalar(Math.max(0.001, sparkS * 1.6));
        v.spark.position.y = 0.35 + P.height * 1.1;
        v.bigGlow.scale.setScalar(3 + P.radius * 7 + P.burst * 16);
        v.bigGlow.material.opacity = clamp(P.glow * 0.55, 0, 1) * (1 - P.dissolve);
        v.bigGlow.position.y = 1.2 + P.height * 1.6;
    },

    balls(fx, t, dt) {
        const pull = smooth(T.P2, T.P4, t);
        for (const b of fx._ballState) {
            if (!b.mesh.parent) continue;
            if (t < T.P2) {
                const near = clamp(1 - b.baseRadius / 0.8, 0, 1);
                b.mesh.position.y = b.y0 + Math.sin(t * 8) * 0.02 * near * smooth(0, T.P1, t);
            } else {
                // Swirl around the funnel while rising with it
                if (b._lift === undefined) b._lift = 0.35 + Math.random() * 0.85;
                b.angle += dt * (2.0 + pull * 9);
                b.radius = lerp(b.baseRadius, 0.18 + b._lift * 0.18, pull);
                b.mesh.position.x = fx._hole.x + Math.cos(b.angle) * b.radius;
                b.mesh.position.z = fx._hole.z + Math.sin(b.angle) * b.radius;
                b.mesh.position.y = b.y0 + pull * b._lift;
                b.mesh.rotation.x += dt * 9; b.mesh.rotation.y += dt * 14;
            }
        }
    },

    detonate(fx) {
        fx._spawnShockwave(0xc9a6ff, 0.12);   // Void Burst ek halkası
    },

    // Look slightly up so the rising funnel stays in frame (eski kamera hissi)
    focus(fx, t) {
        const v = fx.v;
        v._focus.set(fx._hole.x, fx._hole.y + 0.35 * smooth(T.P1, T.P3, t), fx._hole.z);
        return v._focus;
    },
};

// =====================================================
// ☄️ METEOR — "Apocalypse Meteor": lav damarlı kıyamet taşı
// Görsel tasarım _assets_src/finishers/new_finishers/apocalypse-meteor.html
// konseptinden port edildi (mobil bütçeyle: 3-oktav fbm, ~1000 parçacık).
// Kamera koreografisi ESKİ meteor'un beğenilen sistemi: host faz kamerası +
// focus kancası (taşı izle → çarpmaya yaklaşınca bakışı cebe süz) + masa
// titremesi AYNEN korundu. Tüm hareket t-güdümlü → host'un FREEZE anında taş,
// kuyruk ve kayalar gerçekten donar (demo'daki "çarpma sessizliği").
// =====================================================
const meteor = {
    icon: '☄️',
    name: 'Meteor',
    desc: 'Gökten lav damarlı kıyamet taşı düşer — ateş küresi, lav püskürmesi, kor yağmuru.',
    title: 'APOCALYPSE METEOR',
    textGrad: 'linear-gradient(90deg,#ffd27d,#ff9d5c,#fff3c4,#ff7a4d,#ffd27d)',
    textGlow: '0 0 30px rgba(255,170,80,0.7),0 0 60px rgba(255,90,40,0.5)',
    lens: 0.15,
    // Ses: görsel çarpma anında (T.P4, impact katmanlarının başladığı kare) çalınır;
    // dosyanın başındaki ~0.7s giriş `skip` ile atlanır (kulakla ölçüldü: vuruş
    // transient'i ~0.7. saniyede — atlanmazsa ses görselden geç kalıyordu).
    // Kuyruk detonasyon kaosuna gürleme olarak yayılır; uğultu prosedürel kalır.
    sfx: { oneshot: 'finisher-meteor', at: T.P4, skip: 0.7 },
    shock: [0xffffff, 0xffb35c, 0xff6a3d],
    burstPalette: [
        [1.0, 0.8, 0.4], [1.0, 0.55, 0.2], [1.0, 0.95, 0.7], [1.0, 0.3, 0.15], [0.55, 0.08, 0.02], [1.0, 1.0, 1.0],
    ],
    dustColor: 0xffc98a,   // falling embers

    build(fx) {
        const v = fx.v, hole = fx._hole;
        // Çoğunlukla tepeden — kamera (cebe park etmiş) düşüşü çerçeveleyebilsin
        v.spawn = hole.clone().add(new THREE.Vector3(1.6, 4.0, 1.0));
        v._lastT = 0;

        // --- gök taşı: çentikli çekirdek + plazma kabuk + halkalar + glow ---
        v.meteor = new THREE.Group();
        v.meteor.position.copy(v.spawn);
        v.meteor.visible = false;
        fx.group.add(v.meteor);

        const coreGeo = new THREE.IcosahedronGeometry(1, 4);
        {   // köşeli kırık yüzey: katmanlı deterministik "noise" displace (demo birebir)
            const p = coreGeo.attributes.position, w = new THREE.Vector3();
            for (let i = 0; i < p.count; i++) {
                w.fromBufferAttribute(p, i);
                const n1 = Math.sin(w.x * 3.1) * Math.cos(w.y * 2.7) * Math.sin(w.z * 3.7);
                const n2 = Math.sin(w.x * 7.3 + 1.7) * Math.sin(w.y * 6.1 + 0.4) * Math.cos(w.z * 5.9);
                const n3 = Math.sin(w.x * 15.0) * Math.cos(w.y * 13.0) * Math.sin(w.z * 17.0);
                const d = 1 + n1 * 0.28 + n2 * 0.14 + Math.max(0, n3) * 0.10;
                w.normalize().multiplyScalar(d);
                p.setXYZ(i, w.x, w.y, w.z);
            }
            coreGeo.computeVertexNormals();
        }
        v.coreMat = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 }, uHeat: { value: 0 } },
            vertexShader: NOISE_GLSL + `
                varying vec3 vN; varying vec3 vP; varying vec3 vW;
                void main(){
                    vN = normalMatrix * normal;
                    vP = position;
                    vec4 w = modelMatrix * vec4(position, 1.0);
                    vW = w.xyz;
                    gl_Position = projectionMatrix * viewMatrix * w;
                }`,
            fragmentShader: NOISE_GLSL + `
                varying vec3 vN; varying vec3 vP; varying vec3 vW;
                uniform float uTime; uniform float uHeat;
                void main(){
                    vec3 N = normalize(vN);
                    vec3 V = normalize(cameraPosition - vW);
                    // akan lav damarları: ridged noise, zamanla süzülür
                    float flow = uTime * 0.25;
                    float n = fbm(vP * 2.2 + vec3(0.0, -flow, flow * 0.6));
                    float ridge = 1.0 - abs(n);
                    float cracks = smoothstep(0.82, 0.98, ridge);
                    float veins = smoothstep(0.62, 0.92, ridge);
                    float rockN = fbm(vP * 5.0);
                    vec3 rock = mix(vec3(0.05, 0.03, 0.025), vec3(0.13, 0.07, 0.05), rockN * 0.5 + 0.5);
                    vec3 magma = mix(vec3(1.0, 0.25, 0.0), vec3(1.0, 0.85, 0.35), cracks);
                    float pulse = 0.75 + 0.25 * sin(uTime * 6.0 + vP.y * 8.0);
                    vec3 col = rock + magma * (veins * 0.6 + cracks * 1.9) * uHeat * pulse;
                    // atmosfer sürtünmesi: fresnel rim
                    float fres = pow(1.0 - max(dot(N, V), 0.0), 2.4);
                    col += vec3(1.0, 0.45, 0.1) * fres * uHeat * 1.6;
                    float diff = max(dot(N, normalize(vec3(0.4, 0.7, 0.6))), 0.0);
                    col += rock * diff * 0.6;
                    gl_FragColor = vec4(col, 1.0);
                }`,
        });
        v.core = new THREE.Mesh(coreGeo, v.coreMat);
        v.meteor.add(v.core);

        // plazma kabuğu — ince enerji katmanı (BackSide fresnel)
        v.shellMat = new THREE.ShaderMaterial({
            transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
            uniforms: { uTime: { value: 0 }, uHeat: { value: 0 } },
            vertexShader: NOISE_GLSL + `
                varying float vF; varying vec3 vP; uniform float uTime;
                void main(){
                    vP = position;
                    float wob = snoise(position * 2.0 + uTime * 1.5) * 0.06;
                    vec3 p = position * (1.18 + wob);
                    vec4 w = modelMatrix * vec4(p, 1.0);
                    vec3 N = normalize(normalMatrix * normal);
                    vec3 V = normalize((viewMatrix * w).xyz);
                    vF = pow(abs(dot(N, V)), 1.6);
                    gl_Position = projectionMatrix * viewMatrix * w;
                }`,
            fragmentShader: NOISE_GLSL + `
                varying float vF; varying vec3 vP; uniform float uTime; uniform float uHeat;
                void main(){
                    float n = fbm(vP * 3.0 + vec3(0.0, -uTime * 2.2, 0.0));
                    vec3 col = mix(vec3(1.0, 0.35, 0.05), vec3(1.0, 0.8, 0.4), n * 0.5 + 0.5);
                    float a = vF * uHeat * (0.35 + 0.25 * n);
                    gl_FragColor = vec4(col, a);
                }`,
        });
        v.shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), v.shellMat);
        v.meteor.add(v.shell);

        // plazma halkaları — final iniş'te belirir
        v.rings = [];
        for (let i = 0; i < 3; i++) {
            const ring = new THREE.Mesh(
                new THREE.TorusGeometry(1.5 + i * 0.45, 0.045, 6, 48),
                new THREE.MeshBasicMaterial({
                    color: i === 1 ? 0xffcc66 : 0xff7722, transparent: true, opacity: 0,
                    blending: THREE.AdditiveBlending, depthWrite: false,
                })
            );
            ring.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.6;
            v.meteor.add(ring);
            v.rings.push(ring);
        }

        v.glow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: fx._sprite, color: 0xffaa55, transparent: true,
            blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
        }));
        v.meteor.add(v.glow);

        // Cepteki nabızlı "geliyor" işareti (eski — oynanış okunabilirliği)
        v.mark = new THREE.Mesh(
            new THREE.RingGeometry(0.12, 0.16, 48),
            new THREE.MeshBasicMaterial({
                color: 0xff8844, transparent: true, opacity: 0, side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending, depthWrite: false,
            })
        );
        v.mark.position.copy(hole);
        v.mark.position.y += 0.02;
        v.mark.rotation.x = -Math.PI / 2;
        fx.group.add(v.mark);

        // --- parçacık katmanları ---
        v.tail = makeFirePoints(550, fx._sprite, THREE.AdditiveBlending);   // ateş kuyruğu + kıvılcım + kırıntı
        v.smoke = makeFirePoints(140, fx._sprite, THREE.NormalBlending);    // koyu duman (iz + sütun)
        v.erup = makeFirePoints(260, fx._sprite, THREE.AdditiveBlending);   // lav spreyi + püskürme sütunları
        v.ember = makeFirePoints(90, fx._sprite, THREE.AdditiveBlending);   // kor tanecikleri
        for (const s of [v.tail, v.smoke, v.erup, v.ember]) fx.group.add(s.pts);

        // --- impact katmanları (görünmez kurulur, çarpmada oynar) ---
        v.boomGlow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: fx._sprite, color: 0xffffff, transparent: true,
            blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
        }));
        v.boomGlow.position.copy(hole);
        v.boomGlow.position.y += 0.05;
        fx.group.add(v.boomGlow);

        // turuncu ateş küresi — noise ile genişleyen küre
        v.fireMat = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
            uniforms: { uTime: { value: 0 }, uAge: { value: 0 } },
            vertexShader: NOISE_GLSL + `
                varying vec3 vP; uniform float uTime; uniform float uAge;
                void main(){
                    vP = position;
                    float d = snoise(position * 1.6 + uTime * 1.2) * 0.35 * (0.3 + uAge);
                    vec3 p = position * (1.0 + d);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
                }`,
            fragmentShader: NOISE_GLSL + `
                varying vec3 vP; uniform float uTime; uniform float uAge;
                void main(){
                    float n = fbm(vP * 2.0 + vec3(0.0, uTime * 1.5, 0.0));
                    vec3 hot = vec3(1.0, 0.95, 0.7), mid = vec3(1.0, 0.45, 0.05), dark = vec3(0.5, 0.06, 0.0);
                    float m = clamp(n * 0.5 + 0.5 + uAge * 0.8, 0.0, 1.0);
                    vec3 col = mix(hot, mix(mid, dark, uAge), m);
                    float a = (1.0 - uAge) * (0.85 + 0.15 * n);
                    gl_FragColor = vec4(col * 2.0, a);
                }`,
        });
        v.fireball = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3), v.fireMat);
        v.fireball.position.copy(hole);
        v.fireball.position.y += 0.04;
        v.fireball.visible = false;
        fx.group.add(v.fireball);

        // masaya yayılan plazma enerji halkası (soğuk kontrast)
        v.ptorus = new THREE.Mesh(
            new THREE.TorusGeometry(1, 0.05, 8, 64),
            new THREE.MeshBasicMaterial({
                color: 0x77ccff, transparent: true, opacity: 0,
                blending: THREE.AdditiveBlending, depthWrite: false,
            })
        );
        v.ptorus.position.copy(hole);
        v.ptorus.position.y += 0.06;
        v.ptorus.rotation.x = Math.PI / 2.3;
        v.ptorus.visible = false;
        fx.group.add(v.ptorus);

        // kopan/patlayan kayalar — tek instanced mesh
        v.rocks = new THREE.InstancedMesh(
            new THREE.DodecahedronGeometry(0.022, 0),
            new THREE.MeshBasicMaterial({ color: 0x33200f }),
            26
        );
        v.rocks.frustumCulled = false;
        fx.group.add(v.rocks);
        v.rockState = [];
        for (let i = 0; i < 26; i++) {
            v.rockState.push({
                alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(),
                r: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
                rs: 1 + Math.random() * 4, s: 0.5 + Math.random() * 1.1, life: 0,
            });
        }
        v.dummy = new THREE.Object3D();
        v.rockFloor = hole.y - 0.06;
        meteorRockUpdate(v, 0);

        v._focus = new THREE.Vector3();
    },

    update(fx, t, dt) {
        const v = fx.v, hole = fx._hole;
        // sim-dt t'den türetilir → host FREEZE anında 0 olur, her şey gerçekten donar
        const sdt = Math.max(0, Math.min(t - v._lastT, 0.05));
        v._lastT = t;

        const start = T.P2 * 0.7;
        const u = clamp((t - start) / (T.P4 - start), 0, 1);
        const prog = easeInC(u) * 0.85 + u * 0.15;   // kübik ivme — asla lineer değil
        const falling = t >= start && t < T.P4;

        if (t >= 0.5 && t < T.P4) {
            v.meteor.visible = true;
            if (falling) v.meteor.position.lerpVectors(v.spawn, hole, prog);
            const scale = t < start
                ? 0.012 + smooth(0.5, start, t) * 0.03      // uzak titreşen yıldız
                : 0.042 + easeInC(u) * 0.17;                // deve dönüşür
            v.meteor.scale.setScalar(scale);
            v.core.rotation.set(t * 1.1, t * 1.7, 0);       // t-güdümlü → donmada durur
            v.shell.rotation.copy(v.core.rotation);
            v.meteor.rotation.z = Math.sin(t * 1.7) * 0.08;

            const heat = 0.3 + smooth(start, T.P3, t) * 1.3;
            v.coreMat.uniforms.uTime.value = t;
            v.coreMat.uniforms.uHeat.value = heat;
            v.shellMat.uniforms.uTime.value = t;
            v.shellMat.uniforms.uHeat.value = smooth(start, T.P3, t) * 1.2;

            const flick = 0.7 + 0.3 * Math.sin(t * 17) * Math.sin(t * 7.3);
            v.glow.material.opacity = t < start ? smooth(0.5, 1.4, t) * 0.9 * flick : 0.55 + 0.35 * flick;
            v.glow.scale.setScalar(t < start ? 14 : 3.2 + prog * 1.8);

            const ringK = smooth(T.P3 + 0.4, T.P4, t);      // plazma halkaları: final iniş
            for (let i = 0; i < v.rings.length; i++) {
                const r = v.rings[i];
                r.material.opacity = ringK * (0.55 - i * 0.12) * (0.7 + 0.3 * Math.sin(t * 9 + i * 2));
                r.rotation.z = t * (1.5 + i);
                r.scale.setScalar(1 + 0.12 * Math.sin(t * 5 + i * 2.1));
            }
            v.mark.material.opacity = smooth(start, T.P3, t) * (0.35 + 0.3 * Math.sin(t * 8));
            v.mark.scale.setScalar(1 + 0.15 * Math.sin(t * 8));
        } else if (t >= T.P4) {
            v.meteor.visible = false;
            v.mark.material.opacity = 0;
        }

        // --- düşüş katmanları: ateş kuyruğu · duman izi · kıvılcım · kopan kaya ---
        if (falling && sdt > 0) {
            const scale = v.meteor.scale.x;
            const back = _tmpV.copy(v.spawn).sub(hole).normalize();   // hareketin tersi
            let n = spawnCount(60 + 260 * u, sdt);
            while (n--) {
                const off = scale * (0.5 + Math.random() * 2.2);
                const sp = 0.6 + Math.random() * 1.4;
                v.tail.emit(
                    v.meteor.position.x + back.x * off + (Math.random() - 0.5) * scale,
                    v.meteor.position.y + back.y * off + (Math.random() - 0.5) * scale,
                    v.meteor.position.z + back.z * off + (Math.random() - 0.5) * scale,
                    back.x * sp + (Math.random() - 0.5) * 0.3,
                    back.y * sp + (Math.random() - 0.5) * 0.3,
                    back.z * sp + (Math.random() - 0.5) * 0.3,
                    0.35 + Math.random() * 0.55, (0.35 + Math.random() * 0.85) * scale + 0.012,
                    1, 0.75 + Math.random() * 0.2, 0.2 + Math.random() * 0.25,
                    { sw: Math.random() * 6.28, swS: 2 + Math.random() * 4 }
                );
            }
            if (Math.random() < sdt * 18 * u) {   // duman izi
                v.smoke.emit(
                    v.meteor.position.x + back.x * scale * 2 + (Math.random() - 0.5) * scale,
                    v.meteor.position.y + back.y * scale * 2,
                    v.meteor.position.z + back.z * scale * 2,
                    back.x * 0.4, back.y * 0.4, back.z * 0.4,
                    1.2 + Math.random(), 0.5 * scale + 0.04, 0.10, 0.07, 0.06, null
                );
            }
            if (u > 0.35 && Math.random() < sdt * 30) {   // kıvılcımlar
                v.tail.emit(v.meteor.position.x, v.meteor.position.y, v.meteor.position.z,
                    (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3,
                    0.15 + Math.random() * 0.25, 0.01 + Math.random() * 0.02, 1, 0.95, 0.6, null);
            }
            if (u > 0.4 && Math.random() < sdt * 6) {     // kopan kayalar
                const dir = _tmpV.copy(hole).sub(v.spawn).normalize();
                meteorRockSpawn(v, v.meteor.position, new THREE.Vector3(
                    dir.x * (0.4 + u) + (Math.random() - 0.5) * 1.2,
                    dir.y * (0.4 + u) + (Math.random() - 0.5) * 1.2,
                    dir.z * (0.4 + u) + (Math.random() - 0.5) * 0.8
                ), 1 + Math.random() * 1.2);
            }
        }

        // --- impact katmanları ---
        if (t >= T.P4) {
            const et = t - T.P4;
            // 1) beyaz ışık
            v.boomGlow.material.opacity = Math.max(0, 1.15 - et);
            v.boomGlow.scale.setScalar(0.3 + easeOutC(clamp(et / 1.1, 0, 1)) * 3.4);
            // 2) ateş küresi
            const fAge = clamp(et / 1.5, 0, 1);
            v.fireball.visible = fAge < 1;
            if (v.fireball.visible) {
                v.fireball.scale.setScalar(0.08 + easeOutC(fAge) * 0.95);
                v.fireMat.uniforms.uAge.value = fAge;
                v.fireMat.uniforms.uTime.value = t;
            }
            // 3) masaya yayılan plazma halkası
            const pAge = clamp(et / 1.7, 0, 1);
            v.ptorus.visible = pAge < 1;
            if (v.ptorus.visible) {
                v.ptorus.scale.setScalar(0.1 + easeOutC(pAge) * 2.4);
                v.ptorus.material.opacity = (1 - pAge) * 0.7;
            }

            if (sdt > 0) {
                // lav püskürme sütunları (kraterden, gitgide söner)
                if (et > 0.45 && t < T.P6 - 1.2) {
                    const strength = 1 - smooth(T.P5, T.P6 - 1.2, t) * 0.85;
                    let n = spawnCount(46 * strength, sdt);
                    while (n--) {
                        const a = Math.random() * Math.PI * 2, r = Math.random() * 0.12;
                        const swirl = Math.random() < 0.4;
                        v.erup.emit(
                            hole.x + Math.cos(a) * r, hole.y + Math.random() * 0.05, hole.z + Math.sin(a) * r,
                            (Math.random() - 0.5) * 0.3, (1.1 + Math.random() * 1.6) * strength, (Math.random() - 0.5) * 0.3,
                            0.7 + Math.random() * 0.8, 0.03 + Math.random() * 0.05,
                            1, 0.35 + Math.random() * 0.4, 0.02 + Math.random() * 0.12,
                            swirl ? { sw: Math.random() * 6.28, swS: 3 + Math.random() * 4, g: 0.9 } : { g: 0.9 }
                        );
                    }
                    if (Math.random() < sdt * 9) {   // yükselen duman sütunu
                        v.smoke.emit(
                            hole.x + (Math.random() - 0.5) * 0.3, hole.y + 0.1 + Math.random() * 0.2, hole.z + (Math.random() - 0.5) * 0.3,
                            (Math.random() - 0.5) * 0.08, 0.35 + Math.random() * 0.5, (Math.random() - 0.5) * 0.08,
                            1.8 + Math.random() * 1.2, 0.12 + Math.random() * 0.1, 0.09, 0.065, 0.055, null
                        );
                    }
                }
                // gökten hâlâ düşen meteorit kırıntıları
                if (et < 2.5 && Math.random() < sdt * 5) {
                    v.tail.emit(
                        hole.x + (Math.random() - 0.5) * 3, hole.y + 1.3 + Math.random() * 1.2, hole.z + (Math.random() - 0.5) * 2,
                        (Math.random() - 0.5) * 0.3, -(2.2 + Math.random() * 1.6), (Math.random() - 0.5) * 0.3,
                        0.4 + Math.random() * 0.4, 0.018 + Math.random() * 0.025, 1, 0.6, 0.25, null
                    );
                }
                // kor tanecikleri — sönümlenen final
                if (et > 1.2 && t < T.P6 - 0.6 && Math.random() < sdt * 22) {
                    v.ember.emit(
                        hole.x + (Math.random() - 0.5) * 1.4, hole.y + Math.random() * 0.5, hole.z + (Math.random() - 0.5) * 1.4,
                        (Math.random() - 0.5) * 0.06, 0.05 + Math.random() * 0.2, (Math.random() - 0.5) * 0.06,
                        1.6 + Math.random() * 1.6, 0.012 + Math.random() * 0.02, 1, 0.45, 0.1,
                        { fl: Math.random() * 6.28, flS: 2 + Math.random() * 4 }
                    );
                }
            }
        }

        // --- parçacık evrimi (sdt → donma anında her şey durur) ---
        v.tail.update(sdt, (i, k, d2) => {
            const dd = v.tail.data[i];
            if (dd && dd.swS) {   // türbülans swirl
                v.tail.vel[i].x += Math.sin(t * dd.swS + dd.sw) * 1.6 * d2;
                v.tail.vel[i].y += Math.cos(t * dd.swS * 0.8 + dd.sw) * 1.6 * d2;
            }
            v.tail.col[i * 3 + 1] = Math.max(0.05, 0.9 - k * 1.1);   // beyaz→turuncu→kızıl
            v.tail.col[i * 3 + 2] = Math.max(0, 0.5 - k * 1.2);
            v.tail.alp[i] = 1 - k * k;
            v.tail.siz[i] *= 1 - d2 * 0.9;
        });
        v.smoke.update(sdt, (i, k, d2) => {
            v.smoke.siz[i] += d2 * 0.1;                    // genişler
            v.smoke.vel[i].multiplyScalar(1 - d2 * 0.5);   // yavaşlar
            v.smoke.alp[i] = Math.sin(k * Math.PI) * 0.5;
        });
        v.erup.update(sdt, (i, k, d2) => {
            const dd = v.erup.data[i];
            if (dd && dd.swS) {   // ateş girdabı: spiral
                v.erup.pos[i * 3] += Math.sin(t * dd.swS + dd.sw + k * 8) * 0.35 * d2;
                v.erup.pos[i * 3 + 2] += Math.cos(t * dd.swS + dd.sw + k * 8) * 0.35 * d2;
            }
            v.erup.vel[i].y -= (dd ? dd.g : 0.9) * d2;
            v.erup.col[i * 3 + 1] = Math.max(0.05, 0.7 - k * 0.9);
            v.erup.col[i * 3 + 2] = Math.max(0, 0.2 - k * 0.4);
            v.erup.alp[i] = 1 - k;
            v.erup.siz[i] *= 1 - d2 * 0.35;
        });
        v.ember.update(sdt, (i, k) => {
            const dd = v.ember.data[i];
            const fl = 0.4 + 0.6 * Math.abs(Math.sin(t * dd.flS + dd.fl));   // kimi parlar kimi söner
            const fade = Math.sin(Math.min(k * 1.3, 1) * Math.PI);
            v.ember.col[i * 3] = fl;
            v.ember.col[i * 3 + 1] = 0.45 * fl;
            v.ember.col[i * 3 + 2] = 0.08 * fl;
            v.ember.alp[i] = fade;
        });
        meteorRockUpdate(v, sdt);
    },

    balls(fx, t, dt) {
        // Anticipation: the table trembles harder as the meteor closes in
        const g = smooth(T.P2, T.P4, t);
        for (const b of fx._ballState) {
            if (!b.mesh.parent) continue;
            b.mesh.position.x = b.start.x + (Math.random() - 0.5) * 0.008 * g;
            b.mesh.position.z = b.start.z + (Math.random() - 0.5) * 0.008 * g;
            b.mesh.position.y = b.y0 + Math.abs(Math.sin(t * 20 + b.baseRadius * 7)) * 0.02 * g;
        }
    },

    detonate(fx) {
        const v = fx.v, hole = fx._hole;
        fx._spawnShockwave(0xfff1c4, 0.15);   // çarpma anı ekstra flaş halkası
        // lav spreyi: tek seferlik yerçekimli damla patlaması
        for (let i = 0; i < 130; i++) {
            const a = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 2 - 1);
            const sp = 0.8 + Math.random() * 3.0;
            const lava = Math.random() < 0.6;
            v.erup.emit(
                hole.x, hole.y + 0.03, hole.z,
                Math.sin(ph) * Math.cos(a) * sp,
                Math.abs(Math.cos(ph)) * sp * (0.6 + Math.random() * 0.7),
                Math.sin(ph) * Math.sin(a) * sp * 0.6,
                0.8 + Math.random() * 1.4,
                lava ? 0.025 + Math.random() * 0.045 : 0.012 + Math.random() * 0.02,
                lava ? 1 : 0.25, lava ? 0.3 + Math.random() * 0.3 : 0.13, lava ? 0.05 : 0.09,
                { g: 6 }
            );
        }
        // kaya patlaması
        for (let i = 0; i < 16; i++) {
            const a = Math.random() * Math.PI * 2, sp = 0.7 + Math.random() * 2.2;
            meteorRockSpawn(v, _tmpV.set(hole.x, hole.y + 0.04, hole.z),
                new THREE.Vector3(Math.cos(a) * sp, 0.8 + Math.random() * 2.4, Math.sin(a) * sp * 0.6),
                1.2 + Math.random() * 1.8);
        }
    },

    // Düşen taşı kamerayla izle, çarpmaya yaklaşırken bakışı cebe geri süz —
    // eski meteor'un beğenilen kamera hissi (host konum koreografisini yapar).
    // Ek: pull yumuşak rampalı başlar → erken "uzak yıldız" fazında ani bakış sıçraması olmaz.
    focus(fx, t) {
        const v = fx.v;
        if (!v.meteor.visible || t >= T.P4) return null;
        const p = smooth(T.P2 * 0.7, T.P4, t);
        const pull = 0.65 * smooth(0.8, 1.6, t) * (1 - p * p);
        v._focus.copy(fx._hole).lerp(v.meteor.position, pull);
        return v._focus;
    },
};

// ---------------------------------------------
// Absolute Zero (freeze) yardımcıları — ucuz value-noise + kristal shader
// Konsept: _assets_src/finishers/new_finishers/absolute-zero.html
// ---------------------------------------------
const VNOISE_GLSL = `
float hash(vec3 p){ p = fract(p * 0.3183099 + .1); p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),
                 mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                 mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}`;

const _UP = new THREE.Vector3(0, 1, 0);

/**
 * Kristal shader'ı: fresnel rim + içinde AKAN enerji damarları + iç pırıltı +
 * patlama öncesi çatlak flicker'ı + tabandan prosedürel büyüme (uGrow).
 * uT = dünya zamanı (host FREEZE'inde durur) · uVeinT = damar zamanı (donarken
 * de akar — "zaman durdu ama enerji akıyor") · uRT = gerçek zaman (flicker).
 */
function crystalMaterial() {
    return new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: {
            uGrow: { value: 0 }, uT: { value: 0 }, uVeinT: { value: 0 },
            uBright: { value: 1 }, uVein: { value: 1 }, uCrack: { value: 0 },
            uRT: { value: 0 }, uFade: { value: 1 },
        },
        vertexShader: `
            uniform float uGrow, uT;
            varying vec3 vN, vV, vW;
            void main(){
                vec3 p = position;
                float g = clamp(uGrow, 0.0, 1.0);
                p.y *= g;                                          // tabandan büyür
                p.xz *= 0.25 + 0.75 * g;                           // açıldıkça kalınlaşır
                p.x += sin(p.y * 14.0 + uT * 0.4) * 0.006 * (1.0 - g);  // gençken organik salınım
                vec4 w = modelMatrix * vec4(p, 1.0);
                vW = w.xyz;
                vN = normalize(normalMatrix * normal);
                vec4 mv = viewMatrix * w;
                vV = normalize(-mv.xyz);
                gl_Position = projectionMatrix * mv;
            }`,
        fragmentShader: VNOISE_GLSL + `
            uniform float uT, uVeinT, uBright, uVein, uCrack, uRT, uFade;
            varying vec3 vN, vV, vW;
            void main(){
                vec3 N = normalize(vN);
                float fres = pow(1.0 - abs(dot(N, normalize(vV))), 2.4);
                // derin yarı saydam buz gövdesi
                vec3 body = vec3(0.02, 0.10, 0.24) * (0.55 + 0.45 * noise(vW * 16.0));
                // parlak fresnel kenar — "büyülü cam"
                vec3 rim = vec3(0.62, 0.86, 1.0) * fres * 1.7;
                vec3 spec = vec3(0.55, 0.4, 1.0) * pow(fres, 4.0) * 0.6;
                // enerji damarları — kristalin İÇİNDE akan ince ışık bantları
                float n = noise(vW * 26.0 + vec3(0.0, -uVeinT * 0.9, uVeinT * 0.2));
                float band = smoothstep(0.46, 0.50, n) * smoothstep(0.54, 0.50, n);
                vec3 vein = vec3(0.35, 0.8, 1.0) * band * (1.6 + 2.4 * uVein);
                float tw = pow(noise(vW * 85.0 + uVeinT * 0.5), 8.0) * 3.0;   // iç pırıltı
                // çatlak: patlamadan hemen önce kırıklardan yayılan beyaz ışık
                float cr = 0.0;
                if (uCrack > 0.001) {
                    float cn = abs(noise(vW * 42.0) - 0.5) * 2.0;
                    cr = smoothstep(0.18, 0.02, cn) * uCrack * (0.65 + 0.35 * sin(uRT * 70.0 + vW.y * 60.0));
                }
                vec3 col = (body + rim + spec + vein + vec3(0.7, 0.9, 1.0) * tw) * uBright
                         + vec3(0.9, 0.97, 1.0) * cr * 3.0;
                gl_FragColor = vec4(col * uFade, 1.0);
            }`,
    });
}

/** Sivri buz kristali (uca doğru incelen 6-gen silindir), yönlü; list'e {mat,start,dur} ekler. */
function zeroSpike(parent, list, pos, dir, len, rad, start, dur) {
    const geo = new THREE.CylinderGeometry(rad * 0.06, rad, len, 6, 2, false);
    geo.translate(0, len / 2, 0);
    const mat = crystalMaterial();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.quaternion.setFromUnitVectors(_UP, dir.clone().normalize());
    parent.add(mesh);
    list.push({ mat, start, dur });
    return mesh;
}

// =====================================================
// 🧊 FREEZE — the table ices over, then shatters
// =====================================================
// Görsel tasarım _assets_src/finishers/new_finishers/absolute-zero.html
// konseptinden port edildi (76sn'lik demo → host'un 9.6sn zaman çizgisine
// sıkıştırıldı, mobil bütçeyle). Kamera sistemi ESKİ: host faz kamerası aynen;
// yalnız hafif focus yükselmesi eklendi (katedral yukarı büyüdüğü için — cyclone
// deseni). Demo'nun "Absolute Freeze" anı host FREEZE'ine birebir oturur:
// dünya (uT=t) donar, enerji damarları (uVeinT, gerçek dt) akmaya DEVAM eder,
// çatlak flicker'ı (uRT) başlar → patlama.
const freeze = {
    icon: '🧊',
    name: 'Donma',
    desc: 'Mutlak sıfır: buz katedrali büyür, zaman donar — kristal patlamasıyla dağılır.',
    title: 'ABSOLUTE ZERO',
    textGrad: 'linear-gradient(90deg,#bfeaff,#ffffff,#8fd6ff,#e8f9ff,#bfeaff)',
    textGlow: '0 0 30px rgba(170,225,255,0.75),0 0 60px rgba(120,190,255,0.5)',
    lens: 0.2,
    // Ses: 3s'lik kristalleşme yayılımı — sondaki soğuk sub-düşüş FREEZE_START(5.65)
    // anına denk gelsin diye ~2.95'te başlar. Uğultu prosedürel drone kalır.
    sfx: { oneshot: 'finisher-freeze', at: 2.95 },
    shock: [0xffffff, 0xbfe9ff, 0x9fd4ff],
    burstPalette: [
        [0.7, 0.9, 1.0], [0.85, 0.97, 1.0], [1.0, 1.0, 1.0], [0.55, 0.8, 1.0], [0.72, 0.55, 1.0],
    ],
    dustColor: 0xcfeaff,   // snowfall

    build(fx) {
        const v = fx.v, hole = fx._hole;
        v._veinT = 0;   // damar zamanı — donarken de akar
        v._realT = 0;   // gerçek zaman — çatlak flicker'ı

        // --- kristal yapı: golden-angle çiçeklenme + dallar + mini katedral ---
        v.crystals = [];
        v.cryGroup = new THREE.Group();
        v.cryGroup.position.copy(hole);
        fx.group.add(v.cryGroup);

        const GA = Math.PI * (3 - Math.sqrt(5));
        for (let i = 0; i < 14; i++) {
            const az = i * GA + (Math.random() - 0.5) * 0.4;
            const tilt = 0.15 + Math.random() * 1.1;             // çoğu yukarı, birkaçı yana
            const dir = new THREE.Vector3(Math.sin(tilt) * Math.cos(az), Math.cos(tilt), Math.sin(tilt) * Math.sin(az));
            const len = 0.28 + Math.random() * 0.34, rad = 0.02 + Math.random() * 0.025;
            const start = T.P1 + 0.2 + (i / 14) * 1.8 + Math.random() * 0.3;   // P2-P3 boyunca kademeli
            const spike = zeroSpike(v.cryGroup, v.crystals, new THREE.Vector3(0, 0, 0), dir, len, rad, start, 1.2 + Math.random());
            if (Math.random() < 0.6) {   // dal — her kristal kendi yönünde gelişir
                const cd = dir.clone()
                    .add(new THREE.Vector3((Math.random() - 0.5) * 1.4, Math.random() * 0.8 - 0.1, (Math.random() - 0.5) * 1.4).multiplyScalar(0.7))
                    .normalize();
                zeroSpike(spike, v.crystals, new THREE.Vector3(0, len * (0.4 + Math.random() * 0.3), 0), cd,
                    len * (0.3 + Math.random() * 0.25), rad * 0.55, start + 0.8 + Math.random() * 0.7, 1 + Math.random() * 0.8);
            }
        }
        for (let i = 0; i < 5; i++) {   // mini buz katedrali sütunları (cep çevresi)
            const a = i / 5 * Math.PI * 2 + 0.3;
            zeroSpike(v.cryGroup, v.crystals,
                new THREE.Vector3(Math.cos(a) * 0.30, 0, Math.sin(a) * 0.30),
                new THREE.Vector3((Math.random() - 0.5) * 0.12, 1, (Math.random() - 0.5) * 0.12),
                0.45 + Math.random() * 0.28, 0.028 + Math.random() * 0.014,
                T.P3 - 0.4 + i * 0.15, 1.2 + Math.random() * 0.6);
        }

        // --- asılı buz kıymıkları — yerçekimini yok sayar, zaman yavaşlamış hissi ---
        v.shards = [];
        for (let i = 0; i < 12; i++) {
            const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.012 + Math.random() * 0.03, 0), crystalMaterial());
            const a = Math.random() * Math.PI * 2, r = 0.25 + Math.random() * 0.85;
            mesh.position.set(hole.x + Math.cos(a) * r, hole.y + 0.1 + Math.random() * 0.55, hole.z + Math.sin(a) * r);
            mesh.userData = {
                y0: mesh.position.y, ph: Math.random() * 6.28,
                rs: (Math.random() - 0.5) * 0.8, rx0: Math.random() * 3, ry0: Math.random() * 3,
                delay: Math.random(),
            };
            fx.group.add(mesh);
            v.shards.push(mesh);
        }

        // --- don zemini: noise kenarlı, damarlı, parlak halkalı genişleyen disk ---
        v.frost = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
            uniforms: { uR: { value: 0 }, uT: { value: 0 } },
            vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: VNOISE_GLSL + `
                uniform float uR, uT; varying vec2 vUv;
                void main(){
                    vec2 p = (vUv - 0.5) * 2.6;
                    float d = length(p);
                    float edge = d + (noise(vec3(p * 8.0, uT * 0.05)) - 0.5) * 0.18;
                    float m = smoothstep(uR, uR - 0.28, edge);
                    float veins = pow(noise(vec3(p * 12.0, 3.0)), 3.0) * 1.6;
                    float ring = smoothstep(uR, uR - 0.04, edge) - smoothstep(uR - 0.06, uR - 0.11, edge);
                    vec3 col = vec3(0.10, 0.28, 0.5) * m * (0.22 + veins * 0.5) + vec3(0.6, 0.9, 1.0) * ring * 0.5;
                    gl_FragColor = vec4(col, 1.0);
                }`,
        }));
        v.frost.rotation.x = -Math.PI / 2;
        v.frost.position.copy(hole);
        v.frost.position.y += 0.012;
        fx.group.add(v.frost);

        // --- donmuş çekirdek parıltısı (nefes alır, titremez) ---
        v.core = new THREE.Sprite(new THREE.SpriteMaterial({
            map: fx._sprite, color: 0xdff4ff, transparent: true,
            blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
        }));
        v.core.position.set(hole.x, hole.y + 0.12, hole.z);
        fx.group.add(v.core);
        v.halo = new THREE.Sprite(new THREE.SpriteMaterial({
            map: fx._sprite, color: 0x6fbdf2, transparent: true,
            blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
        }));
        v.halo.position.copy(v.core.position);
        fx.group.add(v.halo);

        // patlama flaşı (soğuk beyaz)
        v.flash = new THREE.Sprite(new THREE.SpriteMaterial({
            map: fx._sprite, color: 0xeaf6ff, transparent: true,
            blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
        }));
        v.flash.position.set(hole.x, hole.y + 0.15, hole.z);
        fx.group.add(v.flash);

        // --- GPU parçacık sistemleri (CPU update YOK — hepsi uniform-güdümlü) ---
        // buhar: yükselen soğuk sis (yerçekimine karşı)
        {
            const N = 160;
            const pos = new Float32Array(N * 3), siz = new Float32Array(N), sd = new Float32Array(N);
            for (let i = 0; i < N; i++) {
                const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.7;
                pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.random() * 0.55; pos[i * 3 + 2] = Math.sin(a) * r;
                siz[i] = 0.05 + Math.random() * 0.08; sd[i] = Math.random();
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
            geo.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
            v.mist = new THREE.Points(geo, new THREE.ShaderMaterial({
                transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
                uniforms: { uT: { value: 0 }, uOp: { value: 0 }, uScale: { value: 800 } },
                vertexShader: `
                    uniform float uT, uScale; attribute float aSize, aSeed; varying float vA;
                    void main(){
                        vec3 p = position;
                        p.y = mod(p.y + uT * (0.04 + aSeed * 0.05), 0.55);
                        p.x += sin(uT * 0.1 + aSeed * 20.0) * 0.06;
                        vA = smoothstep(0.0, 0.08, p.y) * smoothstep(0.55, 0.35, p.y) * (0.4 + 0.6 * aSeed);
                        vec4 mv = modelViewMatrix * vec4(p, 1.0);
                        gl_PointSize = aSize * (uScale / -mv.z);
                        gl_Position = projectionMatrix * mv;
                    }`,
                fragmentShader: `
                    uniform float uOp; varying float vA;
                    void main(){
                        float d = length(gl_PointCoord - 0.5) * 2.0;
                        float a = pow(max(0.0, 1.0 - d), 3.0) * vA * uOp;
                        gl_FragColor = vec4(vec3(0.55, 0.75, 0.95) * a * 0.4, 1.0);
                    }`,
            }));
            v.mist.position.copy(hole);
            v.mist.frustumCulled = false;
            fx.group.add(v.mist);
        }
        // kar: mod-düşüş; uRise ile finalde sarmal yükselip kaybolur
        {
            const N = 300;
            const pos = new Float32Array(N * 3), sd = new Float32Array(N);
            for (let i = 0; i < N; i++) {
                const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 1.3;
                pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.random() * 0.9; pos[i * 3 + 2] = Math.sin(a) * r;
                sd[i] = Math.random();
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            geo.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
            v.snow = new THREE.Points(geo, new THREE.ShaderMaterial({
                transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
                uniforms: { uT: { value: 0 }, uOp: { value: 0 }, uRise: { value: 0 }, uScale: { value: 800 } },
                vertexShader: `
                    uniform float uT, uRise, uScale; attribute float aSeed; varying float vA;
                    void main(){
                        vec3 p = position;
                        float fall = uT * (0.16 + aSeed * 0.14);
                        float y = mod(p.y - fall, 0.9);
                        float ang = uRise * (1.5 + aSeed * 2.0);
                        float ca = cos(ang), sa = sin(ang);
                        p.xz = mat2(ca, -sa, sa, ca) * p.xz * (1.0 + uRise * 0.4);
                        p.y = y + uRise * (0.5 + aSeed * 0.8);
                        p.x += sin(uT * 0.6 + aSeed * 30.0) * 0.05;
                        vA = (0.35 + 0.65 * aSeed) * (1.0 - uRise);
                        vec4 mv = modelViewMatrix * vec4(p, 1.0);
                        gl_PointSize = (0.010 + aSeed * 0.020) * (uScale / -mv.z);
                        gl_Position = projectionMatrix * mv;
                    }`,
                fragmentShader: `
                    uniform float uOp; varying float vA;
                    void main(){
                        float d = length(gl_PointCoord - 0.5) * 2.0;
                        float a = pow(max(0.0, 1.0 - d), 2.0) * vA * uOp;
                        gl_FragColor = vec4(vec3(0.85, 0.94, 1.0) * a, 1.0);
                    }`,
            }));
            v.snow.position.copy(hole);
            v.snow.frustumCulled = false;
            fx.group.add(v.snow);
        }
        // kristal patlama: ışık kıran binlerce parça, ağır çekim (GPU sürüklenme)
        {
            const N = 800;
            const pos = new Float32Array(N * 3), dir = new Float32Array(N * 3), sd = new Float32Array(N);
            for (let i = 0; i < N; i++) {
                const a = Math.random() * Math.PI * 2, r = Math.pow(Math.random(), 0.6) * 0.30;
                pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = 0.02 + Math.random() * 0.55; pos[i * 3 + 2] = Math.sin(a) * r;
                const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 2 - 1);
                const sp = (0.5 + Math.random() * 1.5) * (Math.random() < 0.12 ? 1.8 : 1.0);
                dir[i * 3] = Math.sin(ph) * Math.cos(th) * sp;
                dir[i * 3 + 1] = Math.abs(Math.cos(ph)) * sp * (0.35 + Math.random() * 0.65) + 0.25;
                dir[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp;
                sd[i] = Math.random();
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            geo.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
            geo.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
            v.burst = new THREE.Points(geo, new THREE.ShaderMaterial({
                transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
                uniforms: { uBT: { value: 0 }, uT: { value: 0 }, uOp: { value: 0 }, uDust: { value: 0 }, uScale: { value: 800 } },
                vertexShader: `
                    uniform float uBT, uT, uDust, uScale;
                    attribute vec3 aDir; attribute float aSeed; varying float vS;
                    void main(){
                        vS = aSeed;
                        vec3 p = position + aDir * uBT * (0.6 + 0.4 * aSeed);
                        p.y += uDust * (0.3 + aSeed * 0.5);
                        p += 0.04 * vec3(sin(uT * 0.7 + aSeed * 40.0), 0.0, cos(uT * 0.6 + aSeed * 31.0)) * uBT;
                        vec4 mv = modelViewMatrix * vec4(p, 1.0);
                        float size = (0.010 + aSeed * 0.030) * max(0.25, 1.0 - uBT * 0.5) * (1.0 - uDust * 0.6);
                        gl_PointSize = size * (uScale / -mv.z);
                        gl_Position = projectionMatrix * mv;
                    }`,
                fragmentShader: `
                    uniform float uOp, uT; varying float vS;
                    void main(){
                        float d = length(gl_PointCoord - 0.5) * 2.0;
                        float a = pow(max(0.0, 1.0 - d), 2.4);
                        // her parça ışığı farklı kırar — soğuk spektral palet
                        vec3 cA = vec3(0.85, 0.96, 1.0), cB = vec3(0.45, 0.75, 1.0), cC = vec3(0.72, 0.55, 1.0);
                        vec3 col = vS < 0.55 ? mix(cA, cB, vS / 0.55) : mix(cB, cC, (vS - 0.55) / 0.45);
                        float tw = 0.55 + 0.45 * sin(uT * 4.0 + vS * 80.0);   // parıldayan yüzeyler
                        gl_FragColor = vec4(col * a * tw * uOp, 1.0);
                    }`,
            }));
            v.burst.position.copy(hole);
            v.burst.frustumCulled = false;
            v.burst.visible = false;
            fx.group.add(v.burst);
        }
        // final parıltıları: ışığa dönüşüp kaybolurlar
        {
            const N = 60;
            const pos = new Float32Array(N * 3), sd = new Float32Array(N);
            for (let i = 0; i < N; i++) {
                const a = Math.random() * Math.PI * 2, r = 0.1 + Math.random() * 0.8;
                pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = 0.05 + Math.random() * 0.55; pos[i * 3 + 2] = Math.sin(a) * r;
                sd[i] = Math.random();
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            geo.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
            v.sparks = new THREE.Points(geo, new THREE.ShaderMaterial({
                transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
                uniforms: { uT: { value: 0 }, uOp: { value: 0 }, uGlow: { value: 1 }, uScale: { value: 800 } },
                vertexShader: `
                    uniform float uT, uScale; attribute float aSeed; varying float vS;
                    void main(){
                        vS = aSeed;
                        vec3 p = position;
                        p.y += sin(uT * 0.4 + aSeed * 20.0) * 0.06;
                        p.x += sin(uT * 0.25 + aSeed * 13.0) * 0.06;
                        vec4 mv = modelViewMatrix * vec4(p, 1.0);
                        gl_PointSize = (0.008 + aSeed * 0.015) * (uScale / -mv.z);
                        gl_Position = projectionMatrix * mv;
                    }`,
                fragmentShader: `
                    uniform float uOp, uT, uGlow; varying float vS;
                    void main(){
                        float d = length(gl_PointCoord - 0.5) * 2.0;
                        float a = pow(max(0.0, 1.0 - d), 2.2) * (0.5 + 0.5 * sin(uT * 3.0 + vS * 60.0));
                        gl_FragColor = vec4(vec3(0.8, 0.93, 1.0) * a * uOp * uGlow, 1.0);
                    }`,
            }));
            v.sparks.position.copy(hole);
            v.sparks.frustumCulled = false;
            fx.group.add(v.sparks);
        }

        v._focus = new THREE.Vector3();
    },

    update(fx, t, dt) {
        const v = fx.v;
        // Zaman katmanları: uT=t (host FREEZE'inde durur) · veinT gerçek dt ile
        // akar, donmaya girerken HIZLANIR (demo: dünya durdu, enerji akıyor) ·
        // realT çatlak flicker'ı sürer.
        v._realT += dt;
        v._veinT += dt * (1 + 1.2 * smooth(5.2, FREEZE_START, t) * (t < T.P4 ? 1 : 0));

        // zarflar (hepsi t'nin saf fonksiyonu)
        const coreIn = smooth(0.3, 1.0, t) * (1 - smooth(T.P4, T.P4 + 0.1, t));
        const brightAll = 1 + 0.95 * smooth(5.0, 5.7, t) * (t < T.P4 ? 1 : 0);
        const crack = t < T.P4 ? smooth(5.5, 5.95, t) : 0;
        const hideAtBurst = 1 - smooth(T.P4 - 0.05, T.P4, t);

        // çekirdek — nefes alır (t-güdümlü → donmada durur), titremez
        const breathe = 0.75 + 0.16 * Math.sin(t * 0.9);
        v.core.scale.setScalar(0.35 * breathe * coreIn + 0.001);
        v.core.material.opacity = coreIn * (0.55 + 0.3 * smooth(5.0, 5.7, t));
        v.halo.scale.setScalar(0.8 * breathe * coreIn * (1 + smooth(2, 5, t) * 0.5) + 0.001);
        v.halo.material.opacity = coreIn * 0.28 * (1 + smooth(5.0, 5.7, t));

        // don zemini yayılır
        v.frost.material.uniforms.uR.value =
            smooth(0.5, T.P4 - 0.5, t) * 1.15 * (1 - smooth(T.P5 + 1.0, T.P6, t) * 0.5);
        v.frost.material.uniforms.uT.value = t;

        // buhar (patlamada söner, sonra soğuk artçı olarak döner)
        v.mist.material.uniforms.uT.value = t;
        v.mist.material.uniforms.uOp.value =
            smooth(T.P1 - 0.4, T.P2, t) * 0.85 * hideAtBurst
            + smooth(T.P4 + 0.6, T.P5, t) * 0.5 * (1 - smooth(T.P6 - 0.8, T.P6 - 0.2, t));

        // asılı kıymıklar — yerçekimi onları unutmuş (dönüş t-güdümlü → donar)
        for (const m of v.shards) {
            const ud = m.userData;
            const g = easeOutC(clamp((t - (T.P1 + ud.delay * 1.3)) / 1.1, 0, 1)) * hideAtBurst;
            const u = m.material.uniforms;
            u.uGrow.value = g; u.uT.value = t; u.uVeinT.value = v._veinT;
            u.uBright.value = brightAll * 0.8; u.uCrack.value = crack * 0.7; u.uRT.value = v._realT;
            m.position.y = ud.y0 + Math.sin(t * 0.5 + ud.ph) * 0.03;
            m.rotation.y = ud.ry0 + t * ud.rs;
            m.rotation.x = ud.rx0 + t * ud.rs * 0.6;
        }

        // kristal yapı
        v.cryGroup.visible = t < T.P4;
        if (v.cryGroup.visible) {
            const veinAmp = 0.6 + 1.6 * smooth(5.0, 5.7, t);
            for (const c of v.crystals) {
                const u = c.mat.uniforms;
                u.uGrow.value = easeOutC(clamp((t - c.start) / c.dur, 0, 1));
                u.uT.value = t;
                u.uVeinT.value = v._veinT;
                u.uBright.value = brightAll;
                u.uVein.value = veinAmp;
                u.uCrack.value = crack;
                u.uRT.value = v._realT;
            }
        }

        // kar (t-güdümlü düşüş → donmada asılı kalır; finalde sarmal yükselir)
        v.snow.material.uniforms.uT.value = t;
        v.snow.material.uniforms.uOp.value = smooth(T.P2, T.P3, t) * (1 - smooth(T.P6 - 0.8, T.P6 - 0.2, t));
        v.snow.material.uniforms.uRise.value = smooth(T.P4 + 0.6, T.P5 + 0.8, t);

        // kristal patlama parçaları: pop → ağır, yavaş sürüklenme
        v.burst.visible = t >= T.P4;
        if (v.burst.visible) {
            const bt = t - T.P4;
            const u = v.burst.material.uniforms;
            u.uBT.value = (1.3 * (1 - Math.exp(-bt * 2.2)) + bt * 0.16) * 0.32;
            u.uT.value = t;
            u.uOp.value = 1 - smooth(T.P5 + 1.0, T.P6 - 0.2, t);
            u.uDust.value = smooth(T.P5 + 0.6, T.P6 - 0.2, t);
            // soğuk beyaz flaş
            v.flash.material.opacity = Math.max(0, 1 - bt * 1.8) * 0.9;
            v.flash.scale.setScalar(1.2 + easeOutC(Math.min(bt / 0.8, 1)) * 2.2);
        }

        // final parıltıları — ışığa dönüşüp sönerler
        v.sparks.material.uniforms.uT.value = t;
        v.sparks.material.uniforms.uOp.value =
            smooth(T.P5 + 0.5, T.P6 - 0.6, t) * (1 - smooth(T.P6 - 0.4, T.P6 - 0.05, t));
        v.sparks.material.uniforms.uGlow.value = 1 + 2.5 * smooth(T.P6 - 1.0, T.P6 - 0.4, t);
    },

    balls(fx, t, dt) {
        // Balls shiver, then lock dead still as the frost takes them
        const g = smooth(T.P2, T.P3, t);
        for (const b of fx._ballState) {
            if (!b.mesh.parent) continue;
            const s = (1 - g) * smooth(T.P1, T.P2, t);
            b.mesh.position.x = b.start.x + Math.sin(t * 30 + b.baseRadius * 9) * 0.004 * s;
            b.mesh.position.z = b.start.z + Math.cos(t * 27 + b.baseRadius * 5) * 0.004 * s;
            b.mesh.position.y = b.y0;
        }
    },

    detonate(fx) {
        // Katedral tuzla buz olur → GPU patlama bulutu devralır (update gösterir)
        const v = fx.v;
        v.cryGroup.visible = false;
        for (const s of v.shards) s.visible = false;
        fx._spawnShockwave(0xdff4ff, 0.12);
    },

    // Katedral yukarı büyüdükçe bakış hafifçe yükselir (cyclone deseni) —
    // host kamera koreografisi değişmez, yalnız look-at süzülür.
    focus(fx, t) {
        const v = fx.v;
        v._focus.set(fx._hole.x, fx._hole.y + 0.22 * smooth(T.P2, T.P4 - 0.4, t), fx._hole.z);
        return v._focus;
    },
};

// ---------------------------------------------
// Ancient Dragon Summon (dragon) yardımcıları
// Konsept: _assets_src/finishers/new_finishers/ancient-dragon-summon.html
// ---------------------------------------------
// 2D value-noise + fbm (mühür/portal/ejder/nefes shader'ları)
const FBM2_GLSL = `
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),
            mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;
 for(int i=0;i<4;i++){v+=a*noise(p);p=p*2.03+vec2(17.3,9.1);a*=.5;}return v;}`;

function _canvasTex(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    return new THREE.CanvasTexture(c);
}
// Doku önbelleği MODÜL seviyesinde — önizleme döngüsü her ~8sn'de def'i yeniden
// kurar; her kurulumda canvas dokusu üretmek sızıntı olur (cleanup map'i dispose etmez).
let _dragonTexCache = null;
function dragonTextures() {
    if (_dragonTexCache) return _dragonTexCache;
    const feather = _canvasTex(64, 128, (g, w, h) => {
        g.translate(w / 2, h / 2);
        const grad = g.createLinearGradient(0, -h / 2, 0, h / 2);
        grad.addColorStop(0, 'rgba(255,250,225,1)');
        grad.addColorStop(.5, 'rgba(255,205,110,.9)');
        grad.addColorStop(1, 'rgba(255,150,50,0)');
        g.fillStyle = grad;
        g.beginPath(); g.moveTo(0, -h / 2 + 4); g.quadraticCurveTo(w / 2 - 6, -h / 6, 0, h / 2 - 4);
        g.quadraticCurveTo(-w / 2 + 6, -h / 6, 0, -h / 2 + 4); g.fill();
        g.strokeStyle = 'rgba(255,255,240,.85)'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(0, -h / 2 + 6); g.lineTo(0, h / 2 - 8); g.stroke();
    });
    const runes = [];
    for (let i = 1; i <= 6; i++) {
        const seed = i * 7919;
        runes.push(_canvasTex(96, 96, (g, w, h) => {
            let s = seed;
            const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
            g.strokeStyle = 'rgba(255,215,140,1)'; g.lineWidth = 5; g.lineCap = 'round';
            g.shadowColor = 'rgba(255,170,60,.9)'; g.shadowBlur = 8;
            const pts = [];
            for (let k = 0; k < 5; k++) pts.push([14 + rnd() * (w - 28), 14 + rnd() * (h - 28)]);
            g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
            for (let k = 1; k < pts.length; k++) g.lineTo(pts[k][0], pts[k][1]);
            g.stroke();
            if (rnd() > .4) { g.beginPath(); g.arc(w / 2, h / 2, w * 0.32, rnd() * 6, rnd() * 3 + 2); g.stroke(); }
            if (rnd() > .5) { g.beginPath(); g.moveTo(w / 2, 16); g.lineTo(w / 2, h - 16); g.stroke(); }
        }));
    }
    _dragonTexCache = { feather, runes };
    return _dragonTexCache;
}

// =====================================================
// 🐉 DRAGON — "Ancient Dragon Summon": kadim mühür + portal + ilahi nefes
// Görsel tasarım ancient-dragon-summon.html konseptinden port edildi (57sn'lik
// tören → 9.6sn'lik host zaman çizgisine sıkıştırıldı, mobil bütçeyle). Akış:
// mühür kendini çizer → enerji uyanışı (sütun/küre/rün) → gökte portal açılır,
// ejder başı çıkar (önce gözler) → ağzında şarj küresi + arklar (FREEZE = güç
// toplanmış asılı an) → P4'te İLAHİ NEFES cebe iner (katmanlı lazer + halkalar)
// → altın tüy/kristal/kıvılcım patlaması → ejder çekilir, portal kapanır.
// Portal/çatlak kamerasal yaw: fx.camera varsa ona döner (host), yoksa sabit
// önizleme açısına (FinisherPreview kamera vermez).
// =====================================================
const dragon = {
    icon: '🐉',
    name: 'Ejderha',
    desc: 'Kadim mühür çizilir, portal açılır — ejderha ilahi nefesiyle masayı yakar.',
    title: 'ANCIENT DRAGON',
    textGrad: 'linear-gradient(90deg,#f6e2ae,#ffd27a,#fff6dd,#e8c477,#f6e2ae)',
    textGlow: '0 0 30px rgba(255,190,90,0.75),0 0 60px rgba(255,140,40,0.5)',
    lens: 0.15,
    shock: [0xffffff, 0xffd27a, 0xff9540],
    burstPalette: [
        [1.0, 0.85, 0.5], [1.0, 0.62, 0.2], [1.0, 0.96, 0.8], [0.62, 0.78, 1.0], [1.0, 0.45, 0.12],
    ],
    dustColor: 0xffd9a0,   // altın kül

    build(fx) {
        const v = fx.v, hole = fx._hole;
        const tex = dragonTextures();
        v._lastT = 0; v._spinA = 0; v._spinB = 0; v._spinSpeed = 0;
        v._mouth = new THREE.Vector3();
        v._dir = new THREE.Vector3();

        // --- 1 · KADİM MÜHÜR: katmanlı büyü çemberi (süpürme reveal'lı) ---
        v.sealUni = {
            uTime: { value: 0 }, uReveal: { value: 0 }, uSpinA: { value: 0 },
            uSpinB: { value: 0 }, uIntensity: { value: 1 },
        };
        v.seal = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
            uniforms: v.sealUni,
            vertexShader: `varying vec2 vUv;void main(){vUv=uv;
                gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
            fragmentShader: FBM2_GLSL + `
                uniform float uTime,uReveal,uSpinA,uSpinB,uIntensity;varying vec2 vUv;
                float ring(float r,float d,float w){return smoothstep(w,0.,abs(r-d));}
                float layer(float t0,float t1){return clamp((uReveal-t0)/(t1-t0),0.,1.);}
                float sweep(float a,float l){return step(fract(a/6.2831853+0.5),l);}
                void main(){
                    vec2 p=(vUv-.5)*2.2; float r=length(p); if(r>1.05)discard;
                    float a=atan(p.y,p.x);
                    float aA=a+uSpinA, aB=a-uSpinB, aC=a+uSpinB*.5;
                    float g=0.;
                    float l1=layer(0.,.16);                     /* dış ikiz halkalar */
                    g+=(ring(r,.965,.010)+ring(r,.915,.006))*sweep(aA,l1);
                    float l2=layer(.10,.30);                    /* kesik yörünge */
                    float dash=step(.5,fract(aB*28./6.2831853));
                    g+=ring(r,.845,.008)*dash*sweep(aB,l2);
                    float l3=layer(.24,.50);                    /* rün bandı */
                    float band=smoothstep(.60,.62,r)*smoothstep(.78,.76,r);
                    float cell=floor((aA/6.2831853+.5)*26.);
                    float cu=fract((aA/6.2831853+.5)*26.);
                    float rv=(r-.60)/.18;
                    float bars=step(.55,noise(vec2(cell*3.1,floor(rv*5.)*2.7)))
                              *step(.18,cu)*step(cu,.82);
                    g+=band*bars*1.15*sweep(aA,l3);
                    g+=(ring(r,.60,.005)+ring(r,.78,.005))*l3;
                    float l4=layer(.42,.60);                    /* ters halkalar */
                    g+=(ring(r,.545,.007)+ring(r,.505,.005))*sweep(aB,l4);
                    float l5=layer(.55,.72);                    /* on iki kol */
                    float spoke=smoothstep(.028,.0,abs(fract(aC*12./6.2831853)-.5)*(.4+r));
                    g+=spoke*smoothstep(.18,.22,r)*smoothstep(.50,.46,r)*l5;
                    float l6=layer(.62,.86);                    /* dönen hexagram */
                    float ha=mod(aB,1.0471976)-.5235988;
                    g+=ring(r*cos(ha)/.8660254,.40,.008)*l6;
                    float ha2=mod(aB+.5235988,1.0471976)-.5235988;
                    g+=ring(r*cos(ha2)/.8660254,.40,.008)*l6;
                    float l7=layer(.80,1.);                     /* kalp */
                    g+=ring(r,.13,.010)*sweep(aA,l7);
                    g+=exp(-r*7.)*1.6*l7;
                    g+=smoothstep(1.,.2,r)*.045*uReveal;
                    g*=uIntensity*(.85+.15*sin(uTime*3.1));
                    vec3 col=mix(vec3(1.,.42,.08),vec3(1.,.83,.42),clamp(g*.6,0.,1.));
                    gl_FragColor=vec4(col*g,clamp(g,0.,1.));
                }`,
        }));
        v.seal.rotation.x = -Math.PI / 2;
        v.seal.position.copy(hole);
        v.seal.position.y += 0.015;
        fx.group.add(v.seal);

        // --- 2 · ENERJİ UYANIŞI: ışık sütunları + yörünge küreleri + rünler ---
        v.pillarUni = { uTime: { value: 0 }, uPow: { value: 0 } };
        const pillarMat = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
            uniforms: v.pillarUni,
            vertexShader: `varying vec2 vUv;void main(){vUv=uv;
                gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
            fragmentShader: FBM2_GLSL + `
                uniform float uTime,uPow;varying vec2 vUv;
                void main(){
                    float n=fbm(vec2(vUv.x*6.,vUv.y*3.-uTime*2.2));
                    float body=(1.-vUv.y)*(.45+.55*n);
                    float a=body*uPow;
                    vec3 col=mix(vec3(1.,.5,.12),vec3(1.,.9,.55),vUv.y+n*.3);
                    gl_FragColor=vec4(col*a*1.6,a);
                }`,
        });
        v.pillars = [];
        for (let i = 0; i < 4; i++) {
            const m = new THREE.Mesh(new THREE.CylinderGeometry(.03, .055, .85, 10, 1, true), pillarMat);
            const ang = i / 4 * Math.PI * 2 + 0.5;
            m.position.set(hole.x + Math.cos(ang) * 0.34, hole.y, hole.z + Math.sin(ang) * 0.34);
            m.scale.y = 0.001;
            fx.group.add(m);
            v.pillars.push(m);
        }
        v.orbs = [];
        for (let i = 0; i < 5; i++) {
            const spr = new THREE.Sprite(new THREE.SpriteMaterial({
                map: fx._sprite, color: 0xffd9a0, transparent: true, opacity: 0,
                blending: THREE.AdditiveBlending, depthWrite: false,
            }));
            spr.scale.setScalar(0.08);
            fx.group.add(spr);
            v.orbs.push({ spr, ang: i / 5 * Math.PI * 2, rad: 0.5 + Math.random() * 0.3, yo: Math.random() * 6.28, speed: 0.6 + Math.random() * 0.5 });
        }
        v.runes = [];
        for (let i = 0; i < 8; i++) {
            const m = new THREE.Mesh(new THREE.PlaneGeometry(.09, .09), new THREE.MeshBasicMaterial({
                map: tex.runes[i % tex.runes.length], transparent: true, opacity: 0,
                blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
            }));
            fx.group.add(m);
            v.runes.push({
                m, ang: Math.random() * Math.PI * 2, rad: 0.3 + Math.random() * 0.5,
                rise: 0.2 + Math.random() * 0.7, ph: Math.random() * 6.28,
                spin: (Math.random() - .5) * 2, vel: new THREE.Vector3(), exploded: false,
            });
        }

        // --- 3 · PORTAL: uzay çatlakları + canlı kozmik girdap (+ karartıcı) ---
        v.portalG = new THREE.Group();
        v.portalG.position.set(hole.x, hole.y + 0.95, hole.z);
        fx.group.add(v.portalG);
        {
            const pts = [];
            for (let i = 0; i < 10; i++) {
                const a = Math.random() * Math.PI * 2;
                let x = 0, y = 0;
                const dx = Math.cos(a), dy = Math.sin(a);
                for (let s = 0; s < 5; s++) {
                    const nx = x + dx * (0.05 + Math.random() * 0.09) + (Math.random() - .5) * .07;
                    const ny = y + dy * (0.05 + Math.random() * 0.09) + (Math.random() - .5) * .07;
                    pts.push(x, y, 0, nx, ny, 0); x = nx; y = ny;
                }
            }
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
            v.cracks = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
                color: 0xffd890, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
            }));
            v.cracks.position.z = 0.02;
            v.portalG.add(v.cracks);
        }
        v.occluder = new THREE.Mesh(new THREE.CircleGeometry(0.52, 48),
            new THREE.MeshBasicMaterial({ color: 0x000000 }));
        v.occluder.position.z = -0.03;
        v.occluder.visible = false;
        v.portalG.add(v.occluder);
        v.portalUni = { uTime: { value: 0 }, uOpen: { value: 0 } };
        v.portal = new THREE.Mesh(new THREE.CircleGeometry(0.5, 64), new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, uniforms: v.portalUni,
            vertexShader: `varying vec2 vUv;void main(){vUv=uv;
                gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
            fragmentShader: FBM2_GLSL + `
                uniform float uTime,uOpen;varying vec2 vUv;
                void main(){
                    vec2 p=(vUv-.5)*2.; float r=length(p); float ang=atan(p.y,p.x);
                    float edge=1.+fbm(vec2(ang*2.5,uTime*.4))*.10;
                    float rr=r/edge; if(rr>1.)discard;
                    float swirl=ang+(1.-rr)*5.5+uTime*.55;
                    vec2 q=vec2(cos(swirl),sin(swirl))*rr;
                    float neb=fbm(q*2.6+uTime*.12);
                    float neb2=fbm(q*5.2-uTime*.2);
                    vec3 col=mix(vec3(.02,.02,.07),vec3(.16,.10,.42),neb);
                    col=mix(col,vec3(.45,.25,.75),neb2*neb*1.2);
                    col+=vec3(.05,.15,.4)*pow(1.-rr,2.)*1.4;
                    float st=step(.9935,hash(floor((q+7.)*70.)));
                    col+=vec3(1.,.95,.85)*st*(.4+.6*sin(uTime*4.+hash(floor((q+7.)*70.))*20.));
                    float rim=smoothstep(.72,1.,rr);
                    col+=vec3(1.,.6,.2)*rim*(0.9+0.5*sin(ang*7.-uTime*3.5))*1.6;
                    col+=vec3(1.,.85,.5)*smoothstep(.93,1.,rr)*2.2;
                    float alpha=smoothstep(1.,.97,rr)*uOpen;
                    gl_FragColor=vec4(col*(0.4+uOpen),alpha);
                }`,
        }));
        v.portal.scale.setScalar(0.001);
        v.portalG.add(v.portal);

        // --- 4 · EJDERHA: obsidyen gövde + erimiş fresnel rim (prosedürel) ---
        v.dragonUni = { uRim: { value: 0 }, uTime: { value: 0 } };
        const dMat = new THREE.ShaderMaterial({
            uniforms: v.dragonUni,
            vertexShader: `varying vec3 vN,vV;varying vec3 vPos;
                void main(){vN=normalMatrix*normal;
                    vec4 mv=modelViewMatrix*vec4(position,1.);vV=-mv.xyz;vPos=position;
                    gl_Position=projectionMatrix*mv;}`,
            fragmentShader: FBM2_GLSL + `
                uniform float uRim,uTime;varying vec3 vN,vV;varying vec3 vPos;
                void main(){
                    vec3 n=normalize(vN),vv=normalize(vV);
                    float f=pow(1.-abs(dot(n,vv)),2.1);
                    vec3 base=vec3(.028,.02,.016);
                    float cracksN=smoothstep(.62,.7,fbm(vPos.xy*2.1+vPos.z*1.3));
                    vec3 molten=vec3(1.,.42,.1)*cracksN*uRim*.55;
                    vec3 rim=mix(vec3(1.,.5,.13),vec3(1.,.85,.45),f)*f*uRim*1.7;
                    gl_FragColor=vec4(base+rim+molten,1.);
                }`,
        });
        v.dragon = new THREE.Group();
        const head = new THREE.Group();
        v.dragon.add(head);
        v.head = head;
        const ico = (r, d, sx, sy, sz, x, y, z, rx = 0, ry = 0, rz = 0) => {
            const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, d), dMat);
            m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
            return m;
        };
        head.add(ico(1.35, 1, 1.15, .85, 1.55, 0, 0, 0));              /* kafatası */
        head.add(ico(.9, 1, .8, .52, 1.5, 0, -.12, 1.55));             /* burun    */
        head.add(ico(.5, 1, .9, .4, 1., .62, .42, .55, 0, 0, -.25));   /* kaş R    */
        head.add(ico(.5, 1, .9, .4, 1., -.62, .42, .55, 0, 0, .25));   /* kaş L    */
        head.add(ico(.55, 1, .7, .7, 1.1, .95, -.3, -.4));             /* yanak R  */
        head.add(ico(.55, 1, .7, .7, 1.1, -.95, -.3, -.4));            /* yanak L  */
        v.jaw = new THREE.Group();
        v.jaw.position.set(0, -.5, .35);
        head.add(v.jaw);
        v.jaw.add(ico(.8, 1, .72, .34, 1.6, 0, -.05, 1.15));
        v.jaw.add(ico(.4, 1, .8, .5, .8, 0, -.15, -.1));
        const horn = (side) => {   /* boynuzlar: süpürülmüş tüp + koni uç */
            const pts = [new THREE.Vector3(side * .62, .55, -.5),
                new THREE.Vector3(side * 1.15, 1.35, -1.7),
                new THREE.Vector3(side * 1.4, 2.6, -3.1),
                new THREE.Vector3(side * 1.25, 3.7, -4.3)];
            head.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, .17, 6, false), dMat));
            const tip = new THREE.Mesh(new THREE.ConeGeometry(.17, 1.1, 6), dMat);
            const dir = pts[3].clone().sub(pts[2]).normalize();
            tip.position.copy(pts[3]).add(dir.clone().multiplyScalar(.45));
            tip.quaternion.setFromUnitVectors(_UP, dir);
            head.add(tip);
        };
        horn(1); horn(-1);
        for (let i = 0; i < 4; i++) {   /* çene dikenleri */
            const s = i < 2 ? 1 : -1, k = i % 2;
            const sp = new THREE.Mesh(new THREE.ConeGeometry(.09, .8, 5), dMat);
            sp.position.set(s * (.85 + k * .25), -.45, -.2 - k * .7);
            sp.rotation.set(.6, 0, s * (1.5 + k * .3));
            head.add(sp);
        }
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.5, 6, 10), dMat);
        neck.rotation.x = Math.PI / 2 - .12;
        neck.position.set(0, -.5, -3.6);
        head.add(neck);
        v.eyeGlows = [];
        [[.55, .30, 1.28], [-.55, .30, 1.28]].forEach(p => {   /* önce gözler yanar */
            const e = new THREE.Mesh(new THREE.SphereGeometry(.15, 10, 10), new THREE.MeshBasicMaterial({ color: 0xfff2c0 }));
            e.position.set(p[0], p[1], p[2]);
            head.add(e);
            const g = new THREE.Sprite(new THREE.SpriteMaterial({
                map: fx._sprite, color: 0xffcf70, transparent: true, opacity: 0,
                blending: THREE.AdditiveBlending, depthTest: false,
            }));
            g.scale.setScalar(1.4);
            g.position.set(p[0] * 1.05, p[1], p[2] + .15);
            head.add(g);
            v.eyeGlows.push(g);
        });
        v.mouthAnchor = new THREE.Object3D();
        v.mouthAnchor.position.set(0, -.18, 2.2);
        head.add(v.mouthAnchor);
        v.dragon.scale.setScalar(0.13);
        v.dragon.position.z = -0.5;   // portal arkasından çıkar (portalG lokali)
        v.dragon.visible = false;
        v.portalG.add(v.dragon);

        // --- 5 · KÜKREME: şarj küresi + yıldırım arkları ---
        v.sphereUni = { uTime: { value: 0 }, uMix: { value: 0 } };
        v.energySphere = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 24), new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: v.sphereUni,
            vertexShader: `varying vec3 vN,vV;varying vec2 vUv;void main(){vUv=uv;
                vN=normalMatrix*normal;vec4 mv=modelViewMatrix*vec4(position,1.);vV=-mv.xyz;
                gl_Position=projectionMatrix*mv;}`,
            fragmentShader: FBM2_GLSL + `
                uniform float uTime,uMix;varying vec3 vN,vV;varying vec2 vUv;
                void main(){
                    float f=abs(dot(normalize(vN),normalize(vV)));
                    float n=fbm(vUv*6.+vec2(uTime*1.5,-uTime*2.));
                    vec3 blue=vec3(.35,.65,1.),orange=vec3(1.,.55,.15),white=vec3(1.,.98,.9);
                    vec3 col=mix(blue,orange,n);
                    col=mix(col,white,pow(f,2.5));
                    float a=(.35+.65*pow(f,1.5))*(.7+.3*n);
                    gl_FragColor=vec4(col*1.8,a);
                }`,
        }));
        v.energySphere.scale.setScalar(0.001);
        fx.group.add(v.energySphere);
        v.sphereGlow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: fx._sprite, color: 0x9fd0ff, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        fx.group.add(v.sphereGlow);
        v.arcGeo = new THREE.BufferGeometry();
        v.arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 9 * 2 * 3), 3));
        v.arcs = new THREE.LineSegments(v.arcGeo, new THREE.LineBasicMaterial({
            color: 0xcfe6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
        }));
        v.arcs.frustumCulled = false;
        fx.group.add(v.arcs);

        // --- 6 · İLAHİ NEFES: katmanlı lazer + gezen halkalar + akış parçacıkları ---
        v.beamG = new THREE.Group();
        v.beamG.visible = false;
        fx.group.add(v.beamG);
        const beamLayer = (radius, colA, colB, speed, op) => new THREE.Mesh(
            new THREE.CylinderGeometry(radius, radius * 1.25, 1, 14, 1, true),
            new THREE.ShaderMaterial({
                transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
                uniforms: {
                    uTime: { value: 0 }, uPow: { value: 0 },
                    uColA: { value: new THREE.Color(colA) }, uColB: { value: new THREE.Color(colB) },
                    uSpeed: { value: speed }, uOp: { value: op },
                },
                vertexShader: `varying vec2 vUv;varying vec3 vN,vV;void main(){vUv=uv;
                    vN=normalMatrix*normal;vec4 mv=modelViewMatrix*vec4(position,1.);vV=-mv.xyz;
                    gl_Position=projectionMatrix*mv;}`,
                fragmentShader: FBM2_GLSL + `
                    uniform float uTime,uPow,uSpeed,uOp;uniform vec3 uColA,uColB;
                    varying vec2 vUv;varying vec3 vN,vV;
                    void main(){
                        float n=fbm(vec2(vUv.x*5.,vUv.y*4.-uTime*uSpeed));
                        float f=pow(1.-abs(dot(normalize(vN),normalize(vV))),1.2);
                        float ends=smoothstep(0.,.06,vUv.y)*smoothstep(1.,.9,vUv.y);
                        float a=uPow*uOp*ends*(.45+.55*n)*(0.4+0.6*f+0.4);
                        vec3 col=mix(uColA,uColB,n);
                        gl_FragColor=vec4(col*(1.2+uPow),clamp(a,0.,1.));
                    }`,
            }));
        v.beamLayers = [beamLayer(.05, '#fff6dd', '#ffd27a', 7, 1), beamLayer(.11, '#4a86ff', '#9fd0ff', 4.5, .55)];
        v.beamLayers.forEach(b => v.beamG.add(b));
        v.beamCore = new THREE.Mesh(new THREE.CylinderGeometry(.018, .024, 1, 8, 1, true),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
        v.beamG.add(v.beamCore);
        v.beamRings = [];
        for (let i = 0; i < 4; i++) {
            const r = new THREE.Mesh(new THREE.TorusGeometry(0.16, .006, 6, 28),
                new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
            r.rotation.x = Math.PI / 2;
            v.beamG.add(r);
            v.beamRings.push({ m: r, s: i / 4 });
        }
        v.streamN = 160;
        v.streamGeo = new THREE.BufferGeometry();
        v.streamPos = new Float32Array(v.streamN * 3);
        v.streamS = new Float32Array(v.streamN);
        v.streamR = new Float32Array(v.streamN * 2);
        for (let i = 0; i < v.streamN; i++) {
            v.streamS[i] = Math.random();
            v.streamR[i * 2] = Math.random() * 6.28;
            v.streamR[i * 2 + 1] = Math.random();
        }
        v.streamGeo.setAttribute('position', new THREE.BufferAttribute(v.streamPos, 3));
        v.stream = new THREE.Points(v.streamGeo, new THREE.PointsMaterial({
            map: fx._sprite, color: 0xcfe8ff, size: .045, transparent: true, opacity: 0,
            depthWrite: false, blending: THREE.AdditiveBlending,
        }));
        v.stream.frustumCulled = false;
        fx.group.add(v.stream);
        v.impactGlow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: fx._sprite, color: 0xffd080, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        v.impactGlow.position.copy(hole);
        v.impactGlow.position.y += 0.06;
        fx.group.add(v.impactGlow);

        // --- 7 · GÖKSEL PATLAMA: altın kıvılcım + TÜYLER + kristaller ---
        v.sparks = makeFirePoints(300, fx._sprite, THREE.AdditiveBlending);
        fx.group.add(v.sparks.pts);
        v.feathers = [];
        for (let i = 0; i < 22; i++) {
            const m = new THREE.Mesh(new THREE.PlaneGeometry(.045, .1), new THREE.MeshBasicMaterial({
                map: tex.feather, transparent: true, opacity: 0,
                blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
            }));
            fx.group.add(m);
            v.feathers.push({ m, vel: new THREE.Vector3(), rot: new THREE.Vector3((Math.random() - .5) * 4, (Math.random() - .5) * 4, (Math.random() - .5) * 4) });
        }
        v.tetra = [];
        for (let i = 0; i < 12; i++) {
            const m = new THREE.Mesh(new THREE.TetrahedronGeometry(.02 + Math.random() * .025),
                new THREE.MeshBasicMaterial({ color: 0xffdf9a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
            fx.group.add(m);
            v.tetra.push({ m, vel: new THREE.Vector3(), rot: new THREE.Vector3((Math.random() - .5) * 6, (Math.random() - .5) * 6, (Math.random() - .5) * 6) });
        }

        v._focus = new THREE.Vector3();
    },

    update(fx, t, dt) {
        const v = fx.v, hole = fx._hole;
        const sdt = Math.max(0, Math.min(t - v._lastT, 0.05));   // FREEZE'de 0
        v._lastT = t;

        // portal + çatlaklar kameraya yaw döner (önizlemede sabit açı fallback'i)
        const cp = fx.camera ? fx.camera.position : _tmpV.set(hole.x + 1.15, hole.y + 0.8, hole.z + 1.15);
        v.portalG.lookAt(cp.x, v.portalG.position.y, cp.z);

        // --- zarflar ---
        const sealReveal = easeOutC(clamp(t / 1.6, 0, 1));
        const awaken = smooth(T.P1, T.P2 + 0.4, t);
        const portalOpen = smooth(T.P2, T.P2 + 0.8, t) * (1 - smooth(T.P5 + 0.8, T.P6 - 0.4, t));
        const emerge = smooth(T.P2 + 0.5, T.P3 + 0.4, t);
        const retreat = smooth(T.P5 + 0.4, T.P6 - 0.6, t);
        const charge = easeInC(smooth(T.P3 + 0.3, T.P4 - 0.05, t)) * (1 - smooth(T.P4, T.P4 + 0.15, t));
        const beamEnv = smooth(T.P4, T.P4 + 0.2, t) * (1 - smooth(T.P5 + 0.3, T.P5 + 0.9, t));

        // mühür
        v.sealUni.uTime.value = t;
        v.sealUni.uReveal.value = sealReveal * (1 - smooth(T.P6 - 1.2, T.P6 - 0.3, t));
        v.sealUni.uIntensity.value = 0.75 + awaken * 0.55 + beamEnv * 0.5;
        v._spinSpeed = lerp(v._spinSpeed, 0.15 + awaken * 2.1, Math.min(1, sdt * 0.8 * 8));
        v._spinA += sdt * v._spinSpeed;
        v._spinB += sdt * v._spinSpeed * 0.65;
        v.sealUni.uSpinA.value = v._spinA;
        v.sealUni.uSpinB.value = v._spinB;

        // sütunlar + küreler + rünler
        v.pillarUni.uTime.value = t;
        v.pillarUni.uPow.value = awaken * 0.8 * (1 - smooth(T.P5, T.P5 + 0.8, t));
        v.pillars.forEach((m, i) => {
            m.scale.y = Math.max(.001, easeOutC(clamp(awaken * 1.4 - i * .08, 0, 1)));
            m.position.y = hole.y + m.scale.y * 0.42;
        });
        for (const o of v.orbs) {
            o.ang += sdt * o.speed * (0.3 + awaken * 1.6);
            o.spr.position.set(
                hole.x + Math.cos(o.ang) * o.rad,
                hole.y + 0.12 + Math.sin(t * 1.3 + o.yo) * 0.08 + awaken * 0.12,
                hole.z + Math.sin(o.ang) * o.rad);
            o.spr.material.opacity = awaken * 0.9 * (1 - smooth(T.P5, T.P5 + 0.8, t));
        }
        for (const rn of v.runes) {
            if (!rn.exploded) {
                const h = easeOutC(clamp(awaken * 1.3, 0, 1)) * rn.rise + 0.05;
                rn.m.position.set(
                    hole.x + Math.cos(rn.ang + t * .12 * awaken) * rn.rad,
                    hole.y + h + Math.sin(t * .9 + rn.ph) * 0.04,
                    hole.z + Math.sin(rn.ang + t * .12 * awaken) * rn.rad);
                rn.m.material.opacity = awaken * 0.85 * (1 - smooth(T.P5 + 0.6, T.P6 - 0.6, t));
            } else {
                rn.vel.y -= sdt * 0.4;
                rn.vel.multiplyScalar(1 - sdt * .9);
                rn.m.position.addScaledVector(rn.vel, sdt);
                rn.m.material.opacity = Math.max(0, rn.m.material.opacity - sdt * .45);
            }
            rn.m.rotation.y += sdt * rn.spin;
            rn.m.rotation.z += sdt * rn.spin * .4;
        }

        // portal + uzay çatlakları
        const crackK = smooth(T.P2 - 0.4, T.P2, t) * (1 - smooth(T.P2 + 0.3, T.P2 + 0.7, t));
        v.cracks.material.opacity = crackK * (.5 + .5 * Math.sin(t * 22));
        v.cracks.scale.setScalar(.4 + smooth(T.P2 - 0.4, T.P2 + 0.4, t) * 1.1);
        v.portalUni.uTime.value = t;
        v.portalUni.uOpen.value = portalOpen;
        v.portal.scale.setScalar(Math.max(.001, portalOpen * (1 + Math.sin(t * 7) * .015)));
        v.occluder.visible = portalOpen > .02;
        v.occluder.scale.setScalar(Math.max(.001, portalOpen));

        // ejder gelişi + baş/çene
        v.dragon.visible = portalOpen > 0.05;
        v.dragon.position.z = lerp(-0.5, 0.42, easeOutC(emerge)) - retreat * 0.95;
        v.dragon.position.y = Math.sin(t * .7) * .02 * emerge;
        v.dragonUni.uTime.value = t;
        v.dragonUni.uRim.value = (0.25 + emerge * .75 + charge * .6 + beamEnv * .6) * (1 - retreat);
        v.eyeGlows.forEach(g => {
            g.material.opacity = smooth(T.P2 + 0.4, T.P2 + 0.9, t) * .95 * (1 - retreat) * (0.8 + 0.2 * Math.sin(t * 2.7));
        });
        const up5 = easeOutC(smooth(T.P3 + 0.2, T.P4 - 0.6, t));      // kükreme: baş kalkar
        const down6 = easeOutC(smooth(T.P4, T.P4 + 0.25, t));        // nefes: cebe eğilir
        v.head.rotation.x = (-.4 * up5 + .55 * down6) * (1 - retreat);
        v.jaw.rotation.x = easeOutC(smooth(T.P3 + 0.3, T.P4 - 0.5, t)) * .62 * (1 - smooth(T.P5 + 0.3, T.P5 + 0.8, t));

        // ağız dünyası (şarj + nefes buradan)
        v.portalG.updateMatrixWorld(true);
        v.mouthAnchor.getWorldPosition(v._mouth);

        // şarj küresi + arklar
        v.sphereUni.uTime.value = t;
        v.energySphere.position.copy(v._mouth);
        v.energySphere.scale.setScalar(Math.max(.001, charge * 0.14));
        v.sphereGlow.position.copy(v._mouth);
        v.sphereGlow.scale.setScalar(charge * 0.6 + 0.001);
        v.sphereGlow.material.opacity = charge * .85;
        const arcOp = Math.max(charge, beamEnv * .8);
        if (arcOp > .05 && sdt > 0) {   // FREEZE'de arklar DONMUŞ kalır
            const rad = 0.12 + charge * 0.12;
            const pos = v.arcGeo.attributes.position.array;
            let idx = 0;
            for (let a = 0; a < 4; a++) {
                const u = Math.random() * 2 - 1, an = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
                const ex = v._mouth.x + s * Math.cos(an) * rad * 2.4;
                const ey = v._mouth.y + u * rad * 2.4;
                const ez = v._mouth.z + s * Math.sin(an) * rad * 2.4;
                let px = v._mouth.x, py = v._mouth.y, pz = v._mouth.z;
                for (let seg = 1; seg <= 9; seg++) {
                    const k = seg / 9, jag = (1 - k) * rad * .9;
                    const nx = v._mouth.x + (ex - v._mouth.x) * k + (Math.random() - .5) * jag;
                    const ny = v._mouth.y + (ey - v._mouth.y) * k + (Math.random() - .5) * jag;
                    const nz = v._mouth.z + (ez - v._mouth.z) * k + (Math.random() - .5) * jag;
                    pos[idx++] = px; pos[idx++] = py; pos[idx++] = pz;
                    pos[idx++] = nx; pos[idx++] = ny; pos[idx++] = nz;
                    px = nx; py = ny; pz = nz;
                }
            }
            v.arcGeo.attributes.position.needsUpdate = true;
            v.arcs.material.opacity = arcOp * (.4 + .6 * Math.random());
        } else if (arcOp <= .05) {
            v.arcs.material.opacity *= 0.9;
        }

        // ilahi nefes (ağızdan CEBE)
        v.beamG.visible = beamEnv > 0.01;
        if (v.beamG.visible) {
            v._dir.copy(hole).sub(v._mouth);
            const len = v._dir.length();
            v._dir.normalize();
            v.beamG.position.copy(v._mouth).addScaledVector(v._dir, len / 2);
            v.beamG.quaternion.setFromUnitVectors(_UP, _tmpV.copy(v._dir).negate());
            const pulse = 1 + Math.sin(t * 17) * .07 + Math.sin(t * 31) * .04;
            for (const b of v.beamLayers) {
                b.scale.set(pulse * beamEnv, len, pulse * beamEnv);
                b.material.uniforms.uTime.value = t;
                b.material.uniforms.uPow.value = beamEnv;
            }
            v.beamCore.scale.set(beamEnv, len, beamEnv);
            v.beamCore.material.opacity = beamEnv;
            for (const r of v.beamRings) {
                r.s = (r.s + sdt * .9) % 1;
                r.m.position.set(0, -(r.s - .5) * len, 0);
                r.m.scale.setScalar(Math.max(.001, (1 + r.s * 1.6) * beamEnv));
                r.m.material.opacity = beamEnv * .7 * Math.sin(r.s * Math.PI);
            }
            for (let i = 0; i < v.streamN; i++) {
                v.streamS[i] = (v.streamS[i] + sdt * (1.4 + v.streamR[i * 2 + 1])) % 1;
                const k = v.streamS[i];
                const rad = (.03 + v.streamR[i * 2 + 1] * .1) * Math.sin(k * Math.PI);
                const ang = v.streamR[i * 2] + t * 4;
                v.streamPos[i * 3] = lerp(v._mouth.x, hole.x, k) + Math.cos(ang) * rad;
                v.streamPos[i * 3 + 1] = lerp(v._mouth.y, hole.y, k) + Math.sin(ang) * rad * .6;
                v.streamPos[i * 3 + 2] = lerp(v._mouth.z, hole.z, k);
            }
            v.streamGeo.attributes.position.needsUpdate = true;
            v.stream.material.opacity = beamEnv * .9;
            v.impactGlow.material.opacity = beamEnv;
            v.impactGlow.scale.setScalar(0.5 + Math.sin(t * 13) * .1);
        } else {
            v.stream.material.opacity *= .9;
            v.impactGlow.material.opacity *= .9;
        }

        // patlama artıkları (tüyler/kristaller — detonate fırlatır)
        if (t >= T.P4) {
            const et = t - T.P4;
            for (const f of v.feathers) {
                f.vel.y -= sdt * 0.18;
                f.vel.multiplyScalar(1 - sdt * .7);
                f.m.position.addScaledVector(f.vel, sdt);
                f.m.rotation.x += f.rot.x * sdt; f.m.rotation.y += f.rot.y * sdt; f.m.rotation.z += f.rot.z * sdt;
                f.m.material.opacity = Math.max(0, 1 - et / 3);
            }
            for (const c of v.tetra) {
                c.vel.y -= sdt * 0.4;
                c.vel.multiplyScalar(1 - sdt * .6);
                c.m.position.addScaledVector(c.vel, sdt);
                c.m.rotation.x += c.rot.x * sdt; c.m.rotation.y += c.rot.y * sdt;
                c.m.material.opacity = Math.max(0, 1 - et / 2.4);
            }
        }
        v.sparks.update(sdt, (i, k, d2) => {
            v.sparks.vel[i].y -= 1.2 * d2;
            v.sparks.col[i * 3 + 1] = Math.max(0.2, 0.85 - k * 0.7);
            v.sparks.col[i * 3 + 2] = Math.max(0.05, 0.55 - k * 0.7);
            v.sparks.alp[i] = 1 - k;
            v.sparks.siz[i] *= 1 - d2 * 0.5;
        });
    },

    balls(fx, t, dt) {
        // Huşu: ejder belirdikçe toplar titrer + hafifçe havalanır
        const g = smooth(T.P2, T.P4, t);
        for (const b of fx._ballState) {
            if (!b.mesh.parent) continue;
            b.mesh.position.x = b.start.x + (Math.random() - 0.5) * 0.006 * g;
            b.mesh.position.z = b.start.z + (Math.random() - 0.5) * 0.006 * g;
            b.mesh.position.y = b.y0 + g * 0.02 * (0.5 + 0.5 * Math.sin(t * 3 + b.baseRadius * 5));
        }
    },

    detonate(fx) {
        const v = fx.v, hole = fx._hole;
        fx._spawnShockwave(0xffd27a, 0.14);
        // altın kıvılcım + tüy + kristal patlaması (nefes cebe değdiği an)
        for (let i = 0; i < 220; i++) {
            const a = Math.random() * Math.PI * 2, u = Math.random();
            const sp = 0.6 + Math.random() * 2.2;
            v.sparks.emit(hole.x, hole.y + 0.05, hole.z,
                Math.cos(a) * Math.sqrt(1 - u * u) * sp, (u * .9 + .15) * sp, Math.sin(a) * Math.sqrt(1 - u * u) * sp,
                0.8 + Math.random() * 1.4, 0.015 + Math.random() * 0.03,
                1, 0.85, 0.55, null);
        }
        for (const f of v.feathers) {
            f.m.position.set(hole.x, hole.y + 0.08, hole.z);
            const d = new THREE.Vector3(Math.random() - .5, Math.abs(Math.random() - .5) + .25, Math.random() - .5).normalize();
            f.vel.copy(d.multiplyScalar(0.5 + Math.random() * 1.1));
            f.m.material.opacity = 1;
        }
        for (const c of v.tetra) {
            c.m.position.set(hole.x, hole.y + 0.08, hole.z);
            const d = new THREE.Vector3(Math.random() - .5, Math.abs(Math.random() - .5) * .8 + .1, Math.random() - .5).normalize();
            c.vel.copy(d.multiplyScalar(0.7 + Math.random() * 1.5));
            c.m.material.opacity = 1;
        }
    },

    // Bakış portala süzülür (ejder gelişini izle), nefesten hemen önce cebe döner
    focus(fx, t) {
        const v = fx.v;
        const pull = 0.6 * smooth(T.P2 - 0.2, T.P2 + 0.6, t) * (1 - smooth(T.P4 - 0.4, T.P4 - 0.05, t));
        v._focus.copy(fx._hole).lerp(v.portalG.position, pull);
        return v._focus;
    },
};

// ---------------------------------------------
// Time Fracture (timefracture) yardımcıları
// Konsept: _assets_src/finishers/new_finishers/time-fracture.html
// ---------------------------------------------
const ROMAN = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
let _romanTexCache = null;
function romanTextures() {   // modül önbelleği — önizleme döngüsü sızıntı yapmasın
    if (_romanTexCache) return _romanTexCache;
    _romanTexCache = ROMAN.map(txt => _canvasTex(128, 128, (g) => {
        g.font = '52px "Times New Roman", serif';
        g.fillStyle = 'rgba(160, 190, 255, 0.9)';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(txt, 64, 64);
    }));
    return _romanTexCache;
}

// =====================================================
// ⏳ TIME FRACTURE — kozmik saat: zaman durur, geri sarar, sıkışır, KIRILIR
// Görsel tasarım time-fracture.html konseptinden port edildi (41sn → 9.6sn).
// Akış: zaman çekirdeği belirir → cebin üstünde astronomik saat kurulur
// (jiroskopik halkalar + Roma rakamları + akrep/yelkovan) → gerçeklik çatlağı
// yükselir → GERİ SARMA (her şey tersine döner) → SIKIŞMA (saat çekirdeğe
// emilir; host FREEZE'i = tekillik asılı an — zamanın DURMASI temanın kendisi)
// → P4'te TIME BREAK: beyaz flaş + saat CAM KIRIKLARINA ayrılır (her kırığın
// kendi zaman akışı/flicker'ı var) → yankı halkaları + dağılma.
// =====================================================
const timefracture = {
    icon: '⏳',
    name: 'Zaman',
    desc: 'Kozmik saat kurulur, zaman geri sarar ve sıkışır — sonra cam gibi kırılır.',
    title: 'TIME FRACTURE',
    textGrad: 'linear-gradient(90deg,#99bbff,#e6eeff,#8877ff,#ffffff,#99bbff)',
    textGlow: '0 0 30px rgba(130,160,255,0.75),0 0 60px rgba(120,90,255,0.5)',
    lens: 0.5,   // host lens warp'ı "zaman bükülmesi" olarak okunur
    shock: [0xffffff, 0x99bbff, 0x8866ff],
    burstPalette: [
        [0.4, 0.6, 1.0], [0.6, 0.4, 1.0], [0.8, 0.9, 1.0], [1.0, 1.0, 1.0], [0.5, 0.75, 1.0],
    ],
    dustColor: 0xaac4ff,

    build(fx) {
        const v = fx.v, hole = fx._hole;
        v._lastT = 0;
        v.center = hole.clone();
        v.center.y += 0.42;   // saat cebin üstünde asılı

        // --- zaman çekirdeği: fresnel + nabız + yüzey akışı ---
        v.coreUni = {
            time: { value: 0 }, intensity: { value: 0 },
            color1: { value: new THREE.Color(0x4488ff) }, color2: { value: new THREE.Color(0x8844ff) },
            pulseSpeed: { value: 3.0 },
        };
        v.core = new THREE.Mesh(new THREE.SphereGeometry(0.09, 32, 32), new THREE.ShaderMaterial({
            uniforms: v.coreUni,
            transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
            vertexShader: `
                varying vec2 vUv; varying vec3 vNormal; varying vec3 vPosition;
                uniform float time; uniform float intensity;
                void main() {
                    vUv = uv;
                    vNormal = normalize(normalMatrix * normal);
                    vec3 pos = position;
                    float displacement = sin(pos.x * 80.0 + time * 2.0) * sin(pos.y * 80.0 + time * 1.5) * sin(pos.z * 80.0 + time * 3.0) * 0.008 * intensity;
                    pos += normal * displacement;
                    vPosition = pos;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                }`,
            fragmentShader: `
                uniform float time; uniform float intensity;
                uniform vec3 color1; uniform vec3 color2; uniform float pulseSpeed;
                varying vec2 vUv; varying vec3 vNormal; varying vec3 vPosition;
                float noise(vec3 p) {
                    return fract(sin(dot(p, vec3(12.9898, 78.233, 45.543))) * 43758.5453);
                }
                void main() {
                    float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.5);
                    float pulse = sin(time * pulseSpeed) * 0.3 + 0.7;
                    float energy = noise(vPosition * 50.0 + time * 0.5) * 0.5 + 0.5;
                    float flow = sin(vUv.y * 20.0 + time * 2.0) * 0.5 + 0.5;
                    vec3 col = mix(color1, color2, flow * energy);
                    col += vec3(0.3, 0.4, 0.8) * fresnel;
                    float alpha = (fresnel * 0.8 + energy * 0.3) * intensity * pulse;
                    gl_FragColor = vec4(col * (1.0 + fresnel), alpha);
                }`,
        }));
        v.core.position.copy(v.center);
        fx.group.add(v.core);
        v.coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: fx._sprite, color: 0x5566cc, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        v.coreGlow.position.copy(v.center);
        fx.group.add(v.coreGlow);

        // --- jiroskopik saat halkaları + tik çizgileri (LineSegments = tek çizim) ---
        v.ringDatas = [];
        const ringCfgs = [
            { radius: 0.28, tube: 0.004, rx: 0.3, ry: 0, speed: 0.15, ticks: 24 },
            { radius: 0.38, tube: 0.0035, rx: -0.5, ry: 0.2, speed: -0.1, ticks: 12 },
            { radius: 0.48, tube: 0.005, rx: 0.1, ry: -0.4, speed: 0.08, ticks: 24 },
            { radius: 0.20, tube: 0.003, rx: 0.7, ry: 0.5, speed: -0.2, ticks: 12 },
        ];
        v.clockG = new THREE.Group();
        v.clockG.position.copy(v.center);
        fx.group.add(v.clockG);
        for (const cfg of ringCfgs) {
            const rg = new THREE.Group();
            const torus = new THREE.Mesh(new THREE.TorusGeometry(cfg.radius, cfg.tube, 10, 72),
                new THREE.MeshBasicMaterial({ color: 0x6688cc, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
            rg.add(torus);
            const tp = [];
            for (let i = 0; i < cfg.ticks; i++) {
                const a = i / cfg.ticks * Math.PI * 2;
                const isMajor = i % Math.max(1, cfg.ticks / 12) === 0;
                const inner = cfg.radius - (isMajor ? 0.045 : 0.02);
                tp.push(Math.cos(a) * inner, Math.sin(a) * inner, 0, Math.cos(a) * cfg.radius, Math.sin(a) * cfg.radius, 0);
            }
            const tg = new THREE.BufferGeometry();
            tg.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
            const ticks = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({
                color: 0x8899dd, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
            }));
            rg.add(ticks);
            rg.rotation.x = cfg.rx;
            rg.rotation.y = cfg.ry;
            v.clockG.add(rg);
            v.ringDatas.push({ group: rg, speed: cfg.speed, mats: [torus.material, ticks.material] });
        }

        // --- Roma rakamları (yatay çember; sprite = her açıdan okunur) ---
        v.numerals = [];
        const rTex = romanTextures();
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
            const s = new THREE.Sprite(new THREE.SpriteMaterial({
                map: rTex[i], transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
            }));
            s.scale.setScalar(0.07);
            s.position.set(v.center.x + Math.cos(a) * 0.36, v.center.y, v.center.z + Math.sin(a) * 0.36);
            fx.group.add(s);
            v.numerals.push({ s, ang: a });
        }

        // --- akrep/yelkovan: yatay düzlemde döner (güneş saati gibi) ---
        v.handG = new THREE.Group();
        v.handG.position.copy(v.center);
        v.handG.rotation.x = -Math.PI / 2;
        fx.group.add(v.handG);
        v.handDatas = [];
        const handCfgs = [
            { len: 0.26, w: 0.006, color: 0x99bbff, speed: 1.0 },
            { len: 0.20, w: 0.009, color: 0x7799dd, speed: 1 / 8 },
            { len: 0.13, w: 0.012, color: 0x5577bb, speed: 1 / 40 },
        ];
        for (const cfg of handCfgs) {
            const geo = new THREE.PlaneGeometry(cfg.w, cfg.len);
            geo.translate(0, cfg.len / 2, 0);
            const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
                color: cfg.color, transparent: true, opacity: 0,
                blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
            }));
            v.handG.add(m);
            v.handDatas.push({ mesh: m, speed: cfg.speed, angle: Math.random() * 6.28 });
        }

        // --- gerçeklik çatlağı: cepten yükselen dikey enerji yarığı + 2 dal ---
        v.crackUni = {
            time: { value: 0 }, crackWidth: { value: 0 }, crackLength: { value: 0 },
            glowColor1: { value: new THREE.Color(0x4488ff) }, glowColor2: { value: new THREE.Color(0x9944ff) },
            intensity: { value: 0 },
        };
        const crackMatSrc = {
            transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
            uniforms: v.crackUni,
            vertexShader: `
                varying vec2 vUv;
                uniform float time; uniform float crackWidth;
                void main() {
                    vUv = uv;
                    vec3 pos = position;
                    float jag = sin(pos.y * 15.0 + time * 3.0) * 0.02
                              + sin(pos.y * 30.0 - time * 5.0) * 0.008
                              + sin(pos.y * 60.0 + time * 7.0) * 0.004;
                    pos.x += jag * crackWidth * 8.0;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
                }`,
            fragmentShader: `
                uniform float time; uniform float crackWidth; uniform float crackLength;
                uniform vec3 glowColor1; uniform vec3 glowColor2; uniform float intensity;
                varying vec2 vUv;
                float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
                void main() {
                    float centerDist = abs(vUv.x - 0.5) * 2.0;
                    float verticalMask = 1.0 - smoothstep(0.0, crackLength, abs(vUv.y - 0.5) * 2.0);
                    float crack = smoothstep(crackWidth * 0.8, 0.0, centerDist) * verticalMask;
                    float innerGlow = smoothstep(crackWidth * 3.0, 0.0, centerDist) * verticalMask * 0.5;
                    float outerGlow = smoothstep(crackWidth * 8.0, 0.0, centerDist) * verticalMask * 0.15;
                    float flicker = hash(vec2(floor(vUv.y * 50.0), floor(time * 10.0))) * 0.3 + 0.7;
                    float colorMix = sin(vUv.y * 10.0 + time * 3.0) * 0.5 + 0.5;
                    vec3 color = mix(glowColor1, glowColor2, colorMix);
                    vec3 finalColor = vec3(0.9, 0.95, 1.0) * crack + color * (innerGlow + outerGlow);
                    float alpha = (crack + innerGlow + outerGlow) * intensity * flicker;
                    gl_FragColor = vec4(finalColor, alpha);
                }`,
        };
        v.crackG = new THREE.Group();
        v.crackG.position.set(hole.x, hole.y + 0.72, hole.z);
        fx.group.add(v.crackG);
        v.crackG.add(new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.5, 12, 48), new THREE.ShaderMaterial(crackMatSrc)));
        for (let i = 0; i < 2; i++) {
            const b = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.45, 6, 16), new THREE.ShaderMaterial(crackMatSrc));
            b.position.set(0, (i ? 0.3 : -0.25), 0.01 + i * 0.01);
            b.rotation.z = i ? -0.6 : 0.7;
            v.crackG.add(b);
        }

        // --- zaman tozu: saat çevresinde süzülen renkli noktalar (CPU) ---
        {
            const N = 400;
            const pos = new Float32Array(N * 3);
            const col = new Float32Array(N * 3);
            v.dustVel = [];
            for (let i = 0; i < N; i++) {
                const a = Math.random() * Math.PI * 2, r = 0.15 + Math.random() * 0.95;
                pos[i * 3] = v.center.x + Math.cos(a) * r;
                pos[i * 3 + 1] = hole.y + 0.05 + Math.random() * 0.8;
                pos[i * 3 + 2] = v.center.z + Math.sin(a) * r;
                v.dustVel.push(new THREE.Vector3((Math.random() - .5) * .03, (Math.random() - .5) * .03, (Math.random() - .5) * .015));
                const cc = Math.random();
                if (cc < 0.5) { col[i * 3] = 0.4; col[i * 3 + 1] = 0.6; col[i * 3 + 2] = 0.95; }
                else if (cc < 0.8) { col[i * 3] = 0.6; col[i * 3 + 1] = 0.4; col[i * 3 + 2] = 0.95; }
                else { col[i * 3] = 0.85; col[i * 3 + 1] = 0.9; col[i * 3 + 2] = 1.0; }
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
            v.dustGeo = geo;
            v.dust = new THREE.Points(geo, new THREE.PointsMaterial({
                size: 0.018, map: fx._sprite, vertexColors: true, transparent: true,
                blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
            }));
            v.dust.frustumCulled = false;
            fx.group.add(v.dust);
        }

        // --- cam kırıkları (patlamada saatin parçaları) ---
        v.frags = [];
        v.fragG = new THREE.Group();
        v.fragG.visible = false;
        fx.group.add(v.fragG);
        for (let i = 0; i < 50; i++) {
            const w = 0.02 + Math.random() * 0.05, h = 0.02 + Math.random() * 0.05;
            const hue = 0.55 + Math.random() * 0.2;
            const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
                color: new THREE.Color().setHSL(hue, 0.55, 0.65), transparent: true, opacity: 0,
                blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
            }));
            v.fragG.add(m);
            const sp = 0.25 + Math.random() * 0.7;
            v.frags.push({
                mesh: m,
                vel: new THREE.Vector3(Math.random() - .5, Math.random() - .5, (Math.random() - .5) * .5).normalize().multiplyScalar(sp),
                rotVel: new THREE.Vector3((Math.random() - .5) * 6, (Math.random() - .5) * 6, (Math.random() - .5) * 6),
                timeSpeed: 0.2 + Math.random() * 2.8,   // her kırığın KENDİ zaman akışı
                ph: Math.random() * 6.28,
            });
        }

        // --- yankı/dalga halkaları havuzu (patlama sonrası) ---
        v.echoes = [];
        for (let i = 0; i < 5; i++) {
            const m = new THREE.Mesh(new THREE.TorusGeometry(0.15 + Math.random() * 0.3, 0.003, 8, 48),
                new THREE.MeshBasicMaterial({
                    color: new THREE.Color().setHSL(0.55 + Math.random() * 0.15, 0.4, 0.6),
                    transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
                }));
            m.position.copy(v.center);
            m.rotation.set((Math.random() - .5) * 2, (Math.random() - .5) * 2, (Math.random() - .5) * 2);
            fx.group.add(m);
            v.echoes.push({ mesh: m, rotSpeed: (Math.random() - .5), ph: Math.random() * 6.28, grow: 0.6 + Math.random() * 0.8 });
        }

        // beyaz flaş
        v.flash = new THREE.Sprite(new THREE.SpriteMaterial({
            map: fx._sprite, color: 0xeef4ff, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        v.flash.position.copy(v.center);
        v.flash.scale.setScalar(3);
        fx.group.add(v.flash);

        v._focus = new THREE.Vector3();
    },

    update(fx, t, dt) {
        const v = fx.v, hole = fx._hole;
        const sdt = Math.max(0, Math.min(t - v._lastT, 0.05));   // FREEZE'de 0 → zaman DURUR
        v._lastT = t;

        // çatlak kameraya yaw döner (önizlemede sabit açı)
        const cp = fx.camera ? fx.camera.position : _tmpV.set(hole.x + 1.15, hole.y + 0.8, hole.z + 1.15);
        v.crackG.lookAt(cp.x, v.crackG.position.y, cp.z);

        // --- faz zarfları ---
        const REWIND0 = 4.4, REWIND1 = 5.1;
        const comp = t < T.P4 ? smooth(REWIND1, 5.95, t) : 1;      // FREEZE pini = yarı-sıkışmış
        const clockIn = smooth(T.P1 - 0.3, T.P2, t);
        const inRewind = t >= REWIND0 && t < REWIND1;
        const rewindK = inRewind ? (-3 - Math.sin((t - REWIND0) / (REWIND1 - REWIND0) * Math.PI) * 5) : 1;
        const broken = t >= T.P4;

        // saat tik flaşı (P1 öncesi ritmik nabız) + çekirdek
        const tickFlash = Math.pow(Math.max(0, 1 - ((t % 0.9) / 0.9) * 5), 3);
        v.coreUni.time.value = t;
        v.coreUni.intensity.value = broken ? 0
            : (smooth(0.25, T.P1, t) * 0.35 * (1 + tickFlash * 0.5) + clockIn * 0.3 + comp * 2.2);
        v.coreUni.pulseSpeed.value = 3 + comp * 12;
        v.core.visible = !broken;
        v.core.scale.setScalar(1 + comp * 0.6);
        v.coreGlow.material.opacity = broken ? 0 : (0.25 * smooth(0.25, T.P1, t) + comp * 0.5);
        v.coreGlow.scale.setScalar(0.3 + comp * 0.4 + tickFlash * 0.05);

        // halkalar: normal dönüş → geri sarma → sıkışma (hepsi sdt → FREEZE'de donar)
        v.clockG.visible = !broken;
        if (!broken) {
            const ringOp = clockIn * 0.35 * (inRewind ? (1 + Math.sin(t * 8) * 0.3) : 1) * (1 + comp * 0.9);
            const ringScale = Math.max(0.02, 1 - comp * 0.9);
            for (const rd of v.ringDatas) {
                rd.group.rotation.z += rd.speed * rewindK * (1 - comp * 0.8) * sdt * 4;
                rd.group.scale.setScalar(ringScale);
                for (const m of rd.mats) m.opacity = ringOp;
            }
            for (const hd of v.handDatas) {
                hd.angle += hd.speed * (inRewind ? rewindK * 2 : (2 + comp * 20)) * sdt * 2 * Math.PI;
                hd.mesh.rotation.z = -hd.angle;
                hd.mesh.scale.setScalar(Math.max(0.02, 1 - comp * 0.9));
                hd.mesh.material.opacity = clockIn * 0.55;
            }
            for (let i = 0; i < v.numerals.length; i++) {
                const n = v.numerals[i];
                const r = 0.36 * (1 - comp * 0.95);
                n.s.position.set(v.center.x + Math.cos(n.ang) * r, v.center.y, v.center.z + Math.sin(n.ang) * r);
                n.s.material.opacity = clockIn * 0.55 * (1 - comp * 0.4);
            }
        } else {
            for (const hd of v.handDatas) hd.mesh.material.opacity = 0;
            for (const n of v.numerals) n.s.material.opacity = 0;
        }

        // gerçeklik çatlağı (P2→sıkışmada incelir, kırılınca yok)
        const crackGrow = smooth(T.P2, T.P3 - 0.3, t) * (broken ? 0 : 1);
        v.crackG.visible = crackGrow > 0.01;
        v.crackUni.time.value = t;
        v.crackUni.crackWidth.value = lerp(0, 0.12, crackGrow) * (1 - comp * 0.8)
            + (inRewind ? Math.sin(t * 6) * 0.02 : 0);
        v.crackUni.crackLength.value = crackGrow;
        v.crackUni.intensity.value = crackGrow * (1.2 + comp * 1.3) + (inRewind ? Math.sin(t * 10) * 0.3 : 0);

        // zaman tozu: süzülme → geri sarma → içeri emilme → patlama → titreşim
        v.dust.material.opacity = broken ? Math.max(0, 0.8 - (t - T.P4) / 2.4) : (clockIn * 0.55 + comp * 0.4);
        if (sdt > 0) {
            const arr = v.dustGeo.attributes.position.array;
            for (let i = 0; i < v.dustVel.length; i++) {
                if (broken) {   // dışa patlama + titreşim
                    const dx = arr[i * 3] - v.center.x, dy = arr[i * 3 + 1] - v.center.y, dz = arr[i * 3 + 2] - v.center.z;
                    const dl = Math.max(0.05, Math.hypot(dx, dy, dz));
                    arr[i * 3] += (dx / dl) * sdt * 0.5 + Math.sin(t * 10 + i) * 0.001;
                    arr[i * 3 + 1] += (dy / dl) * sdt * 0.5;
                    arr[i * 3 + 2] += (dz / dl) * sdt * 0.5 + Math.cos(t * 10 + i * 1.3) * 0.001;
                } else if (comp > 0.01) {   // merkeze emilme
                    const k = Math.max(0, 1 - comp * 2.4 * sdt);
                    arr[i * 3] = v.center.x + (arr[i * 3] - v.center.x) * k;
                    arr[i * 3 + 1] = v.center.y + (arr[i * 3 + 1] - v.center.y) * k;
                    arr[i * 3 + 2] = v.center.z + (arr[i * 3 + 2] - v.center.z) * k;
                } else {
                    const m = inRewind ? -3 : 1;   // geri sarmada tersine akar
                    arr[i * 3] += v.dustVel[i].x * m * sdt;
                    arr[i * 3 + 1] += v.dustVel[i].y * m * sdt;
                    arr[i * 3 + 2] += v.dustVel[i].z * m * sdt;
                }
            }
            v.dustGeo.attributes.position.needsUpdate = true;
        }

        // TIME BREAK sonrası: cam kırıkları + yankı halkaları + flaş
        if (broken) {
            const et = t - T.P4;
            v.flash.material.opacity = Math.max(0, 1 - et * 2.2) * 0.9;
            for (const f of v.frags) {
                f.vel.multiplyScalar(1 - sdt * (f.timeSpeed < 0.5 ? 1.2 : 0.35));   // kimi kırık zamanda YAVAŞ
                f.mesh.position.addScaledVector(f.vel, sdt);
                f.mesh.rotation.x += f.rotVel.x * sdt;
                f.mesh.rotation.y += f.rotVel.y * sdt;
                f.mesh.rotation.z += f.rotVel.z * sdt;
                const timePulse = Math.sin(t * f.timeSpeed * 3 + f.ph) * 0.5 + 0.5;
                f.mesh.material.opacity = Math.max(0, lerp(0.85, 0.05, clamp(et / 2.8, 0, 1)) * (0.4 + timePulse * 0.6));
            }
            for (const e of v.echoes) {
                e.mesh.rotation.z += e.rotSpeed * sdt;
                const cyc = ((et * e.grow + e.ph) % 2) / 2;
                e.mesh.scale.setScalar(0.3 + cyc * 3.5);
                e.mesh.material.opacity = Math.max(0, 0.3 * (1 - cyc) * (1 - smooth(T.P6 - 1.0, T.P6 - 0.2, t)));
            }
        }
    },

    balls(fx, t, dt) {
        // Zaman durması: toplar titrer, sonra yavaşlayarak TAM durur
        const g = smooth(T.P2, T.P3, t);
        const still = smooth(T.P3, 5.4, t);   // zaman yavaşlar → donar
        for (const b of fx._ballState) {
            if (!b.mesh.parent) continue;
            const s = g * (1 - still);
            b.mesh.position.x = b.start.x + Math.sin(t * 27 + b.baseRadius * 9) * 0.004 * s;
            b.mesh.position.z = b.start.z + Math.cos(t * 23 + b.baseRadius * 5) * 0.004 * s;
            b.mesh.position.y = b.y0 + Math.abs(Math.sin(t * (8 - 5 * still) + b.baseRadius * 7)) * 0.012 * s;
        }
    },

    detonate(fx) {
        const v = fx.v;
        fx._spawnShockwave(0x99bbff, 0.12);
        // saat kırıldı: kırıklar merkezden fırlar
        v.fragG.visible = true;
        for (const f of v.frags) {
            f.mesh.position.copy(v.center);
            f.mesh.material.opacity = 0.85;
        }
    },

    // Saat cebin üstünde — bakış kuruluma süzülür, sıkışmada cebe geri döner
    focus(fx, t) {
        const v = fx.v;
        const lift = 0.35 * smooth(T.P1, T.P2 + 0.5, t) * (1 - smooth(5.2, T.P4 - 0.05, t));
        v._focus.set(fx._hole.x, fx._hole.y + lift, fx._hole.z);
        return v._focus;
    },
};

// Insertion order = menu order.
export const FINISHER_DEFS = { blackhole, cyclone, meteor, freeze, dragon, timefracture };
