import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { TABLE } from '../constants.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

// Bizim Meshy biped iskeletimiz → Quaternius UE-Mannequin iskeleti kemik eşlemesi.
// retargetClip için: anahtar = BİZİM kemik adı, değer = Quaternius kemik adı.
// (Quaternius'un parmak kemikleri bizde yok; eşlenmeyenler retarget'ta atlanır.)
const QUAT_BONE_MAP = {
    Hips: 'pelvis',
    Spine: 'spine_01', Spine01: 'spine_02', Spine02: 'spine_03',
    neck: 'neck_01', Head: 'Head',
    LeftShoulder: 'clavicle_l', LeftArm: 'upperarm_l', LeftForeArm: 'lowerarm_l', LeftHand: 'hand_l',
    RightShoulder: 'clavicle_r', RightArm: 'upperarm_r', RightForeArm: 'lowerarm_r', RightHand: 'hand_r',
    LeftUpLeg: 'thigh_l', LeftLeg: 'calf_l', LeftFoot: 'foot_l', LeftToeBase: 'ball_l',
    RightUpLeg: 'thigh_r', RightLeg: 'calf_r', RightFoot: 'foot_r', RightToeBase: 'ball_r',
};

// Hangi Quaternius klibi → bizdeki hangi temiz ad + döngü mü.
// q_* önekliler LOCOMOTION: init() bunları retarget sonrası idle/walk/run
// yuvalarına taşır (taban Meshy klipleri fallback kalır). Bkz. USE_QUAT_LOCOMOTION.
const QUAT_CLIPS = [
    ['Idle_Loop',         'q_idle', true],    // → idle (beklerken ana duruş)
    ['Walk_Loop',         'q_walk', true],    // → walk (yavaş yürüyüş)
    ['Jog_Fwd_Loop',      'q_run',  true],    // → run  (koşu)
    ['Dance_Loop',        'victory', true],   // game-over kazanan kutlaması
    ['Idle_Talking_Loop', 'idle2',   true],   // beklerken idle varyasyonu
    ['Interact',          'lean',    false],  // topa eğilme/etkileşim (deneme)
];

// Locomotion kaynağı: Quaternius retarget mı, native Meshy mi?
// false → idle/walk/run karakterin KENDİ (native) klipleri (retarget distorsiyonu yok:
//   yamuk duruş / sakat koşma olmaz). Hız bölmesi + idle canlılığı yine çalışır.
// true  → Quaternius Idle/Walk/Jog retarget edilip kullanılır (daha çeşitli ama
//   bu rig çiftinde bacak/duruş hatası verebilir).
// NOT: bu Meshy rig'i için retarget edilen locomotion bacakları bozuyor → şimdilik false.
const USE_QUAT_LOCOMOTION = false;

// Beklerken ara sıra idle2 (Quaternius Idle_Talking) varyasyonu oynat.
// false: retarget bu rig'te idle2'yi de yamuk yapıyor → kapalı. Native idle zaten
// bir döngü (nefes/salınım var), donuk değil. Temiz ikinci idle bulunursa açılır.
const IDLE_VARIATION = false;

// _syncMesh her kare her karakter için çalışır — Euler'i yeniden kullan (GC diyeti).
const _syncEuler = new THREE.Euler();

export class Player {
    constructor(scene, physicsWorld, options = {}) {
        this.scene = scene;
        this.physicsWorld = physicsWorld;
        this.owner = options.owner || 1;          // 1 (insan) | 2 (rakip/bot)
        this.ringColor = options.ringColor || 0xffffff;

        // Character Dimensions (Shrunk to the size of a billiard ball)
        this.radius = 0.014;
        this.height = 0.028;
        this.fullHeight = this.height + this.radius * 2;

        // 1. Visual Mesh Container
        this.mesh = new THREE.Group();
        this.scene.add(this.mesh);

        // Dinamik gölge cast'i (kalite ayarı sürer): low'da kapalı — 86k üçgenlik
        // skinned mesh'i gölge pass'inde ikinci kez çizmek mobilde pahalı; temas
        // gölgesi blob'u (Faz 12) görevi zaten görüyor. setCastShadow toggler.
        this._castShadow = true;
        this._shadowMeshes = [];

        // Temas gölgesi (Faz 12): ayağının altında yumuşak koyu blob (fake AO) → karakter
        // keçeye "ait" hisseder. Halkanın ALTINDA çizilir; havalanınca (ragdoll) söner/yayılır.
        this._restY = TABLE.HEIGHT + this.fullHeight / 2;   // ayakta dururkenki gövde yüksekliği
        this._createContactShadow();

        // Kimlik göstergesi: ayağının altında, keçede duran renkli halka (P1 mor / P2 amber).
        // Unlit (MeshBasic) → moody sahnede "marker" gibi parlar. XZ'de karakteri izler.
        this._createIndicatorRing();

        // 2. Physics Body
        const shape = new CANNON.Box(new CANNON.Vec3(this.radius, this.fullHeight / 2, this.radius));
        this.body = new CANNON.Body({
            mass: 5,
            type: CANNON.Body.KINEMATIC,
            position: new CANNON.Vec3(0, TABLE.HEIGHT + this.fullHeight / 2, 0)
        });
        this.body.addShape(shape);
        this.body.collisionFilterGroup = 2; // Walking group
        this.body.collisionFilterMask = 0;  // Ghost while walking

        this.physicsWorld.addBody(this.body);

        // Movement config
        this.walkSpeed = 0.30;
        this.isRagdoll = false;
        // Faz 3 dash/turbo: isDashing=true iken hız ×_dashSpeedMul + çarparsa rakibi devirir.
        this.isDashing = false;
        this._dashTimer = 0;
        this._dashSpeedMul = 1;
        this.dashKnockScale = 0.35;   // çarpma devirme şiddeti (tier'a göre dash() set eder)
        
        // Animation State
        this.mixer = null;
        this.actions = {};
        this.currentAction = null;
        this.isLoaded = false;
        this.isKicking = false;
        this.isCelebrating = false;   // victory dansı oynarken hareket/idle geçişini kilitler
        this._targetSkinned = null;   // retarget hedefi (karakterin SkinnedMesh'i)

        // Locomotion durumu (hıza göre walk/run + idle canlılığı)
        this._gait = 'walk';          // 'walk' | 'run' — histerezisli yürü/koş seçimi
        this._moving = false;         // şu an yürüyor/koşuyor mu (LAN ağ animasyon kodu için)
        this._idleTimer = 0;          // idle/idle2 varyasyon zamanlayıcısı
        this._idleVariating = false;  // şu an idle2 varyasyonu oynuyor mu
        this._nextIdleBreak = this._randIdleBreak();
        
        // Initial sync
        this._syncMesh();
    }

    async init(onProgress) {
        const loader = new GLTFLoader();

        // Single consolidated, compressed character: mesh + skeleton + all clips
        // (idle / run / walk / hit / arise) in one GLB (~3.8 MB, was ~66 MB of FBX).
        // Produced by _opt_char.js. Textures are embedded; clips are named.
        const MODEL_URL = 'Banana_Shirt_Boy/character.glb';

        try {
            const gltf = await loader.loadAsync(MODEL_URL, onProgress);
            const mainModel = gltf.scene;

            // Auto-scale to fit target height
            const box = new THREE.Box3().setFromObject(mainModel);
            const size = box.getSize(new THREE.Vector3());
            const targetHeight = this.fullHeight * 1.5; // Slightly taller than old capsule
            const scale = targetHeight / size.y;

            mainModel.scale.set(scale, scale, scale);

            // Recalculate bounding box after scaling to offset correctly
            const scaledBox = new THREE.Box3().setFromObject(mainModel);
            mainModel.position.y = -scaledBox.min.y - (this.fullHeight / 2); // Put feet exactly at bottom of capsule

            // Shadows + keep the Meshy look (matte, non-metallic) like the old build.
            this._shadowMeshes = [];   // setCastShadow (kalite) yalnız bunları toggler
            mainModel.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = this._castShadow;
                    child.receiveShadow = true;
                    this._shadowMeshes.push(child);
                    for (const mat of [].concat(child.material)) {
                        if (!mat) continue;
                        mat.metalness = 0.0;
                        mat.roughness = 1.0;
                        // Meshy GLB'si emissive=beyaz + emissive doku ile geliyor →
                        // karakter KENDİLİĞİNDEN parlıyor (sahne ışığını dinlemez, atmosfere
                        // oturmaz, kalitesiz görünür). Söndür: yalnızca sahne ışığıyla aydınlansın.
                        if (mat.emissive) mat.emissive.setHex(0x000000);
                        mat.emissiveIntensity = 0;
                        if (mat.emissiveMap) mat.emissiveMap = null;
                        mat.needsUpdate = true;
                    }
                }
            });

            this.mesh.add(mainModel);

            // Set up Mixer + named clips. GLTFLoader preserves the clip names
            // assigned in _opt_char.js, so look them up by name (fall back to
            // index/regex defensively).
            this.mixer = new THREE.AnimationMixer(mainModel);
            const clips = gltf.animations || [];
            const pick = (name, re) =>
                clips.find(c => c.name === name) ||
                clips.find(c => re.test(c.name)) ||
                null;

            const idleClip  = pick('idle',  /idle|alert/i) || clips[0];
            const runClip   = pick('run',   /run/i);
            const walkClip  = pick('walk',  /walk/i);
            const hitClip   = pick('hit',   /hit|skill/i);
            const ariseClip = pick('arise', /arise/i);

            if (idleClip) this.actions.idle = this.mixer.clipAction(idleClip);
            if (runClip)  this.actions.run  = this.mixer.clipAction(runClip);
            if (walkClip) this.actions.walk = this.mixer.clipAction(walkClip);

            if (hitClip) {
                this.actions.hit = this.mixer.clipAction(hitClip);
                this.actions.hit.setLoop(THREE.LoopOnce);
                this.actions.hit.clampWhenFinished = true;
            }
            if (ariseClip) {
                this.actions.arise = this.mixer.clipAction(ariseClip);
                this.actions.arise.setLoop(THREE.LoopOnce);
                this.actions.arise.clampWhenFinished = true;
            }

            // Retarget hedefi: karakterin SkinnedMesh'i (Quaternius kliplerini bunun
            // iskeletine aktaracağız). Quaternius animasyon kütüphanesini yükle + retarget et.
            this._mainModel = mainModel;
            mainModel.traverse((o) => { if (o.isSkinnedMesh && !this._targetSkinned) this._targetSkinned = o; });
            await this._loadExtraAnims(loader, idleClip);

            // Locomotion'u Quaternius retarget'a yükselt: idle/walk/run yuvalarını
            // q_* kliplerle değiştir (varsa). Başarısız retarget → taban Meshy klibi.
            if (USE_QUAT_LOCOMOTION) {
                if (this.actions.q_idle) this.actions.idle = this.actions.q_idle;
                if (this.actions.q_walk) this.actions.walk = this.actions.q_walk;
                if (this.actions.q_run)  this.actions.run  = this.actions.q_run;
            }

            // Start with idle
            if (this.actions.idle) {
                this.actions.idle.play();
                this.currentAction = this.actions.idle;
            }

            this.isLoaded = true;
        } catch (err) {
            console.error("Failed to load character:", err);
            // Fallback to capsule if loading fails
            const geom = new THREE.CapsuleGeometry(this.radius, this.height, 4, 16);
            const mat = new THREE.MeshStandardMaterial({ color: 0x3b82f6 });
            const capsule = new THREE.Mesh(geom, mat);
            capsule.castShadow = this._castShadow;
            this._shadowMeshes.push(capsule);
            this.mesh.add(capsule);
        }
    }

    /**
     * Dünya-uzayı delta retarget: bir kaynak klibini (farklı rig) bizim iskelete
     * aktarır. Her eşlenen kemik için kaynağın rest'ten DÜNYA-dönüş farkını
     * (D = Qanim · Qbind⁻¹) bizim kemiğin rest dünya-dönüşüne uygulayıp local'e
     * çevirir. Eksen/local-frame farklarına dayanıklı; yalnızca dönüş üretir
     * (boyut/pozisyon değişmez). Hedef olarak KLON iskelet verilir (canlı bozulmaz).
     * @returns {THREE.AnimationClip} kemik adıyla bağlı quaternion izli klip
     */
    _deltaRetarget(targetSkin, targetRoot, srcSkin, srcScene, clip, refClip, fps = 30) {
        const Q = THREE.Quaternion;
        const tBones = targetSkin.skeleton.bones;
        const sBones = srcSkin.skeleton.bones;

        // Hedef REFERANS pozu = "ayağa kaldırılmış BIND" (dik T-pose). Kaynağın referansı
        // da bind=T-pose olduğundan kollar/bacaklar EŞLEŞİR (idle'ı referans alırsak idle
        // kolları aşağıda olduğu için kollar tuhaf kayar). Karakterin ham bind'i yatık
        // (Meshy sırtüstü riglemiş), o yüzden yalnızca KÖK'ü (Hips) idle@0 yönüne çevirip
        // gövdeyi dikleştiriyoruz; diğer kemikler bind-local (T-pose) kalır. Klon üzerinde.
        let idleHipsW = null;
        if (refClip) {
            const rm = new THREE.AnimationMixer(targetRoot);
            rm.clipAction(refClip).play(); rm.setTime(0);
            targetRoot.updateMatrixWorld(true);
            const hb = tBones.find((b) => b.name === 'Hips');
            if (hb) idleHipsW = hb.getWorldQuaternion(new Q());
            rm.stopAllAction();
        }
        targetSkin.skeleton.pose();
        targetRoot.updateMatrixWorld(true);
        if (idleHipsW) {
            const hb = tBones.find((b) => b.name === 'Hips');
            if (hb) {
                const pW = hb.parent ? hb.parent.getWorldQuaternion(new Q()) : new Q();
                hb.quaternion.copy(pW.invert().multiply(idleHipsW)); // Hips → dik yön
            }
        }
        targetRoot.updateMatrixWorld(true);
        const QtBindW = {}, QtBindL = {}, tParentBindW = {};
        for (const b of tBones) {
            QtBindW[b.name] = b.getWorldQuaternion(new Q());
            QtBindL[b.name] = b.quaternion.clone();
            tParentBindW[b.name] = b.parent ? b.parent.getWorldQuaternion(new Q()) : new Q();
        }
        // Kaynak bind dünya dönüşleri.
        srcSkin.skeleton.pose(); srcScene.updateMatrixWorld(true);
        const QsBindW = {};
        for (const b of sBones) QsBindW[b.name] = b.getWorldQuaternion(new Q());

        // Hedef kemikleri EBEVEYN-ÖNCE sırala (dünya→local dönüşüm ebeveyn dünyasını ister).
        const order = [];
        (function walk(b) { if (b.isBone) order.push(b); for (const c of b.children) walk(c); })(tBones[0]);
        for (const b of tBones) if (!order.includes(b)) order.push(b);

        const numFrames = Math.max(2, Math.round(clip.duration * fps));
        const times = new Float32Array(numFrames);
        const values = {};
        for (const b of tBones) if (QUAT_BONE_MAP[b.name]) values[b.name] = new Float32Array(numFrames * 4);

        const mixer = new THREE.AnimationMixer(srcScene);
        mixer.clipAction(clip).play();
        const QsW = {}, tWorld = {};

        for (let i = 0; i < numFrames; i++) {
            const t = (i / (numFrames - 1)) * clip.duration;
            times[i] = t;
            mixer.setTime(t); srcScene.updateMatrixWorld(true);
            for (const b of sBones) QsW[b.name] = b.getWorldQuaternion(QsW[b.name] || new Q());

            for (const tb of order) {
                const parentW = (tb.parent && tb.parent.isBone) ? tWorld[tb.parent.name] : tParentBindW[tb.name];
                const sName = QUAT_BONE_MAP[tb.name];
                let desiredW;
                if (sName && QsW[sName]) {
                    const D = QsW[sName].clone().multiply(QsBindW[sName].clone().invert());
                    desiredW = D.multiply(QtBindW[tb.name]);
                } else {
                    desiredW = parentW.clone().multiply(QtBindL[tb.name]);
                }
                const local = parentW.clone().invert().multiply(desiredW);
                tb.quaternion.copy(local); tb.updateMatrixWorld();
                tWorld[tb.name] = (tWorld[tb.name] || new Q()).copy(desiredW);
                if (values[tb.name]) local.toArray(values[tb.name], i * 4);
            }
        }
        mixer.stopAllAction();

        const tracks = [];
        for (const b of tBones) {
            if (!values[b.name]) continue; // yalnızca eşlenen kemikler animasyonlu
            tracks.push(new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', times, values[b.name]));
        }
        return new THREE.AnimationClip('retargeted', clip.duration, tracks);
    }

    /**
     * Quaternius UAL (CC0) animasyonlarını yükle ve bizim iskelete RETARGET et.
     * İki rig farklı (Meshy biped vs UE-Mannequin), o yüzden klipler doğrudan
     * oynamaz; SkeletonUtils.retargetClip kemik haritası + bind-pose farkını
     * çözerek bizim kemiklere bağlı yeni klipler üretir.
     */
    async _loadExtraAnims(loader, refClip) {
        if (!this._targetSkinned || !this.mixer || !this._mainModel) return;
        try {
            const src = await loader.loadAsync('Banana_Shirt_Boy/anim_lib.glb');
            let srcSkinned = null;
            src.scene.traverse((o) => { if (o.isSkinnedMesh && !srcSkinned) srcSkinned = o; });
            if (!srcSkinned) { console.warn('[anims] kaynak iskelet bulunamadı'); return; }

            // ÖNEMLİ: retargetClip HEDEF iskeletin kemiklerini hesaplarken yerinde
            // değiştirir (yan etki) → canlı karakteri bozar/şişirir. Bu yüzden
            // karakterin bir KLONU üzerinde retarget yapıyoruz; canlı iskelete hiç
            // dokunulmuyor. Üretilen izler kemik ADIYLA bağlı, mevcut mixer canlıya uygular.
            const rig = cloneSkeleton(this._mainModel);
            let cloneSkinned = null;
            rig.traverse((o) => { if (o.isSkinnedMesh && !cloneSkinned) cloneSkinned = o; });
            if (!cloneSkinned) { console.warn('[anims] klon iskelet bulunamadı'); return; }

            for (const [srcName, newName, loop] of QUAT_CLIPS) {
                // Kullanılmayan klipleri retarget etme (mobil açılış maliyeti):
                // locomotion (q_*) sadece USE_QUAT_LOCOMOTION'da, idle2 sadece IDLE_VARIATION'da.
                if (!USE_QUAT_LOCOMOTION && newName.startsWith('q_')) continue;
                if (!IDLE_VARIATION && newName === 'idle2') continue;
                const clip = src.animations.find((c) => c.name === srcName);
                if (!clip) continue;

                // KENDİ retarget'ımız (three.js retargetClip bu UE↔Mixamo rig çiftinde
                // pozu bozuyordu). Dünya-uzayı delta yöntemi: kaynağın her kemikteki
                // rest'ten dünya-dönüş farkını bizim kemiğin rest'ine uygular → local
                // quaternion. Sadece eşlenen kemiklerin dönüş izleri üretilir; boyut
                // değişmez (pozisyon/ölçek izi yok). Doğrulandı: ~3° uzuv-hareket hatası.
                const rc = this._deltaRetarget(cloneSkinned, rig, srcSkinned, src.scene, clip, refClip);
                rc.name = newName;

                const action = this.mixer.clipAction(rc);
                if (loop) {
                    action.setLoop(THREE.LoopRepeat);
                } else {
                    action.setLoop(THREE.LoopOnce);
                    action.clampWhenFinished = true;
                }
                this.actions[newName] = action;
            }
            console.log('[anims] retarget tamam:', Object.keys(this.actions).join(', '));
        } catch (e) {
            console.warn('[anims] ek animasyon yükleme/retarget başarısız:', e.message || e);
        }
    }

    /** Game-over kazanan kutlaması: victory dansını oynat (hareketle ezilmesin diye kilitle). */
    playVictory() {
        if (!this.actions.victory) return;
        this.isCelebrating = true;
        this.isKicking = false;
        this._fadeToAction('victory', 0.3);
    }

    _fadeToAction(name, duration = 0.2) {
        if (!this.isLoaded || !this.actions[name]) return;
        const nextAction = this.actions[name];
        if (this.currentAction === nextAction) return;

        if (this.currentAction) {
            this.currentAction.fadeOut(duration);
        }
        nextAction.reset().fadeIn(duration).play();
        this.currentAction = nextAction;
    }

    /** İki idle varyasyonu arası rastgele bekleme (saniye) — duruş cansız olmasın. */
    _randIdleBreak() { return 5 + Math.random() * 6; } // ~5–11 sn

    /**
     * Beklerken karaktere canlılık: çoğunlukla 'idle', ara sıra (5–11 sn'de bir)
     * bir tur 'idle2' (Idle_Talking) varyasyonu oynatıp tekrar idle'a döner.
     * idle2 yoksa düz idle'da kalır.
     */
    _updateIdleLife(dt) {
        // Varyasyon kapalı (veya idle2 yok) → düz native idle (temiz, yamuk değil).
        if (!IDLE_VARIATION || !this.actions.idle2) {
            this._fadeToAction('idle', 0.25);
            return;
        }

        const inIdleFamily =
            this.currentAction === this.actions.idle ||
            this.currentAction === this.actions.idle2;

        // İdle ailesine yeni girdiysek (ör. yürümeyi bıraktık) → idle'a geç, sıfırla.
        if (!inIdleFamily) {
            this._fadeToAction('idle', 0.25);
            this._idleTimer = 0;
            this._idleVariating = false;
            this._nextIdleBreak = this._randIdleBreak();
            return;
        }

        this._idleTimer += dt;

        if (this._idleVariating) {
            // idle2 varyasyonu bir tur oynadı mı → idle'a dön.
            if (this._idleTimer >= this._varDuration) {
                this._fadeToAction('idle', 0.4);
                this._idleVariating = false;
                this._idleTimer = 0;
                this._nextIdleBreak = this._randIdleBreak();
            }
        } else if (this.actions.idle2 && this._idleTimer >= this._nextIdleBreak) {
            // Zamanı geldi → idle2 varyasyonunu bir tur oynat.
            this._fadeToAction('idle2', 0.4);
            this._idleVariating = true;
            this._idleTimer = 0;
            this._varDuration = this.actions.idle2.getClip().duration;
        }
    }

    /**
     * Update player logic.
     * @param {number} dt
     * @param {{x:number,y:number}} moveInput - analog move vector in input space:
     *        x = strafe (right +), y = forward (+). Keyboard feeds ±1; the
     *        virtual joystick feeds analog magnitudes (0..1) for variable speed.
     * @param {THREE.Vector3} cameraForwardXZ - camera heading on the XZ plane.
     */
    update(dt, moveInput, cameraForwardXZ) {
        if (this.mixer) {
            this.mixer.update(dt);
        }

        // Dash/turbo penceresi: süre dolunca hız çarpanını ve devirme yetkisini kapat.
        if (this.isDashing) {
            this._dashTimer -= dt;
            if (this._dashTimer <= 0) {
                this.isDashing = false;
                this._dashSpeedMul = 1;
            }
        }

        if (this.isRagdoll) {
            this._syncMesh();
            return;
        }

        if (this.isKicking) {
            this._syncMesh();
            return; // Don't move while kicking
        }

        if (this.isCelebrating) {
            this._syncMesh();
            return; // Victory dansı: hareket/idle geçişi yok
        }

        // Kinematic Walking Logic — analog input vector (keyboard or joystick)
        let dirX = moveInput ? moveInput.x : 0;
        let dirZ = moveInput ? moveInput.y : 0;

        const mag = Math.sqrt(dirX * dirX + dirZ * dirZ);
        const isMoving = mag > 0.08; // small deadzone for analog sticks
        this._moving = isMoving;     // LAN ağ animasyon kodu için (host okur)

        if (isMoving) {
            // Normalize direction; keep magnitude (capped) as a speed scale so a
            // small joystick tilt walks slowly. Keyboard mag is always 1.
            const speedScale = Math.min(1, mag);
            dirX /= mag;
            dirZ /= mag;

            // Sağ vektör = (-fwd.z, 0, fwd.x) — ayrı Vector3 üretmeden bileşenle hesapla (GC diyeti).
            const moveX = cameraForwardXZ.x * dirZ + (-cameraForwardXZ.z) * dirX;
            const moveZ = cameraForwardXZ.z * dirZ + cameraForwardXZ.x * dirX;

            // Apply movement (dash/turbo iken hız çarpanıyla)
            const spd = this.walkSpeed * this._dashSpeedMul;
            this.body.position.x += moveX * spd * speedScale * dt;
            this.body.position.z += moveZ * spd * speedScale * dt;
            
            // Clamp to table boundaries
            const hl = TABLE.LENGTH / 2 - this.radius;
            const hw = TABLE.WIDTH / 2 - this.radius;
            this.body.position.x = Math.max(-hl, Math.min(hl, this.body.position.x));
            this.body.position.z = Math.max(-hw, Math.min(hw, this.body.position.z));

            // Face movement direction
            const targetAngle = Math.atan2(moveX, moveZ);
            this.mesh.rotation.y = targetAngle;

            // Hıza göre yürü/koş — histerezisli (eşik civarında titremesin).
            const RUN_ON = 0.62, RUN_OFF = 0.45;
            this._gait = (this._gait === 'run')
                ? (speedScale < RUN_OFF ? 'walk' : 'run')
                : (speedScale > RUN_ON  ? 'run'  : 'walk');
            this._fadeToAction(this._gait, 0.18);

            // Ayak kaymasını azalt: klip oynatma hızını yürüme hızına ölçekle.
            const act = this.actions[this._gait];
            if (act) {
                const nominal = this._gait === 'run' ? 1.0 : 0.55;
                act.timeScale = THREE.MathUtils.clamp(speedScale / nominal, 0.7, 1.5);
            }
            this._idleVariating = false; // hareket başlayınca idle varyasyonunu sıfırla
        } else {
            this._updateIdleLife(dt); // beklerken idle + ara sıra idle2 canlılığı
        }

        this._syncMesh();
    }

    /**
     * Trigger kick animation and fire callback exactly when striking the ball.
     */
    kickAnimation(aimAngle, onStrikeCallback) {
        // Face the target
        this.mesh.rotation.y = aimAngle + Math.PI / 2;
        
        this.isKicking = true;
        this._fadeToAction('hit', 0.1);

        // Hit animation duration is likely ~1.5s, strike point is probably at ~0.6s
        setTimeout(() => {
            if (onStrikeCallback) onStrikeCallback();
        }, 600); 

        // After animation completes, go back to idle
        setTimeout(() => {
            this.isKicking = false;
            this._fadeToAction('idle', 0.3);
        }, 1500);
    }

    /**
     * Karakteri devir (tumble). Top çarpması rastgele/güçlü; sabotaj çarpması nazik
     * ve yönlü olsun diye parametreli.
     * @param {number} impulseScale - itme ölçeği (1 = top çarpması; ~0.35 = sabotaj)
     * @param {{x:number,z:number}|null} dir - yatay itme yönü (normalize); yoksa rastgele
     */
    /**
     * Dash/turbo başlat (hareket item'ı). Kısa süre hız ×SPEED_MUL + bu pencerede
     * rakibe çarparsa KNOCK_SCALE şiddetinde devirir (SabotageManager body-check).
     * @param {{DURATION:number, SPEED_MUL:number, KNOCK_SCALE:number}} cfg
     */
    dash(cfg) {
        if (this.isRagdoll || !cfg) return;
        this.isDashing = true;
        this._dashTimer = cfg.DURATION;
        this._dashSpeedMul = cfg.SPEED_MUL;
        this.dashKnockScale = cfg.KNOCK_SCALE;
    }

    /**
     * @param {number} impulseScale - yatay itme ölçeği (1 = top çarpması)
     * @param {{x:number,z:number}|null} dir - yatay itme yönü (yoksa rastgele)
     * @param {number} vertFactor - dikey itme çarpanı (1 = normal; ≈0 = ayağı kayma/slip)
     */
    makeRagdoll(impulseScale = 1, dir = null, vertFactor = 1) {
        if (this.isRagdoll) return;
        this.isRagdoll = true;
        this.isKicking = false;
        this.isDashing = false;     // dash sırasında devrilirse dash'i kes
        this._dashSpeedMul = 1;

        // Switch physics body to dynamic
        this.body.type = CANNON.Body.DYNAMIC;
        this.body.collisionFilterGroup = 4; // Ragdoll group
        this.body.collisionFilterMask = 1 | 4; // Collide with table and balls

        // Yatay itme yönü: verilmişse o yönde (devirme), yoksa rastgele
        let hx, hz;
        if (dir) {
            const len = Math.hypot(dir.x, dir.z) || 1;
            hx = dir.x / len; hz = dir.z / len;
        } else {
            hx = (Math.random() - 0.5) * 2; hz = (Math.random() - 0.5) * 2;
        }
        const horiz = 5 * impulseScale;
        const vert = (Math.random() * 5 + 2) * impulseScale * vertFactor;
        const force = new CANNON.Vec3(hx * horiz, vert, hz * horiz);
        this.body.applyImpulse(force);

        // Add random spin (ölçekli)
        const spin = 20 * impulseScale;
        this.body.angularVelocity.set(
            (Math.random() - 0.5) * spin,
            (Math.random() - 0.5) * spin,
            (Math.random() - 0.5) * spin
        );

        // Pause animation so the mesh freezes in current pose while tumbling
        if (this.mixer) {
            this.mixer.timeScale = 0;
        }
    }

    reset() {
        this.isRagdoll = false;
        this.isCelebrating = false;
        
        // Reset physics
        this.body.type = CANNON.Body.KINEMATIC;
        this.body.velocity.set(0, 0, 0);
        this.body.angularVelocity.set(0, 0, 0);
        this.body.quaternion.setFromEuler(0, 0, 0); // Stand upright
        
        this.body.collisionFilterGroup = 2; // Walking group
        this.body.collisionFilterMask = 0; // Ghost

        // Clamp to table surface + masa sınırlarına (ragdoll yerçekimsiz sürüklenebilir)
        this.body.position.y = TABLE.HEIGHT + this.fullHeight / 2;
        const hl = TABLE.LENGTH / 2 - this.radius;
        const hw = TABLE.WIDTH / 2 - this.radius;
        this.body.position.x = Math.max(-hl, Math.min(hl, this.body.position.x));
        this.body.position.z = Math.max(-hw, Math.min(hw, this.body.position.z));

        // Play arise animation
        if (this.mixer) {
            this.mixer.timeScale = 1.0;
            this._fadeToAction('arise', 0.1);
            
            // Go to idle after arising
            setTimeout(() => {
                if (!this.isRagdoll && !this.isKicking) {
                    this._fadeToAction('idle', 0.3);
                }
            }, 1800);
        }
    }

    /**
     * Karakterin dinamik gölge cast'ini aç/kapat (grafik kalitesi 'low' → kapalı).
     * Yalnız model mesh'lerini toggler — halka/temas gölgesi blob'u etkilenmez.
     */
    setCastShadow(on) {
        this._castShadow = !!on;
        for (const m of this._shadowMeshes) m.castShadow = this._castShadow;
    }

    _syncMesh() {
        // Copy pos/rot from physics body to visual mesh
        this.mesh.position.copy(this.body.position);
        if (this.isRagdoll) {
            this.mesh.quaternion.copy(this.body.quaternion);
        } else {
            // Keep upright while walking/standing
            this.mesh.quaternion.setFromEuler(_syncEuler.set(0, this.mesh.rotation.y, 0));
        }
        // Gösterge halkası keçe üstünde, karakterin XZ izinde sabit yatay durur.
        if (this.ring) {
            this.ring.position.set(this.body.position.x, TABLE.HEIGHT + 0.002, this.body.position.z);
        }
        // Temas gölgesi: XZ'de karakteri izler; havalanınca (ragdoll) söner + hafif yayılır.
        if (this._shadow) {
            this._shadow.position.set(this.body.position.x, TABLE.HEIGHT + 0.0012, this.body.position.z);
            const lift = Math.max(0, this.body.position.y - this._restY);
            const k = Math.max(0, 1 - lift / 0.05);   // ~5cm kalkınca tamamen kaybolur
            this._shadow.material.opacity = this._shadowBaseOpacity * (0.18 + 0.82 * k);
            this._shadow.scale.setScalar(1 + lift * 6);   // yükseldikçe yumuşar/büyür
        }
    }

    /** Ayak altı temas gölgesi (fake AO): yumuşak radyal blob, keçe üstünde yatar. */
    _createContactShadow() {
        // Radyal alfa dokusu (merkez opak → kenar saydam). RGB önemsiz (materyal rengi siyah).
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 64;
        const ctx = canvas.getContext('2d');
        const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
        g.addColorStop(0, 'rgba(255,255,255,0.95)');
        g.addColorStop(0.55, 'rgba(255,255,255,0.45)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 64);
        const tex = new THREE.CanvasTexture(canvas);

        const r = this.radius * 3.0;
        const mat = new THREE.MeshBasicMaterial({
            color: 0x000000, map: tex, transparent: true, opacity: 0.5,
            depthWrite: false,
        });
        this._shadow = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), mat);
        this._shadow.rotation.x = -Math.PI / 2;
        this._shadow.position.set(0, TABLE.HEIGHT + 0.0012, 0);   // halkanın (0.002) ALTINDA
        this._shadow.renderOrder = 1;
        this._shadowBaseOpacity = 0.5;
        this.scene.add(this._shadow);
    }

    /** Ayak altı kimlik halkası (unlit, hafif saydam). */
    _createIndicatorRing() {
        const geom = new THREE.RingGeometry(this.radius * 1.3, this.radius * 1.9, 32);
        const mat = new THREE.MeshBasicMaterial({
            color: this.ringColor,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        this.ring = new THREE.Mesh(geom, mat);
        this.ring.rotation.x = -Math.PI / 2;     // XY → XZ düzlemine yatır
        this.ring.position.set(0, TABLE.HEIGHT + 0.002, 0);
        this.ring.renderOrder = 2;
        this.scene.add(this.ring);
    }

    /** Karakteri + halkayı görünür/gizli yap (menüde P2 gizlenir). */
    setVisible(v) {
        this.mesh.visible = v;
        if (this.ring) this.ring.visible = v;
        if (this._shadow) this._shadow.visible = v;
    }

    /** Karakteri masa düzleminde bir noktaya yerleştir (kinematik; ragdoll değilken). */
    placeAt(x, z, faceAngle = 0) {
        this.body.position.set(x, TABLE.HEIGHT + this.fullHeight / 2, z);
        this.body.velocity.set(0, 0, 0);
        this.body.angularVelocity.set(0, 0, 0);
        this.mesh.rotation.y = faceAngle;
        this._syncMesh();
    }

    /** Karakter şu an KOŞU yürüyüşünde mi? (histerezisli `_gait` — animasyonla birebir;
     *  ayak sesi walk/run seçimi BUNA bağlanır, hız eşiğine değil → ses ve animasyon örtüşür.) */
    get running() { return this._gait === 'run'; }

    // ---- LAN ağ sunumu (host kodlar → istemci fizik çalıştırmadan çizer) ----

    /** HOST: bu karakterin o anki animasyon kodu (0 idle·1 walk·2 run·3 hit·4 arise·5 ragdoll·6 victory). */
    getNetAnim() {
        if (this.isRagdoll) return 5;
        if (this.isKicking) return 3;
        if (this.isCelebrating) return 6;
        if (!this._moving) return 0;
        return this._gait === 'run' ? 2 : 1;
    }

    /**
     * İSTEMCİ: host snapshot'ından poz + rotasyon + animasyon uygula (fizik YOK).
     * Konum DOĞRUDAN set edilir — yumuşatma main.js interpolasyon tamponunda yapılır
     * (iki snapshot arası, ~INTERP_DELAY geriden → WiFi jitter'ı yutulur).
     * @param {number} an getNetAnim() kodu
     * @param {boolean} rag ragdoll mı · @param {number[]} q ragdoll quaternion [x,y,z,w]
     */
    applyNet(dt, x, y, z, ry, an, rag, q) {
        if (this.mixer) this.mixer.update(dt);

        if (rag) {
            this.isRagdoll = true;
            if (this.mixer) this.mixer.timeScale = 0;
            this.body.position.set(x, y, z);
            if (q) this.body.quaternion.set(q[0], q[1], q[2], q[3]);
            this._syncMesh();
            return;
        }
        if (this.isRagdoll) { this.isRagdoll = false; if (this.mixer) this.mixer.timeScale = 1; }

        this.body.position.set(x, y, z);
        this.mesh.rotation.y = ry;

        const NAMES = ['idle', 'walk', 'run', 'hit', 'arise', null, 'victory'];
        const name = NAMES[an] || 'idle';
        if (an === 6 && this.playVictory) { if (!this.isCelebrating) this.playVictory(); }
        else {
            this.isCelebrating = false;
            this.isKicking = (an === 3);
            this._fadeToAction(name === 'victory' ? 'idle' : name, 0.15);
            // Yürü/koş klibini makul hızda oynat (ayak kayması azalsın); idle/hit kendi hızında.
            const act = this.actions[name];
            if (act && (name === 'walk' || name === 'run')) act.timeScale = name === 'run' ? 1.0 : 0.9;
        }

        this._syncMesh();
    }
}
