// Side panes: Format (shape / picture / text options), Animations, Comments and the Selection pane.
import type { App } from '../app';
import { css } from '../core/color';
import { allElements, slideTitle, uid, type Color, type El, type Fill, type Line, type PictureEl, type ShapeEl, type SlideComment } from '../core/model';
import { LINE_PRESETS } from '../core/geometry';
import { applyFit, fitShape } from '../editor/measure';
import { tableFitToFrame } from '../editor/ops';
import { h, iconEl, selectEl, toast } from './dom';
import { fxIcon, ENTRANCE, EMPHASIS, EXITS } from './galleries';
import { colorPicker } from './pickers';

const round = (n: number) => Math.round(n * 100) / 100;

function pane(title: string, app: App, ...body: (HTMLElement | null)[]): HTMLElement {
  return h('div', { class: 'pane' }, h('div', { class: 'pane-head' }, h('span', { text: title }), h('button', { class: 'icon-btn', title: 'Close', on: { click: () => app.showPane(null) } }, iconEl('close', 14))), h('div', { class: 'pane-body' }, ...body));
}

function section(title: string, open: boolean, ...kids: (HTMLElement | null)[]): HTMLElement {
  const body = h('div', { class: 'sec-body' }, ...kids);
  const head = h('button', { class: 'sec-head' }, iconEl(open ? 'chevron' : 'chevronRight', 12), h('span', { text: title }));
  const box = h('div', { class: 'psec' }, head, body);
  body.style.display = open ? '' : 'none';
  head.addEventListener('click', () => {
    const show = body.style.display === 'none';
    body.style.display = show ? '' : 'none';
    head.firstElementChild!.replaceWith(iconEl(show ? 'chevron' : 'chevronRight', 12));
  });
  return box;
}

function row(label: string, ...ctl: HTMLElement[]): HTMLElement {
  return h('div', { class: 'prow' }, h('span', { class: 'plabel', text: label }), h('span', { class: 'pctl' }, ...ctl));
}

function num(value: number | undefined, step: number, on: (v: number) => void, min = -10000): HTMLInputElement {
  const i = h('input', { class: 'input small', value: value === undefined ? '' : String(round(value)), attrs: { type: 'number', step: String(step), min: String(min) } });
  i.addEventListener('change', () => {
    const v = parseFloat(i.value);
    if (Number.isFinite(v)) on(v);
  });
  return i;
}

function colorBtn(app: App, title: string, get: () => Color | undefined | null, set: (c: Color | null) => void, none?: string): HTMLElement {
  const ctx = app.themeCtx();
  const c = get();
  const sw = h('span', { class: 'swatch-inline', style: { background: c ? css(c, ctx) : 'transparent' } });
  const b = h('button', { class: 'btn small', style: { display: 'inline-flex', gap: '6px', alignItems: 'center' } }, sw, c ? 'Color' : 'None');
  b.addEventListener('click', () => colorPicker(b, { title, ctx, noneLabel: none, onPick: (col) => set(col) }));
  return b;
}

// ---------------------------------------------------------------------------
// Format pane
// ---------------------------------------------------------------------------
export function formatPane(app: App): HTMLElement {
  const els = app.selectedEls();
  if (!els.length) return pane('Format', app, h('p', { class: 'muted', text: 'Select an object to see its formatting options.' }));
  const el = els[0];
  const key = `fmt-${el.id}`;
  const m = (label: string, fn: (e: El) => void, k = true) => app.mutate(label, () => els.forEach(fn), k ? key + label : undefined);
  const parts: HTMLElement[] = [];

  // ---- size & position
  parts.push(
    section('Size & Position', true,
      row('Left', num(els.length === 1 ? el.x / 72 : undefined, 0.05, (v) => app.run('object-size', { x: v * 72 }))),
      row('Top', num(els.length === 1 ? el.y / 72 : undefined, 0.05, (v) => app.run('object-size', { y: v * 72 }))),
      row('Width', num(els.length === 1 ? el.w / 72 : undefined, 0.05, (v) => app.run('object-size', { w: v * 72 }), 0.01)),
      row('Height', num(els.length === 1 ? el.h / 72 : undefined, 0.05, (v) => app.run('object-size', { h: v * 72 }), 0.01)),
      row('Rotation', num(els.length === 1 ? (el.rot ?? 0) : undefined, 5, (v) => app.run('object-size', { rot: v }))),
      el.type === 'picture' ? null : null,
    ),
  );

  if (el.type === 'shape') {
    const sh = el as ShapeEl;
    const isLine = 'prst' in sh.geom && LINE_PRESETS.has(sh.geom.prst);
    const fillKind = !sh.fill || sh.fill.t === 'none' ? 'none' : sh.fill.t === 'grad' ? 'grad' : sh.fill.t === 'pic' ? 'pic' : 'solid';
    if (!isLine) {
      parts.push(
        section('Fill', true,
          row('Fill', selectEl([['none', 'No fill'], ['solid', 'Solid'], ['grad', 'Gradient']], fillKind === 'pic' ? 'solid' : fillKind, (v) => m('Fill', (e) => {
            const s = e as ShapeEl;
            if (v === 'none') s.fill = { t: 'none' };
            else if (v === 'solid') s.fill = { t: 'solid', c: s.fill?.t === 'solid' ? s.fill.c : { theme: 'accent1' } };
            else s.fill = { t: 'grad', stops: [{ pos: 0, c: { theme: 'accent1' } }, { pos: 1, c: { theme: 'accent1', lumMod: 0.5 } }], ang: 90, kind: 'linear' };
          }, false)).also(app)),
          fillKind === 'solid' ? row('Color', colorBtn(app, 'Fill', () => (sh.fill?.t === 'solid' ? sh.fill.c : undefined), (c) => m('Fill', (e) => ((e as ShapeEl).fill = c ? { t: 'solid', c } : { t: 'none' }), false), 'No Fill')) : null,
          fillKind === 'grad' && sh.fill?.t === 'grad' ? row('From', colorBtn(app, 'From', () => (sh.fill as Extract<Fill, { t: 'grad' }>).stops[0].c, (c) => c && m('Fill', (e) => { const f = (e as ShapeEl).fill; if (f?.t === 'grad') f.stops[0].c = c; }, false))) : null,
          fillKind === 'grad' && sh.fill?.t === 'grad' ? row('To', colorBtn(app, 'To', () => (sh.fill as Extract<Fill, { t: 'grad' }>).stops.at(-1)!.c, (c) => c && m('Fill', (e) => { const f = (e as ShapeEl).fill; if (f?.t === 'grad') f.stops[f.stops.length - 1].c = c; }, false))) : null,
          fillKind === 'grad' && sh.fill?.t === 'grad' ? row('Angle', num(sh.fill.ang, 15, (v) => m('Fill', (e) => { const f = (e as ShapeEl).fill; if (f?.t === 'grad') f.ang = v; }))) : null,
          fillKind === 'solid' ? row('Transparency', rangeInput(0, 100, sh.fill?.t === 'solid' && typeof sh.fill.c === 'object' ? Math.round((1 - (sh.fill.c.alpha ?? 1)) * 100) : sh.fill?.t === 'solid' && typeof sh.fill.c === 'string' && sh.fill.c.length === 9 ? Math.round((1 - parseInt(sh.fill.c.slice(7), 16) / 255) * 100) : 0, (v) => m('Transparency', (e) => setFillAlpha(e as ShapeEl, 1 - v / 100)))) : null,
        ),
      );
    }
    const ln: Line | undefined = sh.line;
    parts.push(
      section('Line', true,
        row('Line', selectEl([['none', 'No line'], ['solid', 'Solid line']], ln && ln.c ? 'solid' : 'none', (v) => m('Line', (e) => {
          const s = e as ShapeEl;
          s.line = v === 'none' ? { ...(s.line ?? { w: 1 }), c: null } : { ...(s.line ?? { w: 1 }), c: s.line?.c ?? { theme: 'accent1', lumMod: 0.75 }, w: s.line?.w || 1 };
        }, false)).also(app)),
        ln && ln.c ? row('Color', colorBtn(app, 'Line', () => ln.c, (c) => m('Line', (e) => { const s = e as ShapeEl; s.line = { ...(s.line ?? { w: 1 }), c }; }, false), 'No Line')) : null,
        ln && ln.c ? row('Width (pt)', num(ln.w, 0.25, (v) => m('Line', (e) => { const s = e as ShapeEl; if (s.line) s.line.w = v; }), 0)) : null,
        ln && ln.c ? row('Dash', selectEl([['solid', 'Solid'], ['dot', 'Round dot'], ['sysDot', 'Square dot'], ['dash', 'Dash'], ['lgDash', 'Long dash'], ['dashDot', 'Dash dot']], ln.dash ?? 'solid', (v) => m('Line', (e) => { const s = e as ShapeEl; if (s.line) s.line.dash = v as Line['dash']; }, false))) : null,
        isLine ? row('Begin arrow', selectEl([['', 'None'], ['triangle', 'Arrow'], ['stealth', 'Stealth'], ['oval', 'Oval'], ['diamond', 'Diamond']], ln?.head?.type ?? '', (v) => m('Line', (e) => { const s = e as ShapeEl; if (s.line) s.line.head = v ? { type: v as any } : undefined; }, false))) : null,
        isLine ? row('End arrow', selectEl([['', 'None'], ['triangle', 'Arrow'], ['stealth', 'Stealth'], ['oval', 'Oval'], ['diamond', 'Diamond']], ln?.tail?.type ?? '', (v) => m('Line', (e) => { const s = e as ShapeEl; if (s.line) s.line.tail = v ? { type: v as any } : undefined; }, false))) : null,
        ln && ln.c && !isLine ? row('Corners', selectEl([['miter', 'Miter'], ['round', 'Round'], ['bevel', 'Bevel']], ln.join ?? 'miter', (v) => m('Line', (e) => { const s = e as ShapeEl; if (s.line) s.line.join = v as Line['join']; }, false))) : null,
      ),
    );
    const sd = sh.fx?.shadow;
    parts.push(
      section('Effects', false,
        row('Shadow', selectEl([['none', 'None'], ['on', 'Outer']], sd ? 'on' : 'none', (v) => m('Shadow', (e) => { const s = e as ShapeEl; s.fx = { ...(s.fx ?? {}), shadow: v === 'on' ? { c: '#000000', blur: 8, dist: 4, dir: 45, alpha: 0.4 } : undefined }; }, false)).also(app)),
        sd ? row('Blur', num(sd.blur, 1, (v) => m('Shadow', (e) => { const x = (e as ShapeEl).fx?.shadow; if (x) x.blur = v; }), 0)) : null,
        sd ? row('Distance', num(sd.dist, 1, (v) => m('Shadow', (e) => { const x = (e as ShapeEl).fx?.shadow; if (x) x.dist = v; }), 0)) : null,
        sd ? row('Angle', num(sd.dir, 15, (v) => m('Shadow', (e) => { const x = (e as ShapeEl).fx?.shadow; if (x) x.dir = v; }))) : null,
        sd ? row('Transparency', rangeInput(0, 100, Math.round((1 - (sd.alpha ?? 0.4)) * 100), (v) => m('Shadow', (e) => { const x = (e as ShapeEl).fx?.shadow; if (x) x.alpha = 1 - v / 100; }))) : null,
        row('Glow', num(sh.fx?.glow?.r ?? 0, 1, (v) => m('Glow', (e) => { const s = e as ShapeEl; s.fx = { ...(s.fx ?? {}), glow: v > 0 ? { c: { theme: 'accent1' }, r: v } : undefined }; }), 0)),
      ),
    );
    if (!isLine) {
      const tb = sh.text;
      parts.push(
        section('Text Box', false,
          row('Vertical align', selectEl([['t', 'Top'], ['ctr', 'Middle'], ['b', 'Bottom']], tb?.anchor ?? 't', (v) => app.run('text-anchor', v)).also(app)),
          row('Autofit', selectEl([['none', 'Do not autofit'], ['shrink', 'Shrink text on overflow'], ['shape', 'Resize shape to fit text']], tb?.autofit ?? 'none', (v) => app.run('autofit', v)).also(app)),
          row('Wrap text', checkInput(tb?.wrap !== false, () => app.run('text-wrap'))),
          row('Left margin', num(tb?.insets?.[0] ?? 7.2, 1, (v) => setInset(app, 0, v), 0)),
          row('Top margin', num(tb?.insets?.[1] ?? 3.6, 1, (v) => setInset(app, 1, v), 0)),
          row('Right margin', num(tb?.insets?.[2] ?? 7.2, 1, (v) => setInset(app, 2, v), 0)),
          row('Bottom margin', num(tb?.insets?.[3] ?? 3.6, 1, (v) => setInset(app, 3, v), 0)),
        ),
      );
    }
  }
  if (el.type === 'picture') {
    const p = el as PictureEl;
    parts.push(
      section('Picture', true,
        row('Brightness', rangeInput(-100, 100, Math.round((p.brightness ?? 0) * 100), (v) => m('Brightness', (e) => ((e as PictureEl).brightness = v / 100 || undefined)))),
        row('Contrast', rangeInput(-100, 100, Math.round((p.contrast ?? 0) * 100), (v) => m('Contrast', (e) => ((e as PictureEl).contrast = v / 100 || undefined)))),
        row('Transparency', rangeInput(0, 100, Math.round((1 - (p.alpha ?? 1)) * 100), (v) => m('Transparency', (e) => ((e as PictureEl).alpha = v ? 1 - v / 100 : undefined)))),
        row('Black & white', checkInput(!!p.gray, () => m('Gray', (e) => ((e as PictureEl).gray = !(e as PictureEl).gray || undefined), false))),
        row('Crop', h('button', { class: 'btn small', text: 'Crop…', on: { click: () => void app.run('picture-crop') } })),
      ),
    );
  }
  const alt = h('textarea', { class: 'input', style: { height: '64px', padding: '6px' }, value: el.alt ?? '', attrs: { placeholder: 'Describe this object for accessibility' } });
  alt.addEventListener('change', () => m('Alt text', (e) => (alt.value.trim() ? (e.alt = alt.value.trim()) : delete e.alt), false));
  parts.push(section('Alt Text', false, alt));

  const name = els.length > 1 ? `${els.length} objects` : el.name;
  return pane(`Format — ${name}`, app, ...parts);
}

declare global {
  interface HTMLSelectElement {
    also(app: App): HTMLSelectElement;
  }
}
// small helper so selects re-render the pane after they change the structure of the pane
(HTMLSelectElement.prototype as any).also = function (this: HTMLSelectElement, app: App) {
  this.addEventListener('change', () => setTimeout(() => app.refreshDock(), 30));
  return this;
};

function rangeInput(min: number, max: number, value: number, on: (v: number) => void): HTMLElement {
  const r = h('input', { attrs: { type: 'range', min: String(min), max: String(max), value: String(value) }, style: { flex: '1' } });
  const label = h('span', { class: 'muted', text: `${value}%`, style: { width: '38px', textAlign: 'right' } });
  r.addEventListener('input', () => {
    label.textContent = `${r.value}%`;
    on(Number(r.value));
  });
  return h('span', { style: { display: 'flex', gap: '8px', alignItems: 'center', width: '100%' } }, r, label);
}

function checkInput(value: boolean, on: () => void): HTMLElement {
  const i = h('input', { attrs: { type: 'checkbox', ...(value ? { checked: '' } : {}) } });
  i.addEventListener('change', on);
  return i;
}

function setInset(app: App, idx: number, v: number) {
  app.mutate('Margins', () => {
    for (const e of app.selectedEls()) if (e.type === 'shape') {
      e.text ??= app.defaultShapeText(e);
      const ins = (e.text.insets ??= [7.2, 3.6, 7.2, 3.6]);
      ins[idx] = Math.max(0, v);
    }
  });
}

function setFillAlpha(s: ShapeEl, alpha: number) {
  const f = s.fill;
  if (!f || f.t !== 'solid') return;
  if (typeof f.c === 'string') {
    const hex = f.c.slice(0, 7);
    f.c = alpha >= 0.999 ? hex : hex + Math.round(alpha * 255).toString(16).padStart(2, '0');
  } else f.c = { ...f.c, alpha: alpha >= 0.999 ? undefined : alpha };
}

// ---------------------------------------------------------------------------
// Animations pane
// ---------------------------------------------------------------------------
export function animationsPane(app: App): HTMLElement {
  const slide = app.curSlide();
  const anims = slide.anims ?? [];
  const list = h('div', { class: 'anim-list' });
  const label = (a: (typeof anims)[number]) => [...ENTRANCE, ...EMPHASIS, ...EXITS].find((x) => x.id === a.effect && x.cls === a.cls)?.label ?? a.effect;
  const nameOf = (id: string) => allElements(slide.elements).find((e) => e.id === id)?.name ?? 'Object';
  if (!anims.length) list.append(h('p', { class: 'muted', text: 'No animations on this slide. Select an object and choose an effect on the Animations tab.' }));
  anims.forEach((a, i) => {
    const row_ = h('div', { class: `anim-row${app.sel.includes(a.target) ? ' sel' : ''}` },
      h('span', { class: 'anim-no', text: String(i + 1) }),
      fxIcon(a.effect),
      h('span', { class: 'anim-name' }, h('strong', { text: nameOf(a.target) }), h('small', { text: `${label(a)} · ${a.cls === 'entr' ? 'Entrance' : a.cls === 'exit' ? 'Exit' : 'Emphasis'} · ${a.trigger === 'click' ? 'On click' : a.trigger === 'with' ? 'With previous' : 'After previous'}` })),
      h('button', { class: 'icon-btn', title: 'Remove', on: { click: (e: Event) => { e.stopPropagation(); app.mutate('Remove animation', () => (slide.anims = anims.filter((x) => x !== a))); app.refreshDock(); } } }, iconEl('trash', 14)),
    );
    row_.addEventListener('click', () => app.setSel([a.target]));
    list.append(row_);
  });
  return pane('Animation Pane', app,
    h('div', { style: { display: 'flex', gap: '6px', marginBottom: '8px' } }, h('button', { class: 'btn small primary', text: '▶ Play All', on: { click: () => void app.run('anim-preview') } }), h('button', { class: 'btn small', text: '↑', title: 'Move earlier', on: { click: () => void app.run('anim-earlier') } }), h('button', { class: 'btn small', text: '↓', title: 'Move later', on: { click: () => void app.run('anim-later') } })),
    list,
  );
}

// ---------------------------------------------------------------------------
// Comments pane
// ---------------------------------------------------------------------------
export function commentsPane(app: App): HTMLElement {
  const slide = app.curSlide();
  const list = h('div', { class: 'comment-list' });
  const author = () => app.ncUser ?? 'You';
  const comments = slide.comments ?? [];
  if (!comments.length) list.append(h('p', { class: 'muted', text: 'No comments on this slide.' }));
  comments.forEach((c) => {
    const card = h('div', { class: `comment${c.done ? ' done' : ''}` },
      h('div', { class: 'c-head' }, h('span', { class: 'avatar', text: (c.author[0] ?? '?').toUpperCase() }), h('strong', { text: c.author }), h('small', { text: c.date ? new Date(c.date).toLocaleString() : '' })),
      h('div', { class: 'c-text', text: c.text }),
      ...(c.replies ?? []).map((r) => h('div', { class: 'c-reply' }, h('strong', { text: r.author }), h('div', { text: r.text }))),
      h('div', { class: 'c-actions' },
        h('button', { class: 'btn small', text: c.done ? 'Reopen' : 'Resolve', on: { click: () => { app.mutate('Resolve comment', () => (c.done = !c.done || undefined)); app.refreshDock(); } } }),
        h('button', { class: 'btn small', text: 'Reply', on: { click: () => { const t = window.prompt('Reply'); if (t) { app.mutate('Reply', () => (c.replies ??= []).push({ author: author(), text: t, date: new Date().toISOString() })); app.refreshDock(); } } } }),
        h('button', { class: 'btn small', text: 'Delete', on: { click: () => { app.mutate('Delete comment', () => (slide.comments = comments.filter((x) => x !== c))); app.refreshDock(); } } }),
      ),
    );
    list.append(card);
  });
  const input = h('textarea', { class: 'input', style: { height: '64px', padding: '6px' }, attrs: { placeholder: 'Start a conversation', id: 'comment-input' } });
  const post = h('button', { class: 'btn small primary', text: 'Post', on: { click: () => {
    const t = input.value.trim();
    if (!t) return;
    const c: SlideComment = { id: uid('c'), author: author(), text: t, date: new Date().toISOString() };
    app.mutate('New comment', () => (slide.comments ??= []).push(c));
    app.refreshDock();
  } } });
  return pane('Comments', app, list, h('div', { class: 'comment-new' }, input, post));
}

// ---------------------------------------------------------------------------
// Selection pane
// ---------------------------------------------------------------------------
export function selectionPane(app: App): HTMLElement {
  const c = app.container();
  const list = h('div', { class: 'sel-list' });
  [...c.elements].reverse().forEach((e) => {
    const row_ = h('div', { class: `sel-row${app.sel.includes(e.id) ? ' sel' : ''}` },
      h('span', { class: 'grow', text: e.name }),
      h('button', { class: 'icon-btn', title: e.hidden ? 'Show' : 'Hide', on: { click: (ev: Event) => { ev.stopPropagation(); app.mutate('Visibility', () => (e.hidden = !e.hidden || undefined)); app.refreshDock(); } } }, iconEl(e.hidden ? 'hide' : 'view', 14)),
      h('button', { class: 'icon-btn', title: e.locked ? 'Unlock' : 'Lock', on: { click: (ev: Event) => { ev.stopPropagation(); app.mutate('Lock', () => (e.locked = !e.locked || undefined)); app.refreshDock(); } } }, iconEl(e.locked ? 'lock' : 'unlock', 14)),
    );
    row_.addEventListener('click', () => { app.setSel([e.id]); app.refreshDock(); });
    list.append(row_);
  });
  if (!c.elements.length) list.append(h('p', { class: 'muted', text: 'Nothing on this slide yet.' }));
  void slideTitle;
  void toast;
  return pane('Selection', app, list);
}

export function registerPanes(app: App) {
  app.panes.set('format', formatPane);
  app.panes.set('animations', animationsPane);
  app.panes.set('comments', commentsPane);
  app.panes.set('selection', selectionPane);
}

void tableFitToFrame;
void applyFit;
void fitShape;
