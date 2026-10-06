/* Taç Arena — oyun oturumları
 * Arayüz her modda aynı Session arabirimini kullanır:
 *   mySide, update(nowMs), getView(nowMs), getHUD(nowMs), drainFx(nowMs),
 *   canDeploy(key,x,y), play(handIdx,x,y), emote(code), quit()
 *   olaylar: onEnd(result), onEmote(side, code), onStatus(text)
 */
(function (root) {
  'use strict';
  const TA = (typeof module !== 'undefined' && module.exports)
    ? Object.assign({}, require('./ai.js'))
    : root.TA;
  const { Game, Bot, CARDS, TOWERS, KEY_INDEX, ALL_KEYS, DECK_KEYS, DEFAULT_DECK, canDeployOn, ELIXIR_RATE } = TA;

  const STEP = 1 / 30;
  const SNAP_MS = 100;
  const INTERP_DELAY = 0.13;
  const TIMEOUT_MS = 8000;

  function now() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); }
  function r2(v) { return Math.round(v * 100) / 100; }

  function sanitizeDeck(d) {
    if (!Array.isArray(d)) return DEFAULT_DECK.slice();
    const u = Array.from(new Set(d.filter(k => DECK_KEYS.includes(k))));
    return u.length === 8 ? u : DEFAULT_DECK.slice();
  }

  function resultFor(side, g) {
    return {
      outcome: g.winner === -1 ? 'draw' : (g.winner === side ? 'win' : 'lose'),
      myCrowns: g.crowns[side], oppCrowns: g.crowns[1 - side]
    };
  }

  // ---------- Ortak: yetkili simülasyonu çalıştıran temel ----------
  class SimSession {
    constructor(opts) {
      this.mySide = 0;
      this.g = new Game({ decks: opts.decks, names: opts.names });
      this.acc = 0;
      this.last = null;
      this.ended = false;
      this.onEnd = null; this.onEmote = null; this.onStatus = null;
    }
    _advance(t) {
      if (this.last == null) { this.last = t; return; }
      let dt = (t - this.last) / 1000;
      this.last = t;
      if (dt > 0.25) dt = 0.25; // sekme arka plandaysa büyük sıçramayı sınırla
      this.acc += dt;
      while (this.acc >= STEP) { this._tick(STEP); this.acc -= STEP; }
      if (this.g.over && !this.ended) { this.ended = true; this._finish(); }
    }
    _tick(dt) { this.g.step(dt); }
    _finish() { if (this.onEnd) this.onEnd(Object.assign(resultFor(this.mySide, this.g), { reason: 'normal' })); }
    getView() { return this.g.view(); }
    getHUD() {
      const s = this.mySide, g = this.g;
      return { elixir: g.elixir[s], hand: g.hands[s].slice(), next: g.queues[s][0], crowns: g.crowns.slice(), left: g.timeLeft, ot: g.overtime, dbl: g.doubleElixir, pending: -1 };
    }
    drainFx() { const f = this.g.fxLocal; this.g.fxLocal = []; return f; }
    canDeploy(key, x, y) { return this.g.canDeploy(this.mySide, key, x, y); }
    play(i, x, y) { const k = this.g.hands[this.mySide][i]; return this.g.play(this.mySide, i, k, x, y); }
  }

  // ---------- Bota karşı ----------
  class BotSession extends SimSession {
    constructor(opts) {
      const botDeck = opts.botDeck || pickBotDeck();
      super({ decks: [opts.deck, botDeck], names: [opts.name, opts.botName || 'Bot'] });
      this.bot = new Bot(this.g, 1, opts.level || 'normal');
      this.mode = 'bot';
      this.oppName = opts.botName || 'Bot';
      this.g.fxNet = { push() {} }; // ağ yok
    }
    update(t) { this._advance(t); }
    _tick(dt) { this.bot.update(dt); this.g.step(dt); }
    emote(code) {
      if (this.onEmote) this.onEmote(0, code);
      if (Math.random() < 0.5 && this.onEmote) setTimeout(() => this.onEmote && this.onEmote(1, ['👍', '😄', '😡', '😭'][Math.floor(Math.random() * 4)]), 900);
    }
    quit() { this.ended = true; }
  }

  function pickBotDeck() {
    const decks = [
      ['giant', 'musketeer', 'minions', 'fireball', 'zap', 'knight', 'archers', 'valkyrie'],
      ['hog', 'cannon', 'skeletons', 'musketeer', 'fireball', 'zap', 'knight', 'speargob'],
      ['balloon', 'babydragon', 'minions', 'arrows', 'knight', 'inferno', 'skarmy', 'freeze'],
      ['golem', 'babydragon', 'wizard', 'minirobot', 'zap', 'poison', 'archers', 'skeletons'],
      ['prince', 'barbarians', 'goblins', 'bomber', 'gobhut', 'arrows', 'rocket', 'minions']
    ];
    return decks[Math.floor(Math.random() * decks.length)];
  }

  // ---------- Online host (yetkili) ----------
  class HostSession extends SimSession {
    constructor(opts) {
      // opts: conn, deck, name, trophies, opp {name, trophies}
      super({ decks: [opts.deck, DEFAULT_DECK], names: [opts.name, opts.opp ? opts.opp.name : 'Rakip'] });
      this.mode = 'host';
      this.conn = opts.conn;
      this.opts = opts;
      this.started = false;
      this.oppName = opts.opp ? opts.opp.name : 'Rakip';
      this.ack = 0; this.ackOk = 1;
      this.lastSnap = 0;
      this.endSent = 0;
      this.onStart = null;
      const c = this.conn;
      c.on('hello', d => {
        if (!this.started) {
          this.started = true;
          const deck = sanitizeDeck(d && d.deck);
          this.g = new Game({ decks: [opts.deck, deck], names: [opts.name, (d && d.name) || this.oppName] });
          this.g.fxLocal = [];
          this.oppName = (d && d.name) || this.oppName;
          this.oppTrophies = (d && d.tr) || 0;
          this.last = null;
          if (this.onStart) this.onStart({ oppName: this.oppName, oppTrophies: this.oppTrophies });
        }
        c.send('start', { name: opts.name, tr: opts.trophies || 0 });
      });
      c.on('play', d => {
        if (!this.started || !d) return;
        const k = this.g.hands[1][d.i];
        const ok = typeof d.x === 'number' && typeof d.y === 'number' && k === d.k && this.g.play(1, d.i, d.k, d.x, d.y);
        this.ack = Math.max(this.ack, d.n | 0);
        this.ackOk = ok ? 1 : 0;
      });
      c.on('emote', d => { if (this.onEmote && d) this.onEmote(1, String(d.c).slice(0, 4)); });
      c.on('bye', () => this._oppLeft());
    }
    update(t) {
      if (!this.started || this.ended) {
        if (this.started && this.ended && this.endSent < 4 && t - this.lastSnap > 150) { this._snap(t); this.endSent++; }
        return;
      }
      this._advance(t);
      if (t - this.lastSnap >= SNAP_MS) this._snap(t);
      if (Date.now() - this.conn.lastRecv > TIMEOUT_MS) this._oppLeft();
    }
    _snap(t) {
      this.lastSnap = t;
      this.conn.send('s', encodeSnap(this.g, this.ack, this.ackOk));
    }
    _oppLeft() {
      if (this.ended) return;
      this.ended = true;
      this.g.over = true; this.g.winner = 0;
      if (this.onEnd) this.onEnd(Object.assign(resultFor(0, this.g), { reason: 'left' }));
    }
    emote(code) { this.conn.send('emote', { c: code }); if (this.onEmote) this.onEmote(0, code); }
    quit() {
      if (!this.ended) { this.ended = true; this.g.over = true; this.g.winner = 1; this._snap(now()); }
      this.conn.send('bye', {});
      setTimeout(() => this.conn.close(), 300);
    }
  }

  // ---------- Snapshot kodlama ----------
  const FX_CODES = ['arrow', 'bolt', 'fire', 'bomb', 'spear', 'ball'];
  function encodeSnap(g, ack, ackOk) {
    const e = [];
    for (const o of g.ents) {
      if (o.hp <= 0) continue;
      let f = 0;
      if (o.air) f |= 1;
      if (o.deployT > 0) f |= 2;
      if (o.frozenT > 0) f |= 4;
      if (o.stunT > 0) f |= 8;
      if (o.charging) f |= 16;
      if (o.atk > 0) f |= 32;
      if (o.kind === 'tower' && o.active) f |= 64;
      if (o.flash > 0) f |= 128;
      e.push(o.id, KEY_INDEX[o.key], o.side, Math.round(o.x * 100), Math.round(o.y * 100), Math.ceil(o.hp), f, o.dir || 0, Math.round(o.maxHp));
    }
    const p = [];
    for (const q of g.projs) p.push(q.id, FX_CODES.indexOf(q.fx), Math.round(q.x * 100), Math.round(q.y * 100), q.side, -1);
    for (const sp of g.spells) p.push(sp.id, KEY_INDEX[sp.key], Math.round(sp.x * 100), Math.round(sp.y * 100), sp.side, 1);
    const a = [];
    for (const ar of g.areas) a.push(ar.id, KEY_INDEX[ar.key], Math.round(ar.x * 100), Math.round(ar.y * 100), Math.round(ar.r * 100), Math.round(ar.t * 10));
    const fx = g.fxNet.map(f => {
      const o = Object.assign({}, f);
      for (const k of ['x', 'y', 'r']) if (typeof o[k] === 'number') o[k] = r2(o[k]);
      return o;
    });
    g.fxNet = [];
    return {
      t: r2(g.time), l: Math.round(g.timeLeft * 10) / 10, ot: g.overtime ? 1 : 0, db: g.doubleElixir ? 1 : 0,
      c: g.crowns.slice(), el: [Math.round(g.elixir[0] * 100) / 100, Math.round(g.elixir[1] * 100) / 100],
      h: g.hands[1].slice(), nx: g.queues[1][0], ak: ack, ok: ackOk,
      ov: g.over ? 1 : 0, w: g.winner, e, p, a, fx
    };
  }

  function decodeEnts(arr) {
    const out = new Map();
    for (let i = 0; i < arr.length; i += 9) {
      const key = ALL_KEYS[arr[i + 1]];
      const isTower = key === 'king' || key === 'princess';
      const c = isTower ? TOWERS[key] : CARDS[key];
      const x = arr[i + 3] / 100, y = arr[i + 4] / 100, side = arr[i + 2];
      out.set(arr[i], {
        id: arr[i], k: key, s: side, side, x, y, hp: arr[i + 5], mh: arr[i + 8], f: arr[i + 6], d: arr[i + 7],
        r: c ? (c.r || 0.45) : 0.45,
        kind: isTower ? 'tower' : (c && c.type === 'building' ? 'building' : 'troop'),
        lane: isTower ? (key === 'king' ? 'K' : (x < 9 ? 'L' : 'R')) : undefined
      });
    }
    return out;
  }
  function decodeProjs(arr) {
    const out = new Map();
    for (let i = 0; i < arr.length; i += 6) {
      const sp = arr[i + 5] === 1;
      out.set(arr[i], { id: arr[i], k: sp ? ALL_KEYS[arr[i + 1]] : FX_CODES[arr[i + 1]], x: arr[i + 2] / 100, y: arr[i + 3] / 100, s: arr[i + 4], sp: sp ? 1 : 0 });
    }
    return out;
  }
  function decodeAreas(arr) {
    const out = [];
    for (let i = 0; i < arr.length; i += 6) out.push({ id: arr[i], k: ALL_KEYS[arr[i + 1]], x: arr[i + 2] / 100, y: arr[i + 3] / 100, r: arr[i + 4] / 100, t: arr[i + 5] / 10 });
    return out;
  }

  // ---------- Online guest (görüntüleyici + komut gönderici) ----------
  class GuestSession {
    constructor(opts) {
      // opts: conn, deck, name, trophies, opp
      this.mode = 'guest';
      this.mySide = 1;
      this.conn = opts.conn;
      this.opts = opts;
      this.started = false;
      this.ended = false;
      this.oppName = opts.opp ? opts.opp.name : 'Rakip';
      this.buf = [];
      this.offs = [];
      this.fxQueue = [];
      this.seq = 0;
      this.pend = null; // {n, i, cost, at}
      this.lastHello = 0;
      this.lastPing = 0;
      this.onEnd = null; this.onEmote = null; this.onStatus = null; this.onStart = null; this.onReject = null;
      const c = this.conn;
      c.on('start', d => {
        this.gotStart = true;
        this.oppName = (d && d.name) || this.oppName;
        this.oppTrophies = (d && d.tr) || 0;
        if (this.started) { if (this.onInfo) this.onInfo({ oppName: this.oppName, oppTrophies: this.oppTrophies }); return; }
        this.started = true;
        if (this.onStart) this.onStart({ oppName: this.oppName, oppTrophies: this.oppTrophies });
      });
      c.on('s', d => this._onSnap(d));
      c.on('emote', d => { if (this.onEmote && d) this.onEmote(0, String(d.c).slice(0, 4)); });
      c.on('bye', () => this._oppLeft());
    }
    _hello() { this.conn.send('hello', { name: this.opts.name, tr: this.opts.trophies || 0, deck: this.opts.deck }); }
    _onSnap(d) {
      if (!d || this.ended) return;
      // 'start' mesajı gecikirse birkaç durum paketinden sonra yine de başla
      this.snapCount = (this.snapCount || 0) + 1;
      if (!this.started && this.snapCount >= 8) { this.started = true; if (this.onStart) this.onStart({ oppName: this.oppName, oppTrophies: this.oppTrophies || 0 }); }
      const at = now() / 1000;
      const snap = { ht: d.t, at, raw: d, ents: decodeEnts(d.e), projs: decodeProjs(d.p), areas: decodeAreas(d.a) };
      const last = this.buf[this.buf.length - 1];
      if (last && snap.ht < last.ht) return; // sırasız paket
      this.buf.push(snap);
      if (this.buf.length > 30) this.buf.shift();
      this.offs.push(at - d.t);
      if (this.offs.length > 30) this.offs.shift();
      if (d.fx && d.fx.length) for (const f of d.fx) this.fxQueue.push({ ht: d.t, f });
      if (this.pend && d.ak >= this.pend.n) {
        if (!d.ok && this.onReject) this.onReject();
        this.pend = null;
      }
      if (d.ov && !this.ended) {
        this.ended = true;
        const g = { winner: d.w, crowns: d.c };
        setTimeout(() => { if (this.onEnd) this.onEnd(Object.assign(resultFor(1, g), { reason: 'normal' })); }, 350);
      }
    }
    _oppLeft() {
      if (this.ended) return;
      this.ended = true;
      const last = this.buf[this.buf.length - 1];
      const crowns = last ? last.raw.c : [0, 0];
      if (this.onEnd) this.onEnd({ outcome: 'win', myCrowns: crowns[1], oppCrowns: crowns[0], reason: 'left' });
    }
    _renderTime(t) {
      if (!this.offs.length) return 0;
      let off = Infinity;
      for (const o of this.offs) if (o < off) off = o;
      return t / 1000 - off - INTERP_DELAY;
    }
    update(t) {
      if (this.ended) return;
      if (!this.started) {
        if (t - this.lastHello > 600) { this.lastHello = t; this._hello(); }
        return;
      }
      if (t - this.lastPing > 1000) { this.lastPing = t; this.conn.send('ping', {}); }
      if (Date.now() - this.conn.lastRecv > TIMEOUT_MS) this._oppLeft();
      if (this.pend && t / 1000 - this.pend.at > 2.5) this.pend = null;
    }
    getView(t) {
      const b = this.buf;
      if (!b.length) return null;
      const rt = this._renderTime(t);
      let s0 = b[0], s1 = b[0];
      if (rt >= b[b.length - 1].ht) { s0 = s1 = b[b.length - 1]; }
      else {
        for (let i = 0; i < b.length - 1; i++) {
          if (b[i].ht <= rt && b[i + 1].ht > rt) { s0 = b[i]; s1 = b[i + 1]; break; }
        }
      }
      const span = s1.ht - s0.ht;
      const k = span > 0 ? Math.max(0, Math.min(1, (rt - s0.ht) / span)) : 1;
      const ents = [];
      for (const e1 of s1.ents.values()) {
        const e0 = s0.ents.get(e1.id);
        if (e0) ents.push(Object.assign({}, e1, { x: e0.x + (e1.x - e0.x) * k, y: e0.y + (e1.y - e0.y) * k }));
        else ents.push(e1);
      }
      const projs = [];
      for (const p1 of s1.projs.values()) {
        const p0 = s0.projs.get(p1.id);
        if (p0) projs.push(Object.assign({}, p1, { x: p0.x + (p1.x - p0.x) * k, y: p0.y + (p1.y - p0.y) * k }));
        else if (k > 0.5) projs.push(p1);
      }
      const d = s1.raw;
      return { time: d.t, left: d.l, ot: !!d.ot, dbl: !!d.db, crowns: d.c, elixir: d.el, ents, projs, areas: s1.areas, over: !!d.ov, winner: d.w };
    }
    getHUD(t) {
      const last = this.buf[this.buf.length - 1];
      if (!last) return { elixir: 5, hand: this.opts.deck.slice(0, 4), next: this.opts.deck[4], crowns: [0, 0], left: 180, ot: false, dbl: false, pending: -1 };
      const d = last.raw;
      const rate = ELIXIR_RATE * (d.db ? 2 : 1);
      let el = Math.min(10, d.el[1] + Math.max(0, t / 1000 - last.at) * rate);
      if (this.pend) el = Math.max(0, el - this.pend.cost);
      return { elixir: el, hand: d.h.slice(), next: d.nx, crowns: d.c.slice(), left: Math.max(0, d.l - Math.max(0, t / 1000 - last.at)), ot: !!d.ot, dbl: !!d.db, pending: this.pend ? this.pend.i : -1 };
    }
    drainFx(t) {
      const rt = this._renderTime(t);
      const out = [];
      while (this.fxQueue.length && this.fxQueue[0].ht <= rt + 0.02) out.push(this.fxQueue.shift().f);
      return out;
    }
    _viewEnts() {
      const last = this.buf[this.buf.length - 1];
      return last ? Array.from(last.ents.values()) : [];
    }
    canDeploy(key, x, y) { return canDeployOn(this._viewEnts(), 1, key, x, y); }
    play(i, x, y) {
      if (this.ended || this.pend) return false;
      const hud = this.getHUD(now());
      const k = hud.hand[i];
      if (!k || CARDS[k].cost > hud.elixir + 0.05) return false;
      if (!this.canDeploy(k, x, y)) return false;
      this.seq++;
      this.pend = { n: this.seq, i, cost: CARDS[k].cost, at: now() / 1000 };
      this.conn.send('play', { i, k, x: r2(x), y: r2(y), n: this.seq });
      return true;
    }
    emote(code) { this.conn.send('emote', { c: code }); if (this.onEmote) this.onEmote(1, code); }
    quit() {
      this.ended = true;
      this.conn.send('bye', {});
      setTimeout(() => this.conn.close(), 300);
    }
  }

  const api = { BotSession, HostSession, GuestSession, encodeSnap, sanitizeDeck, pickBotDeck };
  if (typeof module !== 'undefined' && module.exports) module.exports = Object.assign({}, TA, api);
  else root.TA = Object.assign(root.TA || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
