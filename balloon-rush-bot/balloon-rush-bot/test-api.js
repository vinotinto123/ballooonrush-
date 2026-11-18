/* Test end-to-end delle API. Avvia prima il server:
 *   BOT_TOKEN=123456:TESTTOKEN WEBAPP_URL=https://example.com PORT=3999 node server.js
 * poi:
 *   PORT=3999 BOT_TOKEN=123456:TESTTOKEN node test-api.js
 *
 * La partita ora è vera: la puntata esce dal saldo a /api/start, la vincita
 * entra a /api/end solo se il replay server-side arriva vivo al cashout.
 */
const crypto = require('crypto');
const Sim = require('./public/sim.js');
const TOKEN = process.env.BOT_TOKEN || '123456:TESTTOKEN';
const PORT = process.env.PORT || 3999;
const B = `http://127.0.0.1:${PORT}`;

function initData(user) {
  const p = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'AA' + Date.now(),
    user: JSON.stringify(user)
  });
  const dcs = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  p.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return p.toString();
}

const uid = 1000 + Math.floor(Math.random() * 900000);
const ID = initData({ id: uid, first_name: 'Test', language_code: 'pt-br' });
const post = async (path, body = {}) => {
  const r = await fetch(B + path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData: ID, ...body }) });
  return { code: r.status, body: await r.json() };
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* primo tick in cui la mongolfiera ferma al centro esplode */
function deathTick(seed, cap) {
  const s = Sim.create(seed);
  for (let t = 0; t < cap; t++) { Sim.step(s, 0); if (s.dead) return t + 1; }
  return null;
}

(async () => {
  let fail = 0;
  const ok = (cond, label) => { console.log((cond ? '  ✓ ' : '  ✗ ') + label); if (!cond) fail++; };

  console.log('utente di test:', uid);
  const me0 = await post('/api/me');
  console.log('1. /api/me      ', me0.code, JSON.stringify(me0.body));
  ok(me0.body.balance === 5, 'saldo iniziale 5.00');
  ok(me0.body.bet === 5, 'puntata esposta: 5.00');

  const st = await post('/api/start');
  console.log('2. /api/start   ', st.code, JSON.stringify(st.body));
  ok(st.code === 200 && !!st.body.roundId, 'round creato');
  ok(st.body.balance === 0, 'puntata scalata subito (saldo 0.00)');
  ok(typeof st.body.seed === 'number', 'seed casuale');

  await sleep(1200);                                   // il server rifiuta chi accelera
  const cashTick = 60;                                 // x1.09
  const en = await post('/api/end', { roundId: st.body.roundId, inputs: [], cashTick });
  console.log('3. /api/end     ', en.code, JSON.stringify(en.body));
  ok(en.code === 200 && en.body.win > 0, 'vincita pagata dal replay');
  ok(en.body.balance > 5, 'saldo sopra la puntata: ' + en.body.balance);

  const replay = await post('/api/end', { roundId: st.body.roundId, inputs: [], cashTick });
  console.log('4. replay round ', replay.code, JSON.stringify(replay.body));
  ok(replay.code === 400, 'stesso round non pagabile due volte');

  // seconda partita: si gioca finché il saldo basta
  const st2 = await post('/api/start');
  console.log('5. start 2      ', st2.code, JSON.stringify(st2.body));
  ok(st2.code === 200, 'seconda partita ammessa');

  const dt = deathTick(st2.body.seed, 1200);
  const deadTick = dt || 1200;
  await sleep(Math.ceil(deadTick / 60 * 0.9 * 1000) + 300);
  const lost = await post('/api/end', { roundId: st2.body.roundId, inputs: [], cashTick: deadTick });
  console.log('6. end 2 (morte)', lost.code, JSON.stringify(lost.body), 'deathTick', dt);
  ok(lost.code === 200 && lost.body.win === 0, 'chi muore non incassa');
  ok(lost.body.played === 2, 'round contati: ' + lost.body.played);

  const top = await post('/api/topup', { amount: 20 });
  console.log('7. /api/topup   ', top.code, JSON.stringify(top.body));
  ok(top.code === 200 && top.body.amount === 20, 'ricarica accreditata');

  const badTop = await post('/api/topup', { amount: 7 });
  console.log('8. topup 7      ', badTop.code, JSON.stringify(badTop.body));
  ok(badTop.code === 400, 'importo fuori listino rifiutato');

  console.log('9. /api/link    ', JSON.stringify(await post('/api/link',
    { address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', chain: 'sol', wallet: 'phantom' })));
  const cl = await post('/api/claim');
  console.log('10. /api/claim  ', cl.code, JSON.stringify(cl.body));
  ok(cl.code === 200, 'prelievo sopra il minimo');
  console.log('11. /api/me dopo', JSON.stringify((await post('/api/me')).body));

  const noMoney = await post('/api/start');
  console.log('12. start pending', noMoney.code, JSON.stringify(noMoney.body));
  ok(noMoney.code === 400, 'niente partite con prelievo in corso');

  const bad = ID.replace(/hash=./, 'hash=0');
  const r = await fetch(B + '/api/me', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData: bad }) });
  const rb = await r.json();
  console.log('13. firma falsa  ', r.status, JSON.stringify(rb));
  ok(r.status === 401, 'firma falsa respinta');

  console.log(fail ? `\n❌ ${fail} test falliti` : '\n✅ tutti i test verdi');
  process.exit(fail ? 1 : 0);
})();
