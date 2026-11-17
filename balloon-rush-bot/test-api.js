/* Test end-to-end delle API. Avvia prima il server:
 *   BOT_TOKEN=123456:TESTTOKEN WEBAPP_URL=https://example.com PORT=3999 node server.js
 * poi:
 *   PORT=3999 BOT_TOKEN=123456:TESTTOKEN node test-api.js
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

// utente nuovo a ogni esecuzione: la prova è una sola per utente
const uid = 1000 + Math.floor(Math.random() * 900000);
const ID = initData({ id: uid, first_name: 'Test', language_code: 'pt-br' });
const post = async (path, body = {}) => {
  const r = await fetch(B + path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData: ID, ...body }) });
  return { code: r.status, body: await r.json() };
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('utente di test:', uid);
  console.log('1. /api/me      ', JSON.stringify(await post('/api/me')));

  const st = await post('/api/start');
  console.log('2. /api/start   ', st.code, JSON.stringify(st.body));
  if (!st.body.roundId) return console.log('   start rifiutato, stop');

  await sleep(12600);                          // il server rifiuta chi accelera

  const cashTick = 865;                        // x3.40
  const en = await post('/api/end', { roundId: st.body.roundId, inputs: [], cashTick });
  console.log('3. /api/end     ', en.code, JSON.stringify(en.body));

  console.log('4. /api/link    ', JSON.stringify(await post('/api/link',
    { address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', chain: 'sol', wallet: 'phantom' })));
  console.log('5. /api/claim   ', JSON.stringify(await post('/api/claim')));
  console.log('6. /api/me dopo ', JSON.stringify(await post('/api/me')));

  const again = await post('/api/end', { roundId: st.body.roundId, inputs: [], cashTick });
  console.log('7. replay round ', again.code, JSON.stringify(again.body));

  const twice = await post('/api/start');
  console.log('8. seconda prova', twice.code, JSON.stringify(twice.body));

  const bad = ID.replace(/hash=./, 'hash=0');
  const r = await fetch(B + '/api/me', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData: bad }) });
  console.log('9. firma falsa  ', r.status, JSON.stringify(await r.json()));
})();
