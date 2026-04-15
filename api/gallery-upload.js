// api/gallery-upload.js
// Uses @vercel/blob to store images

export const config = {
  api: { bodyParser: false }
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'BLOB_READ_WRITE_TOKEN not set' });
  }

  try {
    // Read raw body
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);

    const ct = req.headers['content-type'] || '';
    const bm = ct.match(/boundary=([^\s;]+)/);
    if (!bm) return res.status(400).json({ error: 'No multipart boundary' });

    const parts = parseMultipart(body, '--' + bm[1]);
    const filePart = parts.find(p => p.name === 'file');
    const nick = (parts.find(p => p.name === 'nick')?.value || 'Anonymous').slice(0, 30);
    const tag  = (parts.find(p => p.name === 'tag')?.value  || 'meme').slice(0, 20);

    if (!filePart?.data?.length) return res.status(400).json({ error: 'No file data' });
    if (filePart.data.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Max 5MB' });

    const ext = (filePart.filename?.split('.').pop() || 'jpg').toLowerCase();
    if (!['jpg','jpeg','png','webp','gif'].includes(ext)) {
      return res.status(400).json({ error: 'Invalid file type' });
    }

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
    const imgType = filePart.contentType || 'image/jpeg';

    // Upload image via Vercel Blob REST API directly (no SDK needed)
    const blobRes = await fetch(`https://blob.vercel-storage.com/gallery/${id}.${ext}`, {
      method: 'PUT',
      headers: {
        'authorization': `Bearer ${token}`,
        'content-type': imgType,
        'x-api-version': '7',
        'x-add-random-suffix': '0',
        'x-cache-control-max-age': '31536000',
      },
      body: filePart.data,
    });

    if (!blobRes.ok) {
      const errText = await blobRes.text();
      throw new Error('Blob upload failed: ' + errText);
    }

    const blobData = await blobRes.json();
    const imageUrl = blobData.url;

    // Save metadata
    const item = {
      id, url: imageUrl,
      nick: nick.startsWith('@') ? nick : '@' + nick,
      tag, likes: 0, createdAt: Date.now()
    };

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

    return res.status(200).json({ item });

  } catch(err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: err.message });
  }
}

function parseMultipart(body, boundary) {
  const parts = [];
  const sep = Buffer.from(boundary);
  const crlfcrlf = Buffer.from('\r\n\r\n');

  let pos = indexOf(body, sep, 0);
  if (pos === -1) return parts;

  while (true) {
    pos += sep.length;
    if (pos >= body.length || (body[pos]===45 && body[pos+1]===45)) break;
    if (body[pos]===13 && body[pos+1]===10) pos += 2;

    const hEnd = indexOf(body, crlfcrlf, pos);
    if (hEnd === -1) break;

    const headers = body.slice(pos, hEnd).toString();
    const dStart = hEnd + 4;
    const nextSep = indexOf(body, Buffer.from('\r\n' + boundary), dStart);
    const dEnd = nextSep === -1 ? body.length : nextSep;

    const nm = headers.match(/name="([^"]+)"/);
    const fm = headers.match(/filename="([^"]+)"/);
    const cm = headers.match(/Content-Type:\s*([^\r\n]+)/i);

    const part = {
      name: nm?.[1] || '',
      filename: fm?.[1] || '',
      contentType: cm?.[1]?.trim() || 'text/plain',
      data: body.slice(dStart, dEnd),
    };
    if (!part.filename) part.value = part.data.toString().trim();
    parts.push(part);
    if (nextSep === -1) break;
    pos = nextSep + 2;
  }
  return parts;
}

function indexOf(buf, search, start = 0) {
  outer: for (let i = start; i <= buf.length - search.length; i++) {
    for (let j = 0; j < search.length; j++) {
      if (buf[i+j] !== search[j]) continue outer;
    }
    return i;
  }
  return -1;
}
