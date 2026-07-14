// ============================================
// RuleEngine — 8-Ball Pool Rules
// ============================================
import { BALL_TYPES, BALL_DATA } from '../constants.js';

export class RuleEngine {
    /**
     * Evaluate a completed shot and determine the outcome.
     * @param {object} gameManager - The current game state
     * @returns {object} result:
     *   - foul: boolean
     *   - foulReason: string
     *   - switchTurn: boolean
     *   - winner: number (0 = none, 1 or 2)
     *   - winReason: string
     *   - assignGroups: string|null (BALL_TYPES.SOLID or STRIPE if groups should be assigned)
     *   - cueBallPocketed: boolean
     */
    evaluate(gameManager) {
        const result = {
            foul: false,
            foulReason: '',
            switchTurn: false,
            winner: 0,
            winReason: '',
            assignGroups: null,
            cueBallPocketed: gameManager.cueBallPocketed,
        };

        const currentPlayer = gameManager.currentPlayer;
        const otherPlayer = currentPlayer === 1 ? 2 : 1;
        const isBreak = gameManager.isBreakShot;
        const firstContact = gameManager.shotFirstContact;
        const pocketed = gameManager.shotPocketed;
        const cuePocketed = gameManager.cueBallPocketed;
        const eightPocketed = gameManager.eightBallPocketed;
        const playerType = gameManager.getPlayerType(currentPlayer);

        // --- 8-ball pocketed ---
        if (eightPocketed) {
            if (isBreak) {
                // 8-ball pocketed on break — re-rack (for simplicity, other player wins)
                result.winner = otherPlayer;
                result.winReason = '8-ball pocketed on break!';
                return result;
            }

            // Check if player has cleared their group
            if (gameManager.hasPlayerClearedGroup(currentPlayer)) {
                // Legal 8-ball shot — player wins!
                if (cuePocketed) {
                    // BUT cue ball also pocketed — scratch on 8-ball = lose
                    result.winner = otherPlayer;
                    result.winReason = 'Scratch on 8-ball shot!';
                } else {
                    result.winner = currentPlayer;
                    result.winReason = 'All balls pocketed + 8-ball!';
                }
            } else {
                // 8-ball pocketed before clearing group — lose!
                result.winner = otherPlayer;
                result.winReason = '8-ball pocketed too early!';
            }
            return result;
        }

        // --- Foul checks ---

        // 1. Cue ball pocketed (scratch)
        if (cuePocketed) {
            result.foul = true;
            result.foulReason = 'Cue ball pocketed!';
        }

        // 2. No ball contacted
        if (!firstContact && !result.foul) {
            result.foul = true;
            result.foulReason = 'No ball contacted!';
        }

        // 3. Wrong ball contacted first (after groups are assigned)
        if (!isBreak && playerType && firstContact && !result.foul) {
            // If player still has balls, must hit own type first
            if (!gameManager.hasPlayerClearedGroup(currentPlayer)) {
                if (firstContact.type !== playerType) {
                    // Exception: if first contact was 8-ball and player has cleared group
                    if (!(firstContact.type === BALL_TYPES.EIGHT && gameManager.hasPlayerClearedGroup(currentPlayer))) {
                        result.foul = true;
                        result.foulReason = "Hit opponent's ball first!";
                    }
                }
            }
        }

        // --- Turn logic ---
        if (result.foul) {
            result.switchTurn = true;
            return result;
        }

        // --- Group assignment (first legal pocket after break) ---
        if (!isBreak && !playerType && pocketed.length > 0) {
            // First ball legally pocketed after break — assign groups
            const firstBall = BALL_DATA.find(b => b.id === pocketed[0]);
            if (firstBall && (firstBall.type === BALL_TYPES.SOLID || firstBall.type === BALL_TYPES.STRIPE)) {
                result.assignGroups = firstBall.type;
            }
        }

        // If it's the break shot
        if (isBreak) {
            if (pocketed.length > 0) {
                // Pocketed ball on break — assign groups based on what was pocketed
                const firstBall = BALL_DATA.find(b => b.id === pocketed[0]);
                if (firstBall && (firstBall.type === BALL_TYPES.SOLID || firstBall.type === BALL_TYPES.STRIPE)) {
                    result.assignGroups = firstBall.type;
                }
                // Player continues (pocketed a ball)
                result.switchTurn = false;
            } else {
                // No ball pocketed on break — switch turn
                result.switchTurn = true;
            }
            return result;
        }

        // --- Normal shot: did the player pocket their own ball? ---
        if (playerType && pocketed.length > 0) {
            const ownPocketed = pocketed.some(id => {
                const data = BALL_DATA.find(b => b.id === id);
                return data && data.type === playerType;
            });

            if (ownPocketed) {
                // Continue playing
                result.switchTurn = false;
            } else {
                // Pocketed opponent's ball or nothing of own — switch
                result.switchTurn = true;
            }
        } else if (pocketed.length === 0) {
            // No ball pocketed — switch turn
            result.switchTurn = true;
        } else {
            // Groups not assigned yet but ball pocketed — keep turn
            result.switchTurn = false;
        }

        return result;
    }
}
