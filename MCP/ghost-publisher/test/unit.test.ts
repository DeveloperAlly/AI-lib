import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownToHtml, mergeHead, faqJsonLd, rewriteMarkdownImages } from '../src/content.js';
import { auditPost } from '../src/seo.js';
import { safeRepoPath, toMarkdownDoc, parseMarkdownDoc } from '../src/github.js';
import { sniffImage, isBlockedAddress, decodeBase64Image, fetchImage } from '../src/media.js';
import { docToInput } from '../src/sync.js';
import { makePng } from './helpers.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OwnerOAuthProvider } from '../src/auth.js';

const media = { maxBytes: 1024 * 1024, allowPrivateHosts: false };

test('markdown: fenced code keeps its language; lone image becomes a figure with alt and caption', () => {
  const html = markdownToHtml('## Setup\n\n```ts\nconst x: number = 1;\n```\n\n![A diagram](https://e.com/a.png "The caption")\n');
  assert.match(html, /<pre><code class="language-ts">const x: number = 1;/);
  assert.match(html, /<figure><img src="https:\/\/e.com\/a.png" alt="A diagram"><figcaption>The caption<\/figcaption><\/figure>/);
  assert.doesNotMatch(html, /<p><figure>/);
});

test('FAQ JSON-LD escapes < so answers cannot break out of the script tag', () => {
  const ld = faqJsonLd([{ question: 'Q?', answer: 'evil </script><script>alert(1)</script>' }]);
  assert.equal((ld.match(/<\/script>/g) ?? []).length, 1);
  assert.match(ld, /"@type":"FAQPage"/);
});

test('mergeHead replaces only the managed block and keeps other code injection', () => {
  const first = mergeHead('<meta name="x" content="keep">', [{ question: 'One?', answer: 'A' }]);
  const second = mergeHead(first, [{ question: 'Two?', answer: 'B' }]);
  assert.match(second, /keep/);
  assert.match(second, /Two\?/);
  assert.doesNotMatch(second, /One\?/);
  assert.equal(mergeHead(second, []), '<meta name="x" content="keep">');
});

test('rewriteMarkdownImages points refs at uploaded copies', () => {
  const md = rewriteMarkdownImages('![a](./img/a.png) ![b](https://x/b.png "t")', new Map([['./img/a.png', 'https://g/content/images/a.png'], ['https://x/b.png', 'https://g/content/images/b.png']]));
  assert.equal(md, '![a](https://g/content/images/a.png) ![b](https://g/content/images/b.png "t")');
});

test('SEO audit flags the important problems and passes a good post', () => {
  const bad = auditPost({ title: 'x', html: '<h1>Big</h1><h4>skip</h4><p>short</p><img src="a.png">', feature_image: 'f.png' });
  const codes = bad.map((f) => f.code);
  for (const c of ['BODY_H1', 'HEADING_SKIP', 'IMAGE_ALT_MISSING', 'FEATURE_IMAGE_ALT_MISSING', 'META_DESCRIPTION_MISSING', 'BODY_THIN'])
    assert.ok(codes.includes(c), `expected ${c}`);
  const body = `<p>${'Direct answer words here. '.repeat(8)}</p><h2>Crash Recovery</h2><p>${'word '.repeat(400)}<a href="https://src">source</a></p><pre><code class="language-js">x</code></pre><figure><img src="i.png" alt="ok"></figure>`;
  const good = auditPost({
    title: 'A good descriptive title for testing', slug: 'good-post', html: body, custom_excerpt: 'e', meta_description: 'd'.repeat(120),
    feature_image: 'f.png', feature_image_alt: 'alt', tags: [{ name: 'AI Engineering' }, { name: 'LangGraph' }, { name: 'Agents' }],
    twitter_title: 'x'.repeat(70), twitter_description: 'x'.repeat(200), og_title: 'o', og_description: 'o',
  });
  assert.deepEqual(good.filter((f) => f.severity !== 'info'), []);
});

test('SEO audit: first tag must be a main category; platform fields respect their limits', () => {
  const codes = (p: Parameters<typeof auditPost>[0]) => auditPost({ title: 'T'.repeat(30), html: '<p>x</p>', ...p }).map((f) => `${f.severity}:${f.code}`);
  assert.ok(codes({ tags: ['LangGraph', 'AI Engineering'] }).includes('error:PRIMARY_TAG_MISSING'), 'main tag not first');
  assert.ok(codes({ tags: [] }).includes('error:PRIMARY_TAG_MISSING'));
  assert.ok(!codes({ tags: ['tutorials', 'n8n', 'Agents'] }).some((c) => c.includes('PRIMARY_TAG')), 'case-insensitive');
  assert.ok(codes({ tags: ['OpEds', 'Tutorials'] }).includes('warn:MAIN_TAG_MULTIPLE'));
  assert.ok(codes({ tags: ['OpEds'] }).includes('info:SEARCH_TAGS_COUNT'));
  const c = codes({ twitter_title: 'x'.repeat(71), twitter_description: 'x'.repeat(201), og_title: 'x'.repeat(71), meta_description: 'x'.repeat(146) });
  for (const k of ['TWITTER_TITLE_LONG', 'TWITTER_DESCRIPTION_LONG', 'OG_TITLE_LONG', 'META_DESCRIPTION_LONG', 'OG_DESCRIPTION_MISSING', 'EXCERPT_MISSING'])
    assert.ok(c.includes(`warn:${k}`), k);
  assert.ok(auditPost({ title: 'T', html: '<h2>What is it?</h2><p>x</p>', tags: ['OpEds'] }).some((f) => f.code === 'H2_QUESTION'));
});

test('repo paths cannot escape the repo root', () => {
  assert.equal(safeRepoPath('posts/./a/../b.md'), 'posts/b.md');
  assert.throws(() => safeRepoPath('../secrets'));
  assert.throws(() => safeRepoPath('posts/../../etc/passwd'));
});

test('front matter round-trips through the sync input mapping', () => {
  const doc = toMarkdownDoc({
    post: { id: 'abc', uuid: 'u', title: 'Hello: world', slug: 'hello', status: 'draft', url: 'u', updated_at: '2026-10-25T21:42:51.000Z', published_at: null, meta_description: 'desc', feature_image: 'https://g/i.png', tags: [] },
    body: '## Hi\n\nBody', format: 'markdown', tags: ['AI'], faq: [{ question: 'Q?', answer: 'A' }],
  });
  const { data, body } = parseMarkdownDoc(doc);
  assert.equal(data.ghost_id, 'abc');
  const input = docToInput(data, body, '/x/posts/hello.md');
  assert.equal(input.title, 'Hello: world');
  assert.equal(input.slug, 'hello');
  assert.equal(input.meta_description, 'desc');
  assert.deepEqual(input.tags, ['AI']);
  assert.match(input.markdown!, /## Hi/);
  assert.equal(input.faq?.[0].question, 'Q?');
});

test('image sniffing accepts real rasters and rejects SVG and junk', () => {
  assert.equal(sniffImage(makePng())?.ext, 'png');
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.throws(() => decodeBase64Image(Buffer.from('<svg/>').toString('base64'), media));
  assert.equal(decodeBase64Image(`data:image/png;base64,${makePng().toString('base64')}`, media).kind.ext, 'png');
});

test('SSRF guard blocks private, loopback and metadata addresses', async () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe'])
    assert.ok(isBlockedAddress(a), a);
  for (const a of ['93.184.216.34', '8.8.8.8', '2606:4700::1111', '::ffff:8.8.8.8']) assert.ok(!isBlockedAddress(a), a);
  await assert.rejects(fetchImage('http://example.com/a.png', media), /Only https/);
  await assert.rejects(fetchImage('https://127.0.0.1/a.png', media), /private or reserved/);
  await assert.rejects(fetchImage('https://localhost/a.png', media), /private or reserved/);
});

test('JavaScript front matter is refused, never evaluated', () => {
  (globalThis as any).__pwned = 0;
  assert.throws(() => parseMarkdownDoc('---js\n{ title: "x", p: (globalThis.__pwned = 42) }\n---\nbody'), /not allowed/);
  assert.equal((globalThis as any).__pwned, 0);
});

test('rotating TOKEN_SECRET invalidates existing refresh tokens', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gp-unit-'));
  const cfg = (secret: string) => ({ publicUrl: new URL('http://localhost:1'), port: 1, ownerPassphrase: 'p'.repeat(16), tokenSecret: secret, dataDir: dir, allowedRedirectHosts: ['localhost'], accessTokenTtlSec: 60, refreshTokenTtlSec: 600 });
  const res = new URL('http://localhost:1/mcp');
  const a = new OwnerOAuthProvider(cfg('a'.repeat(40)), res);
  await a.init();
  const client = await a.clientsStore.registerClient!({ redirect_uris: ['http://localhost:9/cb'], token_endpoint_auth_method: 'none' } as any);
  const t = await (a as any).issue(client.client_id, ['ghost:write'], res.href);
  assert.ok((await a.exchangeRefreshToken(client, t.refresh_token)).access_token, 'works with the same secret');
  const t2 = await (a as any).issue(client.client_id, ['ghost:write'], res.href);
  const b = new OwnerOAuthProvider(cfg('b'.repeat(40)), res);
  await b.init();
  await assert.rejects(b.exchangeRefreshToken(client, t2.refresh_token), /Invalid or expired/);
  await assert.rejects(b.verifyAccessToken(t2.access_token), /Invalid access token/);
});

test('TOKEN_SECRET is generated once and persisted when not configured', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gp-secret-'));
  const cfg = () => ({ publicUrl: new URL('http://localhost:1'), port: 1, ownerPassphrase: 'p'.repeat(16), tokenSecret: '', dataDir: dir, allowedRedirectHosts: ['localhost'], accessTokenTtlSec: 60, refreshTokenTtlSec: 600 });
  const res = new URL('http://localhost:1/mcp');
  const a = new OwnerOAuthProvider(cfg(), res);
  await a.init();
  const client = await a.clientsStore.registerClient!({ redirect_uris: ['http://localhost:9/cb'], token_endpoint_auth_method: 'none' } as any);
  const t = await (a as any).issue(client.client_id, ['ghost:write'], res.href);
  const b = new OwnerOAuthProvider(cfg(), res); // simulates a restart
  await b.init();
  assert.ok(await b.verifyAccessToken(t.access_token), 'token from before restart still valid');
  assert.ok((await b.exchangeRefreshToken(client, t.refresh_token)).access_token);
});

// ---------------- covers ----------------
import sharp from 'sharp';
import { createHmac } from 'node:crypto';
import { renderCover, coverSpecFromPost } from '../src/cover.js';
import { pickMotif } from '../src/cover-motifs.js';
import { readCoverSetting, writeCoverSetting, coverState, coverHash, specForPost } from '../src/autocover.js';
import { verifyGhostSignature } from '../src/webhook.js';

test('cover renders a 1200x675 JPEG deterministically, and rejects an empty title', async () => {
  const spec = { title: 'Building Your Own MCP Server', subtitle: 'What I learnt.', kind: 'Playbook', topic: 'MCP' };
  const a = await renderCover(spec);
  const meta = await sharp(a).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 675);
  assert.ok((await renderCover(spec)).equals(a), 'same input, same bytes');
  await assert.rejects(renderCover({ title: '  ' }), /title/);
});

test('long titles shrink to fit instead of overflowing', async () => {
  const long = 'A very long title about retrieval augmented generation, context caching and the trade-offs between them in production';
  const meta = await sharp(await renderCover({ title: long, subtitle: 'Still fits.' })).metadata();
  assert.equal(meta.height, 675);
});

test('cover spec: kind from tags, topic from the next tag, "Title. Rest" splits into a subtitle', () => {
  const s = coverSpecFromPost({ title: "n8n Got a Brain. Here's What That Actually Means for Your Workflows.", tags: ['Field notes', 'Workflow automation'] });
  assert.equal(s.title, 'n8n Got a Brain');
  assert.equal(s.subtitle, "Here's What That Actually Means for Your Workflows.");
  assert.equal(s.kind, 'Field notes');
  assert.equal(s.topic, 'Workflow automation');
  assert.equal(coverSpecFromPost({ title: 'RAG vs CAG', tags: [] }).kind, 'Field notes');
});

test('motif follows the topic', () => {
  const r = () => 0.5;
  assert.equal(pickMotif('n8n Got a Brain workflow automation', r), 'workflow');
  assert.equal(pickMotif('Building Your Own MCP Server', r), 'hub');
  assert.equal(pickMotif('Why & when to use LangGraph', r), 'graph');
  assert.equal(pickMotif('RAG vs CAG', r), 'retrieval');
  assert.equal(pickMotif('The Competitive Edge of deAI', r), 'network');
});

test('cover settings live in a managed code-injection block that keeps other content', () => {
  const head = writeCoverSetting('<meta name="x" content="keep">', { subtitle: 'a --> b', kind: 'Essay' });
  assert.match(head, /keep/);
  assert.doesNotMatch(head.split('cover ')[1], /-->.*-->/s, 'value cannot close the comment early');
  assert.deepEqual(readCoverSetting(head), { subtitle: 'a --> b', kind: 'Essay' });
  const again = writeCoverSetting(head, { topic: 'T' });
  assert.deepEqual(readCoverSetting(again), { topic: 'T' });
  assert.equal(writeCoverSetting(again, {}), '<meta name="x" content="keep">');
});

test('cover ownership: only ah-cover-<hash>.jpg files count as generated; hash tracks title changes', () => {
  assert.deepEqual(coverState(null), { state: 'none' });
  assert.deepEqual(coverState('https://b/content/images/2026/10/ah-cover-0123456789ab.jpg'), { state: 'generated', hash: '0123456789ab' });
  assert.deepEqual(coverState('https://b/content/images/2026/10/ah-cover-0123456789ab-1.jpg'), { state: 'generated', hash: '0123456789ab' });
  assert.deepEqual(coverState('https://b/content/images/2026/10/my-photo.jpg'), { state: 'custom' });
  const p = { title: 'One', slug: 'one', tags: [{ name: 'Essay' }] };
  assert.equal(coverHash(specForPost(p)), coverHash(specForPost({ ...p })));
  assert.notEqual(coverHash(specForPost(p)), coverHash(specForPost({ ...p, title: 'Two' })));
});

test('Ghost webhook signature: HMAC over body + timestamp, fresh timestamp required', () => {
  const secret = 's'.repeat(32), body = Buffer.from('{"post":{}}'), t = String(Date.now());
  const sig = createHmac('sha256', secret).update(Buffer.concat([body, Buffer.from(t)])).digest('hex');
  assert.ok(verifyGhostSignature(body, `sha256=${sig}, t=${t}`, secret));
  assert.ok(!verifyGhostSignature(body, `sha256=${sig}, t=${t}`, 'x'.repeat(32)));
  assert.ok(!verifyGhostSignature(Buffer.from('{"post":1}'), `sha256=${sig}, t=${t}`, secret));
  assert.ok(!verifyGhostSignature(body, `sha256=${sig}, t=${t}`, secret, Number(t) + 11 * 60_000), 'stale');
  assert.ok(!verifyGhostSignature(body, undefined, secret));
});
