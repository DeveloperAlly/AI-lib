// Post content pipeline shared by the MCP tools and the GitHub sync CLI:
// input schema -> Markdown/HTML -> image upload -> FAQ + JSON-LD -> Ghost payload.

import { createHash } from 'node:crypto';
import { Marked, type Tokens } from 'marked';
import { z } from 'zod';
import type { Ghost } from './ghost.js';
import { decodeBase64Image, fetchImage, type FetchedImage } from './media.js';
import type { MediaConfig } from './config.js';

// ---------- schema ----------

export const imageSourceSchema = z.union([
  z.object({ url: z.string().url().describe('Public https URL of a JPEG, PNG, GIF or WebP image') }),
  z.object({
    base64: z.string().min(16).describe('Base64 image bytes (optionally a data: URI). Keep small; prefer url for large images'),
    filename: z.string().max(120).optional(),
  }),
  z.object({ repo_path: z.string().min(1).describe('Path of an image file in the configured GitHub content repo') }),
]);
export type ImageSource = z.infer<typeof imageSourceSchema>;

export const faqSchema = z
  .array(z.object({ question: z.string().min(3).max(300), answer: z.string().min(1).max(3000) }))
  .max(20);

const slugRe = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const postFieldsShape = {
  title: z.string().min(1).max(255),
  slug: z.string().max(185).regex(slugRe, 'lowercase words separated by hyphens').optional(),
  markdown: z.string().min(1).optional().describe('Post body in Markdown (preferred). Fenced code blocks keep their language. Do not include the title as an H1.'),
  html: z.string().min(1).optional().describe('Post body as HTML, used only if markdown is not given'),
  excerpt: z.string().max(300).optional().describe('Custom excerpt shown on cards and used as a description fallback'),
  tags: z.array(z.string().min(1).max(191)).max(10).optional().describe('First tag = main category (blog page): AI Engineering, Tutorials, OpEds or Project Case Studies. Then 2-4 search tags.'),
  feature_image: imageSourceSchema.optional(),
  feature_image_alt: z.string().max(191).optional(),
  feature_image_caption: z.string().max(1000).optional(),
  meta_title: z.string().max(300).optional().describe('Google title; <= 60 characters'),
  meta_description: z.string().max(500).optional().describe('Google description; 70-145 characters'),
  og_title: z.string().max(300).optional().describe('LinkedIn/Facebook card title; <= 70 characters'),
  og_description: z.string().max(500).optional().describe('LinkedIn/Facebook card description; <= 200 characters'),
  og_image: imageSourceSchema.optional(),
  twitter_title: z.string().max(300).optional().describe('X card title; <= 70 characters'),
  twitter_description: z.string().max(500).optional().describe('X card description; <= 200 characters'),
  twitter_image: imageSourceSchema.optional(),
  canonical_url: z.string().url().max(2000).optional(),
  faq: faqSchema.optional().describe('Question/answer pairs. Rendered as an FAQ section at the end of the post plus FAQPage structured data (AEO)'),
  featured: z.boolean().optional(),
};
export const postInputSchema = z.object(postFieldsShape);
export type PostInput = z.infer<typeof postInputSchema>;

// ---------- image resolution ----------

/** Resolves a relative image path (repo path for the server, filesystem path for sync). */
export type RelativeResolver = (path: string) => Promise<FetchedImage>;

export interface ContentContext {
  ghost: Ghost;
  media: MediaConfig;
  resolveRelative?: RelativeResolver;
}

async function loadSource(src: ImageSource | string, ctx: ContentContext): Promise<FetchedImage> {
  if (typeof src === 'string') {
    if (/^https?:\/\//i.test(src)) return fetchImage(src, ctx.media);
    if (/^data:image\//i.test(src)) return decodeBase64Image(src, ctx.media);
    if (!ctx.resolveRelative) throw new Error(`Cannot resolve relative image path "${src}" (no GitHub repo configured)`);
    return ctx.resolveRelative(src);
  }
  if ('url' in src) return fetchImage(src.url, ctx.media);
  if ('base64' in src) return decodeBase64Image(src.base64, ctx.media, src.filename);
  if (!ctx.resolveRelative) throw new Error('repo_path images need GITHUB_TOKEN and GITHUB_REPO configured');
  return ctx.resolveRelative(src.repo_path);
}

/** Upload an image to Ghost unless it already lives there; returns the Ghost URL. */
export async function toGhostImage(src: ImageSource | string, ctx: ContentContext, cache?: Map<string, string>): Promise<string> {
  if (typeof src === 'string' && ctx.ghost.isGhostHosted(src)) return src;
  if (typeof src === 'object' && 'url' in src && ctx.ghost.isGhostHosted(src.url)) return src.url;
  // Same image referenced as feature image ({url}) and inline (string) must share one key,
  // or it is uploaded twice.
  const key =
    typeof src === 'string' ? src
    : 'url' in src ? src.url
    : 'repo_path' in src ? `{repo}${src.repo_path}`
    : `{b64}${createHash('sha256').update(src.base64).digest('hex')}`;
  const hit = cache?.get(key);
  if (hit) return hit;
  const url = await ctx.ghost.uploadImage(await loadSource(src, ctx));
  cache?.set(key, url);
  return url;
}

// ---------- markdown ----------

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function makeMarked(): Marked {
  const m = new Marked({ gfm: true, breaks: false });
  m.use({
    renderer: {
      // A paragraph holding only an image becomes a <figure>, which Ghost turns
      // into a native image card with alt text and caption.
      paragraph(token: Tokens.Paragraph) {
        const only = token.tokens?.filter((t) => !(t.type === 'text' && !t.raw.trim()));
        if (only?.length === 1 && only[0].type === 'image') {
          const img = only[0] as Tokens.Image;
          const cap = img.title ? `<figcaption>${escapeHtml(img.title)}</figcaption>` : '';
          return `<figure><img src="${escapeHtml(img.href)}" alt="${escapeHtml(img.text)}">${cap}</figure>\n`;
        }
        return false;
      },
    },
  });
  return m;
}

export function markdownToHtml(md: string): string {
  return makeMarked().parse(md, { async: false }) as string;
}

// ---------- FAQ / structured data ----------

const FAQ_START = '<!-- ghost-publisher-mcp:faq:start -->';
const FAQ_END = '<!-- ghost-publisher-mcp:faq:end -->';

export function faqHtml(faq: { question: string; answer: string }[]): string {
  if (!faq.length) return '';
  const items = faq.map((f) => `<h3>${escapeHtml(f.question)}</h3>\n${markdownToHtml(f.answer)}`).join('\n');
  return `<h2>Frequently asked questions</h2>\n${items}`;
}

export function faqJsonLd(faq: { question: string; answer: string }[]): string {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: stripTags(markdownToHtml(f.answer)).trim() },
    })),
  };
  // Escape "<" so answer text can never close the script element.
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

/** Replace only this server's managed block in code injection, keeping anything else. */
export function mergeHead(existing: string | null | undefined, faq: { question: string; answer: string }[] | undefined): string {
  const base = (existing ?? '').replace(new RegExp(`${escapeRe(FAQ_START)}[\\s\\S]*?${escapeRe(FAQ_END)}\\n?`, 'g'), '').trim();
  if (!faq?.length) return base;
  return [base, `${FAQ_START}\n${faqJsonLd(faq)}\n${FAQ_END}`].filter(Boolean).join('\n');
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const stripTags = (html: string) => html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

// ---------- payload ----------

export interface BuildResult {
  payload: Record<string, unknown>;
  hasBody: boolean;
  uploaded: string[];
  /** original inline image src -> Ghost URL, so mirrors can point at the uploaded copy */
  imageMap: Map<string, string>;
}

/**
 * Build a Ghost post payload from (possibly partial) input. Only fields present
 * in `input` are set, so it works for both create and partial update.
 */
export async function buildPayload(
  input: Partial<PostInput>,
  ctx: ContentContext,
  opts: { existingHead?: string | null } = {},
): Promise<BuildResult> {
  const cache = new Map<string, string>();
  const uploaded: string[] = [];
  const up = async (src: ImageSource | string) => {
    const url = await toGhostImage(src, ctx, cache);
    uploaded.push(url);
    return url;
  };
  const p: Record<string, unknown> = {};
  const copy = [
    'title', 'slug', 'feature_image_alt', 'feature_image_caption', 'meta_title', 'meta_description', 'og_title',
    'og_description', 'twitter_title', 'twitter_description', 'canonical_url', 'featured',
  ] as const;
  for (const k of copy) if (input[k] !== undefined) p[k] = input[k];
  if (input.excerpt !== undefined) p.custom_excerpt = input.excerpt;
  if (input.tags !== undefined) p.tags = input.tags.map((name) => ({ name }));
  if (input.feature_image) p.feature_image = await up(input.feature_image);
  if (input.og_image) p.og_image = await up(input.og_image);
  if (input.twitter_image) p.twitter_image = await up(input.twitter_image);

  let html: string | undefined;
  if (input.markdown !== undefined) html = markdownToHtml(input.markdown);
  else if (input.html !== undefined) html = input.html;
  if (html !== undefined) {
    html = await rewriteImages(html, up);
    if (input.faq?.length) html = `${html}\n${faqHtml(input.faq)}`;
    p.html = html;
  }
  if (input.faq !== undefined) p.codeinjection_head = mergeHead(opts.existingHead, input.faq);
  const imageMap = new Map([...cache].filter(([k]) => !k.startsWith('{')));
  return { payload: p, hasBody: html !== undefined, uploaded: [...new Set(uploaded)], imageMap };
}

/** Point Markdown image references at their uploaded Ghost copies. */
export function rewriteMarkdownImages(md: string, map: Map<string, string>): string {
  let out = md;
  for (const [src, url] of map) if (src !== url) out = out.split(`](${src}`).join(`](${url}`);
  return out;
}

async function rewriteImages(html: string, up: (src: string) => Promise<string>): Promise<string> {
  const srcs = [...html.matchAll(/<img\b[^>]*?\ssrc="([^"]+)"/gi)].map((m) => m[1]);
  let out = html;
  for (const raw of new Set(srcs)) {
    const src = raw.replace(/&amp;/g, '&');
    const url = await up(src);
    out = out.split(`src="${raw}"`).join(`src="${escapeHtml(url)}"`);
  }
  return out;
}
