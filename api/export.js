// api/export.js
// Receives PNG frames as base64, encodes MP4 using ffmpeg-static
// Deploy to Vercel api/ folder

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { frames, width, height, duration = 5 } = req.body;

    if (!frames || !Array.isArray(frames) || frames.length === 0) {
      return res.status(400).json({ error: 'No frames provided' });
    }

    const w = Math.min(parseInt(width) || 480, 600);
    const h = Math.min(parseInt(height) || 480, 600);
    const dur = parseInt(duration) || 5;
    // Calculate fps so total duration = dur seconds
    const fps = Math.max(1, Math.round(frames.length / dur));

    // Temp dir for this job
    const tmpDir = join(tmpdir(), 'mp4_' + Date.now() + '_' + Math.random().toString(36).slice(2));
    mkdirSync(tmpDir, { recursive: true });

    try {
      // Write frames as PNG files
      for (let i = 0; i < frames.length; i++) {
        const b64 = frames[i].replace(/^data:image\/\w+;base64,/, '');
        const buf = Buffer.from(b64, 'base64');
        writeFileSync(join(tmpDir, `f${String(i).padStart(4,'0')}.png`), buf);
      }

      // Find ffmpeg
      let ffmpegBin = 'ffmpeg';
      try {
        const mod = await import('ffmpeg-static');
        if (mod.default) ffmpegBin = mod.default;
      } catch(e) {}

      const out = join(tmpDir, 'out.mp4');

      // Encode MP4:
      // -pix_fmt yuv420p  → iOS/Android compatible
      // -movflags faststart → starts playing before full download
      // -crf 18 → near-lossless quality
      // scale: ensure even dimensions (required by libx264)
      const cmd = `"${ffmpegBin}" -y -framerate ${fps} -i "${join(tmpDir,'f%04d.png')}" -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p" -c:v libx264 -preset fast -crf 18 -movflags +faststart -t ${dur} "${out}"`;

      execSync(cmd, { timeout: 55000, stdio: 'pipe' });

      const video = readFileSync(out);
      rmSync(tmpDir, { recursive: true, force: true });

      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', `attachment; filename="analtena-${Date.now()}.mp4"`);
      res.setHeader('Content-Length', video.length);
      res.setHeader('Cache-Control', 'no-cache');
      return res.status(200).end(video);

    } catch(err) {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch(e) {}
      throw err;
    }

  } catch(err) {
    console.error('Export error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
