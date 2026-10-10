// The editing canvas: renders the current slide, draws selection frames, and handles pointer input
// (select, move, resize, rotate, marquee, drawing tools, text and table editing).
import type { App } from '../app';
import { geometryOf, LINE_PRESETS } from '../core/geometry';
import type { Color, El, ShapeEl, TableEl, TextBody } from '../core/model';
import { clone, newShape, newTextBox } from '../core/model';
import { renderSlideInto, slideContext } from '../core/render';
import { paragraphsHtml, textBlockStyle } from '../core/text';
import { h } from '../ui/dom';
import { aabb, corners, round2, tableFitToFrame, unionBounds, type Rect } from './ops';
import { applyFit, fitShape } from './measure';
import { TextEditor } from './textedit';

export type Tool =
  | { kind: 'shape'; prst: string }
  | { kind: 'textbox' }
  | { kind: 'ink'; pen: 'pen' | 'pencil' | 'highlighter'; color: Color; w: number }
  | { kind: 'eraser' };

export interface CellSel {
  id: string;
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLES: { id: HandleId; fx: number; fy: number; sx: number; sy: number }[] = [
  { id: 'nw', fx: 0, fy: 0, sx: -1, sy: -1 },
  { id: 'n', fx: 0.5, fy: 0, sx: 0, sy: -1 },
  { id: 'ne', fx: 1, fy: 0, sx: 1, sy: -1 },
  { id: 'e', fx: 1, fy: 0.5, sx: 1, sy: 0 },
  { id: 'se', fx: 1, fy: 1, sx: 1, sy: 1 },
  { id: 's', fx: 0.5, fy: 1, sx: 0, sy: 1 },
  { id: 'sw', fx: 0, fy: 1, sx: -1, sy: 1 },
  { id: 'w', fx: 0, fy: 0.5, sx: -1, sy: 0 },
];
const CURSORS = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'];
const cursorFor = (sx: number, sy: number, rot: number) => {
  const base = Math.atan2(sy, sx) * (180 / Math.PI); // direction of the handle
  const idx = ((Math.round((base + rot) / 45) % 8) + 8) % 8;
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][idx % 4];
};
void CURSORS;

const isLineEl = (e: El) => e.type === 'shape' && 'prst' in e.geom && LINE_PRESETS.has(e.geom.prst);

interface Drag {
  kind: 'move' | 'resize' | 'rotate' | 'marquee' | 'draw' | 'ink' | 'erase' | 'endpoint' | 'colresize' | 'rowresize' | 'cells';
  sx: number;
  sy: number;
  moved: boolean;
  [k: string]: any;
}

export class Canvas {
  host: HTMLElement;
  stage: HTMLElement;
  overlay: HTMLElement;
  zoom = 1;
  fitMode = true;
  textEditor: TextEditor | null = null;
  editing: { id: string; cell?: { r: number; c: number }; wasNew?: boolean } | null = null;
  private forceText: string | undefined;
  private drag: Drag | null = null;
  private teEl: HTMLElement | null = null;
  private clickPending: { id: string; x: number; y: number; cell?: { r: number; c: number } } | null = null;
  showGrid = false;
  showGuides = true;

  constructor(private app: App, readonly desk: HTMLElement) {
    this.host = h('div', { class: 'slide-host' });
    this.overlay = h('div', { class: 'overlay' });
    this.stage = h('div', { class: 'stage' }, this.host, this.overlay);
    desk.append(this.stage);
    this.bind();
  }

  // -------------------------------------------------------------------------
  // Layout & zoom
  // -------------------------------------------------------------------------
  get size() {
    return this.app.pres.size;
  }

  setZoom(z: number, fit = false) {
    this.fitMode = fit;
    this.zoom = Math.max(0.1, Math.min(5, Math.round(z * 1000) / 1000));
    this.layout();
    this.app.updateZoomUi();
    this.renderOverlay();
  }

  fit() {
    const pad = 44;
    const w = this.desk.clientWidth - pad;
    const hh = this.desk.clientHeight - pad;
    if (w <= 0 || hh <= 0) return;
    this.setZoom(Math.min(w / this.size.w, hh / this.size.h), true);
  }

  layout() {
    const { w, h: hh } = this.size;
    this.stage.style.width = `${w * this.zoom}px`;
    this.stage.style.height = `${hh * this.zoom}px`;
    this.host.style.transform = `scale(${this.zoom})`;
  }

  toSlide(cx: number, cy: number) {
    const r = this.stage.getBoundingClientRect();
    return { x: (cx - r.left) / this.zoom, y: (cy - r.top) / this.zoom };
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------
  render() {
    if (this.editing) {
      // never rebuild the DOM underneath a live text editor
      this.renderOverlay();
      return;
    }
    const c = this.app.container();
    const o = this.app.renderOpts({ editing: true, forceText: this.forceText });
    renderSlideInto(this.host, c, o);
    this.host.classList.add('editing');
    this.layout();
    this.renderOverlay();
  }

  elDom(id: string): HTMLElement | null {
    return this.host.querySelector(`.layer.content > .el[data-id="${CSS.escape(id)}"]`);
  }

  private els(): El[] {
    return this.app.container().elements;
  }
  private selected(): El[] {
    const set = new Set(this.app.sel);
    return this.els().filter((e) => set.has(e.id));
  }

  // -------------------------------------------------------------------------
  // Overlay
  // -------------------------------------------------------------------------
  renderOverlay() {
    this.overlay.replaceChildren();
    const z = this.zoom;
    const sel = this.selected();
    const editingId = this.editing?.id;

    if (this.app.showGridlines) this.overlay.append(this.gridDom());

    for (const e of sel) {
      const multi = sel.length > 1;
      const box = this.boxFor(e, multi ? 'thin' : e.id === editingId ? 'edit' : 'full');
      this.overlay.append(box);
      if (e.type === 'table' && !multi) this.tableGrips(e);
    }
    if (sel.length > 1) this.overlay.append(this.groupBox(sel));
    this.cellHighlight();
    void z;
  }

  private gridDom(): HTMLElement {
    const step = 18 * this.zoom;
    return h('div', { class: 'gridlines', style: { backgroundSize: `${step}px ${step}px` } });
  }

  private rectStyle(x: number, y: number, w: number, hh: number, rot = 0): Partial<CSSStyleDeclaration> {
    const z = this.zoom;
    return { left: `${x * z}px`, top: `${y * z}px`, width: `${w * z}px`, height: `${hh * z}px`, transform: rot ? `rotate(${rot}deg)` : '' };
  }

  private boxFor(e: El, mode: 'full' | 'thin' | 'edit'): HTMLElement {
    const box = h('div', { class: `selbox ${mode}`, style: this.rectStyle(e.x, e.y, e.w, e.h, e.rot ?? 0) });
    if (mode === 'thin') return box;
    // edges are draggable (move) without needing to hit the shape itself
    for (const side of ['t', 'r', 'b', 'l'] as const) {
      const edge = h('div', { class: `edge ${side}` });
      edge.addEventListener('pointerdown', (ev) => this.beginMove(ev, e.id));
      box.append(edge);
    }
    if (mode === 'edit' || e.locked) return box;
    if (isLineEl(e) && !e.rot) {
      const fh = e.flipH ? 1 : 0;
      const fv = e.flipV ? 1 : 0;
      const pts: [string, number, number][] = [['start', fh, fv], ['end', 1 - fh, 1 - fv]];
      for (const [which, fx, fy] of pts) {
        const hd = h('div', { class: 'handle ep', style: { left: `${fx * 100}%`, top: `${fy * 100}%`, cursor: 'crosshair' } });
        hd.addEventListener('pointerdown', (ev) => this.beginEndpoint(ev, e, which as 'start' | 'end'));
        box.append(hd);
      }
      return box;
    }
    for (const hd of HANDLES) {
      const el = h('div', { class: `handle ${hd.id}`, style: { left: `${hd.fx * 100}%`, top: `${hd.fy * 100}%`, cursor: cursorFor(hd.sx, hd.sy, e.rot ?? 0) } });
      el.addEventListener('pointerdown', (ev) => this.beginResize(ev, [e], hd));
      box.append(el);
    }
    const rot = h('div', { class: 'handle rot', title: 'Rotate' });
    rot.addEventListener('pointerdown', (ev) => this.beginRotate(ev, e));
    box.append(h('div', { class: 'rot-stem' }), rot);
    return box;
  }

  private groupBox(sel: El[]): HTMLElement {
    const b = unionBounds(sel);
    const box = h('div', { class: 'selbox full multi', style: this.rectStyle(b.x, b.y, b.w, b.h) });
    for (const side of ['t', 'r', 'b', 'l'] as const) {
      const edge = h('div', { class: `edge ${side}` });
      edge.addEventListener('pointerdown', (ev) => this.beginMove(ev, sel[0].id));
      box.append(edge);
    }
    for (const hd of HANDLES) {
      const el = h('div', { class: `handle ${hd.id}`, style: { left: `${hd.fx * 100}%`, top: `${hd.fy * 100}%`, cursor: cursorFor(hd.sx, hd.sy, 0) } });
      el.addEventListener('pointerdown', (ev) => this.beginResize(ev, sel, hd));
      box.append(el);
    }
    return box;
  }

  private tableGrips(t: TableEl) {
    const z = this.zoom;
    let x = 0;
    t.cols.forEach((w, i) => {
      x += w;
      if (i === t.cols.length - 1) return;
      const g = h('div', { class: 'grip col', style: { left: `${(t.x + x) * z - 3}px`, top: `${t.y * z}px`, height: `${t.h * z}px` } });
      g.addEventListener('pointerdown', (ev) => this.beginGrip(ev, t, 'col', i));
      this.overlay.append(g);
    });
    let y = 0;
    t.rows.forEach((r, i) => {
      y += r.h;
      if (i === t.rows.length - 1) return;
      const g = h('div', { class: 'grip row', style: { left: `${t.x * z}px`, top: `${(t.y + y) * z - 3}px`, width: `${t.w * z}px` } });
      g.addEventListener('pointerdown', (ev) => this.beginGrip(ev, t, 'row', i));
      this.overlay.append(g);
    });
  }

  cellHighlight() {
    const cs = this.app.cellSel;
    if (!cs) return;
    const t = this.els().find((e) => e.id === cs.id);
    if (!t || t.type !== 'table') return;
    const z = this.zoom;
    const r0 = Math.min(cs.r0, cs.r1);
    const r1 = Math.max(cs.r0, cs.r1);
    const c0 = Math.min(cs.c0, cs.c1);
    const c1 = Math.max(cs.c0, cs.c1);
    const xs = [0];
    t.cols.forEach((w) => xs.push(xs[xs.length - 1] + w));
    const ys = [0];
    t.rows.forEach((r) => ys.push(ys[ys.length - 1] + r.h));
    if (r0 === r1 && c0 === c1 && this.editing) return;
    this.overlay.append(h('div', { class: 'cellsel', style: { left: `${(t.x + xs[c0]) * z}px`, top: `${(t.y + ys[r0]) * z}px`, width: `${(xs[c1 + 1] - xs[c0]) * z}px`, height: `${(ys[r1 + 1] - ys[r0]) * z}px` } }));
  }

  // -------------------------------------------------------------------------
  // Pointer input
  // -------------------------------------------------------------------------
  private bind() {
    this.stage.addEventListener('pointerdown', (e) => this.onDown(e));
    this.desk.addEventListener('pointerdown', (e) => {
      if (e.target === this.desk) this.onDown(e);
    });
    this.stage.addEventListener('dblclick', (e) => this.onDblClick(e));
    this.stage.addEventListener('contextmenu', (e) => this.onContext(e));
    this.stage.addEventListener('pointermove', (e) => this.onHover(e));
    this.desk.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        this.setZoom(this.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
      },
      { passive: false },
    );
    new ResizeObserver(() => {
      if (this.fitMode) this.fit();
    }).observe(this.desk);
    this.stage.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('.lnk') as HTMLElement | null;
      if (a && (e.ctrlKey || e.metaKey)) void this.app.openLink(a.dataset.href ?? '');
    });
  }

  private onHover(e: PointerEvent) {
    if (this.drag) return;
    const tool = this.app.tool;
    this.stage.style.cursor = tool ? (tool.kind === 'eraser' ? 'cell' : 'crosshair') : '';
    void e;
  }

  private topElOf(target: EventTarget | null): { el: El; dom: HTMLElement } | null {
    const dom = (target as Element | null)?.closest?.('.layer.content > .el') as HTMLElement | null;
    if (!dom) return null;
    const el = this.els().find((x) => x.id === dom.dataset.id);
    return el ? { el, dom } : null;
  }

  private onDown(e: PointerEvent) {
    if (e.button === 2) return;
    const target = e.target as HTMLElement;
    // clicks inside the live text editor belong to it
    if (this.editing && this.teEl && this.teEl.contains(target)) return;
    if (this.editing) this.endTextEdit();

    const tool = this.app.tool;
    const p = this.toSlide(e.clientX, e.clientY);

    if (tool) {
      e.preventDefault();
      if (tool.kind === 'ink') return this.beginInk(e, tool);
      if (tool.kind === 'eraser') return this.beginErase(e);
      return this.beginDraw(e, tool);
    }

    const hit = this.topElOf(target);
    if (!hit) {
      if (!e.shiftKey && !e.ctrlKey) this.app.setSel([]);
      this.beginMarquee(e);
      return;
    }
    const { el } = hit;
    if (el.locked) {
      this.app.setSel([el.id]);
      return;
    }
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const already = this.app.sel.includes(el.id);

    if (additive) {
      this.app.setSel(already ? this.app.sel.filter((i) => i !== el.id) : [...this.app.sel, el.id]);
      return;
    }
    if (!already) this.app.setSel([el.id]);

    // table cell click
    const td = target.closest('td') as HTMLElement | null;
    if (el.type === 'table' && td) {
      const r = Number(td.dataset.r);
      const c = Number(td.dataset.c);
      this.app.cellSel = { id: el.id, r0: r, c0: c, r1: r, c1: c };
      this.renderOverlay();
      this.app.refreshUi();
      this.beginCellDrag(e, el, r, c);
      return;
    }
    this.app.cellSel = null;

    // a click on the text of a text box / placeholder starts editing on release (no drag)
    const onText = !!target.closest('.tx') && el.type === 'shape' && !!el.text && (el.txBox || !!el.ph);
    this.clickPending = onText ? { id: el.id, x: e.clientX, y: e.clientY } : null;
    this.beginMove(e, el.id);
    void p;
  }

  private onDblClick(e: MouseEvent) {
    if (this.app.tool) return;
    if (this.editing && this.teEl?.contains(e.target as Node)) return;
    const hit = this.topElOf(e.target);
    if (!hit) return;
    const { el } = hit;
    if (el.type === 'shape') this.startTextEdit(el.id, { x: e.clientX, y: e.clientY });
    else if (el.type === 'table') {
      const td = (e.target as HTMLElement).closest('td') as HTMLElement | null;
      if (td) this.startTextEdit(el.id, { x: e.clientX, y: e.clientY }, { r: Number(td.dataset.r), c: Number(td.dataset.c) });
    } else if (el.type === 'chart') void this.app.run('chart-data');
    else if (el.type === 'picture') this.app.run('picture-format-pane');
  }

  private onContext(e: MouseEvent) {
    e.preventDefault();
    const hit = this.topElOf(e.target);
    if (hit && !this.app.sel.includes(hit.el.id)) this.app.setSel([hit.el.id]);
    if (!hit && !this.editing) this.app.setSel([]);
    this.app.showContextMenu(e.clientX, e.clientY, hit?.el ?? null, e.target as HTMLElement);
  }

  // ---- window-level drag plumbing ----
  private startDrag(d: Drag, onMove: (e: PointerEvent) => void, onUp: (e: PointerEvent) => void) {
    this.drag = d;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - d.sx;
      const dy = ev.clientY - d.sy;
      if (!d.moved && Math.hypot(dx, dy) < 3) return;
      d.moved = true;
      onMove(ev);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.drag = null;
      onUp(ev);
      this.overlay.querySelectorAll('.guide, .marquee, .draw-preview').forEach((n) => n.remove());
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // ---- move ----
  private beginMove(ev: PointerEvent, anchorId: string) {
    if (this.app.tool) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (!this.app.sel.includes(anchorId)) this.app.setSel([anchorId]);
    const items = this.selected().filter((e) => !e.locked);
    if (!items.length) return;
    const orig = new Map(items.map((e) => [e.id, { x: e.x, y: e.y }]));
    const start = this.toSlide(ev.clientX, ev.clientY);
    const others = this.els().filter((e) => !orig.has(e.id) && !e.hidden);
    const startBounds = unionBounds(items);
    const click = this.clickPending;
    this.clickPending = null;
    const d: Drag = { kind: 'move', sx: ev.clientX, sy: ev.clientY, moved: false };
    this.startDrag(
      d,
      (e) => {
        const p = this.toSlide(e.clientX, e.clientY);
        let dx = p.x - start.x;
        let dy = p.y - start.y;
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        const guides: { x?: number; y?: number }[] = [];
        if (!e.altKey && this.app.snapOn) {
          const snapped = this.snap({ x: startBounds.x + dx, y: startBounds.y + dy, w: startBounds.w, h: startBounds.h }, others);
          dx += snapped.dx;
          dy += snapped.dy;
          guides.push(...snapped.guides);
        }
        for (const it of items) {
          const o = orig.get(it.id)!;
          it.x = round2(o.x + dx);
          it.y = round2(o.y + dy);
          const dom = this.elDom(it.id);
          if (dom) {
            dom.style.left = `${it.x}px`;
            dom.style.top = `${it.y}px`;
          }
        }
        this.renderOverlay();
        this.drawGuides(guides);
        this.app.touch();
      },
      () => {
        if (d.moved) {
          this.app.commit(items.length > 1 ? 'Move objects' : 'Move object');
          this.render();
        } else if (click) {
          this.startTextEdit(click.id, { x: click.x, y: click.y });
        }
      },
    );
  }

  private snap(box: Rect, others: El[]): { dx: number; dy: number; guides: { x?: number; y?: number }[] } {
    const thr = 6 / this.zoom;
    const xs: number[] = [0, this.size.w / 2, this.size.w];
    const ys: number[] = [0, this.size.h / 2, this.size.h];
    for (const o of others) {
      const b = aabb(o);
      xs.push(b.x, b.x + b.w / 2, b.x + b.w);
      ys.push(b.y, b.y + b.h / 2, b.y + b.h);
    }
    const mine = (r: Rect, axis: 'x' | 'y') => (axis === 'x' ? [r.x, r.x + r.w / 2, r.x + r.w] : [r.y, r.y + r.h / 2, r.y + r.h]);
    let bestX: { d: number; at: number } | null = null;
    let bestY: { d: number; at: number } | null = null;
    for (const m of mine(box, 'x')) for (const t of xs) {
      const d = t - m;
      if (Math.abs(d) <= thr && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, at: t };
    }
    for (const m of mine(box, 'y')) for (const t of ys) {
      const d = t - m;
      if (Math.abs(d) <= thr && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, at: t };
    }
    const guides: { x?: number; y?: number }[] = [];
    if (bestX) guides.push({ x: bestX.at });
    if (bestY) guides.push({ y: bestY.at });
    return { dx: bestX?.d ?? 0, dy: bestY?.d ?? 0, guides };
  }

  private drawGuides(gs: { x?: number; y?: number }[]) {
    this.overlay.querySelectorAll('.guide').forEach((n) => n.remove());
    const z = this.zoom;
    for (const g of gs) {
      if (g.x !== undefined) this.overlay.append(h('div', { class: 'guide v', style: { left: `${g.x * z}px` } }));
      if (g.y !== undefined) this.overlay.append(h('div', { class: 'guide hz', style: { top: `${g.y * z}px` } }));
    }
  }

  // ---- resize ----
  private beginResize(ev: PointerEvent, items: El[], hd: (typeof HANDLES)[number]) {
    ev.preventDefault();
    ev.stopPropagation();
    const single = items.length === 1 ? items[0] : null;
    const box = single ? { x: single.x, y: single.y, w: single.w, h: single.h, rot: single.rot ?? 0 } : { ...unionBounds(items), rot: 0 };
    const orig = new Map(items.map((e) => [e.id, { x: e.x, y: e.y, w: e.w, h: e.h }]));
    const start = this.toSlide(ev.clientX, ev.clientY);
    const keepAspect = (single && single.type === 'picture' && hd.sx !== 0 && hd.sy !== 0) || false;
    const d: Drag = { kind: 'resize', sx: ev.clientX, sy: ev.clientY, moved: false };
    const a = (box.rot * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    this.startDrag(
      d,
      (e) => {
        const p = this.toSlide(e.clientX, e.clientY);
        const dx = p.x - start.x;
        const dy = p.y - start.y;
        // pointer movement in the element's own (rotated) frame
        const ldx = dx * cos + dy * sin;
        const ldy = -dx * sin + dy * cos;
        let nw = box.w + hd.sx * ldx * (e.ctrlKey ? 2 : 1);
        let nh = box.h + hd.sy * ldy * (e.ctrlKey ? 2 : 1);
        if (hd.sx === 0) nw = box.w;
        if (hd.sy === 0) nh = box.h;
        if ((keepAspect || e.shiftKey) && hd.sx !== 0 && hd.sy !== 0) {
          const s = Math.max(nw / box.w, nh / box.h);
          nw = box.w * s;
          nh = box.h * s;
        } else if (e.shiftKey && hd.sx !== 0 && hd.sy === 0) nh = (box.h * nw) / box.w;
        else if (e.shiftKey && hd.sy !== 0 && hd.sx === 0) nw = (box.w * nh) / box.h;
        nw = Math.max(2, nw);
        nh = Math.max(2, nh);
        // keep the opposite edge (or the centre with Ctrl) fixed
        const shiftX = e.ctrlKey ? 0 : (hd.sx * (nw - box.w)) / 2;
        const shiftY = e.ctrlKey ? 0 : (hd.sy * (nh - box.h)) / 2;
        const ncx = box.x + box.w / 2 + shiftX * cos - shiftY * sin;
        const ncy = box.y + box.h / 2 + shiftX * sin + shiftY * cos;
        const nx = ncx - nw / 2;
        const ny = ncy - nh / 2;
        if (single) {
          single.x = round2(nx);
          single.y = round2(ny);
          single.w = round2(nw);
          single.h = round2(nh);
        } else {
          const kx = nw / box.w;
          const ky = nh / box.h;
          for (const it of items) {
            const o = orig.get(it.id)!;
            it.x = round2(nx + (o.x - box.x) * kx);
            it.y = round2(ny + (o.y - box.y) * ky);
            it.w = round2(o.w * kx);
            it.h = round2(o.h * ky);
          }
        }
        this.livePatch(items);
      },
      () => {
        if (d.moved) {
          for (const it of items) if (it.type === 'table') tableFitToFrame(it, it.w, it.h);
          this.afterGeometryChange(items);
          this.app.commit('Resize object');
          this.render();
        }
      },
    );
  }

  /** Update the DOM of elements while dragging without a full re-render. */
  private livePatch(items: El[]) {
    for (const it of items) this.patchGeometry(it);
    this.renderOverlay();
    this.app.touch();
  }

  /** re-render a single element in place (used while its geometry changes). */
  private patchGeometry(el: El) {
    const dom = this.elDom(el.id);
    if (!dom) return;
    const c = this.app.container();
    const o = this.app.renderOpts({ editing: true });
    const tmp = document.createElement('div');
    const sc = slideContext(this.app.pres, c as any);
    void sc;
    tmp.innerHTML = this.app.elementHtml(el, o);
    const fresh = tmp.firstElementChild as HTMLElement | null;
    if (fresh) dom.replaceWith(fresh);
  }

  private afterGeometryChange(items: El[]) {
    const ctx = this.app.themeCtx();
    for (const it of items) {
      if (it.type === 'shape' && it.text && (it.text.autofit === 'shrink' || it.text.autofit === 'shape')) applyFit(it, fitShape(it, ctx, this.app.curIndex + 1, this.app.pres.slides.length));
    }
  }

  // ---- rotate ----
  private beginRotate(ev: PointerEvent, el: El) {
    ev.preventDefault();
    ev.stopPropagation();
    const cx = el.x + el.w / 2;
    const cy = el.y + el.h / 2;
    const d: Drag = { kind: 'rotate', sx: ev.clientX, sy: ev.clientY, moved: false };
    this.startDrag(
      d,
      (e) => {
        const p = this.toSlide(e.clientX, e.clientY);
        let ang = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
        if (e.shiftKey) ang = Math.round(ang / 15) * 15;
        el.rot = ((Math.round(ang * 10) / 10) % 360 + 360) % 360 || undefined;
        const dom = this.elDom(el.id);
        if (dom) dom.style.transform = el.rot ? `rotate(${el.rot}deg)` : '';
        this.renderOverlay();
        this.app.touch();
      },
      () => {
        if (d.moved) {
          this.app.commit('Rotate object');
          this.render();
        }
      },
    );
  }

  // ---- line endpoints ----
  private beginEndpoint(ev: PointerEvent, el: El, which: 'start' | 'end') {
    ev.preventDefault();
    ev.stopPropagation();
    const fh = !!el.flipH;
    const fv = !!el.flipV;
    const sp = { x: el.x + (fh ? el.w : 0), y: el.y + (fv ? el.h : 0) };
    const ep = { x: el.x + (fh ? 0 : el.w), y: el.y + (fv ? 0 : el.h) };
    const d: Drag = { kind: 'endpoint', sx: ev.clientX, sy: ev.clientY, moved: false };
    this.startDrag(
      d,
      (e) => {
        const p = this.toSlide(e.clientX, e.clientY);
        if (e.shiftKey) {
          const fixed = which === 'start' ? ep : sp;
          const dx = p.x - fixed.x;
          const dy = p.y - fixed.y;
          const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12);
          const len = Math.hypot(dx, dy);
          p.x = fixed.x + Math.cos(ang) * len;
          p.y = fixed.y + Math.sin(ang) * len;
        }
        const a = which === 'start' ? p : sp;
        const b = which === 'end' ? p : ep;
        el.x = round2(Math.min(a.x, b.x));
        el.y = round2(Math.min(a.y, b.y));
        el.w = round2(Math.abs(b.x - a.x));
        el.h = round2(Math.abs(b.y - a.y));
        el.flipH = b.x < a.x || undefined;
        el.flipV = b.y < a.y || undefined;
        this.livePatch([el]);
      },
      () => {
        if (d.moved) {
          this.app.commit('Move line end');
          this.render();
        }
      },
    );
  }

  // ---- marquee ----
  private beginMarquee(ev: PointerEvent) {
    const start = this.toSlide(ev.clientX, ev.clientY);
    const base = ev.shiftKey || ev.ctrlKey ? [...this.app.sel] : [];
    const d: Drag = { kind: 'marquee', sx: ev.clientX, sy: ev.clientY, moved: false };
    this.startDrag(
      d,
      (e) => {
        const p = this.toSlide(e.clientX, e.clientY);
        const r = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
        this.overlay.querySelectorAll('.marquee').forEach((n) => n.remove());
        this.overlay.append(h('div', { class: 'marquee', style: this.rectStyle(r.x, r.y, r.w, r.h) }));
        const inside = this.els()
          .filter((el) => !el.hidden && !el.locked)
          .filter((el) => {
            const b = aabb(el);
            return b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h;
          })
          .map((el) => el.id);
        this.app.setSel([...new Set([...base, ...inside])], true);
      },
      () => {},
    );
  }

  // ---- table cell range ----
  private beginCellDrag(ev: PointerEvent, t: TableEl, r0: number, c0: number) {
    const dom = this.elDom(t.id);
    const d: Drag = { kind: 'cells', sx: ev.clientX, sy: ev.clientY, moved: false };
    let extended = false;
    this.startDrag(
      d,
      (e) => {
        const td = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('td') as HTMLElement | null;
        if (!td || !dom?.contains(td)) return;
        const r = Number(td.dataset.r);
        const c = Number(td.dataset.c);
        if (r !== r0 || c !== c0) extended = true;
        this.app.cellSel = { id: t.id, r0, c0, r1: r, c1: c };
        this.renderOverlay();
      },
      () => {
        if (!extended) this.startTextEdit(t.id, { x: ev.clientX, y: ev.clientY }, { r: r0, c: c0 });
        else this.app.refreshUi();
      },
    );
  }

  // ---- table grips ----
  private beginGrip(ev: PointerEvent, t: TableEl, axis: 'col' | 'row', i: number) {
    ev.preventDefault();
    ev.stopPropagation();
    const orig = axis === 'col' ? [t.cols[i], t.cols[i + 1]] : [t.rows[i].h, t.rows[i + 1].h];
    const start = this.toSlide(ev.clientX, ev.clientY);
    const d: Drag = { kind: axis === 'col' ? 'colresize' : 'rowresize', sx: ev.clientX, sy: ev.clientY, moved: false };
    this.startDrag(
      d,
      (e) => {
        const p = this.toSlide(e.clientX, e.clientY);
        const delta = axis === 'col' ? p.x - start.x : p.y - start.y;
        const total = orig[0] + orig[1];
        const a = Math.max(12, Math.min(total - 12, orig[0] + delta));
        if (axis === 'col') {
          t.cols[i] = round2(a);
          t.cols[i + 1] = round2(total - a);
        } else {
          t.rows[i].h = round2(a);
          t.rows[i + 1].h = round2(total - a);
        }
        this.patchGeometry(t);
        this.renderOverlay();
        this.app.touch();
      },
      () => {
        if (d.moved) {
          this.measureTable(t);
          this.app.commit('Resize table');
          this.render();
        }
      },
    );
  }

  /** after layout, copy the real rendered row heights / total height back into the model */
  measureTable(t: TableEl) {
    const dom = this.elDom(t.id);
    const table = dom?.querySelector('table') as HTMLTableElement | null;
    if (!table) return;
    const rows = Array.from(table.rows);
    rows.forEach((tr, i) => {
      if (t.rows[i]) t.rows[i].h = round2(Math.max(t.rows[i].h, tr.offsetHeight));
    });
    t.h = round2(t.rows.reduce((a, r) => a + r.h, 0));
  }

  // ---- drawing new shapes ----
  private beginDraw(ev: PointerEvent, tool: Extract<Tool, { kind: 'shape' | 'textbox' }>) {
    const start = this.toSlide(ev.clientX, ev.clientY);
    const isLine = tool.kind === 'shape' && LINE_PRESETS.has(tool.prst);
    const d: Drag = { kind: 'draw', sx: ev.clientX, sy: ev.clientY, moved: false };
    let rect: Rect = { x: start.x, y: start.y, w: 0, h: 0 };
    let line: { x1: number; y1: number; x2: number; y2: number } = { x1: start.x, y1: start.y, x2: start.x, y2: start.y };
    this.startDrag(
      d,
      (e) => {
        const p = this.toSlide(e.clientX, e.clientY);
        let x2 = p.x;
        let y2 = p.y;
        if (e.shiftKey) {
          if (isLine) {
            const ang = Math.round(Math.atan2(y2 - start.y, x2 - start.x) / (Math.PI / 12)) * (Math.PI / 12);
            const len = Math.hypot(x2 - start.x, y2 - start.y);
            x2 = start.x + Math.cos(ang) * len;
            y2 = start.y + Math.sin(ang) * len;
          } else {
            const s = Math.max(Math.abs(x2 - start.x), Math.abs(y2 - start.y));
            x2 = start.x + Math.sign(x2 - start.x || 1) * s;
            y2 = start.y + Math.sign(y2 - start.y || 1) * s;
          }
        }
        line = { x1: start.x, y1: start.y, x2, y2 };
        rect = { x: Math.min(start.x, x2), y: Math.min(start.y, y2), w: Math.abs(x2 - start.x), h: Math.abs(y2 - start.y) };
        this.overlay.querySelectorAll('.draw-preview').forEach((n) => n.remove());
        if (isLine) {
          const z = this.zoom;
          this.overlay.append(
            h('div', { class: 'draw-preview' }, (() => {
              const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
              svg.setAttribute('style', 'position:absolute;left:0;top:0;overflow:visible');
              const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
              ln.setAttribute('x1', String(line.x1 * z));
              ln.setAttribute('y1', String(line.y1 * z));
              ln.setAttribute('x2', String(line.x2 * z));
              ln.setAttribute('y2', String(line.y2 * z));
              ln.setAttribute('stroke', 'var(--accent)');
              ln.setAttribute('stroke-width', '2');
              svg.append(ln);
              return svg as unknown as HTMLElement;
            })()),
          );
        } else this.overlay.append(h('div', { class: `draw-preview box${tool.kind === 'shape' && /ellipse|flowChartConnector/.test(tool.prst) ? ' round' : ''}`, style: this.rectStyle(rect.x, rect.y, rect.w, rect.h) }));
      },
      () => {
        this.app.setTool(null);
        if (tool.kind === 'textbox') {
          const r = d.moved && rect.w > 8 && rect.h > 8 ? rect : { x: start.x, y: start.y, w: 200, h: 36 };
          const el = this.app.insertTextBox(r);
          this.render();
          this.startTextEdit(el.id, 'end', undefined, true);
          return;
        }
        if (isLine) {
          const dragged = d.moved && Math.hypot(line.x2 - line.x1, line.y2 - line.y1) > 6;
          const l = dragged ? line : { x1: start.x - 60, y1: start.y, x2: start.x + 60, y2: start.y };
          const el = this.app.insertShape(tool.prst, { x: Math.min(l.x1, l.x2), y: Math.min(l.y1, l.y2), w: Math.abs(l.x2 - l.x1), h: Math.abs(l.y2 - l.y1) }, { flipH: l.x2 < l.x1 || undefined, flipV: l.y2 < l.y1 || undefined });
          void el;
        } else {
          const dragged = d.moved && rect.w > 6 && rect.h > 6;
          this.app.insertShape(tool.prst, dragged ? rect : { x: start.x - 60, y: start.y - 40, w: 120, h: 80 });
        }
        this.render();
      },
    );
  }

  // ---- ink ----
  private beginInk(ev: PointerEvent, tool: Extract<Tool, { kind: 'ink' }>) {
    const pts: [number, number][] = [];
    const first = this.toSlide(ev.clientX, ev.clientY);
    pts.push([first.x, first.y]);
    const d: Drag = { kind: 'ink', sx: ev.clientX, sy: ev.clientY, moved: true };
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('style', 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none');
    const path = document.createElementNS(svgNs, 'path');
    const css = this.app.colorCss(tool.color);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', css);
    path.setAttribute('stroke-opacity', tool.pen === 'highlighter' ? '0.5' : tool.pen === 'pencil' ? '0.85' : '1');
    path.setAttribute('stroke-width', String(tool.w * this.zoom));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
    this.overlay.append(svg);
    const z = this.zoom;
    const draw = () => path.setAttribute('d', 'M' + pts.map(([x, y]) => `${x * z},${y * z}`).join('L'));
    draw();
    this.startDrag(
      d,
      (e) => {
        const p = this.toSlide(e.clientX, e.clientY);
        const last = pts[pts.length - 1];
        if (Math.hypot(p.x - last[0], p.y - last[1]) < 0.8) return;
        pts.push([p.x, p.y]);
        draw();
      },
      () => {
        svg.remove();
        if (pts.length < 2) pts.push([pts[0][0] + 0.1, pts[0][1] + 0.1]);
        this.app.insertInk(pts, tool);
        this.render();
      },
    );
  }

  private beginErase(ev: PointerEvent) {
    const d: Drag = { kind: 'erase', sx: ev.clientX, sy: ev.clientY, moved: true };
    const removed = new Set<string>();
    const hitTest = (e: PointerEvent) => {
      const t = document.elementFromPoint(e.clientX, e.clientY);
      const hit = this.topElOf(t);
      if (hit && hit.el.type === 'shape' && hit.el.ink && !removed.has(hit.el.id)) {
        removed.add(hit.el.id);
        const dom = this.elDom(hit.el.id);
        if (dom) dom.style.opacity = '0.15';
      }
    };
    hitTest(ev);
    this.startDrag(d, hitTest, () => {
      if (removed.size) {
        this.app.mutate('Erase ink', () => {
          const c = this.app.container();
          c.elements = c.elements.filter((e) => !removed.has(e.id));
        });
        this.app.setSel([]);
      }
      this.render();
    });
  }

  // -------------------------------------------------------------------------
  // Text editing
  // -------------------------------------------------------------------------
  startTextEdit(id: string, at?: { x: number; y: number } | 'end' | 'all', cell?: { r: number; c: number }, isNew = false) {
    if (this.app.readOnly) return;
    if (this.editing) this.endTextEdit();
    const el = this.els().find((e) => e.id === id);
    if (!el) return;
    if (el.type === 'table') {
      const rr = cell ?? { r: 0, c: 0 };
      return this.startCellEdit(el, rr.r, rr.c, at);
    }
    if (el.type !== 'shape') return;
    if (!el.text) el.text = { paras: [{ runs: [] }], lst: clone(this.app.pres.defaultText ?? []), wrap: true, insets: [7.2, 3.6, 7.2, 3.6], anchor: 'ctr', autofit: 'none' };
    this.app.setSel([id], true);
    this.forceText = id;
    this.render();
    const dom = this.elDom(id);
    const tx = dom?.querySelector('.tx') as HTMLElement | null;
    if (!dom || !tx) return;

    const body = el.text;
    const te = h('div', { class: 'te' });
    te.style.cssText = tx.style.cssText;
    te.style.setProperty('--fs', String(body.fontScale ?? 1));
    te.style.visibility = 'visible';
    tx.style.visibility = 'hidden';
    dom.append(te);
    this.teEl = te;
    const ctx = this.app.themeCtx();
    const ro = { slideNumber: this.app.curIndex + 1, slideCount: this.app.pres.slides.length, date: new Date().toLocaleDateString() };
    const editor = new TextEditor({
      body,
      ctx,
      render: ro,
      mount: te,
      onChange: (b) => this.onTextChange(el, b),
      onExit: () => this.endTextEdit(),
      onSelection: () => this.app.refreshUi(),
    });
    const { inner } = textBlockStyle(body);
    editor.view.dom.style.cssText = inner;
    this.textEditor = editor;
    this.editing = { id, wasNew: isNew };
    this.renderOverlay();
    editor.focus(at ?? 'end');
    this.app.refreshUi();
  }

  private startCellEdit(t: TableEl, r: number, c: number, at?: { x: number; y: number } | 'end' | 'all') {
    const cell = t.rows[r]?.cells[c];
    if (!cell || cell.hMerge || cell.vMerge) return;
    this.app.setSel([t.id], true);
    this.app.cellSel = { id: t.id, r0: r, c0: c, r1: r, c1: c };
    const dom = this.elDom(t.id);
    const td = dom?.querySelector(`td[data-r="${r}"][data-c="${c}"]`) as HTMLElement | null;
    if (!dom || !td) return;
    const inEl = td.querySelector('.tx-in') as HTMLElement;
    const te = h('div', { class: 'te cell' });
    te.style.cssText = 'position:relative;display:block;width:100%';
    inEl.style.display = 'none';
    td.append(te);
    this.teEl = te;
    const ctx = this.app.themeCtx();
    const editor = new TextEditor({
      body: cell.text,
      ctx,
      render: { slideNumber: this.app.curIndex + 1, slideCount: this.app.pres.slides.length },
      mount: te,
      onChange: (b) => {
        cell.text = b;
        this.app.touch();
      },
      onExit: () => this.endTextEdit(),
      onSelection: () => this.app.refreshUi(),
    });
    editor.view.dom.style.cssText = textBlockStyle(cell.text).inner;
    this.textEditor = editor;
    this.editing = { id: t.id, cell: { r, c } };
    this.renderOverlay();
    editor.focus(at ?? 'end');
    this.app.refreshUi();
  }

  private fitTimer: ReturnType<typeof setTimeout> | undefined;
  private onTextChange(el: ShapeEl, b: TextBody) {
    el.text = b;
    this.app.touch();
    if (this.fitTimer) clearTimeout(this.fitTimer);
    this.fitTimer = setTimeout(() => this.liveFit(el), 60);
  }

  /** autofit while typing: patch the wrapper and editor frame without rebuilding the DOM */
  private liveFit(el: ShapeEl) {
    if (!this.editing || !this.teEl || !el.text) return;
    const ctx = this.app.themeCtx();
    const fit = fitShape(el, ctx, this.app.curIndex + 1, this.app.pres.slides.length);
    if (applyFit(el, fit)) {
      const dom = this.elDom(el.id);
      if (dom) {
        dom.style.top = `${el.y}px`;
        dom.style.height = `${el.h}px`;
        const geo = geometryOf(el.geom, el.w, el.h);
        const [l, t, r, b] = geo.text;
        this.teEl.style.left = `${l}px`;
        this.teEl.style.top = `${t}px`;
        this.teEl.style.width = `${r - l}px`;
        this.teEl.style.height = `${b - t}px`;
        const svg = dom.querySelector('svg.geo');
        if (svg) svg.setAttribute('height', String(Math.max(1, el.h)));
      }
      this.teEl.style.setProperty('--fs', String(el.text.fontScale ?? 1));
      this.renderOverlay();
    }
  }

  endTextEdit() {
    if (!this.editing || !this.textEditor) return;
    const { id, cell } = this.editing;
    const editor = this.textEditor;
    const body = editor.destroy();
    this.teEl?.remove();
    this.teEl = null;
    this.textEditor = null;
    this.editing = null;
    this.forceText = undefined;
    const el = this.els().find((e) => e.id === id);
    if (el?.type === 'shape') {
      el.text = body;
      const empty = body.paras.every((p) => p.runs.every((r) => !r.t && !r.br && !r.field));
      if (empty && el.txBox && !el.ph) {
        this.app.container().elements = this.app.container().elements.filter((e) => e.id !== id);
        this.app.sel = [];
      } else if (el.text) applyFit(el, fitShape(el, this.app.themeCtx(), this.app.curIndex + 1, this.app.pres.slides.length));
    } else if (el?.type === 'table' && cell) {
      el.rows[cell.r].cells[cell.c].text = body;
    }
    this.render();
    if (el?.type === 'table') {
      this.measureTable(el);
      this.render();
    }
    this.app.commit('Edit text');
    this.app.refreshUi();
  }

  /** Called when something outside decides the DOM must be rebuilt while editing (e.g. undo). */
  abandonTextEdit() {
    if (!this.editing) return;
    this.textEditor?.destroy();
    this.teEl?.remove();
    this.teEl = null;
    this.textEditor = null;
    this.editing = null;
    this.forceText = undefined;
  }
}

void corners;
void newShape;
void newTextBox;
void paragraphsHtml;
