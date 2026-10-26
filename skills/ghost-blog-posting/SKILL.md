---
name: ghost-blog-posting
description: Post an article to the Ghost blog via the Ghost Blogs connector: images placed in the text, branded cover generated, code blocks tidied, full SEO/AEO, saved as a draft or published.
---

# Ghost blog posting

Turns an article (Markdown file, pasted text, or a draft written in chat) plus its images into a correct Ghost post using the **Ghost Blogs** connector (`check_connection`, `list_posts`, `get_post`, `upload_image`, `create_draft`, `update_draft`, `preview_cover`, `apply_cover`, `seo_check`, `publish_post`, `unpublish_post`).

The author's words are hers. This skill fixes structure and metadata; it does not rewrite prose. Any wording change beyond the mechanical fixes listed below needs her OK first.

## 1. Start: connection, duplicates, draft or publish

1. Call `check_connection`. If it fails, stop and tell the user the connector is not reachable (enable it from the + menu, or reconnect it in Settings > Connectors).
   - Also check that `preview_cover` and `apply_cover` are in your tool list. If they're missing, the chat is holding an old copy of the connector's tools: say so and suggest starting a new chat. Don't fake a cover with another image.
2. Call `list_posts` with `search` set to a distinctive part of the title. If a post with that title already exists, ask whether to update it (`update_draft`) or create a new one. Never create a silent duplicate.
3. Ask **one** question, unless the user already said which: **"Save as a draft, or publish it?"** Offer: *Draft (I'll send you the preview)* and *Publish once checks pass*. Default to draft if there is no answer.

## 2. Images: get every image into the text

**Inventory.** List every image the user supplied (attachments, zips, URLs) and every image reference in the text (`![alt](path)`, `<img>`). Unzip archives. Check each file's real type and pixel size (`file img.png`).

**Match references to files.**
- Match by filename stem, ignoring folder and extension. For example, `diagrams/01-mental-model.svg` in the text matches `01-mental-model.png` in the zip.
- If a reference has no matching file, or a file has no reference, look at the image and the surrounding text. Place it directly after the paragraph it illustrates.
- If the right spot is genuinely unclear, ask. Never drop an image silently, and never leave a reference pointing at a file that won't upload.

**Formats.** The server accepts JPEG, PNG, GIF and WebP up to 10 MB. It refuses SVG on purpose, because SVG can carry script. Convert SVGs to PNG at about 1600px wide:

```bash
pip install cairosvg
python3 -c "import cairosvg; cairosvg.svg2png(url='in.svg', write_to='out.png', output_width=1600)"
```

**Alt text and captions.**
- Every image needs real alt text that describes what the image shows. A file name is not alt text. Keep the author's alt text if she wrote some.
- Captions are optional and use Markdown title syntax: `![alt](src "caption")`.
- An image must be alone in its own paragraph. That is what makes Ghost create a native image card.

**Getting the bytes to Ghost.** The connector runs on a server, so it cannot read files from this chat. It needs one of these, in order of preference:
1. **An existing public https URL.** Use it as-is. The server downloads the image and re-hosts it on Ghost.
2. **The GitHub content repo**, if `check_connection` shows `github_mirror` set. Commit the images there and reference them by repo path (`repo_path`, or a relative path in the Markdown).
3. **A temporary public staging location the user owns**, such as a throwaway branch of a public repo. Use `https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>` URLs.
   - Tell the user before pushing anything, and say where it is.
   - Use the repo name exactly as GitHub reports it now. A renamed repo's old name gives a 404 on raw URLs.
   - Delete the staging location after the post is created. If you cannot delete it, tell the user it is safe to delete, because Ghost keeps its own copies.
4. **Base64.** Only for small images (under about 150 KB each), since the bytes travel through the conversation.

**Feature image: the branded cover (default).**
- Leave `feature_image` out. The server then generates the branded cover: Alison Haire design system, a topic illustration, and the LinkedIn and X handles. This keeps every cover on the blog consistent. Its alt text is set automatically.
- Set the eyebrow through tags. Include one kind tag (Essay, Playbook, Field guide, Field notes, Tutorial, Analysis, Research, Op-ed, Interview); the next tag becomes the topic.
- Pass `cover: { subtitle, kind, topic, title, motif }` when the defaults aren't right:
  - `title`: use a shorter cover title when the post title is long. "Title. Rest" and "Title: Rest" split into title and subtitle automatically.
  - `subtitle`: one line of at most about 60 characters, in the author's voice and taken from the post.
- Before creating the post, call `preview_cover` with the title and tags, and show her the image so she can approve or adjust it.
- Use a different `feature_image` only if she supplies one or asks for it. Never replace a cover she chose; `apply_cover` needs `replace_custom: true` for that, and only on her say-so.
- Diagrams from the post stay inline. Don't promote one to feature image unless she asks.
- **Existing posts:** `apply_cover` (with `expected_revision`) generates the cover and saves its settings, so later title edits in Ghost keep them.
  - A published post also needs `user_approved: true`.
  - Replacing an image she chose also needs `replace_custom: true`, and only when she asked for it.
  - Show her `preview_cover` first.
- **What happens without you:** posts she creates or retitles directly in Ghost get or refresh their generated cover automatically, about 2 minutes after the last edit. You don't need to do anything for those.

## 3. Mechanical fixes to the text (allowed without asking; report each one)

- **Title.** Remove a leading `# Title` line, because Ghost renders the post title as the H1. The body starts at H2. Do not skip heading levels: H2 then H3, never H2 then H4.
- **Code blocks.**
  - Every fenced block gets a language tag (`bash`, `python`, `ts`, `json`, `yaml`, …). Use `text` for program output, logs and terminal transcripts.
  - Never change the code itself.
  - Scan code and commands for anything that looks like a real secret: API keys, tokens, passwords, private URLs with credentials. Placeholders like `sk-or-...` are fine. If you find a real-looking secret, stop and ask before posting.
- **Tables.** Leave Markdown tables as they are; they become HTML cards in Ghost.
- **Embeds.** This is what Ghost does with them, tested on Ghost 6.72:
  - **YouTube:** use the provider's `<iframe>` embed code, on its own line. It becomes a native embed card. A bare YouTube link only shows as a text link.
  - **X:** a pasted X embed (`blockquote.twitter-tweet` plus its script) does **not** survive, because Ghost turns it into a plain quote. Tell her, and either link to the post or ask whether to drop it.
  - **Anything else:** wrap it in `<!--kg-card-begin: html-->` … `<!--kg-card-end: html-->` to keep it as raw HTML, and tell her it only shows if the provider's code runs on the page.
- **Links.** Keep them. If a link is obviously broken (a relative path to a file that only exists locally), tell the user rather than guessing a replacement.
- **Local-only references.** Mentions of files or repos the reader cannot reach are the author's call. Flag them, don't remove them.

## 4. SEO and AEO

Fill all of these in `create_draft`:

| Field | Rule |
|---|---|
| `slug` | Short, lowercase, hyphenated, keyword-led; drop stop words. Aim for under 60 characters. |
| `meta_title` | 60 characters or fewer, with the main keyword near the start. It may differ from the on-page title. |
| `meta_description` | 70–160 characters. Answers "what will I get from this post?" Count the characters; don't estimate. |
| `excerpt` | One or two sentences, 300 characters or fewer, in the author's voice. Shown on cards. |
| `og_title` / `og_description`, `twitter_title` / `twitter_description` | Social versions, which can be a little punchier. They fall back to the meta fields if omitted. |
| `tags` | 3–5 tags. Reuse the blog's existing tag names where possible (check other posts with `get_post`) so archives don't fragment. |
| `canonical_url` | Only if the post was first published somewhere else. |
| `faq` | For answer engines: 3–6 questions readers would actually search for. Each answer must come from what the post says, with nothing invented or outside it. These render as a visible FAQ section plus FAQPage structured data. Tell the user you wrote them so she can check the voice. |

AEO advice (suggest these, don't impose them):
- An opening paragraph of 40–60 words that directly answers the post's core question.
- Question-style H2s where they fit naturally.

## 5. Create, then verify for real

1. Call `create_draft`. It always creates a draft, whatever the user chose.
2. Read the result:
   - `images_uploaded` should equal the number of distinct images.
   - The SEO/AEO findings should contain no `error` items.
   - If anything is wrong, fix it with `update_draft`, passing the `expected_revision` from the latest result.
3. Fetch the `preview_url` and check the rendered page:
   - Every image is present and served from the blog's own `/content/images/` path.
   - No image is missing alt text.
   - The tables and code blocks are there.
   - The FAQ section exists, if one was added.
   - No URLs point at the staging location any more.
   - The feature image is the generated cover, ending in `ah-cover-<hash>.jpg`, unless she supplied her own.
4. Run `seo_check` if you changed anything after creating the post.

## 6. Finish

- **Draft.** Send the preview link and the editor link. Summarise:
  - where each image went
  - every SEO field you set
  - the FAQ you wrote
  - each mechanical fix
  - the remaining findings, and whether they are worth acting on
- **Publish.** Only if the user chose publish and there are no `error` findings, call `publish_post` with `user_approved: true` and the latest `revision`. Then fetch the live URL and confirm it returns 200, shows the images, has the meta description in the page head, and that its `og:image` is the cover. Publishing never emails subscribers; say so in the report.
- If publishing is blocked (error findings, or something needing her decision), leave it as a draft and explain why.
- Clean up any temporary image staging (section 2).

## Don'ts

- Don't publish without the user having chosen to publish in this conversation.
- Don't rewrite the author's prose, headline or intro without asking.
- Don't upload SVGs, invent FAQ facts, or leave images without alt text.
- Don't paste API keys or passphrases into chat. The connector authenticates on its own.
