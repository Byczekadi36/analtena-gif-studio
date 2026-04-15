// api/gallery-like.js
// Increments like count for a gallery item

import { put, head } from '@vercel/blob';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'Missing id' });

    // Fetch current metadata
    const metaUrl = `gallery-meta/${id}.json`;
    
    // We need to find the blob URL first — list to find it
    const { list } = await import('@vercel/blob');
    const { blobs } = await list({ prefix: `gallery-meta/${id}` });
    
    if (!blobs.length) return res.status(404).json({ error: 'Item not found' });

    const resp = await fetch(blobs[0].url);
    if (!resp.ok) return res.status(404).json({ error: 'Metadata not found' });

    const item = await resp.json();
    item.likes = (item.likes || 0) + 1;

    // Save updated metadata
    await put(metaUrl, JSON.stringify(item), {
      access: 'public',
      contentType: 'application/json',
    });

    return res.status(200).json({ likes: item.likes });

  } catch(err) {
    console.error('Like error:', err);
    return res.status(500).json({ error: err.message });
  }
}
