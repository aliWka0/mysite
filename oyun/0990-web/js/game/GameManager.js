// ============================================
// GameManager — Game State Machine
// ============================================
import { GAME_STATES, BALL_TYPES, BALL_DATA } from '../constants.js';

export class GameManager {
    constructor() {
        // Mod + insan/bot atamaları reset()'ten BAĞIMSIZ tutulur (restart aynı modu korur).
        this.mode = 'local2p';   // 'local2p' | 'practice' | 'vsbot'
        this.humanPlayer = 1;
        this.botPlayer = 2;
        this.reset();
    }

    /** Oyun modunu ayarla. vs-Bot'ta insan = P1, bot = P2. */
    setMode(mode) {
        this.mode = mode || 'local2p';
        this.humanPlayer = 1;
        this.botPlayer = 2;
    }

    /** Verilen oyuncu bot mu? (yalnız vsbot modunda P2 bottur) */
    isBot(player) {
        return this.mode === 'vsbot' && player === this.botPlayer;
    }

    /** Sıradaki oyuncu bot mu? */
    isBotTurn() {
        return this.isBot(this.currentPlayer);
    }

    reset() {
        // Initial placeholder state; main.js drives the real flow into WALKING.
        // (The old 'AIMING' value was never handled anywhere — dead state.)
        this.state = GAME_STATES.LOADING;
        this.currentPlayer = 1;
        this.isBreakShot = true;

        // Player group assignments (null until first ball is pocketed after break)
        this.player1Type = null; // 'solid' | 'stripe'
        this.player2Type = null;

        // Tracking pocketed balls per player
        this.pocketedSolids = [];
        this.pocketedStripes = [];

        // Current shot tracking
        this.shotPocketed = [];     // balls pocketed during this shot
        this.cueBallPocketed = false;
        this.eightBallPocketed = false;
        this.shotFirstContact = null;

        // Foul state
        this.foul = false;
        this.foulReason = '';

        // Win state
        this.winner = 0;            // 0 = no winner, 1 or 2
        this.winReason = '';
    }

    setState(newState) {
        this.state = newState;
    }

    /** Prepare for a new shot to clear previous tracking data */
    prepareNewShot() {
        this.shotPocketed = [];
        this.cueBallPocketed = false;
        this.eightBallPocketed = false;
        this.shotFirstContact = null;
        this.foul = false;
        this.foulReason = '';
    }

    getState() {
        return this.state;
    }

    getCurrentPlayer() {
        return this.currentPlayer;
    }

    getPlayerType(player) {
        return player === 1 ? this.player1Type : this.player2Type;
    }

    /** Called when the break shot ends — assign groups if a ball was pocketed */
    /** Assign ball groups to players */
    assignGroups(playerNum, pocketedType) {
        const otherType = pocketedType === BALL_TYPES.SOLID ? BALL_TYPES.STRIPE : BALL_TYPES.SOLID;
        if (playerNum === 1) {
            this.player1Type = pocketedType;
            this.player2Type = otherType;
        } else {
            this.player2Type = pocketedType;
            this.player1Type = otherType;
        }
    }

    /** Record a pocketed ball */
    recordPocketed(ballId) {
        const data = BALL_DATA.find(b => b.id === ballId);
        if (!data) return;

        if (data.type === BALL_TYPES.CUE) {
            this.cueBallPocketed = true;
        } else if (data.type === BALL_TYPES.EIGHT) {
            this.eightBallPocketed = true;
        } else {
            this.shotPocketed.push(ballId);
            if (data.type === BALL_TYPES.SOLID) {
                this.pocketedSolids.push(ballId);
            } else if (data.type === BALL_TYPES.STRIPE) {
                this.pocketedStripes.push(ballId);
            }
        }
    }

    /** Record the first ball the cue ball contacted */
    setFirstContact(contact) {
        this.shotFirstContact = contact;
    }

    /** Switch turn to the other player */
    switchTurn() {
        this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
    }

    /** Check if a player has pocketed all their balls */
    hasPlayerClearedGroup(player) {
        const type = this.getPlayerType(player);
        if (!type) return false;

        if (type === BALL_TYPES.SOLID) {
            return this.pocketedSolids.length === 7;
        } else {
            return this.pocketedStripes.length === 7;
        }
    }

    /** Get array of valid ball IDs the current player is allowed to hit first */
    getValidTargetBalls() {
        // If groups not assigned or break shot, all solid/stripes are valid
        if (this.isBreakShot || !this.player1Type) {
            return BALL_DATA.filter(b => b.id !== 0 && b.id !== 8).map(b => b.id);
        }

        const myType = this.getPlayerType(this.currentPlayer);
        if (myType) {
            // If the group is cleared, 8-ball is the only valid target
            if (this.hasPlayerClearedGroup(this.currentPlayer)) {
                return [8];
            }
            // Otherwise, all balls of my group
            return BALL_DATA.filter(b => b.type === myType).map(b => b.id);
        }

        return [];
    }

    /** Get the balls that belong to a player's group */
    getPlayerBallIds(player) {
        const type = this.getPlayerType(player);
        if (!type) return [];

        return BALL_DATA
            .filter(b => b.type === type)
            .map(b => b.id);
    }

    /** Get pocketed ball IDs for a player's group */
    getPocketedForPlayer(player) {
        const type = this.getPlayerType(player);
        if (!type) return [];
        return type === BALL_TYPES.SOLID ? [...this.pocketedSolids] : [...this.pocketedStripes];
    }
}
