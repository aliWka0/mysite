// ============================================
// BallPhysics — Physics Bodies for Pool Balls
// ============================================
import * as CANNON from 'cannon-es';
import { BALL, BALL_DATA, BALL_TYPES, TABLE, getRackPositions, CUE_BALL_START } from '../constants.js';

export class BallPhysics {
    constructor(physicsWorld) {
        this.physicsWorld = physicsWorld;
        this.bodies = new Map();        // id → CANNON.Body
        this.ballShape = new CANNON.Sphere(BALL.RADIUS);

        // Faz 13: mini-olay sürtünme çarpanı (buz=düşük, ağır=yüksek). Tüm topların
        // linearDamping'i = BALL.LINEAR_DAMPING × bu değer. 1 = normal. Yeni doğan
        // toplar da (_createBody) bu çarpanı alır → cue reset / yeniden dizme korur.
        this._dampingMul = 1;

        // Shot tracking
        this._tracking = false;
        this._firstContact = null;
        this._contacts = [];
        this._cushionHits = 0;

        // Optional sound callback: (type, volume) => void
        // type is 'clack' (ball-ball) or 'rail' (cushion). volume is 0..1.
        this.onSound = null;
    }

    /** Create all ball bodies in starting positions */
    createAllBalls() {
        // Cue ball
        this._createBody(0, CUE_BALL_START);

        // Racked balls
        const rackPositions = getRackPositions();
        rackPositions.forEach(rp => {
            this._createBody(rp.ballId, { x: rp.x, y: rp.y, z: rp.z });
        });
    }

    _createBody(id, position) {
        const body = new CANNON.Body({
            mass: BALL.MASS,
            material: this.physicsWorld.ballMaterial,
            shape: this.ballShape,
            position: new CANNON.Vec3(position.x, position.y, position.z),
            linearDamping: BALL.LINEAR_DAMPING * this._dampingMul,   // Faz 13: olay çarpanı
            angularDamping: BALL.ANGULAR_DAMPING,
            // Toplar yalnız grup-1 (masa/bant/diğer toplar) ile çarpışır; karakter
            // (grup 2 yürüme) ve RAGDOLL (grup 4) ile ÇARPIŞMAZ → devrilen karakter
            // topları bozamaz (bilardo fiziği saf kalır; yetenekler ayrı sistem).
            collisionFilterGroup: 1,
            collisionFilterMask: 1,
        });
        body.userData = { ballId: id };

        // Collision event tracking
        body.addEventListener('collide', (e) => this._onCollide(id, e));

        this.physicsWorld.addBody(body);
        this.bodies.set(id, body);
    }

    _onCollide(ballId, event) {
        const otherBody = event.body;

        // ---- Sound (runs regardless of shot tracking) ----
        if (this.onSound) {
            let impact = 0;
            if (event.contact && typeof event.contact.getImpactVelocityAlongNormal === 'function') {
                impact = Math.abs(event.contact.getImpactVelocityAlongNormal());
            }
            if (impact > 0.05) {
                const vol = Math.min(1, impact / 3);
                if (otherBody.userData && otherBody.userData.ballId !== undefined) {
                    // Ball-ball: each pair fires twice (one listener per body); dedup by id order
                    if (ballId < otherBody.userData.ballId) this.onSound('clack', vol);
                } else if (otherBody.material === this.physicsWorld.cushionMaterial) {
                    this.onSound('rail', vol);
                }
            }
        }

        if (!this._tracking) return;

        // Check if the other body is a ball
        if (otherBody.userData && otherBody.userData.ballId !== undefined) {
            const otherId = otherBody.userData.ballId;

            // Only track cue ball hitting other balls
            if (ballId === 0 && this._firstContact === null) {
                this._firstContact = {
                    id: otherId,
                    type: BALL_DATA.find(b => b.id === otherId)?.type || 'unknown',
                };
            }
            this._contacts.push({ a: ballId, b: otherId });
        } else {
            // Hit cushion or table
            if (otherBody.material === this.physicsWorld.cushionMaterial) {
                this._cushionHits++;
            }
        }
    }

    /** Remove a ball body (pocketed) */
    removeBall(id) {
        const body = this.bodies.get(id);
        if (body) {
            this.physicsWorld.removeBody(body);
            this.bodies.delete(id);
        }
    }

    /** Get a ball body by ID */
    getBallBody(id) {
        return this.bodies.get(id);
    }

    /** Apply impulse to a ball */
    applyImpulse(id, impulse, localPoint = new CANNON.Vec3(0, 0, 0)) {
        const body = this.bodies.get(id);
        if (body) {
            body.applyImpulse(
                new CANNON.Vec3(impulse.x, impulse.y, impulse.z),
                localPoint
            );
        }
    }

    /** Check if all balls have stopped moving (XZ plane only) */
    areAllStopped() {
        const thresholdSq = BALL.STOP_THRESHOLD * BALL.STOP_THRESHOLD;
        let allStopped = true;

        for (const [id, body] of this.bodies) {
            const v = body.velocity;
            // Only check XZ velocity (Y is always clamped to 0)
            const speedSq = v.x * v.x + v.z * v.z;
            
            if (speedSq > thresholdSq) {
                allStopped = false;
            } else {
                // Force velocity to zero to completely kill creeping
                body.velocity.set(0, 0, 0);
                body.angularVelocity.set(0, 0, 0);
            }
        }
        return allStopped;
    }

    /** En hızlı topun XZ hızı (m/s) — top yuvarlanma sesi seviyesi için (Faz 9). */
    getMaxSpeed() {
        let maxSq = 0;
        for (const [, body] of this.bodies) {
            const v = body.velocity;
            const s = v.x * v.x + v.z * v.z;
            if (s > maxSq) maxSq = s;
        }
        return Math.sqrt(maxSq);
    }

    /** Force-stop all balls (zero out velocities) */
    forceStopAll() {
        for (const [id, body] of this.bodies) {
            body.velocity.setZero();
            body.angularVelocity.setZero();
        }
    }

    /**
     * Get all ball positions as Map<id, {x,y,z}>.
     * GC diyeti: Map + girdi objeleri yeniden kullanılır (kare başına ~4 çağrı ×17 obje
     * çöpe gidiyordu — mobil WebView'de GC duraklaması). Sonuç bir SONRAKI çağrıya kadar
     * geçerli; tüketiciler (sync/pocket/bot/net) anlık kullanıyor, saklamıyor.
     */
    getPositions() {
        if (!this._posMap) { this._posMap = new Map(); this._posPool = new Map(); }
        this._posMap.clear();
        this.bodies.forEach((body, id) => {
            let e = this._posPool.get(id);
            if (!e) { e = { x: 0, y: 0, z: 0 }; this._posPool.set(id, e); }
            const p = body.position;
            e.x = p.x; e.y = p.y; e.z = p.z;
            this._posMap.set(id, e);
        });
        return this._posMap;
    }

    /** Get all ball quaternions as Map<id, {x,y,z,w}> (getPositions ile aynı yeniden-kullanım). */
    getQuaternions() {
        if (!this._quatMap) { this._quatMap = new Map(); this._quatPool = new Map(); }
        this._quatMap.clear();
        this.bodies.forEach((body, id) => {
            let e = this._quatPool.get(id);
            if (!e) { e = { x: 0, y: 0, z: 0, w: 1 }; this._quatPool.set(id, e); }
            const q = body.quaternion;
            e.x = q.x; e.y = q.y; e.z = q.z; e.w = q.w;
            this._quatMap.set(id, e);
        });
        return this._quatMap;
    }

    /** Get all active ball IDs */
    getAllActiveBallIds() {
        return Array.from(this.bodies.keys());
    }

    /** Reset cue ball to a position */
    resetCueBall(position) {
        this.removeBall(0);
        this._createBody(0, position || CUE_BALL_START);
    }

    /**
     * Faz 13 mini-olay: tüm topların yatay sürtünmesini ölçekle (buz=<1 kayar,
     * ağır=>1 çabuk durur). Çarpanı saklar → sonradan doğan toplar da alır. 1=normal.
     */
    setDampingMul(mul) {
        this._dampingMul = mul > 0 ? mul : 1;
        const d = BALL.LINEAR_DAMPING * this._dampingMul;
        for (const [, body] of this.bodies) body.linearDamping = d;
    }

    /** Get cue ball position */
    getCueBallPosition() {
        const body = this.bodies.get(0);
        if (!body) return null;
        return { x: body.position.x, y: body.position.y, z: body.position.z };
    }

    // ---- Shot Tracking ----

    /** Start tracking collisions for a new shot */
    beginShotTracking() {
        this._tracking = true;
        this._firstContact = null;
        this._contacts = [];
        this._cushionHits = 0;
    }

    /** End tracking and return shot data */
    endShotTracking() {
        this._tracking = false;
        return {
            firstContact: this._firstContact,
            contacts: [...this._contacts],
            cushionHits: this._cushionHits,
        };
    }

    /** 
     * Clamp all balls to table surface plane.
     * With gravity OFF, balls must be locked to the playing surface.
     * This prevents any Y-axis drift from collision resolution.
     */
    clampToSurface() {
        const targetY = TABLE.HEIGHT + BALL.RADIUS;
        const limitX = (TABLE.LENGTH / 2) + 0.1;
        const limitZ = (TABLE.WIDTH / 2) + 0.1;

        this.bodies.forEach((body, id) => {
            // Lock Y position to table surface
            body.position.y = targetY;
            body.velocity.y = 0;
            
            // Simulate rolling without slipping (w = v / r)
            body.angularVelocity.x = body.velocity.z / BALL.RADIUS;
            body.angularVelocity.z = -body.velocity.x / BALL.RADIUS;
            // Preserve Y spin (English/sidespin) but dampen it over time
            body.angularVelocity.y *= 0.99;
            
            // Safety boundary clamp for X/Z (prevents balls flying out of world bounds entirely)
            if (Math.abs(body.position.x) > limitX) {
                body.position.x = Math.sign(body.position.x) * limitX;
                body.velocity.x *= -0.5; // Bounce back
            }
            if (Math.abs(body.position.z) > limitZ) {
                body.position.z = Math.sign(body.position.z) * limitZ;
                body.velocity.z *= -0.5; // Bounce back
            }
        });
    }
}
