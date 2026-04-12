// api/generate.js — DALL-E 3 + Claude fallback + X1 blockchain payment verification

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const { prompt, frameCount = 6, artStyle = 'cartoon', walletAddress, txSignature } = req.body;

  if (!prompt?.trim()) return res.status(400).json({ error: 'prompt is required' });

  // ── VERIFY X1 PAYMENT ──────────────────────────────────────────────
  const ANAL_MINT = 'EFPkbXTdr3c7aRbCEKoJDYdbbzgzVDBShYGybP3gQwmy';
  const X1_RPC   = 'https://rpc.mainnet.x1.xyz';
  const FEE_WALLET = process.env.FEE_WALLET_ADDRESS; // your wallet that receives ANAL fees
  const REQUIRED_ANAL = 100; // 100 ANAL per GIF

  if (walletAddress && txSignature && FEE_WALLET) {
    try {
      // Verify the transaction on X1 blockchain
      const rpcResp = await fetch(X1_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'getTransaction',
          params: [txSignature, { encoding: 'jsonParsed', commitment: 'confirmed' }],
        }),
      });
      const rpcData = await rpcResp.json();
      const tx = rpcData?.result;

      if (!tx) return res.status(402).json({ error: 'Transaction not found on X1. Please try again.' });
      if (tx.meta?.err) return res.status(402).json({ error: 'Transaction failed on chain.' });

      // Check token transfer to fee wallet
      const tokenBalances = tx.meta?.postTokenBalances || [];
      const transfer = tokenBalances.find(b =>
        b.mint === ANAL_MINT &&
        b.owner === FEE_WALLET
      );

      if (!transfer) return res.status(402).json({ error: 'ANAL payment not detected in transaction.' });

    } catch (err) {
      console.error('X1 verification error:', err);
      // Don't block if RPC is down — log and continue
    }
  }

  // ── DALL-E 3 IMAGE GENERATION ──────────────────────────────────────
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

  if (OPENAI_KEY) {
    try {
      const styleMap = {
        cartoon: 'cartoon style, vibrant colors, comic book art, bold outlines, fun',
        pixel:   'pixel art style, 16-bit retro game art, chunky pixels, nostalgic',
        neon:    'neon glow cyberpunk style, dark background, glowing neon colors',
        sketch:  'pencil sketch style, hand-drawn, expressive lines, color accents',
        retro:   'retro 80s synthwave style, vintage poster art, sunset colors',
      };
      const styleDesc = styleMap[artStyle] || styleMap.cartoon;
      const phases = ['establishing shot', 'building energy', 'peak action', 'climax', 'triumphant', 'celebration finale'];
      const framePrompts = Array.from({ length: Math.min(frameCount, 6) }, (_, i) =>
        `${prompt}. ${styleDesc}. Crypto meme art for Analtena $ANAL token community. ${phases[i] || phases[0]}. No text overlays. Clean square composition. Highly detailed.`
      );

      const images = [];
      for (const fp of framePrompts) {
        const r = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
          body: JSON.stringify({ model: 'dall-e-3', prompt: fp, n: 1, size: '1024x1024', quality: 'hd', response_format: 'b64_json' }),
        });
        if (!r.ok) throw new Error((await r.json()).error?.message || 'DALL-E error');
        const d = await r.json();
        images.push('data:image/png;base64,' + d.data[0].b64_json);
      }
      return res.status(200).json({ mode: 'dalle', title: prompt.slice(0, 40), images });
    } catch (err) {
      console.error('DALL-E failed, using Claude:', err.message);
    }
  }

  // ── CLAUDE CANVAS FALLBACK ─────────────────────────────────────────
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'No AI key configured' });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: 'You are a GIF animation designer for Analtena ($ANAL crypto token). Respond ONLY with valid JSON, no markdown.',
        messages: [{ role: 'user', content: `Create ${Math.min(frameCount,8)}-frame GIF: "${prompt}" style:${artStyle}. JSON: {"title":"...","frames":[{"description":"...","bgColor":"#hex","bgGradient":{"from":"#hex","to":"#hex"},"elements":[{"type":"emoji","value":"🚀","x":0.5,"y":0.5,"size":0.3},{"type":"text","value":"ANAL TO MOON","x":0.5,"y":0.1,"size":0.09,"color":"#FFE500","outline":true},{"type":"stars","count":30,"color":"#fff"},{"type":"bars","values":[0.3,0.7,0.9,0.5,0.8],"color":"#00ff88","glow":true},{"type":"rain","emoji":"💰","count":15},{"type":"burst","x":0.5,"y":0.5,"rays":12,"color":"#FFE500"},{"type":"circle","x":0.8,"y":0.2,"r":0.1,"color":"#ff2d78","glow":true}]}]}. Vary bgColor dramatically per frame. Move elements across frames. Use 7+ elements per frame.` }],
      }),
    });
    if (!r.ok) throw new Error('Anthropic error: ' + r.status);
    const d = await r.json();
    const raw = d.content?.find(b => b.type === 'text')?.text || '';
    let scene;
    try { scene = JSON.parse(raw.replace(/```json|```/g,'').trim()); }
    catch { const m = raw.match(/\{[\s\S]*\}/); if(m) scene=JSON.parse(m[0]); else throw new Error('Parse error'); }
    return res.status(200).json({ mode: 'canvas', scene });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
