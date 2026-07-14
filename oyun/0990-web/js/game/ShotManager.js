// ============================================
// ShotManager — Shot Execution
// ============================================
import { SHOT } from '../constants.js';

export class ShotManager {
    /**
     * Calculate the impulse vector for a shot.
     * @param {number} aimAngle - Horizontal aim angle (radians)
     * @param {number} power - Power level 0–1
     * @returns {{x: number, y: number, z: number}} - Impulse vector
     */
    calculateImpulse(aimAngle, power) {
        const force = SHOT.MIN_FORCE + power * (SHOT.MAX_FORCE - SHOT.MIN_FORCE);

        return {
            x: Math.cos(aimAngle) * force,
            y: 0,
            z: Math.sin(aimAngle) * force,
        };
    }
}
