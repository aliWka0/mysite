// ============================================
// CameraController — Orbit + Aim Camera System
// ============================================
import * as THREE from 'three';
import { TABLE, CAMERA } from '../constants.js';

export class CameraController {
    constructor(camera, domElement) {
        this.camera = camera;
        this.domElement = domElement;

        // Orbit state
        this.target = new THREE.Vector3(0, TABLE.HEIGHT, 0);
        this.azimuth = 0;                       // horizontal angle (radians)
        this.polar = CAMERA.DEFAULT_POLAR;       // vertical angle from Y axis
        this.distance = CAMERA.DEFAULT_DISTANCE;

        // Smooth values
        this._targetAzimuth = this.azimuth;
        this._targetPolar = this.polar;
        this._targetDistance = this.distance;
        this._targetPos = this.target.clone();

        // Mode: 'free' | 'aim' | 'follow'
        this.mode = 'free';
        this._followTarget = null;

        // Input accumulators (set externally by InputManager)
        this.rotateX = 0;
        this.rotateY = 0;
        this.zoomDelta = 0;

        // Player-tunable look settings (driven by Settings / Options menu)
        this.sensitivity = 1;
        this.invertY = false;

        // Menu backdrop drift + cinematic transition timers
        this._menuT = 0;
        this._slowT = 0;

        // Screen shake (juice): decaying positional jitter on impactful events.
        this._shakeAmt = 0;     // current peak amplitude (world units)
        this._shakeT = 0;       // remaining time
        this._shakeDur = 0.001; // this shake's total duration

        // Zoom "punch" (Faz 7 ultimate sinematiği): kısa süre içeri dalış, sonra ease-out.
        this._punchAmt = 0;     // peak distance reduction (world units)
        this._punchT = 0;       // remaining time
        this._punchDur = 0.001; // this punch's total duration

        // Kamera juice (Faz 8): koşu bob'u + topa yaklaşma zoom'u (his / "tok hareket").
        this._bob = 0;          // smoothed bob intensity 0..1
        this._bobTarget = 0;    // istenen bob şiddeti (dışarıdan, hıza göre)
        this._bobPhase = 0;     // bob salınım fazı (gerçek zamanla ilerler)
        this._lastNow = 0;      // bob fazı için gerçek-zaman damgası (çift update'e dayanıklı)
        this._approach = 0;     // smoothed yaklaşma 0..1
        this._approachTarget = 0;
        this._tensionZoom = 0;  // smoothed final-evresi gerilim zoom'u 0..1
        this._tensionTarget = 0;
        this._charge = 0;       // smoothed güç şarjı 0..1 (POWER'da kamera nefesi)
        this._chargeTarget = 0;
        // Yan çerçeve kayması (Enerji Dalgası kanalı): kamera + bakış noktası ekran
        // SAĞINA kayar → karakter solda kalır, yetenek sahneyi doldurur (anime çerçevesi).
        this._side = 0;         // smoothed yan kayma (world units)
        this._sideTarget = 0;
        // TPS çerçevesi (2026-07-10): mesafeyle ORANTILI yan kayma (CAMERA.TPS_SIDE) —
        // zoom değişse de karakter aynı ekran konumunda kalır. _side (world, beam) ile TOPLANIR.
        this._sideFrac = 0;     // smoothed oran (efektif mesafenin katı)
        this._sideFracTarget = 0;
        this._lookTmp = new THREE.Vector3();   // lookAt için geçici (GC diyeti)
    }

    /** Faz 10: "Final Evresi" sürekli gerilim zoom'u (0=kapalı .. 1=yakın). */
    setTension(v) {
        this._tensionTarget = Math.max(0, Math.min(1, v || 0));
    }

    /** Faz 8: takip edilen karakterin hareket şiddeti (0..1) → koşu bob'u (yumuşatılır). */
    setMoveIntensity(v) {
        this._bobTarget = Math.max(0, Math.min(1, v || 0));
    }

    /** Faz 8: cue topa yaklaşma (0=uzak .. 1=bitişik) → hafif zoom-in (yumuşatılır). */
    setApproach(v) {
        this._approachTarget = Math.max(0, Math.min(1, v || 0));
    }

    /**
     * Yan çerçeve kayması (world units, 0 = kapalı): kamera + bakış noktası ekran
     * sağına süzülür → karakter solda kalır. Enerji Dalgası kanalı sürer (BEAM.CAM_SIDE).
     */
    setSideOffset(v) {
        this._sideTarget = v || 0;
    }

    /**
     * TPS çerçevesi: efektif kamera mesafesinin ORANI kadar yan kayma (0=kapalı).
     * Oyun boyunca karakter ekranın SOLUNDA, crosshair ortada kalır (omuz-üstü çerçeve).
     */
    setSideFrac(v) {
        this._sideFracTarget = v || 0;
    }

    /**
     * Güç şarjı (0=yok .. 1=tam güç) → kamera içeri dalar. PowerBar salındığı
     * için kamera güçle birlikte "nefes alır" (yakınlaş/uzaklaş) — atış gerilimi.
     */
    setCharge(v) {
        this._chargeTarget = Math.max(0, Math.min(1, v || 0));
    }

    /**
     * Kısa sinematik "zoom punch": kamera anında bir miktar içeri dalar, sonra yumuşakça
     * geri açılır (ultimate gibi büyük anlarda). Kullanıcının zoom'unu kalıcı bozmaz.
     * @param {number} amount - tepe mesafe azaltımı (world units, ~0.15–0.3)
     * @param {number} duration - saniye
     */
    punch(amount = 0.2, duration = 0.5) {
        if (amount > this._punchAmt) this._punchAmt = amount;
        if (duration > this._punchT) { this._punchT = duration; this._punchDur = duration; }
    }

    /**
     * Trigger a brief camera shake. Stronger shakes win when overlapping.
     * @param {number} amount - peak amplitude in world units (~0.01–0.03)
     * @param {number} duration - seconds
     */
    shake(amount = 0.015, duration = 0.32) {
        if (amount > this._shakeAmt) { this._shakeAmt = amount; }
        if (duration > this._shakeT) { this._shakeT = duration; this._shakeDur = duration; }
    }

    /**
     * Set the camera mode.
     * @param {'free'|'far'|'menu'} mode
     * - 'free': Default close TPS (gameplay — character follow + bob)
     * - 'far':  Overview for ball-in-hand placement
     * - 'menu': Close-up hero shot with idle drift
     */
    setMode(mode) {
        this.mode = mode;

        if (mode === 'free') {
            this._targetDistance = CAMERA.DEFAULT_DISTANCE;
            this._targetPolar = CAMERA.DEFAULT_POLAR;
        } else if (mode === 'far') {
            // Ball-in-hand overview — set externally via _targetDistance/_targetPolar
        } else if (mode === 'menu') {
            this._targetDistance = 0.22; // Close-up "hero" shot of the character
            this._targetPolar = 1.34;    // Near eye-level
            this._menuT = 0;
        }
    }

    /** Briefly slow the camera smoothing for a cinematic move (e.g. menu → game). */
    slowTransition(seconds = 1.4) {
        this._slowT = seconds;
    }

    /** Set the orbit target position (e.g., cue ball position) */
    setTarget(position) {
        this._targetPos.set(position.x, position.y, position.z);
    }

    /** Set the follow target for 'follow' mode (e.g., cue ball mesh) */
    setFollowTarget(mesh) {
        this._followTarget = mesh;
    }

    /** Get the current horizontal aim angle */
    getAimAngle() {
        return this.azimuth;
    }

    /** Set aim angle directly */
    setAimAngle(angle) {
        this.azimuth = angle;
        this._targetAzimuth = angle;
    }

    /** Apply rotation input */
    handleRotation(dx, dy) {
        const speed = CAMERA.ROTATE_SPEED * this.sensitivity;
        this._targetAzimuth += dx * speed;
        this._targetPolar -= (this.invertY ? -dy : dy) * speed;
        this._targetPolar = Math.max(CAMERA.MIN_POLAR, Math.min(CAMERA.MAX_POLAR, this._targetPolar));
    }

    /** Apply zoom input */
    handleZoom(delta) {
        this._targetDistance += delta * 0.001;
        this._targetDistance = Math.max(CAMERA.MIN_DISTANCE, Math.min(CAMERA.MAX_DISTANCE, this._targetDistance));
    }

    /** Update camera position each frame */
    update(dt) {
        // A brief slow window gives the menu → game camera move a cinematic glide.
        let smoothSpeed = CAMERA.SMOOTH_SPEED;
        if (this._slowT > 0) {
            this._slowT -= dt;
            smoothSpeed *= 0.35;
        }
        const smooth = 1 - Math.exp(-smoothSpeed * dt);

        // Menu backdrop: a close idle "hero" shot that drifts gently for a live feel.
        if (this.mode === 'menu') {
            this._menuT += dt;
            this._targetAzimuth = Math.sin(this._menuT * 0.32) * 0.40;       // gentle front-facing sway
            this._targetPolar = 1.34 + Math.sin(this._menuT * 0.21) * 0.05;  // subtle vertical life
        }

        // Follow mode: track the follow target in gameplay ('free') mode
        if (this.mode === 'free' && this._followTarget) {
            const fpos = this._followTarget.position;
            this._targetPos.set(fpos.x, fpos.y, fpos.z);
        }

        // Smoothly interpolate orbit parameters
        this.azimuth += (this._targetAzimuth - this.azimuth) * smooth;
        this.polar += (this._targetPolar - this.polar) * smooth;
        this.distance += (this._targetDistance - this.distance) * smooth;
        this.target.lerp(this._targetPos, smooth);

        // Juice yumuşatması (Faz 8): bob şiddeti + yaklaşma hedeflerine süzül. Çift
        // update'te (WALKING/POWER) iki kez süzülmesi yalnız hızlandırır — zararsız.
        const js = 1 - Math.exp(-8 * dt);
        this._bob += (this._bobTarget - this._bob) * js;
        this._approach += (this._approachTarget - this._approach) * js;
        this._tensionZoom += (this._tensionTarget - this._tensionZoom) * js;
        this._charge += (this._chargeTarget - this._charge) * js;
        this._side += (this._sideTarget - this._side) * js;
        this._sideFrac += (this._sideFracTarget - this._sideFrac) * js;

        // Zoom punch (ultimate sinematiği) + yaklaşma + gerilim + güç şarjı: mesafeyi içeri çek.
        let dist = this.distance - this._approach * CAMERA.APPROACH_ZOOM
                                 - this._tensionZoom * CAMERA.TENSION_ZOOM
                                 - this._charge * CAMERA.CHARGE_ZOOM;
        if (this._punchT > 0) {
            this._punchT -= dt;
            const k = Math.max(0, this._punchT / this._punchDur); // 1 → 0
            dist -= this._punchAmt * k;
            if (this._punchT <= 0) this._punchAmt = 0;
        }
        dist = Math.max(CAMERA.MIN_DISTANCE * 0.5, dist);

        // Compute camera position from spherical coordinates
        const x = this.target.x + dist * Math.sin(this.polar) * Math.cos(this.azimuth);
        const y = this.target.y + dist * Math.cos(this.polar);
        const z = this.target.z + dist * Math.sin(this.polar) * Math.sin(this.azimuth);

        // Koşu bob'u (Faz 8): yalnız hareket modlarında, takip edilen karaktere göre.
        // Faz GERÇEK zamanla ilerler → WALKING'deki çift update'te 2× hızlanmaz.
        let bx = 0, by = 0, bz = 0;
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        if (this.mode === 'free' && this._bob > 0.001) {
            const realDt = this._lastNow ? Math.min(0.05, (now - this._lastNow) / 1000) : 0;
            this._bobPhase += realDt * CAMERA.BOB_FREQ * (0.6 + 0.4 * this._bob);
            by = Math.sin(this._bobPhase * 2) * CAMERA.BOB_VERT * this._bob; // adım = 2× frekans
            const sway = Math.sin(this._bobPhase) * CAMERA.BOB_LAT * this._bob;
            bx = -Math.sin(this.azimuth) * sway;   // bakışa dik yanal salınım
            bz = Math.cos(this.azimuth) * sway;
        }
        this._lastNow = now;

        // Screen shake: jitter the eye position (look-at stays on target → slight
        // rotational + translational shake), amplitude decays to zero.
        let sx = 0, sy = 0, sz = 0;
        if (this._shakeT > 0) {
            this._shakeT -= dt;
            const k = Math.max(0, this._shakeT / this._shakeDur); // 1 → 0
            const a = this._shakeAmt * k;
            sx = (Math.random() * 2 - 1) * a;
            sy = (Math.random() * 2 - 1) * a;
            sz = (Math.random() * 2 - 1) * a;
            if (this._shakeT <= 0) this._shakeAmt = 0;
        }

        // Yan çerçeve kayması: bakış yönüne DİK (ekran sağı) — kamera VE bakış noktası
        // birlikte kayar → görüş yönü korunur, karakter ekranın soluna süzülür.
        // TPS payı mesafeyle orantılı (zoom'da sabit ekran konumu); beam payı sabittir.
        let ox = 0, oz = 0;
        const sideAmt = this._side + this._sideFrac * dist;
        if (Math.abs(sideAmt) > 0.0005) {
            ox = Math.sin(this.azimuth) * sideAmt;
            oz = -Math.cos(this.azimuth) * sideAmt;
        }

        this.camera.position.set(x + sx + bx + ox, y + sy + by, z + sz + bz + oz);
        this.camera.lookAt(this._lookTmp.set(this.target.x + ox, this.target.y, this.target.z + oz));
    }

    /** Reset to default view */
    resetView() {
        this._targetAzimuth = 0;
        this._targetPolar = CAMERA.DEFAULT_POLAR;
        this._targetDistance = CAMERA.DEFAULT_DISTANCE;
        this._targetPos.set(0, TABLE.HEIGHT, 0);
    }
}
