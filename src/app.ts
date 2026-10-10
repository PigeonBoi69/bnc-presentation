import slideCss from './styles/slide.css?inline';
import { css as cssColor, type ThemeCtx } from './core/color';
import { LINE_PRESETS } from './core/geometry';
import { addMedia, imageSize, mediaDuration, mediaUrl, releaseMedia } from './core/media';
import {
  blankDeck,
  clone,
  layoutOf,
  masterOf,
  newPicture,
  newShape,
  newTextBox,
  plainText,
  slideTitle,
  uid,
  type Color,
  type Deck,
  type El,
  type Layout,
  type Master,
  type MediaEl,
  type Pres,
  type ShapeEl,
  type Slide,
  type TextBody,
} from './core/model';
import { baseName, decodeFile, encodeFile, FORMAT_INFO, formatFromName, type Format } from './core/io';
import { elementHtml, slideContext, themeCtxOf, type RenderOpts } from './core/render';
import { buildImagePages, buildPdfHtml, buildSlideshowHtml } from './core/export-html';
import { Canvas, type CellSel, type Tool } from './editor/canvas';
import { cloneEl } from './editor/ops';
import { applyRun } from './editor/format';
import { debounce, h, iconEl, macify, showMenu, toast, prompt, confirmBox, contextMenu, type MenuItem } from './ui/dom';
import { registerCommands, type Command } from './commands';
import { buildRibbon } from './ui/ribbon';
import { SlidePanel } from './ui/thumbs';
import { aboutDialog } from './ui/dialogs';
import type { FindBar } from './ui/findbar';
import { cloudPicker, nextcloudDialog } from './ui/cloud';
import { installStyleBytes, refreshStyles } from './ui/styles';
import type { AppStyle, DocFile, StyleState } from './types/bnc';

export interface DocState {
  name: string;
  format: Format;
  local?: string;
  cloud?: { path: string; etag?: string };
  dirty: boolean;
}

interface Snap {
  json: string;
  label: string;
  cur: number;
  sel: string[];
  key?: string;
  t: number;
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e));

export class App {
  deck: Deck = blankDeck();
  get pres(): Pres {
    return this.deck.pres;
  }
  doc: DocState = { name: 'Presentation', format: 'bncpres', dirty: false };
  cmds = new Map<string, Command>();

  curIndex = 0;
  sel: string[] = [];
  slideSel: string[] = [];
  cellSel: CellSel | null = null;
  tool: Tool | null = null;
  masterView: { kind: 'layout' | 'master'; id: string } | null = null;
  view: 'normal' | 'sorter' = 'normal';
  readOnly = false;
  showGridlines = false;
  snapOn = true;
  showNotes = true;
  theme: 'dark' | 'light' = 'dark';
  autosave = false;
  ribbonMode: 'classic' | 'simplified' = 'classic';
  ribbonCollapsed = false;
  spellcheck = true;
  version = '0.1.0';
  ncUser: string | null = null;
  styleState: StyleState = { styles: [], broken: [], active: null, dir: '' };
  activeStyle: AppStyle | null = null;
  painter: { runs: Record<string, unknown>; } | null = null;
  clip: { kind: 'elements'; els: El[]; text: string } | { kind: 'slides'; slides: Slide[]; text: string } | null = null;
  /** the last picked pen, shared by the Draw tab */
  pen: { pen: 'pen' | 'pencil' | 'highlighter'; color: Color; w: number } = { pen: 'pen', color: '#e11d48', w: 2.25 };
  recent: string[] = [];

  // DOM refs
  root!: HTMLElement;
  desk!: HTMLElement;
  menubar!: HTMLElement;
  ribbonHost!: HTMLElement;
  dock!: HTMLElement;
  notesPane!: HTMLElement;
  notesInput!: HTMLTextAreaElement;
  center!: HTMLElement;
  sorter!: HTMLElement;
  panelHost!: HTMLElement;
  titleName!: HTMLElement;
  autosaveBtn!: HTMLButtonElement;
  saveState!: HTMLElement;
  status!: { slide: HTMLElement; zoomRange: HTMLInputElement; zoomLabel: HTMLElement; cloud: HTMLElement; views: HTMLElement[]; comments: HTMLElement };
  canvas!: Canvas;
  panel!: SlidePanel;
  findBar!: FindBar;
  dockKind: string | null = null;
  panes = new Map<string, (app: App) => HTMLElement>();

  /** set by the ribbon: rebuilds contextual tabs when the selection changes */
  ctxWatcher: (() => void) | null = null;
  private refreshers: (() => void)[] = [];
  private undoStack: Snap[] = [];
  private redoStack: Snap[] = [];
  private snapJson = '';
  private autosaveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  // -------------------------------------------------------------------------
  // Startup
  // -------------------------------------------------------------------------
  async init() {
    const info = await window.bnc.ready();
    this.version = info.version;
    // lets the stylesheet adapt the title bar (macOS has its traffic lights on the left, not window buttons on the right)
    document.documentElement.classList.add(`platform-${info.platform}`);
    const settings = await window.bnc.getSettings();
    this.theme = settings.theme === 'light' ? 'light' : 'dark';
    this.autosave = !!settings.autosave;
    this.ribbonMode = settings.ribbon === 'simplified' ? 'simplified' : 'classic';
    this.recent = settings.recent ?? [];
    this.applyTheme();

    document.head.append(h('style', { attrs: { id: 'slide-css' }, text: slideCss }));
    this.buildShell();
    await refreshStyles(this).catch((e) => console.warn('Could not load app styles', e));
    this.canvas = new Canvas(this, this.desk);
    this.panel = new SlidePanel(this, this.panelHost);
    registerCommands(this);
    buildRibbon(this);
    this.bindGlobalEvents();
    this.refreshCloudState();

    if (info.files.length) await this.loadFile(info.files[0]);
    else this.newPresentation(true);

    window.bnc.onOpenFile((f) => void this.openFileGuarded(f));
    window.bnc.onCloseRequest(async () => {
      if (!this.doc.dirty || (await this.confirmDiscard())) window.bnc.closeConfirmed();
      else window.bnc.closeCancelled?.();
    });
    // macOS menu bar items that must go through the app's own undo history, or into a text box if one has focus
    window.bnc.onMenuCommand?.((id) => {
      const el = document.activeElement;
      if ((id === 'undo' || id === 'redo') && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) document.execCommand(id);
      else void this.run(id);
    });
    this.fullRender();
    setTimeout(() => this.canvas.fit(), 30);
  }

  /** Register a function that re-syncs a ribbon control with the editor state. */
  onRefresh(fn: () => void) {
    this.refreshers.push(fn);
  }
  clearRefreshers() {
    this.refreshers = [];
  }

  refreshUi = debounce(() => {
    this.ctxWatcher?.();
    for (const fn of this.refreshers) fn();
    this.updateStatus();
  }, 30);

  // -------------------------------------------------------------------------
  // Shell
  // -------------------------------------------------------------------------
  private buildShell() {
    const logo = h('img', { class: 'app-logo', attrs: { src: './icon.png', alt: 'BNC Presentation' } });
    this.titleName = h('span', { class: 'name', title: 'Click to rename', text: this.doc.name, on: { click: () => void this.run('rename') } });
    this.saveState = h('span', { class: 'save-state' });
    this.autosaveBtn = h('button', { class: 'autosave', on: { click: () => this.toggleAutosave() } });
    const search = this.buildSearch();

    const titlebar = h(
      'header',
      { class: 'titlebar' },
      logo,
      h('div', { class: 'doc-title' }, this.titleName, this.saveState, this.autosaveBtn),
      search,
      h('div', { class: 'spacer' }),
      h('button', { class: 'chip-btn', title: 'Comments', on: { click: () => void this.run('toggle-comments') } }, iconEl('comment', 15), h('span', { text: 'Comments' })),
      h('button', { class: 'chip-btn', title: 'Editing mode', on: { click: (e) => this.editModeMenu(e.currentTarget) } }, iconEl('penLine', 15), h('span', { text: 'Editing' }), iconEl('chevron', 14)),
      h('button', { class: 'chip-btn', title: 'Start the slide show (F5)', on: { click: () => void this.run('show-start') } }, iconEl('monitorPlay', 15), h('span', { text: 'Present' })),
      h('button', { class: 'chip-btn primary', title: 'Nextcloud', on: { click: (e) => this.cloudMenu(e.currentTarget) } }, iconEl('cloud', 15), h('span', { text: 'Nextcloud' })),
    );

    this.menubar = h('nav', { class: 'menubar' });
    this.ribbonHost = h('div', { class: 'ribbon-wrap' });

    this.panelHost = h('aside', { class: 'slidepanel' });
    this.desk = h('div', { class: 'desk' });
    this.notesInput = h('textarea', { class: 'notes-input', attrs: { placeholder: 'Click to add notes', spellcheck: 'true', 'aria-label': 'Speaker notes' } });
    this.notesInput.addEventListener('input', () => this.onNotesInput());
    const notesResize = h('div', { class: 'notes-resize', title: 'Drag to resize' });
    this.notesPane = h('div', { class: 'notes' }, notesResize, this.notesInput);
    this.bindNotesResize(notesResize);
    this.sorter = h('div', { class: 'sorter', style: { display: 'none' } });
    this.center = h('div', { class: 'center' }, this.desk, this.sorter, this.notesPane);
    this.dock = h('aside', { class: 'dock', style: { display: 'none' } });
    const workspace = h('div', { class: 'workspace' }, this.panelHost, this.center, this.dock);

    const slideStat = h('span', { class: 'stat', text: 'Slide 1 of 1' });
    const commentStat = h('span', { class: 'stat', style: { cursor: 'pointer' }, on: { click: () => void this.run('toggle-comments') } });
    const cloudStat = h('span', { class: 'stat' });
    const zoomRange = h('input', { attrs: { type: 'range', min: '10', max: '300', step: '5', value: '100', 'aria-label': 'Zoom' } });
    zoomRange.addEventListener('input', () => this.canvas.setZoom(Number(zoomRange.value) / 100));
    const zoomLabel = h('span', { class: 'stat', text: '100%' });
    const viewBtn = (id: string, icon: Parameters<typeof iconEl>[0], title: string, cmd: string) => h('button', { title, class: 'vbtn', dataset: { view: id }, on: { click: () => void this.run(cmd) } }, iconEl(icon, 14));
    const views = [viewBtn('normal', 'presentation', 'Normal view', 'view-normal'), viewBtn('sorter', 'sorter', 'Slide Sorter', 'view-sorter'), viewBtn('show', 'monitorPlay', 'Slide Show (F5)', 'show-start')];
    const notesBtn = h('button', { title: 'Show or hide the notes pane', on: { click: () => void this.run('toggle-notes') } }, iconEl('notes', 14), 'Notes');
    const statusbar = h(
      'footer',
      { class: 'statusbar' },
      slideStat,
      h('span', { class: 'stat', text: 'English (U.S.)' }),
      commentStat,
      cloudStat,
      h('div', { class: 'grow' }),
      notesBtn,
      h('div', { class: 'viewbtns' }, ...views),
      h(
        'div',
        { class: 'zoom-ctl' },
        h('button', { title: 'Zoom out', on: { click: () => this.canvas.setZoom(this.canvas.zoom - 0.1) } }, iconEl('minus', 14)),
        zoomRange,
        h('button', { title: 'Zoom in', on: { click: () => this.canvas.setZoom(this.canvas.zoom + 0.1) } }, iconEl('plus', 14)),
        zoomLabel,
        h('button', { title: 'Fit slide to window', on: { click: () => this.canvas.fit() } }, iconEl('fit', 14), 'Fit'),
      ),
    );
    this.status = { slide: slideStat, zoomRange, zoomLabel, cloud: cloudStat, views, comments: commentStat };

    const dropHint = h('div', { class: 'drop-hint', attrs: { id: 'drop-hint' }, text: 'Drop a presentation to open it, or a picture to insert it' });
    this.root.append(titlebar, this.menubar, this.ribbonHost, workspace, statusbar, dropHint);
  }

  private bindNotesResize(handle: HTMLElement) {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = this.notesPane.offsetHeight;
      const move = (ev: PointerEvent) => {
        this.notesPane.style.height = `${Math.max(40, Math.min(400, startH + (startY - ev.clientY)))}px`;
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  private buildSearch(): HTMLElement {
    const input = h('input', { attrs: { type: 'text', placeholder: 'Search for tools, help, and more (Alt + Q)', id: 'cmd-search' } });
    const results = h('div', { class: 'search-results', style: { display: 'none' } });
    let sel = 0;
    let shown: Command[] = [];
    const render = () => {
      const q = input.value.trim().toLowerCase();
      results.replaceChildren();
      if (!q) {
        results.style.display = 'none';
        return;
      }
      shown = [...this.cmds.values()].filter((c) => !c.hidden && `${c.label} ${c.keywords ?? ''}`.toLowerCase().includes(q)).slice(0, 12);
      sel = 0;
      shown.forEach((c, i) => {
        const row = h('div', { class: `search-result${i === 0 ? ' sel' : ''}` }, h('span', { text: c.label }), h('small', { text: macify(c.shortcut ?? c.section ?? '') }));
        row.addEventListener('mousedown', (e) => {
          e.preventDefault();
          choose(c);
        });
        results.append(row);
      });
      if (!shown.length) results.append(h('div', { class: 'search-result' }, h('span', { class: 'muted', text: 'No matching commands' })));
      results.style.display = 'block';
    };
    const choose = (c: Command) => {
      input.value = '';
      results.style.display = 'none';
      input.blur();
      void this.run(c.id);
    };
    input.addEventListener('input', render);
    input.addEventListener('blur', () => setTimeout(() => (results.style.display = 'none'), 120));
    input.addEventListener('focus', render);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        sel = Math.max(0, Math.min(shown.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1)));
        [...results.children].forEach((r, i) => r.classList.toggle('sel', i === sel));
      } else if (e.key === 'Enter' && shown[sel]) {
        e.preventDefault();
        choose(shown[sel]);
      } else if (e.key === 'Escape') {
        input.value = '';
        input.blur();
      }
    });
    return h('div', { class: 'search-box' }, iconEl('search', 15), input, results);
  }

  // -------------------------------------------------------------------------
  // Containers, contexts, rendering helpers
  // -------------------------------------------------------------------------
  /** What the canvas edits right now: the current slide, or a layout / master in Slide Master view. */
  container(): Slide | Layout | Master {
    if (this.masterView) {
      const mv = this.masterView;
      if (mv.kind === 'master') return this.pres.masters.find((m) => m.id === mv.id) ?? this.pres.masters[0];
      return this.pres.layouts.find((l) => l.id === mv.id) ?? this.pres.layouts[0];
    }
    this.curIndex = Math.max(0, Math.min(this.curIndex, this.pres.slides.length - 1));
    return this.pres.slides[this.curIndex];
  }
  curSlide(): Slide {
    this.curIndex = Math.max(0, Math.min(this.curIndex, this.pres.slides.length - 1));
    return this.pres.slides[this.curIndex];
  }
  themeCtxFor(c: Slide | Layout | Master): ThemeCtx {
    if ('layoutId' in c) return slideContext(this.pres, c).ctx;
    if ('masterId' in c) return themeCtxOf(masterOf(this.pres, c));
    return themeCtxOf(c);
  }
  themeCtx(): ThemeCtx {
    return this.themeCtxFor(this.container());
  }
  colorCss(c: Color): string {
    return cssColor(c, this.themeCtx());
  }
  renderOpts(extra: Partial<RenderOpts> = {}, slide?: Slide): RenderOpts {
    const idx = slide ? this.pres.slides.indexOf(slide) : this.curIndex;
    return {
      pres: this.pres,
      media: (id) => mediaUrl(this.deck.media, id),
      slideNumber: Math.max(0, idx) + (this.pres.firstSlideNumber ?? 1),
      slideCount: this.pres.slides.length,
      date: new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'numeric', day: 'numeric' }),
      ...extra,
    };
  }
  elementHtml(el: El, o: RenderOpts): string {
    return elementHtml(el, this.themeCtx(), o);
  }

  // -------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------
  setSel(ids: string[], keepCells = false) {
    const same = ids.length === this.sel.length && ids.every((i, k) => i === this.sel[k]);
    this.sel = ids;
    if (this.painter && ids.length && !same) {
      // Format Painter: the next object you pick receives the copied text formatting
      const look = this.painter.runs;
      this.painter = null;
      applyRun(this, look, 'Format painter');
    }
    if (!keepCells && !(ids.length === 1 && this.cellSel?.id === ids[0])) this.cellSel = null;
    if (!same || !keepCells) this.canvas?.renderOverlay();
    this.refreshUi();
  }
  selectedEls(): El[] {
    const set = new Set(this.sel);
    return this.container().elements.filter((e) => set.has(e.id));
  }
  singleSelected(): El | undefined {
    const s = this.selectedEls();
    return s.length === 1 ? s[0] : undefined;
  }

  // -------------------------------------------------------------------------
  // Editing: every change goes through commit() so undo/redo and dirty tracking just work.
  // -------------------------------------------------------------------------
  /** Run a change on the model, then record it. */
  mutate(label: string, fn: () => void, key?: string) {
    if (this.readOnly) return;
    fn();
    this.commit(label, key);
    this.canvas?.render();
  }

  commit(label: string, key?: string) {
    const json = JSON.stringify(this.deck.pres);
    if (json === this.snapJson) return;
    const now = Date.now();
    const last = this.undoStack[this.undoStack.length - 1];
    if (key && last && last.key === key && now - last.t < 1200) last.t = now;
    else {
      this.undoStack.push({ json: this.snapJson, label, cur: this.curIndex, sel: [...this.sel], key, t: now });
      if (this.undoStack.length > 200) this.undoStack.shift();
    }
    this.redoStack = [];
    this.snapJson = json;
    this.markDirty();
    this.scheduleThumbs();
    this.refreshUi();
  }

  /** a change that is still in progress (dragging): mark dirty and refresh thumbnails, no undo entry yet */
  touch() {
    this.markDirty();
    this.scheduleThumbs();
  }

  private thumbTimer: ReturnType<typeof setTimeout> | undefined;
  scheduleThumbs() {
    if (this.thumbTimer) clearTimeout(this.thumbTimer);
    this.thumbTimer = setTimeout(() => this.panel?.refresh(), 220);
  }

  /** The "command" modifier for a synthetic key event: Cmd on a Mac, Ctrl elsewhere (ProseMirror's "Mod"). */
  private modKey() {
    return document.documentElement.classList.contains('platform-darwin') ? { metaKey: true } : { ctrlKey: true };
  }

  undo() {
    if (this.canvas.textEditor) return void this.canvas.textEditor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ...this.modKey(), bubbles: true }));
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push({ json: this.snapJson, label: s.label, cur: this.curIndex, sel: [...this.sel], t: Date.now() });
    this.restore(s);
    toast(`Undo: ${s.label}`, 'info', 1200);
  }
  redo() {
    if (this.canvas.textEditor) return void this.canvas.textEditor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ...this.modKey(), bubbles: true }));
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push({ json: this.snapJson, label: s.label, cur: this.curIndex, sel: [...this.sel], t: Date.now() });
    this.restore(s);
  }
  canUndo() {
    return this.undoStack.length > 0;
  }
  canRedo() {
    return this.redoStack.length > 0;
  }

  private restore(s: Snap) {
    this.canvas.abandonTextEdit();
    this.deck.pres = JSON.parse(s.json) as Pres;
    this.snapJson = s.json;
    this.curIndex = Math.max(0, Math.min(s.cur, this.pres.slides.length - 1));
    const ids = new Set(this.container().elements.map((e) => e.id));
    this.sel = s.sel.filter((i) => ids.has(i));
    this.cellSel = null;
    this.slideSel = [];
    this.markDirty();
    this.fullRender();
  }

  fullRender() {
    this.canvas.render();
    this.panel.refresh(true);
    this.syncNotes();
    this.refreshUi();
  }

  // -------------------------------------------------------------------------
  // Slides
  // -------------------------------------------------------------------------
  goto(i: number, force = false) {
    const n = this.pres.slides.length;
    i = Math.max(0, Math.min(n - 1, i));
    if (i === this.curIndex && !force) return;
    this.canvas.endTextEdit();
    this.curIndex = i;
    this.sel = [];
    this.cellSel = null;
    this.slideSel = [this.pres.slides[i].id];
    this.canvas.render();
    this.panel.highlight();
    this.syncNotes();
    this.refreshUi();
  }

  newSlide(layoutId?: string, after = this.curIndex) {
    const cur = this.pres.slides[this.curIndex];
    const layout = this.pres.layouts.find((l) => l.id === layoutId) ?? this.defaultNextLayout(cur);
    this.mutate('New slide', () => {
      const s = this.makeSlide(layout);
      this.pres.slides.splice(after + 1, 0, s);
      this.curIndex = after + 1;
      this.sel = [];
      this.slideSel = [s.id];
    });
    this.fullRender();
  }

  private defaultNextLayout(cur?: Slide): Layout {
    const l = cur ? layoutOf(this.pres, cur) : this.pres.layouts[0];
    // after a title slide, PowerPoint offers "Title and Content"
    if (l.kind === 'title') return this.pres.layouts.find((x) => x.kind === 'obj' && x.masterId === l.masterId) ?? l;
    return l;
  }

  makeSlide(layout: Layout): Slide {
    const elements: El[] = [];
    for (const el of layout.elements) {
      if (el.type !== 'shape' || !el.ph || /^(dt|ftr|sldNum)$/.test(el.ph.type)) continue;
      const copy = clone(el);
      copy.id = uid();
      if (copy.text) copy.text = { ...copy.text, paras: [{ runs: [] }] };
      elements.push(copy);
    }
    return { id: uid('s'), layoutId: layout.id, elements };
  }

  deleteSlides(ids: string[] = this.slideSel.length ? this.slideSel : [this.curSlide().id]) {
    if (this.pres.slides.length <= ids.length) {
      // never leave a deck empty: replace by a blank slide
      this.mutate('Delete slide', () => {
        this.pres.slides = [this.makeSlide(this.pres.layouts[0])];
        this.curIndex = 0;
      });
      return this.fullRender();
    }
    const first = Math.min(...ids.map((id) => this.pres.slides.findIndex((s) => s.id === id)));
    this.mutate('Delete slide', () => {
      this.pres.slides = this.pres.slides.filter((s) => !ids.includes(s.id));
      this.curIndex = Math.max(0, Math.min(first, this.pres.slides.length - 1));
      this.sel = [];
    });
    this.slideSel = [this.curSlide().id];
    this.fullRender();
  }

  duplicateSlides(ids: string[] = this.slideSel.length ? this.slideSel : [this.curSlide().id]) {
    const idx = this.pres.slides.map((s, i) => (ids.includes(s.id) ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return;
    this.mutate('Duplicate slide', () => {
      const copies = idx.map((i) => this.cloneSlide(this.pres.slides[i]));
      this.pres.slides.splice(idx[idx.length - 1] + 1, 0, ...copies);
      this.curIndex = idx[idx.length - 1] + 1;
      this.slideSel = copies.map((c) => c.id);
    });
    this.fullRender();
  }

  cloneSlide(s: Slide): Slide {
    const c = clone(s);
    c.id = uid('s');
    const idMap = new Map<string, string>();
    const renew = (e: El) => {
      const nid = uid();
      idMap.set(e.id, nid);
      e.id = nid;
      if (e.type === 'group') e.children.forEach(renew);
    };
    c.elements.forEach(renew);
    c.anims = c.anims?.map((a) => ({ ...a, id: uid('a'), target: idMap.get(a.target) ?? a.target }));
    c.comments = undefined;
    return c;
  }

  moveSlides(ids: string[], toIndex: number) {
    const moving = this.pres.slides.filter((s) => ids.includes(s.id));
    if (!moving.length) return;
    this.mutate('Move slide', () => {
      const rest = this.pres.slides.filter((s) => !ids.includes(s.id));
      const before = this.pres.slides.slice(0, toIndex).filter((s) => !ids.includes(s.id)).length;
      rest.splice(before, 0, ...moving);
      this.pres.slides = rest;
      this.curIndex = this.pres.slides.indexOf(moving[0]);
    });
    this.fullRender();
  }

  // -------------------------------------------------------------------------
  // Inserting things
  // -------------------------------------------------------------------------
  private add(el: El): El {
    this.container().elements.push(el);
    this.sel = [el.id];
    this.cellSel = null;
    return el;
  }

  defaultShapeText(el: ShapeEl): TextBody {
    const lst = clone(this.pres.defaultText ?? []);
    const filled = el.fill && el.fill.t !== 'none';
    for (let i = 0; i < 9; i++) lst[i] = { ...(lst[i] ?? {}), algn: 'ctr', ...(filled ? { color: { theme: 'lt1' } as Color } : {}) };
    return { paras: [{ runs: [] }], lst, wrap: true, autofit: 'none', anchor: 'ctr', insets: [7.2, 3.6, 7.2, 3.6] };
  }

  insertShape(prst: string, r: { x: number; y: number; w: number; h: number }, extra: Partial<ShapeEl> = {}): ShapeEl {
    const isLine = LINE_PRESETS.has(prst);
    const el = newShape(prst, Math.round(r.x), Math.round(r.y), Math.max(isLine ? 0 : 4, Math.round(r.w)), Math.max(isLine ? 0 : 4, Math.round(r.h)), extra);
    if (!isLine) el.text = this.defaultShapeText(el);
    el.name = `${isLine ? 'Line' : prst === 'rect' ? 'Rectangle' : 'Shape'} ${this.container().elements.length + 1}`;
    this.add(el);
    this.commit('Insert shape');
    return el;
  }

  insertTextBox(r: { x: number; y: number; w: number; h: number }): ShapeEl {
    const el = newTextBox(Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h));
    el.text!.lst = clone(this.pres.defaultText ?? []);
    el.name = `TextBox ${this.container().elements.length + 1}`;
    this.add(el);
    return el;
  }

  insertInk(points: [number, number][], tool: { pen: 'pen' | 'pencil' | 'highlighter'; color: Color; w: number }) {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const pad = tool.w / 2;
    const x = Math.min(...xs) - pad;
    const y = Math.min(...ys) - pad;
    const w = Math.max(1, Math.max(...xs) - Math.min(...xs) + tool.w);
    const hh = Math.max(1, Math.max(...ys) - Math.min(...ys) + tool.w);
    const pts = points.map(([px, py]) => [px - x, py - y] as [number, number]);
    const f = (n: number) => Math.round(n * 100) / 100;
    let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
    if (pts.length > 2) {
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i - 1] ?? pts[i];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[i + 2] ?? p2;
        d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)},${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)},${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])},${f(p2[1])}`;
      }
    } else d += pts.slice(1).map((p) => `L${f(p[0])},${f(p[1])}`).join('');
    const color = tool.pen === 'highlighter' && typeof tool.color === 'string' ? tool.color.slice(0, 7) + '88' : tool.color;
    const el: ShapeEl = {
      id: uid(),
      type: 'shape',
      name: 'Ink',
      x: f(x),
      y: f(y),
      w: f(w),
      h: f(hh),
      geom: { cust: [{ w: f(w), h: f(hh), d, fill: false, stroke: true }] },
      line: { c: color, w: tool.pen === 'highlighter' ? tool.w * 3 : tool.w, cap: 'round', join: 'round' },
      ink: true,
    };
    this.add(el);
    this.commit('Draw');
  }

  async insertPictureFiles(files: { name: string; data: Uint8Array; mime?: string }[], at?: { x: number; y: number }) {
    if (!files.length) return;
    const added: El[] = [];
    const { w: sw, h: sh } = this.pres.size;
    let off = 0;
    for (const f of files) {
      const id = addMedia(this.deck.media, f.name, f.data, f.mime);
      const url = mediaUrl(this.deck.media, id)!;
      const dim = await imageSize(url);
      const scale = Math.min(1, (sw * 0.7) / dim.w, (sh * 0.7) / dim.h);
      const w = Math.round(dim.w * scale);
      const hh = Math.round(dim.h * scale);
      const x = at ? at.x - w / 2 : (sw - w) / 2 + off;
      const y = at ? at.y - hh / 2 : (sh - hh) / 2 + off;
      const pic = newPicture(id, Math.round(x), Math.round(y), w, hh, { name: f.name.replace(/\.[^.]+$/, ''), alt: f.name });
      added.push(pic);
      off += 18;
    }
    this.mutate('Insert picture', () => {
      for (const p of added) this.container().elements.push(p);
      this.sel = added.map((a) => a.id);
    });
  }

  async insertMediaFile(kind: 'video' | 'audio', f: { name: string; data: Uint8Array }) {
    const id = addMedia(this.deck.media, f.name, f.data);
    const url = mediaUrl(this.deck.media, id)!;
    const { w: sw, h: sh } = this.pres.size;
    let w = 80;
    let hh = 80;
    if (kind === 'video') {
      const dim = await mediaDuration(url, 'video');
      const s = Math.min(1, (sw * 0.6) / dim.w, (sh * 0.6) / dim.h);
      w = Math.round(dim.w * s);
      hh = Math.round(dim.h * s);
    }
    const el: MediaEl = { id: uid(), type: 'media', kind, media: id, name: f.name, x: Math.round((sw - w) / 2), y: Math.round((sh - hh) / 2), w, h: hh };
    this.mutate(kind === 'video' ? 'Insert video' : 'Insert audio', () => {
      this.add(el);
    });
  }

  deleteSelection() {
    if (this.readOnly) return;
    const ids = new Set(this.sel);
    if (!ids.size) return;
    const cs = this.cellSel;
    void cs;
    this.mutate('Delete', () => {
      const c = this.container();
      c.elements = c.elements.filter((e) => !ids.has(e.id));
      if ('anims' in c && c.anims) c.anims = c.anims.filter((a) => !ids.has(a.target));
      this.sel = [];
      this.cellSel = null;
    });
  }

  // -------------------------------------------------------------------------
  // Clipboard
  // -------------------------------------------------------------------------
  copySelection(cut = false) {
    const els = this.selectedEls();
    if (!els.length) return false;
    // the system clipboard carries the text (or an invisible marker) so we can tell later whether our own copy is still current
    const text = els.map((e) => (e.type === 'shape' ? plainText(e.text) : '')).filter(Boolean).join('\n') || '\u200b';
    this.clip = { kind: 'elements', els: els.map((e) => clone(e)), text };
    void navigator.clipboard?.writeText(text).catch(() => {});
    if (cut) this.deleteSelection();
    toast(cut ? 'Cut' : 'Copied', 'info', 900);
    return true;
  }

  pasteInternal(): boolean {
    const clip = this.clip;
    if (!clip) return false;
    if (clip.kind === 'slides') {
      this.mutate('Paste slides', () => {
        const copies = clip.slides.map((s) => this.cloneSlide(s));
        this.pres.slides.splice(this.curIndex + 1, 0, ...copies);
        this.curIndex += 1;
        this.slideSel = copies.map((c) => c.id);
      });
      this.fullRender();
      return true;
    }
    const pasted = clip.els.map((e) => {
      const c = cloneEl(e);
      c.x += 14;
      c.y += 14;
      return c;
    });
    // keep nudging so repeated pastes do not stack exactly
    clip.els = pasted.map((e) => clone(e));
    this.mutate('Paste', () => {
      for (const p of pasted) this.container().elements.push(p);
      this.sel = pasted.map((p) => p.id);
    });
    return true;
  }

  /** paste from the ribbon / context menu (reads the system clipboard through the main process) */
  async pasteNow() {
    const c = await window.bnc.readClipboard();
    if (this.canvas.textEditor) {
      if (c.text) this.canvas.textEditor.insertText(c.text.replace(/\u200b/g, ''));
      return;
    }
    if (this.clip && (c.text === this.clip.text || (!c.text && !c.png))) return void this.pasteInternal();
    if (c.png) return this.insertPictureFiles([{ name: 'Pasted picture.png', data: c.png, mime: 'image/png' }]);
    if (c.text.trim()) this.pasteText(c.text);
  }

  private pasteText(text: string) {
    const el = this.insertTextBox({ x: 80, y: 80, w: 600, h: 40 });
    el.text!.paras = text.replace(/\r\n?/g, '\n').split('\n').map((t) => ({ runs: t ? [{ t }] : [] }));
    this.commit('Paste text');
    this.canvas.render();
  }

  async pasteFromSystem(e?: ClipboardEvent) {
    const dt = e?.clipboardData;
    const files = Array.from(dt?.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      const out = [];
      for (const f of files) out.push({ name: f.name || 'Pasted picture.png', data: new Uint8Array(await f.arrayBuffer()), mime: f.type });
      return this.insertPictureFiles(out);
    }
    const text = dt?.getData('text/plain') ?? '';
    if (this.clip && (!text || text === this.clip.text)) return void this.pasteInternal();
    if (text.trim()) this.pasteText(text);
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------
  async run(id: string, arg?: any) {
    const c = this.cmds.get(id);
    if (!c) return console.warn('Unknown command', id);
    try {
      await c.run(arg);
    } catch (e) {
      toast(errMsg(e), 'error', 5000);
    }
  }

  setTool(t: Tool | null) {
    this.tool = t;
    this.root.classList.toggle('tool-active', !!t);
    if (t) this.canvas.endTextEdit();
    this.refreshUi();
  }

  async openLink(href: string) {
    if (!href) return;
    if (href.startsWith('slide:')) {
      const i = this.pres.slides.findIndex((s) => s.id === href.slice(6));
      if (i >= 0) this.goto(i);
      return;
    }
    await window.bnc.openExternal(href);
  }

  // -------------------------------------------------------------------------
  // Documents
  // -------------------------------------------------------------------------
  markDirty() {
    if (!this.doc.dirty) {
      this.doc.dirty = true;
      this.updateTitle();
    }
    this.scheduleAutosave();
  }

  private scheduleAutosave() {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    if (!this.autosave || !(this.doc.local || this.doc.cloud) || !FORMAT_INFO[this.doc.format].writable) return;
    this.autosaveTimer = setTimeout(() => {
      if (this.doc.dirty && !this.canvas.editing) void this.save(true);
    }, 3000);
  }

  updateTitle() {
    const d = this.doc;
    this.titleName.textContent = d.name;
    this.saveState.className = `save-state ${d.dirty ? 'dirty' : 'saved'}`;
    this.saveState.replaceChildren(d.dirty ? iconEl('refresh', 12) : iconEl('check', 12), d.dirty ? 'Unsaved' : d.cloud ? 'Saved to Nextcloud' : d.local ? 'Saved' : 'New');
    window.bnc.setTitle(`${d.dirty ? '● ' : ''}${d.name} - BNC Presentation`);
    this.updateAutosaveBadge();
  }

  /** AutoSave needs somewhere to save to: a file on this device or on Nextcloud, in a writable format. */
  autosaveAvailable(): boolean {
    return !!(this.doc.local || this.doc.cloud) && FORMAT_INFO[this.doc.format].writable;
  }

  updateAutosaveBadge() {
    const b = this.autosaveBtn;
    if (!b) return;
    const available = this.autosaveAvailable();
    const state = !available ? 'unavailable' : this.autosave ? 'on' : 'off';
    b.className = `autosave ${state}`;
    b.replaceChildren(iconEl(state === 'on' ? 'refresh' : 'save', 13), h('span', { text: state === 'on' ? 'AutoSave On' : 'AutoSave Off' }));
    b.title =
      state === 'unavailable'
        ? 'AutoSave is unavailable: this presentation has no save location yet. Save it to this device or Nextcloud first.'
        : state === 'on'
          ? 'AutoSave is on: changes are saved automatically a few seconds after you stop editing. Click to turn off.'
          : 'AutoSave is off. Click to turn on.';
    b.setAttribute('aria-disabled', String(!available));
    b.setAttribute('aria-pressed', String(state === 'on'));
  }

  toggleAutosave() {
    if (!this.autosaveAvailable()) {
      toast('Save the presentation to this device or Nextcloud first (Ctrl+S), then AutoSave can be turned on.');
      return;
    }
    void this.setAutosave(!this.autosave);
  }

  async confirmDiscard(): Promise<boolean> {
    this.canvas?.endTextEdit();
    if (!this.doc.dirty) return true;
    const r = await window.bnc.confirmSave(this.doc.name);
    if (r === 'cancel') return false;
    if (r === 'save') {
      await this.save();
      return !this.doc.dirty;
    }
    return true;
  }

  private setDeck(deck: Deck) {
    const old = this.deck;
    this.canvas?.abandonTextEdit();
    this.deck = deck;
    releaseMedia(old.media);
    this.undoStack = [];
    this.redoStack = [];
    this.snapJson = JSON.stringify(deck.pres);
    this.curIndex = 0;
    this.sel = [];
    this.cellSel = null;
    this.slideSel = [deck.pres.slides[0]?.id].filter(Boolean) as string[];
    this.masterView = null;
    this.view = 'normal';
    this.showSorter(false);
  }

  newPresentation(force = false) {
    const go = () => {
      this.setDeck(blankDeck());
      this.doc = { name: 'Presentation', format: 'bncpres', dirty: false };
      this.updateTitle();
      this.fullRender();
      setTimeout(() => this.canvas.fit(), 20);
    };
    if (force) return go();
    void this.confirmDiscard().then((ok) => ok && go());
  }

  async openLocal() {
    if (!(await this.confirmDiscard())) return;
    const f = await window.bnc.openFile();
    if (f) await this.loadFile(f);
  }

  async openFileGuarded(f: DocFile) {
    if (await this.confirmDiscard()) await this.loadFile(f);
  }

  async loadFile(f: DocFile) {
    try {
      const r = await decodeFile(f.name, f.data);
      this.setDeck(r.deck);
      this.doc = { name: baseName(f.name), format: formatFromName(f.name) ?? 'bncpres', local: f.path || undefined, dirty: false };
      this.updateTitle();
      this.fullRender();
      setTimeout(() => this.canvas.fit(), 20);
      toast(`Opened ${f.name}`);
      if (r.warnings.length) void window.bnc.message({ type: 'warning', message: `${f.name} opened with some limitations`, detail: r.warnings.join('\n') });
    } catch (e) {
      void window.bnc.message({ type: 'error', message: `Couldn't open ${f.name}`, detail: errMsg(e) });
    }
  }

  async save(silent = false) {
    this.canvas.endTextEdit();
    if (this.doc.cloud) return this.saveCloud(silent);
    if (this.doc.local && FORMAT_INFO[this.doc.format].writable) {
      try {
        const bytes = await encodeFile(this.doc.format, this.deck);
        await window.bnc.saveFile(this.doc.local, bytes);
        this.doc.dirty = false;
        this.updateTitle();
        if (!silent) toast('Saved');
      } catch (e) {
        toast(`Couldn't save: ${errMsg(e)}`, 'error', 5000);
      }
      return;
    }
    return this.saveAs();
  }

  async saveAs() {
    this.canvas.endTextEdit();
    const order: Format[] = ['bncpres', 'pptx', 'ppsx', 'potx', 'md', 'txt'];
    const first: Format = FORMAT_INFO[this.doc.format].writable ? this.doc.format : 'bncpres';
    const fmts = [first, ...order.filter((f) => f !== first)];
    const filters = fmts.map((f) => ({ name: FORMAT_INFO[f].label, extensions: [FORMAT_INFO[f].ext] }));
    try {
      const bytes = await encodeFile(first, this.deck);
      const r = await window.bnc.saveFileAs({ defaultName: `${this.doc.name}.${FORMAT_INFO[first].ext}`, filters, data: bytes });
      if (!r) return;
      const fmt = formatFromName(r.name) ?? first;
      if (fmt !== first) await window.bnc.saveFile(r.path, await encodeFile(fmt, this.deck));
      this.doc = { name: baseName(r.name), format: fmt, local: r.path, dirty: false };
      this.updateTitle();
      toast(`Saved ${r.name}`);
    } catch (e) {
      toast(`Couldn't save: ${errMsg(e)}`, 'error', 5000);
    }
  }

  async exportAs(fmt: Format) {
    this.canvas.endTextEdit();
    try {
      if (fmt === 'pdf') return await this.exportPdf();
      if (fmt === 'png' || fmt === 'jpg') return await this.exportImages(fmt);
      const info = FORMAT_INFO[fmt];
      const bytes = fmt === 'html' ? new TextEncoder().encode(buildSlideshowHtml(this.deck, slideCss, this.doc.name)) : await encodeFile(fmt, this.deck);
      const r = await window.bnc.saveFileAs({ defaultName: `${this.doc.name}.${info.ext}`, filters: [{ name: info.label, extensions: [info.ext] }], data: bytes });
      if (r) toast(`Exported ${r.name}`);
    } catch (e) {
      toast(`Export failed: ${errMsg(e)}`, 'error', 5000);
    }
  }

  async exportPdf() {
    const html = buildPdfHtml(this.deck, slideCss);
    const r = await window.bnc.exportPdf({ html, defaultName: `${this.doc.name}.pdf` });
    if (r) toast('Exported PDF');
  }

  async exportImages(fmt: 'png' | 'jpg', current = false) {
    const px = 4 / 3; // 96 dpi: a 13.33in slide becomes 1280 pixels
    const { pages, width, height } = buildImagePages(this.deck, slideCss, px, current ? [this.curIndex] : undefined);
    const r = await window.bnc.exportImages({ pages, width, height, format: fmt, baseName: this.doc.name });
    if (r) toast(`Exported ${r.count} picture${r.count === 1 ? '' : 's'}`);
  }

  async print() {
    const html = buildPdfHtml(this.deck, slideCss);
    await window.bnc.print({ html });
  }

  async rename() {
    const n = await prompt('Rename', 'Presentation name', this.doc.name, 'Rename');
    if (!n) return;
    const clean = n.replace(/[\\/:*?"<>|]/g, '');
    if (!clean) return;
    this.doc.name = clean;
    this.updateTitle();
  }

  // ---- Nextcloud ----
  async refreshCloudState() {
    const st = await window.bnc.nc.status().catch(() => null);
    this.ncUser = st?.user ?? null;
    this.status.cloud.textContent = st ? `Nextcloud: ${st.user}` : '';
  }

  async ensureCloud(): Promise<boolean> {
    if (this.ncUser) return true;
    return nextcloudDialog(this);
  }

  async openCloud() {
    if (!(await this.ensureCloud())) return;
    if (!(await this.confirmDiscard())) return;
    const pick = await cloudPicker('open', undefined, this.doc.cloud ? this.doc.cloud.path.replace(/\/[^/]+$/, '') || '/' : '/');
    if (!pick) return;
    try {
      const { data, etag } = await window.bnc.nc.read(pick.path);
      const r = await decodeFile(pick.name, data);
      this.setDeck(r.deck);
      this.doc = { name: baseName(pick.name), format: formatFromName(pick.name) ?? 'bncpres', cloud: { path: pick.path, etag }, dirty: false };
      this.updateTitle();
      this.fullRender();
      setTimeout(() => this.canvas.fit(), 20);
      toast(`Opened ${pick.name} from Nextcloud`);
      if (r.warnings.length) void window.bnc.message({ type: 'warning', message: `${pick.name} opened with some limitations`, detail: r.warnings.join('\n') });
    } catch (e) {
      void window.bnc.message({ type: 'error', message: `Couldn't open ${pick.name}`, detail: errMsg(e) });
    }
  }

  async saveCloudAs() {
    this.canvas.endTextEdit();
    if (!(await this.ensureCloud())) return;
    const fmt: Format = FORMAT_INFO[this.doc.format].writable ? this.doc.format : 'bncpres';
    const start = this.doc.cloud ? this.doc.cloud.path.replace(/\/[^/]+$/, '') || '/' : '/';
    const pick = await cloudPicker('save', `${this.doc.name}.${FORMAT_INFO[fmt].ext}`, start);
    if (!pick) return;
    const f = formatFromName(pick.name) ?? fmt;
    try {
      const bytes = await encodeFile(f, this.deck);
      const { etag } = await window.bnc.nc.write(pick.path, bytes);
      this.doc = { name: baseName(pick.name), format: f, cloud: { path: pick.path, etag }, dirty: false };
      this.updateTitle();
      toast(`Saved to Nextcloud: ${pick.name}`);
    } catch (e) {
      toast(`Couldn't save to Nextcloud: ${errMsg(e)}`, 'error', 6000);
    }
  }

  async saveCloud(silent = false) {
    if (!this.doc.cloud) return this.saveCloudAs();
    const fmt = this.doc.format;
    try {
      const bytes = await encodeFile(fmt, this.deck);
      let res: { etag?: string };
      try {
        res = await window.bnc.nc.write(this.doc.cloud.path, bytes, this.doc.cloud.etag);
      } catch (e) {
        if (!/conflict/i.test(errMsg(e))) throw e;
        const choice = await window.bnc.confirmSave('the newer version on Nextcloud (it changed since you opened it) — overwrite it');
        if (choice !== 'save') return;
        res = await window.bnc.nc.write(this.doc.cloud.path, bytes);
      }
      this.doc.cloud.etag = res.etag;
      this.doc.dirty = false;
      this.updateTitle();
      if (!silent) toast('Saved to Nextcloud');
    } catch (e) {
      toast(`Couldn't save to Nextcloud: ${errMsg(e)}`, 'error', 6000);
    }
  }

  // -------------------------------------------------------------------------
  // View state
  // -------------------------------------------------------------------------
  applyTheme() {
    document.documentElement.dataset.theme = this.theme;
    const cs = getComputedStyle(document.documentElement);
    window.bnc.setOverlay({ color: cs.getPropertyValue('--bg').trim() || '#0e1214', symbolColor: this.theme === 'dark' ? '#e8f0f2' : '#172023' });
  }

  async setTheme(t: 'dark' | 'light') {
    this.theme = t;
    this.applyTheme();
    await window.bnc.setSettings({ theme: t });
    this.refreshUi();
  }

  async setAutosave(on: boolean) {
    this.autosave = on;
    await window.bnc.setSettings({ autosave: on });
    this.scheduleAutosave();
    this.updateAutosaveBadge();
    toast(on ? 'AutoSave is on' : 'AutoSave is off');
  }

  async setRibbonMode(mode: 'classic' | 'simplified') {
    this.ribbonMode = mode;
    await window.bnc.setSettings({ ribbon: mode });
    buildRibbon(this);
  }

  updateZoomUi() {
    if (!this.status) return;
    const z = this.canvas.zoom;
    this.status.zoomRange.value = String(Math.round(z * 100));
    this.status.zoomLabel.textContent = `${Math.round(z * 100)}%`;
  }

  setEditable(on: boolean) {
    this.readOnly = !on;
    this.root.classList.toggle('readonly', !on);
    if (!on) this.canvas.endTextEdit();
    this.refreshUi();
  }

  showSorter(on: boolean) {
    this.view = on ? 'sorter' : 'normal';
    this.desk.style.display = on ? 'none' : '';
    this.notesPane.style.display = on || !this.showNotes ? 'none' : '';
    this.sorter.style.display = on ? '' : 'none';
    this.panelHost.style.display = on ? 'none' : '';
    this.status?.views.forEach((v) => v.classList.toggle('on', v.dataset.view === this.view));
    if (on) {
      this.canvas?.endTextEdit();
      this.panel?.renderSorter(this.sorter);
    } else if (this.canvas) {
      this.canvas.render();
      setTimeout(() => this.canvas.fitMode && this.canvas.fit(), 10);
    }
  }

  setNotesVisible(on: boolean) {
    this.showNotes = on;
    this.notesPane.style.display = on && this.view === 'normal' ? '' : 'none';
    setTimeout(() => this.canvas.fitMode && this.canvas.fit(), 10);
  }

  /** open (or close) one of the side panes */
  showPane(kind: string | null) {
    this.dockKind = kind === this.dockKind ? null : kind;
    this.renderDock();
  }
  renderDock() {
    const kind = this.dockKind;
    this.dock.style.display = kind ? '' : 'none';
    this.dock.replaceChildren();
    if (kind) {
      const build = this.panes.get(kind);
      if (build) this.dock.append(build(this));
    }
    setTimeout(() => this.canvas.fitMode && this.canvas.fit(), 10);
  }
  refreshDock() {
    if (this.dockKind) this.renderDock();
  }

  // -------------------------------------------------------------------------
  // Notes
  // -------------------------------------------------------------------------
  syncNotes() {
    if (!this.notesInput) return;
    const s = this.pres.slides[this.curIndex];
    const text = s?.notes ? s.notes.map((p) => p.runs.map((r) => r.t).join('')).join('\n') : '';
    if (this.notesInput.value !== text) this.notesInput.value = text;
    this.notesInput.disabled = !!this.masterView;
  }
  private onNotesInput() {
    const s = this.curSlide();
    const text = this.notesInput.value;
    s.notes = text ? text.split('\n').map((t) => ({ runs: t ? [{ t }] : [] })) : undefined;
    this.commit('Edit notes', 'notes');
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------
  private updateStatus = () => {
    if (!this.status) return;
    if (this.masterView) this.status.slide.textContent = this.masterView.kind === 'master' ? 'Slide Master' : `Layout: ${(this.container() as Layout).name}`;
    else this.status.slide.textContent = `Slide ${this.curIndex + 1} of ${this.pres.slides.length}`;
    const n = this.curSlide()?.comments?.length ?? 0;
    this.status.comments.textContent = n ? `${n} comment${n === 1 ? '' : 's'}` : '';
    this.status.views.forEach((v) => v.classList.toggle('on', v.dataset.view === this.view));
  };

  updateStatusNow() {
    this.updateStatus();
  }

  // -------------------------------------------------------------------------
  // Menus & global events
  // -------------------------------------------------------------------------
  private editModeMenu(anchor: HTMLElement) {
    showMenu(anchor, [
      { label: 'Editing', icon: 'penLine', checked: !this.readOnly, run: () => this.setEditable(true) },
      { label: 'Viewing', icon: 'view', checked: this.readOnly, run: () => this.setEditable(false) },
    ], { align: 'right' });
  }

  private cloudMenu(anchor: HTMLElement) {
    showMenu(anchor, [
      { label: this.ncUser ? `Connected as ${this.ncUser}` : 'Not connected', header: true },
      { label: 'Open from Nextcloud…', icon: 'cloudDown', run: () => void this.openCloud() },
      { label: 'Save to Nextcloud…', icon: 'cloudUp', run: () => void this.saveCloudAs() },
      { separator: true },
      { label: this.ncUser ? 'Account…' : 'Connect to Nextcloud…', icon: 'settings', run: () => void nextcloudDialog(this) },
    ], { align: 'right' });
  }

  about() {
    aboutDialog(this.version);
  }

  showContextMenu(x: number, y: number, el: El | null, target: HTMLElement) {
    const items: MenuItem[] = [];
    const sel = this.selectedEls();
    const R = (id: string, arg?: any) => () => void this.run(id, arg);
    if (this.canvas.textEditor) {
      items.push({ label: 'Cut', icon: 'cut', shortcut: 'Ctrl+X', run: () => document.execCommand('cut') }, { label: 'Copy', icon: 'copy', shortcut: 'Ctrl+C', run: () => document.execCommand('copy') }, { label: 'Paste', icon: 'paste', shortcut: 'Ctrl+V', run: R('paste') });
      items.push({ separator: true }, { label: 'Hyperlink…', icon: 'link', run: R('insert-link') });
      return contextMenu(x, y, items);
    }
    if (el) {
      items.push({ label: 'Cut', icon: 'cut', shortcut: 'Ctrl+X', run: R('cut') }, { label: 'Copy', icon: 'copy', shortcut: 'Ctrl+C', run: R('copy') }, { label: 'Paste', icon: 'paste', shortcut: 'Ctrl+V', run: R('paste') }, { label: 'Duplicate', icon: 'files', shortcut: 'Ctrl+D', run: R('duplicate') }, { separator: true });
      if (el.type === 'shape') items.push({ label: 'Edit text', icon: 'type', run: () => this.canvas.startTextEdit(el.id, 'end') });
      if (el.type === 'table' && target.closest('td')) {
        items.push({ label: 'Insert row above', run: R('table-row-above') }, { label: 'Insert row below', run: R('table-row-below') }, { label: 'Insert column left', run: R('table-col-left') }, { label: 'Insert column right', run: R('table-col-right') }, { label: 'Delete row', run: R('table-delete-row') }, { label: 'Delete column', run: R('table-delete-col') }, { label: 'Merge cells', icon: 'mergeCells', run: R('table-merge') }, { label: 'Split cell', icon: 'splitCells', run: R('table-split') }, { separator: true });
      }
      items.push(
        { label: 'Bring to front', icon: 'bringFront', run: R('arrange', 'front') },
        { label: 'Send to back', icon: 'sendBack', run: R('arrange', 'back') },
        { label: 'Bring forward', run: R('arrange', 'forward') },
        { label: 'Send backward', run: R('arrange', 'backward') },
        { separator: true },
      );
      if (sel.length > 1) items.push({ label: 'Group', icon: 'group', shortcut: 'Ctrl+G', run: R('group') });
      if (el.type === 'group') items.push({ label: 'Ungroup', icon: 'ungroup', shortcut: 'Ctrl+Shift+G', run: R('ungroup') });
      items.push({ label: 'Link…', icon: 'link', shortcut: 'Ctrl+K', run: R('insert-link') });
      if (el.type === 'picture') items.push({ label: 'Crop…', icon: 'crop', run: R('picture-crop') }, { label: 'Replace picture…', icon: 'image', run: R('picture-replace') });
      if (el.type === 'chart') items.push({ label: 'Edit chart data…', icon: 'chart', run: R('chart-data') });
      items.push({ label: el.locked ? 'Unlock' : 'Lock', icon: el.locked ? 'unlock' : 'lock', run: R('toggle-lock') }, { label: 'Alt text…', run: R('alt-text') }, { separator: true }, { label: 'Format…', icon: 'sliders', run: R('format-pane') }, { label: 'Delete', icon: 'trash', shortcut: 'Del', run: R('delete') });
    } else {
      items.push(
        { label: 'Paste', icon: 'paste', shortcut: 'Ctrl+V', run: R('paste') },
        { label: 'New slide', icon: 'newSlide', run: R('new-slide') },
        { label: 'Layout', icon: 'layout', sub: this.pres.layouts.filter((l) => !this.masterView && l.masterId === masterOf(this.pres, layoutOf(this.pres, this.curSlide())).id).map<MenuItem>((l) => ({ label: l.name, checked: this.curSlide().layoutId === l.id, run: R('slide-layout', l.id) })) },
        { label: 'Reset slide', run: R('reset-slide') },
        { separator: true },
        { label: 'Format background…', icon: 'palette', run: R('format-background') },
        { label: 'Grid and guides', sub: [{ label: 'Gridlines', checked: this.showGridlines, run: R('toggle-gridlines') }, { label: 'Snap to objects', checked: this.snapOn, run: R('toggle-snap') }] },
        { label: 'Slide size…', run: R('slide-size') },
      );
    }
    contextMenu(x, y, items);
  }

  private bindGlobalEvents() {
    document.addEventListener('keydown', (e) => this.onKey(e), true);
    document.addEventListener('paste', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, .ProseMirror')) return;
      e.preventDefault();
      void this.pasteFromSystem(e);
    });

    // Drag & drop
    const hint = document.getElementById('drop-hint')!;
    let depth = 0;
    window.addEventListener('dragenter', (e) => {
      if (e.dataTransfer?.types.includes('Files')) {
        depth++;
        hint.classList.add('on');
      }
    });
    window.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) hint.classList.remove('on');
    });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      depth = 0;
      hint.classList.remove('on');
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (!files.length) return;
      const first = files[0];
      if (/\.(bnctheme|bncvis|bncplugin)$/i.test(first.name)) return void installStyleBytes(this, first.name, new Uint8Array(await first.arrayBuffer()));
      const imgs = files.filter((f) => f.type.startsWith('image/'));
      if (imgs.length) {
        const pos = this.view === 'normal' ? this.canvas.toSlide(e.clientX, e.clientY) : undefined;
        const inside = pos && pos.x >= 0 && pos.y >= 0 && pos.x <= this.pres.size.w && pos.y <= this.pres.size.h;
        const out = [];
        for (const f of imgs) out.push({ name: f.name, data: new Uint8Array(await f.arrayBuffer()), mime: f.type });
        return void this.insertPictureFiles(out, inside ? pos : undefined);
      }
      const vid = files.find((f) => f.type.startsWith('video/') || f.type.startsWith('audio/'));
      if (vid) return void this.insertMediaFile(vid.type.startsWith('video/') ? 'video' : 'audio', { name: vid.name, data: new Uint8Array(await vid.arrayBuffer()) });
      if (!formatFromName(first.name)) return toast(`Can't open ${first.name}`, 'error');
      if (!(await this.confirmDiscard())) return;
      await this.loadFile({ path: '', name: first.name, data: new Uint8Array(await first.arrayBuffer()) });
    });
  }

  private onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    const inField = !!t.closest('input, textarea, select');
    const inEditor = !!t.closest('.ProseMirror');
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();

    if (e.altKey && (k === 'q' || e.code === 'KeyQ')) { // on a Mac Option+Q types "œ", so match the physical key too
      e.preventDefault();
      document.getElementById('cmd-search')?.focus();
      return;
    }
    // application-wide shortcuts work everywhere
    if (mod && !e.altKey) {
      const map: Record<string, string> = { n: 'new', o: 'open', s: e.shiftKey ? 'save-as' : 'save', p: 'print' };
      if (map[k] && !(inField && k === 'o')) {
        e.preventDefault();
        void this.run(map[k]);
        return;
      }
    }
    if (e.key === 'F5') {
      e.preventDefault();
      void this.run(e.shiftKey ? 'show-current' : 'show-start');
      return;
    }
    if (inField) return;

    if (inEditor) {
      if (mod && !e.shiftKey && (k === 'k')) {
        e.preventDefault();
        void this.run('insert-link');
      }
      if (mod && k === 'f') {
        e.preventDefault();
        void this.run('find');
      }
      return;
    }

    // canvas / slide panel shortcuts
    const panelFocus = !!t.closest('.slidepanel');
    if (mod && k === 'z') {
      e.preventDefault();
      return e.shiftKey ? this.redo() : this.undo();
    }
    if (mod && k === 'y') {
      e.preventDefault();
      return this.redo();
    }
    if (mod && k === 'c') {
      e.preventDefault();
      return void this.run('copy');
    }
    if (mod && k === 'x') {
      e.preventDefault();
      return void this.run('cut');
    }
    if (mod && k === 'd') {
      e.preventDefault();
      return void this.run(panelFocus ? 'duplicate-slide' : 'duplicate');
    }
    if (mod && k === 'a') {
      e.preventDefault();
      return void this.run('select-all');
    }
    if (mod && k === 'g') {
      e.preventDefault();
      return void this.run(e.shiftKey ? 'ungroup' : 'group');
    }
    if (mod && k === 'k') {
      e.preventDefault();
      return void this.run('insert-link');
    }
    if (mod && k === 'f') {
      e.preventDefault();
      return void this.run('find');
    }
    if (mod && k === 'h') {
      e.preventDefault();
      return void this.run('replace');
    }
    if (mod && k === 'm') {
      e.preventDefault();
      return void this.run('new-slide');
    }
    if (mod && (k === 'b' || k === 'i' || k === 'u') && this.sel.length) {
      e.preventDefault();
      return void this.run(k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline');
    }
    if (e.key === 'Escape') {
      if (this.tool) return this.setTool(null);
      if (this.sel.length) return this.setSel([]);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (panelFocus && !this.sel.length) return this.deleteSlides();
      if (this.cellSel && this.singleSelected()?.type === 'table' && !e.shiftKey) {
        return void this.run('table-clear-cells');
      }
      return this.deleteSelection();
    }
    if (e.key === 'Enter' && this.sel.length === 1 && !panelFocus) {
      e.preventDefault();
      const el = this.singleSelected();
      if (el?.type === 'shape' || el?.type === 'table') this.canvas.startTextEdit(el.id, 'end');
      return;
    }
    if (e.key === 'Tab' && !panelFocus) {
      const els = this.container().elements;
      if (els.length) {
        e.preventDefault();
        const i = els.findIndex((x) => x.id === this.sel[0]);
        const n = e.shiftKey ? (i <= 0 ? els.length - 1 : i - 1) : (i + 1) % els.length;
        this.setSel([els[n].id]);
      }
      return;
    }
    if (e.key === 'PageDown' || (panelFocus && e.key === 'ArrowDown')) {
      e.preventDefault();
      return this.goto(this.curIndex + 1);
    }
    if (e.key === 'PageUp' || (panelFocus && e.key === 'ArrowUp')) {
      e.preventDefault();
      return this.goto(this.curIndex - 1);
    }
    if (e.key.startsWith('Arrow') && this.sel.length && !panelFocus && !this.readOnly) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : e.altKey ? 0.25 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      for (const el of this.selectedEls()) {
        if (el.locked) continue;
        el.x = Math.round((el.x + dx) * 100) / 100;
        el.y = Math.round((el.y + dy) * 100) / 100;
      }
      this.commit('Nudge', 'nudge');
      this.canvas.render();
      return;
    }
    // typing while a text shape is selected starts editing it
    if (!mod && !e.altKey && e.key.length === 1 && this.sel.length === 1 && !panelFocus && !this.readOnly) {
      const el = this.singleSelected();
      if (el?.type === 'shape' && !el.ink) {
        e.preventDefault();
        this.canvas.startTextEdit(el.id, 'end');
        this.canvas.textEditor?.insertText(e.key);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Misc helpers used by commands
  // -------------------------------------------------------------------------
  slideTitleOf(s: Slide) {
    return slideTitle(s);
  }
  async confirm(title: string, message: string, ok = 'OK', danger = false) {
    return confirmBox(title, message, ok, danger);
  }
}
