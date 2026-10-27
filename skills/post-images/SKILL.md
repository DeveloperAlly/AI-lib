---
name: post-images
description: Get every image and diagram into a blog post in the right place - inventory, matching, placement, alt text, captions, format conversion and getting the bytes onto Ghost. Use when a post has attachments, a zip of diagrams, image links, or needs visuals.
---

# Post images

Works alone on any post body, or as a step of `ghost-blog-posting`. The feature image is not handled here; see `post-cover`.

## Standards

- **Sources:** official docs, the official blog, or Ally's own screenshots and diagrams.
- **Coverage:** at least one image per H2 in technical posts, and at least one architecture or flow diagram in any post covering systems or workflows. Zero or one image in a post over 1,000 words means it is not ready.
- **Images** sit at the top of the section they illustrate, before its prose.
- **Diagrams** sit after the concept is introduced and before the code. Every node is labelled, there are no decorative nodes, and the failure path is shown alongside the happy path. For technical architecture, prefer interactive diagrams with clickable nodes.
- **Alt text** describes what the image shows and what it is for, not what it is. A file name is not alt text. Keep the author's alt text when she wrote some.
- **Captions** are optional, written as `![alt](src "caption")`.
- An image stands alone in its own paragraph, which is what makes Ghost create a native image card.

## Inventory and matching

1. List every image supplied (attachments, unzipped archives, URLs) and every image reference in the text (`![alt](path)`, `<img>`). Check each file's real type and pixel size (`file img.png`).
2. Match references to files by filename stem, ignoring folder and extension: `diagrams/01-mental-model.svg` matches `01-mental-model.png`.
3. An unmatched file or reference: look at the image and the surrounding text, and place it by the standards above.
4. If the right place is genuinely unclear, ask. Never drop an image silently, and never leave a reference to a file that will not upload.

## Formats

The Ghost connector accepts JPEG, PNG, GIF and WebP up to 10 MB. It refuses SVG, because SVG can carry script, and base64 SVG data URIs fail silently in Ghost's Markdown card anyway. Convert SVGs to PNG at about 1600px wide:

```bash
pip install cairosvg
python3 -c "import cairosvg; cairosvg.svg2png(url='in.svg', write_to='out.png', output_width=1600)"
```

## Getting the bytes to Ghost

The connector runs on a server and cannot read files in the chat. In order of preference:

1. **A public https URL**, used as-is. The server downloads it and re-hosts it on Ghost.
2. **The GitHub content repo**, if `check_connection` reports a `github_mirror`: commit the images and reference them by repo path.
3. **A temporary public staging location Ally owns**, such as a throwaway branch of a public repo, via `https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>`.
   - Tell her before pushing and say where.
   - Use the repo name exactly as GitHub reports it now; an old name gives 404 on raw URLs.
   - Remove the staging location afterwards, or tell her it is safe to delete, since Ghost keeps its own copies.
4. **Base64**, only for images under about 150 KB, because the bytes travel through the conversation.

When the same image appears twice, use the same source both times; the server uploads it once.

## Done when

- Every supplied image is placed or explicitly set aside with the owner's agreement.
- Every image has real alt text.
- After creation, every image in the preview is served from the blog's own `/content/images/` path, and nothing points at a staging location.
