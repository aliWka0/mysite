// ============================================
// AimController — Aim Line + Collision Preview
// ============================================
import * as THREE from 'three';
import { BALL, TABLE } from '../constants.js';

export class AimController {
    constructor(scene) {
        this.scene = scene;
        this._visible = false;

        // Aim line — from cue ball toward the shot direction
        const lineGeom = new THREE.BufferGeometry();
        const linePositions = new Float32Array(6); // 2 points × 3 coords
        lineGeom.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
        const lineMat = new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.35,
        });
        this.aimLine = new THREE.Line(lineGeom, lineMat);
        this.aimLine.visible = false;
        this.scene.add(this.aimLine);

        // Dashed extension line (shows full trajectory)
        const dashGeom = new THREE.BufferGeometry();
        const dashPositions = new Float32Array(6);
        dashGeom.setAttribute('position', new THREE.BufferAttribute(dashPositions, 3));
        const dashMat = new THREE.LineDashedMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.15,
            dashSize: 0.02,
            gapSize: 0.02,
        });
        this.dashLine = new THREE.Line(dashGeom, dashMat);
        this.dashLine.visible = false;
        this.scene.add(this.dashLine);

        // Ghost ball (shows where cue ball will hit)
        const ghostGeom = new THREE.SphereGeometry(BALL.RADIUS, 16, 12);
        const ghostMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.2,
            wireframe: true,
        });
        this.ghostBall = new THREE.Mesh(ghostGeom, ghostMat);
        this.ghostBall.visible = false;
        this.scene.add(this.ghostBall);

        // Target indicator (small dot on the target ball)
        const targetGeom = new THREE.SphereGeometry(0.006, 8, 8);
        const targetMat = new THREE.MeshBasicMaterial({
            color: 0xff4444,
            transparent: true,
            opacity: 0.7,
        });
        this.targetDot = new THREE.Mesh(targetGeom, targetMat);
        this.targetDot.visible = false;
        this.scene.add(this.targetDot);

        // 3D aim reticle — flat ring lying on the cloth at the END of the aim
        // line (ball contact or cushion point). This is the real "where am I
        // shooting" marker; it replaces the screen-center crosshair on touch.
        // depthTest off → never hidden behind balls/cushions (it's UI).
        this._charge = 0;
        const retGeom = new THREE.RingGeometry(0.024, 0.034, 32);
        const retMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.85,
            side: THREE.DoubleSide,
            depthTest: false,
            depthWrite: false,
        });
        this.reticle = new THREE.Mesh(retGeom, retMat);
        this.reticle.rotation.x = -Math.PI / 2;
        this.reticle.renderOrder = 6;
        this.reticle.visible = false;
        this.scene.add(this.reticle);

        const retDotGeom = new THREE.CircleGeometry(0.006, 16);
        const retDotMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.9,
            side: THREE.DoubleSide,
            depthTest: false,
            depthWrite: false,
        });
        this.reticleDot = new THREE.Mesh(retDotGeom, retDotMat);
        this.reticleDot.rotation.x = -Math.PI / 2;
        this.reticleDot.renderOrder = 6;
        this.reticleDot.visible = false;
        this.scene.add(this.reticleDot);
    }

    show() {
        this._visible = true;
        this.aimLine.visible = true;
        this.dashLine.visible = true;
        this.reticle.visible = true;
        this.reticleDot.visible = true;
    }

    hide() {
        this._visible = false;
        this.aimLine.visible = false;
        this.dashLine.visible = false;
        this.ghostBall.visible = false;
        this.targetDot.visible = false;
        this.reticle.visible = false;
        this.reticleDot.visible = false;
    }

    /**
     * Charge feedback (0 = not charging .. 1 = full power): the reticle and the
     * aim line blend white → red and the reticle pulses with the power.
     */
    setCharge(frac) {
        this._charge = Math.max(0, Math.min(1, frac || 0));
    }

    /**
     * Update the aim line based on cue ball position and aim angle.
     * Optionally shows collision preview with other balls.
     * @param {THREE.Vector3} cueBallPos - Cue ball position
     * @param {number} aimAngle - Horizontal aim angle (radians)
     * @param {Map<number, THREE.Mesh>} ballMeshes - Map of ball ID → mesh (optional)
     */
    update(cueBallPos, aimAngle, ballMeshes = null) {
        if (!this._visible) return;

        const y = cueBallPos.y;

        // Direction vector (on XZ plane, pointing TOWARD the target)
        const dirX = Math.cos(aimAngle);
        const dirZ = Math.sin(aimAngle);

        // Find the nearest ball collision along the aim direction
        let hitDistance = 3.0; // max line length
        let hitBallMesh = null;

        if (ballMeshes) {
            ballMeshes.forEach((mesh, id) => {
                if (id === 0) return; // skip cue ball

                const dx = mesh.position.x - cueBallPos.x;
                const dz = mesh.position.z - cueBallPos.z;

                // Project onto aim direction
                const dot = dx * dirX + dz * dirZ;
                if (dot <= 0) return; // ball is behind the aim direction

                // Perpendicular distance
                const perpX = dx - dot * dirX;
                const perpZ = dz - dot * dirZ;
                const perpDist = Math.sqrt(perpX * perpX + perpZ * perpZ);

                const collisionDist = BALL.RADIUS * 2;
                if (perpDist < collisionDist) {
                    // Calculate the exact hit distance (center-to-center at collision)
                    const offset = Math.sqrt(collisionDist * collisionDist - perpDist * perpDist);
                    const dist = dot - offset;
                    if (dist > 0 && dist < hitDistance) {
                        hitDistance = dist;
                        hitBallMesh = mesh;
                    }
                }
            });
        }

        // Also check cushion boundaries
        const hl = TABLE.LENGTH / 2;
        const hw = TABLE.WIDTH / 2;
        const cushionHits = [];

        if (Math.abs(dirX) > 0.0001) {
            // Right cushion (x = hl)
            const tRight = (hl - BALL.RADIUS - cueBallPos.x) / dirX;
            if (tRight > 0) cushionHits.push(tRight);
            // Left cushion (x = -hl)
            const tLeft = (-hl + BALL.RADIUS - cueBallPos.x) / dirX;
            if (tLeft > 0) cushionHits.push(tLeft);
        }
        if (Math.abs(dirZ) > 0.0001) {
            // Top cushion (z = hw)
            const tTop = (hw - BALL.RADIUS - cueBallPos.z) / dirZ;
            if (tTop > 0) cushionHits.push(tTop);
            // Bottom cushion (z = -hw)
            const tBottom = (-hw + BALL.RADIUS - cueBallPos.z) / dirZ;
            if (tBottom > 0) cushionHits.push(tBottom);
        }

        const cushionDist = cushionHits.length > 0 ? Math.min(...cushionHits) : hitDistance;
        const finalDist = Math.min(hitDistance, cushionDist);

        // Update aim line (from cue ball to hit point)
        const startX = cueBallPos.x + dirX * BALL.RADIUS * 1.5;
        const startZ = cueBallPos.z + dirZ * BALL.RADIUS * 1.5;
        const endX = cueBallPos.x + dirX * finalDist;
        const endZ = cueBallPos.z + dirZ * finalDist;

        const linePositions = this.aimLine.geometry.attributes.position.array;
        linePositions[0] = startX; linePositions[1] = y; linePositions[2] = startZ;
        linePositions[3] = endX;   linePositions[4] = y; linePositions[5] = endZ;
        this.aimLine.geometry.attributes.position.needsUpdate = true;

        // Dashed line extends beyond hit point
        const dashPositions = this.dashLine.geometry.attributes.position.array;
        dashPositions[0] = endX;  dashPositions[1] = y; dashPositions[2] = endZ;
        dashPositions[3] = cueBallPos.x + dirX * 3.0;
        dashPositions[4] = y;
        dashPositions[5] = cueBallPos.z + dirZ * 3.0;
        this.dashLine.geometry.attributes.position.needsUpdate = true;
        this.dashLine.computeLineDistances();

        // Ghost ball at hit point
        if (hitBallMesh && hitDistance < cushionDist) {
            this.ghostBall.visible = true;
            this.ghostBall.position.set(endX, y, endZ);

            // Target dot on the hit ball
            this.targetDot.visible = true;
            const contactX = endX + dirX * BALL.RADIUS;
            const contactZ = endZ + dirZ * BALL.RADIUS;
            this.targetDot.position.set(contactX, y, contactZ);
        } else {
            this.ghostBall.visible = false;
            this.targetDot.visible = false;
        }

        // Aim reticle: flat on the cloth at the line's end point. While charging
        // it blends toward red and pulses with the current power.
        const clothY = y - BALL.RADIUS + 0.004;
        this.reticle.position.set(endX, clothY, endZ);
        this.reticleDot.position.set(endX, clothY, endZ);

        const c = this._charge;
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const pulse = 1 + (c > 0 ? 0.16 * c * (0.5 + 0.5 * Math.sin(now * 0.012)) : 0);
        this.reticle.scale.setScalar(pulse);
        this.reticle.material.color.setRGB(1, 1 - 0.65 * c, 1 - 0.75 * c);
        this.reticleDot.material.color.copy(this.reticle.material.color);
        this.reticle.material.opacity = 0.7 + 0.3 * c;

        // The solid aim line inherits the charge color (stronger while charging)
        this.aimLine.material.color.copy(this.reticle.material.color);
        this.aimLine.material.opacity = 0.35 + 0.25 * c;
    }

    dispose() {
        this.scene.remove(this.aimLine);
        this.scene.remove(this.dashLine);
        this.scene.remove(this.ghostBall);
        this.scene.remove(this.targetDot);
        this.scene.remove(this.reticle);
        this.scene.remove(this.reticleDot);
        this.aimLine.geometry.dispose();
        this.aimLine.material.dispose();
        this.dashLine.geometry.dispose();
        this.dashLine.material.dispose();
        this.ghostBall.geometry.dispose();
        this.ghostBall.material.dispose();
        this.targetDot.geometry.dispose();
        this.targetDot.material.dispose();
        this.reticle.geometry.dispose();
        this.reticle.material.dispose();
        this.reticleDot.geometry.dispose();
        this.reticleDot.material.dispose();
    }
}
