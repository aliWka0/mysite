// ============================================
// PocketDetector — Detect balls entering pockets
// ============================================
import { TABLE, BALL, getPocketPositions } from '../constants.js';

export class PocketDetector {
    constructor() {
        this.pockets = getPocketPositions();
        this.surfaceY = TABLE.HEIGHT;
        // Corner pockets are slightly larger than side pockets
        this.cornerRadius = TABLE.POCKET_RADIUS * 1.2;
        this.sideRadius = TABLE.POCKET_RADIUS * 1.0;
    }

    /**
     * Check which balls are in pockets.
     * @param {Map<number, {x,y,z}>} ballPositions - Map of ball ID → position
     * @returns {Array<{id: number, pocketIndex: number}>} - Pocketed ball info
     */
    check(ballPositions) {
        const pocketed = [];

        ballPositions.forEach((pos, id) => {
            // Skip balls that are already below the table (already being handled)
            if (pos.y < this.surfaceY - BALL.RADIUS * 3) return;

            for (let pi = 0; pi < this.pockets.length; pi++) {
                const pocket = this.pockets[pi];
                const dx = pos.x - pocket.x;
                const dz = pos.z - pocket.z;
                const distSq = dx * dx + dz * dz;
                const radius = pocket.type === 'corner' ? this.cornerRadius : this.sideRadius;

                if (distSq < radius * radius) {
                    pocketed.push({ id, pocketIndex: pi });
                    break;
                }
            }
        });

        return pocketed;
    }
}
