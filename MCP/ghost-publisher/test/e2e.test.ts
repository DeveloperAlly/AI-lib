// End-to-end: real Ghost (GHOST_URL/GHOST_ADMIN_API_KEY env), real OAuth flow,
// real MCP client over Streamable HTTP, mocked GitHub API, and the sync CLI.
// Run: GHOST_URL=... GHOST_ADMIN_API_KEY=... NO_PROXY='*' npx tsx --test test/e2e.test.ts

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import GhostAdminAPI from '@tryghost/admin-api';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { listen, makePng, mockGitHub, pkce } from './helpers.js';

const PASS = 'correct horse battery staple 42';
const ghostUrl = process.env.GHOST_URL!;
const api = new GhostAdminAPI({ url: ghostUrl, key: process.env.GHOST_ADMIN_API_KEY!, version: 'v6.0' });

let base = '';
let closeAll: () => Promise<void>;
let gh: ReturnType<typeof mockGitHub>;
let imgUrl = '';
let dataDir = '';
let accessToken = '';
let refreshToken = '';
let clientId = '';
const redirectUri = 'http://localhost:33418/callback';
const createdIds: string[] = [];

async function mcp(token = accessToken) {
  const client = new Client({ name: 'e2e', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return client;
}
const text = (r: any) => (r.content as { text: string }[]).map((c) => c.text).join('\n');
const data = (r: any) => JSON.parse(text(r).slice(text(r).indexOf('\n\n{') + 2));

before(async () => {
  // Image host (stands in for any public image URL) and GitHub mock.
  const imgApp = express();
  imgApp.get('/inline.png', (_q, s) => s.type('image/png').send(makePng(6, 4, [20, 120, 200])));
  imgApp.get('/not-image', (_q, s) => s.type('text/html').send('<html>nope</html>'));
  const img = await listen(imgApp);
  imgUrl = `${img.url}/inline.png`;
  gh = mockGitHub();
  const ghSrv = await listen(gh.app);
  gh.files.set('posts/images/repo-img.png', makePng(5, 5, [10, 200, 10]));

  dataDir = await mkdtemp(join(tmpdir(), 'gp-e2e-'));
  // Bind to a known port so PUBLIC_URL matches.
  const port = 18000 + Math.floor(Math.random() * 1000);
  Object.assign(process.env, {
    PUBLIC_URL: `http://localhost:${port}`,
    OWNER_PASSPHRASE: PASS,
    TOKEN_SECRET: 'x'.repeat(48),
    DATA_DIR: dataDir,
    MEDIA_ALLOW_PRIVATE_HOSTS: 'true',
    GITHUB_TOKEN: 'test-gh-token',
    GITHUB_REPO: 'DeveloperAlly/blog-content',
    GITHUB_API_URL: ghSrv.url,
    // Ghost runs in Docker and reaches this process via the bridge gateway.
    COVER_WEBHOOK_BASE: `http://${process.env.DOCKER_HOST_IP ?? '172.17.0.1'}:${port}`,
    COVER_DEBOUNCE_SEC: '1',
  });
  const { createApp } = await import('../src/server.js');
  const { app, registerGhostWebhooks } = await createApp();
  const srv = await new Promise<import('node:http').Server>((r) => { const s = app.listen(port, '0.0.0.0', () => r(s)); });
  await registerGhostWebhooks();
  base = `http://localhost:${port}`;
  closeAll = async () => {
    for (const s of [srv, img.server, ghSrv.server]) s.closeAllConnections?.(), await new Promise((r) => s.close(r));
  };
});

after(async () => {
  for (const id of createdIds) await api.posts.delete({ id }).catch(() => {});
  try {
    const { ids } = JSON.parse(await readFile(join(dataDir, 'webhooks.json'), 'utf8'));
    for (const id of ids) await (api as any).webhooks.delete({ id }).catch(() => {});
  } catch { /* none registered */ }
  await closeAll?.();
  await rm(dataDir, { recursive: true, force: true });
});

// ---------------- OAuth ----------------

test('unauthenticated MCP request gets 401 pointing at resource metadata', async () => {
  const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 401);
  assert.match(r.headers.get('www-authenticate') ?? '', /resource_metadata="http:\/\/localhost:\d+\/\.well-known\/oauth-protected-resource\/mcp"/);
  const meta = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json();
  assert.equal(meta.resource, `${base}/mcp`);
  const as = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
  assert.ok(as.registration_endpoint && as.token_endpoint && as.authorization_endpoint);
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
});

test('wrong Host header is refused (DNS rebinding protection)', async () => {
  const { request } = await import('node:http');
  const status = await new Promise<number>((res) => {
    const u = new URL(`${base}/.well-known/oauth-authorization-server`);
    request({ host: '127.0.0.1', port: u.port, path: u.pathname, headers: { Host: 'evil.example' } }, (r) => res(r.statusCode!)).end();
  });
  assert.equal(status, 403);
});

test('client registration only accepts allowlisted redirect hosts', async () => {
  const evil = await fetch(`${base}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://evil.example/cb'], token_endpoint_auth_method: 'none' }) });
  assert.equal(evil.status, 400);
  const good = await fetch(`${base}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'] }) });
  assert.equal(good.status, 201);
  clientId = (await good.json()).client_id;
});

test('owner login: wrong passphrase and tampering rejected; correct passphrase + PKCE yields tokens; codes are single use; refresh rotates', async () => {
  const { verifier, challenge } = pkce();
  const auth = new URL(`${base}/authorize`);
  Object.entries({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256', state: 'st8', resource: `${base}/mcp`, scope: 'ghost:write' }).forEach(([k, v]) => auth.searchParams.set(k, v));
  const page = await fetch(auth, { redirect: 'manual' });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Authorise Ghost publishing/);
  assert.match(html, /localhost:33418/); // shows the redirect host
  const reqBlob = /name="req" value="([^"]+)"/.exec(html)![1];
  const sig = /name="sig" value="([^"]+)"/.exec(html)![1];
  const post = (body: Record<string, string>) => fetch(`${base}/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });

  assert.equal((await post({ req: reqBlob, sig, passphrase: 'wrong', decision: 'allow' })).status, 401);
  assert.equal((await post({ req: reqBlob, sig: sig.slice(0, -2) + 'AA', passphrase: PASS, decision: 'allow' })).status, 400);
  const ok = await post({ req: reqBlob, sig, passphrase: PASS, decision: 'allow' });
  assert.equal(ok.status, 302);
  const loc = new URL(ok.headers.get('location')!);
  assert.equal(loc.origin + loc.pathname, redirectUri);
  assert.equal(loc.searchParams.get('state'), 'st8');
  const code = loc.searchParams.get('code')!;

  const tok = (body: Record<string, string>) => fetch(`${base}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, ...body }) });
  assert.equal((await tok({ grant_type: 'authorization_code', code, code_verifier: 'x'.repeat(50), redirect_uri: redirectUri })).status, 400, 'bad PKCE verifier');
  const t = await tok({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri, resource: `${base}/mcp` });
  // The bad-verifier attempt must not have burned the code? It did: codes are single use by design.
  if (t.status !== 200) {
    // Re-run the login to get a fresh code, then exchange correctly.
    const again = await post({ req: reqBlob, sig, passphrase: PASS, decision: 'allow' });
    const code2 = new URL(again.headers.get('location')!).searchParams.get('code')!;
    const t2 = await tok({ grant_type: 'authorization_code', code: code2, code_verifier: verifier, redirect_uri: redirectUri, resource: `${base}/mcp` });
    assert.equal(t2.status, 200);
    const j = await t2.json();
    accessToken = j.access_token; refreshToken = j.refresh_token;
    assert.equal((await tok({ grant_type: 'authorization_code', code: code2, code_verifier: verifier, redirect_uri: redirectUri })).status, 400, 'code reuse');
  } else {
    const j = await t.json();
    accessToken = j.access_token; refreshToken = j.refresh_token;
    assert.equal((await tok({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri })).status, 400, 'code reuse');
  }
  assert.ok(accessToken && refreshToken);

  const r1 = await tok({ grant_type: 'refresh_token', refresh_token: refreshToken });
  assert.equal(r1.status, 200);
  const j1 = await r1.json();
  assert.equal((await tok({ grant_type: 'refresh_token', refresh_token: refreshToken })).status, 400, 'old refresh token is dead after rotation');
  // Reuse of a rotated token is treated as theft: the whole family, including the newest token, is revoked.
  assert.equal((await tok({ grant_type: 'refresh_token', refresh_token: j1.refresh_token })).status, 400, 'family revoked after reuse');
  accessToken = j1.access_token;

  // The page's CSP must allow the post-login redirect (Chrome/Safari apply form-action to redirects).
  const csp = page.headers.get('content-security-policy')!;
  assert.match(csp, /form-action 'self' http:\/\/localhost:33418/);
  assert.match(csp, /frame-ancestors 'none'/);
  const wrong = await post({ req: reqBlob, sig, passphrase: 'wrong-again', decision: 'allow' });
  assert.equal(wrong.headers.get('x-frame-options'), 'DENY', 'failed-login page is not frameable');

  const deny = await post({ req: reqBlob, sig, decision: 'deny' });
  assert.equal(new URL(deny.headers.get('location')!).searchParams.get('error'), 'access_denied');
});

test('malformed login bodies get 400 and do not crash the server', async () => {
  for (const body of ['req=a&sig=b&sig=c', 'req=a&sig=b&passphrase=x&passphrase=y', 'req[x]=1']) {
    const r = await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    assert.equal(r.status, 400, body);
  }
  assert.equal((await fetch(`${base}/health`)).status, 200, 'server still alive');
});

test('claude.ai redirect URIs must be the exact callback path', async () => {
  const reg = (u: string) => fetch(`${base}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [u], token_endpoint_auth_method: 'none' }) }).then((r) => r.status);
  assert.equal(await reg('https://claude.ai/evil/path'), 400);
  assert.equal(await reg('vscode://localhost/cb'), 400);
  assert.equal(await reg('https://claude.ai/api/mcp/auth_callback'), 201);
});

test('forged or garbage bearer tokens are rejected', async () => {
  const [body] = accessToken.split('.');
  for (const t of ['garbage', `${body}.AAAA`, 'bm90LWpzb24.AAAA']) {
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, accept: 'application/json, text/event-stream' }, body: '{}' });
    assert.equal(r.status, 401);
  }
});

// ---------------- MCP tools against real Ghost ----------------

let draft: any;

test('tool list is the narrow publishing surface (no delete)', async () => {
  const c = await mcp();
  const names = (await c.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['apply_cover', 'check_connection', 'create_draft', 'get_post', 'list_posts', 'preview_cover', 'publish_post', 'seo_check', 'unpublish_post', 'update_draft', 'upload_image']);
  const pub = (await c.listTools()).tools.find((t) => t.name === 'publish_post')!;
  assert.equal(pub.annotations?.destructiveHint, true);
  const conn = await c.callTool({ name: 'check_connection', arguments: {} });
  assert.ok(!conn.isError, text(conn));
  assert.match(text(conn), /DeveloperAlly\/blog-content@main\/posts/);
  await c.close();
});

const markdown = `Claude can push posts straight to Ghost as drafts, and nothing goes live until you approve it. This post walks through how the connector works, what it checks, and why each safeguard exists for a self-hosted blog.

## How does the connector publish?

${'It creates a draft through the Ghost Admin API, uploads every image, fills the SEO fields and waits. '.repeat(12)}

![A blue test image](${'IMG'} "Inline caption")

## What does the code look like?

\`\`\`ts
const post = await ghost.createDraft(payload);
\`\`\`

![Green image from the repo](images/repo-img.png)

${'Reviewing in Ghost first means the preview you approve is the exact revision that goes live. '.repeat(10)} See the [Ghost Admin API docs](https://docs.ghost.org/admin-api).
`;

test('create_draft: markdown with inline + repo + base64 images, code, SEO and FAQ lands correctly in Ghost and is mirrored', async () => {
  const c = await mcp();
  const res = await c.callTool({
    name: 'create_draft',
    arguments: {
      title: 'How Claude publishes to Ghost safely',
      slug: 'e2e-claude-ghost-publishing',
      markdown: markdown.replace('IMG', imgUrl),
      excerpt: 'Drafts first, approval second: how the Claude to Ghost connector works.',
      tags: ['AI', 'Ghost'],
      feature_image: { base64: makePng(8, 8).toString('base64'), filename: 'feature.png' },
      feature_image_alt: 'Pink square feature image',
      meta_title: 'How Claude publishes to Ghost safely',
      meta_description: 'Claude drafts posts in Ghost with images, SEO fields and FAQ schema, and publishes only after you approve the exact revision.',
      og_title: 'Claude to Ghost, safely',
      faq: [
        { question: 'Does Claude publish without asking?', answer: 'No. It only creates drafts; publishing needs your explicit approval.' },
        { question: 'Are subscribers emailed?', answer: 'No. The connector never sends a newsletter.' },
      ],
    },
  });
  assert.ok(!res.isError, text(res));
  draft = data(res);
  createdIds.push(draft.id);
  assert.equal(draft.status, 'draft');
  assert.equal(draft.images_uploaded.length, 3);
  assert.match(text(res), /Draft created\. Not published\./);

  // Verify in Ghost directly, not through the tool.
  const p = await api.posts.read({ id: draft.id }, { formats: 'html,lexical', include: 'tags' });
  assert.equal(p.status, 'draft');
  assert.equal(p.slug, 'e2e-claude-ghost-publishing');
  assert.ok(p.feature_image.startsWith(`${ghostUrl}/content/images/`), p.feature_image);
  assert.equal(p.feature_image_alt, 'Pink square feature image');
  assert.equal(p.meta_description.length > 70, true);
  assert.equal(p.og_title, 'Claude to Ghost, safely');
  assert.deepEqual(p.tags.map((t: any) => t.name).sort(), ['AI', 'Ghost']);
  const lex = JSON.parse(p.lexical).root.children;
  const images = lex.filter((n: any) => n.type === 'image');
  assert.equal(images.length, 2);
  assert.ok(images.every((n: any) => n.src.startsWith(`${ghostUrl}/content/images/`)), 'inline images re-hosted on Ghost');
  assert.deepEqual(images.map((n: any) => n.alt), ['A blue test image', 'Green image from the repo']);
  assert.equal(images[0].caption, 'Inline caption');
  const code = lex.find((n: any) => n.type === 'codeblock');
  assert.equal(code.language, 'ts');
  assert.match(code.code, /createDraft/);
  assert.match(p.html, /Frequently asked questions/);
  assert.match(p.codeinjection_head, /"@type":"FAQPage"/);
  assert.equal(p.email ?? null, null);

  // Mirror: one file with front matter, Ghost image URLs, [skip ci].
  const file = gh.files.get('posts/e2e-claude-ghost-publishing.md')!.toString('utf8');
  assert.match(file, new RegExp(`ghost_id: ${draft.id}`));
  assert.match(file, /status: draft/);
  assert.ok(!file.includes(imgUrl), 'mirror points at Ghost copy, not the original URL');
  assert.match(file, /```ts/);
  assert.ok(gh.commits.at(-1)!.message.includes('[skip ci]'));

  // Preview link works for the unpublished draft.
  const prev = await fetch(draft.preview_url);
  assert.equal(prev.status, 200);
  await c.close();
});

test('update_draft: stale revision rejected; correct revision updates in place (no duplicate)', async () => {
  const c = await mcp();
  const stale = await c.callTool({ name: 'update_draft', arguments: { id: draft.id, expected_revision: '0000000000000000', meta_title: 'X' } });
  assert.ok(stale.isError);
  assert.match(text(stale), /Revision mismatch/);
  const faqOnly = await c.callTool({ name: 'update_draft', arguments: { id: draft.id, expected_revision: draft.revision, faq: [{ question: 'Q?', answer: 'A' }] } });
  assert.ok(faqOnly.isError);
  const upd = await c.callTool({ name: 'update_draft', arguments: { id: draft.id, expected_revision: draft.revision, meta_title: 'Claude to Ghost: drafts first, publish on approval' } });
  assert.ok(!upd.isError, text(upd));
  const after = data(upd);
  assert.notEqual(after.revision, draft.revision, 'meta-only change produces a new revision');
  // Ghost itself does NOT bump updated_at for meta-only edits; the old revision must now be refused.
  const replay = await c.callTool({ name: 'publish_post', arguments: { id: draft.id, expected_revision: draft.revision, user_approved: true } });
  assert.ok(replay.isError, 'publishing the pre-edit revision is refused');
  draft = after;
  const same = await api.posts.browse({ filter: 'slug:e2e-claude-ghost-publishing', limit: 'all' });
  assert.equal(same.length, 1);
  const p = await api.posts.read({ id: draft.id }, { formats: 'html' });
  assert.equal(p.meta_title, 'Claude to Ghost: drafts first, publish on approval');
  assert.match(p.html, /Frequently asked questions/, 'body untouched by a metadata-only update');
  await c.close();
});

test('same image as feature and inline is uploaded once', async () => {
  const c = await mcp();
  const r = await c.callTool({ name: 'create_draft', arguments: { title: 'E2E dedupe', markdown: `Intro\n\n![Blue](${imgUrl})\n`, feature_image: { url: imgUrl }, feature_image_alt: 'Blue' } });
  assert.ok(!r.isError, text(r));
  const d = data(r);
  createdIds.push(d.id);
  assert.equal(d.images_uploaded.length, 1);
  const p = await api.posts.read({ id: d.id }, { formats: 'html' });
  assert.ok(p.html.includes(p.feature_image), 'inline image and feature image are the same Ghost URL');
  await c.close();
});

test('upload_image rejects non-images', async () => {
  const c = await mcp();
  const r = await c.callTool({ name: 'upload_image', arguments: { source: { url: imgUrl.replace('inline.png', 'not-image') } } });
  assert.ok(r.isError);
  assert.match(text(r), /did not return a JPEG, PNG, GIF or WebP/);
  await c.close();
});

test('publish_post: needs user_approved; blocked on stale revision and on SEO errors; then publishes without email', async () => {
  const c = await mcp();
  const noApproval = await c.callTool({ name: 'publish_post', arguments: { id: draft.id, expected_revision: draft.revision } });
  assert.ok(noApproval.isError, 'schema requires user_approved: true');
  const stale = await c.callTool({ name: 'publish_post', arguments: { id: draft.id, expected_revision: '0000000000000000', user_approved: true } });
  assert.ok(stale.isError);
  assert.equal((await api.posts.read({ id: draft.id })).status, 'draft', 'still a draft after refused publishes');

  // A draft with an image lacking alt text is blocked by the SEO gate.
  const bad = await c.callTool({ name: 'create_draft', arguments: { title: 'E2E no alt', markdown: `Intro\n\n![](${imgUrl})\n` } });
  const badPost = data(bad);
  createdIds.push(badPost.id);
  const blocked = await c.callTool({ name: 'publish_post', arguments: { id: badPost.id, expected_revision: badPost.revision, user_approved: true } });
  assert.ok(blocked.isError);
  assert.match(text(blocked), /no alt text/);
  assert.equal((await api.posts.read({ id: badPost.id })).status, 'draft');

  const pub = await c.callTool({ name: 'publish_post', arguments: { id: draft.id, expected_revision: draft.revision, user_approved: true } });
  assert.ok(!pub.isError, text(pub));
  assert.match(text(pub), /No email was sent/);
  const p = await api.posts.read({ id: draft.id }, { include: 'email,newsletter' });
  assert.equal(p.status, 'published');
  assert.equal(p.email ?? null, null, 'no email object created');
  assert.equal(p.newsletter ?? null, null, 'no newsletter attached');

  const live = await (await fetch(p.url)).text();
  assert.match(live, /"@type": "Article"/);
  assert.match(live, /"@type":"FAQPage"/);
  assert.match(live, /<meta name="description" content="Claude drafts posts in Ghost/);
  assert.match(live, /language-ts/);
  const mirrorFile = gh.files.get('posts/e2e-claude-ghost-publishing.md')!.toString('utf8');
  assert.match(mirrorFile, /status: published/);
  assert.match(mirrorFile, /## How does the connector publish\?/, 'status-only mirror kept the Markdown body');
  draft = data(pub);
  await c.close();
});

test('editing a live post needs user_approved; unpublish returns it to draft', async () => {
  const c = await mcp();
  const cur = await api.posts.read({ id: draft.id });
  const refused = await c.callTool({ name: 'update_draft', arguments: { id: draft.id, expected_revision: (await (await mcp()).callTool({ name: 'get_post', arguments: { id: draft.id } }).then(data)).revision, excerpt: 'changed' } });
  assert.ok(refused.isError);
  assert.match(text(refused), /user_approved: true/);
  const un = await c.callTool({ name: 'unpublish_post', arguments: { id: draft.id, expected_revision: (await (await mcp()).callTool({ name: 'get_post', arguments: { id: draft.id } }).then(data)).revision, user_approved: true } });
  assert.ok(!un.isError, text(un));
  assert.equal((await api.posts.read({ id: draft.id })).status, 'draft');
  await c.close();
});

// ---------------- GitHub push-to-draft sync ----------------

test('sync CLI: creates once, updates in place, refuses conflicts, publishes only when allowed', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'gp-repo-'));
  await mkdir(join(repo, 'posts', 'img'), { recursive: true });
  await writeFile(join(repo, 'posts', 'img', 'local.png'), makePng(7, 3, [250, 200, 0]));
  const file = join(repo, 'posts', 'from-git.md');
  await writeFile(file, `---\ntitle: Written in git\nmeta_description: ${'A post that arrived through a git push and became a Ghost draft. '.repeat(2).trim()}\nfeature_image: img/local.png\nfeature_image_alt: Yellow bar\ntags: [Git]\nstatus: published\n---\n\nPushed from a repo.\n\n![Yellow](img/local.png)\n\n\`\`\`bash\necho hi\n\`\`\`\n`);
  const { main } = await import('../src/sync.js');
  const cwd = process.cwd();
  process.chdir(repo);
  try {
    delete process.env.ALLOW_GIT_PUBLISH;
    assert.equal(await main(['posts/from-git.md']), 0);
    let text1 = await readFile(file, 'utf8');
    const id = /ghost_id: (\w+)/.exec(text1)![1];
    createdIds.push(id);
    let p = await api.posts.read({ id }, { formats: 'lexical' });
    assert.equal(p.status, 'draft', 'status: published ignored without ALLOW_GIT_PUBLISH');
    assert.ok(p.feature_image.startsWith(`${ghostUrl}/content/images/`));
    assert.match(text1, new RegExp(`\\]\\(${ghostUrl.replace(/[/.:]/g, '\\$&')}/content/images/`), 'image refs rewritten to Ghost URLs');
    assert.equal(JSON.parse(p.lexical).root.children.find((n: any) => n.type === 'codeblock').language, 'bash');

    // Second run updates the same post.
    await writeFile(file, text1.replace('Pushed from a repo.', 'Pushed from a repo, then edited.'));
    assert.equal(await main(['posts/from-git.md']), 0);
    assert.equal((await api.posts.browse({ filter: `slug:${p.slug}`, limit: 'all' })).length, 1);
    p = await api.posts.read({ id }, { formats: 'html' });
    assert.match(p.html, /then edited/);

    // Someone edits only an SEO field in Ghost (Ghost leaves updated_at unchanged): git must still not overwrite it.
    await api.posts.edit({ id, updated_at: p.updated_at, meta_title: 'edited in Ghost' });
    text1 = await readFile(file, 'utf8');
    await writeFile(file, text1.replace('then edited', 'then edited again'));
    assert.equal(await main(['posts/from-git.md']), 0);
    assert.doesNotMatch((await api.posts.read({ id }, { formats: 'html' })).html, /edited again/);

    // Clear the lock, allow publishing: now it goes live (and still no email).
    assert.match(await readFile(file, 'utf8'), /status: published/, 'requested status is preserved in the file');
    await writeFile(file, (await readFile(file, 'utf8')).replace(/ghost_revision: .*\n/, ''));
    process.env.ALLOW_GIT_PUBLISH = 'true';
    assert.equal(await main(['posts/from-git.md']), 0);
    p = await api.posts.read({ id }, { include: 'email' });
    assert.equal(p.status, 'published');
    assert.equal(p.email ?? null, null);
    assert.match(await readFile(file, 'utf8'), /status: published/);
  } finally {
    delete process.env.ALLOW_GIT_PUBLISH;
    process.chdir(cwd);
    await rm(repo, { recursive: true, force: true });
  }
});


// ---------------- automatic covers ----------------

const COVER_RE = /\/ah-cover-([0-9a-f]{12})(?:-\d+)?\.jpg$/;
async function waitFor<T>(fn: () => Promise<T | undefined>, ms = 30000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 500));
  }
}

test('create_draft without a feature image gets a branded cover; preview_cover returns an image', async () => {
  const c = await mcp();
  const r: any = await c.callTool({ name: 'create_draft', arguments: { title: 'Agents that survive restarts', markdown: 'Body text for the cover test.', tags: ['Playbook', 'Agents'], cover: { subtitle: 'Checkpoints, not hope.' } } });
  assert.ok(!r.isError, text(r));
  const d = data(r);
  createdIds.push(d.id);
  const p = await api.posts.read({ id: d.id });
  assert.match(p.feature_image, COVER_RE);
  assert.match(p.feature_image_alt, /Agents that survive restarts/);
  assert.match(p.codeinjection_head, /ghost-publisher-mcp:cover \{"subtitle":"Checkpoints, not hope."\}/);
  const img = await fetch(p.feature_image);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');

  const pv: any = await c.callTool({ name: 'preview_cover', arguments: { id: d.id, subtitle: 'Different subtitle' } });
  assert.equal(pv.content[0].type, 'image');
  assert.ok(Buffer.from(pv.content[0].data, 'base64').length > 20000);
  assert.equal((await api.posts.read({ id: d.id })).feature_image, p.feature_image, 'preview changes nothing');
  await c.close();
});

test('webhook: a post created in Ghost gets a cover, a title edit refreshes it, a chosen image is never replaced', async () => {
  // Created directly in Ghost (no MCP): the webhook should add a cover.
  const made = await api.posts.add({ title: 'Written straight into Ghost', html: '<p>Hello</p>', tags: [{ name: 'Essay' }] }, { source: 'html' });
  createdIds.push(made.id);
  const first = await waitFor(async () => {
    const p = await api.posts.read({ id: made.id });
    return COVER_RE.test(p.feature_image ?? '') ? p : undefined;
  });
  const firstHash = COVER_RE.exec(first.feature_image)![1];

  // Edit the title in Ghost: the generated cover is regenerated.
  await api.posts.edit({ id: made.id, updated_at: first.updated_at, title: 'Renamed in the Ghost editor' });
  const second = await waitFor(async () => {
    const p = await api.posts.read({ id: made.id });
    const h = COVER_RE.exec(p.feature_image ?? '')?.[1];
    return h && h !== firstHash ? p : undefined;
  });
  assert.match(second.feature_image_alt, /Renamed in the Ghost editor/);

  // A post with an image the owner chose: title edits leave it alone.
  const own = await api.posts.add({ title: 'Has its own image', html: '<p>x</p>', feature_image: first.feature_image.replace(/ah-cover-[^/]+$/, 'mine.jpg') }, { source: 'html' });
  createdIds.push(own.id);
  const ownRead = await api.posts.read({ id: own.id });
  await api.posts.edit({ id: own.id, updated_at: ownRead.updated_at, title: 'Has its own image, renamed' });
  await new Promise((r) => setTimeout(r, 4000));
  assert.equal((await api.posts.read({ id: own.id })).feature_image, ownRead.feature_image);
});

test('webhook rejects unsigned and forged requests', async () => {
  const { ids, target } = JSON.parse(await readFile(join(dataDir, 'webhooks.json'), 'utf8'));
  assert.equal(ids.length, 2);
  const path = new URL(target).pathname;
  const body = JSON.stringify({ post: { current: { id: 'a'.repeat(24) } } });
  let res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  assert.equal(res.status, 401);
  res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ghost-signature': `sha256=${'0'.repeat(64)}, t=${Date.now()}` }, body });
  assert.equal(res.status, 401);
});

test('apply_cover saves settings, refuses to replace a chosen image unless asked', async () => {
  const c = await mcp();
  const own = await api.posts.add({ title: 'Chosen image post', html: '<p>x</p>', feature_image: `${ghostUrl}/content/images/2026/10/mine.jpg` }, { source: 'html' });
  createdIds.push(own.id);
  let g: any = data(await c.callTool({ name: 'get_post', arguments: { id: own.id } }));
  let r: any = await c.callTool({ name: 'apply_cover', arguments: { id: own.id, expected_revision: g.revision } });
  assert.ok(r.isError && /replace_custom/.test(text(r)), text(r));
  g = data(await c.callTool({ name: 'get_post', arguments: { id: own.id } }));
  r = await c.callTool({ name: 'apply_cover', arguments: { id: own.id, expected_revision: g.revision, kind: 'Field guide', topic: 'Testing', replace_custom: true } });
  assert.ok(!r.isError, text(r));
  const p = await api.posts.read({ id: own.id });
  assert.match(p.feature_image, COVER_RE);
  assert.match(p.codeinjection_head, /"kind":"Field guide","topic":"Testing"/);
  await c.close();
});
