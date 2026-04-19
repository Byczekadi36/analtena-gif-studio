const ANAL_ADDRESS = 'QvDfw6DEVFeVEhsu86auE7wwj1BMp7isBjqEd6MANAL';
const RPC_ENDPOINTS = ['https://rpc.mainnet.x1.xyz','https://xolana.xen.network'];

async function fetchTx(hash) {
  for (const rpc of RPC_ENDPOINTS) {
    try {
      const resp = await fetch(rpc, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          jsonrpc:'2.0', id:1,
          method:'getTransaction',
          params:[hash,{encoding:'jsonParsed',commitment:'confirmed',maxSupportedTransactionVersion:0}]
        })
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data.result) return data.result;
    } catch(e) {}
  }
  return null;
}

function parseAmount(tx, addr) {
  const pre = tx?.meta?.preTokenBalances || [];
  const post = tx?.meta?.postTokenBalances || [];
  for (const p of post) {
    if (p.owner === addr) {
      const preEntry = pre.find(e => e.accountIndex === p.accountIndex);
      const diff = parseInt(p.uiTokenAmount?.amount||'0') - parseInt(preEntry?.uiTokenAmount?.amount||'0');
      if (diff > 0) return Math.floor(diff / Math.pow(10, p.uiTokenAmount?.decimals ?? 9));
    }
  }
  const allIx = [
    ...(tx?.transaction?.message?.instructions||[]),
    ...(tx?.meta?.innerInstructions?.flatMap(i=>i.instructions)||[])
  ];
  for (const ix of allIx) {
    const type = ix.parsed?.type||'';
    const info = ix.parsed?.info||{};
    if (type==='transferChecked' && info.destination===addr)
      return Math.floor(parseInt(info.tokenAmount?.amount||'0')/Math.pow(10,info.tokenAmount?.decimals??9));
    if (type==='transfer' && info.destination===addr)
      return Math.floor(parseInt(info.amount||'0')/Math.pow(10,9));
  }
  return 0;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if (req.method==='OPTIONS') return res.status(200).end();
  if (req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  const {hash} = req.body||{};
  if (!hash||hash.length<40) return res.status(400).json({error:'Invalid hash'});
  const tx = await fetchTx(hash);
  if (!tx) return res.status(404).json({amount:0,error:'TX not found'});
  return res.status(200).json({amount:parseAmount(tx,ANAL_ADDRESS)});
}
