// The ribbon. Every tab is described once as groups of controls; two renderers turn that description into
// either the Classic ribbon (labelled groups, large buttons) or the Simplified one (a single compact row).
import type { App } from '../app';
import { css } from '../core/color';
import { FORMAT_INFO, type Format } from '../core/io';
import { SLIDE_SIZES, THEMES, type Color, type ShapeEl, type TableEl } from '../core/model';
import { currentBody, currentPara, currentRun, effectiveAlign, effectiveBullet } from '../editor/format';
import { NUMBER_SCHEMES, BULLET_CHARS } from '../core/text';
import { TABLE_STYLES } from '../core/tablestyles';
import { h, iconEl, macify, popover, showMenu, type MenuItem } from './dom';
import { ENTRANCE, EMPHASIS, EXITS, TRANSITIONS, fxGallery, fxIcon, layoutGallery, shapeGallery, themeGallery, themeTile, VARIANTS, variantTile } from './galleries';
import type { IconName } from './icons';
import { appColorItems } from './styles';
import { FONT_SIZES, charPicker, colorPicker, combo, loadFonts, tableGridPicker } from './pickers';

// ---------------------------------------------------------------------------
// Control descriptions
// ---------------------------------------------------------------------------
interface BtnItem {
  t: 'btn';
  icon: IconName;
  label?: string;
  title: string;
  cmd?: string;
  arg?: any;
  run?: (app: App, el: HTMLElement) => void;
  size?: 'lg' | 'sm';
  menu?: (app: App) => MenuItem[];
  pop?: (app: App, anchor: HTMLElement) => void;
  split?: boolean;
  active?: (app: App) => boolean;
  off?: (app: App) => boolean;
}
interface ColorItem {
  t: 'color';
  icon: IconName;
  title: string;
  label?: string;
  cmd: string;
  none?: string;
  initial: Color;
  size?: 'lg' | 'sm';
}
interface CustomItem {
  t: 'custom';
  build: (app: App) => HTMLElement;
  size?: 'lg' | 'sm';
}
interface StackItem {
  t: 'stack';
  items: Item[];
}
interface RowsItem {
  t: 'rows';
  rows: Item[][];
}
type Item = BtnItem | ColorItem | CustomItem | StackItem | RowsItem;
interface Group {
  name: string;
  items: Item[];
}

type TabId = 'home' | 'insert' | 'draw' | 'design' | 'transitions' | 'animations' | 'slideshow' | 'review' | 'view' | 'help' | 'shape' | 'picture' | 'tabledesign' | 'tablelayout' | 'chart' | 'media' | 'master';
interface TabDef {
  id: TabId;
  label: string;
  contextual?: boolean;
  groups: (app: App) => Group[];
}

let active: TabId = 'home';
const overflowData = new WeakMap<HTMLElement, Item>();

const lg = (icon: IconName, label: string, cmd: string | undefined, o: Partial<BtnItem> = {}): BtnItem => ({ t: 'btn', icon, label, title: o.title ?? label, cmd, size: 'lg', ...o });
const sm = (icon: IconName, title: string, cmd: string | undefined, o: Partial<BtnItem> = {}): BtnItem => ({ t: 'btn', icon, title, cmd, size: 'sm', ...o });
const smL = (icon: IconName, label: string, cmd: string | undefined, o: Partial<BtnItem> = {}): BtnItem => ({ t: 'btn', icon, label, title: o.title ?? label, cmd, size: 'sm', ...o });
const custom = (build: (app: App) => HTMLElement, size: 'lg' | 'sm' = 'sm'): CustomItem => ({ t: 'custom', build, size });

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------
function spin(app: App, o: { label: string; title: string; unit: string; step: number; min?: number; get: () => number | undefined; set: (v: number) => void }): HTMLElement {
  const input = h('input', { attrs: { type: 'number', step: String(o.step), min: String(o.min ?? 0), 'aria-label': o.title }, title: o.title });
  const upd = () => {
    if (document.activeElement === input) return;
    const v = o.get();
    input.value = v === undefined ? '' : String(Math.round(v * 100) / 100);
    input.disabled = v === undefined;
  };
  const commit = () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v) && v >= (o.min ?? 0)) o.set(v);
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      commit();
      input.blur();
    }
  });
  app.onRefresh(upd);
  upd();
  return h('span', { class: 'spin' }, h('label', null, o.label), input, h('span', { text: o.unit }));
}

const pxToIn = (v: number) => v / 72;

function sizeSpin(app: App, key: 'w' | 'h'): HTMLElement {
  return spin(app, {
    label: key === 'w' ? 'Width' : 'Height',
    title: key === 'w' ? 'Shape width' : 'Shape height',
    unit: '"',
    step: 0.1,
    min: 0.01,
    get: () => {
      const e = app.selectedEls();
      return e.length === 1 ? pxToIn(e[0][key]) : undefined;
    },
    set: (v) => app.run('object-size', { [key]: v * 72 }),
  });
}

function sel(app: App, title: string, options: [string, string][], get: () => string, set: (v: string) => void): HTMLElement {
  const s = h('select', { class: 'select', title, attrs: { 'aria-label': title }, style: { height: '28px', width: 'auto', minWidth: '96px' } }, ...options.map(([v, l]) => h('option', { text: l, attrs: { value: v } })));
  const upd = () => {
    if (document.activeElement !== s) s.value = get();
  };
  s.addEventListener('change', () => set(s.value));
  app.onRefresh(upd);
  upd();
  return h('span', { class: 'spin' }, s);
}

function check(app: App, label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
  const input = h('input', { attrs: { type: 'checkbox' } });
  input.addEventListener('change', () => set(input.checked));
  const upd = () => {
    input.checked = get();
  };
  app.onRefresh(upd);
  upd();
  return h('label', { class: 'rcheck' }, input, label);
}

function themeCtxColors(app: App) {
  return app.themeCtx();
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
const pasteMenu = (): MenuItem[] => [
  { label: 'Paste', icon: 'paste', run: () => void 0 },
];
void pasteMenu;

function fontRows(app: App): RowsItem {
  const fontCombo = custom((a) => {
    const c = combo({
      width: 112,
      title: 'Font',
      getValue: () => currentRun(a).font?.replace(/^\+mj$/, a.themeCtx().theme.fonts.major).replace(/^\+mn$/, a.themeCtx().theme.fonts.minor) ?? a.themeCtx().theme.fonts.minor,
      getItems: loadFonts,
      renderItem: (f) => h('span', { text: f, style: { fontFamily: `'${f}'` } }),
      onCommit: (f) => void a.run('font-family', f),
    });
    a.onRefresh(c.update);
    return c.el;
  });
  const sizeCombo = custom((a) => {
    const c = combo({
      width: 34,
      title: 'Font size',
      numeric: true,
      getValue: () => String(Math.round((currentRun(a).sz ?? 18) * 10) / 10),
      getItems: () => FONT_SIZES.map(String),
      onCommit: (s) => void a.run('font-size', s),
    });
    a.onRefresh(c.update);
    return c.el;
  });
  const row1: Item[] = [
    fontCombo,
    sizeCombo,
    sm('grow', 'Increase font size (Ctrl+Shift+>)', 'font-grow'),
    sm('shrink', 'Decrease font size (Ctrl+Shift+<)', 'font-shrink'),
    sm('caseChange', 'Change case', undefined, {
      menu: () => [
        { label: 'Sentence case', run: () => void app.run('change-case', 'sentence') },
        { label: 'lowercase', run: () => void app.run('change-case', 'lower') },
        { label: 'UPPERCASE', run: () => void app.run('change-case', 'upper') },
        { label: 'Capitalize Each Word', run: () => void app.run('change-case', 'title') },
        { label: 'tOGGLE cASE', run: () => void app.run('change-case', 'toggle') },
      ],
    }),
    sm('clearFormat', 'Clear all formatting', 'clear-format'),
  ];
  const row2: Item[] = [
    sm('bold', 'Bold (Ctrl+B)', 'bold', { active: (a) => !!currentRun(a).b }),
    sm('italic', 'Italic (Ctrl+I)', 'italic', { active: (a) => !!currentRun(a).i }),
    sm('underline', 'Underline (Ctrl+U)', 'underline', { active: (a) => !!currentRun(a).u }),
    sm('strike', 'Strikethrough', 'strike', { active: (a) => !!currentRun(a).strike }),
    sm('subscript', 'Subscript', 'subscript', { active: (a) => (currentRun(a).base ?? 0) < 0 }),
    sm('superscript', 'Superscript', 'superscript', { active: (a) => (currentRun(a).base ?? 0) > 0 }),
    { t: 'color', icon: 'highlighter', title: 'Text highlight color', cmd: 'highlight', none: 'No Color', initial: '#ffff00' },
    { t: 'color', icon: 'fontColor', title: 'Font color', cmd: 'text-color', none: 'Automatic', initial: '#e11d48' },
  ];
  void app;
  return { t: 'rows', rows: [row1, row2] };
}

function paragraphRows(app: App): RowsItem {
  const al = (id: 'l' | 'ctr' | 'r' | 'just', icon: IconName, title: string) => sm(icon, title, 'align', { arg: id, active: (a) => effectiveAlign(a) === id });
  const row1: Item[] = [
    sm('bullets', 'Bullets', 'bullets', {
      split: true,
      active: (a) => effectiveBullet(a)?.t === 'char',
      menu: () => [
        { label: 'None', run: () => void app.run('bullet-char', null) },
        { separator: true },
        ...BULLET_CHARS.map<MenuItem>((c) => ({ label: `${c}   Bullet`, run: () => void app.run('bullet-char', c) })),
      ],
    }),
    sm('numbering', 'Numbering', 'numbering', {
      split: true,
      active: (a) => effectiveBullet(a)?.t === 'num',
      menu: () => [{ label: 'None', run: () => void app.run('numbering', null) }, { separator: true }, ...NUMBER_SCHEMES.map<MenuItem>((s) => ({ label: s.sample, run: () => void app.run('numbering', s.id) }))],
    }),
    sm('outdent', 'Decrease list level', 'outdent'),
    sm('indent', 'Increase list level', 'indent'),
    sm('lineSpacing', 'Line spacing', undefined, {
      menu: () => [0.9, 1, 1.15, 1.5, 2, 2.5, 3].map<MenuItem>((v) => ({ label: String(v), run: () => void app.run('line-spacing', v) })),
    }),
    sm('columns', 'Columns', undefined, {
      menu: () => [1, 2, 3].map<MenuItem>((n) => ({ label: n === 1 ? 'One Column' : `${n === 2 ? 'Two' : 'Three'} Columns`, run: () => void app.run('columns', n) })),
    }),
  ];
  const row2: Item[] = [
    al('l', 'alignLeft', 'Align left (Ctrl+L)'),
    al('ctr', 'alignCenter', 'Center (Ctrl+E)'),
    al('r', 'alignRight', 'Align right (Ctrl+R)'),
    al('just', 'alignJustify', 'Justify (Ctrl+J)'),
    sm('rotateRight', 'Text direction', undefined, {
      menu: () => [
        { label: 'Horizontal', run: () => void app.run('text-direction', 'horz') },
        { label: 'Rotate all text 90°', run: () => void app.run('text-direction', 'vert') },
        { label: 'Rotate all text 270°', run: () => void app.run('text-direction', 'vert270') },
      ],
    }),
    sm('alignMiddle', 'Align text vertically', undefined, {
      menu: () => [
        { label: 'Top', checked: currentBody(app)?.anchor === 't', run: () => void app.run('text-anchor', 't') },
        { label: 'Middle', checked: currentBody(app)?.anchor === 'ctr', run: () => void app.run('text-anchor', 'ctr') },
        { label: 'Bottom', checked: currentBody(app)?.anchor === 'b', run: () => void app.run('text-anchor', 'b') },
      ],
    }),
    sm('shrinkFit', 'Text fitting', undefined, {
      menu: () => [
        { label: 'Do not Autofit', checked: (currentBody(app)?.autofit ?? 'none') === 'none', run: () => void app.run('autofit', 'none') },
        { label: 'Shrink text on overflow', checked: currentBody(app)?.autofit === 'shrink', run: () => void app.run('autofit', 'shrink') },
        { label: 'Resize shape to fit text', checked: currentBody(app)?.autofit === 'shape', run: () => void app.run('autofit', 'shape') },
        { separator: true },
        { label: 'Wrap text in shape', checked: currentBody(app)?.wrap !== false, run: () => void app.run('text-wrap') },
      ],
    }),
  ];
  void currentPara;
  return { t: 'rows', rows: [row1, row2] };
}

const colorMenuItems = (cmd: string) => (app: App): MenuItem[] => [{ label: '', run: () => void app.run(cmd) }];
void colorMenuItems;

function shapeFillItems(): Item[] {
  return [
    { t: 'color', icon: 'fill', title: 'Shape fill', label: 'Shape Fill', cmd: 'shape-fill', none: 'No Fill', initial: { theme: 'accent1' } },
    { t: 'color', icon: 'outline', title: 'Shape outline', label: 'Shape Outline', cmd: 'shape-outline', none: 'No Outline', initial: { theme: 'accent1', lumMod: 0.75 } },
    smL('sparkle', 'Shape Effects', undefined, {
      menu: (app) => [
        { label: 'No Shadow', run: () => void app.run('shape-effect', 'none') },
        { label: 'Shadow: Outer', run: () => void app.run('shape-effect', 'shadow') },
        { label: 'Shadow: Soft', run: () => void app.run('shape-effect', 'shadow-soft') },
        { separator: true },
        { label: 'Glow', run: () => void app.run('shape-effect', 'glow') },
        { label: 'No Glow', run: () => void app.run('shape-effect', 'no-glow') },
      ],
    }),
    smL('alignMiddle', 'Line Weight', undefined, {
      menu: (app) => [0.25, 0.5, 0.75, 1, 1.5, 2.25, 3, 4.5, 6].map<MenuItem>((w) => ({ label: `${w} pt`, run: () => void app.run('outline-weight', w) })),
    }),
  ];
}

const arrangeMenu = (app: App): MenuItem[] => [
  { label: 'Bring to Front', icon: 'bringFront', run: () => void app.run('arrange', 'front') },
  { label: 'Send to Back', icon: 'sendBack', run: () => void app.run('arrange', 'back') },
  { label: 'Bring Forward', run: () => void app.run('arrange', 'forward') },
  { label: 'Send Backward', run: () => void app.run('arrange', 'backward') },
  { separator: true },
  { label: 'Align Left', icon: 'alignLeftEdge', run: () => void app.run('align-objects', 'left') },
  { label: 'Align Center', icon: 'alignCenterEdge', run: () => void app.run('align-objects', 'center') },
  { label: 'Align Right', icon: 'alignRightEdge', run: () => void app.run('align-objects', 'right') },
  { label: 'Align Top', icon: 'alignTop', run: () => void app.run('align-objects', 'top') },
  { label: 'Align Middle', icon: 'alignMiddle', run: () => void app.run('align-objects', 'middle') },
  { label: 'Align Bottom', icon: 'alignBottom', run: () => void app.run('align-objects', 'bottom') },
  { label: 'Distribute Horizontally', icon: 'distH', run: () => void app.run('distribute', 'h') },
  { label: 'Distribute Vertically', icon: 'distV', run: () => void app.run('distribute', 'v') },
  { separator: true },
  { label: 'Group', icon: 'group', shortcut: 'Ctrl+G', run: () => void app.run('group') },
  { label: 'Ungroup', icon: 'ungroup', shortcut: 'Ctrl+Shift+G', run: () => void app.run('ungroup') },
  { separator: true },
  { label: 'Rotate Right 90°', icon: 'rotateRight', run: () => void app.run('rotate', 90) },
  { label: 'Rotate Left 90°', icon: 'rotateLeft', run: () => void app.run('rotate', -90) },
  { label: 'Flip Vertical', icon: 'flipV', run: () => void app.run('flip', 'v') },
  { label: 'Flip Horizontal', icon: 'flipH', run: () => void app.run('flip', 'h') },
  { separator: true },
  { label: 'Selection Pane…', icon: 'layers', run: () => void app.run('selection-pane') },
];

const quickStyleMenu = (app: App): MenuItem[] => [
  ...(['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const).map<MenuItem>((a, i) => ({ label: `Intense — Accent ${i + 1}`, run: () => void app.run('quick-style', { accent: a, kind: 'intense' }) })),
  { separator: true },
  ...(['accent1', 'accent2', 'accent3'] as const).map<MenuItem>((a, i) => ({ label: `Subtle — Accent ${i + 1}`, run: () => void app.run('quick-style', { accent: a, kind: 'subtle' }) })),
  { separator: true },
  ...(['accent1', 'accent2', 'accent3'] as const).map<MenuItem>((a, i) => ({ label: `Colored Outline — Accent ${i + 1}`, run: () => void app.run('quick-style', { accent: a, kind: 'outline' }) })),
];

function homeGroups(app: App): Group[] {
  return [
    { name: 'Undo', items: [{ t: 'stack', items: [sm('undo', 'Undo (Ctrl+Z)', 'undo', { off: (a) => !a.canUndo() && !a.canvas.textEditor }), sm('redo', 'Redo (Ctrl+Y)', 'redo', { off: (a) => !a.canRedo() && !a.canvas.textEditor })] }] },
    {
      name: 'Clipboard',
      items: [
        lg('paste', 'Paste', 'paste', {
          split: true,
          menu: () => [
            { label: 'Paste', icon: 'paste', shortcut: 'Ctrl+V', run: () => void app.run('paste') },
            { label: 'Paste as Plain Text', run: () => void app.run('paste-plain') },
          ],
        }),
        { t: 'stack', items: [smL('cut', 'Cut', 'cut'), smL('copy', 'Copy', 'copy'), smL('roller', 'Format Painter', 'format-painter', { active: (a) => !!a.painter })] },
      ],
    },
    {
      name: 'Slides',
      items: [
        lg('newSlide', 'New Slide', 'new-slide', { split: true, pop: (a, el) => layoutGallery(a, el, (id) => void a.run('new-slide', id)) }),
        {
          t: 'stack',
          items: [
            smL('layout', 'Slide Layout', undefined, { pop: (a, el) => layoutGallery(a, el, (id) => void a.run('slide-layout', id), a.curSlide().layoutId) }),
            smL('files', 'Duplicate Slide', 'duplicate-slide'),
            smL('refresh', 'Reset', 'reset-slide'),
          ],
        },
      ],
    },
    { name: 'Font', items: [fontRows(app)] },
    { name: 'Paragraph', items: [paragraphRows(app)] },
    {
      name: 'Drawing',
      items: [
        lg('shapes', 'Shapes', undefined, { pop: (a, el) => shapeGallery(el, (p) => void a.run('insert-shape', p)) }),
        lg('layers', 'Arrange', undefined, { menu: arrangeMenu }),
        { t: 'stack', items: shapeFillItems().slice(0, 3) },
        lg('wand', 'Quick Styles', undefined, { menu: quickStyleMenu }),
      ],
    },
    { name: 'Editing', items: [{ t: 'stack', items: [smL('search', 'Find', 'find'), smL('replace', 'Replace', 'replace')] }] },
    { name: 'Add-ins', items: [lg('puzzle', 'Add-ins', 'plugins', { title: 'BNC plugins and app styles' })] },
  ];
}

function insertGroups(app: App): Group[] {
  return [
    { name: 'Slides', items: [lg('newSlide', 'New Slide', 'new-slide', { split: true, pop: (a, el) => layoutGallery(a, el, (id) => void a.run('new-slide', id)) })] },
    { name: 'Tables', items: [lg('table', 'Table', undefined, { pop: (a, el) => tableGridPicker(el, (rows, cols) => void a.run('insert-table', { rows, cols }), () => void a.run('insert-table-dialog')) })] },
    {
      name: 'Images',
      items: [
        lg('image', 'Pictures', 'insert-picture', {
          split: true,
          menu: () => [
            { label: 'This device…', icon: 'image', run: () => void app.run('insert-picture') },
            { label: 'From Nextcloud…', icon: 'cloudDown', run: () => void app.run('insert-picture-cloud') },
          ],
        }),
        lg('star', 'Icons', undefined, { pop: (a, el) => void a.run('icon-picker', el) }),
      ],
    },
    { name: 'Media', items: [lg('video', 'Video', 'insert-video'), lg('audio', 'Audio', 'insert-audio')] },
    {
      name: 'Illustrations',
      items: [
        lg('shapes', 'Shapes', undefined, { pop: (a, el) => shapeGallery(el, (p) => void a.run('insert-shape', p)) }),
        lg('chart', 'Chart', undefined, {
          menu: () => [
            { label: 'Column', icon: 'chart', run: () => void app.run('insert-chart', 'col') },
            { label: 'Stacked Column', icon: 'chart', run: () => void app.run('insert-chart', 'colStacked') },
            { label: 'Bar', icon: 'chartBar', run: () => void app.run('insert-chart', 'bar') },
            { label: 'Line', icon: 'chartLine', run: () => void app.run('insert-chart', 'line') },
            { label: 'Area', icon: 'chartLine', run: () => void app.run('insert-chart', 'area') },
            { label: 'Pie', icon: 'chartPie', run: () => void app.run('insert-chart', 'pie') },
            { label: 'Doughnut', icon: 'chartPie', run: () => void app.run('insert-chart', 'doughnut') },
            { label: 'Scatter', icon: 'chartLine', run: () => void app.run('insert-chart', 'scatter') },
            { label: 'Radar', icon: 'chartLine', run: () => void app.run('insert-chart', 'radar') },
          ],
        }),
      ],
    },
    { name: 'Links', items: [lg('link', 'Link', 'insert-link', { title: 'Link (Ctrl+K)' })] },
    {
      name: 'Text',
      items: [
        lg('textBox', 'Text Box', 'insert-textbox'),
        { t: 'stack', items: [smL('footer', 'Header & Footer', 'header-footer'), smL('hash', 'Slide Number', 'insert-slide-number'), smL('dateTime', 'Date & Time', 'insert-date')] },
        lg('type', 'WordArt', undefined, {
          menu: () => [
            { label: 'Big Accent Title', run: () => void app.run('insert-wordart', 'accent') },
            { label: 'Bold Outline', run: () => void app.run('insert-wordart', 'bold') },
            { label: 'Soft Shadow', run: () => void app.run('insert-wordart', 'soft') },
          ],
        }),
        lg('symbol', 'Symbol', undefined, { pop: (a, el) => charPicker(el, 'symbol', (c) => void a.run('insert-char', c)) }),
      ],
    },
    { name: 'Comments', items: [lg('newComment', 'New Comment', 'comment-new')] },
  ];
}

function drawGroups(app: App): Group[] {
  const toolActive = (kind: string, pen?: string) => (a: App) => a.tool?.kind === kind && (pen === undefined || (a.tool as any).pen === pen);
  return [
    { name: 'Tools', items: [lg('select', 'Select', 'tool-select', { active: (a) => !a.tool })] },
    {
      name: 'Pens',
      items: [
        lg('pen', 'Pen', 'tool-pen', { arg: 'pen', active: toolActive('ink', 'pen') }),
        lg('pencil', 'Pencil', 'tool-pen', { arg: 'pencil', active: toolActive('ink', 'pencil') }),
        lg('highlighter', 'Highlighter', 'tool-pen', { arg: 'highlighter', active: toolActive('ink', 'highlighter') }),
        lg('eraser', 'Eraser', 'tool-eraser', { active: toolActive('eraser') }),
        custom((a) => {
          const wrap = h('span', { class: 'rcol' });
          const col = h('button', { class: 'rb', title: 'Pen color' }, iconEl('palette', 16), h('span', { text: 'Color' }));
          col.addEventListener('mousedown', (e) => e.preventDefault());
          col.addEventListener('click', () => colorPicker(col, { title: 'Pen color', ctx: a.themeCtx(), onPick: (c) => void (c && a.run('pen-color', c)) }));
          const w = sel(a, 'Pen thickness', [['0.5', '0.5 pt'], ['1', '1 pt'], ['2.25', '2.25 pt'], ['4', '4 pt'], ['6', '6 pt'], ['10', '10 pt']], () => String(a.pen.w), (v) => void a.run('pen-width', Number(v)));
          wrap.append(col, w);
          return wrap;
        }),
      ],
    },
  ];
  void app;
}

function designGroups(app: App): Group[] {
  return [
    {
      name: 'Themes',
      items: [
        custom((a) => {
          const m = a.pres.masters[0];
          const strip = h('div', { class: 'gallery-strip' });
          THEMES.slice(0, 6).forEach((t, i) => {
            const b = h('button', { class: `gal-mini${m.theme.name === t.name ? ' on' : ''}`, title: t.name, on: { click: () => void a.run('apply-theme', i) } }, themeTile(t, true));
            b.addEventListener('mousedown', (e) => e.preventDefault());
            strip.append(b);
          });
          const more = h('button', { class: 'rb', title: 'More themes', on: { click: (e: Event) => themeGallery(e.currentTarget as HTMLElement, (i) => void a.run('apply-theme', i), m.theme.name) } }, iconEl('chevron', 14));
          return h('div', { class: 'gallery-wrap' }, strip, more);
        }, 'lg'),
      ],
    },
    {
      name: 'Variants',
      items: [
        custom((a) => {
          const m = a.pres.masters[0];
          const strip = h('div', { class: 'gallery-strip' });
          const cur = JSON.stringify(m.clrMap);
          VARIANTS.forEach((v) => {
            strip.append(h('button', { class: `gal-mini${JSON.stringify(v.map) === cur ? ' on' : ''}`, title: v.label, on: { click: () => void a.run('theme-variant', v.id) } }, variantTile(m.theme, v.map)));
          });
          return strip;
        }, 'lg'),
      ],
    },
    {
      name: 'Customize',
      items: [
        lg('scale', 'Slide Size', undefined, {
          menu: () => [
            ...Object.entries(SLIDE_SIZES).slice(0, 4).map<MenuItem>(([k, s]) => ({ label: s.label, checked: app.pres.size.preset === k, run: () => void app.run('slide-size', k) })),
            { separator: true },
            { label: 'Custom Slide Size…', run: () => void app.run('slide-size', 'custom') },
          ],
        }),
        lg('palette', 'Format Background', 'format-background'),
      ],
    },
  ];
}

function transitionGroups(app: App): Group[] {
  const cur = (a: App) => a.curSlide().transition;
  const fx = (a: App) => TRANSITIONS.find((t) => t.id === (cur(a)?.type ?? 'none')) ?? TRANSITIONS[0];
  return [
    { name: 'Preview', items: [lg('play', 'Preview', 'transition-preview')] },
    {
      name: 'Transition to This Slide',
      items: [
        custom((a) => {
          const strip = h('div', { class: 'gallery-strip' });
          const render = () => {
            strip.replaceChildren();
            for (const t of TRANSITIONS.slice(0, 6)) {
              const b = h('button', { class: `gal-mini fx${fx(a).id === t.id ? ' on' : ''}`, title: t.label, on: { click: () => void a.run('transition', t.id) } }, fxIcon(t.id), h('span', { text: t.label }));
              strip.append(b);
            }
          };
          render();
          a.onRefresh(render);
          const more = h('button', { class: 'rb', title: 'More transitions', on: { click: (e: Event) => fxGallery(e.currentTarget as HTMLElement, [{ head: 'Subtle', items: TRANSITIONS }], (f) => void a.run('transition', f.id), fx(a).id) } }, iconEl('chevron', 14));
          return h('div', { class: 'gallery-wrap' }, strip, more);
        }, 'lg'),
        lg('sliders', 'Effect Options', undefined, {
          menu: (a) => (fx(a).dirs ?? []).map<MenuItem>((d) => ({ label: d.label, checked: cur(a)?.dir === d.id, run: () => void a.run('transition-dir', d.id) })).concat((fx(a).dirs ?? []).length ? [] : [{ label: 'No options for this transition', disabled: true }]),
          off: (a) => !fx(a).dirs,
        }),
      ],
    },
    {
      name: 'Timing',
      items: [
        {
          t: 'stack',
          items: [
            custom((a) => spin(a, { label: 'Duration', title: 'Transition duration (seconds)', unit: 's', step: 0.25, get: () => (cur(a) && cur(a)!.type !== 'none' ? (cur(a)!.dur ?? 0.75) : undefined), set: (v) => void a.run('transition-duration', v) })),
            smL('files', 'Apply to All', 'transition-apply-all'),
          ],
        },
        {
          t: 'stack',
          items: [
            custom((a) => check(a, 'On Mouse Click', () => cur(a)?.advClick !== false, (v) => void a.run('transition-advance', { click: v }))),
            custom((a) => spin(a, { label: 'After', title: 'Advance automatically after (seconds)', unit: 's', step: 1, get: () => cur(a)?.advAfter ?? 0, set: (v) => void a.run('transition-advance', { after: v }) })),
          ],
        },
      ],
    },
  ];
  void app;
}

function animationGroups(app: App): Group[] {
  const target = (a: App) => a.curSlide().anims?.find((x) => a.sel.includes(x.target));
  const all = [{ head: 'Entrance', items: ENTRANCE }, { head: 'Emphasis', items: EMPHASIS }, { head: 'Exit', items: EXITS }];
  return [
    { name: 'Preview', items: [lg('play', 'Preview', 'anim-preview')] },
    {
      name: 'Animation',
      items: [
        custom((a) => {
          const strip = h('div', { class: 'gallery-strip' });
          const render = () => {
            strip.replaceChildren();
            const cur = target(a);
            for (const t of [{ id: 'none', label: 'None' }, ...ENTRANCE.slice(0, 5)]) {
              const on = t.id === 'none' ? !cur : cur?.effect === t.id && cur.cls === 'entr';
              strip.append(h('button', { class: `gal-mini fx${on ? ' on' : ''}`, title: t.label, on: { click: () => void a.run('anim-set', t.id === 'none' ? null : { effect: t.id, cls: 'entr' }) } }, fxIcon(t.id), h('span', { text: t.label })));
            }
          };
          render();
          a.onRefresh(render);
          const more = h('button', { class: 'rb', title: 'More animations', on: { click: (e: Event) => fxGallery(e.currentTarget as HTMLElement, all, (f) => void a.run('anim-set', { effect: f.id, cls: f.cls }), target(a)?.effect) } }, iconEl('chevron', 14));
          return h('div', { class: 'gallery-wrap' }, strip, more);
        }, 'lg'),
        lg('sliders', 'Effect Options', undefined, {
          menu: (a) => {
            const t = target(a);
            const info = [...ENTRANCE, ...EXITS].find((x) => x.id === t?.effect && x.cls === t?.cls);
            return (info?.dirs ?? []).length ? info!.dirs!.map<MenuItem>((d) => ({ label: d.label, checked: t?.dir === d.id, run: () => void a.run('anim-dir', d.id) })) : [{ label: 'No options for this animation', disabled: true }];
          },
        }),
      ],
    },
    {
      name: 'Advanced Animation',
      items: [
        lg('wand', 'Add Animation', undefined, { pop: (a, el) => fxGallery(el, all, (f) => void a.run('anim-add', { effect: f.id, cls: f.cls }), undefined) }),
        lg('layers', 'Animation Pane', 'anim-pane', { active: (a) => a.dockKind === 'animations' }),
      ],
    },
    {
      name: 'Timing',
      items: [
        {
          t: 'stack',
          items: [
            custom((a) => sel(a, 'Start', [['click', 'On Click'], ['with', 'With Previous'], ['after', 'After Previous']], () => target(a)?.trigger ?? 'click', (v) => void a.run('anim-start', v))),
            custom((a) => spin(a, { label: 'Duration', title: 'Duration (seconds)', unit: 's', step: 0.25, min: 0.01, get: () => target(a)?.dur, set: (v) => void a.run('anim-duration', v) })),
            custom((a) => spin(a, { label: 'Delay', title: 'Delay (seconds)', unit: 's', step: 0.25, get: () => target(a)?.delay, set: (v) => void a.run('anim-delay', v) })),
          ],
        },
      ],
    },
    { name: 'Reorder Animation', items: [{ t: 'stack', items: [smL('up', 'Move Earlier', 'anim-earlier'), smL('down', 'Move Later', 'anim-later'), smL('trash', 'Remove', 'anim-remove')] }] },
  ];
  void app;
}

function showGroups(app: App): Group[] {
  return [
    { name: 'Start Slide Show', items: [lg('monitorPlay', 'From Beginning', 'show-start'), lg('play', 'From Current Slide', 'show-current')] },
    { name: 'Set Up', items: [lg('settings', 'Set Up Slide Show', 'show-setup'), lg('hide', 'Hide Slide', 'hide-slide', { active: (a) => !!a.curSlide().hidden })] },
  ];
  void app;
}

function reviewGroups(app: App): Group[] {
  return [
    { name: 'Proofing', items: [lg('spelling', 'Spelling', 'spelling', { active: (a) => a.spellcheck, title: 'Check spelling as you type' }), lg('hash', 'Word Count', 'word-count')] },
    { name: 'Accessibility', items: [lg('accessibility', 'Check Accessibility', 'accessibility')] },
    {
      name: 'Comments',
      items: [lg('newComment', 'New Comment', 'comment-new'), { t: 'stack', items: [smL('trash', 'Delete', 'comment-delete'), smL('chevronLeft', 'Previous', 'comment-prev'), smL('chevronRight', 'Next', 'comment-next')] }, lg('comment', 'Show Comments', 'toggle-comments', { active: (a) => a.dockKind === 'comments' })],
    },
  ];
  void app;
}

function viewGroups(app: App): Group[] {
  return [
    {
      name: 'Presentation Views',
      items: [lg('presentation', 'Normal', 'view-normal', { active: (a) => a.view === 'normal' && !a.masterView }), lg('sorter', 'Slide Sorter', 'view-sorter', { active: (a) => a.view === 'sorter' }), lg('layout', 'Slide Master', 'master-open', { active: (a) => !!a.masterView })],
    },
    {
      name: 'Show',
      items: [{ t: 'stack', items: [smL('notes', 'Notes', 'toggle-notes', { active: (a) => a.showNotes }), smL('grid', 'Gridlines', 'toggle-gridlines', { active: (a) => a.showGridlines }), smL('component', 'Snap to Objects', 'toggle-snap', { active: (a) => a.snapOn })] }],
    },
    {
      name: 'Zoom',
      items: [
        lg('zoomIn', 'Zoom', undefined, { menu: () => [50, 75, 100, 150, 200].map<MenuItem>((z) => ({ label: `${z}%`, checked: Math.round(app.canvas.zoom * 100) === z, run: () => void app.run('zoom-set', z / 100) })) }),
        lg('fit', 'Fit to Window', 'zoom-fit'),
      ],
    },
    {
      name: 'Appearance',
      items: [
        lg(app.theme === 'dark' ? 'moon' : 'sun', 'Dark Mode', 'toggle-dark', { active: (a) => a.theme === 'dark' }),
        lg('palette', 'App Color', undefined, { menu: (a) => appColorItems(a) }),
        lg('panelLeft', 'Ribbon Style', undefined, {
          menu: (a) => [
            { label: 'Classic Ribbon', checked: a.ribbonMode === 'classic', run: () => void a.setRibbonMode('classic') },
            { label: 'Simplified Ribbon', checked: a.ribbonMode === 'simplified', run: () => void a.setRibbonMode('simplified') },
          ],
        }),
      ],
    },
  ];
}

function helpGroups(): Group[] {
  return [{ name: 'Help', items: [lg('keyboard', 'Keyboard Shortcuts', 'shortcuts'), lg('info', 'About', 'about'), lg('cloud', 'Nextcloud', 'cloud-settings'), lg('puzzle', 'Plugins', 'plugins')] }];
}

function shapeFormatGroups(app: App): Group[] {
  return [
    { name: 'Insert Shapes', items: [lg('shapes', 'Shapes', undefined, { pop: (a, el) => shapeGallery(el, (p) => void a.run('insert-shape', p)) }), lg('textBox', 'Text Box', 'insert-textbox'), lg('swap', 'Edit Shape', undefined, { pop: (a, el) => shapeGallery(el, (p) => void a.run('change-shape', p)) })] },
    { name: 'Shape Styles', items: [lg('wand', 'Quick Styles', undefined, { menu: quickStyleMenu }), { t: 'stack', items: shapeFillItems().slice(0, 3) }, { t: 'stack', items: [shapeFillItems()[3]] }] },
    { name: 'Arrange', items: [lg('bringFront', 'Bring Forward', 'arrange', { arg: 'forward' }), lg('sendBack', 'Send Backward', 'arrange', { arg: 'backward' }), lg('layers', 'Align & Group', undefined, { menu: arrangeMenu })] },
    { name: 'Size', items: [{ t: 'stack', items: [custom((a) => sizeSpin(a, 'h')), custom((a) => sizeSpin(a, 'w'))] }, custom((a) => spin(a, { label: 'Rotation', title: 'Rotation (degrees)', unit: '°', step: 5, get: () => { const e = a.selectedEls(); return e.length === 1 ? (e[0].rot ?? 0) : undefined; }, set: (v) => void a.run('object-size', { rot: v }) }))] },
  ];
  void app;
}

function pictureGroups(app: App): Group[] {
  return [
    {
      name: 'Adjust',
      items: [
        lg('contrast', 'Corrections', undefined, {
          menu: (a) => [
            { label: 'Brightness +20%', run: () => void a.run('picture-adjust', { brightness: 0.2 }) },
            { label: 'Brightness −20%', run: () => void a.run('picture-adjust', { brightness: -0.2 }) },
            { label: 'Contrast +20%', run: () => void a.run('picture-adjust', { contrast: 0.2 }) },
            { label: 'Contrast −20%', run: () => void a.run('picture-adjust', { contrast: -0.2 }) },
            { separator: true },
            { label: 'Black and White', run: () => void a.run('picture-adjust', { gray: true }) },
            { label: 'Reset picture', run: () => void a.run('picture-reset') },
          ],
        }),
        lg('image', 'Change Picture', 'picture-replace'),
      ],
    },
    {
      name: 'Picture Styles',
      items: [
        { t: 'color', icon: 'outline', title: 'Picture border', label: 'Picture Border', cmd: 'picture-border', none: 'No Outline', initial: { theme: 'accent1' }, size: 'sm' },
        lg('frame', 'Picture Shape', undefined, {
          menu: (a) => [
            { label: 'Rectangle', run: () => void a.run('picture-shape', 'rect') },
            { label: 'Rounded Rectangle', run: () => void a.run('picture-shape', 'roundRect') },
            { label: 'Oval', run: () => void a.run('picture-shape', 'ellipse') },
            { label: 'Diamond', run: () => void a.run('picture-shape', 'diamond') },
            { label: 'Hexagon', run: () => void a.run('picture-shape', 'hexagon') },
            { label: 'Star', run: () => void a.run('picture-shape', 'star5') },
            { label: 'Heart', run: () => void a.run('picture-shape', 'heart') },
          ],
        }),
        lg('sparkle', 'Picture Effects', undefined, { menu: (a) => [{ label: 'No Shadow', run: () => void a.run('shape-effect', 'none') }, { label: 'Shadow', run: () => void a.run('shape-effect', 'shadow') }, { label: 'Soft Shadow', run: () => void a.run('shape-effect', 'shadow-soft') }, { label: 'Glow', run: () => void a.run('shape-effect', 'glow') }] }),
      ],
    },
    { name: 'Arrange', items: [lg('bringFront', 'Bring Forward', 'arrange', { arg: 'forward' }), lg('sendBack', 'Send Backward', 'arrange', { arg: 'backward' }), lg('layers', 'Align & Group', undefined, { menu: arrangeMenu })] },
    { name: 'Size', items: [lg('crop', 'Crop', 'picture-crop'), { t: 'stack', items: [custom((a) => sizeSpin(a, 'h')), custom((a) => sizeSpin(a, 'w'))] }] },
  ];
  void app;
}

const selTable = (a: App): TableEl | undefined => {
  const e = a.singleSelected();
  return e?.type === 'table' ? e : undefined;
};

function tableDesignGroups(app: App): Group[] {
  const opt = (label: string, key: 'firstRow' | 'lastRow' | 'firstCol' | 'lastCol' | 'bandRow' | 'bandCol') => custom((a) => check(a, label, () => !!selTable(a)?.style[key], (v) => void a.run('table-option', { key, value: v })));
  return [
    { name: 'Table Style Options', items: [{ t: 'stack', items: [opt('Header Row', 'firstRow'), opt('Total Row', 'lastRow'), opt('Banded Rows', 'bandRow')] }, { t: 'stack', items: [opt('First Column', 'firstCol'), opt('Last Column', 'lastCol'), opt('Banded Columns', 'bandCol')] }] },
    {
      name: 'Table Styles',
      items: [
        lg('table', 'Table Styles', undefined, {
          pop: (a, anchor) => {
            const body = h('div', { class: 'gallery tablestyles' });
            for (const grp of ['Plain', 'Light', 'Medium', 'Dark']) {
              body.append(h('div', { class: 'gal-head', text: grp }));
              const grid = h('div', { class: 'gal-grid tsgrid' });
              for (const s of TABLE_STYLES.filter((x) => x.group === grp)) {
                const tile = h('button', { class: `gal-tile${selTable(a)?.style.id === s.id ? ' on' : ''}`, title: s.name }, tableStylePreview(a, s.id));
                tile.addEventListener('click', () => {
                  closeNow();
                  void a.run('table-style', s.id);
                });
                grid.append(tile);
              }
              body.append(grid);
            }
            let closeNow = () => {};
            closeNow = popover(anchor, body, { className: 'gallery-pop' });
          },
        }),
      ],
    },
    {
      name: 'Table Format',
      items: [{ t: 'color', icon: 'fill', title: 'Cell shading', label: 'Shading', cmd: 'cell-fill', none: 'No Fill', initial: { theme: 'accent1', lumMod: 0.4, lumOff: 0.6 }, size: 'lg' }, lg('square', 'Borders', undefined, { menu: (a) => [{ label: 'All Borders', run: () => void a.run('table-borders', 'all') }, { label: 'No Border', run: () => void a.run('table-borders', 'none') }, { label: 'Outside Borders', run: () => void a.run('table-borders', 'outside') }] })],
    },
  ];
  void app;
}

function tableStylePreview(app: App, id: string): HTMLElement {
  const ctx = app.themeCtx();
  const colors: Record<string, string> = {};
  void colors;
  const tile = h('div', { class: 'ts-prev' });
  const s = TABLE_STYLES.find((x) => x.id === id)!;
  const p = s.parts;
  const fill = (name: 'wholeTbl' | 'firstRow' | 'band1H') => {
    const f = p[name]?.fill ?? (name === 'band1H' ? p.wholeTbl?.fill : undefined);
    return f && f.t === 'solid' ? css(f.c, ctx) : 'transparent';
  };
  const bd = p.wholeTbl?.borders?.insideH?.c ?? p.wholeTbl?.borders?.t?.c ?? p.firstRow?.borders?.b?.c;
  for (let r = 0; r < 4; r++) {
    const row = h('i', { style: { background: r === 0 ? fill('firstRow') : r % 2 === 1 ? fill('band1H') : fill('wholeTbl'), borderBottom: bd ? `1px solid ${css(bd, ctx)}` : 'none' } });
    tile.append(row);
  }
  return tile;
}

function tableLayoutGroups(app: App): Group[] {
  return [
    {
      name: 'Rows & Columns',
      items: [
        { t: 'stack', items: [smL('up', 'Insert Above', 'table-row-above'), smL('down', 'Insert Below', 'table-row-below')] },
        { t: 'stack', items: [smL('left', 'Insert Left', 'table-col-left'), smL('right', 'Insert Right', 'table-col-right')] },
        { t: 'stack', items: [smL('trash', 'Delete Row', 'table-delete-row'), smL('trash', 'Delete Column', 'table-delete-col'), smL('trash', 'Delete Table', 'delete')] },
      ],
    },
    { name: 'Merge', items: [{ t: 'stack', items: [smL('mergeCells', 'Merge Cells', 'table-merge'), smL('splitCells', 'Split Cell', 'table-split')] }] },
    {
      name: 'Cell Size',
      items: [
        { t: 'stack', items: [smL('rows', 'Distribute Rows', 'table-equal-rows'), smL('columns', 'Distribute Columns', 'table-equal-cols')] },
        custom((a) => spin(a, { label: 'Row height', title: 'Row height (inches)', unit: '"', step: 0.1, min: 0.1, get: () => { const t = selTable(a); const c = a.cellSel; return t && c ? pxToIn(t.rows[Math.min(c.r0, c.r1)]?.h ?? 0) : undefined; }, set: (v) => void a.run('table-row-height', v * 72) })),
      ],
    },
    {
      name: 'Alignment',
      items: [
        { t: 'stack', items: [sm('alignLeft', 'Align left', 'align', { arg: 'l' }), sm('alignCenter', 'Center', 'align', { arg: 'ctr' }), sm('alignRight', 'Align right', 'align', { arg: 'r' })] },
        { t: 'stack', items: [sm('alignTop', 'Align top', 'cell-anchor', { arg: 't' }), sm('alignMiddle', 'Center vertically', 'cell-anchor', { arg: 'ctr' }), sm('alignBottom', 'Align bottom', 'cell-anchor', { arg: 'b' })] },
      ],
    },
  ];
  void app;
}

function chartGroups(app: App): Group[] {
  return [
    {
      name: 'Type',
      items: [
        lg('chart', 'Change Chart Type', undefined, {
          menu: (a) => (['col', 'colStacked', 'bar', 'barStacked', 'line', 'area', 'pie', 'doughnut', 'scatter', 'radar'] as const).map<MenuItem>((k) => ({ label: { col: 'Column', colStacked: 'Stacked Column', bar: 'Bar', barStacked: 'Stacked Bar', line: 'Line', area: 'Area', pie: 'Pie', doughnut: 'Doughnut', scatter: 'Scatter', radar: 'Radar' }[k], run: () => void a.run('chart-type', k) })),
        }),
        lg('table', 'Edit Data', 'chart-data'),
      ],
    },
    {
      name: 'Chart Layouts',
      items: [
        { t: 'stack', items: [smL('type', 'Chart Title', 'chart-toggle', { arg: 'title' }), smL('hash', 'Data Labels', 'chart-toggle', { arg: 'labels' }), smL('grid', 'Gridlines', 'chart-toggle', { arg: 'grid' })] },
        lg('bullets', 'Legend', undefined, {
          menu: (a) => [
            { label: 'None', run: () => void a.run('chart-legend', 'none') },
            { label: 'Right', run: () => void a.run('chart-legend', 'r') },
            { label: 'Bottom', run: () => void a.run('chart-legend', 'b') },
            { label: 'Top', run: () => void a.run('chart-legend', 't') },
            { label: 'Left', run: () => void a.run('chart-legend', 'l') },
          ],
        }),
      ],
    },
    { name: 'Arrange', items: [lg('layers', 'Align & Group', undefined, { menu: arrangeMenu })] },
    { name: 'Size', items: [{ t: 'stack', items: [custom((a) => sizeSpin(a, 'h')), custom((a) => sizeSpin(a, 'w'))] }] },
  ];
  void app;
}

function mediaGroups(app: App): Group[] {
  return [
    { name: 'Playback', items: [lg('play', 'Preview', 'media-preview')] },
    {
      name: 'Options',
      items: [
        {
          t: 'stack',
          items: [
            custom((a) => check(a, 'Start automatically', () => { const e = a.singleSelected(); return e?.type === 'media' ? !!e.autoplay : false; }, (v) => void a.run('media-option', { autoplay: v }))),
            custom((a) => check(a, 'Loop until stopped', () => { const e = a.singleSelected(); return e?.type === 'media' ? !!e.loop : false; }, (v) => void a.run('media-option', { loop: v }))),
          ],
        },
      ],
    },
    { name: 'Arrange', items: [lg('layers', 'Align & Group', undefined, { menu: arrangeMenu })] },
  ];
  void app;
}

function masterGroups(app: App): Group[] {
  return [
    { name: 'Close', items: [lg('close', 'Close Master View', 'master-close')] },
    {
      name: 'Edit Master',
      items: [
        lg('plus', 'Insert Layout', 'layout-insert'),
        { t: 'stack', items: [smL('penLine', 'Rename', 'layout-rename'), smL('files', 'Duplicate', 'layout-duplicate'), smL('trash', 'Delete', 'layout-delete')] },
        lg('type', 'Insert Placeholder', undefined, {
          menu: (a) => [
            { label: 'Title', run: () => void a.run('layout-placeholder', 'title') },
            { label: 'Text', run: () => void a.run('layout-placeholder', 'body') },
            { label: 'Content', run: () => void a.run('layout-placeholder', 'obj') },
            { label: 'Picture', run: () => void a.run('layout-placeholder', 'pic') },
          ],
        }),
      ],
    },
    { name: 'Edit Theme', items: [lg('palette', 'Themes', undefined, { pop: (a, el) => themeGallery(el, (i) => void a.run('apply-theme', i), a.pres.masters[0].theme.name) })] },
    { name: 'Background', items: [lg('fill', 'Background Styles', 'format-background')] },
    { name: 'Master Layout', items: [{ t: 'stack', items: [smL('footer', 'Footers', 'header-footer'), smL('shapes', 'Shapes', undefined, { pop: (a, el) => shapeGallery(el, (p) => void a.run('insert-shape', p)) }), smL('textBox', 'Text Box', 'insert-textbox')] }] },
  ];
  void app;
}

const TABS: TabDef[] = [
  { id: 'home', label: 'Home', groups: homeGroups },
  { id: 'insert', label: 'Insert', groups: insertGroups },
  { id: 'draw', label: 'Draw', groups: drawGroups },
  { id: 'design', label: 'Design', groups: designGroups },
  { id: 'transitions', label: 'Transitions', groups: transitionGroups },
  { id: 'animations', label: 'Animations', groups: animationGroups },
  { id: 'slideshow', label: 'Slide Show', groups: showGroups },
  { id: 'review', label: 'Review', groups: reviewGroups },
  { id: 'view', label: 'View', groups: viewGroups },
  { id: 'help', label: 'Help', groups: () => helpGroups() },
  { id: 'master', label: 'Slide Master', contextual: true, groups: masterGroups },
  { id: 'shape', label: 'Shape Format', contextual: true, groups: shapeFormatGroups },
  { id: 'picture', label: 'Picture Format', contextual: true, groups: pictureGroups },
  { id: 'tabledesign', label: 'Table Design', contextual: true, groups: tableDesignGroups },
  { id: 'tablelayout', label: 'Layout', contextual: true, groups: tableLayoutGroups },
  { id: 'chart', label: 'Chart Design', contextual: true, groups: chartGroups },
  { id: 'media', label: 'Media Format', contextual: true, groups: mediaGroups },
];

function contextTabs(app: App): TabId[] {
  const out: TabId[] = [];
  if (app.masterView) out.push('master');
  const els = app.selectedEls();
  if (els.length === 1) {
    const e = els[0];
    if (e.type === 'shape') out.push('shape');
    else if (e.type === 'picture') out.push('picture');
    else if (e.type === 'table') out.push('tabledesign', 'tablelayout');
    else if (e.type === 'chart') out.push('chart');
    else if (e.type === 'media') out.push('media');
    else out.push('shape');
  } else if (els.length > 1) out.push('shape');
  return out;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function keepFocus(el: HTMLElement) {
  el.addEventListener('mousedown', (e) => e.preventDefault());
}

function btnEl(app: App, it: BtnItem, simple: boolean): HTMLElement {
  const big = it.size === 'lg' && !simple;
  const showLabel = !!it.label && (simple ? it.size === 'lg' || !it.icon : true);
  const hasMenu = !!(it.menu || it.pop);
  const content = (): (Node | null)[] => [
    iconEl(it.icon, big ? 24 : simple ? 18 : 16),
    showLabel ? h('span', { class: 'lbl', text: it.label }) : null,
    hasMenu && !it.split ? h('span', { class: 'caret' }, iconEl('chevron', 12)) : null,
  ];
  const open = (el: HTMLElement) => (it.pop ? it.pop(app, el) : it.menu ? showMenu(el, () => it.menu!(app)) : undefined);
  const main = h('button', { class: `rb${big ? ' lg' : ' sm'}${it.split ? ' grp-l' : ''}`, title: macify(it.title), attrs: { 'aria-label': it.title } }, ...content());
  keepFocus(main);
  main.addEventListener('click', () => {
    if (it.run) it.run(app, main);
    else if (it.cmd) void app.run(it.cmd, it.arg);
    else open(main);
  });
  const sync = (el: HTMLElement) => {
    app.onRefresh(() => {
      if (it.active) el.classList.toggle('active', !!it.active(app));
      if (it.off) el.classList.toggle('disabled', !!it.off(app));
    });
  };
  sync(main);
  if (!it.split) return main;
  const caret = h('button', { class: `rb caret-btn${big ? ' lg-caret' : ''}`, title: `${it.title} options`, attrs: { 'aria-label': `${it.title} options` } }, iconEl('chevron', 12));
  keepFocus(caret);
  caret.addEventListener('click', () => open(caret));
  const box = h('span', { class: `split${big ? ' lgs' : ''}` }, main, caret);
  return box;
}

function colorEl(app: App, it: ColorItem, simple: boolean): HTMLElement {
  let last: Color = it.initial;
  const big = it.size === 'lg' && !simple;
  const swatch = h('span', { class: 'swatch', style: { background: css(last, app.themeCtx()) } });
  const showLabel = !!it.label && !simple;
  const main = h('button', { class: `rb ${big ? 'lg' : 'sm'} grp-l colorbtn`, title: it.title, attrs: { 'aria-label': it.title } }, iconEl(it.icon, big ? 24 : 16), swatch, showLabel ? h('span', { class: 'lbl', text: it.label }) : null);
  const caret = h('button', { class: 'rb caret-btn', title: `${it.title} options` }, iconEl('chevron', 12));
  keepFocus(main);
  keepFocus(caret);
  const apply = (c: Color | null) => {
    if (c) {
      last = c;
      swatch.style.background = css(c, app.themeCtx());
    }
    void app.run(it.cmd, c);
  };
  main.addEventListener('click', () => apply(last));
  caret.addEventListener('click', () => colorPicker(caret, { title: it.title, ctx: app.themeCtx(), noneLabel: it.none, onPick: apply }));
  return h('span', { class: `split${big ? ' lgs' : ''}` }, main, caret);
}

function itemEl(app: App, it: Item, simple: boolean): HTMLElement | null {
  switch (it.t) {
    case 'btn': {
      const el = btnEl(app, it, simple);
      overflowData.set(el, it);
      return el;
    }
    case 'color': {
      const el = colorEl(app, it, simple);
      overflowData.set(el, it);
      return el;
    }
    case 'custom':
      return it.build(app);
    case 'stack': {
      const els = it.items.map((i) => itemEl(app, i, simple)).filter(Boolean) as HTMLElement[];
      const box = h('div', { class: simple ? 'rinline' : 'rstack' }, ...els);
      overflowData.set(box, it);
      return box;
    }
    case 'rows': {
      const rows = it.rows.map((r) => h('div', { class: 'rrow' }, ...(r.map((i) => itemEl(app, i, simple)).filter(Boolean) as HTMLElement[])));
      const box = h('div', { class: simple ? 'rinline' : 'rrows' }, ...(simple ? rows.flatMap((r) => [...r.children] as HTMLElement[]) : rows));
      overflowData.set(box, it);
      return box;
    }
  }
}

function toMenu(app: App, it: Item): MenuItem[] {
  if (it.t === 'btn') {
    const label = it.label ?? it.title;
    if (it.menu) return [{ label, icon: it.icon, sub: it.menu(app) }];
    if (it.cmd) return [{ label, icon: it.icon, checked: it.active?.(app), run: () => void app.run(it.cmd!, it.arg) }];
    if (it.run) return [{ label, icon: it.icon, run: () => it.run!(app, document.body) }];
    return [];
  }
  if (it.t === 'color') return [{ label: it.label ?? it.title, icon: it.icon, run: () => void app.run(it.cmd, it.initial) }];
  if (it.t === 'stack') return it.items.flatMap((i) => toMenu(app, i));
  if (it.t === 'rows') return it.rows.flat().flatMap((i) => toMenu(app, i));
  return [];
}

function firstIcon(items: Item[]): IconName {
  for (const it of items) {
    if (it.t === 'btn' || it.t === 'color') return it.icon;
    if (it.t === 'stack') return firstIcon(it.items);
    if (it.t === 'rows') return firstIcon(it.rows.flat());
  }
  return 'more';
}

function renderClassic(app: App, groups: Group[]): HTMLElement {
  const bar = h('div', { class: 'ribbon classic', attrs: { role: 'toolbar', 'aria-label': 'Ribbon' } });
  const entries = groups.map((g) => {
    const items = g.items.map((it) => itemEl(app, it, false)).filter(Boolean) as HTMLElement[];
    const normal = h('div', { class: 'rgroup' }, h('div', { class: 'rgroup-items' }, ...items), h('div', { class: 'rgroup-name', text: g.name }));
    // when the window is too narrow a group folds into one dropdown button, like Office does
    const btn = h('button', { class: 'rb lg', title: g.name }, iconEl(firstIcon(g.items), 24), h('span', { class: 'lbl', text: g.name }), h('span', { class: 'caret' }, iconEl('chevron', 12)));
    keepFocus(btn);
    btn.addEventListener('click', () => {
      const body = h('div', { class: 'rgroup-pop' }, ...(g.items.map((it) => itemEl(app, it, false)).filter(Boolean) as HTMLElement[]));
      popover(btn, body);
      app.refreshUi();
    });
    const folded = h('div', { class: 'rgroup collapsed', style: { display: 'none' } }, h('div', { class: 'rgroup-items' }, btn), h('div', { class: 'rgroup-name', text: g.name }));
    bar.append(normal, folded);
    return { normal, folded };
  });
  const layout = () => {
    entries.forEach((e) => {
      e.normal.style.display = '';
      e.folded.style.display = 'none';
    });
    for (let i = entries.length - 1; i >= 0 && bar.scrollWidth > bar.clientWidth + 1; i--) {
      entries[i].normal.style.display = 'none';
      entries[i].folded.style.display = '';
    }
  };
  requestAnimationFrame(layout);
  new ResizeObserver(layout).observe(bar);
  return bar;
}

function renderSimple(app: App, groups: Group[]): HTMLElement {
  const bar = h('div', { class: 'ribbon simple', attrs: { role: 'toolbar', 'aria-label': 'Ribbon' } });
  const flow = h('div', { class: 'rflow' });
  const entries: { el: HTMLElement; it: Item }[] = [];
  groups.forEach((g, gi) => {
    if (gi > 0) flow.append(h('div', { class: 'rsep' }));
    for (const it of g.items) {
      const el = itemEl(app, it, true);
      if (!el) continue;
      flow.append(el);
      entries.push({ el, it });
    }
  });
  const more = h('button', { class: 'rb more-btn', title: 'More', style: { display: 'none' } }, iconEl('more', 18));
  keepFocus(more);
  bar.append(flow, more);
  const tidySeparators = () => {
    // a separator is only useful between two visible controls
    const kids = [...flow.children] as HTMLElement[];
    let prevIsSep = true;
    for (const k of kids) {
      if (k.classList.contains('rsep')) {
        k.style.display = prevIsSep ? 'none' : '';
        if (!prevIsSep) prevIsSep = true;
      } else if (k.style.display !== 'none') prevIsSep = false;
    }
    for (let i = kids.length - 1; i >= 0; i--) {
      const k = kids[i];
      if (k.classList.contains('rsep')) k.style.display = 'none';
      else if (k.style.display !== 'none') break;
    }
  };
  const layout = () => {
    entries.forEach((e) => (e.el.style.display = ''));
    flow.querySelectorAll<HTMLElement>('.rsep').forEach((s) => (s.style.display = ''));
    more.style.display = 'none';
    const limit = bar.clientWidth - 8;
    if (flow.scrollWidth <= limit) return;
    more.style.display = '';
    const budget = limit - 44;
    const hidden: Item[] = [];
    let used = 0;
    for (const e of entries) {
      const w = e.el.getBoundingClientRect().width + 2;
      used += w;
      if (used > budget) {
        e.el.style.display = 'none';
        hidden.push(e.it);
      }
    }
    tidySeparators();
    more.onclick = () => showMenu(more, () => hidden.flatMap((i) => toMenu(app, i)), { align: 'right' });
  };
  requestAnimationFrame(layout);
  new ResizeObserver(layout).observe(bar);
  return bar;
}

// ---------------------------------------------------------------------------
// File menu
// ---------------------------------------------------------------------------
async function fileMenu(app: App, anchor: HTMLElement) {
  const settings = await window.bnc.getSettings().catch(() => ({} as Record<string, any>));
  const recent: string[] = settings.recent ?? [];
  const fmtItems = (fmts: Format[]): MenuItem[] => fmts.map((f) => ({ label: FORMAT_INFO[f].label, run: () => void app.exportAs(f) }));
  const d = app.doc;
  const status = d.dirty ? 'Unsaved changes' : d.cloud ? 'Saved to Nextcloud' : d.local ? `Saved to ${d.local.split(/[\\/]/).slice(-2, -1)[0] ?? 'this device'}` : 'Not saved yet';
  showMenu(anchor, [
    { label: status, header: true },
    { label: 'New', icon: 'new', shortcut: 'Ctrl+N', run: () => void app.run('new') },
    {
      label: 'Open',
      icon: 'open',
      sub: [
        { label: 'This device…', icon: 'open', shortcut: 'Ctrl+O', run: () => void app.run('open') },
        { label: 'Nextcloud…', icon: 'cloudDown', run: () => void app.run('open-cloud') },
        ...(recent.length
          ? [{ separator: true } as MenuItem, { label: 'Recent', header: true } as MenuItem, ...recent.slice(0, 8).map<MenuItem>((p) => ({ label: p.split(/[\\/]/).pop(), run: () => void window.bnc.readFile(p).then((f) => app.openFileGuarded(f)).catch(() => void window.bnc.message({ type: 'error', message: 'That file could not be opened.', detail: p })) }))]
          : []),
      ],
    },
    { separator: true },
    { label: 'Save', icon: 'save', shortcut: 'Ctrl+S', run: () => void app.run('save') },
    {
      label: 'Save a Copy',
      icon: 'files',
      sub: [
        { label: 'This device…', shortcut: 'Ctrl+Shift+S', run: () => void app.run('save-as') },
        { label: 'Nextcloud…', icon: 'cloudUp', run: () => void app.run('save-cloud') },
      ],
    },
    { label: 'AutoSave', icon: 'refresh', checked: app.autosave && app.autosaveAvailable(), disabled: !app.autosaveAvailable(), run: () => app.toggleAutosave() },
    { separator: true },
    { label: 'Export', icon: 'export', sub: fmtItems(['pdf', 'pptx', 'ppsx', 'potx', 'bncpres', 'png', 'jpg', 'html', 'md', 'txt']) },
    { label: 'Print', icon: 'print', shortcut: 'Ctrl+P', run: () => void app.run('print') },
    { separator: true },
    { label: 'Rename', icon: 'penLine', run: () => void app.run('rename') },
    { label: 'Nextcloud account', icon: 'cloud', run: () => void app.run('cloud-settings') },
    { label: 'App color', icon: 'palette', sub: appColorItems(app) },
    {
      label: 'Ribbon style',
      icon: 'panelLeft',
      sub: [
        { label: 'Classic Ribbon', checked: app.ribbonMode === 'classic', run: () => void app.setRibbonMode('classic') },
        { label: 'Simplified Ribbon', checked: app.ribbonMode === 'simplified', run: () => void app.setRibbonMode('simplified') },
      ],
    },
    { label: 'Plugins…', icon: 'puzzle', run: () => void app.run('plugins') },
    {
      label: 'Info',
      icon: 'info',
      sub: [
        { label: 'Presentation info…', run: () => void app.run('doc-info') },
        ...(d.local ? [{ label: 'Show in folder', run: () => void window.bnc.reveal(d.local!) } as MenuItem] : []),
      ],
    },
  ]);
}

// ---------------------------------------------------------------------------
// Menubar + ribbon
// ---------------------------------------------------------------------------
export function buildRibbon(app: App) {
  let ctxKey = '';
  const renderBody = () => {
    app.clearRefreshers();
    const tab = TABS.find((t) => t.id === active) ?? TABS[0];
    const groups = tab.groups(app);
    const bar = app.ribbonMode === 'simplified' ? renderSimple(app, groups) : renderClassic(app, groups);
    app.ribbonHost.replaceChildren(bar);
    app.ribbonHost.classList.toggle('collapsed', app.ribbonCollapsed);
    app.refreshUi();
  };

  const renderTabs = () => {
    app.menubar.replaceChildren();
    const ctxTabs = contextTabs(app);
    const visible = TABS.filter((t) => !t.contextual || ctxTabs.includes(t.id));
    if (!visible.some((t) => t.id === active)) active = 'home';
    const mk = (id: string, label: string, ctxual: boolean) => {
      const b = h('button', { class: `tab${id === active ? ' active' : ''}${ctxual ? ' ctx' : ''}`, text: label, attrs: { 'data-tab': id } });
      keepFocus(b);
      b.addEventListener('click', () => {
        if (id === 'file') return void fileMenu(app, b);
        if (app.ribbonCollapsed && id === active) {
          app.ribbonCollapsed = false;
        } else if (app.ribbonCollapsed) app.ribbonCollapsed = false;
        active = id as TabId;
        renderTabs();
        renderBody();
      });
      app.menubar.append(b);
    };
    mk('file', 'File', false);
    visible.forEach((t) => mk(t.id, t.label, !!t.contextual));
    const toggle = h('button', { class: 'ribbon-toggle', title: 'Ribbon options' }, iconEl(app.ribbonCollapsed ? 'chevron' : 'chevronUp', 14));
    keepFocus(toggle);
    toggle.addEventListener('click', () => {
      showMenu(
        toggle,
        [
          { label: 'Classic Ribbon', checked: app.ribbonMode === 'classic', run: () => void app.setRibbonMode('classic') },
          { label: 'Simplified Ribbon', checked: app.ribbonMode === 'simplified', run: () => void app.setRibbonMode('simplified') },
          { separator: true },
          { label: app.ribbonCollapsed ? 'Always show ribbon' : 'Hide ribbon', run: () => {
            app.ribbonCollapsed = !app.ribbonCollapsed;
            renderTabs();
            renderBody();
            setTimeout(() => app.canvas.fitMode && app.canvas.fit(), 20);
          } },
        ],
        { align: 'right' },
      );
    });
    app.menubar.append(h('div', { class: 'grow' }), toggle);
    ctxKey = ctxTabs.join(',');
  };

  // contextual tabs follow the selection
  app.ctxWatcher = () => {
    const key = contextTabs(app).join(',');
    if (key !== ctxKey) {
      const newOnes = key.split(',').filter((k) => k && !ctxKey.split(',').includes(k));
      if (app.masterView && newOnes.includes('master')) active = 'master';
      else if (active === 'master' && !app.masterView) active = 'home';
      renderTabs();
      renderBody();
    }
  };
  renderTabs();
  renderBody();
}

void themeCtxColors;
void ENTRANCE;
void (null as unknown as ShapeEl);
