// api/price.js — Vercel Serverless Function
// Pobiera cenę ANAL z xdex.xyz po stronie serwera
// Dostępne pod: https://analtena-gif-studio.vercel.app/api/price

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30'); // cache 30s na Vercel edge

  const ANAL_MINT = 'EFPkbXTdr3c7aRbCEKoJDYdbbzgzVDBShYGybP3gQwmy';
  const PAIR_ADDR = 'GwwCyLS4VEeZXyPWPYRNiVSuVur6ntioxBmjDQHHHv9x';
  const now = Math.floor(Date.now() / 1000);
  const from = now - 7200;

  // Metoda 1: xdex.xyz chart/history (serwer ma dostęp, nie przeglądarka)
  try {
    const xdexUrl = `https://api.xdex.xyz/api/xdex/chart/history` +
      `?from_token=So11111111111111111111111111111111111111112` +
      `&to_token=${ANAL_MINT}` +
      `&resolution=60&time_from=${from}&time_to=${now}` +
      `&network=X1%20Mainnet`;

    const xr = await fetch(xdexUrl, {
      headers: {
        'Referer': 'https://app.xdex.xyz/',
        'Origin': 'https://app.xdex.xyz',
        'User-Agent': 'Mozilla/5.0 (compatible; Vercel/1.0)',
      },
      signal: AbortSignal.timeout(6000),
    });

    if (xr.ok) {
      const xd = await xr.json();
      if (xd.c && xd.c.length > 0) {
        const lastClose = xd.c[xd.c.length - 1]; // cena w SOL units
        const firstClose = xd.c[0];

        // Pobierz cenę SOL/USD (Binance — zawsze dostępne)
        const solRes = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT', {
          signal: AbortSignal.timeout(4000),
        });
        const solData = await solRes.json();
        const solUsd = parseFloat(solData.price || 150);
        const analUsd = lastClose * solUsd;
        const change = firstClose > 0 ? ((lastClose - firstClose) / firstClose * 100) : 0;

        return res.json({
          price: analUsd,
          change24h: change,
          source: 'xdex',
          raw: { lastClose, solUsd, dataPoints: xd.c.length }
        });
      }
    }
  } catch (e) {
    console.error('xdex error:', e.message);
  }

  // Metoda 2: x1prism status API
  try {
    const prismRes = await fetch(
      `https://x1prism.com/api/token/${ANAL_MINT}?network=x1`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (prismRes.ok) {
      const pd = await prismRes.json();
      const price = parseFloat(pd.priceUsd || pd.price || 0);
      if (price > 0) {
        return res.json({
          price,
          change24h: parseFloat(pd.change24h || 0),
          source: 'x1prism',
        });
      }
    }
  } catch (e) {}

  // Metoda 3: x1.ninja scrape title
  try {
    const ninjaRes = await fetch(
      `https://x1.ninja/pair/${PAIR_ADDR}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) }
    );
    if (ninjaRes.ok) {
      const html = await ninjaRes.text();
      const m = html.match(/<title>([^<]+)<\/title>/i);
      if (m) {
        const priceM = m[1].match(/\$([\d.]+)/);
        const changeM = m[1].match(/\(([+-]?[\d.]+)%\)/);
        if (priceM) {
          return res.json({
            price: parseFloat(priceM[1]),
            change24h: changeM ? parseFloat(changeM[1]) : 0,
            source: 'x1ninja',
          });
        }
      }
    }
  } catch (e) {}

  return res.status(503).json({ error: 'Price unavailable' });
}
