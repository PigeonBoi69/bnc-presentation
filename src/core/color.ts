// Colour maths: resolving theme colours (with PowerPoint's lumMod / lumOff / tint / shade / alpha) to CSS.
import type { Color, Master, ThemeColor, ThemeDef } from './model';

export interface ThemeCtx {
  theme: ThemeDef;
  clrMap: Master['clrMap'];
}

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

export function parseHex(hex: string): RGBA {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return { r: 0, g: 0, b: 0, a: 1 };
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
  };
}

export const toHex = ({ r, g, b }: RGBA) => '#' + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

export function slotHex(slot: ThemeColor['theme'], ctx: ThemeCtx): string {
  const map = ctx.clrMap as Record<string, string>;
  let key: string = slot;
  if (slot === 'tx1' || slot === 'bg1' || slot === 'tx2' || slot === 'bg2') key = map[slot] ?? { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' }[slot];
  const colors = ctx.theme.colors as Record<string, string>;
  return colors[key] ?? '#000000';
}

export interface ColorMods {
  lumMod?: number;
  lumOff?: number;
  tint?: number;
  shade?: number;
  alpha?: number;
}

/** Apply PowerPoint's colour modifiers (in the order PowerPoint does) to a base colour. */
export function applyColorMods(base: RGBA, c: ColorMods): RGBA {
  let { r, g, b } = base;
  if (c.tint != null) {
    r = r * c.tint + 255 * (1 - c.tint);
    g = g * c.tint + 255 * (1 - c.tint);
    b = b * c.tint + 255 * (1 - c.tint);
  }
  if (c.shade != null) {
    r *= c.shade;
    g *= c.shade;
    b *= c.shade;
  }
  if (c.lumMod != null || c.lumOff != null) {
    const [h, s, l] = rgbToHsl(r, g, b);
    const nl = clamp(l * (c.lumMod ?? 1) + (c.lumOff ?? 0));
    [r, g, b] = hslToRgb(h, s, nl);
  }
  return { r, g, b, a: (c.alpha ?? 1) * base.a };
}

export function resolveColor(c: Color | null | undefined, ctx: ThemeCtx): RGBA {
  if (c == null) return { r: 0, g: 0, b: 0, a: 0 };
  if (typeof c === 'string') return parseHex(c);
  return applyColorMods(parseHex(slotHex(c.theme, ctx)), c);
}

export function css(c: Color | null | undefined, ctx: ThemeCtx, extraAlpha = 1): string {
  const { r, g, b, a } = resolveColor(c, ctx);
  const al = a * extraAlpha;
  const R = Math.round(clamp(r, 0, 255));
  const G = Math.round(clamp(g, 0, 255));
  const B = Math.round(clamp(b, 0, 255));
  return al >= 0.999 ? `rgb(${R},${G},${B})` : `rgba(${R},${G},${B},${Math.round(al * 1000) / 1000})`;
}

export function hexOf(c: Color | null | undefined, ctx: ThemeCtx): string {
  return toHex(resolveColor(c, ctx));
}

/** Perceived brightness 0..1 of a colour. */
export function luma(c: Color, ctx: ThemeCtx): number {
  const { r, g, b } = resolveColor(c, ctx);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function isThemeColor(c: Color | null | undefined): c is ThemeColor {
  return !!c && typeof c === 'object';
}

/** Mix a colour with white (positive) or black (negative) for palette rows. */
export function mixHex(hex: string, amount: number): string {
  const { r, g, b } = parseHex(hex);
  const t = amount >= 0 ? 255 : 0;
  const f = Math.abs(amount);
  return toHex({ r: r + (t - r) * f, g: g + (t - g) * f, b: b + (t - b) * f, a: 1 });
}
