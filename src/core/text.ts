// Text rendering helpers shared by the slide renderer and the in-place text editor, so that what you
// see while typing is exactly what the slide shows afterwards.
import { css, type ThemeCtx } from './color';
import { BASE_FONT_FALLBACK, type Bullet, type LstLevel, type Para, type Run, type RunProps, type Spacing, type TextBody } from './model';

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 1.2 is the line height PowerPoint uses for "single" spacing with most fonts. */
export const LINE_FACTOR = 1.2;

export function fontStack(name: string | undefined, ctx: ThemeCtx): string {
  if (!name) return '';
  let n = name;
  if (n === '+mj' || n === '+mj-lt') n = ctx.theme.fonts.major;
  else if (n === '+mn' || n === '+mn-lt') n = ctx.theme.fonts.minor;
  else if (n.startsWith('+')) n = ctx.theme.fonts.minor;
  return `'${n.replace(/'/g, '')}', ${BASE_FONT_FALLBACK}`;
}

export function resolveFontName(name: string | undefined, ctx: ThemeCtx): string {
  if (!name) return ctx.theme.fonts.minor;
  if (name === '+mj' || name === '+mj-lt') return ctx.theme.fonts.major;
  if (name.startsWith('+')) return ctx.theme.fonts.minor;
  return name;
}

// ---------------------------------------------------------------------------
// Bullets
// ---------------------------------------------------------------------------
function roman(n: number, upper: boolean): string {
  const map: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return upper ? out.toUpperCase() : out;
}
function alpha(n: number, upper: boolean): string {
  let out = '';
  let k = n;
  while (k > 0) {
    k--;
    out = String.fromCharCode(97 + (k % 26)) + out;
    k = Math.floor(k / 26);
  }
  return upper ? out.toUpperCase() : out;
}

export function numberLabel(scheme: string, n: number): string {
  const lower = /Lc/.test(scheme);
  const wrap = (core: string) => (/ParenBoth/.test(scheme) ? `(${core})` : /ParenR/.test(scheme) ? `${core})` : /Period/.test(scheme) ? `${core}.` : /Plain/.test(scheme) ? core : `${core}.`);
  if (/^roman/.test(scheme)) return wrap(roman(n, !lower));
  if (/^alpha/.test(scheme)) return wrap(alpha(n, !lower));
  return wrap(String(n));
}

export const NUMBER_SCHEMES: { id: string; sample: string }[] = [
  { id: 'arabicPeriod', sample: '1. 2. 3.' },
  { id: 'arabicParenR', sample: '1) 2) 3)' },
  { id: 'romanUcPeriod', sample: 'I. II. III.' },
  { id: 'alphaUcPeriod', sample: 'A. B. C.' },
  { id: 'alphaLcParenR', sample: 'a) b) c)' },
  { id: 'alphaLcPeriod', sample: 'a. b. c.' },
  { id: 'romanLcPeriod', sample: 'i. ii. iii.' },
];

export const BULLET_CHARS = ['•', '○', '▪', '■', '❖', '➢', '✓', '–'];

export function effBullet(p: Para, lst: LstLevel[] | undefined): Bullet | undefined {
  return p.bu ?? lst?.[p.level ?? 0]?.bu;
}

/** The label drawn before each paragraph (null = no bullet). Numbers restart like PowerPoint's. */
export function bulletLabels(paras: Para[], lst: LstLevel[] | undefined): (string | null)[] {
  const counters: number[] = [];
  const kinds: (string | undefined)[] = [];
  return paras.map((p) => {
    const lvl = p.level ?? 0;
    const bu = effBullet(p, lst);
    for (let i = lvl + 1; i < counters.length; i++) {
      counters[i] = 0;
      kinds[i] = undefined;
    }
    if (!bu || bu.t === 'none') {
      counters[lvl] = 0;
      kinds[lvl] = undefined;
      return null;
    }
    if (bu.t === 'char') {
      counters[lvl] = 0;
      kinds[lvl] = undefined;
      return bu.ch;
    }
    const key = bu.scheme;
    if (kinds[lvl] !== key || !counters[lvl]) counters[lvl] = (bu.start ?? 1) - 1;
    kinds[lvl] = key;
    counters[lvl]++;
    return numberLabel(bu.scheme, counters[lvl]);
  });
}

// ---------------------------------------------------------------------------
// Effective properties
// ---------------------------------------------------------------------------
export function effRun(tb: TextBody | undefined, p: Para, r: RunProps | undefined): RunProps {
  const lv = tb?.lst?.[p.level ?? 0] ?? {};
  const out: RunProps = { sz: lv.sz, b: lv.b, i: lv.i, u: lv.u, strike: lv.strike, color: lv.color, font: lv.font, hl: lv.hl, base: lv.base, cap: lv.cap, spc: lv.spc };
  if (r) for (const [k, v] of Object.entries(r)) if (v !== undefined && k !== 't' && k !== 'br' && k !== 'field') (out as any)[k] = v;
  return out;
}

const spacingPx = (s: Spacing | undefined, size: number): number | undefined => (s ? ('pts' in s ? s.pts : s.pct * size * LINE_FACTOR) : undefined);

export function firstSize(p: Para, tb: TextBody | undefined): number {
  const first = p.runs.find((r) => !r.br && r.t !== '');
  return first?.sz ?? p.end?.sz ?? tb?.lst?.[p.level ?? 0]?.sz ?? 18;
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------
export interface TextRenderOpts {
  scale?: number;
  lnReduction?: number;
  slideNumber?: number;
  slideCount?: number;
  date?: string;
  /** for the in-editor "click to add text" prompt */
  editing?: boolean;
  /** font sizes follow the --fs CSS variable (live text editor) */
  scaleVar?: boolean;
}

const px = (n: number) => `${Math.round(n * 100) / 100}px`;

/** Font size as CSS. With useVar the size follows the container's --fs variable (used while editing). */
const sizePx = (n: number, scale: number, useVar: boolean) => (useVar ? `calc(var(--fs,1) * ${Math.round(n * 100) / 100}px)` : px(n * scale));

export function runStyle(r: RunProps, ctx: ThemeCtx, scale = 1, useVar = false): string {
  const s: string[] = [];
  if (r.font) s.push(`font-family:${fontStack(r.font, ctx).replace(/"/g, "'")}`);
  if (r.sz) s.push(`font-size:${sizePx(r.sz, scale, useVar)}`);
  if (r.b !== undefined) s.push(`font-weight:${r.b ? 700 : 400}`);
  if (r.i !== undefined) s.push(`font-style:${r.i ? 'italic' : 'normal'}`);
  const deco: string[] = [];
  if (r.u) deco.push('underline');
  if (r.strike) deco.push('line-through');
  if (deco.length) s.push(`text-decoration:${deco.join(' ')}${r.u === 'dbl' ? ';text-decoration-style:double' : r.u === 'wavy' ? ';text-decoration-style:wavy' : r.u === 'dotted' ? ';text-decoration-style:dotted' : r.u === 'dash' ? ';text-decoration-style:dashed' : ''}`);
  else if (r.u === false || r.strike === false) s.push('text-decoration:none');
  if (r.color) s.push(`color:${css(r.color, ctx)}`);
  if (r.hl) s.push(`background-color:${css(r.hl, ctx)}`);
  if (r.base) s.push(`vertical-align:${r.base > 0 ? 'super' : 'sub'};font-size:${sizePx((r.sz ?? 18) * 0.65, scale, useVar)}`);
  if (r.cap === 'all') s.push('text-transform:uppercase');
  else if (r.cap === 'small') s.push('font-variant:small-caps');
  if (r.spc) s.push(`letter-spacing:${px(r.spc)}`);
  return s.join(';');
}

export function paraStyle(p: Para, tb: TextBody, ctx: ThemeCtx, opts: TextRenderOpts, first: boolean, bulletOn: boolean): string {
  const scale = opts.scale ?? 1;
  const lv: LstLevel = tb.lst?.[p.level ?? 0] ?? {};
  const base = effRun(tb, p, undefined);
  const size = firstSize(p, tb);
  const s: string[] = [];
  const algn = p.algn ?? lv.algn ?? 'l';
  s.push(`text-align:${algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' ? 'justify' : 'left'}`);
  const marL = p.marL ?? lv.marL ?? 0;
  const indent = p.indent ?? lv.indent ?? 0;
  s.push(`padding-left:${px(marL)}`);
  s.push(`text-indent:${px(indent)}`);
  const ln = p.lnSpc ?? lv.lnSpc;
  if (ln) {
    if ('pct' in ln) s.push(`line-height:${Math.max(0.1, (ln.pct - (opts.lnReduction ?? 0)) * LINE_FACTOR).toFixed(3)}`);
    else s.push(`line-height:${px(ln.pts)}`);
  } else s.push(`line-height:${(Math.max(0.1, 1 - (opts.lnReduction ?? 0)) * LINE_FACTOR).toFixed(3)}`);
  const bef = spacingPx(p.spcBef ?? lv.spcBef, size * scale);
  const aft = spacingPx(p.spcAft ?? lv.spcAft, size * scale);
  if (bef && !first) s.push(`padding-top:${px(bef * (opts.lnReduction ? 1 - opts.lnReduction : 1))}`);
  if (aft) s.push(`padding-bottom:${px(aft * (opts.lnReduction ? 1 - opts.lnReduction : 1))}`);
  if (p.rtl ?? lv.rtl) s.push('direction:rtl');
  // base run look inherited by empty paragraphs, bullets and any run without its own override
  s.push(runStyle({ ...base, sz: size }, ctx, scale, !!opts.scaleVar));
  if (bulletOn) {
    const bu = effBullet(p, tb.lst);
    if (bu && bu.t !== 'none') {
      if (bu.t === 'char' && bu.font) s.push(`--bu-font:${fontStack(bu.font, ctx).replace(/"/g, "'")}`);
      if (bu.color) s.push(`--bu-color:${css(bu.color, ctx)}`);
      if (bu.pct && bu.pct !== 1) s.push(`--bu-size:${bu.pct}em`);
      s.push(`--bu-w:${px(Math.max(0, -indent))}`);
    }
  }
  return s.join(';');
}

function runHtml(r: Run, tb: TextBody, p: Para, ctx: ThemeCtx, opts: TextRenderOpts): string {
  const scale = opts.scale ?? 1;
  if (r.br) return '<br>';
  const own: RunProps = { ...r };
  delete (own as any).t;
  delete (own as any).br;
  delete (own as any).field;
  const style = runStyle(own, ctx, scale, !!opts.scaleVar);
  let text = r.t;
  if (r.field === 'slidenum') text = String(opts.slideNumber ?? 1);
  else if (r.field === 'slidecount') text = String(opts.slideCount ?? 1);
  else if (r.field === 'datetime') text = opts.date ?? new Date().toLocaleDateString();
  const inner = esc(text);
  if (r.link) return `<a class="lnk" data-href="${esc(r.link)}" style="${style};${r.color ? '' : `color:${css({ theme: 'hlink' }, ctx)}`};text-decoration:underline">${inner}</a>`;
  return style ? `<span style="${style}">${inner}</span>` : `<span>${inner}</span>`;
}

export function paragraphsHtml(tb: TextBody, ctx: ThemeCtx, opts: TextRenderOpts = {}): string {
  const labels = bulletLabels(tb.paras, tb.lst);
  return tb.paras
    .map((p, i) => {
      const label = labels[i];
      const style = paraStyle(p, tb, ctx, opts, i === 0, label != null);
      const content = p.runs.length ? p.runs.map((r) => runHtml(r, tb, p, ctx, opts)).join('') : '<br class="e">';
      return `<p style="${esc(style)}"${label != null ? ` data-bu="${esc(label)}"` : ''}>${content}</p>`;
    })
    .join('');
}

export function isEmptyText(tb: TextBody | undefined): boolean {
  return !tb || tb.paras.every((p) => p.runs.every((r) => !r.br && !r.t && !r.field));
}

export const PLACEHOLDER_PROMPTS: Record<string, string> = {
  title: 'Click to add title',
  ctrTitle: 'Click to add title',
  subTitle: 'Click to add subtitle',
  body: 'Click to add text',
  obj: 'Click to add text',
  dt: 'Date',
  ftr: 'Footer',
  sldNum: '‹#›',
  pic: 'Click icon to add picture',
  chart: 'Click icon to add chart',
  tbl: 'Click icon to add table',
  media: 'Click icon to add media',
  clipArt: 'Click icon to add clip art',
  dgm: 'Click icon to add SmartArt graphic',
};

/** The block-level wrapper for a text body: anchoring, insets, wrapping and columns. */
export function textBlockStyle(tb: TextBody): { outer: string; inner: string } {
  const [l, t, r, b] = tb.insets ?? [7.2, 3.6, 7.2, 3.6];
  const anchor = tb.anchor ?? 't';
  const outer = [`padding:${px(t)} ${px(r)} ${px(b)} ${px(l)}`, `justify-content:${anchor === 'ctr' ? 'center' : anchor === 'b' ? 'flex-end' : 'flex-start'}`];
  if (tb.anchorCtr) outer.push('align-items:center');
  const inner: string[] = [];
  inner.push(tb.wrap === false ? 'white-space:pre' : 'white-space:pre-wrap;overflow-wrap:break-word');
  if (tb.vert && tb.vert !== 'horz') inner.push(`writing-mode:vertical-rl${tb.vert === 'vert270' ? ';transform:rotate(180deg)' : ''}`);
  if (tb.cols && tb.cols > 1) inner.push(`column-count:${tb.cols};column-gap:${px(tb.colGap ?? 18)}`);
  return { outer: outer.join(';'), inner: inner.join(';') };
}
