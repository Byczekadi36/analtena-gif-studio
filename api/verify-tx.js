// verify-tx.js — Vercel serverless function
// Detects ANY $ANAL token burn/transfer in a transaction
// Works with burn address (1nc1nerator...) — looks for token DECREASE from sender

const RPC_ENDPOINTS = [
  'https://rpc.mainnet.x1.xyz',
  'https://xolana.xen.network'
];

async function fetchTx(hash) {
  for (const rpc of RPC_ENDPOINTS) {
    try {
      const resp = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'getTransaction',
          params: [hash, {
            encoding: 'jsonParsed',
            commitment: 'finalized',
            maxSupportedTransactionVersion: 0
          }]
        })
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data.result) return data.result;
    } catch (e) {}
  }
  return null;
}

function parseAmount(tx) {
  const pre  = tx?.meta?.preTokenBalances  || [];
  const post = tx?.meta?.postTokenBalances || [];

  // Method 1: Find largest token DECREASE (sender burned/sent tokens)
  // This works regardless of destination — burn address, any wallet
  let amount = 0;
  for (const preB of pre) {
    const postB   = post.find(p => p.accountIndex === preB.accountIndex);
    const preAmt  = parseFloat(preB?.uiTokenAmount?.uiAmount  || 0);
    const postAmt = parseFloat(postB?.uiTokenAmount?.uiAmount || 0);
    const diff    = preAmt - postAmt;
    if (diff > 0 && Math.floor(diff) > amount) {
      amount = Math.floor(diff);
    }
  }
  if (amount > 0) return amount;

  // Method 2: Find largest token INCREASE (receiver got tokens)
  for (const postB of post) {
    const preB    = pre.find(p => p.accountIndex === postB.accountIndex);
    const preAmt  = parseFloat(preB?.uiTokenAmount?.uiAmount  || 0);
    const postAmt = parseFloat(postB?.uiTokenAmount?.uiAmount || 0);
    const diff    = postAmt - preAmt;
    if (diff > 0 && Math.floor(diff) > amount) {
      amount = Math.floor(diff);
    }
  }
  if (amount > 0) return amount;

  // Method 3: Parse instructions — transfer, transferChecked, burn, burnChecked
  const allIx = [
    ...(tx?.transaction?.message?.instructions || []),
    ...(tx?.meta?.innerInstructions?.flatMap(i => i.instructions) || [])
  ];
  for (const ix of allIx) {
    const type = ix.parsed?.type || '';
    const info = ix.parsed?.info || {};
    if (['transfer', 'transferChecked', 'burn', 'burnChecked'].includes(type)) {
      const raw    = parseInt(info.tokenAmount?.amount || info.amount || '0');
      const dec    = parseInt(info.tokenAmount?.decimals ?? 9);
      const parsed = dec > 0 ? Math.floor(raw / Math.pow(10, dec)) : raw;
      if (parsed > amount) amount = parsed;
    }
  }

  return amount;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { hash } = req.body || {};
  if (!hash || hash.length < 40) return res.status(400).json({ error: 'Invalid hash' });

  const tx = await fetchTx(hash);
  if (!tx) return res.status(404).json({ amount: 0, error: 'TX not found on X1 Network' });

  const amount = parseAmount(tx);
  return res.status(200).json({ amount });
}
