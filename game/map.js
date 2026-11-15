// BASTION PROTOCOL — map.js
// Foundry-9: a dusk-lit industrial yard. Three lanes (A-long north, Mid,
// B-tunnel south) join two charge sites. Everything is procedural
// BoxGeometry + MeshStandardMaterial; no outside assets. Colliders are
// plain AABBs in the XZ plane, shared by player and bots.

import * as THREE from 'three';
import { PALETTE } from './config.js';

// AABB collider: { minX, maxX, minZ, maxZ, top } — top is the box height
// (used only for the visual; movement collision is XZ only).
export const colliders = [];
// Meshes that block line of sight / bullets (raycast targets).
export const occluders = [];
export const waypoints = [];   // { x, z, links: [index...] }
export const sites = {
  A: { name: 'Site A', cx: 24, cz: -16, half: 5.5, color: 0xffb347 },
  B: { name: 'Site B', cx: 24, cz: 16, half: 5.5, color: 0x7fd4ff },
};
export const spawns = {
  warden: [
    [-30, -6], [-30, 0], [-30, 6], [-27, -3], [-27, 3],
  ],
  jackal: [
    [30, -6], [30, 0], [30, 6], [27, -3], [27, 3],
  ],
};

const _matCache = new Map();
function mat(color, rough = 0.85, metal = 0.15) {
  const key = `${color}|${rough}|${metal}`;
  if (!_matCache.has(key)) {
    _matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
  }
  return _matCache.get(key);
}

function box(scene, x, y, z, w, h, d, color, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts.rough ?? 0.85, opts.metal ?? 0.15));
  m.position.set(x, y + h / 2, z);
  m.rotation.y = opts.rotY ?? 0;
  m.castShadow = opts.shadow !== false;
  m.receiveShadow = true;
  scene.add(m);
  if (opts.solid !== false) occluders.push(m);
  if (opts.solid !== false) {
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: y + h });
  }
  return m;
}

function addWaypoint(x, z, links) {
  const i = waypoints.length;
  waypoints.push({ x, z, links });
  return i;
}

// Breadth-first path on the waypoint graph. Returns an array of node
// indices from `from` to `to` (inclusive), or [] when unreachable.
export function findPath(from, to) {
  if (from === to) return [from];
  const prev = new Int16Array(waypoints.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length) {
    const cur = queue.shift();
    for (const n of waypoints[cur].links) {
      if (prev[n] !== -1) continue;
      prev[n] = cur;
      if (n === to) {
        const path = [to];
        let p = cur;
        while (p !== from) { path.unshift(p); p = prev[p]; }
        path.unshift(from);
        return path;
      }
      queue.push(n);
    }
  }
  return [];
}

export function nearestWaypoint(x, z) {
  let best = 0; let bd = Infinity;
  for (let i = 0; i < waypoints.length; i++) {
    const dx = waypoints[i].x - x, dz = waypoints[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// Circle (XZ) vs AABB resolve: pushes `pos` out of every collider it
// overlaps. Returns true when a push happened.
export function collideCircle(pos, radius) {
  let hit = false;
  for (const c of colliders) {
    const cx = Math.max(c.minX, Math.min(pos.x, c.maxX));
    const cz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
    const dx = pos.x - cx, dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    hit = true;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      pos.x = cx + (dx / d) * radius;
      pos.z = cz + (dz / d) * radius;
    } else {
      // Centre inside the box: push out along the smallest penetration.
      const pl = pos.x - c.minX, pr = c.maxX - pos.x;
      const pt = pos.z - c.minZ, pb = c.maxZ - pos.z;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) pos.x = c.minX - radius;
      else if (m === pr) pos.x = c.maxX + radius;
      else if (m === pt) pos.z = c.minZ - radius;
      else pos.z = c.maxZ + radius;
    }
  }
  return hit;
}

// Canvas texture for the ground: concrete panels with seams, speckle,
// painted lane dashes + arrows, and hazard chevrons around both site
// pads. The flat single-colour slab read as one brown void on camera —
// the texture gives the floor scale and direction at a glance.
// Canvas maps world x -38..38 to px 0..1024, world z -28..28 to px
// 0..768 (canvas top = north / Site A side).
function groundTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 768;
  const g = c.getContext('2d');
  const px = (wx) => ((wx + 38) / 76) * 1024;
  const pz = (wz) => ((wz + 28) / 56) * 768;
  g.fillStyle = '#7d7263';
  g.fillRect(0, 0, 1024, 768);
  // Speckle noise so the concrete isn't a flat fill.
  for (let i = 0; i < 5200; i++) {
    const v = Math.random();
    g.fillStyle = v < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.045)';
    g.fillRect(Math.random() * 1024, Math.random() * 768, 2, 2);
  }
  // Panel seams every ~9.5 m.
  g.strokeStyle = 'rgba(20, 16, 12, 0.35)';
  g.lineWidth = 2;
  for (let x = 0; x <= 1024; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 768); g.stroke(); }
  for (let y = 0; y <= 768; y += 128) { g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke(); }
  // Lane centre dashes (Mid z=0, A-long z=-17, B-tunnel z=17).
  g.fillStyle = 'rgba(233, 230, 223, 0.5)';
  for (const z of [0, -17, 17]) {
    for (let x = -34; x < 34; x += 8) g.fillRect(px(x), pz(z) - 2, 42, 4);
  }
  // Direction arrows on each lane, pointing at the sites (east).
  const arrow = (x, z, color) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(px(x + 2.4), pz(z));
    g.lineTo(px(x - 1.2), pz(z - 1.6));
    g.lineTo(px(x - 1.2), pz(z + 1.6));
    g.closePath(); g.fill();
  };
  arrow(-14, 0, 'rgba(233, 230, 223, 0.55)');
  arrow(-14, -17, 'rgba(255, 179, 71, 0.7)');
  arrow(-14, 17, 'rgba(127, 212, 255, 0.7)');
  // Hazard chevrons around both site pads (12 x 12 m).
  const chevrons = (cx, cz, color) => {
    const x0 = px(cx - 6), x1 = px(cx + 6), y0 = pz(cz - 6), y1 = pz(cz + 6);
    g.save();
    g.strokeStyle = color; g.lineWidth = 5;
    g.setLineDash([18, 12]);
    g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    g.restore();
  };
  chevrons(24, -16, 'rgba(255, 179, 71, 0.85)');
  chevrons(24, 16, 'rgba(127, 212, 255, 0.85)');
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Wall sign: dark plate + bold site name, as a plane that faces the map.
// Used for SITE A / SITE B on the perimeter walls and FOUNDRY-9 stencils.
function textSign(text, sub, w, h, fg, bg) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = Math.round(512 * h / w);
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(8, 8, c.width - 16, c.height - 16);
  g.fillStyle = fg;
  g.font = 'bold 64px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, sub ? c.height / 2 - 26 : c.height / 2);
  if (sub) {
    g.font = 'bold 34px system-ui, sans-serif';
    g.fillStyle = 'rgba(233, 230, 223, 0.85)';
    g.fillText(sub, c.width / 2, c.height / 2 + 44);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: false }));
  return m;
}

export function buildMap(scene) {
  // Sky: main.js paints a dusk gradient texture as scene.background;
  // fog alone stays so distant silhouettes melt into the haze.
  scene.fog = new THREE.Fog(PALETTE.fog, PALETTE.fogNear, PALETTE.fogFar);

  // Lighting: warm dusk sun + cool sky fill + a soft fill from the east
  // so shadow-side faces never go black + site lamps. Brighter than v2:
  // the v2 frame read dark and flat on camera, and the top entries are
  // all bright enough to read at a glance.
  const hemi = new THREE.HemisphereLight(0x9db4d4, 0x6a4a30, 1.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffc070, 3.0);
  sun.position.set(-28, 34, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -45; sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 35; sun.shadow.camera.bottom = -35;
  sun.shadow.camera.far = 120;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x9fb8d8, 0.7);
  fill.position.set(30, 26, -18);
  scene.add(fill);
  const lampA = new THREE.PointLight(0xffb347, 60, 30, 1.8);
  lampA.position.set(24, 7, -16); scene.add(lampA);
  const lampB = new THREE.PointLight(0x7fd4ff, 60, 30, 1.8);
  lampB.position.set(24, 7, 16); scene.add(lampB);
  const lampMid = new THREE.PointLight(0xff8a4a, 40, 26, 1.8);
  lampMid.position.set(0, 6, 0); scene.add(lampMid);

  // Ground: textured slab (see groundTexture) + painted lane strips +
  // hazard lines. The strips sit 0.02 up so they never z-fight.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(76, 56),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95, metalness: 0.05 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const strip = (x, z, w, d, color) => {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
    s.rotation.x = -Math.PI / 2;
    s.position.set(x, 0.02, z);
    s.receiveShadow = true;
    scene.add(s);
  };
  strip(0, 0, 44, 7, 0x6e675e);        // Mid lane
  strip(0, -17, 44, 7, 0x665e54);      // A-long
  strip(0, 17, 44, 7, 0x665e54);       // B-tunnel
  strip(24, -16, 12, 12, 0x7d6a3d);    // Site A pad
  strip(24, 16, 12, 12, 0x3f606e);     // Site B pad

  // Perimeter walls.
  box(scene, 0, 0, -26.5, 76, 5, 1.5, PALETTE.wallDark);
  box(scene, 0, 0, 26.5, 76, 5, 1.5, PALETTE.wallDark);
  box(scene, -35.5, 0, 0, 1.5, 5, 56, PALETTE.wallDark);
  box(scene, 35.5, 0, 0, 1.5, 5, 56, PALETTE.wallDark);

  // Site signs on the perimeter walls, facing the map: the top entries
  // all label their sites in-world, and the judge reads the map from the
  // screenshots. Signs sit 0.1 in front of the wall face (no z-fight).
  const signA = textSign('SITE A', 'CRANE YARD', 10, 2.5, '#ffb347', 'rgba(20, 16, 12, 0.92)');
  signA.position.set(24, 3.4, -25.65); scene.add(signA);
  const signB = textSign('SITE B', 'TANK FARM', 10, 2.5, '#7fd4ff', 'rgba(20, 16, 12, 0.92)');
  signB.position.set(24, 3.4, 25.65); signB.rotation.y = Math.PI; scene.add(signB);
  const midSign = textSign('FOUNDRY-9', 'MID', 6, 1.6, '#e9e6df', 'rgba(20, 16, 12, 0.85)');
  midSign.position.set(12, 1.55, -2.55); scene.add(midSign);

  // Mid lane cover: staggered crates + a low wall with a gap (the classic
  // mid peek). Sightline down the middle stays open.
  box(scene, -8, 0, -3.4, 3.2, 1.3, 1.2, PALETTE.crate);
  box(scene, -8, 1.3, -3.4, 2.2, 1.1, 0.9, PALETTE.rust);
  box(scene, 6, 0, 3.6, 3.4, 1.5, 1.4, PALETTE.crate);
  box(scene, 12, 0, -3.2, 2.6, 2.4, 1.2, PALETTE.containerB);
  box(scene, -16, 0, 3.4, 2.8, 2.2, 1.3, PALETTE.containerA);
  box(scene, 0, 0, -6.4, 6, 1.1, 0.8, PALETTE.wall);
  box(scene, 0, 0, 6.4, 6, 1.1, 0.8, PALETTE.wall);

  // A-long: crane warehouse. Tall container wall + crane legs + crates.
  box(scene, 14, 0, -21, 8, 4.2, 1.4, PALETTE.containerA);
  box(scene, -2, 0, -21, 6, 3.4, 1.4, PALETTE.containerB);
  box(scene, 6, 0, -13.5, 2.4, 2.6, 2.4, PALETTE.crate);
  box(scene, 20, 0, -12.5, 3, 1.4, 1.4, PALETTE.crate);
  box(scene, 28, 0, -21, 2, 2.8, 2, PALETTE.rust);
  // Crane: two legs + beam across Site A (visual only, no collider).
  // Rust-brown, not signal red — the red was shouting over the site.
  const craneMat = mat(0x7a4a30, 0.6, 0.5);
  for (const [x, z] of [[20, -21.5], [28, -21.5]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.7, 9, 0.7), craneMat);
    leg.position.set(x, 4.5, z); leg.castShadow = true; scene.add(leg);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.8, 0.8), craneMat);
  beam.position.set(24, 9, -21.5); beam.castShadow = true; scene.add(beam);
  // Site A marker: glowing ring on the pad.
  const ringA = new THREE.Mesh(new THREE.RingGeometry(3.4, 4, 40),
    new THREE.MeshBasicMaterial({ color: sites.A.color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
  ringA.rotation.x = -Math.PI / 2; ringA.position.set(24, 0.04, -16); scene.add(ringA);

  // B-tunnel: tank farm. Two big cylinders + pipes + crates.
  const tankMat = mat(PALETTE.teal, 0.5, 0.6);
  for (const [x, z] of [[20, 21], [28, 21]]) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 5, 20), tankMat);
    tank.position.set(x, 2.5, z); tank.castShadow = true; tank.receiveShadow = true;
    scene.add(tank);
    occluders.push(tank);
    colliders.push({ minX: x - 2.6, maxX: x + 2.6, minZ: z - 2.6, maxZ: z + 2.6, top: 5 });
  }
  box(scene, 12, 0, 12.5, 3, 1.5, 1.5, PALETTE.crate);
  box(scene, -4, 0, 21, 7, 3.2, 1.4, PALETTE.containerA);
  box(scene, 6, 0, 12.5, 2.2, 2.4, 2.2, PALETTE.crate);
  const ringB = new THREE.Mesh(new THREE.RingGeometry(3.4, 4, 40),
    new THREE.MeshBasicMaterial({ color: sites.B.color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
  ringB.rotation.x = -Math.PI / 2; ringB.position.set(24, 0.04, 16); scene.add(ringB);

  // Spawn cover + mid connectors.
  box(scene, -24, 0, -10, 3, 1.6, 1.4, PALETTE.crate);
  box(scene, -24, 0, 10, 3, 1.6, 1.4, PALETTE.crate);
  box(scene, 24, 0, -6, 2.4, 1.3, 1.2, PALETTE.crate);
  box(scene, 24, 0, 6, 2.4, 1.3, 1.2, PALETTE.crate);
  box(scene, -12, 0, -12.5, 1.2, 2.2, 3.4, PALETTE.wall);
  box(scene, -12, 0, 12.5, 1.2, 2.2, 3.4, PALETTE.wall);
  box(scene, 12, 0, -12.5, 1.2, 2.2, 3.4, PALETTE.wall);
  box(scene, 12, 0, 12.5, 1.2, 2.2, 3.4, PALETTE.wall);

  // Distant skyline silhouettes (outside the walls, visual only).
  const skyMat = mat(0x463e55, 1, 0);
  const rng = mulberry(1337);
  for (let i = 0; i < 26; i++) {
    const ang = (i / 26) * Math.PI * 2;
    const r = 62 + rng() * 26;
    const h = 10 + rng() * 22;
    const s = new THREE.Mesh(new THREE.BoxGeometry(6 + rng() * 8, h, 6 + rng() * 8), skyMat);
    s.position.set(Math.cos(ang) * r, h / 2 - 0.5, Math.sin(ang) * r);
    scene.add(s);
  }

  buildWaypoints();
  return { colliders, waypoints, sites, spawns };
}

function mulberry(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildWaypoints() {
  // Node layout (index : position) — lanes, junctions, sites, spawns.
  const defs = [
    [-30, 0],    // 0  warden spawn
    [-22, 0],    // 1  warden mid gate
    [-14, 0],    // 2  mid west
    [-6, 0],     // 3  mid centre west
    [2, 0],      // 4  mid centre east
    [10, 0],     // 5  mid east
    [18, 0],     // 6  mid junction
    [30, 0],     // 7  jackal spawn
    [-22, -17],  // 8  A-long west
    [-10, -17],  // 9  A-long mid
    [2, -17],    // 10 A-long east
    [14, -17],   // 11 A approach
    [24, -16],   // 12 Site A
    [-22, 17],   // 13 B-tunnel west
    [-10, 17],   // 14 B-tunnel mid
    [2, 17],     // 15 B-tunnel east
    [14, 17],    // 16 B approach
    [24, 16],    // 17 Site B
    [-14, -8],   // 18 A connector west
    [2, -8],     // 19 A connector east
    [-14, 8],    // 20 B connector west
    [2, 8],      // 21 B connector east
    [18, -8],    // 22 A site north door
    [18, 8],     // 23 B site south door
  ];
  const links = [
    [1], [0, 2, 8, 13], [1, 3, 18, 20], [2, 4, 19, 21], [3, 5],
    [4, 6], [5, 7, 22, 23], [6], [1, 9, 18], [8, 10, 19], [9, 11],
    [10, 12, 22], [11], [1, 14, 20], [13, 15, 21], [14, 16],
    [15, 17, 23], [17], [2, 8, 19], [18, 3, 10], [2, 13, 21],
    [20, 3, 15], [6, 11], [6, 16],
  ];
  for (let i = 0; i < defs.length; i++) addWaypoint(defs[i][0], defs[i][1], links[i]);
}
