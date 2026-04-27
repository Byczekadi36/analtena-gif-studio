// api/price.js — Vercel Serverless Function
// X1 to fork Solany (Xolana/SVM) — używamy Solana RPC API
// Para ANAL/XNT na xdex: GwwCyLS4VEeZXyPWPYRNiVSuVur6ntioxBmjDQHHHv9x

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');

  const PAIR_POOL = 'GwwCyLS4VEeZXyPWPYRNiVSuVur6ntioxBmjDQHHHv9x';
  const ANAL_MINT = 'EFPkbXTdr3c7aRbCEKoJDYdbbzgzVDBShYGybP3gQwmy';
  const SOL_MINT  = 'So11111111111111111111111111111111111111112';

  // X1 mainnet RPC (Solana-compatible fork)
  const X1_RPCS = [
    'https://rpc.mainnet.x1.xyz',
    'https://rpc1.mainnet.x1.xyz',
    'https://api.mainnet.x1.xyz',
  ];

  // ── METODA 1: X1 RPC — getTokenAccountsByOwner dla poola ──
  // Para AMM to konto które trzyma reserve tokenów
  // Raydium CPMM pool ma 2 vault accounts — jeden ANAL, drugi XNT/SOL
  for (const rpc of X1_RPCS) {
    try {
      // Pobierz saldo tokenów w pool vault
      const rpcRes = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'getTokenAccountsByOwner',
          params: [
            PAIR_POOL,
            { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
            { encoding: 'jsonParsed' }
          ]
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (rpcRes.ok) {
        const rpcData = await rpcRes.json();
        const accounts = rpcData?.result?.value || [];

        if (accounts.length >= 2) {
          // Znajdź vault ANAL i vault XNT
          let analReserve = 0, xntReserve = 0;
          for (const acc of accounts) {
            const info = acc?.account?.data?.parsed?.info;
            if (!info) continue;
            const mint = info.mint;
            const amount = parseFloat(info.tokenAmount?.uiAmount || 0);
            if (mint === ANAL_MINT) analReserve = amount;
            else xntReserve = amount;
          }

          if (analReserve > 0 && xntReserve > 0) {
            // Cena ANAL w XNT = xntReserve / analReserve
            const analInXnt = xntReserve / analReserve;

            // Pobierz XNT/USD przez xdex chart (teraz tylko XNT/SOL price)
            // XNT = natywny token X1, odpowiednik SOL na Solanie
            // Pobierz jego cenę z Binance lub CoinGecko
            let xntUsd = 0;
            try {
              // Spróbuj CoinGecko dla XNT
              const cgRes = await fetch(
                'https://api.coingecko.com/api/v3/simple/price?ids=xen-crypto,x1-network&vs_currencies=usd',
                { signal: AbortSignal.timeout(4000) }
              );
              if (cgRes.ok) {
                const cgData = await cgRes.json();
                xntUsd = cgData?.['x1-network']?.usd || cgData?.['xen-crypto']?.usd || 0;
              }
            } catch(e) {}

            // Fallback: ze screena xdex XNT ≈ $0.40 (Market Cap $453K / supply 1B)
            if (!xntUsd) xntUsd = 0.0004; // będzie nieprecyzyjne ale lepsze niż nic

            const analUsd = analInXnt * xntUsd;
            console.log(`[price] RPC OK: analReserve=${analReserve}, xntReserve=${xntReserve}, analInXnt=${analInXnt}, xntUsd=${xntUsd}, analUsd=${analUsd}`);

            if (analUsd > 0) {
              return res.status(200).json({
                price: analUsd,
                change24h: 0,
                source: 'x1rpc',
                debug: { analReserve, xntReserve, analInXnt, xntUsd, rpc }
              });
            }
          }
        }
      }
    } catch(e) {
      console.error(`[price] RPC ${rpc} error:`, e.message);
    }
  }

  // ── METODA 2: xdex chart/history ──
  try {
    const now = Math.floor(Date.now() / 1000);
    const xdexUrl = `https://api.xdex.xyz/api/xdex/chart/history` +
      `?from_token=${SOL_MINT}&to_token=${ANAL_MINT}` +
      `&resolution=60&time_from=${now - 7200}&time_to=${now}` +
      `&network=X1%20Mainnet`;

    const xr = await fetch(xdexUrl, {
      headers: { 'Referer': 'https://app.xdex.xyz/', 'Origin': 'https://app.xdex.xyz' },
      signal: AbortSignal.timeout(6000),
    });

    if (xr.ok) {
      const xd = await xr.json();
      if (Array.isArray(xd.c) && xd.c.length > 0) {
        const last = xd.c[xd.c.length - 1];
        const first = xd.c[0];
        const change = first > 0 ? ((last - first) / first * 100) : 0;
        // last = ile ANAL za 1 SOL → analInSol = 1/last
        const analInSol = 1 / last;
        // SOL price z Binance
        let solUsd = 150;
        try {
          const br = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT',
            { signal: AbortSignal.timeout(3000) });
          if (br.ok) solUsd = parseFloat((await br.json()).price || 150);
        } catch(e) {}
        const analUsd = analInSol * solUsd;
        if (analUsd > 0) {
          return res.status(200).json({
            price: analUsd, change24h: change, source: 'xdex',
            debug: { last, analInSol, solUsd }
          });
        }
      }
    }
  } catch(e) { console.error('[price] xdex error:', e.message); }

  // ── METODA 3: x1.ninja scrape ──
  try {
    const r3 = await fetch(`https://x1.ninja/pair/${PAIR_POOL}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(5000),
    });
    if (r3.ok) {
      const html = await r3.text();
      const title = (html.match(/<title>([^<]+)<\/title>/i) || [])[1] || '';
      const pm = title.match(/\$([\d.]+)/);
      const cm = title.match(/\(([+-]?[\d.]+)%\)/);
      if (pm) {
        return res.status(200).json({
          price: parseFloat(pm[1]),
          change24h: cm ? parseFloat(cm[1]) : 0,
          source: 'x1ninja'
        });
      }
    }
  } catch(e) { console.error('[price] x1ninja error:', e.message); }

  return res.status(503).json({ error: 'Price unavailable' });
}
