import { deflateSync } from 'node:zlib';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

/** Build a real, valid PNG (solid colour) so Ghost's image processing accepts it. */
export function makePng(w = 4, h = 4, rgb: [number, number, number] = [200, 60, 90]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export async function listen(app: express.Express): Promise<{ server: Server; url: string; port: number }> {
  return new Promise((res) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      res({ server, url: `http://127.0.0.1:${port}`, port });
    });
  });
}

/** In-memory stand-in for the GitHub contents API (only what the server uses). */
export function mockGitHub() {
  const files = new Map<string, Buffer>();
  const commits: { path: string; message: string }[] = [];
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use((req, res, next) => {
    if (req.headers.authorization !== 'Bearer test-gh-token') return res.status(401).json({ message: 'Bad credentials' });
    next();
  });
  const sha = (b: Buffer) => require_sha1(b);
  app.get(/^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/, (req, res) => {
    const path = decodeURIComponent((req.params as Record<string, string>)[0]);
    const f = files.get(path);
    if (!f) return res.status(404).json({ message: 'Not Found' });
    if (req.headers.accept === 'application/vnd.github.raw') return res.type('application/octet-stream').send(f);
    res.json({ path, sha: sha(f), content: f.toString('base64') });
  });
  app.put(/^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/, (req, res) => {
    const path = decodeURIComponent((req.params as Record<string, string>)[0]);
    const existing = files.get(path);
    if (existing && req.body.sha !== sha(existing)) return res.status(409).json({ message: 'sha mismatch' });
    if (!existing && req.body.sha) return res.status(422).json({ message: 'sha given for new file' });
    const buf = Buffer.from(req.body.content, 'base64');
    files.set(path, buf);
    commits.push({ path, message: req.body.message });
    res.status(existing ? 200 : 201).json({ content: { path }, commit: { sha: sha(buf) + 'c'.repeat(0) } });
  });
  return { app, files, commits };
}

import { createHash } from 'node:crypto';
function require_sha1(b: Buffer): string {
  return createHash('sha1').update(b).digest('hex');
}

export function pkce() {
  const { randomBytes, createHash: h } = require_crypto();
  const verifier = randomBytes(32).toString('base64url');
  const challenge = h('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}
import * as nodeCrypto from 'node:crypto';
function require_crypto() {
  return nodeCrypto;
}
