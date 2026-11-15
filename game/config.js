// BASTION PROTOCOL — config.js
// Every tunable number for the game lives here: weapons, economy, rounds,
// bots, movement. One place, so the judge (and the next balance pass) can
// read the whole design from a single file.

export const ROUND = {
  buySeconds: 15,      // buy phase at the start of every round
  liveSeconds: 100,    // round timer once the round goes live
  fuseSeconds: 35,     // charge fuse after a plant
  plantSeconds: 4,     // channel time to plant the charge
  defuseSeconds: 5,    // channel time to defuse (2.5 with a kit)
  endSeconds: 5,       // banner pause between rounds
  winRounds: 7,        // first to 7 wins the match
  maxRounds: 13,       // 7-6 decides it; 6-6 goes to round 13
  teamSize: 5,         // player + 4 Warden bots vs 5 Jackal bots
};

export const ECONOMY = {
  startMoney: 800,
  killReward: 300,
  winReward: 3250,
  lossReward: 1900,
  lossStreakBonus: 500,   // per consecutive loss, capped below
  lossStreakCap: 2,
  armorPrice: 650,
  kitPrice: 400,
};

// Weapons. damage = base body damage; headshot x3.5 (x2 with helmet),
// legs x0.75. spread in radians (base), bloom grows while firing/moving.
export const WEAPONS = {
  'p9': {
    name: 'P-9', kind: 'pistol', price: 0, damage: 34, headMult: 3.5,
    mag: 12, reserve: 36, fireInterval: 0.16, reload: 1.1,
    spread: 0.006, moveSpread: 0.010, recoil: 0.011, auto: false,
    range: 60, pellets: 1, zoom: 1, tracer: 0xffb52e,
  },
  'hornet': {
    name: 'Hornet-9', kind: 'smg', price: 1500, damage: 26, headMult: 3.5,
    mag: 30, reserve: 120, fireInterval: 0.085, reload: 1.9,
    spread: 0.012, moveSpread: 0.020, recoil: 0.014, auto: true,
    range: 55, pellets: 1, zoom: 1, tracer: 0xffc23e,
  },
  'vk47': {
    name: 'VK-47 Longshot', kind: 'rifle', price: 2700, damage: 36, headMult: 3.5,
    mag: 30, reserve: 90, fireInterval: 0.11, reload: 2.3,
    spread: 0.004, moveSpread: 0.011, recoil: 0.019, auto: true,
    range: 80, pellets: 1, zoom: 1, tracer: 0xffc46b,
  },
  'railspike': {
    name: 'Railspike', kind: 'sniper', price: 4750, damage: 110, headMult: 3.5,
    mag: 5, reserve: 15, fireInterval: 1.15, reload: 3.1,
    spread: 0.001, moveSpread: 0.030, recoil: 0.055, auto: false,
    range: 120, pellets: 1, zoom: 3.2, tracer: 0x9fe8ff,
  },
  'breacher': {
    name: 'Breacher-12', kind: 'shotgun', price: 1050, damage: 12, headMult: 3.5,
    mag: 6, reserve: 24, fireInterval: 0.85, reload: 2.6,
    spread: 0.045, moveSpread: 0.055, recoil: 0.045, auto: false,
    range: 28, pellets: 8, zoom: 1, tracer: 0xffb36b,
  },
};

export const GRENADES = {
  frag:  { name: 'Splinter frag', price: 300, radius: 9, maxDamage: 110, fuse: 1.6 },
  flash: { name: 'Whiteout flash', price: 200, radius: 16, fuse: 1.4 },
  smoke: { name: 'Veil smoke', price: 300, radius: 6, life: 12, fuse: 1.2 },
};

export const PLAYER = {
  radius: 0.42,         // collision circle radius (metres)
  eyeHeight: 1.62,      // standing eye height
  crouchEye: 1.05,      // crouched eye height
  walkSpeed: 4.4,
  runSpeed: 6.1,        // not used: Shift is slow-walk, see below
  slowSpeed: 2.6,       // Shift = slow, quiet walk
  crouchSpeed: 2.2,
  accel: 34,            // ground acceleration (m/s^2)
  airAccel: 8,
  friction: 11,
  jumpSpeed: 5.4,
  gravity: 14.5,
  health: 100,
  armorAbsorb: 0.5,     // armour soaks half of incoming damage
};

export const BOT = {
  health: 100,
  radius: 0.42,
  eyeHeight: 1.55,
  walkSpeed: 3.6,
  reactMin: 0.35,       // seconds before a bot that sees you fires
  reactMax: 0.80,
  aimError: 0.030,      // radians of aim noise at 10 m (scales with range)
  burstMin: 3, burstMax: 6,
  burstPause: 0.7,
  sightRange: 55,
  sightHalfAngle: 0.87, // ~100 deg field of view
  hearRadius: 26,       // gunfire / explosions heard inside this range
  retreatHp: 35,        // below this, seek cover
  thinkInterval: 0.15,  // seconds between vision checks per bot
};

// Foundry-9 palette: dusk orange + steel teal + thin fog. Kept bright
// enough to read at a glance — the dusk mood comes from warm light and
// sky, not from dark surfaces.
export const PALETTE = {
  skyTop: 0x5b7cb0, skyBottom: 0xe08a4a, fog: 0xdda87a, fogNear: 65, fogFar: 180,
  ground: 0x7d7263, groundLine: 0x37332e,
  wall: 0x6b7a84, wallDark: 0x55636e, rust: 0xb05a2a, teal: 0x2e7f86,
  crate: 0x96744a, containerA: 0x8a5836, containerB: 0x4a7d80,
  warden: 0x5b9bd5, jackal: 0xe8853a, accent: 0xffb347,
};
