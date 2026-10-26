// Topic illustrations for blog covers. Each motif is a deterministic SVG
// fragment drawn in the brand palette inside a box on the right of the cover,
// so every post gets its own picture while the set stays one family.

export type MotifName = 'workflow' | 'hub' | 'graph' | 'retrieval' | 'network' | 'surface';
export const MOTIFS: MotifName[] = ['workflow', 'hub', 'graph', 'retrieval', 'network', 'surface'];

/** Keyword -> motif. First match wins, checked against title, topic and tags. */
const KEYWORDS: [RegExp, MotifName][] = [
  [/\b(n8n|workflows?|automation|zapier|make\.com|pipelines?|etl|integrations?)\b/i, 'workflow'],
  [/\b(lang ?graph|agents?|agentic|orchestration|state machines?|multi-agent|durable)\b/i, 'graph'],
  [/\b(mcp|model context protocol|protocols?|servers?|connectors?|apis?|tools?|plugins?)\b/i, 'hub'],
  [/\b(rag|cag|retrieval|search|embeddings?|vectors?|knowledge|cache|caching|memory|context)\b/i, 'retrieval'],
  [/\b(de-?ai|decentrali[sz]ed|networks?|compute|p2p|web3|blockchain|depin|distributed|nodes?)\b/i, 'network'],
  [/\b(models?|llms?|gpt|claude|gemini|frontier|benchmarks?|evals?|reasoning)\b/i, 'surface'],
];

export function pickMotif(text: string, seed: () => number): MotifName {
  for (const [re, m] of KEYWORDS) if (re.test(text)) return m;
  return MOTIFS[Math.floor(seed() * MOTIFS.length) % MOTIFS.length];
}

export interface MotifCtx {
  /** drawing box */
  x: number; y: number; w: number; h: number;
  accent: string;
  /** contrast highlight (pink, or mint on pink kinds) */
  spark: string;
  ink: string;
  /** deterministic 0..1 stream */
  rnd: () => number;
}

const f = (n: number) => n.toFixed(1);
const glowDot = (x: number, y: number, r: number, c: string) =>
  `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r * 3.2)}" fill="${c}" opacity=".16" filter="url(#soft)"/><circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${c}"/>`;

function workflow(c: MotifCtx): string {
  // Three columns of rounded nodes joined by curves; one active node glows.
  const cols = [1, 2 + Math.floor(c.rnd() * 2), 1 + Math.floor(c.rnd() * 2)];
  const nw = 112, nh = 50;
  const nodes: { x: number; y: number; col: number }[] = [];
  cols.forEach((n, ci) => {
    const cx = c.x + 40 + ci * ((c.w - 80 - nw) / 2);
    for (let i = 0; i < n; i++) {
      const cy = c.y + c.h / 2 + (i - (n - 1) / 2) * 112 + (c.rnd() - 0.5) * 30;
      nodes.push({ x: cx, y: cy - nh / 2, col: ci });
    }
  });
  const active = nodes.filter((n) => n.col === 1)[Math.floor(c.rnd() * cols[1])];
  let edges = '';
  for (const a of nodes) for (const b of nodes) {
    if (b.col !== a.col + 1) continue;
    const x1 = a.x + nw, y1 = a.y + nh / 2, x2 = b.x, y2 = b.y + nh / 2, mx = (x1 + x2) / 2;
    const hot = a === active || b === active;
    edges += `<path d="M${f(x1)} ${f(y1)}C${f(mx)} ${f(y1)} ${f(mx)} ${f(y2)} ${f(x2)} ${f(y2)}" fill="none" stroke="${hot ? c.spark : c.accent}" stroke-opacity="${hot ? 0.75 : 0.35}" stroke-width="${hot ? 2 : 1.4}"/>`;
  }
  const boxes = nodes.map((n) => {
    const hot = n === active;
    const halo = hot ? `<rect x="${f(n.x - 10)}" y="${f(n.y - 10)}" width="${nw + 20}" height="${nh + 20}" rx="18" fill="${c.spark}" opacity=".18" filter="url(#soft)"/>` : '';
    const bars = [0, 1].map((i) => `<rect x="${f(n.x + 16)}" y="${f(n.y + 15 + i * 12)}" width="${i ? 44 : 70}" height="5" rx="2.5" fill="${c.ink}" opacity="${hot ? 0.5 : 0.22}"/>`).join('');
    return `${halo}<rect x="${f(n.x)}" y="${f(n.y)}" width="${nw}" height="${nh}" rx="12" fill="#0B1E20" fill-opacity=".85" stroke="${hot ? c.spark : c.accent}" stroke-opacity="${hot ? 0.95 : 0.4}" stroke-width="${hot ? 2 : 1.2}"/>${bars}` +
      `<circle cx="${f(n.x)}" cy="${f(n.y + nh / 2)}" r="4" fill="${hot ? c.spark : c.ink}" opacity=".8"/><circle cx="${f(n.x + nw)}" cy="${f(n.y + nh / 2)}" r="4" fill="${hot ? c.spark : c.ink}" opacity=".8"/>`;
  }).join('');
  return edges + boxes;
}

function hub(c: MotifCtx): string {
  const cx = c.x + c.w * 0.55, cy = c.y + c.h * 0.48;
  const n = 11 + Math.floor(c.rnd() * 4);
  let out = `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(c.h * 0.46)}" fill="none" stroke="${c.accent}" stroke-opacity=".12" stroke-dasharray="3 7"/>`;
  out += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(c.h * 0.24)}" fill="none" stroke="${c.accent}" stroke-opacity=".14"/>`;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + c.rnd() * 0.35;
    const r = c.h * (0.24 + c.rnd() * 0.24);
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    const hot = i % 5 === 2;
    out += `<line x1="${f(cx)}" y1="${f(cy)}" x2="${f(x)}" y2="${f(y)}" stroke="${hot ? c.spark : c.accent}" stroke-opacity="${hot ? 0.6 : 0.3}" stroke-width="1.2"/>`;
    out += hot ? glowDot(x, y, 5, c.spark) : `<circle cx="${f(x)}" cy="${f(y)}" r="4.5" fill="${c.ink}" opacity=".7"/>`;
  }
  return out + glowDot(cx, cy, 13, c.accent);
}

function graph(c: MotifCtx): string {
  // Layered DAG with a dashed loop back (agent cycle) and one square checkpoint.
  const layers = [1, 2, 3, 2, 1];
  const pts: { x: number; y: number; l: number }[] = [];
  layers.forEach((n, li) => {
    const x = c.x + 30 + li * ((c.w - 60) / (layers.length - 1));
    for (let i = 0; i < n; i++) pts.push({ x, y: c.y + c.h / 2 + (i - (n - 1) / 2) * 92 + (c.rnd() - 0.5) * 24, l: li });
  });
  let out = '';
  for (const a of pts) for (const b of pts) {
    if (b.l !== a.l + 1) continue;
    if (c.rnd() < 0.3 && pts.filter((p) => p.l === b.l).length > 1) continue;
    out += `<line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}" stroke="${c.accent}" stroke-opacity=".38" stroke-width="1.4" marker-end="url(#arrow)"/>`;
  }
  const last = pts[pts.length - 1], mid = pts.find((p) => p.l === 1)!;
  out += `<path d="M${f(last.x)} ${f(last.y + 16)}C${f(last.x)} ${f(c.y + c.h + 10)} ${f(mid.x)} ${f(c.y + c.h + 10)} ${f(mid.x)} ${f(mid.y + 18)}" fill="none" stroke="${c.spark}" stroke-opacity=".75" stroke-width="2" stroke-dasharray="6 6" marker-end="url(#arrowSpark)"/>`;
  const ck = pts.find((p) => p.l === 2)!;
  for (const p of pts) {
    if (p === ck) out += `<rect x="${f(p.x - 14)}" y="${f(p.y - 14)}" width="28" height="28" rx="6" fill="#0B1E20" stroke="${c.spark}" stroke-width="2"/><rect x="${f(p.x - 18)}" y="${f(p.y - 18)}" width="36" height="36" rx="8" fill="${c.spark}" opacity=".15" filter="url(#soft)"/>`;
    else out += `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="13" fill="#0B1E20" stroke="${c.accent}" stroke-opacity=".8" stroke-width="1.6"/><circle cx="${f(p.x)}" cy="${f(p.y)}" r="4" fill="${c.accent}"/>`;
  }
  return out;
}

function retrieval(c: MotifCtx): string {
  // A query point radiating to scattered documents (left), a cache grid (right).
  const qx = c.x + 40 + c.rnd() * 30, qy = c.y + 60 + c.rnd() * 40;
  let out = '';
  for (let i = 0; i < 26; i++) {
    const x = c.x + c.rnd() * c.w * 0.5, y = c.y + c.rnd() * c.h;
    const linked = i % 3 === 0;
    if (linked) out += `<line x1="${f(qx)}" y1="${f(qy)}" x2="${f(x)}" y2="${f(y)}" stroke="${c.spark}" stroke-opacity=".32" stroke-width="1"/>`;
    out += `<circle cx="${f(x)}" cy="${f(y)}" r="${linked ? 4 : 2.6}" fill="${linked ? c.spark : c.ink}" opacity="${linked ? 0.8 : 0.35}"/>`;
  }
  out += glowDot(qx, qy, 8, c.spark);
  const gx = c.x + c.w * 0.56, gy = c.y + 30, cell = 34, gap = 8, cols = 6, rows = 7;
  for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
    const x = gx + k * (cell + gap), y = gy + r * (cell + gap);
    const inBlock = r >= 2 && r <= 4 && k >= 1 && k <= 4;
    const filled = inBlock && c.rnd() < 0.5;
    out += `<rect x="${f(x)}" y="${f(y)}" width="${cell}" height="${cell}" rx="3" fill="${filled ? c.accent : 'none'}" fill-opacity="${filled ? 0.35 : 0}" stroke="${c.accent}" stroke-opacity="${inBlock ? 0.75 : 0.14}" stroke-width="1.2"/>`;
  }
  return out;
}

function network(c: MotifCtx): string {
  const pts = Array.from({ length: 24 }, () => ({ x: c.x + c.rnd() * c.w, y: c.y + c.rnd() * c.h }));
  let out = '';
  pts.forEach((p, i) => {
    const near = pts
      .map((q, j) => ({ j, d: Math.hypot(p.x - q.x, p.y - q.y) }))
      .filter((o) => o.j > i)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    for (const o of near) if (o.d < 170) out += `<line x1="${f(p.x)}" y1="${f(p.y)}" x2="${f(pts[o.j].x)}" y2="${f(pts[o.j].y)}" stroke="${c.accent}" stroke-opacity=".3" stroke-width="1.1"/>`;
  });
  pts.forEach((p, i) => {
    out += i % 7 === 0 ? glowDot(p.x, p.y, 6, i % 14 === 0 ? c.spark : c.accent) : `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${f(3 + (i % 3))}" fill="${c.accent}" opacity=".55"/>`;
  });
  return out;
}

function surface(c: MotifCtx): string {
  // Wireframe terrain: the "frontier is a surface" picture.
  const lines = 13, steps = 40;
  const p1 = c.rnd() * 6, p2 = c.rnd() * 6;
  const z = (u: number, v: number) => Math.sin(u * 3.1 + p1) * 0.5 + Math.cos(v * 2.3 + u * 1.7 + p2) * 0.6;
  const proj = (u: number, v: number) => ({ x: c.x + 20 + u * (c.w - 40) + v * 60, y: c.y + c.h * 0.2 + v * c.h * 0.65 - z(u, v) * 46 });
  let out = '';
  for (let i = 0; i < lines; i++) {
    const v = i / (lines - 1);
    const d = Array.from({ length: steps + 1 }, (_, s) => proj(s / steps, v)).map((p, s) => `${s ? 'L' : 'M'}${f(p.x)} ${f(p.y)}`).join('');
    out += `<path d="${d}" fill="none" stroke="${c.accent}" stroke-opacity="${f(0.12 + 0.4 * (1 - Math.abs(v - 0.45)))}" stroke-width="1.3"/>`;
  }
  for (let s = 0; s <= 10; s++) {
    const u = s / 10;
    const d = Array.from({ length: 21 }, (_, i) => proj(u, i / 20)).map((p, i) => `${i ? 'L' : 'M'}${f(p.x)} ${f(p.y)}`).join('');
    out += `<path d="${d}" fill="none" stroke="${c.accent}" stroke-opacity=".12" stroke-width="1"/>`;
  }
  for (let k = 0; k < 4; k++) {
    const p = proj(0.15 + c.rnd() * 0.7, 0.2 + c.rnd() * 0.6);
    out += k === 0 ? glowDot(p.x, p.y, 7, c.spark) : glowDot(p.x, p.y, 4.5, c.ink);
  }
  return out;
}

const DRAW: Record<MotifName, (c: MotifCtx) => string> = { workflow, hub, graph, retrieval, network, surface };

/** SVG <defs> the motifs rely on (blur and arrow heads). */
export function motifDefs(accent: string, spark: string): string {
  return `<filter id="soft" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="6"/></filter>
<marker id="arrow" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 1L9 5L0 9z" fill="${accent}" fill-opacity=".6"/></marker>
<marker id="arrowSpark" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 1L9 5L0 9z" fill="${spark}"/></marker>`;
}

export function drawMotif(name: MotifName, c: MotifCtx): string {
  return `<g>${DRAW[name](c)}</g>`;
}
