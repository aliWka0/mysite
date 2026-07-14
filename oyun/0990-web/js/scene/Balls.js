// ============================================
// Balls — Pool Ball Meshes + Procedural Textures
// ============================================
import * as THREE from 'three';
import { BALL, BALL_DATA, BALL_TYPES, TABLE, getRackPositions, CUE_BALL_START } from '../constants.js';

export class Balls {
    constructor(scene) {
        this.scene = scene;
        this.meshes = new Map(); // id → THREE.Mesh
        this.ballGeometry = new THREE.SphereGeometry(BALL.RADIUS, 32, 24);
        this._textureCache = new Map();
    }

    /** Create all 16 balls in starting positions */
    createAllBalls() {
        // Cue ball
        this._createBall(0, CUE_BALL_START);

        // Racked balls
        const rackPositions = getRackPositions();
        rackPositions.forEach(rp => {
            this._createBall(rp.ballId, { x: rp.x, y: rp.y, z: rp.z });
        });
    }

    _createBall(id, position) {
        const data = BALL_DATA.find(b => b.id === id);
        if (!data) return;

        const texture = this._getBallTexture(data);
        const mat = new THREE.MeshStandardMaterial({
            map: texture,
            roughness: 0.4, // diffuse the specular highlight
            metalness: 0.0,
            envMapIntensity: 0.5,
        });

        // Cue ball is slightly more glossy
        if (data.type === BALL_TYPES.CUE) {
            mat.roughness = 0.2;
            mat.metalness = 0.0;
            mat.color = new THREE.Color(0xf0f0f0);
            mat.map = null; // Pure white, no texture needed
        }

        const mesh = new THREE.Mesh(this.ballGeometry, mat);
        mesh.position.set(position.x, position.y, position.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.ballId = id;

        // Add glowing ring indicator under the ball
        if (id !== 0 && id !== 8) { // Cue and 8-ball handled differently or have no ring normally
            const indicatorGeom = new THREE.RingGeometry(BALL.RADIUS * 1.3, BALL.RADIUS * 1.6, 32);
            const indicatorMat = new THREE.MeshBasicMaterial({ 
                color: 0x00ffcc, 
                transparent: true, 
                opacity: 0.6, 
                side: THREE.DoubleSide,
                depthWrite: false 
            });
            const indicator = new THREE.Mesh(indicatorGeom, indicatorMat);
            indicator.rotation.x = -Math.PI / 2;
            indicator.position.set(position.x, TABLE.HEIGHT + 0.001, position.z);
            indicator.visible = false;
            this.scene.add(indicator);
            mesh.userData.indicator = indicator;
        } else if (id === 8) {
            const indicatorGeom = new THREE.RingGeometry(BALL.RADIUS * 1.3, BALL.RADIUS * 1.6, 32);
            const indicatorMat = new THREE.MeshBasicMaterial({ 
                color: 0xff3333, // red for 8-ball
                transparent: true, 
                opacity: 0.8, 
                side: THREE.DoubleSide,
                depthWrite: false 
            });
            const indicator = new THREE.Mesh(indicatorGeom, indicatorMat);
            indicator.rotation.x = -Math.PI / 2;
            indicator.position.set(position.x, TABLE.HEIGHT + 0.001, position.z);
            indicator.visible = false;
            this.scene.add(indicator);
            mesh.userData.indicator = indicator;
        }

        this.meshes.set(id, mesh);
        this.scene.add(mesh);
    }

    updateTargetIndicators(validBallIds) {
        this.meshes.forEach((mesh, id) => {
            if (mesh.userData.indicator) {
                mesh.userData.indicator.visible = validBallIds.includes(id);
            }
        });
    }

    /** Generate a procedural canvas texture for a ball */
    _getBallTexture(data) {
        if (this._textureCache.has(data.id)) {
            return this._textureCache.get(data.id);
        }

        const width = 1024;
        const height = 512;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        if (data.type === BALL_TYPES.CUE) {
            // Solid white
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, width, height);
        } else if (data.type === BALL_TYPES.SOLID || data.type === BALL_TYPES.EIGHT) {
            // Solid ball: full color with white circle + number
            ctx.fillStyle = data.color;
            ctx.fillRect(0, 0, width, height);
            this._drawNumberCircle(ctx, width, height, data.number, data.type === BALL_TYPES.EIGHT, 0.25);
            this._drawNumberCircle(ctx, width, height, data.number, data.type === BALL_TYPES.EIGHT, 0.75);
        } else if (data.type === BALL_TYPES.STRIPE) {
            // Stripe ball: white with colored horizontal band + number
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, width, height);

            // Colored stripe band (middle ~50% of the sphere)
            const bandTop = height * 0.25;
            const bandBottom = height * 0.75;
            ctx.fillStyle = data.color;
            ctx.fillRect(0, bandTop, width, bandBottom - bandTop);

            this._drawNumberCircle(ctx, width, height, data.number, false, 0.25);
            this._drawNumberCircle(ctx, width, height, data.number, false, 0.75);
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        this._textureCache.set(data.id, texture);
        return texture;
    }

    _drawNumberCircle(ctx, width, height, number, isEight, xRatio) {
        if (number === 0) return;

        const cx = width * xRatio;
        const cy = height / 2;
        const r = height * 0.16; // Much smaller circle

        // White circle background
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();

        // Thin border
        ctx.strokeStyle = 'rgba(0,0,0,0.15)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Number text
        ctx.fillStyle = isEight ? '#000000' : '#1a1a1a';
        ctx.font = `900 ${height * 0.18}px 'Outfit', Arial, sans-serif`; // Smaller font
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(number), cx, cy + 2);
    }

    /** Remove a ball from the scene (pocketed) */
    removeBall(id) {
        const mesh = this.meshes.get(id);
        if (mesh) {
            this.scene.remove(mesh);
            if (mesh.userData.indicator) {
                this.scene.remove(mesh.userData.indicator);
                mesh.userData.indicator.geometry.dispose();
                mesh.userData.indicator.material.dispose();
            }
            mesh.geometry = undefined; // shared geometry, don't dispose
            mesh.material.dispose();
            this.meshes.delete(id);
        }
    }

    /** Get a ball mesh by ID */
    getBallMesh(id) {
        return this.meshes.get(id);
    }

    /** Get all active ball IDs */
    getAllActiveBallIds() {
        return Array.from(this.meshes.keys());
    }

    /** Sync mesh positions with physics body positions */
    syncWithPhysics(positionMap, quaternionMap) {
        positionMap.forEach((pos, id) => {
            const mesh = this.meshes.get(id);
            if (mesh) {
                mesh.position.set(pos.x, pos.y, pos.z);
                if (quaternionMap && quaternionMap.has(id)) {
                    const q = quaternionMap.get(id);
                    mesh.quaternion.set(q.x, q.y, q.z, q.w);
                }
                if (mesh.userData.indicator) {
                    mesh.userData.indicator.position.set(pos.x, TABLE.HEIGHT + 0.001, pos.z);
                }
            }
        });
    }

    /** Recreate the cue ball at a specific position */
    resetCueBall(position) {
        this.removeBall(0);
        this._createBall(0, position || CUE_BALL_START);
    }

    /** Get cue ball mesh */
    getCueBall() {
        return this.meshes.get(0);
    }

    /** Get the position of a ball */
    getBallPosition(id) {
        const mesh = this.meshes.get(id);
        return mesh ? mesh.position.clone() : null;
    }

    /** Remove all balls */
    removeAll() {
        this.meshes.forEach((mesh, id) => {
            this.scene.remove(mesh);
            if (mesh.userData.indicator) {
                this.scene.remove(mesh.userData.indicator);
                mesh.userData.indicator.geometry.dispose();
                mesh.userData.indicator.material.dispose();
            }
            mesh.material.dispose();
        });
        this.meshes.clear();
    }

    /** Dispose resources */
    dispose() {
        this.removeAll();
        this.ballGeometry.dispose();
        this._textureCache.forEach(t => t.dispose());
        this._textureCache.clear();
    }
}
