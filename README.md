# 🎈 Balloon Rush: guida all'impostazione

## Cosa c'è nella cartella

```
public/index.html   ← il gioco (si apre dentro Telegram)
public/sim.js       ← le regole del gioco (usate sia dal gioco sia dal server)
server.js           ← fa funzionare il bot e controlla le partite
package.json        ← dice all'hosting come avviare il server
```

Il **bot** non è un file: lo crei su Telegram. Il server lo "accende" usando il suo token.

---

## Passo 1: crea il bot (2 minuti)

1. Su Telegram apri **@BotFather** e scrivi `/newbot`.
2. Scegli il nome visibile, per esempio `Balloon Rush`.
3. Scegli lo username: deve finire con `bot`, per esempio `BalloonRushGameBot`.
4. BotFather ti risponde con il **token**, una stringa tipo `7712345678:AAH...`. Copialo e **non condividerlo con nessuno**: chi ha il token controlla il bot.

## Passo 2: inserisci lo username nel gioco

Apri `public/index.html`, cerca `CONFIG` all'inizio dello script e scrivi lo username del bot senza `@`:

```js
BOT_USERNAME: 'BalloonRushGameBot',
APP_SHORT_NAME: 'play'
```

## Passo 3: metti online il server (Railway, circa 10 minuti)

1. Crea un account su **github.com** e un nuovo repository (anche privato). Carica tutti i file della cartella con "Add file → Upload files".
2. Vai su **railway.app**, accedi con GitHub e scegli **New Project → Deploy from GitHub repo**, poi seleziona il repository.
3. In **Settings → Networking → Generate Domain** ottieni un indirizzo tipo `balloon-rush-production.up.railway.app`.
4. In **Variables** aggiungi:
   - `BOT_TOKEN` = il token del passo 1
   - `WEBAPP_URL` = `https://` + l'indirizzo del punto 3
   - `DB_PATH` = `/data/db.json`
5. In **Settings → Volumes** aggiungi un volume montato su `/data`. Senza questo, a ogni aggiornamento si perdono gettoni e classifica.
6. Railway riavvia il servizio. Nei **Logs** deve comparire `🎈 Balloon Rush attivo`.

> Railway funziona con crediti di prova e poi con un piano a pagamento. In alternativa puoi usare Render o una VPS. Evita i piani gratuiti che "addormentano" il server: il bot smetterebbe di rispondere.

## Passo 4: collega il gioco al bot

1. Su @BotFather scrivi `/newapp` e scegli il tuo bot.
2. Inserisci titolo, descrizione breve e un'immagine 640×360 (puoi farla anche al volo).
3. Quando ti chiede l'URL, incolla lo stesso valore di `WEBAPP_URL`.
4. Come **short name** scrivi `play`, lo stesso di `APP_SHORT_NAME`.

## Passo 5: prova

- Scrivi `/start` al tuo bot e premi **🎮 Gioca ora**. Trovi anche il pulsante "Gioca" accanto al campo di testo.
- Fai una partita, incassa e premi **⚔️ Sfida un amico**. L'amico che apre il link gioca sullo stesso percorso e vede la linea gialla del punto in cui hai incassato tu.

## Provare senza Telegram

Apri `public/index.html` direttamente nel browser. Funziona in **modalità prova**: i gettoni sono salvati nel browser, le frecce ← → muovono la mongolfiera e la barra spaziatrice incassa. Sfide e classifica condivisa funzionano solo dentro Telegram.

---

## Come funziona la sicurezza

- Ogni richiesta porta la firma di Telegram (`initData`) e il server la verifica: nessuno può fingersi un altro giocatore.
- Quando inizia una partita, il server scala la puntata e sceglie il *seed* del percorso.
- All'incasso il gioco invia solo i tocchi del giocatore. Il server **rigioca la partita**: se in quel percorso la mongolfiera sarebbe scoppiata, non paga. Se la partita è "durata" meno del tempo reale trascorso, non paga (blocca chi accelera il gioco).

## Regolazioni

- **Difficoltà e moltiplicatore**: in `public/sim.js`, le funzioni `mult()` e `generate()`.
- **Puntate**: `BETS` sia in `index.html` sia in `server.js`.
- **Gettoni iniziali e bonus giornaliero**: `START_CHIPS` e `DAILY_BONUS` in `server.js`.

Se cambi `sim.js` mentre ci sono partite in corso, quelle partite risulteranno non valide: aggiorna quando il gioco è poco usato.

## Prossimi passi (dopo il test con utenti veri)

1. Negozio gettoni in Telegram Stars e video a premio Adsgram.
2. Dominio tuo e collegamento wallet con TON Connect (login e skin NFT).
3. Database vero (SQLite o Postgres) quando gli utenti crescono.

⚠️ I gettoni devono restare **non convertibili** in denaro, crypto o Gifts rivendibili, altrimenti il gioco rientra nella normativa sul gioco a distanza.
