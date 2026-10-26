// Ghost -> server webhook: when a post is added or edited directly in Ghost,
// give it a generated cover, or refresh the generated one after a title/tag
// change. Requests are authenticated with Ghost's HMAC signature
// (X-Ghost-Signature: sha256=<hex>, t=<ms>; HMAC-SHA256(secret, rawBody + t)),
// and work is debounced per post so editor autosaves don't each trigger a
// render, and so the server doesn't save over a post while it's being typed.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import express, { type Express } from 'express';
import { ensureCover } from './autocover.js';
import { Ghost, ghostErrorMessage } from './ghost.js';

type WebhookApi = { webhooks: { add(d: Record<string, unknown>): Promise<{ id: string }>; delete(d: { id: string }): Promise<unknown> } };

export const WEBHOOK_EVENTS = ['post.added', 'post.edited'] as const;
const MAX_SKEW_MS = 10 * 60_000;

export function verifyGhostSignature(raw: Buffer, header: string | undefined, secret: string, now = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]));
  const sig = parts.sha256, t = parts.t;
  if (!sig || !t || !/^\d+$/.test(t) || !/^[0-9a-f]{64}$/i.test(sig)) return false;
  if (Math.abs(now - Number(t)) > MAX_SKEW_MS) return false;
  const want = createHmac('sha256', secret).update(Buffer.concat([raw, Buffer.from(t)])).digest();
  return timingSafeEqual(want, Buffer.from(sig, 'hex'));
}

export async function loadWebhookSecret(dataDir: string, fromEnv?: string): Promise<string> {
  if (fromEnv && fromEnv.length >= 24) return fromEnv;
  const file = join(dataDir, 'webhook-secret');
  try {
    const s = (await readFile(file, 'utf8')).trim();
    if (s.length >= 24) return s;
  } catch { /* first start */ }
  const s = randomBytes(32).toString('hex');
  await writeFile(file, s, { mode: 0o600 });
  return s;
}

/** URL path derived from the secret, so rotating the secret also moves the endpoint. */
export const webhookPath = (secret: string) => `/webhooks/ghost/${createHash('sha256').update(secret).digest('hex').slice(0, 16)}`;

export class CoverScheduler {
  private timers = new Map<string, NodeJS.Timeout>();
  constructor(private ghost: Ghost, private delayMs: number, private log = console) {}

  schedule(postId: string, attempt = 0): void {
    clearTimeout(this.timers.get(postId));
    this.timers.set(postId, setTimeout(() => void this.run(postId, attempt), this.delayMs).unref());
  }

  pending(): number {
    return this.timers.size;
  }

  private async run(postId: string, attempt: number): Promise<void> {
    this.timers.delete(postId);
    try {
      const post = await this.ghost.read({ id: postId });
      const r = await ensureCover(this.ghost, post);
      if (r.action === 'created' || r.action === 'updated') this.log.log(`auto-cover: ${r.action} for ${post.slug}`);
    } catch (e) {
      const msg = ghostErrorMessage(e);
      if (/not found/i.test(msg)) return; // deleted meanwhile
      if (attempt < 3) {
        this.log.warn(`auto-cover: retrying ${postId} (${msg})`);
        this.schedule(postId, attempt + 1);
      } else this.log.error(`auto-cover: gave up on ${postId}: ${msg}`);
    }
  }
}

export function mountWebhook(app: Express, opts: { secret: string; scheduler: CoverScheduler }): string {
  const path = webhookPath(opts.secret);
  app.post(path, express.raw({ type: '*/*', limit: '5mb' }), (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!verifyGhostSignature(raw, req.get('x-ghost-signature'), opts.secret)) {
      res.status(401).json({ error: 'bad signature' });
      return;
    }
    let id: string | undefined;
    try {
      id = JSON.parse(raw.toString('utf8'))?.post?.current?.id;
    } catch { /* fall through */ }
    if (typeof id !== 'string' || !/^[0-9a-f]{24}$/.test(id)) {
      res.status(400).json({ error: 'no post id' });
      return;
    }
    opts.scheduler.schedule(id);
    res.status(202).json({ ok: true });
  });
  return path;
}

/**
 * Register the webhooks on Ghost's integration (the one owning the Admin key).
 * Ghost has no list endpoint for integrations, so the registered target is
 * remembered in DATA_DIR; Ghost also rejects duplicate (event, target) pairs,
 * which we treat as already registered.
 */
export async function registerWebhooks(ghost: Ghost, dataDir: string, targetUrl: string, secret: string, log = console): Promise<void> {
  const file = join(dataDir, 'webhooks.json');
  let saved: { target?: string; ids?: string[] } = {};
  try { saved = JSON.parse(await readFile(file, 'utf8')); } catch { /* none yet */ }
  if (saved.target === targetUrl) return;
  const ids: string[] = [];
  for (const event of WEBHOOK_EVENTS) {
    try {
      const w = await (ghost.api as unknown as WebhookApi).webhooks.add({ event, target_url: targetUrl, secret, name: `Claude auto-cover (${event})` });
      ids.push(w.id);
    } catch (e) {
      const msg = ghostErrorMessage(e);
      if (!/already been used/i.test(msg)) {
        log.error(`auto-cover: could not register ${event} webhook: ${msg}`);
        return;
      }
    }
  }
  // Remove the webhooks for a previous target (e.g. after a secret rotation).
  for (const id of saved.ids ?? []) await (ghost.api as unknown as WebhookApi).webhooks.delete({ id }).catch(() => undefined);
  await writeFile(file, JSON.stringify({ target: targetUrl, ids }, null, 2));
  log.log(`auto-cover: Ghost webhooks registered -> ${targetUrl}`);
}
