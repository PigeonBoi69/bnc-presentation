// Native chart rendering (SVG). Charts are real objects with their own data, not pictures.
import { css, type ThemeCtx } from './color';
import { esc, fontStack } from './text';
import type { ChartEl, Color } from './model';

const ACCENTS = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'] as const;

export function seriesColor(i: number, explicit?: Color): Color {
  if (explicit) return explicit;
  const n = ACCENTS.length;
  const base = ACCENTS[i % n];
  const round = Math.floor(i / n);
  if (round === 0) return { theme: base };
  return round % 2 === 1 ? { theme: base, lumMod: 0.6 } : { theme: base, lumMod: 0.4, lumOff: 0.6 };
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return nice * pow;
}

function ticks(min: number, max: number, count = 5): number[] {
  const step = (max - min) / count;
  return Array.from({ length: count + 1 }, (_, i) => min + step * i);
}

const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : String(Math.round(v * 100) / 100));
const num = (v: number | null | undefined) => (typeof v === 'number' && isFinite(v) ? v : 0);

export function chartSvg(el: ChartEl, w: number, h: number, ctx: ThemeCtx): string {
  const text = css({ theme: 'tx1', lumMod: 0.65, lumOff: 0.35 }, ctx);
  const grid = css({ theme: 'tx1', lumMod: 0.15, lumOff: 0.85 }, ctx);
  const font = fontStack('+mn', ctx).replace(/"/g, "'");
  const out: string[] = [];
  const T = (x: number, y: number, s: string, extra = '') => `<text x="${x}" y="${y}" fill="${text}" font-size="12" font-family="${font}" ${extra}>${esc(s)}</text>`;

  let top = 8;
  let bottom = 8;
  let left = 8;
  let right = 8;
  if (el.title) {
    out.push(`<text x="${w / 2}" y="26" fill="${text}" font-size="18" text-anchor="middle" font-family="${font}">${esc(el.title)}</text>`);
    top += 30;
  }
  const names = el.kind === 'pie' || el.kind === 'doughnut' ? el.cats : el.series.map((s) => s.name);
  const legendColor = (i: number) => (el.kind === 'pie' || el.kind === 'doughnut' ? seriesColor(i) : seriesColor(i, el.series[i]?.color));
  const legendPos = el.legend ?? 'b';
  if (legendPos !== 'none' && names.length) {
    const itemW = (n: string) => 28 + n.length * 6.4;
    if (legendPos === 'b' || legendPos === 't') {
      const total = names.reduce((a, n) => a + itemW(n), 0);
      let x = Math.max(8, (w - total) / 2);
      const y = legendPos === 'b' ? h - 12 : top + 6;
      names.forEach((n, i) => {
        out.push(`<rect x="${x}" y="${y - 9}" width="10" height="10" fill="${css(legendColor(i), ctx)}"/>`, T(x + 15, y, n));
        x += itemW(n);
      });
      if (legendPos === 'b') bottom += 24;
      else top += 24;
    } else {
      const widest = Math.max(...names.map(itemW));
      const x = legendPos === 'r' ? w - widest - 4 : 8;
      let y = Math.max(top + 10, h / 2 - names.length * 10);
      names.forEach((n, i) => {
        out.push(`<rect x="${x}" y="${y - 9}" width="10" height="10" fill="${css(legendColor(i), ctx)}"/>`, T(x + 15, y, n));
        y += 20;
      });
      if (legendPos === 'r') right += widest + 8;
      else left += widest + 8;
    }
  }

  const kind = el.kind;
  const nCats = Math.max(el.cats.length, ...el.series.map((s) => s.values.length), 1);

  // ---- pie / doughnut ----
  if (kind === 'pie' || kind === 'doughnut') {
    const vals = (el.series[0]?.values ?? []).map((v) => Math.max(0, num(v)));
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const cx = left + (w - left - right) / 2;
    const cy = top + (h - top - bottom) / 2;
    const r = Math.max(10, Math.min(w - left - right, h - top - bottom) / 2 - 6);
    let ang = -Math.PI / 2;
    vals.forEach((v, i) => {
      const sweep = (v / total) * Math.PI * 2;
      const a2 = ang + sweep;
      const x1 = cx + r * Math.cos(ang);
      const y1 = cy + r * Math.sin(ang);
      const x2 = cx + r * Math.cos(a2);
      const y2 = cy + r * Math.sin(a2);
      const large = sweep > Math.PI ? 1 : 0;
      const fill = css(seriesColor(i), ctx);
      if (kind === 'doughnut') {
        const ri = r * 0.55;
        const xi1 = cx + ri * Math.cos(a2);
        const yi1 = cy + ri * Math.sin(a2);
        const xi2 = cx + ri * Math.cos(ang);
        const yi2 = cy + ri * Math.sin(ang);
        out.push(`<path d="M${x1},${y1}A${r},${r} 0 ${large} 1 ${x2},${y2}L${xi1},${yi1}A${ri},${ri} 0 ${large} 0 ${xi2},${yi2}Z" fill="${fill}" stroke="#fff" stroke-width="1.5"/>`);
      } else if (vals.length === 1) out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="#fff" stroke-width="1.5"/>`);
      else out.push(`<path d="M${cx},${cy}L${x1},${y1}A${r},${r} 0 ${large} 1 ${x2},${y2}Z" fill="${fill}" stroke="#fff" stroke-width="1.5"/>`);
      if (el.labels) {
        const mid = ang + sweep / 2;
        const lr = kind === 'doughnut' ? r * 0.78 : r * 0.62;
        out.push(`<text x="${cx + lr * Math.cos(mid)}" y="${cy + lr * Math.sin(mid) + 4}" fill="#fff" font-size="12" text-anchor="middle" font-family="${font}">${Math.round((v / total) * 100)}%</text>`);
      }
      ang = a2;
    });
    return out.join('');
  }

  // ---- radar ----
  if (kind === 'radar') {
    const cx = left + (w - left - right) / 2;
    const cy = top + (h - top - bottom) / 2;
    const r = Math.max(10, Math.min(w - left - right, h - top - bottom) / 2 - 20);
    const max = niceMax(Math.max(...el.series.flatMap((s) => s.values.map(num)), 1));
    for (let g = 1; g <= 5; g++) {
      const pts = Array.from({ length: nCats }, (_, i) => `${cx + ((r * g) / 5) * Math.sin((i / nCats) * Math.PI * 2)},${cy - ((r * g) / 5) * Math.cos((i / nCats) * Math.PI * 2)}`);
      out.push(`<polygon points="${pts.join(' ')}" fill="none" stroke="${grid}"/>`);
    }
    for (let i = 0; i < nCats; i++) {
      const x = cx + r * Math.sin((i / nCats) * Math.PI * 2);
      const y = cy - r * Math.cos((i / nCats) * Math.PI * 2);
      out.push(`<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${grid}"/>`, T(cx + (r + 10) * Math.sin((i / nCats) * Math.PI * 2), cy - (r + 10) * Math.cos((i / nCats) * Math.PI * 2) + 4, el.cats[i] ?? '', 'text-anchor="middle"'));
    }
    el.series.forEach((s, si) => {
      const col = css(seriesColor(si, s.color), ctx);
      const pts = Array.from({ length: nCats }, (_, i) => `${cx + (r * num(s.values[i])) / max * Math.sin((i / nCats) * Math.PI * 2)},${cy - (r * num(s.values[i])) / max * Math.cos((i / nCats) * Math.PI * 2)}`);
      out.push(`<polygon points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="2.25"/>`);
    });
    return out.join('');
  }

  // ---- cartesian ----
  const horizontal = kind === 'bar' || kind === 'barStacked';
  const stacked = kind === 'colStacked' || kind === 'barStacked';
  const isScatter = kind === 'scatter';

  let yMin = 0;
  let yMax = 1;
  if (stacked) {
    for (let i = 0; i < nCats; i++) yMax = Math.max(yMax, el.series.reduce((a, s) => a + Math.max(0, num(s.values[i])), 0));
    for (let i = 0; i < nCats; i++) yMin = Math.min(yMin, el.series.reduce((a, s) => a + Math.min(0, num(s.values[i])), 0));
  } else {
    for (const s of el.series) for (const v of s.values) {
      yMax = Math.max(yMax, num(v));
      yMin = Math.min(yMin, num(v));
    }
  }
  const niceTop = niceMax(yMax);
  yMax = niceTop;
  if (yMin < 0) yMin = -niceMax(-yMin);

  let xMin = 0;
  let xMax = 1;
  if (isScatter) {
    const xs = el.series.flatMap((s) => (s.x ?? s.values.map((_, i) => i + 1)).map(num));
    xMax = niceMax(Math.max(...xs, 1));
    xMin = Math.min(0, ...xs);
  }

  const yTicks = ticks(yMin, yMax, 5);
  const labelW = Math.max(...yTicks.map((t) => fmt(t).length)) * 6.6 + 10;
  const catLabelH = 22;

  const px0 = left + (horizontal ? Math.max(...el.cats.map((c) => c.length), 3) * 6.2 + 10 : labelW);
  const px1 = w - right - 6;
  const py0 = top + 6;
  const py1 = h - bottom - (horizontal ? labelW * 0 + 20 : catLabelH);
  const pw = Math.max(10, px1 - px0);
  const ph = Math.max(10, py1 - py0);

  const vToY = (v: number) => py1 - ((v - yMin) / (yMax - yMin || 1)) * ph;
  const vToX = (v: number) => px0 + ((v - yMin) / (yMax - yMin || 1)) * pw;
  const sx = (v: number) => px0 + ((v - xMin) / (xMax - xMin || 1)) * pw;

  // gridlines + value axis
  if (el.grid !== false || true) {
    yTicks.forEach((t) => {
      if (horizontal) {
        const x = vToX(t);
        out.push(el.grid !== false ? `<line x1="${x}" y1="${py0}" x2="${x}" y2="${py1}" stroke="${grid}"/>` : '', T(x, py1 + 15, fmt(t), 'text-anchor="middle"'));
      } else {
        const y = vToY(t);
        out.push(el.grid !== false ? `<line x1="${px0}" y1="${y}" x2="${px1}" y2="${y}" stroke="${grid}"/>` : '', T(px0 - 6, y + 4, fmt(t), 'text-anchor="end"'));
      }
    });
  }
  if (isScatter) {
    ticks(xMin, xMax, 5).forEach((t) => out.push(T(sx(t), py1 + 15, fmt(t), 'text-anchor="middle"')));
  }
  // axis lines
  out.push(`<line x1="${px0}" y1="${py0}" x2="${px0}" y2="${py1}" stroke="${grid}"/>`);
  const zeroY = vToY(0);
  out.push(`<line x1="${px0}" y1="${horizontal ? py1 : zeroY}" x2="${px1}" y2="${horizontal ? py1 : zeroY}" stroke="${css({ theme: 'tx1', lumMod: 0.25, lumOff: 0.75 }, ctx)}"/>`);

  const m = el.series.length || 1;

  if (kind === 'col' || kind === 'colStacked' || kind === 'bar' || kind === 'barStacked') {
    const groupW = (horizontal ? ph : pw) / nCats;
    const gap = groupW * 0.25;
    const barW = stacked ? groupW - gap : (groupW - gap) / m;
    for (let c = 0; c < nCats; c++) {
      let pos = 0;
      let neg = 0;
      el.series.forEach((s, si) => {
        const v = num(s.values[c]);
        const col = css(seriesColor(si, s.color), ctx);
        let a: number;
        let b: number;
        if (stacked) {
          if (v >= 0) {
            a = pos;
            pos += v;
            b = pos;
          } else {
            a = neg;
            neg += v;
            b = neg;
          }
        } else {
          a = 0;
          b = v;
        }
        if (horizontal) {
          const y = py0 + c * groupW + gap / 2 + (stacked ? 0 : si * barW);
          const x1 = vToX(Math.min(a, b));
          const x2 = vToX(Math.max(a, b));
          out.push(`<rect x="${x1}" y="${y}" width="${Math.max(0, x2 - x1)}" height="${barW}" fill="${col}"/>`);
          if (el.labels) out.push(T((x1 + x2) / 2, y + barW / 2 + 4, fmt(v), `text-anchor="middle" ${stacked ? 'fill="#fff"' : ''}`));
        } else {
          const x = px0 + c * groupW + gap / 2 + (stacked ? 0 : si * barW);
          const y1 = vToY(Math.max(a, b));
          const y2 = vToY(Math.min(a, b));
          out.push(`<rect x="${x}" y="${y1}" width="${barW}" height="${Math.max(0, y2 - y1)}" fill="${col}"/>`);
          if (el.labels) out.push(T(x + barW / 2, stacked ? (y1 + y2) / 2 + 4 : y1 - 4, fmt(v), 'text-anchor="middle"'));
        }
      });
      if (horizontal) out.push(T(px0 - 6, py0 + c * groupW + groupW / 2 + 4, el.cats[c] ?? '', 'text-anchor="end"'));
      else out.push(T(px0 + c * groupW + groupW / 2, py1 + 16, el.cats[c] ?? '', 'text-anchor="middle"'));
    }
    return out.join('');
  }

  if (kind === 'line' || kind === 'area') {
    const step = pw / nCats;
    for (let c = 0; c < nCats; c++) out.push(T(px0 + c * step + step / 2, py1 + 16, el.cats[c] ?? '', 'text-anchor="middle"'));
    el.series.forEach((s, si) => {
      const col = css(seriesColor(si, s.color), ctx);
      const pts = s.values.map((v, i) => [px0 + i * step + step / 2, vToY(num(v))] as [number, number]);
      if (!pts.length) return;
      if (kind === 'area') {
        const a = `M${pts[0][0]},${zeroY}` + pts.map((p) => `L${p[0]},${p[1]}`).join('') + `L${pts[pts.length - 1][0]},${zeroY}Z`;
        out.push(`<path d="${a}" fill="${col}" fill-opacity="0.7"/>`);
      } else {
        const d = el.smooth ? smoothPath(pts) : 'M' + pts.map((p) => `${p[0]},${p[1]}`).join('L');
        out.push(`<path d="${d}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`);
        pts.forEach((p) => out.push(`<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="${col}"/>`));
      }
      if (el.labels) pts.forEach((p, i) => out.push(T(p[0], p[1] - 8, fmt(num(s.values[i])), 'text-anchor="middle"')));
    });
    return out.join('');
  }

  if (kind === 'scatter') {
    el.series.forEach((s, si) => {
      const col = css(seriesColor(si, s.color), ctx);
      const xs = s.x ?? s.values.map((_, i) => i + 1);
      s.values.forEach((v, i) => out.push(`<circle cx="${sx(num(xs[i]))}" cy="${vToY(num(v))}" r="4.5" fill="${col}"/>`));
    });
    return out.join('');
  }
  return out.join('');
}

function smoothPath(pts: [number, number][]): string {
  if (pts.length < 3) return 'M' + pts.map((p) => p.join(',')).join('L');
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    d += `C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  return d;
}
