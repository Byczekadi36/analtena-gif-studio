// api/gallery-like.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return res.status(500).json({ error: 'No token' });

  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Missing id' });

    // List to find the blob URL
    const listRes = await fetch(`https://blob.vercel-storage.com?prefix=gallery-meta%2F${id}&limit=1`, {
      headers: { 'authorization': `Bearer ${token}`, 'x-api-version': '7' }
    });
    const { blobs } = await listRes.json();
    if (!blobs?.length) return res.status(404).json({ error: 'Not found' });

    const r = await fetch(blobs[0].url);
    const item = await r.json();
    item.likes = (item.likes || 0) + 1;

    await fetch(`https://blob.vercel-storage.com/gallery-meta/${id}.json`, {
      method: 'PUT',
      headers: {
        'authorization': `Bearer ${token}`,
        'content-type': 'application/json',
        'x-api-version': '7',
        'x-add-random-suffix': '0',
      },
      body: JSON.stringify(item),
    });

    return res.status(200).json({ likes: item.likes });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
}
