// Automatic covers: decide whether a post needs a (new) generated cover and
// apply it. Shared by the MCP tools and the Ghost webhook.
//
// Ownership rule: a cover this server generated is recognisable by its file
// name (ah-cover-<hash>.jpg). Only those are ever replaced. A feature image the
// owner chose is left alone unless replace_custom is explicitly requested.
// Per-post cover settings (eyebrow kind/topic, subtitle, motif, or off) live in
// a managed comment block in the post's code injection, so a later title edit
// in Ghost regenerates the cover with the same settings.

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { coverSpecFromPost, renderCover, type CoverSpec } from './cover.js';
import { MOTIFS, type MotifName } from './cover-motifs.js';
import type { Ghost, GhostPost } from './ghost.js';
import { sniffImage } from './media.js';

/** Bump to regenerate every generated cover (e.g. after a design change). */
export const COVER_RENDER_VERSION = 1;

const START = '<!-- ghost-publisher-mcp:cover ';
const END = ' -->';
const BLOCK_RE = /<!-- ghost-publisher-mcp:cover (\{[^\n]*?\}) -->\n?/g;
const FILE_RE = /\/ah-cover-([0-9a-f]{12})(?:-\d+)?\.jpg$/;

export const coverOptionsSchema = z.object({
  kind: z.string().max(40).optional().describe('Eyebrow label and colour: Essay, Playbook, Field guide, Field notes, Tutorial, Analysis, Research, Op-ed, Interview'),
  topic: z.string().max(60).optional().describe('Eyebrow topic, e.g. "Model Context Protocol"'),
  title: z.string().max(120).optional().describe('Shorter title for the cover only'),
  subtitle: z.string().max(120).optional().describe('One-line italic subtitle'),
  motif: z.enum(MOTIFS as [MotifName, ...MotifName[]]).optional().describe('Illustration; chosen from the topic when omitted'),
});
export type CoverOptions = z.infer<typeof coverOptionsSchema>;
export type CoverSetting = CoverOptions & { off?: boolean };

export function readCoverSetting(head: string | null | undefined): CoverSetting {
  const m = [...(head ?? '').matchAll(BLOCK_RE)].pop();
  if (!m) return {};
  try {
    const v = JSON.parse(m[1]);
    return v && typeof v === 'object' ? (v as CoverSetting) : {};
  } catch {
    return {};
  }
}

export function writeCoverSetting(head: string | null | undefined, setting: CoverSetting): string {
  const base = (head ?? '').replace(BLOCK_RE, '').trim();
  const clean = Object.fromEntries(Object.entries(setting).filter(([, v]) => v !== undefined && v !== ''));
  if (!Object.keys(clean).length) return base;
  // "--" can't appear inside an HTML comment; JSON-escape it.
  const json = JSON.stringify(clean).replace(/--/g, '-\\u002d').replace(/>/g, '\\u003e');
  return [base, `${START}${json}${END}`].filter(Boolean).join('\n');
}

export function specForPost(post: Pick<GhostPost, 'title' | 'slug'> & { tags?: { name: string }[]; custom_excerpt?: unknown; codeinjection_head?: unknown }): CoverSpec {
  const s = readCoverSetting(post.codeinjection_head as string | null);
  const tags = (post.tags ?? []).map((t) => t.name);
  return coverSpecFromPost(
    { title: post.title, tags, excerpt: (post.custom_excerpt as string | null) ?? null, slug: post.slug },
    { kind: s.kind, topic: s.topic, title: s.title, subtitle: s.subtitle, motif: s.motif, keywords: tags.join(' ') },
  );
}

export function coverHash(spec: CoverSpec): string {
  const canon = JSON.stringify([COVER_RENDER_VERSION, spec.title, spec.subtitle ?? '', spec.kind ?? '', spec.topic ?? '', spec.motif ?? '', spec.keywords ?? '', spec.seed ?? '']);
  return createHash('sha256').update(canon).digest('hex').slice(0, 12);
}

export type CoverState = { state: 'none' } | { state: 'generated'; hash: string } | { state: 'custom' };

export function coverState(featureImage: unknown): CoverState {
  if (!featureImage || typeof featureImage !== 'string') return { state: 'none' };
  const m = featureImage.match(FILE_RE);
  return m ? { state: 'generated', hash: m[1] } : { state: 'custom' };
}

export function coverAlt(spec: CoverSpec): string {
  return `Cover illustration for "${spec.title}" by Alison Haire`.slice(0, 191);
}

export type CoverAction = 'created' | 'updated' | 'unchanged' | 'kept-custom' | 'off';

/**
 * Make sure the post's cover matches its current title/tags/settings.
 * `post` must be a fresh read (Ghost.read). Returns what happened.
 */
export async function ensureCover(
  ghost: Ghost,
  post: GhostPost,
  opts: { replaceCustom?: boolean } = {},
): Promise<{ action: CoverAction; url?: string; post: GhostPost }> {
  const setting = readCoverSetting(post.codeinjection_head as string | null);
  if (setting.off && !opts.replaceCustom) return { action: 'off', post };
  const st = coverState(post.feature_image);
  if (st.state === 'custom' && !opts.replaceCustom) return { action: 'kept-custom', post };
  const spec = specForPost(post);
  const hash = coverHash(spec);
  if (st.state === 'generated' && st.hash === hash) return { action: 'unchanged', post };

  const bytes = await renderCover(spec);
  const url = await ghost.uploadImage({ bytes, name: `ah-cover-${hash}.jpg`, kind: sniffImage(bytes)! });
  const fields: Record<string, unknown> = { feature_image: url };
  // Alt text describes the image, so a new cover always gets new alt text
  // (a replaced chosen image's old alt no longer fits).
  fields.feature_image_alt = coverAlt(spec);
  const edited = await ghost.edit(post.id, post.updated_at, fields);
  return { action: st.state === 'none' ? 'created' : 'updated', url, post: edited };
}
