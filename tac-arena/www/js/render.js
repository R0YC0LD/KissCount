/* Taç Arena — canvas çizim motoru */
(function (root) {
  'use strict';
  const TA = root.TA;
  const { CARDS, W, H, RIVER_TOP, RIVER_BOT, BRIDGES, sy } = TA;

  const EMOJI_FONT = '"Noto Color Emoji","Apple Color Emoji","Segoe UI Emoji","Twemoji Mozilla",sans-serif';
  const TEAM = {
    me: { fill: '#3b82f6', dark: '#1e3a8a', light: '#93c5fd', roof: '#2563eb' },
    op: { fill: '#ef4444', dark: '#7f1d1d', light: '#fca5a5', roof: '#dc2626' }
  };

  const TOWER_SPOTS = [];
  for (const side of [0, 1]) {
    TOWER_SPOTS.push({ side, lane: 'L', key: 'princess', x: 3.5, y: sy(side, 25.5) });
    TOWER_SPOTS.push({ side, lane: 'R', key: 'princess', x: 14.5, y: sy(side, 25.5) });
    TOWER_SPOTS.push({ side, lane: 'K', key: 'king', x: 9, y: sy(side, 29) });
  }

  class Renderer {
    constructor(canvas) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.flip = false;
      this.mySide = 0;
      this.particles = [];
      this.rings = [];
      this.beams = [];
      this.popups = [];
      this.bubbles = [];
      this.shakeT = 0;
      this.prevProj = new Map();
      this.emojiCache = new Map();
      this.drag = null;
      this.lastView = null;
      this.ts = 10; this.ox = 0; this.oy = 0;
      this.dpr = 1; this.cw = 0; this.ch = 0;
      this.lastT = 0;
    }

    resize() {
      const r = this.cv.getBoundingClientRect();
      const dpr = Math.min(root.devicePixelRatio || 1, 2.5);
      this.dpr = dpr;
      this.cw = r.width; this.ch = r.height;
      this.cv.width = Math.max(1, Math.round(r.width * dpr));
      this.cv.height = Math.max(1, Math.round(r.height * dpr));
      this.ts = Math.min(r.width / W, r.height / H);
      this.ox = (r.width - W * this.ts) / 2;
      this.oy = (r.height - H * this.ts) / 2;
      this.emojiCache.clear();
      this._buildBg();
    }

    toScreen(x, y) { const vy = this.flip ? H - y : y; return [this.ox + x * this.ts, this.oy + vy * this.ts]; }
    toWorld(px, py) { const x = (px - this.ox) / this.ts; const vy = (py - this.oy) / this.ts; return [x, this.flip ? H - vy : vy]; }
    team(side) { return side === this.mySide ? TEAM.me : TEAM.op; }

    emoji(ch, px) {
      px = Math.max(6, Math.round(px));
      const key = ch + '|' + px;
      let c = this.emojiCache.get(key);
      if (c) return c;
      const s = Math.ceil(px * 1.35 * this.dpr);
      c = document.createElement('canvas');
      c.width = s; c.height = s;
      const x = c.getContext('2d');
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = Math.round(px * this.dpr) + 'px ' + EMOJI_FONT;
      x.fillText(ch, s / 2, s / 2 + px * this.dpr * 0.06);
      this.emojiCache.set(key, c);
      return c;
    }
    drawEmoji(ch, x, y, px, alpha) {
      const c = this.emoji(ch, px);
      const s = c.width / this.dpr;
      const ctx = this.ctx;
      if (alpha != null && alpha < 1) { const a = ctx.globalAlpha; ctx.globalAlpha = a * alpha; ctx.drawImage(c, x - s / 2, y - s / 2, s, s); ctx.globalAlpha = a; }
      else ctx.drawImage(c, x - s / 2, y - s / 2, s, s);
    }

    // ---------- statik arka plan ----------
    _buildBg() {
      const c = document.createElement('canvas');
      c.width = this.cv.width; c.height = this.cv.height;
      const x = c.getContext('2d');
      x.scale(this.dpr, this.dpr);
      const ts = this.ts, ox = this.ox, oy = this.oy;
      // dış çerçeve
      const g0 = x.createLinearGradient(0, 0, 0, this.ch);
      g0.addColorStop(0, '#2a4a2a'); g0.addColorStop(1, '#1d361d');
      x.fillStyle = g0; x.fillRect(0, 0, this.cw, this.ch);
      // çim karoları
      for (let i = 0; i < W; i++) {
        for (let j = 0; j < H; j++) {
          x.fillStyle = (i + j) % 2 ? '#78c257' : '#6fb94f';
          x.fillRect(ox + i * ts, oy + j * ts, ts + 0.5, ts + 0.5);
        }
      }
      // patikalar
      x.fillStyle = 'rgba(214,190,130,0.45)';
      const path = (x0, y0, w, h) => { x.beginPath(); roundRect(x, ox + x0 * ts, oy + y0 * ts, w * ts, h * ts, ts * 0.45); x.fill(); };
      path(2.9, 4, 1.2, 24); path(13.9, 4, 1.2, 24);
      path(4, 2.4, 10, 1.2); path(4, 28.4, 10, 1.2);
      // nehir
      const ry = oy + RIVER_TOP * ts, rh = (RIVER_BOT - RIVER_TOP) * ts;
      const gr = x.createLinearGradient(0, ry, 0, ry + rh);
      gr.addColorStop(0, '#3fa9e8'); gr.addColorStop(0.5, '#2d8fd6'); gr.addColorStop(1, '#3fa9e8');
      x.fillStyle = gr; x.fillRect(ox, ry, W * ts, rh);
      x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(ox, ry, W * ts, ts * 0.12); x.fillRect(ox, ry + rh - ts * 0.12, W * ts, ts * 0.12);
      x.strokeStyle = 'rgba(255,255,255,0.35)'; x.lineWidth = Math.max(1, ts * 0.07);
      for (let i = 0; i < 9; i++) {
        const wx = ox + (i * 2 + 0.6) * ts, wy = ry + (i % 2 ? 0.7 : 1.3) * ts;
        x.beginPath(); x.moveTo(wx, wy); x.quadraticCurveTo(wx + ts * 0.4, wy - ts * 0.25, wx + ts * 0.8, wy); x.stroke();
      }
      // köprüler
      for (const bx of BRIDGES) {
        const x0 = ox + (bx - 1.1) * ts, y0 = oy + (RIVER_TOP - 0.45) * ts, w = 2.2 * ts, h = (RIVER_BOT - RIVER_TOP + 0.9) * ts;
        x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(x0 + ts * 0.12, y0 + ts * 0.12, w, h);
        x.fillStyle = '#a8743f'; x.fillRect(x0, y0, w, h);
        x.strokeStyle = '#7a4f26'; x.lineWidth = Math.max(1, ts * 0.06);
        for (let k = 1; k < 7; k++) { const py = y0 + h * k / 7; x.beginPath(); x.moveTo(x0, py); x.lineTo(x0 + w, py); x.stroke(); }
        x.fillStyle = '#6b4321'; x.fillRect(x0 - ts * 0.12, y0, ts * 0.22, h); x.fillRect(x0 + w - ts * 0.1, y0, ts * 0.22, h);
      }
      // kenar çizgisi
      x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 2;
      x.strokeRect(ox, oy, W * ts, H * ts);
      // yarı çizgisi (hafif)
      x.fillStyle = 'rgba(255,255,255,0.05)';
      x.fillRect(ox, oy + RIVER_BOT * ts, W * ts, (H - RIVER_BOT) * ts); // kendi yarımız hep altta
      this.bg = c;
    }

    // ---------- efektler ----------
    addFx(list) {
      for (const f of list) {
        switch (f.t) {
          case 'hit': this._sparks(f.x, f.y, f.b ? 8 : 4, f.b ? '#fff3a0' : '#ffffff', f.b ? 0.35 : 0.22); break;
          case 'boom':
            this.rings.push({ x: f.x, y: f.y, r: f.r, life: 0.35, max: 0.35, color: f.k === 'fire' ? '255,140,40' : '255,200,120', fill: true });
            this._sparks(f.x, f.y, 6, f.k === 'fire' ? '#ff9b3d' : '#ffd27a', 0.35);
            break;
          case 'spell': this._spellFx(f); break;
          case 'area': this.rings.push({ x: f.x, y: f.y, r: f.r, life: 0.4, max: 0.4, color: '140,230,80', fill: true }); break;
          case 'die': this._puff(f.x, f.y, f.a); break;
          case 'tower':
            this.rings.push({ x: f.x, y: f.y, r: f.king ? 4 : 3, life: 0.7, max: 0.7, color: '255,170,60', fill: true });
            for (let i = 0; i < 26; i++) this.particles.push(this._p(f.x, f.y, (Math.random() - 0.5) * 9, (Math.random() - 0.8) * 9, i % 3 ? '#8e8e99' : '#ffb347', 0.25 + Math.random() * 0.25, 0.9, 14));
            this.shakeT = 0.5;
            break;
          case 'spin': this.rings.push({ x: f.x, y: f.y, r: f.r, life: 0.25, max: 0.25, color: '255,255,255', fill: false }); break;
          case 'beam': this.beams.push({ a: f.a, b: f.b, st: f.st, life: 0.16 }); break;
          case 'play': if (f.s !== this.mySide) this.popups.push({ k: f.k, x: f.x, y: f.y, life: 1.3, max: 1.3 }); break;
        }
      }
    }
    _p(x, y, vx, vy, color, size, life, g) { return { x, y, vx, vy, color, size, life, max: life, g: g || 0 }; }
    _sparks(x, y, n, color, size) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 4;
        this.particles.push(this._p(x, y, Math.cos(a) * s, Math.sin(a) * s, color, size * (0.5 + Math.random() * 0.6), 0.25 + Math.random() * 0.15));
      }
    }
    _puff(x, y, air) {
      for (let i = 0; i < 7; i++) {
        const a = Math.random() * Math.PI * 2, s = 0.6 + Math.random() * 1.4;
        this.particles.push(this._p(x, y - (air ? 0.8 : 0), Math.cos(a) * s, Math.sin(a) * s - 0.8, 'rgba(235,235,235,0.9)', 0.35 + Math.random() * 0.3, 0.5 + Math.random() * 0.3));
      }
    }
    _spellFx(f) {
      const colors = { zap: '170,220,255', arrows: '200,170,110', fireball: '255,130,30', freeze: '160,230,255', rocket: '255,110,40' };
      const col = colors[f.k] || '255,255,255';
      this.rings.push({ x: f.x, y: f.y, r: f.r, life: f.k === 'freeze' ? 0.9 : 0.45, max: f.k === 'freeze' ? 0.9 : 0.45, color: col, fill: true });
      if (f.k === 'zap') {
        for (let i = 0; i < 5; i++) this.beams.push({ zx: f.x + (Math.random() - 0.5) * f.r * 1.4, zy: f.y + (Math.random() - 0.5) * f.r * 1.4, life: 0.18, zap: true });
      } else if (f.k === 'arrows') {
        for (let i = 0; i < 24; i++) { const a = Math.random() * Math.PI * 2, r = Math.random() * f.r; this.particles.push(this._p(f.x + Math.cos(a) * r, f.y + Math.sin(a) * r, 0, 0, '#6b4a22', 0.18, 0.3)); }
      } else if (f.k === 'fireball' || f.k === 'rocket') {
        for (let i = 0; i < 18; i++) { const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 5; this.particles.push(this._p(f.x, f.y, Math.cos(a) * s, Math.sin(a) * s, i % 2 ? '#ffb02e' : '#ff5a1f', 0.3 + Math.random() * 0.3, 0.45)); }
        this.shakeT = Math.max(this.shakeT, f.k === 'rocket' ? 0.35 : 0.18);
      } else if (f.k === 'freeze') {
        for (let i = 0; i < 14; i++) { const a = Math.random() * Math.PI * 2, r = Math.random() * f.r; this.particles.push(this._p(f.x + Math.cos(a) * r, f.y + Math.sin(a) * r, 0, -0.6, '#e6f8ff', 0.2, 0.8)); }
      }
    }
    bubble(side, text) {
      const king = TOWER_SPOTS.find(t => t.side === side && t.lane === 'K');
      this.bubbles.push({ side, text, x: king.x, y: king.y, life: 2.2 });
    }

    // ---------- ana çizim ----------
    draw(view, t) {
      const ctx = this.ctx;
      if (!this.cw || !this.bg) { this.resize(); if (!this.cw) return; }
      const dt = this.lastT ? Math.min(0.05, (t - this.lastT) / 1000) : 0.016;
      this.lastT = t;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.cw, this.ch);
      if (this.shakeT > 0) {
        this.shakeT -= dt;
        const m = this.ts * 0.25 * Math.max(0, this.shakeT);
        ctx.translate((Math.random() - 0.5) * m * 2, (Math.random() - 0.5) * m * 2);
      }
      if (this.bg) ctx.drawImage(this.bg, 0, 0, this.cw, this.ch);
      if (!view) return;
      this.lastView = view;
      const ts = this.ts;
      const time = t / 1000;

      if (this.drag) this._drawZones(view);

      // zehir alanları
      for (const a of view.areas) {
        const [x, y] = this.toScreen(a.x, a.y);
        ctx.fillStyle = 'rgba(120,210,60,0.25)';
        ctx.beginPath(); ctx.arc(x, y, a.r * ts, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(90,170,40,0.7)'; ctx.lineWidth = 2; ctx.setLineDash([ts * 0.3, ts * 0.2]); ctx.stroke(); ctx.setLineDash([]);
        for (let i = 0; i < 4; i++) {
          const bb = (time * 0.7 + i * 0.25 + a.id * 0.13) % 1;
          ctx.fillStyle = 'rgba(190,255,120,' + (0.6 * (1 - bb)) + ')';
          ctx.beginPath(); ctx.arc(x + Math.cos(i * 1.7 + a.id) * a.r * ts * 0.5, y - bb * ts * 0.8 + Math.sin(i * 2.3) * a.r * ts * 0.4, ts * 0.12, 0, Math.PI * 2); ctx.fill();
        }
      }

      // yıkık kuleler
      for (const sp of TOWER_SPOTS) {
        if (!view.ents.some(e => e.kind === 'tower' && e.s === sp.side && e.k === sp.key && Math.abs(e.x - sp.x) < 0.1)) this._rubble(sp);
      }

      const ground = [], air = [];
      for (const e of view.ents) ((e.f & 1) ? air : ground).push(e);
      ground.sort((a, b) => this.toScreen(a.x, a.y)[1] - this.toScreen(b.x, b.y)[1]);
      air.sort((a, b) => this.toScreen(a.x, a.y)[1] - this.toScreen(b.x, b.y)[1]);
      for (const e of air) this._shadow(e);
      for (const e of ground) {
        if (e.kind === 'tower') this._tower(e, time);
        else if (e.kind === 'building') this._building(e, time);
        else this._troop(e, time);
      }
      this._beams(view, dt);
      for (const e of air) this._troop(e, time);
      this._projs(view);
      this._fx(dt);
      this._popups(dt);
      if (this.drag) this._ghost();
    }

    _drawZones(view) {
      const d = this.drag;
      const c = CARDS[d.key];
      if (!c || c.type === 'spell') return;
      const ctx = this.ctx, ts = this.ts, ms = this.mySide;
      const enemyAlive = lane => view.ents.some(e => e.kind === 'tower' && e.s === 1 - ms && e.lane === lane);
      ctx.fillStyle = 'rgba(255,40,40,0.20)';
      const band = (x0, x1, ly0, ly1) => {
        const ya = sy(ms, ly0), yb = sy(ms, ly1);
        const [sx0, sy0] = this.toScreen(x0, ya), [sx1, sy1] = this.toScreen(x1, yb);
        ctx.fillRect(Math.min(sx0, sx1), Math.min(sy0, sy1), Math.abs(sx1 - sx0), Math.abs(sy1 - sy0));
      };
      for (const [lane, x0, x1] of [['L', 0, 9], ['R', 9, 18]]) {
        if (enemyAlive(lane)) band(x0, x1, 0, RIVER_BOT + 0.5);
        else { band(x0, x1, 0, 11); band(x0, x1, RIVER_TOP, RIVER_BOT + 0.5); }
      }
    }

    _shadow(e) {
      const ctx = this.ctx, ts = this.ts;
      const [x, y] = this.toScreen(e.x, e.y);
      const r = visR(e.r) * ts;
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath(); ctx.ellipse(x, y + r * 0.4, r * 0.9, r * 0.42, 0, 0, Math.PI * 2); ctx.fill();
    }

    _hpBar(cx, cy, w, h, frac, side, showNum, hp) {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.beginPath(); roundRect(ctx, cx - w / 2 - 1, cy - h / 2 - 1, w + 2, h + 2, h / 2); ctx.fill();
      ctx.fillStyle = side === this.mySide ? '#4fa3ff' : '#ff5252';
      if (frac > 0) { ctx.beginPath(); roundRect(ctx, cx - w / 2, cy - h / 2, Math.max(h, w * frac), h, h / 2); ctx.fill(); }
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(cx - w / 2 + h / 2, cy - h / 2 + 1, Math.max(0, w * frac - h), Math.max(1, h * 0.3));
      if (showNum) {
        ctx.font = 'bold ' + Math.max(9, Math.round(h * 1.05)) + 'px system-ui,sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.strokeText(String(hp), cx, cy + 0.5);
        ctx.fillStyle = '#fff'; ctx.fillText(String(hp), cx, cy + 0.5);
      }
    }

    _tower(e, time) {
      const ctx = this.ctx, ts = this.ts;
      const [x, y] = this.toScreen(e.x, e.y);
      const tm = this.team(e.s);
      const king = e.k === 'king';
      const half = (king ? 1.85 : 1.4) * ts;
      // gölge
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath(); roundRect(ctx, x - half + ts * 0.18, y - half + ts * 0.25, half * 2, half * 2, ts * 0.4); ctx.fill();
      // taş gövde
      const g = ctx.createLinearGradient(x, y - half, x, y + half);
      g.addColorStop(0, '#b7b7c4'); g.addColorStop(1, '#7d7d8c');
      ctx.fillStyle = g;
      ctx.beginPath(); roundRect(ctx, x - half, y - half, half * 2, half * 2, ts * 0.4); ctx.fill();
      ctx.strokeStyle = '#4b4b58'; ctx.lineWidth = Math.max(1.5, ts * 0.08); ctx.stroke();
      // mazgallar
      ctx.fillStyle = '#9a9aa8';
      const n = king ? 5 : 4;
      for (let i = 0; i < n; i++) {
        const bx = x - half + (i + 0.5) * (half * 2 / n);
        ctx.fillRect(bx - ts * 0.18, y - half - ts * 0.2, ts * 0.36, ts * 0.3);
      }
      // takım rengi platform
      const inner = half * 0.68;
      const g2 = ctx.createLinearGradient(x, y - inner, x, y + inner);
      g2.addColorStop(0, tm.light); g2.addColorStop(1, tm.fill);
      ctx.fillStyle = g2;
      ctx.beginPath(); roundRect(ctx, x - inner, y - inner, inner * 2, inner * 2, ts * 0.3); ctx.fill();
      ctx.strokeStyle = tm.dark; ctx.lineWidth = Math.max(1, ts * 0.06); ctx.stroke();
      // karakter
      const bump = (e.f & 32) ? 1.08 : 1;
      this.drawEmoji(king ? '🤴' : '👸', x, y - ts * 0.05, ts * (king ? 1.6 : 1.3) * bump);
      if (king && !(e.f & 64)) {
        ctx.font = 'bold ' + Math.round(ts * 0.6) + 'px system-ui,sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.textAlign = 'center';
        ctx.fillText('z', x + inner * 0.9, y - inner * 0.6 - Math.sin(time * 2) * ts * 0.1);
        ctx.fillText('Z', x + inner * 1.2, y - inner * 1.0 - Math.sin(time * 2 + 1) * ts * 0.1);
      }
      if (e.f & 4) { ctx.fillStyle = 'rgba(170,225,255,0.45)'; ctx.beginPath(); roundRect(ctx, x - half, y - half, half * 2, half * 2, ts * 0.4); ctx.fill(); }
      if (e.f & 128) { ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); roundRect(ctx, x - half, y - half, half * 2, half * 2, ts * 0.4); ctx.fill(); }
      // can barı
      this._hpBar(x, y - half - ts * 0.55, half * 2.1, Math.max(8, ts * 0.42), e.hp / e.mh, e.s, true, e.hp);
    }

    _rubble(sp) {
      const ctx = this.ctx, ts = this.ts;
      const [x, y] = this.toScreen(sp.x, sp.y);
      const half = (sp.key === 'king' ? 1.7 : 1.3) * ts;
      ctx.fillStyle = 'rgba(60,50,40,0.35)';
      ctx.beginPath(); ctx.ellipse(x, y, half, half * 0.8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8a8a96';
      const rocks = [[-0.5, -0.2, 0.4], [0.4, 0.1, 0.35], [-0.1, 0.45, 0.3], [0.55, -0.45, 0.25], [-0.6, 0.4, 0.22]];
      for (const [rx, ry, rr] of rocks) { ctx.beginPath(); ctx.arc(x + rx * half, y + ry * half, rr * ts, 0, Math.PI * 2); ctx.fill(); }
    }

    _building(e, time) {
      const ctx = this.ctx, ts = this.ts;
      const [x, y] = this.toScreen(e.x, e.y);
      const tm = this.team(e.s);
      const half = e.r * ts * 1.05;
      const c = CARDS[e.k];
      ctx.globalAlpha = (e.f & 2) ? 0.6 : 1;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); roundRect(ctx, x - half + ts * 0.12, y - half + ts * 0.18, half * 2, half * 2, ts * 0.3); ctx.fill();
      const g = ctx.createLinearGradient(x, y - half, x, y + half);
      g.addColorStop(0, '#d9c49a'); g.addColorStop(1, '#a88f61');
      ctx.fillStyle = g;
      ctx.beginPath(); roundRect(ctx, x - half, y - half, half * 2, half * 2, ts * 0.3); ctx.fill();
      ctx.strokeStyle = tm.fill; ctx.lineWidth = Math.max(2, ts * 0.14); ctx.stroke();
      const bump = (e.f & 32) ? 1.1 : 1;
      this.drawEmoji(c.emoji, x, y, half * 1.5 * bump);
      if (e.f & 4) { ctx.fillStyle = 'rgba(170,225,255,0.5)'; ctx.beginPath(); roundRect(ctx, x - half, y - half, half * 2, half * 2, ts * 0.3); ctx.fill(); }
      if (e.f & 128) { ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.beginPath(); roundRect(ctx, x - half, y - half, half * 2, half * 2, ts * 0.3); ctx.fill(); }
      ctx.globalAlpha = 1;
      this._hpBar(x, y - half - ts * 0.3, Math.max(half * 2, ts * 1.4), Math.max(4, ts * 0.2), e.hp / e.mh, e.s, false);
      if (e.f & 2) this._deployRing(x, y, half * 1.3, time);
    }

    _deployRing(x, y, r, time) {
      const ctx = this.ctx;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r, time * 6, time * 6 + Math.PI * 1.2); ctx.stroke();
    }

    _troop(e, time) {
      const ctx = this.ctx, ts = this.ts;
      const [sx, sy0] = this.toScreen(e.x, e.y);
      const tm = this.team(e.s);
      const c = CARDS[e.k];
      const isAir = !!(e.f & 1);
      const r = visR(e.r) * ts;
      const lift = isAir ? ts * 0.85 + Math.sin(time * 3 + e.id) * ts * 0.08 : 0;
      const bob = (e.f & 2) ? 0 : Math.abs(Math.sin(time * 9 + e.id * 1.3)) * r * 0.12;
      const x = sx, y = sy0 - lift - bob;
      if (!isAir) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.ellipse(sx, sy0 + r * 0.45, r * 0.95, r * 0.42, 0, 0, Math.PI * 2); ctx.fill();
      }
      const alpha = (e.f & 2) ? 0.55 : 1;
      ctx.globalAlpha = alpha;
      const scale = (e.f & 32) ? 1.12 : 1;
      // hücum izi
      if (e.f & 16) {
        ctx.strokeStyle = 'rgba(255,200,80,0.8)'; ctx.lineWidth = Math.max(1.5, ts * 0.07);
        const dir = this.flip ? -(e.d || -1) : (e.d || -1);
        for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(x + i * r * 0.5, y - dir * r * 1.1); ctx.lineTo(x + i * r * 0.5, y - dir * r * 2.0); ctx.stroke(); }
      }
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r * 1.05);
      g.addColorStop(0, tm.light); g.addColorStop(1, tm.fill);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r * scale, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = tm.dark; ctx.lineWidth = Math.max(1.2, r * 0.14); ctx.stroke();
      this.drawEmoji(c.unitEmoji || c.emoji, x, y, r * 1.45 * scale);
      if (e.f & 128) { ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
      if (e.f & 4) {
        ctx.fillStyle = 'rgba(170,225,255,0.6)'; ctx.beginPath(); ctx.arc(x, y, r * 1.05, 0, Math.PI * 2); ctx.fill();
        this.drawEmoji('❄️', x + r * 0.6, y - r * 0.7, r * 0.8);
      }
      if (e.f & 8) {
        ctx.fillStyle = '#ffe14d';
        for (let i = 0; i < 3; i++) { const a = time * 6 + i * 2.1; ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * 0.8, y - r * 1.05 + Math.sin(a) * r * 0.25, Math.max(1.5, r * 0.15), 0, Math.PI * 2); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
      if (e.f & 2) this._deployRing(x, y, r * 1.35, time);
      else if (e.hp < e.mh) this._hpBar(x, y - r - Math.max(4, ts * 0.22), Math.max(r * 2.2, ts * 0.9), Math.max(3, ts * 0.15), e.hp / e.mh, e.s, false);
    }

    _beams(view, dt) {
      const ctx = this.ctx, ts = this.ts;
      for (let i = this.beams.length - 1; i >= 0; i--) {
        const b = this.beams[i];
        b.life -= dt;
        if (b.life <= 0) { this.beams.splice(i, 1); continue; }
        if (b.zap) {
          const [x, y] = this.toScreen(b.zx, b.zy);
          ctx.strokeStyle = 'rgba(200,235,255,' + Math.min(1, b.life * 6) + ')'; ctx.lineWidth = Math.max(2, ts * 0.12);
          ctx.beginPath(); ctx.moveTo(x, y - ts * 3);
          for (let k = 1; k <= 4; k++) ctx.lineTo(x + (Math.random() - 0.5) * ts * 0.8, y - ts * 3 + k * ts * 0.75);
          ctx.stroke();
          continue;
        }
        const a = view.ents.find(e => e.id === b.a), t = view.ents.find(e => e.id === b.b);
        if (!a || !t) continue;
        const [ax, ay] = this.toScreen(a.x, a.y), [bx, by] = this.toScreen(t.x, t.y - ((t.f & 1) ? 0.85 : 0));
        const w = [0.08, 0.16, 0.28][b.st || 0] * ts;
        ctx.strokeStyle = ['rgba(255,190,90,0.9)', 'rgba(255,120,40,0.95)', 'rgba(255,60,20,1)'][b.st || 0];
        ctx.lineWidth = Math.max(1.5, w);
        ctx.beginPath(); ctx.moveTo(ax, ay - ts * 0.4); ctx.lineTo(bx, by); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,200,0.9)'; ctx.lineWidth = Math.max(1, w * 0.35);
        ctx.beginPath(); ctx.moveTo(ax, ay - ts * 0.4); ctx.lineTo(bx, by); ctx.stroke();
      }
    }

    _projs(view) {
      const ctx = this.ctx, ts = this.ts;
      const seen = new Map();
      for (const p of view.projs) {
        const [x, y] = this.toScreen(p.x, p.y);
        const prev = this.prevProj.get(p.id);
        let ang = 0;
        if (prev && (Math.abs(prev[0] - x) + Math.abs(prev[1] - y)) > 0.1) ang = Math.atan2(y - prev[1], x - prev[0]);
        else if (prev) ang = prev[2];
        seen.set(p.id, [x, y, ang]);
        if (p.sp) {
          const c = CARDS[p.k];
          if (p.k === 'arrows') {
            ctx.strokeStyle = '#5a3d1c'; ctx.lineWidth = Math.max(1.5, ts * 0.07);
            for (let i = 0; i < 7; i++) {
              const ox = Math.cos(i * 2.4) * ts * 0.7, oy = Math.sin(i * 2.4) * ts * 0.5;
              ctx.beginPath(); ctx.moveTo(x + ox - Math.cos(ang) * ts * 0.4, y + oy - Math.sin(ang) * ts * 0.4); ctx.lineTo(x + ox + Math.cos(ang) * ts * 0.3, y + oy + Math.sin(ang) * ts * 0.3); ctx.stroke();
            }
          } else {
            ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.ellipse(x, y + ts * 0.9, ts * 0.45, ts * 0.2, 0, 0, Math.PI * 2); ctx.fill();
            if (p.k === 'fireball') { ctx.fillStyle = 'rgba(255,150,40,0.35)'; ctx.beginPath(); ctx.arc(x, y, ts * 0.85, 0, Math.PI * 2); ctx.fill(); }
            this.drawEmoji(c ? c.emoji : '✨', x, y, ts * 1.2);
          }
          continue;
        }
        switch (p.k) {
          case 'arrow': case 'spear': {
            const len = ts * (p.k === 'spear' ? 0.7 : 0.55);
            ctx.strokeStyle = p.k === 'spear' ? '#3c2a14' : '#6b4a22'; ctx.lineWidth = Math.max(1.5, ts * (p.k === 'spear' ? 0.09 : 0.06));
            ctx.beginPath(); ctx.moveTo(x - Math.cos(ang) * len, y - Math.sin(ang) * len); ctx.lineTo(x, y); ctx.stroke();
            ctx.fillStyle = '#e5e5e5'; ctx.beginPath(); ctx.arc(x, y, Math.max(1.2, ts * 0.06), 0, Math.PI * 2); ctx.fill();
            break;
          }
          case 'fire':
            ctx.fillStyle = 'rgba(255,120,30,0.45)'; ctx.beginPath(); ctx.arc(x, y, ts * 0.32, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#ffd25a'; ctx.beginPath(); ctx.arc(x, y, ts * 0.16, 0, Math.PI * 2); ctx.fill();
            break;
          case 'bomb':
            ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(x, y, ts * 0.2, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#ffb02e'; ctx.beginPath(); ctx.arc(x + ts * 0.12, y - ts * 0.15, ts * 0.07, 0, Math.PI * 2); ctx.fill();
            break;
          case 'ball':
            ctx.fillStyle = '#3a3a44'; ctx.beginPath(); ctx.arc(x, y, ts * 0.2, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(x - ts * 0.06, y - ts * 0.06, ts * 0.07, 0, Math.PI * 2); ctx.fill();
            break;
          default: {
            const tm = this.team(p.s);
            ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.beginPath(); ctx.arc(x, y, ts * 0.22, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = tm.light; ctx.beginPath(); ctx.arc(x, y, ts * 0.13, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
      this.prevProj = seen;
    }

    _fx(dt) {
      const ctx = this.ctx, ts = this.ts;
      for (let i = this.rings.length - 1; i >= 0; i--) {
        const r = this.rings[i];
        r.life -= dt;
        if (r.life <= 0) { this.rings.splice(i, 1); continue; }
        const k = 1 - r.life / r.max;
        const [x, y] = this.toScreen(r.x, r.y);
        const rad = r.r * ts * (0.35 + 0.65 * Math.min(1, k * 1.6));
        if (r.fill) { ctx.fillStyle = 'rgba(' + r.color + ',' + (0.4 * (1 - k)) + ')'; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill(); }
        ctx.strokeStyle = 'rgba(' + r.color + ',' + (0.9 * (1 - k)) + ')'; ctx.lineWidth = Math.max(2, ts * 0.12);
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.stroke();
      }
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life -= dt;
        if (p.life <= 0) { this.particles.splice(i, 1); continue; }
        // parçacıklar dünya koordinatında; vy<0 ekranda yukarı demek
        p.x += p.vx * dt; p.y += p.vy * dt * (this.flip ? -1 : 1);
        p.vy += p.g * dt;
        const [x, y] = this.toScreen(p.x, p.y);
        ctx.globalAlpha = Math.max(0, p.life / p.max);
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(x, y, Math.max(1, p.size * ts * 0.5), 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    _popups(dt) {
      const ctx = this.ctx, ts = this.ts;
      for (let i = this.popups.length - 1; i >= 0; i--) {
        const p = this.popups[i];
        p.life -= dt;
        if (p.life <= 0) { this.popups.splice(i, 1); continue; }
        const c = CARDS[p.k];
        const [x, y0] = this.toScreen(p.x, p.y);
        const k = 1 - p.life / p.max;
        const y = y0 - ts * 1.6 - k * ts * 0.5;
        ctx.globalAlpha = Math.min(1, p.life * 3);
        ctx.fillStyle = 'rgba(120,20,20,0.85)';
        ctx.beginPath(); roundRect(ctx, x - ts * 0.75, y - ts * 0.9, ts * 1.5, ts * 1.8, ts * 0.25); ctx.fill();
        ctx.strokeStyle = '#ffd6d6'; ctx.lineWidth = 1.5; ctx.stroke();
        this.drawEmoji(c.emoji, x, y - ts * 0.2, ts * 0.95);
        ctx.font = 'bold ' + Math.round(ts * 0.42) + 'px system-ui,sans-serif';
        ctx.fillStyle = '#e9b8ff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(c.cost), x, y + ts * 0.58);
        ctx.globalAlpha = 1;
      }
      for (let i = this.bubbles.length - 1; i >= 0; i--) {
        const b = this.bubbles[i];
        b.life -= dt;
        if (b.life <= 0) { this.bubbles.splice(i, 1); continue; }
        const [x, y0] = this.toScreen(b.x, b.y);
        const mine = b.side === this.mySide;
        const y = y0 + (mine ? -ts * 3.6 : ts * 3.2);
        const bx = x + ts * 3.2;
        ctx.globalAlpha = Math.min(1, b.life * 3);
        ctx.fillStyle = '#fff';
        ctx.beginPath(); roundRect(ctx, bx - ts * 1.2, y - ts * 1.0, ts * 2.4, ts * 2.0, ts * 0.6); ctx.fill();
        ctx.beginPath(); ctx.moveTo(bx - ts * 0.9, y + (mine ? ts * 0.8 : -ts * 0.8)); ctx.lineTo(bx - ts * 1.6, y + (mine ? ts * 1.5 : -ts * 1.5)); ctx.lineTo(bx - ts * 0.3, y + (mine ? ts * 0.9 : -ts * 0.9)); ctx.fill();
        this.drawEmoji(b.text, bx, y, ts * 1.4);
        ctx.globalAlpha = 1;
      }
    }

    _ghost() {
      const d = this.drag;
      if (!d || d.x == null) return;
      const ctx = this.ctx, ts = this.ts;
      const c = CARDS[d.key];
      const [x, y] = this.toScreen(d.x, d.y);
      const bad = !d.valid;
      if (c.type === 'spell') {
        ctx.fillStyle = bad ? 'rgba(255,60,60,0.18)' : 'rgba(255,255,255,0.18)';
        ctx.beginPath(); ctx.arc(x, y, c.radius * ts, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = bad ? 'rgba(255,80,80,0.9)' : 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
        ctx.stroke();
        this.drawEmoji(c.emoji, x, y, ts * 1.3, 0.85);
        return;
      }
      if (c.type === 'building') {
        if (c.range) {
          ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.setLineDash([ts * 0.3, ts * 0.25]); ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(x, y, (c.range + c.r) * ts, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        }
        ctx.fillStyle = bad ? 'rgba(255,60,60,0.45)' : 'rgba(255,255,255,0.4)';
        ctx.beginPath(); roundRect(ctx, x - c.r * ts, y - c.r * ts, c.r * 2 * ts, c.r * 2 * ts, ts * 0.25); ctx.fill();
        this.drawEmoji(c.emoji, x, y, ts * 1.2, 0.85);
        return;
      }
      const f = TA.formation(c.count || 1);
      for (const [ox, oy] of f) {
        const px = x + ox * ts, py = y + oy * ts; // ekranda dizilim her iki taraf için aynı
        ctx.fillStyle = bad ? 'rgba(255,60,60,0.5)' : 'rgba(255,255,255,0.45)';
        ctx.beginPath(); ctx.arc(px, py, visR(c.r) * ts, 0, Math.PI * 2); ctx.fill();
        this.drawEmoji(c.unitEmoji || c.emoji, px, py, visR(c.r) * ts * 1.45, 0.8);
      }
      if (c.range >= 2) {
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.setLineDash([ts * 0.3, ts * 0.25]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, (c.range + (c.r || 0.45)) * ts, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
    }
  }

  // Görsel yarıçap: çarpışma yarıçapından biraz büyük, küçük birlikler de net görünsün
  function visR(r) { return Math.max(0.42, r || 0.45) * 1.3; }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  TA.Renderer = Renderer;
})(window);
