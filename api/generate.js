// api/generate.js
// Claude (Anthropic) — wymyśla scenę i prompty dla każdej klatki
// Replicate (Flux) — generuje prawdziwe obrazy AI dla każdej klatki

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

  const { prompt, frameCount = 6, artStyle = 'cartoon' } = req.body;
  if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt jest wymagany' });

  const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY;
  const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;

  if (!ANTHROPIC_KEY)   return res.status(500).json({ error: 'Brak klucza Anthropic' });
  if (!REPLICATE_TOKEN) return res.status(500).json({ error: 'Brak klucza Replicate' });

  const stylePrompts = {
    cartoon:  'cartoon illustration, vibrant colors, bold outlines, comic book style, fun and energetic',
    pixel:    '16-bit pixel art, retro game style, chunky pixels, nostalgic',
    neon:     'cyberpunk neon art, dark background, glowing neon lights, futuristic',
    sketch:   'pencil sketch, hand-drawn illustration, expressive lines, artistic',
    retro:    '80s retro synthwave poster art, vintage colors, sunset gradient',
  };
  const styleDesc = stylePrompts[artStyle] || stylePrompts.cartoon;
  const count = Math.min(parseInt(frameCount) || 6, 6);

  // ── KROK 1: Claude generuje prompty dla każdej klatki ──────────────
  let frameImagePrompts;
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
        max_tokens: 2000,
        system: `Jesteś ekspertem od animacji i crypto meme art dla społeczności Analtena ($ANAL token).
Tworzysz sekwencje obrazów które razem tworzą płynną animację GIF.
Odpowiadaj TYLKO w JSON — bez markdown, bez wyjaśnień.`,
        messages: [{
          role: 'user',
          content: `Stwórz ${count} promptów do obrazów AI dla animacji GIF na temat: "${prompt.trim()}"
Styl artystyczny: ${styleDesc}

Każdy prompt musi:
- Być po angielsku (dla modelu AI)
- Opisywać JEDEN kadr animacji
- Tworzyć razem płynną historię/animację
- Zawierać crypto/meme elementy ($ANAL token, rakiety, księżyc, diamenty, wykresy)
- Kończyć się: "${styleDesc}, high quality, detailed, square format, no text"

JSON tylko, bez markdown:
{
  "title": "Tytuł GIF po polsku max 30 znaków",
  "frames": [
    {"prompt": "detailed image prompt in English...", "description": "co dzieje się w tej klatce po polsku"}
  ]
}`,
        }],
      }),
    });

    if (!claudeResp.ok) throw new Error('Claude API error: ' + claudeResp.status);
    const claudeData = await claudeResp.json();
    const raw = claudeData.content?.find(b => b.type === 'text')?.text || '';
    let parsed;
    try { parsed = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
    catch { const m = raw.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); else throw new Error('Błąd parsowania odpowiedzi Claude'); }
    frameImagePrompts = parsed;
  } catch (err) {
    return res.status(500).json({ error: 'Claude error: ' + err.message });
  }

  // ── KROK 2: Replicate (Flux) generuje obrazy ───────────────────────
  const images = [];
  const frames = frameImagePrompts.frames || [];

  for (let i = 0; i < frames.length; i++) {
    const imagePrompt = frames[i].prompt;
    console.log(`Generating frame ${i+1}/${frames.length}: ${imagePrompt.slice(0,60)}...`);
    try {
      // Uruchom Flux Schnell — prefer:wait czeka aż skończy (do 60s)
      const startResp = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${REPLICATE_TOKEN}`,
          'Prefer': 'wait=60',
        },
        body: JSON.stringify({
          input: {
            prompt: imagePrompt,
            num_outputs: 1,
            aspect_ratio: '1:1',
            output_format: 'webp',
            output_quality: 90,
            num_inference_steps: 4,
          },
        }),
      });

      if (!startResp.ok) {
        const err = await startResp.json();
        throw new Error(err.detail || 'Replicate start error: ' + startResp.status);
      }

      let prediction = await startResp.json();

      // Czekaj aż obraz będzie gotowy (max 45 sekund)
      let attempts = 0;
      while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && attempts < 22) {
        await new Promise(r => setTimeout(r, 2000));
        const pollResp = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
          headers: { 'Authorization': `Bearer ${REPLICATE_TOKEN}` },
        });
        prediction = await pollResp.json();
        attempts++;
        console.log(`Frame ${i+1} status: ${prediction.status} (attempt ${attempts})`);
      }

      if (prediction.status === 'failed') throw new Error('Replicate generation failed');
      if (!prediction.output?.[0]) throw new Error('Brak obrazu w odpowiedzi');

      images.push({
        url: prediction.output[0],
        description: frames[i].description || '',
      });

    } catch (err) {
      console.error(`Frame ${i+1} error:`, err.message);
      // Dodaj placeholder jeśli klatka się nie wygenerowała
      images.push({ url: null, description: frames[i].description || '', error: err.message });
    }
  }

  return res.status(200).json({
    mode: 'replicate',
    title: frameImagePrompts.title || prompt.slice(0, 30),
    images,
  });
}
