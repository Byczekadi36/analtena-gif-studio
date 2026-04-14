// api/export.js
// Backend GIF encoder — receives base64 frames from frontend,
// encodes GIF server-side, returns download URL as blob
// No native deps — uses pure-JS gifenc via CDN import

// Simple GIF encoder — pure JS implementation
// LZW compression + GIF89a format
function encodeGIF(frames, width, height, delay) {
  // Convert delay from ms to centiseconds
  const delayCentiseconds = Math.round(delay / 10);

  const chunks = [];

  // ── GIF Header ──
  chunks.push(strToBytes('GIF89a'));

  // Logical Screen Descriptor
  chunks.push(wordLE(width));
  chunks.push(wordLE(height));
  chunks.push(new Uint8Array([
    0x00,  // Global Color Table Flag = 0 (no global palette)
    0x00,  // Background color index
    0x00   // Pixel aspect ratio
  ]));

  // Netscape Application Extension (looping)
  chunks.push(new Uint8Array([
    0x21, 0xFF, 0x0B,
    ...strToBytes('NETSCAPE2.0'),
    0x03, 0x01,
    0x00, 0x00, // loop count 0 = infinite
    0x00
  ]));

  for (let f = 0; f < frames.length; f++) {
    const { palette, indices } = frames[f];

    // Graphic Control Extension
    chunks.push(new Uint8Array([
      0x21, 0xF9, 0x04,
      0x00,                        // disposal method
      delayCentiseconds & 0xFF,    // delay low
      (delayCentiseconds >> 8) & 0xFF, // delay high
      0x00,                        // transparent color index
      0x00                         // block terminator
    ]));

    // Image Descriptor
    chunks.push(new Uint8Array([0x2C]));
    chunks.push(wordLE(0)); // left
    chunks.push(wordLE(0)); // top
    chunks.push(wordLE(width));
    chunks.push(wordLE(height));
    // Local Color Table Flag=1, size = 7 (256 colors)
    chunks.push(new Uint8Array([0x80 | 7]));

    // Local Color Table (256 * 3 bytes)
    const ctBytes = new Uint8Array(256 * 3);
    for (let i = 0; i < palette.length && i < 256; i++) {
      ctBytes[i*3]   = palette[i][0];
      ctBytes[i*3+1] = palette[i][1];
      ctBytes[i*3+2] = palette[i][2];
    }
    chunks.push(ctBytes);

    // LZW minimum code size
    const minCodeSize = 8;
    chunks.push(new Uint8Array([minCodeSize]));

    // LZW compressed data
    const lzwData = lzwEncode(indices, minCodeSize);
    // Split into sub-blocks of max 255 bytes
    let i = 0;
    while (i < lzwData.length) {
      const blockSize = Math.min(255, lzwData.length - i);
      chunks.push(new Uint8Array([blockSize]));
      chunks.push(lzwData.slice(i, i + blockSize));
      i += blockSize;
    }
    chunks.push(new Uint8Array([0x00])); // block terminator
  }

  // GIF Trailer
  chunks.push(new Uint8Array([0x3B]));

  // Concatenate all chunks
  const totalLength = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function wordLE(n) {
  return new Uint8Array([n & 0xFF, (n >> 8) & 0xFF]);
}

function strToBytes(s) {
  return new Uint8Array([...s].map(c => c.charCodeAt(0)));
}

// LZW encoder for GIF
function lzwEncode(indices, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const eofCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eofCode + 1;

  const table = new Map();
  const initTable = () => {
    table.clear();
    codeSize = minCodeSize + 1;
    nextCode = eofCode + 1;
  };

  const bits = [];
  let bitBuffer = 0, bitCount = 0;
  const output = [];

  const writeBits = (code) => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      output.push(bitBuffer & 0xFF);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  };

  initTable();
  writeBits(clearCode);

  let index = 0;
  let prefix = indices[index++];

  while (index < indices.length) {
    const pixel = indices[index++];
    const key = prefix * 4096 + pixel;
    if (table.has(key)) {
      prefix = table.get(key);
    } else {
      writeBits(prefix);
      if (nextCode < 4096) {
        table.set(key, nextCode++);
        if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
      } else {
        writeBits(clearCode);
        initTable();
      }
      prefix = pixel;
    }
  }
  writeBits(prefix);
  writeBits(eofCode);
  if (bitCount > 0) output.push(bitBuffer & 0xFF);

  return new Uint8Array(output);
}

// Quantize RGBA pixel array to 256 colors
function quantize(pixels, width, height) {
  // Build color histogram
  const hist = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]   & 0xF8;
    const g = pixels[i+1] & 0xF8;
    const b = pixels[i+2] & 0xF8;
    const key = (r << 16) | (g << 8) | b;
    hist.set(key, (hist.get(key) || 0) + 1);
  }

  // Sort by frequency, take top 255 colors (leave index 0 for background)
  const sorted = [...hist.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 255);

  const palette = [[0, 0, 0]]; // index 0 = black background
  const colorToIdx = new Map();
  for (const [key] of sorted) {
    const idx = palette.length;
    const r = (key >> 16) & 0xFF;
    const g = (key >> 8)  & 0xFF;
    const b =  key        & 0xFF;
    palette.push([r, g, b]);
    colorToIdx.set(key, idx);
  }
  // Pad to 256
  while (palette.length < 256) palette.push([0, 0, 0]);

  // Map each pixel to nearest palette index
  const indices = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
    const r = pixels[i]   & 0xF8;
    const g = pixels[i+1] & 0xF8;
    const b = pixels[i+2] & 0xF8;
    const key = (r << 16) | (g << 8) | b;
    if (colorToIdx.has(key)) {
      indices[p] = colorToIdx.get(key);
    } else {
      // Nearest neighbor (simple)
      let best = 0, bestDist = Infinity;
      for (let j = 0; j < palette.length; j++) {
        const dr = pixels[i]   - palette[j][0];
        const dg = pixels[i+1] - palette[j][1];
        const db = pixels[i+2] - palette[j][2];
        const d = dr*dr + dg*dg + db*db;
        if (d < bestDist) { bestDist = d; best = j; }
      }
      indices[p] = best;
    }
  }

  return { palette, indices };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    return res.status(200).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { frames, width, height, delay = 100 } = req.body;

    if (!frames || !Array.isArray(frames) || frames.length === 0) {
      return res.status(400).json({ error: 'No frames provided' });
    }

    const w = parseInt(width) || 320;
    const h = parseInt(height) || 320;
    const d = parseInt(delay) || 100;

    // Decode base64 frames and quantize
    const gifFrames = [];
    for (const frameB64 of frames) {
      // frameB64 is base64 PNG data URL
      // Extract base64 data
      const base64Data = frameB64.replace(/^data:image\/\w+;base64,/, '');
      const binaryStr = atob(base64Data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      // Parse PNG to get pixel data using canvas-like approach
      // We'll use the raw RGBA data sent from frontend
      // Frontend should send raw RGBA as base64, not PNG
      const rgba = bytes; // raw RGBA uint8array
      const { palette, indices } = quantize(rgba, w, h);
      gifFrames.push({ palette, indices });
    }

    // Encode GIF
    const gifData = encodeGIF(gifFrames, w, h, d);

    // Return as binary
    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Content-Disposition', 'attachment; filename="analtena.gif"');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Length', gifData.length);
    res.status(200).end(Buffer.from(gifData));

  } catch (err) {
    console.error('Export error:', err);
    return res.status(500).json({ error: err.message });
  }
}
