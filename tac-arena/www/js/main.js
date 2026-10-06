/* Taç Arena — arayüz ve uygulama akışı */
(function () {
  'use strict';
  const TA = window.TA;
  const { CARDS, DECK_KEYS, DEFAULT_DECK, RARITY, sy } = TA;
  const $ = id => document.getElementById(id);

  // ---------------- Kalıcı veri ----------------
  const store = {
    get(k, def) { try { const v = localStorage.getItem('tacarena_' + k); return v ? JSON.parse(v) : def; } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem('tacarena_' + k, JSON.stringify(v)); } catch (e) { /* yoksay */ } }
  };

  const defaultProfile = () => ({
    name: 'Oyuncu' + Math.floor(100 + Math.random() * 900), trophies: 0, best: 0,
    wins: 0, losses: 0, draws: 0, games: 0, onlineWins: 0, threeCrowns: 0, towers: 0, cardsPlayed: 0,
    hardWin: false, deckEdited: false, friendGames: 0, ach: {}
  });
  let profile = Object.assign(defaultProfile(), store.get('profile', {}));
  let deck = TA.sanitizeDeck(store.get('deck', DEFAULT_DECK));
  const saveProfile = () => store.set('profile', profile);
  const saveDeck = () => store.set('deck', deck);
  TA.Audio.enabled = store.get('sound', true);

  const ARENAS = [[0, 'Eğitim Kampı', '🛡️'], [200, 'Goblin Stadyumu', '👺'], [500, 'Kemik Çukuru', '💀'], [900, 'Barbar Arenası', '🧔'], [1400, 'Büyü Vadisi', '🧙'], [2000, 'Kraliyet Arenası', '🤴'], [3000, 'Efsaneler Arenası', '🐉']];
  const arenaFor = t => { let a = ARENAS[0]; for (const x of ARENAS) if (t >= x[0]) a = x; return a; };

  const ACHIEVEMENTS = [
    { id: 'first_win', icon: '🥇', name: 'İlk Zafer', desc: 'Bir maç kazan', prog: p => [p.wins, 1] },
    { id: 'three_crown', icon: '👑', name: 'Üç Taç', desc: 'Bir maçta 3 taç al', prog: p => [p.threeCrowns, 1] },
    { id: 'online_win', icon: '⚔️', name: 'Online Savaşçı', desc: 'Online bir maç kazan', prog: p => [p.onlineWins, 1] },
    { id: 'online_10', icon: '🏟️', name: 'Arena Ustası', desc: '10 online maç kazan', prog: p => [p.onlineWins, 10] },
    { id: 'hard_bot', icon: '🤖', name: 'Bot Avcısı', desc: 'Zor botu yen', prog: p => [p.hardWin ? 1 : 0, 1] },
    { id: 'towers_25', icon: '🏰', name: 'Kule Yıkıcı', desc: 'Toplam 25 kule yık', prog: p => [p.towers, 25] },
    { id: 'games_20', icon: '🔥', name: 'Azimli', desc: '20 maç oyna', prog: p => [p.games, 20] },
    { id: 'cards_300', icon: '🃏', name: 'Kart Ustası', desc: 'Toplam 300 kart oyna', prog: p => [p.cardsPlayed, 300] },
    { id: 'trophy_500', icon: '🏆', name: 'Yükselen Yıldız', desc: '500 kupaya ulaş', prog: p => [p.best, 500] },
    { id: 'deck_edit', icon: '🧠', name: 'Stratejist', desc: 'Desteni düzenle', prog: p => [p.deckEdited ? 1 : 0, 1] },
    { id: 'friend', icon: '🤝', name: 'Kanka Maçı', desc: 'Arkadaşınla oda maçı oyna', prog: p => [p.friendGames, 1] }
  ];
  function checkAchievements() {
    const fresh = [];
    for (const a of ACHIEVEMENTS) {
      const [c, t] = a.prog(profile);
      if (c >= t && !profile.ach[a.id]) { profile.ach[a.id] = Date.now(); fresh.push(a); }
    }
    if (fresh.length) saveProfile();
    return fresh;
  }

  // ---------------- Yardımcılar ----------------
  let toastT = null;
  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), ms || 1600);
  }
  function vibrate(ms) {
    try { if (window.Android && window.Android.vibrate) window.Android.vibrate(ms); else if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* yoksay */ }
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function cardHTML(k, extra) {
    const c = CARDS[k];
    const typeIcon = c.type === 'spell' ? '✨' : (c.type === 'building' ? '🏛️' : '');
    return `<div class="tcard ${extra || ''}" style="--rc:${RARITY[c.rarity].color}" data-k="${k}">
      <div class="cost">${c.cost}</div><div class="type">${typeIcon}</div>
      <div class="art">${c.emoji}</div><div class="nm">${esc(c.name)}</div></div>`;
  }

  let current = 'home';
  function show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
    current = id;
  }

  // ---------------- Modal ----------------
  let modalClosable = true, modalOnClose = null;
  function openModal(html, opts) {
    opts = opts || {};
    $('modalBox').innerHTML = html;
    $('modal').classList.remove('hidden');
    modalClosable = opts.closable !== false;
    modalOnClose = opts.onClose || null;
  }
  function closeModal() {
    $('modal').classList.add('hidden');
    const cb = modalOnClose; modalOnClose = null;
    if (cb) cb();
  }
  $('modal').addEventListener('click', e => { if (e.target.id === 'modal' && modalClosable) closeModal(); });

  // ---------------- Ağ ----------------
  let net = null;
  try {
    net = new TA.Net();
    net.setProfile(profile);
    net.onOnline = n => { const p = $('netPill'); p.className = 'net-pill ok'; $('netText').textContent = 'Çevrimiçi: ' + n; $('searchInfo').textContent = 'Çevrimiçi oyuncular: ' + n; };
    net.onLobbyStatus = st => {
      if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') { $('netPill').className = 'net-pill err'; $('netText').textContent = 'Bağlantı yok'; }
    };
    net.connectLobby();
  } catch (e) {
    $('netPill').className = 'net-pill err';
    $('netText').textContent = 'Çevrimdışı';
  }

  // ---------------- Ana menü ----------------
  function renderHome() {
    const ar = arenaFor(profile.trophies);
    $('pName').textContent = profile.name;
    $('pTrophy').textContent = profile.trophies;
    $('pArena').textContent = ar[1];
    $('pAvatar').textContent = ar[2];
    $('deckPreview').innerHTML = deck.map(k => `<div class="mini"><i>${CARDS[k].cost}</i>${CARDS[k].emoji}</div>`).join('');
    $('statsLine').textContent = `${profile.games} maç · ${profile.wins} galibiyet · ${profile.losses} mağlubiyet`;
    const done = ACHIEVEMENTS.filter(a => profile.ach[a.id]).length;
    $('achCount').textContent = `${done}/${ACHIEVEMENTS.length}`;
    $('btnSound').textContent = TA.Audio.enabled ? '🔊' : '🔇';
  }

  document.addEventListener('pointerdown', () => TA.Audio.init(), { capture: true });

  $('btnSound').onclick = () => { TA.Audio.enabled = !TA.Audio.enabled; store.set('sound', TA.Audio.enabled); renderHome(); TA.Audio.play('click'); };
  $('profileCard').onclick = () => {
    openModal(`<h2>İsmini değiştir</h2>
      <input class="modal-input" id="nameIn" maxlength="14" value="${esc(profile.name)}">
      <div class="modal-actions"><button class="btn" id="mCancel">Vazgeç</button><button class="btn btn-gold" id="mSave">Kaydet</button></div>`);
    const inp = $('nameIn');
    setTimeout(() => inp.focus(), 50);
    $('mCancel').onclick = closeModal;
    $('mSave').onclick = () => {
      const v = inp.value.replace(/\s+/g, ' ').trim().slice(0, 14);
      if (v.length < 2) { toast('İsim en az 2 karakter olmalı'); return; }
      profile.name = v; saveProfile(); if (net) net.setProfile(profile); renderHome(); closeModal();
    };
  };
  $('btnHelp').onclick = () => openModal(`<div class="howto"><h2>Nasıl Oynanır?</h2>
    <h3>🎯 Amaç</h3><p>Rakibin kulelerini yık! Her prenses kulesi 1 taç, kral kulesi 3 taç değerindedir. 3 dakika sonunda daha çok tacı olan kazanır. Eşitlikte 1 dakika uzatma oynanır: ilk tacı alan kazanır.</p>
    <h3>💧 İksir</h3><p>Kart oynamak iksir harcar. İksir zamanla dolar (en fazla 10). Son 1 dakikada iksir 2 kat hızlı dolar.</p>
    <h3>🃏 Kart oynama</h3><ul><li>Kartı sürükleyip arenaya bırak, ya da karta dokunup arenaya dokun.</li><li>Birlik ve binaları sadece kendi yarına koyabilirsin. Rakibin bir prenses kulesini yıkarsan o koridorda ileri yerleştirme açılır.</li><li>Büyüler arenanın her yerine atılabilir.</li></ul>
    <h3>🤴 Kral kulesi</h3><p>Kral kulesi başta uyur. Hasar alınca ya da bir prenses kulesi yıkılınca uyanır ve ateş etmeye başlar.</p>
    <h3>🌐 Online</h3><p><b>Savaş</b> butonu çevrimiçi rastgele bir rakip bulur. <b>Arkadaşla</b> modunda bir oda kodu oluştur, arkadaşın aynı kodla katılsın. Farklı ağlardan ve telefonlardan oynayabilirsiniz.</p>
    <div class="modal-actions"><button class="btn btn-gold" id="mOk">Anladım!</button></div></div>`);
  document.addEventListener('click', e => { if (e.target && e.target.id === 'mOk') closeModal(); });

  $('btnAch').onclick = () => {
    const rows = ACHIEVEMENTS.map(a => {
      const [c, t] = a.prog(profile);
      const done = !!profile.ach[a.id];
      return `<div class="ach ${done ? 'done' : ''}"><div class="ai">${a.icon}</div><div class="at"><b>${a.name}</b><small>${a.desc}</small></div><div class="prog">${done ? '✔' : Math.min(c, t) + '/' + t}</div></div>`;
    }).join('');
    openModal(`<h2>🏅 Başarımlar</h2><div class="ach-list">${rows}</div><div class="modal-actions"><button class="btn btn-gold" id="mOk">Kapat</button></div>`);
  };

  document.querySelectorAll('[data-back]').forEach(b => b.onclick = () => goHome());
  function goHome() {
    if (current === 'room' && net) { net.leaveRoom(); net.backToIdle(); }
    if (current === 'search' && net) net.cancelSearch();
    swapKey = null;
    renderHome();
    show('home');
  }

  // ---------------- Deste ----------------
  let swapKey = null;
  function renderDeck() {
    $('deckGrid').innerHTML = deck.map((k, i) => cardHTML(k, swapKey ? 'selected' : '').replace('data-k=', `data-i="${i}" data-k=`)).join('');
    const all = DECK_KEYS.slice().sort((a, b) => CARDS[a].cost - CARDS[b].cost || CARDS[a].name.localeCompare(CARDS[b].name, 'tr'));
    $('collGrid').innerHTML = all.map(k => cardHTML(k, deck.includes(k) ? 'in-deck' : '')).join('');
    $('collCount').textContent = `(${all.length})`;
    $('avgElixir').textContent = (deck.reduce((a, k) => a + CARDS[k].cost, 0) / 8).toFixed(1);
    const h = $('deckHint');
    if (swapKey) { h.textContent = `“${CARDS[swapKey].name}” ile değiştirmek için desteden bir kart seç`; h.classList.add('swap'); }
    else { h.textContent = 'Bir karta dokun: bilgi gör, desteye ekle veya değiştir.'; h.classList.remove('swap'); }
  }
  $('btnDeck').onclick = () => { swapKey = null; renderDeck(); show('deck'); };
  $('deckGrid').onclick = e => {
    const el = e.target.closest('.tcard'); if (!el) return;
    const i = +el.dataset.i;
    if (swapKey) {
      deck[i] = swapKey; swapKey = null; saveDeck();
      profile.deckEdited = true; saveProfile(); checkAchievements();
      TA.Audio.play('deploy');
      renderDeck();
      return;
    }
    cardInfo(deck[i], false);
  };
  $('collGrid').onclick = e => {
    const el = e.target.closest('.tcard'); if (!el) return;
    const k = el.dataset.k;
    cardInfo(k, !deck.includes(k));
  };
  function speedLabel(s) { return s <= 0.75 ? 'Yavaş' : s <= 1 ? 'Orta' : s <= 1.5 ? 'Hızlı' : 'Çok hızlı'; }
  function cardInfo(k, canAdd) {
    const c = CARDS[k];
    const st = [];
    const tg = { ground: 'Kara', all: 'Hava ve Kara', buildings: 'Binalar' };
    if (c.type === 'spell') {
      if (c.dmg) st.push(['Hasar', c.dmg]);
      if (c.dps) st.push(['Saniyede hasar', c.dps + ' × ' + c.dur + 'sn']);
      st.push(['Yarıçap', c.radius]);
      if (c.stun) st.push(['Sersemletme', c.stun + 'sn']);
      if (c.freeze) st.push(['Dondurma', c.freeze + 'sn']);
      st.push(['Kule hasarı', Math.round((c.towerPct || 1) * 100) + '%']);
    } else {
      st.push(['Can', c.hp]);
      if (c.ramp) st.push(['Hasar', c.ramp.join(' → ')]);
      else if (c.dmg) st.push(['Hasar', c.dmg + (c.charge ? ' (hücum ×2)' : '')]);
      if (c.hit) st.push(['Vuruş hızı', c.hit + 'sn']);
      if (c.type === 'troop') st.push(['Hareket', speedLabel(c.speed)]);
      if (c.range != null) st.push(['Menzil', c.range < 2 ? 'Yakın' : c.range]);
      if (c.targets) st.push(['Hedef', tg[c.targets]]);
      if (c.count > 1) st.push(['Adet', '×' + c.count]);
      if (c.splash || c.splashSelf) st.push(['Alan hasarı', 'Var']);
      if (c.air) st.push(['Tür', 'Uçan']);
      if (c.lifetime) st.push(['Ömür', c.lifetime + 'sn']);
      if (c.spawn) st.push(['Üretim', 'Her ' + c.spawn.every + 'sn']);
    }
    const rar = RARITY[c.rarity];
    openModal(`<div class="card-info">${cardHTML(k)}<div><h2>${esc(c.name)}</h2>
      <div class="rar" style="color:${rar.color}">${rar.name} · ${c.type === 'spell' ? 'Büyü' : c.type === 'building' ? 'Bina' : 'Birlik'}</div></div></div>
      <p>${esc(c.desc)}</p>
      <div class="stat-grid">${st.map(([a, b]) => `<div class="stat">${a}<b>${b}</b></div>`).join('')}</div>
      <div class="modal-actions"><button class="btn" id="mClose">Kapat</button>${canAdd ? '<button class="btn btn-gold" id="mUse">Desteye Ekle</button>' : ''}</div>`);
    $('mClose').onclick = closeModal;
    if (canAdd) $('mUse').onclick = () => { swapKey = k; closeModal(); renderDeck(); $('deckGrid').scrollIntoView({ behavior: 'smooth' }); };
  }

  // ---------------- Bot ----------------
  const BOT_NAMES = { easy: 'Acemi Bot', normal: 'Usta Bot', hard: 'Efsane Bot' };
  let lastBotLevel = 'normal';
  $('btnBot').onclick = () => {
    openModal(`<h2>🤖 Antrenman</h2><p class="muted" style="text-align:center">Bir zorluk seç</p>
      <div class="diff-list">
        <button class="btn btn-green" data-lv="easy"><span class="bi">🙂</span><span><b>Kolay</b><small>Yeni başlayanlar için</small></span></button>
        <button class="btn btn-blue" data-lv="normal"><span class="bi">😐</span><span><b>Normal</b><small>Dengeli rakip</small></span></button>
        <button class="btn btn-red" data-lv="hard"><span class="bi">😈</span><span><b>Zor</b><small>Hızlı ve akıllı</small></span></button>
      </div>`);
    $('modalBox').querySelectorAll('[data-lv]').forEach(b => b.onclick = () => { closeModal(); startBot(b.dataset.lv); });
  };
  function startBot(level) {
    lastBotLevel = level;
    const s = new TA.BotSession({ deck, name: profile.name, level, botName: BOT_NAMES[level] });
    s.kind = 'bot'; s.level = level;
    enterGame(s, BOT_NAMES[level], level === 'hard' ? '😈 Zor' : level === 'easy' ? '🙂 Kolay' : '😐 Normal');
    s.started = true;
    banner('SAVAŞ!', 'Kuleleri yık!');
    TA.Audio.play('start');
  }

  // ---------------- Online arama ----------------
  const TIPS = [
    '💡 Dev gibi tankların arkasına uzak menzilli birlikler koy.',
    '💡 İskelet Ordusu tankları eritir ama Ok Yağmuru ile yok olur.',
    '💡 Kral kulesini erken uyandırmamaya dikkat et!',
    '💡 Son dakikada iksir 2 kat hızlı dolar.',
    '💡 Binalar Dev, Golem ve Domuz Binici gibi birlikleri kendine çeker.',
    '💡 Cehennem Kulesi aynı hedefe vurdukça daha çok hasar verir.',
    '💡 Şimşek, Cehennem Kulesi’nin hasar birikimini sıfırlar.'
  ];
  let searchTimer = null;
  $('btnOnline').onclick = () => {
    if (!net) { toast('İnternet bağlantısı gerekli'); return; }
    net.setProfile(profile);
    show('search');
    $('searchTitle').textContent = 'Rakip aranıyor…';
    const t0 = Date.now();
    let tip = Math.floor(Math.random() * TIPS.length);
    $('searchTip').textContent = TIPS[tip];
    clearInterval(searchTimer);
    searchTimer = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      $('searchTime').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
      if (s % 6 === 5) { tip = (tip + 1) % TIPS.length; $('searchTip').textContent = TIPS[tip]; }
    }, 1000);
    $('searchTime').textContent = '0:00';
    net.startSearch(info => { clearInterval(searchTimer); TA.Audio.play('match'); startOnline(info, 'online'); });
  };
  $('btnCancelSearch').onclick = () => { clearInterval(searchTimer); if (net) net.cancelSearch(); goHome(); };

  // ---------------- Oda ----------------
  $('btnFriend').onclick = () => {
    if (!net) { toast('İnternet bağlantısı gerekli'); return; }
    net.setProfile(profile);
    $('roomCodeBox').classList.add('hidden');
    $('roomStatus').textContent = '';
    $('roomInput').value = '';
    show('room');
  };
  function roomStatus(st) {
    const m = { waiting: '⏳ Arkadaşın bekleniyor…', full: '⛔ Bu oda dolu!', found: '✅ Arkadaşın bulundu, bağlanılıyor…', error: '⚠️ Bağlantı hatası, tekrar dene' };
    $('roomStatus').textContent = m[st] || '';
  }
  $('btnCreateRoom').onclick = () => {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    $('roomCode').textContent = code;
    $('roomCodeBox').classList.remove('hidden');
    net.joinRoom(code, info => startOnline(info, 'room'), roomStatus);
  };
  $('btnJoinRoom').onclick = () => {
    const code = $('roomInput').value.replace(/\D/g, '');
    if (code.length !== 4) { toast('4 haneli oda kodunu yaz'); return; }
    $('roomInput').blur();
    net.joinRoom(code, info => startOnline(info, 'room'), roomStatus);
  };
  $('roomInput').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); });
  $('btnShareCode').onclick = () => {
    const code = $('roomCode').textContent;
    const text = `Taç Arena'da benimle kapış! Oda kodu: ${code}`;
    try {
      if (window.Android && window.Android.share) { window.Android.share(text); return; }
      if (navigator.share) { navigator.share({ text }).catch(() => {}); return; }
      if (navigator.clipboard) { navigator.clipboard.writeText(code).then(() => toast('Kod kopyalandı: ' + code)).catch(() => toast('Oda kodu: ' + code)); return; }
    } catch (e) { /* yoksay */ }
    toast('Oda kodu: ' + code);
  };

  // ---------------- Online maç başlat ----------------
  let startGuard = null;
  function startOnline(info, kind, connOverride) {
    const conn = connOverride || net.openMatch(info.matchId);
    const opts = { conn, deck, name: profile.name, trophies: profile.trophies, opp: info.opp };
    const s = info.host ? new TA.HostSession(opts) : new TA.GuestSession(opts);
    s.kind = kind;
    s.onStart = d => {
      clearTimeout(startGuard);
      $('waitOverlay').classList.add('hidden');
      $('oppName').textContent = d.oppName;
      $('oppTr').textContent = '🏆 ' + (d.oppTrophies || 0);
      if (kind === 'room' && net) net.leaveRoom();
      banner('SAVAŞ!', kind === 'room' ? 'Arkadaş maçı' : 'Online maç');
      TA.Audio.play('start');
      vibrate(60);
    };
    s.onInfo = d => { $('oppName').textContent = d.oppName; $('oppTr').textContent = '🏆 ' + (d.oppTrophies || 0); };
    enterGame(s, info.opp && info.opp.name || 'Rakip', '🏆 ' + ((info.opp && info.opp.trophies) || 0));
    $('waitText').textContent = 'Rakip bağlanıyor…';
    $('waitOverlay').classList.remove('hidden');
    clearTimeout(startGuard);
    startGuard = setTimeout(() => {
      if (session === s && !s.started) {
        toast('Rakip bağlanamadı, tekrar dene', 2500);
        s.ended = true; conn.close(); session = null; if (net) { net.leaveRoom(); net.backToIdle(); } goHome();
      }
    }, 15000);
  }

  // ---------------- Oyun ----------------
  const cv = $('cv');
  const renderer = new TA.Renderer(cv);
  let session = null;
  let sel = -1, drag = null;
  let hudCache = {};
  let resultShown = false;
  let lastLeft = 999;
  let lastEmote = 0;

  function enterGame(s, oppName, oppTr) {
    session = s;
    resultShown = false;
    sel = -1; drag = null; hudCache = {};
    lastLeft = 999;
    renderer.mySide = s.mySide;
    renderer.flip = s.mySide === 1;
    renderer.particles = []; renderer.rings = []; renderer.beams = []; renderer.popups = []; renderer.bubbles = [];
    renderer.drag = null;
    $('oppName').textContent = oppName;
    $('oppTr').textContent = oppTr || '';
    $('waitOverlay').classList.add('hidden');
    $('emotePanel').classList.add('hidden');
    show('game');
    buildSlots();
    requestAnimationFrame(() => renderer.resize());
    s.onEnd = r => endGame(r);
    s.onEmote = (side, code) => { renderer.bubble(side, code); TA.Audio.play('emote'); };
    s.onReject = () => toast('Kart oynanamadı');
  }

  function buildSlots() {
    const box = $('slots');
    box.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const d = document.createElement('div');
      d.className = 'slot';
      d.dataset.i = i;
      d.innerHTML = '<div class="tcard"></div><div class="shade"></div>';
      d.addEventListener('pointerdown', onSlotDown);
      box.appendChild(d);
    }
  }

  function banner(text, sub) {
    const b = $('banner');
    b.innerHTML = esc(text) + (sub ? `<small>${esc(sub)}</small>` : '');
    b.classList.add('show');
    clearTimeout(b._t);
    b._t = setTimeout(() => b.classList.remove('show'), 1600);
  }

  function updateHUD(h) {
    if (!h) return;
    const ms = session.mySide;
    const left = Math.ceil(h.left);
    const tStr = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
    if (hudCache.t !== tStr) { $('timer').textContent = tStr; hudCache.t = tStr; }
    const urgent = h.ot || left <= 10;
    if (hudCache.urg !== urgent) { $('timer').classList.toggle('urgent', urgent); hudCache.urg = urgent; }
    const lbl = h.ot ? 'UZATMA' : (h.dbl ? 'x2 İksir' : 'Kalan süre');
    if (hudCache.lbl !== lbl) { $('timerLabel').textContent = lbl; hudCache.lbl = lbl; }
    if (!h.ot && lastLeft > 60 && h.left <= 60 && h.left > 0 && session.started) banner('2x İKSİR!', 'Son 60 saniye');
    lastLeft = h.left;
    const cm = h.crowns[ms], co = h.crowns[1 - ms];
    if (hudCache.cm !== cm) { $('crMe').textContent = cm; hudCache.cm = cm; }
    if (hudCache.co !== co) { $('crOp').textContent = co; hudCache.co = co; }
    const el = Math.max(0, Math.min(10, h.elixir));
    const w = (el * 10).toFixed(1) + '%';
    if (hudCache.w !== w) { $('elixirFill').style.width = w; hudCache.w = w; }
    if (hudCache.dbl !== h.dbl) { $('elixirFill').classList.toggle('dbl', h.dbl); hudCache.dbl = h.dbl; }
    const en = Math.floor(el);
    if (hudCache.en !== en) { $('elixirNum').textContent = en; hudCache.en = en; }
    const slots = $('slots').children;
    for (let i = 0; i < 4; i++) {
      const k = h.hand[i];
      const sl = slots[i];
      if (!sl) continue;
      const key = 'k' + i;
      if (hudCache[key] !== k) {
        sl.querySelector('.tcard').outerHTML = cardHTML(k);
        if (hudCache[key]) { sl.classList.remove('cycle'); void sl.offsetWidth; sl.classList.add('cycle'); }
        hudCache[key] = k;
      }
      const cost = CARDS[k].cost;
      const poor = cost > el + 0.001;
      sl.classList.toggle('poor', poor);
      sl.classList.toggle('selected', sel === i);
      sl.classList.toggle('pending', h.pending === i);
      const shade = Math.max(0, 1 - el / cost);
      const sh = (shade * 100).toFixed(0) + '%';
      if (hudCache['s' + i] !== sh) { sl.querySelector('.shade').style.height = sh; hudCache['s' + i] = sh; }
    }
    if (hudCache.nx !== h.next) {
      const c = CARDS[h.next];
      $('nextCard').querySelector('.nc-art').innerHTML = c ? c.emoji : '';
      hudCache.nx = h.next;
    }
  }

  function handleFx(list) {
    if (!list.length) return;
    renderer.addFx(list);
    const ms = session.mySide;
    for (const f of list) {
      switch (f.t) {
        case 'play': if (f.s === ms) TA.Audio.play('deploy'); break;
        case 'spell': TA.Audio.play(f.k === 'zap' ? 'zap' : (f.k === 'fireball' || f.k === 'rocket') ? 'boom' : 'spell'); break;
        case 'area': TA.Audio.play('spell'); break;
        case 'boom': TA.Audio.play('boom'); break;
        case 'hit': TA.Audio.play('hit'); break;
        case 'tower':
          TA.Audio.play('tower'); vibrate(f.s === ms ? 220 : 90);
          if (!f.king) banner(f.s === ms ? 'Kuleni kaybettin!' : 'Kule yıkıldı! 👑');
          break;
        case 'overtime': banner('UZATMA!', 'İlk tacı alan kazanır'); break;
      }
    }
  }

  function frame(t) {
    requestAnimationFrame(frame);
    if (!session || current !== 'game') return;
    try {
      session.update(t);
      const view = session.getView(t);
      handleFx(session.drainFx(t));
      renderer.draw(view, t);
      if (view) updateHUD(session.getHUD(t));
    } catch (err) {
      if (window.console) console.error(err);
    }
  }
  requestAnimationFrame(frame);
  // Arka planda da (rAF yavaşlarsa) ağ ve simülasyon dönmeye devam etsin
  setInterval(() => { if (session && session.mode !== 'bot') { try { session.update(performance.now()); } catch (e) { /* yoksay */ } } }, 50);
  window.addEventListener('resize', () => { if (current === 'game') renderer.resize(); });

  // ---------------- Girdi ----------------
  function posFromEvent(e) {
    const r = cv.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    if (px < 0 || py < 0 || px > r.width || py > r.height) return null;
    const [wx, wy] = renderer.toWorld(px, py);
    return { wx, wy };
  }
  function placement(key, wx, wy) {
    const c = CARDS[key];
    const ms = session.mySide;
    let x = Math.max(0.5, Math.min(17.5, wx)), y = Math.max(0.5, Math.min(31.5, wy));
    if (c.type !== 'spell') {
      x = Math.min(17.5, Math.floor(x) + 0.5);
      y = Math.min(31.5, Math.floor(y) + 0.5);
    }
    let valid = session.canDeploy(key, x, y);
    if (!valid && c.type !== 'spell') {
      // Rakip yarısına sürüklenirse kendi sınırına yapıştır
      const ly = sy(ms, y);
      if (ly < 17.5) {
        const y2 = sy(ms, 17.5);
        if (session.canDeploy(key, x, y2)) { y = y2; valid = true; }
      }
    }
    return { x, y, valid };
  }
  function onSlotDown(e) {
    if (!session || session.ended) return;
    const i = +e.currentTarget.dataset.i;
    const h = session.getHUD(performance.now());
    if (h.pending === i) return;
    const key = h.hand[i];
    const wasSel = sel === i;
    sel = i;
    drag = { i, key, id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, wasSel };
    renderer.drag = { key, x: null, y: null, valid: false };
    TA.Audio.play('click');
    e.preventDefault();
  }
  window.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id || !session) return;
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 10) drag.moved = true;
    const p = posFromEvent(e);
    if (!p) { renderer.drag = { key: drag.key, x: null, y: null, valid: false }; return; }
    const pl = placement(drag.key, p.wx, p.wy);
    renderer.drag = { key: drag.key, x: pl.x, y: pl.y, valid: pl.valid };
  });
  window.addEventListener('pointerup', e => {
    if (!drag || e.pointerId !== drag.id || !session) return;
    const d = drag; drag = null;
    const p = posFromEvent(e);
    if (p && d.moved) {
      const pl = placement(d.key, p.wx, p.wy);
      tryDeploy(d.i, d.key, pl);
      sel = -1; renderer.drag = null;
    } else if (!d.moved && d.wasSel) {
      // seçili karta tekrar dokunmak seçimi kaldırır
      sel = -1; renderer.drag = null;
    } else if (!d.moved) {
      // dokun-seç modu: kart seçili kalır, arenaya dokununca oynar
      renderer.drag = { key: d.key, x: null, y: null, valid: false };
    } else {
      sel = -1; renderer.drag = null;
    }
  });
  window.addEventListener('pointercancel', () => { drag = null; sel = -1; renderer.drag = null; });
  cv.addEventListener('pointerdown', e => {
    $('emotePanel').classList.add('hidden');
    if (!session || sel < 0 || drag) return;
    const h = session.getHUD(performance.now());
    const key = h.hand[sel];
    const p = posFromEvent(e);
    if (!p) return;
    const pl = placement(key, p.wx, p.wy);
    if (tryDeploy(sel, key, pl)) { sel = -1; renderer.drag = null; }
  });
  function tryDeploy(i, key, pl) {
    const h = session.getHUD(performance.now());
    if (h.hand[i] !== key) return false;
    if (CARDS[key].cost > h.elixir + 0.001) { toast('Yetersiz iksir! 💧'); TA.Audio.play('poor'); return false; }
    if (!pl.valid) { toast('Buraya yerleştiremezsin'); TA.Audio.play('poor'); return false; }
    const ok = session.play(i, pl.x, pl.y);
    if (ok) { profile.cardsPlayed++; vibrate(15); }
    return ok;
  }

  // Emojiler
  const EMOTES = ['😀', '😂', '😡', '😭', '👍', '🙏', '😎', '🤯', '👑'];
  $('emotePanel').innerHTML = EMOTES.map(e => `<button data-e="${e}">${e}</button>`).join('');
  $('btnEmote').onclick = () => $('emotePanel').classList.toggle('hidden');
  $('emotePanel').onclick = e => {
    const b = e.target.closest('[data-e]'); if (!b || !session) return;
    $('emotePanel').classList.add('hidden');
    if (Date.now() - lastEmote < 1500) return;
    lastEmote = Date.now();
    session.emote(b.dataset.e);
  };

  // Oyun menüsü
  $('btnMenu').onclick = () => openGameMenu();
  function openGameMenu() {
    if (!session || resultShown) return;
    openModal(`<h2>⚙️ Menü</h2>
      <div class="diff-list">
        <button class="btn btn-green" id="mResume"><span class="bi">▶️</span><span><b>Devam Et</b></span></button>
        <button class="btn" id="mSound"><span class="bi">${TA.Audio.enabled ? '🔊' : '🔇'}</span><span><b>Ses: ${TA.Audio.enabled ? 'Açık' : 'Kapalı'}</b></span></button>
        <button class="btn btn-red" id="mQuit"><span class="bi">🏳️</span><span><b>Teslim Ol</b><small>Maçı kaybedersin</small></span></button>
      </div>`);
    $('mResume').onclick = closeModal;
    $('mSound').onclick = () => { TA.Audio.enabled = !TA.Audio.enabled; store.set('sound', TA.Audio.enabled); closeModal(); openGameMenu(); };
    $('mQuit').onclick = () => {
      closeModal();
      if (!session) return;
      const s = session;
      const h = s.getHUD(performance.now());
      s.quit();
      endGame({ outcome: 'lose', myCrowns: h.crowns[s.mySide], oppCrowns: h.crowns[1 - s.mySide], reason: 'surrender' });
    };
  }

  // ---------------- Maç sonu ----------------
  function endGame(r) {
    if (resultShown || !session) return;
    resultShown = true;
    const s = session;
    const online = s.kind === 'online';
    let dTr = 0;
    if (online) dTr = r.outcome === 'win' ? 30 + Math.floor(Math.random() * 3) : r.outcome === 'lose' ? -Math.min(profile.trophies, 20) : 0;
    profile.games++;
    if (r.outcome === 'win') profile.wins++; else if (r.outcome === 'lose') profile.losses++; else profile.draws++;
    if (r.outcome === 'win' && online) profile.onlineWins++;
    if (r.outcome === 'win' && r.myCrowns >= 3) profile.threeCrowns++;
    if (r.outcome === 'win' && s.kind === 'bot' && s.level === 'hard') profile.hardWin = true;
    if (s.kind === 'room') profile.friendGames++;
    profile.towers += Math.min(3, r.myCrowns || 0);
    profile.trophies = Math.max(0, profile.trophies + dTr);
    profile.best = Math.max(profile.best, profile.trophies);
    saveProfile();
    if (net) net.setProfile(profile);
    const fresh = checkAchievements();
    if (net && s.kind !== 'bot') setTimeout(() => net.backToIdle(), 500);

    setTimeout(() => {
      TA.Audio.play(r.outcome === 'win' ? 'win' : r.outcome === 'lose' ? 'lose' : 'click');
      const title = r.outcome === 'win' ? 'ZAFER!' : r.outcome === 'lose' ? 'YENİLGİ' : 'BERABERE';
      const reason = r.reason === 'left' ? (r.outcome === 'win' ? 'Rakip oyundan ayrıldı' : 'Bağlantı koptu') : r.reason === 'surrender' ? 'Teslim oldun' : '';
      const crowns = [0, 1, 2].map(i => `<span class="${i < (r.myCrowns || 0) ? 'on' : ''}" style="animation-delay:${0.15 + i * 0.25}s">👑</span>`).join('');
      openModal(`<div class="result-title ${r.outcome}">${title}</div>
        <div class="result-crowns">${crowns}</div>
        <div class="result-sub">${r.myCrowns || 0} - ${r.oppCrowns || 0}${reason ? ' · ' + reason : ''}</div>
        ${online ? `<div class="result-trophy ${dTr >= 0 ? 'up' : 'down'}">🏆 ${dTr >= 0 ? '+' : ''}${dTr}</div>` : ''}
        ${fresh.map(a => `<div class="new-ach">${a.icon} Yeni başarım: ${a.name}</div>`).join('')}
        <div class="modal-actions"><button class="btn" id="mHome">Ana Menü</button><button class="btn btn-gold" id="mAgain">Tekrar Oyna</button></div>`, { closable: false });
      $('mHome').onclick = () => { closeModal(); leaveGame(); goHome(); };
      $('mAgain').onclick = () => {
        closeModal(); const kind = s.kind; leaveGame();
        if (kind === 'bot') startBot(lastBotLevel);
        else if (kind === 'online') { renderHome(); $('btnOnline').onclick(); }
        else { goHome(); $('btnFriend').onclick(); }
      };
    }, r.reason === 'surrender' ? 200 : 1300);
  }

  function leaveGame() {
    if (session && session.conn) { try { session.conn.close(); } catch (e) { /* yoksay */ } }
    session = null;
    renderer.drag = null;
  }

  // ---------------- Android geri tuşu ----------------
  window.taBack = function () {
    if (!$('modal').classList.contains('hidden')) {
      if (modalClosable) closeModal();
      return 'ok';
    }
    if (current === 'game') { openGameMenu(); return 'ok'; }
    if (current === 'search') { $('btnCancelSearch').onclick(); return 'ok'; }
    if (current !== 'home') { goHome(); return 'ok'; }
    return 'exit';
  };
  window.addEventListener('beforeunload', () => { if (session && session.mode !== 'bot') session.quit(); });

  // Test kancası (yalnızca geliştirme testlerinde kullanılır)
  TA.debug = { startOnline };

  renderHome();
  if (!store.get('seenHelp', false)) { store.set('seenHelp', true); setTimeout(() => $('btnHelp').onclick(), 400); }
})();
