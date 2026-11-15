// BASTION PROTOCOL — hud.js
// Every DOM overlay: health, ammo, timer, score, money, crosshair,
// killfeed, hitmarker, damage direction, round banner, buy menu,
// scoreboard, objective messages, minimap, floating damage numbers.
// The HUD is plain DOM/CSS — sharp, cheap, and exactly what the
// screenshots show.

import { WEAPONS, GRENADES } from './config.js';

// Minimap world bounds (Foundry-9 is 76 x 56 m, sites at x=24).
const MAP_MIN_X = -38, MAP_MAX_X = 38, MAP_MIN_Z = -28, MAP_MAX_Z = 28;

export class HUD {
  constructor(root) {
    this.el = {};
    const ids = ['health', 'healthBar', 'armor', 'ammoMag', 'ammoRes', 'weaponName',
      'weaponSlots', 'timer', 'score', 'money', 'roundLabel', 'crosshair', 'hitmarker', 'killfeed',
      'banner', 'bannerSub', 'objective', 'buyMenu', 'buyList', 'scoreboard',
      'scoreRows', 'flash', 'damageDir', 'reloadHint', 'hint', 'plantBar', 'plantFill',
      'plantLabel', 'centerMsg', 'armorBarWrap', 'armorBar', 'minimap', 'dmgLayer'];
    for (const id of ids) this.el[id] = root.querySelector('#' + id);
    this.killfeedTimer = 0;
    this.bannerTimer = 0;
    this.damageTimer = 0;
    this.hitTimer = 0;
    this._mm = this.el.minimap.getContext('2d');
    this._dmgCount = 0;
  }

  setHealth(hp, armor) {
    this.el.health.textContent = Math.max(0, Math.ceil(hp));
    this.el.healthBar.style.width = Math.max(0, hp) + '%';
    this.el.healthBar.style.background = hp > 50 ? '#7fd47a' : hp > 25 ? '#ffb347' : '#ff5a4a';
    this.el.armorBarWrap.style.display = armor > 0 ? 'block' : 'none';
    this.el.armorBar.style.width = Math.max(0, Math.min(100, armor)) + '%';
    this.el.armor.textContent = armor > 0 ? 'KEVLAR ' + Math.ceil(armor) : '';
  }

  // Weapon card: slots (1 = primary when bought, 2 = pistol), defuse
  // kit, grenades. A pistol-only loadout shows one slot, not a duplicate.
  setWeaponCard(loadout) {
    const slots = [];
    if (loadout.primary !== 'p9' && loadout.owned[loadout.primary]) {
      slots.push(loadout.current === loadout.primary ? `<b>1 ${WEAPONS[loadout.primary].name}</b>` : `1 ${WEAPONS[loadout.primary].name}`);
    }
    slots.push(loadout.current === 'p9' ? '<b>2 P-9</b>' : '2 P-9');
    if (loadout.kit) slots.push('KIT ✓');
    const g = loadout.grenades;
    slots.push(`FRAG ${g.frag} · FLASH ${g.flash} · SMOKE ${g.smoke}`);
    this.el.weaponSlots.innerHTML = slots.join(' &nbsp;·&nbsp; ');
  }

  setAmmo(mag, reserve, name, reloading) {
    this.el.ammoMag.textContent = mag;
    this.el.ammoRes.textContent = '/ ' + reserve;
    this.el.weaponName.textContent = name;
    this.el.reloadHint.style.display = reloading ? 'block' : 'none';
    this.el.reloadHint.textContent = reloading ? 'RELOADING…' : '';
  }

  setTimer(sec, phase) {
    const s = Math.max(0, Math.ceil(sec));
    const m = Math.floor(s / 60), r = s % 60;
    this.el.timer.textContent = `${m}:${String(r).padStart(2, '0')}`;
    this.el.timer.style.color = phase === 'buy' ? '#7fd4ff' : s <= 10 ? '#ff5a4a' : '#e9e6df';
  }

  setScore(w, j, round) {
    this.el.score.textContent = `WARDENS ${w} — ${j} JACKALS`;
    this.el.roundLabel.textContent = 'ROUND ' + round + ' / 13';
  }

  setMoney(m) { this.el.money.textContent = '$' + m.toLocaleString('en-US'); }

  setCrosshair(spreadPx, visible = true) {
    this.el.crosshair.style.display = visible ? 'block' : 'none';
    const gap = Math.round(4 + spreadPx);
    this.el.crosshair.style.setProperty('--gap', gap + 'px');
  }

  // Floating damage number at screen point (sx, sy): the damage just
  // dealt, orange + bigger on a headshot, red on a kill. It appears at
  // full opacity and lifts after 3 s of GAME time (now): a wall-clock
  // setTimeout is wrong here — this headless box takes ~8 s of wall time
  // to render one screenshot frame while the game clock barely moves,
  // so a 4.6 s wall-clock number was already gone when the capture
  // frame was rendered. NOTE: no CSS transition on this node — a
  // margin/opacity transition plus the fly class made the number
  // invisible on headless captures even though it was in the DOM at
  // opacity 1 (verified by six probes); a static node paints fine.
  spawnDamageNumber(sx, sy, text, kind, now) {
    const layer = this.el.dmgLayer;
    while (layer.children.length >= 8) layer.firstChild.remove();
    const div = document.createElement('div');
    div.className = 'dmg-num' + (kind === 'head' ? ' head' : kind === 'kill' ? ' kill' : '');
    div.textContent = text;
    // Small jitter so two hits on the same spot in one burst don't
    // print exactly on top of each other.
    div.style.left = Math.round(sx + (Math.random() * 24 - 12)) + 'px';
    div.style.top = Math.round(sy + (Math.random() * 16 - 8)) + 'px';
    div._expire = now + 3;
    layer.appendChild(div);
  }

  // Lift expired damage numbers (called by main.js on its 10 Hz HUD
  // tick, on the same game clock the numbers were stamped with).
  pruneDamageNumbers(now) {
    const layer = this.el.dmgLayer;
    for (const div of [...layer.children]) {
      if (div._expire !== undefined && now > div._expire) div.remove();
    }
  }

  // Live minimap (called ~10x/s by main.js): lanes, site rings + names,
  // the player's arrow, squad dots, and a pulsing red marker while the
  // charge is planted. Enemies are never shown — only what the squad
  // would actually know.
  drawMinimap(player, bots, planted, plantSite) {
    const c = this._mm;
    const W = 168, H = 124;
    const X = (wx) => ((wx - MAP_MIN_X) / (MAP_MAX_X - MAP_MIN_X)) * W;
    const Z = (wz) => ((wz - MAP_MIN_Z) / (MAP_MAX_Z - MAP_MIN_Z)) * H;
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(20, 24, 30, 0.55)';
    c.fillRect(0, 0, W, H);
    // Lane strips.
    c.fillStyle = 'rgba(233, 230, 223, 0.10)';
    c.fillRect(X(-22), Z(-3.5), X(22) - X(-22), Z(3.5) - Z(-3.5));       // Mid
    c.fillRect(X(-22), Z(-20.5), X(22) - X(-22), Z(-13.5) - Z(-20.5));   // A-long
    c.fillRect(X(-22), Z(13.5), X(22) - X(-22), Z(20.5) - Z(13.5));     // B-tunnel
    // Perimeter.
    c.strokeStyle = 'rgba(233, 230, 223, 0.35)';
    c.strokeRect(X(-38), Z(-28), X(38) - X(-38), Z(28) - Z(-28));
    // Sites: ring + name. Planted charge pulses red on its site.
    const sites = [
      { x: 24, z: -16, label: 'SITE A', sub: 'CRANE YARD', color: '#ffb347' },
      { x: 24, z: 16, label: 'SITE B', sub: 'TANK FARM', color: '#7fd4ff' },
    ];
    for (const s of sites) {
      const isPlant = planted && plantSite === s.label.slice(-1);
      c.beginPath();
      c.arc(X(s.x), Z(s.z), isPlant ? 7 + Math.sin(performance.now() / 150) * 1.5 : 6, 0, Math.PI * 2);
      c.strokeStyle = isPlant ? '#ff2a1a' : s.color;
      c.lineWidth = 1.6;
      c.stroke();
      // Labels sit LEFT of the ring: both sites are on the map's right
      // edge, so text to the right would clip off the canvas.
      c.font = 'bold 8px system-ui, sans-serif';
      c.fillStyle = isPlant ? '#ff5a4a' : s.color;
      c.textAlign = 'right';
      c.fillText(s.label, X(s.x) - 9, Z(s.z) - 1);
      c.font = '7px system-ui, sans-serif';
      c.fillStyle = 'rgba(233, 230, 223, 0.6)';
      c.fillText(s.sub, X(s.x) - 9, Z(s.z) + 8);
    }
    // Squad dots (Wardens, blue); the player is a white arrow.
    for (const b of bots) {
      if (!b.alive || b.team !== 'warden') continue;
      c.beginPath();
      c.arc(X(b.pos.x), Z(b.pos.z), 3, 0, Math.PI * 2);
      c.fillStyle = '#7fb8ff';
      c.fill();
    }
    if (player.alive) {
      const px = X(player.pos.x), pz = Z(player.pos.z);
      c.save();
      c.translate(px, pz);
      // Canvas y runs south, so the up-drawn arrow rotates by -yaw.
      c.rotate(-player.yaw);
      c.beginPath();
      c.moveTo(0, -6); c.lineTo(4.5, 5); c.lineTo(-4.5, 5); c.closePath();
      c.fillStyle = '#ffffff';
      c.fill();
      c.restore();
    }
  }

  hitmarker(head, kill) {
    this.el.hitmarker.classList.add('on');
    this.el.hitmarker.classList.toggle('head', !!head);
    this.el.hitmarker.classList.toggle('kill', !!kill);
    this.hitTimer = 0.18;
  }

  damageFrom(angleDeg) {
    // angleDeg: direction of the attacker relative to the camera, 0 = ahead.
    this.el.damageDir.style.transform = `translate(-50%,-50%) rotate(${angleDeg}deg)`;
    this.el.damageDir.classList.add('on');
    this.damageTimer = 0.9;
  }

  addKill(killer, victim, head, killerTeam) {
    const div = document.createElement('div');
    div.className = 'kf-row';
    const kc = killerTeam === 'warden' ? '#7fb8ff' : '#ff9a4a';
    div.innerHTML = `<span style="color:${kc}">${killer}</span> <span class="kf-x">${head ? '◉' : '✕'}</span> <span>${victim}</span>`;
    this.el.killfeed.prepend(div);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.lastChild.remove();
  }

  banner(title, sub, color = '#e9e6df', seconds = 4) {
    this.el.banner.textContent = title;
    this.el.bannerSub.textContent = sub;
    this.el.banner.style.color = color;
    this.el.banner.style.display = 'block';
    this.el.bannerSub.style.display = 'block';
    this.bannerTimer = seconds;
  }

  objective(text, color = '#ffb347') {
    this.el.objective.textContent = text;
    this.el.objective.style.color = color;
    this.el.objective.style.display = text ? 'block' : 'none';
  }

  center(text, seconds = 2.5) {
    this.el.centerMsg.textContent = text;
    this.el.centerMsg.style.display = text ? 'block' : 'none';
    this.centerTimer = seconds;
  }

  flashWhite(strength) {
    this.el.flash.style.opacity = String(Math.min(1, strength));
    this.flashTimer = 0.5;
  }

  // Plant / defuse progress bar (bottom centre).
  setChannel(label, frac) {
    if (frac == null) { this.el.plantBar.style.display = 'none'; return; }
    this.el.plantBar.style.display = 'block';
    this.el.plantLabel.textContent = label;
    this.el.plantFill.style.width = Math.round(frac * 100) + '%';
  }

  showBuy(money, loadout, onBuy) {
    const list = this.el.buyList;
    list.innerHTML = '';
    const rows = [];
    for (const [id, w] of Object.entries(WEAPONS)) {
      if (id === 'p9') continue;
      rows.push({ id, label: `${w.name} — $${w.price}`, owned: !!loadout.owned[id], price: w.price });
    }
    rows.push({ id: 'armor', label: `Armour + Helmet — $650`, owned: loadout.armor >= 100, price: 650 });
    rows.push({ id: 'kit', label: `Defuse Kit (fast defuse) — $400`, owned: loadout.kit, price: 400 });
    for (const [id, g] of Object.entries(GRENADES)) {
      rows.push({ id, label: `${g.name} — $${g.price} (x${loadout.grenades[id]})`, owned: loadout.grenades[id] >= 2, price: g.price });
    }
    for (const r of rows) {
      const b = document.createElement('button');
      b.className = 'buy-row' + (r.owned ? ' owned' : '') + (money < r.price ? ' poor' : '');
      b.textContent = r.label + (r.owned ? ' ✓' : '');
      b.addEventListener('click', () => onBuy(r.id));
      list.appendChild(b);
    }
    this.el.buyMenu.style.display = 'block';
    this.el.buyMenu.querySelector('.buy-money').textContent = 'Money: $' + money;
  }

  hideBuy() { this.el.buyMenu.style.display = 'none'; }

  showScoreboard(rows, wScore, jScore) {
    // rows: [{ name, team, kills, deaths, money }] sorted by kills desc.
    const body = this.el.scoreRows;
    body.innerHTML = '';
    for (const r of rows) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td style="color:${r.team === 'warden' ? '#7fb8ff' : '#ff9a4a'}">${r.name}</td>` +
        `<td>${r.kills}</td><td>${r.deaths}</td><td>$${r.money}</td>`;
      body.appendChild(tr);
    }
    this.el.scoreboard.querySelector('.sb-score').textContent = `WARDENS ${wScore} — ${jScore} JACKALS`;
    this.el.scoreboard.style.display = 'block';
  }

  hideScoreboard() { this.el.scoreboard.style.display = 'none'; }

  hint(text) { this.el.hint.textContent = text; this.el.hint.style.display = text ? 'block' : 'none'; }

  update(dt) {
    if (this.hitTimer > 0) { this.hitTimer -= dt; if (this.hitTimer <= 0) this.el.hitmarker.classList.remove('on', 'head', 'kill'); }
    if (this.damageTimer > 0) { this.damageTimer -= dt; if (this.damageTimer <= 0) this.el.damageDir.classList.remove('on'); }
    if (this.bannerTimer > 0) { this.bannerTimer -= dt; if (this.bannerTimer <= 0) { this.el.banner.style.display = 'none'; this.el.bannerSub.style.display = 'none'; } }
    if (this.centerTimer > 0) { this.centerTimer -= dt; if (this.centerTimer <= 0) this.el.centerMsg.style.display = 'none'; }
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      const o = parseFloat(this.el.flash.style.opacity || '0');
      this.el.flash.style.opacity = String(Math.max(0, o - dt * 2.2));
    }
  }
}
