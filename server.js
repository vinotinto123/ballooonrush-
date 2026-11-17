// Balloon Rush — server del bot Telegram + API del gioco
// Node.js 18+, nessuna dipendenza da installare.
// Avvio:  BOT_TOKEN=xxx WEBAPP_URL=https://tuo-indirizzo node server.js

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Sim = require('./public/sim.js');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || '';
const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_PATH || path.join(__dirname, 'db.json');
if (!BOT_TOKEN) { console.error('❌ Manca la variabile BOT_TOKEN'); process.exit(1); }

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const PUBLIC = path.join(__dirname, 'public');
const BETS = [10, 50, 100, 500];
const START_CHIPS = 1000, DAILY_BONUS = 500;

/* ---------- database su file ---------- */
let db = { users: {}, challenges: {} };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch (e) {}
let saveT;
const saveDb = () => { clearTimeout(saveT); saveT = setTimeout(() => fs.writeFile(DB_FILE, JSON.stringify(db), () => {}), 300); };
const today = () => new Date().toISOString().slice(0, 10);
const week = () => Math.floor((Date.now() / 864e5 + 3) / 7);
const rounds = new Map(); // partite in corso (in memoria)
setInterval(() => { const lim = Date.now() - 10 * 60e3; for (const [k, r] of rounds) if (r.startedAt < lim) rounds.delete(k); }, 60e3);

/* ---------- Telegram ---------- */
async function tgApi(method, body) {
  const r = await fetch(`${API}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json(); if (!j.ok) throw new Error(`${method}: ${j.description}`); return j.result;
}
// Verifica che la richiesta arrivi davvero da Telegram (firma di initData)
function auth(initData) {
  if (!initData) return null;
  const p = new URLSearchParams(initData); const hash = p.get('hash'); if (!hash) return null; p.delete('hash');
  const dcs = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calc = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  if (calc.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  if (Date.now() / 1000 - Number(p.get('auth_date')) > 86400) return null;
  const u = JSON.parse(p.get('user') || 'null'); if (!u) return null;
  const id = String(u.id);
  if (!db.users[id]) db.users[id] = { chips: START_CHIPS, best: 0, day: today(), wk: week(), wkBest: 0, name: '' };
  const user = db.users[id];
  user.name = (u.first_name || 'Player').slice(0, 24);
  return { id, user };
}

/* ---------- API del gioco ---------- */
const routes = {
  '/api/me': (a) => {
    let daily = 0;
    if (a.user.day !== today()) { a.user.day = today(); a.user.chips += DAILY_BONUS; daily = DAILY_BONUS; }
    saveDb();
    return { chips: a.user.chips, best: a.user.best, daily };
  },
  '/api/start': (a, b) => {
    const bet = Number(b.bet);
    if (!BETS.includes(bet)) throw 'Invalid bet';
    if (a.user.chips < bet) throw 'Not enough coins';
    for (const [k, r] of rounds) if (r.user === a.id) rounds.delete(k); // una partita alla volta
    let seed = crypto.randomInt(0, 2 ** 32 - 1), challenge = null;
    if (b.challenge && db.challenges[b.challenge]) { challenge = b.challenge; seed = db.challenges[challenge].seed; }
    a.user.chips -= bet; saveDb();
    const roundId = crypto.randomBytes(9).toString('base64url');
    rounds.set(roundId, { user: a.id, seed, bet, startedAt: Date.now(), done: false, challenge });
    return { roundId, seed, chips: a.user.chips };
  },
  '/api/end': (a, b) => {
    const r = rounds.get(b.roundId);
    if (!r || r.user !== a.id || r.done) throw 'Invalid round';
    r.done = true;
    let win = 0, mult = 0;
    const inputs = Array.isArray(b.inputs) ? b.inputs : [];
    const okInputs = inputs.length <= 8000 && inputs.every(x => Array.isArray(x) && Number.isInteger(x[0]) && x[0] >= 0 && x[0] <= Sim.MAX_TICKS && Number.isInteger(x[1]) && Math.abs(x[1]) <= 6);
    const cashTick = b.cashTick;
    if (okInputs && Number.isInteger(cashTick) && cashTick > 0 && cashTick <= Sim.MAX_TICKS) {
      const realMs = Date.now() - r.startedAt;
      const fairTime = realMs >= (cashTick * 1000 / 60) * 0.85;          // niente "acceleratori"
      if (fairTime && !Sim.replay(r.seed, inputs, cashTick).dead) {     // il server rigioca la partita
        mult = Sim.mult(cashTick); win = Math.floor(r.bet * mult);
        a.user.chips += win; a.user.best = Math.max(a.user.best, mult);
        if (a.user.wk !== week()) { a.user.wk = week(); a.user.wkBest = 0; }
        a.user.wkBest = Math.max(a.user.wkBest, mult);
        r.cashTick = cashTick; r.mult = mult;
      }
    }
    saveDb();
    return { chips: a.user.chips, win, mult, best: a.user.best };
  },
  '/api/challenge': (a, b) => {
    const r = rounds.get(b.roundId);
    if (!r || r.user !== a.id || !r.mult) throw 'You can only challenge on a cashed-out round';
    const id = crypto.randomBytes(6).toString('base64url');
    db.challenges[id] = { seed: r.seed, cashTick: r.cashTick, mult: r.mult, name: a.user.name, by: a.id, at: Date.now() };
    saveDb();
    return { id };
  },
  '/api/challenge/get': (a, b) => {
    const c = db.challenges[b.id]; if (!c) return null;
    return { id: b.id, cashTick: c.cashTick, mult: c.mult, name: c.name };
  },
  '/api/top': (a) => {
    const w = week();
    const list = Object.entries(db.users).filter(([, u]) => u.wk === w && u.wkBest > 0)
      .sort((x, y) => y[1].wkBest - x[1].wkBest);
    const top = list.slice(0, 10).map(([id, u]) => ({ name: u.name, mult: u.wkBest, isMe: id === a.id }));
    const idx = list.findIndex(([id]) => id === a.id);
    return { top, me: idx >= 0 ? { rank: idx + 1, mult: list[idx][1].wkBest } : null };
  },
};

const readBody = req => new Promise((res, rej) => {
  let d = ''; req.on('data', c => { d += c; if (d.length > 3e5) req.destroy(); });
  req.on('end', () => { try { res(JSON.parse(d || '{}')); } catch (e) { rej(e); } }); req.on('error', rej);
});
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.end();
  const url = req.url.split('?')[0];
  try {
    if (req.method === 'POST' && routes[url]) {
      const body = await readBody(req);
      const a = auth(body.initData);
      if (!a) return json(res, 401, { error: 'Open the game from Telegram' });
      try { return json(res, 200, routes[url](a, body)); }
      catch (e) { return json(res, 400, { error: typeof e === 'string' ? e : 'Error' }); }
    }
    let file = decodeURIComponent(url); if (file === '/') file = '/index.html';
    const full = path.join(PUBLIC, path.normalize(file));
    if (!full.startsWith(PUBLIC) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  } catch (e) { console.error(e); json(res, 500, { error: 'Server error' }); }
}).listen(PORT, () => console.log(`🎈 Balloon Rush attivo sulla porta ${PORT}`));

/* ---------- Bot: risponde ai messaggi (long polling) ---------- */
async function onUpdate(u) {
  const msg = u.message; if (!msg || !msg.text) return;
  if (msg.text.startsWith('/start')) {
    await tgApi('sendMessage', {
      chat_id: msg.chat.id,
      text: '🎈 *Balloon Rush*\n\nBet your coins, fly your balloon higher and cash out before it pops.\nFree coins every day. Challenge your friends on the same run!',
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🎮 Play now', web_app: { url: WEBAPP_URL } }]] },
    });
  } else if (msg.text.startsWith('/help')) {
    await tgApi('sendMessage', { chat_id: msg.chat.id, text: 'Tap left or right to steer, hit CASH OUT whenever you want. Coins are virtual and have no monetary value.' });
  }
}
let offset = 0;
(async function poll() {
  await tgApi('deleteWebhook', {}).catch(() => {});
  try { await tgApi('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Play', web_app: { url: WEBAPP_URL } } }); } catch (e) { console.error(e.message); }
  for (;;) {
    try {
      const ups = await tgApi('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
      for (const u of ups) { offset = u.update_id + 1; onUpdate(u).catch(e => console.error(e.message)); }
    } catch (e) { console.error(e.message); await new Promise(r => setTimeout(r, 3000)); }
  }
})();
