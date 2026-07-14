// ============================================
// ItemSystem — Veri-güdümlü eşya/yetenek çatısı (Faz 1 omurga)
// ============================================
// Parti döngüsünün belkemiği. Tüm güçler (muz, dash, kalkan, mermi, ultimate…)
// tek bir tanım tablosundan (ITEM_DEFS) gelir; yeni item = veri + küçük `activate`.
// Her oyuncunun TEK slotu vardır (şimdilik). Adalet artık "elinde item var mı" +
// cooldown ile sağlanır (eski sürekli-enerji yerine). Kutular Faz 2'de slotu doldurur.
//
// activate(ctx) sözleşmesi: ctx = { ownerNum, x, z, sabotage, sound, scene, players }.
//   - true dönerse item TÜKETİLİR (slot boşalır) + cooldown başlar.
//   - false dönerse (ör. tuzak max'a ulaşmış) slot KORUNUR, tekrar denenebilir.
//
// `role` (kim kullanır): 'saboteur' = saldırı (sabotajcı, nişancıya karşı) ·
//   'shooter' = savunma (nişancı kendini korur) · 'any' = serbest. main.js aktif
//   role ile eşleştirir (useItemAt'e role verir); HUD/touch buton buna göre gösterilir.
//
// `aiMode` (Faz 5, yalnız SALDIRI item'larında): botun item'i nasıl kullanacağını söyler —
//   'melee'=yaklaş+çarp (dash/turbo) · 'trap'=yoluna bırak (muz) · 'ranged'=uzaktan fırlat
//   (yay/bomba). Kalkanda aiMode YOK → bot onu sabotaj turunda harcamaz, kendi sırasına saklar.
//   Ayarlar constants.js BOT.ITEM_AI[mode].

import { MOVEMENT } from '../constants.js';

export const ITEM_TYPES = {
    TRAP: 'trap',
    MOVEMENT: 'movement',
    PROJECTILE: 'projectile',
    DEFENSE: 'defense',
    ULTIMATE: 'ultimate',
};

// --- Eşya tanımları ---
export const ITEM_DEFS = {
    banana: {
        id: 'banana',
        name: 'Muz',
        icon: '🍌',
        type: ITEM_TYPES.TRAP,
        role: 'saboteur',
        aiMode: 'trap',
        cooldown: 1.0,   // s — kullandıktan sonra yeni item kullanma gecikmesi
        activate(ctx) {
            // Sahibin ayağının dibine muz bırak (mekanik SabotageManager'da).
            return ctx.sabotage.dropTrap(ctx.ownerNum, ctx.x, ctx.z);
        },
    },

    // --- Hareket item'ları (Faz 3): hız patlaması + çarparsa devir (katmanlı) ---
    rocket: {
        id: 'rocket',
        name: 'Roket Ayakkabı',
        icon: '👟',
        type: ITEM_TYPES.MOVEMENT,
        role: 'saboteur',
        aiMode: 'melee',
        cooldown: 0.4,
        activate(ctx) {
            const p = ctx.players && ctx.players[ctx.ownerNum];
            if (!p) return false;
            p.dash(MOVEMENT.ROCKET);
            if (ctx.sound && ctx.sound.playWhoosh) ctx.sound.playWhoosh(0.7);   // Faz 9 dash whoosh
            return true;
        },
    },
    turbo: {
        id: 'turbo',
        name: 'Turbo',
        icon: '⚡',
        type: ITEM_TYPES.MOVEMENT,
        role: 'saboteur',
        aiMode: 'melee',
        cooldown: 0.4,
        activate(ctx) {
            const p = ctx.players && ctx.players[ctx.ownerNum];
            if (!p) return false;
            p.dash(MOVEMENT.TURBO);
            if (ctx.sound && ctx.sound.playWhoosh) ctx.sound.playWhoosh(0.85);   // Faz 9 dash whoosh
            return true;
        },
    },

    // --- Saldırı/savunma item'ları (Faz 4) ---
    // Menzilli mermi: sabotajcı nişancıya doğru fırlatır; isabette nazikçe devirir.
    bow: {
        id: 'bow',
        name: 'Roket Mermi',
        icon: '🏹',
        type: ITEM_TYPES.PROJECTILE,
        role: 'saboteur',
        aiMode: 'ranged',
        cooldown: 1.2,
        activate(ctx) {
            // Hedef (nişancı) SabotageManager'da saklı; ona doğru fırlatılır.
            return ctx.sabotage.fireProjectile(ctx.ownerNum, ctx.x, ctx.z);
        },
    },
    // Bomba: baktığın yöne bowling gibi yuvarla; 4 sn ilerler, BÜYÜK yarıçapta patlar.
    bomb: {
        id: 'bomb',
        name: 'Bomba',
        icon: '💣',
        type: ITEM_TYPES.PROJECTILE,
        role: 'saboteur',
        aiMode: 'ranged',
        cooldown: 1.2,
        activate(ctx) {
            // ctx.aimDir = yuvarlanma yönü (main: insan→kamera yönü, bot→nişancıya).
            return ctx.sabotage.dropBomb(ctx.ownerNum, ctx.x, ctx.z, ctx.aimDir);
        },
    },
    // Kalkan: nişancı savunması. Kısa dokunulmazlık + görsel kabuk.
    shield: {
        id: 'shield',
        name: 'Kalkan',
        icon: '🛡️',
        type: ITEM_TYPES.DEFENSE,
        role: 'shooter',
        cooldown: 0.5,
        activate(ctx) {
            const p = ctx.players && ctx.players[ctx.ownerNum];
            if (!p) return false;
            return ctx.sabotage.grantShield(ctx.ownerNum, p);
        },
    },
    // --- Ultimate (Faz 7) ---
    // Kutudan DÜŞMEZ (ITEM_DROP_TABLE'da yok) — kombo enerjisi (ComboSystem) dolunca
    // ayrı yoldan (useUltimate) tetiklenir. role 'any': nişancı/sabotajcı fark etmez.
    // Jenerik "Şok Dalgası"; ileride karaktere özel ultimate'lar setUltimate ile bağlanır.
    ultimate_shockwave: {
        id: 'ultimate_shockwave',
        name: 'Şok Dalgası',
        icon: '🌀',
        type: ITEM_TYPES.ULTIMATE,
        role: 'any',
        activate(ctx) {
            return ctx.sabotage.triggerShockwave(ctx.ownerNum, ctx.players);
        },
    },
    // "Enerji Dalgası" — Dragon Ball tarzı şarj + lazer (görsel ref: _assets_src/ulti_ball.html).
    // channel:true → kanal boyunca kullanan KİLİTLİDİR (hareket yok, aim ile yön verir);
    // bu yüzden yalnız WALKING'de tetiklenir (POWER'da cue şarjıyla çakışırdı — main doğrular).
    // İnsan P1'in varsayılan ultisi (main.js setUltimate); bot şok dalgasında kalır.
    ultimate_beam: {
        id: 'ultimate_beam',
        name: 'Enerji Dalgası',
        icon: '🔥',
        type: ITEM_TYPES.ULTIMATE,
        role: 'any',
        channel: true,
        activate(ctx) {
            return ctx.sabotage.triggerBeam(ctx.ownerNum, ctx.players);
        },
    },
};

// Varsayılan jenerik ultimate (skin/karakter sistemi gelince oyuncuya özel atanır).
export const DEFAULT_ULTIMATE = 'ultimate_shockwave';

export class ItemSystem {
    constructor({ sabotage, sound, scene, players } = {}) {
        this.sabotage = sabotage || null;
        this.sound = sound || null;
        this.scene = scene || null;
        this.players = players || null;

        this.slots = { 1: null, 2: null };     // oyuncu no → itemId | null
        this.cooldown = { 1: 0, 2: 0 };         // oyuncu no → kalan cooldown (s)
        // Ultimate (Faz 7): oyuncu başına ult id (skin sistemiyle bağlanacak; şimdilik jenerik).
        this.ultimates = { 1: DEFAULT_ULTIMATE, 2: DEFAULT_ULTIMATE };
    }

    /** Oyuncunun ultimate tanımı (karaktere/skin'e göre; şimdilik jenerik). */
    ultimateFor(num) {
        return ITEM_DEFS[this.ultimates[num]] || null;
    }

    /** Skin/karakter sistemi: oyuncuya özel ultimate ata (id ITEM_DEFS'te olmalı). */
    setUltimate(num, id) {
        if (ITEM_DEFS[id]) this.ultimates[num] = id;
    }

    /**
     * Ultimate'i kullan (slot/cooldown YOK — enerji gate'i ComboSystem'de, çağıran kontrol
     * eder). activate(ctx) etkiyi uygular; başarılıysa true (çağıran enerjiyi harcar).
     */
    useUltimate(num, extra = {}) {
        const def = this.ultimateFor(num);
        if (!def) return false;
        return def.activate({
            ownerNum: num,
            sabotage: this.sabotage,
            sound: this.sound,
            scene: this.scene,
            players: this.players,
            ...extra,
        });
    }

    /** Cooldown sayaçlarını ilerlet (her kare). */
    update(dt) {
        if (this.cooldown[1] > 0) this.cooldown[1] -= dt;
        if (this.cooldown[2] > 0) this.cooldown[2] -= dt;
    }

    /** Slot boşsa item ver (kutudan toplama). Doluysa reddet (tek slot). */
    pickup(num, itemId) {
        if (this.slots[num]) return false;
        if (!ITEM_DEFS[itemId]) return false;
        this.slots[num] = itemId;
        return true;
    }

    /** Oyuncunun slotundaki item tanımı (veya null). */
    getItem(num) {
        const id = this.slots[num];
        return id ? ITEM_DEFS[id] : null;
    }

    hasItem(num) {
        return !!this.slots[num];
    }

    /** Şu an kullanılabilir mi? (slot dolu + cooldown bitmiş) */
    canUse(num) {
        return !!this.slots[num] && this.cooldown[num] <= 0;
    }

    /** Cooldown ilerleme oranı (0=hazır .. 1=yeni başladı) — UI için. */
    cooldownFrac(num) {
        const id = this.slots[num];
        const def = id ? ITEM_DEFS[id] : null;
        const cd = def ? def.cooldown : 1;
        return cd > 0 ? Math.max(0, Math.min(1, this.cooldown[num] / cd)) : 0;
    }

    /**
     * Slottaki item'i kullan. extra = aktivasyon bağlamı (konum vb. main verir).
     * Başarılıysa slotu tüketir + cooldown başlatır.
     */
    useItem(num, extra = {}) {
        if (!this.canUse(num)) return false;
        const def = ITEM_DEFS[this.slots[num]];
        const ok = def.activate({
            ownerNum: num,
            sabotage: this.sabotage,
            sound: this.sound,
            scene: this.scene,
            players: this.players,
            ...extra,
        });
        if (ok) {
            this.slots[num] = null;
            this.cooldown[num] = def.cooldown;
        }
        return ok;
    }

    /** Maç/restart başında temizle. */
    reset() {
        this.slots = { 1: null, 2: null };
        this.cooldown = { 1: 0, 2: 0 };
    }
}
