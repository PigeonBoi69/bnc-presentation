import { css, type ThemeCtx } from '../core/color';
import type { Color, ThemeColor, ThemeSlot } from '../core/model';
import { h, popover, iconEl } from './dom';

// ---------------------------------------------------------------------------
// Colour picker (theme aware, like PowerPoint's)
// ---------------------------------------------------------------------------
const THEME_ORDER: ThemeSlot[] = ['bg1', 'tx1', 'bg2', 'tx2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];
const THEME_NAMES: Record<string, string> = { bg1: 'Background 1', tx1: 'Text 1', bg2: 'Background 2', tx2: 'Text 2', accent1: 'Accent 1', accent2: 'Accent 2', accent3: 'Accent 3', accent4: 'Accent 4', accent5: 'Accent 5', accent6: 'Accent 6' };

/** The five shades under each theme colour. */
function shades(slot: ThemeSlot): { c: ThemeColor; label: string }[] {
  const base: ThemeColor = { theme: slot };
  if (slot === 'bg1') return [{ c: base, label: '' }, { c: { ...base, lumMod: 0.95 }, label: 'Darker 5%' }, { c: { ...base, lumMod: 0.85 }, label: 'Darker 15%' }, { c: { ...base, lumMod: 0.75 }, label: 'Darker 25%' }, { c: { ...base, lumMod: 0.65 }, label: 'Darker 35%' }, { c: { ...base, lumMod: 0.5 }, label: 'Darker 50%' }];
  if (slot === 'tx1') return [{ c: base, label: '' }, { c: { ...base, lumMod: 0.5, lumOff: 0.5 }, label: 'Lighter 50%' }, { c: { ...base, lumMod: 0.65, lumOff: 0.35 }, label: 'Lighter 35%' }, { c: { ...base, lumMod: 0.75, lumOff: 0.25 }, label: 'Lighter 25%' }, { c: { ...base, lumMod: 0.85, lumOff: 0.15 }, label: 'Lighter 15%' }, { c: { ...base, lumMod: 0.95, lumOff: 0.05 }, label: 'Lighter 5%' }];
  return [{ c: base, label: '' }, { c: { ...base, lumMod: 0.2, lumOff: 0.8 }, label: 'Lighter 80%' }, { c: { ...base, lumMod: 0.4, lumOff: 0.6 }, label: 'Lighter 60%' }, { c: { ...base, lumMod: 0.6, lumOff: 0.4 }, label: 'Lighter 40%' }, { c: { ...base, lumMod: 0.75 }, label: 'Darker 25%' }, { c: { ...base, lumMod: 0.5 }, label: 'Darker 50%' }];
}

const STANDARD = ['#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0'];
const recent: Color[] = [];

export function rememberColor(c: Color) {
  const key = JSON.stringify(c);
  const i = recent.findIndex((r) => JSON.stringify(r) === key);
  if (i >= 0) recent.splice(i, 1);
  recent.unshift(c);
  recent.length = Math.min(recent.length, 10);
}

export interface ColorPickerOpts {
  title: string;
  ctx: ThemeCtx;
  noneLabel?: string;
  onPick: (c: Color | null) => void;
  /** show the transparency slider */
  alpha?: boolean;
}

export function colorPicker(anchor: HTMLElement, o: ColorPickerOpts) {
  let close = () => {};
  const pick = (c: Color | null) => {
    close();
    if (c) rememberColor(c);
    o.onPick(c);
  };
  const cell = (c: Color, title: string) =>
    h('button', { class: 'color-cell', title, style: { background: css(c, o.ctx) }, on: { click: () => pick(c) } });
  const grid = h('div', { class: 'color-grid' });
  const cols = THEME_ORDER.map(shades);
  for (let row = 0; row < 6; row++) for (let col = 0; col < 10; col++) grid.append(cell(cols[col][row].c, `${THEME_NAMES[THEME_ORDER[col]]}${cols[col][row].label ? ', ' + cols[col][row].label : ''}`));

  const std = h('div', { class: 'color-grid' });
  for (const c of STANDARD) std.append(cell(c, c.toUpperCase()));

  const custom = h('input', { attrs: { type: 'color' }, style: { width: '30px', height: '26px', padding: '0', border: '0', background: 'none', cursor: 'pointer' } });
  custom.addEventListener('change', () => pick(custom.value));

  const body = h('div', { class: 'color-pop' }, h('div', { class: 'color-title', text: `${o.title} — Theme Colors` }), grid, h('div', { class: 'color-title', text: 'Standard Colors' }), std);
  if (recent.length) {
    const rec = h('div', { class: 'color-grid' });
    for (const c of recent) rec.append(cell(c, 'Recent'));
    body.append(h('div', { class: 'color-title', text: 'Recent Colors' }), rec);
  }
  body.append(
    h('div', { class: 'color-actions' },
      o.noneLabel ? h('button', { class: 'btn small', style: { flex: '1' }, text: o.noneLabel, on: { click: () => pick(null) } }) : null,
      h('label', { class: 'muted', style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } }, 'More colors', custom),
    ),
  );
  close = popover(anchor, body);
}

// ---------------------------------------------------------------------------
// Table size grid
// ---------------------------------------------------------------------------
export function tableGridPicker(anchor: HTMLElement, onPick: (rows: number, cols: number) => void, onCustom: () => void) {
  let close = () => {};
  const COLS = 10;
  const ROWS = 8;
  const label = h('div', { class: 'table-label', text: 'Insert Table' });
  const grid = h('div', { class: 'table-grid' });
  const cells: HTMLElement[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = h('i');
      cell.addEventListener('mouseenter', () => {
        cells.forEach((el, i) => el.classList.toggle('on', Math.floor(i / COLS) <= r && i % COLS <= c));
        label.textContent = `${c + 1} x ${r + 1}`;
      });
      cell.addEventListener('click', () => {
        close();
        onPick(r + 1, c + 1);
      });
      cells.push(cell);
      grid.append(cell);
    }
  }
  const custom = h('button', { class: 'btn', style: { width: '100%', marginTop: '8px', height: '28px' }, text: 'Insert Table…', on: { click: () => { close(); onCustom(); } } });
  close = popover(anchor, h('div', { class: 'table-pop' }, grid, label, custom));
}

// ---------------------------------------------------------------------------
// Symbols & emoji
// ---------------------------------------------------------------------------
const SYMBOLS = [
  ...'©®™§¶†‡•…‰′″‹›«»¡¿¢£¤¥€¦¨ª¬±²³´µ·¹º¼½¾×÷',
  ...'←↑→↓↔↕⇐⇑⇒⇓⇔∀∂∃∅∇∈∉∋∏∑−∗√∝∞∠∧∨∩∪∫∴∼≅≈≠≡≤≥⊂⊃⊄⊆⊇⊕⊗⊥',
  ...'αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ',
  ...'♠♣♥♦♪♫☀☁☂☃★☆☎☑☒☐✓✔✗✘✚✦❤❖',
];
const EMOJI = [
  ...'😀😃😄😁😆😅😂🤣😊😇🙂😉😍🥰😘😋😎🤩🥳😏😒😞😔😟😕🙁😣😖😫😩🥺😢😭😤😠😡🤯😳🥵🥶😱😰🤔🤗🤭🤫😶😐😑😬🙄😴',
  ...'👍👎👌✌🤞👏🙌🙏💪👀🧠❤🧡💛💚💙💜🖤💔✨🔥⭐🌟💡🎉🎊🎁🏆📌📎📝📚📖💻📱📷🎵🎮🚀✈🚗🏠🌍🌈☀🌙☕🍕🍔🍎',
];

export function charPicker(anchor: HTMLElement, kind: 'symbol' | 'emoji', onPick: (ch: string) => void) {
  let close = () => {};
  const list = kind === 'symbol' ? SYMBOLS : EMOJI;
  const grid = h('div', { class: 'char-grid' });
  for (const ch of list) grid.append(h('button', { text: ch, title: `U+${ch.codePointAt(0)!.toString(16).toUpperCase()}`, on: { click: () => { close(); onPick(ch); } } }));
  close = popover(anchor, h('div', null, grid));
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------
export const DEFAULT_FONTS = [
  'Aptos', 'Aptos Display', 'Arial', 'Book Antiqua', 'Calibri', 'Calibri Light', 'Cambria', 'Candara', 'Century Gothic', 'Comic Sans MS', 'Consolas',
  'Courier New', 'Franklin Gothic Medium', 'Garamond', 'Georgia', 'Impact', 'Lucida Console', 'Palatino Linotype', 'Rockwell',
  'Segoe UI', 'Sylfaen', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana',
];

let fontCache: string[] | null = null;
export async function loadFonts(): Promise<string[]> {
  if (fontCache) return fontCache;
  try {
    const anyWin = window as any;
    if (typeof anyWin.queryLocalFonts === 'function') {
      const fonts: { family: string }[] = await anyWin.queryLocalFonts();
      const set = new Set(fonts.map((f) => f.family));
      if (set.size) {
        for (const f of ['Aptos', 'Aptos Display']) set.add(f);
        fontCache = [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        return fontCache;
      }
    }
  } catch {
    /* fall through to defaults */
  }
  fontCache = DEFAULT_FONTS;
  return fontCache;
}

export const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96];

/** An editable combo box (text input + dropdown list). */
export function combo(opts: {
  width: number;
  title: string;
  getValue: () => string;
  getItems: () => Promise<string[]> | string[];
  onCommit: (v: string) => void;
  renderItem?: (v: string) => HTMLElement;
  numeric?: boolean;
}) {
  const input = h('input', { attrs: { type: 'text', 'aria-label': opts.title, spellcheck: 'false' }, style: { width: `${opts.width}px` } });
  const caret = h('button', { class: 'rb', title: opts.title, attrs: { tabindex: '-1' } }, iconEl('chevron', 14));
  const root = h('div', { class: 'rcombo', title: opts.title }, input, caret);
  let closePop = () => {};

  const open = async () => {
    const items = await opts.getItems();
    const cur = opts.getValue();
    const list = h('div', { class: 'list-pop' });
    const filter = opts.numeric ? '' : input.value.toLowerCase() === cur.toLowerCase() ? '' : input.value.toLowerCase();
    for (const it of items) {
      if (filter && !it.toLowerCase().includes(filter)) continue;
      const row = h('div', { class: `list-item${it.toLowerCase() === cur.toLowerCase() ? ' sel' : ''}` }, opts.renderItem ? opts.renderItem(it) : it);
      row.addEventListener('mousedown', (e) => e.preventDefault());
      row.addEventListener('click', () => {
        closePop();
        opts.onCommit(it);
      });
      list.append(row);
    }
    closePop = popover(root, list);
    list.querySelector('.sel')?.scrollIntoView({ block: 'center' });
  };
  caret.addEventListener('mousedown', (e) => e.preventDefault());
  caret.addEventListener('click', () => void open());
  input.addEventListener('focus', () => input.select());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      closePop();
      opts.onCommit(input.value.trim());
    } else if (e.key === 'Escape') {
      input.value = opts.getValue();
      closePop();
    }
  });
  const update = () => {
    if (document.activeElement !== input) input.value = opts.getValue();
  };
  return { el: root, update, input };
}
