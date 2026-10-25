// Push-to-draft sync, run by the GitHub Action in the content repo:
//   node dist/sync.js posts/my-post.md [more files...]
//
// For each Markdown file: create the Ghost draft (or update it if ghost_id is
// set), upload local and remote images, then write ghost_id / ghost_revision
// and Ghost image URLs back into the file. Publishing from git happens only if
// ALLOW_GIT_PUBLISH=true and the file says `status: published`.

import { readFile, writeFile, realpath } from 'node:fs/promises';
import { basename, dirname, resolve, sep } from 'node:path';
import { loadGhostConfig, loadMediaConfig } from './config.js';
import { buildPayload, rewriteMarkdownImages, type ContentContext, type PostInput } from './content.js';
import { Ghost, ghostErrorMessage, revisionOf, type GhostPost } from './ghost.js';
import { parseMarkdownDoc, toMarkdownDoc } from './github.js';
import { checkImageBytes } from './media.js';

type Outcome = { file: string; result: 'created' | 'updated' | 'published' | 'skipped' | 'failed'; detail: string };

const asStr = (v: unknown): string | undefined => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : v == null ? undefined : String(v));

export function docToInput(data: Record<string, unknown>, body: string, file: string): Partial<PostInput> & { title: string } {
  const title = asStr(data.title)?.trim();
  if (!title) throw new Error('front matter needs a title');
  const input: Record<string, unknown> = {
    title,
    slug: asStr(data.slug) ?? basename(file).replace(/\.md$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    [data.format === 'html' ? 'html' : 'markdown']: body,
  };
  for (const k of ['feature_image_alt', 'feature_image_caption', 'meta_title', 'meta_description', 'og_title', 'og_description', 'twitter_title', 'twitter_description', 'canonical_url', 'excerpt']) {
    const v = asStr(data[k]);
    if (v !== undefined) input[k] = v;
  }
  for (const k of ['feature_image', 'og_image', 'twitter_image']) {
    const v = asStr(data[k]);
    if (v) input[k] = v; // string: URL or path relative to the post file
  }
  if (Array.isArray(data.tags)) input.tags = data.tags.map(String);
  if (Array.isArray(data.faq)) input.faq = data.faq as PostInput['faq'];
  if (typeof data.featured === 'boolean') input.featured = data.featured;
  return input as Partial<PostInput> & { title: string };
}

async function syncFile(file: string, ghost: Ghost, root: string, allowPublish: boolean): Promise<Outcome> {
  const abs = resolve(file);
  const text = await readFile(abs, 'utf8');
  const { data, body } = parseMarkdownDoc(text);
  const input = docToInput(data, body, abs);
  const media = loadMediaConfig();
  const ctx: ContentContext = {
    ghost,
    media,
    resolveRelative: async (p) => {
      const target = await realpath(resolve(dirname(abs), p));
      if (!target.startsWith(root + sep)) throw new Error(`Image path ${p} is outside the repository`);
      return checkImageBytes(await readFile(target), media, basename(target));
    },
  };

  const ghostId = asStr(data.ghost_id);
  let post: GhostPost;
  let result: Outcome['result'];
  let current: GhostPost | null = null;
  if (ghostId) {
    current = await ghost.read({ id: ghostId });
    const lastSynced = asStr(data.ghost_revision);
    if (lastSynced && lastSynced !== revisionOf(current))
      return { file, result: 'skipped', detail: `Ghost copy changed since last sync (revision ${revisionOf(current)} vs ${lastSynced}). Pull the change into git, or delete ghost_revision from the front matter to overwrite Ghost.` };
    if (current.status !== 'draft' && !allowPublish)
      return { file, result: 'skipped', detail: `post is ${current.status}; git updates to live posts need ALLOW_GIT_PUBLISH=true` };
  }

  const built = await buildPayload(input, ctx, { existingHead: (current?.codeinjection_head as string | null) ?? null });
  if (current) {
    await ghost.edit(current.id, current.updated_at, built.payload, { html: true });
    result = 'updated';
  } else {
    const created = await ghost.createDraft(built.payload);
    current = created;
    result = 'created';
  }
  post = await ghost.read({ id: current.id });

  if (asStr(data.status) === 'published' && post.status === 'draft') {
    if (allowPublish) {
      await ghost.setStatus(post.id, post.updated_at, 'published');
      post = await ghost.read({ id: post.id });
      result = 'published';
    }
  }

  // Write back ids and Ghost-hosted image URLs so the next sync is an update, not a duplicate.
  const isHtml = data.format === 'html';
  const newBody = isHtml ? body : rewriteMarkdownImages(body, built.imageMap);
  const requested = asStr(data.status);
  await writeFile(abs, toMarkdownDoc({ post, body: newBody, format: isHtml ? 'html' : 'markdown', tags: input.tags, faq: input.faq, status: requested === 'published' || requested === 'draft' ? requested : undefined }));
  const note = asStr(data.status) === 'published' && post.status === 'draft' ? ' (status: published ignored; set ALLOW_GIT_PUBLISH=true to publish from git)' : '';
  return { file, result, detail: `${post.status} ${ghost.editorUrl(post.id)}${note}` };
}

export async function main(files: string[]): Promise<number> {
  const ghost = new Ghost(loadGhostConfig());
  const allowPublish = process.env.ALLOW_GIT_PUBLISH === 'true';
  const root = await realpath(process.cwd());
  const outcomes: Outcome[] = [];
  for (const f of files.filter((x) => /\.md$/i.test(x))) {
    try {
      outcomes.push(await syncFile(f, ghost, root, allowPublish));
    } catch (e) {
      outcomes.push({ file: f, result: 'failed', detail: ghostErrorMessage(e) });
    }
  }
  for (const o of outcomes) console.log(`${o.result.padEnd(9)} ${o.file}  ${o.detail}`);
  if (!outcomes.length) console.log('No Markdown files to sync.');
  return outcomes.some((o) => o.result === 'failed') ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
