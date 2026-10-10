// The BNC Presentation data model. Everything here is plain JSON (so it can be cloned for undo and
// written to .bncpres). All lengths are in points: 1pt = 1/72 inch = 12700 EMU. A 16:9 slide is 960 x 540.
//
// Binary data (pictures, audio, video) lives in `Deck.media`, never inside the JSON model.

// ---------------------------------------------------------------------------
// Colour, fills, lines
// ---------------------------------------------------------------------------
export type ThemeSlot =
  | 'dk1' | 'lt1' | 'dk2' | 'lt2'
  | 'accent1' | 'accent2' | 'accent3' | 'accent4' | 'accent5' | 'accent6'
  | 'hlink' | 'folHlink'
  | 'tx1' | 'bg1' | 'tx2' | 'bg2';

/** A colour taken from the slide's theme, optionally lightened/darkened (all modifiers are fractions). */
export interface ThemeColor {
  theme: ThemeSlot;
  lumMod?: number;
  lumOff?: number;
  tint?: number;
  shade?: number;
  alpha?: number;
}
/** '#rrggbb', '#rrggbbaa', or a theme colour. */
export type Color = string | ThemeColor;

export interface GradStop {
  pos: number; // 0..1
  c: Color;
}
export type Fill =
  | { t: 'none' }
  | { t: 'solid'; c: Color }
  | { t: 'grad'; stops: GradStop[]; ang: number; kind?: 'linear' | 'radial' | 'rect' | 'path' }
  | { t: 'pic'; media: string; tile?: boolean; alpha?: number }
  | { t: 'pattern'; fg: Color; bg: Color; prst: string };

export type DashStyle = 'solid' | 'dot' | 'dash' | 'dashDot' | 'lgDash' | 'lgDashDot' | 'lgDashDotDot' | 'sysDash' | 'sysDot' | 'sysDashDot' | 'sysDashDotDot';
export interface ArrowEnd {
  type: 'triangle' | 'stealth' | 'diamond' | 'oval' | 'arrow';
  w?: 'sm' | 'med' | 'lg';
  len?: 'sm' | 'med' | 'lg';
}
export interface Line {
  /** null = no outline */
  c: Color | null;
  w: number;
  dash?: DashStyle;
  cap?: 'flat' | 'round' | 'square';
  join?: 'round' | 'bevel' | 'miter';
  head?: ArrowEnd;
  tail?: ArrowEnd;
  grad?: Fill;
}
export interface Shadow {
  c: Color;
  blur: number;
  dist: number;
  dir: number; // degrees, 0 = to the right, 90 = down
  alpha?: number; // 0..1
}
export interface Effects {
  shadow?: Shadow;
  glow?: { c: Color; r: number };
  softEdge?: number;
  reflection?: boolean;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------
export type Spacing = { pct: number } | { pts: number }; // pct: 1 = 100 %

export interface RunProps {
  b?: boolean;
  i?: boolean;
  u?: boolean | 'dbl' | 'dotted' | 'dash' | 'wavy';
  strike?: boolean;
  sz?: number;
  color?: Color;
  font?: string;
  hl?: Color;
  /** baseline shift in percent: 30 = superscript, -25 = subscript */
  base?: number;
  cap?: 'all' | 'small';
  spc?: number; // letter spacing, pt
  link?: string;
  lang?: string;
}
export interface Run extends RunProps {
  t: string;
  br?: boolean;
  field?: 'slidenum' | 'datetime' | 'slidecount';
}

export type Bullet =
  | { t: 'none' }
  | { t: 'char'; ch: string; font?: string; color?: Color; pct?: number }
  | { t: 'num'; scheme: string; start?: number; color?: Color; pct?: number };

export interface ParaProps {
  algn?: 'l' | 'ctr' | 'r' | 'just';
  marL?: number;
  indent?: number;
  lnSpc?: Spacing;
  spcBef?: Spacing;
  spcAft?: Spacing;
  bu?: Bullet;
  rtl?: boolean;
}
/** One level of a list style: paragraph settings plus the default run settings for that level. */
export interface LstLevel extends ParaProps, RunProps {}

export interface Para extends ParaProps {
  runs: Run[];
  level?: number;
  /** run properties of the (invisible) paragraph end: sizes empty lines */
  end?: RunProps;
}

export interface TextBody {
  paras: Para[];
  /** list style: index = outline level (0..8) */
  lst?: LstLevel[];
  anchor?: 't' | 'ctr' | 'b';
  anchorCtr?: boolean;
  insets?: [number, number, number, number]; // l, t, r, b
  wrap?: boolean; // default true
  autofit?: 'none' | 'shape' | 'shrink';
  fontScale?: number; // 0..1 (from "shrink text on overflow")
  lnSpcReduction?: number; // 0..1
  vert?: 'horz' | 'vert' | 'vert270' | 'eaVert';
  cols?: number;
  colGap?: number;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------
export interface CustPath {
  w: number;
  h: number;
  d: string; // SVG path data in the path's own (w x h) space
  fill?: boolean;
  stroke?: boolean;
}
export type Geom = { prst: string; adj?: Record<string, number> } | { cust: CustPath[] };

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------
export type PhType = 'title' | 'ctrTitle' | 'subTitle' | 'body' | 'obj' | 'dt' | 'ftr' | 'sldNum' | 'pic' | 'chart' | 'tbl' | 'media' | 'clipArt' | 'dgm';

export interface Placeholder {
  type: PhType;
  idx?: number;
}

export interface ElBase {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rot?: number; // degrees, clockwise
  flipH?: boolean;
  flipV?: boolean;
  ph?: Placeholder;
  hidden?: boolean;
  locked?: boolean;
  alt?: string;
  link?: string; // hyperlink on the whole object
}

export interface ShapeEl extends ElBase {
  type: 'shape';
  geom: Geom;
  fill?: Fill;
  line?: Line;
  fx?: Effects;
  text?: TextBody;
  /** true for text boxes (no fill/outline by default) */
  txBox?: boolean;
  /** freehand ink (pen / highlighter strokes) */
  ink?: boolean;
}

export interface Crop {
  l: number;
  t: number;
  r: number;
  b: number; // fractions 0..1 of the source image
}
export interface PictureEl extends ElBase {
  type: 'picture';
  media: string;
  crop?: Crop;
  geom?: Geom;
  line?: Line;
  fx?: Effects;
  alpha?: number;
  brightness?: number; // -1..1
  contrast?: number; // -1..1
  gray?: boolean;
}

export interface CellBorders {
  l?: Line;
  r?: Line;
  t?: Line;
  b?: Line;
}
export interface Cell {
  text: TextBody;
  fill?: Fill;
  borders?: CellBorders;
  gridSpan?: number;
  rowSpan?: number;
  hMerge?: boolean;
  vMerge?: boolean;
  anchor?: 't' | 'ctr' | 'b';
  margins?: [number, number, number, number];
}
export interface TableEl extends ElBase {
  type: 'table';
  cols: number[]; // widths
  rows: { h: number; cells: Cell[] }[];
  style: { id: string; firstRow?: boolean; lastRow?: boolean; firstCol?: boolean; lastCol?: boolean; bandRow?: boolean; bandCol?: boolean };
}

export interface ChartSeries {
  name: string;
  values: (number | null)[];
  color?: Color;
  /** scatter / bubble x values */
  x?: (number | null)[];
}
export type ChartKind = 'bar' | 'col' | 'line' | 'pie' | 'doughnut' | 'area' | 'scatter' | 'barStacked' | 'colStacked' | 'radar';
export interface ChartEl extends ElBase {
  type: 'chart';
  kind: ChartKind;
  title?: string;
  cats: string[];
  series: ChartSeries[];
  legend?: 'none' | 'r' | 'b' | 't' | 'l';
  labels?: boolean;
  grid?: boolean;
  smooth?: boolean;
}

export interface MediaEl extends ElBase {
  type: 'media';
  kind: 'video' | 'audio';
  media: string;
  poster?: string; // media id of an image
  autoplay?: boolean;
  loop?: boolean;
}

export interface GroupEl extends ElBase {
  type: 'group';
  /** the size of the children's own coordinate space; children are scaled by w/cw, h/ch */
  cw: number;
  ch: number;
  children: El[];
}

export type El = ShapeEl | PictureEl | TableEl | ChartEl | MediaEl | GroupEl;

// ---------------------------------------------------------------------------
// Slides, layouts, masters
// ---------------------------------------------------------------------------
export interface Transition {
  type: string; // none | fade | push | wipe | split | cover | uncover | zoom | dissolve | flip | cut | random ...
  dir?: string; // l r u d | in out | horz vert ...
  dur?: number; // seconds
  advClick?: boolean; // default true
  advAfter?: number; // seconds
}

export type AnimClass = 'entr' | 'exit' | 'emph';
export interface Anim {
  id: string;
  target: string; // element id
  cls: AnimClass;
  effect: string; // appear | fade | fly | wipe | zoom | float | split | wheel | bounce | spin | pulse | grow ...
  dir?: string; // fly/wipe direction: l r u d
  trigger: 'click' | 'with' | 'after';
  dur: number; // seconds
  delay: number;
}

export interface SlideComment {
  id: string;
  author: string;
  text: string;
  date: string;
  x?: number;
  y?: number;
  done?: boolean;
  replies?: { author: string; text: string; date: string }[];
}

export interface ThemeDef {
  name: string;
  colors: Record<'dk1' | 'lt1' | 'dk2' | 'lt2' | 'accent1' | 'accent2' | 'accent3' | 'accent4' | 'accent5' | 'accent6' | 'hlink' | 'folHlink', string>;
  fonts: { major: string; minor: string };
}

export interface Master {
  id: string;
  name: string;
  theme: ThemeDef;
  clrMap: { bg1: string; tx1: string; bg2: string; tx2: string };
  bg: Fill;
  elements: El[];
  txStyles: { title: LstLevel[]; body: LstLevel[]; other: LstLevel[] };
}

export interface Layout {
  id: string;
  masterId: string;
  name: string;
  kind?: string; // title | obj | secHead | twoObj | twoTxTwoObj | titleOnly | blank | objTx | picTx ...
  bg?: Fill; // undefined = inherit from master
  showMaster?: boolean; // default true
  elements: El[];
}

export interface Slide {
  id: string;
  layoutId: string;
  elements: El[];
  bg?: Fill; // undefined = inherit
  showMaster?: boolean; // show layout/master shapes, default true
  hidden?: boolean;
  notes?: Para[];
  transition?: Transition;
  anims?: Anim[];
  comments?: SlideComment[];
  /** section this slide starts, if any */
  section?: string;
}

export interface Pres {
  version: 1;
  title: string;
  author: string;
  created: string;
  modified: string;
  size: { w: number; h: number; preset?: string };
  masters: Master[];
  layouts: Layout[];
  slides: Slide[];
  /** Default text style for text boxes */
  defaultText?: LstLevel[];
  firstSlideNumber?: number;
  footer?: { slideNum: boolean; date: boolean; dateText?: string; dateFixed?: boolean; footer: boolean; footerText: string; skipTitle: boolean };
  show?: { loop?: boolean; useTimings?: boolean };
}

export interface MediaItem {
  mime: string;
  name: string;
  data: Uint8Array;
}
export type MediaStore = Map<string, MediaItem>;

/** A presentation plus its binary media. */
export interface Deck {
  pres: Pres;
  media: MediaStore;
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------
let counter = 0;
export function uid(prefix = 'e'): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

// ---------------------------------------------------------------------------
// Slide sizes
// ---------------------------------------------------------------------------
export const SLIDE_SIZES: Record<string, { label: string; w: number; h: number }> = {
  wide: { label: 'Widescreen (16:9)', w: 960, h: 540 },
  standard: { label: 'Standard (4:3)', w: 720, h: 540 },
  '16x10': { label: 'Widescreen (16:10)', w: 864, h: 540 },
  a4: { label: 'A4 Paper (210 x 297 mm)', w: 756, h: 540 },
  letter: { label: 'Letter Paper (8.5 x 11 in)', w: 792, h: 612 },
  banner: { label: 'Banner', w: 720, h: 90 },
  square: { label: 'Square (1:1)', w: 540, h: 540 },
};

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------
export const BASE_FONT_FALLBACK = "'Segoe UI', Calibri, Carlito, 'Helvetica Neue', Arial, sans-serif";

function themeOf(name: string, c: ThemeDef['colors'], major = 'Aptos Display', minor = 'Aptos'): ThemeDef {
  return { name, colors: c, fonts: { major, minor } };
}

export const THEMES: ThemeDef[] = [
  themeOf('BNC Teal', { dk1: '#10181c', lt1: '#ffffff', dk2: '#12343b', lt2: '#e6f4f2', accent1: '#14a39a', accent2: '#3b82f6', accent3: '#f59e0b', accent4: '#ec4899', accent5: '#8b5cf6', accent6: '#64748b', hlink: '#0e7490', folHlink: '#7c3aed' }),
  themeOf('Office', { dk1: '#000000', lt1: '#ffffff', dk2: '#44546a', lt2: '#e7e6e6', accent1: '#4472c4', accent2: '#ed7d31', accent3: '#a5a5a5', accent4: '#ffc000', accent5: '#5b9bd5', accent6: '#70ad47', hlink: '#0563c1', folHlink: '#954f72' }, 'Calibri Light', 'Calibri'),
  themeOf('Violet', { dk1: '#17142b', lt1: '#ffffff', dk2: '#2f2796', lt2: '#ecebfb', accent1: '#6f5ff0', accent2: '#ff7ab6', accent3: '#ffcf5c', accent4: '#34d3a5', accent5: '#4aa8ff', accent6: '#9a9ab0', hlink: '#5b4bdb', folHlink: '#a855f7' }),
  themeOf('Sunset', { dk1: '#2a1410', lt1: '#fffaf5', dk2: '#7a2e1d', lt2: '#fde8d8', accent1: '#e8572a', accent2: '#f4a300', accent3: '#c2185b', accent4: '#6d4c41', accent5: '#2e7d6b', accent6: '#8d6e63', hlink: '#c2410c', folHlink: '#9d174d' }),
  themeOf('Forest', { dk1: '#0f1f17', lt1: '#ffffff', dk2: '#1b4332', lt2: '#e9f3ec', accent1: '#2d9a5f', accent2: '#95c11f', accent3: '#d4a017', accent4: '#1f7a8c', accent5: '#8a5a44', accent6: '#6b7f73', hlink: '#15803d', folHlink: '#7c3aed' }),
  themeOf('Ocean', { dk1: '#0b1b2b', lt1: '#ffffff', dk2: '#0b3a5b', lt2: '#e4f1fa', accent1: '#1d7fd1', accent2: '#00b4d8', accent3: '#ff9f1c', accent4: '#2ec4b6', accent5: '#7b61ff', accent6: '#5f7d95', hlink: '#0369a1', folHlink: '#7e22ce' }),
  themeOf('Mono', { dk1: '#111111', lt1: '#ffffff', dk2: '#3a3a3a', lt2: '#eeeeee', accent1: '#222222', accent2: '#e63946', accent3: '#6b6b6b', accent4: '#a8a8a8', accent5: '#457b9d', accent6: '#1d3557', hlink: '#1d4ed8', folHlink: '#6b21a8' }, 'Georgia', 'Segoe UI'),
];

/** Dark variants: swap which of the theme's colours the master maps to background and text. */
export const LIGHT_MAP = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
export const DARK_MAP = { bg1: 'dk1', tx1: 'lt1', bg2: 'dk2', tx2: 'lt2' };

// ---------------------------------------------------------------------------
// Default text styles (what the master carries)
// ---------------------------------------------------------------------------
const tc = (theme: ThemeSlot): ThemeColor => ({ theme });

function titleStyle(): LstLevel[] {
  return [{ algn: 'l', lnSpc: { pct: 0.9 }, spcBef: { pct: 0 }, bu: { t: 'none' }, sz: 44, color: tc('tx1'), font: '+mj' }];
}

function bodyStyle(): LstLevel[] {
  const sizes = [28, 24, 20, 18, 18, 18, 18, 18, 18];
  return sizes.map((sz, i) => ({
    algn: 'l' as const,
    marL: 18 + i * 36,
    indent: -18,
    lnSpc: { pct: 0.9 },
    spcBef: { pts: i === 0 ? 10 : 5 },
    bu: { t: 'char' as const, ch: '•', font: 'Arial' },
    sz,
    color: tc('tx1'),
    font: '+mn',
  }));
}

function otherStyle(): LstLevel[] {
  return Array.from({ length: 9 }, (_, i) => ({ algn: 'l' as const, marL: i * 36, indent: 0, sz: 18, color: tc('tx1'), font: '+mn' }));
}

export function defaultTextLst(): LstLevel[] {
  return otherStyle();
}

// ---------------------------------------------------------------------------
// Element factories
// ---------------------------------------------------------------------------
export const DEFAULT_INSETS: [number, number, number, number] = [7.2, 3.6, 7.2, 3.6];

export function paraOf(text: string, extra: Partial<Para> = {}, rp: RunProps = {}): Para {
  return { runs: text ? [{ t: text, ...rp }] : [], ...extra };
}

export function textBodyOf(text: string | string[], opts: Partial<TextBody> = {}): TextBody {
  const lines = Array.isArray(text) ? text : text.split('\n');
  return { paras: lines.map((l) => paraOf(l)), ...opts };
}

export function newShape(prst: string, x: number, y: number, w: number, h: number, opts: Partial<ShapeEl> = {}): ShapeEl {
  const isLine = /^(line|straightConnector1|bentConnector\d|curvedConnector\d)$/.test(prst);
  return {
    id: uid(),
    type: 'shape',
    name: isLine ? 'Line' : prst === 'rect' ? 'Rectangle' : 'Shape',
    x,
    y,
    w,
    h,
    geom: { prst },
    fill: isLine ? undefined : { t: 'solid', c: tc('accent1') },
    line: isLine ? { c: tc('accent1'), w: 2.25 } : { c: { theme: 'accent1', lumMod: 0.75 }, w: 1 },
    ...opts,
  };
}

export function newTextBox(x: number, y: number, w: number, h: number, text = '', opts: Partial<ShapeEl> = {}): ShapeEl {
  return {
    id: uid(),
    type: 'shape',
    name: 'TextBox',
    x,
    y,
    w,
    h,
    geom: { prst: 'rect' },
    txBox: true,
    text: { paras: [paraOf(text)], lst: defaultTextLst(), wrap: true, autofit: 'shape', insets: [...DEFAULT_INSETS], anchor: 't' },
    ...opts,
  };
}

export function newPicture(media: string, x: number, y: number, w: number, h: number, opts: Partial<PictureEl> = {}): PictureEl {
  return { id: uid(), type: 'picture', name: 'Picture', x, y, w, h, media, ...opts };
}

export function emptyCell(): Cell {
  return { text: { paras: [{ runs: [] }], lst: defaultTextLst() } };
}

export function newTable(rows: number, cols: number, x: number, y: number, w: number, rowH = 36): TableEl {
  const cw = w / cols;
  return {
    id: uid(),
    type: 'table',
    name: 'Table',
    x,
    y,
    w,
    h: rows * rowH,
    cols: Array.from({ length: cols }, () => cw),
    rows: Array.from({ length: rows }, () => ({ h: rowH, cells: Array.from({ length: cols }, emptyCell) })),
    style: { id: 'medium2-accent1', firstRow: true, bandRow: true },
  };
}

export function newChart(kind: ChartKind, x: number, y: number, w: number, h: number): ChartEl {
  return {
    id: uid(),
    type: 'chart',
    name: 'Chart',
    x,
    y,
    w,
    h,
    kind,
    title: 'Chart Title',
    cats: ['Category 1', 'Category 2', 'Category 3', 'Category 4'],
    series: [
      { name: 'Series 1', values: [4.3, 2.5, 3.5, 4.5] },
      { name: 'Series 2', values: [2.4, 4.4, 1.8, 2.8] },
      { name: 'Series 3', values: [2, 2, 3, 5] },
    ],
    legend: 'b',
    grid: true,
    labels: false,
  };
}

// ---------------------------------------------------------------------------
// Default layouts and masters
// ---------------------------------------------------------------------------
function ph(type: PhType, name: string, x: number, y: number, w: number, h: number, opts: Partial<ShapeEl> & { idx?: number; prompt?: string } = {}): ShapeEl {
  const { idx, prompt: _p, ...rest } = opts;
  void _p;
  return {
    id: uid(),
    type: 'shape',
    name,
    x,
    y,
    w,
    h,
    ph: { type, idx },
    geom: { prst: 'rect' },
    text: { paras: [{ runs: [] }], lst: [], wrap: true, autofit: 'shrink', insets: [...DEFAULT_INSETS], anchor: type === 'title' || type === 'ctrTitle' ? 'ctr' : 't' },
    ...rest,
  };
}

function footerPhs(): ShapeEl[] {
  const small = (extra: Partial<LstLevel>): LstLevel[] => [{ sz: 12, color: { theme: 'tx1', lumMod: 0.6, lumOff: 0.4 }, ...extra }];
  const dt = ph('dt', 'Date Placeholder', 66, 500.5, 216, 28.75, { idx: 10 });
  dt.text!.lst = small({ algn: 'l' });
  dt.text!.anchor = 'ctr';
  dt.text!.paras = [{ runs: [{ t: '', field: 'datetime' }] }];
  const ftr = ph('ftr', 'Footer Placeholder', 318, 500.5, 324, 28.75, { idx: 11 });
  ftr.text!.lst = small({ algn: 'ctr' });
  ftr.text!.anchor = 'ctr';
  const num = ph('sldNum', 'Slide Number Placeholder', 678, 500.5, 216, 28.75, { idx: 12 });
  num.text!.lst = small({ algn: 'r' });
  num.text!.anchor = 'ctr';
  num.text!.paras = [{ runs: [{ t: '‹#›', field: 'slidenum' }] }];
  return [dt, ftr, num];
}

export function buildMaster(theme: ThemeDef, dark = false): Master {
  const title = ph('title', 'Title Placeholder', 66, 28.75, 828, 104.4);
  title.text!.lst = titleStyle();
  const body = ph('body', 'Text Placeholder', 66, 143.75, 828, 342.6, { idx: 1 });
  body.text!.lst = bodyStyle();
  return {
    id: uid('m'),
    name: 'Office Theme',
    theme,
    clrMap: dark ? { ...DARK_MAP } : { ...LIGHT_MAP },
    bg: { t: 'solid', c: tc('bg1') },
    elements: [title, body, ...footerPhs()],
    txStyles: { title: titleStyle(), body: bodyStyle(), other: otherStyle() },
  };
}

type LayoutSpec = (m: Master) => Layout;

function withLst(el: ShapeEl, lst: LstLevel[] | undefined, extra: Partial<TextBody> = {}): ShapeEl {
  el.text = { ...el.text!, lst: lst ?? [], ...extra };
  return el;
}

function inheritStyle(m: Master, kind: 'title' | 'body' | 'other'): LstLevel[] {
  return clone(m.txStyles[kind]);
}

export function buildLayouts(m: Master): Layout[] {
  const mk = (name: string, kind: string, elements: El[]): Layout => ({ id: uid('l'), masterId: m.id, name, kind, elements: [...elements, ...footerPhs()] });
  const titleEl = (x = 66, y = 28.75, w = 828, h = 104.4, extra: Partial<LstLevel> = {}) => withLst(ph('title', 'Title 1', x, y, w, h), inheritStyle(m, 'title').map((l, i) => (i === 0 ? { ...l, ...extra } : l)));
  const bodyEl = (name: string, idx: number, x: number, y: number, w: number, h: number, type: PhType = 'body') => withLst(ph(type, name, x, y, w, h, { idx }), inheritStyle(m, 'body'));

  const layouts: Layout[] = [];

  // Title Slide
  {
    const t = withLst(ph('ctrTitle', 'Title 1', 120, 88.4, 720, 188), inheritStyle(m, 'title').map((l, i) => (i === 0 ? { ...l, algn: 'ctr' as const, sz: 60 } : l)), { anchor: 'b' });
    const sub = withLst(ph('subTitle', 'Subtitle 2', 120, 283.6, 720, 130.4, { idx: 1 }), inheritStyle(m, 'body').map((l) => ({ ...l, algn: 'ctr' as const, bu: { t: 'none' as const }, marL: 0, indent: 0, sz: l.sz! + (l.sz === 28 ? 0 : 0) })));
    sub.text!.lst![0].sz = 24;
    layouts.push(mk('Title Slide', 'title', [t, sub]));
  }
  layouts.push(mk('Title and Content', 'obj', [titleEl(), bodyEl('Content Placeholder 2', 1, 66, 143.75, 828, 342.6, 'obj')]));
  {
    const t = withLst(ph('title', 'Title 1', 65.5, 134.6, 828, 224.6), inheritStyle(m, 'title').map((l, i) => (i === 0 ? { ...l, sz: 60 } : l)), { anchor: 'b' });
    const b = withLst(ph('body', 'Text Placeholder 2', 65.5, 361.4, 828, 118.1, { idx: 1 }), inheritStyle(m, 'body').map((l) => ({ ...l, bu: { t: 'none' as const }, marL: 0, indent: 0, sz: 24, color: { theme: 'tx1' as const, lumMod: 0.75, lumOff: 0.25 } })));
    layouts.push(mk('Section Header', 'secHead', [t, b]));
  }
  layouts.push(mk('Two Content', 'twoObj', [titleEl(), bodyEl('Content Placeholder 2', 1, 66, 143.75, 408, 342.6, 'obj'), bodyEl('Content Placeholder 3', 2, 486, 143.75, 408, 342.6, 'obj')]));
  {
    const hdr = (name: string, idx: number, x: number, w: number) =>
      withLst(ph('body', name, x, 132.4, w, 64.9, { idx }), inheritStyle(m, 'body').map((l, i) => (i === 0 ? { ...l, bu: { t: 'none' as const }, marL: 0, indent: 0, sz: 24, b: true } : l)), { anchor: 'b' });
    layouts.push(
      mk('Comparison', 'twoTxTwoObj', [
        titleEl(),
        hdr('Text Placeholder 2', 1, 66.1, 406.1),
        bodyEl('Content Placeholder 3', 2, 66.1, 197.25, 406.1, 290.1, 'obj'),
        hdr('Text Placeholder 4', 3, 486, 408.1),
        bodyEl('Content Placeholder 5', 4, 486, 197.25, 408.1, 290.1, 'obj'),
      ]),
    );
  }
  layouts.push(mk('Title Only', 'titleOnly', [titleEl()]));
  layouts.push(mk('Blank', 'blank', []));
  {
    const t = titleEl(66.1, 36, 309.6, 126, { sz: 32, b: true });
    t.text!.anchor = 'b';
    const content = bodyEl('Content Placeholder 2', 1, 408.1, 77.75, 486, 383.75, 'obj');
    const txt = withLst(ph('body', 'Text Placeholder 3', 66.1, 162, 309.6, 300.1, { idx: 2 }), inheritStyle(m, 'body').map((l, i) => (i === 0 ? { ...l, bu: { t: 'none' as const }, marL: 0, indent: 0, sz: 16 } : l)));
    layouts.push(mk('Content with Caption', 'objTx', [t, content, txt]));
  }
  {
    const t = titleEl(66.1, 36, 309.6, 126, { sz: 32, b: true });
    t.text!.anchor = 'b';
    const pic = ph('pic', 'Picture Placeholder 2', 408.1, 77.75, 486, 383.75, { idx: 1 });
    const txt = withLst(ph('body', 'Text Placeholder 3', 66.1, 162, 309.6, 300.1, { idx: 2 }), inheritStyle(m, 'body').map((l, i) => (i === 0 ? { ...l, bu: { t: 'none' as const }, marL: 0, indent: 0, sz: 16 } : l)));
    layouts.push(mk('Picture with Caption', 'picTx', [t, pic, txt]));
  }
  void (null as unknown as LayoutSpec);
  return layouts;
}

export function blankPres(themeIndex = 0, dark = false): Pres {
  const master = buildMaster(THEMES[themeIndex] ?? THEMES[0], dark);
  const layouts = buildLayouts(master);
  const now = new Date().toISOString();
  const pres: Pres = {
    version: 1,
    title: '',
    author: '',
    created: now,
    modified: now,
    size: { w: 960, h: 540, preset: 'wide' },
    masters: [master],
    layouts,
    slides: [],
    defaultText: defaultTextLst(),
  };
  pres.slides.push(slideFromLayout(pres, layouts[0].id));
  return pres;
}

export function blankDeck(themeIndex = 0): Deck {
  return { pres: blankPres(themeIndex), media: new Map() };
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------
export function layoutOf(p: Pres, slide: Slide): Layout {
  return p.layouts.find((l) => l.id === slide.layoutId) ?? p.layouts[0];
}
export function masterOf(p: Pres, layout: Layout): Master {
  return p.masters.find((m) => m.id === layout.masterId) ?? p.masters[0];
}
export function masterForSlide(p: Pres, slide: Slide): Master {
  return masterOf(p, layoutOf(p, slide));
}

/** Create a slide's placeholders from a layout (footer-type placeholders are left out, like PowerPoint). */
export function slideFromLayout(p: Pres, layoutId: string): Slide {
  const layout = p.layouts.find((l) => l.id === layoutId) ?? p.layouts[0];
  const elements: El[] = [];
  for (const el of layout.elements) {
    if (el.type !== 'shape' || !el.ph) continue;
    if (el.ph.type === 'dt' || el.ph.type === 'ftr' || el.ph.type === 'sldNum') continue;
    const copy = clone(el);
    copy.id = uid();
    if (copy.text) copy.text = { ...copy.text, paras: [{ runs: [] }] };
    elements.push(copy);
  }
  return { id: uid('s'), layoutId: layout.id, elements };
}

export function allElements(list: El[], out: El[] = []): El[] {
  for (const e of list) {
    out.push(e);
    if (e.type === 'group') allElements(e.children, out);
  }
  return out;
}

export function isTextShape(e: El): e is ShapeEl {
  return e.type === 'shape' && !!e.text;
}

export function plainText(t: TextBody | undefined): string {
  if (!t) return '';
  return t.paras.map((p) => p.runs.map((r) => (r.br ? '\n' : r.t)).join('')).join('\n');
}

export function slideTitle(s: Slide): string {
  const t = s.elements.find((e) => e.type === 'shape' && (e.ph?.type === 'title' || e.ph?.type === 'ctrTitle')) as ShapeEl | undefined;
  return plainText(t?.text).trim();
}

export function normalizePres(p: Pres): Pres {
  if (!p.masters?.length) {
    const fresh = blankPres();
    p.masters = fresh.masters;
    p.layouts = fresh.layouts;
  }
  p.slides ??= [];
  p.size ??= { w: 960, h: 540 };
  return p;
}
