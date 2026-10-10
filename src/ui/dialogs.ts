import type { App } from '../app';
import { css, luma } from '../core/color';
import { addMedia, imageSize, mediaUrl } from '../core/media';
import {
  allElements,
  clone,
  plainText,
  slideTitle,
  uid,
  SLIDE_SIZES,
  type Color,
  type El,
  type Fill,
  type ChartEl,
  type PictureEl,
  type ShapeEl,
  type Slide,
} from '../core/model';
import { layoutOf } from '../core/model';
import { checkbox, field, h, iconEl, macify, modal, selectEl, toast, popover, numberField } from './dom';
import { colorPicker } from './pickers';
import { iconNames, iconPaths, prettyName } from './iconshapes';

const inches = (pt: number) => Math.round((pt / 72) * 100) / 100;

// ---------------------------------------------------------------------------
// Link
// ---------------------------------------------------------------------------
export function linkDialog(app: App) {
  const te = app.canvas.textEditor;
  const el = app.singleSelected();
  const current = te ? te.runProps().link : el?.link;
  const addr = h('input', { class: 'input', value: current && !current.startsWith('slide:') ? current : 'https://', attrs: { type: 'text' } });
  const slides = h('select', { class: 'select' }, h('option', { text: '— none —', attrs: { value: '' } }), ...app.pres.slides.map((s, i) => h('option', { text: `${i + 1}. ${slideTitle(s) || 'Slide ' + (i + 1)}`, attrs: { value: s.id } })));
  if (current?.startsWith('slide:')) slides.value = current.slice(6);
  const body = h('div', null, field('Address', addr), field('Or place in this presentation', slides));
  const apply = (link: string | undefined) => {
    if (te) te.setRunProps({ link, ...(link ? { u: true as const } : { u: undefined }) });
    else if (el) app.mutate('Link', () => (link ? (el.link = link) : delete el.link));
    else toast('Select some text or an object first.');
  };
  const buttons: Parameters<typeof modal>[2] = [
    { label: 'Cancel' },
    {
      label: 'OK',
      primary: true,
      run: () => {
        let href = addr.value.trim();
        if (slides.value) return apply(`slide:${slides.value}`);
        if (!href || href === 'https://') return apply(undefined);
        if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) href = 'https://' + href;
        apply(href);
      },
    },
  ];
  if (current) buttons.unshift({ label: 'Remove link', run: () => apply(undefined) });
  modal('Insert Link', body, buttons);
  setTimeout(() => addr.select(), 20);
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------
export function tableDialog(app: App) {
  const rows = h('input', { class: 'input', value: '4', attrs: { type: 'number', min: '1', max: '100' } });
  const cols = h('input', { class: 'input', value: '4', attrs: { type: 'number', min: '1', max: '20' } });
  modal('Insert Table', h('div', { class: 'grid2' }, field('Columns', cols), field('Rows', rows)), [
    { label: 'Cancel' },
    { label: 'OK', primary: true, run: () => void app.run('insert-table', { rows: Number(rows.value) || 1, cols: Number(cols.value) || 1 }) },
  ]);
}

// ---------------------------------------------------------------------------
// Slide size
// ---------------------------------------------------------------------------
export function slideSizeDialog(app: App) {
  const p = app.pres;
  const w = numberField(inches(p.size.w), { min: 1, max: 56, step: 0.1 }, () => {});
  const hh = numberField(inches(p.size.h), { min: 1, max: 56, step: 0.1 }, () => {});
  const preset = selectEl([...Object.entries(SLIDE_SIZES).map(([k, s]) => [k, s.label] as [string, string]), ['custom', 'Custom']], p.size.preset ?? 'custom', (v) => {
    const s = SLIDE_SIZES[v];
    if (s) {
      w.value = String(inches(s.w));
      hh.value = String(inches(s.h));
    }
  });
  const scaleText = checkbox('Scale text with the slide', true, () => {});
  const body = h('div', null, field('Slide size for', preset), h('div', { class: 'grid2' }, field('Width (in)', w), field('Height (in)', hh)), scaleText, h('p', { class: 'muted', style: { fontSize: '12px' }, text: 'Everything on your slides is scaled to fit the new size.' }));
  modal('Slide Size', body, [
    { label: 'Cancel' },
    {
      label: 'OK',
      primary: true,
      run: () => {
        const nw = Math.max(72, Math.min(4032, parseFloat(w.value) * 72));
        const nh = Math.max(72, Math.min(4032, parseFloat(hh.value) * 72));
        if (!(nw > 0 && nh > 0)) return false;
        const scaleFonts = (scaleText.querySelector('input') as HTMLInputElement).checked;
        app.mutate('Slide size', () => resizeDeck(app, nw, nh, scaleFonts, preset.value === 'custom' ? undefined : preset.value));
        app.fullRender();
        setTimeout(() => app.canvas.fit(), 10);
      },
    },
  ]);
}

export function resizeDeck(app: App, nw: number, nh: number, scaleFonts: boolean, presetKey?: string) {
  const p = app.pres;
  const ow = p.size.w;
  const oh = p.size.h;
  const s = Math.min(nw / ow, nh / oh);
  const dx = (nw - ow * s) / 2;
  const dy = (nh - oh * s) / 2;
  const fix = (els: El[]) => {
    for (const e of els) {
      e.x = Math.round((e.x * s + dx) * 100) / 100;
      e.y = Math.round((e.y * s + dy) * 100) / 100;
      e.w = Math.round(e.w * s * 100) / 100;
      e.h = Math.round(e.h * s * 100) / 100;
      if (e.type === 'table') {
        e.cols = e.cols.map((c) => c * s);
        e.rows.forEach((r) => (r.h *= s));
      }
      if (scaleFonts) {
        const bodies = e.type === 'shape' && e.text ? [e.text] : e.type === 'table' ? e.rows.flatMap((r) => r.cells.map((c) => c.text)) : [];
        for (const b of bodies) {
          for (const l of b.lst ?? []) if (l?.sz) l.sz = Math.round(l.sz * s * 10) / 10;
          for (const para of b.paras) {
            for (const r of para.runs) if (r.sz) r.sz = Math.round(r.sz * s * 10) / 10;
            if (para.end?.sz) para.end.sz = Math.round(para.end.sz * s * 10) / 10;
          }
        }
      }
      if (e.type === 'group') {
        e.children = e.children;
      }
    }
  };
  for (const sl of p.slides) fix(sl.elements);
  for (const l of p.layouts) fix(l.elements);
  for (const m of p.masters) fix(m.elements);
  p.size = { w: nw, h: nh, preset: presetKey };
}

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------
export function backgroundDialog(app: App) {
  const container = app.container();
  const isSlide = 'layoutId' in container;
  const cur: Fill | undefined = (container as { bg?: Fill }).bg;
  const ctx = app.themeCtx();
  type Kind = 'solid' | 'grad' | 'pic';
  let kind: Kind = cur?.t === 'grad' ? 'grad' : cur?.t === 'pic' ? 'pic' : 'solid';
  let c1: Color = cur?.t === 'solid' ? cur.c : cur?.t === 'grad' ? cur.stops[0].c : { theme: 'bg1' };
  let c2: Color = cur?.t === 'grad' ? cur.stops[cur.stops.length - 1].c : { theme: 'accent1', lumMod: 0.4, lumOff: 0.6 };
  let angle = cur?.t === 'grad' ? cur.ang : 90;
  let pic: string | undefined = cur?.t === 'pic' ? cur.media : undefined;

  const colorBtn = (get: () => Color, set: (c: Color) => void) => {
    const sw = h('span', { class: 'swatch-inline', style: { background: css(get(), ctx) } });
    const b = h('button', { class: 'btn', style: { display: 'inline-flex', gap: '8px', alignItems: 'center' } }, sw, 'Color');
    b.addEventListener('click', () => colorPicker(b, { title: 'Color', ctx, onPick: (c) => { if (c) { set(c); sw.style.background = css(c, ctx); } } }));
    return b;
  };
  const radios = h('div', { class: 'radios' });
  const panels = h('div');
  const render = () => {
    radios.replaceChildren(
      ...(['solid', 'grad', 'pic'] as Kind[]).map((k) => h('label', { class: 'switch' }, h('input', { attrs: { type: 'radio', name: 'bgk', ...(k === kind ? { checked: '' } : {}) }, on: { change: () => { kind = k; render(); } } }), { solid: 'Solid fill', grad: 'Gradient fill', pic: 'Picture fill' }[k])),
    );
    panels.replaceChildren();
    if (kind === 'solid') panels.append(field('Fill color', colorBtn(() => c1, (c) => (c1 = c))));
    if (kind === 'grad')
      panels.append(
        h('div', { style: { display: 'flex', gap: '16px', alignItems: 'flex-end' } }, field('From', colorBtn(() => c1, (c) => (c1 = c))), field('To', colorBtn(() => c2, (c) => (c2 = c))), field('Angle (°)', numberField(angle, { min: 0, max: 360, step: 15 }, (v) => (angle = v)))),
      );
    if (kind === 'pic') {
      const name = h('span', { class: 'muted', text: pic ? 'A picture is selected' : 'No picture chosen' });
      const b = h('button', { class: 'btn' }, 'Choose picture…');
      b.addEventListener('click', async () => {
        const files = await window.bnc.openMedia('image');
        if (files[0]) {
          pic = addMedia(app.deck.media, files[0].name, files[0].data);
          name.textContent = files[0].name;
        }
      });
      panels.append(h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, b, name));
    }
  };
  render();
  const build = (): Fill | undefined => {
    if (kind === 'solid') return { t: 'solid', c: c1 };
    if (kind === 'grad') return { t: 'grad', stops: [{ pos: 0, c: c1 }, { pos: 1, c: c2 }], ang: angle, kind: 'linear' };
    return pic ? { t: 'pic', media: pic } : undefined;
  };
  const body = h('div', null, radios, panels);
  const buttons: Parameters<typeof modal>[2] = [{ label: 'Cancel' }];
  if (isSlide) buttons.push({ label: 'Reset background', run: () => app.mutate('Reset background', () => delete (container as Slide).bg) });
  buttons.push(
    {
      label: 'Apply to All',
      run: () => {
        const f = build();
        if (!f) return false;
        app.mutate('Background', () => {
          for (const m of app.pres.masters) m.bg = clone(f);
          for (const l of app.pres.layouts) delete l.bg;
          for (const s of app.pres.slides) delete s.bg;
        });
      },
    },
    {
      label: isSlide ? 'Apply' : 'OK',
      primary: true,
      run: () => {
        const f = build();
        if (!f) return false;
        app.mutate('Background', () => ((container as { bg?: Fill }).bg = clone(f)));
      },
    },
  );
  modal('Format Background', body, buttons, { width: 480 });
}

// ---------------------------------------------------------------------------
// Header & footer
// ---------------------------------------------------------------------------
export function headerFooterDialog(app: App) {
  const cur = app.pres.footer ?? { slideNum: false, date: false, footer: false, footerText: '', skipTitle: false };
  const date = checkbox('Date and time', cur.date, () => {});
  const dateFixed = h('input', { class: 'input', value: cur.dateText ?? new Date().toLocaleDateString(), attrs: { type: 'text', placeholder: 'Fixed date text, or leave to update automatically' } });
  const num = checkbox('Slide number', cur.slideNum, () => {});
  const foot = checkbox('Footer', cur.footer, () => {});
  const footText = h('input', { class: 'input', value: cur.footerText, attrs: { type: 'text' } });
  const skip = checkbox("Don't show on title slide", cur.skipTitle, () => {});
  const val = (c: HTMLElement) => (c.querySelector('input') as HTMLInputElement).checked;
  const body = h('div', null, date, field('Fixed date (optional)', dateFixed), num, foot, field('Footer text', footText), skip);
  const apply = (all: boolean) => {
    const s = { slideNum: val(num), date: val(date), dateText: dateFixed.value.trim() || undefined, dateFixed: !!dateFixed.value.trim(), footer: val(foot), footerText: footText.value, skipTitle: val(skip) };
    app.mutate('Header & footer', () => {
      app.pres.footer = s;
      const targets = all ? app.pres.slides : [app.curSlide()];
      for (const sl of targets) applyFooters(app, sl, s);
    });
    app.fullRender();
  };
  modal('Header and Footer', body, [{ label: 'Cancel' }, { label: 'Apply', run: () => apply(false) }, { label: 'Apply to All', primary: true, run: () => apply(true) }], { width: 460 });
}

export function applyFooters(app: App, slide: Slide, s: NonNullable<App['pres']['footer']>) {
  const layout = layoutOf(app.pres, slide);
  const isTitle = layout.kind === 'title';
  const want: Record<'dt' | 'ftr' | 'sldNum', boolean> = { dt: s.date && !(isTitle && s.skipTitle), ftr: s.footer && !(isTitle && s.skipTitle), sldNum: s.slideNum && !(isTitle && s.skipTitle) };
  for (const type of ['dt', 'ftr', 'sldNum'] as const) {
    const existing = slide.elements.find((e): e is ShapeEl => e.type === 'shape' && e.ph?.type === type);
    if (!want[type]) {
      if (existing) slide.elements = slide.elements.filter((e) => e !== existing);
      continue;
    }
    const src = layout.elements.find((e): e is ShapeEl => e.type === 'shape' && e.ph?.type === type) ?? app.pres.masters[0].elements.find((e): e is ShapeEl => e.type === 'shape' && e.ph?.type === type);
    if (!src) continue;
    const el: ShapeEl = existing ?? { ...clone(src), id: uid() };
    el.text = { ...clone(src.text!), paras: [] };
    if (type === 'dt') el.text.paras = [{ runs: s.dateFixed && s.dateText ? [{ t: s.dateText }] : [{ t: '', field: 'datetime' }] }];
    else if (type === 'ftr') el.text.paras = [{ runs: s.footerText ? [{ t: s.footerText }] : [] }];
    else el.text.paras = [{ runs: [{ t: '‹#›', field: 'slidenum' }] }];
    if (!existing) slide.elements.push(el);
  }
}

// ---------------------------------------------------------------------------
// Alt text, crop
// ---------------------------------------------------------------------------
export function altTextDialog(app: App) {
  const el = app.singleSelected();
  if (!el) return toast('Select an object first.');
  const input = h('textarea', { class: 'input', style: { height: '90px', padding: '8px' }, value: el.alt ?? '' });
  modal('Alt Text', field('Describe this object for people who cannot see it', input), [
    { label: 'Cancel' },
    { label: 'OK', primary: true, run: () => app.mutate('Alt text', () => (input.value.trim() ? (el.alt = input.value.trim()) : delete el.alt)) },
  ]);
}

export function cropDialog(app: App) {
  const el = app.singleSelected();
  if (!el || el.type !== 'picture') return toast('Select a picture first.');
  const c = el.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const f = (v: number) => numberField(Math.round(v * 1000) / 10, { min: 0, max: 90, step: 1 }, () => {});
  const [l, t, r, b] = [f(c.l), f(c.t), f(c.r), f(c.b)];
  modal('Crop Picture', h('div', { class: 'grid2' }, field('Left (%)', l), field('Top (%)', t), field('Right (%)', r), field('Bottom (%)', b)), [
    { label: 'Cancel' },
    {
      label: 'Reset',
      run: () => app.mutate('Crop', () => applyCrop(el, { l: 0, t: 0, r: 0, b: 0 })),
    },
    {
      label: 'OK',
      primary: true,
      run: () => {
        const n = { l: Math.min(0.9, (parseFloat(l.value) || 0) / 100), t: Math.min(0.9, (parseFloat(t.value) || 0) / 100), r: Math.min(0.9, (parseFloat(r.value) || 0) / 100), b: Math.min(0.9, (parseFloat(b.value) || 0) / 100) };
        if (n.l + n.r >= 0.95 || n.t + n.b >= 0.95) return false;
        app.mutate('Crop', () => applyCrop(el, n));
      },
    },
  ]);
}

/** Crop without distorting: the frame shrinks / grows with the visible part of the picture. */
export function applyCrop(el: PictureEl, n: { l: number; t: number; r: number; b: number }) {
  const o = el.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const vw0 = 1 - o.l - o.r;
  const vh0 = 1 - o.t - o.b;
  const imgW = el.w / vw0;
  const imgH = el.h / vh0;
  const vw1 = 1 - n.l - n.r;
  const vh1 = 1 - n.t - n.b;
  el.x = Math.round((el.x + (n.l - o.l) * imgW) * 100) / 100;
  el.y = Math.round((el.y + (n.t - o.t) * imgH) * 100) / 100;
  el.w = Math.round(imgW * vw1 * 100) / 100;
  el.h = Math.round(imgH * vh1 * 100) / 100;
  if (n.l || n.t || n.r || n.b) el.crop = n;
  else delete el.crop;
}

// ---------------------------------------------------------------------------
// Chart data
// ---------------------------------------------------------------------------
export function chartDataDialog(app: App) {
  const el = app.singleSelected();
  if (!el || el.type !== 'chart') return toast('Select a chart first.');
  const chart = clone(el) as ChartEl;
  const table = h('table', { class: 'datatable' });
  const render = () => {
    table.replaceChildren();
    const head = h('tr', null, h('th'), ...chart.series.map((s, i) => h('th', null, h('input', { class: 'cell', value: s.name, on: { input: (e: any) => (chart.series[i].name = e.target.value) } }))));
    table.append(head);
    chart.cats.forEach((cat, r) => {
      table.append(
        h('tr', null, h('th', null, h('input', { class: 'cell', value: cat, on: { input: (e: any) => (chart.cats[r] = e.target.value) } })), ...chart.series.map((s, i) => h('td', null, h('input', { class: 'cell', value: s.values[r] == null ? '' : String(s.values[r]), on: { input: (e: any) => (chart.series[i].values[r] = e.target.value === '' || Number.isNaN(Number(e.target.value)) ? null : Number(e.target.value)) } })))),
      );
    });
  };
  render();
  const addRow = h('button', { class: 'btn small', text: '+ Category', on: { click: () => { chart.cats.push(`Category ${chart.cats.length + 1}`); chart.series.forEach((s) => s.values.push(null)); render(); } } });
  const addCol = h('button', { class: 'btn small', text: '+ Series', on: { click: () => { chart.series.push({ name: `Series ${chart.series.length + 1}`, values: chart.cats.map(() => null) }); render(); } } });
  const delRow = h('button', { class: 'btn small', text: '− Category', on: { click: () => { if (chart.cats.length > 1) { chart.cats.pop(); chart.series.forEach((s) => s.values.pop()); render(); } } } });
  const delCol = h('button', { class: 'btn small', text: '− Series', on: { click: () => { if (chart.series.length > 1) { chart.series.pop(); render(); } } } });
  modal('Chart Data', h('div', null, h('div', { style: { overflow: 'auto', maxHeight: '320px', border: '1px solid var(--border)', borderRadius: '8px' } }, table), h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } }, addRow, delRow, addCol, delCol)), [
    { label: 'Cancel' },
    {
      label: 'OK',
      primary: true,
      run: () => app.mutate('Chart data', () => {
        el.cats = chart.cats;
        el.series = chart.series;
      }),
    },
  ], { width: 640 });
}

// ---------------------------------------------------------------------------
// Counts, info, accessibility, show setup
// ---------------------------------------------------------------------------
export function wordCountDialog(app: App) {
  let words = 0;
  let chars = 0;
  let noSpaces = 0;
  let notes = 0;
  for (const s of app.pres.slides) {
    for (const e of allElements(s.elements)) {
      const texts: string[] = [];
      if (e.type === 'shape' && e.text) texts.push(plainText(e.text));
      else if (e.type === 'table') for (const r of e.rows) for (const c of r.cells) texts.push(plainText(c.text));
      for (const t of texts) {
        words += t.trim() ? t.trim().split(/\s+/).length : 0;
        chars += t.length;
        noSpaces += t.replace(/\s/g, '').length;
      }
    }
    if (s.notes) notes += s.notes.map((p) => p.runs.map((r) => r.t).join('')).join(' ').trim().split(/\s+/).filter(Boolean).length;
  }
  const row = (k: string, v: string | number) => [h('span', { text: k }), h('strong', { text: String(v) })];
  modal('Word Count', h('div', { class: 'shortcuts' }, ...row('Slides', app.pres.slides.length), ...row('Words', words), ...row('Characters (no spaces)', noSpaces), ...row('Characters (with spaces)', chars), ...row('Words in notes', notes)), [{ label: 'Close', primary: true }], { width: 360 });
}

export function docInfoDialog(app: App) {
  const title = h('input', { class: 'input', value: app.pres.title, attrs: { type: 'text' } });
  const author = h('input', { class: 'input', value: app.pres.author, attrs: { type: 'text' } });
  modal('Presentation Info', h('div', null, field('Title', title), field('Author', author), h('p', { class: 'muted', text: `${app.pres.slides.length} slide(s) · ${app.pres.layouts.length} layouts · ${Math.round((app.pres.size.w / 72) * 100) / 100}" × ${Math.round((app.pres.size.h / 72) * 100) / 100}"` }), h('p', { class: 'muted', text: app.doc.cloud ? `Nextcloud: ${app.doc.cloud.path}` : app.doc.local ? `File: ${app.doc.local}` : 'Not saved yet' })), [
    { label: 'Cancel' },
    { label: 'Save', primary: true, run: () => app.mutate('Info', () => { app.pres.title = title.value; app.pres.author = author.value; }) },
  ]);
}

interface Issue {
  slide: number;
  id?: string;
  text: string;
  kind: 'error' | 'warn';
}

export function accessibilityDialog(app: App) {
  const issues: Issue[] = [];
  app.pres.slides.forEach((s, i) => {
    if (!slideTitle(s)) issues.push({ slide: i, text: 'Slide has no title', kind: 'error' });
    for (const e of allElements(s.elements)) {
      if ((e.type === 'picture' || e.type === 'chart' || e.type === 'media') && !e.alt && !e.hidden) issues.push({ slide: i, id: e.id, text: `Missing alt text: ${e.name}`, kind: 'error' });
      if (e.type === 'shape' && e.text && !e.ink) {
        const small = e.text.paras.some((p) => p.runs.some((r) => r.t && (r.sz ?? e.text!.lst?.[p.level ?? 0]?.sz ?? 18) < 12));
        if (small) issues.push({ slide: i, id: e.id, text: 'Text is very small (under 12 pt)', kind: 'warn' });
        const ctx = app.themeCtxFor(s);
        const fg = e.text.lst?.[0]?.color;
        const bg = e.fill?.t === 'solid' ? e.fill.c : undefined;
        if (fg && bg && Math.abs(luma(fg, ctx) - luma(bg, ctx)) < 0.25 && plainText(e.text).trim()) issues.push({ slide: i, id: e.id, text: 'Text may be hard to read (low contrast)', kind: 'warn' });
      }
    }
  });
  const list = h('div', { class: 'issue-list' });
  if (!issues.length) list.append(h('p', { text: 'No accessibility issues found. Nice work!' }));
  for (const is of issues.slice(0, 80)) {
    list.append(
      h('div', { class: `issue ${is.kind}` }, h('span', { class: 'tag' + (is.kind === 'error' ? ' err' : ' warn'), text: is.kind === 'error' ? 'Error' : 'Tip' }), h('span', { class: 'grow', text: `Slide ${is.slide + 1}: ${is.text}` }), h('button', { class: 'btn small', text: 'Go to', on: { click: () => { app.goto(is.slide, true); if (is.id) app.setSel([is.id]); } } })),
    );
  }
  modal('Accessibility Checker', list, [{ label: 'Close', primary: true }], { width: 560 });
}

export function setupShowDialog(app: App) {
  const cur = app.pres.show ?? {};
  const loop = checkbox('Loop continuously until Esc', !!cur.loop, () => {});
  const timings = checkbox('Use timings, if present', cur.useTimings !== false, () => {});
  modal('Set Up Show', h('div', null, loop, timings), [
    { label: 'Cancel' },
    { label: 'OK', primary: true, run: () => app.mutate('Set up show', () => { app.pres.show = { loop: (loop.querySelector('input') as HTMLInputElement).checked, useTimings: (timings.querySelector('input') as HTMLInputElement).checked }; }) },
  ]);
}

export function shortcutsDialog() {
  const rows: [string, string][] = [
    ['New / Open / Save', 'Ctrl+N / Ctrl+O / Ctrl+S'],
    ['Save As', 'Ctrl+Shift+S'],
    ['Print', 'Ctrl+P'],
    ['New slide', 'Ctrl+M'],
    ['Duplicate object / slide', 'Ctrl+D'],
    ['Cut / Copy / Paste', 'Ctrl+X / C / V'],
    ['Undo / Redo', 'Ctrl+Z / Ctrl+Y'],
    ['Bold / Italic / Underline', 'Ctrl+B / I / U'],
    ['Group / Ungroup', 'Ctrl+G / Ctrl+Shift+G'],
    ['Select all', 'Ctrl+A'],
    ['Insert link', 'Ctrl+K'],
    ['Find / Replace', 'Ctrl+F / Ctrl+H'],
    ['Edit text of selected shape', 'Enter or just start typing'],
    ['Leave text editing', 'Esc'],
    ['Nudge object (fine / big)', 'Arrow / Shift+Arrow'],
    ['Move with straight line / keep proportions', 'Shift + drag'],
    ['Resize from the centre', 'Ctrl + drag'],
    ['Turn off snapping while dragging', 'Alt + drag'],
    ['Next / previous slide', 'PgDn / PgUp'],
    ['Start slide show / from this slide', 'F5 / Shift+F5'],
    ['During the show: next / previous', 'Space, → / ←'],
    ['During the show: black / white screen', 'B / W'],
    ['Search commands', 'Alt+Q'],
    ['Zoom', 'Ctrl+Scroll'],
  ];
  const grid = h('div', { class: 'shortcuts' });
  for (const [k, v] of rows) grid.append(h('span', { text: k }), h('span', { class: 'kbd', text: macify(v) }));
  modal('Keyboard Shortcuts', grid, [{ label: 'Close', primary: true }], { width: 560 });
}

export function aboutDialog(version: string) {
  modal(
    'About BNC Presentation',
    h(
      'div',
      { style: 'text-align:center' },
      h('img', { attrs: { src: (document.querySelector('img.app-logo') as HTMLImageElement | null)?.src ?? './icon.png', width: '72', height: '72' }, style: 'border-radius:16px' }),
      h('h2', { text: 'BNC Presentation', style: 'margin:10px 0 2px' }),
      h('div', { class: 'muted', text: `Version ${version}` }),
      h('p', { text: 'An open-source presentation maker with full .pptx support and Nextcloud integration.' }),
      h('p', { class: 'muted', text: 'MIT License. Built with Electron, ProseMirror, JSZip and Lucide.' }),
    ),
    [{ label: 'Close', primary: true }],
    { width: 400 },
  );
}

// ---------------------------------------------------------------------------
// Icon picker
// ---------------------------------------------------------------------------
export function iconPicker(app: App, anchor: HTMLElement) {
  let close = () => {};
  const all = iconNames();
  const search = h('input', { class: 'input', attrs: { type: 'text', placeholder: 'Search icons (e.g. heart, arrow, chart)' } });
  const grid = h('div', { class: 'icon-grid' });
  const renderGrid = () => {
    const q = search.value.trim().toLowerCase().replace(/\s+/g, '');
    const list = (q ? all.filter((n) => n.toLowerCase().includes(q)) : all).slice(0, 180);
    grid.replaceChildren();
    for (const name of list) {
      const paths = iconPaths(name);
      if (!paths.length) continue;
      const svg = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths.map((d) => `<path d="${d}"/>`).join('')}</svg>`;
      const b = h('button', { class: 'icon-cell', title: prettyName(name) });
      b.innerHTML = svg;
      b.addEventListener('click', () => {
        close();
        void app.run('insert-icon', name);
      });
      grid.append(b);
    }
    if (!grid.children.length) grid.append(h('p', { class: 'muted', text: 'No matching icons.' }));
  };
  search.addEventListener('input', renderGrid);
  renderGrid();
  close = popover(anchor, h('div', { class: 'icon-pop' }, search, grid));
  setTimeout(() => search.focus(), 30);
}

void iconEl;
void imageSize;
void mediaUrl;
