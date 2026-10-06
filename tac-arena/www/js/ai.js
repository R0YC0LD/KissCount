/* Taç Arena — bot yapay zekası (antrenman modu)
 * Bot, kendi tarafının bakış açısıyla düşünür: kendi yarısı ly > 17.
 */
(function (root) {
  'use strict';
  const TA = (typeof module !== 'undefined' && module.exports) ? require('./sim.js') : root.TA;
  const { CARDS, sy, W } = TA;

  const LEVELS = {
    easy: { think: 1.7, offense: 9.5, jitter: 2.2, smart: 0.35 },
    normal: { think: 1.0, offense: 8, jitter: 1.0, smart: 0.75 },
    hard: { think: 0.55, offense: 7, jitter: 0.4, smart: 1.0 }
  };

  const WIN_CONDITIONS = ['giant', 'golem', 'hog', 'balloon'];
  const TANK_KILLERS = ['minirobot', 'inferno', 'skarmy', 'prince', 'knight', 'barbarians', 'cannon'];

  class Bot {
    constructor(game, side, level) {
      this.g = game;
      this.side = side;
      this.cfg = LEVELS[level] || LEVELS.normal;
      this.t = 1.5;
      this.lastPlay = 0;
    }

    ly(y) { return sy(this.side, y); }
    wy(ly) { return sy(this.side, ly); }

    update(dt) {
      if (this.g.over) return;
      this.t -= dt;
      if (this.t > 0) return;
      this.t = this.cfg.think * (0.7 + Math.random() * 0.6);
      try { this.think(); } catch (err) { /* bot hatası oyunu durdurmasın */ }
    }

    affordable() {
      const el = this.g.elixir[this.side];
      return this.g.hands[this.side].map((k, i) => ({ k, i, c: CARDS[k] })).filter(o => o.c.cost <= el);
    }

    tryPlay(o, lx, lyv) {
      const j = this.cfg.jitter;
      const attempts = [[0, 0], [Math.random() * j - j / 2, Math.random() * j - j / 2], [0, 1], [0, 2], [1, 1], [-1, 1]];
      for (const [ax, ay] of attempts) {
        let x = Math.max(0.5, Math.min(W - 0.5, lx + ax));
        let ly = Math.max(0.5, Math.min(31.5, lyv + ay));
        if (o.c.type !== 'spell') { x = Math.floor(x) + 0.5; ly = Math.floor(ly) + 0.5; }
        const y = this.wy(ly);
        if (this.g.play(this.side, o.i, o.k, x, y)) { this.lastPlay = this.g.time; return true; }
      }
      return false;
    }

    think() {
      const g = this.g, s = this.side, en = 1 - s;
      const enemies = g.ents.filter(e => e.side === en && e.kind === 'troop' && e.hp > 0);
      const threats = enemies.filter(e => this.ly(e.y) >= 12.5);
      const el = g.elixir[s];

      // 1) Kule bitirme: düşük canlı kuleye büyü
      if (Math.random() < this.cfg.smart) {
        for (const o of this.affordable()) {
          if (o.c.type !== 'spell' || !o.c.dmg) continue;
          const tw = g.towers(en).find(t => t.hp <= o.c.dmg * (o.c.towerPct || 1) && (t.key !== 'king' || t.hp < 600));
          if (tw && this.tryPlay(o, tw.x, this.ly(tw.y))) return;
        }
      }

      // 2) Savunma
      if (threats.length) {
        if (this.defend(threats)) return;
        if (el < 9) return; // iksir biriktir
      }

      // 3) Destek: kendi tankının arkasına
      const myTank = g.ents.find(e => e.side === s && e.kind === 'troop' && WIN_CONDITIONS.includes(e.key) && this.ly(e.y) > 12);
      if (myTank && el >= 4 && Math.random() < this.cfg.smart) {
        const sup = this.affordable().filter(o => o.c.type === 'troop' && !WIN_CONDITIONS.includes(o.k) && o.c.range >= 3);
        const any = sup.length ? sup : this.affordable().filter(o => o.c.type === 'troop' && !WIN_CONDITIONS.includes(o.k));
        if (any.length) {
          const o = any[Math.floor(Math.random() * any.length)];
          if (this.tryPlay(o, myTank.x, Math.min(31, this.ly(myTank.y) + 2.5))) return;
        }
      }

      // 4) Hücum
      const threshold = g.doubleElixir ? this.cfg.offense - 2 : this.cfg.offense;
      if (el >= threshold || el >= 9.8) this.attack();
    }

    lanePick() {
      const en = 1 - this.side;
      const l = this.g.tower(en, 'L'), r = this.g.tower(en, 'R');
      if (!l) return 'L';
      if (!r) return 'R';
      if (Math.abs(l.hp - r.hp) > 300) return l.hp < r.hp ? 'L' : 'R';
      return Math.random() < 0.5 ? 'L' : 'R';
    }

    attack() {
      const hand = this.affordable();
      if (!hand.length) return;
      const lane = this.lanePick();
      const bx = lane === 'L' ? 3.5 : 14.5;
      const wc = hand.filter(o => WIN_CONDITIONS.includes(o.k));
      if (wc.length) {
        const o = wc[0];
        if (o.k === 'hog') { if (this.tryPlay(o, bx, 18.5)) return; }
        else if (o.k === 'balloon') { if (this.tryPlay(o, bx, 19.5)) return; }
        else if (this.tryPlay(o, lane === 'L' ? 6.5 : 11.5, 30.5)) return;
      }
      const troops = hand.filter(o => o.c.type === 'troop');
      if (troops.length) {
        const o = troops[Math.floor(Math.random() * troops.length)];
        // Rakibin o koridordaki kulesi yıkıldıysa doğrudan ileriye (cebe) yerleştir
        if (!this.g.tower(1 - this.side, lane) && this.tryPlay(o, lane === 'L' ? 4.5 : 13.5, 9.5)) return;
        const back = o.c.range >= 3 ? 21.5 : 18.5;
        this.tryPlay(o, bx, back);
        return;
      }
      // Bina veya büyü kaldıysa ve iksir dolduysa: binayı ortaya koy
      const b = hand.find(o => o.c.type === 'building');
      if (b && this.g.elixir[this.side] >= 9.5) this.tryPlay(b, 9, 21.5);
    }

    defend(threats) {
      const g = this.g;
      // tehditleri koridora göre grupla
      const left = threats.filter(e => e.x < W / 2), right = threats.filter(e => e.x >= W / 2);
      const grp = (left.reduce((a, e) => a + e.hp, 0) >= right.reduce((a, e) => a + e.hp, 0)) ? left : right;
      if (!grp.length) return false;
      let cx = 0, cy = 0, hpSum = 0;
      for (const e of grp) { cx += e.x * e.hp; cy += this.ly(e.y) * e.hp; hpSum += e.hp; }
      cx /= hpSum; cy /= hpSum;
      const air = grp.filter(e => e.air).length;
      const swarm = grp.filter(e => e.maxHp <= 350).length;
      const tank = grp.reduce((m, e) => Math.max(m, e.hp), 0);
      const smart = Math.random() < this.cfg.smart;

      const hand = this.affordable();
      if (!hand.length) return false;
      const scored = hand.map(o => {
        const c = o.c;
        let sc = 0;
        if (c.type === 'spell') {
          if (!c.dmg && !c.dps && !c.freeze) return { o, sc: -1 };
          const total = c.dmg + (c.dps ? c.dps * c.dur : 0);
          let v = 0;
          for (const e of grp) if (Math.hypot(e.x - cx, this.ly(e.y) - cy) <= c.radius + 0.5) v += Math.min(e.hp, total);
          sc = v / (c.cost * 180) - 0.8;
          if (o.k === 'rocket') sc -= 1.5;
        } else {
          const hitsAir = c.targets === 'all';
          if (air && !hitsAir && air === grp.length) return { o, sc: -1 };
          if (c.targets === 'buildings') return { o, sc: -1 };
          sc = 1;
          if (air && hitsAir) sc += 1.5;
          if (swarm >= 3 && (c.splash || c.splashSelf)) sc += 1.5;
          if (tank >= 1500 && TANK_KILLERS.includes(o.k)) sc += 1.5;
          if (swarm >= 3 && c.count >= 3 && !c.splash) sc -= 0.8;
          sc -= c.cost * 0.15;
        }
        if (!smart) sc = Math.random() * 2;
        return { o, sc };
      }).filter(x => x.sc > 0).sort((a, b) => b.sc - a.sc);
      if (!scored.length) return false;
      const { o } = scored[0];
      const c = o.c;
      if (c.type === 'spell') return this.tryPlay(o, cx, cy);
      if (c.type === 'building') return this.tryPlay(o, 9, Math.max(20.5, Math.min(23.5, cy + 3)));
      // birlik: tehdit ile kule arasına
      const dist = c.range >= 3 ? 4 : 2;
      const ly = Math.max(17.5, Math.min(30.5, Math.max(cy + dist, 18.5)));
      return this.tryPlay(o, cx, ly);
    }
  }

  const api = { Bot, BOT_LEVELS: LEVELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = Object.assign({}, TA, api);
  else root.TA = Object.assign(root.TA || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
