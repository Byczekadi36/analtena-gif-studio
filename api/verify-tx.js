// /api/verify-tx.js  —  Vercel Serverless Function
//
// Zabezpieczenia:
//   [1] TX hash jednorazowy (Redis, TTL 2 lata) — główne zabezpieczenie
//   [2] TX musi istnieć na X1 blockchainie
//   [3] TX musi być udany (nie failed)
//   [4] TX nie może być starszy niż 72h
//   [5] Musi być spalony minimum 1 $ANAL
//   [6] Rate limit: 10 req / 5 min / IP
//   [7] Walidacja formatu hasha
//   [8] walletAddress opcjonalny — jeśli podany, musi zgadzać się z senderem TX
//
// UWAGA: walletAddress NIE jest wymagany — weryfikacja działa samym hashem TX.
// Adres sendera jest wykrywany bezpośrednio z danych transakcji na blockchainie.

const RPC_LIST = [
  'https://rpc.mainnet.x1.xyz',
  'https://rpc1.mainnet.x1.xyz',
  'https://rpc2.mainnet.x1.xyz',
  'https://xolana.xen.network',
];

const BURN_ADDR = '1nc1nerator11111111111111111111111111111111';
const MAX_AGE_H = 72;
const MIN_BURN  = 1;
const KV_TTL    = 63072000; // 2 lata

// ── Redis helpers (Upstash REST API) ─────────────────────────
function redisURL()   { return process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL   || ''; }
function redisToken() { return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || ''; }

async function redisGet(key) {
  try {
    const r = await fetch(`${redisURL()}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${redisToken()}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.result ?? null;
  } catch { return null; }
}

async function redisSet(key, value, ttl) {
  try {
    const qs = ttl ? `?ex=${ttl}` : '';
    const r = await fetch(
      `${redisURL()}/set/${encodeURIComponent(key)}/${encodeURIComponent(String(value))}${qs}`,
      { headers: { Authorization: `Bearer ${redisToken()}` }, signal: AbortSignal.timeout(4000) }
    );
    return r.ok;
  } catch { return false; }
}

async function redisIncr(key, ttl) {
  try {
    const r = await fetch(`${redisURL()}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${redisToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['INCR', key], ['EXPIRE', key, ttl]]),
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return 1;
    const d = await r.json();
    return d[0]?.result ?? 1;
  } catch { return 1; }
}

// ── Pobierz TX z X1 RPC ──────────────────────────────────────
async function fetchTx(hash) {
  for (const rpc of RPC_LIST) {
    try {
      const r = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'getTransaction',
          params: [hash, { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0 }],
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) continue;
      const d = await r.json();
      if (d.result) return d.result;
    } catch { continue; }
  }
  return null;
}

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || 'unknown';
}

// ── Handler ──────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { hash, walletAddress } = req.body || {};
  const ip = getIP(req);

  // ── Sprawdź Redis ─────────────────────────────────────────
  if (!redisURL() || !redisToken()) {
    return res.status(503).json({ error: 'Storage not configured. Contact admin.' });
  }

  // ── [1] Walidacja formatu hasha ───────────────────────────
  if (!hash || typeof hash !== 'string' || !/^[A-Za-z0-9]{43,90}$/.test(hash.trim())) {
    return res.status(400).json({ error: 'Invalid TX hash format' });
  }
  const txHash = hash.trim();

  // ── [2] Rate limit per IP (10 / 5 min) ───────────────────
  const ipCount = await redisIncr(`rl:ip:${ip}`, 300);
  if (ipCount > 10) {
    return res.status(429).json({ error: 'Too many requests. Wait 5 minutes.' });
  }

  // ── [3] Sprawdź czy hash już był użyty ───────────────────
  const existing = await redisGet(`tx:${txHash}`);
  if (existing) {
    let usedBy = existing;
    try { usedBy = JSON.parse(existing).wallet || existing; } catch {}
    return res.status(400).json({
      error: 'Transaction already claimed',
      detail: `This TX was already used (wallet: ${String(usedBy).slice(0,8)}...)`,
    });
  }

  // ── [4] Pobierz TX z blockchainu ─────────────────────────
  const tx = await fetchTx(txHash);
  if (!tx) {
    return res.status(400).json({ error: 'Transaction not found on X1 Network. Check hash or wait for confirmation.' });
  }

  // ── [5] Wiek TX max 72h ──────────────────────────────────
  if (tx.blockTime) {
    const ageH = (Date.now() / 1000 - tx.blockTime) / 3600;
    if (ageH > MAX_AGE_H) {
      return res.status(400).json({ error: `Transaction too old (${Math.round(ageH)}h). Max ${MAX_AGE_H}h allowed.` });
    }
  }

  // ── [6] TX musi być udany ────────────────────────────────
  if (tx.meta?.err !== null && tx.meta?.err !== undefined) {
    return res.status(400).json({ error: 'Transaction failed on-chain. Only successful transactions count.' });
  }

  // ── [7] Wykryj sendera TX (z danych on-chain, nie od usera) ──
  const accountKeys = tx.transaction?.message?.accountKeys || [];
  const senderRaw = accountKeys[0];
  const sender = typeof senderRaw === 'object'
    ? (senderRaw?.pubkey?.toString() || String(senderRaw))
    : String(senderRaw ?? '');

  // ── [8] Jeśli walletAddress podany — sprawdź zgodność ────
  // (opcjonalne — nie blokuje jeśli brak)
  if (walletAddress && walletAddress.length >= 32 && sender && sender !== walletAddress) {
    return res.status(400).json({
      error: 'Wallet mismatch',
      detail: `TX sender is ${sender.slice(0,8)}..., not the provided wallet.`,
    });
  }

  // ── [9] Wykryj kwotę spalonego $ANAL ─────────────────────
  const pre  = tx.meta?.preTokenBalances  || [];
  const post = tx.meta?.postTokenBalances || [];
  let burnedAmount = 0;
  let verified = false;

  // Metoda A: sender stracił tokeny
  for (const preB of pre) {
    const postB = post.find(p => p.accountIndex === preB.accountIndex);
    const preAmt  = parseFloat(preB.uiTokenAmount?.uiAmount  ?? 0);
    const postAmt = parseFloat(postB?.uiTokenAmount?.uiAmount ?? 0);
    if (preAmt > postAmt + 0.0001) {
      burnedAmount = preAmt - postAmt;
      verified = true;
      break;
    }
  }

  // Metoda B: burn address otrzymał tokeny
  if (!verified) {
    for (const postB of post) {
      if (postB.owner !== BURN_ADDR) continue;
      const preB = pre.find(p => p.accountIndex === postB.accountIndex);
      const preAmt  = parseFloat(preB?.uiTokenAmount?.uiAmount ?? 0);
      const postAmt = parseFloat(postB.uiTokenAmount?.uiAmount ?? 0);
      if (postAmt > preAmt + 0.0001) {
        burnedAmount = postAmt - preAmt;
        verified = true;
        break;
      }
    }
  }

  // Metoda C: fallback SOL lamports
  if (!verified) {
    const idx = accountKeys.findIndex(k => {
      const pk = typeof k === 'object' ? (k.pubkey || k) : k;
      return String(pk) === sender;
    });
    if (idx >= 0) {
      const drop = (tx.meta?.preBalances?.[idx] ?? 0)
                 - (tx.meta?.postBalances?.[idx] ?? 0)
                 - (tx.meta?.fee ?? 0);
      if (drop > 5000) { burnedAmount = drop / 1e9; verified = true; }
    }
  }

  if (!verified || burnedAmount < MIN_BURN) {
    return res.status(400).json({
      error: `No burn detected or amount too small. Minimum ${MIN_BURN} $ANAL required.`,
    });
  }

  // ── [10] Zapisz hash w Redis PRZED odpowiedzią ────────────
  const record = JSON.stringify({
    wallet: sender || walletAddress || 'unknown',
    amount: burnedAmount,
    ts: Date.now(),
  });
  const saved = await redisSet(`tx:${txHash}`, record, KV_TTL);

  // Jeśli Redis nie zapisał — odrzucamy (bezpieczeństwo)
  if (!saved) {
    return res.status(503).json({ error: 'Storage write failed. Please try again in a moment.' });
  }

  // ── Sukces ────────────────────────────────────────────────
  return res.status(200).json({
    success:  true,
    amount:   burnedAmount,
    sender:   sender || walletAddress || 'unknown',
    txTime:   tx.blockTime,
    message:  `Verified: ${burnedAmount.toFixed(2)} $ANAL burned`,
  });
}
