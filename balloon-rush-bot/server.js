// Balloon Rush — server del bot Telegram + API della miniapp
// Node.js 18+ (fetch e crypto nativi), nessuna dipendenza da installare.
// Avvio:  node server.js     (legge .env se presente)

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ---------- .env senza dipendenze ---------- */
(() => {
  const f = path.join(__dirname, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim().replace(/^["']|["']$/g, '');
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
})();

const Sim = require('./public/sim.js');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || '';
const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_PATH || path.join(__dirname, 'db.json');
if (!BOT_TOKEN) { console.error('❌ Manca BOT_TOKEN (variabile ambiente o file .env)'); process.exit(1); }
if (!WEBAPP_URL) console.warn('⚠️  Manca WEBAPP_URL: il bottone "Gioca" del bot non funzionerà.');

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const PUBLIC = path.join(__dirname, 'public');

/* ---------- parametri del funnel ---------- */
const DEMO = { bet: 5.00, startBalance: 5.00, minWithdraw: 15.00, autoCash: 3.40, maxTicks: 900, corridor: 40 };

/* ---------- database su file ---------- */
let db = { users: {}, challenges: {} };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch (e) {}
let saveT;
const saveDb = () => { clearTimeout(saveT); saveT = setTimeout(() => fs.writeFile(DB_FILE, JSON.stringify(db), () => {}), 300); };
const week = () => Math.floor((Date.now() / 864e5 + 3) / 7);
const rounds = new Map();
setInterval(() => { const lim = Date.now() - 10 * 60e3; for (const [k, r] of rounds) if (r.startedAt < lim) rounds.delete(k); }, 60e3);

/* ---------- replay con lo stesso corridoio del client ----------
 * Il client limita la mongolfiera a W/2 ± corridor: il server verifica con la
 * STESSA regola, altrimenti un tocco laterale farebbe divergere i due. */
function replayDemo(seed, inputs, endTick) {
  const byTick = new Map();
  for (const [t, d] of inputs) byTick.set(t, (byTick.get(t) || 0) + d);
  const s = Sim.create(seed);
  const lo = Sim.W / 2 - DEMO.corridor, hi = Sim.W / 2 + DEMO.corridor;
  while (s.tick < endTick) {
    Sim.step(s, byTick.get(s.tick) || 0);
    if (s.x < lo) { s.x = lo; s.vx = 0; }
    if (s.x > hi) { s.x = hi; s.vx = 0; }
    if (s.dead) return { dead: true, tick: s.tick };
  }
  return { dead: false, tick: s.tick };
}

/* ---------- seed della demo: corridoio centrale libero ----------
 * Un seed è valido se, per tutti i tick, nessun ostacolo passa a meno di 90 px
 * dal centro. Con corridoio ±40 e raggio di collisione ~44 la partita si vince
 * con qualsiasi input, ma la vincita è vera nel motore e il replay la convalida. */
const DEMO_SAFE_SEED = 54720574;   // precalcolato: boot istantaneo
function seedIsSafe(seed, ticks) {
  const C = Sim.W / 2, NEED = 90;
  const s = Sim.create(seed);
  for (let t = 0; t < ticks; t++) {
    for (const o of s.obs) {
      if (Math.abs(o.y - s.alt) > 250) continue;
      if (Math.abs(Sim.obsX(o, t) - C) < NEED) return false;
    }
    Sim.step(s, 0);
    if (s.dead) return false;
    s.x = C; s.vx = 0;
  }
  return true;
}
function pickDemoSeed() {
  if (seedIsSafe(DEMO_SAFE_SEED, DEMO.maxTicks)) return DEMO_SAFE_SEED;
  for (let i = 0; i < 120000; i++) {
    const seed = crypto.randomInt(0, 2 ** 32 - 1);
    if (seedIsSafe(seed, DEMO.maxTicks)) return seed;
  }
  return DEMO_SAFE_SEED;
}
const DEMO_SEED = pickDemoSeed();

/* ---------- Telegram ---------- */
async function tgApi(method, body) {
  const r = await fetch(`${API}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json(); if (!j.ok) throw new Error(`${method}: ${j.description}`); return j.result;
}
const LANGS = ['it', 'en', 'es', 'pt', 'ru'];
function newUser(lang) {
  return { credit: DEMO.startBalance, played: 0, lang: lang || 'en', chain: 'Solana',
    wallet: null, address: null, status: 'idle', claim: 0, best: 0, wk: week(), wkBest: 0, name: '' };
}
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
  if (!db.users[id]) db.users[id] = newUser((u.language_code || 'en').slice(0, 2));
  const user = db.users[id];
  user.name = (u.first_name || 'Player').slice(0, 24);
  if (user.credit == null) user.credit = DEMO.startBalance;
  return { id, user };
}

/* ---------- API della miniapp ---------- */
const routes = {
  '/api/me': (a) => {
    saveDb();
    return {
      balance: +a.user.credit.toFixed(2),
      played: a.user.played || 0,
      lang: a.user.lang || 'en',
      chain: a.user.chain || 'Solana',
      status: a.user.status || 'idle',
      claim: a.user.claim || 0
    };
  },

  '/api/start': (a) => {
    if ((a.user.played || 0) >= 1) throw 'Already played';   // la prova è una sola, volutamente
    for (const [k, r] of rounds) if (r.user === a.id) rounds.delete(k);
    const roundId = crypto.randomBytes(9).toString('base64url');
    rounds.set(roundId, { user: a.id, seed: DEMO_SEED, bet: DEMO.bet, startedAt: Date.now(), done: false });
    return { roundId, seed: DEMO_SEED, bet: DEMO.bet };
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
      const fairTime = realMs >= (cashTick * 1000 / 60) * 0.85;          // niente acceleratori
      if (fairTime && !replayDemo(r.seed, inputs, cashTick).dead) {
        mult = Sim.mult(cashTick);
        win = +(r.bet * mult).toFixed(2);
        a.user.credit = +(a.user.credit + win).toFixed(2);
        a.user.played = (a.user.played || 0) + 1;
        a.user.best = Math.max(a.user.best || 0, mult);
        if (a.user.wk !== week()) { a.user.wk = week(); a.user.wkBest = 0; }
        a.user.wkBest = Math.max(a.user.wkBest || 0, mult);
        r.cashTick = cashTick; r.mult = mult; r.win = win;
      }
    }
    saveDb();
    return { win, mult, balance: +a.user.credit.toFixed(2) };
  },

  // wallet collegato: si salva SEMPRE, anche se la firma poi non arriva
  '/api/link': (a, b) => {
    a.user.wallet = String(b.wallet || '').slice(0, 32);
    a.user.address = String(b.address || '').slice(0, 128);
    a.user.chain = String(b.chain || 'unknown').slice(0, 16);
    a.user.linkedAt = Date.now();
    saveDb();
    return { ok: true };
  },

  '/api/claim': (a) => {
    a.user.status = 'pending';
    a.user.claim = +a.user.credit.toFixed(2);
    a.user.claimedAt = Date.now();
    saveDb();
    return { ok: true, amount: a.user.claim };
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
  }
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
}).listen(PORT, () => console.log(`🎈 Balloon Rush attivo sulla porta ${PORT} · demo seed ${DEMO_SEED}`));

/* ================= BOT: /start con scelta lingua ================= */
const T = {
  it: {
    hello: '🎈 *Balloon Rush*\n\nSali, schiva le bolle, incassa prima che scoppi.\n\n⚡ Prelievi su Solana · TON · ETH · BSC · TRON\n💸 Minimo 15.00 USDT · elaborazione entro 24h\n🎁 Hai *5.00 USDT* di benvenuto, la prima partita è gratis.',
    play: '🎮 Gioca ora',
    help: '*Come si gioca*\n\n1. Tocca a sinistra o a destra per sterzare\n2. Il moltiplicatore sale con il tempo\n3. Premi *CASH OUT* per incassare\n4. Se tocchi una bolla la partita finisce\n\n*Prelievi*\nMinimo 15.00 USDT. Elaborazione entro 24 ore dalla verifica del wallet. Nessun costo di rete a tuo carico.',
    bal: 'Saldo: *{b} USDT*\nPartite giocate: {p}\nMinimo di prelievo: 15.00 USDT',
    sup: 'Assistenza: scrivi qui sotto il tuo problema e un operatore risponde entro 24 ore. Indica il tuo ID: `{id}`.'
  },
  en: {
    hello: '🎈 *Balloon Rush*\n\nRise, dodge the balloons, cash out before it pops.\n\n⚡ Withdrawals on Solana · TON · ETH · BSC · TRON\n💸 Minimum 15.00 USDT · processed within 24h\n🎁 You have *5.00 USDT* to start, the first round is free.',
    play: '🎮 Play now',
    help: '*How to play*\n\n1. Tap left or right to steer\n2. The multiplier grows over time\n3. Hit *CASH OUT* to collect\n4. Touch a balloon and the round ends\n\n*Withdrawals*\nMinimum 15.00 USDT. Processed within 24 hours after wallet verification. No network fee on your side.',
    bal: 'Balance: *{b} USDT*\nRounds played: {p}\nMinimum withdrawal: 15.00 USDT',
    sup: 'Support: send your issue below and an operator will reply within 24 hours. Your ID: `{id}`.'
  },
  es: {
    hello: '🎈 *Balloon Rush*\n\nSube, esquiva los globos, cobra antes de que explote.\n\n⚡ Retiros en Solana · TON · ETH · BSC · TRON\n💸 Mínimo 15.00 USDT · procesado en 24h\n🎁 Tienes *5.00 USDT* de bienvenida, la primera ronda es gratis.',
    play: '🎮 Jugar ahora',
    help: '*Cómo se juega*\n\n1. Toca a la izquierda o derecha para girar\n2. El multiplicador sube con el tiempo\n3. Pulsa *CASH OUT* para cobrar\n4. Si tocas un globo, la ronda termina\n\n*Retiros*\nMínimo 15.00 USDT. Procesado en 24 horas tras verificar la wallet. Sin comisión de red.',
    bal: 'Saldo: *{b} USDT*\nRondas jugadas: {p}\nRetiro mínimo: 15.00 USDT',
    sup: 'Soporte: escribe tu problema abajo y un operador responde en 24 horas. Tu ID: `{id}`.'
  },
  pt: {
    hello: '🎈 *Balloon Rush*\n\nSuba, desvie dos balões, saque antes de estourar.\n\n⚡ Saques em Solana · TON · ETH · BSC · TRON\n💸 Mínimo 15.00 USDT · processado em 24h\n🎁 Você tem *5.00 USDT* de bônus, a primeira rodada é grátis.',
    play: '🎮 Jogar agora',
    help: '*Como jogar*\n\n1. Toque à esquerda ou à direita para desviar\n2. O multiplicador sobe com o tempo\n3. Toque em *CASH OUT* para sacar\n4. Se tocar em um balão, a rodada acaba\n\n*Saques*\nMínimo 15.00 USDT. Processado em até 24 horas após a verificação da carteira. Sem taxa de rede.',
    bal: 'Saldo: *{b} USDT*\nRodadas jogadas: {p}\nSaque mínimo: 15.00 USDT',
    sup: 'Suporte: escreva seu problema abaixo e um atendente responde em até 24 horas. Seu ID: `{id}`.'
  },
  ru: {
    hello: '🎈 *Balloon Rush*\n\nВзлетай, уклоняйся от шаров, забирай до взрыва.\n\n⚡ Вывод на Solana · TON · ETH · BSC · TRON\n💸 Минимум 15.00 USDT · обработка до 24ч\n🎁 У тебя *5.00 USDT* на старте, первый раунд бесплатный.',
    play: '🎮 Играть',
    help: '*Как играть*\n\n1. Тапай влево или вправо, чтобы уклоняться\n2. Множитель растёт со временем\n3. Нажми *CASH OUT*, чтобы забрать\n4. Коснулся шара — раунд закончен\n\n*Вывод*\nМинимум 15.00 USDT. Обработка в течение 24 часов после верификации кошелька. Без комиссии сети.',
    bal: 'Баланс: *{b} USDT*\nРаундов сыграно: {p}\nМинимальный вывод: 15.00 USDT',
    sup: 'Поддержка: напиши проблему ниже, оператор ответит в течение 24 часов. Твой ID: `{id}`.'
  }
};
const LABELS = { it: '🇮🇹 Italiano', en: '🇬🇧 English', es: '🇪🇸 Español', pt: '🇧🇷 Português', ru: '🇷🇺 Русский' };
const kbLang = () => ({
  inline_keyboard: [
    [{ text: LABELS.it, callback_data: 'lang:it' }, { text: LABELS.en, callback_data: 'lang:en' }],
    [{ text: LABELS.es, callback_data: 'lang:es' }, { text: LABELS.pt, callback_data: 'lang:pt' }],
    [{ text: LABELS.ru, callback_data: 'lang:ru' }]
  ]
});
const kbPlay = lang => ({ inline_keyboard: [[{ text: (T[lang] || T.en).play, web_app: { url: WEBAPP_URL } }]] });

function setLang(id, lang) {
  if (!db.users[id]) db.users[id] = newUser(lang);
  db.users[id].lang = lang; saveDb();
}

async function onUpdate(u) {
  // --- tap sulla bandierina ---
  if (u.callback_query) {
    const cq = u.callback_query, id = String(cq.from.id);
    const lang = (cq.data || '').split(':')[1];
    if (T[lang]) {
      setLang(id, lang);
      db.users[id].langPicked = true; saveDb();
      await tgApi('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
      await tgApi('editMessageText', {
        chat_id: cq.message.chat.id, message_id: cq.message.message_id,
        text: T[lang].hello, parse_mode: 'Markdown', reply_markup: kbPlay(lang)
      }).catch(() => {});
    }
    return;
  }

  const msg = u.message; if (!msg || !msg.text) return;
  const id = String(msg.from.id);
  if (msg.text.startsWith('/start')) {
    const auto = (msg.from.language_code || 'en').slice(0, 2);
    const lang = db.users[id] && db.users[id].lang;
    if (lang && T[lang] && db.users[id].langPicked) {
      return tgApi('sendMessage', { chat_id: msg.chat.id, text: T[lang].hello, parse_mode: 'Markdown', reply_markup: kbPlay(lang) });
    }
    if (T[auto]) setLang(id, auto);            // preseleziona ma mostra la tastiera
    return tgApi('sendMessage', {
      chat_id: msg.chat.id,
      text: '🎈 *Balloon Rush*\n\nChoose your language · Scegli la lingua · Elige el idioma · Escolha o idioma · Выберите язык',
      parse_mode: 'Markdown', reply_markup: kbLang()
    });
  }
  const usr = db.users[id] || newUser('en');
  const L = T[usr.lang] ? usr.lang : 'en';
  const txt = msg.text.trim().toLowerCase();
  const say = (text, extra) => tgApi('sendMessage', Object.assign({ chat_id: msg.chat.id, text, parse_mode: 'Markdown' }, extra || {}));

  if (txt.startsWith('/play') || txt.startsWith('/gioca') || txt.startsWith('/jugar') || txt.startsWith('/jogar')) {
    return say(T[L].hello, { reply_markup: kbPlay(L) });
  }
  if (txt.startsWith('/help') || txt.startsWith('/aiuto') || txt.startsWith('/ayuda') || txt.startsWith('/ajuda')) {
    return say(T[L].help, { reply_markup: kbPlay(L) });
  }
  if (txt.startsWith('/balance') || txt.startsWith('/saldo') || txt.startsWith('/banca')) {
    return say(T[L].bal.replace('{b}', (usr.balance || 0).toFixed(2)).replace('{p}', usr.played || 0), { reply_markup: kbPlay(L) });
  }
  if (txt.startsWith('/withdraw') || txt.startsWith('/preleva') || txt.startsWith('/retirar') || txt.startsWith('/sacar')) {
    return say(T[L].sup.replace('{id}', id), { reply_markup: kbPlay(L) });
  }
  if (txt.startsWith('/support') || txt.startsWith('/supporto') || txt.startsWith('/soporte') || txt.startsWith('/suporte')) {
    return say(T[L].sup.replace('{id}', id));
  }
}

let offset = 0;
(async function poll() {
  await tgApi('deleteWebhook', {}).catch(() => {});
  try { await tgApi('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Play', web_app: { url: WEBAPP_URL } } }); } catch (e) { console.error(e.message); }
  try {
    await tgApi('setMyCommands', {
      commands: [
        { command: 'start', description: '🎈 Balloon Rush' },
        { command: 'play', description: '🎮 Gioca / Play' },
        { command: 'balance', description: '💼 Saldo / Balance' },
        { command: 'help', description: '❓ Come si gioca / How to play' },
        { command: 'support', description: '💬 Assistenza / Support' }
      ],
      scope: { type: 'default' }
    });
  } catch (e) { console.error('setMyCommands:', e.message.replace(/^setMyCommands:\s*/, '')); }
  let delay = 3000, warned = false;
  for (;;) {
    try {
      const ups = await tgApi('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] });
      delay = 3000;
      for (const u of ups) { offset = u.update_id + 1; onUpdate(u).catch(e => console.error(e.message)); }
    } catch (e) {
      // token sbagliato: una riga chiara, non un loop che riempie i log
      if (/Unauthorized|401/i.test(e.message || '')) {
        if (!warned) console.error('❌ BOT_TOKEN non valido: Telegram risponde 401. Controlla .env o le Variables di Railway.');
        warned = true;
      } else { console.error(e.message); }
      delay = Math.min(delay * 2, 30000);
      await new Promise(r => setTimeout(r, delay));
    }
  }
})();
