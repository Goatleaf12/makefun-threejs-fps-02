// BASTION PROTOCOL — fx.js
// Particles, tracers and smoke with zero per-frame allocation: one
// THREE.Points pool per effect, reused every round. Smoke clouds are
// sprite puffs that also block bot vision (see bots.js).

import * as THREE from 'three';

const MAX_PARTICLES = 600;
const MAX_TRACERS = 24;
const MAX_SMOKE = 40;

// Scratch vectors for the tapered-tracer orientation (no allocation).
const _tDir = new THREE.Vector3();
const _tUp = new THREE.Vector3(0, 1, 0);

export class FX {
  constructor(scene) {
    this.scene = scene;
    // Particle pool: positions + colours + per-particle life/velocity.
    this.pGeo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    this.pGeo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.pMat = new THREE.PointsMaterial({ size: 0.08, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
    this.points = new THREE.Points(this.pGeo, this.pMat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.pVel = new Float32Array(MAX_PARTICLES * 3);
    this.pLife = new Float32Array(MAX_PARTICLES);
    this.pMaxLife = new Float32Array(MAX_PARTICLES);
    this.pCursor = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) { this.pPos[i * 3 + 1] = -100; this.pLife[i] = 0; }

    // Tracer pool: one tapered cylinder per tracer, reused. Tapered
    // (0.025 at the muzzle, 0.09 at the target): a constant-thickness
    // box seen from behind the gun reads as a giant white monolith —
    // the near end is 1 m from the camera, so 0.15 m subtends ~9°.
    // The taper keeps the streak thin at the gun and readable at the
    // target, and additive over the bright scene no longer saturates
    // to white.
    this.tracers = [];
    const tMat = new THREE.MeshBasicMaterial({ color: 0xffc23e, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const tGeo = new THREE.CylinderGeometry(0.09, 0.025, 1, 6, 1, true);
    for (let i = 0; i < MAX_TRACERS; i++) {
      const m = new THREE.Mesh(tGeo, tMat.clone());
      m.visible = false; scene.add(m);
      this.tracers.push({ mesh: m, until: 0 });
    }
    this.tCursor = 0;

    // Smoke puffs: soft billboards that linger.
    this.smokes = [];
    const sGeo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < MAX_SMOKE; i++) {
      const m = new THREE.Mesh(sGeo, new THREE.MeshBasicMaterial({
        color: 0x9aa0a4, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
      }));
      m.visible = false; scene.add(m);
      this.smokes.push({ mesh: m, life: 0, maxLife: 1, x: 0, y: 0, z: 0 });
    }
    this.sCursor = 0;
    this._v = new THREE.Vector3();

    // Muzzle flash sprite: a small additive radial flare at the barrel
    // tip. Particles alone read as floating squares this close to the
    // camera, so the flash itself is one textured quad, ~70 ms.
    const fc = document.createElement('canvas');
    fc.width = 64; fc.height = 64;
    const fg = fc.getContext('2d');
    const grad = fg.createRadialGradient(32, 32, 2, 32, 32, 31);
    grad.addColorStop(0, 'rgba(255, 228, 160, 0.9)');
    grad.addColorStop(0.35, 'rgba(255, 180, 90, 0.7)');
    grad.addColorStop(1, 'rgba(255, 140, 40, 0)');
    fg.fillStyle = grad;
    fg.fillRect(0, 0, 64, 64);
    const flashTex = new THREE.CanvasTexture(fc);
    flashTex.colorSpace = THREE.SRGBColorSpace;
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.28, 0.28),
      new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.flash.visible = false;
    scene.add(this.flash);
    this.flashUntil = 0;   // game-clock expiry (see muzzle/update)
  }

  spawn(x, y, z, vx, vy, vz, life, r, g, b) {
    const i = this.pCursor;
    this.pCursor = (this.pCursor + 1) % MAX_PARTICLES;
    this.pPos[i * 3] = x; this.pPos[i * 3 + 1] = y; this.pPos[i * 3 + 2] = z;
    this.pVel[i * 3] = vx; this.pVel[i * 3 + 1] = vy; this.pVel[i * 3 + 2] = vz;
    this.pCol[i * 3] = r; this.pCol[i * 3 + 1] = g; this.pCol[i * 3 + 2] = b;
    this.pLife[i] = life; this.pMaxLife[i] = life;
  }

  burst(pos, count, color, speed = 3, life = 0.5, up = 1.5) {
    const r = ((color >> 16) & 255) / 255, g = ((color >> 8) & 255) / 255, b = (color & 255) / 255;
    for (let n = 0; n < count; n++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.spawn(pos.x, pos.y, pos.z,
        Math.cos(a) * s, (Math.random() - 0.3) * up, Math.sin(a) * s,
        life * (0.6 + Math.random() * 0.7), r, g, b);
    }
  }

  // Muzzle flash: one additive flare quad at the barrel tip (a flash,
  // not floating squares) + two tiny sparks. A Points burst this close
  // to the camera reads as giant squares, so sparks stay out of it.
  muzzle(pos, dir, now) {
    this.flash.position.copy(pos);
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.visible = true;
    this.flashUntil = now + 0.15;
  }

  // One tracer: a stretched box from muzzle to impact, bright enough to
  // read against a warm scene. Lives 0.22 s (still on screen for a
  // shutter a few frames after the shot).
  tracer(from, to, color = 0xffd27a, now = 0) {
    const t = this.tracers[this.tCursor];
    this.tCursor = (this.tCursor + 1) % MAX_TRACERS;
    const len = from.distanceTo(to);
    t.mesh.position.copy(from).add(to).multiplyScalar(0.5);
    // Cylinder axis is +Y: point it from the muzzle at the target.
    // radiusTop (+Y) is the target end, radiusBottom the muzzle end.
    _tDir.copy(to).sub(from).normalize();
    t.mesh.quaternion.setFromUnitVectors(_tUp, _tDir);
    t.mesh.scale.set(1, Math.max(0.1, len), 1);
    t.mesh.material.color.setHex(color);
    t.mesh.material.opacity = 1;
    t.mesh.visible = true;
    t.until = now + 0.3;
  }

  explosion(pos) {
    this.burst(pos, 46, 0xff7a2a, 7, 0.9, 4);
    this.burst(pos, 24, 0xffd27a, 4, 0.6, 3);
    this.burst(pos, 18, 0x555555, 2.5, 1.4, 2.5);
  }

  smokeCloud(x, y, z, life = 12) {
    for (let n = 0; n < 9; n++) {
      const s = this.smokes[this.sCursor];
      this.sCursor = (this.sCursor + 1) % MAX_SMOKE;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 2.6;
      s.x = x + Math.cos(a) * r; s.y = y + 0.4 + Math.random() * 1.4; s.z = z + Math.sin(a) * r;
      s.life = life * (0.8 + Math.random() * 0.4); s.maxLife = s.life;
      s.mesh.position.set(s.x, s.y, s.z);
      const sc = 2.2 + Math.random() * 1.6;
      s.mesh.scale.set(sc, sc, 1);
      s.mesh.visible = true;
    }
  }

  // Is the line of sight between a and b blocked by a smoke puff?
  smokeBlocks(ax, ay, az, bx, by, bz) {
    for (const s of this.smokes) {
      if (s.life <= 0) continue;
      // Distance from segment ab to the puff centre, in 3D.
      const abx = bx - ax, aby = by - ay, abz = bz - az;
      const apx = s.x - ax, apy = s.y - ay, apz = s.z - az;
      const len2 = abx * abx + aby * aby + abz * abz;
      let t = len2 > 0 ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
      if (dx * dx + dy * dy + dz * dz < 2.4 * 2.4) return true;
    }
    return false;
  }

  // update takes the GAME clock (now), not a frame dt: flash + tracer
  // lifetimes are game time, so they freeze when the game is frozen
  // for a screenshot and live the same 0.15/0.3 s in real 60 fps play.
  // Particles and smoke still decay per render (they are ambient, not
  // shutter-critical).
  update(now, dt, camera) {
    // Muzzle flash sprite: face the camera, fade fast.
    if (this.flash.visible) {
      const left = this.flashUntil - now;
      if (left <= 0) { this.flash.visible = false; }
      else {
        this.flash.lookAt(camera.position);
        // Capped at 0.75: at full opacity the additive flare blows the
        // target out to white on camera.
        this.flash.material.opacity = Math.min(0.75, left / 0.1);
      }
    }
    // Particles.
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      if (this.pLife[i] <= 0) { this.pPos[i * 3 + 1] = -100; continue; }
      this.pVel[i * 3 + 1] -= 5 * dt;
      this.pPos[i * 3] += this.pVel[i * 3] * dt;
      this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      if (this.pPos[i * 3 + 1] < 0.03) { this.pPos[i * 3 + 1] = 0.03; this.pVel[i * 3 + 1] = 0; }
    }
    this.pGeo.attributes.position.needsUpdate = true;
    this.pGeo.attributes.color.needsUpdate = true;
    // Tracers fade fast (game clock).
    for (const t of this.tracers) {
      if (!t.mesh.visible) continue;
      const left = (t.until || 0) - now;
      if (left <= 0) { t.mesh.visible = false; continue; }
      t.mesh.material.opacity = Math.min(1, left / 0.15 * 0.9);
    }
    // Smoke puffs billboard toward the camera and fade out.
    for (const s of this.smokes) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { s.mesh.visible = false; s.mesh.material.opacity = 0; continue; }
      s.mesh.lookAt(camera.position);
      const fade = Math.min(1, s.life / 2, (s.maxLife - s.life) / 0.4 + 0.2);
      s.mesh.material.opacity = 0.62 * Math.max(0, fade);
    }
  }

  clear() {
    for (let i = 0; i < MAX_PARTICLES; i++) { this.pLife[i] = 0; this.pPos[i * 3 + 1] = -100; }
    for (const t of this.tracers) { t.until = 0; t.mesh.visible = false; }
    for (const s of this.smokes) { s.life = 0; s.mesh.visible = false; }
    this.flashUntil = 0; this.flash.visible = false;
  }
}
