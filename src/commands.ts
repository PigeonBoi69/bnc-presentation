// Every action in the app, by id. The ribbon, context menus, keyboard shortcuts and the Alt+Q command
// search all go through app.run(id, arg).
import type { App } from './app';
import { LINE_PRESETS } from './core/geometry';
import { addMedia } from './core/media';
import {
  allElements,
  clone,
  newChart,
  newTable,
  newTextBox,
  slideTitle,
  uid,
  SLIDE_SIZES,
  THEMES,
  type Anim,
  type ChartKind,
  type Color,
  type El,
  type Line,
  type ShapeEl,
  type TableEl,
  type Transition,
} from './core/model';
import type { Format } from './core/io';
import { applyTableStyle, tableStyleById } from './core/tablestyles';
import { applyRun, applyPara, changeIndent, clearFormatting, currentRun, setBulletChar, setCase, setNumbering, stepFontSize, toggleBullet } from './editor/format';
import { applyFit, fitShape } from './editor/measure';
import {
  align as alignEls,
  applyLayout,
  arrange,
  cloneEl,
  distribute,
  flipEls,
  groupEls,
  newSlideFromLayout,
  resetSlide,
  rotateEls,
  tableDeleteCol,
  tableDeleteRow,
  tableEqualCols,
  tableEqualRows,
  tableFitToFrame,
  tableInsertCol,
  tableInsertRow,
  tableMerge,
  tableRestyle,
  tableSplit,
  ungroupEl,
  unionBounds,
} from './editor/ops';
import { FindBar } from './ui/findbar';
import {
  accessibilityDialog,
  altTextDialog,
  backgroundDialog,
  chartDataDialog,
  cropDialog,
  docInfoDialog,
  headerFooterDialog,
  iconPicker,
  linkDialog,
  resizeDeck,
  setupShowDialog,
  shortcutsDialog,
  slideSizeDialog,
  tableDialog,
  wordCountDialog,
} from './ui/dialogs';
import { cloudPicker, nextcloudDialog } from './ui/cloud';
import { prompt, toast } from './ui/dom';
import { iconPaths } from './ui/iconshapes';
import { registerPanes } from './ui/panes';
import { pluginsDialog } from './ui/styles';
import { startShow } from './ui/slideshow';
import { VARIANTS } from './ui/galleries';

export interface Command {
  id: string;
  label: string;
  run: (arg?: any) => void | Promise<void>;
  keywords?: string;
  shortcut?: string;
  section?: string;
  hidden?: boolean;
}

export function registerCommands(app: App) {
  registerPanes(app);
  app.findBar = new FindBar(app, app.center);

  const reg = (id: string, label: string, run: (arg?: any) => void | Promise<void>, o: Partial<Command> = {}) => app.cmds.set(id, { id, label, run, ...o });
  const els = () => app.selectedEls();
  const m = (label: string, fn: () => void, key?: string) => app.mutate(label, fn, key);
  const onShapes = (label: string, fn: (s: ShapeEl) => void, key?: string) => {
    const shapes = els().filter((e): e is ShapeEl => e.type === 'shape');
    if (!shapes.length) return toast('Select a shape first.');
    m(label, () => shapes.forEach(fn), key);
  };
  const selTable = (): TableEl | undefined => {
    const e = app.singleSelected();
    return e?.type === 'table' ? e : undefined;
  };
  const cellRange = (t: TableEl) => {
    const cs = app.cellSel && app.cellSel.id === t.id ? app.cellSel : { r0: 0, c0: 0, r1: t.rows.length - 1, c1: t.cols.length - 1, id: t.id };
    return { r0: Math.min(cs.r0, cs.r1), r1: Math.max(cs.r0, cs.r1), c0: Math.min(cs.c0, cs.c1), c1: Math.max(cs.c0, cs.c1) };
  };
  const anchorCell = (t: TableEl) => {
    const cs = app.cellSel && app.cellSel.id === t.id ? app.cellSel : null;
    return { r: cs ? Math.min(cs.r0, cs.r1) : 0, c: cs ? Math.min(cs.c0, cs.c1) : 0 };
  };

  // ---- File ----
  reg('new', 'New presentation', () => app.newPresentation(), { shortcut: 'Ctrl+N', section: 'File' });
  reg('open', 'Open from this device', () => app.openLocal(), { shortcut: 'Ctrl+O', section: 'File' });
  reg('open-cloud', 'Open from Nextcloud', () => app.openCloud(), { section: 'File', keywords: 'cloud' });
  reg('save', 'Save', () => app.save(), { shortcut: 'Ctrl+S', section: 'File' });
  reg('save-as', 'Save a copy', () => app.saveAs(), { shortcut: 'Ctrl+Shift+S', section: 'File' });
  reg('save-cloud', 'Save to Nextcloud', () => app.saveCloudAs(), { section: 'File', keywords: 'cloud' });
  reg('print', 'Print', () => app.print(), { shortcut: 'Ctrl+P', section: 'File' });
  reg('autosave-toggle', 'Toggle AutoSave', () => app.toggleAutosave(), { section: 'File' });
  reg('rename', 'Rename presentation', () => app.rename(), { section: 'File' });
  reg('doc-info', 'Presentation info', () => docInfoDialog(app), { section: 'File' });
  for (const f of ['pdf', 'pptx', 'ppsx', 'potx', 'bncpres', 'png', 'jpg', 'html', 'md', 'txt'] as Format[]) reg(`export-${f}`, `Export as ${f.toUpperCase()}`, () => app.exportAs(f), { section: 'Export', keywords: 'save convert' });
  reg('export-current-png', 'Export current slide as picture', () => app.exportImages('png', true), { section: 'Export' });
  reg('plugins', 'Plugins and app styles', () => pluginsDialog(app), { section: 'App', keywords: 'theme color style bnctheme' });
  reg('cloud-settings', 'Nextcloud account', () => void nextcloudDialog(app), { section: 'App' });
  reg('about', 'About BNC Presentation', () => app.about(), { section: 'Help' });
  reg('shortcuts', 'Keyboard shortcuts', () => shortcutsDialog(), { section: 'Help' });

  // ---- Edit ----
  reg('undo', 'Undo', () => app.undo(), { shortcut: 'Ctrl+Z', section: 'Edit' });
  reg('redo', 'Redo', () => app.redo(), { shortcut: 'Ctrl+Y', section: 'Edit' });
  reg('cut', 'Cut', () => (app.canvas.textEditor ? void document.execCommand('cut') : void app.copySelection(true)), { shortcut: 'Ctrl+X', section: 'Edit' });
  reg('copy', 'Copy', () => (app.canvas.textEditor ? void document.execCommand('copy') : void app.copySelection(false)), { shortcut: 'Ctrl+C', section: 'Edit' });
  reg('paste', 'Paste', () => app.pasteNow(), { shortcut: 'Ctrl+V', section: 'Edit' });
  reg('paste-plain', 'Paste as plain text', async () => {
    const c = await window.bnc.readClipboard();
    const text = c.text.replace(/​/g, '');
    if (!text) return;
    if (app.canvas.textEditor) app.canvas.textEditor.insertText(text);
    else app.pasteNow();
  }, { section: 'Edit' });
  reg('duplicate', 'Duplicate', () => {
    const sel = els();
    if (!sel.length) return;
    const copies = sel.map((e) => {
      const c = cloneEl(e);
      c.x += 14;
      c.y += 14;
      return c;
    });
    m('Duplicate', () => {
      app.container().elements.push(...copies);
      app.sel = copies.map((c) => c.id);
    });
  }, { shortcut: 'Ctrl+D', section: 'Edit' });
  reg('delete', 'Delete', () => app.deleteSelection(), { shortcut: 'Del', section: 'Edit' });
  reg('select-all', 'Select all', () => {
    if (app.canvas.textEditor) return app.canvas.textEditor.selectAll();
    app.setSel(app.container().elements.filter((e) => !e.locked && !e.hidden).map((e) => e.id));
  }, { shortcut: 'Ctrl+A', section: 'Edit' });
  reg('find', 'Find', () => app.findBar.open(false), { shortcut: 'Ctrl+F', section: 'Edit' });
  reg('replace', 'Replace', () => app.findBar.open(true), { shortcut: 'Ctrl+H', section: 'Edit' });
  reg('format-painter', 'Format painter', () => {
    if (app.painter) {
      app.painter = null;
      return app.refreshUi();
    }
    app.painter = { runs: { ...currentRun(app) } as Record<string, unknown> };
    toast('Format Painter: select another object to copy the formatting to it');
    app.refreshUi();
  }, { section: 'Home' });

  // ---- Slides ----
  reg('new-slide', 'New slide', (layoutId?: string) => app.newSlide(typeof layoutId === 'string' ? layoutId : undefined), { shortcut: 'Ctrl+M', section: 'Slides' });
  reg('duplicate-slide', 'Duplicate slide', () => app.duplicateSlides(), { section: 'Slides' });
  reg('delete-slide', 'Delete slide', () => app.deleteSlides(), { section: 'Slides' });
  reg('hide-slide', 'Hide or show slide', () => {
    const ids = app.slideSel.length ? app.slideSel : [app.curSlide().id];
    const slides = app.pres.slides.filter((s) => ids.includes(s.id));
    const hide = !slides.every((s) => s.hidden);
    m('Hide slide', () => slides.forEach((s) => (s.hidden = hide || undefined)));
    app.panel.refresh();
  }, { section: 'Slides' });
  reg('slide-move-up', 'Move slide up', () => app.moveSlides(app.slideSel.length ? app.slideSel : [app.curSlide().id], Math.max(0, app.curIndex - 1)), { hidden: true });
  reg('slide-move-down', 'Move slide down', () => app.moveSlides(app.slideSel.length ? app.slideSel : [app.curSlide().id], Math.min(app.pres.slides.length, app.curIndex + 2)), { hidden: true });
  reg('slide-copy', 'Copy slide', () => {
    const ids = app.slideSel.length ? app.slideSel : [app.curSlide().id];
    const slides = app.pres.slides.filter((s) => ids.includes(s.id)).map((s) => clone(s));
    app.clip = { kind: 'slides', slides, text: '​' };
    void navigator.clipboard?.writeText('​').catch(() => {});
    toast('Copied slide');
  }, { hidden: true });
  reg('slide-cut', 'Cut slide', () => {
    void app.run('slide-copy');
    app.deleteSlides();
  }, { hidden: true });
  reg('slide-paste', 'Paste slide', () => void app.pasteInternal(), { hidden: true });
  reg('slide-layout', 'Change slide layout', (id: string) => {
    if (!id) return;
    const targets = app.slideSel.length ? app.pres.slides.filter((s) => app.slideSel.includes(s.id)) : [app.curSlide()];
    m('Layout', () => targets.forEach((s) => applyLayout(app.pres, s, id)));
    app.sel = [];
  }, { section: 'Slides' });
  reg('reset-slide', 'Reset slide', () => m('Reset slide', () => resetSlide(app.pres, app.curSlide())), { section: 'Slides' });
  reg('section-add', 'Add section', async () => {
    const name = await prompt('Add Section', 'Section name', 'Untitled Section', 'Add');
    if (name) m('Add section', () => (app.curSlide().section = name));
    app.panel.refresh();
  }, { section: 'Slides' });
  reg('section-rename', 'Rename section', async (id?: string) => {
    const s = app.pres.slides.find((x) => x.id === id) ?? app.curSlide();
    const name = await prompt('Rename Section', 'Section name', s.section ?? '', 'Rename');
    if (name) m('Rename section', () => (s.section = name));
    app.panel.refresh();
  }, { hidden: true });
  reg('section-remove', 'Remove section', (id?: string) => {
    const s = app.pres.slides.find((x) => x.id === id) ?? app.curSlide();
    m('Remove section', () => delete s.section);
    app.panel.refresh();
  }, { hidden: true });
  reg('slide-size', 'Slide size', (key?: string) => {
    if (!key || key === 'custom') return slideSizeDialog(app);
    const s = SLIDE_SIZES[key];
    if (!s) return;
    m('Slide size', () => resizeDeck(app, s.w, s.h, true, key));
    app.fullRender();
    setTimeout(() => app.canvas.fit(), 10);
  }, { section: 'Design', keywords: 'widescreen 4:3 16:9 size' });
  reg('format-background', 'Format background', () => backgroundDialog(app), { section: 'Design' });
  reg('apply-theme', 'Apply theme', (i: number) => {
    const t = THEMES[i];
    if (!t) return;
    m('Theme', () => app.pres.masters.forEach((mm) => (mm.theme = clone(t))));
    app.fullRender();
  }, { section: 'Design' });
  reg('theme-variant', 'Theme variant', (id: string) => {
    const v = VARIANTS.find((x) => x.id === id);
    if (!v) return;
    m('Variant', () => app.pres.masters.forEach((mm) => (mm.clrMap = { ...v.map })));
    app.fullRender();
  }, { section: 'Design', keywords: 'dark light' });
  reg('header-footer', 'Header & footer', () => headerFooterDialog(app), { section: 'Insert', keywords: 'slide number date footer' });

  // ---- Insert ----
  reg('insert-shape', 'Insert shape', (prst: string) => {
    app.setTool({ kind: 'shape', prst });
    toast('Click or drag on the slide to draw the shape', 'info', 1800);
  }, { hidden: true });
  reg('insert-textbox', 'Insert text box', () => {
    app.setTool({ kind: 'textbox' });
    toast('Click or drag on the slide to add a text box', 'info', 1800);
  }, { section: 'Insert' });
  reg('insert-picture', 'Insert picture', async () => {
    const files = await window.bnc.openMedia('image');
    if (files.length) await app.insertPictureFiles(files);
  }, { section: 'Insert', keywords: 'image photo' });
  reg('insert-picture-cloud', 'Insert picture from Nextcloud', async () => {
    if (!(await app.ensureCloud())) return;
    const pick = await cloudPicker('open', undefined, '/', ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp']);
    if (!pick) return;
    const { data } = await window.bnc.nc.read(pick.path);
    await app.insertPictureFiles([{ name: pick.name, data }]);
  }, { section: 'Insert' });
  reg('insert-video', 'Insert video', async () => {
    const f = (await window.bnc.openMedia('video'))[0];
    if (f) await app.insertMediaFile('video', f);
  }, { section: 'Insert' });
  reg('insert-audio', 'Insert audio', async () => {
    const f = (await window.bnc.openMedia('audio'))[0];
    if (f) await app.insertMediaFile('audio', f);
  }, { section: 'Insert' });
  reg('insert-table-dialog', 'Insert table…', () => tableDialog(app), { hidden: true });
  reg('insert-table', 'Insert table', (o: { rows: number; cols: number }) => {
    const { w: sw, h: sh } = app.pres.size;
    const rows = Math.max(1, Math.min(100, o.rows));
    const cols = Math.max(1, Math.min(20, o.cols));
    const w = Math.min(sw * 0.84, cols * 150);
    const rowH = Math.max(18, Math.min(40, (sh - 140) / rows));
    const t = newTable(rows, cols, Math.round((sw - w) / 2), Math.round(Math.max(60, (sh - rows * rowH) / 2)), Math.round(w), rowH);
    tableRestyle(t);
    m('Insert table', () => {
      app.container().elements.push(t);
      app.sel = [t.id];
      app.cellSel = { id: t.id, r0: 0, c0: 0, r1: 0, c1: 0 };
    });
    setTimeout(() => app.canvas.startTextEdit(t.id, 'end', { r: 0, c: 0 }), 30);
  }, { section: 'Insert', keywords: 'grid' });
  reg('insert-chart', 'Insert chart', (kind: ChartKind = 'col') => {
    const { w: sw, h: sh } = app.pres.size;
    const c = newChart(kind, Math.round(sw * 0.16), Math.round(sh * 0.2), Math.round(sw * 0.68), Math.round(sh * 0.62));
    if (kind === 'pie' || kind === 'doughnut') c.series = c.series.slice(0, 1);
    m('Insert chart', () => {
      app.container().elements.push(c);
      app.sel = [c.id];
    });
    setTimeout(() => chartDataDialog(app), 60);
  }, { section: 'Insert', keywords: 'graph bar line pie' });
  reg('icon-picker', 'Insert icon', (anchor?: HTMLElement) => iconPicker(app, anchor ?? app.ribbonHost), { section: 'Insert', keywords: 'symbol graphic' });
  reg('insert-icon', 'Insert icon', (name: string) => {
    const paths = iconPaths(name);
    if (!paths.length) return;
    const { w: sw, h: sh } = app.pres.size;
    const size = 96;
    const el: ShapeEl = {
      id: uid(),
      type: 'shape',
      name: `Graphic ${name}`,
      x: Math.round((sw - size) / 2),
      y: Math.round((sh - size) / 2),
      w: size,
      h: size,
      geom: { cust: paths.map((d) => ({ w: 24, h: 24, d, fill: false, stroke: true })) },
      line: { c: { theme: 'accent1' }, w: 5, cap: 'round', join: 'round' },
      alt: name.replace(/([a-z])([A-Z])/g, '$1 $2'),
    };
    m('Insert icon', () => {
      app.container().elements.push(el);
      app.sel = [el.id];
    });
  }, { hidden: true });
  reg('insert-link', 'Insert link', () => linkDialog(app), { shortcut: 'Ctrl+K', section: 'Insert', keywords: 'hyperlink url' });
  reg('insert-char', 'Insert symbol', (ch: string) => {
    const te = app.canvas.textEditor;
    if (te) return te.insertText(ch);
    const { w: sw, h: sh } = app.pres.size;
    const el = newTextBox(Math.round(sw / 2 - 40), Math.round(sh / 2 - 30), 80, 60);
    el.text!.paras = [{ runs: [{ t: ch, sz: 44 }] }];
    el.text!.lst = clone(app.pres.defaultText ?? []);
    m('Insert symbol', () => {
      app.container().elements.push(el);
      app.sel = [el.id];
    });
  }, { hidden: true });
  const fieldBox = (field: 'datetime' | 'slidenum', label: string) => {
    const te = app.canvas.textEditor;
    if (te) return te.insertField(field);
    const { w: sw, h: sh } = app.pres.size;
    const el = newTextBox(Math.round(sw / 2 - 90), Math.round(sh - 70), 180, 30);
    el.text!.lst = clone(app.pres.defaultText ?? []);
    el.text!.paras = [{ runs: [{ t: '', field }] }];
    m(label, () => {
      app.container().elements.push(el);
      app.sel = [el.id];
    });
  };
  reg('insert-date', 'Insert date and time', () => fieldBox('datetime', 'Insert date'), { section: 'Insert' });
  reg('insert-slide-number', 'Insert slide number', () => fieldBox('slidenum', 'Insert slide number'), { section: 'Insert' });
  reg('insert-wordart', 'Insert WordArt', (style: string) => {
    const { w: sw, h: sh } = app.pres.size;
    const el = newTextBox(Math.round(sw / 2 - 260), Math.round(sh / 2 - 50), 520, 100, '');
    el.text!.lst = clone(app.pres.defaultText ?? []);
    const color: Color = style === 'bold' ? { theme: 'tx1' } : style === 'soft' ? { theme: 'accent2' } : { theme: 'accent1' };
    el.text!.paras = [{ algn: 'ctr', runs: [{ t: 'Your text here', sz: 60, b: true, color, font: '+mj' }] }];
    m('WordArt', () => {
      app.container().elements.push(el);
      app.sel = [el.id];
    });
  }, { hidden: true });

  // ---- Text formatting ----
  const toggleRun = (key: 'b' | 'i' | 'u' | 'strike') => applyRun(app, { [key]: !currentRun(app)[key] } as any);
  reg('bold', 'Bold', () => toggleRun('b'), { shortcut: 'Ctrl+B', section: 'Font' });
  reg('italic', 'Italic', () => toggleRun('i'), { shortcut: 'Ctrl+I', section: 'Font' });
  reg('underline', 'Underline', () => toggleRun('u'), { shortcut: 'Ctrl+U', section: 'Font' });
  reg('strike', 'Strikethrough', () => toggleRun('strike'), { section: 'Font' });
  reg('subscript', 'Subscript', () => applyRun(app, { base: (currentRun(app).base ?? 0) < 0 ? undefined : -25 }), { section: 'Font' });
  reg('superscript', 'Superscript', () => applyRun(app, { base: (currentRun(app).base ?? 0) > 0 ? undefined : 30 }), { section: 'Font' });
  reg('font-family', 'Font', (f: string) => {
    if (f) applyRun(app, { font: f });
  }, { hidden: true });
  reg('font-size', 'Font size', (s: string | number) => {
    const v = parseFloat(String(s));
    if (v > 0 && v < 1000) applyRun(app, { sz: v });
  }, { hidden: true });
  reg('font-grow', 'Increase font size', () => stepFontSize(app, 1), { shortcut: 'Ctrl+Shift+>', section: 'Font' });
  reg('font-shrink', 'Decrease font size', () => stepFontSize(app, -1), { shortcut: 'Ctrl+Shift+<', section: 'Font' });
  reg('text-color', 'Font color', (c: Color | null) => applyRun(app, { color: c ?? undefined }), { section: 'Font', keywords: 'colour' });
  reg('highlight', 'Text highlight color', (c: Color | null) => applyRun(app, { hl: c ?? undefined }), { section: 'Font' });
  reg('clear-format', 'Clear all formatting', () => clearFormatting(app), { section: 'Font' });
  reg('change-case', 'Change case', (mode: any) => setCase(app, mode), { hidden: true });
  reg('bullets', 'Bullets', () => toggleBullet(app), { section: 'Paragraph' });
  reg('bullet-char', 'Bullet style', (ch: string | null) => setBulletChar(app, ch), { hidden: true });
  reg('numbering', 'Numbering', (scheme?: string | null) => setNumbering(app, scheme === undefined ? 'arabicPeriod' : scheme), { section: 'Paragraph' });
  reg('indent', 'Increase list level', () => changeIndent(app, 1), { section: 'Paragraph' });
  reg('outdent', 'Decrease list level', () => changeIndent(app, -1), { section: 'Paragraph' });
  reg('align', 'Align text', (a: 'l' | 'ctr' | 'r' | 'just') => applyPara(app, { algn: a }), { hidden: true });
  reg('line-spacing', 'Line spacing', (v: number) => applyPara(app, { lnSpc: { pct: v } }), { hidden: true });
  const textShapes = () => els().filter((e): e is ShapeEl => e.type === 'shape');
  reg('text-direction', 'Text direction', (v: 'horz' | 'vert' | 'vert270') => {
    const shapes = textShapes();
    if (!shapes.length) return;
    m('Text direction', () => shapes.forEach((s) => { s.text ??= app.defaultShapeText(s); s.text.vert = v === 'horz' ? undefined : v; }));
  }, { hidden: true });
  reg('text-anchor', 'Align text vertically', (a: 't' | 'ctr' | 'b') => {
    const t = selTable();
    if (t) return void app.run('cell-anchor', a);
    const shapes = textShapes();
    if (!shapes.length) return;
    m('Vertical alignment', () => shapes.forEach((s) => { s.text ??= app.defaultShapeText(s); s.text.anchor = a; }));
  }, { hidden: true });
  reg('columns', 'Text columns', (n: number) => {
    const shapes = textShapes();
    if (!shapes.length) return;
    m('Columns', () => shapes.forEach((s) => { s.text ??= app.defaultShapeText(s); s.text.cols = n > 1 ? n : undefined; }));
  }, { hidden: true });
  reg('autofit', 'Text fitting', (mode: 'none' | 'shrink' | 'shape') => {
    const shapes = textShapes();
    if (!shapes.length) return;
    m('Autofit', () => shapes.forEach((s) => {
      s.text ??= app.defaultShapeText(s);
      s.text.autofit = mode;
      applyFit(s, fitShape(s, app.themeCtx(), app.curIndex + 1, app.pres.slides.length));
    }));
  }, { hidden: true });
  reg('text-wrap', 'Wrap text', () => {
    const shapes = textShapes();
    if (!shapes.length) return;
    m('Wrap text', () => shapes.forEach((s) => { s.text ??= app.defaultShapeText(s); s.text.wrap = s.text.wrap === false ? true : false; }));
  }, { hidden: true });

  // ---- Shapes & objects ----
  const fillOf = (c: Color | null) => (c ? ({ t: 'solid', c } as const) : ({ t: 'none' } as const));
  reg('shape-fill', 'Shape fill', (c: Color | null) => {
    const t = selTable();
    if (t) return void app.run('cell-fill', c);
    onShapes('Shape fill', (s) => (s.fill = fillOf(c)));
  }, { section: 'Shape', keywords: 'color' });
  reg('shape-outline', 'Shape outline', (c: Color | null) => {
    const pics = els().filter((e) => e.type === 'picture');
    if (pics.length && !textShapes().length) return void app.run('picture-border', c);
    onShapes('Shape outline', (s) => (s.line = { ...(s.line ?? { w: 1 }), c, w: s.line?.w || 1 }));
  }, { section: 'Shape' });
  reg('outline-weight', 'Outline weight', (w: number) => onShapes('Outline weight', (s) => (s.line = { ...(s.line ?? { c: { theme: 'accent1' } }), w } as Line)), { hidden: true });
  reg('outline-dash', 'Outline dash', (d: Line['dash']) => onShapes('Outline dash', (s) => s.line && (s.line.dash = d)), { hidden: true });
  reg('shape-effect', 'Shape effects', (k: string) => {
    const targets = els().filter((e): e is ShapeEl => e.type === 'shape' || e.type === 'picture') as (ShapeEl | { fx?: any })[];
    if (!targets.length) return;
    m('Effects', () => targets.forEach((t) => {
      const fx = (t.fx ??= {});
      if (k === 'none') delete fx.shadow;
      else if (k === 'shadow') fx.shadow = { c: '#000000', blur: 8, dist: 4, dir: 45, alpha: 0.4 };
      else if (k === 'shadow-soft') fx.shadow = { c: '#000000', blur: 18, dist: 6, dir: 90, alpha: 0.25 };
      else if (k === 'glow') fx.glow = { c: { theme: 'accent1' }, r: 10 };
      else if (k === 'no-glow') delete fx.glow;
    }));
  }, { hidden: true });
  reg('quick-style', 'Quick style', (o: { accent: any; kind: 'intense' | 'subtle' | 'outline' }) => {
    onShapes('Style', (s) => {
      const acc: Color = { theme: o.accent };
      if (o.kind === 'intense') {
        s.fill = { t: 'solid', c: acc };
        s.line = { c: { theme: o.accent, lumMod: 0.75 }, w: 1 };
        s.text && (s.text.lst = (s.text.lst ?? []).map((l) => ({ ...l, color: { theme: 'lt1' } as Color })));
      } else if (o.kind === 'subtle') {
        s.fill = { t: 'solid', c: { theme: o.accent, lumMod: 0.2, lumOff: 0.8 } };
        s.line = { c: acc, w: 1 };
        s.text && (s.text.lst = (s.text.lst ?? []).map((l) => ({ ...l, color: { theme: 'tx1' } as Color })));
      } else {
        s.fill = { t: 'solid', c: { theme: 'bg1' } };
        s.line = { c: acc, w: 2.25 };
        s.text && (s.text.lst = (s.text.lst ?? []).map((l) => ({ ...l, color: acc })));
      }
    });
  }, { hidden: true });
  reg('object-size', 'Size and position', (o: { x?: number; y?: number; w?: number; h?: number; rot?: number }) => {
    const sel = els();
    if (!sel.length) return;
    m('Size', () => {
      for (const e of sel) {
        if (o.x !== undefined) e.x = Math.round(o.x * 100) / 100;
        if (o.y !== undefined) e.y = Math.round(o.y * 100) / 100;
        if (o.w !== undefined) e.w = Math.max(1, Math.round(o.w * 100) / 100);
        if (o.h !== undefined) e.h = Math.max(1, Math.round(o.h * 100) / 100);
        if (o.rot !== undefined) e.rot = (((o.rot % 360) + 360) % 360) || undefined;
        if (e.type === 'table' && (o.w !== undefined || o.h !== undefined)) tableFitToFrame(e, e.w, e.h);
        if (e.type === 'shape') applyFit(e, fitShape(e, app.themeCtx(), app.curIndex + 1, app.pres.slides.length));
      }
    }, 'size');
  }, { hidden: true });
  reg('arrange', 'Arrange', (mode: 'front' | 'back' | 'forward' | 'backward') => m('Arrange', () => arrange(app.container().elements, app.sel, mode)), { section: 'Arrange', keywords: 'bring front send back' });
  reg('align-objects', 'Align objects', (mode: any) => {
    const sel = els();
    if (!sel.length) return;
    const within = sel.length === 1 ? { x: 0, y: 0, w: app.pres.size.w, h: app.pres.size.h } : unionBounds(sel);
    m('Align', () => alignEls(sel, mode, within));
  }, { hidden: true });
  reg('distribute', 'Distribute objects', (axis: 'h' | 'v') => m('Distribute', () => distribute(els(), axis)), { hidden: true });
  reg('group', 'Group', () => {
    if (app.sel.length < 2) return toast('Select two or more objects to group.');
    m('Group', () => {
      const g = groupEls(app.container().elements, app.sel);
      if (g) app.sel = [g.id];
    });
  }, { shortcut: 'Ctrl+G', section: 'Arrange' });
  reg('ungroup', 'Ungroup', () => {
    const groups = els().filter((e) => e.type === 'group');
    if (!groups.length) return;
    m('Ungroup', () => {
      const ids: string[] = [];
      for (const g of groups) ids.push(...ungroupEl(app.container().elements, g.id).map((c) => c.id));
      app.sel = ids;
    });
  }, { shortcut: 'Ctrl+Shift+G', section: 'Arrange' });
  reg('rotate', 'Rotate', (deg: number) => m('Rotate', () => rotateEls(els(), deg)), { hidden: true });
  reg('flip', 'Flip', (axis: 'h' | 'v') => m('Flip', () => flipEls(els(), axis)), { hidden: true });
  reg('change-shape', 'Change shape', (prst: string) => onShapes('Change shape', (s) => { if (!s.ink) s.geom = { prst }; }), { hidden: true });
  reg('toggle-lock', 'Lock or unlock object', () => m('Lock', () => els().forEach((e) => (e.locked = !e.locked || undefined))), { hidden: true });
  reg('alt-text', 'Alt text', () => altTextDialog(app), { section: 'Accessibility' });
  reg('format-pane', 'Format pane', () => app.showPane('format'), { section: 'View', keywords: 'format shape options' });
  reg('selection-pane', 'Selection pane', () => app.showPane('selection'), { section: 'View', keywords: 'objects layers' });
  reg('picture-format-pane', 'Format picture', () => app.showPane('format'), { hidden: true });

  // ---- Pictures ----
  const pics = () => els().filter((e) => e.type === 'picture') as Extract<El, { type: 'picture' }>[];
  reg('picture-replace', 'Change picture', async () => {
    const p = pics()[0];
    if (!p) return toast('Select a picture first.');
    const f = (await window.bnc.openMedia('image'))[0];
    if (!f) return;
    const id = addMedia(app.deck.media, f.name, f.data);
    m('Change picture', () => (p.media = id));
  }, { section: 'Picture' });
  reg('picture-crop', 'Crop picture', () => cropDialog(app), { section: 'Picture' });
  reg('picture-adjust', 'Adjust picture', (o: { brightness?: number; contrast?: number; gray?: boolean }) => {
    const ps = pics();
    if (!ps.length) return;
    m('Adjust picture', () => ps.forEach((p) => {
      if (o.brightness !== undefined) p.brightness = Math.max(-1, Math.min(1, (p.brightness ?? 0) + o.brightness)) || undefined;
      if (o.contrast !== undefined) p.contrast = Math.max(-1, Math.min(1, (p.contrast ?? 0) + o.contrast)) || undefined;
      if (o.gray) p.gray = true;
    }));
  }, { hidden: true });
  reg('picture-reset', 'Reset picture', () => m('Reset picture', () => pics().forEach((p) => { delete p.brightness; delete p.contrast; delete p.gray; delete p.alpha; })), { hidden: true });
  reg('picture-border', 'Picture border', (c: Color | null) => m('Picture border', () => pics().forEach((p) => (p.line = c ? { c, w: p.line?.w || 2.25 } : undefined))), { hidden: true });
  reg('picture-shape', 'Picture shape', (prst: string) => m('Picture shape', () => pics().forEach((p) => (p.geom = prst === 'rect' ? undefined : { prst }))), { hidden: true });

  // ---- Tables ----
  const tableOp = (label: string, fn: (t: TableEl, r: number, c: number) => void) => {
    const t = selTable();
    if (!t) return toast('Click inside a table first.');
    const { r, c } = anchorCell(t);
    m(label, () => fn(t, r, c));
    setTimeout(() => {
      app.canvas.measureTable(t);
      app.canvas.render();
    }, 20);
  };
  reg('table-row-above', 'Insert row above', () => tableOp('Insert row', (t, r) => tableInsertRow(t, r, r)), { section: 'Table' });
  reg('table-row-below', 'Insert row below', () => tableOp('Insert row', (t, r) => tableInsertRow(t, r + 1, r)), { section: 'Table' });
  reg('table-col-left', 'Insert column left', () => tableOp('Insert column', (t, _r, c) => tableInsertCol(t, c)), { section: 'Table' });
  reg('table-col-right', 'Insert column right', () => tableOp('Insert column', (t, _r, c) => tableInsertCol(t, c + 1)), { section: 'Table' });
  reg('table-delete-row', 'Delete row', () => tableOp('Delete row', (t, r) => { tableDeleteRow(t, r); app.cellSel = null; }), { section: 'Table' });
  reg('table-delete-col', 'Delete column', () => tableOp('Delete column', (t, _r, c) => { tableDeleteCol(t, c); app.cellSel = null; }), { section: 'Table' });
  reg('table-merge', 'Merge cells', () => tableOp('Merge cells', (t) => { const q = cellRange(t); tableMerge(t, q.r0, q.c0, q.r1, q.c1); }), { section: 'Table' });
  reg('table-split', 'Split cell', () => tableOp('Split cell', (t, r, c) => tableSplit(t, r, c)), { section: 'Table' });
  reg('table-equal-rows', 'Distribute rows', () => tableOp('Distribute rows', (t) => tableEqualRows(t)), { section: 'Table' });
  reg('table-equal-cols', 'Distribute columns', () => tableOp('Distribute columns', (t) => tableEqualCols(t)), { section: 'Table' });
  reg('table-row-height', 'Row height', (h_: number) => tableOp('Row height', (t) => { const q = cellRange(t); for (let r = q.r0; r <= q.r1; r++) t.rows[r].h = Math.max(10, h_); t.h = t.rows.reduce((a, r) => a + r.h, 0); }), { hidden: true });
  reg('table-style', 'Table style', (id: string) => tableOp('Table style', (t) => { t.style.id = id; tableRestyle(t); }), { hidden: true });
  reg('table-option', 'Table style options', (o: { key: keyof TableEl['style']; value: boolean }) => tableOp('Table options', (t) => { (t.style as any)[o.key] = o.value; tableRestyle(t); }), { hidden: true });
  reg('cell-fill', 'Cell shading', (c: Color | null) => tableOp('Cell shading', (t) => { const q = cellRange(t); for (let r = q.r0; r <= q.r1; r++) for (let cc = q.c0; cc <= q.c1; cc++) t.rows[r].cells[cc].fill = c ? { t: 'solid', c } : undefined; }), { hidden: true });
  reg('cell-anchor', 'Cell vertical alignment', (a: 't' | 'ctr' | 'b') => tableOp('Cell alignment', (t) => { const q = cellRange(t); for (let r = q.r0; r <= q.r1; r++) for (let cc = q.c0; cc <= q.c1; cc++) t.rows[r].cells[cc].anchor = a; }), { hidden: true });
  reg('table-borders', 'Table borders', (kind: 'all' | 'none' | 'outside') => tableOp('Borders', (t) => {
    const q = cellRange(t);
    const ln: Line = { c: { theme: 'tx1' }, w: 1 };
    for (let r = q.r0; r <= q.r1; r++) for (let c = q.c0; c <= q.c1; c++) {
      const cell = t.rows[r].cells[c];
      if (kind === 'none') cell.borders = undefined;
      else if (kind === 'all') cell.borders = { l: ln, r: ln, t: ln, b: ln };
      else cell.borders = { ...(cell.borders ?? {}), ...(c === q.c0 ? { l: ln } : {}), ...(c === q.c1 ? { r: ln } : {}), ...(r === q.r0 ? { t: ln } : {}), ...(r === q.r1 ? { b: ln } : {}) };
    }
  }), { hidden: true });
  reg('table-clear-cells', 'Clear cell contents', () => tableOp('Clear cells', (t) => { const q = cellRange(t); for (let r = q.r0; r <= q.r1; r++) for (let c = q.c0; c <= q.c1; c++) t.rows[r].cells[c].text.paras = [{ runs: [] }]; }), { hidden: true });

  // ---- Charts ----
  const chart = () => {
    const e = app.singleSelected();
    return e?.type === 'chart' ? e : undefined;
  };
  reg('chart-data', 'Edit chart data', () => chartDataDialog(app), { section: 'Chart' });
  reg('chart-type', 'Change chart type', (k: ChartKind) => { const c = chart(); if (c) m('Chart type', () => (c.kind = k)); }, { hidden: true });
  reg('chart-toggle', 'Chart elements', (what: 'title' | 'labels' | 'grid') => {
    const c = chart();
    if (!c) return;
    m('Chart', () => {
      if (what === 'title') c.title = c.title ? undefined : 'Chart Title';
      else if (what === 'labels') c.labels = !c.labels;
      else c.grid = c.grid === false;
    });
  }, { hidden: true });
  reg('chart-legend', 'Chart legend', (pos: any) => { const c = chart(); if (c) m('Legend', () => (c.legend = pos)); }, { hidden: true });

  // ---- Media ----
  reg('media-option', 'Media options', (o: { autoplay?: boolean; loop?: boolean }) => {
    const e = app.singleSelected();
    if (e?.type !== 'media') return;
    m('Media', () => Object.assign(e, o));
  }, { hidden: true });
  reg('media-preview', 'Preview media', () => toast('Play the slide show to hear and see media.'), { hidden: true });

  // ---- Transitions ----
  const slides = () => (app.slideSel.length > 1 ? app.pres.slides.filter((s) => app.slideSel.includes(s.id)) : [app.curSlide()]);
  reg('transition', 'Slide transition', (type: string) => m('Transition', () => slides().forEach((s) => {
    if (type === 'none') delete s.transition;
    else s.transition = { ...(s.transition ?? {}), type, dur: s.transition?.dur ?? 0.7, dir: undefined };
  })), { section: 'Transitions' });
  reg('transition-dir', 'Transition options', (dir: string) => m('Transition', () => slides().forEach((s) => s.transition && (s.transition.dir = dir))), { hidden: true });
  reg('transition-duration', 'Transition duration', (d: number) => m('Transition', () => slides().forEach((s) => s.transition && (s.transition.dur = Math.max(0.1, d)))), { hidden: true });
  reg('transition-apply-all', 'Apply transition to all slides', () => {
    const t = app.curSlide().transition;
    m('Transition', () => app.pres.slides.forEach((s) => (s.transition = t ? { ...t } : undefined)));
  }, { section: 'Transitions' });
  reg('transition-advance', 'Advance slide', (o: { click?: boolean; after?: number }) => m('Advance', () => slides().forEach((s) => {
    const t = (s.transition ??= { type: 'none' } as Transition);
    if (o.click !== undefined) t.advClick = o.click ? undefined : false;
    if (o.after !== undefined) t.advAfter = o.after > 0 ? o.after : undefined;
    if (t.type === 'none' && !t.advAfter && t.advClick === undefined) delete s.transition;
  })), { hidden: true });
  reg('transition-preview', 'Preview transition', () => {
    if (app.curIndex === 0) return toast('Pick a slide after the first one to preview its transition.');
    return startShow(app, { from: app.curIndex - 1 }).then(() => undefined);
  }, { section: 'Transitions' });

  // ---- Animations ----
  const targetsAnim = () => {
    const sel = els();
    return app.curSlide().anims?.filter((a) => sel.some((e) => e.id === a.target)) ?? [];
  };
  const mkAnim = (target: string, fx: { effect: string; cls: Anim['cls'] }): Anim => ({ id: uid('a'), target, cls: fx.cls ?? 'entr', effect: fx.effect, trigger: 'click', dur: fx.effect === 'appear' ? 0.01 : 0.5, delay: 0, dir: fx.effect === 'fly' ? 'b' : fx.effect === 'wipe' ? 'l' : undefined });
  reg('anim-set', 'Set animation', (fx: { effect: string; cls: Anim['cls'] } | null) => {
    const sel = els();
    if (!sel.length) return toast('Select an object to animate.');
    const s = app.curSlide();
    m('Animation', () => {
      s.anims = (s.anims ?? []).filter((a) => !sel.some((e) => e.id === a.target));
      if (fx) for (const e of sel) s.anims.push(mkAnim(e.id, fx));
      if (!s.anims.length) delete s.anims;
    });
    app.refreshDock();
    if (fx) void app.run('anim-preview');
  }, { section: 'Animations', keywords: 'animate effect fly fade' });
  reg('anim-add', 'Add animation', (fx: { effect: string; cls: Anim['cls'] }) => {
    const sel = els();
    if (!sel.length) return toast('Select an object to animate.');
    const s = app.curSlide();
    m('Animation', () => (s.anims ??= []).push(...sel.map((e) => mkAnim(e.id, fx))));
    app.refreshDock();
  }, { hidden: true });
  const editAnim = (fn: (a: Anim) => void) => {
    const list = targetsAnim();
    if (!list.length) return toast('Select an animated object first.');
    m('Animation', () => list.forEach(fn));
    app.refreshDock();
  };
  reg('anim-dir', 'Animation direction', (d: string) => editAnim((a) => (a.dir = d)), { hidden: true });
  reg('anim-start', 'Animation start', (v: Anim['trigger']) => editAnim((a) => (a.trigger = v)), { hidden: true });
  reg('anim-duration', 'Animation duration', (v: number) => editAnim((a) => (a.dur = Math.max(0.01, v))), { hidden: true });
  reg('anim-delay', 'Animation delay', (v: number) => editAnim((a) => (a.delay = Math.max(0, v))), { hidden: true });
  const moveAnim = (dir: -1 | 1) => {
    const s = app.curSlide();
    const list = targetsAnim();
    if (!list.length || !s.anims) return;
    m('Reorder animation', () => {
      const i = s.anims!.indexOf(list[0]);
      const j = i + dir;
      if (j >= 0 && j < s.anims!.length) [s.anims![i], s.anims![j]] = [s.anims![j], s.anims![i]];
    });
    app.refreshDock();
  };
  reg('anim-earlier', 'Move animation earlier', () => moveAnim(-1), { hidden: true });
  reg('anim-later', 'Move animation later', () => moveAnim(1), { hidden: true });
  reg('anim-remove', 'Remove animation', () => {
    const list = targetsAnim();
    const s = app.curSlide();
    if (!list.length) return;
    m('Remove animation', () => (s.anims = s.anims!.filter((a) => !list.includes(a))));
    app.refreshDock();
  }, { hidden: true });
  reg('anim-pane', 'Animation pane', () => app.showPane('animations'), { section: 'Animations' });
  reg('anim-preview', 'Preview animations', () => {
    if (!app.curSlide().anims?.length) return toast('This slide has no animations.');
    return startShow(app, { from: app.curIndex, previewAnims: true });
  }, { section: 'Animations' });

  // ---- Slide show ----
  reg('show-start', 'Start slide show from the beginning', () => startShow(app, { from: 0 }), { shortcut: 'F5', section: 'Slide Show', keywords: 'present play' });
  reg('show-current', 'Start slide show from this slide', () => startShow(app, { from: app.curIndex }), { shortcut: 'Shift+F5', section: 'Slide Show', keywords: 'present play' });
  reg('show-setup', 'Set up slide show', () => setupShowDialog(app), { section: 'Slide Show' });

  // ---- Review ----
  reg('spelling', 'Spelling check', () => {
    app.spellcheck = !app.spellcheck;
    document.querySelectorAll('.ProseMirror, .notes-input').forEach((n) => n.setAttribute('spellcheck', String(app.spellcheck)));
    app.refreshUi();
    toast(app.spellcheck ? 'Spell check is on' : 'Spell check is off');
  }, { section: 'Review' });
  reg('word-count', 'Word count', () => wordCountDialog(app), { section: 'Review' });
  reg('accessibility', 'Check accessibility', () => accessibilityDialog(app), { section: 'Review' });
  reg('toggle-comments', 'Show comments', () => app.showPane('comments'), { section: 'Review' });
  reg('comment-new', 'New comment', () => {
    if (app.dockKind !== 'comments') app.showPane('comments');
    setTimeout(() => document.getElementById('comment-input')?.focus(), 40);
  }, { section: 'Review' });
  reg('comment-delete', 'Delete comment', () => {
    const s = app.curSlide();
    if (!s.comments?.length) return;
    m('Delete comment', () => s.comments!.pop());
    app.refreshDock();
  }, { hidden: true });
  const commentNav = (dir: 1 | -1) => {
    const idx = app.pres.slides.map((s, i) => (s.comments?.length ? i : -1)).filter((i) => i >= 0);
    const target = dir > 0 ? idx.find((i) => i > app.curIndex) : [...idx].reverse().find((i) => i < app.curIndex);
    if (target !== undefined) app.goto(target);
    else toast('No more comments');
  };
  reg('comment-next', 'Next comment', () => commentNav(1), { hidden: true });
  reg('comment-prev', 'Previous comment', () => commentNav(-1), { hidden: true });

  // ---- View ----
  reg('view-normal', 'Normal view', () => {
    app.showSorter(false);
    if (app.masterView) void app.run('master-close');
  }, { section: 'View' });
  reg('view-sorter', 'Slide sorter', () => app.showSorter(true), { section: 'View' });
  reg('master-open', 'Slide master view', () => {
    app.canvas.endTextEdit();
    app.showSorter(false);
    app.masterView = { kind: 'layout', id: app.curSlide().layoutId };
    app.sel = [];
    app.fullRender();
    setTimeout(() => app.canvas.fit(), 20);
  }, { section: 'View', keywords: 'layout template master' });
  reg('master-close', 'Close master view', () => {
    app.canvas.endTextEdit();
    app.masterView = null;
    app.panel.resetMasterCache();
    app.sel = [];
    app.fullRender();
    setTimeout(() => app.canvas.fit(), 20);
  }, { section: 'View' });
  reg('layout-insert', 'Insert layout', () => {
    const base = app.masterView?.kind === 'layout' ? (app.container() as any) : app.pres.layouts[0];
    const mid = base.masterId ?? app.pres.masters[0].id;
    const l = { id: uid('l'), masterId: mid, name: 'Custom Layout', elements: base.elements ? clone(base.elements).map((e: El) => ({ ...e, id: uid() })) : [] };
    m('Insert layout', () => app.pres.layouts.push(l));
    app.masterView = { kind: 'layout', id: l.id };
    app.fullRender();
  }, { hidden: true });
  reg('layout-rename', 'Rename layout', async (id?: string) => {
    const l = app.pres.layouts.find((x) => x.id === (id ?? app.masterView?.id));
    if (!l) return;
    const name = await prompt('Rename Layout', 'Layout name', l.name, 'Rename');
    if (name) m('Rename layout', () => (l.name = name));
    app.fullRender();
  }, { hidden: true });
  reg('layout-duplicate', 'Duplicate layout', (id?: string) => {
    const l = app.pres.layouts.find((x) => x.id === (id ?? app.masterView?.id));
    if (!l) return;
    const copy = { ...clone(l), id: uid('l'), name: `${l.name} copy` };
    copy.elements = copy.elements.map((e) => ({ ...e, id: uid() }));
    m('Duplicate layout', () => app.pres.layouts.splice(app.pres.layouts.indexOf(l) + 1, 0, copy));
    app.masterView = { kind: 'layout', id: copy.id };
    app.fullRender();
  }, { hidden: true });
  reg('layout-delete', 'Delete layout', async (id?: string) => {
    const l = app.pres.layouts.find((x) => x.id === (id ?? app.masterView?.id));
    if (!l) return;
    if (app.pres.layouts.length <= 1) return toast('A presentation needs at least one layout.');
    if (app.pres.slides.some((s) => s.layoutId === l.id) && !(await app.confirm('Delete layout', `Slides use "${l.name}". They will switch to another layout. Delete it?`, 'Delete', true))) return;
    const fallback = app.pres.layouts.find((x) => x !== l)!;
    m('Delete layout', () => {
      app.pres.slides.forEach((s) => s.layoutId === l.id && (s.layoutId = fallback.id));
      app.pres.layouts = app.pres.layouts.filter((x) => x !== l);
    });
    app.masterView = { kind: 'layout', id: fallback.id };
    app.fullRender();
  }, { hidden: true });
  reg('layout-placeholder', 'Insert placeholder', (type: string) => {
    if (!app.masterView) return;
    const { w: sw } = app.pres.size;
    const el: ShapeEl = { id: uid(), type: 'shape', name: `${type} placeholder`, x: 66, y: 150, w: sw - 132, h: 200, ph: { type: type as any, idx: Math.max(0, ...app.container().elements.map((e) => e.ph?.idx ?? 0)) + 1 }, geom: { prst: 'rect' }, text: { paras: [{ runs: [] }], lst: clone(app.pres.masters[0].txStyles.body), wrap: true, insets: [7.2, 3.6, 7.2, 3.6], anchor: 't', autofit: 'shrink' } };
    m('Insert placeholder', () => { app.container().elements.push(el); app.sel = [el.id]; });
  }, { hidden: true });
  reg('toggle-notes', 'Show or hide notes', () => app.setNotesVisible(!app.showNotes), { section: 'View' });
  reg('toggle-gridlines', 'Show gridlines', () => { app.showGridlines = !app.showGridlines; app.canvas.renderOverlay(); app.refreshUi(); }, { section: 'View' });
  reg('toggle-snap', 'Snap to objects', () => { app.snapOn = !app.snapOn; app.refreshUi(); }, { section: 'View' });
  reg('zoom-set', 'Set zoom', (z: number) => app.canvas.setZoom(z), { hidden: true });
  reg('zoom-fit', 'Fit slide to window', () => app.canvas.fit(), { section: 'View' });
  reg('zoom-100', 'Zoom to 100%', () => app.canvas.setZoom(1), { section: 'View' });
  reg('toggle-dark', 'Dark mode', () => app.setTheme(app.theme === 'dark' ? 'light' : 'dark'), { section: 'View', keywords: 'light theme night' });

  // ---- Draw ----
  reg('tool-select', 'Select', () => app.setTool(null), { section: 'Draw' });
  reg('tool-pen', 'Pen', (pen: 'pen' | 'pencil' | 'highlighter' = 'pen') => {
    const color = pen === 'highlighter' ? '#ffd400' : app.pen.color;
    const w = pen === 'highlighter' ? 6 : pen === 'pencil' ? 1 : app.pen.w;
    app.pen = { pen, color: pen === 'highlighter' ? color : app.pen.color, w: pen === 'highlighter' ? w : app.pen.w };
    app.setTool({ kind: 'ink', pen, color, w: pen === 'pencil' ? Math.min(w, 1.5) : w });
  }, { section: 'Draw', keywords: 'ink pencil highlighter' });
  reg('tool-eraser', 'Eraser', () => app.setTool({ kind: 'eraser' }), { section: 'Draw' });
  reg('pen-color', 'Pen color', (c: Color) => {
    app.pen = { ...app.pen, color: c };
    if (app.tool?.kind === 'ink') app.setTool({ ...app.tool, color: c });
  }, { hidden: true });
  reg('pen-width', 'Pen thickness', (w: number) => {
    app.pen = { ...app.pen, w };
    if (app.tool?.kind === 'ink') app.setTool({ ...app.tool, w });
  }, { hidden: true });

  void allElements;
  void slideTitle;
  void applyTableStyle;
  void tableStyleById;
  void LINE_PRESETS;
  void newSlideFromLayout;
}
