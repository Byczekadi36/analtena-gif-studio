// api/gallery-list.js
// Returns all gallery items from Vercel Blob Storage

import { list } from '@vercel/blob';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // List all metadata files
    const { blobs } = await list({ prefix: 'gallery-meta/' });

    const items = await Promise.all(
      blobs.map(async blob => {
        try {
          const resp = await fetch(blob.url);
          if (!resp.ok) return null;
          return await resp.json();
        } catch(e) {
          return null;
        }
      })
    );

    const validItems = items.filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);

    return res.status(200).json({ items: validItems });

  } catch(err) {
    console.error('Gallery list error:', err);
    return res.status(500).json({ error: err.message, items: [] });
  }
}
