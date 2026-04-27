// api/price.js — Vercel Serverless Function
// X1 to fork Solany (SVM) — So11111...112 na X1 = Wrapped XNT (nie SOL!)
// Para ANAL/XNT na xdex: GwwCyLS4VEeZXyPWPYRNiVSuVur6ntioxBmjDQHHHv9x

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');

  const ANAL = 'EFPkbXTdr3c7aRbCEKoJDYdbbzgzVDBShYGybP3gQwmy';
  const XNT  = 'So11111111111111111111111111111111111111112'; // Wrapped XNT na X1
  const PAIR = 'GwwCyLS4VEeZXyPWPYRNiVSuVur6ntioxBmjDQHHHv9x';
  const now  = Math.floor(Date.now() / 1000);

  // ── Pomocnicza: pobierz XNT/USD ──
  // XNT = natywny token X1 network
  // Ze screena xdex: price ANAL=$0.000453, 0.00112 XNT per ANAL → XNT≈$0.404
  async function getXntUsd() {
    // Próba 1: CoinGecko
    try {
      const r = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=xen-network,x1-network,xen-crypto&vs_currencies=usd',
        { signal: AbortSignal.timeout(4000) }
      );
      if (r.ok) {
        const d = await r.json();
        const v = d['xen-network']?.usd || d['x1-network']?.usd;
        if (v && v > 0) return v;
      }
    } catch(e) {}
    // Fallback: stała obliczona ze screena
    return 0.404;
  }

  // ── METODA 1: xdex chart/history (najbardziej aktualne dane) ──
  try {
    const url = `https://api.xdex.xyz/api/xdex/chart/history` +
      `?from_token=${XNT}&to_token=${ANAL}` +
      `&resolution=60&time_from=${now - 7200}&time_to=${now}` +
      `&network=X1%20Mainnet`;

    const r = await fetch(url, {
      headers: {
        'Referer': 'https://app.xdex.xyz/',
        'Origin':  'https://app.xdex.xyz',
        'Accept':  'application/json',
      },
      signal: AbortSignal.timeout(7000),
    });

    if (r.ok) {
      const d = await r.json();
      // d.c[i] = ile ANAL dostaniesz za 1 XNT
      // Cena ANAL w XNT = 1 / d.c[-1]
      if (Array.isArray(d.c) && d.c.length > 0) {
        const last  = d.c[d.c.length - 1]; // ile ANAL za 1 XNT
        const first = d.c[0];
        const analInXnt = 1 / last;         // ile XNT za 1 ANAL
        const change = first > 0 ? ((last - first) / first * 100) * -1 : 0;
        // Zmiana odwrócona: jeśli więcej ANAL za XNT → ANAL tanieje
        
        const xntUsd = await getXntUsd();
        const analUsd = analInXnt * xntUsd;

        console.log(`xdex: last=${last}, analInXnt=${analInXnt}, xntUsd=${xntUsd}, analUsd=${analUsd}`);

        if (analUsd > 0) {
          return res.status(200).json({
            price:     analUsd,
            change24h: change,
            source:    'xdex',
            debug:     { last, analInXnt, xntUsd, points: d.c.length }
          });
        }
      }
    } else {
      console.error('xdex status:', r.status);
    }
  } catch(e) {
    console.error('xdex error:', e.message);
  }

  // ── METODA 2: X1 RPC — getTokenAccountsByOwner ──
  // Czyta rezerwy bezpośrednio z blockchain
  for (const rpc of ['https://rpc.mainnet.x1.xyz', 'https://rpc1.mainnet.x1.xyz']) {
    try {
      const r2 = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'getTokenAccountsByOwner',
          params: [PAIR, { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, { encoding: 'jsonParsed' }]
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (r2.ok) {
        const rd = await r2.json();
        const accounts = rd?.result?.value || [];
        let analR = 0, xntR = 0;
        for (const acc of accounts) {
          const info = acc?.account?.data?.parsed?.info;
          if (!info) continue;
          const amount = parseFloat(info.tokenAmount?.uiAmount || 0);
          if (info.mint === ANAL) analR = amount;
          else xntR = amount;
        }
        if (analR > 0 && xntR > 0) {
          const analInXnt = xntR / analR;
          const xntUsd = await getXntUsd();
          const analUsd = analInXnt * xntUsd;
          if (analUsd > 0) {
            return res.status(200).json({ price: analUsd, change24h: 0, source: 'x1rpc',
              debug: { analR, xntR, analInXnt, xntUsd } });
          }
        }
      }
    } catch(e) { console.error('rpc error:', e.message); }
  }

  // ── METODA 3: x1.ninja scrape ──
  try {
    const r3 = await fetch(`https://x1.ninja/pair/${PAIR}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(6000),
    });
    if (r3.ok) {
      const html = await r3.text();
      const title = (html.match(/<title>([^<]+)<\/title>/i) || [])[1] || '';
      const pm = title.match(/\$([\d.]+)/);
      const cm = title.match(/\(([+-]?[\d.]+)%\)/);
      if (pm) return res.status(200).json({
        price: parseFloat(pm[1]), change24h: cm ? parseFloat(cm[1]) : 0, source: 'x1ninja'
      });
    }
  } catch(e) { console.error('x1ninja error:', e.message); }

  return res.status(503).json({ error: 'Price unavailable' });
}
