// BASTION PROTOCOL — bots.js
// Bot AI: waypoint graph + BFS routing, line-of-sight perception, burst
// fire with reaction time and aim error, cover-seeking at low HP, and
// objective play (carry + plant the charge, rotate, defuse). Warden bots
// defend; Jackal bots attack. Difficulty is tuned so a human can win a
// duel but a careless push loses — aim error and reaction scale with
// distance and target movement.

import * as THREE from 'three';
import { BOT, WEAPONS } from './config.js';
import { findPath, nearestWaypoint, waypoints, collideCircle } from './map.js';
import { freshLoadout } from './weapons.js';

const NAMES = {
  warden: ['Vex', 'Hale', 'Mira', 'Sable'],
  jackal: ['Rook', 'Fang', 'Nyx', 'Grit', 'Ash'],
};
const BODY_COLORS = { warden: 0x5b9bd5, jackal: 0xe8853a };

let botCounter = 0;

export class Bot {
  constructor(scene, team, index) {
    this.id = botCounter++;
    this.team = team;             // 'warden' | 'jackal'
    this.name = NAMES[team][index % NAMES[team].length];
    this.index = index;
    this.role = 'rusher';
    this.pos = new THREE.Vector3(0, 0, 0);
    this.yaw = 0;
    this.hp = BOT.health;
    this.alive = true;
    this.loadout = freshLoadout();
    this.loadout.primary = 'vk47';
    this.loadout.owned = { p9: true, vk47: true };
    this.loadout.mag = { p9: 12, vk47: 30 };
    this.loadout.reserve = { p9: 36, vk47: 90 };
    this.loadout.current = 'vk47';
    this.node = 0;                // current waypoint node
    this.path = [];               // queue of node indices to follow
    this.targetPoint = null;      // { x, z } override destination
    this.state = 'move';          // move | hold | combat | plant | defuse | retreat | dead
    this.enemy = null;            // visible enemy (player or Bot)
    this.reactAt = 0;             // game time when the bot may first fire
    this.burstLeft = 0;
    this.burstAt = 0;
    this.thinkAt = 0;
    this.plantProgress = 0;
    this.defuseProgress = 0;
    this.investigate = null;      // { x, z } heard-noise point
    this.holdUntil = 0;
    this.kills = 0; this.deaths = 0;
    this.carriesCharge = false;
    this.flashUntil = 0;
    this._tmp = new THREE.Vector3();

    // Visual: simple stylised soldier — torso, head, legs, gun.
    // The three hitboxes double as the visible body (different shades).
    this.group = new THREE.Group();
    const col = BODY_COLORS[team];
    const mk = (w, h, d, color, y, part) => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.2 }),
      );
      m.position.y = y;
      m.castShadow = true;
      m.userData = { bot: this, part };
      this.group.add(m);
      return m;
    };
    this.headMesh = mk(0.34, 0.34, 0.34, 0xd9a986, 1.62, 'head');
    // Visor strip so the head reads at a glance.
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.3, metalness: 0.6 }));
    visor.position.set(0, 1.64, 0.18);
    this.group.add(visor);
    this.torsoMesh = mk(0.62, 0.72, 0.36, col, 1.08, 'body');
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.2, 0.38),
      new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.7 }));
    chest.position.y = 1.18; this.group.add(chest);
    // Bright team trim across the shoulders — the squad reads at a glance,
    // even in the shadow side of the map.
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.07, 0.38),
      new THREE.MeshBasicMaterial({ color: col }));
    trim.position.y = 1.47; this.group.add(trim);
    this.legsMesh = mk(0.5, 0.68, 0.34, 0x4a4f55, 0.34, 'legs');
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.85),
      new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.4, metalness: 0.7 }));
    gun.position.set(0.28, 1.25, 0.35);
    this.group.add(gun);
    // Charge pack on the back: only the bot carrying the charge shows it,
    // so the objective is readable in a firefight at a glance.
    this.chargePack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.14),
      new THREE.MeshStandardMaterial({ color: 0x3a2020, roughness: 0.5, metalness: 0.4, emissive: 0xff2a1a, emissiveIntensity: 0.9 }));
    this.chargePack.position.set(0, 1.15, 0.26);
    this.chargePack.visible = false;
    this.group.add(this.chargePack);
    // Team ring under the feet — reads instantly in a firefight.
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 24),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
    this.group.add(ring);
    this.hitboxes = [this.headMesh, this.torsoMesh, this.legsMesh];
    scene.add(this.group);
  }

  eyeY() { return this.pos.y + BOT.eyeHeight; }

  reset(x, z, yaw, role) {
    this.pos.set(x, 0, z);
    this.yaw = yaw;
    this.hp = BOT.health;
    this.alive = true;
    this.state = 'move';
    this.role = role;
    this.enemy = null;
    this.path = [];
    this.targetPoint = null;
    this.plantProgress = 0;
    this.defuseProgress = 0;
    this.investigate = null;
    this.burstLeft = 0;
    this.carriesCharge = false;
    this.flashUntil = 0;
    this.loadout = freshLoadout();
    this.loadout.primary = 'vk47';
    this.loadout.owned = { p9: true, vk47: true };
    this.loadout.mag = { p9: 12, vk47: 30 };
    this.loadout.reserve = { p9: 36, vk47: 90 };
    this.loadout.current = 'vk47';
    this.group.visible = true;
    this.group.position.copy(this.pos);
  }

  die() {
    this.alive = false;
    this.state = 'dead';
    this.deaths += 1;
    this.group.visible = false;
  }

  // --- routing ---------------------------------------------------------
  setDestination(nodeIdx) {
    const from = nearestWaypoint(this.pos.x, this.pos.z);
    this.path = findPath(from, nodeIdx);
    if (this.path.length && this.path[0] === from) this.path.shift();
    this.state = 'move';
  }

  pickObjective(ctx) {
    // ctx: { phase, planted, plantSite, round, carrier }
    if (this.team === 'jackal') {
      if (ctx.planted) { this.setDestination(ctx.plantSite === 'A' ? 12 : 17); return; }
      if (this.carriesCharge) { this.setDestination(this.role === 'carrierB' ? 17 : 12); return; }
      if (this.role === 'mid') { this.setDestination(4); this.holdUntil = ctx.now + 14; return; }
      if (this.role === 'lurker') { this.setDestination(this.roleSite === 'B' ? 17 : 12); return; }
      this.setDestination(this.roleSite === 'B' ? 16 : 11);
      return;
    }
    // Wardens defend: anchors hold their site, one mid, one rotates.
    if (ctx.planted) { this.setDestination(ctx.plantSite === 'A' ? 12 : 17); return; }
    if (this.role === 'anchorA') { this.setDestination(12); this.holdUntil = ctx.now + 999; return; }
    if (this.role === 'anchorB') { this.setDestination(17); this.holdUntil = ctx.now + 999; return; }
    if (this.role === 'mid') { this.setDestination(3); this.holdUntil = ctx.now + 18; return; }
    this.setDestination(6);
  }

  // --- per-tick update ---------------------------------------------------
  update(dt, ctx) {
    if (!this.alive) return;
    const now = ctx.now;
    // Face movement direction while walking; face enemy while fighting.
    // Vision check every thinkInterval (cheap: one ray per bot).
    if (now >= this.thinkAt) {
      this.thinkAt = now + BOT.thinkInterval;
      this.scan(ctx);
    }
    if (this.flashUntil > now) { this.enemy = null; }
    if (!this.enemy && this.state === 'combat') this.state = 'move';

    // Combat overrides everything while an enemy is visible.
    if (this.enemy && this.enemy.alive !== false) {
      this.state = 'combat';
      this.fight(dt, ctx);
      this.syncVisual(dt);
      return;
    }
    // Plant / defuse channels.
    if (this.state === 'plant') { this.doPlant(dt, ctx); this.syncVisual(dt); return; }
    if (this.state === 'defuse') { this.doDefuse(dt, ctx); this.syncVisual(dt); return; }

    // Objective: carrier plants when the site is clear of enemies.
    if (this.team === 'jackal' && this.carriesCharge && !ctx.planted) {
      const site = this.role === 'carrierB' ? ctx.sites.B : ctx.sites.A;
      const dx = this.pos.x - site.cx, dz = this.pos.z - site.cz;
      if (Math.hypot(dx, dz) < site.half * 0.8 && !this.anyEnemyNear(ctx, 16)) {
        this.state = 'plant';
        this.plantProgress = 0;
        ctx.onPlantStart?.(this);
        this.syncVisual(dt);
        return;
      }
    }
    // Warden defuse: charge planted and bot stands on the site.
    if (this.team === 'warden' && ctx.planted) {
      const site = ctx.sites[ctx.plantSite];
      const dx = this.pos.x - site.cx, dz = this.pos.z - site.cz;
      if (Math.hypot(dx, dz) < 3 && !this.anyEnemyNear(ctx, 14)) {
        this.state = 'defuse';
        this.defuseProgress = 0;
        ctx.onDefuseStart?.(this);
        this.syncVisual(dt);
        return;
      }
    }
    // Low HP: fall back toward spawn.
    if (this.hp < BOT.retreatHp && this.state !== 'retreat') {
      this.state = 'retreat';
      this.setDestination(this.team === 'warden' ? 0 : 7);
    }
    if (this.state === 'retreat' && this.hp > 70) this.state = 'move';

    // Investigate a heard noise.
    if (this.investigate && this.state === 'move' && !this.path.length) {
      const n = nearestWaypoint(this.investigate.x, this.investigate.z);
      this.setDestination(n);
      this.investigate = null;
    }
    // Hold in place until the hold timer ends, then re-pick an objective.
    if (this.state === 'hold') {
      if (now >= this.holdUntil) { this.state = 'move'; this.pickObjective(ctx); }
      this.syncVisual(dt);
      return;
    }
    // Follow the path.
    if (!this.path.length) {
      if (this.holdUntil > now) { this.state = 'hold'; this.syncVisual(dt); return; }
      this.pickObjective(ctx);
      if (!this.path.length) { this.syncVisual(dt); return; }
    }
    const next = waypoints[this.path[0]];
    const dx = next.x - this.pos.x, dz = next.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.6) { this.path.shift(); this.syncVisual(dt); return; }
    const sp = BOT.walkSpeed;
    const vx = (dx / dist) * sp, vz = (dz / dist) * sp;
    this.pos.x += vx * dt;
    this.pos.z += vz * dt;
    this.yaw = Math.atan2(-vx, -vz);
    collideCircle(this.pos, BOT.radius);
    this.syncVisual(dt);
  }

  scan(ctx) {
    // Find the nearest visible enemy (player first, then bots).
    let best = null; let bestD = Infinity;
    const consider = (target, tx, ty, tz) => {
      const dx = tx - this.pos.x, dy = ty - this.eyeY(), dz = tz - this.pos.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > BOT.sightRange || d >= bestD) return;
      const ang = Math.atan2(-dx, -dz);
      let da = ang - this.yaw;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      if (Math.abs(da) > BOT.sightHalfAngle && d > 4) return;
      if (ctx.smokeBlocks(this.pos.x, this.eyeY(), this.pos.z, tx, ty, tz)) return;
      if (!ctx.hasLineOfSight(this.pos.x, this.eyeY(), this.pos.z, tx, ty, tz)) return;
      best = target; bestD = d;
    };
    const p = ctx.player;
    if (p.alive && p.team !== this.team) consider(p, p.pos.x, p.pos.y + 1.2, p.pos.z);
    for (const b of ctx.bots) {
      if (b === this || !b.alive || b.team === this.team) continue;
      consider(b, b.pos.x, b.pos.y + 1.2, b.pos.z);
    }
    if (best && best !== this.enemy) {
      // Fresh sighting: reaction delay scales with distance.
      this.reactAt = ctx.now + BOT.reactMin + Math.random() * (BOT.reactMax - BOT.reactMin) + bestD * 0.004;
      this.burstLeft = 0;
      // Squad comms: call the contact out (throttled by the sighting
      // itself — a bot only re-reports when its target changes).
      ctx.onContact?.(this, best);
    }
    this.enemy = best;
  }

  anyEnemyNear(ctx, radius) {
    const p = ctx.player;
    if (p.alive && p.team !== this.team) {
      if (Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < radius) return true;
    }
    for (const b of ctx.bots) {
      if (b === this || !b.alive || b.team === this.team) continue;
      if (Math.hypot(b.pos.x - this.pos.x, b.pos.z - this.pos.z) < radius) return true;
    }
    return false;
  }

  fight(dt, ctx) {
    const e = this.enemy;
    if (!e || e.alive === false) { this.enemy = null; this.state = 'move'; return; }
    const ex = e.pos.x, ez = e.pos.z, ey = e.pos.y + 1.2;
    const dx = ex - this.pos.x, dz = ez - this.pos.z;
    const dist = Math.hypot(dx, dz);
    // Face the enemy.
    const want = Math.atan2(-dx, -dz);
    let da = want - this.yaw;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    this.yaw += Math.max(-6 * dt, Math.min(6 * dt, da));
    if (ctx.now < this.reactAt) return;
    // Burst fire with pauses.
    if (this.burstLeft <= 0) {
      if (ctx.now < this.burstAt) return;
      this.burstLeft = BOT.burstMin + Math.floor(Math.random() * (BOT.burstMax - BOT.burstMin + 1));
      this.burstAt = ctx.now + BOT.burstPause;
    }
    if (ctx.now - (this.lastShotAt || -99) < WEAPONS.vk47.fireInterval) return;
    this.lastShotAt = ctx.now;
    this.burstLeft -= 1;
    ctx.onBotShot(this, e, dist);
  }

  doPlant(dt, ctx) {
    this.plantProgress += dt;
    ctx.onPlantTick?.(this, this.plantProgress / 4);
    if (this.anyEnemyNear(ctx, 16)) { // interrupted
      this.state = 'move';
      this.plantProgress = 0;
      ctx.onPlantCancel?.(this);
      return;
    }
    if (this.plantProgress >= 4) {
      this.state = 'move';
      this.carriesCharge = false;
      ctx.onPlanted?.(this);
    }
  }

  doDefuse(dt, ctx) {
    const need = 5;
    this.defuseProgress += dt;
    ctx.onDefuseTick?.(this, this.defuseProgress / need);
    if (this.anyEnemyNear(ctx, 14)) {
      this.state = 'move';
      this.defuseProgress = 0;
      ctx.onDefuseCancel?.(this);
      return;
    }
    if (this.defuseProgress >= need) {
      this.state = 'move';
      ctx.onDefused?.(this);
    }
  }

  // Hear a gunshot / explosion: turn toward it, maybe investigate.
  hear(x, z, now) {
    const d = Math.hypot(x - this.pos.x, z - this.pos.z);
    if (d > BOT.hearRadius) return;
    if (!this.enemy && this.state !== 'plant' && this.state !== 'defuse') {
      this.investigate = { x, z };
      if (this.state === 'hold') this.holdUntil = Math.min(this.holdUntil, now + 2);
    }
  }

  syncVisual(dt) {
    this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.group.rotation.y = this.yaw;
    this.chargePack.visible = this.carriesCharge && this.alive;
    // Crouch the model slightly when holding a site (visual only).
    const targetY = this.state === 'hold' ? 0.92 : 1;
    this.group.scale.y += (targetY - this.group.scale.y) * Math.min(1, dt * 6);
  }
}
