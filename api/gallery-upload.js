// api/gallery-upload.js
// Uploads image to Vercel Blob Storage + saves metadata

import { put, list } from '@vercel/blob';

export const config = {
  api: { bodyParser: false }
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Parse multipart form data manually
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);

    // Extract boundary from content-type
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
    if (!boundaryMatch) return res.status(400).json({ error: 'No boundary in multipart' });

    const boundary = '--' + boundaryMatch[1];
    const parts = parseMultipart(body, boundary);

    const filePart = parts.find(p => p.name === 'file');
    const nick = (parts.find(p => p.name === 'nick')?.value || 'Anonymous').slice(0, 30);
    const tag = (parts.find(p => p.name === 'tag')?.value || 'meme').slice(0, 20);

    if (!filePart) return res.status(400).json({ error: 'No file provided' });
    if (filePart.data.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'File too large (max 5MB)' });

    const ext = filePart.filename?.split('.').pop()?.toLowerCase() || 'jpg';
    const validExts = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
    if (!validExts.includes(ext)) return res.status(400).json({ error: 'Invalid file type' });

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const filename = `gallery/${id}.${ext}`;

    // Upload image to Vercel Blob
    const blob = await put(filename, filePart.data, {
      access: 'public',
      contentType: filePart.contentType || 'image/jpeg',
    });

    // Save metadata as JSON blob
    const item = {
      id,
      url: blob.url,
      nick: nick.startsWith('@') ? nick : '@' + nick,
      tag,
      likes: 0,
      createdAt: Date.now(),
    };

    await put(`gallery-meta/${id}.json`, JSON.stringify(item), {
      access: 'public',
      contentType: 'application/json',
    });

    return res.status(200).json({ item });

  } catch(err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// Simple multipart parser
function parseMultipart(body, boundary) {
  const parts = [];
  const sep = Buffer.from('\r\n' + boundary);
  const start = Buffer.from(boundary);

  let pos = body.indexOf(start);
  if (pos === -1) return parts;
  pos += start.length;

  while (pos < body.length) {
    if (body[pos] === 45 && body[pos+1] === 45) break; // '--'
    if (body[pos] === 13 && body[pos+1] === 10) pos += 2; // CRLF

    // Find end of headers
    const headerEnd = indexOf(body, Buffer.from('\r\n\r\n'), pos);
    if (headerEnd === -1) break;

    const headerStr = body.slice(pos, headerEnd).toString();
    const dataStart = headerEnd + 4;

    const nextBoundary = indexOf(body, sep, dataStart);
    const dataEnd = nextBoundary === -1 ? body.length - 2 : nextBoundary;

    const data = body.slice(dataStart, dataEnd);

    // Parse headers
    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const filenameMatch = headerStr.match(/filename="([^"]+)"/);
    const ctMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);

    const part = {
      name: nameMatch?.[1] || '',
      filename: filenameMatch?.[1] || '',
      contentType: ctMatch?.[1]?.trim() || 'text/plain',
      data,
    };

    if (!part.filename) {
      part.value = data.toString().trim();
    }

    parts.push(part);

    if (nextBoundary === -1) break;
    pos = nextBoundary + sep.length;
  }

  return parts;
}

function indexOf(buf, search, start = 0) {
  for (let i = start; i <= buf.length - search.length; i++) {
    let found = true;
    for (let j = 0; j < search.length; j++) {
      if (buf[i+j] !== search[j]) { found = false; break; }
    }
    if (found) return i;
  }
  return -1;
}
