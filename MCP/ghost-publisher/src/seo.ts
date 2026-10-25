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
  tags?: unknown[] | null;
  codeinjection_head?: string | null;
}

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
  if (!desc) add('warn', 'META_DESCRIPTION_MISSING', 'No meta_description. Ghost will fall back to the excerpt; write one of 70-160 characters that answers the searcher\'s question.');
  else if (desc.length < 70) add('warn', 'META_DESCRIPTION_SHORT', `meta_description is ${desc.length} characters; aim for 70-160.`);
  else if (desc.length > 160) add('warn', 'META_DESCRIPTION_LONG', `meta_description is ${desc.length} characters; it will likely be truncated after about 160.`);

  if (!p.custom_excerpt?.trim()) add('info', 'EXCERPT_MISSING', 'No custom excerpt; Ghost will auto-generate one from the first paragraph.');

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
  const questionHeads = headings.filter((h) => h.level >= 2 && /\?$/.test(h.text)).length;
  const hasFaq = /"@type":"FAQPage"/.test(p.codeinjection_head ?? '');
  if (!hasFaq && !questionHeads && words >= 300)
    add('info', 'AEO_NO_QUESTIONS', 'No question-style headings or FAQ. Adding the questions readers ask (faq field) improves answer-engine extraction.');

  if (!p.tags?.length) add('info', 'TAGS_MISSING', 'No tags; tags drive Ghost tag archives and internal linking.');
  return f;
}

export function summarise(findings: Finding[]): string {
  if (!findings.length) return 'SEO/AEO check: no findings.';
  const order: Severity[] = ['error', 'warn', 'info'];
  return ['SEO/AEO check:', ...order.flatMap((s) => findings.filter((x) => x.severity === s).map((x) => `- [${s}] ${x.message}`))].join('\n');
}
