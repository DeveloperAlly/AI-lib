---
name: post-cover
description: Make the branded cover (feature image) for a Ghost blog post with the Ghost Blogs connector - choose the eyebrow kind, topic, cover title, subtitle and illustration, preview, and apply. Use after the post's title is final.
---

# Post cover

Every post on blog.alisonhaire.com gets the same family of covers: the Alison Haire design system, a topic illustration, and the LinkedIn and X handles. The Ghost Blogs server draws them; nothing is generated in chat.

Works alone (for an existing post or a title that does not exist yet), or as a step of `ghost-blog-posting`. Run it after `naming`, because the cover shows the final title.

## Settings

| Setting | Rule |
|---|---|
| `kind` | The eyebrow label and colour. One of: Essay (pink), Playbook or Tutorial (green), Field guide or Analysis (teal), Field notes, Post or Op-ed (mint), Research (light mint), Interview (pink). This is the post's form, and is separate from the site category tag (ruling, 27 Oct 2026). |
| `topic` | The eyebrow's second part, 1-4 words naming the subject (`Model Context Protocol`). |
| `title` | Only if the post title is too long for two lines (about 40 characters). Use the `naming` cover profile. |
| `subtitle` | One line of about 60 characters at most, taken from the post's own words. Use the `naming` cover profile. |
| `motif` | Optional. Chosen from the topic when omitted: `workflow` (automation, n8n), `hub` (MCP, APIs, servers), `graph` (agents, LangGraph), `retrieval` (RAG, search, memory), `network` (decentralised, compute), `surface` (models, benchmarks). Set it explicitly when two neighbouring posts would otherwise look alike. |

`title` and `subtitle` are cover-only; they do not change the post.

Use a different feature image only when Ally supplies one or asks for it. Diagrams from the post stay inline; don't promote one to feature image unless she asks.

## Steps

1. **Preview.** Call `preview_cover` with the post `id` (or a `title` and `tags` for a post not yet created) plus the settings. Show Ally the image. Nothing changes.
2. **Apply.**
   - New post: leave `feature_image` out of `create_draft` and pass the same settings as `cover: {...}`.
   - Existing post: call `apply_cover` with `id`, `expected_revision` and the settings.
     - A published post also needs `user_approved: true`, after she approves that specific change.
     - Replacing an image she chose needs `replace_custom: true`, and only when she asked.
   - `off: true` stops generated covers for a post.
3. **Check.** `get_post` shows `feature_image` ending in `ah-cover-<hash>.jpg` and alt text naming the post. For a live post, the page's `og:image` and `twitter:image` point at the same file.

## Automatic behaviour

- A post created in Ghost without a feature image gets a cover about 2 minutes after its last edit.
- Changing the title, tags or excerpt in Ghost regenerates a generated cover, keeping the saved settings.
- Generated covers are recognised by the `ah-cover-` file name. An image Ally chose is never replaced automatically.
- If she is still in the Ghost editor when the cover updates, her next save may report a conflict; reloading fixes it.

If `preview_cover` or `apply_cover` is missing from the tool list, the chat holds an old copy of the connector's tools: say so and suggest a new chat. Never fake a cover with another image.
