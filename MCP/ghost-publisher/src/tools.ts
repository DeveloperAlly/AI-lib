// MCP tool surface. Narrow on purpose: no delete, no members, no newsletters.
// Drafts are the only thing Claude can create; going live needs an explicit,
// revision-pinned publish call that the owner approved in chat.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { MediaConfig } from './config.js';
import { buildPayload, imageSourceSchema, postFieldsShape, rewriteMarkdownImages, toGhostImage, type ContentContext, type PostInput } from './content.js';
import { Ghost, ghostErrorMessage, revisionOf, type GhostPost } from './ghost.js';
import { GitHubRepo, SKIP_CI, parseMarkdownDoc, toMarkdownDoc } from './github.js';
import { auditPost, summarise } from './seo.js';
import { coverHash, coverOptionsSchema, coverState, ensureCover, specForPost, writeCoverSetting, type CoverSetting } from './autocover.js';
import { renderCover, coverSpecFromPost } from './cover.js';

export interface ToolDeps {
  ghost: Ghost;
  media: MediaConfig;
  github: GitHubRepo | null;
}

type Result = { content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[]; isError?: boolean };
const ok = (text: string, data?: unknown): Result => ({
  content: [{ type: 'text', text: data === undefined ? text : `${text}\n\n${JSON.stringify(data, null, 2)}` }],
});
const fail = (text: string): Result => ({ content: [{ type: 'text', text }], isError: true });

async function guard(fn: () => Promise<Result>): Promise<Result> {
  try {
    return await fn();
  } catch (e) {
    return fail(ghostErrorMessage(e));
  }
}

function summary(g: Ghost, p: GhostPost) {
  return {
    id: p.id,
    title: p.title,
    slug: p.slug,
    status: p.status,
    revision: p.html !== undefined ? revisionOf(p) : undefined,
    updated_at: p.updated_at,
    published_at: p.published_at,
    editor_url: g.editorUrl(p.id),
    ...(p.status === 'published' ? { live_url: p.url } : { preview_url: g.previewUrl(p) }),
  };
}

const coverSchema = coverOptionsSchema
  .extend({ off: z.boolean().optional().describe('true = no generated cover for this post') })
  .optional()
  .describe('Branded cover. Used automatically when no feature_image is given; pass settings to tune the eyebrow/subtitle/motif, or off: true for no generated cover.');
const toSetting = (c: CoverSetting): CoverSetting => (c.off ? { off: true } : { ...c, off: undefined });
void coverState;

export function registerTools(server: McpServer, deps: ToolDeps): void {
  const { ghost, github } = deps;
  const ctx: ContentContext = { ghost, media: deps.media, resolveRelative: github?.resolver(deps.media, github.cfg.postsDir) };

  /** Mirror to GitHub; never fails the Ghost operation, reports instead. */
  async function mirror(post: GhostPost, src: { markdown?: string; html?: string; tags?: string[]; faq?: PostInput['faq'] } | null, action: string): Promise<string> {
    if (!github) return 'GitHub mirror: not configured.';
    try {
      const path = github.postPath(post.slug);
      let body = src?.markdown ?? src?.html;
      let format: 'markdown' | 'html' = src?.markdown !== undefined ? 'markdown' : 'html';
      let faq = src?.faq;
      if (body === undefined) {
        // Status-only change: keep the existing mirrored body if there is one.
        const existing = await github.readRaw(path);
        if (existing) {
          const doc = parseMarkdownDoc(Buffer.from(existing).toString('utf8'));
          body = doc.body;
          format = doc.data.format === 'html' ? 'html' : 'markdown';
          faq ??= doc.data.faq as PostInput['faq'];
        } else {
          body = post.html ?? (await ghost.read({ id: post.id })).html ?? '';
          format = 'html';
        }
      }
      const res = await github.writeFile(path, toMarkdownDoc({ post, body, format, tags: src?.tags, faq }), `ghost-mcp: ${action} ${post.slug} ${SKIP_CI}`);
      return `GitHub mirror: ${github.cfg.repo}/${res.path} @ ${res.commit.slice(0, 7)}.`;
    } catch (e) {
      return `GitHub mirror FAILED (Ghost change still applied): ${(e as Error).message}`;
    }
  }

  server.registerTool(
    'check_connection',
    {
      title: 'Check Ghost connection',
      description: 'Verify the connection to the Ghost blog and report the site title, URL, Ghost version and whether the GitHub mirror is configured.',
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    () => guard(async () => {
      const s = await ghost.site();
      return ok('Connected to Ghost.', { title: s.title, url: s.url, version: s.version, github_mirror: github ? `${github.cfg.repo}@${github.cfg.branch}/${github.cfg.postsDir}` : null });
    }),
  );

  server.registerTool(
    'list_posts',
    {
      title: 'List posts',
      description: 'List posts on the blog, newest first, with ids. Use get_post to obtain the current revision before editing or publishing.',
      inputSchema: {
        status: z.enum(['draft', 'published', 'scheduled', 'all']).default('all'),
        search: z.string().max(100).optional().describe('Case-insensitive title search'),
        limit: z.number().int().min(1).max(50).default(15),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (a) => guard(async () => {
      const posts = await ghost.list(a);
      return ok(`${posts.length} post(s).`, posts.map((p) => summary(ghost, p)));
    }),
  );

  server.registerTool(
    'get_post',
    {
      title: 'Get post',
      description: 'Read one post by id or slug: content (HTML), SEO fields, tags, current revision, and an SEO/AEO check. Read this before update_draft or publish_post to get the current revision.',
      inputSchema: { id: z.string().optional(), slug: z.string().optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (a) => guard(async () => {
      if (!a.id && !a.slug) return fail('Give id or slug.');
      const p = await ghost.read(a);
      const findings = auditPost(p);
      const fields = Object.fromEntries(
        ['custom_excerpt', 'feature_image', 'feature_image_alt', 'feature_image_caption', 'meta_title', 'meta_description', 'og_title', 'og_description', 'og_image', 'twitter_title', 'twitter_description', 'twitter_image', 'canonical_url', 'featured']
          .map((k) => [k, p[k] ?? null]),
      );
      return ok(summarise(findings), { ...summary(ghost, p), tags: p.tags?.map((t) => t.name), ...fields, html: p.html, findings });
    }),
  );

  server.registerTool(
    'upload_image',
    {
      title: 'Upload image',
      description: 'Upload an image (public https URL, small base64, or a path in the GitHub content repo) to Ghost and return its Ghost-hosted URL. create_draft and update_draft upload images automatically, so this is only needed for one-off uploads.',
      inputSchema: { source: imageSourceSchema },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (a) => guard(async () => ok('Uploaded.', { url: await toGhostImage(a.source, ctx) })),
  );

  server.registerTool(
    'create_draft',
    {
      title: 'Create draft post',
      description:
        'Create a NEW post as a DRAFT (never published). Write the body in Markdown; inline images (![alt](url "caption")) and the feature image are uploaded to Ghost automatically. Fill the SEO fields (meta_title <= 60 chars, meta_description 70-160 chars, excerpt, feature_image_alt) and, for answer-engine optimisation, open with a direct answer and add an faq list. Returns preview and editor links plus an SEO/AEO check. Show the owner the preview link and wait for explicit approval before calling publish_post.',
      inputSchema: { ...postFieldsShape, cover: coverSchema },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    ({ cover, ...input }) => guard(async () => {
      if (input.markdown === undefined && input.html === undefined) return fail('Provide the post body as markdown (preferred) or html.');
      const built = await buildPayload(input, ctx);
      if (cover !== undefined) built.payload.codeinjection_head = writeCoverSetting(built.payload.codeinjection_head as string | undefined, toSetting(cover));
      const created = await ghost.createDraft(built.payload);
      let post = await ghost.read({ id: created.id }); // re-read for rendered HTML
      let coverNote = 'Cover: feature image supplied.';
      if (!input.feature_image && !cover?.off) {
        const r = await ensureCover(ghost, post);
        coverNote = `Cover: ${r.action}${r.url ? ` (${r.url})` : ''}.`;
        if (r.url) post = await ghost.read({ id: post.id });
      }
      const findings = auditPost(post);
      const md = input.markdown !== undefined ? rewriteMarkdownImages(input.markdown, built.imageMap) : undefined;
      const mirrored = await mirror(post, { markdown: md, html: md === undefined ? input.html : undefined, tags: input.tags, faq: input.faq }, 'draft');
      return ok(`Draft created. Not published.\n${coverNote}\n${mirrored}\n${summarise(findings)}`, { ...summary(ghost, post), images_uploaded: built.uploaded, findings });
    }),
  );

  server.registerTool(
    'update_draft',
    {
      title: 'Update post',
      description:
        'Update fields of an existing post. Pass expected_revision from the latest get_post/create_draft/update_draft result; the update is rejected if anything in the post changed since (no silent overwrites). Only the fields you pass are changed; passing markdown/html replaces the whole body. Editing a PUBLISHED post changes the live page, so it additionally requires user_approved: true after the owner explicitly approved that change in chat.',
      inputSchema: {
        id: z.string(),
        expected_revision: z.string().describe('revision from the most recent read of this post'),
        ...Object.fromEntries(Object.entries(postFieldsShape).map(([k, v]) => [k, k === 'title' ? (v as z.ZodString).optional() : v])),
        cover: coverSchema,
        user_approved: z.boolean().optional().describe('Required (true) only when the post is already published'),
      } as Record<string, z.ZodTypeAny>,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (raw) => guard(async () => {
      const a = raw as Partial<PostInput> & { id: string; expected_revision: string; user_approved?: boolean; cover?: CoverSetting };
      const current = await ghost.read({ id: a.id });
      if (revisionOf(current) !== a.expected_revision)
        return fail(`Revision mismatch: the post changed since revision ${a.expected_revision} (now ${revisionOf(current)}). Re-read it with get_post, check what changed, and retry.`);
      if (current.status !== 'draft' && a.user_approved !== true)
        return fail(`This post is ${current.status}. Changing it alters the live page; ask the owner to approve this specific change, then call again with user_approved: true.`);
      const { id, expected_revision, user_approved, cover, ...fields } = a;
      void expected_revision;
      void user_approved;
      if (fields.faq !== undefined && fields.markdown === undefined && fields.html === undefined)
        return fail('To change the FAQ, pass the full body too (markdown or html) so the visible FAQ section and its structured data stay in sync.');
      const built = await buildPayload(fields, ctx, { existingHead: current.codeinjection_head as string | null });
      if (cover !== undefined)
        built.payload.codeinjection_head = writeCoverSetting((built.payload.codeinjection_head as string | undefined) ?? (current.codeinjection_head as string | null), toSetting(cover));
      const edited = await ghost.edit(id, current.updated_at, built.payload, { html: built.hasBody });
      let post = await ghost.read({ id: edited.id });
      // Keep a generated cover in step with the new title/tags/settings (never touches a chosen image).
      const coverRes = fields.feature_image ? null : await ensureCover(ghost, post);
      if (coverRes?.url) post = await ghost.read({ id: post.id });
      const md = fields.markdown !== undefined ? rewriteMarkdownImages(fields.markdown, built.imageMap) : undefined;
      const mirrored = await mirror(post, built.hasBody ? { markdown: md, html: md === undefined ? fields.html : undefined, tags: fields.tags, faq: fields.faq } : null, 'update');
      const findings = auditPost(post);
      return ok(`Post updated (status: ${post.status}).\nCover: ${coverRes ? coverRes.action : 'feature image supplied'}.\n${mirrored}\n${summarise(findings)}`, { ...summary(ghost, post), images_uploaded: built.uploaded, findings });
    }),
  );

  server.registerTool(
    'preview_cover',
    {
      title: 'Preview cover',
      description:
        "Render the branded cover (1200x675, Alison Haire design system) without changing anything and return the image. Give a post id to preview that post's cover with its current title/tags/settings (optionally overridden), or give a title to preview a cover for a post that doesn't exist yet.",
      inputSchema: { id: z.string().optional(), tags: z.array(z.string()).max(10).optional().describe('Tags, when previewing without a post id'), ...coverOptionsSchema.shape },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (a) => guard(async () => {
      const { id, tags, ...opts } = a;
      let spec;
      if (id) {
        const p = await ghost.read({ id });
        const base = specForPost(p);
        spec = { ...base, ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)) };
      } else if (opts.title) spec = coverSpecFromPost({ title: opts.title, tags }, { ...opts, title: undefined, keywords: (tags ?? []).join(' ') });
      else return fail('Give a post id or a title.');
      const jpg = await renderCover(spec);
      return {
        content: [
          { type: 'image', data: jpg.toString('base64'), mimeType: 'image/jpeg' },
          { type: 'text', text: `Preview only; nothing was changed.\n${JSON.stringify({ ...spec, hash: coverHash(spec) }, null, 2)}` },
        ],
      };
    }),
  );

  server.registerTool(
    'apply_cover',
    {
      title: 'Apply generated cover',
      description:
        "Generate the branded cover for a post and set it as the feature image, optionally saving cover settings (eyebrow kind/topic, cover title, subtitle, motif) that later title edits in Ghost keep using. Replaces a generated cover freely, but replaces an image the owner chose only with replace_custom: true. Changing a PUBLISHED post needs user_approved: true after the owner approved it in chat. Pass off: true to stop automatic covers for this post.",
      inputSchema: {
        id: z.string(),
        expected_revision: z.string(),
        ...coverOptionsSchema.shape,
        off: z.boolean().optional().describe('Disable automatic covers for this post'),
        replace_custom: z.boolean().default(false).describe('Replace a feature image the owner chose (only if they asked)'),
        user_approved: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    (a) => guard(async () => {
      let post = await ghost.read({ id: a.id });
      if (revisionOf(post) !== a.expected_revision) return fail(`Revision mismatch (now ${revisionOf(post)}). Re-read the post and retry.`);
      if (post.status !== 'draft' && a.user_approved !== true)
        return fail(`This post is ${post.status}; changing its cover changes the live page. Get the owner's approval, then call again with user_approved: true.`);
      const { id, expected_revision, replace_custom, user_approved, ...opts } = a;
      void id; void expected_revision; void user_approved;
      const hasOpts = Object.values(opts).some((v) => v !== undefined);
      if (hasOpts) {
        const head = writeCoverSetting(post.codeinjection_head as string | null, opts.off ? { off: true } : { ...opts, off: undefined });
        await ghost.edit(post.id, post.updated_at, { codeinjection_head: head });
        post = await ghost.read({ id: post.id });
      }
      if (opts.off) return ok('Automatic covers are off for this post. The current feature image was left as is.', summary(ghost, post));
      const r = await ensureCover(ghost, post, { replaceCustom: replace_custom });
      if (r.action === 'kept-custom') return fail('This post has a feature image the owner chose. Pass replace_custom: true only if she asked to replace it.');
      post = await ghost.read({ id: post.id });
      return ok(`Cover ${r.action}.`, { ...summary(ghost, post), feature_image: post.feature_image });
    }),
  );

  server.registerTool(
    'seo_check',
    {
      title: 'SEO/AEO check',
      description: 'Run the SEO and answer-engine checks on a post: title and description length, slug, heading structure, image alt text, feature image, code block languages, links, answer-first opening and FAQ coverage.',
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (a) => guard(async () => {
      const p = await ghost.read({ id: a.id });
      const findings = auditPost(p);
      return ok(summarise(findings), { id: p.id, revision: revisionOf(p), findings });
    }),
  );

  server.registerTool(
    'publish_post',
    {
      title: 'Publish post',
      description:
        'Publish a draft so it goes LIVE on the blog. Only call this after the owner has reviewed the draft and explicitly said to publish it in this conversation. Pin the exact revision they reviewed with expected_revision; if anything changed since, it refuses. Never sends a newsletter email. Blocked if the SEO/AEO check has errors (e.g. missing alt text) unless accept_findings is true.',
      inputSchema: {
        id: z.string(),
        expected_revision: z.string().describe('revision of the draft the owner reviewed'),
        user_approved: z.literal(true).describe('Must be true: confirms the owner explicitly approved publishing this post in chat'),
        accept_findings: z.boolean().default(false).describe('Publish despite SEO/AEO errors (only if the owner said so)'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    (a) => guard(async () => {
      const current = await ghost.read({ id: a.id });
      if (current.status === 'published') return ok('Already published.', summary(ghost, current));
      if (current.status !== 'draft') return fail(`Post is ${current.status}; only drafts can be published with this tool.`);
      if (revisionOf(current) !== a.expected_revision)
        return fail(`Revision mismatch: the draft changed after review (now revision ${revisionOf(current)}). Show the owner the latest preview and get approval again.`);
      const findings = auditPost(current);
      const errors = findings.filter((f) => f.severity === 'error');
      if (errors.length && !a.accept_findings)
        return fail(`Not published. Fix these first (or get the owner's OK and pass accept_findings: true):\n${errors.map((e) => `- ${e.message}`).join('\n')}`);
      await ghost.setStatus(a.id, current.updated_at, 'published');
      const post = await ghost.read({ id: a.id });
      const mirrored = await mirror(post, null, 'publish');
      return ok(`Published. No email was sent.\n${mirrored}`, summary(ghost, post));
    }),
  );

  server.registerTool(
    'unpublish_post',
    {
      title: 'Unpublish post',
      description: 'Take a published post offline by returning it to draft. Only after the owner explicitly asks for it.',
      inputSchema: {
        id: z.string(),
        expected_revision: z.string(),
        user_approved: z.literal(true).describe('Must be true: the owner explicitly asked to unpublish'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    (a) => guard(async () => {
      const current = await ghost.read({ id: a.id });
      if (current.status === 'draft') return ok('Already a draft.', summary(ghost, current));
      if (revisionOf(current) !== a.expected_revision) return fail(`Revision mismatch (now ${revisionOf(current)}). Re-read and confirm with the owner.`);
      await ghost.setStatus(a.id, current.updated_at, 'draft');
      const post = await ghost.read({ id: a.id });
      const mirrored = await mirror(post, null, 'unpublish');
      return ok(`Unpublished; the post is a draft again.\n${mirrored}`, summary(ghost, post));
    }),
  );
}
