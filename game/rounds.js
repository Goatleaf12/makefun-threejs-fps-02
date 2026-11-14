// BASTION PROTOCOL — rounds.js
// Match state machine: buy phase → live round → end banner → next round.
// First to 7 (max 13). Win conditions: elimination, charge detonation,
// defuse, or timeout (defenders win if the charge was never planted).
// Economy lives here too: kill rewards, round rewards, loss-streak bonus.

import { ROUND, ECONOMY } from './config.js';

export class Rounds {
  constructor() {
    this.resetMatch();
  }

  resetMatch() {
    this.round = 1;
    this.scoreW = 0;
    this.scoreJ = 0;
    this.phase = 'buy';          // buy | live | end
    this.phaseT = ROUND.buySeconds;
    this.money = ECONOMY.startMoney;
    this.lossStreak = 0;
    this.charge = { planted: false, site: null, fuse: 0, planter: null };
    this.winner = null;          // match winner: 'warden' | 'jackal' | null
    this.lastReason = '';
    this.kills = { warden: 0, jackal: 0 };
    this.playerKills = 0;
    this.playerDeaths = 0;
  }

  get timeLeft() { return Math.max(0, this.phaseT); }

  startRound() {
    this.phase = 'buy';
    this.phaseT = ROUND.buySeconds;
    this.charge = { planted: false, site: null, fuse: 0, planter: null };
  }

  // Called every fixed tick. `ctx` = { wardensAlive, jackalsAlive,
  // playerAlive }. Returns an event string or null:
  // 'live' | 'timeout' | 'explode' | 'roundEnd'.
  update(dt, ctx) {
    if (this.phase === 'buy') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) { this.phase = 'live'; this.phaseT = ROUND.liveSeconds; return 'live'; }
      return null;
    }
    if (this.phase === 'live') {
      if (this.charge.planted) {
        this.charge.fuse -= dt;
        if (this.charge.fuse <= 0) return 'explode';
      } else {
        this.phaseT -= dt;
        if (this.phaseT <= 0) return 'timeout';
      }
      // Elimination ends the round immediately.
      if (ctx.jackalsAlive === 0) return 'elimW';
      if (ctx.wardensAlive === 0) return 'elimJ';
      return null;
    }
    if (this.phase === 'end') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        if (this.winner) return 'matchOver';
        this.round += 1;
        this.startRound();
        return 'nextRound';
      }
      return null;
    }
    return null;
  }

  // Resolve a round end. `winner` = 'warden' | 'jackal'.
  // Returns { moneyDelta, reason } for the player's economy.
  endRound(winner, reason) {
    this.lastReason = reason;
    if (winner === 'warden') {
      this.scoreW += 1;
      this.lossStreak = 0;
    } else {
      this.scoreJ += 1;
      this.lossStreak += 1;
    }
    let moneyDelta = winner === 'warden'
      ? ECONOMY.winReward
      : ECONOMY.lossReward + Math.min(this.lossStreak - 1, ECONOMY.lossStreakCap) * ECONOMY.lossStreakBonus;
    this.money += moneyDelta;
    this.phase = 'end';
    this.phaseT = ROUND.endSeconds;
    if (this.scoreW >= ROUND.winRounds || this.scoreJ >= ROUND.winRounds ||
        this.round >= ROUND.maxRounds) {
      this.winner = this.scoreW > this.scoreJ ? 'warden'
        : this.scoreJ > this.scoreW ? 'jackal'
        : (this.scoreW >= ROUND.winRounds ? 'warden' : 'jackal');
      // 6-6 after round 13: the team ahead wins; a true tie goes to Wardens
      // only if they won the last round (handled by score compare above).
      if (this.scoreW === this.scoreJ) this.winner = winner;
    }
    return { moneyDelta, reason };
  }

  addKillReward() { this.money += ECONOMY.killReward; }

  plantCharge(site, planter) {
    this.charge = { planted: true, site, fuse: ROUND.fuseSeconds, planter };
  }

  defuseCharge() {
    this.charge = { planted: false, site: null, fuse: 0, planter: null };
  }

  get scoreLine() { return `WARDENS ${this.scoreW} — ${this.scoreJ} JACKALS`; }
}
