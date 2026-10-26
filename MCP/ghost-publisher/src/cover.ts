// Branded blog covers, rendered from the Alison Haire design system
// (colors_and_type.css + the website's PostThumbnail fallback poster):
// dark teal-charcoal base, a type-coloured diagonal wash, concentric "portal"
// rings bleeding off the right, a tracked uppercase eyebrow, a Plus Jakarta
// Sans title that auto-fits, an italic subtitle, and a footer with the AH mark,
// blog URL, LinkedIn and X handles. Deterministic: same input, same pixels.

import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';

export const COVER_WIDTH = 1200;
export const COVER_HEIGHT = 675;

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts');
const FONT = {
  extrabold: join(FONT_DIR, 'PlusJakartaSans-ExtraBold.ttf'),
  bold: join(FONT_DIR, 'PlusJakartaSans-Bold.ttf'),
  italic: join(FONT_DIR, 'PlusJakartaSans-MediumItalic.ttf'),
};
const FAMILY = 'Plus Jakarta Sans';

/** Design-system tokens (colors_and_type.css). */
const T = {
  void: '#050D0E',
  abyss: '#081618',
  mint: '#5CF0D3',
  mintBright: '#B3FEEF',
  pink: '#FF5079',
  ink0: '#ECFBF6',
  ink1: '#B6D0CC',
  ink2: '#7C9794',
};

/** Same table as the website's PostThumbnail: kind -> [wash start, wash end, accent]. */
const PALETTE: Record<string, readonly [string, string, string]> = {
  'op-ed': ['#1A2E5E', '#0B1E20', '#5BEFD0'],
  essay: ['#3D1F4E', '#0B1E20', '#FF85A3'],
  analysis: ['#0B2638', '#0B1E20', '#14C7C3'],
  tutorial: ['#0B3326', '#0B1E20', '#57D092'],
  interview: ['#4E1F2E', '#0B1E20', '#FF5079'],
  research: ['#1E2A56', '#0B1E20', '#93F7E4'],
  post: ['#112A2D', '#050D0E', '#5BEFD0'],
};
/** Blog eyebrow names mapped onto the website's kinds. */
const KIND_ALIASES: Record<string, string> = {
  playbook: 'tutorial',
  guide: 'tutorial',
  'how-to': 'tutorial',
  'field guide': 'analysis',
  'deep dive': 'analysis',
  'field notes': 'post',
  notes: 'post',
  opinion: 'op-ed',
};
export const COVER_KINDS = [...Object.keys(PALETTE), ...Object.keys(KIND_ALIASES)];

export const SOCIAL = {
  name: 'Alison Haire',
  site: 'blog.alisonhaire.com',
  linkedin: 'in/ally-haire',
  x: '@DeveloperAlly',
};

export interface CoverSpec {
  title: string;
  subtitle?: string;
  /** Eyebrow first word and colour, e.g. "Essay", "Playbook", "Field guide". */
  kind?: string;
  /** Eyebrow second part, e.g. "Model Context Protocol". */
  topic?: string;
  /** Varies the ring placement; defaults to the title. */
  seed?: string;
}

export function paletteFor(kind: string | undefined) {
  const k = (kind ?? 'post').trim().toLowerCase();
  return PALETTE[KIND_ALIASES[k] ?? k] ?? PALETTE.post;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

interface TextBox { input: Buffer; width: number; height: number }

/** Render Pango markup to a transparent PNG (sharp/libvips text). */
async function text(markup: string, fontfile: string, opts: { width?: number; align?: 'left' | 'right' } = {}): Promise<TextBox> {
  const { data, info } = await sharp({
    text: { text: markup, font: FAMILY, fontfile, rgba: true, dpi: 72, width: opts.width, align: opts.align ?? 'left', wrap: 'word' },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { input: data, width: info.width, height: info.height };
}

const span = (s: string, a: { size: number; color: string; weight?: number; track?: number; style?: string; lh?: number }) =>
  `<span font_size="${a.size}pt" foreground="${a.color}"${a.weight ? ` font_weight="${a.weight}"` : ''}` +
  `${a.style ? ` font_style="${a.style}"` : ''}` +
  // letter_spacing is in 1/1024 pt; at 72 dpi 1 pt = 1 px
  `${a.track ? ` letter_spacing="${Math.round(a.track * 1024)}"` : ''}` +
  `${a.lh ? ` line_height="${a.lh}"` : ''}>${esc(s)}</span>`;

const X0 = 72; // left margin, matches the old covers
const MAX_TITLE_W = 860;

/** Largest title size (3 lines max) that fits, then "balance" the lines by narrowing. */
async function fitTitle(title: string, maxHeight: number): Promise<TextBox> {
  for (let size = 96; size >= 44; size -= 4) {
    const m = span(title, { size, color: T.ink0, weight: 800, track: -0.02 * size, lh: 1.04 });
    const full = await text(m, FONT.extrabold, { width: MAX_TITLE_W });
    const lines = Math.round(full.height / (size * 1.04 * 1.18)) || 1; // rough: pango logical line ~1.2em
    if (full.height > maxHeight || lines > 3) continue;
    // text-wrap: balance — narrow the box while the height (line count) stays the same
    let best = full;
    for (let w = MAX_TITLE_W - 40; w >= 360; w -= 40) {
      const t = await text(m, FONT.extrabold, { width: w });
      if (t.height !== full.height) break;
      best = t;
    }
    return best;
  }
  // Very long title: smallest size, clipped by maxHeight check below.
  return text(span(title, { size: 44, color: T.ink0, weight: 800, track: -0.88, lh: 1.04 }), FONT.extrabold, { width: MAX_TITLE_W });
}

function seeded(seed: string) {
  const h = createHash('sha256').update(seed).digest();
  return (i: number) => h[i % h.length] / 255;
}

function backgroundSvg(spec: CoverSpec, accent: string, wash: readonly [string, string, string]): string {
  const r = seeded(spec.seed ?? spec.title);
  const cx = 860 + r(0) * 180; // rings bleed off the right edge
  const cy = 170 + r(1) * 170;
  const base = 70 + r(2) * 30;
  const second = /^#FF/i.test(accent) ? T.mint : T.pink; // the "spark": pink, or mint on pink kinds
  const rings = [1, 2, 3, 4, 5, 6]
    .map((i) => `<circle cx="${cx}" cy="${cy}" r="${base * i}" fill="none" stroke="${accent}" stroke-opacity="${(0.34 / i).toFixed(3)}" stroke-width="1.4"/>`)
    .join('');
  const dashR = base * 2.5;
  const dashRot = Math.round(-40 + r(3) * 80);
  const sparkA = ((-90 + dashRot) * Math.PI) / 180;
  const cross = (x: number, y: number) =>
    `<path d="M${x - 12} ${y}H${x + 12}M${x} ${y - 12}V${y + 12}" stroke="${accent}" stroke-opacity=".45" stroke-width="1"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${COVER_WIDTH}" height="${COVER_HEIGHT}">
<defs>
  <linearGradient id="wash" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${wash[0]}"/><stop offset=".55" stop-color="${wash[1]}"/><stop offset="1" stop-color="${T.void}"/>
  </linearGradient>
  <radialGradient id="lift" cx=".5" cy="-.1" r="1.1">
    <stop offset="0" stop-color="#0E2629" stop-opacity=".55"/><stop offset=".5" stop-color="${T.abyss}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="portal" cx="${cx}" cy="${cy}" r="${base * 3.4}" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="${accent}" stop-opacity=".30"/><stop offset=".42" stop-color="${second}" stop-opacity=".08"/><stop offset="1" stop-color="${T.abyss}" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="scrim" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="${T.void}" stop-opacity=".55"/><stop offset=".6" stop-color="${T.void}" stop-opacity="0"/>
  </linearGradient>
</defs>
<rect width="100%" height="100%" fill="${T.abyss}"/>
<rect width="100%" height="100%" fill="url(#wash)"/>
<rect width="100%" height="100%" fill="url(#lift)"/>
<circle cx="${cx}" cy="${cy}" r="${base * 3.4}" fill="url(#portal)"/>
${rings}
<circle cx="${cx}" cy="${cy}" r="${dashR}" fill="none" stroke="${second}" stroke-opacity=".5" stroke-width="2" stroke-dasharray="${Math.round(dashR * 4.6)} ${Math.round(dashR * 1.68)}" stroke-linecap="round" transform="rotate(${dashRot} ${cx} ${cy})"/>
<circle cx="${(cx + dashR * Math.cos(sparkA)).toFixed(1)}" cy="${(cy + dashR * Math.sin(sparkA)).toFixed(1)}" r="5" fill="${second}"/>
<circle cx="${cx}" cy="${cy}" r="9" fill="${accent}" fill-opacity=".9"/>
<rect width="100%" height="100%" fill="url(#scrim)"/>
${cross(COVER_WIDTH - X0, 72)}${cross(COVER_WIDTH - X0, 590)}
<line x1="${X0}" y1="590" x2="${COVER_WIDTH - X0 - 24}" y2="590" stroke="#93F7E4" stroke-opacity=".14"/>
</svg>`;
}

/** The AH monogram (design system assets/logo-monogram.svg), at a given size. */
function monogramSvg(size: number): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 120 120">
<circle cx="60" cy="60" r="53" fill="none" stroke="#FF5079" stroke-width="3" opacity="0.3"/>
<circle cx="60" cy="60" r="44" fill="none" stroke="#FF5079" stroke-width="3.4" opacity="0.65" stroke-dasharray="205 35" stroke-linecap="round" transform="rotate(-26 60 60)"/>
<g fill="none" stroke="#5BEFD0" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">
<path d="M35 89 L60 30"/><path d="M60 30 L60 89"/><path d="M84 31 L84 89"/><path d="M47 60 L84 60"/></g>
<circle cx="92" cy="23" r="5" fill="#5BEFD0"/></svg>`);
}

/** Small LinkedIn and X glyphs for the footer, in the muted ink colour. */
function socialIcon(kind: 'linkedin' | 'x', size: number, color: string): Buffer {
  const body =
    kind === 'linkedin'
      ? `<rect x="1" y="1" width="22" height="22" rx="4" fill="none" stroke="${color}" stroke-width="1.8"/>
         <path d="M7 10v7M7 7v.01M11 17v-7M11 13a3 3 0 0 1 6 0v4" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`
      : `<path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.4l-5.8-7.58-6.64 7.58H.47l8.6-9.83L0 1.15h7.6l5.24 6.93zm-1.3 19.5h2.04L6.49 3.24H4.3z" fill="${color}"/>`;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">${body}</svg>`);
}

/** Render a 1200x675 JPEG cover. */
export async function renderCover(spec: CoverSpec): Promise<Buffer> {
  const title = spec.title.trim();
  if (!title) throw new Error('Cover needs a title');
  const [w0, w1, accent] = paletteFor(spec.kind);
  const layers: OverlayOptions[] = [];

  // Eyebrow: KIND · TOPIC, tracked uppercase, accent colour, short underline.
  const eyebrow = [spec.kind ?? 'Post', spec.topic].filter(Boolean).join('  ·  ').toUpperCase();
  const eb = await text(span(eyebrow, { size: 15, color: accent, weight: 700, track: 15 * 0.22 }), FONT.bold, { width: 900 });
  layers.push({ input: eb.input, left: X0, top: 60 });
  layers.push({
    input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="2"><rect width="48" height="2" fill="${accent}"/></svg>`),
    left: X0,
    top: 60 + eb.height + 10,
  });

  // Footer row (y ~ 606-630).
  const footY = 610;
  layers.push({ input: monogramSvg(34), left: X0 - 4, top: footY - 6 });
  const left = await text(
    span(SOCIAL.name.toUpperCase(), { size: 13, color: T.ink0, weight: 700, track: 13 * 0.22 }) +
      span('   ·   ', { size: 13, color: T.ink2 }) +
      span(SOCIAL.site, { size: 13, color: T.ink1, weight: 700, track: 0.4 }),
    FONT.bold,
  );
  layers.push({ input: left.input, left: X0 + 42, top: footY + 11 - Math.round(left.height / 2) });

  const handle = async (s: string) => text(span(s, { size: 14, color: T.ink1, weight: 700, track: 0.3 }), FONT.bold);
  const xT = await handle(SOCIAL.x);
  const liT = await handle(SOCIAL.linkedin);
  let right = COVER_WIDTH - X0;
  right -= xT.width;
  layers.push({ input: xT.input, left: right, top: footY + 11 - Math.round(xT.height / 2) });
  right -= 26;
  layers.push({ input: socialIcon('x', 17, T.ink1), left: right, top: footY + 3 });
  right -= 34 + liT.width;
  layers.push({ input: liT.input, left: right, top: footY + 11 - Math.round(liT.height / 2) });
  right -= 26;
  layers.push({ input: socialIcon('linkedin', 18, T.ink1), left: right, top: footY + 2 });

  // Title + subtitle, bottom-anchored above the footer rule.
  let bottom = 566;
  if (spec.subtitle?.trim()) {
    let sub = await text(span(spec.subtitle.trim(), { size: 28, color: T.ink1, style: 'italic' }), FONT.italic, { width: 980 });
    if (sub.height > 48) sub = await text(span(spec.subtitle.trim(), { size: 22, color: T.ink1, style: 'italic' }), FONT.italic, { width: 980 });
    layers.push({ input: sub.input, left: X0, top: bottom - sub.height });
    bottom -= sub.height + 26;
  }
  const maxTitleH = bottom - 130;
  const t = await fitTitle(title, maxTitleH);
  if (t.height > maxTitleH) throw new Error('Title is too long to fit on a cover; pass a shorter cover title');
  layers.push({ input: t.input, left: X0 - 4, top: bottom - t.height });

  return sharp(Buffer.from(backgroundSvg(spec, accent, [w0, w1, accent])))
    .composite(layers)
    .jpeg({ quality: 90, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toBuffer();
}

// ---------- deriving a spec from a post ----------

const KIND_SET = new Set(COVER_KINDS);

/**
 * Best-effort cover spec from post fields: a tag naming a kind (Essay, Playbook,
 * Field guide, ...) sets the eyebrow kind; the first other tag is the topic.
 * "Title. Rest" or "Title: Rest" splits into title + subtitle like the
 * existing covers; otherwise a short custom excerpt becomes the subtitle.
 */
export function coverSpecFromPost(p: { title: string; tags?: string[]; excerpt?: string | null; slug?: string }, override: Partial<CoverSpec> = {}): CoverSpec {
  const tags = (p.tags ?? []).filter((t) => !t.startsWith('#'));
  const kindTag = tags.find((t) => KIND_SET.has(t.trim().toLowerCase()));
  const topic = tags.find((t) => t !== kindTag);
  let title = p.title.trim();
  let subtitle: string | undefined;
  const split = title.match(/^(.{6,60}?)(?:[.:?!]|\s[—-])\s+(.{8,})$/);
  if (split) {
    title = split[1] + (title[split[1].length] === '?' ? '?' : '');
    subtitle = split[2].replace(/\s+/g, ' ');
    // "Here's What That Actually Means for Your Workflows." -> sentence case is the author's call; keep as written
  } else if (p.excerpt) {
    const first = p.excerpt.trim().split(/(?<=[.!?])\s/)[0];
    if (first.length <= 80) subtitle = first;
  }
  return {
    title,
    subtitle,
    kind: kindTag ?? 'Field notes',
    topic,
    seed: p.slug ?? p.title,
    ...Object.fromEntries(Object.entries(override).filter(([, v]) => v !== undefined)),
  };
}
