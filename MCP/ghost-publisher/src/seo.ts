// Mechanical SEO / AEO checks on a Ghost post. These are heuristics with
// conventional thresholds, not a ranking score. "error" findings block publish
// (unless explicitly accepted); "warn" and "info" are advice.

import { stripTags } from './content.js';

export type Severity = 'error' | 'warn' | 'info';
export interface Finding {
  severity: Severity;
  code: string;
  message: string;
}

export interface AuditablePost {
  title?: string | null;
  slug?: string | null;
  html?: string | null;
  custom_excerpt?: string | null;
  meta_title?: string | null;
  meta_description?: string | null;
  feature_image?: string | null;
  feature_image_alt?: string | null;
  og_image?: string | null;
  og_title?: string | null;
  og_description?: string | null;
  twitter_title?: string | null;
  twitter_description?: string | null;
  tags?: unknown[] | null;
  codeinjection_head?: string | null;
}

/** Site categories (blog pages). The first tag is Ghost's primary tag and must be one of these. */
export function mainTags(): string[] {
  return (process.env.BLOG_MAIN_TAGS ?? 'AI Engineering,Tutorials,OpEds,Project Case Studies')
    .split(',').map((t) => t.trim()).filter(Boolean);
}

const tagName = (t: unknown) => (typeof t === 'string' ? t : (t as { name?: string })?.name ?? '').trim();

// Platform budgets. Google: Ghost's own editor recommends 60 (title) and 145
// (description). X: card title max 70, description max 200 characters
// (developer.x.com/cards/markup). The Facebook/Open Graph card (also read by
// LinkedIn) is held to the X budget so one length works for both.
const LIMITS = { metaTitle: 60, metaDesc: 145, metaDescMin: 70, social: { title: 70, desc: 200 } };

export function auditPost(p: AuditablePost): Finding[] {
  const f: Finding[] = [];
  const add = (severity: Severity, code: string, message: string) => f.push({ severity, code, message });
  const html = p.html ?? '';
  const text = stripTags(html).trim();
  const words = text ? text.split(/\s+/).length : 0;

  // Title and description
  const title = (p.meta_title || p.title || '').trim();
  if (!p.title?.trim()) add('error', 'TITLE_MISSING', 'Post has no title.');
  else if (title.length > 60) add('warn', 'TITLE_LONG', `SEO title is ${title.length} characters; search results usually truncate after about 60. Set meta_title.`);
  else if (title.length < 20) add('info', 'TITLE_SHORT', `SEO title is only ${title.length} characters; a more descriptive title may earn more clicks.`);

  const desc = (p.meta_description || '').trim();
  if (!desc) add('warn', 'META_DESCRIPTION_MISSING', `No meta_description. Google will improvise one; write ${LIMITS.metaDescMin}-${LIMITS.metaDesc} characters that answer the searcher's question.`);
  else if (desc.length < LIMITS.metaDescMin) add('warn', 'META_DESCRIPTION_SHORT', `meta_description is ${desc.length} characters; aim for ${LIMITS.metaDescMin}-${LIMITS.metaDesc}.`);
  else if (desc.length > LIMITS.metaDesc) add('warn', 'META_DESCRIPTION_LONG', `meta_description is ${desc.length} characters; Ghost recommends at most ${LIMITS.metaDesc}.`);

  if (!p.custom_excerpt?.trim()) add('warn', 'EXCERPT_MISSING', 'No excerpt. Cards, RSS and every platform field that is left empty fall back to the first paragraph; write a 1-2 sentence excerpt.');

  // Platform cards: X, and Open Graph (Facebook/LinkedIn)
  const social: [string, string | null | undefined, number][] = [
    ['twitter_title', p.twitter_title, LIMITS.social.title], ['twitter_description', p.twitter_description, LIMITS.social.desc],
    ['og_title', p.og_title, LIMITS.social.title], ['og_description', p.og_description, LIMITS.social.desc],
  ];
  for (const [field, val, max] of social) {
    const v = (val ?? '').trim();
    const platform = field.startsWith('twitter') ? 'X' : 'LinkedIn/Facebook';
    if (!v) add('warn', `${field.toUpperCase()}_MISSING`, `No ${field}; ${platform} will fall back to the generic title/excerpt (or the first lines of the body).`);
    else if (v.length > max) add('warn', `${field.toUpperCase()}_LONG`, `${field} is ${v.length} characters; keep it to ${max} for ${platform}.`);
  }

  // Categorisation: first tag = Ghost primary tag = the blog page the post lives on
  const tags = (p.tags ?? []).map(tagName).filter((t) => t && !t.startsWith('#'));
  const mains = mainTags();
  const isMain = (t: string) => mains.some((m) => m.toLowerCase() === t.toLowerCase());
  if (!tags.length || !isMain(tags[0]))
    add('error', 'PRIMARY_TAG_MISSING', `The first tag must be one main category (${mains.join(', ')}); it decides which blog page the post appears on.${tags.length ? ` First tag is "${tags[0]}".` : ''}`);
  if (tags.filter(isMain).length > 1) add('warn', 'MAIN_TAG_MULTIPLE', 'More than one main category tag; keep exactly one so the post is listed on one page.');
  const secondary = tags.filter((t) => !isMain(t)).length;
  if (tags.length && (secondary < 2 || secondary > 4)) add('info', 'SEARCH_TAGS_COUNT', `${secondary} search tag(s) besides the main category; aim for 2-4.`);

  // Slug
  if (p.slug) {
    if (p.slug.length > 75) add('warn', 'SLUG_LONG', `Slug is ${p.slug.length} characters; shorter, keyword-led slugs are easier to share.`);
    if (/^untitled|-\d+$/.test(p.slug)) add('info', 'SLUG_GENERIC', `Slug "${p.slug}" looks auto-generated; consider a descriptive one.`);
  }

  // Body
  if (!words) add('error', 'BODY_EMPTY', 'Post body is empty.');
  else if (words < 300) add('warn', 'BODY_THIN', `Body is ${words} words; under about 300 words tends to rank and get cited poorly.`);

  const headings = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => ({ level: Number(m[1]), text: stripTags(m[2]).trim() }));
  if (headings.some((h) => h.level === 1)) add('warn', 'BODY_H1', 'Body contains an H1. Ghost renders the title as the H1, so use H2 and below in the body.');
  for (let i = 1; i < headings.length; i++) {
    if (headings[i].level > headings[i - 1].level + 1) {
      add('warn', 'HEADING_SKIP', `Heading level jumps from H${headings[i - 1].level} to H${headings[i].level} at "${headings[i].text.slice(0, 60)}".`);
      break;
    }
  }
  if (words >= 600 && !headings.some((h) => h.level === 2)) add('warn', 'NO_SUBHEADINGS', 'Long post with no H2 sections; subheadings help both readers and answer engines.');

  // Images
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const noAlt = imgs.filter((tag) => !/\balt="[^"]+"/i.test(tag));
  if (noAlt.length) add('error', 'IMAGE_ALT_MISSING', `${noAlt.length} inline image(s) have no alt text. Add descriptive alt text for accessibility and image search.`);
  if (!p.feature_image) add('warn', 'FEATURE_IMAGE_MISSING', 'No feature image; social shares and some answer engines use it as the preview.');
  else if (!p.feature_image_alt?.trim()) add('error', 'FEATURE_IMAGE_ALT_MISSING', 'Feature image has no alt text (feature_image_alt).');

  // Code
  const codeBlocks = [...html.matchAll(/<pre><code([^>]*)>/gi)];
  const noLang = codeBlocks.filter((m) => !/class="[^"]*language-/i.test(m[1]));
  if (noLang.length) add('info', 'CODE_NO_LANGUAGE', `${noLang.length} code block(s) have no language; add one after the opening fence for highlighting.`);

  // Links
  const links = [...html.matchAll(/<a\b[^>]*href="([^"]+)"/gi)].map((m) => m[1]);
  if (words >= 300 && !links.length) add('info', 'NO_LINKS', 'No links. Citing sources and linking related posts helps credibility and discovery.');

  // AEO: answer-first and question-shaped structure
  const firstPara = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(html);
  const firstWords = firstPara ? stripTags(firstPara[1]).trim().split(/\s+/).filter(Boolean).length : 0;
  if (firstPara && firstWords > 60) add('info', 'AEO_LEAD_LONG', `Opening paragraph is ${firstWords} words. Answer engines favour a direct 40-60 word answer up front.`);
  const hasFaq = /"@type":"FAQPage"/.test(p.codeinjection_head ?? '');
  if (!hasFaq && words >= 300)
    add('info', 'AEO_NO_FAQ', 'No FAQ. The questions readers ask belong in the faq field (visible FAQ plus FAQPage data), not in the H2s.');
  const questionH2 = headings.filter((h) => h.level === 2 && /\?$/.test(h.text)).length;
  if (questionH2) add('warn', 'H2_QUESTION', `${questionH2} H2 heading(s) are questions; H2s name the section's concept (questions go in the FAQ or an H3).`);
  return f;
}

export function summarise(findings: Finding[]): string {
  if (!findings.length) return 'SEO/AEO check: no findings.';
  const order: Severity[] = ['error', 'warn', 'info'];
  return ['SEO/AEO check:', ...order.flatMap((s) => findings.filter((x) => x.severity === s).map((x) => `- [${s}] ${x.message}`))].join('\n');
}
