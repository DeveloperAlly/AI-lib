// Thin, deliberately narrow wrapper over the Ghost Admin API.
// It exposes no delete and never sends the `newsletter` query parameter, so a
// publish can never trigger an email (Ghost emails a post if and only if an
// active newsletter is passed).

import GhostAdminAPI from '@tryghost/admin-api';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GhostConfig } from './config.js';
import type { FetchedImage } from './media.js';

export const SEO_FIELDS = [
  'meta_title', 'meta_description', 'og_title', 'og_description', 'og_image',
  'twitter_title', 'twitter_description', 'twitter_image', 'canonical_url',
] as const;

export const POST_FIELDS = [
  'id', 'uuid', 'title', 'slug', 'status', 'url', 'updated_at', 'published_at', 'custom_excerpt',
  'feature_image', 'feature_image_alt', 'feature_image_caption', 'featured', 'visibility',
  'codeinjection_head', ...SEO_FIELDS,
];

export interface GhostPost {
  id: string;
  uuid: string;
  title: string;
  slug: string;
  status: 'draft' | 'published' | 'scheduled' | 'sent';
  url: string;
  updated_at: string;
  published_at: string | null;
  html?: string;
  tags?: { name: string; slug: string }[];
  [k: string]: unknown;
}

export class Ghost {
  readonly api: GhostAdminAPI;
  constructor(readonly cfg: GhostConfig) {
    this.api = new GhostAdminAPI({ url: cfg.url, key: cfg.adminApiKey, version: cfg.apiVersion });
  }

  editorUrl(id: string): string {
    return `${this.cfg.url}/ghost/#/editor/post/${id}`;
  }

  previewUrl(post: Pick<GhostPost, 'uuid'>): string {
    return `${this.cfg.url}/p/${post.uuid}/`;
  }

  isGhostHosted(url: string): boolean {
    return url.startsWith(`${this.cfg.url}/content/images/`);
  }

  async site(): Promise<Record<string, unknown>> {
    return this.api.site.read();
  }

  async read(idOrSlug: { id?: string; slug?: string }): Promise<GhostPost> {
    const key = idOrSlug.id ? { id: idOrSlug.id } : { slug: idOrSlug.slug };
    return this.api.posts.read(key, { formats: 'html', include: 'tags' });
  }

  async list(opts: { status?: string; search?: string; limit?: number }): Promise<GhostPost[]> {
    const filters: string[] = [];
    if (opts.status && opts.status !== 'all') filters.push(`status:${opts.status}`);
    if (opts.search) filters.push(`title:~'${opts.search.replace(/['\\]/g, '')}'`);
    return this.api.posts.browse({
      limit: Math.min(Math.max(opts.limit ?? 15, 1), 50),
      order: 'updated_at desc',
      fields: 'id,uuid,title,slug,status,url,updated_at,published_at',
      ...(filters.length ? { filter: filters.join('+') } : {}),
    });
  }

  async createDraft(post: Record<string, unknown>): Promise<GhostPost> {
    return this.api.posts.add({ ...post, status: 'draft' }, { source: 'html' });
  }

  /** Edit with Ghost's optimistic lock: fails if the post changed since `updated_at`. */
  async edit(id: string, updatedAt: string, fields: Record<string, unknown>, opts: { html?: boolean } = {}): Promise<GhostPost> {
    const { status: _ignored, ...rest } = fields;
    return this.api.posts.edit({ ...rest, id, updated_at: updatedAt }, opts.html ? { source: 'html' } : {});
  }

  async setStatus(id: string, updatedAt: string, status: 'published' | 'draft'): Promise<GhostPost> {
    // No newsletter / email_segment params: Ghost will not send email.
    return this.api.posts.edit({ id, updated_at: updatedAt, status });
  }

  async uploadImage(img: FetchedImage): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'ghost-img-'));
    try {
      const file = join(dir, img.name);
      await writeFile(file, img.bytes);
      const res = await this.api.images.upload({ file, purpose: 'image' });
      return res.url;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

/**
 * Content fingerprint of a post. Ghost's updated_at alone is not enough: it has
 * one-second resolution and is NOT bumped when only SEO metadata (meta/og/
 * twitter fields, stored in posts_meta) changes. Pinning reviews and publishes
 * to this hash means "the exact revision the owner reviewed" really holds.
 * Requires a post read with formats=html and include=tags (Ghost.read does).
 */
export function revisionOf(p: GhostPost): string {
  const parts = [
    p.updated_at, p.title, p.slug, p.html ?? '', p.custom_excerpt, p.feature_image, p.feature_image_alt,
    p.feature_image_caption, p.featured, p.codeinjection_head, ...SEO_FIELDS.map((k) => p[k]),
    (p.tags ?? []).map((t) => t.name).join('|'),
  ];
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}

/** Turn Ghost's error objects into a readable single line. */
export function ghostErrorMessage(e: unknown): string {
  const err = e as { message?: string; context?: string; type?: string; response?: { status?: number } };
  const parts = [err.type, err.message, err.context].filter(Boolean);
  const msg = parts.join(': ') || String(e);
  if (/UpdateCollisionError|Saving failed! Someone else is editing/i.test(msg))
    return `The post changed since you last read it (revision mismatch). Re-read it with get_post and use the new updated_at. Ghost said: ${msg}`;
  return msg;
}
