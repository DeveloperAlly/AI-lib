---
name: post-settings
description: Fill a Ghost blog post's settings for discovery - the main category tag and search tags, slug, excerpt, Google meta title and description, X card, LinkedIn/Facebook card, and FAQ for answer engines. Use when creating or updating a post on blog.alisonhaire.com, or when auditing existing posts' metadata.
---

# Post settings

Everything in Ghost's post settings panel that decides where a post is listed and how it reads in search, answer engines and social previews. Works alone (pass the fields to `create_draft` or `update_draft`), or as a step of `ghost-blog-posting`. Run it after `naming`, because these fields build on the final title.

Count characters with code (`python3 -c "print(len('...'))"`); never estimate.

## Tags

**Main category: exactly one, and always the first tag.** Ghost treats the first tag as the primary tag, and the blog lists the post on that category's page.

| Main tag | Use when, after reading, the reader can... |
|---|---|
| AI Engineering | understand or decide how to build, run or evaluate an AI system (agents, MCP, RAG, models, infrastructure) |
| Tutorials | follow along and build something themselves, with working code |
| OpEds | weigh an argument or position (strategy, industry direction, decentralised AI) |
| Project Case Studies | see what Ally built and shipped: the problem, the build, the results |

Pick by the post's purpose (the `blog-harness` Gate 0 PURPOSE line), not its topic: a LangGraph walkthrough the reader follows is Tutorials, while a LangGraph design trade-off piece is AI Engineering. If two fit, ask Ally.

**Search tags: 2-4 after the main tag.** These are the terms a reader would search, such as product, protocol or technique names (`LangGraph`, `MCP`, `n8n`). Reuse the blog's existing tag names (check other posts with `get_post`) so archives do not fragment. Internal tags start with `#` and are not public.

The server's `seo_check` raises an error, which blocks publishing, when the first tag is not a main category. The list is set by `BLOG_MAIN_TAGS` on the server.

## Fields

Each field has a different reader and job. Do not paste one sentence into all of them; an empty field falls back to the excerpt, or failing that to the first lines of the body.

| Field | Reader | Rule |
|---|---|---|
| `slug` | Everyone | Short, lowercase, hyphenated, keyword-led, stop words dropped; under 60 characters. Never change the slug of a published post. |
| `excerpt` | Blog cards, RSS, answer engines | 1-2 sentences, at most 300 characters, in Ally's voice. Answer first: what the post shows or argues, and for whom. It is the fallback for every empty field below. |
| `meta_title` | Google | At most 60 characters, main keyword first. May differ from the post title. Leave empty only if the post title already fits and leads with the keyword. |
| `meta_description` | Google | 70-145 characters (Ghost's recommendation is 145). Answers the searcher's question and contains the keyword. No clickbait gap. |
| `twitter_title` | X | At most 70 characters (X card limit). The `ally-voice` X tone: a peer in the room. |
| `twitter_description` | X | At most 200 characters (X card limit). The concrete hook: a number, a result, or what broke. |
| `og_title` | LinkedIn, Facebook | At most 70 characters. The `ally-voice` LinkedIn tone: the professional outcome. |
| `og_description` | LinkedIn, Facebook | At most 200 characters. Who should read it and what they will be able to do. |
| `twitter_image`, `og_image` | X, LinkedIn | Leave empty. Ghost then uses the feature image, which is the branded cover. |
| `canonical_url` | Search engines | Only when the post was first published somewhere else. |

The 60 and 145 limits come from Ghost's editor. The 70 and 200 limits are X's card limits (developer.x.com/cards/markup). LinkedIn and Facebook are held to the same 70 and 200 so one budget works for both.

## FAQ (answer engines)

Pass `faq` with 3-6 questions readers would actually search. Each answer must come only from what the post says, with nothing invented. The server renders them as a visible FAQ section plus FAQPage structured data. This is where question-shaped text belongs; H2s are concept names (`naming`). Tell Ally you wrote them so she can check the voice. To change the FAQ later, pass the full body too, so the visible section and the data stay in sync.

Optionally, open the body with a 40-60 word paragraph that directly answers the post's core question. Suggest it; do not impose it.

## Done when

`seo_check` shows:
- no `PRIMARY_TAG_MISSING` error;
- no `*_MISSING` or `*_LONG` warnings for the excerpt, meta, twitter or og fields;
- `SEARCH_TAGS_COUNT` absent.

On a live post, the page head carries the meta description, and its `og:` and `twitter:` tags carry the new text.

Editing a published post's settings changes the live page, so `update_draft` needs `user_approved: true` after Ally approves that specific change.
