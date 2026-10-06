/* Taç Arena — oyun oturumları
 * Arayüz her modda aynı Session arabirimini kullanır:
 *   mySide, update(nowMs), getView(nowMs), getHUD(nowMs), drainFx(nowMs),
 *   canDeploy(key,x,y), play(handIdx,x,y), emote(code), quit()
 *   olaylar: onStart, onInfo, onEnd(result), onEmote(side, code), onReject
 */
(function (root) {
  'use strict';
  const TA = (typeof module !== 'undefined' && module.exports)
    ? Object.assign({}, require('./ai.js'))
    : root.TA;
  const { Game, Bot, CARDS, TOWERS, KEY_INDEX, ALL_KEYS, DECK_KEYS, DEFAULT_DECK, canDeployOn, ELIXIR_RATE } = TA;

  const STEP = 1 / 30;
  const SNAP_MS = 83;          // ~12 durum paketi / sn
  const TIMEOUT_MS = 10000;    // bu kadar süre mesaj gelmezse rakip ayrılmış sayılır
  const LAG_MS = 1200;         // bu süreden sonra "bağlantı zayıf" uyarısı
  const PING_MS = 1500;
  const POS_Q = 20;            // konum hassasiyeti: 1/20 karo

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
      this.ping = 0;
      this.onEnd = null; this.onEmote = null; this.onStart = null;
    }
    _advance(t) {
      if (this.last == null) { this.last = t; return; }
      let dt = (t - this.last) / 1000;
      this.last = t;
      if (dt <= 0) return;
      if (dt > 0.25) dt = 0.25; // uygulama arka plandaysa büyük sıçramayı sınırla
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP && n < 8) { this._tick(STEP); this.acc -= STEP; n++; }
      if (n >= 8) this.acc = 0;
      if (this.g.over && !this.ended) { this.ended = true; this._finish(); }
    }
    _tick(dt) { this.g.step(dt); }
    _finish() { if (this.onEnd) this.onEnd(Object.assign(resultFor(this.mySide, this.g), { reason: 'normal' })); }
    getView() { const v = this.g.view(); v.ghosts = []; return v; }
    getHUD() {
      const s = this.mySide, g = this.g;
      return { elixir: g.elixir[s], hand: g.hands[s].slice(), next: g.queues[s][0], crowns: g.crowns.slice(), left: g.timeLeft, ot: g.overtime, dbl: g.doubleElixir, cd: g.cd, pending: [], ping: this.ping, lag: false };
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
      this.started = true;
      this.oppName = opts.botName || 'Bot';
      this.g.fxNet = { push() {} }; // ağ yok
    }
    update(t) { this._advance(t); }
    _tick(dt) { this.bot.update(dt); this.g.step(dt); }
    emote(code) {
      if (this.onEmote) this.onEmote(0, code);
      if (Math.random() < 0.5) setTimeout(() => { if (this.onEmote && !this.ended) this.onEmote(1, ['👍', '😄', '😡', '😭'][Math.floor(Math.random() * 4)]); }, 900);
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

  // Ping-pong: her iki taraf da gidiş-dönüş süresini ölçer
  function setupPing(sess, conn) {
    sess.ping = 0;
    sess._lastPing = 0;
    conn.on('pi', d => conn.send('po', d));
    conn.on('po', d => {
      if (!d || typeof d.t !== 'number') return;
      const rtt = now() - d.t;
      if (rtt >= 0 && rtt < 10000) sess.ping = sess.ping ? Math.round(sess.ping * 0.7 + rtt * 0.3) : Math.round(rtt);
    });
  }
  function maybePing(sess, conn, t) {
    if (t - sess._lastPing > PING_MS) { sess._lastPing = t; conn.send('pi', { t: r2(now()) }); }
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
      const c = this.conn;
      setupPing(this, c);
      c.on('hello', d => {
        if (!this.started) {
          this.started = true;
          const deck = sanitizeDeck(d && d.deck);
          this.g = new Game({ decks: [opts.deck, deck], names: [opts.name, (d && d.name) || this.oppName] });
          this.g.fxLocal = [];
          this.oppName = String((d && d.name) || this.oppName).slice(0, 16);
          this.oppTrophies = (d && d.tr) | 0;
          this.last = null;
          if (this.onStart) this.onStart({ oppName: this.oppName, oppTrophies: this.oppTrophies });
        }
        c.send('start', { name: opts.name, tr: opts.trophies || 0 });
      });
      c.on('play', d => {
        if (!this.started || !d || this.ended) return;
        const n = d.n | 0;
        if (n <= this.ack) return; // tekrar gelen komut
        const k = this.g.hands[1][d.i];
        const ok = typeof d.x === 'number' && typeof d.y === 'number' && k === d.k && this.g.play(1, d.i, d.k, d.x, d.y);
        this.ack = n;
        this.ackOk = ok ? 1 : 0;
        this._snap(now()); // onayı hemen gönder: misafir için gecikmeyi azaltır
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
      maybePing(this, this.conn, t);
      if (Date.now() - this.conn.lastRecv > TIMEOUT_MS) this._oppLeft();
    }
    getHUD(t) {
      const h = super.getHUD(t);
      h.lag = this.started && !this.ended && Date.now() - this.conn.lastRecv > LAG_MS;
      return h;
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
  // Bir varlık satırı: id, anahtar, taraf, x, y, can, bayraklar (7 sayı)
  const FX_CODES = ['arrow', 'bolt', 'fire', 'bomb', 'spear', 'ball'];
  const ENT_W = 7, PROJ_W = 9, AREA_W = 6;
  function q(v) { return Math.round(v * POS_Q); }
  function entFlags(o) {
    let f = 0;
    if (o.air) f |= 1;
    if (o.deployT > 0) f |= 2;
    if (o.frozenT > 0) f |= 4;
    if (o.stunT > 0) f |= 8;
    if (o.charging) f |= 16;
    if (o.atk > 0) f |= 32;
    if (o.kind === 'tower' && o.active) f |= 64;
    if (o.flash > 0) f |= 128;
    return f;
  }
  function encodeSnap(g, ack, ackOk) {
    const e = [];
    for (const o of g.ents) {
      if (o.hp <= 0) continue;
      e.push(o.id, KEY_INDEX[o.key], o.side, q(o.x), q(o.y), Math.ceil(o.hp), entFlags(o));
    }
    const p = [];
    for (const pr of g.projs) p.push(pr.id, FX_CODES.indexOf(pr.fx), q(pr.x), q(pr.y), pr.side, Math.round(pr.h0 * 10), Math.round(pr.h1 * 10), q(pr.tx), q(pr.ty));
    for (const sp of g.spells) p.push(sp.id, 100 + KEY_INDEX[sp.key], q(sp.x), q(sp.y), sp.side, 0, 0, q(sp.tx), q(sp.ty));
    const a = [];
    for (const ar of g.areas) a.push(ar.id, KEY_INDEX[ar.key], q(ar.x), q(ar.y), q(ar.r), Math.round(ar.t * 10));
    const fx = g.fxNet.map(f => {
      const o = Object.assign({}, f);
      for (const k of ['x', 'y', 'r']) if (typeof o[k] === 'number') o[k] = r2(o[k]);
      return o;
    });
    g.fxNet = [];
    const out = {
      t: Math.round(g.clock * 1000) / 1000, gt: r2(g.time), cd: r2(g.cd), l: Math.round(g.timeLeft * 10) / 10,
      ot: g.overtime ? 1 : 0, db: g.doubleElixir ? 1 : 0,
      c: g.crowns.slice(), el: Math.round(g.elixir[1] * 100) / 100,
      h: g.hands[1].slice(), nx: g.queues[1][0], ak: ack, ok: ackOk,
      e, p, a
    };
    if (fx.length) out.fx = fx;
    if (g.over) { out.ov = 1; out.w = g.winner; }
    return out;
  }

  function decodeEnts(arr) {
    const out = new Map();
    for (let i = 0; i + ENT_W <= arr.length; i += ENT_W) {
      const key = ALL_KEYS[arr[i + 1]];
      const isTower = key === 'king' || key === 'princess';
      const c = isTower ? TOWERS[key] : CARDS[key];
      if (!c) continue;
      const x = arr[i + 3] / POS_Q, y = arr[i + 4] / POS_Q, side = arr[i + 2];
      out.set(arr[i], {
        id: arr[i], k: key, s: side, side, x, y, hp: arr[i + 5], mh: c.hp, f: arr[i + 6],
        r: c.r || 0.45,
        kind: isTower ? 'tower' : (c.type === 'building' ? 'building' : 'troop'),
        lane: isTower ? (key === 'king' ? 'K' : (x < 9 ? 'L' : 'R')) : undefined
      });
    }
    return out;
  }
  function decodeProjs(arr) {
    const out = new Map();
    for (let i = 0; i + PROJ_W <= arr.length; i += PROJ_W) {
      const code = arr[i + 1];
      const base = { id: arr[i], x: arr[i + 2] / POS_Q, y: arr[i + 3] / POS_Q, s: arr[i + 4] };
      base.tx = arr[i + 7] / POS_Q; base.ty = arr[i + 8] / POS_Q;
      if (code >= 100) out.set(arr[i], Object.assign(base, { k: ALL_KEYS[code - 100], sp: 1 }));
      else out.set(arr[i], Object.assign(base, { k: FX_CODES[code] || 'bolt', sp: 0, h0: arr[i + 5] / 10, h1: arr[i + 6] / 10 }));
    }
    return out;
  }
  function decodeAreas(arr) {
    const out = [];
    for (let i = 0; i + AREA_W <= arr.length; i += AREA_W) out.push({ id: arr[i], k: ALL_KEYS[arr[i + 1]], x: arr[i + 2] / POS_Q, y: arr[i + 3] / POS_Q, r: arr[i + 4] / POS_Q, t: arr[i + 5] / 10 });
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
      this.oppTrophies = 0;
      this.buf = [];
      this.offs = [];
      this.delay = 0.12;
      this.fxQueue = [];
      this.seq = 0;
      this.pends = [];    // onay bekleyen kartlar: {n, i, cost, at}
      this.ghosts = [];   // yerel tahmin: oynanan kartın anında görünen hayaleti
      this.lastHello = 0;
      this.onEnd = null; this.onEmote = null; this.onStart = null; this.onReject = null; this.onInfo = null;
      const c = this.conn;
      setupPing(this, c);
      c.on('start', d => {
        this.gotStart = true;
        this.oppName = String((d && d.name) || this.oppName).slice(0, 16);
        this.oppTrophies = (d && d.tr) | 0;
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
      if (!d || this.ended || !Array.isArray(d.e)) return;
      // 'start' mesajı gecikirse birkaç durum paketinden sonra yine de başla
      this.snapCount = (this.snapCount || 0) + 1;
      if (!this.started && this.snapCount >= 8) { this.started = true; if (this.onStart) this.onStart({ oppName: this.oppName, oppTrophies: this.oppTrophies }); }
      const at = now() / 1000;
      const last = this.buf[this.buf.length - 1];
      if (last && d.t <= last.ht) {
        // aynı/eski paket (anında onay paketi gibi): yalnızca onay bilgisini işle
        this._ack(d);
        return;
      }
      const snap = { ht: d.t, at, raw: d, ents: decodeEnts(d.e), projs: decodeProjs(d.p || []), areas: decodeAreas(d.a || []) };
      this.buf.push(snap);
      if (this.buf.length > 40) this.buf.shift();
      // Saat farkı ve titreşim (jitter) tahmini → uyarlanabilir ara değerleme gecikmesi
      this.offs.push(at - d.t);
      if (this.offs.length > 60) this.offs.shift();
      let mn = Infinity, sum = 0;
      for (const o of this.offs) { if (o < mn) mn = o; sum += o; }
      this.offMin = mn;
      const jitter = sum / this.offs.length - mn;
      const want = Math.max(0.09, Math.min(0.35, SNAP_MS / 1000 + jitter * 1.5 + 0.02));
      this.delay += (want - this.delay) * 0.1;
      if (d.fx && d.fx.length) for (const f of d.fx) this.fxQueue.push({ ht: d.t, f });
      this._ack(d);
      if (d.ov && !this.ended) {
        this.ended = true;
        const g = { winner: d.w, crowns: d.c };
        setTimeout(() => { if (this.onEnd) this.onEnd(Object.assign(resultFor(1, g), { reason: 'normal' })); }, 350);
      }
    }
    _ack(d) {
      for (let i = this.pends.length - 1; i >= 0; i--) {
        const p = this.pends[i];
        if (d.ak < p.n) continue;
        const g = this.ghosts.find(x => x.n === p.n);
        if (d.ak === p.n && !d.ok) {
          if (this.onReject) this.onReject();
          if (g) this.ghosts.splice(this.ghosts.indexOf(g), 1);
        } else if (g) {
          // Gerçek birlik ara değerleme gecikmesi kadar sonra görünür; hayalet o ana kadar kalsın
          g.until = now() / 1000 + this.delay + 0.1;
        }
        this.pends.splice(i, 1);
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
      return t / 1000 - this.offMin - this.delay;
    }
    update(t) {
      if (this.ended) return;
      if (!this.started) {
        if (t - this.lastHello > 600) { this.lastHello = t; this._hello(); }
        return;
      }
      maybePing(this, this.conn, t);
      if (Date.now() - this.conn.lastRecv > TIMEOUT_MS) this._oppLeft();
      const ts = t / 1000;
      for (let i = this.pends.length - 1; i >= 0; i--) {
        if (ts - this.pends[i].at <= 3) continue;
        // onay kayboldu: hayaleti kaldır, kartı serbest bırak
        const g = this.ghosts.find(x => x.n === this.pends[i].n);
        if (g) this.ghosts.splice(this.ghosts.indexOf(g), 1);
        this.pends.splice(i, 1);
      }
      for (let i = this.ghosts.length - 1; i >= 0; i--) if (this.ghosts[i].until && ts > this.ghosts[i].until) this.ghosts.splice(i, 1);
    }
    getView(t) {
      const b = this.buf;
      if (!b.length) return null;
      const rt = this._renderTime(t);
      const lastS = b[b.length - 1];
      let s0, s1, k;
      if (rt >= lastS.ht) {
        // Paket gecikti: son iki pakete göre en fazla 0.25 sn ileriye tahmin et
        s1 = lastS; s0 = b.length > 1 ? b[b.length - 2] : lastS;
        const span = s1.ht - s0.ht;
        k = span > 0 ? 1 + Math.min(0.25, rt - s1.ht) / span : 1;
      } else {
        s0 = b[0]; s1 = b[0]; k = 1;
        for (let i = b.length - 2; i >= 0; i--) {
          if (b[i].ht <= rt) { s0 = b[i]; s1 = b[i + 1]; break; }
        }
        const span = s1.ht - s0.ht;
        k = span > 0 ? Math.max(0, Math.min(1, (rt - s0.ht) / span)) : 1;
      }
      const ents = [];
      for (const e1 of s1.ents.values()) {
        const e0 = s0.ents.get(e1.id);
        if (e0 && e1.kind === 'troop') {
          // Çok büyük sıçramaları (geri itme vb.) yumuşatmadan uygula
          const jump = Math.abs(e1.x - e0.x) + Math.abs(e1.y - e0.y) > 3;
          ents.push(Object.assign({}, e1, jump ? {} : { x: e0.x + (e1.x - e0.x) * k, y: e0.y + (e1.y - e0.y) * k }));
        } else ents.push(e1);
      }
      const projs = [];
      for (const p1 of s1.projs.values()) {
        const p0 = s0.projs.get(p1.id);
        if (p0) projs.push(Object.assign({}, p1, { x: p0.x + (p1.x - p0.x) * k, y: p0.y + (p1.y - p0.y) * k }));
        else if (k > 0.5) projs.push(p1);
      }
      const d = s1.raw;
      const ts = t / 1000;
      return {
        time: d.gt, clock: d.t, cd: Math.max(0, d.cd - Math.max(0, rt - s1.ht)), left: d.l, ot: !!d.ot, dbl: !!d.db, crowns: d.c,
        ents, projs, areas: s1.areas, over: !!d.ov, winner: d.w,
        ghosts: this.ghosts.filter(g => !g.until || ts <= g.until)
      };
    }
    getHUD(t) {
      const last = this.buf[this.buf.length - 1];
      const lag = this.started && !this.ended && Date.now() - this.conn.lastRecv > LAG_MS;
      if (!last) return { elixir: 5, hand: this.opts.deck.slice(0, 4), next: this.opts.deck[4], crowns: [0, 0], left: 180, ot: false, dbl: false, cd: 3, pending: [], ping: this.ping, lag };
      const d = last.raw;
      const since = Math.max(0, t / 1000 - last.at);
      const rate = d.cd > 0 ? 0 : ELIXIR_RATE * (d.db ? 2 : 1);
      let el = Math.min(10, d.el + Math.min(since, 1.5) * rate);
      for (const p of this.pends) el -= p.cost;
      el = Math.max(0, el);
      const left = d.cd > 0 ? d.l : Math.max(0, d.l - Math.min(since, 1.5));
      return { elixir: el, hand: d.h.slice(), next: d.nx, crowns: d.c.slice(), left, ot: !!d.ot, dbl: !!d.db, cd: Math.max(0, d.cd - since), pending: this.pends.map(p => p.i), ping: this.ping, lag };
    }
    drainFx(t) {
      const rt = this._renderTime(t);
      const out = [];
      while (this.fxQueue.length && this.fxQueue[0].ht <= rt + 0.02) out.push(this.fxQueue.shift().f);
      // Kuyruk aşırı büyürse (uzun kopma sonrası) eskileri at
      if (this.fxQueue.length > 300) this.fxQueue.splice(0, this.fxQueue.length - 300);
      return out;
    }
    _viewEnts() {
      const last = this.buf[this.buf.length - 1];
      return last ? Array.from(last.ents.values()) : [];
    }
    canDeploy(key, x, y) { return canDeployOn(this._viewEnts(), 1, key, x, y); }
    play(i, x, y) {
      if (this.ended || this.pends.length >= 3) return false;
      const t = now();
      const hud = this.getHUD(t);
      if (hud.cd > 0.05 || hud.pending.includes(i)) return false;
      const k = hud.hand[i];
      if (!k || CARDS[k].cost > hud.elixir + 0.05) return false;
      if (!this.canDeploy(k, x, y)) return false;
      this.seq++;
      this.pends.push({ n: this.seq, i, cost: CARDS[k].cost, at: t / 1000 });
      this.ghosts.push({ n: this.seq, k, x, y, s: 1, at: t / 1000 });
      const msg = { i, k, x: r2(x), y: r2(y), n: this.seq };
      this.conn.send('play', msg);
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
