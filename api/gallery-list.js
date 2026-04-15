// api/gallery-list.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return res.status(200).json({ items: [] });

  try {
    // List blobs via REST API
    const listRes = await fetch('https://blob.vercel-storage.com?prefix=gallery-meta%2F&limit=100', {
      headers: {
        'authorization': `Bearer ${token}`,
        'x-api-version': '7',
      }
    });

    if (!listRes.ok) {
      const t = await listRes.text();
      throw new Error('List failed: ' + t);
    }

    const { blobs } = await listRes.json();

    const items = await Promise.all(
      (blobs || []).map(async blob => {
        try {
          const r = await fetch(blob.url);
          if (!r.ok) return null;
          return await r.json();
        } catch { return null; }
      })
    );

    const valid = items.filter(Boolean).sort((a,b) => b.createdAt - a.createdAt);
    return res.status(200).json({ items: valid });

  } catch(err) {
    console.error('List error:', err);
    return res.status(200).json({ items: [], error: err.message });
  }
}
