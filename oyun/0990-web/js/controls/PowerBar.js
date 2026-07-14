// ============================================
// PowerBar — Power Charging Mechanic
// ============================================
import { SHOT } from '../constants.js';

export class PowerBar {
    constructor() {
        this.container = document.getElementById('power-bar-container');
        this.fill = document.getElementById('power-bar-fill');
        this.power = 0;       // 0–1
        this._charging = false;
        this._direction = 1;   // 1 = increasing, -1 = decreasing (oscillating mode)
    }

    show() {
        this.container?.classList.remove('hidden');
    }

    hide() {
        this.container?.classList.add('hidden');
        this.reset();
    }

    startCharging() {
        this._charging = true;
        this._direction = 1;
        this.power = 0;
    }

    /** Stop charging and return final power (0–1) */
    stopCharging() {
        this._charging = false;
        const finalPower = this.power;
        return finalPower;
    }

    /** Update each frame — oscillates power up and down */
    update(dt) {
        if (!this._charging) return;

        this.power += this._direction * SHOT.CHARGE_SPEED * dt;

        // Oscillate between 0 and 1
        if (this.power >= 1) {
            this.power = 1;
            this._direction = -1;
        } else if (this.power <= 0.05) {
            this.power = 0.05;
            this._direction = 1;
        }

        // Update DOM
        this._updateFill();
    }

    _updateFill() {
        if (this.fill) {
            const pct = this.power * 100;
            // The fill bar is horizontal (CSS animates width, not height).
            this.fill.style.width = `${pct}%`;
        }
    }

    /** Set power directly (for external control) */
    setPower(value) {
        this.power = Math.max(0, Math.min(1, value));
        this._updateFill();
    }

    /** Get current power (0–1) */
    getPower() {
        return this.power;
    }

    isCharging() {
        return this._charging;
    }

    reset() {
        this._charging = false;
        this.power = 0;
        this._direction = 1;
        this._updateFill();
    }
}
