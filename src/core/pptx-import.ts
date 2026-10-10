// PowerPoint (.pptx / .ppsx / .potx) importer. Reads the Open XML package directly and converts it to the
// BNC Presentation model. Placeholder inheritance (master -> layout -> slide) is resolved while importing
// so that every element carries its own geometry and text style, which keeps editing predictable.
import JSZip from 'jszip';
import { applyColorMods, parseHex, toHex } from './color';
import {
  uid,
  type Anim,
  type ArrowEnd,
  type Bullet,
  type Cell,
  type ChartEl,
  type ChartKind,
  type Color,
  type CustPath,
  type DashStyle,
  type Effects,
  type El,
  type Fill,
  type GroupEl,
  type Layout,
  type Line,
  type LstLevel,
  type Master,
  type MediaItem,
  type MediaStore,
  type Para,
  type PhType,
  type PictureEl,
  type Pres,
  type Run,
  type RunProps,
  type ShapeEl,
  type Slide,
  type SlideComment,
  type Spacing,
  type TableEl,
  type TextBody,
  type ThemeColor,
  type ThemeDef,
  type ThemeSlot,
  type Transition,
  type MediaEl,
  type Geom,
  defaultTextLst,
} from './model';
import { attr, boolAttr, descendants, kid, kids, numAttr, parseXml, path as xpath, textOf, type XNode } from './xml';
import { applyTableStyle, DEFAULT_TABLE_STYLE, tableStyleById, TABLE_STYLES, type TableStyleDef, type TsBorders, type TsPart, type PartName } from './tablestyles';

const EMU = 12700;
const pt = (v: number | undefined, d = 0) => (v === undefined ? d : v / EMU);

export interface ImportResult {
  pres: Pres;
  media: MediaStore;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Package access
// ---------------------------------------------------------------------------
interface Rel {
  id: string;
  type: string;
  target: string; // resolved part path (internal) or URL (external)
  external: boolean;
}
type Rels = Map<string, Rel>;

function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/');
  parts.pop();
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

class Pkg {
  private xmlCache = new Map<string, XNode | null>();
  private relCache = new Map<string, Rels>();
  constructor(readonly zip: JSZip) {}

  has(p: string) {
    return !!this.zip.file(p);
  }
  async text(p: string): Promise<string | undefined> {
    const f = this.zip.file(p);
    return f ? await f.async('string') : undefined;
  }
  async xml(p: string): Promise<XNode | undefined> {
    if (this.xmlCache.has(p)) return this.xmlCache.get(p) ?? undefined;
    const t = await this.text(p);
    const n = t ? parseXml(t) : null;
    this.xmlCache.set(p, n);
    return n ?? undefined;
  }
  async bytes(p: string): Promise<Uint8Array | undefined> {
    const f = this.zip.file(p);
    return f ? await f.async('uint8array') : undefined;
  }
  async rels(part: string): Promise<Rels> {
    const cached = this.relCache.get(part);
    if (cached) return cached;
    const dir = part.slice(0, part.lastIndexOf('/') + 1);
    const name = part.slice(part.lastIndexOf('/') + 1);
    const root = await this.xml(`${dir}_rels/${name}.rels`);
    const out: Rels = new Map();
    for (const r of kids(root, 'Relationship')) {
      const external = r.a.TargetMode === 'External';
      out.set(r.a.Id, { id: r.a.Id, type: r.a.Type ?? '', target: external ? r.a.Target : resolvePath(part, r.a.Target ?? ''), external });
    }
    this.relCache.set(part, out);
    return out;
  }
}

const relByType = (rels: Rels, suffix: string): Rel[] => [...rels.values()].filter((r) => r.type.endsWith(suffix));

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff',
  emf: 'image/emf', wmf: 'image/wmf',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', avi: 'video/x-msvideo', wmv: 'video/x-ms-wmv', mpg: 'video/mpeg', mpeg: 'video/mpeg',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', wma: 'audio/x-ms-wma', ogg: 'audio/ogg', aac: 'audio/aac',
};

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
interface ThemeParsed {
  def: ThemeDef;
  fills: XNode[];
  lines: XNode[];
  effects: XNode[];
  bgFills: XNode[];
}

const DEFAULT_COLORS: ThemeDef['colors'] = { dk1: '#000000', lt1: '#ffffff', dk2: '#44546a', lt2: '#e7e6e6', accent1: '#4472c4', accent2: '#ed7d31', accent3: '#a5a5a5', accent4: '#ffc000', accent5: '#5b9bd5', accent6: '#70ad47', hlink: '#0563c1', folHlink: '#954f72' };

function parseTheme(root: XNode | undefined): ThemeParsed {
  const colors = { ...DEFAULT_COLORS };
  const scheme = xpath(root, 'themeElements', 'clrScheme');
  for (const k of Object.keys(colors) as (keyof typeof colors)[]) {
    const n = kid(scheme, k);
    const c = n?.c[0];
    if (!c) continue;
    if (c.n === 'srgbClr') colors[k] = '#' + (c.a.val ?? '000000');
    else if (c.n === 'sysClr') colors[k] = '#' + (c.a.lastClr ?? (c.a.val === 'window' ? 'ffffff' : '000000'));
  }
  const fonts = xpath(root, 'themeElements', 'fontScheme');
  const major = attr(xpath(fonts, 'majorFont', 'latin'), 'typeface') || 'Calibri Light';
  const minor = attr(xpath(fonts, 'minorFont', 'latin'), 'typeface') || 'Calibri';
  const fmt = xpath(root, 'themeElements', 'fmtScheme');
  return {
    def: { name: root?.a.name ?? 'Theme', colors, fonts: { major, minor } },
    fills: kids(kid(fmt, 'fillStyleLst')),
    lines: kids(kid(fmt, 'lnStyleLst')),
    effects: kids(kid(fmt, 'effectStyleLst')),
    bgFills: kids(kid(fmt, 'bgFillStyleLst')),
  };
}

// ---------------------------------------------------------------------------
// Per-part context
// ---------------------------------------------------------------------------
interface Cx {
  imp: Importer;
  part: string;
  rels: Rels;
  theme: ThemeParsed;
  /** colour-map override of a layout / slide (bg1 -> dk1 ...) */
  map?: Record<string, string>;
}

const PRST_COLORS: Record<string, string> = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080', orange: '#ffa500', purple: '#800080', cyan: '#00ffff', magenta: '#ff00ff', lime: '#00ff00', navy: '#000080', teal: '#008080', maroon: '#800000', silver: '#c0c0c0', olive: '#808000', pink: '#ffc0cb', brown: '#a52a2a' };

const COLOR_NODES = new Set(['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr', 'hslClr']);

function mergeColorMods(base: ThemeColor, m: { lumMod?: number; lumOff?: number; tint?: number; shade?: number; alpha?: number }): ThemeColor {
  const out = { ...base };
  if (m.lumMod !== undefined) {
    out.lumMod = (out.lumMod ?? 1) * m.lumMod;
    if (out.lumOff !== undefined) out.lumOff = out.lumOff * m.lumMod;
  }
  if (m.lumOff !== undefined) out.lumOff = (out.lumOff ?? 0) + m.lumOff;
  if (m.tint !== undefined) out.tint = m.tint;
  if (m.shade !== undefined) out.shade = m.shade;
  if (m.alpha !== undefined) out.alpha = (out.alpha ?? 1) * m.alpha;
  return out;
}

function colorNode(n: XNode, cx: Cx, phClr?: Color): Color | undefined {
  const mods: { lumMod?: number; lumOff?: number; tint?: number; shade?: number; alpha?: number } = {};
  for (const m of n.c) {
    const v = numAttr(m, 'val');
    if (v === undefined) continue;
    if (m.n === 'alpha') mods.alpha = v / 100000;
    else if (m.n === 'lumMod') mods.lumMod = v / 100000;
    else if (m.n === 'lumOff') mods.lumOff = v / 100000;
    else if (m.n === 'tint') mods.tint = v / 100000;
    else if (m.n === 'shade') mods.shade = v / 100000;
  }
  let base: Color | undefined;
  switch (n.n) {
    case 'srgbClr':
      base = '#' + (n.a.val ?? '000000');
      break;
    case 'sysClr':
      base = '#' + (n.a.lastClr ?? (n.a.val === 'window' ? 'ffffff' : '000000'));
      break;
    case 'prstClr':
      base = PRST_COLORS[n.a.val ?? 'black'] ?? '#000000';
      break;
    case 'scrgbClr': {
      const ch = (k: string) => Math.round(((numAttr(n, k) ?? 0) / 100000) * 255);
      base = toHex({ r: ch('r'), g: ch('g'), b: ch('b'), a: 1 });
      break;
    }
    case 'schemeClr': {
      const val = n.a.val ?? 'tx1';
      if (val === 'phClr') base = phClr ?? ({ theme: 'accent1' } as ThemeColor);
      else {
        let slot = val;
        if (cx.map && (slot === 'bg1' || slot === 'tx1' || slot === 'bg2' || slot === 'tx2')) slot = cx.map[slot] ?? slot;
        base = { theme: slot as ThemeSlot };
      }
      break;
    }
    default:
      return undefined;
  }
  if (!Object.keys(mods).length) return base;
  if (typeof base === 'string') {
    const rgba = applyColorMods(parseHex(base), mods);
    const hex = toHex(rgba);
    return rgba.a < 0.999 ? hex + Math.round(rgba.a * 255).toString(16).padStart(2, '0') : hex;
  }
  return mergeColorMods(base, mods);
}

function colorOf(parent: XNode | undefined, cx: Cx, phClr?: Color): Color | undefined {
  const c = parent?.c.find((k) => COLOR_NODES.has(k.n));
  return c ? colorNode(c, cx, phClr) : undefined;
}

// ---------------------------------------------------------------------------
// Fills, lines, effects
// ---------------------------------------------------------------------------
function fillOf(parent: XNode | undefined, cx: Cx, phClr?: Color): Fill | undefined {
  for (const k of parent?.c ?? []) {
    switch (k.n) {
      case 'noFill':
        return { t: 'none' };
      case 'solidFill': {
        const c = colorOf(k, cx, phClr);
        return c ? { t: 'solid', c } : undefined;
      }
      case 'gradFill': {
        const stops = kids(kid(k, 'gsLst'), 'gs')
          .map((gs) => ({ pos: (numAttr(gs, 'pos') ?? 0) / 100000, c: colorOf(gs, cx, phClr) ?? '#000000' }))
          .sort((a, b) => a.pos - b.pos);
        if (!stops.length) return undefined;
        const lin = kid(k, 'lin');
        const pathG = kid(k, 'path');
        if (pathG) return { t: 'grad', stops, ang: 0, kind: pathG.a.path === 'circle' ? 'radial' : pathG.a.path === 'rect' ? 'rect' : 'path' };
        return { t: 'grad', stops, ang: (numAttr(lin, 'ang') ?? 0) / 60000, kind: 'linear' };
      }
      case 'blipFill': {
        const id = attr(kid(k, 'blip'), 'r:embed');
        const rel = id ? cx.rels.get(id) : undefined;
        const media = rel && !rel.external ? cx.imp.mediaId(rel.target) : undefined;
        return media ? { t: 'pic', media, tile: !!kid(k, 'tile') } : undefined;
      }
      case 'pattFill':
        return { t: 'pattern', prst: k.a.prst ?? 'pct50', fg: colorOf(kid(k, 'fgClr'), cx, phClr) ?? '#000000', bg: colorOf(kid(k, 'bgClr'), cx, phClr) ?? '#ffffff' };
      case 'grpFill':
        return undefined;
    }
  }
  return undefined;
}

const DASHES = new Set(['solid', 'dot', 'dash', 'dashDot', 'lgDash', 'lgDashDot', 'lgDashDotDot', 'sysDash', 'sysDot', 'sysDashDot', 'sysDashDotDot']);

function arrowOf(n: XNode | undefined): ArrowEnd | undefined {
  if (!n || !n.a.type || n.a.type === 'none') return undefined;
  const t = n.a.type as ArrowEnd['type'];
  return { type: t, w: (n.a.w as ArrowEnd['w']) ?? 'med', len: (n.a.len as ArrowEnd['len']) ?? 'med' };
}

function lineOf(ln: XNode | undefined, cx: Cx, base?: Line, phClr?: Color): Line | undefined {
  if (!ln) return base;
  const out: Line = { ...(base ?? { c: null, w: 0 }) };
  const w = numAttr(ln, 'w');
  if (w !== undefined) out.w = w / EMU;
  const cap = ln.a.cap;
  if (cap) out.cap = cap === 'rnd' ? 'round' : cap === 'sq' ? 'square' : 'flat';
  const f = fillOf(ln, cx, phClr);
  if (f) {
    if (f.t === 'none') out.c = null;
    else if (f.t === 'solid') out.c = f.c;
    else if (f.t === 'grad') {
      out.c = f.stops[0]?.c ?? '#000000';
      out.grad = f;
    }
  }
  const dash = attr(kid(ln, 'prstDash'), 'val');
  if (dash && DASHES.has(dash)) out.dash = dash as DashStyle;
  else if (kid(ln, 'custDash')) out.dash = 'dash';
  if (kid(ln, 'round')) out.join = 'round';
  else if (kid(ln, 'bevel')) out.join = 'bevel';
  else if (kid(ln, 'miter')) out.join = 'miter';
  const he = arrowOf(kid(ln, 'headEnd'));
  const te = arrowOf(kid(ln, 'tailEnd'));
  if (kid(ln, 'headEnd')) out.head = he;
  if (kid(ln, 'tailEnd')) out.tail = te;
  return out;
}

function effectsOf(lst: XNode | undefined, cx: Cx, phClr?: Color): Effects | undefined {
  if (!lst) return undefined;
  const fx: Effects = {};
  const sh = kid(lst, 'outerShdw');
  if (sh) {
    const c = colorOf(sh, cx, phClr) ?? '#000000';
    fx.shadow = { c, blur: pt(numAttr(sh, 'blurRad'), 0), dist: pt(numAttr(sh, 'dist'), 0), dir: (numAttr(sh, 'dir') ?? 0) / 60000, alpha: 1 };
  }
  const glow = kid(lst, 'glow');
  if (glow) fx.glow = { c: colorOf(glow, cx, phClr) ?? '#ffffff', r: pt(numAttr(glow, 'rad'), 5) };
  const soft = kid(lst, 'softEdge');
  if (soft) fx.softEdge = pt(numAttr(soft, 'rad'), 0);
  if (kid(lst, 'reflection')) fx.reflection = true;
  return Object.keys(fx).length ? fx : undefined;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------
interface Xfrm {
  x: number;
  y: number;
  w: number;
  h: number;
  rot?: number;
  flipH?: boolean;
  flipV?: boolean;
  chX?: number;
  chY?: number;
  chW?: number;
  chH?: number;
}

function xfrmOf(n: XNode | undefined): Xfrm | undefined {
  if (!n) return undefined;
  const off = kid(n, 'off');
  const ext = kid(n, 'ext');
  if (!off && !ext) return undefined;
  const chOff = kid(n, 'chOff');
  const chExt = kid(n, 'chExt');
  return {
    x: pt(numAttr(off, 'x')),
    y: pt(numAttr(off, 'y')),
    w: pt(numAttr(ext, 'cx')),
    h: pt(numAttr(ext, 'cy')),
    rot: numAttr(n, 'rot') ? (numAttr(n, 'rot') as number) / 60000 : undefined,
    flipH: boolAttr(n, 'flipH') || undefined,
    flipV: boolAttr(n, 'flipV') || undefined,
    chX: chOff ? pt(numAttr(chOff, 'x')) : undefined,
    chY: chOff ? pt(numAttr(chOff, 'y')) : undefined,
    chW: chExt ? pt(numAttr(chExt, 'cx')) : undefined,
    chH: chExt ? pt(numAttr(chExt, 'cy')) : undefined,
  };
}

/** Evaluate a custom-geometry guide formula. */
function evalGuides(gdLst: XNode | undefined, w: number, h: number, avLst?: XNode): Record<string, number> {
  const vars: Record<string, number> = { l: 0, t: 0, r: w, b: h, w, h, hc: w / 2, vc: h / 2, wd2: w / 2, hd2: h / 2, wd4: w / 4, hd4: h / 4, wd8: w / 8, hd8: h / 8, ss: Math.min(w, h), ls: Math.max(w, h), cd4: 5400000, cd2: 10800000, cd8: 2700000, '3cd4': 16200000, '3cd8': 8100000, '5cd8': 13500000, '7cd8': 18900000 };
  const get = (a: string): number => {
    if (a in vars) return vars[a];
    const v = Number(a);
    return Number.isFinite(v) ? v : 0;
  };
  const run = (gd: XNode) => {
    const parts = (gd.a.fmla ?? '').trim().split(/\s+/);
    const op = parts[0];
    const [a, b, c] = [get(parts[1] ?? '0'), get(parts[2] ?? '0'), get(parts[3] ?? '0')];
    const deg = (v: number) => (v / 60000) * (Math.PI / 180);
    let v = 0;
    switch (op) {
      case 'val': v = a; break;
      case '*/': v = c ? (a * b) / c : 0; break;
      case '+-': v = a + b - c; break;
      case '+/': v = c ? (a + b) / c : 0; break;
      case '?:': v = a > 0 ? b : c; break;
      case 'abs': v = Math.abs(a); break;
      case 'sqrt': v = Math.sqrt(a); break;
      case 'mod': v = Math.sqrt(a * a + b * b + c * c); break;
      case 'max': v = Math.max(a, b); break;
      case 'min': v = Math.min(a, b); break;
      case 'pin': v = Math.min(Math.max(b, a), c); break;
      case 'sin': v = a * Math.sin(deg(b)); break;
      case 'cos': v = a * Math.cos(deg(b)); break;
      case 'tan': v = a * Math.tan(deg(b)); break;
      case 'at2': v = (Math.atan2(b, a) * 180 * 60000) / Math.PI; break;
      case 'cat2': v = a * Math.cos(Math.atan2(c, b)); break;
      case 'sat2': v = a * Math.sin(Math.atan2(c, b)); break;
    }
    vars[gd.a.name ?? ''] = v;
  };
  for (const gd of kids(avLst, 'gd')) run(gd);
  for (const gd of kids(gdLst, 'gd')) run(gd);
  return vars;
}

function custGeomOf(cg: XNode, w: number, h: number): Geom | undefined {
  const guides = evalGuides(kid(cg, 'gdLst'), w * EMU, h * EMU, kid(cg, 'avLst'));
  const val = (s: string | undefined): number => {
    if (s === undefined) return 0;
    if (s in guides) return guides[s];
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  };
  const paths: CustPath[] = [];
  for (const p of kids(kid(cg, 'pathLst'), 'path')) {
    const pw = numAttr(p, 'w') || w * EMU;
    const ph = numAttr(p, 'h') || h * EMU;
    let d = '';
    let cur: [number, number] = [0, 0];
    let start: [number, number] = [0, 0];
    const P = (n: XNode): [number, number] => [val(n.a.x), val(n.a.y)];
    const f = (v: number) => Math.round(v * 100) / 100;
    for (const cmd of p.c) {
      if (cmd.n === 'moveTo') {
        const [x, y] = P(kid(cmd, 'pt')!);
        d += `M${f(x)},${f(y)}`;
        cur = start = [x, y];
      } else if (cmd.n === 'lnTo') {
        const [x, y] = P(kid(cmd, 'pt')!);
        d += `L${f(x)},${f(y)}`;
        cur = [x, y];
      } else if (cmd.n === 'cubicBezTo') {
        const pts = kids(cmd, 'pt').map(P);
        if (pts.length === 3) {
          d += `C${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')}`;
          cur = pts[2];
        }
      } else if (cmd.n === 'quadBezTo') {
        const pts = kids(cmd, 'pt').map(P);
        if (pts.length === 2) {
          d += `Q${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')}`;
          cur = pts[1];
        }
      } else if (cmd.n === 'arcTo') {
        const wR = val(cmd.a.wR);
        const hR = val(cmd.a.hR);
        const st = val(cmd.a.stAng) / 60000;
        const sw = val(cmd.a.swAng) / 60000;
        const cxp = cur[0] - wR * Math.cos((st * Math.PI) / 180);
        const cyp = cur[1] - hR * Math.sin((st * Math.PI) / 180);
        const en = ((st + sw) * Math.PI) / 180;
        const ex = cxp + wR * Math.cos(en);
        const ey = cyp + hR * Math.sin(en);
        d += `A${f(wR)},${f(hR)} 0 ${Math.abs(sw) > 180 ? 1 : 0} ${sw >= 0 ? 1 : 0} ${f(ex)},${f(ey)}`;
        cur = [ex, ey];
      } else if (cmd.n === 'close') {
        d += 'Z';
        cur = start;
      }
    }
    if (d) paths.push({ w: pw, h: ph, d, fill: p.a.fill !== 'none', stroke: p.a.stroke !== '0' && p.a.stroke !== 'false' });
  }
  return paths.length ? { cust: paths } : undefined;
}

function geomOf(spPr: XNode | undefined, w: number, h: number): Geom | undefined {
  const pg = kid(spPr, 'prstGeom');
  if (pg) {
    const adj: Record<string, number> = {};
    for (const gd of kids(kid(pg, 'avLst'), 'gd')) {
      const m = /val\s+(-?\d+)/.exec(gd.a.fmla ?? '');
      if (m && gd.a.name) adj[gd.a.name] = Number(m[1]);
    }
    return Object.keys(adj).length ? { prst: pg.a.prst ?? 'rect', adj } : { prst: pg.a.prst ?? 'rect' };
  }
  const cg = kid(spPr, 'custGeom');
  if (cg) return custGeomOf(cg, w, h);
  return undefined;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------
const FIELD_TYPES: Record<string, Run['field']> = { slidenum: 'slidenum' };

function fontName(typeface: string | undefined): string | undefined {
  if (!typeface) return undefined;
  if (typeface === '+mj-lt' || typeface === '+mj-ea' || typeface === '+mj-cs') return '+mj';
  if (typeface === '+mn-lt' || typeface === '+mn-ea' || typeface === '+mn-cs') return '+mn';
  return typeface;
}

function runPropsOf(rPr: XNode | undefined, cx: Cx, phClr?: Color): RunProps {
  const out: RunProps = {};
  if (!rPr) return out;
  const sz = numAttr(rPr, 'sz');
  if (sz !== undefined) out.sz = sz / 100;
  const b = boolAttr(rPr, 'b');
  if (b !== undefined) out.b = b;
  const i = boolAttr(rPr, 'i');
  if (i !== undefined) out.i = i;
  const u = rPr.a.u;
  if (u !== undefined) out.u = u === 'none' ? false : u === 'dbl' ? 'dbl' : u === 'wavy' ? 'wavy' : u === 'dotted' ? 'dotted' : u.startsWith('dash') ? 'dash' : true;
  const st = rPr.a.strike;
  if (st !== undefined) out.strike = st !== 'noStrike';
  const bl = numAttr(rPr, 'baseline');
  if (bl) out.base = bl / 1000;
  const cap = rPr.a.cap;
  if (cap === 'all') out.cap = 'all';
  else if (cap === 'small') out.cap = 'small';
  const spc = numAttr(rPr, 'spc');
  if (spc) out.spc = spc / 100;
  const lang = rPr.a.lang;
  if (lang) out.lang = lang;
  const color = colorOf(kid(rPr, 'solidFill'), cx, phClr);
  if (color) out.color = color;
  else if (kid(rPr, 'gradFill')) {
    const g = fillOf(rPr, cx, phClr);
    if (g && g.t === 'grad') out.color = g.stops[0]?.c;
  }
  const hl = colorOf(kid(rPr, 'highlight'), cx, phClr);
  if (hl) out.hl = hl;
  const latin = fontName(attr(kid(rPr, 'latin'), 'typeface'));
  if (latin) out.font = latin;
  const link = kid(rPr, 'hlinkClick');
  if (link) {
    const id = link.a['r:id'];
    const rel = id ? cx.rels.get(id) : undefined;
    if (rel && rel.external) out.link = rel.target;
    else if (rel) out.link = `#slide:${rel.target}`;
  }
  return out;
}

function spacingOf(n: XNode | undefined): Spacing | undefined {
  if (!n) return undefined;
  const pct = kid(n, 'spcPct');
  if (pct) return { pct: (numAttr(pct, 'val') ?? 100000) / 100000 };
  const pts = kid(n, 'spcPts');
  if (pts) return { pts: (numAttr(pts, 'val') ?? 0) / 100 };
  return undefined;
}

function bulletOf(pPr: XNode, cx: Cx): Bullet | undefined {
  if (kid(pPr, 'buNone')) return { t: 'none' };
  const color = colorOf(kid(pPr, 'buClr'), cx);
  const sz = kid(pPr, 'buSzPct');
  const pct = sz ? (numAttr(sz, 'val') ?? 100000) / 100000 : undefined;
  const ch = kid(pPr, 'buChar');
  if (ch) {
    const font = fontName(attr(kid(pPr, 'buFont'), 'typeface'));
    return { t: 'char', ch: ch.a.char ?? '•', font, color, pct };
  }
  const num = kid(pPr, 'buAutoNum');
  if (num) return { t: 'num', scheme: num.a.type ?? 'arabicPeriod', start: numAttr(num, 'startAt'), color, pct };
  if (kid(pPr, 'buBlip')) return { t: 'char', ch: '•', color, pct };
  return undefined;
}

interface ParaParsed extends LstLevel {
  level?: number;
}
function paraPropsOf(pPr: XNode | undefined, cx: Cx): ParaParsed {
  const out: ParaParsed = {};
  if (!pPr) return out;
  const algn = pPr.a.algn;
  if (algn) out.algn = algn === 'ctr' ? 'ctr' : algn === 'r' ? 'r' : algn === 'just' || algn === 'dist' || algn === 'justLow' || algn === 'thaiDist' ? 'just' : 'l';
  const marL = numAttr(pPr, 'marL');
  if (marL !== undefined) out.marL = marL / EMU;
  const indent = numAttr(pPr, 'indent');
  if (indent !== undefined) out.indent = indent / EMU;
  const lvl = numAttr(pPr, 'lvl');
  if (lvl) out.level = lvl;
  if (pPr.a.rtl === '1') out.rtl = true;
  const ln = spacingOf(kid(pPr, 'lnSpc'));
  if (ln) out.lnSpc = ln;
  const sb = spacingOf(kid(pPr, 'spcBef'));
  if (sb) out.spcBef = sb;
  const sa = spacingOf(kid(pPr, 'spcAft'));
  if (sa) out.spcAft = sa;
  const bu = bulletOf(pPr, cx);
  if (bu) out.bu = bu;
  const def = kid(pPr, 'defRPr');
  if (def) Object.assign(out, runPropsOf(def, cx));
  return out;
}

function lstOf(lst: XNode | undefined, cx: Cx): LstLevel[] {
  const out: LstLevel[] = [];
  if (!lst) return out;
  for (let i = 0; i < 9; i++) {
    const n = kid(lst, `lvl${i + 1}pPr`);
    if (n) {
      const p = paraPropsOf(n, cx);
      delete p.level;
      out[i] = p;
    }
  }
  return out;
}

function mergeLst(...layers: (LstLevel[] | undefined)[]): LstLevel[] {
  const out: LstLevel[] = [];
  for (const layer of layers) {
    if (!layer) continue;
    for (let i = 0; i < 9; i++) {
      const src = layer[i];
      if (!src) continue;
      const dst = (out[i] ??= {});
      for (const [k, v] of Object.entries(src)) if (v !== undefined) (dst as any)[k] = v;
    }
  }
  for (let i = 0; i < 9; i++) out[i] ??= {};
  return out;
}

type BodyProps = Partial<Pick<TextBody, 'insets' | 'anchor' | 'anchorCtr' | 'wrap' | 'autofit' | 'fontScale' | 'lnSpcReduction' | 'vert' | 'cols' | 'colGap'>>;

function bodyPrOf(bp: XNode | undefined): BodyProps {
  const out: BodyProps = {};
  if (!bp) return out;
  const l = numAttr(bp, 'lIns');
  const t = numAttr(bp, 'tIns');
  const r = numAttr(bp, 'rIns');
  const b = numAttr(bp, 'bIns');
  if (l !== undefined || t !== undefined || r !== undefined || b !== undefined) out.insets = [pt(l, 7.2 * EMU / EMU), pt(t, 3.6), pt(r, 7.2), pt(b, 3.6)];
  if (l !== undefined || t !== undefined || r !== undefined || b !== undefined) out.insets = [l !== undefined ? l / EMU : 7.2, t !== undefined ? t / EMU : 3.6, r !== undefined ? r / EMU : 7.2, b !== undefined ? b / EMU : 3.6];
  const anchor = bp.a.anchor;
  if (anchor) out.anchor = anchor === 'ctr' ? 'ctr' : anchor === 'b' ? 'b' : 't';
  if (bp.a.anchorCtr === '1') out.anchorCtr = true;
  if (bp.a.wrap) out.wrap = bp.a.wrap !== 'none';
  if (bp.a.vert && bp.a.vert !== 'horz') out.vert = bp.a.vert === 'vert270' ? 'vert270' : bp.a.vert === 'eaVert' ? 'eaVert' : 'vert';
  const nc = numAttr(bp, 'numCol');
  if (nc && nc > 1) out.cols = nc;
  const sc = numAttr(bp, 'spcCol');
  if (sc) out.colGap = sc / EMU;
  const na = kid(bp, 'normAutofit');
  if (na) {
    out.autofit = 'shrink';
    const fs = numAttr(na, 'fontScale');
    if (fs !== undefined) out.fontScale = fs / 100000;
    const lr = numAttr(na, 'lnSpcReduction');
    if (lr !== undefined) out.lnSpcReduction = lr / 100000;
  } else if (kid(bp, 'spAutoFit')) out.autofit = 'shape';
  else if (kid(bp, 'noAutofit')) out.autofit = 'none';
  return out;
}

function mergeBody(...layers: (BodyProps | undefined)[]): BodyProps {
  const out: BodyProps = {};
  for (const l of layers) if (l) for (const [k, v] of Object.entries(l)) if (v !== undefined) (out as any)[k] = v;
  return out;
}

function parasOf(tx: XNode | undefined, cx: Cx): Para[] {
  const out: Para[] = [];
  for (const p of kids(tx, 'p')) {
    const props = paraPropsOf(kid(p, 'pPr'), cx);
    const para: Para = { runs: [] };
    const { level, ...rest } = props;
    // run-level defaults from pPr/defRPr are rare; keep paragraph-level settings only
    for (const k of ['algn', 'marL', 'indent', 'lnSpc', 'spcBef', 'spcAft', 'bu', 'rtl'] as const) if (rest[k] !== undefined) (para as any)[k] = rest[k];
    if (level) para.level = level;
    for (const ch of p.c) {
      if (ch.n === 'r') {
        const text = textOf(kid(ch, 't'));
        const rp = runPropsOf(kid(ch, 'rPr'), cx);
        if (text === '' && !Object.keys(rp).length) continue;
        para.runs.push({ t: text, ...rp });
      } else if (ch.n === 'br') {
        para.runs.push({ t: '', br: true, ...runPropsOf(kid(ch, 'rPr'), cx) });
      } else if (ch.n === 'fld') {
        const type = ch.a.type ?? '';
        const field: Run['field'] = FIELD_TYPES[type] ?? (type.startsWith('datetime') ? 'datetime' : undefined);
        para.runs.push({ t: textOf(kid(ch, 't')), ...(field ? { field } : {}), ...runPropsOf(kid(ch, 'rPr'), cx) });
      }
    }
    const end = kid(p, 'endParaRPr');
    if (end) {
      const e = runPropsOf(end, cx);
      if (Object.keys(e).length) para.end = e;
    }
    out.push(para);
  }
  if (!out.length) out.push({ runs: [] });
  return out;
}

// ---------------------------------------------------------------------------
// Parent chain for placeholders
// ---------------------------------------------------------------------------
interface ParentSp {
  xfrm?: Xfrm;
  body?: BodyProps;
  lst: LstLevel[];
  fill?: Fill;
  line?: Line;
  geom?: Geom;
  type: string;
  idx?: number;
}

const masterKind = (type: string) => (type === 'ctrTitle' || type === 'title' ? 'title' : type === 'dt' || type === 'ftr' || type === 'sldNum' ? type : 'body');

interface Styled {
  fill?: Fill;
  line?: Line;
  fx?: Effects;
  fontColor?: Color;
}

function styleRefs(style: XNode | undefined, cx: Cx): Styled {
  const out: Styled = {};
  if (!style) return out;
  const th = cx.theme;
  const fr = kid(style, 'fillRef');
  if (fr) {
    const idx = numAttr(fr, 'idx') ?? 0;
    const ph = colorOf(fr, cx);
    if (idx >= 1001) out.fill = fillOf({ c: [th.bgFills[idx - 1001]].filter(Boolean) } as unknown as XNode, cx, ph) ?? undefined;
    else if (idx >= 1) {
      const node = th.fills[idx - 1];
      out.fill = node ? fillOf({ n: 'x', a: {}, t: '', c: [node] }, cx, ph) : undefined;
    }
    if (idx === 0) out.fill = { t: 'none' };
  }
  const lr = kid(style, 'lnRef');
  if (lr) {
    const idx = numAttr(lr, 'idx') ?? 0;
    const ph = colorOf(lr, cx);
    if (idx >= 1) {
      const node = th.lines[idx - 1];
      out.line = node ? lineOf(node, cx, undefined, ph) : undefined;
    } else out.line = { c: null, w: 0 };
  }
  const er = kid(style, 'effectRef');
  if (er) {
    const idx = numAttr(er, 'idx') ?? 0;
    const ph = colorOf(er, cx);
    if (idx >= 1) {
      const node = th.effects[idx - 1];
      out.fx = effectsOf(kid(node, 'effectLst'), cx, ph);
    }
  }
  const fo = kid(style, 'fontRef');
  if (fo) out.fontColor = colorOf(fo, cx);
  return out;
}

// ---------------------------------------------------------------------------
// The importer
// ---------------------------------------------------------------------------
interface ShapeCtx {
  /** looks up the parent placeholder (layout for slides, master for layouts) */
  lookup?: (ph: { type: string; idx?: number }) => ParentSp | undefined;
  /** the text style base for a placeholder type (master txStyles) */
  txBase?: (type: string) => LstLevel[];
  /** collects the resolved placeholder info for children to inherit from */
  collect?: (ph: ParentSp) => void;
  /** shape ids (cNvPr id) -> element id, for animations */
  ids?: Map<string, string>;
  inGroup?: boolean;
  /** the slide's background fill, for shapes marked useBgFill */
  bgFill?: Fill;
}

class Importer {
  media: MediaStore = new Map();
  warnings: string[] = [];
  private mediaByPath = new Map<string, string>();
  private mediaBytes = new Map<string, Uint8Array>();
  tableStyles = new Map<string, TableStyleDef>();
  defaultText: LstLevel[] = defaultTextLst();
  slideIdByPath = new Map<string, string>();

  constructor(readonly pkg: Pkg) {}

  async preloadMedia() {
    const names = Object.keys(this.pkg.zip.files).filter((n) => /^ppt\/(media|embeddings)\//i.test(n) && !this.pkg.zip.files[n].dir);
    for (const n of names) {
      const b = await this.pkg.bytes(n);
      if (b) this.mediaBytes.set(n, b);
    }
  }

  mediaId(target: string): string | undefined {
    const known = this.mediaByPath.get(target);
    if (known) return known;
    const data = this.mediaBytes.get(target);
    if (!data) return undefined;
    const ext = (target.split('.').pop() ?? '').toLowerCase();
    const id = `media${this.mediaByPath.size + 1}`;
    const item: MediaItem = { mime: MIME[ext] ?? 'application/octet-stream', name: target.split('/').pop() ?? id, data };
    this.media.set(id, item);
    this.mediaByPath.set(target, id);
    return id;
  }

  warn(msg: string) {
    if (!this.warnings.includes(msg) && this.warnings.length < 40) this.warnings.push(msg);
  }

  // ---- shapes ----
  async spTree(tree: XNode | undefined, cx: Cx, sc: ShapeCtx): Promise<El[]> {
    const out: El[] = [];
    if (!tree) return out;
    const items: XNode[] = [];
    const flatten = (nodes: XNode[]) => {
      for (const n of nodes) {
        if (n.n === 'AlternateContent') {
          const fb = kid(n, 'Fallback');
          const choice = kid(n, 'Choice');
          const pick = fb ?? choice;
          if (pick) flatten(pick.c);
        } else items.push(n);
      }
    };
    flatten(tree.c);
    for (const n of items) {
      try {
        let el: El | null = null;
        if (n.n === 'sp') el = this.sp(n, cx, sc);
        else if (n.n === 'cxnSp') el = this.sp(n, cx, sc, true);
        else if (n.n === 'pic') el = await this.pic(n, cx, sc);
        else if (n.n === 'grpSp') el = await this.group(n, cx, sc);
        else if (n.n === 'graphicFrame') el = await this.graphicFrame(n, cx, sc);
        if (el) out.push(el);
      } catch (e) {
        this.warn(`Skipped an object that could not be read (${n.n}): ${(e as Error).message}`);
      }
    }
    return out;
  }

  private nv(n: XNode): { id: string; name: string; descr?: string; ph?: { type: string; idx?: number }; txBox: boolean; link?: string } {
    const nvPr0 = kid(n, 'nvSpPr') ?? kid(n, 'nvPicPr') ?? kid(n, 'nvCxnSpPr') ?? kid(n, 'nvGrpSpPr') ?? kid(n, 'nvGraphicFramePr');
    const c = kid(nvPr0, 'cNvPr');
    const nvPr = kid(nvPr0, 'nvPr');
    const ph = kid(nvPr, 'ph');
    return {
      id: c?.a.id ?? '',
      name: c?.a.name ?? 'Object',
      descr: c?.a.descr || undefined,
      ph: ph ? { type: ph.a.type ?? 'obj', idx: numAttr(ph, 'idx') } : undefined,
      txBox: kid(nvPr0, 'cNvSpPr')?.a.txBox === '1',
    };
  }

  private linkOf(n: XNode, cx: Cx): string | undefined {
    const c = kid(kid(n.c[0], 'cNvPr'), 'hlinkClick');
    if (!c) return undefined;
    const rel = c.a['r:id'] ? cx.rels.get(c.a['r:id']) : undefined;
    if (rel?.external) return rel.target;
    if (rel) return `#slide:${rel.target}`;
    return undefined;
  }

  sp(n: XNode, cx: Cx, sc: ShapeCtx, isCxn = false): El | null {
    const nv = this.nv(n);
    const spPr = kid(n, 'spPr');
    const parent = nv.ph ? sc.lookup?.(nv.ph) : undefined;
    const own = xfrmOf(kid(spPr, 'xfrm'));
    const xf = own ?? parent?.xfrm;
    if (!xf) {
      if (!nv.ph) return null;
    }
    const x = xf ?? { x: 0, y: 0, w: 0, h: 0 };
    const geom = geomOf(spPr, x.w, x.h) ?? parent?.geom ?? (isCxn ? { prst: 'line' } : { prst: 'rect' });
    const style = styleRefs(kid(n, 'style'), cx);

    // fill & outline
    let fill = fillOf(spPr, cx);
    if (fill === undefined) fill = nv.ph ? (parent?.fill ?? style.fill) : style.fill;
    if (n.a.useBgFill === '1') fill = sc.bgFill ?? { t: 'solid', c: { theme: 'bg1' } };
    if (nv.txBox && fill === undefined) fill = { t: 'none' };
    const lnNode = kid(spPr, 'ln');
    const baseLine = nv.ph ? (parent?.line ?? style.line) : style.line;
    const line = lineOf(lnNode, cx, baseLine) ?? baseLine;
    const fx = effectsOf(kid(spPr, 'effectLst'), cx) ?? style.fx;

    // text
    const hasText = !!kid(n, 'txBody');
    let text: TextBody | undefined;
    if (hasText || nv.ph) {
      const tx = kid(n, 'txBody');
      const phType = nv.ph?.type ?? '';
      const base = nv.ph ? (parent?.lst ?? sc.txBase?.(phType) ?? this.defaultText) : this.defaultText;
      const fontRefLst: LstLevel[] | undefined = style.fontColor ? Array.from({ length: 9 }, () => ({ color: style.fontColor })) : undefined;
      const lst = mergeLst(nv.ph ? undefined : fontRefLst, base, lstOf(kid(tx, 'lstStyle'), cx));
      const body = mergeBody(parent?.body, bodyPrOf(kid(tx, 'bodyPr')));
      text = { paras: parasOf(tx, cx), lst, wrap: body.wrap ?? true, autofit: body.autofit, insets: body.insets ?? [7.2, 3.6, 7.2, 3.6], anchor: body.anchor ?? 't', fontScale: body.fontScale, lnSpcReduction: body.lnSpcReduction };
      if (body.anchorCtr) text.anchorCtr = true;
      if (body.vert) text.vert = body.vert;
      if (body.cols) {
        text.cols = body.cols;
        text.colGap = body.colGap;
      }
    }

    const el: ShapeEl = {
      id: uid(),
      type: 'shape',
      name: nv.name,
      x: x.x,
      y: x.y,
      w: x.w,
      h: x.h,
      rot: x.rot,
      flipH: x.flipH,
      flipV: x.flipV,
      geom,
      fill: fill,
      line: line,
      fx,
      text,
      txBox: nv.txBox || undefined,
      alt: nv.descr,
      link: this.linkOf(n, cx),
    };
    if (nv.ph) el.ph = { type: nv.ph.type as PhType, idx: nv.ph.idx };
    if (nv.id) sc.ids?.set(nv.id, el.id);
    if (nv.ph && sc.collect) {
      sc.collect({ xfrm: xf, body: mergeBody(parent?.body, bodyPrOf(kid(kid(n, 'txBody'), 'bodyPr'))), lst: text?.lst ?? [], fill, line, geom, type: nv.ph.type, idx: nv.ph.idx });
    }
    return stripUndefined(el);
  }

  async pic(n: XNode, cx: Cx, sc: ShapeCtx): Promise<El | null> {
    const nv = this.nv(n);
    const spPr = kid(n, 'spPr');
    const parent = nv.ph ? sc.lookup?.(nv.ph) : undefined;
    const xf = xfrmOf(kid(spPr, 'xfrm')) ?? parent?.xfrm;
    if (!xf) return null;
    const blipFill = kid(n, 'blipFill');
    const blip = kid(blipFill, 'blip');
    const rid = blip?.a['r:embed'] ?? blip?.a['r:link'];
    const rel = rid ? cx.rels.get(rid) : undefined;
    const nvPr = kid(kid(n, 'nvPicPr'), 'nvPr');
    // video / audio
    const vf = kid(nvPr, 'videoFile');
    const af = kid(nvPr, 'audioFile');
    if (vf || af) {
      const ext = descendants(nvPr, 'media')[0];
      const mrel = ext?.a['r:embed'] ? cx.rels.get(ext.a['r:embed']) : (vf ?? af)?.a['r:link'] ? cx.rels.get((vf ?? af)!.a['r:link']) : undefined;
      const mid = mrel && !mrel.external ? this.mediaId(mrel.target) : undefined;
      if (mid) {
        const poster = rel && !rel.external ? this.mediaId(rel.target) : undefined;
        const me: MediaEl = { id: uid(), type: 'media', kind: af ? 'audio' : 'video', media: mid, poster, name: nv.name, x: xf.x, y: xf.y, w: xf.w, h: xf.h, rot: xf.rot };
        if (nv.id) sc.ids?.set(nv.id, me.id);
        return stripUndefined(me);
      }
    }
    const media = rel && !rel.external ? this.mediaId(rel.target) : undefined;
    if (!media) {
      if (rel?.external) this.warn('A linked (not embedded) picture was skipped.');
      return null;
    }
    const src = kid(blipFill, 'srcRect');
    const crop = src ? { l: (numAttr(src, 'l') ?? 0) / 100000, t: (numAttr(src, 't') ?? 0) / 100000, r: (numAttr(src, 'r') ?? 0) / 100000, b: (numAttr(src, 'b') ?? 0) / 100000 } : undefined;
    const geom = geomOf(spPr, xf.w, xf.h);
    const el: PictureEl = {
      id: uid(),
      type: 'picture',
      name: nv.name,
      x: xf.x,
      y: xf.y,
      w: xf.w,
      h: xf.h,
      rot: xf.rot,
      flipH: xf.flipH,
      flipV: xf.flipV,
      media,
      crop: crop && (crop.l || crop.t || crop.r || crop.b) ? crop : undefined,
      geom: geom && 'prst' in geom && geom.prst === 'rect' ? undefined : geom,
      line: lineOf(kid(spPr, 'ln'), cx),
      fx: effectsOf(kid(spPr, 'effectLst'), cx),
      alt: nv.descr,
      link: this.linkOf(n, cx),
    };
    if (el.line && (el.line.c == null || !el.line.w)) el.line = undefined;
    const am = kid(blip, 'alphaModFix');
    if (am) el.alpha = (numAttr(am, 'amt') ?? 100000) / 100000;
    const lum = kid(blip, 'lum');
    if (lum) {
      if (numAttr(lum, 'bright')) el.brightness = (numAttr(lum, 'bright') as number) / 100000;
      if (numAttr(lum, 'contrast')) el.contrast = (numAttr(lum, 'contrast') as number) / 100000;
    }
    if (kid(blip, 'grayscl')) el.gray = true;
    if (nv.id) sc.ids?.set(nv.id, el.id);
    if (nv.ph && sc.collect) sc.collect({ xfrm: xf, lst: [], type: nv.ph.type, idx: nv.ph.idx });
    return stripUndefined(el);
  }

  async group(n: XNode, cx: Cx, sc: ShapeCtx): Promise<El | null> {
    const nv = this.nv(n);
    const xf = xfrmOf(kid(kid(n, 'grpSpPr'), 'xfrm'));
    if (!xf) return null;
    const chX = xf.chX ?? xf.x;
    const chY = xf.chY ?? xf.y;
    const cw = xf.chW ?? xf.w;
    const ch = xf.chH ?? xf.h;
    const kidsEls = await this.spTree(n, cx, { ...sc, inGroup: true, lookup: undefined, collect: undefined });
    const shift = (e: El) => {
      e.x -= chX;
      e.y -= chY;
    };
    kidsEls.forEach(shift);
    const el: GroupEl = { id: uid(), type: 'group', name: nv.name, x: xf.x, y: xf.y, w: xf.w, h: xf.h, rot: xf.rot, flipH: xf.flipH, flipV: xf.flipV, cw, ch, children: kidsEls };
    if (nv.id) sc.ids?.set(nv.id, el.id);
    return stripUndefined(el);
  }

  async graphicFrame(n: XNode, cx: Cx, sc: ShapeCtx): Promise<El | null> {
    const nv = this.nv(n);
    const xf = xfrmOf(kid(n, 'xfrm'));
    if (!xf) return null;
    const data = xpath(n, 'graphic', 'graphicData');
    const uri = data?.a.uri ?? '';
    let el: El | null = null;
    if (kid(data, 'tbl')) el = this.table(kid(data, 'tbl')!, cx, xf, nv.name);
    else if (uri.endsWith('/chart') || kid(data, 'chart')) el = await this.chart(kid(data, 'chart')!, cx, xf, nv.name);
    else if (uri.endsWith('/diagram') || kid(data, 'relIds')) el = await this.diagram(cx, xf, nv.name, sc);
    else {
      // OLE objects, equations etc.: use the picture PowerPoint stores as a preview
      const pic = descendants(data, 'pic')[0];
      if (pic) {
        const p = await this.pic(pic, cx, sc);
        if (p) {
          Object.assign(p, { x: xf.x, y: xf.y, w: xf.w, h: xf.h, name: nv.name });
          el = p;
        }
      } else this.warn(`An object of type "${uri.split('/').pop() || 'unknown'}" could not be shown.`);
    }
    if (el && nv.id) sc.ids?.set(nv.id, el.id);
    return el ? stripUndefined(el) : null;
  }

  // ---- tables ----
  table(tbl: XNode, cx: Cx, xf: Xfrm, name: string): TableEl {
    const pr = kid(tbl, 'tblPr');
    const cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map((g) => pt(numAttr(g, 'w')));
    const styleGuid = kid(pr, 'tableStyleId')?.t.trim() ?? '';
    const rows: TableEl['rows'] = kids(tbl, 'tr').map((tr) => ({
      h: pt(numAttr(tr, 'h')),
      cells: kids(tr, 'tc').map((tc): Cell => {
        const tcPr = kid(tc, 'tcPr');
        const lst = mergeLst(this.defaultText);
        const tx = kid(tc, 'txBody');
        const cell: Cell = { text: { paras: parasOf(tx, cx), lst: mergeLst(lst, lstOf(kid(tx, 'lstStyle'), cx)), wrap: true, insets: [7.2, 3.6, 7.2, 3.6] } };
        const gs = numAttr(tc, 'gridSpan');
        if (gs && gs > 1) cell.gridSpan = gs;
        const rs = numAttr(tc, 'rowSpan');
        if (rs && rs > 1) cell.rowSpan = rs;
        if (tc.a.hMerge === '1') cell.hMerge = true;
        if (tc.a.vMerge === '1') cell.vMerge = true;
        return cell;
      }),
    }));
    const style = { id: tableStyleById(styleGuid)?.id ?? (styleGuid || DEFAULT_TABLE_STYLE), firstRow: boolAttr(pr, 'firstRow'), lastRow: boolAttr(pr, 'lastRow'), firstCol: boolAttr(pr, 'firstCol'), lastCol: boolAttr(pr, 'lastCol'), bandRow: boolAttr(pr, 'bandRow'), bandCol: boolAttr(pr, 'bandCol') };
    const el: TableEl = { id: uid(), type: 'table', name, x: xf.x, y: xf.y, w: xf.w || cols.reduce((a, b) => a + b, 0), h: xf.h || rows.reduce((a, r) => a + r.h, 0), cols, rows, style };
    // 1. the style, 2. explicit cell settings on top
    const def = this.tableStyles.get(styleGuid.toLowerCase()) ?? tableStyleById(styleGuid) ?? (styleGuid ? undefined : tableStyleById(DEFAULT_TABLE_STYLE));
    applyTableStyle(el, def ?? tableStyleById(DEFAULT_TABLE_STYLE));
    kids(tbl, 'tr').forEach((tr, r) =>
      kids(tr, 'tc').forEach((tc, c) => {
        const tcPr = kid(tc, 'tcPr');
        const cell = el.rows[r].cells[c];
        if (!tcPr || !cell) return;
        const f = fillOf(tcPr, cx);
        if (f) cell.fill = f.t === 'none' ? undefined : f;
        const m = [numAttr(tcPr, 'marL'), numAttr(tcPr, 'marT'), numAttr(tcPr, 'marR'), numAttr(tcPr, 'marB')];
        if (m.some((v) => v !== undefined)) cell.margins = [pt(m[0], 7.2 * EMU), pt(m[1], 3.6 * EMU), pt(m[2], 7.2 * EMU), pt(m[3], 3.6 * EMU)].map((v, i) => (m[i] === undefined ? [7.2, 3.6, 7.2, 3.6][i] : v)) as [number, number, number, number];
        const a = tcPr.a.anchor;
        if (a) cell.anchor = a === 'ctr' ? 'ctr' : a === 'b' ? 'b' : 't';
        for (const [tag, side] of [['lnL', 'l'], ['lnR', 'r'], ['lnT', 't'], ['lnB', 'b']] as const) {
          const ln = kid(tcPr, tag);
          if (!ln) continue;
          const l = lineOf(ln, cx, cell.borders?.[side]);
          cell.borders = { ...(cell.borders ?? {}) };
          if (l && l.c) cell.borders[side] = l;
          else delete cell.borders[side];
        }
      }),
    );
    // explicit text colours / bold in the style win over the default text style
    return el;
  }

  // ---- charts ----
  async chart(c: XNode, cx: Cx, xf: Xfrm, name: string): Promise<El | null> {
    const rid = c.a['r:id'];
    const rel = rid ? cx.rels.get(rid) : undefined;
    if (!rel) return null;
    const root = await this.pkg.xml(rel.target);
    const plot = xpath(root, 'chart', 'plotArea');
    if (!plot) return null;
    const typeNode = plot.c.find((k) => /Chart$/.test(k.n) && k.n !== 'layout' && !/^(valAx|catAx|dateAx|serAx)$/.test(k.n));
    if (!typeNode) return null;
    const grouping = attr(kid(typeNode, 'grouping'), 'val');
    const barDir = attr(kid(typeNode, 'barDir'), 'val');
    let kind: ChartKind = 'col';
    switch (typeNode.n) {
      case 'barChart':
      case 'bar3DChart':
        kind = barDir === 'bar' ? (grouping === 'stacked' || grouping === 'percentStacked' ? 'barStacked' : 'bar') : grouping === 'stacked' || grouping === 'percentStacked' ? 'colStacked' : 'col';
        break;
      case 'lineChart':
      case 'line3DChart':
        kind = 'line';
        break;
      case 'areaChart':
      case 'area3DChart':
        kind = 'area';
        break;
      case 'pieChart':
      case 'pie3DChart':
      case 'ofPieChart':
        kind = 'pie';
        break;
      case 'doughnutChart':
        kind = 'doughnut';
        break;
      case 'scatterChart':
      case 'bubbleChart':
        kind = 'scatter';
        break;
      case 'radarChart':
        kind = 'radar';
        break;
      default:
        kind = 'col';
    }
    const readStr = (n: XNode | undefined): string[] => {
      const cache = kid(kid(n, 'strRef') ?? kid(n, 'numRef') ?? n, 'strCache') ?? kid(kid(n, 'numRef'), 'numCache') ?? kid(n, 'strLit') ?? kid(n, 'numLit');
      const pts = kids(cache, 'pt');
      const count = numAttr(kid(cache, 'ptCount'), 'val') ?? pts.length;
      const out: string[] = Array.from({ length: count }, () => '');
      for (const p of pts) out[Number(p.a.idx)] = textOf(kid(p, 'v'));
      return out;
    };
    const readNum = (n: XNode | undefined): (number | null)[] => readStr(n).map((s) => (s === '' || Number.isNaN(Number(s)) ? null : Number(s)));
    const series = kids(typeNode, 'ser').map((s, i) => {
      const color = colorOf(kid(kid(s, 'spPr'), 'solidFill') ? kid(s, 'spPr') : undefined, cx);
      const catNode = kid(s, 'cat') ?? kid(s, 'xVal');
      return {
        name: readStr(kid(s, 'tx'))[0] || `Series ${i + 1}`,
        values: readNum(kid(s, 'val') ?? kid(s, 'yVal')),
        color: color ?? undefined,
        x: kind === 'scatter' ? readNum(kid(s, 'xVal')) : undefined,
        _cats: catNode ? readStr(catNode) : [],
      };
    });
    const cats = series.find((s) => s._cats.length)?._cats ?? [];
    const titleNode = xpath(root, 'chart', 'title');
    const title = titleNode ? descendants(titleNode, 't').map(textOf).join('') : '';
    const legendPos = attr(xpath(root, 'chart', 'legend', 'legendPos'), 'val');
    const legend = !xpath(root, 'chart', 'legend') ? 'none' : legendPos === 'r' || legendPos === 't' || legendPos === 'l' ? legendPos : 'b';
    const showVal = descendants(typeNode, 'showVal').some((n) => n.a.val === '1');
    const el: ChartEl = {
      id: uid(),
      type: 'chart',
      name,
      x: xf.x,
      y: xf.y,
      w: xf.w,
      h: xf.h,
      kind,
      title: title || undefined,
      cats: cats.length ? cats : Array.from({ length: Math.max(...series.map((s) => s.values.length), 0) }, (_, i) => String(i + 1)),
      series: series.map(({ _cats, ...s }) => s),
      legend: legend as ChartEl['legend'],
      labels: showVal,
      grid: !!kid(kid(plot, 'valAx'), 'majorGridlines'),
      smooth: kid(kid(typeNode, 'ser'), 'smooth')?.a.val === '1',
    };
    return el;
  }

  // ---- SmartArt: use the drawing PowerPoint stores next to the data model ----
  async diagram(cx: Cx, xf: Xfrm, name: string, sc: ShapeCtx): Promise<El | null> {
    const draw = relByType(cx.rels, '/diagramDrawing')[0];
    if (!draw) {
      this.warn('A SmartArt graphic has no saved drawing and was skipped.');
      return null;
    }
    const root = await this.pkg.xml(draw.target);
    const tree = kid(root, 'spTree');
    if (!tree) return null;
    const dcx: Cx = { ...cx, part: draw.target, rels: await this.pkg.rels(draw.target) };
    const kidsEls = await this.spTree(tree, dcx, { ...sc, lookup: undefined, collect: undefined, inGroup: true });
    // text in diagram shapes can have its own transform; keep it simple and drop txXfrm
    return { id: uid(), type: 'group', name, x: xf.x, y: xf.y, w: xf.w, h: xf.h, cw: xf.w, ch: xf.h, children: kidsEls } as GroupEl;
  }

  // ---- whole file ----
  async slideLike(part: string, theme: ThemeParsed, sc: ShapeCtx, map?: Record<string, string>) {
    const root = await this.pkg.xml(part);
    const rels = await this.pkg.rels(part);
    const cx: Cx = { imp: this, part, rels, theme, map };
    return { root, cx, rels, elements: await this.spTree(xpath(root, 'cSld', 'spTree'), cx, sc) };
  }
}

function stripUndefined<T extends object>(o: T): T {
  for (const k of Object.keys(o)) if ((o as any)[k] === undefined) delete (o as any)[k];
  return o;
}

// ---------------------------------------------------------------------------
// Transitions & animations
// ---------------------------------------------------------------------------
function transitionOf(slide: XNode | undefined): Transition | undefined {
  if (!slide) return undefined;
  const find = (nodes: XNode[]): XNode | undefined => {
    for (const n of nodes) {
      if (n.n === 'transition') return n;
      if (n.n === 'AlternateContent') {
        const choice = kid(n, 'Choice');
        const fb = kid(n, 'Fallback');
        const t = (choice && find(choice.c)) || (fb && find(fb.c));
        if (t) return t;
      }
    }
    return undefined;
  };
  const tr = find(slide.c);
  if (!tr) return undefined;
  const effect = tr.c.find((k) => k.n !== 'sndAc' && k.n !== 'extLst');
  const spd = tr.a.spd;
  const dur = numAttr(tr, 'dur') ? (numAttr(tr, 'dur') as number) / 1000 : spd === 'fast' ? 0.5 : spd === 'slow' ? 1.5 : 0.75;
  const t: Transition = { type: effect?.n ?? 'none', dur };
  if (effect) {
    // OOXML names the direction of travel (u = moving up); we store the side the new slide comes from (b = bottom)
    const FROM: Record<string, string> = { l: 'r', r: 'l', d: 't', u: 'b' };
    if (effect.n === 'split') t.dir = effect.a.orient === 'vert' ? 'vert' : 'horz';
    else if (['push', 'wipe', 'cover', 'pull'].includes(effect.n) && effect.a.dir) t.dir = FROM[effect.a.dir] ?? effect.a.dir;
    else if (effect.a.dir) t.dir = effect.a.dir;
  }
  if (tr.a.advClick === '0') t.advClick = false;
  const adv = numAttr(tr, 'advTm');
  if (adv !== undefined) t.advAfter = adv / 1000;
  return t;
}

const ENTR: Record<number, string> = { 1: 'appear', 2: 'fly', 10: 'fade', 22: 'wipe', 23: 'zoom', 53: 'zoom', 16: 'split', 21: 'wheel', 26: 'bounce', 30: 'float', 42: 'float', 37: 'float', 47: 'float' };
const SUBTYPE_DIR: Record<number, string> = { 1: 't', 2: 'r', 4: 'b', 8: 'l', 9: 'tl', 3: 'tr', 12: 'bl', 6: 'br' };

function animsOf(slide: XNode | undefined, ids: Map<string, string>): Anim[] {
  const timing = kid(slide, 'timing');
  if (!timing) return [];
  const out: Anim[] = [];
  for (const ctn of descendants(timing, 'cTn')) {
    const cls = ctn.a.presetClass;
    if (!cls || (cls !== 'entr' && cls !== 'exit' && cls !== 'emph')) continue;
    const spTgt = descendants(ctn, 'spTgt')[0];
    const target = spTgt ? ids.get(spTgt.a.spid) : undefined;
    if (!target) continue;
    const presetId = numAttr(ctn, 'presetID') ?? 1;
    const node = ctn.a.nodeType;
    const trigger: Anim['trigger'] = node === 'withEffect' ? 'with' : node === 'afterEffect' ? 'after' : 'click';
    const delayCond = kid(kid(ctn, 'stCondLst'), 'cond');
    const delay = delayCond && delayCond.a.delay && delayCond.a.delay !== 'indefinite' ? Number(delayCond.a.delay) / 1000 : 0;
    let dur = 0.5;
    for (const c of descendants(ctn, 'cTn')) {
      const d = numAttr(c, 'dur');
      if (d && d > 1) dur = Math.max(dur === 0.5 ? 0 : dur, d / 1000);
    }
    const effect = cls === 'emph' ? (presetId === 6 ? 'grow' : presetId === 8 ? 'spin' : 'pulse') : (ENTR[presetId] ?? 'fade');
    out.push({ id: uid('a'), target, cls, effect, dir: SUBTYPE_DIR[numAttr(ctn, 'presetSubtype') ?? 0], trigger: out.length === 0 && trigger !== 'click' ? 'click' : trigger, dur, delay });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
export async function importPptx(data: Uint8Array | ArrayBuffer): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(data);
  const pkg = new Pkg(zip);
  const imp = new Importer(pkg);
  await imp.preloadMedia();

  const pres0 = await pkg.xml('ppt/presentation.xml');
  if (!pres0 || pres0.n !== 'presentation') throw new Error('This does not look like a PowerPoint file (ppt/presentation.xml is missing).');
  const presRels = await pkg.rels('ppt/presentation.xml');

  const sz = kid(pres0, 'sldSz');
  const size = { w: pt(numAttr(sz, 'cx'), 12192000 / EMU) || 960, h: pt(numAttr(sz, 'cy'), 6858000 / EMU) || 540 };

  // table styles that the file defines itself
  const tsRel = relByType(presRels, '/tableStyles')[0];
  if (tsRel) {
    const root = await pkg.xml(tsRel.target);
    for (const s of kids(root, 'tblStyle')) {
      const def = parseTableStyle(s);
      if (def) imp.tableStyles.set(def.id.toLowerCase(), def);
    }
  }

  const author = (await pkg.xml('docProps/core.xml')) as XNode | undefined;
  const title = textOf(kid(author, 'title')) || '';
  const creator = textOf(kid(author, 'creator')) || '';

  const masters: Master[] = [];
  const layouts: Layout[] = [];
  const layoutByPath = new Map<string, Layout>();
  const layoutParents = new Map<string, ParentSp[]>();
  const themeByMaster = new Map<string, ThemeParsed>();
  const masterPathToId = new Map<string, string>();

  const masterRels = relByType(presRels, '/slideMaster');
  for (const mr of masterRels) {
    const mPart = mr.target;
    const mRels = await pkg.rels(mPart);
    const themeRel = relByType(mRels, '/theme')[0];
    const theme = parseTheme(themeRel ? await pkg.xml(themeRel.target) : undefined);
    const mRoot = await pkg.xml(mPart);

    const mcx: Cx = { imp, part: mPart, rels: mRels, theme };
    const cm = kid(mRoot, 'clrMap');
    const clrMap = { bg1: cm?.a.bg1 ?? 'lt1', tx1: cm?.a.tx1 ?? 'dk1', bg2: cm?.a.bg2 ?? 'lt2', tx2: cm?.a.tx2 ?? 'dk2' };
    const tx = kid(mRoot, 'txStyles');
    const txStyles = { title: mergeLst(lstOf(kid(tx, 'titleStyle'), mcx)), body: mergeLst(lstOf(kid(tx, 'bodyStyle'), mcx)), other: mergeLst(lstOf(kid(tx, 'otherStyle'), mcx)) };

    // presentation default text style (first master only matters)
    if (!imp.defaultText.some((l) => Object.keys(l).length) || masters.length === 0) {
      const dts = lstOf(kid(pres0, 'defaultTextStyle'), mcx);
      if (dts.length) imp.defaultText = mergeLst(defaultTextLst(), dts);
    }

    // master placeholders
    const masterPhs: ParentSp[] = [];
    const baseFor = (type: string) => (masterKind(type) === 'title' ? txStyles.title : masterKind(type) === 'body' ? txStyles.body : txStyles.other);
    const mElements = await imp.spTree(xpath(mRoot, 'cSld', 'spTree'), mcx, {
      txBase: baseFor,
      collect: (p) => masterPhs.push(p),
      lookup: undefined,
    });
    // the master's own placeholder text styles come from txStyles (applied by sp via txBase)
    const bgNode = xpath(mRoot, 'cSld', 'bg');
    const bg = bgOf(bgNode, mcx) ?? { t: 'solid', c: { theme: 'bg1' } as ThemeColor };
    const master: Master = { id: uid('m'), name: theme.def.name, theme: theme.def, clrMap, bg, elements: mElements, txStyles };
    masters.push(master);
    masterPathToId.set(mPart, master.id);
    themeByMaster.set(master.id, theme);

    // layouts of this master
    const layoutIds = kids(kid(mRoot, 'sldLayoutIdLst'), 'sldLayoutId');
    for (const lid of layoutIds) {
      const rel = mRels.get(lid.a['r:id']);
      if (!rel) continue;
      const lRoot = await pkg.xml(rel.target);
      const lRels = await pkg.rels(rel.target);
      const ovr = xpath(lRoot, 'clrMapOvr', 'overrideClrMapping');
      const map = ovr ? { bg1: ovr.a.bg1, tx1: ovr.a.tx1, bg2: ovr.a.bg2, tx2: ovr.a.tx2 } : undefined;
      const lcx: Cx = { imp, part: rel.target, rels: lRels, theme, map: map && JSON.stringify(map) !== JSON.stringify(clrMap) ? map : undefined };
      const layoutPhs: ParentSp[] = [];
      const lElements = await imp.spTree(xpath(lRoot, 'cSld', 'spTree'), lcx, {
        lookup: (ph) => findMasterPh(masterPhs, ph),
        txBase: baseFor,
        collect: (p) => layoutPhs.push(p),
      });
      const lbg = xpath(lRoot, 'cSld', 'bg');
      const layout: Layout = {
        id: uid('l'),
        masterId: master.id,
        name: xpath(lRoot, 'cSld') ? (xpath(lRoot, 'cSld')!.a.name ?? 'Layout') : 'Layout',
        kind: lRoot?.a.type,
        bg: lbg ? bgOf(lbg, lcx) : undefined,
        showMaster: lRoot?.a.showMasterSp === '0' ? false : undefined,
        elements: lElements,
      };
      layouts.push(layout);
      layoutByPath.set(rel.target, layout);
      layoutParents.set(layout.id, layoutPhs);
    }
  }
  if (!masters.length) throw new Error('The presentation has no slide master.');

  // slides
  const slides: Slide[] = [];
  const slideIds = kids(kid(pres0, 'sldIdLst'), 'sldId');
  const sectionOf = new Map<string, string>();
  for (const sec of descendants(pres0, 'section')) {
    const first = descendants(sec, 'sldId')[0];
    if (first && sec.a.name) sectionOf.set(first.a.id, sec.a.name);
  }
  const pendingLinks: { run: any; target: string }[] = [];
  void pendingLinks;
  const commentAuthors = new Map<string, { name: string; initials: string }>();
  const caRel = relByType(presRels, '/commentAuthors')[0];
  if (caRel) {
    const ca = await pkg.xml(caRel.target);
    for (const a of kids(ca, 'cmAuthor')) commentAuthors.set(a.a.id, { name: a.a.name ?? 'Author', initials: a.a.initials ?? '' });
  }
  const modernAuthors = new Map<string, string>();
  const maRel = relByType(presRels, '/authors')[0];
  if (maRel) {
    const ma = await pkg.xml(maRel.target);
    for (const a of kids(ma, 'author')) modernAuthors.set(a.a.id, a.a.name ?? 'Author');
  }

  for (const sid of slideIds) {
    const rel = presRels.get(sid.a['r:id']);
    if (!rel) continue;
    try {
      const sRels = await pkg.rels(rel.target);
      const layRel = relByType(sRels, '/slideLayout')[0];
      const layout = (layRel && layoutByPath.get(layRel.target)) ?? layouts[0];
      const master = masters.find((m) => m.id === layout.masterId)!;
      const theme = themeByMaster.get(master.id)!;
      const phs = layoutParents.get(layout.id) ?? [];
      const sRoot = await pkg.xml(rel.target);
      const ovr = xpath(sRoot, 'clrMapOvr', 'overrideClrMapping');
      const map = ovr ? { bg1: ovr.a.bg1, tx1: ovr.a.tx1, bg2: ovr.a.bg2, tx2: ovr.a.tx2 } : undefined;
      const ids = new Map<string, string>();
      const baseFor = (type: string) => (masterKind(type) === 'title' ? master.txStyles.title : masterKind(type) === 'body' ? master.txStyles.body : master.txStyles.other);
      const cx: Cx = { imp, part: rel.target, rels: sRels, theme, map: map && JSON.stringify(map) !== JSON.stringify(master.clrMap) ? map : undefined };
      const bgNode = xpath(sRoot, 'cSld', 'bg');
      const bgFill = (bgNode ? bgOf(bgNode, cx) : undefined) ?? layout.bg ?? master.bg;
      const elements = await imp.spTree(xpath(sRoot, 'cSld', 'spTree'), cx, { lookup: (ph) => findLayoutPh(phs, ph), txBase: baseFor, ids, bgFill });
      const slide: Slide = { id: uid('s'), layoutId: layout.id, elements };
      if (bgNode) slide.bg = bgOf(bgNode, cx);
      if (sRoot?.a.showMasterSp === '0') slide.showMaster = false;
      if (sRoot?.a.show === '0') slide.hidden = true;
      const tr = transitionOf(sRoot);
      if (tr && tr.type !== 'none') slide.transition = tr;
      const an = animsOf(sRoot, ids);
      if (an.length) slide.anims = an;
      const sec = sectionOf.get(sid.a.id);
      if (sec) slide.section = sec;
      imp.slideIdByPath.set(rel.target, slide.id);

      // notes
      const noteRel = relByType(sRels, '/notesSlide')[0];
      if (noteRel) {
        const nRoot = await pkg.xml(noteRel.target);
        const ncx: Cx = { imp, part: noteRel.target, rels: await pkg.rels(noteRel.target), theme };
        for (const sp of descendants(xpath(nRoot, 'cSld', 'spTree'), 'sp')) {
          const ph = xpath(sp, 'nvSpPr', 'nvPr', 'ph');
          if (ph?.a.type === 'body') {
            const paras = parasOf(kid(sp, 'txBody'), ncx).map((p) => ({ runs: p.runs.map((r) => ({ t: r.t, ...(r.br ? { br: true } : {}) })) }));
            if (paras.some((p) => p.runs.length)) slide.notes = paras;
          }
        }
      }

      // comments
      const comments: SlideComment[] = [];
      for (const cr of relByType(sRels, '/comments')) {
        const cRoot = await pkg.xml(cr.target);
        for (const cm of kids(cRoot, 'cm')) {
          const au = commentAuthors.get(cm.a.authorId ?? '');
          const pos = kid(cm, 'pos');
          comments.push({ id: uid('c'), author: au?.name ?? 'Author', text: textOf(kid(cm, 'text')), date: cm.a.dt ?? '', x: pos ? numAttr(pos, 'x') : undefined, y: pos ? numAttr(pos, 'y') : undefined });
        }
      }
      for (const cr of [...sRels.values()].filter((r) => /modernComment/i.test(r.type) || /modernComment_/i.test(r.target))) {
        const cRoot = await pkg.xml(cr.target);
        for (const cm of descendants(cRoot, 'cm')) {
          const text = descendants(cm, 'p').map(textOf).join('\n') || textOf(kid(cm, 'txBody'));
          comments.push({ id: uid('c'), author: modernAuthors.get(cm.a.authorId ?? '') ?? 'Author', text, date: cm.a.created ?? '' });
        }
      }
      if (comments.length) slide.comments = comments;
      slides.push(slide);
    } catch (e) {
      imp.warn(`Slide ${slides.length + 1} could not be read completely: ${(e as Error).message}`);
      slides.push({ id: uid('s'), layoutId: layouts[0].id, elements: [] });
    }
  }

  // internal hyperlinks: "#slide:<part path>" -> "slide:<id>"
  const fix = (els: El[]) => {
    for (const e of els) {
      if (e.link?.startsWith('#slide:')) {
        const id = imp.slideIdByPath.get(e.link.slice(7));
        e.link = id ? `slide:${id}` : undefined;
      }
      if (e.type === 'shape' && e.text) for (const p of e.text.paras) for (const r of p.runs) if (r.link?.startsWith('#slide:')) {
        const id = imp.slideIdByPath.get(r.link.slice(7));
        if (id) r.link = `slide:${id}`;
        else delete r.link;
      }
      if (e.type === 'group') fix(e.children);
    }
  };
  slides.forEach((s) => fix(s.elements));

  const pres: Pres = {
    version: 1,
    title,
    author: creator,
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    size,
    masters,
    layouts,
    slides,
    defaultText: imp.defaultText,
  };
  const fsn = numAttr(pres0, 'firstSlideNum');
  if (fsn !== undefined && fsn !== 1) pres.firstSlideNumber = fsn;
  if (!slides.length) slides.push({ id: uid('s'), layoutId: layouts[0].id, elements: [] });
  return { pres, media: imp.media, warnings: imp.warnings };
}

// ---------------------------------------------------------------------------
function findMasterPh(list: ParentSp[], ph: { type: string; idx?: number }): ParentSp | undefined {
  const kind = masterKind(ph.type);
  return list.find((p) => masterKind(p.type) === kind && (kind === 'body' ? true : true));
}

function findLayoutPh(list: ParentSp[], ph: { type: string; idx?: number }): ParentSp | undefined {
  if (ph.idx !== undefined) {
    const byIdx = list.find((p) => p.idx === ph.idx && (p.type === ph.type || masterKind(p.type) === masterKind(ph.type)));
    if (byIdx) return byIdx;
    const idxOnly = list.find((p) => p.idx === ph.idx && ph.idx !== 0);
    if (idxOnly) return idxOnly;
  }
  const norm = (t: string) => (t === 'ctrTitle' ? 'title' : t);
  return list.find((p) => norm(p.type) === norm(ph.type)) ?? list.find((p) => masterKind(p.type) === masterKind(ph.type));
}

function bgOf(bg: XNode | undefined, cx: Cx): Fill | undefined {
  if (!bg) return undefined;
  const pr = kid(bg, 'bgPr');
  if (pr) return fillOf(pr, cx);
  const ref = kid(bg, 'bgRef');
  if (ref) {
    const idx = numAttr(ref, 'idx') ?? 0;
    const ph = colorOf(ref, cx);
    const node = cx.theme.bgFills[idx - 1001];
    if (node) return fillOf({ n: 'x', a: {}, t: '', c: [node] }, cx, ph);
    if (ph) return { t: 'solid', c: ph };
  }
  return undefined;
}

function parseTableStyle(s: XNode): TableStyleDef | undefined {
  const id = s.a.styleId;
  if (!id) return undefined;
  const parts: TableStyleDef['parts'] = {};
  const cx0 = { theme: parseTheme(undefined), imp: undefined as unknown as Importer, part: '', rels: new Map() } as Cx;
  const names: [string, PartName][] = [['wholeTbl', 'wholeTbl'], ['band1H', 'band1H'], ['band2H', 'band2H'], ['band1V', 'band1V'], ['band2V', 'band2V'], ['lastCol', 'lastCol'], ['firstCol', 'firstCol'], ['lastRow', 'lastRow'], ['seCell', 'seCell'], ['swCell', 'swCell'], ['firstRow', 'firstRow'], ['neCell', 'neCell'], ['nwCell', 'nwCell']];
  for (const [tag, part] of names) {
    const n = kid(s, tag);
    if (!n) continue;
    const out: TsPart = {};
    const txs = kid(n, 'tcTxStyle');
    if (txs) {
      if (txs.a.b) out.b = txs.a.b === 'on';
      if (txs.a.i) out.i = txs.a.i === 'on';
      const col = colorOf(txs, cx0) ?? colorOf(kid(txs, 'fontRef'), cx0);
      if (col) out.color = col;
    }
    const tcs = kid(n, 'tcStyle');
    if (tcs) {
      const bd = kid(tcs, 'tcBdr');
      if (bd) {
        const b: TsBorders = {};
        for (const [t, k] of [['left', 'l'], ['right', 'r'], ['top', 't'], ['bottom', 'b'], ['insideH', 'insideH'], ['insideV', 'insideV']] as const) {
          const side = kid(bd, t);
          if (!side) continue;
          const ln = kid(side, 'ln');
          if (!ln) continue;
          const l = lineOf(ln, cx0);
          b[k] = l && l.c ? l : null;
        }
        out.borders = b;
      }
      const fillNode = kid(tcs, 'fill');
      if (fillNode) {
        const f = fillOf(fillNode, cx0);
        out.fill = f && f.t !== 'none' ? f : null;
      }
    }
    parts[part] = out;
  }
  return { id, name: s.a.styleName ?? id, group: 'Document', parts };
}

void TABLE_STYLES;
