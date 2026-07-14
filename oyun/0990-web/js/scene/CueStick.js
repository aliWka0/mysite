// ============================================
// CueStick — Cue Stick Visual + Animation
// ============================================
import * as THREE from 'three';
import { BALL } from '../constants.js';

export class CueStick {
    constructor(scene) {
        this.scene = scene;
        this.group = new THREE.Group();
        this.visible = false;
        this.pullback = 0;       // 0–1 pullback for power
        this._animating = false;

        this._createStick();
        this.group.visible = false;
        this.scene.add(this.group);
    }

    _createStick() {
        // Cue stick: tapered cylinder
        const stickLength = 1.4;
        const tipRadius = 0.005;
        const buttRadius = 0.014;

        // Create an inner container to hold the meshes
        // This allows us to rotate and translate the geometry 
        // so that the tip is at (0,0,0) and the stick extends along +Z
        const innerGroup = new THREE.Group();

        // We build the stick along the Y axis (default for CylinderGeometry)
        // Tip is at Y = stickLength, butt is at Y = 0.

        // Main shaft (wood color)
        const shaftGeom = new THREE.CylinderGeometry(tipRadius, buttRadius * 0.7, stickLength * 0.65, 12);
        const shaftMat = new THREE.MeshStandardMaterial({
            color: 0xd4a56a,
            roughness: 0.5,
            metalness: 0.05,
        });
        const shaft = new THREE.Mesh(shaftGeom, shaftMat);
        shaft.position.y = stickLength * 0.325 + stickLength * 0.35;
        innerGroup.add(shaft);

        // Butt section (darker wood)
        const buttGeom = new THREE.CylinderGeometry(buttRadius * 0.7, buttRadius, stickLength * 0.35, 12);
        const buttMat = new THREE.MeshStandardMaterial({
            color: 0x2a1506,
            roughness: 0.4,
            metalness: 0.1,
        });
        const butt = new THREE.Mesh(buttGeom, buttMat);
        butt.position.y = stickLength * 0.175;
        innerGroup.add(butt);

        // Tip (blue chalk)
        const tipGeom = new THREE.CylinderGeometry(tipRadius * 0.9, tipRadius, 0.015, 12);
        const tipMat = new THREE.MeshStandardMaterial({
            color: 0x3366bb,
            roughness: 0.7,
            metalness: 0.0,
        });
        const tip = new THREE.Mesh(tipGeom, tipMat);
        tip.position.y = stickLength + 0.0075;
        innerGroup.add(tip);

        // Ferrule (white ring above tip)
        const ferruleGeom = new THREE.CylinderGeometry(tipRadius, tipRadius, 0.012, 12);
        const ferruleMat = new THREE.MeshStandardMaterial({
            color: 0xf0f0e0,
            roughness: 0.3,
            metalness: 0.1,
        });
        const ferrule = new THREE.Mesh(ferruleGeom, ferruleMat);
        ferrule.position.y = stickLength - 0.002;
        innerGroup.add(ferrule);

        // Wrap / band (decorative ring)
        const wrapGeom = new THREE.CylinderGeometry(buttRadius * 0.72, buttRadius * 0.72, 0.04, 12);
        const wrapMat = new THREE.MeshStandardMaterial({
            color: 0x111111,
            roughness: 0.6,
            metalness: 0.3,
        });
        const wrap = new THREE.Mesh(wrapGeom, wrapMat);
        wrap.position.y = stickLength * 0.35;
        innerGroup.add(wrap);

        // Transform inner group so the tip (which is at Y = stickLength) moves to origin (0,0,0)
        innerGroup.position.y = -stickLength;
        
        // Rotate the inner group so the tip points towards -Z, and butt goes towards +Z
        innerGroup.rotation.x = Math.PI / 2;

        this.group.add(innerGroup);

        // Store dimensions
        this.stickLength = stickLength;

        // Enable shadow casting
        this.group.traverse(child => {
            if (child.isMesh) {
                child.castShadow = true;
            }
        });
    }

    /**
     * Position the cue stick relative to the cue ball.
     * @param {THREE.Vector3} cueBallPos - Position of the cue ball
     * @param {number} aimAngle - Horizontal aim angle (radians)
     * @param {number} power - Power 0–1 (controls pullback distance)
     */
    update(cueBallPos, aimAngle, power = 0) {
        if (!this.visible) return;

        // Store for animation use
        this._lastCueBallPos = cueBallPos;
        this._lastAimAngle = aimAngle;

        // Calculate the direction from cue ball along aim angle (on XZ plane)
        const dirX = Math.cos(aimAngle);
        const dirZ = Math.sin(aimAngle);

        // Base offset: stick tip starts just outside the ball surface
        const baseOffset = BALL.RADIUS + 0.01;
        // Pullback offset based on power
        const pullbackOffset = (this._animating ? this.pullback : power * 0.35);
        const totalOffset = baseOffset + pullbackOffset;

        // The tip (which is this.group's origin) should be placed 'totalOffset' distance AWAY from the ball, 
        // in the direction OPPOSITE to the aim direction. 
        // aimAngle is where we are shooting TO.
        // So we move back by subtracting dir.
        const tipX = cueBallPos.x - dirX * totalOffset;
        const tipZ = cueBallPos.z - dirZ * totalOffset;

        this.group.position.set(tipX, cueBallPos.y, tipZ);

        // Now look exactly at the cue ball
        this.group.lookAt(cueBallPos.x, cueBallPos.y, cueBallPos.z);

        // Slight downward tilt for realism (after lookAt, local X is right, local Y is up, local Z is back)
        // Rotating around local X axis by a small negative amount tilts it up at the butt (down at the tip)
        this.group.rotateX(-0.03);
    }

    show() {
        this.visible = true;
        this.group.visible = true;
    }

    hide() {
        this.visible = false;
        this.group.visible = false;
    }

    /**
     * Animate the shot: pull back then thrust forward.
     * @param {number} power - Shot power 0–1
     * @param {Function} onStrike - Called at the moment of impact
     * @param {Function} onComplete - Called when animation finishes
     */
    animateShot(power, onStrike, onComplete) {
        if (this._animating) return;
        this._animating = true;
        this.visible = true;
        this.group.visible = true;

        const pullDuration = 150;    // ms
        const strikeDuration = 80;   // ms
        const holdDuration = 100;    // ms
        const startTime = performance.now();
        const maxPull = power * 0.35;

        let struck = false;

        const animate = (time) => {
            const elapsed = time - startTime;

            if (elapsed < pullDuration) {
                // Pull back phase
                this.pullback = (elapsed / pullDuration) * maxPull;
            } else if (elapsed < pullDuration + strikeDuration) {
                // Strike phase
                const t = (elapsed - pullDuration) / strikeDuration;
                this.pullback = maxPull * (1 - t);
                if (!struck && t > 0.7) {
                    struck = true;
                    if (onStrike) onStrike();
                }
            } else if (elapsed < pullDuration + strikeDuration + holdDuration) {
                this.pullback = 0;
            } else {
                // Done
                this._animating = false;
                this.pullback = 0;
                if (onComplete) onComplete();
                return;
            }

            // Update visual position during animation
            if (this._lastCueBallPos) {
                this.update(this._lastCueBallPos, this._lastAimAngle, 0);
            }

            requestAnimationFrame(animate);
        };

        requestAnimationFrame(animate);
    }

    get isAnimating() {
        return this._animating;
    }
}
