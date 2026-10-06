/* Taç Arena — sentezlenmiş ses efektleri (dosya gerektirmez) */
(function (root) {
  'use strict';
  const TA = root.TA;
  let ctx = null, master = null, noiseBuf = null;
  let enabled = true;
  const last = {};

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ctx = null; }
  }

  function tone(freq, dur, type, vol, slideTo, delay) {
    const t = ctx.currentTime + (delay || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.3, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, freq, delay) {
    const t = ctx.currentTime + (delay || 0);
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq || 1200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol || 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + dur + 0.02);
  }

  const SFX = {
    click() { tone(660, 0.06, 'triangle', 0.15); },
    deploy() { tone(520, 0.12, 'sine', 0.25, 260); noise(0.08, 0.08, 2000); },
    spell() { noise(0.25, 0.25, 900); tone(200, 0.25, 'sawtooth', 0.08, 80); },
    zap() { noise(0.15, 0.3, 4000); tone(1200, 0.12, 'square', 0.06, 300); },
    hit() { noise(0.05, 0.08, 1800); },
    boom() { noise(0.35, 0.35, 500); tone(110, 0.3, 'sine', 0.3, 40); },
    tower() { noise(0.9, 0.5, 400); tone(90, 0.8, 'sine', 0.45, 30); tone(60, 0.9, 'triangle', 0.3, 25, 0.05); },
    poor() { tone(220, 0.12, 'square', 0.1, 180); },
    start() { tone(392, 0.18, 'triangle', 0.25); tone(523, 0.18, 'triangle', 0.25, null, 0.18); tone(784, 0.35, 'triangle', 0.3, null, 0.36); },
    win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.28, 'triangle', 0.3, null, i * 0.14)); },
    lose() { [440, 392, 330, 262].forEach((f, i) => tone(f, 0.3, 'sine', 0.28, null, i * 0.18)); },
    emote() { tone(880, 0.08, 'sine', 0.15); tone(1320, 0.1, 'sine', 0.12, null, 0.07); },
    match() { tone(660, 0.12, 'square', 0.12); tone(990, 0.2, 'square', 0.12, null, 0.12); },
    tick() { tone(1000, 0.04, 'square', 0.06); }
  };

  TA.Audio = {
    init,
    get enabled() { return enabled; },
    set enabled(v) { enabled = !!v; },
    play(name) {
      if (!enabled || !ctx || !SFX[name]) return;
      const now = performance.now();
      const gap = name === 'hit' ? 70 : 40;
      if (last[name] && now - last[name] < gap) return;
      last[name] = now;
      try { SFX[name](); } catch (e) { /* yoksay */ }
    }
  };
})(window);
