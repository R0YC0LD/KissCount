/* Taç Arena — oyun simülasyonu (yetkili taraf: çevrimdışı oyun veya online maçta host)
 * Taraf 0 = alt, taraf 1 = üst. Dünya koordinatları karo cinsinden.
 */
(function (root) {
  'use strict';
  const TA = (typeof module !== 'undefined' && module.exports) ? require('./cards.js') : root.TA;
  const { CARDS, TOWERS } = TA;

  const W = 18, H = 32;
  const RIVER_TOP = 15, RIVER_BOT = 17;
  const BRIDGES = [3.5, 14.5];
  const MATCH_TIME = 180, DOUBLE_AT = 120, OVERTIME = 60;
  const ELIXIR_RATE = 1 / 2.8, START_ELIXIR = 5, MAX_ELIXIR = 10;
  const POCKET_Y = 5.5; // kule yıkılınca rakip yarıda yerleştirilebilecek en ileri satır (kendi bakışımızla)
  const COUNTDOWN = 3;

  // Taraf koordinat dönüşümü: taraf 1 için y ekseni aynalanır.
  function sy(side, y) { return side === 0 ? y : H - y; }

  function dist(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  function formation(n) {
    if (n <= 1) return [[0, 0]];
    if (n === 2) return [[-0.55, 0], [0.55, 0]];
    const out = [];
    if (n <= 6) {
      const r = 0.55 + n * 0.08;
      for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + i * Math.PI * 2 / n; out.push([Math.cos(a) * r, Math.sin(a) * r]); }
      return out;
    }
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) { const r = 0.42 * Math.sqrt(i + 0.5); const a = i * golden; out.push([Math.cos(a) * r, Math.sin(a) * r]); }
    return out;
  }

  // Yerleştirme kuralı; hem simülasyon hem de istemci görünümü (view) için ortak.
  // ents: {kind, side, lane, x, y, r, hp} alanları olan nesneler.
  function canDeployOn(ents, side, key, x, y) {
    const c = CARDS[key];
    if (!c) return false;
    if (!(x >= 0.5 && x <= W - 0.5 && y >= 0.5 && y <= H - 0.5)) return false;
    if (c.type === 'spell') return true;
    const ly = sy(side, y); // tarafın kendi bakış açısındaki y (kendi yarısı > 17)
    let ok = ly >= RIVER_BOT + 0.5;
    if (!ok && ly >= POCKET_Y) {
      // Rakibin o koridordaki prenses kulesi yıkıldıysa o koridorun neredeyse tamamı açılır
      const lane = x < W / 2 ? 'L' : 'R';
      if (!ents.some(e => e.kind === 'tower' && e.side === 1 - side && e.lane === lane && e.hp > 0)) ok = true;
    }
    if (!ok) return false;
    if (c.type === 'building') {
      for (const e of ents) {
        if (e.hp <= 0 || (e.kind !== 'tower' && e.kind !== 'building')) continue;
        if (Math.hypot(e.x - x, e.y - y) < e.r + c.r + 0.1) return false;
      }
    }
    return true;
  }

  class Game {
    constructor(opts) {
      opts = opts || {};
      this.time = 0;
      this.clock = 0; // geri sayım dahil sürekli ilerleyen saat (ağ senkronu için)
      this.cd = opts.countdown == null ? COUNTDOWN : opts.countdown;
      this.nid = 1;
      this.ents = [];
      this.projs = [];
      this.spells = [];
      this.areas = [];
      this.fxLocal = [];
      this.fxNet = [];
      this.crowns = [0, 0];
      this.elixir = [START_ELIXIR, START_ELIXIR];
      this.over = false;
      this.winner = -1;
      this.overtime = false;
      this.names = opts.names || ['Oyuncu', 'Rakip'];
      this.stats = [{ played: 0, elixirSpent: 0 }, { played: 0, elixirSpent: 0 }];
      this.decks = [0, 1].map(s => shuffle((opts.decks && opts.decks[s]) || TA.DEFAULT_DECK));
      this.hands = this.decks.map(d => d.slice(0, 4));
      this.queues = this.decks.map(d => d.slice(4));
      this._entMap = new Map();
      this._buildTowers();
    }

    // ---------- kurulum ----------
    _buildTowers() {
      for (const side of [0, 1]) {
        this._addTower(side, 'princess', 3.5, sy(side, 25.5), 'L');
        this._addTower(side, 'princess', 14.5, sy(side, 25.5), 'R');
        this._addTower(side, 'king', 9, sy(side, 29), 'K');
      }
    }
    _addTower(side, key, x, y, lane) {
      const t = TOWERS[key];
      const e = {
        id: this.nid++, side, key, kind: 'tower', lane, x, y, r: t.r, hp: t.hp, maxHp: t.hp,
        air: false, mass: 1000, atkCd: 0.5, target: null, retarget: 0, deployT: 0, stunT: 0, frozenT: 0,
        active: key !== 'king', flash: 0, atk: 0, rampT: 0
      };
      this._add(e);
      return e;
    }
    _add(e) { this.ents.push(e); this._entMap.set(e.id, e); }
    byId(id) { const e = this._entMap.get(id); return e && e.hp > 0 ? e : null; }
    emit(fx) { this.fxLocal.push(fx); this.fxNet.push(fx); }

    tower(side, lane) { return this.ents.find(e => e.kind === 'tower' && e.side === side && e.lane === lane && e.hp > 0) || null; }
    towers(side) { return this.ents.filter(e => e.kind === 'tower' && e.side === side && e.hp > 0); }

    get doubleElixir() { return this.time >= DOUBLE_AT || this.overtime; }
    get timeLeft() {
      if (this.overtime) return Math.max(0, MATCH_TIME + OVERTIME - this.time);
      return Math.max(0, MATCH_TIME - this.time);
    }

    // ---------- yerleştirme ----------
    canDeploy(side, key, x, y) { return canDeployOn(this.ents, side, key, x, y); }

    // Oyuncu kart oynatır. Başarılıysa true.
    play(side, handIdx, key, x, y) {
      if (this.over || this.cd > 0) return false;
      const hand = this.hands[side];
      if (handIdx < 0 || handIdx > 3 || hand[handIdx] !== key) return false;
      const c = CARDS[key];
      if (this.elixir[side] < c.cost) return false;
      if (!this.canDeploy(side, key, x, y)) return false;
      this.elixir[side] -= c.cost;
      this.stats[side].played++;
      this.stats[side].elixirSpent += c.cost;
      const next = this.queues[side].shift();
      this.queues[side].push(key);
      hand[handIdx] = next;
      this.deploy(side, key, x, y);
      this.emit({ t: 'play', s: side, k: key, x, y });
      return true;
    }

    deploy(side, key, x, y) {
      const c = CARDS[key];
      if (c.type === 'spell') {
        const king = this.ents.find(e => e.kind === 'tower' && e.key === 'king' && e.side === side) || { x: 9, y: sy(side, 29) };
        if (!c.speed) { this._applySpell(side, key, x, y); return; }
        const d = Math.hypot(x - king.x, y - king.y);
        this.spells.push({ id: this.nid++, side, key, x0: king.x, y0: king.y, x: king.x, y: king.y, tx: x, ty: y, t: 0, dur: Math.max(0.35, d / c.speed) });
        return;
      }
      if (c.type === 'building') { this.spawnUnit(side, key, x, y, 1.0); return; }
      const f = formation(c.count || 1);
      for (const [ox, oy] of f) {
        const fy = side === 0 ? oy : -oy;
        this.spawnUnit(side, key, Math.min(W - 0.5, Math.max(0.5, x + ox)), Math.min(H - 0.5, Math.max(0.5, y + fy)), 1.0);
      }
    }

    spawnUnit(side, key, x, y, deployT) {
      const c = CARDS[key];
      const e = {
        id: this.nid++, side, key, kind: c.type === 'building' ? 'building' : 'troop',
        x, y, r: c.r || 0.45, hp: c.hp, maxHp: c.hp, air: !!c.air, mass: c.mass || 2,
        atkCd: 0, target: null, retarget: 0, deployT: deployT == null ? 1 : deployT,
        stunT: 0, frozenT: 0, life: c.lifetime || 0, spawnT: c.spawn ? 1.0 : 0,
        moved: 0, charging: false, rampT: 0, rampTarget: null, flash: 0, atk: 0,
        dir: side === 0 ? -1 : 1, active: true
      };
      this._add(e);
      return e;
    }

    // ---------- ana döngü ----------
    step(dt) {
      if (this.over) return;
      this.clock += dt;
      if (this.cd > 0) {
        this.cd -= dt;
        if (this.cd <= 0) { this.cd = 0; this.emit({ t: 'go' }); }
        return;
      }
      this.time += dt;
      const rate = ELIXIR_RATE * (this.doubleElixir ? 2 : 1);
      for (let s = 0; s < 2; s++) this.elixir[s] = Math.min(MAX_ELIXIR, this.elixir[s] + rate * dt);

      // büyü uçuşları
      for (let i = this.spells.length - 1; i >= 0; i--) {
        const sp = this.spells[i];
        sp.t += dt;
        const k = Math.min(1, sp.t / sp.dur);
        sp.x = sp.x0 + (sp.tx - sp.x0) * k;
        sp.y = sp.y0 + (sp.ty - sp.y0) * k;
        if (k >= 1) { this.spells.splice(i, 1); this._applySpell(sp.side, sp.key, sp.tx, sp.ty); }
      }
      // kalıcı alanlar (zehir)
      for (let i = this.areas.length - 1; i >= 0; i--) {
        const a = this.areas[i];
        a.t -= dt; a.tick -= dt;
        if (a.tick <= 0) {
          a.tick += 0.5;
          this.areaDamage(a.side, a.x, a.y, a.r, a.dps * 0.5, { towerPct: a.towerPct, slow: true });
        }
        if (a.t <= 0) this.areas.splice(i, 1);
      }

      const n = this.ents.length;
      for (let i = 0; i < n; i++) this._updateEnt(this.ents[i], dt);
      this._updateProjs(dt);
      this._collide();
      this._cleanup();
      this._checkTime();
    }

    _checkTime() {
      if (this.over) return;
      if (!this.overtime && this.time >= MATCH_TIME) {
        if (this.crowns[0] !== this.crowns[1]) this._end(this.crowns[0] > this.crowns[1] ? 0 : 1);
        else { this.overtime = true; this._otCrowns = this.crowns.slice(); this.emit({ t: 'overtime' }); }
      } else if (this.overtime) {
        if (this.crowns[0] !== this.crowns[1]) this._end(this.crowns[0] > this.crowns[1] ? 0 : 1);
        else if (this.time >= MATCH_TIME + OVERTIME) {
          // Eşitlik bozucu: en zayıf kulesinin canı daha düşük olan kaybeder
          const weakest = s => Math.min(...this.ents.filter(e => e.kind === 'tower' && e.side === s).map(e => Math.max(0, e.hp)));
          const w0 = weakest(0), w1 = weakest(1);
          this._end(Math.abs(w0 - w1) < 1 ? -1 : (w0 > w1 ? 0 : 1));
        }
      }
    }

    _end(winner) {
      if (this.over) return;
      this.over = true;
      this.winner = winner;
      this.emit({ t: 'end', w: winner });
    }

    _cardOf(e) { return e.kind === 'tower' ? TOWERS[e.key] : CARDS[e.key]; }

    _updateEnt(e, dt) {
      if (e.hp <= 0) return;
      if (e.flash > 0) e.flash -= dt;
      if (e.atk > 0) e.atk -= dt;
      if (e.deployT > 0) { e.deployT -= dt; return; }
      const c = this._cardOf(e);

      if (e.kind === 'building') {
        if (e.life > 0) e.hp -= (e.maxHp / e.life) * dt;
        if (c.spawn && e.hp > 0) {
          e.spawnT -= dt;
          if (e.spawnT <= 0) {
            e.spawnT = c.spawn.every;
            for (let i = 0; i < c.spawn.n; i++) {
              this.spawnUnit(e.side, c.spawn.key, e.x + (Math.random() - 0.5) * 0.6, e.y + (e.side === 0 ? -1.2 : 1.2), 0.3);
            }
          }
        }
      }
      if (e.frozenT > 0) { e.frozenT -= dt; return; }
      if (e.stunT > 0) { e.stunT -= dt; return; }
      if (e.kind === 'tower' && !e.active) return;
      if (!c.dmg && !c.ramp) return;

      e.atkCd -= dt;
      e.retarget -= dt;
      let t = e.target != null ? this.byId(e.target) : null;
      const inR = t && this.inRange(e, t, c);
      if (!t || (!inR && e.retarget <= 0) || (e.kind !== 'troop' && !inR)) {
        const nt = this.acquire(e, c);
        if (nt !== t) {
          e.rampT = 0;
          if (nt && e.atkCd < 0.3) e.atkCd = 0.3; // hedef değişiminde kısa nişan alma
        }
        t = nt;
        e.target = t ? t.id : null;
        e.retarget = 0.25;
      }
      if (!t) return;

      if (this.inRange(e, t, c)) {
        if (c.ramp) e.rampT += dt;
        if (e.atkCd <= 0) this._attack(e, t, c);
      } else if (e.kind === 'troop') {
        this._move(e, t, c, dt);
      }
    }

    inRange(e, t, c) {
      return dist(e, t) - t.r - e.r <= c.range;
    }

    _canTarget(e, c, o) {
      const tg = c.targets || 'all';
      if (tg === 'buildings') return o.kind !== 'troop';
      if (tg === 'ground') return !o.air;
      return true;
    }

    acquire(e, c) {
      const sight = e.kind === 'troop' ? Math.max(5.5, c.range) : c.range;
      let best = null, bd = Infinity;
      for (const o of this.ents) {
        if (o.side === e.side || o.hp <= 0) continue;
        if (!this._canTarget(e, c, o)) continue;
        const d = dist(e, o) - o.r - e.r;
        if (d <= sight && d < bd) { bd = d; best = o; }
      }
      if (!best && e.kind === 'troop') best = this.laneTower(e);
      return best;
    }

    laneTower(e) {
      const enemy = 1 - e.side;
      const lane = e.x < W / 2 ? 'L' : 'R';
      return this.tower(enemy, lane) || this.tower(enemy, 'K') || this.tower(enemy, lane === 'L' ? 'R' : 'L');
    }

    _move(e, t, c, dt) {
      let speed = c.speed;
      if (e.charging) speed *= 2;
      if (e.slowT > 0) { speed *= 0.65; e.slowT -= dt; }
      let tx = t.x, ty = t.y;
      if (!e.air && !c.jump && ((e.y > 16) !== (ty > 16))) {
        // Nehri köprüden geç
        const bx = (Math.abs(e.x - BRIDGES[0]) + Math.abs(tx - BRIDGES[0])) <= (Math.abs(e.x - BRIDGES[1]) + Math.abs(tx - BRIDGES[1])) ? BRIDGES[0] : BRIDGES[1];
        const inBand = e.y > RIVER_TOP - 0.7 && e.y < RIVER_BOT + 0.7;
        if (inBand && Math.abs(e.x - bx) < 0.9) { tx = bx; ty = ty < e.y ? RIVER_TOP - 1.2 : RIVER_BOT + 1.2; }
        else { tx = bx; ty = e.y > 16 ? RIVER_BOT + 0.5 : RIVER_TOP - 0.5; }
      }
      let dx = tx - e.x, dy = ty - e.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      // Statik engellerin (kule / bina) etrafından dolaş
      if (!e.air) {
        for (const s of this.ents) {
          if (s.hp <= 0 || s === t || (s.kind !== 'tower' && s.kind !== 'building')) continue;
          const vx = s.x - e.x, vy = s.y - e.y;
          const along = vx * dx + vy * dy;
          if (along <= 0 || along > s.r + 2.5) continue;
          const cross = dx * vy - dy * vx;
          if (Math.abs(cross) < s.r + e.r + 0.15) {
            // (dy,-dx) yönü, cross>0 iken engelden uzak taraftır
            const sgn = cross > 0 ? 1 : (cross < 0 ? -1 : (t.x > e.x ? -1 : 1));
            const ndx = dx + dy * sgn * 1.3, ndy = dy - dx * sgn * 1.3;
            const l2 = Math.hypot(ndx, ndy) || 1;
            dx = ndx / l2; dy = ndy / l2;
            break;
          }
        }
      }
      const stepLen = speed * dt;
      e.x += dx * stepLen;
      e.y += dy * stepLen;
      e.dir = dy < 0 ? -1 : 1;
      if (c.charge) {
        e.moved += stepLen;
        if (!e.charging && e.moved >= 2.5) { e.charging = true; this.emit({ t: 'charge', id: e.id }); }
      }
    }

    _attack(e, t, c) {
      e.atkCd = c.hit;
      e.atk = 0.25;
      let dmg = c.dmg;
      if (c.ramp) {
        const stage = e.rampT < 2 ? 0 : (e.rampT < 4 ? 1 : 2);
        dmg = c.ramp[stage];
        t.flash = 0.1;
        this.damage(t, dmg);
        this.emit({ t: 'beam', a: e.id, b: t.id, st: stage });
        return;
      }
      if (e.charging) { dmg *= 2; e.charging = false; }
      e.moved = 0;
      const tg = c.targets || 'all';
      if (c.proj) {
        this.projs.push({
          id: this.nid++, side: e.side, x: e.x, y: e.y, tid: t.id, tx: t.x, ty: t.y,
          spd: c.proj, dmg, splash: c.splash || 0, hitAir: tg !== 'ground', fx: c.projFx || 'bolt',
          h0: e.kind === 'tower' ? (e.key === 'king' ? 3 : 2.4) : (e.air ? 1.2 : 0.6), h1: t.air ? 1.2 : (t.kind === 'tower' ? 1.4 : 0.5)
        });
      } else if (c.splashSelf) {
        this.areaDamage(e.side, e.x, e.y, c.splashSelf + e.r, dmg, { air: false });
        this.emit({ t: 'spin', x: e.x, y: e.y, r: c.splashSelf + e.r });
      } else if (c.splash) {
        this.areaDamage(e.side, t.x, t.y, c.splash, dmg, { air: tg !== 'ground' });
      } else {
        this.damage(t, dmg);
        this.emit({ t: 'hit', x: t.x, y: t.y, b: dmg >= 500 ? 1 : 0 });
      }
    }

    damage(o, dmg) {
      if (o.hp <= 0) return;
      o.hp -= dmg;
      o.flash = 0.12;
      if (o.kind === 'tower' || dmg >= 300) this.emit({ t: 'dmg', x: o.x, y: o.y, v: Math.round(dmg), tw: o.kind === 'tower' ? 1 : 0, s: o.side });
      if (o.kind === 'tower' && o.key === 'king' && !o.active) { o.active = true; this.emit({ t: 'kingwake', s: o.side }); }
    }

    areaDamage(side, x, y, r, dmg, opts) {
      opts = opts || {};
      const air = opts.air !== false, ground = opts.ground !== false;
      for (const o of this.ents) {
        if (o.side === side || o.hp <= 0) continue;
        if (o.air ? !air : !ground) continue;
        const d = Math.hypot(o.x - x, o.y - y) - o.r;
        if (d > r) continue;
        const v = o.kind === 'tower' ? dmg * (opts.towerPct == null ? 1 : opts.towerPct) : dmg;
        if (v > 0) this.damage(o, v);
        if (opts.stun) { o.stunT = Math.max(o.stunT, opts.stun); o.charging = false; o.moved = 0; o.rampT = 0; o.target = null; }
        if (opts.freeze) { o.frozenT = Math.max(o.frozenT, opts.freeze); o.charging = false; o.moved = 0; o.rampT = 0; }
        if (opts.slow && o.kind === 'troop') o.slowT = 0.6;
        if (opts.knock && o.kind === 'troop' && o.mass < 10) {
          const ang = Math.atan2(o.y - y, o.x - x);
          o.x += Math.cos(ang) * 0.7; o.y += Math.sin(ang) * 0.7;
        }
      }
    }

    _applySpell(side, key, x, y) {
      const c = CARDS[key];
      if (c.dur) {
        this.areas.push({ id: this.nid++, side, key, x, y, r: c.radius, dps: c.dps, t: c.dur, tick: 0, towerPct: c.towerPct });
        this.emit({ t: 'area', k: key, x, y, r: c.radius, d: c.dur });
        return;
      }
      this.areaDamage(side, x, y, c.radius, c.dmg, { towerPct: c.towerPct, stun: c.stun, freeze: c.freeze, knock: c.knock });
      this.emit({ t: 'spell', k: key, x, y, r: c.radius });
    }

    _updateProjs(dt) {
      for (let i = this.projs.length - 1; i >= 0; i--) {
        const p = this.projs[i];
        const t = this.byId(p.tid);
        if (t) { p.tx = t.x; p.ty = t.y; }
        const dx = p.tx - p.x, dy = p.ty - p.y;
        const d = Math.hypot(dx, dy);
        const st = p.spd * dt;
        if (d <= st) {
          this.projs.splice(i, 1);
          if (p.splash) {
            this.areaDamage(p.side, p.tx, p.ty, p.splash, p.dmg, { air: p.hitAir });
            this.emit({ t: 'boom', x: p.tx, y: p.ty, r: p.splash, k: p.fx });
          } else if (t) {
            this.damage(t, p.dmg);
            this.emit({ t: 'hit', x: p.tx, y: p.ty, b: 0 });
          }
        } else {
          p.x += dx / d * st; p.y += dy / d * st;
        }
      }
    }

    _collide() {
      const troops = this.ents.filter(e => e.kind === 'troop' && e.hp > 0);
      const statics = this.ents.filter(e => (e.kind === 'tower' || e.kind === 'building') && e.hp > 0);
      for (let i = 0; i < troops.length; i++) {
        const a = troops[i];
        for (let j = i + 1; j < troops.length; j++) {
          const b = troops[j];
          if (a.air !== b.air) continue;
          let dx = b.x - a.x, dy = b.y - a.y;
          const minD = a.r + b.r;
          if (Math.abs(dx) > minD || Math.abs(dy) > minD) continue;
          let d = Math.hypot(dx, dy);
          if (d >= minD) continue;
          if (d < 1e-4) { dx = (Math.random() - 0.5) * 0.01; dy = 0.01; d = Math.hypot(dx, dy); }
          const ov = (minD - d) * 0.5;
          const wa = b.mass / (a.mass + b.mass), wb = 1 - wa;
          const nx = dx / d, ny = dy / d;
          a.x -= nx * ov * wa; a.y -= ny * ov * wa;
          b.x += nx * ov * wb; b.y += ny * ov * wb;
          // Kafa kafaya gelen ve birbirini hedeflemeyen birimler yana kayarak geçsin (köprüde kilitlenmeyi önler)
          if (Math.abs(ny) > 0.6 && a.target !== b.id && b.target !== a.id && (a.side !== b.side || a.target !== b.target)) {
            const sgn = a.id < b.id ? 1 : -1;
            const slide = ov * 0.8 * sgn;
            a.x -= ny * slide * wa; b.x += ny * slide * wb;
          }
        }
      }
      for (const a of troops) {
        if (!a.air) {
          for (const s of statics) {
            const dx = a.x - s.x, dy = a.y - s.y;
            const minD = a.r + s.r;
            const d = Math.hypot(dx, dy);
            if (d < minD) {
              if (d < 1e-4) { a.x += 0.01; continue; }
              a.x = s.x + dx / d * minD; a.y = s.y + dy / d * minD;
            }
          }
          const c = CARDS[a.key];
          if (!c.jump && a.y > RIVER_TOP && a.y < RIVER_BOT) {
            const nb = Math.min(Math.abs(a.x - BRIDGES[0]), Math.abs(a.x - BRIDGES[1]));
            if (nb > 1.0) {
              // köprü dışında nehre girme
              const bx = Math.abs(a.x - BRIDGES[0]) < Math.abs(a.x - BRIDGES[1]) ? BRIDGES[0] : BRIDGES[1];
              if (a.y < 16 && a.y > RIVER_TOP) a.y = RIVER_TOP;
              else if (a.y >= 16 && a.y < RIVER_BOT) a.y = RIVER_BOT;
              if (Math.abs(a.x - bx) < 1.4) a.x += (bx - a.x) * 0.2;
            }
          }
        }
        if (a.x < 0.4) a.x = 0.4; if (a.x > W - 0.4) a.x = W - 0.4;
        if (a.y < 0.4) a.y = 0.4; if (a.y > H - 0.4) a.y = H - 0.4;
      }
    }

    _cleanup() {
      let anyDead = false;
      for (const e of this.ents) if (e.hp <= 0) { anyDead = true; break; }
      if (!anyDead) return;
      const dead = this.ents.filter(e => e.hp <= 0);
      this.ents = this.ents.filter(e => e.hp > 0);
      for (const e of dead) {
        this._entMap.delete(e.id);
        const c = this._cardOf(e);
        if (e.kind === 'tower') {
          const enemy = 1 - e.side;
          if (e.key === 'king') {
            this.crowns[enemy] = 3;
            for (const o of this.ents) if (o.kind === 'tower' && o.side === e.side) { o.hp = 0; }
            this.emit({ t: 'tower', s: e.side, x: e.x, y: e.y, king: 1 });
            this.ents = this.ents.filter(o => !(o.kind === 'tower' && o.side === e.side));
            this._end(enemy);
          } else {
            this.crowns[enemy] = Math.min(3, this.crowns[enemy] + 1);
            const king = this.tower(e.side, 'K');
            if (king && !king.active) { king.active = true; this.emit({ t: 'kingwake', s: e.side }); }
            this.emit({ t: 'tower', s: e.side, x: e.x, y: e.y, king: 0 });
          }
          continue;
        }
        this.emit({ t: 'die', x: e.x, y: e.y, k: e.key, a: e.air ? 1 : 0 });
        if (c.deathDmg) {
          this.areaDamage(e.side, e.x, e.y, c.deathDmg.r, c.deathDmg.dmg, { air: false });
          this.emit({ t: 'boom', x: e.x, y: e.y, r: c.deathDmg.r, k: 'bomb' });
        }
        if (c.deathSpawn) {
          const f = formation(c.deathSpawn.n);
          for (const [ox, oy] of f) this.spawnUnit(e.side, c.deathSpawn.key, e.x + ox, e.y + oy, 0.5);
        }
      }
      // Ölü hedefleri temizle
      for (const e of this.ents) if (e.target != null && !this._entMap.has(e.target)) e.target = null;
    }

    // ---------- görünüm (render + ağ için ortak format) ----------
    view() {
      const ents = [];
      for (const e of this.ents) {
        if (e.hp <= 0) continue;
        let f = 0;
        if (e.air) f |= 1;
        if (e.deployT > 0) f |= 2;
        if (e.frozenT > 0) f |= 4;
        if (e.stunT > 0) f |= 8;
        if (e.charging) f |= 16;
        if (e.atk > 0) f |= 32;
        if (e.kind === 'tower' && e.active) f |= 64;
        if (e.flash > 0) f |= 128;
        ents.push({ id: e.id, k: e.key, s: e.side, side: e.side, lane: e.lane, x: e.x, y: e.y, hp: Math.ceil(e.hp), mh: e.maxHp, f, r: e.r, d: e.dir, kind: e.kind });
      }
      const projs = this.projs.map(p => ({ id: p.id, k: p.fx, x: p.x, y: p.y, s: p.side, h0: p.h0, h1: p.h1, tx: p.tx, ty: p.ty }));
      for (const sp of this.spells) projs.push({ id: sp.id, k: sp.key, x: sp.x, y: sp.y, s: sp.side, sp: 1, tx: sp.tx, ty: sp.ty });
      const areas = this.areas.map(a => ({ id: a.id, k: a.key, x: a.x, y: a.y, r: a.r, t: a.t }));
      return {
        time: this.time, clock: this.clock, cd: this.cd, left: this.timeLeft, ot: this.overtime, dbl: this.doubleElixir,
        crowns: this.crowns.slice(), elixir: this.elixir.slice(), ents, projs, areas,
        over: this.over, winner: this.winner
      };
    }
  }

  const api = { Game, canDeployOn, ELIXIR_RATE, POCKET_Y, COUNTDOWN, W, H, RIVER_TOP, RIVER_BOT, BRIDGES, MATCH_TIME, DOUBLE_AT, OVERTIME, sy, formation };
  if (typeof module !== 'undefined' && module.exports) module.exports = Object.assign({}, TA, api);
  else root.TA = Object.assign(root.TA || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
