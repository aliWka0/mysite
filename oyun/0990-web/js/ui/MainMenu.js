// ============================================
// MainMenu — Rocket League–style main menu controller
// ============================================
// Owns the #main-menu HTML overlay shown over the live 3D scene (the table +
// idle character act as the backdrop while the camera slowly orbits). The menu
// is left-anchored: a vertical nav with skewed highlight bars, a detail panel
// that swaps per item, and corner widgets (profile bottom-left, tip bottom-right).
//
// Wiring lives in main.js:
//   menu.onPlay(startGame)  → fired when the player picks a PLAY sub-option
//   menu.show() / menu.hide()
// ============================================
import { IS_TOUCH } from '../constants.js';
import { FINISHER_DEFS } from '../scene/FinisherDefs.js';
import { FinisherPreview } from './FinisherPreview.js';

const TIPS = [
    'Beyaz topa yaklaş ve nişan al — yakınken nişan çizgisi belirir.',
    '8 numaralı topu en SONA sakla; erken sokarsan kaybedersin.',
    'Bandlardan sektirerek zor toplara açı bulabilirsin.',
    'Beyaz topu deliğe düşürmek faul — rakibe "ball in hand" verir.',
    'Topa merkez dışı vurarak dönüş (effe) kazandırabilirsin.',
];

export class MainMenu {
    constructor({ sound, settings, progression } = {}) {
        this.root = document.getElementById('main-menu');
        this.nav = document.getElementById('mm-nav');
        this.items = Array.from(this.nav.querySelectorAll('.mm-item'));
        // LAN-stili kart sayfaları (2026-07-03): nav → ortada tam sayfa açılır.
        this.pages = Array.from(this.root.querySelectorAll('.mm-page'));
        this.sound = sound || null;
        this.settings = settings || null;
        this.progression = progression || null;   // Faz 15: profil köşesi (LVL + coin)

        this._onPlay = null;
        this._onLan = null;
        this._current = 'play';    // klavye imleci (nav vurgusu)
        this._page = null;         // açık sayfa anahtarı (null = yalnız nav)
        this._tipTimer = null;
        this._finPreview = null;   // lazy FinisherPreview (GL context on first open)
        this._previewId = null;    // variant shown in the preview pane

        this._fillHowTo();
        this._fillFinishers();
        this._wire();
        this._wireOptions();
        this._syncOptions();
    }

    /** Register the callback fired when the player starts a game. */
    onPlay(cb) { this._onPlay = cb; }

    /** Register the callback fired when the player picks "İki Cihaz (LAN)". */
    onLan(cb) { this._onLan = cb; }

    show() {
        this.root.classList.remove('hidden');
        document.body.classList.add('menu-active');
        // Kozmik menü ambiyansı — jest/buffer hazır olunca kendiliğinden başlar (idempotent).
        if (this.sound && this.sound.startAmbience) this.sound.startAmbience();
        this._closePage();          // menü nav ile açılır; sayfa tıklayınca gelir
        this._highlight('play');
        this._syncOptions();
        this._syncProfile();
        this._startTips();
    }

    /** Faz 15: profil köşesi — seviye + coin (Progression'dan; her menü açılışında tazelenir). */
    _syncProfile() {
        if (!this.progression) return;
        const lvl = document.getElementById('mm-plvl');
        const coins = document.getElementById('mm-coins');
        if (lvl) lvl.textContent = 'LVL ' + this.progression.level;
        if (coins) coins.textContent = '🪙 ' + this.progression.coins;
    }

    hide() {
        this.root.classList.add('hidden');
        document.body.classList.remove('menu-active');
        if (this.sound && this.sound.stopAmbience) this.sound.stopAmbience();
        this._stopTips();
        this._closePage();
    }

    // ---- Content ----

    _fillHowTo() {
        const list = document.getElementById('mm-howto-list');
        if (!list) return;
        const rows = IS_TOUCH
            ? [
                ['Joystick', 'Sol alttaki joystick ile karakteri yürüt'],
                ['Sürükle', 'Ekranı sürükleyerek etrafa bak / nişan al'],
                ['ATEŞ', 'Beyaz topa yaklaş, ATEŞ\'e basılı tut, bırak'],
                ['+ / −', 'Sağdaki butonlarla yakınlaş / uzaklaş'],
              ]
            : [
                ['W A S D', 'Karakteri yürüt'],
                ['Fare', 'Etrafa bak ve nişan al'],
                ['Sol tık', 'Topa bakarken basılı tut → güç, bırak → vuruş'],
                ['Scroll', 'Yakınlaş / uzaklaş'],
              ];
        list.innerHTML = rows
            .map(([k, v]) => `<li><span class="mm-key">${k}</span><span class="mm-howto-d">${v}</span></li>`)
            .join('');
    }

    /**
     * Faz 14: Finishers sayfası — sol liste + canlı 3D önizleme (FinisherPreview).
     * Karta dokunmak yalnız ÖNİZLER; kayıt "SEÇ" butonuyla Settings('finisher')'a yazılır.
     */
    _fillFinishers() {
        const list = document.getElementById('mm-finisher-list');
        if (!list) return;
        list.innerHTML = Object.entries(FINISHER_DEFS)
            .map(([id, d]) => `
                <button class="mm-fin" data-fin="${id}">
                    <span class="mm-fin-ico">${d.icon}</span>
                    <span class="mm-fin-name">${d.name}</span>
                    <span class="mm-fin-tag">✓</span>
                </button>`)
            .join('');
        list.querySelectorAll('.mm-fin').forEach(btn => {
            btn.addEventListener('click', () => {
                this._previewFin(btn.dataset.fin);
                if (this.sound) this.sound.playUI('move');
            });
        });

        const sel = document.getElementById('mm-fin-select');
        if (sel) sel.addEventListener('click', () => {
            if (!this._previewId || sel.classList.contains('is-current')) return;
            if (this.settings) this.settings.set('finisher', this._previewId);
            this._syncFinishers();
            if (this.sound) this.sound.playUI('confirm');
        });

        this._syncFinishers();
    }

    /** Show a variant in the preview pane (stage + title + desc + button state). */
    _previewFin(id) {
        const d = FINISHER_DEFS[id];
        if (!d) return;
        this._previewId = id;
        document.querySelectorAll('#mm-finisher-list .mm-fin')
            .forEach(b => b.classList.toggle('is-previewing', b.dataset.fin === id));

        const title = document.getElementById('mm-fin-pv-title');
        if (title) {
            title.textContent = d.title;
            title.style.backgroundImage = d.textGrad;   // variant's own gradient identity
        }
        const desc = document.getElementById('mm-fin-pv-desc');
        if (desc) desc.textContent = d.desc;

        if (this._finPreview) this._finPreview.setVariant(id);
        this._syncFinishers();
    }

    /** Reflect the SAVED selection into card badges + the select button. */
    _syncFinishers() {
        const cur = this.settings ? this.settings.get('finisher') : 'blackhole';
        document.querySelectorAll('#mm-finisher-list .mm-fin')
            .forEach(b => b.classList.toggle('is-selected', b.dataset.fin === cur));
        const sel = document.getElementById('mm-fin-select');
        if (sel) {
            const isCur = this._previewId === cur;
            sel.classList.toggle('is-current', isCur);
            sel.textContent = isCur ? '✓ SEÇİLİ' : 'SEÇ';
        }
    }

    /** Panel opened: lazily create the GL preview stage and start its loop. */
    _openFinPreview() {
        const canvas = document.getElementById('mm-fin-canvas');
        if (!canvas) return;
        if (!this._finPreview) this._finPreview = new FinisherPreview(canvas, this.sound);
        const id = this._previewId || (this.settings ? this.settings.get('finisher') : 'blackhole');
        this._previewFin(id);
        this._finPreview.start(id);
    }

    _closeFinPreview() {
        if (this._finPreview) this._finPreview.stop();
    }

    _startTips() {
        const el = document.getElementById('mm-tip-text');
        if (!el) return;
        let i = Math.floor(Math.random() * TIPS.length);
        el.textContent = TIPS[i];
        this._stopTips();
        this._tipTimer = setInterval(() => {
            i = (i + 1) % TIPS.length;
            el.style.opacity = '0';
            setTimeout(() => { el.textContent = TIPS[i]; el.style.opacity = '1'; }, 250);
        }, 5500);
    }

    _stopTips() {
        if (this._tipTimer) { clearInterval(this._tipTimer); this._tipTimer = null; }
    }

    // ---- Interaction ----

    _wire() {
        // Top-level nav items → LAN-stili sayfa aç
        this.items.forEach(it => {
            it.addEventListener('click', () => {
                if (it.dataset.locked) { this._denied(it); return; }
                if (this.sound) this.sound.playUI('move');
                this._select(it.dataset.menu);
            });
            // Hover blip (desktop) — mouseenter fires once per entry, so no spam.
            it.addEventListener('mouseenter', () => {
                if (!it.dataset.locked && this.sound) this.sound.playUI('move');
            });
        });

        // Sayfa "‹ Geri" butonları → sayfayı kapat, nav'a dön
        this.root.querySelectorAll('[data-back]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (this.sound) this.sound.playUI('move');
                this._closePage();
            });
        });

        // Sayfa aksiyonları (PLAY mod kartları, EXIT onayı)
        this.root.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.dataset.locked) { this._denied(btn); return; }
                const action = btn.dataset.action;
                if (action === 'local2p' || action === 'practice' || action === 'vsbot') {
                    if (this.sound) this.sound.playUI('confirm');
                    if (this._onPlay) this._onPlay(action);
                } else if (action === 'lan') {
                    if (this.sound) this.sound.playUI('confirm');
                    if (this._onLan) this._onLan();
                } else if (action === 'exit') {
                    this._exit();
                }
            });
        });

        // Keyboard navigation (desktop): oklar nav imleci, Enter sayfa açar, Esc kapatır
        window.addEventListener('keydown', (e) => {
            if (this.root.classList.contains('hidden')) return;
            if (e.key === 'Escape' && this._page) { e.preventDefault(); this._closePage(); return; }
            if (this._page) return;   // sayfa açıkken ok/Enter nav'ı sürmesin
            const sel = this.items.filter(i => !i.dataset.locked);
            const idx = sel.findIndex(i => i.dataset.menu === this._current);
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this._highlight(sel[(idx + 1) % sel.length].dataset.menu);
                if (this.sound) this.sound.playUI('move');
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this._highlight(sel[(idx - 1 + sel.length) % sel.length].dataset.menu);
                if (this.sound) this.sound.playUI('move');
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (this.sound) this.sound.playUI('confirm');
                this._select(this._current);
            }
        });
    }

    // ---- Options (sound / sensitivity / invert-Y / quality) ----

    _wireOptions() {
        const s = this.settings;

        const soundBtn = document.getElementById('mm-sound-toggle');
        if (soundBtn) soundBtn.addEventListener('click', () => {
            const on = !(s ? s.get('sound') : (this.sound ? this.sound.enabled : true));
            if (s) s.set('sound', on); else if (this.sound) this.sound.enabled = on;
            if (on && this.sound) this.sound.ensure();
            this._syncOptions();
            if (on && this.sound) this.sound.playUI('confirm');
        });

        const sens = document.getElementById('mm-sens');
        if (sens) sens.addEventListener('input', () => {
            const v = parseFloat(sens.value);
            if (s) s.set('sensitivity', v);
            const label = document.getElementById('mm-sens-val');
            if (label) label.textContent = v.toFixed(1) + '×';
        });

        const inv = document.getElementById('mm-invert-toggle');
        if (inv) inv.addEventListener('click', () => {
            const on = !(s ? s.get('invertY') : false);
            if (s) s.set('invertY', on);
            this._syncOptions();
            if (this.sound) this.sound.playUI('move');
        });

        const q = document.getElementById('mm-quality-toggle');
        if (q) q.addEventListener('click', () => {
            const next = (s ? s.get('quality') : 'high') === 'high' ? 'low' : 'high';
            if (s) s.set('quality', next);
            this._syncOptions();
            if (this.sound) this.sound.playUI('move');
        });

        const fps = document.getElementById('mm-fps-toggle');
        if (fps) fps.addEventListener('click', () => {
            const on = !(s ? s.get('fps') : false);
            if (s) s.set('fps', on);
            this._syncOptions();
            if (this.sound) this.sound.playUI('move');
        });
    }

    /** Reflect current setting values into the Options controls. */
    _syncOptions() {
        const s = this.settings;
        const setToggle = (btnId, stateId, on, onText, offText) => {
            const btn = document.getElementById(btnId);
            const st = document.getElementById(stateId);
            if (st) st.textContent = on ? onText : offText;
            if (btn) { btn.setAttribute('aria-pressed', String(on)); btn.classList.toggle('is-off', !on); }
        };

        const soundOn = s ? s.get('sound') : (this.sound ? this.sound.enabled : true);
        setToggle('mm-sound-toggle', 'mm-sound-state', soundOn, 'AÇIK', 'KAPALI');

        const inv = s ? s.get('invertY') : false;
        setToggle('mm-invert-toggle', 'mm-invert-state', inv, 'AÇIK', 'KAPALI');

        const high = (s ? s.get('quality') : 'high') === 'high';
        setToggle('mm-quality-toggle', 'mm-quality-state', high, 'YÜKSEK', 'DÜŞÜK');

        const fpsOn = s ? !!s.get('fps') : false;
        setToggle('mm-fps-toggle', 'mm-fps-state', fpsOn, 'AÇIK', 'KAPALI');

        const sensVal = s ? s.get('sensitivity') : 1.0;
        const sensInput = document.getElementById('mm-sens');
        const sensLabel = document.getElementById('mm-sens-val');
        if (sensInput) sensInput.value = String(sensVal);
        if (sensLabel) sensLabel.textContent = Number(sensVal).toFixed(1) + '×';
    }

    /** Nav vurgusu (klavye imleci / açık sayfanın sahibi). */
    _highlight(key) {
        this._current = key;
        this.items.forEach(i => i.classList.toggle('is-active', i.dataset.menu === key && !i.dataset.locked));
    }

    /** Nav seçimi → ilgili LAN-stili sayfayı aç (sayfası yoksa yalnız vurgular). */
    _select(key) {
        this._highlight(key);
        this._closePage();
        const page = document.getElementById('mm-page-' + key);
        if (!page) return;           // (garage kilitli — sayfası yok)
        page.classList.remove('hidden');
        this._page = key;
        // Finishers: canlı 3D önizleme yalnız sayfa açıkken döner (lazy GL context).
        if (key === 'finishers') this._openFinPreview();
    }

    /** Açık sayfayı kapat (geri butonu / Esc / menü gizlenince). */
    _closePage() {
        if (this._page === 'finishers') this._closeFinPreview();
        this.pages.forEach(p => p.classList.add('hidden'));
        this._page = null;
    }

    _denied(el) {
        el.classList.remove('mm-shake');
        void el.offsetWidth; // force reflow so the animation restarts
        el.classList.add('mm-shake');
        if (this.sound) this.sound.playUI('move');
    }

    _exit() {
        // Capacitor APK WebView / script-opened windows can close; a normal
        // browser tab cannot be force-closed, so this is a best-effort no-op there.
        try { window.close(); } catch (_) { /* ignore */ }
    }
}
