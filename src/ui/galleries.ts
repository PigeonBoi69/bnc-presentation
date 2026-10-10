// Dropdown galleries: shapes, layouts, themes, transitions and animations, with little previews.
import type { App } from '../app';
import { geometryOf, LINE_PRESETS, SHAPE_GALLERY } from '../core/geometry';
import { THEMES, type ThemeDef } from '../core/model';
import { renderSlideInto } from '../core/render';
import { h, popover } from './dom';

export function shapePreview(prst: string, size = 22, color = 'currentColor'): SVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  const isLine = LINE_PRESETS.has(prst);
  const pad = 2.5;
  const w = size - pad * 2;
  const hh = isLine ? w : size - pad * 2;
  const geo = geometryOf({ prst }, w, hh);
  const g = document.createElementNS(ns, 'g');
  g.setAttribute('transform', `translate(${pad},${pad})`);
  for (const p of geo.paths) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', p.d);
    path.setAttribute('fill', p.fill === 'none' || isLine ? 'none' : p.fill === 'darken' ? 'rgba(0,0,0,.25)' : p.fill === 'lighten' ? 'rgba(255,255,255,.3)' : color);
    path.setAttribute('fill-opacity', p.fill === 'norm' ? '0.18' : '1');
    path.setAttribute('stroke', p.stroke ? color : 'none');
    path.setAttribute('stroke-width', '1.2');
    path.setAttribute('stroke-linejoin', 'round');
    g.append(path);
  }
  svg.append(g);
  return svg;
}

export function shapeGallery(anchor: HTMLElement, onPick: (prst: string) => void) {
  let close = () => {};
  const body = h('div', { class: 'gallery shapes' });
  for (const g of SHAPE_GALLERY) {
    body.append(h('div', { class: 'gal-head', text: g.group }));
    const grid = h('div', { class: 'gal-grid shapegrid' });
    for (const it of g.items) {
      grid.append(
        h('button', { class: 'gal-tile', title: it.label, on: { click: () => { close(); onPick(it.id); } } }, shapePreview(it.id, 26)),
      );
    }
    body.append(grid);
  }
  close = popover(anchor, body, { className: 'gallery-pop' });
}

export function layoutGallery(app: App, anchor: HTMLElement, onPick: (layoutId: string) => void, current?: string) {
  let close = () => {};
  const pres = app.pres;
  const cur = app.curSlide();
  const masterId = pres.layouts.find((l) => l.id === cur.layoutId)?.masterId ?? pres.masters[0].id;
  const body = h('div', { class: 'gallery layouts' }, h('div', { class: 'gal-head', text: pres.masters.find((m) => m.id === masterId)?.name ?? 'Layouts' }));
  const grid = h('div', { class: 'gal-grid layoutgrid' });
  const scale = 150 / pres.size.w;
  for (const l of pres.layouts.filter((x) => x.masterId === masterId)) {
    const frame = h('div', { class: 'lay-frame', style: { width: `${150}px`, height: `${pres.size.h * scale}px` } });
    const inner = h('div');
    renderSlideInto(inner, l, app.renderOpts({ editing: true }));
    inner.style.transform = `scale(${scale})`;
    frame.append(inner);
    grid.append(
      h('button', { class: `gal-tile lay${current === l.id ? ' on' : ''}`, title: l.name, on: { click: () => { close(); onPick(l.id); } } }, frame, h('span', { text: l.name })),
    );
  }
  body.append(grid);
  close = popover(anchor, body, { className: 'gallery-pop' });
}

export function themeTile(t: ThemeDef, small = false): HTMLElement {
  const bg = t.colors.lt1;
  const tile = h('div', { class: `theme-tile${small ? ' small' : ''}`, style: { background: bg, color: t.colors.dk1 } });
  tile.append(
    h('span', { class: 'aa', text: 'Aa', style: { fontFamily: `'${t.fonts.minor}', 'Segoe UI', sans-serif`, color: t.colors.dk1 } }),
    h('span', { class: 'swatches' }, ...(['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const).map((k) => h('i', { style: { background: t.colors[k] } }))),
  );
  return tile;
}

export function themeGallery(anchor: HTMLElement, onPick: (index: number) => void, currentName?: string) {
  let close = () => {};
  const body = h('div', { class: 'gallery themes' }, h('div', { class: 'gal-head', text: 'Built-in' }));
  const grid = h('div', { class: 'gal-grid themegrid' });
  THEMES.forEach((t, i) => {
    grid.append(h('button', { class: `gal-tile${currentName === t.name ? ' on' : ''}`, title: t.name, on: { click: () => { close(); onPick(i); } } }, themeTile(t), h('span', { text: t.name })));
  });
  body.append(grid);
  close = popover(anchor, body, { className: 'gallery-pop' });
}

export const VARIANTS: { id: string; label: string; map: { bg1: string; tx1: string; bg2: string; tx2: string } }[] = [
  { id: 'light', label: 'Light', map: { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' } },
  { id: 'dark', label: 'Dark', map: { bg1: 'dk1', tx1: 'lt1', bg2: 'dk2', tx2: 'lt2' } },
  { id: 'soft', label: 'Soft', map: { bg1: 'lt2', tx1: 'dk1', bg2: 'lt1', tx2: 'dk2' } },
  { id: 'contrast', label: 'Contrast', map: { bg1: 'dk2', tx1: 'lt1', bg2: 'dk1', tx2: 'lt2' } },
];

export function variantTile(t: ThemeDef, map: (typeof VARIANTS)[number]['map']): HTMLElement {
  const colors = t.colors as Record<string, string>;
  const bg = colors[map.bg1];
  const fg = colors[map.tx1];
  return h('div', { class: 'theme-tile small', style: { background: bg, color: fg } },
    h('span', { class: 'aa', text: 'Aa', style: { color: fg, fontFamily: `'${t.fonts.minor}', 'Segoe UI', sans-serif` } }),
    h('span', { class: 'swatches' }, ...(['accent1', 'accent2', 'accent3', 'accent4'] as const).map((k) => h('i', { style: { background: t.colors[k] } }))));
}

// ---------------------------------------------------------------------------
// Transition and animation tiles
// ---------------------------------------------------------------------------
export interface FxInfo {
  id: string;
  label: string;
  cls?: 'entr' | 'exit' | 'emph';
  dirs?: { id: string; label: string }[];
}

const DIRS4 = [{ id: 'l', label: 'From Left' }, { id: 'r', label: 'From Right' }, { id: 't', label: 'From Top' }, { id: 'b', label: 'From Bottom' }];

export const TRANSITIONS: FxInfo[] = [
  { id: 'none', label: 'None' },
  { id: 'fade', label: 'Fade' },
  { id: 'push', label: 'Push', dirs: DIRS4 },
  { id: 'wipe', label: 'Wipe', dirs: DIRS4 },
  { id: 'split', label: 'Split', dirs: [{ id: 'horz', label: 'Horizontal' }, { id: 'vert', label: 'Vertical' }] },
  { id: 'pull', label: 'Reveal', dirs: DIRS4 },
  { id: 'cover', label: 'Cover', dirs: DIRS4 },
  { id: 'zoom', label: 'Zoom', dirs: [{ id: 'in', label: 'In' }, { id: 'out', label: 'Out' }] },
  { id: 'dissolve', label: 'Dissolve' },
  { id: 'cut', label: 'Cut' },
];

export const ENTRANCE: FxInfo[] = [
  { id: 'appear', label: 'Appear', cls: 'entr' },
  { id: 'fade', label: 'Fade', cls: 'entr' },
  { id: 'fly', label: 'Fly In', cls: 'entr', dirs: DIRS4 },
  { id: 'float', label: 'Float In', cls: 'entr' },
  { id: 'wipe', label: 'Wipe', cls: 'entr', dirs: DIRS4 },
  { id: 'zoom', label: 'Zoom', cls: 'entr' },
  { id: 'split', label: 'Split', cls: 'entr' },
  { id: 'wheel', label: 'Wheel', cls: 'entr' },
  { id: 'bounce', label: 'Bounce', cls: 'entr' },
];
export const EMPHASIS: FxInfo[] = [
  { id: 'pulse', label: 'Pulse', cls: 'emph' },
  { id: 'spin', label: 'Spin', cls: 'emph' },
  { id: 'grow', label: 'Grow/Shrink', cls: 'emph' },
];
export const EXITS: FxInfo[] = [
  { id: 'appear', label: 'Disappear', cls: 'exit' },
  { id: 'fade', label: 'Fade', cls: 'exit' },
  { id: 'fly', label: 'Fly Out', cls: 'exit', dirs: DIRS4 },
  { id: 'wipe', label: 'Wipe', cls: 'exit', dirs: DIRS4 },
  { id: 'zoom', label: 'Zoom', cls: 'exit' },
];

export function fxIcon(id: string): SVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '34');
  svg.setAttribute('height', '26');
  svg.setAttribute('viewBox', '0 0 34 26');
  const rect = (x: number, y: number, w: number, hh: number, o = 0.9) => `<rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="2" fill="currentColor" fill-opacity="${o}"/>`;
  const frame = '<rect x="1" y="1" width="32" height="24" rx="3" fill="none" stroke="currentColor" stroke-opacity=".45"/>';
  const map: Record<string, string> = {
    none: '<path d="M8 5l18 16M26 5L8 21" stroke="currentColor" stroke-opacity=".4" stroke-width="1.6"/>',
    fade: rect(7, 6, 20, 14, 0.35) + rect(10, 9, 14, 8, 0.8),
    push: rect(2, 5, 14, 16, 0.4) + rect(14, 5, 14, 16, 0.9) + '<path d="M29 13h-4m2-2l2 2-2 2" stroke="currentColor" fill="none"/>',
    wipe: rect(4, 5, 12, 16, 0.9) + rect(16, 5, 14, 16, 0.25),
    split: rect(4, 5, 11, 16, 0.9) + rect(19, 5, 11, 16, 0.9),
    pull: rect(4, 5, 26, 16, 0.25) + rect(4, 5, 14, 16, 0.85),
    cover: rect(4, 5, 26, 16, 0.25) + rect(12, 5, 18, 16, 0.9),
    zoom: rect(12, 8, 10, 10, 0.9) + '<rect x="6" y="4" width="22" height="18" rx="2" fill="none" stroke="currentColor" stroke-opacity=".5"/>',
    dissolve: Array.from({ length: 18 }, (_, i) => rect(5 + (i % 6) * 4.4, 6 + Math.floor(i / 6) * 5, 3, 3.4, i % 3 === 0 ? 0.3 : 0.9)).join(''),
    cut: rect(5, 5, 24, 16, 0.9),
    appear: rect(10, 7, 14, 12, 0.9),
    fly: rect(14, 7, 14, 12, 0.9) + '<path d="M2 13h8" stroke="currentColor" stroke-dasharray="2 2"/>',
    float: rect(10, 4, 14, 12, 0.9) + '<path d="M17 22v-3" stroke="currentColor" stroke-dasharray="1 2"/>',
    zoomfx: rect(12, 8, 10, 10, 0.9),
    wheel: '<circle cx="17" cy="13" r="8" fill="currentColor" fill-opacity=".85"/><path d="M17 13V5M17 13l7 4M17 13l-7 4" stroke="var(--surface-2)" stroke-width="1.5"/>',
    bounce: '<circle cx="17" cy="9" r="4" fill="currentColor"/><path d="M8 22h18" stroke="currentColor" stroke-opacity=".5"/>',
    pulse: rect(8, 6, 18, 14, 0.9) + '<rect x="5" y="3" width="24" height="20" rx="3" fill="none" stroke="currentColor" stroke-opacity=".4"/>',
    spin: '<path d="M17 4a9 9 0 1 1-9 9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 9l3 4 4-3" fill="none" stroke="currentColor" stroke-width="1.6"/>',
    grow: rect(11, 8, 12, 10, 0.9) + '<path d="M5 4l4 4M29 22l-4-4M29 4l-4 4M5 22l4-4" stroke="currentColor" stroke-opacity=".6"/>',
  };
  svg.innerHTML = frame + (map[id] ?? map.fade);
  return svg;
}

export function fxGallery(anchor: HTMLElement, sections: { head: string; items: FxInfo[] }[], onPick: (fx: FxInfo) => void, currentId?: string) {
  let close = () => {};
  const body = h('div', { class: 'gallery fx' });
  for (const s of sections) {
    body.append(h('div', { class: 'gal-head', text: s.head }));
    const grid = h('div', { class: 'gal-grid fxgrid' });
    for (const it of s.items) {
      grid.append(h('button', { class: `gal-tile${currentId === it.id ? ' on' : ''}`, title: it.label, on: { click: () => { close(); onPick(it); } } }, fxIcon(it.id), h('span', { text: it.label })));
    }
    body.append(grid);
  }
  close = popover(anchor, body, { className: 'gallery-pop' });
}
