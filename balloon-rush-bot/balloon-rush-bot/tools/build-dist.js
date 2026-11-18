// Rigenera dist/ : server.js + miniapp incorporata, senza cartella public/.
// Uso:  node tools/build-dist.js
// Serve solo se devi caricare su GitHub un singolo file invece della cartella.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'dist');

const read = f => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
const INLINE = ['index.html', 'i18n.js', 'wallets.js', 'sim.js', 'tonconnect-manifest.json'];

let srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8').replace(/\r\n/g, '\n');

// 1) sim.js incorporato come modulo CommonJS
const embSim =
  '/* ---- sim.js incorporato ---- */\nconst __SIM = (() => {\n  const module = { exports: {} };\n' +
  '  (function (module, exports) {\n' + read('sim.js') + '\n  })(module, module.exports);\n' +
  '  return module.exports;\n})();\n';

// 2) file statici come stringhe + icona in base64
const files = INLINE.map(n => '  ' + JSON.stringify('/' + n) + ': ' + JSON.stringify(read(n))).join(',\n');
const icon = fs.readFileSync(path.join(PUBLIC, 'icon-180.png')).toString('base64');
const embFiles =
  'const FILES = {\n' + files + '\n};\n' +
  "const ICON = Buffer.from(" + JSON.stringify(icon) + ", 'base64');\n";

// 3) sostituisci require + servizio statico
const NEED = "const Sim = require('./public/sim.js');";
if (!srv.includes(NEED)) throw new Error('require di sim.js non trovato in server.js');
srv = srv.replace(NEED, embSim + 'const Sim = __SIM;\n\n/* ---- miniapp incorporata (nessuna cartella public/) ---- */\n' + embFiles);

const OLD = `    let file = decodeURIComponent(url); if (file === '/') file = '/index.html';
    const full = path.join(PUBLIC, path.normalize(file));
    if (!full.startsWith(PUBLIC) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);`;
const NEW = `    let file = decodeURIComponent(url); if (file === '/') file = '/index.html';
    if (file === '/icon-180.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(ICON); }
    const body = FILES[file];
    if (body === undefined) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(body);`;
if (!srv.includes(OLD)) throw new Error('blocco statico non trovato in server.js (server.js è cambiato?)');
srv = srv.replace(OLD, NEW);

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'server.js'), srv);

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
pkg.description = 'Balloon Rush — versione monofile (miniapp incorporata)';
fs.writeFileSync(path.join(OUT, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

console.log('dist/server.js   ' + fs.statSync(path.join(OUT, 'server.js')).size + ' byte');
console.log('dist/package.json scritto');
console.log('Ora carica SOLO questi due file nella root del repo, oppure fai git push.');
