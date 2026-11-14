// BASTION PROTOCOL — fx.js
// Particles, tracers and smoke with zero per-frame allocation: one
// THREE.Points pool per effect, reused every round. Smoke clouds are
// sprite puffs that also block bot vision (see bots.js).

import * as THREE from 'three';

const MAX_PARTICLES = 600;
const MAX_TRACERS = 24;
const MAX_SMOKE = 40;

export class FX {
  constructor(scene) {
    this.scene = scene;
    // Particle pool: positions + colours + per-particle life/velocity.
    this.pGeo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    this.pGeo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.pMat = new THREE.PointsMaterial({ size: 0.14, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
    this.points = new THREE.Points(this.pGeo, this.pMat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.pVel = new Float32Array(MAX_PARTICLES * 3);
    this.pLife = new Float32Array(MAX_PARTICLES);
    this.pMaxLife = new Float32Array(MAX_PARTICLES);
    this.pCursor = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) { this.pPos[i * 3 + 1] = -100; this.pLife[i] = 0; }

    // Tracer pool: one stretched box per tracer, reused.
    this.tracers = [];
    const tMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.85 });
    const tGeo = new THREE.BoxGeometry(0.03, 0.03, 1);
    for (let i = 0; i < MAX_TRACERS; i++) {
      const m = new THREE.Mesh(tGeo, tMat.clone());
      m.visible = false; scene.add(m);
      this.tracers.push({ mesh: m, life: 0 });
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

  // Muzzle flash + a few sparks at the barrel tip.
  muzzle(pos, dir) {
    this.burst(pos, 6, 0xffc46b, 2.2, 0.12, 0.6);
    this.burst(pos, 3, 0xfff2c0, 1.2, 0.08, 0.3);
  }

  tracer(from, to, color = 0xffd27a) {
    const t = this.tracers[this.tCursor];
    this.tCursor = (this.tCursor + 1) % MAX_TRACERS;
    const len = from.distanceTo(to);
    t.mesh.position.copy(from).add(to).multiplyScalar(0.5);
    t.mesh.lookAt(to);
    t.mesh.scale.set(1, 1, Math.max(0.1, len));
    t.mesh.material.color.setHex(color);
    t.mesh.material.opacity = 0.85;
    t.mesh.visible = true;
    t.life = 0.07;
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

  update(dt, camera) {
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
    // Tracers fade fast.
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) { t.mesh.visible = false; continue; }
      t.mesh.material.opacity = t.life / 0.07 * 0.85;
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
    for (const t of this.tracers) { t.life = 0; t.mesh.visible = false; }
    for (const s of this.smokes) { s.life = 0; s.mesh.visible = false; }
  }
}
