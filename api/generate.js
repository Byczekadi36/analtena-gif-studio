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

  const { prompt, artStyle = 'cartoon', frameCount = 4, promptOnly = false, userPrompt = '' } = req.body;

  // Handle promptOnly mode — generate a random prompt idea
  if (promptOnly) {
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'Brak klucza Anthropic' });
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 80,
        messages: [{ role: 'user', content: userPrompt || 'Generate a creative GIF prompt about $ANAL Analtena crypto token. Max 20 words, vivid, animation-friendly.' }],
        system: 'You are a creative prompt generator for AI image/GIF generation. Reply ONLY with the prompt text, nothing else, no quotes, no explanation.'
      })
    });
    const d = await r.json();
    const randomPrompt = d?.content?.[0]?.text?.trim() || '';
    return res.status(200).json({ randomPrompt });
  }

  if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt jest wymagany' });

  const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY;
  const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;

  if (!ANTHROPIC_KEY)   return res.status(500).json({ error: 'Brak klucza Anthropic' });
  if (!REPLICATE_TOKEN) return res.status(500).json({ error: 'Brak klucza Replicate' });

  const styleMap = {
    cartoon:   'cartoon illustration, vibrant colors, bold outlines, comic book style, Disney Pixar quality',
    pixel:     '16-bit pixel art, retro game style, chunky pixels, sharp edges, limited palette',
    neon:      'cyberpunk neon art, dark background, glowing neon colors, synthwave aesthetic',
    anime:     'anime illustration style, clean lines, vivid colors, Studio Ghibli inspired, cel shading',
    oil:       'oil painting masterpiece, rich textures, impressionist brushstrokes, gallery quality, dramatic lighting',
    watercolor:'watercolor painting, soft washes, organic edges, artistic, pastel tones, paper texture',
    render3d:  'hyper-realistic 3D render, octane render, photorealistic, ray tracing, 8K quality, cinematic',
    comic:     'Marvel comic book style, bold ink lines, halftone dots, dynamic action pose, dramatic',
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
        system: 'You are an expert AI image prompt engineer for Flux image generation. Reply ONLY with valid JSON, no markdown, no explanation.',
        messages: [{
          role: 'user',
          content: `Create a perfect Flux image generation prompt for this concept: "${prompt.trim()}"
Style: ${styleDesc}

Rules:
- Stay TRUE to the user's concept — do NOT add owls or Analtena unless the user mentioned them
- Make it vivid, cinematic, highly detailed
- Optimize for animated GIF: dynamic composition, motion-friendly
- Square format, no text overlays
- Max 60 words for the prompt

Reply with JSON only:
{"title": "short title max 25 chars", "prompt": "detailed English Flux prompt, ${styleDesc}, vibrant, highly detailed, dynamic composition, cinematic lighting, square format, no text"}`,
        }],
      }),
    });

    if (!claudeResp.ok) throw new Error('Claude error: ' + claudeResp.status);
    const claudeData = await claudeResp.json();
    const raw = claudeData.content?.find(b => b.type === 'text')?.text || '';
    let parsed;
    try { parsed = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
    catch { const m = raw.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : null; }

    imagePrompt = parsed?.prompt || `${prompt}, ${styleDesc}, vibrant colors, cinematic lighting, highly detailed, dynamic composition`;
    title = parsed?.title || prompt.slice(0, 25);

  } catch (err) {
    // Fallback prompt jeśli Claude zawiedzie
    imagePrompt = `${prompt}, ${styleDesc}, vibrant colors, cinematic lighting, highly detailed, dynamic composition, square format`;
    title = prompt.slice(0, 25);
  }

  // ── KROK 2: Wyślij zadanie do Replicate (fire and forget) ──────────
  try {
    // Quality mode: flux-dev (better quality, ~15s), Speed mode: flux-schnell (~5s)
    const qualityMode = req.body.quality === 'high';
    const modelUrl = qualityMode
      ? 'https://api.replicate.com/v1/models/black-forest-labs/flux-dev/predictions'
      : 'https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions';

    const replicateResp = await fetch(modelUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${REPLICATE_TOKEN}`,
      },
      body: JSON.stringify({
        input: {
          prompt: imagePrompt,
          num_outputs: 1,
          aspect_ratio: '1:1',
          output_format: 'webp',
          output_quality: 95,
          num_inference_steps: qualityMode ? 28 : 4,
          guidance: qualityMode ? 3.5 : undefined,
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
