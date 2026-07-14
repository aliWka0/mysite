// ============================================
// Settings — persistent player preferences
// ============================================
// Small store for player-tunable options (sound, look sensitivity, invert-Y,
// graphics quality). Persists to localStorage (works in the Capacitor WebView
// too) and applies each value live to the relevant system via bind().
//
//   const settings = new Settings();
//   settings.bind({ camera, scene, sound });   // applies all current values
//   settings.set('sensitivity', 1.4);          // persists + applies live
// ============================================
import { IS_TOUCH } from '../constants.js';

const KEY = 'pool3d.settings.v1';

const DEFAULTS = {
    sound: true,
    sensitivity: 1.0,                 // multiplier on CAMERA.ROTATE_SPEED
    invertY: false,
    quality: IS_TOUCH ? 'low' : 'high',
    finisher: 'blackhole',            // FINISHER_DEFS id — kazanma sineması çeşidi (Faz 14)
    fps: false,                       // FPS göstergesi (perf teşhisi — Options'tan açılır)
};

export class Settings {
    constructor() {
        this.values = { ...DEFAULTS, ...this._load() };
        this._targets = {};
    }

    _load() {
        try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
        catch (_) { return {}; }
    }

    _save() {
        try { localStorage.setItem(KEY, JSON.stringify(this.values)); }
        catch (_) { /* private mode / storage disabled — keep in-memory only */ }
    }

    /** Wire the systems each setting drives, then apply all current values. */
    bind(targets) {
        this._targets = targets || {};
        this.applyAll();
    }

    get(key) { return this.values[key]; }

    /** Update a setting: persist it and apply it live. */
    set(key, value) {
        this.values[key] = value;
        this._save();
        this.apply(key);
    }

    apply(key) {
        const { camera, scene, sound, players } = this._targets;
        switch (key) {
            case 'sensitivity': if (camera) camera.sensitivity = this.values.sensitivity; break;
            case 'invertY':     if (camera) camera.invertY = this.values.invertY; break;
            case 'quality': {
                const q = this.values.quality;
                if (scene && scene.setQuality) scene.setQuality(q);
                // Karakter dinamik gölgesi low'da kapalı (temas gölgesi blob'u yeter) —
                // 86k üçgenlik skinned mesh gölge pass'inden çıkar (mobil perf).
                if (players) {
                    for (const k of [1, 2]) {
                        if (players[k] && players[k].setCastShadow) players[k].setCastShadow(q !== 'low');
                    }
                }
                break;
            }
            case 'sound':       if (sound) sound.enabled = this.values.sound; break;
            case 'fps': {
                const { ui } = this._targets;
                if (ui && ui.setFpsVisible) ui.setFpsVisible(this.values.fps);
                break;
            }
        }
    }

    applyAll() {
        ['sensitivity', 'invertY', 'quality', 'sound', 'fps'].forEach(k => this.apply(k));
    }
}
