// ============================================
// TouchControls — On-screen joystick + shoot button + zoom (mobile)
// ============================================
// Owns the touch-only HUD overlays and their own touch listeners. Because each
// overlay is a separate DOM element, the fingers that drive it never reach the
// canvas (InputManager), so movement (joystick) and look (canvas drag) work
// independently — true two-thumb control.
//
// Exposes:
//   getMoveVector()  → { x, y }  analog joystick vector (x = right+, y = forward+)
//   onShootPress(cb) → fired when the SHOOT button is pressed (hold to charge)
//   onShootRelease(cb) → fired when SHOOT is released (fire the shot)
//   onTrapPress(cb)  → fired when the USE-ITEM button is tapped (saboteur uses item)
//   setItem(def,usable) → update the USE-ITEM button icon/label/enabled to the held item
//   onZoom(cb)       → fired repeatedly while a zoom button is held (delta px)
//   setRole(role)    → 'shooter' shows SHOOT, 'saboteur' shows TRAP (per-turn swap)
//   show() / hide()  → toggle the overlays during play vs. loading/game-over
// ============================================

export class TouchControls {
    constructor() {
        this.moveVector = { x: 0, y: 0 };

        this._joy = document.getElementById('touch-joystick');
        this._knob = document.getElementById('touch-joystick-knob');
        this._shootBtn = document.getElementById('shoot-btn');
        this._trapBtn = document.getElementById('trap-btn');
        this._shieldBtn = document.getElementById('shield-btn');
        this._ultiBtn = document.getElementById('ulti-btn');
        this._zoomIn = document.getElementById('zoom-in');
        this._zoomOut = document.getElementById('zoom-out');

        this._joyId = null;
        this._joyCenter = { x: 0, y: 0 };
        this._radius = 48; // px — max knob travel

        this._onShootPress = [];
        this._onShootRelease = [];
        this._onTrap = [];
        this._onShield = [];
        this._onUlti = [];
        this._onZoom = [];
        this._zoomTimer = null;

        this._wireJoystick();
        this._wireShoot();
        this._wireTrap();
        this._wireShield();
        this._wireUlti();
        this._wireZoom();
    }

    // ---- Public API ----

    getMoveVector() {
        return this.moveVector;
    }

    onShootPress(cb) { this._onShootPress.push(cb); }
    onShootRelease(cb) { this._onShootRelease.push(cb); }
    onTrap(cb) { this._onTrap.push(cb); }
    onTrapPress(cb) { this._onTrap.push(cb); }   // ad eşanlamlısı (main.js çağrısı)
    onShield(cb) { this._onShield.push(cb); }    // KALKAN butonu (nişancı savunması)
    onUlti(cb) { this._onUlti.push(cb); }        // ULTİ butonu (enerji dolunca, SHOOT'un yanı)
    onZoom(cb) { this._onZoom.push(cb); }

    /**
     * Tur rolüne göre eylem butonu: 'shooter' → SHOOT görünür, 'saboteur' → USE-ITEM.
     * CSS body.sabo-role ile hangi butonun gösterileceğini seçer.
     */
    setRole(role) {
        document.body.classList.toggle('sabo-role', role === 'saboteur');
    }

    /**
     * USE-ITEM butonunu slottaki item'e göre güncelle. itemDef=null → boş (sönük).
     * @param {object|null} itemDef  {icon, name}
     * @param {boolean} usable  şu an kullanılabilir mi (slot dolu + cooldown bitti)
     */
    setItem(itemDef, usable) {
        if (!this._trapBtn) return;
        const icon = this._trapBtn.querySelector('.trap-icon');
        const label = this._trapBtn.querySelector('.trap-label');
        if (itemDef) {
            if (icon) icon.textContent = itemDef.icon;
            if (label) label.textContent = 'KULLAN';
        } else {
            if (icon) icon.textContent = '·';
            if (label) label.textContent = 'BOŞ';
        }
        this._trapBtn.classList.toggle('disabled', !usable);
    }

    /**
     * KALKAN butonu (nişancı savunması; SHOOT slotundan ayrı, üstte). show=false →
     * tamamen gizli. itemDef ikonu basar; usable=false → sönük (cooldown).
     */
    setShield(itemDef, usable, show) {
        if (!this._shieldBtn) return;
        this._shieldBtn.classList.toggle('show', !!show);
        if (!show) return;
        const icon = this._shieldBtn.querySelector('.shield-icon');
        if (icon && itemDef) icon.textContent = itemDef.icon;
        this._shieldBtn.classList.toggle('disabled', !usable);
    }

    /**
     * ULTİ butonu (SHOOT'un yanında): yalnız enerji DOLUNCA görünür (altın nabız).
     * itemDef ikonu basılır (oyuncunun ekipli ultimate'ı — ör. 🔥 Enerji Dalgası).
     */
    setUlti(itemDef, ready) {
        if (!this._ultiBtn) return;
        this._ultiBtn.classList.toggle('ready', !!ready);
        if (ready && itemDef) {
            const icon = this._ultiBtn.querySelector('.ulti-btn-icon');
            if (icon) icon.textContent = itemDef.icon;
        }
    }

    show() {
        document.body.classList.add('touch-active');
    }

    hide() {
        document.body.classList.remove('touch-active');
        document.body.classList.remove('sabo-role');
        if (this._shieldBtn) this._shieldBtn.classList.remove('show');
        if (this._ultiBtn) this._ultiBtn.classList.remove('ready');
        this._resetJoy();
    }

    // ---- Joystick ----

    _wireJoystick() {
        if (!this._joy) return;

        const start = (e) => {
            e.preventDefault();
            const t = e.changedTouches[0];
            this._joyId = t.identifier;
            const rect = this._joy.getBoundingClientRect();
            this._joyCenter.x = rect.left + rect.width / 2;
            this._joyCenter.y = rect.top + rect.height / 2;
            this._updateJoy(t.clientX, t.clientY);
        };
        const move = (e) => {
            e.preventDefault();
            for (const t of e.changedTouches) {
                if (t.identifier === this._joyId) this._updateJoy(t.clientX, t.clientY);
            }
        };
        const end = (e) => {
            for (const t of e.changedTouches) {
                if (t.identifier === this._joyId) this._resetJoy();
            }
        };

        this._joy.addEventListener('touchstart', start, { passive: false });
        this._joy.addEventListener('touchmove', move, { passive: false });
        this._joy.addEventListener('touchend', end);
        this._joy.addEventListener('touchcancel', end);
    }

    _updateJoy(x, y) {
        let dx = x - this._joyCenter.x;
        let dy = y - this._joyCenter.y;
        const dist = Math.hypot(dx, dy);
        if (dist > this._radius) {
            dx = (dx / dist) * this._radius;
            dy = (dy / dist) * this._radius;
        }
        if (this._knob) this._knob.style.transform = `translate(${dx}px, ${dy}px)`;

        // Screen Y grows downward; "up" on the stick means walking forward.
        this.moveVector.x = dx / this._radius;
        this.moveVector.y = -dy / this._radius;
    }

    _resetJoy() {
        this._joyId = null;
        this.moveVector.x = 0;
        this.moveVector.y = 0;
        if (this._knob) this._knob.style.transform = 'translate(0px, 0px)';
    }

    // ---- Shoot button (hold to charge, release to fire) ----

    _wireShoot() {
        if (!this._shootBtn) return;

        const press = (e) => {
            e.preventDefault();
            this._shootBtn.classList.add('charging');
            this._onShootPress.forEach(cb => cb());
        };
        const release = (e) => {
            if (e.cancelable) e.preventDefault();
            this._shootBtn.classList.remove('charging');
            this._onShootRelease.forEach(cb => cb());
        };

        this._shootBtn.addEventListener('touchstart', press, { passive: false });
        this._shootBtn.addEventListener('touchend', release);
        this._shootBtn.addEventListener('touchcancel', release);
    }

    // ---- Trap button (tap to drop a banana peel while saboteur) ----

    _wireTrap() {
        if (!this._trapBtn) return;

        const tap = (e) => {
            e.preventDefault();
            this._trapBtn.classList.add('active');
            this._onTrap.forEach(cb => cb());
        };
        const release = () => this._trapBtn.classList.remove('active');

        this._trapBtn.addEventListener('touchstart', tap, { passive: false });
        this._trapBtn.addEventListener('touchend', release);
        this._trapBtn.addEventListener('touchcancel', release);
    }

    // ---- Ulti button (tap to unleash the ultimate when the energy bar is full) ----

    _wireUlti() {
        if (!this._ultiBtn) return;

        const tap = (e) => {
            e.preventDefault();
            if (!this._ultiBtn.classList.contains('ready')) return;
            this._onUlti.forEach(cb => cb());
        };
        this._ultiBtn.addEventListener('touchstart', tap, { passive: false });
    }

    // ---- Shield button (tap to raise a shield while shooter; defense) ----

    _wireShield() {
        if (!this._shieldBtn) return;

        const tap = (e) => {
            e.preventDefault();
            if (this._shieldBtn.classList.contains('disabled')) return;
            this._shieldBtn.classList.add('active');
            this._onShield.forEach(cb => cb());
        };
        const release = () => this._shieldBtn.classList.remove('active');

        this._shieldBtn.addEventListener('touchstart', tap, { passive: false });
        this._shieldBtn.addEventListener('touchend', release);
        this._shieldBtn.addEventListener('touchcancel', release);
    }

    // ---- Zoom buttons (repeat while held) ----

    _wireZoom() {
        const bind = (el, delta) => {
            if (!el) return;
            const start = (e) => {
                e.preventDefault();
                this._fireZoom(delta);
                this._stopZoom();
                this._zoomTimer = setInterval(() => this._fireZoom(delta), 50);
            };
            const stop = () => this._stopZoom();
            el.addEventListener('touchstart', start, { passive: false });
            el.addEventListener('touchend', stop);
            el.addEventListener('touchcancel', stop);
        };
        // Zoom in = pull camera closer = negative distance delta (handleZoom adds delta*0.001).
        bind(this._zoomIn, -160);
        bind(this._zoomOut, 160);
    }

    _fireZoom(delta) {
        this._onZoom.forEach(cb => cb(delta));
    }

    _stopZoom() {
        if (this._zoomTimer) {
            clearInterval(this._zoomTimer);
            this._zoomTimer = null;
        }
    }
}
