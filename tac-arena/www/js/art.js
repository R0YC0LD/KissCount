/* Taç Arena — vektör karakter çizimleri ve animasyonları
 * Tüm karakterler kodla çizilir (resim dosyası yok). Koordinatlar "birim" cinsindendir:
 * orijin karakterin ayak ortası, yukarı negatif y. 1 birim ≈ 1 karo.
 *
 * drawUnit(ctx, key, x, y, u, pose)
 *   pose: { t, walk, moving, atk (0..1 veya -1), face (1 ön / -1 arka), flip (1/-1), team: 'me'|'op',
 *           frozen, sleeping, alpha }
 */
(function (root) {
  'use strict';
  const TA = root.TA;

  const OUT = '#231c33';
  const TEAMS = {
    me: { main: '#3b82f6', dark: '#1d4ed8', light: '#93c5fd', deep: '#172b6b', glow: '#7cc4ff' },
    op: { main: '#e5484d', dark: '#b4232a', light: '#fca5a5', deep: '#5c1015', glow: '#ff8a7a' }
  };
  const SKIN = '#f4c7a1', SKIN_D = '#d9a07a';
  const GOB = '#7cc24a', GOB_D = '#4f8a2a';
  const BONE = '#f1efe6', BONE_D = '#bdb8a6';
  const STEEL = '#c9d1dc', STEEL_D = '#7d8796';
  const GOLD = '#ffc531', GOLD_D = '#c98a06';
  const WOOD = '#9a6434', WOOD_D = '#6b421f';

  // ---------- temel şekiller (birim uzayında) ----------
  let LW = 0.04;
  function path(c, fill, stroke) {
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke !== false) { c.lineWidth = LW; c.strokeStyle = stroke || OUT; c.stroke(); }
  }
  function circ(c, x, y, r, fill, stroke) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); path(c, fill, stroke); }
  function ell(c, x, y, rx, ry, fill, stroke, rot) { c.beginPath(); c.ellipse(x, y, rx, ry, rot || 0, 0, Math.PI * 2); path(c, fill, stroke); }
  function rrect(c, x, y, w, h, r, fill, stroke) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
    path(c, fill, stroke);
  }
  function poly(c, pts, fill, stroke) {
    c.beginPath(); c.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
    c.closePath(); path(c, fill, stroke);
  }
  function seg(c, x1, y1, x2, y2, w, color, outline) {
    c.lineCap = 'round';
    if (outline !== false) { c.strokeStyle = OUT; c.lineWidth = w + LW * 2; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); }
    c.strokeStyle = color; c.lineWidth = w; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  }
  function shine(c, x, y, rx, ry) { c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.ellipse(x, y, rx, ry, -0.5, 0, Math.PI * 2); c.fill(); }

  const MELEE_TILT = { sword: 1, bigsword: 1, axe: 1, hammer: 1, dagger: 1, club: 1 };
  const lerp = (a, b, k) => a + (b - a) * k;
  const clamp01 = k => Math.max(0, Math.min(1, k));
  // Yakın dövüş vuruş açısı: geri kalkış → ileri savuruş → dinlenme
  function swing(atk, rest) {
    if (atk < 0) return rest;
    if (atk < 0.45) return lerp(rest, -2.3, atk / 0.45);
    if (atk < 0.7) return lerp(-2.3, 1.5, (atk - 0.45) / 0.25);
    return lerp(1.5, rest, (atk - 0.7) / 0.3);
  }

  // ---------- yüz ----------
  function face(c, x, y, r, P, opts) {
    if (P.face < 0) return;
    opts = opts || {};
    const ey = y - r * 0.05, ex = r * 0.38;
    if (P.sleeping || P.frozen) {
      c.strokeStyle = OUT; c.lineWidth = LW * 0.9; c.lineCap = 'round';
      c.beginPath(); c.moveTo(x - ex - r * 0.12, ey); c.lineTo(x - ex + r * 0.12, ey); c.moveTo(x + ex - r * 0.12, ey); c.lineTo(x + ex + r * 0.12, ey); c.stroke();
    } else {
      const er = r * (opts.eye || 0.13);
      c.fillStyle = opts.eyeColor || '#fff';
      c.beginPath(); c.ellipse(x - ex, ey, er, er * 1.2, 0, 0, Math.PI * 2); c.ellipse(x + ex, ey, er, er * 1.2, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = opts.pupil || '#1d1a2b';
      c.beginPath(); c.arc(x - ex + er * 0.25, ey + er * 0.15, er * 0.6, 0, Math.PI * 2); c.arc(x + ex + er * 0.25, ey + er * 0.15, er * 0.6, 0, Math.PI * 2); c.fill();
      if (opts.angry) {
        c.strokeStyle = OUT; c.lineWidth = LW; c.beginPath();
        c.moveTo(x - ex - er * 1.3, ey - er * 2.0); c.lineTo(x - ex + er * 1.1, ey - er * 1.2);
        c.moveTo(x + ex + er * 1.3, ey - er * 2.0); c.lineTo(x + ex - er * 1.1, ey - er * 1.2); c.stroke();
      }
    }
    if (opts.mouth !== false) {
      c.strokeStyle = OUT; c.lineWidth = LW * 0.8; c.beginPath();
      if (P.atk >= 0 && !opts.calm) c.ellipse(x + r * 0.05, y + r * 0.42, r * 0.14, r * 0.1, 0, 0, Math.PI * 2);
      else c.arc(x + r * 0.05, y + r * 0.3, r * 0.18, 0.3, Math.PI - 0.3);
      c.stroke();
    }
  }

  // ---------- silahlar (el noktasında, kol yönünde) ----------
  function weapon(c, kind, team, P) {
    switch (kind) {
      case 'sword':
        rrect(c, -0.05, 0.02, 0.1, 0.05, 0.02, GOLD_D);
        poly(c, [-0.035, 0.06, 0.035, 0.06, 0.03, 0.5, 0, 0.56, -0.03, 0.5], STEEL);
        seg(c, 0, 0.1, 0, 0.48, 0.012, '#fff', false);
        break;
      case 'bigsword':
        rrect(c, -0.07, 0.02, 0.14, 0.06, 0.02, GOLD_D);
        poly(c, [-0.05, 0.07, 0.05, 0.07, 0.05, 0.62, 0, 0.7, -0.05, 0.62], STEEL);
        break;
      case 'axe':
        seg(c, 0, -0.08, 0, 0.55, 0.05, WOOD);
        c.beginPath(); c.moveTo(0, 0.38); c.quadraticCurveTo(0.26, 0.3, 0.24, 0.56); c.quadraticCurveTo(0.12, 0.5, 0, 0.52); c.closePath(); path(c, STEEL);
        c.beginPath(); c.moveTo(0, 0.38); c.quadraticCurveTo(-0.26, 0.3, -0.24, 0.56); c.quadraticCurveTo(-0.12, 0.5, 0, 0.52); c.closePath(); path(c, STEEL);
        break;
      case 'spear':
        seg(c, 0, -0.35, 0, 0.6, 0.04, WOOD);
        poly(c, [-0.05, 0.58, 0.05, 0.58, 0, 0.78], STEEL);
        break;
      case 'lance':
        seg(c, 0, -0.3, 0, 0.95, 0.06, team.light);
        poly(c, [-0.09, 0.2, 0.09, 0.2, 0.03, 0.98, -0.03, 0.98], team.main);
        rrect(c, -0.1, 0.12, 0.2, 0.08, 0.03, GOLD);
        break;
      case 'dagger':
        poly(c, [-0.03, 0.04, 0.03, 0.04, 0, 0.28], STEEL);
        break;
      case 'hammer':
        seg(c, 0, -0.05, 0, 0.5, 0.05, WOOD);
        rrect(c, -0.14, 0.4, 0.28, 0.18, 0.04, '#8a8f99');
        break;
      case 'club':
        c.beginPath(); c.moveTo(-0.03, 0); c.lineTo(0.03, 0); c.lineTo(0.08, 0.45); c.quadraticCurveTo(0, 0.55, -0.08, 0.45); c.closePath(); path(c, WOOD);
        break;
      case 'bow': {
        const pull = P.atk >= 0 ? Math.sin(Math.PI * clamp01(P.atk * 1.4)) : 0;
        c.lineCap = 'round';
        for (const [w, col] of [[0.08, OUT], [0.045, WOOD]]) {
          c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(-0.32, 0.1); c.quadraticCurveTo(0, 0.55, 0.32, 0.1); c.stroke();
        }
        const sy0 = 0.1 - 0.2 * pull;
        c.strokeStyle = '#eee'; c.lineWidth = 0.015; c.beginPath(); c.moveTo(-0.32, 0.1); c.lineTo(0, sy0); c.lineTo(0.32, 0.1); c.stroke();
        if (pull > 0.1) { seg(c, 0, sy0, 0, sy0 + 0.5, 0.025, WOOD_D, false); poly(c, [-0.04, sy0 + 0.48, 0.04, sy0 + 0.48, 0, sy0 + 0.58], STEEL, false); }
        break;
      }
      case 'musket':
        rrect(c, -0.05, -0.1, 0.1, 0.3, 0.03, WOOD);
        rrect(c, -0.025, 0.15, 0.05, 0.55, 0.02, '#4b4f5a');
        if (P.atk >= 0 && P.atk < 0.25) { circ(c, 0, 0.78, 0.09 * (1 - P.atk * 3), '#ffd25a', false); circ(c, 0, 0.78, 0.05, '#fff', false); }
        break;
      case 'staff':
        seg(c, 0, -0.3, 0, 0.5, 0.045, WOOD_D);
        circ(c, 0, -0.34, 0.07, team.glow);
        break;
      case 'bomb': {
        circ(c, 0, 0.15, 0.16, '#2b2b36');
        shine(c, -0.05, 0.1, 0.05, 0.03);
        seg(c, 0.08, 0.02, 0.15, -0.08, 0.025, '#c9a35a', false);
        const fl = 0.04 + Math.sin(P.t * 30) * 0.015;
        circ(c, 0.16, -0.1, fl, '#ffb02e', false);
        break;
      }
      case 'fist':
        circ(c, 0, 0.02, 0.1, P.skin || SKIN);
        break;
      case 'shield':
        c.beginPath(); c.moveTo(-0.17, -0.18); c.lineTo(0.17, -0.18); c.lineTo(0.15, 0.08); c.quadraticCurveTo(0, 0.24, -0.15, 0.08); c.closePath(); path(c, team.main);
        c.beginPath(); c.moveTo(0, -0.14); c.lineTo(0, 0.15); c.moveTo(-0.12, -0.04); c.lineTo(0.12, -0.04); c.strokeStyle = GOLD; c.lineWidth = 0.04; c.stroke();
        break;
    }
  }

  // ---------- insansı karakter ----------
  // o: { scale, skin, body, legs, head(fn), weapon, offhand, armRest, ranged, belt, cape, boots, seated, wide }
  function humanoid(c, P, o) {
    const team = P.T;
    const mv = P.moving ? 1 : 0;
    const sw = Math.sin(P.walk) * mv;
    const bob = mv ? Math.abs(Math.cos(P.walk)) * 0.045 : Math.sin(P.t * 2.4 + (P.seed || 0)) * 0.012;
    const wide = o.wide || 1;
    const skin = o.skin || SKIN;
    c.save();
    c.translate(0, -bob);
    const hipY = -0.38, shY = -0.76;
    // bacaklar
    if (!o.seated) {
      const legC = o.legs || '#4a3b5c';
      for (const side of [-1, 1]) {
        c.save();
        c.translate(side * 0.1 * wide, hipY);
        c.rotate(sw * 0.55 * side);
        rrect(c, -0.065, 0, 0.13, 0.32, 0.05, legC);
        ell(c, 0.015, 0.33, 0.085, 0.05, o.boots || '#3a2a1a');
        c.restore();
      }
    }
    // kolun açısı (silah kolu)
    let armA;
    if (o.ranged) armA = P.atk >= 0 ? 1.35 - Math.sin(Math.min(1, P.atk * 2) * Math.PI) * 0.15 : (o.armRest != null ? o.armRest : 0.25) - sw * 0.3;
    else armA = swing(P.atk, (o.armRest != null ? o.armRest : 0.35) - sw * 0.35);
    const offA = 0.3 + sw * 0.35;
    // ang > 0: kol ileri (karakterin baktığı yöne) döner
    const drawArm = (side, ang, item) => {
      c.save();
      c.translate(side * 0.23 * wide, shY);
      c.rotate(-ang);
      rrect(c, -0.06, -0.02, 0.12, 0.3, 0.05, o.sleeve || o.body || team.main);
      circ(c, 0, 0.3, 0.07, skin);
      if (item) {
        c.translate(0, 0.3);
        if (MELEE_TILT[item]) c.rotate(-0.45);
        weapon(c, item, team, P);
      }
      c.restore();
    };
    // pelerin
    if (o.cape) {
      c.beginPath(); c.moveTo(-0.22 * wide, shY); c.lineTo(0.22 * wide, shY);
      c.lineTo(0.3 * wide + sw * 0.03, -0.18); c.quadraticCurveTo(0, -0.1, -0.3 * wide + sw * 0.03, -0.18); c.closePath();
      path(c, o.cape === true ? team.dark : o.cape);
    }
    // arkadaki kol (kalkan / boş el)
    if (P.face >= 0) drawArm(-1, offA, o.offhand);
    else drawArm(1, armA, o.weapon);
    // gövde
    rrect(c, -0.23 * wide, shY - 0.06, 0.46 * wide, 0.46, 0.13, o.body || team.main);
    if (o.armor) { rrect(c, -0.17 * wide, shY, 0.34 * wide, 0.26, 0.08, o.armor); shine(c, -0.07, shY + 0.07, 0.07, 0.04); }
    if (o.belt !== false) rrect(c, -0.23 * wide, hipY - 0.07, 0.46 * wide, 0.07, 0.02, o.belt || '#4a3324', OUT);
    if (o.emblem) circ(c, 0, shY + 0.13, 0.06, o.emblem);
    // baş
    const hy = shY - 0.25, hr = o.headR || 0.24;
    if (o.head) o.head(c, 0, hy, hr, P, team);
    else { circ(c, 0, hy, hr, skin); face(c, 0, hy, hr, P); }
    // öndeki kol
    if (P.face >= 0) drawArm(1, armA, o.weapon);
    else drawArm(-1, offA, o.offhand);
    c.restore();
  }

  // ---------- kafa/saç stilleri ----------
  const heads = {
    knight(c, x, y, r, P) {
      circ(c, x, y, r, SKIN);
      face(c, x, y + 0.02, r, P);
      if (P.face >= 0) { c.fillStyle = '#7a4a24'; c.beginPath(); c.ellipse(x - 0.07, y + 0.08, 0.08, 0.03, 0.3, 0, Math.PI * 2); c.ellipse(x + 0.07, y + 0.08, 0.08, 0.03, -0.3, 0, Math.PI * 2); c.fill(); }
      c.beginPath(); c.arc(x, y - 0.02, r * 1.04, Math.PI, 0); c.lineTo(x + r * 1.04, y - 0.02); path(c, STEEL);
      rrect(c, x - 0.025, y - 0.03, 0.05, 0.12, 0.02, STEEL_D);
      shine(c, x - 0.08, y - 0.13, 0.06, 0.03);
    },
    archer(c, x, y, r, P, T) {
      ell(c, x + 0.2, y + 0.05, 0.08, 0.2, '#ff6fa8', OUT, -0.4);
      circ(c, x, y, r, SKIN);
      face(c, x, y + 0.03, r, P);
      c.beginPath(); c.arc(x, y - 0.01, r * 1.05, Math.PI * 1.02, Math.PI * 1.98); c.quadraticCurveTo(x, y - r * 0.4, x - r * 1.03, y); path(c, '#ff6fa8');
      if (P.face < 0) circ(c, x, y, r * 0.98, '#ff6fa8');
      rrect(c, x - r * 0.9, y - r * 0.75, r * 1.8, r * 0.18, 0.03, T.main);
    },
    musketeer(c, x, y, r, P) {
      circ(c, x, y, r, SKIN);
      face(c, x, y + 0.03, r, P);
      ell(c, x - 0.14, y + 0.12, 0.08, 0.14, '#8e4fd1');
      ell(c, x, y - 0.12, r * 1.45, r * 0.32, STEEL);
      c.beginPath(); c.arc(x, y - 0.12, r * 0.85, Math.PI, 0); path(c, STEEL);
      poly(c, [x - 0.03, y - 0.3, x + 0.03, y - 0.3, x, y - 0.42], STEEL_D);
      shine(c, x - 0.08, y - 0.2, 0.06, 0.03);
    },
    wizard(c, x, y, r, P, T) {
      circ(c, x, y, r, SKIN);
      face(c, x, y + 0.04, r, P);
      ell(c, x, y - 0.08, r * 1.4, r * 0.3, T.dark);
      c.beginPath(); c.moveTo(x - r * 0.9, y - 0.1); c.quadraticCurveTo(x - 0.05, y - 0.5, x + 0.18 + Math.sin(P.t * 3) * 0.03, y - 0.62); c.quadraticCurveTo(x + 0.1, y - 0.3, x + r * 0.9, y - 0.1); c.closePath(); path(c, T.main);
      rrect(c, x - r * 0.88, y - 0.17, r * 1.76, 0.07, 0.02, GOLD);
      ell(c, x, y + 0.2, 0.12, 0.1, '#ece6da');
    },
    valkyrie(c, x, y, r, P) {
      for (const s of [-1, 1]) ell(c, x + s * 0.24, y + 0.18, 0.07, 0.17, '#ff8a1f', OUT, s * 0.3);
      circ(c, x, y, r, SKIN);
      face(c, x, y + 0.03, r, P);
      c.beginPath(); c.arc(x, y - 0.01, r * 1.06, Math.PI * 1.0, Math.PI * 2.0); c.quadraticCurveTo(x + 0.05, y - r * 0.5, x - r * 1.05, y); path(c, '#ff8a1f');
      if (P.face < 0) circ(c, x, y, r, '#ff8a1f');
    },
    barbarian(c, x, y, r, P) {
      circ(c, x, y, r, SKIN);
      face(c, x, y - 0.01, r, P, { angry: true });
      if (P.face >= 0) { c.fillStyle = '#f2c94c'; c.strokeStyle = OUT; c.lineWidth = LW; c.beginPath(); c.moveTo(x - 0.17, y + 0.06); c.quadraticCurveTo(x, y + 0.02, x + 0.17, y + 0.06); c.quadraticCurveTo(x + 0.2, y + 0.22, x + 0.1, y + 0.13); c.quadraticCurveTo(x, y + 0.1, x - 0.1, y + 0.13); c.quadraticCurveTo(x - 0.2, y + 0.22, x - 0.17, y + 0.06); c.fill(); c.stroke(); }
      for (const s of [-1, 1]) { c.beginPath(); c.moveTo(x + s * 0.18, y - 0.12); c.quadraticCurveTo(x + s * 0.42, y - 0.2, x + s * 0.36, y - 0.42); c.quadraticCurveTo(x + s * 0.3, y - 0.24, x + s * 0.1, y - 0.2); c.closePath(); path(c, '#f4efe2'); }
      c.beginPath(); c.arc(x, y - 0.03, r * 1.03, Math.PI, 0); path(c, '#9aa1ad');
      rrect(c, x - r * 1.05, y - 0.07, r * 2.1, 0.07, 0.02, '#7d8796');
    },
    prince(c, x, y, r, P, T) {
      circ(c, x, y, r, SKIN);
      face(c, x, y + 0.03, r, P);
      c.beginPath(); c.arc(x, y - 0.02, r * 1.05, Math.PI, 0); path(c, GOLD);
      poly(c, [x - 0.04, y - 0.25, x + 0.04, y - 0.25, x + 0.02, y - 0.06, x - 0.02, y - 0.06], GOLD_D);
      c.beginPath(); c.moveTo(x, y - 0.25); c.quadraticCurveTo(x - 0.25 - Math.sin(P.t * 8) * 0.04, y - 0.45, x - 0.38, y - 0.25); c.quadraticCurveTo(x - 0.18, y - 0.32, x, y - 0.2); path(c, T.main);
      rrect(c, x - 0.14, y - 0.02, 0.28, 0.05, 0.02, GOLD_D);
    },
    goblin(c, x, y, r, P, T, hood) {
      for (const s of [-1, 1]) poly(c, [x + s * r * 0.75, y - 0.05, x + s * r * 2.1, y - 0.2 + Math.sin(P.t * 6 + s) * 0.02, x + s * r * 0.8, y + 0.1], GOB);
      circ(c, x, y, r, GOB);
      face(c, x, y + 0.02, r, P, { angry: true, eye: 0.16, eyeColor: '#fff6b0' });
      if (P.face >= 0) { poly(c, [x - 0.02, y + 0.03, x + 0.1, y + 0.1, x - 0.02, y + 0.11], '#6aae3c'); }
      if (hood) { c.beginPath(); c.arc(x, y, r * 1.08, Math.PI * 1.05, Math.PI * 1.95); c.quadraticCurveTo(x + 0.1, y - r * 1.6, x - r * 1.04, y - r * 0.3); path(c, T.main); }
      else { poly(c, [x - 0.08, y - r * 0.95, x, y - r * 1.4, x + 0.08, y - r * 0.95], '#3b2a1a'); }
    },
    skull(c, x, y, r, P) {
      circ(c, x, y, r, BONE);
      rrect(c, x - r * 0.55, y + r * 0.5, r * 1.1, r * 0.55, r * 0.2, BONE);
      if (P.face >= 0) {
        c.fillStyle = '#231c33';
        c.beginPath(); c.ellipse(x - r * 0.38, y + 0.0, r * 0.25, r * 0.3, 0, 0, Math.PI * 2); c.ellipse(x + r * 0.38, y, r * 0.25, r * 0.3, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = P.T.glow; c.beginPath(); c.arc(x - r * 0.38, y + 0.02, r * 0.09, 0, Math.PI * 2); c.arc(x + r * 0.38, y + 0.02, r * 0.09, 0, Math.PI * 2); c.fill();
        c.strokeStyle = OUT; c.lineWidth = LW * 0.7; c.beginPath();
        for (let i = -1; i <= 1; i++) { c.moveTo(x + i * r * 0.2, y + r * 0.55); c.lineTo(x + i * r * 0.2, y + r * 0.95); }
        c.stroke();
      }
    },
    hogrider(c, x, y, r, P) {
      circ(c, x, y, r, SKIN_D);
      face(c, x, y + 0.03, r, P, { angry: true });
      poly(c, [x - 0.06, y - r * 0.85, x + 0.06, y - r * 0.85, x + 0.03, y - r * 1.55, x - 0.03, y - r * 1.55], '#2b2b36');
      if (P.face >= 0) { c.fillStyle = '#3b2a1a'; c.fillRect(x - 0.12, y + 0.08, 0.24, 0.04); }
    },
    robot(c, x, y, r, P, T) {
      rrect(c, x - r, y - r, r * 2, r * 2, r * 0.45, '#3d4352');
      for (const s of [-1, 1]) { c.beginPath(); c.moveTo(x + s * r * 0.7, y - r * 0.8); c.quadraticCurveTo(x + s * r * 1.5, y - r * 1.2, x + s * r * 1.2, y - r * 1.9); c.quadraticCurveTo(x + s * r * 1.05, y - r * 1.25, x + s * r * 0.35, y - r * 0.95); c.closePath(); path(c, '#d9d9d9'); }
      if (P.face >= 0) {
        rrect(c, x - r * 0.75, y - r * 0.2, r * 1.5, r * 0.4, r * 0.15, '#111');
        const g = P.atk >= 0 ? '#fff' : T.glow;
        c.fillStyle = g; c.beginPath(); c.arc(x - r * 0.35, y, r * 0.13, 0, Math.PI * 2); c.arc(x + r * 0.35, y, r * 0.13, 0, Math.PI * 2); c.fill();
      }
      shine(c, x - r * 0.4, y - r * 0.55, r * 0.3, r * 0.12);
    },
    giant(c, x, y, r, P) {
      circ(c, x, y, r, SKIN);
      face(c, x, y + 0.02, r, P, { angry: P.atk >= 0 });
      c.beginPath(); c.arc(x, y + 0.04, r * 0.95, 0.15 * Math.PI, 0.85 * Math.PI); c.lineTo(x - r * 0.4, y + r * 0.75); c.quadraticCurveTo(x, y + r * 1.2, x + r * 0.4, y + r * 0.75); c.closePath();
      if (P.face >= 0) path(c, '#d9762b');
      c.beginPath(); c.arc(x, y - 0.02, r * 1.0, Math.PI * 1.1, Math.PI * 1.9); c.lineTo(x, y - r * 0.6); c.closePath(); path(c, '#d9762b');
    },
    princess(c, x, y, r, P, T) {
      ell(c, x, y + 0.12, r * 1.15, r * 1.0, '#ffd0e8');
      circ(c, x, y, r, SKIN);
      face(c, x, y + 0.04, r, P);
      c.beginPath(); c.arc(x, y - 0.01, r * 1.06, Math.PI * 1.0, Math.PI * 2.0); c.quadraticCurveTo(x, y - r * 0.3, x - r * 1.05, y); path(c, '#ffd0e8');
      poly(c, [x - 0.12, y - r * 0.85, x - 0.08, y - r * 1.25, x - 0.03, y - r * 1.0, x, y - r * 1.35, x + 0.03, y - r * 1.0, x + 0.08, y - r * 1.25, x + 0.12, y - r * 0.85], GOLD);
    },
    king(c, x, y, r, P, T) {
      circ(c, x, y, r, SKIN);
      face(c, x, y - 0.01, r, P, { calm: true });
      c.beginPath(); c.arc(x, y + 0.05, r * 0.98, 0.1 * Math.PI, 0.9 * Math.PI); c.lineTo(x - r * 0.5, y + r * 0.9); c.quadraticCurveTo(x, y + r * 1.5, x + r * 0.5, y + r * 0.9); c.closePath(); path(c, '#f4f1ea');
      if (P.face >= 0) { c.fillStyle = '#e8e2d4'; c.beginPath(); c.ellipse(x - 0.08, y + 0.08, 0.1, 0.04, 0.2, 0, Math.PI * 2); c.ellipse(x + 0.08, y + 0.08, 0.1, 0.04, -0.2, 0, Math.PI * 2); c.fill(); }
      poly(c, [x - r, y - r * 0.55, x - r * 1.05, y - r * 1.45, x - r * 0.5, y - r * 0.95, x, y - r * 1.6, x + r * 0.5, y - r * 0.95, x + r * 1.05, y - r * 1.45, x + r, y - r * 0.55], GOLD);
      circ(c, x, y - r * 1.0, r * 0.13, T.main);
      shine(c, x - r * 0.5, y - r * 0.9, r * 0.2, r * 0.07);
    }
  };

  // ---------- binekler ----------
  function hog(c, P, T) {
    const mv = P.moving ? 1 : 0, ph = P.walk;
    const bob = mv ? Math.abs(Math.sin(ph)) * 0.06 : 0;
    c.save(); c.translate(0, -bob);
    for (const [lx, o] of [[-0.28, 0], [0.28, Math.PI], [-0.14, Math.PI], [0.36, 0]]) {
      const a = Math.sin(ph + o) * 0.6 * mv;
      c.save(); c.translate(lx, -0.22); c.rotate(a); rrect(c, -0.05, 0, 0.1, 0.22, 0.04, '#9c5a4a'); c.restore();
    }
    ell(c, 0, -0.42, 0.48, 0.27, '#c97b63');
    ell(c, -0.05, -0.32, 0.3, 0.12, '#e3a08a', false);
    // kafa
    ell(c, 0.42, -0.45, 0.2, 0.18, '#c97b63');
    ell(c, 0.58, -0.42, 0.08, 0.07, '#e8a08e');
    poly(c, [0.5, -0.36, 0.62, -0.26, 0.48, -0.32], '#fff');
    circ(c, 0.45, -0.52, 0.03, '#231c33', false);
    poly(c, [0.32, -0.58, 0.36, -0.75, 0.42, -0.6], '#9c5a4a');
    rrect(c, -0.3, -0.7, 0.4, 0.1, 0.04, T.main);
    c.restore();
    return -0.66 - bob;
  }
  function horse(c, P, T) {
    const mv = P.moving ? 1 : 0, ph = P.walk;
    const bob = mv ? Math.abs(Math.sin(ph)) * 0.07 : 0;
    c.save(); c.translate(0, -bob);
    for (const [lx, o] of [[-0.32, 0], [0.32, Math.PI], [-0.18, Math.PI], [0.42, 0]]) {
      const a = Math.sin(ph + o) * 0.7 * mv;
      c.save(); c.translate(lx, -0.36); c.rotate(a); rrect(c, -0.05, 0, 0.1, 0.36, 0.04, '#7a4a2a'); ell(c, 0, 0.36, 0.06, 0.03, '#2b2b36'); c.restore();
    }
    ell(c, 0, -0.56, 0.52, 0.26, '#a8683a');
    // eyer örtüsü
    c.beginPath(); c.moveTo(-0.3, -0.75); c.lineTo(0.25, -0.75); c.lineTo(0.3, -0.42); c.lineTo(-0.35, -0.42); c.closePath(); path(c, T.main);
    rrect(c, -0.32, -0.48, 0.64, 0.05, 0.02, GOLD, false);
    // boyun + baş
    poly(c, [0.32, -0.7, 0.52, -1.0, 0.68, -0.92, 0.5, -0.55], '#a8683a');
    ell(c, 0.66, -0.94, 0.17, 0.11, '#a8683a', OUT, 0.5);
    circ(c, 0.66, -0.99, 0.025, '#231c33', false);
    poly(c, [0.46, -1.0, 0.36, -0.8, 0.5, -0.85], '#3b2a1a');
    c.beginPath(); c.moveTo(-0.5, -0.6); c.quadraticCurveTo(-0.75, -0.55 + Math.sin(P.t * 6) * 0.05, -0.68, -0.3); path(c, null); c.strokeStyle = '#3b2a1a'; c.lineWidth = 0.08; c.stroke();
    c.restore();
    return -0.78 - bob;
  }

  // ---------- özel yaratıklar ----------
  function skeleton(c, P, T, item) {
    const mv = P.moving ? 1 : 0, sw = Math.sin(P.walk) * mv;
    const bob = mv ? Math.abs(Math.cos(P.walk)) * 0.04 : 0;
    c.save(); c.translate(0, -bob);
    for (const s of [-1, 1]) { c.save(); c.translate(s * 0.08, -0.33); c.rotate(sw * 0.6 * s); seg(c, 0, 0, 0, 0.3, 0.055, BONE); c.restore(); }
    // kaburga
    rrect(c, -0.16, -0.66, 0.32, 0.3, 0.1, BONE);
    c.strokeStyle = BONE_D; c.lineWidth = 0.03; c.beginPath();
    for (let i = 0; i < 3; i++) { c.moveTo(-0.12, -0.6 + i * 0.08); c.lineTo(0.12, -0.6 + i * 0.08); }
    c.stroke();
    rrect(c, -0.15, -0.4, 0.3, 0.06, 0.02, T.main);
    // kollar
    const armA = item === 'bomb' ? (P.atk >= 0 ? swing(P.atk, 0.6) : 0.6) : swing(P.atk, 0.3 - sw * 0.4);
    c.save(); c.translate(-0.18, -0.62); c.rotate(0.3 + sw * 0.4); seg(c, 0, 0, 0, 0.26, 0.045, BONE); c.restore();
    heads.skull(c, 0, -0.85, 0.2, P);
    c.save(); c.translate(0.18, -0.62); c.rotate(-armA); seg(c, 0, 0, 0, 0.26, 0.045, BONE);
    c.translate(0, 0.27); weapon(c, item || 'sword', T, P); c.restore();
    c.restore();
  }

  function giantBody(c, P, T) {
    humanoid(c, P, {
      body: '#8a5a3a', armor: null, sleeve: SKIN, legs: '#6b4a2a', belt: T.main, emblem: GOLD,
      head: heads.giant, weapon: 'fist', offhand: 'fist', armRest: 0.2, wide: 1.25, headR: 0.25
    });
  }

  function golem(c, P, T, small) {
    const mv = P.moving ? 1 : 0, sw = Math.sin(P.walk) * mv;
    const bob = mv ? Math.abs(Math.cos(P.walk)) * 0.04 : 0;
    const rock = small ? '#8b8f9c' : '#7b7f8c', rockD = '#5a5e6b';
    c.save(); c.translate(0, -bob);
    for (const s of [-1, 1]) { c.save(); c.translate(s * 0.2, -0.35); c.rotate(sw * 0.4 * s); rrect(c, -0.13, 0, 0.26, 0.36, 0.08, rockD); c.restore(); }
    // gövde
    c.beginPath(); c.moveTo(-0.45, -0.4); c.lineTo(-0.5, -0.9); c.lineTo(-0.25, -1.1); c.lineTo(0.25, -1.12); c.lineTo(0.5, -0.92); c.lineTo(0.45, -0.4); c.lineTo(0, -0.3); c.closePath(); path(c, rock);
    // parlayan çatlaklar
    c.strokeStyle = T.glow; c.lineWidth = 0.05; c.lineCap = 'round'; c.beginPath();
    c.moveTo(-0.2, -0.95); c.lineTo(-0.08, -0.75); c.lineTo(-0.2, -0.55); c.moveTo(0.18, -1.0); c.lineTo(0.1, -0.8); c.lineTo(0.24, -0.6); c.stroke();
    const armA = swing(P.atk, 0.1 - sw * 0.25);
    for (const s of [-1, 1]) {
      c.save(); c.translate(s * 0.52, -0.95); c.rotate(s > 0 ? -armA : 0.1 + sw * 0.25);
      rrect(c, -0.13, -0.05, 0.26, 0.42, 0.1, rock); circ(c, 0, 0.42, 0.16, rockD);
      c.restore();
    }
    // kafa
    rrect(c, -0.22, -1.38, 0.44, 0.32, 0.1, rock);
    if (P.face >= 0) { c.fillStyle = T.glow; c.fillRect(-0.14, -1.25, 0.09, 0.05); c.fillRect(0.05, -1.25, 0.09, 0.05); }
    shine(c, -0.2, -1.0, 0.12, 0.05);
    c.restore();
  }

  function balloon(c, P, T) {
    const sway = Math.sin(P.t * 2) * 0.05;
    c.save(); c.rotate(sway * 0.3);
    // ipler
    c.strokeStyle = '#5a4630'; c.lineWidth = 0.025;
    c.beginPath(); c.moveTo(-0.2, -0.25); c.lineTo(-0.38, -0.75); c.moveTo(0.2, -0.25); c.lineTo(0.38, -0.75); c.stroke();
    // sepet
    rrect(c, -0.24, -0.32, 0.48, 0.26, 0.05, WOOD);
    c.strokeStyle = WOOD_D; c.lineWidth = 0.02; c.beginPath(); c.moveTo(-0.24, -0.2); c.lineTo(0.24, -0.2); c.stroke();
    if (P.atk >= 0 && P.atk < 0.5) circ(c, 0, -0.05 + P.atk * 0.6, 0.11, '#2b2b36');
    else circ(c, 0, -0.34, 0.1, '#2b2b36');
    // balon
    ell(c, 0, -1.15, 0.55, 0.5, T.main);
    c.strokeStyle = T.dark; c.lineWidth = 0.03; c.beginPath(); c.ellipse(0, -1.15, 0.22, 0.5, 0, 0, Math.PI * 2); c.moveTo(0, -1.65); c.lineTo(0, -0.65); c.stroke();
    // kafatası amblemi
    circ(c, 0, -1.15, 0.15, BONE, false);
    c.fillStyle = '#231c33'; c.beginPath(); c.arc(-0.055, -1.16, 0.04, 0, Math.PI * 2); c.arc(0.055, -1.16, 0.04, 0, Math.PI * 2); c.fill();
    shine(c, -0.25, -1.4, 0.12, 0.08);
    c.restore();
  }

  function dragon(c, P, T) {
    const flap = Math.sin(P.t * 9);
    c.save();
    for (const s of [-1, 1]) {
      c.save(); c.translate(s * 0.18, -0.7); c.rotate(s * (0.4 + flap * 0.35));
      c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(s * 0.5, -0.45, s * 0.68, -0.1); c.quadraticCurveTo(s * 0.45, -0.05, s * 0.5, 0.15); c.quadraticCurveTo(s * 0.25, 0.05, 0, 0.12); c.closePath(); path(c, '#3aa86b');
      c.restore();
    }
    // kuyruk
    c.beginPath(); c.moveTo(-0.15, -0.35); c.quadraticCurveTo(-0.45, -0.2, -0.5, -0.45 + Math.sin(P.t * 4) * 0.05); path(c, null); c.strokeStyle = '#2f8a57'; c.lineWidth = 0.1; c.lineCap = 'round'; c.stroke();
    ell(c, 0, -0.52, 0.3, 0.26, '#4cc483');
    ell(c, 0.02, -0.46, 0.17, 0.16, '#f6d77a', false);
    rrect(c, -0.2, -0.76, 0.4, 0.06, 0.03, T.main);
    // kafa
    circ(c, 0.05, -0.92, 0.25, '#4cc483');
    ell(c, 0.15, -0.82, 0.14, 0.09, '#5bd493');
    for (const s of [-1, 1]) poly(c, [0.05 + s * 0.1, -1.1, 0.05 + s * 0.2, -1.32, 0.05 + s * 0.03, -1.15], '#f4efe2');
    face(c, 0.05, -0.95, 0.25, P, { mouth: false });
    if (P.atk >= 0 && P.atk < 0.4) { circ(c, 0.2, -0.75, 0.1 + P.atk * 0.2, 'rgba(255,150,40,0.85)', false); circ(c, 0.2, -0.75, 0.06, '#ffe08a', false); }
    c.restore();
  }

  function minion(c, P, T) {
    const flap = Math.sin(P.t * 14);
    for (const s of [-1, 1]) {
      c.save(); c.translate(s * 0.14, -0.6); c.rotate(s * (0.5 + flap * 0.5));
      c.beginPath(); c.moveTo(0, 0); c.lineTo(s * 0.42, -0.25); c.lineTo(s * 0.35, 0); c.lineTo(s * 0.45, 0.08); c.lineTo(0, 0.1); c.closePath(); path(c, '#3a3f8f');
      c.restore();
    }
    ell(c, 0, -0.5, 0.2, 0.22, '#5b7fd9');
    rrect(c, -0.16, -0.42, 0.32, 0.06, 0.02, T.main);
    circ(c, 0, -0.8, 0.2, '#6d8fe8');
    for (const s of [-1, 1]) poly(c, [s * 0.08, -0.94, s * 0.18, -1.12, s * 0.16, -0.9], '#f4efe2');
    face(c, 0, -0.8, 0.2, P, { angry: true, eyeColor: '#fff6b0' });
    // pençe/el
    const a = swing(P.atk, 0.3);
    c.save(); c.translate(0.16, -0.58); c.rotate(-a); seg(c, 0, 0, 0, 0.18, 0.06, '#5b7fd9'); c.restore();
  }

  // ---------- birim tanımları ----------
  const UNITS = {
    knight: { s: 1.0, draw: (c, P) => humanoid(c, P, { head: heads.knight, weapon: 'sword', offhand: 'shield', armor: STEEL, legs: '#4b4f5a', cape: true }) },
    archers: { s: 0.85, draw: (c, P) => humanoid(c, P, { head: heads.archer, weapon: 'bow', ranged: true, legs: '#3b6b3b', boots: '#5a3a1a' }) },
    musketeer: { s: 0.92, draw: (c, P) => humanoid(c, P, { head: heads.musketeer, weapon: 'musket', ranged: true, armor: STEEL, legs: '#4a3b5c' }) },
    wizard: {
      s: 0.92, draw: (c, P) => {
        humanoid(c, P, { head: heads.wizard, weapon: 'staff', ranged: true, legs: P.T.deep, cape: P.T.dark, body: P.T.dark, sleeve: P.T.main });
        if (P.atk >= 0 && P.atk < 0.5) { const k = P.atk / 0.5; circ(c, 0.35, -0.9, 0.08 + k * 0.1, 'rgba(255,140,40,0.8)', false); circ(c, 0.35, -0.9, 0.05 + k * 0.05, '#ffe08a', false); }
      }
    },
    valkyrie: { s: 1.0, draw: (c, P) => humanoid(c, P, { head: heads.valkyrie, weapon: 'axe', armRest: 0.6, armor: '#c9a35a', legs: '#6b4a2a', wide: 1.1 }) },
    barbarians: { s: 0.98, draw: (c, P) => humanoid(c, P, { head: heads.barbarian, weapon: 'sword', body: SKIN, sleeve: SKIN, legs: '#7a4a24', belt: P.T.main, wide: 1.12 }) },
    minirobot: { s: 0.95, draw: (c, P) => humanoid(c, P, { head: heads.robot, weapon: 'bigsword', body: '#3d4352', sleeve: '#3d4352', armor: '#5a6172', legs: '#2b2f3a', emblem: P.T.glow, headR: 0.22, wide: 1.1 }) },
    prince: {
      s: 1.0, draw: (c, P) => {
        const sy0 = horse(c, P, P.T);
        c.save(); c.translate(-0.05, sy0 + 0.35); c.scale(0.85, 0.85);
        humanoid(c, P, { head: heads.prince, weapon: 'lance', armRest: P.charge ? 1.45 : 0.9, armor: GOLD, seated: true, cape: true });
        c.restore();
      }
    },
    hog: {
      s: 1.0, draw: (c, P) => {
        const sy0 = hog(c, P, P.T);
        c.save(); c.translate(-0.05, sy0 + 0.33); c.scale(0.8, 0.8);
        humanoid(c, P, { head: heads.hogrider, weapon: 'hammer', body: SKIN_D, sleeve: SKIN_D, belt: P.T.main, seated: true, wide: 1.1 });
        c.restore();
      }
    },
    goblins: { s: 0.78, draw: (c, P) => humanoid(c, P, { skin: GOB, head: (c2, x, y, r, P2, T) => heads.goblin(c2, x, y, r, P2, T, false), weapon: 'dagger', legs: '#5a3a1a', body: '#8a5a2a', sleeve: GOB, belt: P.T.main }) },
    speargob: { s: 0.78, draw: (c, P) => humanoid(c, P, { skin: GOB, head: (c2, x, y, r, P2, T) => heads.goblin(c2, x, y, r, P2, T, true), weapon: 'spear', ranged: true, legs: '#5a3a1a', body: P.T.main, sleeve: GOB }) },
    skeletons: { s: 0.82, draw: (c, P) => skeleton(c, P, P.T, 'sword') },
    skarmy: { s: 0.8, draw: (c, P) => skeleton(c, P, P.T, 'sword') },
    bomber: { s: 0.85, draw: (c, P) => skeleton(c, P, P.T, 'bomb') },
    giant: { s: 1.45, draw: (c, P) => giantBody(c, P, P.T) },
    golem: { s: 1.35, draw: (c, P) => golem(c, P, P.T, false) },
    golemite: { s: 0.8, draw: (c, P) => golem(c, P, P.T, true) },
    balloon: { s: 1.05, draw: (c, P) => balloon(c, P, P.T) },
    babydragon: { s: 1.0, draw: (c, P) => dragon(c, P, P.T) },
    minions: { s: 0.85, draw: (c, P) => minion(c, P, P.T) },
    // kulelerin üstündeki karakterler
    t_princess: { s: 0.85, draw: (c, P) => humanoid(c, P, { head: heads.princess, weapon: 'bow', ranged: true, body: P.T.main, legs: P.T.dark, sleeve: P.T.light, belt: GOLD }) },
    t_king: { s: 1.0, draw: (c, P) => humanoid(c, P, { head: heads.king, weapon: 'fist', offhand: 'fist', body: P.T.main, sleeve: P.T.main, legs: P.T.deep, cape: '#7a1f2a', belt: GOLD, emblem: GOLD, wide: 1.2, headR: 0.26 }) }
  };

  function makePose(p) {
    return {
      t: p.t || 0, walk: p.walk || 0, moving: !!p.moving, atk: p.atk == null ? -1 : p.atk,
      face: p.face == null ? 1 : p.face, flip: p.flip || 1, T: TEAMS[p.team || 'me'],
      frozen: !!p.frozen, sleeping: !!p.sleeping, seed: p.seed || 0, charge: !!p.charge
    };
  }

  // x, y: ekran (ayak noktası), u: 1 karonun piksel boyutu
  function drawUnit(c, key, x, y, u, pose) {
    const def = UNITS[key];
    if (!def) return;
    const P = makePose(pose || {});
    const s = u * def.s;
    c.save();
    c.translate(x, y);
    c.scale(s * P.flip, s);
    LW = 0.045;
    c.lineJoin = 'round';
    def.draw(c, P);
    c.restore();
  }

  // ---------- binalar ----------
  function drawBuilding(c, key, x, y, u, pose) {
    const P = makePose(pose || {});
    const T = P.T;
    c.save(); c.translate(x, y); c.scale(u, u); LW = 0.045; c.lineJoin = 'round';
    if (key === 'cannon') {
      // ahşap platform
      poly(c, [-0.8, -0.1, 0.8, -0.1, 0.65, -0.45, -0.65, -0.45], WOOD);
      poly(c, [-0.8, -0.1, 0.8, -0.1, 0.8, 0.05, -0.8, 0.05], WOOD_D);
      rrect(c, -0.75, -0.18, 1.5, 0.08, 0.03, T.main, false);
      // namlu
      const aim = P.aim || 0;
      const rec = P.atk >= 0 && P.atk < 0.3 ? (0.3 - P.atk) * 0.5 : 0;
      c.save(); c.translate(0, -0.55); c.rotate(aim);
      rrect(c, -0.16, -0.1 + rec, 0.32, 0.75, 0.12, '#3a3f4b');
      rrect(c, -0.2, 0.5 + rec, 0.4, 0.14, 0.05, '#2b2f3a');
      shine(c, -0.07, 0.15, 0.04, 0.2);
      c.restore();
      for (const s of [-1, 1]) circ(c, s * 0.42, -0.35, 0.2, WOOD_D), circ(c, s * 0.42, -0.35, 0.07, '#3a3f4b');
    } else if (key === 'inferno') {
      poly(c, [-0.55, 0, 0.55, 0, 0.42, -1.3, -0.42, -1.3], '#6b6f7c');
      poly(c, [-0.55, 0, 0.55, 0, 0.55, 0.08, -0.55, 0.08], '#4a4e5a');
      c.strokeStyle = '#4a4e5a'; c.lineWidth = 0.03; c.beginPath();
      for (let i = 1; i < 4; i++) { c.moveTo(-0.52 + i * 0.03, -i * 0.32); c.lineTo(0.52 - i * 0.03, -i * 0.32); }
      c.stroke();
      rrect(c, -0.5, -0.5, 1.0, 0.1, 0.03, T.main);
      const g = 0.18 + Math.sin(P.t * 6) * 0.03 + (P.atk >= 0 ? 0.06 : 0);
      circ(c, 0, -1.48, g * 1.6, 'rgba(255,120,30,0.35)', false);
      poly(c, [0, -1.85, 0.2, -1.48, 0, -1.2, -0.2, -1.48], '#ff6a2a');
      poly(c, [0, -1.75, 0.1, -1.48, 0, -1.3, -0.1, -1.48], '#ffd25a', false);
      for (const s of [-1, 1]) poly(c, [s * 0.42, -1.3, s * 0.3, -1.6, s * 0.2, -1.3], '#4a4e5a');
    } else if (key === 'gobhut') {
      poly(c, [-0.7, 0, 0.7, 0, 0.6, -0.65, -0.6, -0.65], WOOD);
      c.strokeStyle = WOOD_D; c.lineWidth = 0.03; c.beginPath();
      for (let i = -2; i <= 2; i++) { c.moveTo(i * 0.25, 0); c.lineTo(i * 0.22, -0.65); }
      c.stroke();
      rrect(c, -0.16, -0.42, 0.32, 0.42, 0.14, '#2b1d10');
      poly(c, [-0.9, -0.55, 0, -1.45, 0.9, -0.55], '#d6b154');
      c.strokeStyle = '#a8853a'; c.lineWidth = 0.03; c.beginPath();
      for (let i = 0; i < 4; i++) { c.moveTo(-0.7 + i * 0.1, -0.6 - i * 0.18); c.lineTo(0.7 - i * 0.1, -0.6 - i * 0.18); }
      c.stroke();
      seg(c, 0, -1.45, 0, -1.85, 0.04, WOOD_D);
      poly(c, [0, -1.85, 0.32 + Math.sin(P.t * 5) * 0.03, -1.75, 0, -1.65], T.main);
    }
    c.restore();
  }

  // ---------- büyü ikonları ----------
  function drawSpellIcon(c, key, x, y, u, t) {
    t = t || 0;
    c.save(); c.translate(x, y); c.scale(u, u); LW = 0.05; c.lineJoin = 'round';
    switch (key) {
      case 'fireball':
        for (let i = 0; i < 3; i++) poly(c, [-0.3 + i * 0.12, -0.2, -0.75 + i * 0.1, -0.75 + i * 0.15, -0.15 + i * 0.1, -0.35], i % 2 ? '#ffb02e' : '#ff6a2a', false);
        circ(c, 0, 0, 0.42, '#ff6a2a');
        circ(c, 0.05, 0.05, 0.28, '#ffb02e', false);
        circ(c, 0.08, 0.08, 0.14, '#fff2b0', false);
        break;
      case 'zap':
        poly(c, [0.1, -0.7, -0.35, 0.05, -0.02, 0.05, -0.15, 0.7, 0.35, -0.12, 0.02, -0.12, 0.2, -0.7], '#ffe14d');
        poly(c, [0.06, -0.55, -0.22, 0.0, 0.04, 0.0], '#fff', false);
        break;
      case 'arrows':
        for (const [dx, dy] of [[-0.25, 0.1], [0, -0.1], [0.25, 0.1]]) {
          c.save(); c.translate(dx, dy); c.rotate(0.15);
          seg(c, 0, -0.55, 0, 0.35, 0.06, WOOD);
          poly(c, [-0.09, 0.3, 0.09, 0.3, 0, 0.52], STEEL);
          poly(c, [0, -0.55, -0.1, -0.68, -0.1, -0.45, 0, -0.35, 0.1, -0.45, 0.1, -0.68], '#e5484d');
          c.restore();
        }
        break;
      case 'freeze':
        c.strokeStyle = OUT; c.lineWidth = 0.18; c.lineCap = 'round';
        for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3; c.beginPath(); c.moveTo(Math.cos(a) * 0.6, Math.sin(a) * 0.6); c.lineTo(-Math.cos(a) * 0.6, -Math.sin(a) * 0.6); c.stroke(); }
        c.strokeStyle = '#bfefff'; c.lineWidth = 0.1;
        for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3; c.beginPath(); c.moveTo(Math.cos(a) * 0.6, Math.sin(a) * 0.6); c.lineTo(-Math.cos(a) * 0.6, -Math.sin(a) * 0.6); c.stroke(); }
        circ(c, 0, 0, 0.16, '#e6f8ff');
        break;
      case 'poison':
        ell(c, 0, 0.15, 0.4, 0.38, '#5ec43a');
        rrect(c, -0.12, -0.45, 0.24, 0.3, 0.05, '#5ec43a');
        rrect(c, -0.16, -0.58, 0.32, 0.14, 0.04, WOOD);
        circ(c, -0.1, 0.1, 0.07, '#b6f28f', false); circ(c, 0.12, 0.25, 0.05, '#b6f28f', false);
        c.fillStyle = '#231c33'; c.beginPath(); c.arc(-0.08, 0.15, 0.05, 0, 7); c.arc(0.08, 0.15, 0.05, 0, 7); c.fill();
        break;
      case 'rocket':
        c.rotate(0.6);
        poly(c, [0, -0.75, 0.2, -0.4, 0.2, 0.4, -0.2, 0.4, -0.2, -0.4], '#d9dde4');
        poly(c, [0, -0.75, 0.2, -0.4, -0.2, -0.4], '#e5484d');
        for (const s of [-1, 1]) poly(c, [s * 0.2, 0.1, s * 0.4, 0.5, s * 0.2, 0.4], '#e5484d');
        circ(c, 0, -0.1, 0.09, '#5ab0ff');
        poly(c, [-0.14, 0.42, 0.14, 0.42, 0, 0.75 + Math.sin(t * 30) * 0.06], '#ffb02e', false);
        break;
    }
    c.restore();
  }

  // ---------- kart portreleri (dataURL, önbellekli) ----------
  const portraitCache = {};
  function cardArt(key, size) {
    size = size || 160;
    const ck = key + '|' + size;
    if (portraitCache[ck]) return portraitCache[ck];
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = Math.round(size * 1.2);
    const c = cv.getContext('2d');
    const card = TA.CARDS[key];
    const W = cv.width, H = cv.height;
    // arka plan
    const g = c.createRadialGradient(W / 2, H * 0.45, W * 0.1, W / 2, H * 0.5, W * 0.8);
    const bg = { common: ['#6d8bb3', '#2c3d5c'], rare: ['#f0a33a', '#7a3d0a'], epic: ['#b25cff', '#3b1673'], legendary: ['#3ee0c8', '#0a4a50'] }[card.rarity] || ['#6d8bb3', '#2c3d5c'];
    g.addColorStop(0, bg[0]); g.addColorStop(1, bg[1]);
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 6; i++) { c.beginPath(); c.arc(W / 2, H * 0.55, W * (0.2 + i * 0.12), 0, Math.PI * 2); c.fill(); }
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.beginPath(); c.ellipse(W / 2, H * 0.84, W * 0.32, W * 0.07, 0, 0, Math.PI * 2); c.fill();
    const pose = { t: 0.3, team: 'me', face: 1 };
    if (card.type === 'spell') drawSpellIcon(c, key, W / 2, H * 0.48, W * 0.55, 0);
    else if (card.type === 'building') drawBuilding(c, key, W / 2, H * 0.84, W * 0.42, Object.assign({ aim: 0.6 }, pose));
    else {
      const def = UNITS[key];
      const n = Math.min(card.count || 1, key === 'skarmy' ? 5 : 3);
      const PORTRAIT = { giant: 0.36, golem: 0.4, balloon: 0.3, babydragon: 0.5, prince: 0.42, hog: 0.44, minions: 0.55 };
      const base = W * (PORTRAIT[key] || 0.5) / Math.sqrt(def.s) * (n > 1 ? 1 : 1.15);
      const spots = n === 1 ? [[0, 0, 1]] : n === 2 ? [[-0.2, -0.02, 0.85], [0.2, 0.02, 0.9]] : n === 3 ? [[-0.24, -0.04, 0.78], [0.24, -0.04, 0.78], [0, 0.04, 0.9]] : [[-0.3, -0.08, 0.6], [0.3, -0.08, 0.6], [-0.15, -0.02, 0.7], [0.15, -0.02, 0.7], [0, 0.05, 0.8]];
      for (const [dx, dy, sc] of spots) drawUnit(c, key, W / 2 + dx * W, H * (0.84 + dy * 0.6) - (card.air ? H * 0.08 : 0), base * sc, Object.assign({ flip: dx < 0 ? -1 : 1 }, pose));
    }
    const url = cv.toDataURL('image/png');
    portraitCache[ck] = url;
    return url;
  }

  TA.Art = { drawUnit, drawBuilding, drawSpellIcon, cardArt, TEAMS, UNITS };
})(typeof window !== 'undefined' ? window : globalThis);
