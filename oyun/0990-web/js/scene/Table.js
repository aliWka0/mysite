// ============================================
// Table — Procedural Billiard Table Geometry
// ============================================
import * as THREE from 'three';
import { TABLE, getPocketPositions } from '../constants.js';

export class Table {
    constructor(scene) {
        this.scene = scene;
        this.group = new THREE.Group();
        this.pocketPositions = getPocketPositions();
        this.cushionData = []; // {position, halfExtents, quaternion} for physics

        this._createPlayingSurface();
        this._createCushions();
        this._createFrame();
        this._createPockets();
        this._createLegs();
        this._createDecorations();

        this.scene.add(this.group);
    }

    _createPlayingSurface() {
        // Green felt surface
        const geom = new THREE.BoxGeometry(TABLE.LENGTH, 0.02, TABLE.WIDTH);
        const mat = new THREE.MeshStandardMaterial({
            color: 0x0d6b2e,
            roughness: 0.92,
            metalness: 0.0,
        });
        const surface = new THREE.Mesh(geom, mat);
        surface.position.y = TABLE.HEIGHT - 0.01;
        surface.receiveShadow = true;
        this.group.add(surface);
    }

    _createCushions() {
        const mat = new THREE.MeshStandardMaterial({
            color: 0x0a5a25,
            roughness: 0.85,
            metalness: 0.05,
        });

        const hl = TABLE.LENGTH / 2;
        const hw = TABLE.WIDTH / 2;
        const pr = TABLE.POCKET_RADIUS;
        const ch = TABLE.RAIL_HEIGHT;          // cushion height
        const cw = TABLE.CUSHION_WIDTH;        // cushion depth
        const sy = TABLE.HEIGHT + ch / 2;      // center Y of cushion

        // The 6 cushion segments:
        // 2 short-side cushions (along Z, at x = ±hl)
        // 4 long-side cushion segments (along X, at z = ±hw, split by side pocket)

        // Short cushion at x = -hl (left end), runs between corner pockets
        const shortLen = TABLE.WIDTH - 2 * pr * 1.6;
        this._addCushion(mat, { x: -hl - cw/2, y: sy, z: 0 }, { x: cw/2, y: ch/2, z: shortLen/2 }, 'short');
        this._addCushion(mat, { x:  hl + cw/2, y: sy, z: 0 }, { x: cw/2, y: ch/2, z: shortLen/2 }, 'short');

        // Long cushion segments at z = -hw (bottom)
        const longLen = (TABLE.LENGTH / 2 - pr * 1.8);
        this._addCushion(mat, { x: -longLen/2 - pr*0.2, y: sy, z: -hw - cw/2 }, { x: longLen/2, y: ch/2, z: cw/2 }, 'long');
        this._addCushion(mat, { x:  longLen/2 + pr*0.2, y: sy, z: -hw - cw/2 }, { x: longLen/2, y: ch/2, z: cw/2 }, 'long');

        // Long cushion segments at z = +hw (top)
        this._addCushion(mat, { x: -longLen/2 - pr*0.2, y: sy, z:  hw + cw/2 }, { x: longLen/2, y: ch/2, z: cw/2 }, 'long');
        this._addCushion(mat, { x:  longLen/2 + pr*0.2, y: sy, z:  hw + cw/2 }, { x: longLen/2, y: ch/2, z: cw/2 }, 'long');
    }

    _addCushion(mat, pos, halfExtents, type) {
        const geom = new THREE.BoxGeometry(halfExtents.x * 2, halfExtents.y * 2, halfExtents.z * 2);
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(pos.x, pos.y, pos.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.group.add(mesh);

        // Store cushion data for physics
        this.cushionData.push({
            position: { x: pos.x, y: pos.y, z: pos.z },
            halfExtents: { x: halfExtents.x, y: halfExtents.y, z: halfExtents.z },
        });
    }

    _createFrame() {
        const frameMat = new THREE.MeshStandardMaterial({
            color: 0x5c3a1e,
            roughness: 0.5,
            metalness: 0.15,
        });

        const fw = TABLE.FRAME_WIDTH;
        const fh = TABLE.FRAME_HEIGHT;
        const hl = TABLE.LENGTH / 2 + TABLE.CUSHION_WIDTH;
        const hw = TABLE.WIDTH / 2 + TABLE.CUSHION_WIDTH;
        const fy = TABLE.HEIGHT - fh / 2;

        // Top rail (z+)
        this._addFrame(frameMat, { x: 0, y: fy, z: hw + fw/2 }, TABLE.LENGTH + fw * 2 + TABLE.CUSHION_WIDTH * 2, fh, fw);
        // Bottom rail (z-)
        this._addFrame(frameMat, { x: 0, y: fy, z: -hw - fw/2 }, TABLE.LENGTH + fw * 2 + TABLE.CUSHION_WIDTH * 2, fh, fw);
        // Left rail (x-)
        this._addFrame(frameMat, { x: -hl - fw/2, y: fy, z: 0 }, fw, fh, TABLE.WIDTH + TABLE.CUSHION_WIDTH * 2);
        // Right rail (x+)
        this._addFrame(frameMat, { x: hl + fw/2, y: fy, z: 0 }, fw, fh, TABLE.WIDTH + TABLE.CUSHION_WIDTH * 2);

        // Top cap (flat top of the rail)
        const capMat = new THREE.MeshStandardMaterial({
            color: 0x6b4423,
            roughness: 0.45,
            metalness: 0.2,
        });
        const capY = TABLE.HEIGHT + TABLE.RAIL_HEIGHT;

        // Top cap z+
        this._addFrameCap(capMat, { x: 0, y: capY, z: hw + fw/2 + TABLE.CUSHION_WIDTH/2 },
            TABLE.LENGTH + fw * 2 + TABLE.CUSHION_WIDTH * 2, fw + TABLE.CUSHION_WIDTH);
        // Top cap z-
        this._addFrameCap(capMat, { x: 0, y: capY, z: -hw - fw/2 - TABLE.CUSHION_WIDTH/2 },
            TABLE.LENGTH + fw * 2 + TABLE.CUSHION_WIDTH * 2, fw + TABLE.CUSHION_WIDTH);
        // Top cap x-
        this._addFrameCap(capMat, { x: -hl - fw/2 - TABLE.CUSHION_WIDTH/2, y: capY, z: 0 },
            fw + TABLE.CUSHION_WIDTH, TABLE.WIDTH + TABLE.CUSHION_WIDTH * 2);
        // Top cap x+
        this._addFrameCap(capMat, { x: hl + fw/2 + TABLE.CUSHION_WIDTH/2, y: capY, z: 0 },
            fw + TABLE.CUSHION_WIDTH, TABLE.WIDTH + TABLE.CUSHION_WIDTH * 2);
    }

    _addFrame(mat, pos, w, h, d) {
        const geom = new THREE.BoxGeometry(w, h, d);
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(pos.x, pos.y, pos.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.group.add(mesh);
    }

    _addFrameCap(mat, pos, w, d) {
        const geom = new THREE.BoxGeometry(w, 0.018, d);
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(pos.x, pos.y, pos.z);
        mesh.receiveShadow = true;
        this.group.add(mesh);
    }

    _createPockets() {
        const pocketMat = new THREE.MeshStandardMaterial({
            color: 0x050505,
            roughness: 0.9,
            metalness: 0,
        });

        const rimMat = new THREE.MeshStandardMaterial({
            color: 0x8B7355,
            roughness: 0.35,
            metalness: 0.5,
        });

        this.pocketPositions.forEach(p => {
            // Pocket hole (black disc)
            const holeGeom = new THREE.CircleGeometry(TABLE.POCKET_RADIUS, 24);
            const hole = new THREE.Mesh(holeGeom, pocketMat);
            hole.rotation.x = -Math.PI / 2;
            hole.position.set(p.x, TABLE.HEIGHT + 0.001, p.z);
            this.group.add(hole);

            // Pocket rim (brass-like ring)
            const rimGeom = new THREE.TorusGeometry(TABLE.POCKET_RADIUS, 0.006, 8, 24);
            const rim = new THREE.Mesh(rimGeom, rimMat);
            rim.rotation.x = -Math.PI / 2;
            rim.position.set(p.x, TABLE.HEIGHT + TABLE.RAIL_HEIGHT * 0.3, p.z);
            this.group.add(rim);
        });
    }

    _createLegs() {
        const legMat = new THREE.MeshStandardMaterial({
            color: 0x4a2c0a,
            roughness: 0.55,
            metalness: 0.1,
        });

        const hl = TABLE.LENGTH / 2 + TABLE.CUSHION_WIDTH + TABLE.FRAME_WIDTH * 0.7;
        const hw = TABLE.WIDTH / 2 + TABLE.CUSHION_WIDTH + TABLE.FRAME_WIDTH * 0.7;
        const legH = TABLE.HEIGHT - TABLE.FRAME_HEIGHT;
        const legW = 0.07;

        const positions = [
            [-hl, hw], [-hl, -hw],
            [hl, hw],  [hl, -hw],
        ];

        positions.forEach(([x, z]) => {
            const geom = new THREE.BoxGeometry(legW, legH, legW);
            const leg = new THREE.Mesh(geom, legMat);
            leg.position.set(x, legH / 2, z);
            leg.castShadow = true;
            this.group.add(leg);

            // Small foot
            const footGeom = new THREE.CylinderGeometry(0.04, 0.045, 0.02, 12);
            const footMat = new THREE.MeshStandardMaterial({
                color: 0x888888,
                roughness: 0.3,
                metalness: 0.7,
            });
            const foot = new THREE.Mesh(footGeom, footMat);
            foot.position.set(x, 0.01, z);
            this.group.add(foot);
        });
    }

    _createDecorations() {
        // Diamond markers on the rails
        const diamondMat = new THREE.MeshStandardMaterial({
            color: 0xD4AF37,
            roughness: 0.3,
            metalness: 0.6,
        });

        const hl = TABLE.LENGTH / 2;
        const hw = TABLE.WIDTH / 2;
        const dy = TABLE.HEIGHT + TABLE.RAIL_HEIGHT + 0.01;
        const offset = TABLE.CUSHION_WIDTH + TABLE.FRAME_WIDTH / 2;

        // Diamonds along long rails
        for (let i = 1; i <= 3; i++) {
            const x = -hl + i * (TABLE.LENGTH / 4);
            [hw + offset, -hw - offset].forEach(z => {
                const dGeom = new THREE.CircleGeometry(0.012, 4);
                const diamond = new THREE.Mesh(dGeom, diamondMat);
                diamond.rotation.x = -Math.PI / 2;
                diamond.rotation.z = Math.PI / 4;
                diamond.position.set(x, dy, z);
                this.group.add(diamond);
            });
        }

        // Diamonds along short rails
        for (let i = 1; i <= 1; i++) {
            const z = -hw + i * (TABLE.WIDTH / 2);
            [-hl - offset, hl + offset].forEach(x => {
                const dGeom = new THREE.CircleGeometry(0.012, 4);
                const diamond = new THREE.Mesh(dGeom, diamondMat);
                diamond.rotation.x = -Math.PI / 2;
                diamond.rotation.z = Math.PI / 4;
                diamond.position.set(x, dy, z);
                this.group.add(diamond);
            });
        }

        // Head string line (faint line across the table)
        const headStringX = -TABLE.LENGTH / 4;
        const lineGeom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(headStringX, TABLE.HEIGHT + 0.002, -hw + 0.03),
            new THREE.Vector3(headStringX, TABLE.HEIGHT + 0.002,  hw - 0.03),
        ]);
        const lineMat = new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.08,
        });
        const headString = new THREE.Line(lineGeom, lineMat);
        this.group.add(headString);

        // Foot spot
        const spotGeom = new THREE.CircleGeometry(0.008, 16);
        const spotMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.5,
            emissive: 0x333333,
        });
        const footSpot = new THREE.Mesh(spotGeom, spotMat);
        footSpot.rotation.x = -Math.PI / 2;
        footSpot.position.set(TABLE.LENGTH / 4, TABLE.HEIGHT + 0.002, 0);
        this.group.add(footSpot);
    }

    /** Show/hide the procedural visuals without touching physics data. */
    setVisible(visible) {
        this.group.visible = visible;
    }

    getCushionData() {
        return this.cushionData;
    }

    getPocketPositions() {
        return this.pocketPositions;
    }
}
