// PowerPoint (.pptx / .ppsx / .potx) exporter. Writes a complete Open XML package by hand: theme, masters,
// layouts, slides (shapes, pictures, tables, charts, media, groups), notes, comments, transitions and animations.
// Every shape is written with explicit geometry and text styling, so it looks the same without relying on
// inheritance. The text styles are also kept in the masters, so editing the file in PowerPoint still works.
import JSZip from 'jszip';
import { LINE_PRESETS } from './geometry';
import { EXT_BY_MIME } from './media';
import {
  type Anim,
  type Bullet,
  type ChartEl,
  type Color,
  type Deck,
  type El,
  type Fill,
  type Geom,
  type GroupEl,
  type Layout,
  type Line,
  type LstLevel,
  type Master,
  type MediaEl,
  type Para,
  type PictureEl,
  type Pres,
  type Run,
  type RunProps,
  type ShapeEl,
  type Slide,
  type Spacing,
  type TableEl,
  type TextBody,
  type ThemeColor,
  type Transition,
} from './model';
import { effRun } from './text';
import { tableStyleGuid } from './tablestyles';
import { xmlEsc as esc } from './xml';

const EMU = 12700;
const emu = (pt: number) => Math.round(pt * EMU);

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const CT = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml',
  potx: 'application/vnd.openxmlformats-officedocument.presentationml.template.main+xml',
};

// ---------------------------------------------------------------------------
// Parts & relationships
// ---------------------------------------------------------------------------
interface RelDef {
  id: string;
  type: string;
  target: string;
  external?: boolean;
}
class Part {
  rels: RelDef[] = [];
  constructor(readonly path: string) {}
  add(type: string, target: string, external = false): string {
    const found = this.rels.find((r) => r.type === type && r.target === target && !!r.external === external);
    if (found) return found.id;
    const id = `rId${this.rels.length + 1}`;
    this.rels.push({ id, type, target, external });
    return id;
  }
  relsXml(): string {
    return `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${this.rels
      .map((r) => `<Relationship Id="${r.id}" Type="${r.type.startsWith('http') ? r.type : `${REL}/${r.type}`}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`)
      .join('')}</Relationships>`;
  }
  relsPath(): string {
    const i = this.path.lastIndexOf('/');
    return `${this.path.slice(0, i + 1)}_rels/${this.path.slice(i + 1)}.rels`;
  }
}

/** Relative path from one part to a target part ("../media/image1.png"). */
function relTarget(from: string, to: string): string {
  const f = from.split('/').slice(0, -1);
  const t = to.split('/');
  while (f.length && t.length > 1 && f[0] === t[0]) {
    f.shift();
    t.shift();
  }
  return [...f.map(() => '..'), ...t].join('/');
}

interface Ex {
  deck: Deck;
  zip: JSZip;
  overrides: { part: string; type: string }[];
  defaults: Map<string, string>;
  mediaPaths: Map<string, string>;
  chartCount: number;
  embedCount: number;
  slideParts: Map<string, string>;
}

function addMedia(ex: Ex, part: Part, id: string): string | undefined {
  const item = ex.deck.media.get(id);
  if (!item) return undefined;
  let path = ex.mediaPaths.get(id);
  if (!path) {
    const ext = EXT_BY_MIME[item.mime] ?? (item.name.split('.').pop() ?? 'bin').toLowerCase();
    path = `ppt/media/media${ex.mediaPaths.size + 1}.${ext}`;
    ex.mediaPaths.set(id, path);
    ex.zip.file(path, item.data);
    ex.defaults.set(ext, item.mime);
  }
  return part.add(item.mime.startsWith('video/') ? 'video' : item.mime.startsWith('audio/') ? 'audio' : 'image', relTarget(part.path, path));
}

// ---------------------------------------------------------------------------
// Colour, fill, line, effects
// ---------------------------------------------------------------------------
const SCHEME = new Set(['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink', 'tx1', 'bg1', 'tx2', 'bg2']);

function clr(c: Color | undefined | null): string {
  if (c == null) return '<a:srgbClr val="000000"/>';
  if (typeof c === 'string') {
    const hex = c.replace('#', '').padEnd(6, '0');
    const val = hex.slice(0, 6).toUpperCase();
    if (hex.length >= 8) return `<a:srgbClr val="${val}"><a:alpha val="${Math.round((parseInt(hex.slice(6, 8), 16) / 255) * 100000)}"/></a:srgbClr>`;
    return `<a:srgbClr val="${val}"/>`;
  }
  const t = c as ThemeColor;
  const mods = [
    t.tint !== undefined ? `<a:tint val="${Math.round(t.tint * 100000)}"/>` : '',
    t.shade !== undefined ? `<a:shade val="${Math.round(t.shade * 100000)}"/>` : '',
    t.lumMod !== undefined ? `<a:lumMod val="${Math.round(t.lumMod * 100000)}"/>` : '',
    t.lumOff !== undefined ? `<a:lumOff val="${Math.round(t.lumOff * 100000)}"/>` : '',
    t.alpha !== undefined ? `<a:alpha val="${Math.round(t.alpha * 100000)}"/>` : '',
  ].join('');
  const slot = SCHEME.has(t.theme) ? t.theme : 'tx1';
  return mods ? `<a:schemeClr val="${slot}">${mods}</a:schemeClr>` : `<a:schemeClr val="${slot}"/>`;
}

function fillXml(f: Fill | undefined, part: Part, ex: Ex): string {
  if (!f) return '';
  switch (f.t) {
    case 'none':
      return '<a:noFill/>';
    case 'solid':
      return `<a:solidFill>${clr(f.c)}</a:solidFill>`;
    case 'grad': {
      const stops = [...f.stops].sort((a, b) => a.pos - b.pos).map((s) => `<a:gs pos="${Math.round(s.pos * 100000)}">${clr(s.c)}</a:gs>`).join('');
      const shade = f.kind === 'radial' || f.kind === 'path' || f.kind === 'rect' ? `<a:path path="${f.kind === 'rect' ? 'rect' : 'circle'}"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path>` : `<a:lin ang="${Math.round((((f.ang % 360) + 360) % 360) * 60000)}" scaled="0"/>`;
      return `<a:gradFill rotWithShape="1"><a:gsLst>${stops}</a:gsLst>${shade}</a:gradFill>`;
    }
    case 'pic': {
      const id = addMedia(ex, part, f.media);
      return id ? `<a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="${id}"/><a:srcRect/>${f.tile ? '<a:tile tx="0" ty="0" sx="100000" sy="100000" flip="none" algn="tl"/>' : '<a:stretch><a:fillRect/></a:stretch>'}</a:blipFill>` : '<a:noFill/>';
    }
    case 'pattern':
      return `<a:pattFill prst="${esc(f.prst)}"><a:fgClr>${clr(f.fg)}</a:fgClr><a:bgClr>${clr(f.bg)}</a:bgClr></a:pattFill>`;
  }
}

function arrowXml(tag: 'headEnd' | 'tailEnd', a: Line['head']): string {
  return a ? `<a:${tag} type="${a.type === 'arrow' ? 'arrow' : a.type}" w="${a.w ?? 'med'}" len="${a.len ?? 'med'}"/>` : '';
}

function lineXml(l: Line | undefined, part: Part, ex: Ex, tag = 'ln'): string {
  if (!l) return '';
  if (l.c == null || !(l.w > 0)) return `<a:${tag}><a:noFill/></a:${tag}>`;
  const cap = l.cap === 'round' ? 'rnd' : l.cap === 'square' ? 'sq' : 'flat';
  const fill = l.grad ? fillXml(l.grad, part, ex) : `<a:solidFill>${clr(l.c)}</a:solidFill>`;
  const join = l.join === 'round' ? '<a:round/>' : l.join === 'bevel' ? '<a:bevel/>' : l.join === 'miter' ? '<a:miter lim="800000"/>' : '';
  return `<a:${tag} w="${emu(l.w)}" cap="${cap}" cmpd="sng">${fill}<a:prstDash val="${l.dash ?? 'solid'}"/>${join}${arrowXml('headEnd', l.head)}${arrowXml('tailEnd', l.tail)}</a:${tag}>`;
}

function effectXml(fx: { shadow?: any; glow?: any; softEdge?: number } | undefined): string {
  if (!fx || (!fx.shadow && !fx.glow && !fx.softEdge)) return '';
  const glow = fx.glow ? `<a:glow rad="${emu(fx.glow.r)}">${clr(fx.glow.c)}</a:glow>` : '';
  let sh = '';
  if (fx.shadow) {
    const s = fx.shadow;
    const color = typeof s.c === 'string' ? s.c.slice(0, 7) : s.c;
    const inner = typeof color === 'string' ? `<a:srgbClr val="${color.replace('#', '').toUpperCase()}"><a:alpha val="${Math.round((s.alpha ?? 0.4) * 100000)}"/></a:srgbClr>` : clr({ ...(color as ThemeColor), alpha: s.alpha ?? 0.4 });
    sh = `<a:outerShdw blurRad="${emu(s.blur)}" dist="${emu(s.dist)}" dir="${Math.round(s.dir * 60000)}" algn="ctr" rotWithShape="0">${inner}</a:outerShdw>`;
  }
  const soft = fx.softEdge ? `<a:softEdge rad="${emu(fx.softEdge)}"/>` : '';
  return `<a:effectLst>${glow}${sh}${soft}</a:effectLst>`;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------
function arcParams(x0: number, y0: number, rx: number, ry: number, large: number, sweep: number, x: number, y: number) {
  if (rx === 0 || ry === 0) return { wR: rx, hR: ry, st: 0, sw: 0 };
  const dx2 = (x0 - x) / 2;
  const dy2 = (y0 - y) / 2;
  let lambda = (dx2 * dx2) / (rx * rx) + (dy2 * dy2) / (ry * ry);
  if (lambda > 1) {
    lambda = Math.sqrt(lambda);
    rx *= lambda;
    ry *= lambda;
  }
  const sign = large === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * dy2 * dy2 - ry * ry * dx2 * dx2;
  const den = rx * rx * dy2 * dy2 + ry * ry * dx2 * dx2;
  const coef = sign * Math.sqrt(Math.max(0, num / (den || 1)));
  const cxp = (coef * rx * dy2) / ry;
  const cyp = (-coef * ry * dx2) / rx;
  const t1 = Math.atan2((dy2 - cyp) / ry, (dx2 - cxp) / rx);
  const t2 = Math.atan2((-dy2 - cyp) / ry, (-dx2 - cxp) / rx);
  let d = t2 - t1;
  if (!sweep && d > 0) d -= 2 * Math.PI;
  if (sweep && d < 0) d += 2 * Math.PI;
  return { wR: rx, hR: ry, st: (t1 * 180) / Math.PI, sw: (d * 180) / Math.PI };
}

/** SVG path data (absolute M L C Q A Z) to OOXML path commands, in 1/100 units. */
function pathCommands(d: string, k: number): string {
  const re = /([MLCQAZ])([^MLCQAZ]*)/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  const P = (x: number, y: number) => `<a:pt x="${Math.round(x * k)}" y="${Math.round(y * k)}"/>`;
  while ((m = re.exec(d))) {
    const n = m[2].trim().length ? m[2].trim().split(/[\s,]+/).map(Number) : [];
    switch (m[1]) {
      case 'M':
        out.push(`<a:moveTo>${P(n[0], n[1])}</a:moveTo>`);
        cx = sx = n[0];
        cy = sy = n[1];
        break;
      case 'L':
        out.push(`<a:lnTo>${P(n[0], n[1])}</a:lnTo>`);
        cx = n[0];
        cy = n[1];
        break;
      case 'C':
        out.push(`<a:cubicBezTo>${P(n[0], n[1])}${P(n[2], n[3])}${P(n[4], n[5])}</a:cubicBezTo>`);
        cx = n[4];
        cy = n[5];
        break;
      case 'Q': {
        const c1x = cx + (2 / 3) * (n[0] - cx);
        const c1y = cy + (2 / 3) * (n[1] - cy);
        const c2x = n[2] + (2 / 3) * (n[0] - n[2]);
        const c2y = n[3] + (2 / 3) * (n[1] - n[3]);
        out.push(`<a:cubicBezTo>${P(c1x, c1y)}${P(c2x, c2y)}${P(n[2], n[3])}</a:cubicBezTo>`);
        cx = n[2];
        cy = n[3];
        break;
      }
      case 'A': {
        for (let i = 0; i + 6 < n.length + 0; i += 7) {
          const a = arcParams(cx, cy, n[i], n[i + 1], n[i + 3], n[i + 4], n[i + 5], n[i + 6]);
          out.push(`<a:arcTo wR="${Math.round(a.wR * k)}" hR="${Math.round(a.hR * k)}" stAng="${Math.round(a.st * 60000)}" swAng="${Math.round(a.sw * 60000)}"/>`);
          cx = n[i + 5];
          cy = n[i + 6];
        }
        break;
      }
      case 'Z':
        out.push('<a:close/>');
        cx = sx;
        cy = sy;
        break;
    }
  }
  return out.join('');
}

function geomXml(g: Geom | undefined): string {
  if (!g) return '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
  if ('cust' in g) {
    const paths = g.cust
      .map((p) => {
        const k = 100;
        const attrs = `w="${Math.round(p.w * k)}" h="${Math.round(p.h * k)}"${p.fill === false ? ' fill="none"' : ''}${p.stroke === false ? ' stroke="0"' : ''}`;
        return `<a:path ${attrs}>${pathCommands(p.d, k)}</a:path>`;
      })
      .join('');
    return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst>${paths}</a:pathLst></a:custGeom>`;
  }
  const av = g.adj ? Object.entries(g.adj).map(([n, v]) => `<a:gd name="${esc(n)}" fmla="val ${Math.round(v)}"/>`).join('') : '';
  return `<a:prstGeom prst="${esc(g.prst)}"><a:avLst>${av}</a:avLst></a:prstGeom>`;
}

function xfrmXml(e: { x: number; y: number; w: number; h: number; rot?: number; flipH?: boolean; flipV?: boolean }, tag = 'a:xfrm', extra = ''): string {
  const attrs = `${e.rot ? ` rot="${Math.round(e.rot * 60000)}"` : ''}${e.flipH ? ' flipH="1"' : ''}${e.flipV ? ' flipV="1"' : ''}`;
  return `<${tag}${attrs}><a:off x="${emu(e.x)}" y="${emu(e.y)}"/><a:ext cx="${emu(e.w)}" cy="${emu(e.h)}"/>${extra}</${tag}>`;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------
const fontRef = (f: string) => (f === '+mj' ? '+mj-lt' : f === '+mn' ? '+mn-lt' : f);

function spacingXml(tag: string, s: Spacing | undefined): string {
  if (!s) return '';
  return `<a:${tag}>${'pct' in s ? `<a:spcPct val="${Math.round(s.pct * 100000)}"/>` : `<a:spcPts val="${Math.round(s.pts * 100)}"/>`}</a:${tag}>`;
}

function bulletXml(bu: Bullet | undefined): string {
  if (!bu) return '';
  if (bu.t === 'none') return '<a:buNone/>';
  const color = bu.color ? `<a:buClr>${clr(bu.color)}</a:buClr>` : '';
  const size = bu.pct && bu.pct !== 1 ? `<a:buSzPct val="${Math.round(bu.pct * 100000)}"/>` : '';
  if (bu.t === 'char') return `${color}${size}${bu.font ? `<a:buFont typeface="${esc(bu.font)}"/>` : ''}<a:buChar char="${esc(bu.ch)}"/>`;
  return `${color}${size}<a:buFont typeface="+mj-lt"/><a:buAutoNum type="${esc(bu.scheme)}"${bu.start && bu.start !== 1 ? ` startAt="${bu.start}"` : ''}/>`;
}

function rPrXml(rp: RunProps, tag: string, part: Part, extra = '', ex?: Ex): string {
  const attrs: string[] = ['lang="en-US"'];
  if (rp.sz) attrs.push(`sz="${Math.round(rp.sz * 100)}"`);
  if (rp.b !== undefined) attrs.push(`b="${rp.b ? 1 : 0}"`);
  if (rp.i !== undefined) attrs.push(`i="${rp.i ? 1 : 0}"`);
  if (rp.u !== undefined) attrs.push(`u="${rp.u === false ? 'none' : rp.u === 'dbl' ? 'dbl' : rp.u === 'wavy' ? 'wavy' : rp.u === 'dotted' ? 'dotted' : rp.u === 'dash' ? 'dash' : 'sng'}"`);
  if (rp.strike !== undefined) attrs.push(`strike="${rp.strike ? 'sngStrike' : 'noStrike'}"`);
  if (rp.base) attrs.push(`baseline="${Math.round(rp.base * 1000)}"`);
  if (rp.cap) attrs.push(`cap="${rp.cap === 'all' ? 'all' : 'small'}"`);
  if (rp.spc) attrs.push(`spc="${Math.round(rp.spc * 100)}"`);
  attrs.push('dirty="0"');
  let kids = '';
  if (rp.color) kids += `<a:solidFill>${clr(rp.color)}</a:solidFill>`;
  if (rp.hl) kids += `<a:highlight>${clr(rp.hl)}</a:highlight>`;
  if (rp.font) kids += `<a:latin typeface="${esc(fontRef(rp.font))}"/>`;
  if (rp.link) kids += hlinkXml(rp.link, part, ex);
  kids += extra;
  return kids ? `<a:${tag} ${attrs.join(' ')}>${kids}</a:${tag}>` : `<a:${tag} ${attrs.join(' ')}/>`;
}

function hlinkXml(link: string, part: Part, ex?: Ex): string {
  if (link.startsWith('slide:')) {
    const target = ex?.slideParts.get(link.slice(6));
    if (!target) return '';
    const id = part.add('slide', relTarget(part.path, target));
    return `<a:hlinkClick r:id="${id}" action="ppaction://hlinksldjump"/>`;
  }
  const id = part.add('hyperlink', link, true);
  return `<a:hlinkClick r:id="${id}"/>`;
}

function pPrAttrs(p: LstLevel & { level?: number }): string {
  const a: string[] = [];
  if (p.marL !== undefined) a.push(`marL="${emu(p.marL)}"`);
  if (p.indent !== undefined) a.push(`indent="${emu(p.indent)}"`);
  if (p.level) a.push(`lvl="${p.level}"`);
  if (p.algn) a.push(`algn="${p.algn}"`);
  if (p.rtl) a.push('rtl="1"');
  return a.length ? ' ' + a.join(' ') : '';
}

function pPrKids(p: LstLevel): string {
  return spacingXml('lnSpc', p.lnSpc) + spacingXml('spcBef', p.spcBef) + spacingXml('spcAft', p.spcAft) + bulletXml(p.bu);
}

export function lstXml(lst: LstLevel[] | undefined, part: Part, tag = 'a:lstStyle', ex?: Ex): string {
  if (!lst) return `<${tag}/>`;
  let out = '';
  lst.forEach((l, i) => {
    if (!l) return;
    const { sz, b, i: it, u, strike, color, font, hl, base, cap, spc, lang, link, ...pp } = l as LstLevel & RunProps;
    const rp: RunProps = { sz, b, i: it, u, strike, color, font, hl, base, cap, spc, lang, link };
    const hasR = Object.values(rp).some((v) => v !== undefined);
    const hasP = Object.values(pp).some((v) => v !== undefined);
    if (!hasR && !hasP) return;
    out += `<a:lvl${i + 1}pPr${pPrAttrs(pp)}>${pPrKids(pp)}${hasR ? rPrXml(rp, 'defRPr', part, '', ex) : ''}</a:lvl${i + 1}pPr>`;
  });
  return out ? `<${tag}>${out}</${tag}>` : `<${tag}/>`;
}

function runXml(r: Run, part: Part, ex: Ex | undefined, bake?: (r: Run) => RunProps): string {
  const rp: RunProps = bake ? bake(r) : { sz: r.sz, b: r.b, i: r.i, u: r.u, strike: r.strike, color: r.color, font: r.font, hl: r.hl, base: r.base, cap: r.cap, spc: r.spc, link: r.link };
  const clean: RunProps = {};
  for (const [k, v] of Object.entries(rp)) if (v !== undefined) (clean as any)[k] = v;
  if (r.br) return `<a:br>${rPrXml(clean, 'rPr', part, '', ex)}</a:br>`;
  if (r.field) {
    const type = r.field === 'slidenum' ? 'slidenum' : r.field === 'datetime' ? 'datetime1' : 'slidenum';
    return `<a:fld id="{${guid(r.field)}}" type="${type}">${rPrXml(clean, 'rPr', part, '', ex)}<a:t>${esc(r.t || (r.field === 'slidenum' ? '‹#›' : ''))}</a:t></a:fld>`;
  }
  if (!r.t) return '';
  return `<a:r>${rPrXml(clean, 'rPr', part, '', ex)}<a:t>${esc(r.t)}</a:t></a:r>`;
}

function guid(seed: string): string {
  let h = 0;
  for (const c of seed) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  const hex = (n: number, len: number) => Math.abs(n * 2654435761 | 0).toString(16).toUpperCase().padStart(len, '0').slice(0, len);
  return `${hex(h, 8)}-${hex(h + 1, 4)}-${hex(h + 2, 4)}-${hex(h + 3, 4)}-${hex(h + 4, 12)}`;
}

function parasXml(paras: Para[], part: Part, ex: Ex | undefined, tb?: TextBody, bake = false): string {
  return paras
    .map((p) => {
      const pp: LstLevel & { level?: number } = { algn: p.algn, marL: p.marL, indent: p.indent, lnSpc: p.lnSpc, spcBef: p.spcBef, spcAft: p.spcAft, bu: p.bu, rtl: p.rtl, level: p.level };
      const bakeFn = bake && tb ? (r: Run): RunProps => ({ ...effRun(tb, p, r), link: r.link }) : undefined;
      const runs = p.runs.map((r) => runXml(r, part, ex, bakeFn)).join('');
      const endRp: RunProps = { ...(p.end ?? {}) };
      if (bake && tb && !p.runs.length) Object.assign(endRp, effRun(tb, p, p.end));
      const end = rPrXml(endRp, 'endParaRPr', part, '', ex);
      const attrs = pPrAttrs(pp);
      const kids = pPrKids(pp);
      return `<a:p>${attrs || kids ? `<a:pPr${attrs}>${kids}</a:pPr>` : ''}${runs}${end}</a:p>`;
    })
    .join('');
}

function bodyPrXml(tb: TextBody): string {
  const a: string[] = [];
  const ins = tb.insets ?? [7.2, 3.6, 7.2, 3.6];
  a.push(`lIns="${emu(ins[0])}" tIns="${emu(ins[1])}" rIns="${emu(ins[2])}" bIns="${emu(ins[3])}"`);
  a.push(`wrap="${tb.wrap === false ? 'none' : 'square'}"`);
  a.push('rtlCol="0"');
  if (tb.anchor) a.push(`anchor="${tb.anchor}"`);
  if (tb.anchorCtr) a.push('anchorCtr="1"');
  if (tb.vert && tb.vert !== 'horz') a.push(`vert="${tb.vert}"`);
  if (tb.cols && tb.cols > 1) a.push(`numCol="${tb.cols}"${tb.colGap ? ` spcCol="${emu(tb.colGap)}"` : ''}`);
  const fit =
    tb.autofit === 'shrink'
      ? `<a:normAutofit${tb.fontScale ? ` fontScale="${Math.round(tb.fontScale * 100000)}"` : ''}${tb.lnSpcReduction ? ` lnSpcReduction="${Math.round(tb.lnSpcReduction * 100000)}"` : ''}/>`
      : tb.autofit === 'shape'
        ? '<a:spAutoFit/>'
        : '<a:noAutofit/>';
  return `<a:bodyPr ${a.join(' ')}>${fit}</a:bodyPr>`;
}

function txBodyXml(tb: TextBody, part: Part, ex: Ex | undefined, tag = 'p:txBody'): string {
  return `<${tag}>${bodyPrXml(tb)}${lstXml(tb.lst, part, 'a:lstStyle', ex)}${parasXml(tb.paras.length ? tb.paras : [{ runs: [] }], part, ex)}</${tag}>`;
}

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------
interface SlideCtx {
  part: Part;
  ex: Ex;
  next: () => number;
  /** element id -> shape id (for animations) */
  ids: Map<string, number>;
}

function phXml(ph: ShapeEl['ph']): string {
  if (!ph) return '';
  const type = ph.type === 'obj' ? '' : ` type="${ph.type}"`;
  const idx = ph.idx !== undefined ? ` idx="${ph.idx}"` : '';
  const size = ph.type === 'body' && ph.idx === undefined ? '' : '';
  return `<p:ph${type}${idx}${size}/>`;
}

function cNvPr(el: El, c: SlideCtx, id: number, extraInner = ''): string {
  const link = el.link ? hlinkXml(el.link, c.part, c.ex) : '';
  const alt = el.alt ? ` descr="${esc(el.alt)}"` : '';
  const inner = link + extraInner;
  return inner ? `<p:cNvPr id="${id}" name="${esc(el.name)}"${alt}>${inner}</p:cNvPr>` : `<p:cNvPr id="${id}" name="${esc(el.name)}"${alt}/>`;
}

function shapeXml(el: ShapeEl, c: SlideCtx): string {
  const id = c.next();
  c.ids.set(el.id, id);
  const isLine = 'prst' in el.geom && LINE_PRESETS.has(el.geom.prst);
  const fill = isLine ? '' : fillXml(el.fill ?? { t: 'none' }, c.part, c.ex);
  const ln = lineXml(el.line ?? (isLine ? undefined : { c: null, w: 0 }), c.part, c.ex);
  const fx = effectXml(el.fx);
  const spPr = `<p:spPr>${xfrmXml(el)}${geomXml(el.geom)}${fill}${ln}${fx}</p:spPr>`;
  if (isLine) {
    return `<p:cxnSp><p:nvCxnSpPr>${cNvPr(el, c, id)}<p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>${spPr}</p:cxnSp>`;
  }
  const locks = el.ph ? '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>' : el.txBox ? '<p:cNvSpPr txBox="1"/>' : '<p:cNvSpPr/>';
  const text = el.text ? txBodyXml(el.text, c.part, c.ex) : '';
  return `<p:sp><p:nvSpPr>${cNvPr(el, c, id)}${locks}<p:nvPr>${phXml(el.ph)}</p:nvPr></p:nvSpPr>${spPr}${text}</p:sp>`;
}

function pictureXml(el: PictureEl, c: SlideCtx): string {
  const id = c.next();
  c.ids.set(el.id, id);
  const rid = addMedia(c.ex, c.part, el.media);
  if (!rid) return '';
  const cr = el.crop;
  const src = cr ? `<a:srcRect l="${Math.round(cr.l * 100000)}" t="${Math.round(cr.t * 100000)}" r="${Math.round(cr.r * 100000)}" b="${Math.round(cr.b * 100000)}"/>` : '';
  const blipKids = (el.alpha != null && el.alpha < 1 ? `<a:alphaModFix amt="${Math.round(el.alpha * 100000)}"/>` : '') + (el.gray ? '<a:grayscl/>' : '') + (el.brightness || el.contrast ? `<a:lum bright="${Math.round((el.brightness ?? 0) * 100000)}" contrast="${Math.round((el.contrast ?? 0) * 100000)}"/>` : '');
  const blip = blipKids ? `<a:blip r:embed="${rid}">${blipKids}</a:blip>` : `<a:blip r:embed="${rid}"/>`;
  return `<p:pic><p:nvPicPr>${cNvPr(el, c, id)}<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill>${blip}${src}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrmXml(el)}${geomXml(el.geom)}${lineXml(el.line, c.part, c.ex)}${effectXml(el.fx)}</p:spPr></p:pic>`;
}

function tableXml(el: TableEl, c: SlideCtx): string {
  const id = c.next();
  c.ids.set(el.id, id);
  const st = el.style;
  const flags = `${st.firstRow ? ' firstRow="1"' : ''}${st.lastRow ? ' lastRow="1"' : ''}${st.firstCol ? ' firstCol="1"' : ''}${st.lastCol ? ' lastCol="1"' : ''}${st.bandRow ? ' bandRow="1"' : ''}${st.bandCol ? ' bandCol="1"' : ''}`;
  const grid = el.cols.map((w) => `<a:gridCol w="${emu(w)}"/>`).join('');
  const rows = el.rows
    .map((row) => {
      const cells = row.cells
        .map((cell) => {
          const m = cell.margins ?? [7.2, 3.6, 7.2, 3.6];
          const side = (tag: string, ln: Line | undefined) => (ln && ln.c ? lineXml(ln, c.part, c.ex, tag) : `<a:${tag} w="0"><a:noFill/></a:${tag}>`);
          const b = cell.borders ?? {};
          const tcPr = `<a:tcPr marL="${emu(m[0])}" marR="${emu(m[2])}" marT="${emu(m[1])}" marB="${emu(m[3])}"${cell.anchor ? ` anchor="${cell.anchor}"` : ''}>${side('lnL', b.l)}${side('lnR', b.r)}${side('lnT', b.t)}${side('lnB', b.b)}${cell.fill ? fillXml(cell.fill, c.part, c.ex) : '<a:noFill/>'}</a:tcPr>`;
          const attrs = `${cell.gridSpan && cell.gridSpan > 1 ? ` gridSpan="${cell.gridSpan}"` : ''}${cell.rowSpan && cell.rowSpan > 1 ? ` rowSpan="${cell.rowSpan}"` : ''}${cell.hMerge ? ' hMerge="1"' : ''}${cell.vMerge ? ' vMerge="1"' : ''}`;
          const body = `<a:txBody><a:bodyPr/><a:lstStyle/>${parasXml(cell.text.paras.length ? cell.text.paras : [{ runs: [] }], c.part, c.ex, cell.text, true)}</a:txBody>`;
          return `<a:tc${attrs}>${body}${tcPr}</a:tc>`;
        })
        .join('');
      return `<a:tr h="${emu(row.h)}">${cells}</a:tr>`;
    })
    .join('');
  return `<p:graphicFrame><p:nvGraphicFramePr>${cNvPr(el, c, id)}<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>${xfrmXml(el, 'p:xfrm')}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr${flags}><a:tableStyleId>${tableStyleGuid(st.id)}</a:tableStyleId></a:tblPr><a:tblGrid>${grid}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

function groupXml(el: GroupEl, c: SlideCtx): string {
  const id = c.next();
  c.ids.set(el.id, id);
  const kids = el.children.map((k) => elementXml(k, c)).join('');
  return `<p:grpSp><p:nvGrpSpPr>${cNvPr(el, c, id)}<p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr>${xfrmXml(el, 'a:xfrm', `<a:chOff x="0" y="0"/><a:chExt cx="${emu(el.cw)}" cy="${emu(el.ch)}"/>`)}</p:grpSpPr>${kids}</p:grpSp>`;
}

// a 2x2 transparent PNG used as the poster of media objects
const BLANK_PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (ch) => ch.charCodeAt(0));

function mediaXml(el: MediaEl, c: SlideCtx): string {
  const id = c.next();
  c.ids.set(el.id, id);
  const item = c.ex.deck.media.get(el.media);
  if (!item) return '';
  const rid = addMedia(c.ex, c.part, el.media);
  if (!rid) return '';
  const mediaRel = c.part.add('http://schemas.microsoft.com/office/2007/relationships/media', relTarget(c.part.path, c.ex.mediaPaths.get(el.media)!));
  let posterRid: string;
  if (el.poster && addMedia(c.ex, c.part, el.poster)) posterRid = addMedia(c.ex, c.part, el.poster)!;
  else {
    let path = c.ex.mediaPaths.get('__blank');
    if (!path) {
      path = 'ppt/media/blank-poster.png';
      c.ex.mediaPaths.set('__blank', path);
      c.ex.zip.file(path, BLANK_PNG);
      c.ex.defaults.set('png', 'image/png');
    }
    posterRid = c.part.add('image', relTarget(c.part.path, path));
  }
  const file = el.kind === 'audio' ? `<a:audioFile r:link="${rid}"/>` : `<a:videoFile r:link="${rid}"/>`;
  return `<p:pic><p:nvPicPr>${cNvPr(el, c, id)}<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr>${file}<p:extLst><p:ext uri="{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}"><p14:media xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" r:embed="${mediaRel}"/></p:ext></p:extLst></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="${posterRid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrmXml(el)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

function chartFrameXml(el: ChartEl, c: SlideCtx): string {
  const id = c.next();
  c.ids.set(el.id, id);
  const n = ++c.ex.chartCount;
  const chartPath = `ppt/charts/chart${n}.xml`;
  const chartPart = new Part(chartPath);
  const wbPath = `ppt/embeddings/Microsoft_Excel_Sheet${++c.ex.embedCount}.xlsx`;
  chartPart.add('package', relTarget(chartPath, wbPath));
  c.ex.zip.file(chartPath, chartXml(el, 'rId1'));
  c.ex.zip.file(chartPart.relsPath(), chartPart.relsXml());
  c.ex.overrides.push({ part: chartPath, type: 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml' });
  c.ex.defaults.set('xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  pendingWorkbooks.push({ path: wbPath, zip: workbookZip(el) });
  const rid = c.part.add('chart', relTarget(c.part.path, chartPath));
  return `<p:graphicFrame><p:nvGraphicFramePr>${cNvPr(el, c, id)}<p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>${xfrmXml(el, 'p:xfrm')}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${rid}"/></a:graphicData></a:graphic></p:graphicFrame>`;
}

export function elementXml(el: El, c: SlideCtx): string {
  if (el.hidden && el.type !== 'shape') return '';
  switch (el.type) {
    case 'shape':
      return shapeXml(el, c);
    case 'picture':
      return pictureXml(el, c);
    case 'table':
      return tableXml(el, c);
    case 'group':
      return groupXml(el, c);
    case 'media':
      return mediaXml(el, c);
    case 'chart':
      return chartFrameXml(el, c);
  }
}

// ---------------------------------------------------------------------------
// Charts (chart part + embedded workbook so "Edit Data" works in PowerPoint)
// ---------------------------------------------------------------------------
const colLetter = (i: number) => String.fromCharCode(65 + i);

function chartXml(el: ChartEl, extRid: string): string {
  const cats = el.cats;
  const strCache = (vals: string[]) => `<c:strCache><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('')}</c:strCache>`;
  const numCache = (vals: (number | null)[]) => `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${vals.length}"/>${vals.map((v, i) => (v == null ? '' : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join('')}</c:numCache>`;
  const n = cats.length;
  const sers = el.series
    .map((s, i) => {
      const col = colLetter(i + 1);
      const color = s.color ? `<c:spPr><a:solidFill>${clr(s.color)}</a:solidFill></c:spPr>` : `<c:spPr><a:solidFill><a:schemeClr val="accent${(i % 6) + 1}"/></a:solidFill></c:spPr>`;
      const tx = `<c:tx><c:strRef><c:f>Sheet1!$${col}$1</c:f>${strCache([s.name])}</c:strRef></c:tx>`;
      const cat = `<c:cat><c:strRef><c:f>Sheet1!$A$2:$A$${n + 1}</c:f>${strCache(cats)}</c:strRef></c:cat>`;
      const val = `<c:val><c:numRef><c:f>Sheet1!$${col}$2:$${col}$${n + 1}</c:f>${numCache(s.values)}</c:numRef></c:val>`;
      if (el.kind === 'scatter') {
        const xs = s.x ?? s.values.map((_, k) => k + 1);
        return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx}<c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="7"/><c:spPr><a:solidFill><a:schemeClr val="accent${(i % 6) + 1}"/></a:solidFill></c:spPr></c:marker><c:xVal><c:numRef><c:f>Sheet1!$A$2:$A$${n + 1}</c:f>${numCache(xs)}</c:numRef></c:xVal><c:yVal><c:numRef><c:f>Sheet1!$${col}$2:$${col}$${n + 1}</c:f>${numCache(s.values)}</c:numRef></c:yVal><c:smooth val="0"/></c:ser>`;
      }
      const isPie = el.kind === 'pie' || el.kind === 'doughnut';
      const dpts = isPie ? cats.map((_, k) => `<c:dPt><c:idx val="${k}"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:schemeClr val="accent${(k % 6) + 1}"/></a:solidFill></c:spPr></c:dPt>`).join('') : '';
      const labels = el.labels ? `<c:dLbls><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>` : '';
      const line = el.kind === 'line' ? `<c:spPr><a:ln w="28575" cap="rnd"><a:solidFill>${s.color ? clr(s.color) : `<a:schemeClr val="accent${(i % 6) + 1}"/>`}</a:solidFill><a:round/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>` : color;
      const body = el.kind === 'line' ? `${line}${labels}${cat}${val}<c:smooth val="${el.smooth ? 1 : 0}"/>` : `${line}${isPie ? '' : '<c:invertIfNegative val="0"/>'}${dpts}${labels}${cat}${val}`;
      return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx}${body}</c:ser>`.replace('<c:invertIfNegative val="0"/>', el.kind === 'col' || el.kind === 'bar' || el.kind === 'colStacked' || el.kind === 'barStacked' ? '<c:invertIfNegative val="0"/>' : '');
    })
    .join('');
  let plot: string;
  const ax = '<c:axId val="111111111"/><c:axId val="222222222"/>';
  switch (el.kind) {
    case 'pie':
      plot = `<c:pieChart><c:varyColors val="1"/>${sers}<c:firstSliceAng val="0"/></c:pieChart>`;
      break;
    case 'doughnut':
      plot = `<c:doughnutChart><c:varyColors val="1"/>${sers}<c:firstSliceAng val="0"/><c:holeSize val="55"/></c:doughnutChart>`;
      break;
    case 'line':
      plot = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${sers}<c:marker val="1"/>${ax}</c:lineChart>`;
      break;
    case 'area':
      plot = `<c:areaChart><c:grouping val="standard"/><c:varyColors val="0"/>${sers}${ax}</c:areaChart>`;
      break;
    case 'scatter':
      plot = `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${sers}${ax}</c:scatterChart>`;
      break;
    case 'radar':
      plot = `<c:radarChart><c:radarStyle val="marker"/><c:varyColors val="0"/>${sers}${ax}</c:radarChart>`;
      break;
    default: {
      const stacked = el.kind === 'colStacked' || el.kind === 'barStacked';
      const horiz = el.kind === 'bar' || el.kind === 'barStacked';
      plot = `<c:barChart><c:barDir val="${horiz ? 'bar' : 'col'}"/><c:grouping val="${stacked ? 'stacked' : 'clustered'}"/><c:varyColors val="0"/>${sers}<c:gapWidth val="150"/>${stacked ? '<c:overlap val="100"/>' : ''}${ax}</c:barChart>`;
    }
  }
  const noAxes = el.kind === 'pie' || el.kind === 'doughnut';
  const horiz = el.kind === 'bar' || el.kind === 'barStacked';
  const axes = noAxes
    ? ''
    : el.kind === 'scatter'
      ? `<c:valAx><c:axId val="111111111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="222222222"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx><c:valAx><c:axId val="222222222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>${el.grid === false ? '' : '<c:majorGridlines/>'}<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="111111111"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>`
      : `<c:catAx><c:axId val="111111111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${horiz ? 'l' : 'b'}"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="222222222"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx><c:valAx><c:axId val="222222222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${horiz ? 'b' : 'l'}"/>${el.grid === false ? '' : '<c:majorGridlines/>'}<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="111111111"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`;
  const title = el.title ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${esc(el.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>` : '<c:autoTitleDeleted val="1"/>';
  const legend = el.legend && el.legend !== 'none' ? `<c:legend><c:legendPos val="${el.legend}"/><c:overlay val="0"/></c:legend>` : '';
  return `${XML_HEAD}<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:date1904 val="0"/><c:roundedCorners val="0"/><c:chart>${title}<c:plotArea><c:layout/>${plot}${axes}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:externalData r:id="${extRid}"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`;
}

/** A minimal .xlsx so PowerPoint's "Edit Data" has something to open. */
function workbookZip(el: ChartEl): JSZip {
  const z = new JSZip();
  z.file('[Content_Types].xml', `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  z.file('_rels/.rels', `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  z.file('xl/workbook.xml', `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  z.file('xl/_rels/workbook.xml.rels', `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
  const str = (ref: string, v: string) => `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
  const rows: string[] = [`<row r="1">${str('A1', '')}${el.series.map((s, i) => str(`${colLetter(i + 1)}1`, s.name)).join('')}</row>`];
  el.cats.forEach((cat, r) => {
    rows.push(`<row r="${r + 2}">${str(`A${r + 2}`, cat)}${el.series.map((s, i) => (s.values[r] == null ? '' : `<c r="${colLetter(i + 1)}${r + 2}"><v>${s.values[r]}</v></c>`)).join('')}</row>`);
  });
  z.file('xl/worksheets/sheet1.xml', `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join('')}</sheetData></worksheet>`);
  return z;
}
/** workbooks are zipped asynchronously once the whole presentation has been written */
const pendingWorkbooks: { path: string; zip: JSZip }[] = [];

// ---------------------------------------------------------------------------
// Transitions & animations
// ---------------------------------------------------------------------------
const OOXML_DIR: Record<string, string> = { l: 'r', r: 'l', t: 'd', b: 'u' };
const dirOf = (d: string | undefined) => OOXML_DIR[d ?? ''] ?? 'l';

function transitionXml(t: Transition | undefined): string {
  if (!t) return '';
  const spd = (t.dur ?? 0.75) <= 0.5 ? 'fast' : (t.dur ?? 0.75) >= 1.25 ? 'slow' : 'med';
  const attrs = `spd="${spd}"${t.advClick === false ? ' advClick="0"' : ''}${t.advAfter ? ` advTm="${Math.round(t.advAfter * 1000)}"` : ''}`;
  let inner = '';
  switch (t.type) {
    case 'none':
      inner = '';
      break;
    case 'push':
    case 'wipe':
    case 'cover':
    case 'pull':
      inner = `<p:${t.type} dir="${dirOf(t.dir)}"/>`;
      break;
    case 'split':
      inner = `<p:split orient="${t.dir === 'vert' ? 'vert' : 'horz'}" dir="out"/>`;
      break;
    case 'zoom':
      inner = `<p:zoom dir="${t.dir === 'out' ? 'out' : 'in'}"/>`;
      break;
    case 'dissolve':
      inner = '<p:dissolve/>';
      break;
    case 'cut':
      inner = '<p:cut/>';
      break;
    default:
      inner = '<p:fade/>';
  }
  return `<p:transition ${attrs}>${inner}</p:transition>`;
}

const FLY_SUB: Record<string, number> = { t: 1, r: 2, b: 4, l: 8 };

function timingXml(anims: Anim[] | undefined, ids: Map<string, number>, textShapes: Set<string>): string {
  const list = (anims ?? []).filter((a) => ids.has(a.target));
  if (!list.length) return '';
  let n = 3;
  const next = () => n++;
  const steps: Anim[][] = [];
  for (const a of list) {
    if (a.trigger === 'click' || !steps.length) steps.push([]);
    steps[steps.length - 1].push(a);
  }
  const tgt = (spid: number) => `<p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl>`;
  const setVis = (spid: number, val: 'visible' | 'hidden', at = 0) => `<p:set><p:cBhvr><p:cTn id="${next()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="${at}"/></p:stCondLst></p:cTn>${tgt(spid)}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="${val}"/></p:to></p:set>`;
  const filterFx = (spid: number, filter: string, ms: number, io: 'in' | 'out') => `<p:animEffect transition="${io}" filter="${filter}"><p:cBhvr><p:cTn id="${next()}" dur="${ms}"/>${tgt(spid)}</p:cBhvr></p:animEffect>`;
  const animNum = (spid: number, attr: string, from: string, to: string, ms: number) => `<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="${next()}" dur="${ms}" fill="hold"/>${tgt(spid)}<p:attrNameLst><p:attrName>${attr}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val><p:strVal val="${from}"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="${to}"/></p:val></p:tav></p:tavLst></p:anim>`;

  const effect = (a: Anim): { id: number; subtype: number; body: string } => {
    const spid = ids.get(a.target)!;
    const ms = Math.max(1, Math.round(a.dur * 1000));
    const out = a.cls === 'exit';
    const vis = (inner: string) => (out ? inner + setVis(spid, 'hidden', ms) : setVis(spid, 'visible') + inner);
    if (a.cls === 'emph') {
      if (a.effect === 'spin') return { id: 8, subtype: 0, body: `<p:animRot by="21600000"><p:cBhvr><p:cTn id="${next()}" dur="${ms}" fill="hold"/>${tgt(spid)}<p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst></p:cBhvr></p:animRot>` };
      const by = a.effect === 'grow' ? 150000 : 112000;
      return { id: a.effect === 'grow' ? 6 : 26, subtype: 0, body: `<p:animScale><p:cBhvr><p:cTn id="${next()}" dur="${ms}" fill="hold"/>${tgt(spid)}</p:cBhvr><p:by x="${by}" y="${by}"/></p:animScale>` };
    }
    switch (a.effect) {
      case 'appear':
        return { id: 1, subtype: 0, body: out ? setVis(spid, 'hidden') : setVis(spid, 'visible') };
      case 'fly': {
        const d = a.dir ?? 'b';
        const [fx, tx, fy, ty] = d === 'l' ? ['0-#ppt_w/2', '#ppt_x', '#ppt_y', '#ppt_y'] : d === 'r' ? ['1+#ppt_w/2', '#ppt_x', '#ppt_y', '#ppt_y'] : d === 't' ? ['#ppt_x', '#ppt_x', '0-#ppt_h/2', '#ppt_y'] : ['#ppt_x', '#ppt_x', '1+#ppt_h/2', '#ppt_y'];
        const body = out ? animNum(spid, 'ppt_x', tx, fx, ms) + animNum(spid, 'ppt_y', ty, fy, ms) : animNum(spid, 'ppt_x', fx, tx, ms) + animNum(spid, 'ppt_y', fy, ty, ms);
        return { id: 2, subtype: FLY_SUB[d] ?? 4, body: vis(body) };
      }
      case 'wipe': {
        const d = a.dir ?? 'l';
        const f = d === 'l' ? 'wipe(left)' : d === 'r' ? 'wipe(right)' : d === 't' ? 'wipe(up)' : 'wipe(down)';
        return { id: 22, subtype: FLY_SUB[d] ?? 8, body: vis(filterFx(spid, f, ms, out ? 'out' : 'in')) };
      }
      case 'zoom':
        return { id: 53, subtype: 16, body: vis(animNum(spid, 'ppt_w', out ? '#ppt_w' : '0', out ? '0' : '#ppt_w', ms) + animNum(spid, 'ppt_h', out ? '#ppt_h' : '0', out ? '0' : '#ppt_h', ms) + filterFx(spid, 'fade', ms, out ? 'out' : 'in')) };
      default:
        return { id: 10, subtype: 0, body: vis(filterFx(spid, 'fade', ms, out ? 'out' : 'in')) };
    }
  };

  const stepXml = steps
    .map((step) => {
      const outer = next();
      const inner = next();
      let prevEnd = 0;
      let prevStart = 0;
      const effects = step
        .map((a, i) => {
          const start = a.trigger === 'after' ? prevEnd + a.delay : a.trigger === 'with' ? prevStart + a.delay : a.delay;
          prevStart = start;
          prevEnd = start + a.dur;
          const eid = next();
          const e = effect(a);
          const node = i === 0 && a.trigger === 'click' ? 'clickEffect' : a.trigger === 'after' ? 'afterEffect' : 'withEffect';
          const cls = a.cls;
          return `<p:par><p:cTn id="${eid}" presetID="${e.id}" presetClass="${cls}" presetSubtype="${e.subtype}" fill="hold"${textShapes.has(a.target) ? ' grpId="0"' : ''} nodeType="${node}"><p:stCondLst><p:cond delay="${Math.round(start * 1000)}"/></p:stCondLst><p:childTnLst>${e.body}</p:childTnLst></p:cTn></p:par>`;
        })
        .join('');
      return `<p:par><p:cTn id="${outer}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="${inner}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${effects}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`;
    })
    .join('');
  const bld = [...new Set(list.map((a) => a.target))].filter((t) => textShapes.has(t)).map((t) => `<p:bldP spid="${ids.get(t)}" grpId="0"/>`).join('');
  return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${stepXml}</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst>${bld ? `<p:bldLst>${bld}</p:bldLst>` : ''}</p:timing>`;
}

// ---------------------------------------------------------------------------
// Theme, master, layout, slide, notes
// ---------------------------------------------------------------------------
function themeXml(m: Master): string {
  const c = m.theme.colors;
  const slot = (k: keyof typeof c) => `<a:${k}><a:srgbClr val="${c[k].replace('#', '').toUpperCase()}"/></a:${k}>`;
  const ln = (w: number) => `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`;
  const solid = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  return `${XML_HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${esc(m.theme.name)}"><a:themeElements><a:clrScheme name="${esc(m.theme.name)}">${(['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'] as const).map(slot).join('')}</a:clrScheme><a:fontScheme name="${esc(m.theme.name)}"><a:majorFont><a:latin typeface="${esc(m.theme.fonts.major)}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${esc(m.theme.fonts.minor)}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst>${solid}${solid}${solid}</a:fillStyleLst><a:lnStyleLst>${ln(6350)}${ln(12700)}${ln(19050)}</a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst>${solid}${solid}${solid}</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
}

function groupHeader(): string {
  return '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
}

function bgXml(f: Fill | undefined, part: Part, ex: Ex): string {
  if (!f) return '';
  return `<p:bg><p:bgPr>${fillXml(f, part, ex)}<a:effectLst/></p:bgPr></p:bg>`;
}

function newCtx(part: Part, ex: Ex): SlideCtx {
  let n = 1;
  return { part, ex, next: () => ++n, ids: new Map() };
}

const LAYOUT_TYPES = new Set(['title', 'tx', 'twoColTx', 'tbl', 'txAndChart', 'chartAndTx', 'dgm', 'chart', 'txAndClipArt', 'clipArtAndTx', 'titleOnly', 'blank', 'txAndObj', 'objAndTx', 'objOnly', 'obj', 'txAndMedia', 'mediaAndTx', 'objOverTx', 'txOverObj', 'txAndTwoObj', 'twoObjAndTx', 'twoObjOverTx', 'fourObj', 'vertTx', 'clipArtAndVertTx', 'vertTitleAndTx', 'vertTitleAndTxOverChart', 'twoObj', 'objAndTwoObj', 'twoObjAndObj', 'cust', 'secHead', 'twoTxTwoObj', 'objTx', 'picTx']);

function allLevels(lst: LstLevel[] | undefined, part: Part, tag: string, ex: Ex): string {
  return lstXml(lst, part, tag, ex);
}

export async function exportPptx(deck: Deck, kind: 'pptx' | 'ppsx' | 'potx' = 'pptx'): Promise<Uint8Array> {
  const pres = deck.pres;
  const zip = new JSZip();
  const ex: Ex = { deck, zip, overrides: [], defaults: new Map([['rels', 'application/vnd.openxmlformats-package.relationships+xml'], ['xml', 'application/xml']]), mediaPaths: new Map(), chartCount: 0, embedCount: 0, slideParts: new Map() };
  pendingWorkbooks.length = 0;

  const presPart = new Part('ppt/presentation.xml');
  const hasNotes = pres.slides.some((s) => s.notes?.some((p) => p.runs.some((r) => r.t)));
  const hasComments = pres.slides.some((s) => s.comments?.length);

  // number everything up front so hyperlinks between slides resolve
  pres.slides.forEach((s, i) => ex.slideParts.set(s.id, `ppt/slides/slide${i + 1}.xml`));

  // ---- masters, themes, layouts
  const masterParts = new Map<string, Part>();
  const layoutParts = new Map<string, Part>();
  let layoutNo = 0;
  const masterIdXml: string[] = [];
  let idSeq = 2147483648;
  pres.masters.forEach((m, mi) => {
    const mPart = new Part(`ppt/slideMasters/slideMaster${mi + 1}.xml`);
    masterParts.set(m.id, mPart);
    const themePath = `ppt/theme/theme${mi + 1}.xml`;
    zip.file(themePath, themeXml(m));
    ex.overrides.push({ part: themePath, type: 'application/vnd.openxmlformats-officedocument.theme+xml' });
    const layoutsOfMaster = pres.layouts.filter((l) => l.masterId === m.id);
    const layoutIds: string[] = [];
    for (const l of layoutsOfMaster) {
      const lPart = new Part(`ppt/slideLayouts/slideLayout${++layoutNo}.xml`);
      layoutParts.set(l.id, lPart);
      const lid = mPart.add('slideLayout', relTarget(mPart.path, lPart.path));
      layoutIds.push(`<p:sldLayoutId id="${++idSeq}" r:id="${lid}"/>`);
    }
    mPart.add('theme', relTarget(mPart.path, themePath));
    for (const l of layoutsOfMaster) {
      const lPart = layoutParts.get(l.id)!;
      lPart.add('slideMaster', relTarget(lPart.path, mPart.path));
      const c = newCtx(lPart, ex);
      const shapes = l.elements.map((e) => elementXml(e, c)).join('');
      const type = l.kind && LAYOUT_TYPES.has(l.kind) ? ` type="${l.kind}"` : '';
      zip.file(lPart.path, `${XML_HEAD}<p:sldLayout ${NS}${type} preserve="1"${l.showMaster === false ? ' showMasterSp="0"' : ''}><p:cSld name="${esc(l.name)}">${bgXml(l.bg, lPart, ex)}<p:spTree>${groupHeader()}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
      zip.file(lPart.relsPath(), lPart.relsXml());
      ex.overrides.push({ part: lPart.path, type: 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml' });
    }
    const c = newCtx(mPart, ex);
    const shapes = m.elements.map((e) => elementXml(e, c)).join('');
    const cm = m.clrMap;
    const clrMap = `<p:clrMap bg1="${cm.bg1}" tx1="${cm.tx1}" bg2="${cm.bg2}" tx2="${cm.tx2}" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>`;
    const styles = `<p:txStyles>${allLevels(m.txStyles.title, mPart, 'p:titleStyle', ex)}${allLevels(m.txStyles.body, mPart, 'p:bodyStyle', ex)}${allLevels(m.txStyles.other, mPart, 'p:otherStyle', ex)}</p:txStyles>`;
    zip.file(mPart.path, `${XML_HEAD}<p:sldMaster ${NS}><p:cSld>${bgXml(m.bg, mPart, ex)}<p:spTree>${groupHeader()}${shapes}</p:spTree></p:cSld>${clrMap}<p:sldLayoutIdLst>${layoutIds.join('')}</p:sldLayoutIdLst>${styles}</p:sldMaster>`);
    zip.file(mPart.relsPath(), mPart.relsXml());
    ex.overrides.push({ part: mPart.path, type: 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml' });
    const rid = presPart.add('slideMaster', relTarget(presPart.path, mPart.path));
    masterIdXml.push(`<p:sldMasterId id="${++idSeq}" r:id="${rid}"/>`);
  });

  // ---- notes master (only when needed)
  let notesMasterPart: Part | null = null;
  if (hasNotes) {
    notesMasterPart = new Part('ppt/notesMasters/notesMaster1.xml');
    const themePath = `ppt/theme/theme${pres.masters.length + 1}.xml`;
    zip.file(themePath, themeXml(pres.masters[0]));
    ex.overrides.push({ part: themePath, type: 'application/vnd.openxmlformats-officedocument.theme+xml' });
    notesMasterPart.add('theme', relTarget(notesMasterPart.path, themePath));
    const body = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="1143000"/><a:ext cx="5486400" cy="3086100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln></p:spPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"/><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master text styles</a:t></a:r></a:p></p:txBody></p:sp>`;
    zip.file(notesMasterPart.path, `${XML_HEAD}<p:notesMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${groupHeader()}${body}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:notesStyle><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:notesStyle></p:notesMaster>`);
    zip.file(notesMasterPart.relsPath(), notesMasterPart.relsXml());
    ex.overrides.push({ part: notesMasterPart.path, type: 'application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml' });
  }
  const notesMasterRid = notesMasterPart ? presPart.add('notesMaster', relTarget(presPart.path, notesMasterPart.path)) : null;

  // ---- comment authors
  const authors: string[] = [];
  if (hasComments) {
    for (const s of pres.slides) for (const c of s.comments ?? []) if (!authors.includes(c.author)) authors.push(c.author);
    zip.file('ppt/commentAuthors.xml', `${XML_HEAD}<p:cmAuthorLst ${NS}>${authors.map((a, i) => `<p:cmAuthor id="${i}" name="${esc(a)}" initials="${esc(a.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 3).toUpperCase() || 'A')}" lastIdx="${pres.slides.reduce((n, s) => n + (s.comments?.filter((c) => c.author === a).length ?? 0), 0)}" clrIdx="${i}"/>`).join('')}</p:cmAuthorLst>`);
    ex.overrides.push({ part: 'ppt/commentAuthors.xml', type: 'application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml' });
    presPart.add('commentAuthors', 'commentAuthors.xml');
  }

  // ---- slides
  const sldIds: string[] = [];
  const sections: { name: string; ids: number[] }[] = [];
  let notesNo = 0;
  let commentNo = 0;
  pres.slides.forEach((s, i) => {
    const sPart = new Part(`ppt/slides/slide${i + 1}.xml`);
    const layout = pres.layouts.find((l) => l.id === s.layoutId) ?? pres.layouts[0];
    sPart.add('slideLayout', relTarget(sPart.path, layoutParts.get(layout.id)!.path));
    const c = newCtx(sPart, ex);
    const shapes = s.elements.map((e) => elementXml(e, c)).join('');
    const textShapes = new Set(s.elements.filter((e) => e.type === 'shape' && e.text && !(('prst' in e.geom) && LINE_PRESETS.has(e.geom.prst))).map((e) => e.id));
    const timing = timingXml(s.anims, c.ids, textShapes);
    const attrs = `${s.hidden ? ' show="0"' : ''}${s.showMaster === false ? ' showMasterSp="0"' : ''}`;
    // notes
    if (notesMasterPart && s.notes?.some((p) => p.runs.some((r) => r.t))) {
      const nPart = new Part(`ppt/notesSlides/notesSlide${++notesNo}.xml`);
      nPart.add('notesMaster', relTarget(nPart.path, notesMasterPart.path));
      nPart.add('slide', relTarget(nPart.path, sPart.path));
      sPart.add('notesSlide', relTarget(sPart.path, nPart.path));
      const paras = s.notes.map((p) => `<a:p>${p.runs.map((r) => (r.br ? '<a:br><a:rPr lang="en-US"/></a:br>' : r.t ? `<a:r><a:rPr lang="en-US" dirty="0"/><a:t>${esc(r.t)}</a:t></a:r>` : '')).join('')}</a:p>`).join('');
      zip.file(nPart.path, `${XML_HEAD}<p:notes ${NS}><p:cSld><p:spTree>${groupHeader()}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`);
      zip.file(nPart.relsPath(), nPart.relsXml());
      ex.overrides.push({ part: nPart.path, type: 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml' });
    }
    // comments
    if (s.comments?.length) {
      const cPath = `ppt/comments/comment${++commentNo}.xml`;
      sPart.add('comments', relTarget(sPart.path, cPath));
      zip.file(cPath, `${XML_HEAD}<p:cmLst ${NS}>${s.comments.map((cm, k) => `<p:cm authorId="${Math.max(0, authors.indexOf(cm.author))}" dt="${esc(cm.date && !Number.isNaN(Date.parse(cm.date)) ? new Date(cm.date).toISOString().replace(/\.\d+Z$/, '.000') : '2024-01-01T00:00:00.000')}" idx="${k + 1}"><p:pos x="${Math.round(cm.x ?? 10)}" y="${Math.round(cm.y ?? 10)}"/><p:text>${esc(cm.text)}</p:text></p:cm>`).join('')}</p:cmLst>`);
      ex.overrides.push({ part: cPath, type: 'application/vnd.openxmlformats-officedocument.presentationml.comments+xml' });
    }
    zip.file(sPart.path, `${XML_HEAD}<p:sld ${NS}${attrs}><p:cSld>${bgXml(s.bg, sPart, ex)}<p:spTree>${groupHeader()}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${transitionXml(s.transition)}${timing}</p:sld>`);
    zip.file(sPart.relsPath(), sPart.relsXml());
    ex.overrides.push({ part: sPart.path, type: 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml' });
    const rid = presPart.add('slide', relTarget(presPart.path, sPart.path));
    const sid = 256 + i;
    sldIds.push(`<p:sldId id="${sid}" r:id="${rid}"/>`);
    if (s.section !== undefined) sections.push({ name: s.section, ids: [] });
    if (sections.length) sections[sections.length - 1].ids.push(sid);
  });

  // ---- presentation.xml
  presPart.add('presProps', 'presProps.xml');
  presPart.add('viewProps', 'viewProps.xml');
  presPart.add('theme', relTarget(presPart.path, 'ppt/theme/theme1.xml'));
  presPart.add('tableStyles', 'tableStyles.xml');
  const sectionXml = sections.length ? `<p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">${sections.map((s, i) => `<p14:section name="${esc(s.name || 'Section')}" id="{${guid('section' + i)}}"><p14:sldIdLst>${s.ids.map((id) => `<p14:sldId id="${id}"/>`).join('')}</p14:sldIdLst></p14:section>`).join('')}</p14:sectionLst></p:ext></p:extLst>` : '';
  const defaultText = lstXml(pres.defaultText, presPart, 'p:defaultTextStyle', ex);
  zip.file(
    presPart.path,
    `${XML_HEAD}<p:presentation ${NS} saveSubsetFonts="1"${pres.firstSlideNumber && pres.firstSlideNumber !== 1 ? ` firstSlideNum="${pres.firstSlideNumber}"` : ''}><p:sldMasterIdLst>${masterIdXml.join('')}</p:sldMasterIdLst>${notesMasterRid ? `<p:notesMasterIdLst><p:notesMasterId r:id="${notesMasterRid}"/></p:notesMasterIdLst>` : ''}<p:sldIdLst>${sldIds.join('')}</p:sldIdLst><p:sldSz cx="${emu(pres.size.w)}" cy="${emu(pres.size.h)}"/><p:notesSz cx="6858000" cy="9144000"/>${defaultText}${sectionXml}</p:presentation>`,
  );
  zip.file(presPart.relsPath(), presPart.relsXml());
  zip.file('ppt/presProps.xml', `${XML_HEAD}<p:presentationPr ${NS}/>`);
  zip.file('ppt/viewProps.xml', `${XML_HEAD}<p:viewPr ${NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:slideViewPr><p:cSldViewPr><p:cViewPr varScale="1"><p:scale><a:sx n="100" d="100"/><a:sy n="100" d="100"/></p:scale><p:origin x="0" y="0"/></p:cViewPr><p:guideLst/></p:cSldViewPr></p:slideViewPr><p:notesTextViewPr><p:cViewPr><p:scale><a:sx n="1" d="1"/><a:sy n="1" d="1"/></p:scale><p:origin x="0" y="0"/></p:cViewPr></p:notesTextViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`);
  zip.file('ppt/tableStyles.xml', `${XML_HEAD}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`);
  for (const o of [['ppt/presProps.xml', 'application/vnd.openxmlformats-officedocument.presentationml.presProps+xml'], ['ppt/viewProps.xml', 'application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml'], ['ppt/tableStyles.xml', 'application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml']] as const) ex.overrides.push({ part: o[0], type: o[1] });
  ex.overrides.push({ part: presPart.path, type: CT[kind] });

  // ---- document properties
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  zip.file('docProps/core.xml', `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(pres.title)}</dc:title><dc:creator>${esc(pres.author)}</dc:creator><cp:lastModifiedBy>BNC Presentation</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
  zip.file('docProps/app.xml', `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>BNC Presentation</Application><Slides>${pres.slides.length}</Slides></Properties>`);
  ex.overrides.push({ part: 'docProps/core.xml', type: 'application/vnd.openxmlformats-package.core-properties+xml' }, { part: 'docProps/app.xml', type: 'application/vnd.openxmlformats-officedocument.extended-properties+xml' });
  zip.file('_rels/.rels', `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`);

  // ---- content types
  const defaults = [...ex.defaults.entries()].map(([e, t]) => `<Default Extension="${esc(e)}" ContentType="${esc(t)}"/>`).join('');
  zip.file('[Content_Types].xml', `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults}${ex.overrides.map((o) => `<Override PartName="/${o.part}" ContentType="${o.type}"/>`).join('')}</Types>`);

  // embedded chart workbooks are generated asynchronously
  for (const wb of pendingWorkbooks.splice(0)) zip.file(wb.path, await wb.zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
