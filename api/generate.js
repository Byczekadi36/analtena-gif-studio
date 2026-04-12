// api/generate.js
// Architektura: fire-and-forget
// 1. Claude generuje prompt obrazu
// 2. Replicate startuje generowanie (bez czekania)
// 3. Zwracamy prediction_id do frontendu
// 4. Frontend odpytuje /api/status co 2 sekundy

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

  const { prompt, artStyle = 'cartoon', frameCount = 4 } = req.body;
  if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt jest wymagany' });

  const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY;
  const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;

  if (!ANTHROPIC_KEY)   return res.status(500).json({ error: 'Brak klucza Anthropic' });
  if (!REPLICATE_TOKEN) return res.status(500).json({ error: 'Brak klucza Replicate' });

  const styleMap = {
    cartoon: 'cartoon illustration, vibrant colors, bold outlines, comic book style',
    pixel:   '16-bit pixel art, retro game style, chunky pixels',
    neon:    'cyberpunk neon art, dark background, glowing neon colors',
    sketch:  'pencil sketch, hand-drawn, expressive lines',
    retro:   '80s retro synthwave poster art, vintage colors',
  };
  const styleDesc = styleMap[artStyle] || styleMap.cartoon;

  // ── KROK 1: Claude tworzy optymalny prompt obrazu ─────────────────
  let imagePrompt, title;
  try {
    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        system: 'Jesteś ekspertem od tworzenia promptów dla modeli generowania obrazów AI. Odpowiadaj TYLKO w JSON bez markdown.',
        messages: [{
          role: 'user',
          content: `Stwórz jeden doskonały prompt po angielsku dla modelu Flux do wygenerowania obrazu GIF na temat: "${prompt.trim()}"
Styl: ${styleDesc}
Dodaj elementy crypto/meme: sowa Analtena, rakieta, księżyc, diamenty, wykresy.

JSON bez markdown:
{"title": "tytuł po polsku max 25 znaków", "prompt": "detailed English image prompt for Flux Pro image generator. ${styleDesc}. Analtena owl mascot (cute cartoon owl holding eggplants). Crypto meme art. Vibrant colors. Highly detailed. Professional quality. Cinematic lighting. Sharp focus. Square format. No text overlays."}`,
        }],
      }),
    });

    if (!claudeResp.ok) throw new Error('Claude error: ' + claudeResp.status);
    const claudeData = await claudeResp.json();
    const raw = claudeData.content?.find(b => b.type === 'text')?.text || '';
    let parsed;
    try { parsed = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
    catch { const m = raw.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : null; }

    imagePrompt = parsed?.prompt || `${prompt}, ${styleDesc}, crypto meme art, owl mascot, vibrant colors`;
    title = parsed?.title || prompt.slice(0, 25);

  } catch (err) {
    // Fallback prompt jeśli Claude zawiedzie
    imagePrompt = `${prompt}, ${styleDesc}, crypto meme art, Analtena owl mascot, vibrant colors, highly detailed`;
    title = prompt.slice(0, 25);
  }

  // ── KROK 2: Wyślij zadanie do Replicate (fire and forget) ──────────
  try {
    const replicateResp = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro/predictions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${REPLICATE_TOKEN}`,
      },
      body: JSON.stringify({
        input: {
          prompt: imagePrompt,
          aspect_ratio: '1:1',
          output_format: 'webp',
          output_quality: 100,
          safety_tolerance: 6,
          prompt_upsampling: true,
        },
      }),
    });

    if (!replicateResp.ok) {
      const err = await replicateResp.json();
      throw new Error(err.detail || 'Replicate error: ' + replicateResp.status);
    }

    const prediction = await replicateResp.json();

    // Zwróć natychmiast prediction_id — frontend będzie odpytywać status
    return res.status(200).json({
      predictionId: prediction.id,
      title,
      imagePrompt,
      frameCount: parseInt(frameCount) || 4,
      artStyle,
      status: prediction.status,
    });

  } catch (err) {
    console.error('Replicate error:', err);
    return res.status(500).json({ error: err.message });
  }
}
