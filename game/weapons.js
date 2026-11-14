// BASTION PROTOCOL — weapons.js
// Weapon definitions and the shared combat math: hit zones, spread,
// recoil, reload, and grenade flight. Player and bots both go through
// these helpers so the gunplay rules are identical on both sides.

import { WEAPONS, GRENADES } from './config.js';

export { WEAPONS, GRENADES };

// A fresh loadout for a combatant: primary slot starts as the pistol;
// bought weapons replace the primary. `owned` is the set of weapon ids
// the combatant currently carries (losing a round wipes it for the player).
export function freshLoadout() {
  return {
    primary: 'p9',
    owned: { p9: true },
    mag: { p9: WEAPONS.p9.mag },
    reserve: { p9: WEAPONS.p9.reserve },
    armor: 0,          // 0 | 50 | 100 armour points
    helmet: false,
    kit: false,        // defuse kit (halves defuse time)
    grenades: { frag: 0, flash: 0, smoke: 0 },
    current: 'p9',
    reloading: false,
    reloadEnd: 0,
    lastShot: -99,
    bloom: 0,          // 0..1 extra spread from firing
    recoil: 0,         // accumulated recoil, decays when not firing
  };
}

// Damage for one pellet hitting a body zone at a given range.
// Zones: 'head' | 'body' | 'legs'. Armour soaks half of body damage;
// a helmet cuts headshot multiplier from 3.5 to 2.
export function computeDamage(weaponId, zone, range, hasHelmet, hasArmor) {
  const w = WEAPONS[weaponId];
  let dmg = w.damage;
  if (zone === 'head') dmg *= hasHelmet ? 2 : w.headMult;
  else if (zone === 'legs') dmg *= 0.75;
  // Falloff past half the weapon's range, down to 55% at max range.
  if (range > w.range * 0.5) {
    const t = Math.min(1, (range - w.range * 0.5) / (w.range * 0.5));
    dmg *= 1 - 0.45 * t;
  }
  let armorSoak = 0;
  if (hasArmor && zone !== 'head') armorSoak = Math.min(dmg * 0.5, 50);
  return { hp: dmg - armorSoak, armor: armorSoak };
}

// Current spread (radians) for a weapon given the shooter's state.
// Moving punishes: +60% while moving, -30% while crouched, +bloom while
// firing. Standing still for 0.4 s lets bloom settle (caller decays it).
export function currentSpread(weaponId, loadout, moving, crouched, airborne) {
  const w = WEAPONS[weaponId];
  let s = w.spread + loadout.bloom * 0.02;
  if (moving) s += w.moveSpread * 0.6;
  if (crouched) s *= 0.7;
  if (airborne) s += 0.03;
  return s;
}

// Can this loadout fire right now? (mag, reload, fire interval)
export function canFire(loadout, now) {
  const w = WEAPONS[loadout.current];
  if (loadout.reloading) return false;
  if (loadout.mag[loadout.current] <= 0) return false;
  return now - loadout.lastShot >= w.fireInterval;
}

export function startReload(loadout, now) {
  const id = loadout.current;
  const w = WEAPONS[id];
  if (loadout.reloading) return false;
  if (loadout.mag[id] >= w.mag) return false;
  if (loadout.reserve[id] <= 0) return false;
  loadout.reloading = true;
  loadout.reloadEnd = now + w.reload;
  return true;
}

export function finishReload(loadout) {
  const id = loadout.current;
  const w = WEAPONS[id];
  const need = w.mag - loadout.mag[id];
  const take = Math.min(need, loadout.reserve[id]);
  loadout.mag[id] += take;
  loadout.reserve[id] -= take;
  loadout.reloading = false;
}

// Buy a weapon/item. Returns { ok, reason } — money is deducted by the
// caller only when ok. Grenades stack; weapons replace the primary slot.
export function buyItem(loadout, money, itemId) {
  if (WEAPONS[itemId]) {
    const w = WEAPONS[itemId];
    if (money < w.price) return { ok: false, reason: 'Not enough money' };
    if (loadout.owned[itemId]) return { ok: false, reason: 'Already owned' };
    loadout.owned[itemId] = true;
    loadout.primary = itemId;
    loadout.current = itemId;
    loadout.mag[itemId] = w.mag;
    loadout.reserve[itemId] = w.reserve;
    return { ok: true, cost: w.price };
  }
  if (itemId === 'armor') {
    if (money < 650) return { ok: false, reason: 'Not enough money' };
    if (loadout.armor >= 100) return { ok: false, reason: 'Armour full' };
    loadout.armor = 100; loadout.helmet = true;
    return { ok: true, cost: 650 };
  }
  if (itemId === 'kit') {
    if (money < 400) return { ok: false, reason: 'Not enough money' };
    if (loadout.kit) return { ok: false, reason: 'Already owned' };
    loadout.kit = true;
    return { ok: true, cost: 400 };
  }
  if (GRENADES[itemId]) {
    const g = GRENADES[itemId];
    if (money < g.price) return { ok: false, reason: 'Not enough money' };
    if (loadout.grenades[itemId] >= 2) return { ok: false, reason: 'Carrying max' };
    loadout.grenades[itemId] += 1;
    return { ok: true, cost: g.price };
  }
  return { ok: false, reason: 'Unknown item' };
}

// Grenade flight: simple ballistic step. `g` = { pos: Vector3-like,
// vel: Vector3-like, kind, fuse }. Ground bounce with damping; the
// caller detonates when fuse hits 0.
export function stepGrenade(g, dt) {
  g.vel.y -= 14.5 * dt;
  g.pos.x += g.vel.x * dt;
  g.pos.y += g.vel.y * dt;
  g.pos.z += g.vel.z * dt;
  if (g.pos.y < 0.12) {
    g.pos.y = 0.12;
    g.vel.y = -g.vel.y * 0.35;
    g.vel.x *= 0.6; g.vel.z *= 0.6;
  }
  g.fuse -= dt;
  return g.fuse <= 0;
}
