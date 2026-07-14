// ============================================
// UltiBeam — "Enerji Dalgası" ultimate VFX (şarj topu + lazer)
// ============================================
// Görsel referans: _assets_src/ulti_ball.html (kırmızı-turuncu plazma topu +
// katmanlı lazer). Bu sınıf onun MOBİL BÜTÇELİ oyun-içi sürümü: 3 katmanlı
// plazma küre (kompakt fbm shader) + şarj halkaları + yakınsayan parçacıklar +
// 3 katmanlı lazer kolonu + gezen halkalar + uç parlaması + 1 point light.
//
// Sadece GÖRSEL — oyun etkisi (devirme/item süpürme) SabotageManager'da.
// Konum + yön her kare dışarıdan verilir (origin = karakterin önü, yaw = aim);
// FIRE sırasında yaw değişirse lazer SÜPÜRÜLÜR (Dragon Ball hissi).
// Nesneler bir kez kurulur; play() ile sıfırlanıp yeniden kullanılır (GC dostu).
// ============================================
import * as THREE from 'three';
import { BEAM } from '../constants.js';
import { makeSoftSprite } from './FinisherDefs.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// ---- Kompakt plazma küre shader'ı (ulti_ball.html'den sadeleştirildi) ----
const SPHERE_VERT = `
    varying vec3 vNormalW;
    varying vec3 vPosW;
    varying vec2 vUv;
    uniform float uTime;
    void main(){
        vUv = uv;
        vec3 n = normalize(normal);
        float d = (sin(position.y * 9.0 + uTime * 3.4) + sin(position.x * 12.0 - uTime * 4.2)) * 0.03;
        vec3 p = position + n * d;
        vec4 w = modelMatrix * vec4(p, 1.0);
        vPosW = w.xyz;
        vNormalW = normalize(mat3(modelMatrix) * n);
        gl_Position = projectionMatrix * viewMatrix * w;
    }
`;
const SPHERE_FRAG = `
    precision highp float;
    varying vec3 vNormalW;
    varying vec3 vPosW;
    varying vec2 vUv;
    uniform float uTime; uniform float uAlpha; uniform float uIntensity;
    uniform vec3 uColorA; uniform vec3 uColorB; uniform vec3 uColorC;
    float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float noise(vec3 p){
        vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(
            mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
            mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
            f.z);
    }
    float fbm(vec3 p){ float v = 0.0; float a = 0.5; for(int i = 0; i < 3; i++){ v += noise(p) * a; p *= 2.05; a *= 0.52; } return v; }
    void main(){
        vec3 viewDir = normalize(cameraPosition - vPosW);
        float fres = pow(1.0 - max(dot(normalize(vNormalW), viewDir), 0.0), 2.2);
        float plasma = fbm(vPosW * 60.0 + vec3(uTime * 0.9, -uTime * 0.7, uTime * 0.4));
        float hot = smoothstep(0.45, 0.95, plasma + uIntensity * 0.15);
        vec3 col = mix(uColorA, uColorB, plasma);
        col = mix(col, uColorC, hot * (0.5 + uIntensity * 0.35));
        col += uColorC * fres * (1.2 + uIntensity);
        float a = uAlpha * (0.2 + fres * 1.1 + hot * 0.25);
        gl_FragColor = vec4(col * (1.2 + uIntensity), a);
    }
`;

// ---- Kompakt lazer shader'ı (akış çizgileri + kenar + uç yumuşaması) ----
const BEAM_VERT = `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const BEAM_FRAG = `
    precision highp float;
    varying vec2 vUv;
    uniform float uTime; uniform float uAlpha; uniform float uPower;
    uniform vec3 uColorA; uniform vec3 uColorB; uniform vec3 uColorC;
    void main(){
        float along = vUv.y;
        float around = vUv.x;
        float flow = sin(along * 42.0 - uTime * 20.0 + sin(around * 6.283) * 2.2) * 0.5 + 0.5;
        float stripes = smoothstep(0.15, 1.0, flow + uPower * 0.2);
        float edge = pow(abs(sin(around * 3.14159)), 0.32);
        vec3 col = mix(uColorA, uColorB, stripes);
        col = mix(col, uColorC, smoothstep(0.6, 1.0, stripes));
        float frontFade = smoothstep(0.0, 0.05, along) * (1.0 - smoothstep(0.92, 1.0, along));
        float a = uAlpha * frontFade * (0.35 + edge * 0.65 + stripes * 0.2);
        gl_FragColor = vec4(col * (1.2 + uPower * 1.2), a);
    }
`;

const N_PARTICLES = 160;
const N_TRAVEL_RINGS = 6;

export class UltiBeam {
    constructor(scene) {
        this.scene = scene;
        this.active = false;
        this.t = 0;
        this.firing = false;
        this.justFired = false;
        this.done = false;
        this.dirX = 1; this.dirZ = 0;

        this._sprite = makeSoftSprite();
        this.group = new THREE.Group();          // top (origin'de)
        this.beamGroup = new THREE.Group();      // lazer (+X yönlü, yaw ile döner)
        this.group.add(this.beamGroup);
        this.group.visible = false;
        this.scene.add(this.group);

        this._buildBall();
        this._buildBeam();

        // Enerji ışığı — top şarj olurken sahneyi/karakteri kızıla boyar (his!).
        this.light = new THREE.PointLight(0xff4a24, 0, 3.4);
        this.group.add(this.light);
    }

    _sphereMat(alpha, intensity, colors) {
        return new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 }, uAlpha: { value: alpha }, uIntensity: { value: intensity },
                uColorA: { value: new THREE.Color(colors[0]) },
                uColorB: { value: new THREE.Color(colors[1]) },
                uColorC: { value: new THREE.Color(colors[2]) },
            },
            vertexShader: SPHERE_VERT, fragmentShader: SPHERE_FRAG,
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        });
    }

    _buildBall() {
        // 3 katman: dış / iç / çekirdek (ulti_ball paleti: kırmızı → turuncu → beyaz)
        this._outerMat = this._sphereMat(0.5, 0.5, [0xff1d0a, 0xff4a13, 0xfff2d2]);
        this._innerMat = this._sphereMat(0.75, 0.9, [0xff3a14, 0xff8a22, 0xffffff]);
        this._coreMat = this._sphereMat(0.9, 1.5, [0xffd2b8, 0xffffff, 0xffffff]);
        this._outer = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), this._outerMat);
        this._inner = new THREE.Mesh(new THREE.SphereGeometry(0.72, 24, 18), this._innerMat);
        this._core = new THREE.Mesh(new THREE.SphereGeometry(0.4, 18, 14), this._coreMat);
        this.group.add(this._outer, this._inner, this._core);

        // Parlama sprite'ları
        this._glowA = new THREE.Sprite(new THREE.SpriteMaterial({
            map: this._sprite, color: 0xff7a1f, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        this._glowB = new THREE.Sprite(new THREE.SpriteMaterial({
            map: this._sprite, color: 0xffd2a2, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        this.group.add(this._glowA, this._glowB);

        // Şarj halkaları (4 ince torus, farklı eksenlerde döner)
        this._rings = [];
        const ringColors = [0xff7a2f, 0xff2a18, 0xffa43a, 0xff5b16];
        for (let i = 0; i < 4; i++) {
            const ring = new THREE.Mesh(
                new THREE.TorusGeometry(1, 0.03, 8, 48),
                new THREE.MeshBasicMaterial({
                    color: ringColors[i], transparent: true, opacity: 0,
                    blending: THREE.AdditiveBlending, depthWrite: false,
                })
            );
            ring.rotation.set(i * 0.7, i * 0.95, i * 1.3);
            this.group.add(ring);
            this._rings.push(ring);
        }

        // Yakınsayan enerji parçacıkları (şarjda içeri çekilir)
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(N_PARTICLES * 3);
        const col = new Float32Array(N_PARTICLES * 3);
        this._pData = [];
        for (let i = 0; i < N_PARTICLES; i++) {
            const a = Math.random() * Math.PI * 2;
            const r = 0.12 + Math.random() * 0.22;   // büyük topa (×2) uygun geniş bulut
            this._pData.push({
                a, r,
                y: (Math.random() - 0.5) * 0.14,
                sp: 1.5 + Math.random() * 3,
            });
            const warm = Math.random();
            col[i * 3] = 1; col[i * 3 + 1] = 0.25 + warm * 0.45; col[i * 3 + 2] = 0.08 + warm * 0.12;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        this._pGeo = geo;
        this._pPts = new THREE.Points(geo, new THREE.PointsMaterial({
            size: 0.02, map: this._sprite, vertexColors: true, transparent: true,
            blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
        }));
        this.group.add(this._pPts);
    }

    _beamMat(alpha, colors) {
        return new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 }, uAlpha: { value: alpha }, uPower: { value: 0 },
                uColorA: { value: new THREE.Color(colors[0]) },
                uColorB: { value: new THREE.Color(colors[1]) },
                uColorC: { value: new THREE.Color(colors[2]) },
            },
            vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG,
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        });
    }

    _cylinder(material) {
        // Birim silindir; local Y → +X'e yatırılır. scale = (r, uzunluk, r).
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 24, 1, true), material);
        mesh.rotation.z = -Math.PI / 2;
        mesh.frustumCulled = false;
        this.beamGroup.add(mesh);
        return mesh;
    }

    _buildBeam() {
        this._coreBeamMat = new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
        });
        this._innerBeamMat = this._beamMat(0.85, [0xff3c16, 0xff781d, 0xffffff]);
        this._outerBeamMat = this._beamMat(0.4, [0xd81e10, 0xff5d1c, 0xffd9a8]);
        this._coreBeam = this._cylinder(this._coreBeamMat);
        this._innerBeam = this._cylinder(this._innerBeamMat);
        this._outerBeam = this._cylinder(this._outerBeamMat);

        // Lazer boyunca gezen halkalar
        this._travelRings = [];
        for (let i = 0; i < N_TRAVEL_RINGS; i++) {
            const ring = new THREE.Mesh(
                new THREE.TorusGeometry(1, 0.035, 8, 40),
                new THREE.MeshBasicMaterial({
                    color: 0xff7a2f, transparent: true, opacity: 0,
                    blending: THREE.AdditiveBlending, depthWrite: false,
                })
            );
            ring.rotation.y = Math.PI / 2;
            ring.userData.seed = (i + 0.5) / N_TRAVEL_RINGS;
            this.beamGroup.add(ring);
            this._travelRings.push(ring);
        }

        // Uç parlaması (lazerin değdiği yerde)
        this._tipGlow = new THREE.Sprite(new THREE.SpriteMaterial({
            map: this._sprite, color: 0xffd2a8, transparent: true, opacity: 0,
            blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        this.beamGroup.add(this._tipGlow);
    }

    /** Sekansı baştan başlat (nesneler yeniden kullanılır). */
    play() {
        this.active = true;
        this.t = 0;
        this.firing = false;
        this.justFired = false;
        this.done = false;
        this.group.visible = true;
    }

    stop() {
        this.active = false;
        this.done = true;
        this.firing = false;
        this.group.visible = false;
        if (this.light) this.light.intensity = 0;
    }

    /**
     * Her kare: konum (topun merkezi) + yaw (aim yönü). FIRE sırasında yaw
     * değişirse lazer süpürülür. Fazlar içeride ilerler.
     */
    update(dt, x, y, z, yaw) {
        if (!this.active) return;
        this.t += dt;
        const t = this.t;
        const T_FIRE_END = BEAM.CHARGE + BEAM.FIRE;
        const T_END = T_FIRE_END + BEAM.FADE;

        this.group.position.set(x, y, z);
        this.beamGroup.rotation.y = -yaw;   // +X → (cos yaw, 0, sin yaw)
        this.dirX = Math.cos(yaw); this.dirZ = Math.sin(yaw);

        // --- Fazlar ---
        const charge = smooth(0, BEAM.CHARGE * 0.9, t);
        const fireIn = smooth(BEAM.CHARGE, BEAM.CHARGE + 0.12, t);
        const fadeOut = 1 - smooth(T_FIRE_END, T_END, t);
        const beamPower = fireIn * fadeOut;
        const wasFiring = this.firing;
        this.firing = t >= BEAM.CHARGE && t < T_FIRE_END;
        this.justFired = this.firing && !wasFiring;
        if (t >= T_END) { this.stop(); return; }

        // --- Top: şarjda büyür + titrer, ateşte hafif küçülüp beslenir, sonda söner ---
        const tremble = 1 + charge * (Math.sin(t * 34) * 0.05 + Math.sin(t * 61) * 0.02);
        let r = lerp(0.12, 1, charge) * BEAM.BALL_R * tremble;
        if (this.firing) r *= 0.8 + Math.sin(t * 26) * 0.05;
        r *= fadeOut;
        const intensity = charge * 0.8 + beamPower * 0.9;

        this._outer.scale.setScalar(Math.max(0.001, r));
        this._inner.scale.setScalar(Math.max(0.001, r));
        this._core.scale.setScalar(Math.max(0.001, r));
        this._outer.rotation.y = t * 0.8; this._outer.rotation.z = -t * 0.5;
        this._inner.rotation.x = -t * 1.1; this._inner.rotation.y = t * 0.9;
        this._core.rotation.y = t * 2.2;
        for (const m of [this._outerMat, this._innerMat, this._coreMat]) {
            m.uniforms.uTime.value = t;
            m.uniforms.uIntensity.value = intensity;
        }
        this._outerMat.uniforms.uAlpha.value = 0.5 * fadeOut;
        this._innerMat.uniforms.uAlpha.value = 0.7 * fadeOut;
        this._coreMat.uniforms.uAlpha.value = 0.9 * fadeOut;

        this._glowA.scale.setScalar(r * 5);
        this._glowB.scale.setScalar(r * 8);
        this._glowA.material.opacity = (0.25 + intensity * 0.35) * fadeOut * (charge > 0.02 ? 1 : 0);
        this._glowB.material.opacity = (0.1 + intensity * 0.2) * fadeOut * (charge > 0.02 ? 1 : 0);

        for (let i = 0; i < this._rings.length; i++) {
            const ring = this._rings[i];
            const spin = t * (0.8 + i * 0.3 + intensity);
            ring.rotation.x = i * 0.7 + spin;
            ring.rotation.y = i * 0.95 - spin * 0.7;
            ring.scale.setScalar(Math.max(0.001, r * (1.25 + i * 0.18)));
            ring.material.opacity = charge * 0.55 * fadeOut * (i % 2 ? 0.7 : 1);
        }

        // Yakınsayan parçacıklar (şarjda görünür, ateşle sönümlenir)
        const attract = charge;
        const pOp = charge * (1 - fireIn * 0.7) * fadeOut;
        this._pPts.material.opacity = pOp * 0.9;
        if (pOp > 0.01) {
            const arr = this._pGeo.attributes.position.array;
            for (let i = 0; i < N_PARTICLES; i++) {
                const p = this._pData[i];
                p.a += p.sp * dt * (1 + attract);
                const rr = lerp(p.r, Math.max(r * 1.6, 0.01), attract);   // dıştan topun hemen dışına çekil
                arr[i * 3] = Math.cos(p.a) * rr;
                arr[i * 3 + 1] = p.y * (1 - attract * 0.7) + Math.sin(p.a * 1.3) * rr * 0.4;
                arr[i * 3 + 2] = Math.sin(p.a) * rr;
            }
            this._pGeo.attributes.position.needsUpdate = true;
        }

        // --- Lazer ---
        const len = BEAM.RANGE * smooth(BEAM.CHARGE, BEAM.CHARGE + 0.16, t) * (0.2 + 0.8 * fadeOut);
        const show = beamPower > 0.01;
        this._coreBeam.visible = this._innerBeam.visible = this._outerBeam.visible = show;
        if (show) {
            const pulse = 1 + Math.sin(t * 24) * 0.06;
            const rr = BEAM.BEAM_R * pulse;
            this._coreBeam.scale.set(rr * 0.8, len, rr * 0.8);
            this._innerBeam.scale.set(rr * 2.2, len, rr * 2.2);
            this._outerBeam.scale.set(rr * 3.6, len, rr * 3.6);
            this._coreBeam.position.x = this._innerBeam.position.x = this._outerBeam.position.x = len / 2;
            this._coreBeamMat.opacity = beamPower * 0.85;
            for (const m of [this._innerBeamMat, this._outerBeamMat]) {
                m.uniforms.uTime.value = t;
                m.uniforms.uPower.value = beamPower;
            }
            this._innerBeamMat.uniforms.uAlpha.value = beamPower * 0.9;
            this._outerBeamMat.uniforms.uAlpha.value = beamPower * 0.4;

            this._tipGlow.position.set(len, 0, 0);
            this._tipGlow.scale.setScalar(0.22 + beamPower * 0.18 + Math.sin(t * 30) * 0.03);
            this._tipGlow.material.opacity = beamPower * 0.9;
        } else {
            this._tipGlow.material.opacity = 0;
        }
        for (const ring of this._travelRings) {
            ring.visible = show;
            if (!show) continue;
            const travel = (ring.userData.seed + (t - BEAM.CHARGE) * 0.9) % 1;
            ring.position.x = travel * len;
            ring.scale.setScalar(BEAM.BEAM_R * (2.5 + ring.userData.seed * 2));
            ring.material.opacity = Math.sin(travel * Math.PI) * beamPower * 0.5;
        }

        // Işık: şarjda kızarır, ateşte patlar
        this.light.intensity = charge * 1.6 + beamPower * 3.2;
        this.light.color.setHex(this.firing ? 0xff5c1e : 0xff4a24);
    }
}
