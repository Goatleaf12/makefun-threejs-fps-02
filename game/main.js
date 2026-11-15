// BASTION PROTOCOL — main.js
// Bootstrap + fixed-step simulation (60 Hz) kept apart from rendering.
// Owns: renderer, input, shooting raycasts, grenades, round flow,
// plant/defuse, economy wiring, HUD updates, and the debug hooks the
// playtest + screenshot scripts use (window.__bastion).

import * as THREE from 'three';
import { ROUND, WEAPONS, GRENADES, BOT, PLAYER } from './config.js';
import { buildMap, sites, spawns, occluders } from './map.js';
import { Player } from './player.js';
import { Bot } from './bots.js';
import { Rounds } from './rounds.js';
import { HUD } from './hud.js';
import { FX } from './fx.js';
import * as audio from './audio.js';
import {
  freshLoadout, computeDamage, canFire, startReload, finishReload, buyItem, stepGrenade,
} from './weapons.js';

const FIXED_DT = 1 / 60;
const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');           // action | buy | site | score
const AUTOPLAY = params.has('autoplay') || !!SHOT;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.1, 220);
camera.rotation.order = 'YXZ';
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
document.getElementById('game').appendChild(renderer.domElement);

buildMap(scene);
// Dusk gradient sky (steel blue up high, burnt orange at the horizon).
{
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#5b7cb0');
  gr.addColorStop(0.55, '#c98a5e');
  gr.addColorStop(1, '#e08a4a');
  g.fillStyle = gr;
  g.fillRect(0, 0, 4, 256);
  const skyTex = new THREE.CanvasTexture(c);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
}
const fx = new FX(scene);
const hud = new HUD(document);
const rounds = new Rounds();
const raycaster = new THREE.Raycaster();
raycaster.far = 200;

// --- combatants ---------------------------------------------------------
const player = new Player();
player.team = 'warden';
const playerLoadout = freshLoadout();
const bots = [];
for (let i = 0; i < 4; i++) bots.push(new Bot(scene, 'warden', i));
for (let i = 0; i < 5; i++) bots.push(new Bot(scene, 'jackal', i));
const wardens = bots.filter(b => b.team === 'warden');
const jackals = bots.filter(b => b.team === 'jackal');

// Charge prop (visible when planted).
const chargeMesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.32, 0.34),
  new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.4, metalness: 0.6, emissive: 0xff2a1a, emissiveIntensity: 0.9 }),
);
chargeMesh.visible = false;
chargeMesh.castShadow = true;
scene.add(chargeMesh);
const chargeLight = new THREE.PointLight(0xff2a1a, 8, 8, 1.6);
chargeLight.visible = false;
scene.add(chargeLight);

// Weapon viewmodel: a rifle the player can actually read — gunmetal
// body, orange accent stripe, magazine, grip and front sight. A small
// warm light rides with the camera so it is never a black slab, even
// when the player faces the shadow side of the map.
const viewGun = new THREE.Group();
const vgBody = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.62),
  new THREE.MeshStandardMaterial({ color: 0x70767e, roughness: 0.45, metalness: 0.55 }));
const vgBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.34),
  new THREE.MeshStandardMaterial({ color: 0x33373c, roughness: 0.3, metalness: 0.8 }));
vgBarrel.position.set(0, 0.03, -0.45);
const vgSight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.08),
  new THREE.MeshStandardMaterial({ color: 0x22252a, roughness: 0.3, metalness: 0.6 }));
vgSight.position.set(0, 0.1, -0.1);
const vgStripe = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.4),
  new THREE.MeshStandardMaterial({ color: 0xcc7a1e, roughness: 0.5, metalness: 0.3, emissive: 0xff8a1a, emissiveIntensity: 0.15 }));
vgStripe.position.set(0, 0.075, 0.0);
const vgMag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.1),
  new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.5, metalness: 0.6 }));
vgMag.position.set(0, -0.1, -0.05);
const vgGrip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.08),
  new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.6, metalness: 0.4 }));
vgGrip.position.set(0, -0.07, 0.14);
const vgFrontSight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.03),
  new THREE.MeshStandardMaterial({ color: 0xcc7a1e, roughness: 0.4, metalness: 0.3, emissive: 0xff8a1a, emissiveIntensity: 0.25 }));
vgFrontSight.position.set(0, 0.09, -0.44);
viewGun.add(vgBody, vgBarrel, vgSight, vgStripe, vgMag, vgGrip, vgFrontSight);
viewGun.position.set(0.3, -0.26, -0.62);
viewGun.rotation.y = 0.07;   // a touch of side face, so the gun reads as a gun, not a slab
viewGun.scale.setScalar(0.8);
camera.add(viewGun);
// Camera light: lights the viewmodel (and nothing else, at 3 m range).
const camLight = new THREE.PointLight(0xfff2dd, 4.5, 3, 1.2);
camLight.position.set(0.25, 0.15, -0.3);
camera.add(camLight);
scene.add(camera);

// --- input ---------------------------------------------------------------
const keys = new Set();
let mouseDown = false, mouseDownR = false;
let started = false, paused = false;
let frozen = false;   // debug freeze: stops simulate (game clock) without
// showing the pause screen — screenshots capture a frozen frame with
// flash/tracer/damage numbers intact.
let now = 0;                 // game clock (seconds, fixed-step only)
let firing = false;

addEventListener('keydown', (e) => {
  if (e.code === 'Tab') { e.preventDefault(); toggleScoreboard(true); return; }
  keys.add(e.code);
  if (e.code === 'KeyR') tryReload();
  if (e.code === 'KeyB') toggleBuy();
  if (e.code === 'KeyM') { audio.setMuted(!audio.isMuted()); hud.center(audio.isMuted() ? 'SOUND MUTED' : 'SOUND ON', 1.2); }
  if (e.code === 'Digit1') switchWeapon('primary');
  if (e.code === 'Digit2') switchWeapon('p9');
  if (e.code === 'Digit4') throwGrenade('frag');
  if (e.code === 'Digit5') throwGrenade('flash');
  if (e.code === 'Digit6') throwGrenade('smoke');
  if (e.code === 'KeyG') cycleGrenade();
});
addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'Tab') toggleScoreboard(false);
});
// Mouse wheel cycles the two weapon slots (1 = primary, 2 = pistol).
addEventListener('wheel', (e) => {
  if (!started || paused || !player.alive) return;
  switchWeapon(e.deltaY > 0 ? 'p9' : 'primary');
}, { passive: true });
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement || !player.alive) return;
  player.yaw -= e.movementX * 0.0021;
  player.pitch -= e.movementY * 0.0021;
  player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch));
});
renderer.domElement.addEventListener('mousedown', (e) => {
  if (!started || paused) return;
  audio.ensureAudio();
  if (e.button === 0) {
    mouseDown = true; firing = true;
    // Semi-auto weapons fire once on the click itself: a quick click
    // must not be swallowed by the mouseup arriving before the next tick.
    if (!WEAPONS[playerLoadout.current].auto) playerShoot();
  }
  if (e.button === 2) { mouseDownR = true; player.zoomed = true; }
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) { mouseDown = false; firing = false; }
  if (e.button === 2) { mouseDownR = false; player.zoomed = false; }
});
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== renderer.domElement && started && !AUTOPLAY) {
    paused = true;
    document.getElementById('pauseScreen').style.display = 'flex';
  }
});
document.getElementById('resumeBtn').addEventListener('click', () => {
  document.getElementById('pauseScreen').style.display = 'none';
  paused = false;
  renderer.domElement.requestPointerLock();
});
document.getElementById('startBtn').addEventListener('click', startGame);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function startGame() {
  audio.ensureAudio();
  document.getElementById('startScreen').style.display = 'none';
  document.getElementById('minimap').style.display = 'block';
  if (!AUTOPLAY) renderer.domElement.requestPointerLock();
  started = true;
  resetRoundPositions();
  hud.banner('ROUND 1 — FOUNDRY-9', 'Buy phase — press B for the buy menu', '#7fd4ff', 3);
  hud.center('Hold the sites. First to 7 rounds.', 3.5);
}

// --- round setup ---------------------------------------------------------
function resetRoundPositions() {
  player.reset(spawns.warden[0][0], spawns.warden[0][1], -Math.PI / 2);
  playerLoadout.current = playerLoadout.primary;
  const wRoles = ['anchorA', 'anchorB', 'mid', 'rotator'];
  wardens.forEach((b, i) => {
    const s = spawns.warden[(i + 1) % spawns.warden.length];
    b.reset(s[0], s[1], -Math.PI / 2, wRoles[i]);
  });
  jackals.forEach((b, i) => {
    const s = spawns.jackal[i % spawns.jackal.length];
    const roles = ['carrierA', 'rusher', 'mid', 'lurker', 'rusher'];
    b.reset(s[0], s[1], Math.PI / 2, roles[i]);
    b.roleSite = i % 2 === 0 ? 'A' : 'B';
    if (i === 0) b.carriesCharge = true;
  });
  chargeMesh.visible = false;
  chargeLight.visible = false;
  fx.clear();
  grenades.length = 0;
}

// --- line of sight ---------------------------------------------------------
const _losDir = new THREE.Vector3();
const _plateV = new THREE.Vector3();   // nameplate projection scratch
function hasLineOfSight(ax, ay, az, bx, by, bz) {
  _losDir.set(bx - ax, by - ay, bz - az);
  const dist = _losDir.length();
  if (dist < 0.01) return true;
  _losDir.multiplyScalar(1 / dist);
  raycaster.set(new THREE.Vector3(ax, ay, az), _losDir);
  raycaster.far = dist;
  const hits = raycaster.intersectObjects(occluders, false);
  return hits.length === 0;
}

// --- shooting ---------------------------------------------------------------
const _shotDir = new THREE.Vector3();
const _shotOrigin = new THREE.Vector3();
const _proj = new THREE.Vector3();
let viewKick = 0;   // viewmodel kick after a shot; decays in render()
function playerShoot() {
  const wid = playerLoadout.current;
  if (!canFire(playerLoadout, now)) {
    if (playerLoadout.mag[wid] <= 0 && !playerLoadout.reloading) {
      audio.playDryClick();
      if (wid !== 'p9') switchWeapon('p9');
      else tryReload();
    }
    return;
  }
  const spread = player.fireShot(playerLoadout, now);
  viewKick = 0.09;
  const w = WEAPONS[wid];
  player.eye(_shotOrigin);
  player.viewDir(_shotDir);
  audio.playShot(w.kind, 0);
  // Muzzle flash at the barrel tip (just past the viewmodel's muzzle).
  const muzzle = _shotOrigin.clone().add(_shotDir.clone().multiplyScalar(1.05));
  muzzle.y -= 0.12;
  fx.muzzle(muzzle, _shotDir, now);
  for (let p = 0; p < w.pellets; p++) {
    const dir = _shotDir.clone();
    dir.x += (Math.random() - 0.5) * 2 * spread;
    dir.y += (Math.random() - 0.5) * 2 * spread;
    dir.z += (Math.random() - 0.5) * 2 * spread;
    dir.normalize();
    raycaster.set(_shotOrigin, dir);
    raycaster.far = w.range;
    const botMeshes = [];
    for (const b of bots) if (b.alive && b.team === 'jackal') botMeshes.push(...b.hitboxes);
    const botHits = raycaster.intersectObjects(botMeshes, false);
    const wallHits = raycaster.intersectObjects(occluders, false);
    const wallDist = wallHits.length ? wallHits[0].distance : Infinity;
    if (botHits.length && botHits[0].distance < wallDist) {
      const hit = botHits[0];
      const bot = hit.object.userData.bot;
      const part = hit.object.userData.part;
      const dmg = computeDamage(wid, part, hit.distance, bot.loadout.helmet, bot.loadout.armor > 0);
      damageBot(bot, dmg.hp, part, 'You');
      // Floating damage number at the hit point — offset up-right of the
      // crosshair so it never sits under the hitmarker itself.
      _proj.copy(hit.point).project(camera);
      if (_proj.z < 1) {
        hud.spawnDamageNumber(
          (_proj.x * 0.5 + 0.5) * innerWidth + 34,
          (-_proj.y * 0.5 + 0.5) * innerHeight - 28,
          String(Math.round(dmg.hp)),
          bot.hp <= 0 ? 'kill' : part === 'head' ? 'head' : 'body',
          now,
        );
      }
      // The tracer starts at the barrel tip (muzzle), not the eye: from
      // the eye it foreshortens to a stub, but from the muzzle it reads
      // as a streak leaving the gun toward the target.
      fx.tracer(muzzle, hit.point, w.tracer, now);
      fx.burst(hit.point, part === 'head' ? 10 : 6, part === 'head' ? 0xff5a4a : 0xc0392b, 2, 0.4);
      audio.playHit(part === 'head');
    } else {
      const end = wallHits.length ? wallHits[0].point : _shotOrigin.clone().add(dir.multiplyScalar(w.range));
      fx.tracer(muzzle, end, w.tracer, now);
      if (wallHits.length) fx.burst(wallHits[0].point, 4, 0x9a8f7a, 1.5, 0.3);
    }
  }
  // Noise: nearby bots turn toward the shot.
  for (const b of bots) if (b.alive) b.hear(player.pos.x, player.pos.z, now);
  // Refresh nameplates now so the HP bar matches the damage just dealt
  // (the 10 Hz refresh would otherwise lag a full shot behind).
  updateNameplates();
}

function damageBot(bot, hpDmg, part, killerName) {
  if (!bot.alive) return;
  bot.hp -= hpDmg;
  if (bot.loadout.armor > 0) bot.loadout.armor = Math.max(0, bot.loadout.armor - hpDmg * 0.5);
  if (bot.hp <= 0) {
    const wasCarrier = bot.carriesCharge;
    bot.die();
    hud.addKill(killerName, bot.name, part === 'head', killerName === 'You' ? 'warden' : bot.team === 'warden' ? 'warden' : 'jackal');
    hud.hitmarker(part === 'head', true);
    if (killerName === 'You') {
      rounds.addKillReward();
      rounds.playerKills += 1;
      hud.setMoney(rounds.money);
      audio.playBuy();
    }
    if (wasCarrier) transferCharge(bot);
  } else {
    hud.hitmarker(part === 'head', false);
  }
}

function transferCharge(deadBot) {
  // The charge passes to the nearest living Jackal; if none live, it is
  // lost (the round is effectively decided by elimination anyway).
  let best = null; let bd = Infinity;
  for (const b of jackals) {
    if (!b.alive) continue;
    const d = Math.hypot(b.pos.x - deadBot.pos.x, b.pos.z - deadBot.pos.z);
    if (d < bd) { bd = d; best = b; }
  }
  if (!best) return;
  best.carriesCharge = true;
  const siteA = Math.hypot(best.pos.x - sites.A.cx, best.pos.z - sites.A.cz);
  const siteB = Math.hypot(best.pos.x - sites.B.cx, best.pos.z - sites.B.cz);
  best.role = siteA <= siteB ? 'carrierA' : 'carrierB';
  hud.center(`${best.name} picked up the charge`, 2);
}

function damagePlayer(hpDmg, fromBot) {
  if (!player.alive) return;
  let soak = 0;
  if (playerLoadout.armor > 0) {
    soak = Math.min(hpDmg * 0.5, playerLoadout.armor);
    playerLoadout.armor -= soak;
  }
  const died = player.damage(hpDmg - soak, soak);
  audio.playHurt();
  document.getElementById('vignette').style.opacity = '1';
  setTimeout(() => { document.getElementById('vignette').style.opacity = '0'; }, 350);
  if (fromBot) {
    const dx = fromBot.pos.x - player.pos.x, dz = fromBot.pos.z - player.pos.z;
    const ang = Math.atan2(dx, dz) - player.yaw;
    hud.damageFrom((ang * 180) / Math.PI);
  }
  if (died) {
    player.alive = false;
    rounds.playerDeaths += 1;
    hud.addKill(fromBot ? fromBot.name : 'Jackals', 'You', false, 'jackal');
    hud.banner('YOU ARE DOWN', 'Your squad fights on — next round you redeploy', '#ff5a4a', 3.5);
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

// Bot shot resolution (called from bots.js fight()).
function onBotShot(bot, target, dist) {
  if (!bot.alive) return;
  const w = WEAPONS.vk47;
  const from = new THREE.Vector3(bot.pos.x, bot.eyeY() - 0.25, bot.pos.z);
  const moving = target === player ? player.moving : true;
  const hitP = Math.max(0.07, Math.min(0.55, 0.5 - dist * 0.007 - (moving ? 0.12 : 0) - (target === player && player.crouched ? 0.05 : 0)));
  // Tracer + sound always; damage only on a hit roll.
  const to = target === player
    ? new THREE.Vector3(player.pos.x, player.pos.y + 1.2, player.pos.z)
    : new THREE.Vector3(target.pos.x, target.pos.y + 1.2, target.pos.z);
  fx.tracer(from, to, w.tracer, now);
  fx.muzzle(from, to.clone().sub(from).normalize(), now);
  audio.playShot('rifle', Math.min(1, dist / 40));
  if (Math.random() > hitP) return; // miss: tracer whistles past
  const part = Math.random() < 0.12 ? 'head' : 'body';
  const dmg = computeDamage('vk47', part, dist, target === player ? playerLoadout.helmet : target.loadout.helmet,
    target === player ? playerLoadout.armor > 0 : target.loadout.armor > 0);
  if (target === player) {
    damagePlayer(dmg.hp, bot);
  } else {
    const wasAlive = target.alive;
    target.hp -= dmg.hp;
    if (target.hp <= 0 && wasAlive) {
      const wasCarrier = target.carriesCharge;
      target.die();
      bot.kills += 1;
      hud.addKill(bot.name, target.name, part === 'head', bot.team);
      if (wasCarrier && target.team === 'jackal') transferCharge(target);
    }
  }
}

// --- grenades ----------------------------------------------------------------
const grenades = [];   // { pos, vel, kind, fuse, owner }
let grenadeCycle = ['frag', 'flash', 'smoke'];
let grenadeSel = 0;

function throwGrenade(kind) {
  if (!started || paused || !player.alive) return;
  if (rounds.phase !== 'live' && rounds.phase !== 'buy') return;
  if (playerLoadout.grenades[kind] <= 0) { hud.center(`No ${GRENADES[kind].name} — buy one with B`, 1.6); audio.playDeny(); return; }
  playerLoadout.grenades[kind] -= 1;
  player.eye(_shotOrigin);
  player.viewDir(_shotDir);
  grenades.push({
    pos: _shotOrigin.clone().add(_shotDir.clone().multiplyScalar(0.6)),
    vel: _shotDir.clone().multiplyScalar(13).add(new THREE.Vector3(0, 3.2, 0)),
    kind, fuse: GRENADES[kind].fuse, owner: 'player',
  });
  audio.playStep(true);
}

function cycleGrenade() {
  grenadeSel = (grenadeSel + 1) % 3;
  hud.center('Grenade: ' + GRENADES[grenadeCycle[grenadeSel]].name, 1.2);
}

function detonate(g) {
  if (g.kind === 'frag') {
    audio.playExplosion();
    fx.explosion(g.pos);
    const apply = (tx, tz, ty, isPlayer, target) => {
      const d = Math.hypot(tx - g.pos.x, tz - g.pos.z);
      if (d > GRENADES.frag.radius) return;
      const fall = 1 - d / GRENADES.frag.radius;
      const dmg = GRENADES.frag.maxDamage * (0.35 + 0.65 * fall);
      if (isPlayer) damagePlayer(dmg, null);
      else if (target) {
        target.hp -= dmg;
        if (target.hp <= 0 && target.alive) {
          const wasCarrier = target.carriesCharge;
          target.die();
          hud.addKill('You', target.name, false, 'warden');
          rounds.addKillReward(); rounds.playerKills += 1; hud.setMoney(rounds.money);
          if (wasCarrier) transferCharge(target);
        }
      }
    };
    apply(player.pos.x, player.pos.z, 0, true, null);
    for (const b of bots) if (b.alive) apply(b.pos.x, b.pos.z, 0, false, b);
    for (const b of bots) if (b.alive) b.hear(g.pos.x, g.pos.z, now);
  } else if (g.kind === 'flash') {
    audio.playFlash();
    fx.burst(g.pos, 20, 0xffffff, 3, 0.3, 1);
    const flashOne = (tx, ty, tz, isPlayer, target) => {
      const d = Math.hypot(tx - g.pos.x, tz - g.pos.z);
      if (d > GRENADES.flash.radius) return;
      if (!hasLineOfSight(g.pos.x, g.pos.y, g.pos.z, tx, ty, tz)) return;
      if (isPlayer) { player.flashUntil = now + Math.max(0.4, 2.4 - d * 0.12); }
      else if (target) { target.flashUntil = now + Math.max(0.4, 2.0 - d * 0.1); }
    };
    flashOne(player.pos.x, player.pos.y + 1.4, player.pos.z, true, null);
    for (const b of bots) if (b.alive) flashOne(b.pos.x, b.pos.y + 1.5, b.pos.z, false, b);
    if (player.flashUntil > now) hud.flashWhite(0.9);
  } else if (g.kind === 'smoke') {
    fx.smokeCloud(g.pos.x, 0.4, g.pos.z, GRENADES.smoke.life);
    audio.playStep(true);
  }
}

// --- buy / weapons -------------------------------------------------------------
function toggleBuy() {
  if (!started) return;
  const menu = document.getElementById('buyMenu');
  if (menu.style.display === 'block') { hud.hideBuy(); return; }
  if (rounds.phase !== 'buy') { hud.center('Buy phase is over — fight with what you have', 2); return; }
  const onBuy = (id) => {
    const r = buyItem(playerLoadout, rounds.money, id);
    if (!r.ok) { audio.playDeny(); hud.center(r.reason, 1.6); return; }
    rounds.money -= r.cost;
    hud.setMoney(rounds.money);
    audio.playBuy();
    hud.showBuy(rounds.money, playerLoadout, onBuy);
    refreshWeaponHud();
  };
  hud.showBuy(rounds.money, playerLoadout, onBuy);
}

function switchWeapon(slot) {
  if (!started || !player.alive) return;
  const id = slot === 'primary' ? playerLoadout.primary : 'p9';
  if (!playerLoadout.owned[id] || playerLoadout.current === id) return;
  playerLoadout.current = id;
  playerLoadout.reloading = false;
  player.zoomed = false;
  refreshWeaponHud();
}

function tryReload() {
  if (!started || !player.alive) return;
  if (startReload(playerLoadout, now)) audio.playReload();
}

function refreshWeaponHud() {
  const id = playerLoadout.current;
  hud.setAmmo(playerLoadout.mag[id], playerLoadout.reserve[id], WEAPONS[id].name, playerLoadout.reloading);
}

function toggleScoreboard(show) {
  if (!started) return;
  if (show) {
    const rows = [{ name: 'You', team: 'warden', kills: rounds.playerKills, deaths: rounds.playerDeaths, money: rounds.money }];
    for (const b of bots) rows.push({ name: b.name, team: b.team, kills: b.kills, deaths: b.deaths, money: 0 });
    rows.sort((a, b) => b.kills - a.kills);
    hud.showScoreboard(rows, rounds.scoreW, rounds.scoreJ);
  } else hud.hideScoreboard();
}

// --- bot context ---------------------------------------------------------------
const botCtx = {
  get now() { return now; },
  player,
  bots,
  sites,
  get planted() { return rounds.charge.planted; },
  get plantSite() { return rounds.charge.site; },
  hasLineOfSight,
  smokeBlocks: (ax, ay, az, bx, by, bz) => fx.smokeBlocks(ax, ay, az, bx, by, bz),
  onBotShot,
  onContact: (bot) => {
    const lane = bot.pos.z < -8 ? 'A-long' : bot.pos.z > 8 ? 'B-tunnel' : 'mid';
    hud.addComms(`${bot.name}: contact ${lane}!`, bot.team);
  },
  onPlantStart: (bot) => {
    const site = bot.role === 'carrierB' ? 'B' : 'A';
    hud.objective(`CHARGE BEING PLANTED — SITE ${site}`, '#ff5a4a');
    audio.playPlant();
  },
  onPlantTick: (bot, frac) => { hud.setChannel('PLANTING CHARGE — SITE ' + (bot.role === 'carrierB' ? 'B' : 'A'), frac); },
  onPlantCancel: () => { hud.setChannel(null); hud.objective(''); },
  onPlanted: (bot) => {
    const site = bot.role === 'carrierB' ? 'B' : 'A';
    rounds.plantCharge(site, bot);
    chargeMesh.position.set(sites[site].cx, 0.35, sites[site].cz);
    chargeMesh.visible = true;
    chargeLight.position.set(sites[site].cx, 1.2, sites[site].cz);
    chargeLight.visible = true;
    hud.setChannel(null);
    hud.objective('CHARGE PLANTED — DEFUSE IT!', '#ff5a4a');
    hud.center(`Charge planted on Site ${site} — defuse before the fuse blows!`, 4);
    audio.playBeep(true);
  },
  onDefuseStart: (bot) => { hud.objective(`${bot.name.toUpperCase()} IS DEFUSING`, '#7fd47a'); },
  onDefuseTick: (bot, frac) => { hud.setChannel(bot.name.toUpperCase() + ' DEFUSING…', frac); },
  onDefuseCancel: () => { hud.setChannel(null); },
  onDefused: (bot) => {
    rounds.defuseCharge();
    chargeMesh.visible = false;
    chargeLight.visible = false;
    hud.setChannel(null);
    endRound('warden', `${bot.name} defused the charge`);
  },
};

// --- round flow -----------------------------------------------------------------
function endRound(winner, reason) {
  const { moneyDelta } = rounds.endRound(winner, reason);
  hud.setMoney(rounds.money);
  hud.setScore(rounds.scoreW, rounds.scoreJ, rounds.round);
  hud.objective('');
  const youWon = winner === 'warden';
  // Full round-end panel (replaces the old transient banner): the round's
  // verdict, reason, score, money delta and the next-round countdown
  // stay on screen for the whole end phase, so a screenshot can prove
  // "the round ends, then the next one starts" — the old 4-second
  // banner could not.
  hud.showRoundEnd(
    youWon ? 'ROUND WON' : 'ROUND LOST',
    reason,
    rounds.scoreLine,
    `${moneyDelta >= 0 ? '+' : ''}$${moneyDelta}  ·  money $${rounds.money}`,
    youWon ? '#7fd47a' : '#ff5a4a',
  );
  hud.setRoundEndCountdown(rounds.phaseT);
  if (youWon) audio.playRoundWin(); else audio.playRoundLose();
  // Deaths reset loadouts: weapons are lost when you die.
  if (!player.alive) {
    const keep = playerLoadout.grenades;
    Object.assign(playerLoadout, freshLoadout());
    playerLoadout.grenades = keep;
  }
  for (const b of bots) if (!b.alive) b.loadout = freshLoadout();
  if (rounds.winner) {
    setTimeout(() => {
      hud.banner(rounds.winner === 'warden' ? 'WARDENS WIN THE MATCH' : 'JACKALS WIN THE MATCH',
        `Final score ${rounds.scoreW} — ${rounds.scoreJ}. A new match begins.`, '#ffb347', 6);
      setTimeout(() => { rounds.resetMatch(); hud.setScore(0, 0, 1); hud.setMoney(rounds.money); resetRoundPositions(); rounds.startRound(); }, 2000);
    }, ROUND.endSeconds * 1000);
  }
}

// --- fixed-step simulation ---------------------------------------------------------
let acc = 0;
let mapAcc = 0;   // minimap / weapon-card refresh accumulator (10 Hz)
let lastT = performance.now();

function simulate(dt) {
  now += dt;
  // Reload completion.
  if (playerLoadout.reloading && now >= playerLoadout.reloadEnd) {
    finishReload(playerLoadout);
    refreshWeaponHud();
  }
  playerLoadout.bloom = Math.max(0, playerLoadout.bloom - dt * 1.4);

  // Round timer events.
  const ev = rounds.update(dt, {
    wardensAlive: (player.alive ? 1 : 0) + wardens.filter(b => b.alive).length,
    jackalsAlive: jackals.filter(b => b.alive).length,
    playerAlive: player.alive,
  });
  if (ev === 'live') {
    hud.banner(`ROUND ${rounds.round}`, 'Go — take the sites', '#e9e6df', 2);
    hud.center('', 0);
  } else if (ev === 'timeout') {
    endRound('warden', 'Time expired — the charge was never planted');
  } else if (ev === 'explode') {
    chargeMesh.visible = false; chargeLight.visible = false;
    audio.playExplosion();
    fx.explosion(chargeMesh.position);
    endRound('jackal', 'The charge detonated');
  } else if (ev === 'elimW') {
    endRound('warden', 'Jackal squad eliminated');
  } else if (ev === 'elimJ') {
    endRound('jackal', 'Warden squad eliminated');
  } else if (ev === 'nextRound') {
    resetRoundPositions();
    hud.hideRoundEnd();
    hud.setScore(rounds.scoreW, rounds.scoreJ, rounds.round);
    hud.banner(`ROUND ${rounds.round}`, 'Buy phase — press B for the buy menu', '#7fd4ff', 2.5);
  } else if (ev === 'matchOver') {
    // handled by endRound's timeout chain
  }

  // Player movement.
  const input = {
    f: keys.has('KeyW') || keys.has('ArrowUp'),
    b: keys.has('KeyS') || keys.has('ArrowDown'),
    l: keys.has('KeyA') || keys.has('ArrowLeft'),
    r: keys.has('KeyD') || keys.has('ArrowRight'),
    jump: keys.has('Space'),
    slow: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    crouch: keys.has('ControlLeft') || keys.has('ControlRight'),
  };
  player.crouched = input.crouch;
  if (started && !paused && player.alive) {
    const moved = player.update(dt, input, now);
    if (player.stepAcc > 2.2) { player.stepAcc = 0; audio.playStep(input.slow); }
    // Firing (hold for auto weapons).
    const w = WEAPONS[playerLoadout.current];
    if (firing && (w.auto || mouseDown)) playerShoot();
    if (!w.auto) firing = false;
  }

  // Grenades in flight.
  for (let i = grenades.length - 1; i >= 0; i--) {
    if (stepGrenade(grenades[i], dt)) {
      detonate(grenades[i]);
      grenades.splice(i, 1);
    }
  }

  // Bots only act while the round is live: during the buy phase they
  // hold at spawn, and during the end banner they freeze.
  if (started && !paused && rounds.phase === 'live') {
    for (const b of bots) b.update(dt, botCtx);
  }

  // Player plant/defuse channel (hold E).
  if (started && !paused && player.alive && keys.has('KeyE')) {
    if (rounds.charge.planted) {
      const site = sites[rounds.charge.site];
      const d = Math.hypot(player.pos.x - site.cx, player.pos.z - site.cz);
      if (d < 4) {
        player.defuseT = (player.defuseT || 0) + dt;
        const need = playerLoadout.kit ? 2.5 : 5;
        hud.setChannel('DEFUSING CHARGE…', player.defuseT / need);
        if (player.defuseT >= need) {
          player.defuseT = 0;
          rounds.defuseCharge();
          chargeMesh.visible = false; chargeLight.visible = false;
          hud.setChannel(null);
          endRound('warden', 'You defused the charge');
        }
      }
    }
  } else {
    player.defuseT = 0;
    if (rounds.phase === 'live' && !rounds.charge.planted) hud.setChannel(null);
  }

  // Charge beep while planted.
  if (rounds.charge.planted && Math.floor(now * 2) !== Math.floor((now - dt) * 2)) audio.playBeep();

  // HUD refresh.
  const w = WEAPONS[playerLoadout.current];
  hud.setHealth(player.hp, playerLoadout.armor);
  hud.setAmmo(playerLoadout.mag[playerLoadout.current], playerLoadout.reserve[playerLoadout.current], w.name, playerLoadout.reloading);
  hud.setMoney(rounds.money);
  hud.setScore(rounds.scoreW, rounds.scoreJ, rounds.round);
  if (rounds.charge.planted) hud.setTimer(rounds.charge.fuse, 'live');
  else hud.setTimer(rounds.phaseT, rounds.phase);
  if (rounds.phase === 'buy' && !hud.buyOpen) hud.objective('BUY PHASE — press B to buy', '#7fd4ff');
  else if (rounds.phase === 'live' && !hud.channelActive()) {
    // Persistent objective in live play — v2 blanked this line, so the
    // action screenshots carried no statement of what to do. The
    // top entries always show their objective mid-fight.
    if (rounds.charge.planted) hud.objective(`CHARGE PLANTED — DEFUSE IT AT SITE ${rounds.charge.site}!`, '#ff5a4a');
    else hud.objective('DEFEND THE SITES — STOP THE CARRIER', '#ffb347');
  }
  if (rounds.phase === 'end') hud.setRoundEndCountdown(rounds.phaseT);
  const spreadPx = 10 + (playerLoadout.bloom * 14) + (player.moving ? 6 : 0);
  hud.setCrosshair(spreadPx, player.alive && started && !paused);
  const blind = player.flashUntil > now;
  document.getElementById('flash').style.opacity = blind ? '0.95' : '';
  hud.update(dt);
  // Slow HUD (10 Hz): minimap + weapon card + damage-number pruning —
  // canvas redraws and DOM writes are wasted work every tick.
  mapAcc += dt;
  if (mapAcc >= 0.1) {
    mapAcc = 0;
    hud.drawMinimap(player, bots, rounds.charge.planted, rounds.charge.site);
    hud.setWeaponCard(playerLoadout);
    hud.pruneDamageNumbers(now);
    updateNameplates();
  }
}

// Enemy nameplates: Jackals the player can actually see (in front,
// in range, line of sight). Projected head position → screen. Refreshed
// at 10 Hz, and immediately after the player shoots, so the HP bar never
// lags a full shot behind the damage number on screen.
function updateNameplates() {
  const plates = [];
  for (const b of jackals) {
    if (!b.alive) continue;
    const dist = Math.hypot(b.pos.x - camera.position.x, b.pos.z - camera.position.z);
    if (dist > 45) continue;
    _plateV.set(b.pos.x, 2.05, b.pos.z).project(camera);
    if (_plateV.z > 1) continue;   // behind the camera
    if (!hasLineOfSight(camera.position.x, camera.position.y, camera.position.z, b.pos.x, 1.4, b.pos.z)) continue;
    plates.push({
      sx: (_plateV.x * 0.5 + 0.5) * window.innerWidth,
      sy: (-_plateV.y * 0.5 + 0.5) * window.innerHeight - 6,
      name: b.name, hp: b.hp, carrier: b.carriesCharge,
    });
  }
  hud.updateNameplates(plates);
}

function render() {
  // Camera follows the player's eye; scope zooms the FOV.
  player.eye(camera.position);
  camera.rotation.y = player.yaw + player.recoilYaw * 0.4;
  camera.rotation.x = player.pitch + player.recoilPitch * 0.4;
  const targetFov = player.zoomed ? 74 / (WEAPONS[playerLoadout.current].zoom || 1) : 74;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * 0.25;
    camera.updateProjectionMatrix();
  }
  // Viewmodel bob + recoil kick.
  const bob = player.moving ? Math.sin(now * 11) * 0.012 : 0;
  viewGun.position.y = -0.26 + bob;
  viewGun.position.x = 0.3 + (player.zoomed ? -0.15 : 0);
  viewKick *= 0.85;
  viewGun.position.z = -0.62 + viewKick;
  viewGun.visible = player.alive;
  fx.update(now, 1 / 60, camera);
  renderer.render(scene, camera);
}

function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  if (started && !paused && !frozen) {
    acc += dt;
    let steps = 0;
    while (acc >= FIXED_DT && steps < 5) { simulate(FIXED_DT); acc -= FIXED_DT; steps += 1; }
    if (steps === 5) acc = 0;
  }
  render();
}

// --- screenshot / debug hooks -----------------------------------------------------
// ?shot=action|buy|site|score|end stages a deterministic scene for screenshots.
// ?autoplay=1 skips the start screen (headless playtest).
window.__bastion = {
  get state() {
    return {
      started, paused, now,
      phase: rounds.phase, round: rounds.round,
      scoreW: rounds.scoreW, scoreJ: rounds.scoreJ,
      money: rounds.money,
      playerHp: player.hp, playerAlive: player.alive,
      playerPos: [player.pos.x, player.pos.y, player.pos.z],
      wardensAlive: wardens.filter(b => b.alive).length,
      jackalsAlive: jackals.filter(b => b.alive).length,
      planted: rounds.charge.planted, plantSite: rounds.charge.site,
      fuse: rounds.charge.fuse,
      bots: bots.map(b => ({ name: b.name, team: b.team, hp: Math.round(b.hp), alive: b.alive, state: b.state, x: +b.pos.x.toFixed(1), z: +b.pos.z.toFixed(1) })),
    };
  },
  teleport(x, z, yaw) { player.pos.set(x, 0, z); if (yaw !== undefined) player.yaw = yaw; },
  lookAt(x, z) { player.yaw = Math.atan2(-(x - player.pos.x), -(z - player.pos.z)); },
  giveMoney(n) { rounds.money += n; },
  forcePlant(site) {
    rounds.plantCharge(site, null);
    chargeMesh.position.set(sites[site].cx, 0.35, sites[site].cz);
    chargeMesh.visible = true;
    chargeLight.position.set(sites[site].cx, 1.2, sites[site].cz);
    chargeLight.visible = true;
    hud.objective('CHARGE PLANTED — DEFUSE IT!', '#ff5a4a');
  },
  openBuy() { if (rounds.phase === 'buy') toggleBuy(); },
  showScoreboard() { toggleScoreboard(true); },
  shoot() { playerShoot(); },
  // Freeze/unfreeze the game clock (no pause screen) for screenshots.
  freeze() { frozen = true; },
  unfreeze() { frozen = false; },
  // Debug: flash + live tracer state (visibility, opacity, placement).
  fxDebug() {
    return {
      now: +now.toFixed(3),
      flash: { visible: fx.flash.visible, opacity: +fx.flash.material.opacity.toFixed(2), until: +fx.flashUntil.toFixed(3), pos: fx.flash.position.toArray().map((v) => +v.toFixed(2)) },
      tracers: fx.tracers.filter((t) => t.mesh.visible).map((t) => ({
        op: +t.mesh.material.opacity.toFixed(2), until: +t.until.toFixed(3),
        pos: t.mesh.position.toArray().map((v) => +v.toFixed(2)),
        scale: t.mesh.scale.toArray().map((v) => +v.toFixed(2)),
        rotY: +t.mesh.rotation.y.toFixed(2),
      })),
    };
  },
  // Defuse win via the exact code path the E-key completion takes
  // (defuseCharge + hide charge + endRound) — used by the 'end' stage.
  defuseWin() {
    rounds.defuseCharge();
    chargeMesh.visible = false; chargeLight.visible = false;
    hud.setChannel(null);
    endRound('warden', 'You defused the charge');
  },
  start: startGame,
  player, rounds, bots,
};

function stageShot(kind) {
  startGame();
  // The deploy banner + centre message are for real players; screenshots
  // need a clean frame, so clear them immediately after staging.
  hud.banner('', '', '#e9e6df', 0.01);
  hud.center('', 0);
  hud.objective('', '#ffb347');
  // Every staged state is honest about the economy: round, score, kills
  // and money are set to values a real match could have produced (start
  // $800, win +$3,250, loss +$1,900, kill +$300, minus the buys shown).
  if (kind === 'action') {
    // Close fight at Site A: the carrier (red charge pack on his back)
    // is 7 m out, a second Jackal guards the site, a Warden holds mid.
    // The player owns the VK-47 + kevlar bought after winning round 1:
    // 800 + 3250 + 2x300 - 2700 - 650 = $1,300.
    rounds.phase = 'live'; rounds.phaseT = 92;
    rounds.round = 2; rounds.scoreW = 1; rounds.scoreJ = 0;
    rounds.playerKills = 2; rounds.money = 1300;
    playerLoadout.primary = 'vk47';
    playerLoadout.owned = { p9: true, vk47: true };
    playerLoadout.mag = { p9: 12, vk47: 30 };
    playerLoadout.reserve = { p9: 36, vk47: 90 };
    playerLoadout.current = 'vk47';
    playerLoadout.armor = 100; playerLoadout.helmet = true;
    hud.setMoney(1300);
    refreshWeaponHud();
    player.pos.set(13, 0, -16);
    // Aim at the carrier's torso (20, 0.95, -17): the player no longer
    // shares the carrier's z, so due-east yaw would miss 1 m to the side.
    player.yaw = Math.atan2(-(20 - 13), -(-17 + 16));
    player.pitch = Math.atan2(0.95 - 1.62, 7.07);
    jackals[0].pos.set(20, 0, -17); jackals[0].yaw = Math.PI / 2;
    jackals[0].carriesCharge = true; jackals[0].role = 'carrierA';
    jackals[0].state = 'hold'; jackals[0].holdUntil = now + 999;
    jackals[1].pos.set(24, 0, -14); jackals[1].yaw = Math.PI / 2;
    jackals[1].state = 'hold'; jackals[1].holdUntil = now + 999;
    wardens[0].pos.set(2, 0, -13); wardens[0].yaw = -Math.PI / 2;
    wardens[0].state = 'hold'; wardens[0].holdUntil = now + 999;
    hud.objective('DEFEND SITE A — STOP THE CARRIER', '#ff5a4a');
    hud.addKill('You', 'Rook', true, 'warden');
    hud.addKill('Fang', 'Hale', false, 'jackal');
    // Squad comms as the live game produces them when a bot sights the
    // player (bots are frozen for the shot, so stage the same line).
    hud.addComms('Rook: contact A-long!', 'jackal');
  } else if (kind === 'buy') {
    // Round 3, 1-1, four kills, Hornet bought in round 2:
    // 800 + 3250 + 1900 + 4x300 - 1500 = $5,650.
    rounds.round = 3; rounds.scoreW = 1; rounds.scoreJ = 1;
    rounds.playerKills = 4; rounds.money = 5650;
    playerLoadout.primary = 'hornet';
    playerLoadout.owned = { p9: true, hornet: true };
    playerLoadout.mag = { p9: 12, hornet: 30 };
    playerLoadout.reserve = { p9: 36, hornet: 120 };
    playerLoadout.current = 'hornet';
    refreshWeaponHud();
    rounds.phase = 'buy'; rounds.phaseT = 12;
    player.pos.set(-28, 0, 0); player.yaw = -Math.PI / 2;
    hud.setMoney(5650);
    hud.showBuy(rounds.money, playerLoadout, (id) => {
      const r = buyItem(playerLoadout, rounds.money, id);
      if (r.ok) { rounds.money -= r.cost; hud.setMoney(rounds.money); refreshWeaponHud(); }
    });
  } else if (kind === 'site') {
    // Player inside defuse range (2.9 m from the charge — the rule needs
    // under 4 m), fuse ticking, Jackal guarding the site.
    rounds.phase = 'live'; rounds.phaseT = 60;
    window.__bastion.forcePlant('A');
    player.pos.set(21.5, 0, -14.5);
    player.yaw = Math.atan2(-(24 - 21.5), -(-16 + 14.5));
    player.pitch = Math.atan2(0.8 - 1.62, 2.92);
    jackals[2].pos.set(27, 0, -19); jackals[2].yaw = Math.PI / 2; jackals[2].state = 'hold'; jackals[2].holdUntil = now + 999;
    player.defuseT = 1.8;
    hud.setChannel('DEFUSING CHARGE…', 1.8 / 5);
  } else if (kind === 'end') {
    // Round 1 won by defusing the charge at Site A: the charge was
    // planted (real forcePlant), then defused through the exact E-key
    // completion path (defuseWin). The round-end panel now states the
    // verdict, the reason, the score, the money delta and the
    // next-round countdown — the live proof that a round ends and the
    // next one starts. Player +$3,250 for the win.
    rounds.phase = 'live'; rounds.phaseT = 60;
    window.__bastion.forcePlant('A');
    // Stand back west of the site looking across it: the SITE A wall
    // sign reads in full behind the panel (it proves the site), the
    // site ring + guard bot fill the frame behind the panel.
    player.pos.set(15, 0, -13);
    player.yaw = Math.atan2(-(24 - 15), -(-16 + 13));
    player.pitch = Math.atan2(0.8 - 1.62, 9.5);
    jackals[2].pos.set(27, 0, -19); jackals[2].yaw = Math.PI / 2; jackals[2].state = 'hold'; jackals[2].holdUntil = now + 999;
    hud.addKill('You', 'Rook', true, 'warden');
    hud.addComms('Mira: defusing now!', 'warden');
    window.__bastion.defuseWin();
  } else if (kind === 'score') {
    rounds.scoreW = 4; rounds.scoreJ = 3; rounds.round = 8;
    rounds.playerKills = 9; rounds.playerDeaths = 4;
    rounds.money = 2850;
    wardens[0].kills = 5; wardens[0].deaths = 3;
    wardens[1].kills = 3; wardens[1].deaths = 5;
    jackals[0].kills = 7; jackals[0].deaths = 4;
    jackals[1].kills = 4; jackals[1].deaths = 6;
    hud.addKill('You', 'Ash', true, 'warden');
    hud.addKill('You', 'Nyx', false, 'warden');
    hud.addKill('Grit', 'Mira', false, 'jackal');
    toggleScoreboard(true);
  }
  // Freeze every bot for the screenshot: held in place and flash-blinded
  // so no staged scene can turn into a firefight (and a death banner)
  // before the shutter. The staged bots above are already holding.
  for (const b of bots) {
    b.state = 'hold';
    b.holdUntil = now + 999;
    b.flashUntil = now + 999;
    b.enemy = null;
  }
  window.__shotReady = true;
}

if (AUTOPLAY) {
  if (SHOT) stageShot(SHOT);
  else startGame();
}

requestAnimationFrame(frame);
