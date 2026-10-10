// Measuring text in a hidden slide, for "shrink text on overflow" and "resize shape to fit text".
import type { ThemeCtx } from '../core/color';
import { geometryOf } from '../core/geometry';
import type { ShapeEl, TextBody } from '../core/model';
import { paragraphsHtml, textBlockStyle } from '../core/text';

let host: HTMLElement | null = null;

function getHost(): HTMLElement {
  if (host && document.body.contains(host)) return host;
  host = document.createElement('div');
  host.className = 'slide';
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-20000px;top:0;visibility:hidden;pointer-events:none;overflow:visible;width:2000px;height:200px;background:none';
  document.body.append(host);
  return host;
}

/** Height of the laid-out text (without insets) for a given available width. */
export function textHeight(tb: TextBody, width: number, ctx: ThemeCtx, scale = 1, lnReduction = 0, slideNumber = 1, slideCount = 1): number {
  const h = getHost();
  const { inner } = textBlockStyle(tb);
  h.innerHTML = `<div class="tx" style="position:relative;display:block;width:${Math.max(1, width)}px"><div class="tx-in" style="${inner}">${paragraphsHtml(tb, ctx, { scale, lnReduction, slideNumber, slideCount })}</div></div>`;
  const inEl = h.querySelector('.tx-in') as HTMLElement;
  const r = inEl.getBoundingClientRect().height;
  h.innerHTML = '';
  return r;
}

export interface FitInfo {
  /** height the text needs, including insets */
  needed: number;
  fontScale: number;
  lnSpcReduction: number;
}

/** Apply a shape's autofit rule. Returns what to change (the caller writes it into the model). */
export function fitShape(el: ShapeEl, ctx: ThemeCtx, slideNumber = 1, slideCount = 1): FitInfo | null {
  const tb = el.text;
  if (!tb) return null;
  const geo = geometryOf(el.geom, el.w, el.h);
  const [l, t, r, b] = geo.text;
  const ins = tb.insets ?? [7.2, 3.6, 7.2, 3.6];
  const width = r - l - ins[0] - ins[2];
  const avail = b - t - ins[1] - ins[3];
  const mode = tb.autofit ?? 'none';
  if (tb.wrap === false && mode !== 'shape') return { needed: 0, fontScale: tb.fontScale ?? 1, lnSpcReduction: tb.lnSpcReduction ?? 0 };
  const natural = textHeight(tb, width, ctx, 1, 0, slideNumber, slideCount);
  if (mode === 'shape') {
    const needed = natural + ins[1] + ins[3] + (el.h - (b - t)) ;
    return { needed: Math.max(needed, 10), fontScale: 1, lnSpcReduction: 0 };
  }
  if (mode === 'shrink') {
    if (natural <= avail + 0.5) return { needed: el.h, fontScale: 1, lnSpcReduction: 0 };
    for (let i = 1; i <= 10; i++) {
      const scale = 1 - 0.075 * i;
      const red = i < 2 ? 0.1 : 0.2;
      if (textHeight(tb, width, ctx, scale, red, slideNumber, slideCount) <= avail + 0.5) return { needed: el.h, fontScale: Math.round(scale * 1000) / 1000, lnSpcReduction: red };
    }
    return { needed: el.h, fontScale: 0.25, lnSpcReduction: 0.2 };
  }
  return { needed: el.h, fontScale: 1, lnSpcReduction: 0 };
}

/** Apply the result of fitShape to the element. Returns true if anything changed. */
export function applyFit(el: ShapeEl, fit: FitInfo | null): boolean {
  if (!fit || !el.text) return false;
  let changed = false;
  const mode = el.text.autofit ?? 'none';
  if (mode === 'shape') {
    if (Math.abs(fit.needed - el.h) > 0.5) {
      const anchor = el.text.anchor ?? 't';
      const delta = fit.needed - el.h;
      if (anchor === 'b') el.y -= delta;
      else if (anchor === 'ctr') el.y -= delta / 2;
      el.h = Math.round(fit.needed * 100) / 100;
      changed = true;
    }
    if (el.text.fontScale) {
      el.text.fontScale = undefined;
      el.text.lnSpcReduction = undefined;
      changed = true;
    }
  } else if (mode === 'shrink') {
    const fs = fit.fontScale === 1 ? undefined : fit.fontScale;
    const lr = fit.lnSpcReduction === 0 ? undefined : fit.lnSpcReduction;
    if (el.text.fontScale !== fs || el.text.lnSpcReduction !== lr) {
      el.text.fontScale = fs;
      el.text.lnSpcReduction = lr;
      changed = true;
    }
  } else if (el.text.fontScale) {
    el.text.fontScale = undefined;
    el.text.lnSpcReduction = undefined;
    changed = true;
  }
  return changed;
}
