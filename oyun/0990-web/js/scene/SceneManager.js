// ============================================
// SceneManager — Three.js Scene Setup
// ============================================
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import { IS_TOUCH, POST } from '../constants.js';

// Tepe lambalarının masa uzun ekseni (X) boyunca konumları. Masa LENGTH=2.54
// (x ∈ [-1.27, 1.27]) → üç lamba bu aralığı düzgün kaplar. Hem ışıklar hem görünür
// lamba gövdeleri bu konumlara yerleşir.
const LAMP_XS = [-0.85, 0, 0.85];

export class SceneManager {
    constructor(canvas) {
        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: !IS_TOUCH,   // MSAA is costly on mobile GPUs
            alpha: false,
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        // Cap device pixel ratio lower on touch devices to protect fill-rate.
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_TOUCH ? 1.5 : 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        // NeutralToneMapping (Khronos PBR Neutral): ACESFilmic keçenin doygun yeşilini
        // pastele yıkıyordu (kullanıcı Blender kıyası, 2026-07-02) — Neutral renk tonunu
        // korur, yalnız parlak uçları yumuşatır. Masa rengi artık dokudakine sadık.
        this.renderer.toneMapping = THREE.NeutralToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;

        // Scene — black-hole moru atmosfer: çok koyu mor zemin, kenarlar sise düşer
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x070510);
        this.scene.fog = new THREE.Fog(0x080611, 4.5, 12);

        // Camera
        this.camera = new THREE.PerspectiveCamera(
            50,
            window.innerWidth / window.innerHeight,
            0.01,
            50
        );
        this.camera.position.set(0, 2.5, 2.5);
        this.camera.lookAt(0, 0.8, 0);

        // Lighting
        this._setupLights();

        // Floor
        this._createFloor();

        // Postprocessing (Faz 11): yalnız "Yüksek" kalitede kurulur/açılır (setQuality).
        this.composer = null;
        this._bloom = null;
        this._vignette = null;
        this._postEnabled = false;

        // Resize handler
        this._onResize = this._handleResize.bind(this);
        window.addEventListener('resize', this._onResize);
    }

    /** EffectComposer pipeline'ını kur (Bloom + Vignette + OutputPass). Bir kez. */
    _buildComposer() {
        if (this.composer) return;
        const w = window.innerWidth, h = window.innerHeight;
        const composer = new EffectComposer(this.renderer);
        composer.setPixelRatio(this.renderer.getPixelRatio());
        composer.setSize(w, h);
        composer.addPass(new RenderPass(this.scene, this.camera));

        const bloom = new UnrealBloomPass(
            new THREE.Vector2(w, h), POST.BLOOM_STRENGTH, POST.BLOOM_RADIUS, POST.BLOOM_THRESHOLD
        );
        composer.addPass(bloom);

        const vignette = new ShaderPass(VignetteShader);
        vignette.uniforms.offset.value = POST.VIGNETTE_OFFSET;
        vignette.uniforms.darkness.value = POST.VIGNETTE_DARK;
        composer.addPass(vignette);

        // OutputPass: tonemap (ACESFilmic) + sRGB dönüşümü (doğrudan-render ile aynı görünüm).
        composer.addPass(new OutputPass());

        this.composer = composer;
        this._bloom = bloom;
        this._vignette = vignette;
    }

    /** Postprocessing'i serbest bırak (GPU belleği) — düşük kaliteye geçince. */
    _disposePost() {
        if (!this.composer) return;
        this.composer.dispose();   // render target'ları serbest bırakır
        this.composer = null;
        this._bloom = null;
        this._vignette = null;
    }

    /** Postprocessing aç/kapat (setQuality çağırır). on iken composer'ı kurar. */
    _setPost(on) {
        this._postEnabled = !!on;
        if (on) this._buildComposer();
        else this._disposePost();
    }

    _setupLights() {
        // Ambient — siyahları hafifçe morla kaldırır.
        const ambient = new THREE.AmbientLight(0x342d4e, 0.26);
        this.scene.add(ambient);

        // Hemisphere — hafif soğuk-mor üst dolgu; kenarlar tamamen kararmasın.
        // (0.32→0.26: mor film keçeye biniyordu — tema dursun ama masayı boyamasın.)
        const hemi = new THREE.HemisphereLight(0x6a63b0, 0x070512, 0.26);
        hemi.position.set(0, 4, 0);
        this.scene.add(hemi);
        this._hemi = hemi;                 // low kalitede ışık diyeti telafisi (setQuality)
        this._baseHemiInt = hemi.intensity;

        // Tepe dolgu — masayı genel olarak yukarıdan eşitler (yassılaştırmadan).
        const topFill = new THREE.DirectionalLight(0xbfc4ff, 0.2);
        topFill.position.set(0, 4, 0.5);
        topFill.target.position.set(0, 0.8, 0);
        this.scene.add(topFill);
        this.scene.add(topFill.target);
        this._topFill = topFill;
        this._baseTopFillInt = topFill.intensity;

        // Tepedeki bilardo lambaları — masa uzun ekseni (X) boyunca ÜÇ lamba.
        // Tek lamba dengesizdi (merkez parlak, kenar/yüz karanlık); üç havuz örtüşünce
        // masa boyunca düzgün ışık + karakterin yüzü açılır. Yalnızca ORTA lamba gölge
        // atar (mobilde 3 gölge haritası pahalı); yan lambalar dolgu.
        // Spot rengi nötr-sıcak (0xfff8ee): eski krem (0xfff1dd) yeşil keçeyi
        // sarıya çekip solduruyordu — masa rengi dokuya sadık kalsın.
        this.overheadLights = [];
        for (const lx of LAMP_XS) {
            const isCenter = lx === 0;
            const spot = new THREE.SpotLight(0xfff8ee, isCenter ? 10 : 9);
            spot.position.set(lx, 2.8, 0);
            spot.angle = Math.PI / 5;
            spot.penumbra = 0.85;
            spot.decay = 1.5;
            spot.distance = 8;
            spot.target.position.set(lx, 0.8, 0);
            if (isCenter) {
                spot.castShadow = true;
                spot.shadow.mapSize.set(IS_TOUCH ? 1024 : 2048, IS_TOUCH ? 1024 : 2048);
                spot.shadow.camera.near = 0.5;
                spot.shadow.camera.far = 6;
                spot.shadow.bias = -0.001;
                spot.shadow.radius = 3;
                this.mainLight = spot; // setQuality bunun gölge haritasını günceller
            }
            this.scene.add(spot);
            this.scene.add(spot.target);
            this.overheadLights.push(spot);
        }

        // Aksan ışıkları — sıcak/soğuk sinematik kontrast (black-hole moru teması).
        // Sol: mor rim; sağ: amber sıcaklık. Dolgu değil, atmosfer için kısık tutuldu.
        // (2026-07-02 kısıldı: bantları pembeye, keçe kenarını mora boyuyorlardı.)
        const violet = new THREE.PointLight(0x8a4bff, 1.4, 11);
        violet.position.set(-2.2, 1.9, -1.5);
        this.scene.add(violet);
        this._violet = violet;             // low kalitede kapatılır (setQuality)

        const amber = new THREE.PointLight(0xff9a4e, 1.0, 10);
        amber.position.set(2.2, 1.9, 1.5);
        this.scene.add(amber);

        // Faz 10 "Final Evresi" gerilim tinti: amber ışığı + sis/zemin rengini kırmızıya
        // çeker (setTension). Temel değerleri sakla → kapanınca geri dönülür.
        this._amber = amber;
        this._baseAmberColor = amber.color.clone();
        this._baseAmberInt = amber.intensity;
        this._baseFog = this.scene.fog.color.clone();
        this._baseBg = this.scene.background.clone();
        this._tension = 0;            // smoothed 0..1
        this._tensionTarget = 0;      // istenen gerilim (0/1)
        this._tensFog = new THREE.Color(0x2a0206);
        this._tensBg = new THREE.Color(0x180207);
        this._tensRed = new THREE.Color(0xff2630);

        // Lamp shade geometry (visual indicator of each overhead light)
        for (const lx of LAMP_XS) this._createLampShade(lx);
    }

    _createLampShade(x = 0) {
        const group = new THREE.Group();

        // Shade — wide cone
        const shadeGeom = new THREE.CylinderGeometry(0.45, 0.65, 0.15, 32, 1, true);
        const shadeMat = new THREE.MeshStandardMaterial({
            color: 0x1a3a1a,
            roughness: 0.7,
            metalness: 0.3,
            side: THREE.DoubleSide,
        });
        const shade = new THREE.Mesh(shadeGeom, shadeMat);
        group.add(shade);

        // Rim ring
        const rimGeom = new THREE.TorusGeometry(0.65, 0.012, 8, 48);
        const rimMat = new THREE.MeshStandardMaterial({
            color: 0xc0a060,
            roughness: 0.3,
            metalness: 0.8,
        });
        const rim = new THREE.Mesh(rimGeom, rimMat);
        rim.rotation.x = Math.PI / 2;
        rim.position.y = -0.075;
        group.add(rim);

        // Chain / cord
        const cordGeom = new THREE.CylinderGeometry(0.005, 0.005, 1.0, 6);
        const cordMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
        const cord = new THREE.Mesh(cordGeom, cordMat);
        cord.position.y = 0.55;
        group.add(cord);

        // Inner glow (emissive disc)
        const glowGeom = new THREE.CircleGeometry(0.5, 32);
        const glowMat = new THREE.MeshBasicMaterial({
            color: 0xffeedd,
            transparent: true,
            opacity: 0.25,
            side: THREE.DoubleSide,
        });
        const glow = new THREE.Mesh(glowGeom, glowMat);
        glow.rotation.x = Math.PI / 2;
        glow.position.y = -0.07;
        group.add(glow);

        group.position.set(x, 2.75, 0);
        this.scene.add(group);
    }

    _createFloor() {
        // Dark polished floor
        const floorGeom = new THREE.PlaneGeometry(20, 20);
        const floorMat = new THREE.MeshStandardMaterial({
            color: 0x0d0d15,
            roughness: 0.85,
            metalness: 0.1,
        });
        const floor = new THREE.Mesh(floorGeom, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = 0;
        floor.receiveShadow = true;
        this.scene.add(floor);

        // Subtle wall hint
        const wallGeom = new THREE.PlaneGeometry(20, 5);
        const wallMat = new THREE.MeshStandardMaterial({
            color: 0x0f0f1a,
            roughness: 0.95,
        });
        const backWall = new THREE.Mesh(wallGeom, wallMat);
        backWall.position.set(0, 2.5, -6);
        this.scene.add(backWall);
    }

    /**
     * Apply a graphics quality level ('high' | 'low'). Adjusts pixel ratio and
     * shadow-map resolution. Defaults preserve the original tuning exactly
     * (desktop high = PR2 / 2048, touch low = PR1.5 / 1024). Safe at runtime.
     */
    setQuality(level) {
        const low = level === 'low';
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, low ? 1.5 : 2));
        if (this.mainLight) {
            const size = low ? 1024 : 2048;
            if (this.mainLight.shadow.mapSize.width !== size) {
                this.mainLight.shadow.mapSize.set(size, size);
                // Dispose the old shadow map so the new size takes effect.
                if (this.mainLight.shadow.map) {
                    this.mainLight.shadow.map.dispose();
                    this.mainLight.shadow.map = null;
                }
            }
        }

        // Işık diyeti (mobil perf): forward render'da HER piksel sahnedeki tüm ışıkları
        // hesaplar — low'da yan 2 spot + 2 aksan point'i kapat (visible=false shader'dan
        // da çıkarır → program küçülür), kaybı hemi/topFill artışıyla telafi et. Lamba
        // gövdeleri/glow diskleri görsel olarak yanık kalır. Final-evre amber nabzı
        // low'da görünmez (fog/zemin tinti yine çalışır) — bilinçli feragat.
        for (const s of this.overheadLights) {
            if (s !== this.mainLight) { s.visible = !low; s.target.visible = !low; }
        }
        if (this._violet) this._violet.visible = !low;
        if (this._amber) this._amber.visible = !low;
        if (this._hemi) this._hemi.intensity = low ? 0.44 : this._baseHemiInt;
        if (this._topFill) this._topFill.intensity = low ? 0.38 : this._baseTopFillInt;

        // Gölge filtresi: low'da PCF (PCFSoft'un geniş kernel'i mobilde pahalı).
        // Tip değişimi derlenmiş materyallere işlesin diye needsUpdate gerekir.
        const wantShadowType = low ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
        if (this.renderer.shadowMap.type !== wantShadowType) {
            this.renderer.shadowMap.type = wantShadowType;
            this.scene.traverse((o) => {
                if (o.material) {
                    for (const m of [].concat(o.material)) if (m) m.needsUpdate = true;
                }
            });
        }

        // Faz 11: postprocessing yalnız "Yüksek" kalitede (mobil-perf bütçesi).
        this._setPost(!low);
        if (this.composer) this.composer.setPixelRatio(this.renderer.getPixelRatio());
    }

    /** Faz 10: "Final Evresi" gerilim aydınlatması aç/kapat (sis/zemin/amber → kırmızı). */
    setTension(on) {
        this._tensionTarget = on ? 1 : 0;
    }

    render() {
        // Gerilim tinti: hedefe yumuşakça süzül + amber ışığı kırmızı nabza çek (Faz 10).
        if (this._amber && (this._tension !== this._tensionTarget || this._tension > 0)) {
            this._tension += (this._tensionTarget - this._tension) * 0.06;
            if (Math.abs(this._tension - this._tensionTarget) < 0.002) this._tension = this._tensionTarget;
            const t = this._tension;
            this.scene.fog.color.copy(this._baseFog).lerp(this._tensFog, t);
            this.scene.background.copy(this._baseBg).lerp(this._tensBg, t);
            this._amber.color.copy(this._baseAmberColor).lerp(this._tensRed, t);
            const pulse = 0.8 + Math.sin(performance.now() * 0.006) * 0.5;
            this._amber.intensity = this._baseAmberInt + t * (2.6 + pulse);
        }
        // Faz 11: "Yüksek" kalitede composer (Bloom+Vignette), aksi halde doğrudan render.
        if (this._postEnabled && this.composer) this.composer.render();
        else this.renderer.render(this.scene, this.camera);
    }

    _handleResize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
        if (this.composer) {
            this.composer.setPixelRatio(this.renderer.getPixelRatio());
            this.composer.setSize(w, h);
            if (this._bloom) this._bloom.setSize(w, h);
        }
    }

    dispose() {
        window.removeEventListener('resize', this._onResize);
        this.renderer.dispose();
    }
}
