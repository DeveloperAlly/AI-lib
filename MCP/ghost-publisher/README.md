# Ghost publisher MCP

A remote MCP server that lets Claude write posts into a self-hosted Ghost blog as **drafts**, optimised for search and answer engines, and publish them **only after the owner approves the exact revision in chat**. Every change is mirrored to a GitHub content repo, and pushing Markdown to that repo creates drafts too.

Built for `blog.alisonhaire.com` (Ghost on Sliplane), served at `https://blog.mcp.developerally.io/mcp`.

```
Claude (web / desktop / mobile)
   │  OAuth 2.1 + PKCE (owner passphrase)          GitHub content repo
   ▼                                                 ▲  mirror (a)   │ push (b)
blog.mcp.developerally.io/mcp ──── Ghost Admin API ──┤               ▼
   (this server, Sliplane)          blog.alisonhaire.com      GitHub Action → sync CLI → Ghost drafts
```

## What Claude can do

| Tool | Effect |
| --- | --- |
| `check_connection` | Confirms Ghost is reachable; reports site, version and mirror target. |
| `list_posts`, `get_post` | Read posts. `get_post` returns the current `revision` plus an SEO/AEO check. |
| `create_draft` | New post, always a draft. Markdown body; images uploaded to Ghost; SEO fields; FAQ section + FAQPage structured data. Returns preview and editor links. |
| `update_draft` | Changes only the fields passed, pinned to `expected_revision`. Editing a live post also needs `user_approved: true`. |
| `upload_image` | One-off upload (https URL, small base64, or a path in the content repo). |
| `seo_check` | Title/description length, slug, heading structure, alt text, feature image, code-block languages, links, answer-first opening, FAQ coverage. |
| `publish_post` | Goes live. Requires `user_approved: true` and the reviewed `expected_revision`; blocked on SEO errors (for example missing alt text) unless explicitly accepted. Never emails subscribers. |
| `unpublish_post` | Back to draft, same approval rules. |

There is deliberately **no delete** and no access to members, newsletters, themes or settings.

**Content support:** Markdown with headings, lists, links, tables, images (`![alt](src "caption")` becomes a native Ghost image card with alt text and caption) and fenced code blocks (the language is kept and becomes a native Ghost code card). Images can be https URLs, base64, or paths in the content repo; they are re-hosted on Ghost. JPEG, PNG, GIF and WebP only (SVG is refused because it can carry script). Video and audio are not supported yet.

## Safety model

- **Drafts by default.** Creating content can never publish it.
- **Approval is revision-pinned.** Each read returns a `revision`, a hash over the body, title, slug, images, every SEO field, the FAQ schema and the tags. Publishing refuses if anything changed after the owner reviewed it. Ghost's own `updated_at` is not enough for this: it has one-second resolution and Ghost does **not** change it when only SEO metadata is edited (verified on Ghost 6.72).
- **No email, ever.** Ghost emails a post if and only if a `newsletter` is passed when publishing ([Ghost docs](https://docs.ghost.org/admin-api/posts/sending-a-post)). This server never passes one; the end-to-end test asserts no email object is created.
- **Single-owner OAuth.** Claude registers itself (DCR) and the owner signs in with a passphrase. Redirect URIs are restricted to an allowlist (`claude.ai`, `claude.com`, loopback). PKCE S256 is enforced. Access tokens last 1 hour and are HMAC-signed and bound to this MCP URL. Refresh tokens rotate, and a used one is dead. Login is rate-limited. The login form is signed so its parameters can't be tampered with. Host-header checks block DNS rebinding.
- **Image fetching is SSRF-guarded.** Only https is accepted. Private, loopback, link-local, CGNAT and metadata addresses are refused, and the check runs inside the connection's own DNS lookup so a hostname can't swap addresses between check and connect. Redirects are re-checked, and size is capped (10 MB default).
- **Secrets stay server-side.** The Ghost Admin key and GitHub token live only in Sliplane environment secrets. They are never logged and never returned.
- **Honest limit:** `user_approved: true` is asserted by Claude, so the server can't prove a human clicked anything. The guarantees are that Claude can't publish by accident, that it must name the exact revision, and that it can't publish a revision that changed after review. Your claude.ai tool-permission prompts are a second layer.

## Deploy on Sliplane

### 1. Ghost: create an integration key

Ghost Admin → Settings → Integrations → **Add custom integration** (name it "Claude"). Copy the **Admin API key**, which looks like `24hex:64hex`.

### 2. Sliplane: create the service

In the same Sliplane project as Ghost, **Deploy Service**:

- **Source:** GitHub repo `DeveloperAlly/AI-lib`, branch `main`
- **Dockerfile path:** `MCP/ghost-publisher/Dockerfile`, **Docker context:** `MCP/ghost-publisher`
- **Expose service:** on (public). **Health check path:** `/health`
- **Volume (recommended):** mount at `/data`. This keeps OAuth clients and refresh tokens across deploys; without it you will need to re-authorise Claude after each deploy. Sliplane notes that volumes turn off zero-downtime deploys.
- **Environment variables** (mark the secret ones as secret):

| Variable | Value |
| --- | --- |
| `PUBLIC_URL` | `https://blog.mcp.developerally.io` |
| `GHOST_URL` | `https://blog.alisonhaire.com` |
| `GHOST_ADMIN_API_KEY` | *secret*: key from step 1 |
| `OWNER_PASSPHRASE` | *secret*: 16+ characters; you type this once when connecting Claude |
| `TOKEN_SECRET` | *secret*: `openssl rand -hex 32` (changing it signs everyone out) |
| `GITHUB_TOKEN` | *secret, optional*: fine-grained PAT, **Contents: read and write** on the content repo only |
| `GITHUB_REPO` | optional: e.g. `DeveloperAlly/blog-content` |
| `GITHUB_BRANCH` / `GITHUB_POSTS_DIR` | optional: default `main` / `posts` |

`PORT` and `DATA_DIR` are set in the image (`8080`, `/data`). Do not add secrets as Docker build args.

### 3. DNS: `blog.mcp.developerally.io` (Cloudflare)

1. Sliplane → service → **Domains** → **Add Domain** → `blog.mcp.developerally.io`.
2. Cloudflare → `developerally.io` → DNS → add a **CNAME** with name `blog.mcp` and target the `*.sliplane.app` host that Sliplane shows. Set it to **DNS only (grey cloud)**.
3. Leave it grey. Cloudflare's free Universal SSL covers only first-level subdomains, and `blog.mcp.developerally.io` is second-level, so proxying it would serve an invalid certificate. Sliplane issues the certificate itself.

Check: `https://blog.mcp.developerally.io/health` returns `{"ok":true,...}`, and `https://blog.mcp.developerally.io/.well-known/oauth-protected-resource/mcp` returns JSON whose `resource` is `https://blog.mcp.developerally.io/mcp`.

### 4. Connect Claude

claude.ai → Settings → Connectors → **Add custom connector** → URL `https://blog.mcp.developerally.io/mcp` (leave OAuth client fields blank) → Connect. A page titled **Authorise Ghost publishing** opens: enter `OWNER_PASSPHRASE` and choose **Authorise**. Enable the connector in a chat from the + menu. It then works on web, desktop and mobile.

## GitHub: mirror and push-to-draft

1. Create a content repo (e.g. `DeveloperAlly/blog-content`) with a `posts/` folder.
2. **Mirror (a):** set `GITHUB_TOKEN` + `GITHUB_REPO` on the server. Every create, update, publish and unpublish writes `posts/<slug>.md`, with front matter and image links pointing at the Ghost copies. These commits carry `[skip ci]`, so they don't trigger the sync.
3. **Push-to-draft (b):** copy [`github/ghost-sync.yml`](github/ghost-sync.yml) to `.github/workflows/ghost-sync.yml` in the content repo, and add repo secrets `GHOST_URL` and `GHOST_ADMIN_API_KEY`. Pushing a changed `posts/*.md` creates or updates a draft, uploads images (relative paths work), and writes `ghost_id` / `ghost_revision` back into the file.
   - If the Ghost copy was edited since the last sync, the file is **skipped**, not overwritten. Pull the change into git, or delete `ghost_revision` to force it.
   - `status: published` in a file publishes only if the repo variable `ALLOW_GIT_PUBLISH` is `true`. The default is drafts only, which keeps chat approval as the one way to go live.

Post file format (the same one the mirror writes):

```markdown
---
title: How I deploy Ghost on Sliplane
slug: deploy-ghost-on-sliplane
meta_title: Deploy Ghost on Sliplane in 10 minutes
meta_description: A step-by-step guide to running Ghost on Sliplane with a custom domain, HTTPS and backups.
excerpt: Ghost on Sliplane, start to finish.
tags: [Ghost, Self-hosting]
feature_image: images/cover.png
feature_image_alt: Ghost admin dashboard on a laptop
faq:
  - question: Does Sliplane handle HTTPS?
    answer: Yes. Custom domains get certificates automatically.
status: draft
---

Opening paragraph that answers the question directly in 40 to 60 words...

## How do I set up the database?
```

## Using it in Claude

> Write a post about X for my blog. Make it SEO and AEO friendly, include a code example and the cover image at <url>. Create it as a draft and show me the preview.

> Change the meta description to ... and add an FAQ about ...

> Looks good, publish it.

Claude creates the draft, shows the preview link and the SEO/AEO findings, and waits. It publishes only after you say so, pinned to the revision you saw.

## Development

```bash
npm ci
npm run build
npm run test:unit                      # pure logic, no network
GHOST_URL=http://localhost:2368 GHOST_ADMIN_API_KEY=... NO_PROXY='*' npm run test:e2e   # needs a disposable Ghost
SMOKE_BASE=https://blog.mcp.developerally.io SMOKE_PASSPHRASE=... npx tsx test/smoke.ts  # read-only check of a deployed server
```

The end-to-end suite runs against a real Ghost (tested on Ghost 6.72 in Docker). It drives the full OAuth flow and the MCP protocol, uses a mocked GitHub API, and runs the sync CLI. It creates its own posts and deletes them afterwards. **Never point it at the live blog**: use a throwaway Ghost, for example `docker run -e server__host=0.0.0.0 -e url=http://localhost:2368 -e NODE_ENV=development -e database__client=sqlite3 -e database__connection__filename=/var/lib/ghost/content/data/ghost.db -p 2368:2368 ghost:6-alpine`.

## Known limits

- Images only. Video, audio and file uploads aren't in Ghost's documented integration API, so they aren't supported.
- Base64 images go through the chat transcript, so keep them small and prefer URLs or repo paths for photos.
- Changing a post's slug leaves the old mirror file in the repo; delete it by hand.
- The server keeps up to 200 registered OAuth clients. Claude registers one per connection, and the oldest unused ones are pruned.
