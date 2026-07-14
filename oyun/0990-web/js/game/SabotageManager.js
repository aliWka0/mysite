// ============================================
// SabotageManager — Sabotaj MEKANİKLERİ (çarpma + tuzak fiziği)
// ============================================
// Sabotaj penceresi (nişancının WALKING/POWER'ı) boyunca her kare çağrılır.
// NOT (Faz 1): "ne zaman sabotaj" kararı artık ItemSystem'de (elinde item varsa).
// Burası yalnız MEKANİĞİ tutar:
//   • Tuzak (muz): item etkinleştirince `dropTrap` çağrılır; nişancı üstünden geçerse devrilir.
//   • Çarpma (body-check): yalnız sabotajcı DASH'teyken (`saboteur.isDashing`) devirir — Faz 3'te
//     dash/turbo item'larıyla açılır; Faz 1'de isDashing hep false olduğundan KAPALI.
// Devirme = Player.makeRagdoll + otomatik kurtarma; nişancı devrilince onShooterKnocked().
// Koruma: grace (tur başı) + kalkış dokunulmazlığı + ŞARJ dokunulmazlığı. FOUL ÜRETMEZ.
import * as THREE from 'three';
import { TABLE, SABOTAGE, PROJECTILE, BOMB, SHIELD, ULTIMATE, BEAM } from '../constants.js';
import { Projectile } from '../scene/Projectile.js';
import { UltiBeam } from '../scene/UltiBeam.js';

export class SabotageManager {
    constructor({ scene, sound, particles, onShooterKnocked, onExplosion, onBeamFire } = {}) {
        this.scene = scene;
        this.sound = sound || null;
        this.particles = particles || null;   // bomba patlama tozu (Faz 4)
        this.onShooterKnocked = onShooterKnocked || null;
        this.onExplosion = onExplosion || null;   // (x,z) — bomba patlayınca (kamera sarsıntısı/glow)
        this.onBeamFire = onBeamFire || null;     // (x,z) — Enerji Dalgası ateşleme sineması (yoksa onExplosion)

        this.traps = [];          // { mesh, owner, x, z, life }
        this.projectiles = [];    // Projectile[] — uçan mermiler (Faz 4: yay/roket)
        this.bombs = [];          // { mesh, spark, owner, x, z, fuse } (Faz 4)
        this.shields = [];        // { num, player, mesh, life } — kalkan kabukları (Faz 4)
        this.recovering = [];     // { player, num, timer } — devrilenleri kaldırmak için
        this._bodyCheckCd = 0;    // çarpma cooldown sayacı (Faz 3 dash için)
        this._lastPos = {};       // oyuncu hız hesabı için önceki konum (num → {x,z})

        // En son update'ten nişancı bilgisi (item activate'leri buradan hedef alır).
        this._shooter = null;
        this._shooterNum = 0;

        // --- Koruma durumu (adalet) ---
        // Dokunulmazlık: devrilip kalkınca kısa süre tekrar devrilemez (oyuncu no → s).
        // Kalkan (Faz 4) da buraya yazar → nişancı bir süre devrilemez.
        this.immune = { 1: 0, 2: 0 };
        // Grace: tur başında nişancı bu süre boyunca hiç devrilmez.
        this.graceTimer = 0;

        // "Enerji Dalgası" ultimate'ı (şarj + lazer): kanal durumu + VFX (lazy).
        this.beam = null;         // { owner, hit } | null
        this._ultiBeam = null;    // UltiBeam VFX (ilk kullanımda kurulur)
    }

    /** Tüm tuzakları kaldır (tur değişiminde temiz başla). */
    clearTraps() {
        for (const t of this.traps) this._disposeTrap(t);
        this.traps.length = 0;
    }

    /** Sahadaki tüm Faz 4 item nesnelerini (mermi/bomba/kalkan) kaldır. */
    clearItems() {
        for (const p of this.projectiles) this._disposeProjectile(p);
        this.projectiles.length = 0;
        for (const b of this.bombs) this._disposeBomb(b);
        this.bombs.length = 0;
        this._clearShields();
    }

    _clearShields() {
        for (const s of this.shields) this._disposeShield(s);
        this.shields.length = 0;
    }

    /**
     * TUR DEĞİŞİMİ: devrilenleri kaldır + grace başlat + kalkanları temizle. Sahadaki
     * TUZAK/MERMİ/BOMBA **KORUNUR** (kendi ömürleri/dolana kadar devam eder — atış
     * onları silmez). Tam temizlik için clearAll (maç/restart).
     */
    reset() {
        this._clearShields();
        for (const r of this.recovering) {
            if (r.player && r.player.isRagdoll) r.player.reset();
        }
        this.recovering.length = 0;
        this._bodyCheckCd = 0;
        this.immune = { 1: 0, 2: 0 };
        this.graceTimer = SABOTAGE.TURN_GRACE;   // nişancıya yaklaşma/şarj penceresi
    }

    /** MAÇ/RESTART: sahadaki HER ŞEYİ temizle (tuzak + mermi + bomba + kalkan + devrilen). */
    clearAll() {
        this.clearTraps();
        this.clearItems();
        // Enerji Dalgası kanalı varsa iptal (maç sonu/restart).
        if (this._ultiBeam) this._ultiBeam.stop();
        this.beam = null;
        for (const r of this.recovering) {
            if (r.player && r.player.isRagdoll) r.player.reset();
        }
        this.recovering.length = 0;
        this._bodyCheckCd = 0;
        this.immune = { 1: 0, 2: 0 };
        this.graceTimer = SABOTAGE.TURN_GRACE;
    }

    /**
     * Tuzak (muz) bırak — ItemSystem item etkinleştirince çağırır (slot + cooldown ORADA
     * yönetilir; burada yalnız sahadaki max sınırı). owner = bırakan oyuncu no.
     */
    dropTrap(owner, x, z) {
        const mine = this.traps.filter((t) => t.owner === owner);
        if (mine.length >= SABOTAGE.TRAP_MAX) return false;

        const group = new THREE.Group();
        // "Muz kabuğu" yer tutucu: sarı hilal (torus arc) + küçük sap.
        const peelGeom = new THREE.TorusGeometry(0.012, 0.0045, 8, 16, Math.PI * 1.35);
        const peelMat = new THREE.MeshBasicMaterial({ color: 0xffe14d });
        const peel = new THREE.Mesh(peelGeom, peelMat);
        peel.rotation.x = -Math.PI / 2;
        group.add(peel);
        group.position.set(x, TABLE.HEIGHT + 0.004, z);
        this.scene.add(group);

        this.traps.push({ mesh: group, owner, x, z, life: SABOTAGE.TRAP_LIFETIME });
        if (this.sound && this.sound.playBananaDrop) this.sound.playBananaDrop();
        return true;
    }

    /**
     * Homing menzilli mermi fırlat (yay/ok item'ı). owner = sabotajcı; hedef = en son
     * update'ten bilinen NİŞANCI (mermi onu otomatik takip eder, 3 sn). Nişancı yoksa
     * false → slot korunur. (x,z) = sabotajcının ayak konumu (çıkış noktası).
     */
    fireProjectile(owner, x, z) {
        const target = this._shooter;
        if (!target || owner === this._shooterNum) return false;
        const pr = new Projectile(this.scene, this.particles, x, z, target, owner);
        // Uçuş vınlaması: mermi yaşadığı sürece döner (_disposeProjectile söndürür).
        pr.sfx = (this.sound && this.sound.startLoop)
            ? this.sound.startLoop('projectile-loop', { gain: 0.3 }) : null;
        this.projectiles.push(pr);
        if (this.sound && this.sound.playBowShot) this.sound.playBowShot();
        return true;
    }

    /** Merminin loop sesini söndürüp görselini kaldır (tüm mermi ölüm yolları buradan). */
    _disposeProjectile(pr) {
        if (pr.sfx) { pr.sfx.stop(0.15); pr.sfx = null; }
        pr.dispose();
    }

    /**
     * Bomba YUVARLA (bowling): owner = sabotajcı; (x,z) = ayak konumu; dir = yuvarlanma
     * yönü (insan→baktığı yön, bot→nişancıya). BOMB.TRAVEL sn yuvarlanır, sonra (veya
     * nişancıya değince / sınıra varınca) BÜYÜK yarıçapta patlar — update'te.
     */
    dropBomb(owner, x, z, dir) {
        // Yuvarlanma yönü: verilen aim; yoksa nişancıya; o da yoksa +X.
        let dx = 1, dz = 0;
        if (dir && (dir.x || dir.z)) {
            const l = Math.hypot(dir.x, dir.z) || 1; dx = dir.x / l; dz = dir.z / l;
        } else if (this._shooter) {
            const sx = this._shooter.mesh.position.x - x, sz = this._shooter.mesh.position.z - z;
            const l = Math.hypot(sx, sz) || 1; dx = sx / l; dz = sz / l;
        }

        // Görsel: koyu yuvarlanan top + yüzeyde parlak nokta (dönüş görünsün).
        const group = new THREE.Group();
        const ball = new THREE.Group();
        ball.add(new THREE.Mesh(
            new THREE.SphereGeometry(BOMB.SIZE, 14, 12),
            // Koyu gövde + hafif kızıl emissive → koyu keçede görünür, "tehlikeli" hisset.
            new THREE.MeshStandardMaterial({
                color: BOMB.COLOR, metalness: 0.3, roughness: 0.55,
                emissive: 0x551200, emissiveIntensity: 0.6,
            })
        ));
        const dot = new THREE.Mesh(
            new THREE.SphereGeometry(BOMB.SIZE * 0.32, 8, 6),
            new THREE.MeshBasicMaterial({ color: BOMB.FLASH })
        );
        dot.position.set(0, BOMB.SIZE, 0);   // yüzeyde (tepe) → yuvarlanınca döner
        ball.add(dot);
        group.add(ball);
        group.position.set(x, TABLE.HEIGHT + BOMB.SIZE, z);
        this.scene.add(group);

        // Yuvarlanma ekseni: hareket yönüne dik yatay (sabit).
        const axis = new THREE.Vector3(-dz, 0, dx).normalize();
        // Yuvarlanma + fitil cızırtısı: bomba yaşadığı sürece döner (_disposeBomb söndürür).
        const sfx = (this.sound && this.sound.startLoop)
            ? this.sound.startLoop('bomb-roll-loop', { gain: 0.5 }) : null;
        this.bombs.push({ mesh: group, ball, axis, owner, x, z, dx, dz, timer: BOMB.TRAVEL, sfx });
        return true;
    }

    /**
     * Kalkan ver (nişancı savunması). num = kullanan oyuncu. immune[num] yazarak
     * onu bir süre devrilmez yapar (yalnız nişancı devrilebildiğinden bu onu korur) +
     * etrafına görsel kabuk koyar (update'te oyuncuyu izler, süre sonu söner).
     */
    grantShield(num, player) {
        this.immune[num] = Math.max(this.immune[num] || 0, SHIELD.DURATION);
        // Aynı oyuncunun önceki kabuğunu kaldır (üst üste binmesin).
        for (let i = this.shields.length - 1; i >= 0; i--) {
            if (this.shields[i].num === num) { this._disposeShield(this.shields[i]); this.shields.splice(i, 1); }
        }
        const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(player.fullHeight * 0.95, 16, 12),
            new THREE.MeshBasicMaterial({
                color: SHIELD.COLOR, transparent: true, opacity: 0.22,
                side: THREE.DoubleSide, depthWrite: false,
            })
        );
        mesh.renderOrder = 3;
        this.scene.add(mesh);
        this.shields.push({ num, player, mesh, life: SHIELD.DURATION });
        if (this.sound && this.sound.playShieldUp) this.sound.playShieldUp();
        return true;
    }

    /**
     * Ultimate "Şok Dalgası" (Faz 7): kullanan oyuncudan yayılan EMP. Sahadaki TÜM
     * tuzak/mermi/bomba'yı siler, RAKİBİ devirir (korumaları DELER — grace/dokunulmazlık/
     * şarj geçersiz; maç boyu biriken nadir ödül) ve kullanana kısa kalkan verir.
     * Görsel: büyük genişleyen halka + patlama; ses + kamera geri bildirimi (onExplosion).
     * Enerji gate'i ÇAĞIRANDA (ComboSystem.isUltReady/consumeUlt). Her zaman true döner.
     */
    triggerShockwave(ownerNum, players) {
        const owner = players[ownerNum];
        if (!owner) return false;
        const oppNum = ownerNum === 1 ? 2 : 1;
        const opp = players[oppNum];
        const ox = owner.mesh.position.x, oz = owner.mesh.position.z;

        // VFX + ses + kamera (merkez = kullanan oyuncu).
        if (this.particles) {
            try { this.particles.createShockwave(ox, oz, ULTIMATE.COLOR, ULTIMATE.RING_R); }
            catch (_) { /* yok say */ }
        }
        if (this.sound && this.sound.playShockwave) this.sound.playShockwave();
        if (this.onExplosion) this.onExplosion(ox, oz);

        // EMP: sahadaki tüm tehlikeleri sil (tuzak + mermi + bomba + kalkanlar).
        this.clearTraps();
        this.clearItems();

        // Rakibi devir — KORUMALARI DELER (immune/grace/şarj kontrolü YOK). Kullanandan uzağa.
        if (opp && !opp.isRagdoll) {
            const dx = opp.mesh.position.x - ox, dz = opp.mesh.position.z - oz;
            const len = Math.hypot(dx, dz) || 1;
            this._knock(opp, { x: dx / len, z: dz / len }, ULTIMATE.KNOCK_SCALE,
                { recovery: ULTIMATE.RECOVERY });
        }

        // Kullanana kısa kalkan (anında misilleme olmasın).
        this.grantShield(ownerNum, owner);
        return true;
    }

    /**
     * Ultimate "Enerji Dalgası" (Dragon Ball tarzı): kullanan KİLİTLENİR, önünde
     * enerji topu şarj olur (yönü kamera/aim verir), sonra lazer o yöne ateşler.
     * Lazer koridorundaki RAKİBİ devirir (korumaları DELER) + koridordaki tuzak/
     * mermi/bombayı süpürür. Kanal boyunca kullanan dokunulmazdır (güç toplarken
     * kesilme olmasın). Enerji gate'i çağıranda. Görsel: UltiBeam (ulti_ball.html).
     */
    triggerBeam(ownerNum, players) {
        if (this.beam) return false;                       // zaten kanal açık
        const owner = players && players[ownerNum];
        if (!owner || owner.isRagdoll) return false;
        if (!this._ultiBeam) this._ultiBeam = new UltiBeam(this.scene);

        this.beam = { owner: ownerNum, hit: false };
        this._ultiBeam.play();
        // Kanal boyunca dokunulmazlık (şarjı kimse kesemesin).
        const total = BEAM.CHARGE + BEAM.FIRE + BEAM.FADE;
        this.immune[ownerNum] = Math.max(this.immune[ownerNum] || 0, total);
        if (this.sound && this.sound.playBeamCharge) this.sound.playBeamCharge(BEAM.CHARGE);
        return true;
    }

    /** Bu oyuncu şu an Enerji Dalgası kanalında mı? (main hareket/atış kilidi için) */
    isBeamChanneling(num) {
        return !!this.beam && this.beam.owner === num;
    }

    /** Lazer şu an ATEŞ fazında mı? (main: ekran "güç filtresi" bunu izler) */
    isBeamFiring() {
        return !!this.beam && !!this._ultiBeam && this._ultiBeam.firing;
    }

    _updateBeam(dt, players, beamYaw) {
        if (!this.beam) return;
        const owner = players[this.beam.owner];
        const fx = this._ultiBeam;
        if (!owner || !fx) { this.beam = null; return; }

        // Yön: aim (kamera) — yoksa karakterin baktığı yön. Karakter aim'e DÖNER.
        // (Player konvansiyonu: mesh.rotation.y = atan2(dirX, dirZ) → bakış = (sin ry, cos ry).)
        const yaw = (beamYaw != null) ? beamYaw
            : Math.atan2(Math.cos(owner.mesh.rotation.y), Math.sin(owner.mesh.rotation.y));
        if (!owner.isRagdoll) owner.mesh.rotation.y = Math.atan2(Math.cos(yaw), Math.sin(yaw));

        // Topun merkezi: karakterin önü, göğüs hizası.
        const ox = owner.mesh.position.x + Math.cos(yaw) * BEAM.AHEAD;
        const oz = owner.mesh.position.z + Math.sin(yaw) * BEAM.AHEAD;
        const oy = TABLE.HEIGHT + BEAM.Y_OFF;
        fx.update(dt, ox, oy, oz, yaw);

        // Ateşleme ANI: ışın sesi + sinema (onBeamFire → büyük sarsıntı/punch/mor flaş;
        // bağlanmamışsa genel onExplosion'a düşer).
        if (fx.justFired) {
            if (this.sound && this.sound.playBeamFire) this.sound.playBeamFire();
            if (this.onBeamFire) this.onBeamFire(ox, oz);
            else if (this.onExplosion) this.onExplosion(ox, oz);
        }

        // Ateş boyunca: koridordaki rakip devrilir (bir kez) + item'lar süpürülür.
        if (fx.firing) {
            const vNum = this.beam.owner === 1 ? 2 : 1;
            const victim = players[vNum];
            if (!this.beam.hit && victim && !victim.isRagdoll &&
                this._inCorridor(victim.mesh.position.x, victim.mesh.position.z, ox, oz, fx.dirX, fx.dirZ)) {
                // KORUMALARI DELER (grace/immune/şarj geçersiz — ulti kuralı, şok dalgasıyla aynı).
                this._knock(victim, { x: fx.dirX, z: fx.dirZ }, BEAM.KNOCK_SCALE, { recovery: BEAM.RECOVERY });
                this.beam.hit = true;
            }
            this._sweepCorridor(ox, oz, fx.dirX, fx.dirZ);
        }

        if (fx.done) this.beam = null;
    }

    /** Nokta lazer koridorunda mı? (ileri 0..RANGE, dik uzaklık < WIDTH) */
    _inCorridor(px, pz, ox, oz, dirX, dirZ) {
        const dx = px - ox, dz = pz - oz;
        const along = dx * dirX + dz * dirZ;
        if (along < 0 || along > BEAM.RANGE) return false;
        const perp = Math.abs(dx * dirZ - dz * dirX);
        return perp < BEAM.WIDTH;
    }

    /** Lazer koridorundaki tuzak/mermi/bombayı süpür (yönlü EMP). */
    _sweepCorridor(ox, oz, dirX, dirZ) {
        for (let i = this.traps.length - 1; i >= 0; i--) {
            const t = this.traps[i];
            if (this._inCorridor(t.x, t.z, ox, oz, dirX, dirZ)) {
                this._disposeTrap(t);
                this.traps.splice(i, 1);
            }
        }
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const p = this.projectiles[i];
            if (this._inCorridor(p.x, p.z, ox, oz, dirX, dirZ)) {
                this._disposeProjectile(p);
                this.projectiles.splice(i, 1);
            }
        }
        for (let i = this.bombs.length - 1; i >= 0; i--) {
            const b = this.bombs[i];
            if (this._inCorridor(b.x, b.z, ox, oz, dirX, dirZ)) {
                this._disposeBomb(b);
                this.bombs.splice(i, 1);
            }
        }
    }

    /**
     * Her kare çağrılır (oyun boyunca, HER state'te — yetenekler kendi sistemlerini
     * KESİNTİSİZ sürdürür: atış/top hareketi bunları DONDURMAZ/SİLMEZ).
     *   players      = { 1: Player, 2: Player }
     *   shooterNum   = aktif nişancı (currentPlayer)
     *   shooterCharging = nişancı POWER'da mı (başlanan atış korunur)
     *   saboWindow   = sabotaj penceresi mi (WALKING/POWER) — body-check yalnız burada
     * Yetenek kurbanı = SAHİBİN RAKİBİ (owner'ın karşısındaki oyuncu); böylece tuzak/
     * mermi/bomba tur değişse de doğru kişiyi etkiler. Kurban "savunmasız" = ayakta +
     * dokunulmaz değil + (o an şarj eden nişancı değil). Grace YALNIZ body-check'i kısıtlar
     * (item'lar grace'i geçer → isabet ederler; "düşmanın içinden geçme" bug'ı çözülür).
     */
    update(dt, { players, shooterNum, shooterCharging, saboWindow, beamYaw }) {
        // Item activate'leri (fireProjectile/dropBomb hedefi) = nişancı (= sabotajcının rakibi).
        this._shooterNum = shooterNum;
        this._shooter = shooterNum ? players[shooterNum] : null;

        if (this._bodyCheckCd > 0) this._bodyCheckCd -= dt;
        if (this.graceTimer > 0) this.graceTimer -= dt;
        for (const n of [1, 2]) if (this.immune[n] > 0) this.immune[n] -= dt;

        // --- "Enerji Dalgası" ultimate kanalı (şarj + lazer) — her state'te sürer ---
        this._updateBeam(dt, players, beamYaw);

        // Kurban savunmasız mı? (item'lar için: ayakta + dokunulmaz değil + şarj koruması).
        const vulnerable = (victim, vNum) =>
            victim && !victim.isRagdoll && (this.immune[vNum] || 0) <= 0
            && !(vNum === shooterNum && shooterCharging);

        // --- Çarpma (body-check): yalnız SABOTAJ PENCERESİNDE, sabotajcı DASH'teyken ---
        if (saboWindow && shooterNum) {
            const shooter = players[shooterNum];
            const sabNum = shooterNum === 1 ? 2 : 1;
            const saboteur = players[sabNum];
            const shooterProtected =
                shooterCharging || this.graceTimer > 0 || (this.immune[shooterNum] || 0) > 0;
            const sabSpeed = this._trackSpeed(sabNum, saboteur, dt);
            this._trackSpeed(shooterNum, shooter, dt);
            if (shooter && saboteur && saboteur.isDashing && !shooter.isRagdoll &&
                this._bodyCheckCd <= 0 && !shooterProtected) {
                const dx = shooter.mesh.position.x - saboteur.mesh.position.x;
                const dz = shooter.mesh.position.z - saboteur.mesh.position.z;
                if (Math.hypot(dx, dz) < SABOTAGE.BODYCHECK_RANGE && sabSpeed > SABOTAGE.BODYCHECK_SPEED) {
                    this._knock(shooter, { x: dx, z: dz }, saboteur.dashKnockScale);
                    this._bodyCheckCd = SABOTAGE.BODYCHECK_COOLDOWN;
                }
            }
        }

        // --- Tuzaklar (muz): sahibin rakibi üstünden geçerse AYAĞI KAYAR (her state). ---
        for (let i = this.traps.length - 1; i >= 0; i--) {
            const t = this.traps[i];
            t.life -= dt;
            const vNum = t.owner === 1 ? 2 : 1;
            const victim = players[vNum];
            if (vulnerable(victim, vNum)) {
                const dx = victim.mesh.position.x - t.x;
                const dz = victim.mesh.position.z - t.z;
                if (Math.hypot(dx, dz) < SABOTAGE.TRAP_RADIUS) {
                    this._knock(victim,
                        { x: (Math.random() - 0.5), z: (Math.random() - 0.5) },
                        SABOTAGE.SLIP_SCALE,
                        { vert: SABOTAGE.SLIP_VERT, recovery: SABOTAGE.SLIP_RECOVERY, sfx: 'slip' });
                    if (this.particles) this.particles.createDashPuff(t.x, t.z);
                    this._disposeTrap(t);
                    this.traps.splice(i, 1);
                    continue;
                }
            }
            if (t.life <= 0) { this._disposeTrap(t); this.traps.splice(i, 1); }
        }

        // --- Mermiler (homing ok): ilerle/takip + savunmasız rakibe isabet → devir. ---
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const pr = this.projectiles[i];
            pr.update(dt);
            const vNum = pr.owner === 1 ? 2 : 1;
            const victim = players[vNum];
            let hit = false;
            if (vulnerable(victim, vNum)) {
                const dx = victim.mesh.position.x - pr.x;
                const dz = victim.mesh.position.z - pr.z;
                if (Math.hypot(dx, dz) < PROJECTILE.HIT_RADIUS) {
                    this._knock(victim, { x: pr.dirX, z: pr.dirZ }, PROJECTILE.KNOCK_SCALE);
                    hit = true;
                }
            }
            if (hit || pr.life <= 0 || this._outOfBounds(pr.x, pr.z)) {
                this._disposeProjectile(pr);
                this.projectiles.splice(i, 1);
            }
        }

        // --- Bombalar (yuvarlanan): ilerle + dön; rakibe değince / sınırda / süre sonu patla. ---
        for (let i = this.bombs.length - 1; i >= 0; i--) {
            const b = this.bombs[i];
            b.timer -= dt;
            b.x += b.dx * BOMB.SPEED * dt;
            b.z += b.dz * BOMB.SPEED * dt;
            b.mesh.position.set(b.x, TABLE.HEIGHT + BOMB.SIZE, b.z);
            b.ball.rotateOnWorldAxis(b.axis, (BOMB.SPEED * dt) / BOMB.SIZE); // yuvarlanma

            const vNum = b.owner === 1 ? 2 : 1;
            const victim = players[vNum];
            const isVuln = vulnerable(victim, vNum);
            let boom = b.timer <= 0 || this._outOfBounds(b.x, b.z);
            if (!boom && isVuln) {
                const dx = victim.mesh.position.x - b.x;
                const dz = victim.mesh.position.z - b.z;
                if (Math.hypot(dx, dz) < BOMB.CONTACT) boom = true;  // direkt isabet → erken patla
            }
            if (boom) {
                this._detonateBomb(b, victim, isVuln);
                this._disposeBomb(b);
                this.bombs.splice(i, 1);
            }
        }

        // --- Kalkanlar: kabuğu sahibini izlet + nabız + süre sonu söndür ---
        for (let i = this.shields.length - 1; i >= 0; i--) {
            const s = this.shields[i];
            s.life -= dt;
            if (s.player) {
                s.mesh.position.set(
                    s.player.mesh.position.x,
                    TABLE.HEIGHT + s.player.fullHeight / 2,
                    s.player.mesh.position.z
                );
            }
            s.mesh.scale.setScalar(1 + Math.sin(s.life * 8) * 0.04);
            s.mesh.material.opacity = 0.10 + 0.14 * Math.max(0, s.life / SHIELD.DURATION);
            if (s.life <= 0) {
                if (this.sound && this.sound.playShieldDown) this.sound.playShieldDown();
                this._disposeShield(s);
                this.shields.splice(i, 1);
            }
        }

        // --- Devrilenleri zamanı gelince ayağa kaldır + kalkış dokunulmazlığı ver ---
        for (let i = this.recovering.length - 1; i >= 0; i--) {
            const r = this.recovering[i];
            r.timer -= dt;
            if (r.timer <= 0) {
                if (r.player && r.player.isRagdoll) r.player.reset();
                this.immune[r.num] = SABOTAGE.KNOCK_IMMUNITY;   // kalkar kalkmaz tekrar devrilme
                this.recovering.splice(i, 1);
            }
        }
    }

    // ---- iç yardımcılar ----

    /**
     * Kurbanı devir + yerde kalma süresini kaydet. opts.vert = dikey itme çarpanı
     * (muz slip'i ≈0), opts.recovery = yerde kalma süresi (yoksa varsayılan),
     * opts.sfx = 'slip' → muz kayma sesi (varsayılan: darbe + yere düşüş).
     */
    _knock(victim, awayDir, scale, opts = {}) {
        const vert = opts.vert != null ? opts.vert : 1;
        const recovery = opts.recovery != null ? opts.recovery : SABOTAGE.RAGDOLL_RECOVERY;
        victim.makeRagdoll(scale != null ? scale : SABOTAGE.RAGDOLL_SCALE, awayDir, vert);
        if (this.sound) {
            if (opts.sfx === 'slip' && this.sound.playSlip) this.sound.playSlip();
            else if (this.sound.playKnock) this.sound.playKnock();
            else if (this.sound.playClack) this.sound.playClack(0.8);
        }
        // Çarpışma tozu (Faz 9): devrilen oyuncunun ayağının dibinde toprak rengi puf.
        if (this.particles && victim.mesh) {
            this.particles.createDust(victim.mesh.position.x, victim.mesh.position.z);
        }
        // Zaten kurtarma listesinde değilse ekle (num = oyuncu no, dokunulmazlık için).
        if (!this.recovering.some((r) => r.player === victim)) {
            this.recovering.push({ player: victim, num: victim.owner, timer: recovery });
        }
        // Kurbanın no'sunu geçir (main: insan→kırmızı "sabote edildin" / bot→yeşil "devirdin").
        if (this.onShooterKnocked) this.onShooterKnocked(victim.owner);
    }

    _trackSpeed(num, player, dt) {
        if (!player || dt <= 0) return 0;
        const p = player.mesh.position;
        const last = this._lastPos[num];
        let speed = 0;
        if (last) speed = Math.hypot(p.x - last.x, p.z - last.z) / dt;
        this._lastPos[num] = { x: p.x, z: p.z };
        return speed;
    }

    _disposeTrap(t) {
        if (!t || !t.mesh) return;
        this.scene.remove(t.mesh);
        t.mesh.traverse((o) => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) o.material.dispose();
        });
    }

    /** Mermi oyun alanını aştı mı? (sınırı geçince söndür). */
    _outOfBounds(x, z) {
        return Math.abs(x) > TABLE.LENGTH / 2 || Math.abs(z) > TABLE.WIDTH / 2;
    }

    /** Bomba patlat: BÜYÜK patlama VFX + ses + kamera geri bildirimi + yarıçaptaki
     *  savunmasız rakibi sert devir (yerde biraz daha uzun kalır). isVuln = patlama anında
     *  kurban savunmasız mıydı (dokunulmaz/şarj değil). */
    _detonateBomb(b, victim, isVuln) {
        if (this.particles) {
            try { this.particles.createExplosion({ x: b.x, y: TABLE.HEIGHT + 0.02, z: b.z }, BOMB.FLASH); }
            catch (_) { /* yok say */ }
        }
        if (this.sound && this.sound.playExplosion) this.sound.playExplosion();
        if (this.onExplosion) this.onExplosion(b.x, b.z);   // kamera sarsıntısı/glow (main)
        if (isVuln && victim) {
            const dx = victim.mesh.position.x - b.x;
            const dz = victim.mesh.position.z - b.z;
            const d = Math.hypot(dx, dz);
            if (d < BOMB.RADIUS) {
                const len = d || 1;
                this._knock(victim, { x: dx / len, z: dz / len }, BOMB.KNOCK_SCALE, { recovery: 1.3 });
            }
        }
    }

    _disposeBomb(b) {
        if (!b) return;
        if (b.sfx) { b.sfx.stop(0.15); b.sfx = null; }
        if (!b.mesh) return;
        this.scene.remove(b.mesh);
        b.mesh.traverse((o) => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) o.material.dispose();
        });
    }

    _disposeShield(s) {
        if (!s || !s.mesh) return;
        this.scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        s.mesh.material.dispose();
    }
}
