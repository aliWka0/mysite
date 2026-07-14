// ============================================
// TableModel — High-detail GLB billiard table (VISUAL ONLY)
// ============================================
// Physics (cushions + pockets) still come from the procedural `Table` class.
// This module only loads the GLB mesh and fits it so that its felt surface
// and cushion noses line up exactly with the physics play area defined in
// constants.js — so balls roll and bounce on the *visible* table.
//
// The reference values below were measured directly from the GLB geometry
// (in the model's own world space, after its baked node transforms):
//   • felt playing surface height ........ MODEL_FELT_Y
//   • play area half-length (model +Z) ... MODEL_PLAY_HALF_LEN
//   • play area half-width  (model +X) ... MODEL_PLAY_HALF_WID
// The model's long axis is +Z, while the game's long axis is +X, so the
// model is rotated 90° about Y to align them.
// ============================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TABLE, BALL } from '../constants.js';

// Kalite moduna göre model: 'high' → 4096 doku + 591k üçgen (masaüstü/web),
// 'low' (mobil varsayılanı) → 2048 doku + ~158k üçgen (`table_optimized_mobile.glb`,
// _opt.js üretir). 4096 baseColor GPU'da ham ~90MB açılıyor + 591k üçgen her kare —
// telefondaki kasmanın ana kaynağıydı. Seçim YÜKLEME anında yapılır (canlı kalite
// değişimi masayı yeniden yüklemez; yeniden başlatınca uygulanır).
const MODEL_URL        = 'table_optimized.glb';
const MODEL_URL_MOBILE = 'table_optimized_mobile.glb';

// --- Measured model-space reference points (do not guess; these come from the file) ---
const MODEL_FELT_Y        = 0.1299;   // world Y of the felt surface in the model
const MODEL_PLAY_HALF_LEN = 0.4504;   // half play length along model +Z
const MODEL_PLAY_HALF_WID = 0.2444;   // half play width  along model +X

// Fine vertical correction: the visible felt sits slightly above the measured
// plane, so balls/character looked ~20% sunk into the cloth. Drop the whole
// model by a fraction of the ball radius so balls rest ON the felt.
const SURFACE_DROP = BALL.RADIUS * 0.6;  // ≈ 17.1 mm

export class TableModel {
    constructor(scene, renderer = null, quality = 'high') {
        this.scene = scene;
        this.renderer = renderer;   // doku anizotropisi için (opsiyonel)
        this.quality = quality;     // 'low' → mobil GLB (küçük doku + geometri)
        this.root = new THREE.Group();
        this.loaded = false;
        this.scene.add(this.root);
    }

    async init(onProgress) {
        const loader = new GLTFLoader();
        try {
            const url = this.quality === 'low' ? MODEL_URL_MOBILE : MODEL_URL;
            const gltf = await loader.loadAsync(url, onProgress);
            const model = gltf.scene;

            // Fit the model's play area to the physics play area.
            // Model length (+Z) -> world X ; model width (+X) -> world Z (after 90° Y-rotation).
            const scaleForLength = (TABLE.LENGTH / 2) / MODEL_PLAY_HALF_LEN; // applied to local Z
            const scaleForWidth  = (TABLE.WIDTH  / 2) / MODEL_PLAY_HALF_WID; // applied to local X
            const scaleY = scaleForLength; // keep vertical proportions tied to the long axis

            // Three.js applies scale in local axes, THEN rotation.
            this.root.scale.set(scaleForWidth, scaleY, scaleForLength);
            this.root.rotation.y = Math.PI / 2;

            // Drop the felt surface exactly onto the physics playing height,
            // minus a small correction so balls rest on (not sink into) the felt.
            this.root.position.set(0, TABLE.HEIGHT - scaleY * MODEL_FELT_Y - SURFACE_DROP, 0);

            // Shadows + sane material defaults. Anizotropi ŞART: kamera masaya
            // alçak açıyla bakar → filtreleme olmadan keçe dokusu yatık açıda
            // çözünürlükten bağımsız yağlıboya gibi bulanıklaşır.
            const maxAniso = this.renderer
                ? this.renderer.capabilities.getMaxAnisotropy() : 8;
            model.traverse((child) => {
                if (child.isMesh) {
                    // castShadow yalnız 'high'da: masa statik, gölge pass'inde yüzbinlerce
                    // üçgeni her kare İKİNCİ kez çizmek mobil kasmanın büyük parçasıydı.
                    // 'low'da kapalı — toplar/karakterler masaya gölge düşürmeye devam
                    // eder (receiveShadow açık), masanın kendi gölgesi dokuda/AO'da.
                    child.castShadow = this.quality !== 'low';
                    child.receiveShadow = true;
                    if (child.material && child.material.map) {
                        child.material.map.colorSpace = THREE.SRGBColorSpace;
                        child.material.map.anisotropy = Math.min(8, maxAniso);
                    }
                }
            });

            this.root.add(model);
            this._addClothDecals();   // Faz 12: keçeye tebeşir/çizik izleri (yaşanmışlık)
            this.loaded = true;
        } catch (err) {
            console.error('Failed to load table model:', err);
            this.loaded = false;
        }
    }

    /**
     * Faz 12: keçe üstüne ince tebeşir/çizik izleri (yumuşak smudge dekalleri). Saf
     * prosedürel (canvas) → varlık yok. Çok sönük tutulur (oyun netliğini bozmaz);
     * sahneye DOĞRUDAN eklenir (model transform'undan etkilenmesin). setVisible toggler.
     */
    _addClothDecals() {
        // Paylaşımlı yumuşak smudge dokusu (radyal alfa).
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 64;
        const ctx = canvas.getContext('2d');
        const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 31);
        g.addColorStop(0, 'rgba(255,255,255,0.9)');
        g.addColorStop(0.6, 'rgba(255,255,255,0.35)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
        const tex = new THREE.CanvasTexture(canvas);

        // { x, z, r, color, opacity } — keçe içinde, çoğunlukla kenara/köşeye yakın, sönük.
        const SPOTS = [
            { x: -0.95, z:  0.18, r: 0.06, c: 0x0a0a08, o: 0.11 },   // çizik (koyu)
            { x:  0.62, z: -0.30, r: 0.05, c: 0x0a0a08, o: 0.10 },
            { x:  0.05, z:  0.34, r: 0.045, c: 0x0a0a08, o: 0.09 },
            { x: -0.40, z: -0.34, r: 0.05, c: 0x0a0a08, o: 0.10 },
            { x:  1.00, z:  0.10, r: 0.055, c: 0xaec4dc, o: 0.07 },  // tebeşir (açık mavi)
            { x: -1.02, z: -0.12, r: 0.05, c: 0xaec4dc, o: 0.06 },
        ];
        this._decals = [];
        for (const s of SPOTS) {
            const mat = new THREE.MeshBasicMaterial({
                color: s.c, map: tex, transparent: true, opacity: s.o, depthWrite: false,
            });
            const d = new THREE.Mesh(new THREE.PlaneGeometry(s.r * 2, s.r * 2), mat);
            d.rotation.x = -Math.PI / 2;
            d.rotation.z = Math.random() * Math.PI;       // her iz farklı dönsün
            d.position.set(s.x, TABLE.HEIGHT + 0.0008, s.z);  // temas gölgesinin de altında
            d.renderOrder = 0;
            this.scene.add(d);
            this._decals.push(d);
        }
    }

    setVisible(visible) {
        this.root.visible = visible;
        if (this._decals) for (const d of this._decals) d.visible = visible;
    }
}
