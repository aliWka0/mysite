// ============================================
// UIManager — HUD, Notifications, Overlays
// ============================================
import { BALL_DATA, BALL_TYPES } from '../constants.js';

export class UIManager {
    constructor() {
        // SoundManager referansı (main.js init'te atar) — UI olay sesleri
        // (ulti-hazır / kombo pop / foul-danger / ödül paneli) buradan çalınır.
        this.sound = null;

        // Cache DOM elements
        this.loadingScreen = document.getElementById('loading-screen');
        this.loadingFill = this.loadingScreen?.querySelector('.loading-fill');
        this.loadingText = this.loadingScreen?.querySelector('.loading-text');
        this.hudTop = document.getElementById('hud-top');
        this.turnText = document.getElementById('turn-text');

        this.player1Panel = document.getElementById('player1-panel');
        this.player2Panel = document.getElementById('player2-panel');
        this.p1Balls = document.getElementById('p1-balls');
        this.p2Balls = document.getElementById('p2-balls');
        this.p1Type = document.getElementById('p1-type');
        this.p2Type = document.getElementById('p2-type');

        this.eventTint = document.getElementById('event-tint');   // Faz 13 mini-olay ekran tinti

        this.notification = document.getElementById('notification');
        this.notifIcon = document.getElementById('notification-icon');
        this.notifText = document.getElementById('notification-text');
        this.notifSubtext = document.getElementById('notification-subtext');
        this.screenFlash = document.getElementById('screen-flash');

        this.powerBarContainer = document.getElementById('power-bar-container');

        this.itemSlot = document.getElementById('item-slot');
        this.itemSlotIcon = this.itemSlot?.querySelector('.item-slot-icon');
        this.itemSlotCd = this.itemSlot?.querySelector('.item-slot-cd');

        // Ultimate enerji barı + kombo pop (Faz 6)
        this.ultiHud = document.getElementById('ultimate-hud');
        this.ultiFill = document.getElementById('ulti-fill');
        this.ultiLabel = document.getElementById('ulti-label');
        this.comboPop = document.getElementById('combo-pop');
        this._ultiReady = false;

        this.controlsHelp = document.getElementById('controls-help');
        this.shootBtn = document.getElementById('shoot-btn');

        this.gameOverScreen = document.getElementById('game-over-screen');
        this.winnerText = document.getElementById('winner-text');
        this.winReason = document.getElementById('win-reason');
        this.restartBtn = document.getElementById('restart-btn');

        this._notifTimeout = null;

        // FPS göstergesi (Options'tan açılır; perf teşhisi için — cihazda doğrulama).
        // Elemanı dinamik yaratır → index.html'e dokunmaz.
        this._fpsEl = null;
        this._fpsOn = false;
        this._fpsFrames = 0;
        this._fpsAccum = 0;
    }

    // ---- FPS göstergesi ----

    /** FPS overlay'ini aç/kapat (Settings 'fps' anahtarı sürer). */
    setFpsVisible(on) {
        this._fpsOn = !!on;
        if (this._fpsOn && !this._fpsEl) {
            const el = document.createElement('div');
            el.id = 'fps-meter';
            document.body.appendChild(el);
            this._fpsEl = el;
        }
        if (this._fpsEl) this._fpsEl.style.display = this._fpsOn ? 'block' : 'none';
        // Ölçümü sıfırla — kapalı kaldığı süre ilk pencereye sızmasın.
        this._fpsLast = undefined;
        this._fpsFrames = 0;
        this._fpsAccum = 0;
    }

    /**
     * Her kare çağrılır (gameLoop); ~0.5 sn'de bir FPS + ort. kare süresi yazar.
     * Kendi saatini kullanır (gameLoop dt'si 0.05'e kırpılır — düşük FPS'te yanıltırdı).
     */
    updateFps() {
        if (!this._fpsOn || !this._fpsEl) return;
        const now = performance.now();
        if (this._fpsLast === undefined) { this._fpsLast = now; return; }
        this._fpsFrames++;
        this._fpsAccum += (now - this._fpsLast) / 1000;
        this._fpsLast = now;
        if (this._fpsAccum >= 0.5) {
            const fps = this._fpsFrames / this._fpsAccum;
            const ms = (this._fpsAccum / this._fpsFrames) * 1000;
            this._fpsEl.textContent = `${fps.toFixed(0)} FPS · ${ms.toFixed(1)} ms`;
            this._fpsFrames = 0;
            this._fpsAccum = 0;
        }
    }

    // ---- Loading ----

    /**
     * Drive the loading bar from real asset-download progress (0..1).
     * CSS transitions the width so discrete jumps still animate smoothly.
     */
    setLoadingProgress(frac) {
        const pct = Math.max(0, Math.min(1, frac)) * 100;
        if (this.loadingFill) this.loadingFill.style.width = `${pct}%`;
        if (this.loadingText) this.loadingText.textContent = `Yükleniyor… ${Math.round(pct)}%`;
    }

    hideLoading() {
        if (this.loadingScreen) {
            this.loadingScreen.classList.add('fade-out');
            setTimeout(() => {
                this.loadingScreen.classList.add('hidden');
            }, 600);
        }
    }

    // ---- HUD ----

    showHUD() {
        this.hudTop?.classList.remove('hidden');
        this.controlsHelp?.classList.remove('hidden');
        this.shootBtn?.classList.remove('hidden');
        this.ultiHud?.classList.remove('hidden');
    }

    hideHUD() {
        this.hudTop?.classList.add('hidden');
        this.itemSlot?.classList.add('hidden');
        this.ultiHud?.classList.add('hidden');
    }

    updateTurn(playerNum, isBreak = false) {
        // Update active panel
        this.player1Panel?.classList.toggle('active', playerNum === 1);
        this.player2Panel?.classList.toggle('active', playerNum === 2);

        // Update turn text
        if (this.turnText) {
            if (isBreak) {
                this.turnText.textContent = 'BREAK SHOT';
                this.turnText.style.color = '';
            } else {
                this.turnText.textContent = `PLAYER ${playerNum}'S TURN`;
                this.turnText.style.color = '';
            }
        }
    }

    updatePlayerTypes(p1Type, p2Type) {
        if (this.p1Type) {
            this.p1Type.textContent = p1Type ? (p1Type === BALL_TYPES.SOLID ? '● SOLIDS' : '◐ STRIPES') : '';
        }
        if (this.p2Type) {
            this.p2Type.textContent = p2Type ? (p2Type === BALL_TYPES.SOLID ? '● SOLIDS' : '◐ STRIPES') : '';
        }
    }

    /**
     * Update the ball indicators for each player.
     * @param {number[]} p1BallIds - Ball IDs assigned to player 1's group
     * @param {number[]} p1Pocketed - Ball IDs player 1 has pocketed
     * @param {number[]} p2BallIds - Ball IDs assigned to player 2's group
     * @param {number[]} p2Pocketed - Ball IDs player 2 has pocketed
     */
    updatePlayerBalls(p1BallIds, p1Pocketed, p2BallIds, p2Pocketed) {
        this._renderBallDots(this.p1Balls, p1BallIds, p1Pocketed);
        this._renderBallDots(this.p2Balls, p2BallIds, p2Pocketed);
    }

    _renderBallDots(container, ballIds, pocketed) {
        if (!container) return;
        container.innerHTML = '';

        ballIds.forEach(id => {
            const data = BALL_DATA.find(b => b.id === id);
            if (!data) return;

            const dot = document.createElement('div');
            dot.className = 'ball-dot';
            if (pocketed.includes(id)) {
                dot.classList.add('pocketed');
            }
            dot.style.backgroundColor = data.color;

            // Number label
            const num = document.createElement('span');
            num.className = 'ball-number';
            num.textContent = data.number;
            dot.appendChild(num);

            container.appendChild(dot);
        });
    }

    // ---- Notifications ----

    // Olay türü → ekran-kenarı glow rengi + şiddeti. Her bildirim farklı "hisset"sin
    // (kullanıcı isteği: hepsi aynı olmasın). glow=null → kenar parlaması yok.
    static EDGE_GLOW = {
        normal:  null,
        success: { color: '#22c55e', strength: 0.55 },   // pozitif (yeşil)
        pickup:  { color: '#4dd2ff', strength: 0.55 },   // item aldın (cam göbeği)
        foul:    { color: '#f59e0b', strength: 0.8  },   // faul (amber)
        warning: { color: '#f59e0b', strength: 0.6  },   // uyarı (amber)
        danger:  { color: '#ff2d2d', strength: 1.0  },   // sabote edildin (kırmızı)
        ultimate:{ color: '#b06bff', strength: 1.0  },   // ultimate (mor şok dalgası)
    };

    /**
     * Show a compact top-center toast (over the turn indicator). Also pulses the
     * screen-edge glow keyed to `type` unless `glow` is explicitly given/null.
     * @param {string} text - Main text
     * @param {object} options - { subtext, icon, type, duration, glow }
     */
    showNotification(text, options = {}) {
        const { subtext = '', icon = '', type = 'normal', duration = 2000, glow } = options;

        if (this._notifTimeout) {
            clearTimeout(this._notifTimeout);
        }

        this.notification.className = type !== 'normal' ? type : '';
        if (this.notifIcon) this.notifIcon.textContent = icon;
        if (this.notifText) this.notifText.textContent = text;
        if (this.notifSubtext) this.notifSubtext.textContent = subtext;

        this.notification.classList.remove('hidden');

        // Re-trigger animation
        const content = this.notification.querySelector('.notification-content');
        if (content) {
            content.style.animation = 'none';
            content.offsetHeight; // force reflow
            content.style.animation = '';
        }

        // Edge glow: explicit override wins; else derive from type.
        const g = glow !== undefined ? glow : UIManager.EDGE_GLOW[type];
        if (g) this.flashEdge(g.color, g.strength);

        // Tür sesi: foul/warning → vızıltı, danger → tehlike vurgusu (örnek yoksa sessiz;
        // LAN istemcisi de host bildirimini aldığında duyar).
        if (this.sound) {
            if (type === 'foul' && this.sound.playFoul) this.sound.playFoul();
            else if (type === 'warning' && this.sound.playFoul) this.sound.playFoul(0.4);
            else if (type === 'danger' && this.sound.playDanger) this.sound.playDanger();
        }

        if (duration > 0) {
            this._notifTimeout = setTimeout(() => {
                this.notification.classList.add('hidden');
            }, duration);
        }
    }

    /**
     * Pulse the screen-edge glow (juice). color = CSS color; strength 0..1 peak
     * opacity; duration ms. Pure visual; never blocks input.
     */
    flashEdge(color, strength = 1, duration = 600) {
        if (!this.screenFlash) return;
        this.screenFlash.style.setProperty('--flash-color', color);
        this.screenFlash.style.setProperty('--flash-strength', String(strength));
        this.screenFlash.style.setProperty('--flash-dur', `${duration}ms`);
        // Restart the animation even if it's mid-flight.
        this.screenFlash.classList.remove('flash');
        void this.screenFlash.offsetWidth; // force reflow
        this.screenFlash.classList.add('flash');
    }

    /**
     * Faz 13 mini-olay ekran tinti: aktif olayın renginde yavaş nabız atan kenar
     * vinyeti. color=CSS renk → açar; null → kapatır. Saf overlay, girdiyi engellemez.
     */
    setEventTint(color) {
        if (!this.eventTint) return;
        if (color) {
            this.eventTint.style.setProperty('--event-color', color);
            this.eventTint.classList.add('active');
        } else {
            this.eventTint.classList.remove('active');
        }
    }

    /**
     * "Enerji Dalgası" ateş filtresi: mor güç vinyeti (ekran kenarlarından içeri
     * enerji basıyor hissi). Eleman lazily yaratılır (index.html'e dokunmaz);
     * her kare çağrılabilir (idempotent toggle). Saf overlay, girdiyi engellemez.
     */
    setUltiTint(on) {
        if (on && !this._ultiTint) {
            const el = document.createElement('div');
            el.id = 'ulti-tint';
            document.body.appendChild(el);
            this._ultiTint = el;
        }
        if (this._ultiTint) this._ultiTint.classList.toggle('active', !!on);
    }

    hideNotification() {
        this.notification?.classList.add('hidden');
        if (this._notifTimeout) {
            clearTimeout(this._notifTimeout);
            this._notifTimeout = null;
        }
    }

    // ---- Power Bar ----

    showPowerBar() {
        this.powerBarContainer?.classList.remove('hidden');
    }

    hidePowerBar() {
        this.powerBarContainer?.classList.add('hidden');
    }

    // ---- Item slot (shown only while the human is the saboteur) ----

    /**
     * @param {object|null} itemDef  ITEM_DEFS girdisi ({icon,name}) veya null (boş slot)
     * @param {boolean} visible  insan sabotajcı mı (yalnız o zaman göster)
     * @param {number} cooldownFrac  0=hazır .. 1=yeni kullanıldı (cooldown göstergesi)
     */
    updateItemSlot(itemDef, visible, cooldownFrac = 0) {
        if (!this.itemSlot) return;
        this.itemSlot.classList.toggle('hidden', !visible);
        if (!visible) return;
        const empty = !itemDef;
        this.itemSlot.classList.toggle('empty', empty);
        if (this.itemSlotIcon) this.itemSlotIcon.textContent = empty ? '·' : itemDef.icon;
        // Cooldown örtüsü: üstten inen yarı saydam perde (1=tam kapalı, 0=açık/hazır).
        if (this.itemSlotCd) this.itemSlotCd.style.transform = `scaleY(${Math.max(0, Math.min(1, cooldownFrac))})`;
    }

    // ---- Ultimate energy + combo (Faz 6) ----

    /**
     * Ultimate enerji barını güncelle. @param {number} frac 0..1 · @param {boolean} ready dolu mu.
     */
    updateUltimate(frac, ready) {
        if (this.ultiFill) this.ultiFill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
        if (ready !== this._ultiReady) {
            this._ultiReady = ready;
            this.ultiHud?.classList.toggle('ready', ready);
            if (this.ultiLabel) this.ultiLabel.textContent = ready ? 'ULTI HAZIR' : 'ULTI';
            if (ready && this.sound && this.sound.playUltiReady) this.sound.playUltiReady();
        }
    }

    /** "COMBO xN" pop'unu oynat (yalnız N≥2'de anlamlı) — pitch N ile yükselir. */
    popCombo(n) {
        if (!this.comboPop || n < 2) return;
        this.comboPop.textContent = `COMBO x${n}`;
        this.comboPop.classList.remove('pop');
        void this.comboPop.offsetWidth;   // reflow → animasyonu yeniden tetikle
        this.comboPop.classList.add('pop');
        if (this.sound && this.sound.playCombo) this.sound.playCombo(n);
    }

    // ---- Game Over ----

    /**
     * @param {object|null} rewards  Faz 15: Progression.finishMatch() özeti —
     *        {xpGain, coinGain, breakdown[], bar:{levelBefore/After, fromFrac, toFrac}}.
     *        null → ödül paneli gizli (LAN istemcisi / ilerleme yok).
     */
    showGameOver(winner, reason, rewards = null) {
        if (this.winnerText) this.winnerText.textContent = `Player ${winner} Wins!`;
        if (this.winReason) this.winReason.textContent = reason;
        this.gameOverScreen?.classList.remove('hidden');
        document.getElementById('pause-btn')?.classList.add('hidden');   // maç bitti — ⏸ gizle
        this._renderRewards(rewards);
    }

    hideGameOver() {
        this.gameOverScreen?.classList.add('hidden');
        if (this._rwAnim) { cancelAnimationFrame(this._rwAnim); this._rwAnim = null; }
        if (this._rwTick) { this._rwTick.stop(0.1); this._rwTick = null; }
    }

    /** Faz 15: ödül paneli — kazanım satırları + coin/XP sayaçları + XP barı animasyonu. */
    _renderRewards(rw) {
        const box = document.getElementById('go-rewards');
        if (!box) return;
        if (this._rwAnim) { cancelAnimationFrame(this._rwAnim); this._rwAnim = null; }
        if (this._rwTick) { this._rwTick.stop(0.1); this._rwTick = null; }
        if (!rw) { box.classList.add('hidden'); return; }
        box.classList.remove('hidden');

        // Kazanım satırları (kademeli belirme — delay CSS animasyonuna verilir).
        const list = document.getElementById('go-breakdown');
        if (list) {
            list.innerHTML = rw.breakdown.map((b, i) => `
                <li style="animation-delay:${0.15 + i * 0.22}s">
                    <span>${b.label}${b.count > 1 ? ` ×${b.count}` : ''}</span><b>+${b.xp} XP</b>
                </li>`).join('');
        }

        const lvlLabel = document.getElementById('go-lvl-label');
        const fill = document.getElementById('go-xpbar-fill');
        const coinEl = document.getElementById('go-coin-count');
        const xpEl = document.getElementById('go-xp-gain');
        const lvlUp = document.getElementById('go-levelup');
        if (!lvlLabel || !fill || !coinEl || !xpEl || !lvlUp) return;
        lvlUp.classList.add('hidden');
        lvlLabel.textContent = 'LVL ' + rw.bar.levelBefore;
        fill.style.width = (rw.bar.fromFrac * 100) + '%';

        // rAF: coin/XP sayaçları dolar; XP barı fromFrac→toFrac süzülür — seviye
        // atlanıyorsa %100'e dolup sıfırdan devam eder + "LEVEL UP!" flaşı.
        const t0 = performance.now();
        const COUNT_DUR = 900, BAR_DELAY = 350, BAR_DUR = 1200;
        const levels = rw.bar.levelAfter - rw.bar.levelBefore;
        const totalSpan = levels > 0
            ? (1 - rw.bar.fromFrac) + (levels - 1) + rw.bar.toFrac
            : (rw.bar.toFrac - rw.bar.fromFrac);
        let lvlShown = rw.bar.levelBefore;
        // Sesler: coin sayacı dönerken tık loop'u; bar süzülmeye başlarken XP süpürmesi.
        if (this.sound && this.sound.startLoop && rw.coinGain > 0) {
            this._rwTick = this.sound.startLoop('coin-tick-loop', { gain: 0.45 });
        }
        let xpPlayed = false;
        const step = (now) => {
            const t = now - t0;
            const cp = Math.min(1, t / COUNT_DUR);
            coinEl.textContent = Math.round(rw.coinGain * cp);
            xpEl.textContent = Math.round(rw.xpGain * cp);
            if (cp >= 1 && this._rwTick) { this._rwTick.stop(0.15); this._rwTick = null; }
            const bp = Math.min(1, Math.max(0, (t - BAR_DELAY) / BAR_DUR));
            if (!xpPlayed && t >= BAR_DELAY) {
                xpPlayed = true;
                if (this.sound && this.sound.playXpFill) this.sound.playXpFill();
            }
            const ease = bp * bp * (3 - 2 * bp);
            let dist = rw.bar.fromFrac + ease * totalSpan;   // seviye sınırlarını aşan mesafe
            let lvl = rw.bar.levelBefore;
            while (dist > 1 && lvl < rw.bar.levelAfter) { dist -= 1; lvl++; }
            if (lvl !== lvlShown) {
                lvlShown = lvl;
                lvlLabel.textContent = 'LVL ' + lvl;
                lvlUp.classList.remove('hidden');
                if (this.sound && this.sound.playLevelUp) this.sound.playLevelUp();
            }
            fill.style.width = (Math.min(1, dist) * 100) + '%';
            if (cp < 1 || bp < 1) this._rwAnim = requestAnimationFrame(step);
            else this._rwAnim = null;
        };
        this._rwAnim = requestAnimationFrame(step);
    }

    /** Register a restart callback */
    onRestartClick(callback) {
        this.restartBtn?.addEventListener('click', callback);
    }

    /**
     * Ultimate barına dokunma/tık (Faz 7): dolu olduğunda kullanıcı buradan tetikler.
     * Hazır değilken çağrı no-op'tur (tetikleyici enerjiyi kontrol eder). Hem masaüstü
     * tık hem mobil dokunma bağlanır (CSS .ready'de pointer-events açılır).
     */
    onUltimateClick(callback) {
        const bar = document.getElementById('ulti-bar') || this.ultiHud;
        if (!bar) return;
        bar.addEventListener('click', (e) => { e.preventDefault(); callback(); });
        bar.addEventListener('touchstart', (e) => { e.preventDefault(); callback(); }, { passive: false });
    }

    // ---- Controls ----

    showControlsHelp() {
        this.controlsHelp?.classList.remove('hidden');
    }

    hideControlsHelp() {
        this.controlsHelp?.classList.add('hidden');
    }

    showShootButton() {
        this.shootBtn?.classList.remove('hidden');
    }

    hideShootButton() {
        this.shootBtn?.classList.add('hidden');
    }
}
