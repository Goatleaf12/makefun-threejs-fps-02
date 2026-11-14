// BASTION PROTOCOL — hud.js
// Every DOM overlay: health, ammo, timer, score, money, crosshair,
// killfeed, hitmarker, damage direction, round banner, buy menu,
// scoreboard, objective messages. The HUD is plain DOM/CSS — sharp,
// cheap, and exactly what the screenshots show.

import { WEAPONS, GRENADES } from './config.js';

export class HUD {
  constructor(root) {
    this.el = {};
    const ids = ['health', 'healthBar', 'armor', 'ammoMag', 'ammoRes', 'weaponName',
      'timer', 'score', 'money', 'roundLabel', 'crosshair', 'hitmarker', 'killfeed',
      'banner', 'bannerSub', 'objective', 'buyMenu', 'buyList', 'scoreboard',
      'scoreRows', 'flash', 'damageDir', 'reloadHint', 'hint', 'plantBar', 'plantFill',
      'plantLabel', 'centerMsg'];
    for (const id of ids) this.el[id] = root.querySelector('#' + id);
    this.killfeedTimer = 0;
    this.bannerTimer = 0;
    this.damageTimer = 0;
    this.hitTimer = 0;
  }

  setHealth(hp, armor) {
    this.el.health.textContent = Math.max(0, Math.ceil(hp));
    this.el.healthBar.style.width = Math.max(0, hp) + '%';
    this.el.healthBar.style.background = hp > 50 ? '#7fd47a' : hp > 25 ? '#ffb347' : '#ff5a4a';
    this.el.armor.textContent = armor > 0 ? 'ARMOR ' + Math.ceil(armor) : '';
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
