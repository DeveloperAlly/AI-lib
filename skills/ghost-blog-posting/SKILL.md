---
name: ghost-blog-posting
description: Publish an article to Ally's Ghost blog (blog.alisonhaire.com) through the Ghost Blogs connector - runs naming, slop review, images, cover and post settings in order, then creates the draft, verifies the preview and publishes on approval. Use for any new post or any update to an existing post.
---

# Ghost blog posting

The orchestrator. It owns the order of the steps and the Ghost mechanics; each step's rules live in its own skill, loaded when the step runs. To write a post from scratch, use `blog-harness` first, then come here to publish.

The author's words are hers. Nothing here rewrites prose without her OK, except the Ghost formatting fixes in step 5, which are reported.

Connector tools: `check_connection`, `list_posts`, `get_post`, `upload_image`, `create_draft`, `update_draft`, `preview_cover`, `apply_cover`, `seo_check`, `publish_post`, `unpublish_post`.

## 0. Start

1. Call `check_connection`. If it fails, stop and tell Ally the connector is not reachable (enable it from the + menu, or reconnect it in Settings > Connectors). If `preview_cover` and `apply_cover` are missing, the chat holds an old copy of the tool list: say so and suggest a new chat.
2. Call `list_posts` with `search` set to a distinctive part of the title. If the post exists, ask whether to update it or create a new one. Never create a silent duplicate.
3. Ask one question, unless she already said: **"Save as a draft, or publish it?"** Offer *Draft (I'll send you the preview)* and *Publish once checks pass*. Default to draft if there is no answer.

## Before posting

### 1. Names: `naming`

Run the blog post title profile for the title, and the blog section heading profile for every H2 and H3. Show the compact output (current name, top three, winner) and apply only the names she approves. Remove a leading `# Title` line from the body, because Ghost renders the title as the H1.

### 2. Prose review: `no-ai-slop`

Run it in detection mode on the body. Report findings with proposed fixes and apply only the fixes she accepts. If the post came through `blog-harness`, its mechanical scan must also be clean.

### 3. Images: `post-images`

Place every image, write alt text, convert SVGs, and get the bytes to a source the server can fetch.

### 4. Cover: `post-cover`

After the names are final. Choose kind, topic, subtitle and motif, run `preview_cover`, and show it.

### 5. Ghost formatting (allowed without asking; report each one)

Verified on blog.alisonhaire.com (Ghost 6.44 to 6.72).

| Item | Rule |
|---|---|
| Headings | H2 and below in the body; no skipped levels (H2 then H3, never H2 then H4). |
| Code blocks | Every fenced block gets a language (`bash`, `python`, `ts`, `json`, `yaml`; `text` for output, logs and transcripts). Never change the code itself. |
| Secrets | Scan code and commands for real-looking keys, tokens, passwords or credentialed URLs. Placeholders like `sk-or-...` are fine. Stop and ask on anything real. |
| Tables | Markdown tables become HTML cards. The content column is 594px and the theme scrolls wide tables: 5 short columns rendered 872px (tolerable), and 3 columns with one prose column rendered 2266px (unusable). Any table whose cells carry a sentence becomes a definition list, one paragraph per row: `**Term** does X. Evidence sentence.` |
| Footnotes | Not supported. Use inline links. |
| Embeds | YouTube: the provider's `<iframe>` on its own line becomes a native embed card; a bare link stays a text link. X: a pasted X embed is turned into a plain quote and does not render, so link to the post instead or ask. Anything else: wrap it in `<!--kg-card-begin: html-->` ... `<!--kg-card-end: html-->`, and note it only shows if the provider's script runs. `prove-it-tutorial` section 6 covers embeds in that mode. |
| Links | Keep them. Flag ones that are obviously broken, such as relative paths to local files, rather than guessing a replacement. |

## While posting

### 6. Settings: `post-settings`

Main category tag first, plus search tags, slug, excerpt, Google, X and LinkedIn fields, and FAQ.

### 7. Create

Call `create_draft` with the Markdown body, the approved title, the `post-settings` fields and `cover: {...}`, and no `feature_image`. It always creates a draft, whatever she chose. For an existing post, use `update_draft` with the latest `expected_revision`; a published post needs `user_approved: true` for each change she approved.

### 8. Verify for real

1. Read the result:
   - `images_uploaded` equals the number of distinct images;
   - the cover was created;
   - `seo_check` shows no errors, and every warning is either fixed or explained to her.
2. Fetch the `preview_url` and check the rendered page. The live theme decides; the Ghost editor can look right while the site does not. A table once rendered white on white on the live site.
   - Every image is present, served from `/content/images/`, with alt text.
   - Tables fit, and code blocks have their languages.
   - The FAQ section is present.
   - Nothing points at a staging location.
3. Fix with `update_draft`, then run `seo_check` again.

## 9. Finish

- **Draft.** Send the preview and editor links. Summarise:
  - the names chosen;
  - prose fixes applied;
  - where each image went;
  - the cover settings;
  - every settings field;
  - the FAQ;
  - the formatting fixes;
  - remaining findings, and whether they are worth acting on.
- **Publish**, only if she chose publish and there are no `error` findings: call `publish_post` with `user_approved: true` and the latest `revision`. Fetch the live URL and confirm:
  - it returns 200;
  - the images show;
  - the meta description is in the page head;
  - `og:image` is the cover.

  Publishing never emails subscribers; say so.
- If publishing is blocked, leave it as a draft and say why.
- Clean up any image staging.

## Known theme defects

- Table header contrast: fixed 13 Sep 2026 by site-header code injection (`.gh-content table th { background: transparent !important; color: inherit !important; border-bottom: 1px solid rgba(128,128,128,.45) !important; }`).
- Table width: open. The breakout fix (`grid-column: wide-start / wide-end`) widens tables to 931px but pushes headings into the sidebar gutter. This needs theme work, not code injection.

## Don'ts

- Don't publish without her choosing to publish in this conversation.
- Don't rewrite her prose, headline or intro without asking.
- Don't upload SVGs, invent FAQ facts, or leave images without alt text.
- Don't delete posts. Retitle a post as superseded and let her delete it.
- Don't paste API keys or passphrases into chat; the connector authenticates on its own.
