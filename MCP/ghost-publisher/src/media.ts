// Image intake: fetch (SSRF-guarded), decode or read an image, check it is a
// real raster image by its magic bytes, and hand back bytes ready for Ghost.

import { lookup } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import type { MediaConfig } from './config.js';

export type ImageKind = { ext: 'jpg' | 'png' | 'gif' | 'webp'; mime: string };

// Ghost accepts WEBP, JPEG, GIF, PNG and SVG for purpose=image. SVG is refused
// here on purpose: it can carry script and is rarely needed for blog media.
export function sniffImage(buf: Uint8Array): ImageKind | null {
  const b = buf;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', mime: 'image/png' };
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return { ext: 'gif', mime: 'image/gif' };
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
    return { ext: 'webp', mime: 'image/webp' };
  return null;
}

// Private, loopback, link-local, CGNAT, multicast and reserved ranges.
// Separate lists per family: Node's BlockList matches IPv4 lookups against
// IPv4-mapped IPv6 rules, so one shared list would block every IPv4 address.
const blocked4 = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked4.addSubnet(net, prefix, 'ipv4');
const blocked6 = new BlockList();
for (const [net, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2001:db8::', 32]] as const)
  blocked6.addSubnet(net, prefix, 'ipv6');

export function isBlockedAddress(addr: string): boolean {
  const fam = isIP(addr);
  if (fam === 4) return blocked4.check(addr, 'ipv4');
  if (fam === 6) {
    // IPv4-mapped (::ffff:a.b.c.d or ::ffff:XXXX:XXXX): judge the embedded IPv4.
    const mapped = /^::ffff:(?:0:)?(\d+\.\d+\.\d+\.\d+)$/i.exec(addr);
    if (mapped) return blocked4.check(mapped[1], 'ipv4');
    const hex = /^::ffff:(?:0:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(addr);
    if (hex) {
      const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16);
      return blocked4.check([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'), 'ipv4');
    }
    return blocked6.check(addr, 'ipv6');
  }
  return true;
}

// The check runs inside the connection's own DNS lookup, so a hostname cannot
// resolve to a public address for the check and a private one for the connect.
function guardedAgent(allowPrivate: boolean): Agent {
  return new Agent({
    connect: {
      lookup(hostname, options, cb) {
        lookup(hostname, { ...options, all: true }, (err, addresses) => {
          if (err) return cb(err, '', 0);
          const list = (addresses as unknown as { address: string; family: number }[]) ?? [];
          const ok = list.filter((a) => allowPrivate || !isBlockedAddress(a.address));
          if (!ok.length) return cb(new Error(`Refusing to fetch ${hostname}: it resolves only to private or reserved addresses`), '', 0);
          if ((options as { all?: boolean }).all) return (cb as any)(null, ok);
          cb(null, ok[0].address, ok[0].family);
        });
      },
    },
  });
}

export interface FetchedImage {
  bytes: Uint8Array;
  kind: ImageKind;
  name: string;
}

export async function fetchImage(rawUrl: string, cfg: MediaConfig): Promise<FetchedImage> {
  let url = new URL(rawUrl);
  const agent = guardedAgent(cfg.allowPrivateHosts);
  try {
    for (let hop = 0; hop < 4; hop++) {
      if (url.protocol !== 'https:' && !(cfg.allowPrivateHosts && url.protocol === 'http:'))
        throw new Error(`Only https image URLs are accepted (got ${url.protocol})`);
      if (url.username || url.password) throw new Error('Image URLs must not contain credentials');
      if (isIP(url.hostname.replace(/^\[|\]$/g, '')) && !cfg.allowPrivateHosts && isBlockedAddress(url.hostname.replace(/^\[|\]$/g, '')))
        throw new Error('Refusing to fetch a private or reserved address');
      const res = await undiciFetch(url, { dispatcher: agent, redirect: 'manual', signal: AbortSignal.timeout(20_000) }).catch((e: unknown) => {
        const cause = (e as { cause?: { message?: string } }).cause?.message;
        throw new Error(`Could not fetch image from ${url.host}: ${cause ?? (e as Error).message}`);
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) throw new Error(`Redirect without location from ${url.host}`);
        url = new URL(loc, url);
        continue;
      }
      if (!res.ok) throw new Error(`Image fetch failed: HTTP ${res.status} from ${url.host}`);
      const declared = Number(res.headers.get('content-length') ?? '0');
      if (declared > cfg.maxBytes) throw new Error(`Image is larger than ${cfg.maxBytes / 1048576} MB`);
      const bytes = await readCapped(res.body as unknown as AsyncIterable<Uint8Array> | null, cfg.maxBytes);
      const kind = sniffImage(bytes);
      if (!kind) throw new Error('URL did not return a JPEG, PNG, GIF or WebP image');
      return { bytes, kind, name: baseName(url.pathname, kind) };
    }
    throw new Error('Too many redirects');
  } finally {
    await agent.close();
  }
}

async function readCapped(body: AsyncIterable<Uint8Array> | null, max: number): Promise<Uint8Array> {
  if (!body) throw new Error('Empty image response');
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > max) throw new Error(`Image is larger than ${max / 1048576} MB`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function decodeBase64Image(data: string, cfg: MediaConfig, filename?: string): FetchedImage {
  const cleaned = data.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) throw new Error('base64 data is not valid base64');
  const bytes = Buffer.from(cleaned, 'base64');
  if (bytes.byteLength > cfg.maxBytes) throw new Error(`Image is larger than ${cfg.maxBytes / 1048576} MB`);
  const kind = sniffImage(bytes);
  if (!kind) throw new Error('base64 data is not a JPEG, PNG, GIF or WebP image');
  return { bytes, kind, name: baseName(filename ?? 'image', kind) };
}

export function checkImageBytes(bytes: Uint8Array, cfg: MediaConfig, name: string): FetchedImage {
  if (bytes.byteLength > cfg.maxBytes) throw new Error(`${name} is larger than ${cfg.maxBytes / 1048576} MB`);
  const kind = sniffImage(bytes);
  if (!kind) throw new Error(`${name} is not a JPEG, PNG, GIF or WebP image`);
  return { bytes, kind, name: baseName(name, kind) };
}

function baseName(pathLike: string, kind: ImageKind): string {
  const last = decodeURIComponent(pathLike.split('/').pop() || 'image');
  const stem = last.replace(/\.[^.]*$/, '').replace(/[^\w.-]+/g, '-').slice(0, 60) || 'image';
  return `${stem}.${kind.ext}`;
}
