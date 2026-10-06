/* Taç Arena — kart tanımları
 * Birimler karo (tile) cinsinden: arena 18 x 32 karo.
 * speed: karo/sn, hit: saldırı aralığı (sn), range: kenardan kenara menzil.
 */
(function (root) {
  'use strict';

  const CARDS = {
    // ---------- 1-2 iksir ----------
    skeletons: {
      name: 'İskeletler', emoji: '💀', cost: 1, type: 'troop', rarity: 'common', count: 3,
      hp: 81, dmg: 81, hit: 1.0, range: 0.5, speed: 1.5, targets: 'ground', r: 0.3, mass: 1,
      desc: 'Üç hızlı iskelet. Ucuz ve dikkat dağıtmak için mükemmel.'
    },
    goblins: {
      name: 'Goblinler', emoji: '👺', cost: 2, type: 'troop', rarity: 'common', count: 3,
      hp: 202, dmg: 120, hit: 1.1, range: 0.5, speed: 2.0, targets: 'ground', r: 0.35, mass: 1.5,
      desc: 'Çok hızlı, yakın dövüşçü üç goblin.'
    },
    speargob: {
      name: 'Mızraklı Goblinler', emoji: '👹', cost: 2, type: 'troop', rarity: 'common', count: 3,
      hp: 133, dmg: 81, hit: 1.7, range: 5, speed: 2.0, targets: 'all', r: 0.35, mass: 1.5,
      proj: 12, projFx: 'spear',
      desc: 'Uzaktan mızrak fırlatan üç goblin. Havaya da vurur.'
    },
    bomber: {
      name: 'Bombacı', emoji: '💣', cost: 2, type: 'troop', rarity: 'common', count: 1,
      hp: 304, dmg: 225, hit: 1.8, range: 4.5, speed: 1.0, targets: 'ground', r: 0.4, mass: 2,
      proj: 8, projFx: 'bomb', splash: 1.5,
      desc: 'Alan hasarlı bomba atar. Kalabalık kara birliklerine karşı etkili.'
    },
    zap: {
      name: 'Şimşek', emoji: '⚡', cost: 2, type: 'spell', rarity: 'common',
      radius: 2.5, dmg: 192, towerPct: 0.35, stun: 0.5, speed: 0,
      desc: 'Anında hasar verir ve düşmanları kısa süre sersemletir.'
    },

    // ---------- 3 iksir ----------
    knight: {
      name: 'Şövalye', emoji: '🤺', cost: 3, type: 'troop', rarity: 'common', count: 1,
      hp: 1766, dmg: 202, hit: 1.2, range: 0.7, speed: 1.0, targets: 'ground', r: 0.5, mass: 6,
      desc: 'Dayanıklı ve güvenilir yakın dövüş savaşçısı.'
    },
    archers: {
      name: 'Okçular', emoji: '🏹', cost: 3, type: 'troop', rarity: 'common', count: 2,
      hp: 304, dmg: 107, hit: 0.9, range: 5, speed: 1.0, targets: 'all', r: 0.4, mass: 2,
      proj: 14, projFx: 'arrow',
      desc: 'Uzaktan ok atan iki okçu. Hava ve kara hedeflerine vurur.'
    },
    minions: {
      name: 'Minyonlar', emoji: '🦇', cost: 3, type: 'troop', rarity: 'common', count: 3,
      hp: 230, dmg: 102, hit: 1.0, range: 1.6, speed: 1.5, targets: 'all', air: true, r: 0.4, mass: 1.5,
      proj: 15, projFx: 'bolt',
      desc: 'Üç uçan minyon. Hızlı ve can sıkıcı.'
    },
    skarmy: {
      name: 'İskelet Ordusu', emoji: '☠️', cost: 3, type: 'troop', rarity: 'epic', count: 15,
      hp: 81, dmg: 81, hit: 1.0, range: 0.5, speed: 1.5, targets: 'ground', r: 0.3, mass: 1,
      unitEmoji: '💀',
      desc: '15 iskeletlik bir ordu! Tankları eritir ama alan hasarına dikkat.'
    },
    cannon: {
      name: 'Top', emoji: '🎯', cost: 3, type: 'building', rarity: 'common',
      hp: 950, dmg: 212, hit: 0.9, range: 5.5, targets: 'ground', r: 0.9, lifetime: 30,
      proj: 18, projFx: 'ball',
      desc: 'Kara birliklerine ateş eden savunma binası. Devleri kendine çeker.'
    },
    arrows: {
      name: 'Ok Yağmuru', emoji: '🌧️', cost: 3, type: 'spell', rarity: 'common',
      radius: 4, dmg: 366, towerPct: 0.35, speed: 16,
      desc: 'Geniş bir alana ok yağdırır. Kalabalıklara karşı birebir.'
    },

    // ---------- 4 iksir ----------
    musketeer: {
      name: 'Tüfekçi', emoji: '💂', cost: 4, type: 'troop', rarity: 'rare', count: 1,
      hp: 720, dmg: 218, hit: 1.0, range: 6, speed: 1.0, targets: 'all', r: 0.45, mass: 3,
      proj: 16, projFx: 'bolt',
      desc: 'Uzun menzilli nişancı. Hava ve kara hedeflerine vurur.'
    },
    minirobot: {
      name: 'Mini Robot', emoji: '🤖', cost: 4, type: 'troop', rarity: 'rare', count: 1,
      hp: 1361, dmg: 720, hit: 1.6, range: 0.8, speed: 1.5, targets: 'ground', r: 0.45, mass: 5,
      desc: 'Hızlı ve çok güçlü vuruşlu robot. Tankların korkulu rüyası.'
    },
    valkyrie: {
      name: 'Valkür', emoji: '🪓', cost: 4, type: 'troop', rarity: 'rare', count: 1,
      hp: 1908, dmg: 267, hit: 1.5, range: 0.8, speed: 1.0, targets: 'ground', r: 0.5, mass: 6,
      splashSelf: 1.4,
      desc: 'Baltasını etrafında döndürerek çevresindeki herkese vurur.'
    },
    babydragon: {
      name: 'Bebek Ejderha', emoji: '🐉', cost: 4, type: 'troop', rarity: 'epic', count: 1,
      hp: 1152, dmg: 161, hit: 1.5, range: 3.5, speed: 1.5, targets: 'all', air: true, r: 0.55, mass: 4,
      proj: 10, projFx: 'fire', splash: 1.5,
      desc: 'Uçan, alan hasarlı ateş püskürten sevimli ejderha.'
    },
    hog: {
      name: 'Domuz Binici', emoji: '🐗', cost: 4, type: 'troop', rarity: 'rare', count: 1,
      hp: 1697, dmg: 318, hit: 1.6, range: 0.8, speed: 2.0, targets: 'buildings', r: 0.5, mass: 5,
      jump: true,
      desc: 'Sadece binalara saldırır ve nehrin üzerinden atlar. Çok hızlı!'
    },
    fireball: {
      name: 'Ateş Topu', emoji: '🔥', cost: 4, type: 'spell', rarity: 'rare',
      radius: 2.5, dmg: 689, towerPct: 0.35, speed: 12, knock: true,
      desc: 'Orta alanda yüksek hasar verir ve hafif birlikleri geri iter.'
    },
    freeze: {
      name: 'Dondurma', emoji: '❄️', cost: 4, type: 'spell', rarity: 'epic',
      radius: 3, dmg: 115, towerPct: 0.35, freeze: 4, speed: 0,
      desc: 'Alandaki düşman birlik ve kuleleri 4 saniye dondurur.'
    },
    poison: {
      name: 'Zehir', emoji: '☣️', cost: 4, type: 'spell', rarity: 'epic',
      radius: 3.5, dmg: 0, dps: 91, dur: 8, towerPct: 0.35, speed: 0,
      desc: '8 saniye boyunca alandaki düşmanlara sürekli hasar verir.'
    },

    // ---------- 5 iksir ----------
    giant: {
      name: 'Dev', emoji: '🗿', cost: 5, type: 'troop', rarity: 'rare', count: 1,
      hp: 4091, dmg: 254, hit: 1.5, range: 0.8, speed: 0.75, targets: 'buildings', r: 0.75, mass: 18,
      desc: 'Çok dayanıklı tank. Sadece binalara ve kulelere saldırır.'
    },
    wizard: {
      name: 'Büyücü', emoji: '🧙', cost: 5, type: 'troop', rarity: 'rare', count: 1,
      hp: 755, dmg: 281, hit: 1.4, range: 5.5, speed: 1.0, targets: 'all', r: 0.45, mass: 3,
      proj: 12, projFx: 'fire', splash: 1.5,
      desc: 'Alan hasarlı ateş topları fırlatır. Hava ve kara hedeflerine vurur.'
    },
    prince: {
      name: 'Prens', emoji: '🏇', cost: 5, type: 'troop', rarity: 'epic', count: 1,
      hp: 1920, dmg: 392, hit: 1.4, range: 1.2, speed: 1.0, targets: 'ground', r: 0.55, mass: 8,
      charge: true,
      desc: 'Bir süre koşunca hücuma geçer: iki kat hızlanır, ilk vuruşu iki kat hasar verir.'
    },
    barbarians: {
      name: 'Barbarlar', emoji: '🧔', cost: 5, type: 'troop', rarity: 'common', count: 5,
      hp: 670, dmg: 192, hit: 1.4, range: 0.7, speed: 1.0, targets: 'ground', r: 0.45, mass: 4,
      desc: 'Beş kaba saba barbar. Sağlam ve kalabalık.'
    },
    balloon: {
      name: 'Balon', emoji: '🎈', cost: 5, type: 'troop', rarity: 'epic', count: 1,
      hp: 1679, dmg: 798, hit: 3.0, range: 0.6, speed: 1.25, targets: 'buildings', air: true, r: 0.6, mass: 6,
      deathDmg: { r: 2, dmg: 272 },
      desc: 'Uçarak binalara dev bombalar bırakır. Düşerken de patlar.'
    },
    inferno: {
      name: 'Cehennem Kulesi', emoji: '🌋', cost: 5, type: 'building', rarity: 'rare',
      hp: 1749, ramp: [35, 120, 420], hit: 0.4, range: 6, targets: 'all', r: 0.9, lifetime: 30,
      desc: 'Aynı hedefe vurdukça hasarı katlanarak artar. Tankları eritir.'
    },
    gobhut: {
      name: 'Goblin Kulübesi', emoji: '🛖', cost: 5, type: 'building', rarity: 'rare',
      hp: 1200, r: 0.9, lifetime: 40, spawn: { key: 'speargob', n: 1, every: 4.5 },
      desc: 'Her birkaç saniyede bir mızraklı goblin çıkarır.'
    },

    // ---------- 6+ iksir ----------
    rocket: {
      name: 'Roket', emoji: '🚀', cost: 6, type: 'spell', rarity: 'rare',
      radius: 2, dmg: 1484, towerPct: 0.35, speed: 7, knock: true,
      desc: 'Küçük bir alana devasa hasar verir. Kule bitirmek için ideal.'
    },
    golem: {
      name: 'Golem', emoji: '⛰️', cost: 8, type: 'troop', rarity: 'epic', count: 1,
      hp: 5100, dmg: 312, hit: 2.5, range: 0.8, speed: 0.75, targets: 'buildings', r: 0.9, mass: 30,
      deathDmg: { r: 2, dmg: 312 }, deathSpawn: { key: 'golemite', n: 2 },
      desc: 'Devasa taş canavar. Ölünce patlar ve iki küçük golem çıkar.'
    },

    // ---------- Destede olmayan (yardımcı) birimler ----------
    golemite: {
      name: 'Golemcik', emoji: '🪨', cost: 0, type: 'troop', rarity: 'common', count: 1, hidden: true,
      hp: 1000, dmg: 64, hit: 2.5, range: 0.8, speed: 0.75, targets: 'buildings', r: 0.55, mass: 10,
      deathDmg: { r: 1.5, dmg: 64 },
      desc: ''
    }
  };

  // Kule istatistikleri
  const TOWERS = {
    princess: { name: 'Prenses Kulesi', hp: 2534, dmg: 90, hit: 0.8, range: 7.5, r: 1.5, proj: 18, projFx: 'arrow', targets: 'all' },
    king: { name: 'Kral Kulesi', hp: 4008, dmg: 100, hit: 1.0, range: 7, r: 2.0, proj: 14, projFx: 'ball', targets: 'all' }
  };

  const DECK_KEYS = Object.keys(CARDS).filter(k => !CARDS[k].hidden);
  // Ağ paketlerinde kısaltma için sabit sıra
  const ALL_KEYS = Object.keys(CARDS).concat(['princess', 'king']);
  const KEY_INDEX = {};
  ALL_KEYS.forEach((k, i) => { KEY_INDEX[k] = i; });

  const DEFAULT_DECK = ['knight', 'archers', 'giant', 'musketeer', 'fireball', 'zap', 'minions', 'valkyrie'];

  const RARITY = {
    common: { name: 'Sıradan', color: '#9fb3c8' },
    rare: { name: 'Nadir', color: '#f0a33a' },
    epic: { name: 'Destansı', color: '#b25cff' },
    legendary: { name: 'Efsanevi', color: '#3ee0c8' }
  };

  for (const k of Object.keys(CARDS)) CARDS[k].key = k;

  const api = { CARDS, TOWERS, DECK_KEYS, ALL_KEYS, KEY_INDEX, DEFAULT_DECK, RARITY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TA = Object.assign(root.TA || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
