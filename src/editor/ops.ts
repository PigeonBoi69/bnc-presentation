// Pure operations on the slide model: arranging, aligning, grouping, layouts and table surgery.
// Nothing here touches the DOM, so all of it can be tested and reused by the web version later.
import {
  allElements,
  clone,
  emptyCell,
  uid,
  type Cell,
  type El,
  type GroupEl,
  type Layout,
  type Pres,
  type ShapeEl,
  type Slide,
  type TableEl,
} from '../core/model';
import { applyTableStyle, tableStyleById } from '../core/tablestyles';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
export function corners(el: Rect & { rot?: number }): [number, number][] {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const a = ((el.rot ?? 0) * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return [[-el.w / 2, -el.h / 2], [el.w / 2, -el.h / 2], [el.w / 2, el.h / 2], [-el.w / 2, el.h / 2]].map(([dx, dy]) => [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos]);
}

/** Axis-aligned bounds of a (possibly rotated) element. */
export function aabb(el: Rect & { rot?: number }): Rect {
  if (!el.rot) return { x: el.x, y: el.y, w: el.w, h: el.h };
  const pts = corners(el);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function unionBounds(els: (Rect & { rot?: number })[]): Rect {
  if (!els.length) return { x: 0, y: 0, w: 0, h: 0 };
  const bs = els.map(aabb);
  const x = Math.min(...bs.map((b) => b.x));
  const y = Math.min(...bs.map((b) => b.y));
  return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------
export const findTop = (list: El[], id: string): El | undefined => list.find((e) => e.id === id);
export const findAny = (list: El[], id: string): El | undefined => allElements(list).find((e) => e.id === id);

export function cloneEl(el: El): El {
  const c = clone(el);
  const renew = (e: El) => {
    e.id = uid();
    if (e.type === 'group') e.children.forEach(renew);
  };
  renew(c);
  return c;
}

// ---------------------------------------------------------------------------
// Z-order
// ---------------------------------------------------------------------------
export type ArrangeMode = 'front' | 'back' | 'forward' | 'backward';
export function arrange(list: El[], ids: string[], mode: ArrangeMode) {
  const set = new Set(ids);
  const picked = list.filter((e) => set.has(e.id));
  if (!picked.length) return;
  if (mode === 'front' || mode === 'back') {
    const rest = list.filter((e) => !set.has(e.id));
    list.splice(0, list.length, ...(mode === 'front' ? [...rest, ...picked] : [...picked, ...rest]));
    return;
  }
  if (mode === 'forward') {
    for (let i = list.length - 2; i >= 0; i--) if (set.has(list[i].id) && !set.has(list[i + 1].id)) [list[i], list[i + 1]] = [list[i + 1], list[i]];
  } else {
    for (let i = 1; i < list.length; i++) if (set.has(list[i].id) && !set.has(list[i - 1].id)) [list[i], list[i - 1]] = [list[i - 1], list[i]];
  }
}

// ---------------------------------------------------------------------------
// Align / distribute / flip / rotate
// ---------------------------------------------------------------------------
export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export function align(els: El[], mode: AlignMode, within: Rect) {
  for (const e of els) {
    const b = aabb(e);
    let dx = 0;
    let dy = 0;
    if (mode === 'left') dx = within.x - b.x;
    else if (mode === 'center') dx = within.x + within.w / 2 - (b.x + b.w / 2);
    else if (mode === 'right') dx = within.x + within.w - (b.x + b.w);
    else if (mode === 'top') dy = within.y - b.y;
    else if (mode === 'middle') dy = within.y + within.h / 2 - (b.y + b.h / 2);
    else dy = within.y + within.h - (b.y + b.h);
    e.x = round2(e.x + dx);
    e.y = round2(e.y + dy);
  }
}

export function distribute(els: El[], axis: 'h' | 'v') {
  if (els.length < 3) return;
  const sorted = [...els].sort((a, b) => (axis === 'h' ? aabb(a).x - aabb(b).x : aabb(a).y - aabb(b).y));
  const first = aabb(sorted[0]);
  const last = aabb(sorted[sorted.length - 1]);
  const total = sorted.reduce((s, e) => s + (axis === 'h' ? aabb(e).w : aabb(e).h), 0);
  const span = axis === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y;
  const gap = (span - total) / (sorted.length - 1);
  let pos = axis === 'h' ? first.x : first.y;
  for (const e of sorted) {
    const b = aabb(e);
    if (axis === 'h') e.x = round2(e.x + (pos - b.x));
    else e.y = round2(e.y + (pos - b.y));
    pos += (axis === 'h' ? b.w : b.h) + gap;
  }
}

export function flipEls(els: El[], axis: 'h' | 'v') {
  const b = unionBounds(els);
  for (const e of els) {
    if (axis === 'h') {
      e.flipH = !e.flipH || undefined;
      e.x = round2(b.x + b.w - (e.x - b.x) - e.w);
    } else {
      e.flipV = !e.flipV || undefined;
      e.y = round2(b.y + b.h - (e.y - b.y) - e.h);
    }
    if (e.rot) e.rot = (360 - e.rot) % 360;
  }
}

export function rotateEls(els: El[], deg: number) {
  for (const e of els) e.rot = (((e.rot ?? 0) + deg) % 360 + 360) % 360 || undefined;
}

// ---------------------------------------------------------------------------
// Group / ungroup
// ---------------------------------------------------------------------------
export function groupEls(list: El[], ids: string[]): GroupEl | null {
  const picked = list.filter((e) => ids.includes(e.id));
  if (picked.length < 2) return null;
  const b = unionBounds(picked);
  const topIndex = Math.max(...picked.map((e) => list.indexOf(e)));
  const children = picked.map((e) => {
    const c = clone(e);
    c.x = round2(c.x - b.x);
    c.y = round2(c.y - b.y);
    return c;
  });
  const g: GroupEl = { id: uid(), type: 'group', name: 'Group', x: round2(b.x), y: round2(b.y), w: round2(b.w), h: round2(b.h), cw: round2(b.w), ch: round2(b.h), children };
  const insertAt = topIndex - (picked.length - 1);
  for (const e of picked) list.splice(list.indexOf(e), 1);
  list.splice(Math.max(0, insertAt), 0, g);
  return g;
}

export function ungroupEl(list: El[], id: string): El[] {
  const idx = list.findIndex((e) => e.id === id);
  const g = list[idx];
  if (!g || g.type !== 'group') return [];
  const sx = g.cw ? g.w / g.cw : 1;
  const sy = g.ch ? g.h / g.ch : 1;
  const gcx = g.x + g.w / 2;
  const gcy = g.y + g.h / 2;
  const a = ((g.rot ?? 0) * Math.PI) / 180;
  const out = g.children.map((c) => {
    const k = clone(c);
    k.w = round2(c.w * sx);
    k.h = round2(c.h * sy);
    let ccx = g.x + (c.x + c.w / 2) * sx;
    let ccy = g.y + (c.y + c.h / 2) * sy;
    if (g.flipH) {
      ccx = 2 * gcx - ccx;
      k.flipH = !k.flipH || undefined;
      if (k.rot) k.rot = (360 - k.rot) % 360;
    }
    if (g.flipV) {
      ccy = 2 * gcy - ccy;
      k.flipV = !k.flipV || undefined;
      if (k.rot) k.rot = (360 - k.rot) % 360;
    }
    if (g.rot) {
      const dx = ccx - gcx;
      const dy = ccy - gcy;
      ccx = gcx + dx * Math.cos(a) - dy * Math.sin(a);
      ccy = gcy + dx * Math.sin(a) + dy * Math.cos(a);
      k.rot = (((k.rot ?? 0) + g.rot) % 360 + 360) % 360;
    }
    k.x = round2(ccx - k.w / 2);
    k.y = round2(ccy - k.h / 2);
    return k;
  });
  list.splice(idx, 1, ...out);
  return out;
}

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------
const isFooterPh = (e: El) => e.type === 'shape' && !!e.ph && (e.ph.type === 'dt' || e.ph.type === 'ftr' || e.ph.type === 'sldNum');
const kindOf = (t: string) => (t === 'ctrTitle' || t === 'title' ? 'title' : t === 'subTitle' || t === 'body' || t === 'obj' ? 'body' : t);

function copyPlaceholderLook(dst: ShapeEl, src: ShapeEl) {
  dst.x = src.x;
  dst.y = src.y;
  dst.w = src.w;
  dst.h = src.h;
  dst.rot = src.rot;
  dst.ph = { ...src.ph! };
  if (src.text) {
    const keep = dst.text?.paras ?? [{ runs: [] }];
    dst.text = { ...clone(src.text), paras: keep };
  }
  if (src.fill) dst.fill = clone(src.fill);
  else delete dst.fill;
  if (src.line) dst.line = clone(src.line);
}

/** Switch a slide to another layout, moving existing content into the new placeholders where possible. */
export function applyLayout(pres: Pres, slide: Slide, layoutId: string) {
  const layout = pres.layouts.find((l) => l.id === layoutId);
  if (!layout) return;
  slide.layoutId = layout.id;
  const wanted = layout.elements.filter((e): e is ShapeEl => e.type === 'shape' && !!e.ph && !isFooterPh(e));
  const existing = slide.elements.filter((e): e is ShapeEl => e.type === 'shape' && !!e.ph && !isFooterPh(e));
  const used = new Set<string>();
  const matches = new Map<string, ShapeEl>();
  for (const w of wanted) {
    const hit =
      existing.find((e) => !used.has(e.id) && e.ph!.idx === w.ph!.idx && kindOf(e.ph!.type) === kindOf(w.ph!.type)) ??
      existing.find((e) => !used.has(e.id) && kindOf(e.ph!.type) === kindOf(w.ph!.type));
    if (hit) {
      used.add(hit.id);
      matches.set(w.id, hit);
    }
  }
  const out: El[] = [];
  // keep z-order: non-placeholders and matched ones where they were, new placeholders at the back
  const fresh: ShapeEl[] = [];
  for (const w of wanted) {
    const m = matches.get(w.id);
    if (m) copyPlaceholderLook(m, w);
    else {
      const n = clone(w);
      n.id = uid();
      n.text = { ...n.text!, paras: [{ runs: [] }] };
      fresh.push(n);
    }
  }
  for (const e of slide.elements) {
    if (e.type === 'shape' && e.ph && !isFooterPh(e) && !used.has(e.id)) {
      // an old placeholder with no home: drop it if empty, otherwise turn it into a plain text box
      const empty = !e.text || e.text.paras.every((p) => p.runs.every((r) => !r.t && !r.br && !r.field));
      if (empty) continue;
      delete e.ph;
      e.txBox = true;
    }
    out.push(e);
  }
  slide.elements = [...fresh, ...out];
}

/** Put every placeholder back where its layout wants it. */
export function resetSlide(pres: Pres, slide: Slide) {
  const layout = pres.layouts.find((l) => l.id === slide.layoutId);
  if (!layout) return;
  for (const e of slide.elements) {
    if (e.type !== 'shape' || !e.ph) continue;
    const src = layout.elements.find((l): l is ShapeEl => l.type === 'shape' && !!l.ph && (l.ph.idx === e.ph!.idx || kindOf(l.ph.type) === kindOf(e.ph!.type)) && kindOf(l.ph.type) === kindOf(e.ph!.type));
    if (src) copyPlaceholderLook(e, src);
    if (e.text) e.text.fontScale = undefined;
  }
}

export function newSlideFromLayout(pres: Pres, layout: Layout): Slide {
  const elements: El[] = [];
  for (const el of layout.elements) {
    if (el.type !== 'shape' || !el.ph || isFooterPh(el)) continue;
    const copy = clone(el);
    copy.id = uid();
    if (copy.text) copy.text = { ...copy.text, paras: [{ runs: [] }] };
    elements.push(copy);
  }
  return { id: uid('s'), layoutId: layout.id, elements };
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------
export function tableRestyle(t: TableEl) {
  applyTableStyle(t, tableStyleById(t.style.id) ?? tableStyleById('medium2-accent1'));
}

function fixSpans(t: TableEl) {
  // clear merge flags that no longer have an owner after structural edits
  const nR = t.rows.length;
  const nC = t.cols.length;
  for (let r = 0; r < nR; r++)
    for (let c = 0; c < nC; c++) {
      const cell = t.rows[r].cells[c];
      if (!cell) continue;
      if (cell.hMerge) {
        let owner: Cell | undefined;
        for (let k = c - 1; k >= 0; k--) {
          const o = t.rows[r].cells[k];
          if (o && !o.hMerge) {
            owner = o;
            break;
          }
        }
        if (!owner || (owner.gridSpan ?? 1) <= c - t.rows[r].cells.indexOf(owner)) cell.hMerge = undefined;
      }
      if (cell.vMerge) {
        let owner: Cell | undefined;
        for (let k = r - 1; k >= 0; k--) {
          const o = t.rows[k].cells[c];
          if (o && !o.vMerge) {
            owner = o;
            break;
          }
        }
        if (!owner) cell.vMerge = undefined;
      }
    }
}

export function tableInsertRow(t: TableEl, at: number, copyFrom = Math.max(0, at - 1)) {
  const src = t.rows[Math.min(copyFrom, t.rows.length - 1)];
  const row = { h: src?.h ?? 36, cells: t.cols.map(() => emptyCell()) };
  t.rows.splice(at, 0, row);
  t.h = round2(t.h + row.h);
  tableRestyle(t);
}
export function tableInsertCol(t: TableEl, at: number) {
  const w = t.cols[Math.min(Math.max(at - 1, 0), t.cols.length - 1)] ?? 100;
  t.cols.splice(at, 0, w);
  for (const r of t.rows) r.cells.splice(at, 0, emptyCell());
  t.w = round2(t.w + w);
  tableRestyle(t);
}
export function tableDeleteRow(t: TableEl, at: number) {
  if (t.rows.length <= 1) return false;
  t.h = round2(t.h - t.rows[at].h);
  t.rows.splice(at, 1);
  fixSpans(t);
  tableRestyle(t);
  return true;
}
export function tableDeleteCol(t: TableEl, at: number) {
  if (t.cols.length <= 1) return false;
  t.w = round2(t.w - t.cols[at]);
  t.cols.splice(at, 1);
  for (const r of t.rows) r.cells.splice(at, 1);
  fixSpans(t);
  tableRestyle(t);
  return true;
}

export function tableMerge(t: TableEl, r0: number, c0: number, r1: number, c1: number) {
  const top = Math.min(r0, r1);
  const bot = Math.max(r0, r1);
  const left = Math.min(c0, c1);
  const right = Math.max(c0, c1);
  if (top === bot && left === right) return;
  const owner = t.rows[top].cells[left];
  const texts: string[] = [];
  for (let r = top; r <= bot; r++)
    for (let c = left; c <= right; c++) {
      const cell = t.rows[r].cells[c];
      if ((r !== top || c !== left) && cell.text.paras.some((p) => p.runs.length)) {
        owner.text.paras.push(...cell.text.paras.filter((p) => p.runs.length));
        texts.push('x');
      }
      if (r !== top || c !== left) {
        cell.hMerge = r === top ? true : c > left ? true : undefined;
        cell.vMerge = r > top ? true : undefined;
        if (r > top && c > left) cell.hMerge = true;
        cell.text = { ...cell.text, paras: [{ runs: [] }] };
      }
    }
  owner.gridSpan = right - left + 1 > 1 ? right - left + 1 : undefined;
  owner.rowSpan = bot - top + 1 > 1 ? bot - top + 1 : undefined;
}

export function tableSplit(t: TableEl, r: number, c: number) {
  const cell = t.rows[r].cells[c];
  const gs = cell.gridSpan ?? 1;
  const rs = cell.rowSpan ?? 1;
  for (let rr = r; rr < r + rs; rr++)
    for (let cc = c; cc < c + gs; cc++) {
      const k = t.rows[rr]?.cells[cc];
      if (k) {
        k.hMerge = undefined;
        k.vMerge = undefined;
      }
    }
  cell.gridSpan = undefined;
  cell.rowSpan = undefined;
}

export function tableEqualCols(t: TableEl) {
  const w = t.w / t.cols.length;
  t.cols = t.cols.map(() => round2(w));
}
export function tableEqualRows(t: TableEl) {
  const h = t.h / t.rows.length;
  t.rows.forEach((r) => (r.h = round2(h)));
}

/** Scale the table's own grid to a new frame size (used when the frame is resized). */
export function tableFitToFrame(t: TableEl, w: number, h: number) {
  const sx = t.w ? w / t.w : 1;
  const sy = t.h ? h / t.h : 1;
  t.cols = t.cols.map((c) => round2(c * sx));
  t.rows.forEach((r) => (r.h = round2(r.h * sy)));
  t.w = w;
  t.h = h;
}

export function blankLike<T extends El>(e: T): T {
  return cloneEl(e) as T;
}
