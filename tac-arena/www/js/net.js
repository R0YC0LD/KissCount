/* Taç Arena — online eşleştirme ve maç bağlantısı (Supabase Realtime: presence + broadcast)
 * Sunucu kodu gerekmez: oyunculardan biri (host) maçı simüle eder, diğerine durum gönderir.
 */
(function (root) {
  'use strict';

  const CONFIG = {
    url: 'https://gnsmevblecsmnhzufqtr.supabase.co',
    key: 'sb_publishable_LIX6BfgnEzogqfLHkQeGbw_NXiKHy_A',
    lobby: 'tac-arena-lobby-v1',
    proto: 1
  };

  function rid(n) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < (n || 10); i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  class Net {
    constructor(opts) {
      opts = opts || {};
      const create = opts.createClient || (root.supabase && root.supabase.createClient);
      if (!create) throw new Error('Supabase yüklenemedi');
      const realtime = { params: { eventsPerSecond: 40 }, heartbeatIntervalMs: 15000 };
      if (opts.transport) realtime.transport = opts.transport;
      this.client = create(CONFIG.url, CONFIG.key, { realtime, auth: { persistSession: false, autoRefreshToken: false } });
      this.id = rid(12);
      this.profile = { name: 'Oyuncu', trophies: 0 };
      this.lobby = null;
      this.lobbyReady = false;
      this.state = 'idle'; // idle | searching | playing
      this.since = 0;
      this.pending = null;
      this.onlineCount = 0;
      this.onOnline = null;
      this.onMatch = null;
      this.onLobbyStatus = null;
      this._evalTimer = null;
      this.room = null;
    }

    setProfile(p) { this.profile = { name: p.name, trophies: p.trophies || 0 }; if (this.lobbyReady) this._track(); }

    // ---------------- Lobi ----------------
    connectLobby() {
      if (this.lobby) return;
      const ch = this.client.channel(CONFIG.lobby, { config: { presence: { key: this.id }, broadcast: { self: false } } });
      this.lobby = ch;
      ch.on('presence', { event: 'sync' }, () => {
        const st = ch.presenceState();
        this.onlineCount = Object.keys(st).length;
        if (this.onOnline) this.onOnline(this.onlineCount);
        this._evaluate();
      });
      ch.on('broadcast', { event: 'invite' }, ({ payload }) => this._onInvite(payload));
      ch.on('broadcast', { event: 'accept' }, ({ payload }) => this._onAccept(payload));
      ch.on('broadcast', { event: 'decline' }, ({ payload }) => this._onDecline(payload));
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') { this.lobbyReady = true; this._track(); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { this.lobbyReady = false; }
        if (this.onLobbyStatus) this.onLobbyStatus(status);
      });
    }

    _track() {
      if (!this.lobby || !this.lobbyReady) return;
      this.lobby.track({ id: this.id, name: this.profile.name, tr: this.profile.trophies, st: this.state, since: this.since, v: CONFIG.proto }).catch(() => {});
    }

    _searchers() {
      if (!this.lobby) return [];
      const st = this.lobby.presenceState();
      const out = [];
      for (const k of Object.keys(st)) {
        const metas = st[k];
        const m = metas && metas[metas.length - 1];
        if (m && m.st === 'searching' && m.v === CONFIG.proto) out.push(m);
      }
      out.sort((a, b) => (a.since - b.since) || (a.id < b.id ? -1 : 1));
      return out;
    }

    startSearch(onMatch) {
      this.onMatch = onMatch;
      this.state = 'searching';
      this.since = Date.now();
      this.pending = null;
      this.connectLobby();
      this._track();
      clearInterval(this._evalTimer);
      this._evalTimer = setInterval(() => this._evaluate(), 1500);
    }

    cancelSearch() {
      clearInterval(this._evalTimer);
      this._evalTimer = null;
      if (this.state === 'searching') { this.state = 'idle'; this.pending = null; this._track(); }
    }

    _send(event, payload) {
      if (!this.lobby || !this.lobbyReady) return;
      this.lobby.send({ type: 'broadcast', event, payload }).catch(() => {});
    }

    _evaluate() {
      if (this.state !== 'searching') return;
      if (this.pending && Date.now() - this.pending.at > 4000) this.pending = null;
      if (this.pending) return;
      const list = this._searchers().filter(m => m.id !== this.id);
      if (!list.length) return;
      const oldest = list[0];
      // En eski bekleyen davet bekler; diğerleri en eskiyi davet eder.
      const iAmOldest = this.since < oldest.since || (this.since === oldest.since && this.id < oldest.id);
      if (iAmOldest) return;
      const matchId = oldest.id + '_' + this.id;
      this.pending = { to: oldest.id, matchId, at: Date.now() };
      this._send('invite', { to: oldest.id, from: this.id, matchId, name: this.profile.name, tr: this.profile.trophies });
    }

    _onInvite(p) {
      if (!p || p.to !== this.id) return;
      if (this.state !== 'searching' || this.pending) { this._send('decline', { to: p.from, from: this.id, matchId: p.matchId }); return; }
      this._send('accept', { to: p.from, from: this.id, matchId: p.matchId, name: this.profile.name, tr: this.profile.trophies });
      this._matched({ matchId: p.matchId, host: true, opp: { id: p.from, name: p.name, trophies: p.tr } });
    }

    _onAccept(p) {
      if (!p || p.to !== this.id || !this.pending || p.matchId !== this.pending.matchId || this.state !== 'searching') return;
      this._matched({ matchId: p.matchId, host: false, opp: { id: p.from, name: p.name, trophies: p.tr } });
    }

    _onDecline(p) {
      if (!p || p.to !== this.id || !this.pending || p.matchId !== this.pending.matchId) return;
      this.pending = null;
    }

    _matched(info) {
      clearInterval(this._evalTimer);
      this._evalTimer = null;
      this.state = 'playing';
      this.pending = null;
      this._track();
      const cb = this.onMatch;
      this.onMatch = null;
      if (cb) cb(info);
    }

    backToIdle() { this.state = 'idle'; this._track(); }

    // ---------------- Oda kodu ile arkadaş maçı ----------------
    joinRoom(code, onMatch, onStatus) {
      this.leaveRoom();
      const since = Date.now();
      const ch = this.client.channel('tac-arena-room-' + code, { config: { presence: { key: this.id }, broadcast: { self: false } } });
      this.room = ch;
      let done = false;
      ch.on('presence', { event: 'sync' }, () => {
        if (done) return;
        const st = ch.presenceState();
        const list = [];
        for (const k of Object.keys(st)) { const m = st[k][st[k].length - 1]; if (m && m.v === CONFIG.proto) list.push(m); }
        list.sort((a, b) => (a.since - b.since) || (a.id < b.id ? -1 : 1));
        const idx = list.findIndex(m => m.id === this.id);
        if (idx < 0) return;
        if (idx >= 2) { if (onStatus) onStatus('full'); return; }
        if (list.length < 2) { if (onStatus) onStatus('waiting'); return; }
        const host = list[0], guest = list[1];
        const opp = idx === 0 ? guest : host;
        done = true;
        if (onStatus) onStatus('found');
        const info = { matchId: 'room' + code + '_' + host.id + '_' + guest.id, host: idx === 0, opp: { id: opp.id, name: opp.name, trophies: opp.tr } };
        // Oda kanalı maç başlayana kadar açık kalır (rakip de eşleşmeyi görebilsin);
        // arayüz maç başlayınca leaveRoom() çağırır.
        onMatch(info);
      });
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          ch.track({ id: this.id, name: this.profile.name, tr: this.profile.trophies, since, v: CONFIG.proto }).catch(() => {});
          if (onStatus) onStatus('waiting');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          if (onStatus) onStatus('error');
        }
      });
      if (this.lobbyReady) { this.state = 'playing'; this._track(); }
    }

    leaveRoom() {
      if (!this.room) return;
      const ch = this.room;
      this.room = null;
      ch.untrack().catch(() => {});
      this.client.removeChannel(ch);
    }

    // ---------------- Maç kanalı ----------------
    openMatch(matchId) { return new MatchConn(this, matchId); }
  }

  class MatchConn {
    constructor(net, matchId) {
      this.net = net;
      this.handlers = {};
      this.ready = false;
      this.closed = false;
      this.lastRecv = Date.now();
      this.queue = [];
      const ch = net.client.channel('tac-arena-match-' + matchId, { config: { broadcast: { self: false, ack: false } } });
      this.ch = ch;
      ch.on('broadcast', { event: 'm' }, ({ payload }) => {
        if (this.closed || !payload) return;
        this.lastRecv = Date.now();
        const h = this.handlers[payload.e];
        if (h) h(payload.d);
        if (this.handlers['*']) this.handlers['*'](payload.e, payload.d);
      });
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          this.ready = true;
          const q = this.queue; this.queue = [];
          for (const m of q) this._raw(m);
          if (this.handlers.ready) this.handlers.ready();
        } else if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && this.handlers.error) {
          this.handlers.error(status);
        }
      });
    }
    on(e, fn) { this.handlers[e] = fn; return this; }
    _raw(m) { this.ch.send({ type: 'broadcast', event: 'm', payload: m }).catch(() => {}); }
    send(e, d) {
      if (this.closed) return;
      const m = { e, d };
      if (!this.ready) { this.queue.push(m); return; }
      this._raw(m);
    }
    close() {
      if (this.closed) return;
      this.closed = true;
      try { this.net.client.removeChannel(this.ch); } catch (e) { /* yoksay */ }
    }
  }

  const api = { Net, NET_CONFIG: CONFIG, rid };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TA = Object.assign(root.TA || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
