/* Taç Arena — 2.5D (perspektifli) canvas çizim motoru
 * Kamera arenaya eğik bakar: uzak taraf daha dar ve basık görünür, kuleler ve birimler yükseklik kazanır.
 * Görüş koordinatı "vy": oyuncunun kendi tarafı her zaman altta (misafir için dünya y'si ters çevrilir).
 */
(function (root) {
  'use strict';
  const TA = root.TA;
  const { CARDS, W, H, RIVER_TOP, RIVER_BOT, BRIDGES, sy } = TA;
  const Art = TA.Art;

  const S0 = 0.76;   // uzak kenardaki ölçek
  const Q = 0.8;     // zemin basıklığı (eğik bakış)
  const ZK = 0.92;   // yüksekliklerin ekrandaki karşılığı
  const TEAM = Art.TEAMS;
  const UNIT_SCALE = 1.3; // karakterlerin karo boyutuna göre çizim ölçeği

  const TOWER_SPOTS = [];
  for (const side of [0, 1]) {
    TOWER_SPOTS.push({ side, lane: 'L', key: 'princess', x: 3.5, y: sy(side, 25.5) });
    TOWER_SPOTS.push({ side, lane: 'R', key: 'princess', x: 14.5, y: sy(side, 25.5) });
    TOWER_SPOTS.push({ side, lane: 'K', key: 'king', x: 9, y: sy(side, 29) });
  }
  const TOWER_GEO = { princess: { hs: 1.3, h: 2.1 }, king: { hs: 1.75, h: 2.5 } };

  // Birimlerin kafa yüksekliği (karo) — can barı ve efektler için
  function unitHeight(key) {
    const d = Art.UNITS[key];
    return UNIT_SCALE / 0.95 * (d ? d.s : 1) * (key === 'balloon' ? 1.7 : key === 'golem' || key === 'golemite' ? 1.45 : key === 'prince' || key === 'hog' ? 1.6 : 1.3);
  }

  class Renderer {
    constructor(canvas) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.flip = false;
      this.mySide = 0;
      this.dpr = 1; this.cw = 0; this.ch = 0;
      this.ts = 10; this.cx = 0; this.oy = 0;
      this.drag = null;
      this.lastT = 0;
      this.reset();
    }

    reset() {
      this.particles = [];
      this.rings = [];
      this.beams = [];
      this.popups = [];
      this.bubbles = [];
      this.texts = [];
      this.dying = [];
      this.anim = new Map();
      this.projMem = new Map();
      this.shakeT = 0;
      this.flashT = 0;
      this.lastIds = new Map();
    }

    resize() {
      const r = this.cv.getBoundingClientRect();
      const dpr = Math.min(root.devicePixelRatio || 1, 2);
      this.dpr = dpr;
      this.cw = r.width; this.ch = r.height;
      this.cv.width = Math.max(1, Math.round(r.width * dpr));
      this.cv.height = Math.max(1, Math.round(r.height * dpr));
      const ht = Q * H * (1 + S0) / 2; // arenanın ekrandaki yüksekliği (karo)
      this.ts = Math.min(r.width / (W + 0.5), r.height / (ht + 3.6));
      this.cx = r.width / 2;
      const total = this.ts * (ht + 3.6);
      this.oy = (r.height - total) / 2 + this.ts * 3.0;
      this._buildBg();
    }

    // ---------- projeksiyon ----------
    vyOf(y) { return this.flip ? H - y : y; }
    sAt(vy) { return S0 + (1 - S0) * vy / H; }
    // görüş uzayı (x, vy, z) → ekran
    P(x, vy, z) {
      const s = S0 + (1 - S0) * vy / H;
      const u = this.ts * s;
      return [this.cx + (x - W / 2) * u, this.oy + this.ts * Q * (S0 * vy + (1 - S0) * vy * vy / (2 * H)) - (z || 0) * u * ZK, u];
    }
    toScreen(x, y, z) { return this.P(x, this.vyOf(y), z); }
    toWorld(px, py) {
      const a = (1 - S0) / (2 * H), b = S0, c = -(py - this.oy) / (this.ts * Q);
      const vy = (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a);
      const u = this.ts * this.sAt(vy);
      const x = W / 2 + (px - this.cx) / u;
      return [x, this.flip ? H - vy : vy];
    }
    team(side) { return side === this.mySide ? 'me' : 'op'; }

    // Görüş uzayında dikdörtgen zemin parçası (dikey kenarlar hafif eğri olduğu için bölünür)
    quad(c, x0, v0, x1, v1, z) {
      const n = Math.max(1, Math.ceil(Math.abs(v1 - v0) / 2));
      c.beginPath();
      for (let i = 0; i <= n; i++) { const v = v0 + (v1 - v0) * i / n; const p = this.P(x0, v, z); i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); }
      for (let i = n; i >= 0; i--) { const v = v0 + (v1 - v0) * i / n; const p = this.P(x1, v, z); c.lineTo(p[0], p[1]); }
      c.closePath();
    }
    // Zeminde elips (perspektifli)
    groundEllipse(c, x, vy, r, z) {
      const p = this.P(x, vy, z || 0);
      c.beginPath(); c.ellipse(p[0], p[1], r * p[2], r * p[2] * Q, 0, 0, Math.PI * 2);
      return p;
    }

    // ---------- statik arka plan ----------
    _buildBg() {
      const cv = document.createElement('canvas');
      cv.width = this.cv.width; cv.height = this.cv.height;
      const c = cv.getContext('2d');
      c.scale(this.dpr, this.dpr);
      // dış alan: koyu orman zemini
      const g0 = c.createLinearGradient(0, 0, 0, this.ch);
      g0.addColorStop(0, '#1f3d22'); g0.addColorStop(1, '#2c5a2c');
      c.fillStyle = g0; c.fillRect(0, 0, this.cw, this.ch);
      // arena dışındaki çim kenarı
      c.fillStyle = '#3f7a35';
      this.quad(c, -1.2, -1.5, W + 1.2, H + 1.5, 0); c.fill();
      // ağaçlar ve kayalar (deterministik)
      let seed = 7;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const trees = [];
      for (let i = 0; i < 46; i++) {
        const side = i % 2 ? -1 : 1;
        const vy = -2 + rnd() * (H + 4);
        const x = side < 0 ? -1.4 - rnd() * 3.5 : W + 1.4 + rnd() * 3.5;
        trees.push([x, vy, 0.7 + rnd() * 0.6]);
      }
      for (let i = 0; i < 10; i++) trees.push([-1 + rnd() * (W + 2), -2.2 - rnd() * 2.5, 0.7 + rnd() * 0.5]);
      trees.sort((a, b) => a[1] - b[1]);
      // arena zemini: çim karoları
      for (let j = 0; j < H; j++) {
        for (let i = 0; i < W; i++) {
          const base = (i + j) % 2 ? [123, 196, 90] : [113, 186, 82];
          const n = ((i * 73 + j * 151) % 7) - 3;
          c.fillStyle = `rgb(${base[0] + n * 2},${base[1] + n * 2},${base[2] + n})`;
          this.quad(c, i, j, i + 1.02, j + 1.02, 0); c.fill();
        }
      }
      // patikalar (kulelerden köprülere)
      c.fillStyle = 'rgba(214,186,120,0.55)';
      for (const lx of [3.5, 14.5]) { this.quad(c, lx - 0.65, 3.5, lx + 0.65, 28.5, 0); c.fill(); }
      this.quad(c, 4, 2.3, 14, 3.6, 0); c.fill();
      this.quad(c, 4, 28.4, 14, 29.7, 0); c.fill();
      // kule kaideleri (taş zemin)
      c.fillStyle = 'rgba(150,140,120,0.55)';
      for (const sp of TOWER_SPOTS) {
        const g = TOWER_GEO[sp.key], vy = this.vyOf(sp.y);
        this.quad(c, sp.x - g.hs - 0.35, vy - g.hs - 0.35, sp.x + g.hs + 0.35, vy + g.hs + 0.35, 0); c.fill();
      }
      // nehir
      const rT = this.flip ? H - RIVER_BOT : RIVER_TOP, rB = this.flip ? H - RIVER_TOP : RIVER_BOT;
      c.fillStyle = '#5b3d22';
      this.quad(c, 0, rT, W, rT + 0.35, 0); c.fill(); // uzak kıyının ön yüzü (derinlik)
      const pa = this.P(0, rT), pb = this.P(0, rB);
      const gw = c.createLinearGradient(0, pa[1], 0, pb[1]);
      gw.addColorStop(0, '#2a7fc4'); gw.addColorStop(0.5, '#3d9ee0'); gw.addColorStop(1, '#58b4ee');
      c.fillStyle = gw; this.quad(c, 0, rT + 0.3, W, rB, 0); c.fill();
      c.fillStyle = 'rgba(0,0,0,0.18)'; this.quad(c, 0, rT + 0.3, W, rT + 0.55, 0); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.25)'; this.quad(c, 0, rB - 0.12, W, rB, 0); c.fill();
      // köprüler (yüksekliği olan tahta köprü)
      for (const bx of BRIDGES) {
        const x0 = bx - 1.1, x1 = bx + 1.1, v0 = rT - 0.5, v1 = rB + 0.5;
        c.fillStyle = 'rgba(0,0,0,0.3)'; this.quad(c, x0 + 0.1, v0 + 0.2, x1 + 0.15, v1 + 0.25, 0); c.fill();
        c.fillStyle = '#7a4f26'; this.quad(c, x0, v1 - 0.01, x1, v1, 0.18); c.fill();
        c.fillStyle = '#b17c45'; this.quad(c, x0, v0, x1, v1, 0.18); c.fill();
        c.strokeStyle = '#7a4f26'; c.lineWidth = Math.max(1, this.ts * 0.05);
        for (let k = 1; k < 7; k++) { const v = v0 + (v1 - v0) * k / 7; const a = this.P(x0, v, 0.18), b = this.P(x1, v, 0.18); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
        // korkuluklar
        for (const xr of [x0 + 0.1, x1 - 0.1]) {
          for (let k = 0; k <= 3; k++) {
            const v = v0 + (v1 - v0) * k / 3;
            const a = this.P(xr, v, 0.18), b = this.P(xr, v, 0.75);
            c.strokeStyle = '#5a3a1a'; c.lineWidth = Math.max(2, this.ts * 0.14); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
          }
          const a = this.P(xr, v0, 0.7), b = this.P(xr, v1, 0.7);
          c.strokeStyle = '#8a5a2a'; c.lineWidth = Math.max(2, this.ts * 0.12); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
        }
      }
      // arena duvarları (alçak taş çit)
      const wallH = 0.5;
      c.fillStyle = '#8f8a80';
      this.quad(c, -0.35, -0.35, W + 0.35, 0, wallH); c.fill();
      c.fillStyle = '#6e695f';
      { const a = this.P(-0.35, 0, wallH), b = this.P(W + 0.35, 0, wallH), d = this.P(W + 0.35, 0, 0), e = this.P(-0.35, 0, 0); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo(d[0], d[1]); c.lineTo(e[0], e[1]); c.closePath(); c.fill(); }
      for (const [xa, xb] of [[-0.35, 0], [W, W + 0.35]]) {
        c.fillStyle = '#8f8a80'; this.quad(c, xa, -0.35, xb, H + 0.35, wallH); c.fill();
        c.fillStyle = '#6e695f';
        const inner = xa < 0 ? xb : xa;
        c.beginPath();
        for (let k = 0; k <= 8; k++) { const p = this.P(inner, -0.35 + (H + 0.7) * k / 8, wallH); k ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); }
        for (let k = 8; k >= 0; k--) { const p = this.P(inner, -0.35 + (H + 0.7) * k / 8, 0); c.lineTo(p[0], p[1]); }
        c.closePath(); c.fill();
      }
      // ağaçlar
      for (const [x, vy, sc] of trees) {
        const p = this.P(x, vy, 0), u = p[2] * sc;
        c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.ellipse(p[0] + u * 0.2, p[1], u * 0.9, u * 0.35, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#5a3a1f'; c.fillRect(p[0] - u * 0.1, p[1] - u * 0.8, u * 0.2, u * 0.8);
        for (const [dx, dy, rr, col] of [[0, -1.4, 0.75, '#245c2a'], [-0.35, -1.1, 0.5, '#2c6e32'], [0.35, -1.15, 0.5, '#2c6e32'], [0, -1.75, 0.5, '#368a3c']]) {
          c.fillStyle = col; c.beginPath(); c.arc(p[0] + dx * u, p[1] + dy * u, rr * u, 0, Math.PI * 2); c.fill();
        }
      }
      this.bg = cv;
    }

    // ---------- efektler ----------
    addFx(list) {
      for (const f of list) {
        switch (f.t) {
          case 'hit': this._sparks(f.x, f.y, 0.7, f.b ? 9 : 4, f.b ? '#fff3a0' : '#ffffff', f.b ? 0.3 : 0.18); break;
          case 'boom':
            this.rings.push({ x: f.x, y: f.y, r: f.r, life: 0.4, max: 0.4, color: f.k === 'fire' ? '255,140,40' : '255,200,120', fill: true });
            this._sparks(f.x, f.y, 0.3, 8, f.k === 'fire' ? '#ff9b3d' : '#ffd27a', 0.3);
            this._smoke(f.x, f.y, 4);
            break;
          case 'spell': this._spellFx(f); break;
          case 'area': this.rings.push({ x: f.x, y: f.y, r: f.r, life: 0.5, max: 0.5, color: '140,230,80', fill: true }); break;
          case 'tower': this._towerFx(f); break;
          case 'spin': this.rings.push({ x: f.x, y: f.y, r: f.r, life: 0.28, max: 0.28, color: '255,255,255', fill: false, z: 0.5 }); break;
          case 'beam': this.beams.push({ a: f.a, b: f.b, st: f.st, life: 0.16 }); break;
          case 'play': if (f.s !== this.mySide) this.popups.push({ k: f.k, x: f.x, y: f.y, life: 1.3, max: 1.3 }); break;
          case 'dmg': if (f.tw || f.v >= 300) this._dmgText(f); break;
          case 'kingwake': this.texts.push({ x: 9, y: sy(f.s, 29), z: 4.4, text: '!', color: '#ffe14d', life: 1.0, max: 1.0, size: 1.4 }); break;
        }
      }
    }
    _p(x, y, z, vx, vy, vz, color, size, life, g) { return { x, y, z, vx, vy, vz, color, size, life, max: life, g: g == null ? 9 : g }; }
    _sparks(x, y, z, n, color, size) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 3;
        this.particles.push(this._p(x, y, z, Math.cos(a) * s, Math.sin(a) * s, 1 + Math.random() * 3, color, size * (0.5 + Math.random() * 0.7), 0.25 + Math.random() * 0.2, 12));
      }
    }
    _smoke(x, y, n, col) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = 0.3 + Math.random() * 0.8;
        this.particles.push(this._p(x, y, 0.2, Math.cos(a) * s, Math.sin(a) * s, 0.8 + Math.random(), col || 'rgba(230,230,230,0.8)', 0.45 + Math.random() * 0.3, 0.6 + Math.random() * 0.3, -0.5));
      }
    }
    _dmgText(f) {
      if (this.texts.length > 40) return;
      const z = f.tw ? 3.2 : 1.6;
      this.texts.push({ x: f.x + (Math.random() - 0.5) * 0.8, y: f.y, z, text: String(f.v), color: f.s === this.mySide ? '#ff6b6b' : '#ffffff', life: 0.8, max: 0.8, size: f.v >= 300 ? 0.75 : 0.55 });
    }
    _towerFx(f) {
      this.rings.push({ x: f.x, y: f.y, r: f.king ? 4.5 : 3.2, life: 0.8, max: 0.8, color: '255,170,60', fill: true });
      for (let i = 0; i < 34; i++) {
        const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 5;
        this.particles.push(this._p(f.x, f.y, 1 + Math.random() * 2, Math.cos(a) * s, Math.sin(a) * s, 2 + Math.random() * 6, i % 3 ? '#8e8e99' : (i % 2 ? '#ffb347' : '#5a5e6b'), 0.25 + Math.random() * 0.3, 1.0 + Math.random() * 0.4, 12));
      }
      this._smoke(f.x, f.y, 10, 'rgba(120,110,100,0.7)');
      this.shakeT = f.king ? 0.9 : 0.5;
      this.flashT = f.king ? 0.35 : 0.15;
    }
    _spellFx(f) {
      const colors = { zap: '170,220,255', arrows: '200,170,110', fireball: '255,130,30', freeze: '160,230,255', rocket: '255,110,40' };
      const col = colors[f.k] || '255,255,255';
      const life = f.k === 'freeze' ? 1.0 : 0.5;
      this.rings.push({ x: f.x, y: f.y, r: f.r, life, max: life, color: col, fill: true });
      if (f.k === 'zap') {
        for (let i = 0; i < 6; i++) this.beams.push({ zx: f.x + (Math.random() - 0.5) * f.r * 1.4, zy: f.y + (Math.random() - 0.5) * f.r * 1.4, life: 0.2, zap: true });
        this.flashT = Math.max(this.flashT, 0.08);
      } else if (f.k === 'arrows') {
        for (let i = 0; i < 26; i++) { const a = Math.random() * Math.PI * 2, r = Math.random() * f.r; this.particles.push(this._p(f.x + Math.cos(a) * r, f.y + Math.sin(a) * r, 0.1, 0, 0, 1.5, '#6b4a22', 0.14, 0.3, 6)); }
      } else if (f.k === 'fireball' || f.k === 'rocket') {
        const n = f.k === 'rocket' ? 30 : 20;
        for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 5; this.particles.push(this._p(f.x, f.y, 0.4, Math.cos(a) * s, Math.sin(a) * s, 2 + Math.random() * 4, i % 2 ? '#ffb02e' : '#ff5a1f', 0.3 + Math.random() * 0.3, 0.5, 10)); }
        this._smoke(f.x, f.y, 8, 'rgba(70,60,60,0.7)');
        this.shakeT = Math.max(this.shakeT, f.k === 'rocket' ? 0.4 : 0.22);
      } else if (f.k === 'freeze') {
        for (let i = 0; i < 18; i++) { const a = Math.random() * Math.PI * 2, r = Math.random() * f.r; this.particles.push(this._p(f.x + Math.cos(a) * r, f.y + Math.sin(a) * r, 0.2, 0, 0, 1.2, '#e6f8ff', 0.18, 0.9, -0.5)); }
      }
    }
    bubble(side, text) {
      const king = TOWER_SPOTS.find(t => t.side === side && t.lane === 'K');
      this.bubbles.push({ side, text, x: king.x, y: king.y, life: 2.2 });
    }
    screenOf(x, y, z) { const p = this.toScreen(x, y, z || 0); return { x: p[0], y: p[1] }; }

    // ---------- birim animasyon durumu ----------
    _animFor(e, now, dt) {
      let a = this.anim.get(e.id);
      const vy = this.vyOf(e.y);
      if (!a) {
        a = { lx: e.x, lv: vy, walk: Math.random() * 6, moving: false, atkT: -1, prevAtk: false, face: e.s === this.mySide ? -1 : 1, flip: 1, born: now, seen: now, still: 0, key: e.k, s: e.s, hx: e.x, hy: e.y };
        a.drop = (e.f & 2) ? 1 : 0;
        this.anim.set(e.id, a);
      }
      const dx = e.x - a.lx, dv = vy - a.lv;
      const d = Math.hypot(dx, dv);
      if (d > 0.002) {
        a.walk += d * 6.5;
        a.still = 0;
        a.moving = true;
        if (Math.abs(dx) > 0.004) a.flip = dx > 0 ? 1 : -1;
        if (Math.abs(dv) > 0.004) a.face = dv < 0 ? -1 : 1;
      } else {
        a.still += dt;
        if (a.still > 0.12) a.moving = false;
      }
      a.lx = e.x; a.lv = vy; a.seen = now;
      a.hx = e.x; a.hy = e.y;
      const atk = !!(e.f & 32);
      if (atk && !a.prevAtk) a.atkT = 0;
      a.prevAtk = atk;
      if (a.atkT >= 0) { a.atkT += dt / 0.42; if (a.atkT > 1) a.atkT = -1; }
      if (a.drop > 0) {
        a.drop -= dt / 0.35;
        if (a.drop <= 0) { a.drop = 0; this.rings.push({ x: e.x, y: e.y, r: 0.9 * e.r + 0.4, life: 0.3, max: 0.3, color: '255,255,255', fill: false }); this._smoke(e.x, e.y, 3, 'rgba(220,200,160,0.7)'); }
      }
      return a;
    }

    // ---------- ana çizim ----------
    draw(view, t) {
      const c = this.ctx;
      if (!this.cw || !this.bg) { this.resize(); if (!this.cw) return; }
      const dt = this.lastT ? Math.min(0.05, Math.max(0, (t - this.lastT) / 1000)) : 0.016;
      this.lastT = t;
      const now = t / 1000;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.clearRect(0, 0, this.cw, this.ch);
      if (this.shakeT > 0) {
        this.shakeT -= dt;
        const m = this.ts * 0.3 * Math.max(0, this.shakeT);
        c.translate((Math.random() - 0.5) * m * 2, (Math.random() - 0.5) * m * 2);
      }
      c.drawImage(this.bg, 0, 0, this.cw, this.ch);
      if (!view) return;
      this._water(c, now);
      if (this.drag) this._zones(c, view);

      // zehir alanları (zeminde)
      for (const a of view.areas) {
        const vy = this.vyOf(a.y);
        this.groundEllipse(c, a.x, vy, a.r); c.fillStyle = 'rgba(120,210,60,0.25)'; c.fill();
        c.strokeStyle = 'rgba(90,170,40,0.8)'; c.lineWidth = 2; c.setLineDash([this.ts * 0.3, this.ts * 0.2]); c.stroke(); c.setLineDash([]);
        for (let i = 0; i < 5; i++) {
          const bb = (now * 0.7 + i * 0.2 + a.id * 0.13) % 1;
          const p = this.P(a.x + Math.cos(i * 1.7 + a.id) * a.r * 0.6, vy + Math.sin(i * 2.3) * a.r * 0.5, bb * 1.2);
          c.fillStyle = 'rgba(190,255,120,' + (0.7 * (1 - bb)) + ')';
          c.beginPath(); c.arc(p[0], p[1], p[2] * 0.12, 0, Math.PI * 2); c.fill();
        }
      }
      // zemin halkaları (patlamalar)
      this._rings(c, dt);

      // ölen birimler için iz: görünümden kaybolanları yakala
      const ids = new Set();
      for (const e of view.ents) ids.add(e.id);
      for (const [id, a] of this.anim) {
        if (!ids.has(id)) {
          if (now - a.seen < 0.5 && CARDS[a.key] && CARDS[a.key].type === 'troop') this.dying.push({ key: a.key, x: a.hx, y: a.hy, s: a.s, flip: a.flip, face: a.face, t0: now, air: CARDS[a.key].air });
          this.anim.delete(id);
        }
      }

      // çizilecekleri derinliğe göre sırala
      const items = [];
      const towerAt = new Set();
      for (const e of view.ents) {
        if (e.kind === 'tower') towerAt.add(e.s + e.lane);
        items.push({ v: this.vyOf(e.y), z: (e.f & 1) ? 1 : 0, e });
      }
      for (const sp of TOWER_SPOTS) if (!towerAt.has(sp.side + sp.lane)) items.push({ v: this.vyOf(sp.y), z: 0, rubble: sp });
      for (const g of (view.ghosts || [])) items.push({ v: this.vyOf(g.y), z: 0, ghost: g });
      for (const d of this.dying) items.push({ v: this.vyOf(d.y), z: d.air ? 1 : 0, dead: d });
      items.sort((a, b) => (a.z - b.z) || (a.v - b.v));
      // gölgeler (uçanlar için zeminde)
      for (const it of items) if (it.e && (it.e.f & 1)) { this.groundEllipse(c, it.e.x, it.v, it.e.r * 0.9); c.fillStyle = 'rgba(0,0,0,0.22)'; c.fill(); }
      for (const it of items) {
        if (it.rubble) this._rubble(c, it.rubble);
        else if (it.ghost) this._ghostUnit(c, it.ghost, now);
        else if (it.dead) this._dead(c, it.dead, now);
        else if (it.e.kind === 'tower') this._tower(c, it.e, now, dt);
        else if (it.e.kind === 'building') this._building(c, it.e, now, dt);
        else this._troop(c, it.e, now, dt);
      }
      this.dying = this.dying.filter(d => now - d.t0 < 0.6);
      this._beams(c, view, dt);
      this._projs(c, view, now);
      this._particles(c, dt);
      this._texts(c, dt);
      this._popups(c, dt);
      if (this.drag) this._ghost(c, now);
      if (this.flashT > 0) {
        this.flashT -= dt;
        c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        c.fillStyle = 'rgba(255,245,220,' + Math.max(0, this.flashT * 2) + ')';
        c.fillRect(0, 0, this.cw, this.ch);
      }
    }

    _water(c, now) {
      const rT = this.flip ? H - RIVER_BOT : RIVER_TOP, rB = this.flip ? H - RIVER_TOP : RIVER_BOT;
      c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = Math.max(1, this.ts * 0.06);
      for (let i = 0; i < 10; i++) {
        const xx = ((i * 2.1 + now * 0.6) % (W + 2)) - 1;
        if (BRIDGES.some(b => Math.abs(xx + 0.4 - b) < 1.4)) continue;
        const vy = rT + 0.6 + (i % 3) * 0.45;
        if (vy > rB - 0.2) continue;
        const a = this.P(xx, vy, 0), b = this.P(xx + 0.4, vy - 0.12, 0), d = this.P(xx + 0.8, vy, 0);
        c.beginPath(); c.moveTo(a[0], a[1]); c.quadraticCurveTo(b[0], b[1], d[0], d[1]); c.stroke();
      }
    }

    _zones(c, view) {
      const d = this.drag;
      const card = CARDS[d.key];
      if (!card || card.type === 'spell') return;
      const ms = this.mySide;
      const enemyAlive = lane => view.ents.some(e => e.kind === 'tower' && e.s === 1 - ms && e.lane === lane);
      c.fillStyle = 'rgba(255,40,40,0.22)';
      // kendi bakışımızda ly < sınır olan bölgeler yasak; ekranda vy = ly (biz hep alttayız)
      for (const [lane, x0, x1] of [['L', 0, 9], ['R', 9, 18]]) {
        const lim = enemyAlive(lane) ? RIVER_BOT + 0.5 : TA.POCKET_Y;
        // görüş uzayında x ekseni dünya ile aynı; misafir için şerit adları dünya x'ine göre
        this.quad(c, x0, 0, x1, lim, 0); c.fill();
      }
      c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 2; c.setLineDash([this.ts * 0.3, this.ts * 0.2]);
      for (const [lane, x0, x1] of [['L', 0, 9], ['R', 9, 18]]) {
        const lim = enemyAlive(lane) ? RIVER_BOT + 0.5 : TA.POCKET_Y;
        const a = this.P(x0, lim, 0), b = this.P(x1, lim, 0);
        c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
      }
      c.setLineDash([]);
    }

    _hpBar(c, sx, syy, w, h, frac, side, num) {
      const mine = side === this.mySide;
      c.fillStyle = 'rgba(0,0,0,0.7)';
      rr(c, sx - w / 2 - 1.5, syy - h / 2 - 1.5, w + 3, h + 3, h / 2 + 1.5); c.fill();
      c.fillStyle = mine ? '#4fa3ff' : '#ff5252';
      if (frac > 0) { rr(c, sx - w / 2, syy - h / 2, Math.max(h, w * Math.min(1, frac)), h, h / 2); c.fill(); }
      c.fillStyle = 'rgba(255,255,255,0.3)';
      c.fillRect(sx - w / 2 + h / 2, syy - h / 2 + 1, Math.max(0, w * Math.min(1, frac) - h), Math.max(1, h * 0.28));
      if (num != null) {
        c.font = '900 ' + Math.max(9, Math.round(h * 1.05)) + 'px system-ui,sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.75)'; c.strokeText(String(num), sx, syy + 0.5);
        c.fillStyle = '#fff'; c.fillText(String(num), sx, syy + 0.5);
      }
    }

    // Kutu (kule gövdesi) — görüş uzayında
    _box(c, x, vy, hs, h, cols) {
      const xl = x - hs, xr = x + hs, vb = vy - hs, vf = vy + hs;
      const fl0 = this.P(xl, vf, 0), fr0 = this.P(xr, vf, 0), fl1 = this.P(xl, vf, h), fr1 = this.P(xr, vf, h);
      const bl1 = this.P(xl, vb, h), br1 = this.P(xr, vb, h), bl0 = this.P(xl, vb, 0), br0 = this.P(xr, vb, 0);
      // yan yüz (kameranın göremediği taraf değil, merkeze bakan taraf)
      if (x < W / 2) { c.fillStyle = cols.side; c.beginPath(); c.moveTo(fr0[0], fr0[1]); c.lineTo(br0[0], br0[1]); c.lineTo(br1[0], br1[1]); c.lineTo(fr1[0], fr1[1]); c.closePath(); c.fill(); }
      else if (x > W / 2) { c.fillStyle = cols.side; c.beginPath(); c.moveTo(fl0[0], fl0[1]); c.lineTo(bl0[0], bl0[1]); c.lineTo(bl1[0], bl1[1]); c.lineTo(fl1[0], fl1[1]); c.closePath(); c.fill(); }
      // ön yüz
      const g = c.createLinearGradient(0, fl1[1], 0, fl0[1]);
      g.addColorStop(0, cols.front0); g.addColorStop(1, cols.front1);
      c.fillStyle = g; c.beginPath(); c.moveTo(fl0[0], fl0[1]); c.lineTo(fr0[0], fr0[1]); c.lineTo(fr1[0], fr1[1]); c.lineTo(fl1[0], fl1[1]); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(30,25,40,0.6)'; c.lineWidth = 1.5; c.stroke();
      // üst yüz
      c.fillStyle = cols.top; c.beginPath(); c.moveTo(fl1[0], fl1[1]); c.lineTo(fr1[0], fr1[1]); c.lineTo(br1[0], br1[1]); c.lineTo(bl1[0], bl1[1]); c.closePath(); c.fill(); c.stroke();
      return { fl0, fr0, fl1, fr1, bl1, br1 };
    }

    _tower(c, e, now, dt) {
      const king = e.k === 'king';
      const G = TOWER_GEO[e.k];
      const vy = this.vyOf(e.y);
      const T = TEAM[this.team(e.s)];
      const flash = (e.f & 128) ? 1 : 0;
      // gölge
      c.fillStyle = 'rgba(0,0,0,0.3)';
      this.quad(c, e.x - G.hs + 0.25, vy - G.hs + 0.3, e.x + G.hs + 0.35, vy + G.hs + 0.35, 0); c.fill();
      const stone = flash ? { front0: '#e6e6ee', front1: '#c5c5d0', side: '#a5a5b2', top: '#d8d8e2' } : { front0: '#b9b6c4', front1: '#8b8899', side: '#6f6c7c', top: '#a9a6b6' };
      const b = this._box(c, e.x, vy, G.hs, G.h, stone);
      // taş çizgileri
      c.strokeStyle = 'rgba(60,55,75,0.35)'; c.lineWidth = 1;
      for (let k = 1; k < 4; k++) {
        const z = G.h * k / 4; const a = this.P(e.x - G.hs, vy + G.hs, z), d = this.P(e.x + G.hs, vy + G.hs, z);
        c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(d[0], d[1]); c.stroke();
        for (let m = 0; m < 3; m++) {
          const xx = e.x - G.hs + (G.hs * 2) * ((m + (k % 2) * 0.5 + 0.25) / 3);
          const p1 = this.P(xx, vy + G.hs, z), p2 = this.P(xx, vy + G.hs, z - G.h / 4);
          c.beginPath(); c.moveTo(p1[0], p1[1]); c.lineTo(p2[0], p2[1]); c.stroke();
        }
      }
      // takım sancağı (ön yüzde)
      const bw = G.hs * 0.55;
      const s1 = this.P(e.x - bw, vy + G.hs + 0.01, G.h * 0.92), s2 = this.P(e.x + bw, vy + G.hs + 0.01, G.h * 0.92);
      const s3 = this.P(e.x + bw, vy + G.hs + 0.01, G.h * 0.35), s4 = this.P(e.x, vy + G.hs + 0.01, G.h * 0.22), s5 = this.P(e.x - bw, vy + G.hs + 0.01, G.h * 0.35);
      c.fillStyle = T.main; c.beginPath(); c.moveTo(s1[0], s1[1]); c.lineTo(s2[0], s2[1]); c.lineTo(s3[0], s3[1]); c.lineTo(s4[0], s4[1]); c.lineTo(s5[0], s5[1]); c.closePath(); c.fill();
      c.strokeStyle = T.deep; c.lineWidth = 1.5; c.stroke();
      const em = this.P(e.x, vy + G.hs + 0.02, G.h * 0.62);
      c.fillStyle = '#ffc531'; c.beginPath(); c.arc(em[0], em[1], em[2] * 0.22, 0, Math.PI * 2); c.fill();
      // mazgallar (ön kenar)
      const n = king ? 5 : 4;
      for (let i = 0; i < n; i++) {
        const xx = e.x - G.hs + (i + 0.5) * (G.hs * 2 / n);
        const a = this.P(xx - 0.2, vy + G.hs, G.h), d = this.P(xx + 0.2, vy + G.hs, G.h + 0.35);
        c.fillStyle = flash ? '#e0e0ea' : '#a8a5b5';
        c.fillRect(a[0], d[1], d[0] - a[0], a[1] - d[1]);
        c.strokeStyle = 'rgba(30,25,40,0.5)'; c.lineWidth = 1; c.strokeRect(a[0], d[1], d[0] - a[0], a[1] - d[1]);
      }
      // üstteki karakter
      const top = this.P(e.x, vy + 0.1, G.h);
      let a = this.anim.get(e.id);
      if (!a) { a = { atkT: -1, prevAtk: false }; this.anim.set(e.id, a); }
      a.seen = now; a.key = e.k; a.hx = e.x; a.hy = e.y; a.s = e.s;
      const atk = !!(e.f & 32);
      if (atk && !a.prevAtk) a.atkT = 0;
      a.prevAtk = atk;
      if (a.atkT >= 0) { a.atkT += dt / 0.4; if (a.atkT > 1) a.atkT = -1; }
      const sleeping = king && !(e.f & 64);
      Art.drawUnit(c, king ? 't_king' : 't_princess', top[0], top[1], top[2] * (king ? 1.6 : 1.45), {
        t: now, atk: a.atkT, face: e.s === this.mySide ? -1 : 1, team: this.team(e.s), sleeping, frozen: !!(e.f & 4), seed: e.id
      });
      if (king && !sleeping) {
        // kral kulesinin topu
        const cp = this.P(e.x + 1.0, vy + 0.6, G.h);
        c.fillStyle = '#3a3f4b'; c.beginPath(); c.arc(cp[0], cp[1] - cp[2] * 0.15, cp[2] * 0.28, 0, Math.PI * 2); c.fill();
      }
      if (sleeping) {
        c.font = '900 ' + Math.round(top[2] * 0.55) + 'px system-ui,sans-serif';
        c.fillStyle = 'rgba(255,255,255,0.9)'; c.textAlign = 'center';
        c.fillText('z', top[0] + top[2] * 0.9, top[1] - top[2] * 2.2 - Math.sin(now * 2) * top[2] * 0.1);
        c.fillText('Z', top[0] + top[2] * 1.25, top[1] - top[2] * 2.8 - Math.sin(now * 2 + 1) * top[2] * 0.1);
      }
      if (e.f & 4) { c.fillStyle = 'rgba(170,225,255,0.45)'; c.beginPath(); c.moveTo(b.fl0[0], b.fl0[1]); c.lineTo(b.fr0[0], b.fr0[1]); c.lineTo(b.br1[0], b.br1[1] - top[2]); c.lineTo(b.bl1[0], b.bl1[1] - top[2]); c.closePath(); c.fill(); }
      // can barı
      const hb = this.P(e.x, vy - G.hs, G.h + (king ? 2.9 : 2.5));
      this._hpBar(c, hb[0], hb[1], hb[2] * G.hs * 1.9, Math.max(9, hb[2] * 0.42), e.hp / e.mh, e.s, e.hp);
    }

    _rubble(c, sp) {
      const G = TOWER_GEO[sp.key], vy = this.vyOf(sp.y);
      c.fillStyle = 'rgba(60,50,40,0.4)';
      this.groundEllipse(c, sp.x, vy, G.hs * 1.1); c.fill();
      const rocks = [[-0.5, -0.3, 0.45, 0.35], [0.45, 0.1, 0.4, 0.3], [-0.1, 0.4, 0.35, 0.45], [0.55, -0.45, 0.3, 0.2], [-0.6, 0.35, 0.28, 0.25], [0.05, -0.1, 0.5, 0.6]];
      for (const [rx, rv, rs, rz] of rocks) {
        const p = this.P(sp.x + rx * G.hs, vy + rv * G.hs, 0);
        const r = rs * p[2];
        c.fillStyle = '#6f6c7c'; c.beginPath(); c.ellipse(p[0], p[1] - r * rz, r, r * 0.75, 0.2, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#9a97a8'; c.beginPath(); c.ellipse(p[0] - r * 0.15, p[1] - r * rz - r * 0.2, r * 0.6, r * 0.35, 0.2, 0, Math.PI * 2); c.fill();
      }
    }

    _building(c, e, now, dt) {
      const vy = this.vyOf(e.y);
      const a = this._animFor(e, now, dt);
      const p = this.P(e.x, vy, a.drop > 0 ? a.drop * a.drop * 4 : 0);
      const tm = this.team(e.s);
      this.groundEllipse(c, e.x, vy, e.r * 1.05); c.fillStyle = 'rgba(0,0,0,0.28)'; c.fill();
      this.groundEllipse(c, e.x, vy, e.r * 1.1); c.strokeStyle = TEAM[tm].main; c.lineWidth = Math.max(2, p[2] * 0.1); c.stroke();
      if (e.f & 2) c.globalAlpha = 0.75;
      let aim = 0;
      if (e.k === 'cannon') aim = (e.s === this.mySide ? Math.PI : 0) + Math.sin(now * 0.7 + e.id) * 0.3;
      Art.drawBuilding(c, e.k, p[0], p[1], p[2] * 1.15, { t: now, team: tm, atk: a.atkT, aim });
      c.globalAlpha = 1;
      if (e.f & 4) { c.fillStyle = 'rgba(170,225,255,0.5)'; c.beginPath(); c.ellipse(p[0], p[1] - p[2] * 0.6, p[2] * 0.9, p[2] * 0.8, 0, 0, Math.PI * 2); c.fill(); }
      if (e.f & 128) { c.fillStyle = 'rgba(255,255,255,0.3)'; c.beginPath(); c.ellipse(p[0], p[1] - p[2] * 0.6, p[2] * 0.8, p[2] * 0.7, 0, 0, Math.PI * 2); c.fill(); }
      const hb = this.P(e.x, vy, e.k === 'inferno' ? 2.3 : e.k === 'gobhut' ? 2.2 : 1.4);
      this._hpBar(c, hb[0], hb[1], Math.max(hb[2] * 1.3, 26), Math.max(4, hb[2] * 0.18), e.hp / e.mh, e.s);
    }

    _troop(c, e, now, dt) {
      const vy = this.vyOf(e.y);
      const a = this._animFor(e, now, dt);
      const air = !!(e.f & 1);
      const hover = air ? 1.0 + Math.sin(now * 3 + e.id) * 0.08 : 0;
      const drop = a.drop > 0 ? a.drop * a.drop * 5 : 0;
      const p = this.P(e.x, vy, hover + drop);
      const tm = this.team(e.s);
      if (!air) {
        this.groundEllipse(c, e.x, vy, Math.max(0.42, e.r) * 1.15); c.fillStyle = 'rgba(0,0,0,0.25)'; c.fill();
        this.groundEllipse(c, e.x, vy, Math.max(0.42, e.r) * 1.2); c.strokeStyle = TEAM[tm].main; c.globalAlpha = 0.85; c.lineWidth = Math.max(1.5, p[2] * 0.07); c.stroke(); c.globalAlpha = 1;
      }
      if (e.f & 2) c.globalAlpha = 0.8;
      const u = p[2] * UNIT_SCALE;
      // hücum izi
      if (e.f & 16) {
        c.strokeStyle = 'rgba(255,220,120,0.8)'; c.lineWidth = Math.max(1.5, u * 0.06);
        for (let i = -1; i <= 1; i++) { c.beginPath(); c.moveTo(p[0] - a.flip * u * 0.7, p[1] - u * (0.4 + i * 0.25)); c.lineTo(p[0] - a.flip * u * 1.5, p[1] - u * (0.4 + i * 0.25)); c.stroke(); }
      }
      Art.drawUnit(c, e.k, p[0], p[1], u, {
        t: now, walk: a.walk, moving: a.moving && !(e.f & 2), atk: a.atkT, face: a.face, flip: a.flip,
        team: tm, frozen: !!(e.f & 4), seed: e.id, charge: !!(e.f & 16)
      });
      c.globalAlpha = 1;
      const hh = unitHeight(e.k);
      if (e.f & 128) { c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.ellipse(p[0], p[1] - u * hh * 0.5, u * 0.55, u * hh * 0.55, 0, 0, Math.PI * 2); c.fill(); }
      if (e.f & 4) {
        c.fillStyle = 'rgba(170,225,255,0.5)'; c.beginPath(); c.ellipse(p[0], p[1] - u * hh * 0.5, u * 0.6, u * hh * 0.6, 0, 0, Math.PI * 2); c.fill();
        c.strokeStyle = 'rgba(230,250,255,0.9)'; c.lineWidth = 1.5; c.stroke();
      }
      if (e.f & 8) {
        c.fillStyle = '#ffe14d';
        for (let i = 0; i < 3; i++) { const an = now * 6 + i * 2.1; c.beginPath(); c.arc(p[0] + Math.cos(an) * u * 0.4, p[1] - u * hh - u * 0.1 + Math.sin(an) * u * 0.12, Math.max(1.5, u * 0.07), 0, Math.PI * 2); c.fill(); }
      }
      if (e.f & 2) {
        c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 2;
        c.beginPath(); const pc = this.P(e.x, vy, 0); c.ellipse(pc[0], pc[1], (e.r + 0.25) * pc[2], (e.r + 0.25) * pc[2] * Q, 0, now * 6, now * 6 + Math.PI * 1.2); c.stroke();
      } else if (e.hp < e.mh) {
        this._hpBar(c, p[0], p[1] - u * hh - u * 0.18, Math.max(u * 0.9, 18), Math.max(3, u * 0.13), e.hp / e.mh, e.s);
      }
    }

    _ghostUnit(c, g, now) {
      const vy = this.vyOf(g.y);
      const card = CARDS[g.k];
      if (!card) return;
      c.globalAlpha = 0.55;
      if (card.type === 'spell') {
        this.groundEllipse(c, g.x, vy, card.radius); c.fillStyle = 'rgba(255,255,255,0.15)'; c.fill();
      } else if (card.type === 'building') {
        const p = this.P(g.x, vy, 0);
        Art.drawBuilding(c, g.k, p[0], p[1], p[2] * 1.15, { t: now, team: 'me' });
      } else {
        for (const [ox, oy] of TA.formation(Math.min(card.count || 1, 6))) {
          const p = this.P(g.x + ox, vy + oy, 0); // dizilim ofseti görüş uzayında her iki taraf için +oy
          Art.drawUnit(c, g.k, p[0], p[1], p[2] * UNIT_SCALE, { t: now, team: 'me', face: -1 });
        }
      }
      c.globalAlpha = 1;
    }

    _dead(c, d, now) {
      const k = (now - d.t0) / 0.6;
      if (k >= 1) return;
      const vy = this.vyOf(d.y);
      const p = this.P(d.x, vy, d.air ? Math.max(0, 1 - k * 1.6) : 0);
      c.save();
      c.globalAlpha = Math.max(0, 1 - k);
      c.translate(p[0], p[1]);
      c.rotate(d.flip * Math.min(1.3, k * 3));
      Art.drawUnit(c, d.key, 0, 0, p[2] * UNIT_SCALE, { t: d.t0, team: this.team(d.s), face: d.face, flip: d.flip, frozen: true });
      c.restore();
      c.globalAlpha = 1;
    }

    _rings(c, dt) {
      for (let i = this.rings.length - 1; i >= 0; i--) {
        const r = this.rings[i];
        r.life -= dt;
        if (r.life <= 0) { this.rings.splice(i, 1); continue; }
        const k = 1 - r.life / r.max;
        const rad = r.r * (0.35 + 0.65 * Math.min(1, k * 1.6));
        this.groundEllipse(c, r.x, this.vyOf(r.y), rad, r.z || 0);
        if (r.fill) { c.fillStyle = 'rgba(' + r.color + ',' + (0.4 * (1 - k)) + ')'; c.fill(); }
        c.strokeStyle = 'rgba(' + r.color + ',' + (0.9 * (1 - k)) + ')'; c.lineWidth = Math.max(2, this.ts * 0.12); c.stroke();
      }
    }

    _beams(c, view, dt) {
      for (let i = this.beams.length - 1; i >= 0; i--) {
        const b = this.beams[i];
        b.life -= dt;
        if (b.life <= 0) { this.beams.splice(i, 1); continue; }
        if (b.zap) {
          const g = this.P(b.zx, this.vyOf(b.zy), 0), top = this.P(b.zx, this.vyOf(b.zy), 5);
          c.strokeStyle = 'rgba(200,235,255,' + Math.min(1, b.life * 6) + ')'; c.lineWidth = Math.max(2, this.ts * 0.14);
          c.beginPath(); c.moveTo(top[0], top[1]);
          for (let k = 1; k <= 5; k++) c.lineTo(lerp(top[0], g[0], k / 5) + (k < 5 ? (Math.random() - 0.5) * this.ts : 0), lerp(top[1], g[1], k / 5));
          c.stroke();
          continue;
        }
        const a = view.ents.find(e => e.id === b.a), t = view.ents.find(e => e.id === b.b);
        if (!a || !t) continue;
        const pa = this.P(a.x, this.vyOf(a.y), 1.8), pb = this.P(t.x, this.vyOf(t.y), (t.f & 1) ? 1.4 : 0.6);
        const w = [0.08, 0.16, 0.3][b.st || 0] * this.ts;
        c.strokeStyle = ['rgba(255,190,90,0.9)', 'rgba(255,120,40,0.95)', 'rgba(255,60,20,1)'][b.st || 0];
        c.lineWidth = Math.max(1.5, w);
        c.beginPath(); c.moveTo(pa[0], pa[1]); c.lineTo(pb[0], pb[1]); c.stroke();
        c.strokeStyle = 'rgba(255,255,200,0.9)'; c.lineWidth = Math.max(1, w * 0.35);
        c.beginPath(); c.moveTo(pa[0], pa[1]); c.lineTo(pb[0], pb[1]); c.stroke();
      }
    }

    _projs(c, view, now) {
      const seen = new Map();
      for (const p of view.projs) {
        let m = this.projMem.get(p.id);
        const tx = p.tx != null ? p.tx : p.x, ty = p.ty != null ? p.ty : p.y;
        if (!m) m = { x0: p.x, y0: p.y, d0: Math.max(0.01, Math.hypot(tx - p.x, ty - p.y)), px: p.x, py: p.y, ang: 0 };
        seen.set(p.id, m);
        const rem = Math.hypot(tx - p.x, ty - p.y);
        const k = Math.max(0, Math.min(1, 1 - rem / m.d0));
        const vy = this.vyOf(p.y);
        let z;
        if (p.sp) z = 0.5 + Math.min(6, m.d0 * 0.45) * 4 * k * (1 - k) + (1 - k) * 2.5;
        else z = lerp(p.h0 || 0.6, p.h1 || 0.5, k) + ((p.k === 'bomb' || p.k === 'fire' || p.k === 'ball') ? m.d0 * 0.25 * 4 * k * (1 - k) : 0);
        const s = this.P(p.x, vy, z);
        const dxs = s[0] - (m.sx != null ? m.sx : s[0]), dys = s[1] - (m.sy != null ? m.sy : s[1]);
        if (Math.abs(dxs) + Math.abs(dys) > 0.5) m.ang = Math.atan2(dys, dxs);
        m.sx = s[0]; m.sy = s[1];
        const u = s[2];
        // zemindeki gölge
        const g = this.P(p.x, vy, 0);
        c.fillStyle = 'rgba(0,0,0,0.2)'; c.beginPath(); c.ellipse(g[0], g[1], u * (p.sp ? 0.6 : 0.15), u * (p.sp ? 0.25 : 0.07), 0, 0, Math.PI * 2); c.fill();
        if (p.sp) {
          if (p.k === 'arrows') {
            c.save(); c.translate(s[0], s[1]); c.rotate(m.ang);
            for (let i = 0; i < 9; i++) {
              const ox = Math.cos(i * 2.4) * u * 0.9, oy = Math.sin(i * 2.4) * u * 0.6;
              c.strokeStyle = '#5a3d1c'; c.lineWidth = Math.max(1.5, u * 0.07);
              c.beginPath(); c.moveTo(ox - u * 0.45, oy); c.lineTo(ox + u * 0.3, oy); c.stroke();
              c.fillStyle = '#ddd'; c.beginPath(); c.arc(ox + u * 0.32, oy, u * 0.06, 0, Math.PI * 2); c.fill();
            }
            c.restore();
          } else {
            if (p.k === 'fireball' || p.k === 'rocket') {
              if (Math.random() < 0.7) this.particles.push(this._p(p.x, p.y, z, 0, 0, 0.3, Math.random() < 0.5 ? '#ffb02e' : 'rgba(120,110,100,0.7)', 0.3 + Math.random() * 0.2, 0.35, -1));
              c.fillStyle = 'rgba(255,150,40,0.35)'; c.beginPath(); c.arc(s[0], s[1], u * 0.8, 0, Math.PI * 2); c.fill();
            }
            c.save(); c.translate(s[0], s[1]); if (p.k === 'rocket') c.rotate(m.ang + Math.PI / 2 - 0.6);
            Art.drawSpellIcon(c, p.k, 0, 0, u * 0.9, now);
            c.restore();
          }
          continue;
        }
        switch (p.k) {
          case 'arrow': case 'spear': {
            const len = u * (p.k === 'spear' ? 0.75 : 0.55);
            c.save(); c.translate(s[0], s[1]); c.rotate(m.ang);
            c.strokeStyle = p.k === 'spear' ? '#3c2a14' : '#6b4a22'; c.lineWidth = Math.max(1.5, u * (p.k === 'spear' ? 0.09 : 0.06));
            c.beginPath(); c.moveTo(-len, 0); c.lineTo(0, 0); c.stroke();
            c.fillStyle = '#e5e5e5'; c.beginPath(); c.moveTo(u * 0.12, 0); c.lineTo(-u * 0.04, -u * 0.06); c.lineTo(-u * 0.04, u * 0.06); c.closePath(); c.fill();
            c.restore();
            break;
          }
          case 'fire':
            c.fillStyle = 'rgba(255,120,30,0.45)'; c.beginPath(); c.arc(s[0], s[1], u * 0.34, 0, Math.PI * 2); c.fill();
            c.fillStyle = '#ffd25a'; c.beginPath(); c.arc(s[0], s[1], u * 0.17, 0, Math.PI * 2); c.fill();
            if (Math.random() < 0.5) this.particles.push(this._p(p.x, p.y, z, 0, 0, 0.2, '#ff9b3d', 0.15, 0.25, -1));
            break;
          case 'bomb':
            c.fillStyle = '#222'; c.beginPath(); c.arc(s[0], s[1], u * 0.2, 0, Math.PI * 2); c.fill();
            c.fillStyle = '#ffb02e'; c.beginPath(); c.arc(s[0] + u * 0.12, s[1] - u * 0.15, u * 0.07, 0, Math.PI * 2); c.fill();
            break;
          case 'ball':
            c.fillStyle = '#3a3a44'; c.beginPath(); c.arc(s[0], s[1], u * 0.21, 0, Math.PI * 2); c.fill();
            c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.arc(s[0] - u * 0.06, s[1] - u * 0.06, u * 0.07, 0, Math.PI * 2); c.fill();
            break;
          default: {
            const T = TEAM[this.team(p.s)];
            c.fillStyle = 'rgba(255,255,255,0.45)'; c.beginPath(); c.arc(s[0], s[1], u * 0.22, 0, Math.PI * 2); c.fill();
            c.fillStyle = T.glow; c.beginPath(); c.arc(s[0], s[1], u * 0.13, 0, Math.PI * 2); c.fill();
          }
        }
      }
      this.projMem = seen;
    }

    _particles(c, dt) {
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life -= dt;
        if (p.life <= 0) { this.particles.splice(i, 1); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.z += p.vz * dt; p.vz -= p.g * dt;
        if (p.z < 0) { p.z = 0; p.vz *= -0.3; p.vx *= 0.6; p.vy *= 0.6; }
        const s = this.P(p.x, this.vyOf(p.y), p.z);
        c.globalAlpha = Math.max(0, Math.min(1, p.life / p.max * 1.5));
        c.fillStyle = p.color;
        c.beginPath(); c.arc(s[0], s[1], Math.max(1, p.size * s[2] * 0.5), 0, Math.PI * 2); c.fill();
      }
      c.globalAlpha = 1;
      if (this.particles.length > 500) this.particles.splice(0, this.particles.length - 500);
    }

    _texts(c, dt) {
      for (let i = this.texts.length - 1; i >= 0; i--) {
        const t = this.texts[i];
        t.life -= dt;
        if (t.life <= 0) { this.texts.splice(i, 1); continue; }
        const k = 1 - t.life / t.max;
        const s = this.P(t.x, this.vyOf(t.y), t.z + k * 1.0);
        const size = Math.round(s[2] * t.size * (k < 0.15 ? 0.7 + k * 2 : 1));
        c.globalAlpha = Math.min(1, t.life * 3);
        c.font = '900 ' + size + 'px system-ui,sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.lineWidth = Math.max(2, size * 0.18); c.strokeStyle = 'rgba(0,0,0,0.8)'; c.strokeText(t.text, s[0], s[1]);
        c.fillStyle = t.color; c.fillText(t.text, s[0], s[1]);
      }
      c.globalAlpha = 1;
    }

    _popups(c, dt) {
      for (let i = this.popups.length - 1; i >= 0; i--) {
        const p = this.popups[i];
        p.life -= dt;
        if (p.life <= 0) { this.popups.splice(i, 1); continue; }
        const card = CARDS[p.k];
        const k = 1 - p.life / p.max;
        const s = this.P(p.x, this.vyOf(p.y), 2.4 + k * 0.5);
        const w = s[2] * 1.5, h = s[2] * 1.8;
        c.globalAlpha = Math.min(1, p.life * 3);
        c.fillStyle = 'rgba(120,20,20,0.9)'; rr(c, s[0] - w / 2, s[1] - h / 2, w, h, s[2] * 0.25); c.fill();
        c.strokeStyle = '#ffd6d6'; c.lineWidth = 1.5; c.stroke();
        const img = cardImage(p.k);
        if (img && img.complete && img.naturalWidth) c.drawImage(img, s[0] - w * 0.42, s[1] - h * 0.44, w * 0.84, h * 0.7);
        c.font = '900 ' + Math.round(s[2] * 0.42) + 'px system-ui,sans-serif';
        c.fillStyle = '#f3b6ff'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(String(card.cost), s[0], s[1] + h * 0.38);
        c.globalAlpha = 1;
      }
      for (let i = this.bubbles.length - 1; i >= 0; i--) {
        const b = this.bubbles[i];
        b.life -= dt;
        if (b.life <= 0) { this.bubbles.splice(i, 1); continue; }
        const mine = b.side === this.mySide;
        const s = this.P(b.x + 3.2, this.vyOf(b.y), mine ? 4.5 : 3.2);
        const u = s[2];
        c.globalAlpha = Math.min(1, b.life * 3);
        const pop = Math.min(1, (2.2 - b.life) * 6);
        c.fillStyle = '#fff'; rr(c, s[0] - u * 1.2 * pop, s[1] - u * pop, u * 2.4 * pop, u * 2.0 * pop, u * 0.6); c.fill();
        c.beginPath(); c.moveTo(s[0] - u * 0.9, s[1] + u * 0.8); c.lineTo(s[0] - u * 1.6, s[1] + u * 1.5); c.lineTo(s[0] - u * 0.3, s[1] + u * 0.9); c.fill();
        c.font = Math.round(u * 1.3 * pop) + 'px "Noto Color Emoji","Apple Color Emoji","Segoe UI Emoji",sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(b.text, s[0], s[1] + u * 0.05);
        c.globalAlpha = 1;
      }
    }

    _ghost(c, now) {
      const d = this.drag;
      if (!d || d.x == null) return;
      const card = CARDS[d.key];
      const vy = this.vyOf(d.y);
      const bad = !d.valid;
      if (card.type === 'spell') {
        this.groundEllipse(c, d.x, vy, card.radius);
        c.fillStyle = bad ? 'rgba(255,60,60,0.2)' : 'rgba(255,255,255,0.2)'; c.fill();
        c.strokeStyle = bad ? 'rgba(255,80,80,0.95)' : 'rgba(255,255,255,0.95)'; c.lineWidth = 2.5; c.stroke();
        const p = this.P(d.x, vy, 1.2 + Math.sin(now * 5) * 0.15);
        c.globalAlpha = 0.85; Art.drawSpellIcon(c, d.key, p[0], p[1], p[2] * 0.9, now); c.globalAlpha = 1;
        return;
      }
      const range = card.range && card.range >= 2 ? card.range + (card.r || 0.45) : 0;
      if (range) {
        this.groundEllipse(c, d.x, vy, range);
        c.strokeStyle = 'rgba(255,255,255,0.45)'; c.setLineDash([this.ts * 0.3, this.ts * 0.25]); c.lineWidth = 1.5; c.stroke(); c.setLineDash([]);
      }
      c.globalAlpha = bad ? 0.45 : 0.7;
      if (card.type === 'building') {
        this.groundEllipse(c, d.x, vy, card.r * 1.1); c.fillStyle = bad ? 'rgba(255,60,60,0.5)' : 'rgba(255,255,255,0.35)'; c.fill();
        const p = this.P(d.x, vy, 0);
        Art.drawBuilding(c, d.key, p[0], p[1], p[2] * 1.15, { t: now, team: 'me' });
      } else {
        for (const [ox, oy] of TA.formation(card.count || 1)) {
          const gv = vy + oy;
          this.groundEllipse(c, d.x + ox, gv, Math.max(0.38, card.r || 0.45)); c.fillStyle = bad ? 'rgba(255,60,60,0.55)' : 'rgba(255,255,255,0.45)'; c.fill();
          if ((card.count || 1) <= 6 || (Math.abs(ox) + Math.abs(oy)) < 1.2) {
            const p = this.P(d.x + ox, gv, card.air ? 1 : 0);
            Art.drawUnit(c, d.key, p[0], p[1], p[2] * UNIT_SCALE, { t: now, team: 'me', face: -1 });
          }
        }
      }
      c.globalAlpha = 1;
    }
  }

  // kart görsellerinin Image önbelleği (rakip kart açılır pencereleri için)
  const imgCache = {};
  function cardImage(k) {
    if (!imgCache[k]) { const im = new Image(); im.src = Art.cardArt(k, 96); imgCache[k] = im; }
    return imgCache[k];
  }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function rr(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  TA.Renderer = Renderer;
})(window);
