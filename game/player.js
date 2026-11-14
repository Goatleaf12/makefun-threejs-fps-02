// BASTION PROTOCOL — player.js
// First-person controller: WASD with acceleration + friction, jump,
// crouch, slow-walk, AABB collision, pointer-lock mouse look, and the
// firing/recoil state. Movement is pure simulation (no rendering here);
// main.js reads eye position + view direction to place the camera.

import * as THREE from 'three';
import { PLAYER } from './config.js';
import { collideCircle } from './map.js';
import { currentSpread, canFire } from './weapons.js';

const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class Player {
  constructor() {
    this.pos = new THREE.Vector3(-30, 0, 0);   // feet position
    this.vel = new THREE.Vector3();
    this.yaw = -Math.PI / 2;   // facing +X (toward mid)
    this.pitch = 0;
    this.crouched = false;
    this.onGround = true;
    this.hp = PLAYER.health;
    this.alive = true;
    this.recoilPitch = 0;      // accumulated recoil offset (decays)
    this.recoilYaw = 0;
    this.lastMoveTime = 0;
    this.moving = false;
    this.stepAcc = 0;
    this.flashUntil = 0;       // flashbang blind until (seconds, game clock)
    this.zoomed = false;
  }

  get eyeHeight() { return this.crouched ? PLAYER.crouchEye : PLAYER.eyeHeight; }

  eye(out = _eye) {
    out.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
    return out;
  }

  viewDir(out = _dir) {
    const p = this.pitch + this.recoilPitch;
    const y = this.yaw + this.recoilYaw;
    out.set(-Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
    return out;
  }

  // input: { f,b,l,r, jump, slow, crouch } — booleans for this tick.
  // Returns distance moved this tick (for step sounds + spread).
  update(dt, input, now) {
    if (!this.alive) return 0;
    const speed = this.crouched ? PLAYER.crouchSpeed : input.slow ? PLAYER.slowSpeed : PLAYER.walkSpeed;
    // Wish direction in world space (yaw-relative).
    let wx = 0, wz = 0;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    if (input.f) { wx += -sy; wz += -cy; }
    if (input.b) { wx += sy; wz += cy; }
    if (input.l) { wx += -cy; wz += sy; }
    if (input.r) { wx += cy; wz += -sy; }
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }
    const accel = this.onGround ? PLAYER.accel : PLAYER.airAccel;
    this.vel.x += wx * accel * dt;
    this.vel.z += wz * accel * dt;
    // Friction when no input (ground only).
    if (this.onGround && wl === 0) {
      const fr = Math.max(0, 1 - PLAYER.friction * dt);
      this.vel.x *= fr; this.vel.z *= fr;
    }
    // Clamp horizontal speed.
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > speed) { this.vel.x *= speed / hs; this.vel.z *= speed / hs; }
    // Jump.
    if (input.jump && this.onGround) { this.vel.y = PLAYER.jumpSpeed; this.onGround = false; }
    // Gravity + ground.
    this.vel.y -= PLAYER.gravity * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= 0) { this.pos.y = 0; this.vel.y = 0; this.onGround = true; }
    collideCircle(this.pos, PLAYER.radius);
    // Recoil recovery.
    this.recoilPitch *= Math.max(0, 1 - 9 * dt);
    this.recoilYaw *= Math.max(0, 1 - 9 * dt);
    this.moving = hs > 0.5;
    const moved = hs * dt;
    this.stepAcc += moved;
    return moved;
  }

  // Firing: caller checks canFire, then calls this to consume ammo and
  // apply recoil. Returns the spread to use for this shot.
  fireShot(loadout, now) {
    const w = loadout.current;
    loadout.mag[w] -= 1;
    loadout.lastShot = now;
    loadout.bloom = Math.min(1, loadout.bloom + 0.16);
    const spread = currentSpread(w, loadout, this.moving, this.crouched, !this.onGround);
    const recoil = { p: 0, y: 0 };
    const base = { p9: 0.011, hornet: 0.014, vk47: 0.019, railspike: 0.055, breacher: 0.045 }[w] ?? 0.015;
    recoil.p = base * (0.8 + Math.random() * 0.4);
    recoil.y = (Math.random() - 0.5) * base * 0.5;
    this.recoilPitch += recoil.p;
    this.recoilYaw += recoil.y;
    return spread;
  }

  // Damage the player. Returns true when this kill lands (hp <= 0).
  damage(amount, armorSoak) {
    if (!this.alive) return false;
    this.hp -= amount;
    return this.hp <= 0;
  }

  reset(x, z, yaw) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw; this.pitch = 0;
    this.hp = PLAYER.health;
    this.alive = true;
    this.recoilPitch = 0; this.recoilYaw = 0;
    this.crouched = false; this.zoomed = false;
  }

  get blinded() { return false; } // replaced by flashUntil in main loop
}
