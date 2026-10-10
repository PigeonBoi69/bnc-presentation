// Table styles. A style is a recipe; applying it writes explicit fills, borders and text settings into the
// cells (so the table looks the same everywhere), while the table remembers which style it came from.
import type { Cell, Color, Fill, Line, LstLevel, TableEl } from './model';

export type PartName = 'wholeTbl' | 'band1H' | 'band2H' | 'band1V' | 'band2V' | 'firstCol' | 'lastCol' | 'firstRow' | 'lastRow' | 'nwCell' | 'neCell' | 'swCell' | 'seCell';

export interface TsBorders {
  l?: Line | null;
  r?: Line | null;
  t?: Line | null;
  b?: Line | null;
  insideH?: Line | null;
  insideV?: Line | null;
}
export interface TsPart {
  fill?: Fill | null;
  b?: boolean;
  i?: boolean;
  color?: Color;
  borders?: TsBorders;
}
export interface TableStyleDef {
  id: string;
  name: string;
  group: string;
  guid?: string;
  parts: Partial<Record<PartName, TsPart>>;
}

const solid = (c: Color): Fill => ({ t: 'solid', c });
const line = (c: Color, w = 1): Line => ({ c, w });
const dk1: Color = { theme: 'dk1' };
const lt1: Color = { theme: 'lt1' };
const tx1: Color = { theme: 'tx1' };
const bg1: Color = { theme: 'bg1' };

const ACC = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const;
const accName = (i: number) => `Accent ${i + 1}`;

function medium2(accent: Color | null, id: string, name: string, guid?: string): TableStyleDef {
  const base = accent ?? dk1;
  const tintOf = (t: number): Color => (typeof base === 'string' ? base : { ...base, tint: t });
  const edge = line(lt1, 1);
  return {
    id,
    name,
    group: 'Medium',
    guid,
    parts: {
      wholeTbl: { color: dk1, fill: solid(tintOf(0.2)), borders: { l: edge, r: edge, t: edge, b: edge, insideH: edge, insideV: edge } },
      band1H: { fill: solid(tintOf(0.4)) },
      band1V: { fill: solid(tintOf(0.4)) },
      firstCol: { b: true, color: lt1, fill: solid(base) },
      lastCol: { b: true, color: lt1, fill: solid(base) },
      lastRow: { b: true, color: lt1, fill: solid(base), borders: { t: line(lt1, 3) } },
      firstRow: { b: true, color: lt1, fill: solid(base), borders: { b: line(lt1, 3) } },
    },
  };
}

function medium1(accent: Color | null, id: string, name: string, guid?: string): TableStyleDef {
  const base = accent ?? dk1;
  const edge = line(base, 1);
  return {
    id,
    name,
    group: 'Medium',
    guid,
    parts: {
      wholeTbl: { color: dk1, fill: solid(lt1), borders: { l: edge, r: edge, t: edge, b: edge, insideH: edge } },
      band1H: { fill: solid(typeof base === 'string' ? base : { ...base, tint: 0.2 }) },
      band1V: { fill: solid(typeof base === 'string' ? base : { ...base, tint: 0.2 }) },
      firstCol: { b: true },
      lastCol: { b: true },
      lastRow: { b: true, borders: { t: line(base, 2) }, fill: solid(lt1) },
      firstRow: { b: true, color: lt1, fill: solid(base) },
    },
  };
}

function light1(accent: Color | null, id: string, name: string, guid?: string): TableStyleDef {
  const base = accent ?? tx1;
  const edge = line(base, 1);
  return {
    id,
    name,
    group: 'Light',
    guid,
    parts: {
      wholeTbl: { color: tx1, borders: { t: edge, b: edge } },
      band1H: { fill: solid(typeof base === 'string' ? base : { ...base, alpha: 0.2 }) },
      band1V: { fill: solid(typeof base === 'string' ? base : { ...base, alpha: 0.2 }) },
      firstCol: { b: true },
      lastCol: { b: true },
      lastRow: { b: true, borders: { t: edge } },
      firstRow: { b: true, borders: { b: edge } },
    },
  };
}

function light2(accent: Color | null, id: string, name: string, guid?: string): TableStyleDef {
  const base = accent ?? tx1;
  const edge = line(base, 1);
  return {
    id,
    name,
    group: 'Light',
    guid,
    parts: {
      wholeTbl: { color: tx1, borders: { l: edge, r: edge, t: edge, b: edge } },
      band1H: { borders: { t: edge, b: edge } },
      band1V: { borders: { l: edge, r: edge } },
      firstCol: { b: true },
      lastCol: { b: true },
      lastRow: { b: true, borders: { t: line(base, 2) } },
      firstRow: { b: true, color: bg1, fill: solid(base) },
    },
  };
}

function light3(accent: Color | null, id: string, name: string, guid?: string): TableStyleDef {
  const base = accent ?? tx1;
  const edge = line(base, 1);
  return {
    id,
    name,
    group: 'Light',
    guid,
    parts: {
      wholeTbl: { color: tx1, borders: { l: edge, r: edge, t: edge, b: edge, insideH: edge, insideV: edge } },
      band1H: { fill: solid(typeof base === 'string' ? base : { ...base, alpha: 0.2 }) },
      band1V: { fill: solid(typeof base === 'string' ? base : { ...base, alpha: 0.2 }) },
      firstCol: { b: true },
      lastCol: { b: true },
      lastRow: { b: true, borders: { t: line(base, 2) } },
      firstRow: { b: true, color: base, borders: { b: line(base, 2) } },
    },
  };
}

function dark1(accent: Color | null, id: string, name: string, guid?: string): TableStyleDef {
  const base = accent ?? dk1;
  const shade = (s: number): Color => (typeof base === 'string' ? base : { ...base, shade: s });
  return {
    id,
    name,
    group: 'Dark',
    guid,
    parts: {
      wholeTbl: { color: lt1, fill: solid(shade(0.2)) },
      band1H: { fill: solid(shade(0.4)) },
      band1V: { fill: solid(shade(0.4)) },
      firstCol: { b: true, color: lt1, fill: solid(shade(0.6)) },
      lastCol: { b: true, color: lt1, fill: solid(shade(0.6)) },
      lastRow: { b: true, color: lt1, fill: solid(shade(0.6)), borders: { t: line(lt1, 3) } },
      firstRow: { b: true, color: lt1, fill: solid(typeof base === 'string' ? base : { theme: 'dk1' }), borders: { b: line(lt1, 3) } },
    },
  };
}

const MEDIUM2_GUIDS = ['{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}', '{21E4AEA4-8DFA-4A89-87EB-49C32662AFE0}', '{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}', '{00A15C55-8517-42AA-B614-E9B94910E393}', '{7DF18680-E054-41AD-8BC1-D1AEF772440D}', '{93296810-A885-4BE3-A3E7-6D5BEEA58F35}'];
const MEDIUM1_GUIDS = ['{B301B821-A1FF-4177-AEE7-76D212191A09}', '{9DCAF9ED-07DC-4A11-8D7F-57B35C25682E}', '{1FECB4D8-DB02-4DC6-A0A2-4F2EBAE1DC90}', '{1E171933-4619-4E11-9A3F-F7608DF75F80}', '{FABFCF23-3B69-468F-B69F-88F6DE6A72F2}', '{10A1B5D5-9B99-4C35-A422-299274C87663}'];
const LIGHT1_GUIDS = ['{3B4B98B0-60AC-42C2-AFA5-B58CD77FA1E5}', '{0E3FDE45-AF77-4B5C-9715-49D594BDF05E}', '{C083E6E3-FA7D-4D7B-A595-EF9225AFEA82}', '{D27102A9-8310-4765-A935-A1911B00CA55}', '{5FD0F851-EC5A-4D38-B0AD-8093EC10F338}', '{68D230F3-CF80-4859-8CE7-A43EE81993B5}'];
const LIGHT2_GUIDS = ['{69012ECD-51FC-41F1-AA8D-1B2483CD663E}', '{72833802-FEF1-4C79-8D5D-14CF1EAF98D9}', '{F2DE63D5-997A-4646-A377-4702673A728D}', '{17292A2E-F333-43FB-9621-5CBBE7FDCDCB}', '{5A111915-BE36-4E01-A7E5-04B1672EAD32}', '{912C8C85-51F0-491E-9774-3900AFEF0FD7}'];
const LIGHT3_GUIDS = ['{BC89EF96-8CEA-46FF-86C4-4CE0E7609802}', '{5DA37D80-6434-44D0-A028-1B22A696006F}', '{8799B23B-EC83-4686-B30A-512413B5E67A}', '{ED083AE6-46FA-4A59-8FB0-9F97EB10719F}', '{BDBED569-4797-4DF1-A0F4-6AAB3CD982D8}', '{E8B1032C-EA38-4F05-BA0D-38AFFFC7BED3}'];

export const TABLE_STYLES: TableStyleDef[] = [
  { id: 'none-nogrid', name: 'No Style, No Grid', group: 'Plain', guid: '{2D5ABB26-0587-4C30-8999-92F81FD0307C}', parts: { wholeTbl: { color: tx1 } } },
  { id: 'none-grid', name: 'No Style, Table Grid', group: 'Plain', guid: '{5940675A-B579-460E-94D1-54222C63F5DA}', parts: { wholeTbl: { color: tx1, borders: { l: line(tx1), r: line(tx1), t: line(tx1), b: line(tx1), insideH: line(tx1), insideV: line(tx1) } } } },
  light1(null, 'light1', 'Light Style 1', '{9D7B26C5-4107-4FEC-AEDC-1716B250A1EF}'),
  ...ACC.map((a, i) => light1({ theme: a }, `light1-${a}`, `Light Style 1 - ${accName(i)}`, LIGHT1_GUIDS[i])),
  light2(null, 'light2', 'Light Style 2', '{7E9639D4-E3E2-4D34-9284-5A2195B3D0D7}'),
  ...ACC.map((a, i) => light2({ theme: a }, `light2-${a}`, `Light Style 2 - ${accName(i)}`, LIGHT2_GUIDS[i])),
  light3(null, 'light3', 'Light Style 3', '{616DA210-FB5B-4158-B5E0-FEB733F419BA}'),
  ...ACC.map((a, i) => light3({ theme: a }, `light3-${a}`, `Light Style 3 - ${accName(i)}`, LIGHT3_GUIDS[i])),
  medium1(null, 'medium1', 'Medium Style 1', '{793D81CF-94F2-401A-BA57-92F5A7B2D0C5}'),
  ...ACC.map((a, i) => medium1({ theme: a }, `medium1-${a}`, `Medium Style 1 - ${accName(i)}`, MEDIUM1_GUIDS[i])),
  medium2(null, 'medium2', 'Medium Style 2', '{073A0DAA-6AF3-43AB-8588-CEC1D06C72B9}'),
  ...ACC.map((a, i) => medium2({ theme: a }, `medium2-${a}`, `Medium Style 2 - ${accName(i)}`, MEDIUM2_GUIDS[i])),
  dark1(null, 'dark1', 'Dark Style 1', '{E8034E78-7F5D-4C2E-B375-FC64B27BC917}'),
  ...ACC.map((a, i) => dark1({ theme: a }, `dark1-${a}`, `Dark Style 1 - ${accName(i)}`, undefined)),
];

export const DEFAULT_TABLE_STYLE = 'medium2-accent1';

export function tableStyleById(id: string): TableStyleDef | undefined {
  return TABLE_STYLES.find((s) => s.id === id || s.guid?.toLowerCase() === id.toLowerCase());
}
export function tableStyleGuid(id: string): string {
  return tableStyleById(id)?.guid ?? (id.startsWith('{') ? id : '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}');
}

function mergeBorders(dst: TsBorders, src: TsBorders | undefined) {
  if (!src) return;
  for (const k of ['l', 'r', 't', 'b', 'insideH', 'insideV'] as const) if (src[k] !== undefined) dst[k] = src[k];
}

/** Write a style's look into every cell of a table. Cell merges are respected. */
export function applyTableStyle(t: TableEl, def: TableStyleDef | undefined) {
  const nRows = t.rows.length;
  const nCols = t.cols.length;
  const st = t.style;
  const bandOffsetR = st.firstRow ? 1 : 0;
  const bandOffsetC = st.firstCol ? 1 : 0;
  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < nCols; c++) {
      const cell = t.rows[r].cells[c];
      if (!cell) continue;
      cell.fill = undefined;
      cell.borders = undefined;
      if (!def) continue;
      const names: PartName[] = ['wholeTbl'];
      if (st.bandRow && r >= bandOffsetR && !(st.lastRow && r === nRows - 1)) names.push((r - bandOffsetR) % 2 === 0 ? 'band1H' : 'band2H');
      if (st.bandCol && c >= bandOffsetC && !(st.lastCol && c === nCols - 1)) names.push((c - bandOffsetC) % 2 === 0 ? 'band1V' : 'band2V');
      if (st.firstCol && c === 0) names.push('firstCol');
      if (st.lastCol && c === nCols - 1) names.push('lastCol');
      if (st.lastRow && r === nRows - 1) names.push('lastRow');
      if (st.firstRow && r === 0) names.push('firstRow');
      if (st.firstRow && st.firstCol && r === 0 && c === 0) names.push('nwCell');
      if (st.firstRow && st.lastCol && r === 0 && c === nCols - 1) names.push('neCell');
      if (st.lastRow && st.firstCol && r === nRows - 1 && c === 0) names.push('swCell');
      if (st.lastRow && st.lastCol && r === nRows - 1 && c === nCols - 1) names.push('seCell');

      let fill: Fill | null | undefined;
      let bold: boolean | undefined;
      let italic: boolean | undefined;
      let color: Color | undefined;
      const bd: TsBorders = {};
      for (const nme of names) {
        const part = def.parts[nme];
        if (!part) continue;
        if (part.fill !== undefined) fill = part.fill;
        if (part.b !== undefined) bold = part.b;
        if (part.i !== undefined) italic = part.i;
        if (part.color !== undefined) color = part.color;
        mergeBorders(bd, part.borders);
      }
      if (fill) cell.fill = fill;
      const edge = (own: Line | null | undefined, inner: Line | null | undefined, isEdge: boolean) => (isEdge ? own : inner !== undefined ? inner : own);
      const bl = edge(bd.l, bd.insideV, c === 0);
      const br = edge(bd.r, bd.insideV, c === nCols - 1);
      const bt = edge(bd.t, bd.insideH, r === 0);
      const bb = edge(bd.b, bd.insideH, r === nRows - 1);
      const borders = { l: bl ?? undefined, r: br ?? undefined, t: bt ?? undefined, b: bb ?? undefined };
      if (borders.l || borders.r || borders.t || borders.b) cell.borders = borders;
      if (bold !== undefined || italic !== undefined || color !== undefined) {
        cell.text.lst = Array.from({ length: 9 }, (_, i) => ({ ...(cell.text.lst?.[i] ?? {}), ...(bold !== undefined ? { b: bold } : {}), ...(italic !== undefined ? { i: italic } : {}), ...(color !== undefined ? { color } : {}) })) as LstLevel[];
      }
    }
  }
}

export function cellOf(t: TableEl, r: number, c: number): Cell | undefined {
  return t.rows[r]?.cells[c];
}
