/* Esegue il JS inline di index.html in un DOM finto: serve solo a scoprire
 * errori di runtime al caricamento (elementi mancanti, funzioni undefined).
 * Non e' un test di rendering.
 */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
const inline = html.match(/<script>([\s\S]*?)<\/script>/)[1];

/* ---------- DOM finto ---------- */
const ids = [...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
const els = {};
function mkEl(id) {
  const e = {
    id, textContent: '', innerHTML: '', value: '', disabled: false, style: {}, dataset: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { on === undefined ? (this._s.has(c) ? this._s.delete(c) : this._s.add(c)) : (on ? this._s.add(c) : this._s.delete(c)); },
      contains(c) { return this._s.has(c); } },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, focus() {}, blur() {},
    querySelectorAll: () => [], querySelector: () => mkEl('sub'),
    getBoundingClientRect: () => ({ width: 390, height: 844, top: 0, left: 0 }),
    setAttribute() {}, getAttribute: () => null, closest: () => null, remove() {}
  };
  return e;
}
ids.forEach(id => els[id] = mkEl(id));

const ctxProxy = new Proxy({}, {
  get: (t, k) => {
    if (k === 'canvas') return { width: 390, height: 844 };
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (k === 'measureText') return () => ({ width: 10 });
    if (typeof k === 'string' && ['fillStyle', 'strokeStyle', 'lineWidth', 'font', 'globalAlpha',
      'shadowBlur', 'shadowColor', 'lineCap', 'textAlign', 'lineJoin'].includes(k)) return t[k];
    return () => {};
  },
  set: (t, k, v) => { t[k] = v; return true; }
});

const canvas = mkEl('c');
canvas.width = 390; canvas.height = 844;
canvas.getContext = () => ctxProxy;
els['c'] = canvas;

const document = {
  getElementById: id => els[id] || null,
  querySelector: sel => mkEl('q'),
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  createElement: tag => mkEl(tag),
  body: mkEl('body'), documentElement: mkEl('html'), head: mkEl('head'),
  visibilityState: 'visible', hidden: false
};

const errors = [];
const win = {
  document, innerWidth: 390, innerHeight: 844, devicePixelRatio: 2,
  addEventListener() {}, removeEventListener() {},
  requestAnimationFrame: () => 1, cancelAnimationFrame() {},
  setInterval: () => 0, clearInterval() {}, setTimeout: fn => { try { fn(); } catch (e) { errors.push(e); } return 0; },
  clearTimeout() {}, matchMedia: () => ({ matches: false, addListener() {} }),
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
  navigator: { language: 'it-IT', userAgent: 'node', clipboard: { writeText: async () => {} } },
  location: { search: '', href: 'http://localhost/', reload() {} },
  performance: { now: () => Date.now() },
  fetch: async () => ({ ok: true, status: 200, json: async () => ({ balance: 5, played: 0, lang: 'it', chain: 'Solana', status: 'idle', claim: 0 }) }),
  open: () => null, alert: () => {}, console,
  URLSearchParams, TextEncoder, Promise, Math, Date, JSON, Number, String, Object, Array, RegExp, Error
};
win.window = win;
win.self = win;
win.globalThis = win;

/* carica i18n e wallets nel contesto finto */
const run = (src, name) => {
  try { new Function('window', 'document', 'navigator', 'fetch', 'requestAnimationFrame', 'setInterval',
    'setTimeout', 'clearInterval', 'localStorage', 'performance', 'location', 'innerWidth', 'innerHeight',
    'devicePixelRatio', 'self', 'console',
    src.replace(/\}\)\(this\);/g, '})(window);'))
    (win, document, win.navigator, win.fetch, win.requestAnimationFrame, win.setInterval,
     win.setTimeout, win.clearInterval, win.localStorage, win.performance, win.location,
     390, 844, 2, win, console);
  } catch (e) { errors.push(new Error(name + ': ' + e.message)); }
};

run(fs.readFileSync(path.join(__dirname, 'public/i18n.js'), 'utf8'), 'i18n.js');
run(fs.readFileSync(path.join(__dirname, 'public/wallets.js'), 'utf8'), 'wallets.js');
run(fs.readFileSync(path.join(__dirname, 'public/sim.js'), 'utf8'), 'sim.js');

if (process.env.STATE) win.localStorage._d['br_v2'] = process.env.STATE;  // stato di partenza simulato

try {
  new Function('window', 'document', 'navigator', 'fetch', 'requestAnimationFrame', 'setInterval',
    'setTimeout', 'clearInterval', 'localStorage', 'performance', 'location', 'innerWidth', 'innerHeight',
    'devicePixelRatio', 'self', 'console', 'Telegram', 'I18N', 'Wallets', 'addEventListener', 'removeEventListener',
    inline)(win, document, win.navigator, win.fetch, win.requestAnimationFrame, win.setInterval,
    win.setTimeout, win.clearInterval, win.localStorage, win.performance, win.location,
    390, 844, 2, win, console, undefined, win.I18N, win.Wallets, win.addEventListener, win.removeEventListener);
} catch (e) {
  errors.push(new Error('inline: ' + e.message + '\n  ' + (e.stack || '').split('\n')[1]));
}

(async () => {
  await new Promise(r => setImmediate(r));   // lascia risolvere le promise del boot
  await new Promise(r => setImmediate(r));
  if (errors.length) {
    console.log('❌ ' + errors.length + ' errore/i:');
    errors.forEach(e => console.log('  - ' + e.message));
    process.exit(1);
  }
  console.log('✅ nessun errore di runtime al caricamento');
  console.log('   id collegati:', Object.keys(els).length, '| chiavi i18n it:', Object.keys(win.I18N.DICT.it).length);
  console.log('   CTA lobby:', JSON.stringify(els['play'].textContent), '| nota:', JSON.stringify(els['freeNote'].textContent));
  console.log('   saldo:', JSON.stringify(els['bal'].textContent), '| contatore online:', els['onlineN'].textContent);
  console.log('   feed:', els['feed'].innerHTML.replace(/\s+/g, ' ').slice(0, 120));
  console.log('   chip ricarica:', els['tuChips'].innerHTML.replace(/\s+/g, ' ').slice(0, 120));
})();
