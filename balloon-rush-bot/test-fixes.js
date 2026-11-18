/* Test dei fix: config pubblica, eventi di funnel, stats, dedupe del topup.
 * Avvio:  PORT=3999 BOT_TOKEN=123456:TESTTOKEN node server.js
 * Poi:    PORT=3999 BOT_TOKEN=123456:TESTTOKEN node test-fixes.js
 */
const crypto = require('crypto');
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

const uid = 2000 + Math.floor(Math.random() * 900000);
const ID = initData({ id: uid, first_name: 'Fix', language_code: 'es-mx' });
const post = async (path, body = {}) => {
  const r = await fetch(B + path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData: ID, ...body }) });
  return { code: r.status, body: await r.json() };
};

(async () => {
  let fail = 0;
  const ok = (c, l) => { console.log((c ? '  ✓ ' : '  ✗ ') + l); if (!c) fail++; };

  console.log('utente di test:', uid);

  const cfg = await (await fetch(B + '/api/config')).json();
  console.log('1. /api/config  ', JSON.stringify(cfg));
  ok(cfg.bet === 5 && cfg.minWithdraw === 15, 'config pubblica servita');
  ok(typeof cfg.minDrainUsd === 'number', 'soglia di drain esposta');

  const hz = await (await fetch(B + '/healthz')).json();
  console.log('2. /healthz     ', JSON.stringify(hz));
  ok('wc' in hz, 'healthz riporta se WC_PROJECT_ID è configurato');

  const me0 = await post('/api/me');
  console.log('3. /api/me      ', JSON.stringify(me0.body));
  ok(me0.body.address === null, 'address vuoto prima del collegamento');

  for (const n of ['open', 'play_start', 'wall', 'wallet_pick', 'lowbal', 'sign_ok']) {
    const r = await post('/api/ev', { name: n, meta: { chain: 'sol' } });
    if (r.code !== 200) ok(false, 'evento ' + n);
  }
  const bad = await post('/api/ev', { name: '!!!' });
  console.log('4. /api/ev      ', bad.code, JSON.stringify(bad.body));
  ok(bad.code === 400, 'nome evento vuoto rifiutato');

  const st = await (await fetch(B + '/api/stats')).json();
  console.log('5. /api/stats   ', JSON.stringify(st));
  ok(st.users >= 1, 'utente contato');
  ok(st.events && st.events.sign_ok >= 1, 'eventi aggregati');
  ok(st.signed >= 1, 'funnel: signed calcolato');
  ok(st.byLang && st.byLang.es >= 1, 'raggruppamento per lingua');

  const t1 = await post('/api/topup', { amount: 20, txHash: 'TX-TEST-1' });
  const t2 = await post('/api/topup', { amount: 20, txHash: 'TX-TEST-1' });
  console.log('6. topup dedupe ', t1.code, t2.code, JSON.stringify(t2.body));
  ok(t1.code === 200, 'primo accredito ok');
  ok(t2.code === 400, 'stesso txHash non accreditato due volte');

  const t3 = await post('/api/topup', { amount: 50 });
  console.log('7. topup legacy ', t3.code, JSON.stringify(t3.body));
  ok(t3.code === 200, 'topup senza txHash continua a funzionare');

  console.log(fail ? `\n❌ ${fail} test falliti` : '\n✅ tutti i test verdi');
  process.exit(fail ? 1 : 0);
})();
