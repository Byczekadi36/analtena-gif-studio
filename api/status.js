// api/status.js
// Odpytuje Replicate o status generowania obrazu
// Frontend wywołuje co 2 sekundy aż status = 'succeeded'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Brak prediction ID' });

  const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;
  if (!REPLICATE_TOKEN) return res.status(500).json({ error: 'Brak klucza Replicate' });

  try {
    const resp = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: { 'Authorization': `Bearer ${REPLICATE_TOKEN}` },
    });

    if (!resp.ok) throw new Error('Status check error: ' + resp.status);
    const prediction = await resp.json();

    return res.status(200).json({
      id: prediction.id,
      status: prediction.status,           // 'starting' | 'processing' | 'succeeded' | 'failed'
      imageUrl: prediction.output?.[0] || null,
      error: prediction.error || null,
      metrics: prediction.metrics || null,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
