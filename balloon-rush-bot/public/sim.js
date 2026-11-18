/* Balloon Rush — logica di gioco deterministica.
 * Lo STESSO file gira nel browser (per disegnare la partita) e sul server
 * (per verificare il risultato). Usa solo + - * / e Math.imul/abs/floor,
 * così il risultato è identico su ogni dispositivo.
 */
(function (root) {
  const W = 360;            // larghezza del mondo
  const R = 18;             // raggio della mongolfiera
  const RISE = 2;           // salita per tick (60 tick = 1 secondo)
  const IMPULSE = 2.6;      // spinta laterale di un tocco
  const DAMP = 0.93;        // attrito laterale
  const MAX_TICKS = 60 * 180;

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // moltiplicatore in base al tempo di volo: 10s≈x2.4 · 20s≈x5 · 30s≈x9.8 · 60s≈x27
  function mult(tick) {
    const t = tick / 60;
    return Math.floor((1 + 0.08 * t + 0.006 * t * t) * 100) / 100;
  }

  function create(seed) {
    const s = { r: rng(seed), tick: 0, x: W / 2, vx: 0, alt: 0, obs: [], winds: [], nextY: 420, dead: false };
    generate(s, 900);
    return s;
  }

  function generate(s, upTo) {
    while (s.nextY < upTo) {
      const lvl = Math.min(1, s.nextY / 12000); // difficoltà 0 → 1 in ~100 s
      if (s.nextY > 1500 && s.r() < 0.18) {
        const dir = s.r() < 0.5 ? -1 : 1;
        const h = 160 + s.r() * 120;
        s.winds.push({ y0: s.nextY, y1: s.nextY + h, f: dir * (0.10 + 0.12 * lvl) });
      }
      const n = s.r() < 0.35 + 0.4 * lvl ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const cloud = s.r() < 0.5;
        const r = cloud ? 22 + s.r() * 14 : 14 + s.r() * 6;
        const moving = s.r() < 0.2 + 0.5 * lvl;
        s.obs.push({
          y: s.nextY + s.r() * 40, x: 20 + s.r() * (W - 40), r,
          amp: moving ? 40 + s.r() * 80 : 0,
          spd: 1 + Math.floor(s.r() * 3), ph: Math.floor(s.r() * 200),
          type: cloud ? 'cloud' : 'bird'
        });
      }
      s.nextY += 230 - 110 * lvl + s.r() * 60;
    }
  }

  function obsX(o, tick) {
    if (!o.amp) return o.x;
    const v = (tick * o.spd + o.ph) % 200;
    return o.x + o.amp * (Math.abs(v - 100) / 100 - 0.5) * 2;
  }

  function step(s, dir) {
    if (s.dead) return;
    if (dir) s.vx += dir * IMPULSE;
    for (const w of s.winds) if (s.alt >= w.y0 && s.alt <= w.y1) s.vx += w.f;
    s.vx *= DAMP;
    s.x += s.vx;
    if (s.x < R) { s.x = R; s.vx = -s.vx * 0.5; }
    if (s.x > W - R) { s.x = W - R; s.vx = -s.vx * 0.5; }
    s.tick++;
    s.alt = s.tick * RISE;
    generate(s, s.alt + 900);
    if (s.obs.length && s.obs[0].y < s.alt - 300) s.obs = s.obs.filter(o => o.y >= s.alt - 300);
    if (s.winds.length && s.winds[0].y1 < s.alt - 300) s.winds = s.winds.filter(w => w.y1 >= s.alt - 300);
    for (const o of s.obs) {
      const dy = o.y - s.alt;
      if (dy > 60 || dy < -60) continue;
      const dx = obsX(o, s.tick) - s.x;
      const rr = (o.r + R) * 0.82; // un po' di tolleranza: i quasi-scontri sono divertenti
      if (dx * dx + dy * dy < rr * rr) { s.dead = true; return; }
    }
  }

  // Rigioca una partita: inputs = [[tick, direzione], ...]
  function replay(seed, inputs, endTick) {
    const byTick = new Map();
    for (const [t, d] of inputs) byTick.set(t, (byTick.get(t) || 0) + d);
    const s = create(seed);
    while (s.tick < endTick) {
      step(s, byTick.get(s.tick) || 0);
      if (s.dead) return { dead: true, tick: s.tick };
    }
    return { dead: false, tick: s.tick };
  }

  const API = { W, R, RISE, MAX_TICKS, create, generate, step, obsX, mult, replay };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.BalloonSim = API;
})(this);
