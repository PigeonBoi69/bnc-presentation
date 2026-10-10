// Slide renderer: turns the model into HTML/SVG. Used for the editing canvas, thumbnails, the slide
// show, and the HTML / PDF / image exports, so every view of a slide looks identical.
import { css, type ThemeCtx } from './color';
import { chartSvg } from './chart';
import { geometryOf, LINE_PRESETS, type ShapeGeometry } from './geometry';
import {
  layoutOf,
  masterOf,
  type ArrowEnd,
  type Cell,
  type DashStyle,
  type El,
  type Fill,
  type GroupEl,
  type Layout,
  type Line,
  type Master,
  type PictureEl,
  type Pres,
  type ShapeEl,
  type Slide,
  type TableEl,
  type TextBody,
  type MediaEl,
  type ChartEl,
  type Effects,
} from './model';
import { esc, isEmptyText, paragraphsHtml, PLACEHOLDER_PROMPTS, textBlockStyle, type TextRenderOpts } from './text';

export interface RenderOpts {
  pres: Pres;
  /** resolves a media id to a URL the page can load (blob: or data:) */
  media: (id: string) => string | undefined;
  slideNumber: number;
  slideCount: number;
  /** editing canvas: adds element ids, empty-placeholder prompts and media badges */
  editing?: boolean;
  date?: string;
  /** slide show: let video / audio play */
  playing?: boolean;
  /** element ids to leave out (e.g. while their text is open in the editor) */
  hide?: Set<string>;
  /** always emit the text block of this element (so the text editor has somewhere to go) */
  forceText?: string;
}

let gradientCounter = 0;
const gid = (p: string) => `${p}${++gradientCounter}`;
const px = (n: number) => `${Math.round(n * 100) / 100}px`;
const num = (n: number) => Math.round(n * 100) / 100;

export function themeCtxOf(master: Master): ThemeCtx {
  return { theme: master.theme, clrMap: master.clrMap };
}

// ---------------------------------------------------------------------------
// Fills & lines
// ---------------------------------------------------------------------------
export function fillCssBackground(f: Fill | undefined, ctx: ThemeCtx, o: Pick<RenderOpts, 'media'>): string {
  if (!f || f.t === 'none') return 'background:transparent';
  if (f.t === 'solid') return `background:${css(f.c, ctx)}`;
  if (f.t === 'grad') {
    const stops = [...f.stops].sort((a, b) => a.pos - b.pos).map((s) => `${css(s.c, ctx)} ${Math.round(s.pos * 1000) / 10}%`);
    if (f.kind === 'radial' || f.kind === 'path' || f.kind === 'rect') return `background:radial-gradient(circle at 50% 50%,${stops.join(',')})`;
    return `background:linear-gradient(${Math.round(f.ang + 90)}deg,${stops.join(',')})`;
  }
  if (f.t === 'pic') {
    const url = o.media(f.media);
    return url ? `background:url('${url}') ${f.tile ? 'repeat' : 'no-repeat'};background-size:${f.tile ? 'auto' : '100% 100%'}` : 'background:#ddd';
  }
  return `background:${css(f.bg, ctx)}`;
}

const DASH: Record<DashStyle, number[]> = {
  solid: [],
  dot: [1, 3],
  dash: [4, 3],
  dashDot: [4, 3, 1, 3],
  lgDash: [8, 3],
  lgDashDot: [8, 3, 1, 3],
  lgDashDotDot: [8, 3, 1, 3, 1, 3],
  sysDash: [3, 1],
  sysDot: [1, 1],
  sysDashDot: [3, 1, 1, 1],
  sysDashDotDot: [3, 1, 1, 1, 1, 1],
};

interface Defs {
  list: string[];
}

function svgFill(f: Fill | undefined, ctx: ThemeCtx, defs: Defs, o: RenderOpts, w: number, h: number): string {
  if (!f || f.t === 'none') return 'none';
  if (f.t === 'solid') return css(f.c, ctx);
  if (f.t === 'grad') {
    const id = gid('g');
    const stops = [...f.stops].sort((a, b) => a.pos - b.pos).map((s) => `<stop offset="${s.pos}" stop-color="${css(s.c, ctx)}"/>`).join('');
    if (f.kind === 'radial' || f.kind === 'path' || f.kind === 'rect') defs.list.push(`<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.7">${stops}</radialGradient>`);
    else {
      const a = (f.ang * Math.PI) / 180;
      // objectBoundingBox gradients are stretched with the shape; compensate so the angle looks right
      const x1 = 0.5 - Math.cos(a) / 2;
      const y1 = 0.5 - Math.sin(a) / 2;
      const x2 = 0.5 + Math.cos(a) / 2;
      const y2 = 0.5 + Math.sin(a) / 2;
      defs.list.push(`<linearGradient id="${id}" x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}">${stops}</linearGradient>`);
    }
    return `url(#${id})`;
  }
  if (f.t === 'pic') {
    const url = o.media(f.media);
    if (!url) return '#ddd';
    const id = gid('p');
    defs.list.push(
      f.tile
        ? `<pattern id="${id}" patternUnits="userSpaceOnUse" width="96" height="96"><image href="${url}" width="96" height="96" preserveAspectRatio="none"/></pattern>`
        : `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${num(w)}" height="${num(h)}"><image href="${url}" width="${num(w)}" height="${num(h)}" preserveAspectRatio="none"/></pattern>`,
    );
    return `url(#${id})`;
  }
  // pattern fill: approximate with the foreground colour mixed toward the background
  return css(f.fg, ctx);
}

function arrowMarker(end: ArrowEnd, color: string, defs: Defs, which: 'start' | 'end'): string {
  const id = gid('m');
  const wScale = end.w === 'sm' ? 2 : end.w === 'lg' ? 5 : 3;
  const lScale = end.len === 'sm' ? 2 : end.len === 'lg' ? 5 : 3;
  const mw = wScale;
  const ml = lScale;
  let shape: string;
  let refX = 0;
  switch (end.type) {
    case 'oval':
      shape = `<ellipse cx="${ml / 2}" cy="${mw / 2}" rx="${ml / 2}" ry="${mw / 2}" fill="${color}"/>`;
      refX = ml / 2;
      break;
    case 'diamond':
      shape = `<path d="M0,${mw / 2}L${ml / 2},0L${ml},${mw / 2}L${ml / 2},${mw}Z" fill="${color}"/>`;
      refX = ml / 2;
      break;
    case 'stealth':
      shape = `<path d="M0,0L${ml},${mw / 2}L0,${mw}L${ml * 0.3},${mw / 2}Z" fill="${color}"/>`;
      refX = ml * 0.3;
      break;
    case 'arrow':
      shape = `<path d="M0,0L${ml},${mw / 2}L0,${mw}" fill="none" stroke="${color}" stroke-width="0.6"/>`;
      refX = ml * 0.5;
      break;
    default:
      shape = `<path d="M0,0L${ml},${mw / 2}L0,${mw}Z" fill="${color}"/>`;
      refX = ml * 0.6;
  }
  void which;
  defs.list.push(`<marker id="${id}" viewBox="0 0 ${ml} ${mw}" refX="${refX}" refY="${mw / 2}" markerWidth="${ml}" markerHeight="${mw}" markerUnits="strokeWidth" orient="auto-start-reverse">${shape}</marker>`);
  return id;
}

function strokeAttrs(line: Line | undefined, ctx: ThemeCtx, defs: Defs, o: RenderOpts, w: number, h: number, withMarkers: boolean): string {
  if (!line || line.c == null || !(line.w > 0)) return 'stroke="none"';
  const parts = [`stroke="${line.grad ? svgFill(line.grad, ctx, defs, o, w, h) : css(line.c, ctx)}"`, `stroke-width="${num(line.w)}"`];
  const dash = DASH[line.dash ?? 'solid'];
  if (dash?.length) parts.push(`stroke-dasharray="${dash.map((d) => num(d * Math.max(1, line.w))).join(' ')}"`);
  parts.push(`stroke-linecap="${line.cap === 'round' ? 'round' : line.cap === 'square' ? 'square' : 'butt'}"`);
  parts.push(`stroke-linejoin="${line.join ?? 'miter'}"`);
  if (withMarkers) {
    const color = css(line.c, ctx);
    if (line.head) parts.push(`marker-start="url(#${arrowMarker(line.head, color, defs, 'start')})"`);
    if (line.tail) parts.push(`marker-end="url(#${arrowMarker(line.tail, color, defs, 'end')})"`);
  }
  return parts.join(' ');
}

function effectsFilter(fx: Effects | undefined, ctx: ThemeCtx): string {
  if (!fx) return '';
  const f: string[] = [];
  if (fx.shadow) {
    const s = fx.shadow;
    const dx = Math.cos((s.dir * Math.PI) / 180) * s.dist;
    const dy = Math.sin((s.dir * Math.PI) / 180) * s.dist;
    f.push(`drop-shadow(${px(dx)} ${px(dy)} ${px(s.blur / 2)} ${css(s.c, ctx, s.alpha ?? 0.4)})`);
  }
  if (fx.glow) f.push(`drop-shadow(0 0 ${px(fx.glow.r / 2)} ${css(fx.glow.c, ctx, 0.6)})`);
  return f.length ? `filter:${f.join(' ')}` : '';
}

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------
function wrapperStyle(el: El): string {
  const s = [`left:${px(el.x)}`, `top:${px(el.y)}`, `width:${px(el.w)}`, `height:${px(el.h)}`];
  if (el.rot) s.push(`transform:rotate(${el.rot}deg)`);
  return s.join(';');
}

function textBlock(tb: TextBody, geo: ShapeGeometry, ctx: ThemeCtx, o: RenderOpts, el: El, extraStyle = ''): string {
  const [l, t, r, b] = geo.text;
  const { outer, inner } = textBlockStyle(tb);
  const ro: TextRenderOpts = { scale: tb.fontScale ?? 1, lnReduction: tb.lnSpcReduction, slideNumber: o.slideNumber, slideCount: o.slideCount, date: o.date, editing: o.editing };
  const empty = isEmptyText(tb);
  const prompt = o.editing && empty && el.ph ? PLACEHOLDER_PROMPTS[el.ph.type] : undefined;
  const flipV = el.flipV ? 'transform:rotate(180deg);' : '';
  return `<div class="tx${prompt ? ' ph-empty' : empty ? '' : ' has-text'}" style="${prompt ? `--prompt:'${prompt}';` : ''}left:${px(l)};top:${px(t)};width:${px(Math.max(0, r - l))};height:${px(Math.max(0, b - t))};${outer};${flipV}${extraStyle}"><div class="tx-in" style="${inner}">${paragraphsHtml(tb, ctx, ro)}</div></div>`;
}

function shapeHtml(el: ShapeEl, ctx: ThemeCtx, o: RenderOpts, attrs: string): string {
  const geo = geometryOf(el.geom, el.w, el.h);
  const defs: Defs = { list: [] };
  const isLine = 'prst' in el.geom && LINE_PRESETS.has(el.geom.prst);
  const fillAttr = geo.open && isLine ? 'none' : svgFill(el.fill, ctx, defs, o, el.w, el.h);
  const paths: string[] = [];
  for (const p of geo.paths) {
    const fillOn = p.fill !== 'none';
    const strokeOn = p.stroke;
    const stroke = strokeOn ? strokeAttrs(el.line, ctx, defs, o, el.w, el.h, !fillOn || !!geo.open) : 'stroke="none"';
    if (p.fill === 'darken' || p.fill === 'lighten') {
      paths.push(`<path d="${p.d}" fill="${fillAttr}" stroke="none"/>`);
      paths.push(`<path d="${p.d}" fill="${p.fill === 'darken' ? 'rgba(0,0,0,.3)' : 'rgba(255,255,255,.35)'}" ${stroke}/>`);
    } else {
      paths.push(`<path d="${p.d}" fill="${fillOn ? fillAttr : 'none'}" ${stroke} ${geo.open && isLine ? 'pointer-events="stroke"' : ''}/>`);
    }
  }
  // a fat invisible stroke so thin lines and pen strokes are easy to click while editing
  if (o.editing && (isLine || el.ink) && geo.paths[0]) {
    for (const p of geo.paths) paths.push(`<path d="${p.d}" fill="none" stroke="transparent" stroke-width="${Math.max(12, num(el.line?.w ?? 1) + 8)}" stroke-linecap="round" stroke-linejoin="round" pointer-events="stroke"/>`);
  }
  const flips = [el.flipH ? 'scaleX(-1)' : '', el.flipV ? 'scaleY(-1)' : ''].filter(Boolean).join(' ');
  const fx = effectsFilter(el.fx, ctx);
  const svg = `<svg class="geo" width="${Math.max(1, num(el.w))}" height="${Math.max(1, num(el.h))}" style="${flips ? `transform:${flips};` : ''}${fx}"><defs>${defs.list.join('')}</defs>${paths.join('')}</svg>`;
  const text = el.text && (!isEmptyText(el.text) || (o.editing && (el.ph || o.forceText === el.id))) ? textBlock(el.text, geo, ctx, o, el) : '';
  return `<div class="el sh${isLine ? ' ln' : ''}" ${attrs} style="${wrapperStyle(el)}">${svg}${text}</div>`;
}

function pictureHtml(el: PictureEl, ctx: ThemeCtx, o: RenderOpts, attrs: string): string {
  const url = o.media(el.media);
  const crop = el.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const visW = Math.max(0.001, 1 - crop.l - crop.r);
  const visH = Math.max(0.001, 1 - crop.t - crop.b);
  const imgW = el.w / visW;
  const imgH = el.h / visH;
  const geo = el.geom && 'prst' in el.geom && el.geom.prst !== 'rect' ? geometryOf(el.geom, el.w, el.h) : null;
  const clip = geo ? `clip-path:path('${geo.paths[0].d}');` : '';
  const filters: string[] = [];
  if (el.brightness) filters.push(`brightness(${1 + el.brightness})`);
  if (el.contrast) filters.push(`contrast(${1 + el.contrast})`);
  if (el.gray) filters.push('grayscale(1)');
  const fx = effectsFilter(el.fx, ctx);
  const flips = [el.flipH ? 'scaleX(-1)' : '', el.flipV ? 'scaleY(-1)' : ''].filter(Boolean).join(' ');
  const img = url
    ? `<img src="${url}" draggable="false" style="position:absolute;left:${px(-crop.l * imgW)};top:${px(-crop.t * imgH)};width:${px(imgW)};height:${px(imgH)};${filters.length ? `filter:${filters.join(' ')};` : ''}${el.alpha != null && el.alpha < 1 ? `opacity:${el.alpha};` : ''}">`
    : `<div class="missing" style="position:absolute;inset:0">Picture</div>`;
  let outline = '';
  if (el.line && el.line.c) {
    const defs: Defs = { list: [] };
    const d = (geo ?? geometryOf(undefined, el.w, el.h)).paths[0].d;
    outline = `<svg class="geo" width="${Math.max(1, num(el.w))}" height="${Math.max(1, num(el.h))}"><path d="${d}" fill="none" ${strokeAttrs(el.line, ctx, defs, o, el.w, el.h, false)}/></svg>`;
  }
  const outer = [fx].filter(Boolean).join(';');
  return `<div class="el pic" ${attrs} style="${wrapperStyle(el)};${outer}"><div class="clip" style="position:absolute;inset:0;overflow:hidden;${clip}${flips ? `transform:${flips};` : ''}">${img}</div>${outline}</div>`;
}

function cellStyle(c: Cell, tb: TableEl, ctx: ThemeCtx, o: RenderOpts): string {
  const s: string[] = [];
  const m = c.margins ?? [7.2, 3.6, 7.2, 3.6];
  s.push(`padding:${px(m[1])} ${px(m[2])} ${px(m[3])} ${px(m[0])}`);
  s.push(`vertical-align:${c.anchor === 'ctr' ? 'middle' : c.anchor === 'b' ? 'bottom' : 'top'}`);
  if (c.fill) s.push(fillCssBackground(c.fill, ctx, o));
  const bd = (side: 'l' | 'r' | 't' | 'b', css_: string) => {
    const ln = c.borders?.[side];
    if (ln && ln.c && ln.w > 0) s.push(`${css_}:${px(ln.w)} ${ln.dash && ln.dash !== 'solid' ? 'dashed' : 'solid'} ${css(ln.c, ctx)}`);
    else s.push(`${css_}:0 none`);
  };
  bd('l', 'border-left');
  bd('r', 'border-right');
  bd('t', 'border-top');
  bd('b', 'border-bottom');
  void tb;
  return s.join(';');
}

function tableHtml(el: TableEl, ctx: ThemeCtx, o: RenderOpts, attrs: string): string {
  const cols = el.cols.map((w) => `<col style="width:${px(w)}">`).join('');
  const rows: string[] = [];
  el.rows.forEach((row, r) => {
    const cells: string[] = [];
    row.cells.forEach((c, i) => {
      if (c.hMerge || c.vMerge) return;
      const ro: TextRenderOpts = { scale: c.text.fontScale ?? 1, slideNumber: o.slideNumber, slideCount: o.slideCount, date: o.date };
      const { inner } = textBlockStyle(c.text);
      cells.push(
        `<td data-r="${r}" data-c="${i}" ${c.gridSpan && c.gridSpan > 1 ? `colspan="${c.gridSpan}"` : ''} ${c.rowSpan && c.rowSpan > 1 ? `rowspan="${c.rowSpan}"` : ''} style="${cellStyle(c, el, ctx, o)}"><div class="tx-in" style="${inner}">${paragraphsHtml(c.text, ctx, ro)}</div></td>`,
      );
    });
    rows.push(`<tr style="height:${px(row.h)}">${cells.join('')}</tr>`);
  });
  return `<div class="el tbl" ${attrs} style="${wrapperStyle(el)}"><table style="width:${px(el.w)}"><colgroup>${cols}</colgroup><tbody>${rows.join('')}</tbody></table></div>`;
}

function chartHtml(el: ChartEl, ctx: ThemeCtx, attrs: string): string {
  return `<div class="el ch" ${attrs} style="${wrapperStyle(el)}"><svg class="geo" width="${num(el.w)}" height="${num(el.h)}">${chartSvg(el, el.w, el.h, ctx)}</svg></div>`;
}

function mediaHtml(el: MediaEl, o: RenderOpts, attrs: string): string {
  const url = o.media(el.media);
  if (el.kind === 'audio') {
    const ctl = o.playing && url ? `<audio src="${url}" ${el.autoplay ? 'autoplay' : ''} ${el.loop ? 'loop' : ''} controls style="position:absolute;left:0;top:0;width:100%;height:100%"></audio>` : '';
    return `<div class="el med audio" ${attrs} style="${wrapperStyle(el)}"><svg class="geo" width="${num(el.w)}" height="${num(el.h)}" viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet"><circle cx="12" cy="12" r="11" fill="rgba(0,0,0,.65)"/><path d="M7 10v4h3l4 3V7l-4 3zm9.5 2a3 3 0 0 0-1.6-2.6v5.2a3 3 0 0 0 1.6-2.6z" fill="#fff"/></svg>${ctl}</div>`;
  }
  const poster = el.poster ? o.media(el.poster) : undefined;
  const vid = url
    ? `<video src="${url}" ${poster ? `poster="${poster}"` : ''} preload="metadata" ${o.playing ? `${el.autoplay ? 'autoplay' : ''} ${el.loop ? 'loop' : ''} controls` : 'muted'} style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain;background:#000;${o.playing ? '' : 'pointer-events:none'}"></video>`
    : '<div class="missing" style="position:absolute;inset:0">Video</div>';
  const badge = o.editing ? '<div class="play-badge"></div>' : '';
  return `<div class="el med video" ${attrs} style="${wrapperStyle(el)}">${vid}${badge}</div>`;
}

function groupHtml(el: GroupEl, ctx: ThemeCtx, o: RenderOpts, attrs: string): string {
  const sx = el.cw ? el.w / el.cw : 1;
  const sy = el.ch ? el.h / el.ch : 1;
  const kids = el.children.map((c) => elementHtml(c, ctx, o, false)).join('');
  const flips = [el.flipH ? 'scaleX(-1)' : '', el.flipV ? 'scaleY(-1)' : ''].filter(Boolean).join(' ');
  return `<div class="el grp" ${attrs} style="${wrapperStyle(el)}"><div class="grp-in" style="position:absolute;left:0;top:0;width:${px(el.cw)};height:${px(el.ch)};transform-origin:0 0;transform:${flips ? flips + ' ' : ''}scale(${num(sx)},${num(sy)})${el.flipH ? ';left:' + px(el.w) : ''}">${kids}</div></div>`;
}

export function elementHtml(el: El, ctx: ThemeCtx, o: RenderOpts, top = true): string {
  if (el.hidden || o.hide?.has(el.id)) return '';
  const attrs = `data-id="${esc(el.id)}"${el.link ? ` data-link="${esc(el.link)}"` : ''}${el.alt ? ` aria-label="${esc(el.alt)}"` : ''}${top && el.ph ? ` data-ph="${el.ph.type}"` : ''}`;
  switch (el.type) {
    case 'shape':
      return shapeHtml(el, ctx, o, attrs);
    case 'picture':
      return pictureHtml(el, ctx, o, attrs);
    case 'table':
      return tableHtml(el, ctx, o, attrs);
    case 'chart':
      return chartHtml(el, ctx, attrs);
    case 'media':
      return mediaHtml(el, o, attrs);
    case 'group':
      return groupHtml(el, ctx, o, attrs);
  }
}

// ---------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------
export interface SlideContext {
  layout: Layout;
  master: Master;
  ctx: ThemeCtx;
}
export function slideContext(pres: Pres, slide: { layoutId: string }): SlideContext {
  const layout = layoutOf(pres, slide as Slide);
  const master = masterOf(pres, layout);
  return { layout, master, ctx: themeCtxOf(master) };
}

export function effectiveBackground(slide: { bg?: Fill }, layout: Layout, master: Master): Fill {
  return slide.bg ?? layout.bg ?? master.bg;
}

/** The slide's elements as HTML (background shapes from master and layout first). */
export function slideLayersHtml(slide: Slide | Layout | Master, o: RenderOpts, sc?: SlideContext): string {
  const isSlide = 'layoutId' in slide;
  const ctxs = sc ?? (isSlide ? slideContext(o.pres, slide) : 'masterId' in slide ? slideContext(o.pres, { layoutId: slide.id }) : { layout: o.pres.layouts[0], master: slide as Master, ctx: themeCtxOf(slide as Master) });
  const { layout, master, ctx } = ctxs;
  const parts: string[] = [];
  const showMasterShapes = isSlide ? slide.showMaster !== false : true;
  if (isSlide && showMasterShapes) {
    if (layout.showMaster !== false) parts.push(`<div class="layer master">${master.elements.filter((e) => !e.ph).map((e) => elementHtml(e, ctx, { ...o, editing: false }, false)).join('')}</div>`);
    parts.push(`<div class="layer layout">${layout.elements.filter((e) => !e.ph).map((e) => elementHtml(e, ctx, { ...o, editing: false }, false)).join('')}</div>`);
  } else if ('masterId' in slide && layout === slide) {
    if (layout.showMaster !== false) parts.push(`<div class="layer master">${master.elements.filter((e) => !e.ph).map((e) => elementHtml(e, ctx, { ...o, editing: false }, false)).join('')}</div>`);
  }
  parts.push(`<div class="layer content">${slide.elements.map((e) => elementHtml(e, ctx, o)).join('')}</div>`);
  return parts.join('');
}

export function slideBackgroundStyle(slide: Slide | Layout | Master, o: RenderOpts): string {
  if ('layoutId' in slide) {
    const sc = slideContext(o.pres, slide);
    return fillCssBackground(effectiveBackground(slide, sc.layout, sc.master), sc.ctx, o);
  }
  if ('masterId' in slide) {
    const sc = slideContext(o.pres, { layoutId: slide.id });
    return fillCssBackground(slide.bg ?? sc.master.bg, sc.ctx, o);
  }
  return fillCssBackground(slide.bg, themeCtxOf(slide), o);
}

/** Fill a container element with a rendered slide. The container is sized in slide points (1pt = 1px). */
export function renderSlideInto(container: HTMLElement, slide: Slide | Layout | Master, o: RenderOpts) {
  const { w, h } = o.pres.size;
  container.classList.add('slide');
  container.setAttribute('style', `width:${w}px;height:${h}px;${slideBackgroundStyle(slide, o)}`);
  container.innerHTML = slideLayersHtml(slide, o);
}

export function slideHtmlString(slide: Slide, o: RenderOpts): string {
  const { w, h } = o.pres.size;
  return `<div class="slide" style="width:${w}px;height:${h}px;${slideBackgroundStyle(slide, o)}">${slideLayersHtml(slide, o)}</div>`;
}
