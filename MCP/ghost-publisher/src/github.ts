// GitHub side: (a) mirror every draft/publish into a content repo as Markdown
// with front matter, and (b) read images/posts from that repo. The front-matter
// format is the same one the push-to-draft sync reads, so the two directions
// round-trip.

import matter from 'gray-matter';
import { posix } from 'node:path';
import type { GitHubConfig, MediaConfig } from './config.js';
import { checkImageBytes, type FetchedImage } from './media.js';
import type { GhostPost } from './ghost.js';
import { SEO_FIELDS, revisionOf } from './ghost.js';

// "[skip ci]" in the commit message stops GitHub Actions from running the
// push-to-draft workflow on the server's own mirror commits (no sync loop).
export const SKIP_CI = '[skip ci]';

const API = () => (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');

export class GitHubRepo {
  constructor(readonly cfg: GitHubConfig) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${this.cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ghost-publisher-mcp',
      ...extra,
    };
  }

  private contentsUrl(path: string): string {
    return `${API()}/repos/${this.cfg.repo}/contents/${safeRepoPath(path).split('/').map(encodeURIComponent).join('/')}`;
  }

  async readRaw(path: string): Promise<Uint8Array | null> {
    const res = await fetch(`${this.contentsUrl(path)}?ref=${encodeURIComponent(this.cfg.branch)}`, {
      headers: this.headers({ Accept: 'application/vnd.github.raw' }),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub read ${path} failed: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  private async sha(path: string): Promise<string | undefined> {
    const res = await fetch(`${this.contentsUrl(path)}?ref=${encodeURIComponent(this.cfg.branch)}`, { headers: this.headers() });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`GitHub lookup ${path} failed: HTTP ${res.status}`);
    return ((await res.json()) as { sha: string }).sha;
  }

  async writeFile(path: string, content: string, message: string): Promise<{ commit: string; path: string }> {
    const sha = await this.sha(path);
    const res = await fetch(this.contentsUrl(path), {
      method: 'PUT',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message, content: Buffer.from(content, 'utf8').toString('base64'), branch: this.cfg.branch, ...(sha ? { sha } : {}) }),
    });
    if (!res.ok) throw new Error(`GitHub write ${path} failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { commit: { sha: string } };
    return { commit: j.commit.sha, path };
  }

  postPath(slug: string): string {
    return posix.join(this.cfg.postsDir, `${slug}.md`);
  }

  /** Image resolver for repo_path sources and relative Markdown image paths. */
  resolver(media: MediaConfig, baseDir?: string) {
    return async (p: string): Promise<FetchedImage> => {
      const path = p.startsWith('/') || !baseDir ? p.replace(/^\/+/, '') : posix.join(baseDir, p);
      const bytes = await this.readRaw(path);
      if (!bytes) throw new Error(`Image ${path} not found in ${this.cfg.repo}@${this.cfg.branch}`);
      return checkImageBytes(bytes, media, posix.basename(path));
    };
  }
}

/** Normalise a repo-relative path and refuse anything that escapes the repo root. */
export function safeRepoPath(p: string): string {
  const n = posix.normalize(p.replace(/\\/g, '/')).replace(/^\/+/, '');
  if (!n || n === '.' || n.startsWith('..') || n.includes('/../')) throw new Error(`Invalid repo path "${p}"`);
  return n;
}

// ---------- front matter ----------

export interface MirrorInput {
  post: GhostPost;
  body: string;
  format: 'markdown' | 'html';
  tags?: string[];
  faq?: { question: string; answer: string }[];
  /** Status to record instead of Ghost's (sync keeps the author's requested status). */
  status?: string;
}

/** Serialise a Ghost post to the shared Markdown + front-matter format. */
export function toMarkdownDoc(m: MirrorInput): string {
  const p = m.post;
  const fm: Record<string, unknown> = {
    title: p.title,
    slug: p.slug,
    status: m.status ?? p.status,
    ghost_id: p.id,
    // Fingerprint of the Ghost copy at last sync; a later mismatch means someone
    // edited in Ghost, so the sync refuses to overwrite it.
    ghost_revision: revisionOf(p),
    ...(p.published_at ? { published_at: p.published_at } : {}),
    ...(m.format === 'html' ? { format: 'html' } : {}),
  };
  const tags = m.tags ?? p.tags?.map((t) => t.name);
  if (tags?.length) fm.tags = tags;
  for (const k of ['custom_excerpt', 'feature_image', 'feature_image_alt', 'feature_image_caption', 'featured', ...SEO_FIELDS] as const) {
    const v = p[k];
    if (v !== null && v !== undefined && v !== '' && v !== false) fm[k === 'custom_excerpt' ? 'excerpt' : k] = v;
  }
  if (m.faq?.length) fm.faq = m.faq;
  return matter.stringify(`\n${m.body.trim()}\n`, fm);
}

// gray-matter evals `---js` front matter by default; repo content must never run
// code on the server. Passing options also disables gray-matter's unbounded cache.
const MATTER_OPTS = {
  engines: {
    javascript: () => {
      throw new Error('JavaScript front matter is not allowed');
    },
  },
};

export function parseMarkdownDoc(text: string): { data: Record<string, unknown>; body: string } {
  const parsed = matter(text, MATTER_OPTS as never);
  return { data: parsed.data as Record<string, unknown>, body: parsed.content };
}
