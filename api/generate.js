// api/generate.js
// Vercel serverless function — keeps your Anthropic API key safe on the server.
// The browser never sees the key. It only talks to /api/generate.

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Basic CORS — tighten this to your domain in production
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const { prompt, frameCount, artStyle } = req.body;

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  const systemPrompt = `You are a GIF animation designer for a crypto meme community called Analtena ($ANAL token on Solana). 
You create vivid, funny, high-energy GIF animations.
Always respond ONLY with valid JSON — no markdown, no explanation, just JSON.`;

  const userPrompt = `Create a ${frameCount || 8}-frame animated GIF based on this idea: "${prompt.trim()}"
Art style: ${artStyle || 'cartoon'}

Respond ONLY with this JSON structure (no markdown, no backticks):
{
  "title": "short gif title",
  "bgColor": "#hexcolor",
  "frames": [
    {
      "description": "what to draw in this frame",
      "bgColor": "#hexcolor",
      "elements": [
        {"type": "emoji",   "value": "🚀", "x": 0.5,  "y": 0.5,  "size": 0.25},
        {"type": "text",    "value": "TO THE MOON", "x": 0.5, "y": 0.15, "size": 0.08, "color": "#FFE500"},
        {"type": "rect",    "x": 0.1, "y": 0.8, "w": 0.8, "h": 0.05, "color": "#00ffcc", "alpha": 0.7},
        {"type": "circle",  "x": 0.5, "y": 0.5, "r": 0.1, "color": "#ff2d78"},
        {"type": "stars",   "count": 20, "color": "#ffffff"},
        {"type": "bars",    "values": [0.3,0.6,0.9,0.5,0.8], "color": "#00ff88"},
        {"type": "rain",    "emoji": "💰", "count": 10},
        {"type": "line",    "x1": 0.0, "y1": 0.7, "x2": 1.0, "y2": 0.3, "color": "#00ffcc", "width": 0.008}
      ]
    }
  ]
}

Rules:
- x, y, size, r, w, h are all fractions of canvas size (0.0 to 1.0)
- Vary bgColor per frame to create movement
- Animate positions across frames (move elements progressively)
- Be creative and crypto-meme-appropriate
- Each frame should feel different from the last`;

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      console.error('Anthropic API error:', upstream.status, errText);
      return res.status(upstream.status).json({ error: 'AI service error', detail: upstream.status });
    }

    const data = await upstream.json();
    const rawText = data.content?.find(b => b.type === 'text')?.text || '';

    // Parse & validate JSON from Claude
    let scene;
    try {
      const clean = rawText.replace(/```json|```/g, '').trim();
      scene = JSON.parse(clean);
    } catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        scene = JSON.parse(match[0]);
      } else {
        throw new Error('Could not parse AI response');
      }
    }

    if (!scene.frames || !Array.isArray(scene.frames)) {
      throw new Error('Invalid scene structure from AI');
    }

    return res.status(200).json({ scene });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
