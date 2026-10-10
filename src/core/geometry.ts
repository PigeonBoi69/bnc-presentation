// Preset shape geometry: turns a PowerPoint preset name (+ adjust values) into SVG path data.
// Formulas follow the OOXML preset shape definitions; unknown names fall back to a rectangle.
import type { CustPath, Geom } from './model';

export interface ShapePath {
  d: string;
  /** 'norm' = the shape's fill, 'darken'/'lighten' = shaded faces, 'none' = no fill (line only) */
  fill: 'norm' | 'darken' | 'lighten' | 'none';
  stroke: boolean;
}
export interface ShapeGeometry {
  paths: ShapePath[];
  /** text rectangle [l, t, r, b] in px */
  text: [number, number, number, number];
  /** true for open shapes where the fill makes no sense (lines, arcs) */
  open?: boolean;
}

const f = (n: number) => (Math.round(n * 100) / 100).toString();
const rad = (deg: number) => (deg * Math.PI) / 180;

function poly(pts: [number, number][], close = true): string {
  return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)},${f(y)}`).join('') + (close ? 'Z' : '');
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number, ccw = false): string {
  const s = ccw ? 0 : 1;
  return `M${f(cx - rx)},${f(cy)}A${f(rx)},${f(ry)} 0 1 ${s} ${f(cx + rx)},${f(cy)}A${f(rx)},${f(ry)} 0 1 ${s} ${f(cx - rx)},${f(cy)}Z`;
}

function ptOnEllipse(cx: number, cy: number, rx: number, ry: number, deg: number): [number, number] {
  return [cx + rx * Math.cos(rad(deg)), cy + ry * Math.sin(rad(deg))];
}

/** SVG arc segment (assumes the pen is already at the start point). sweep in degrees, clockwise positive. */
function arcTo(cx: number, cy: number, rx: number, ry: number, endDeg: number, sweep: number): string {
  const [x, y] = ptOnEllipse(cx, cy, rx, ry, endDeg);
  const large = Math.abs(sweep) > 180 ? 1 : 0;
  return `A${f(rx)},${f(ry)} 0 ${large} ${sweep >= 0 ? 1 : 0} ${f(x)},${f(y)}`;
}

function regularPolygon(n: number, w: number, h: number, startDeg = -90): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) pts.push([Math.cos(rad(startDeg + (360 / n) * i)), Math.sin(rad(startDeg + (360 / n) * i))]);
  return fitPoints(pts, w, h);
}

function fitPoints(pts: [number, number][], w: number, h: number): [number, number][] {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return pts.map(([x, y]) => [((x - minX) / (maxX - minX || 1)) * w, ((y - minY) / (maxY - minY || 1)) * h]);
}

function star(n: number, ratio: number, w: number, h: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? 1 : ratio;
    const a = rad(-90 + (180 / n) * i);
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return fitPoints(pts, w, h);
}

const STAR_ADJ: Record<number, number> = { 4: 12500, 5: 19098, 6: 28868, 7: 34601, 8: 37500, 10: 42533, 12: 37500, 16: 37500, 24: 37500, 32: 37500 };

const full = (w: number, h: number): [number, number, number, number] => [0, 0, w, h];
const one = (d: string, text: [number, number, number, number], opts: Partial<ShapePath> = {}): ShapeGeometry => ({ paths: [{ d, fill: 'norm', stroke: true, ...opts }], text });

export function presetGeometry(prst: string, w: number, h: number, adj: Record<string, number> = {}): ShapeGeometry {
  const ss = Math.min(w, h);
  const a = (name: string, def: number) => (adj[name] !== undefined ? adj[name] : def);
  const hc = w / 2;
  const vc = h / 2;

  switch (prst) {
    case 'rect':
    case 'flowChartProcess':
      return one(`M0,0H${f(w)}V${f(h)}H0Z`, full(w, h));

    case 'roundRect': {
      const r = Math.min(Math.max(0, (ss * a('adj', 16667)) / 100000), ss / 2);
      const il = r * 0.29289;
      return one(`M${f(r)},0H${f(w - r)}A${f(r)},${f(r)} 0 0 1 ${f(w)},${f(r)}V${f(h - r)}A${f(r)},${f(r)} 0 0 1 ${f(w - r)},${f(h)}H${f(r)}A${f(r)},${f(r)} 0 0 1 0,${f(h - r)}V${f(r)}A${f(r)},${f(r)} 0 0 1 ${f(r)},0Z`, [il, il, w - il, h - il]);
    }
    case 'flowChartAlternateProcess': {
      const r = Math.min(ss / 6, ss / 2);
      return one(`M${f(r)},0H${f(w - r)}A${f(r)},${f(r)} 0 0 1 ${f(w)},${f(r)}V${f(h - r)}A${f(r)},${f(r)} 0 0 1 ${f(w - r)},${f(h)}H${f(r)}A${f(r)},${f(r)} 0 0 1 0,${f(h - r)}V${f(r)}A${f(r)},${f(r)} 0 0 1 ${f(r)},0Z`, [r * 0.29, r * 0.29, w - r * 0.29, h - r * 0.29]);
    }
    case 'round1Rect': {
      const r = Math.min((ss * a('adj', 16667)) / 100000, ss);
      return one(`M0,0H${f(w - r)}A${f(r)},${f(r)} 0 0 1 ${f(w)},${f(r)}V${f(h)}H0Z`, full(w, h));
    }
    case 'round2SameRect': {
      const r1 = Math.min((ss * a('adj1', 16667)) / 100000, ss / 2);
      const r2 = Math.min((ss * a('adj2', 0)) / 100000, ss / 2);
      return one(`M${f(r1)},0H${f(w - r1)}A${f(r1)},${f(r1)} 0 0 1 ${f(w)},${f(r1)}V${f(h - r2)}A${f(r2)},${f(r2)} 0 0 1 ${f(w - r2)},${f(h)}H${f(r2)}A${f(r2)},${f(r2)} 0 0 1 0,${f(h - r2)}V${f(r1)}A${f(r1)},${f(r1)} 0 0 1 ${f(r1)},0Z`, full(w, h));
    }
    case 'round2DiagRect': {
      const r1 = Math.min((ss * a('adj1', 16667)) / 100000, ss / 2);
      const r2 = Math.min((ss * a('adj2', 0)) / 100000, ss / 2);
      return one(`M${f(r1)},0H${f(w - r2)}A${f(r2)},${f(r2)} 0 0 1 ${f(w)},${f(r2)}V${f(h - r1)}A${f(r1)},${f(r1)} 0 0 1 ${f(w - r1)},${f(h)}H${f(r2)}A${f(r2)},${f(r2)} 0 0 1 0,${f(h - r2)}V${f(r1)}A${f(r1)},${f(r1)} 0 0 1 ${f(r1)},0Z`.replace(`H${f(w - r2)}A`, `H${f(w - r2)}A`), full(w, h));
    }
    case 'snip1Rect': {
      const s = Math.min((ss * a('adj', 16667)) / 100000, ss);
      return one(poly([[0, 0], [w - s, 0], [w, s], [w, h], [0, h]]), full(w, h));
    }
    case 'snip2SameRect': {
      const s1 = Math.min((ss * a('adj1', 16667)) / 100000, ss / 2);
      const s2 = Math.min((ss * a('adj2', 0)) / 100000, ss / 2);
      return one(poly([[s1, 0], [w - s1, 0], [w, s1], [w, h - s2], [w - s2, h], [s2, h], [0, h - s2], [0, s1]]), full(w, h));
    }
    case 'snipRoundRect': {
      const r = Math.min((ss * a('adj1', 16667)) / 100000, ss);
      const s = Math.min((ss * a('adj2', 16667)) / 100000, ss);
      return one(`M${f(r)},0H${f(w - s)}L${f(w)},${f(s)}V${f(h)}H0V${f(r)}A${f(r)},${f(r)} 0 0 1 ${f(r)},0Z`.replace(`A${f(r)},${f(r)} 0 0 1 ${f(r)},0Z`, `A${f(r)},${f(r)} 0 0 1 ${f(r)},0Z`), full(w, h));
    }

    case 'ellipse':
    case 'flowChartConnector': {
      const k = 0.14645;
      return one(ellipsePath(hc, vc, hc, vc), [w * k, h * k, w * (1 - k), h * (1 - k)]);
    }
    case 'triangle': {
      const x = (w * a('adj', 50000)) / 100000;
      return one(poly([[x, 0], [w, h], [0, h]]), [x / 2, vc, (x + w) / 2, h]);
    }
    case 'rtTriangle':
      return one(poly([[0, 0], [w, h], [0, h]]), [0, vc, w / 2, h]);
    case 'diamond':
    case 'flowChartDecision':
      return one(poly([[hc, 0], [w, vc], [hc, h], [0, vc]]), [w / 4, h / 4, (w * 3) / 4, (h * 3) / 4]);
    case 'parallelogram': {
      const max = (100000 * w) / ss;
      const x = (ss * Math.min(a('adj', 25000), max)) / 100000;
      return one(poly([[x, 0], [w, 0], [w - x, h], [0, h]]), [x * 0.5, 0, w - x * 0.5, h]);
    }
    case 'flowChartInputOutput':
      return one(poly([[w / 5, 0], [w, 0], [(w * 4) / 5, h], [0, h]]), [w / 5, 0, (w * 4) / 5, h]);
    case 'trapezoid': {
      const x = (ss * Math.min(a('adj', 25000), (50000 * w) / ss)) / 100000;
      return one(poly([[0, h], [x, 0], [w - x, 0], [w, h]]), [x / 3, h / 3, w - x / 3, h]);
    }
    case 'pentagon':
      return one(poly(regularPolygon(5, w, h)), [w * 0.2, h * 0.2, w * 0.8, h * 0.8]);
    case 'hexagon': {
      const x = Math.min((ss * a('adj', 25000)) / 100000, w / 2);
      return one(poly([[0, vc], [x, 0], [w - x, 0], [w, vc], [w - x, h], [x, h]]), [x * 0.5, h * 0.1, w - x * 0.5, h * 0.9]);
    }
    case 'flowChartPreparation':
      return one(poly([[0, vc], [w / 5, 0], [(w * 4) / 5, 0], [w, vc], [(w * 4) / 5, h], [w / 5, h]]), [w / 5, 0, (w * 4) / 5, h]);
    case 'heptagon':
      return one(poly(regularPolygon(7, w, h)), [w * 0.15, h * 0.15, w * 0.85, h * 0.85]);
    case 'octagon': {
      const x = (ss * Math.min(a('adj', 29289), 50000)) / 100000;
      return one(poly([[0, x], [x, 0], [w - x, 0], [w, x], [w, h - x], [w - x, h], [x, h], [0, h - x]]), [x / 2, x / 2, w - x / 2, h - x / 2]);
    }
    case 'decagon':
      return one(poly(regularPolygon(10, w, h, 0)), [w * 0.15, h * 0.15, w * 0.85, h * 0.85]);
    case 'dodecagon':
      return one(poly(regularPolygon(12, w, h, 0)), [w * 0.15, h * 0.15, w * 0.85, h * 0.85]);
    case 'plus': {
      const x = (ss * Math.min(a('adj', 25000), 50000)) / 100000;
      return one(poly([[x, 0], [w - x, 0], [w - x, x], [w, x], [w, h - x], [w - x, h - x], [w - x, h], [x, h], [x, h - x], [0, h - x], [0, x], [x, x]]), [0, 0, w, h]);
    }
    case 'frame': {
      const t = (ss * Math.min(a('adj1', 12500), 50000)) / 100000;
      return one(`M0,0H${f(w)}V${f(h)}H0ZM${f(t)},${f(t)}V${f(h - t)}H${f(w - t)}V${f(t)}Z`, [t, t, w - t, h - t]);
    }
    case 'donut': {
      const t = (ss * Math.min(a('adj', 25000), 50000)) / 100000;
      return one(ellipsePath(hc, vc, hc, vc) + ellipsePath(hc, vc, Math.max(0.1, hc - t), Math.max(0.1, vc - t), true), [w * 0.146, h * 0.146, w * 0.854, h * 0.854]);
    }
    case 'noSmoking': {
      const t = (ss * Math.min(a('adj', 18750), 50000)) / 100000;
      const rx = hc - t;
      const ry = vc - t;
      const ang = Math.atan2(h, w);
      const ox = Math.cos(ang) * rx;
      const oy = Math.sin(ang) * ry;
      const bw = Math.max(0.1, t * 0.9);
      const dx = Math.sin(Math.atan2(oy, ox)) * bw;
      const dy = Math.cos(Math.atan2(oy, ox)) * bw;
      const band = poly([[hc - ox - dx * 0.3, vc - oy + dy * 0.3], [hc - ox + dx * 0.3, vc - oy - dy * 0.3], [hc + ox + dx * 0.3, vc + oy - dy * 0.3], [hc + ox - dx * 0.3, vc + oy + dy * 0.3]]);
      return one(ellipsePath(hc, vc, hc, vc) + ellipsePath(hc, vc, rx, ry, true) + band, [w * 0.146, h * 0.146, w * 0.854, h * 0.854]);
    }
    case 'smileyFace': {
      const eye = (cx: number, cy: number) => ellipsePath(cx, cy, w * 0.06, h * 0.075);
      const sm = (a('adj', 4653) / 100000) * h;
      return {
        paths: [
          { d: ellipsePath(hc, vc, hc, vc), fill: 'norm', stroke: true },
          { d: eye(w * 0.3, h * 0.37) + eye(w * 0.7, h * 0.37), fill: 'darken', stroke: false },
          { d: `M${f(w * 0.2)},${f(h * 0.63)}Q${f(hc)},${f(h * 0.63 + sm * 8)} ${f(w * 0.8)},${f(h * 0.63)}`, fill: 'none', stroke: true },
        ],
        text: [w * 0.146, h * 0.146, w * 0.854, h * 0.854],
      };
    }
    case 'heart': {
      const X = (v: number) => (v / 100) * w;
      const Y = (v: number) => (v / 100) * h;
      return one(`M${f(X(50))},${f(Y(92))}C${f(X(10))},${f(Y(62))} ${f(X(0))},${f(Y(36))} ${f(X(14))},${f(Y(18))}C${f(X(27))},${f(Y(2))} ${f(X(45))},${f(Y(8))} ${f(X(50))},${f(Y(26))}C${f(X(55))},${f(Y(8))} ${f(X(73))},${f(Y(2))} ${f(X(86))},${f(Y(18))}C${f(X(100))},${f(Y(36))} ${f(X(90))},${f(Y(62))} ${f(X(50))},${f(Y(92))}Z`, [w * 0.2, h * 0.2, w * 0.8, h * 0.65]);
    }
    case 'lightningBolt': {
      const p = [[8472, 0], [12860, 6080], [11050, 6797], [16577, 12007], [14767, 12877], [21600, 21600], [10012, 14915], [12222, 13987], [5022, 9705], [7602, 8382], [0, 3890]];
      return one(poly(p.map(([x, y]) => [(x / 21600) * w, (y / 21600) * h])), [(w * 8680) / 21600, (h * 8615) / 21600, (w * 13840) / 21600, (h * 13530) / 21600]);
    }
    case 'sun': {
      const t = Math.min(a('adj', 25000), 50000) / 100000;
      const r = Math.min(w, h) / 2;
      const core = r * (1 - t) * 0.75;
      const rays: string[] = [];
      for (let i = 0; i < 8; i++) {
        const ang = i * 45;
        const [x1, y1] = ptOnEllipse(hc, vc, hc, vc, ang);
        const [bx1, by1] = ptOnEllipse(hc, vc, (hc * (core * 1.25)) / r, (vc * (core * 1.25)) / r, ang - 12);
        const [bx2, by2] = ptOnEllipse(hc, vc, (hc * (core * 1.25)) / r, (vc * (core * 1.25)) / r, ang + 12);
        rays.push(poly([[bx1, by1], [x1, y1], [bx2, by2]]));
      }
      return one(rays.join('') + ellipsePath(hc, vc, (hc * core) / r, (vc * core) / r), [w * 0.2, h * 0.2, w * 0.8, h * 0.8]);
    }
    case 'moon': {
      const thick = Math.min(Math.max(a('adj', 50000), 0), 87500) / 100000;
      const ri = Math.max(0.1, w * (1 - thick));
      return one(`M${f(w)},0A${f(w)},${f(vc)} 0 0 0 ${f(w)},${f(h)}A${f(ri)},${f(vc)} 0 0 1 ${f(w)},0Z`, [w * 0.25, h * 0.2, w * 0.75, h * 0.8]);
    }
    case 'cloud': {
      const X = (v: number) => (v / 100) * w;
      const Y = (v: number) => (v / 100) * h;
      return one(
        `M${f(X(18))},${f(Y(78))}C${f(X(2))},${f(Y(78))} ${f(X(-2))},${f(Y(52))} ${f(X(12))},${f(Y(46))}C${f(X(4))},${f(Y(26))} ${f(X(26))},${f(Y(14))} ${f(X(38))},${f(Y(26))}C${f(X(44))},${f(Y(6))} ${f(X(70))},${f(Y(6))} ${f(X(74))},${f(Y(26))}C${f(X(92))},${f(Y(20))} ${f(X(104))},${f(Y(46))} ${f(X(88))},${f(Y(56))}C${f(X(100))},${f(Y(76))} ${f(X(82))},${f(Y(92))} ${f(X(66))},${f(Y(80))}C${f(X(58))},${f(Y(96))} ${f(X(36))},${f(Y(96))} ${f(X(30))},${f(Y(80))}C${f(X(26))},${f(Y(80))} ${f(X(22))},${f(Y(80))} ${f(X(18))},${f(Y(78))}Z`,
        [w * 0.15, h * 0.25, w * 0.85, h * 0.75],
      );
    }

    // ---- stars ----
    case 'star4':
    case 'star5':
    case 'star6':
    case 'star7':
    case 'star8':
    case 'star10':
    case 'star12':
    case 'star16':
    case 'star24':
    case 'star32': {
      const n = parseInt(prst.slice(4), 10);
      const ratio = Math.min(Math.max(a('adj', STAR_ADJ[n] ?? 37500), 0), 50000) / 50000;
      return one(poly(star(n, ratio, w, h)), [w * 0.2, h * 0.2, w * 0.8, h * 0.8]);
    }

    // ---- arrows ----
    case 'rightArrow': {
      const a1 = Math.min(Math.max(a('adj1', 50000), 0), 100000);
      const dx = Math.min((ss * a('adj2', 50000)) / 100000, w);
      const dy = (h * a1) / 200000;
      const x1 = w - dx;
      return one(poly([[0, vc - dy], [x1, vc - dy], [x1, 0], [w, vc], [x1, h], [x1, vc + dy], [0, vc + dy]]), [0, vc - dy, x1 + (dx * dy) / (h / 2 || 1), vc + dy]);
    }
    case 'leftArrow': {
      const a1 = Math.min(Math.max(a('adj1', 50000), 0), 100000);
      const dx = Math.min((ss * a('adj2', 50000)) / 100000, w);
      const dy = (h * a1) / 200000;
      return one(poly([[w, vc - dy], [dx, vc - dy], [dx, 0], [0, vc], [dx, h], [dx, vc + dy], [w, vc + dy]]), [dx - (dx * dy) / (h / 2 || 1), vc - dy, w, vc + dy]);
    }
    case 'upArrow': {
      const a1 = Math.min(Math.max(a('adj1', 50000), 0), 100000);
      const dy = Math.min((ss * a('adj2', 50000)) / 100000, h);
      const dx = (w * a1) / 200000;
      return one(poly([[hc - dx, h], [hc - dx, dy], [0, dy], [hc, 0], [w, dy], [hc + dx, dy], [hc + dx, h]]), [hc - dx, dy, hc + dx, h]);
    }
    case 'downArrow': {
      const a1 = Math.min(Math.max(a('adj1', 50000), 0), 100000);
      const dy = Math.min((ss * a('adj2', 50000)) / 100000, h);
      const dx = (w * a1) / 200000;
      return one(poly([[hc - dx, 0], [hc - dx, h - dy], [0, h - dy], [hc, h], [w, h - dy], [hc + dx, h - dy], [hc + dx, 0]]), [hc - dx, 0, hc + dx, h - dy]);
    }
    case 'leftRightArrow': {
      const a1 = a('adj1', 50000);
      const dx = Math.min((ss * a('adj2', 50000)) / 100000, w / 2);
      const dy = (h * a1) / 200000;
      return one(poly([[0, vc], [dx, 0], [dx, vc - dy], [w - dx, vc - dy], [w - dx, 0], [w, vc], [w - dx, h], [w - dx, vc + dy], [dx, vc + dy], [dx, h]]), [dx, vc - dy, w - dx, vc + dy]);
    }
    case 'upDownArrow': {
      const a1 = a('adj1', 50000);
      const dy = Math.min((ss * a('adj2', 50000)) / 100000, h / 2);
      const dx = (w * a1) / 200000;
      return one(poly([[hc, 0], [w, dy], [hc + dx, dy], [hc + dx, h - dy], [w, h - dy], [hc, h], [0, h - dy], [hc - dx, h - dy], [hc - dx, dy], [0, dy]]), [hc - dx, dy, hc + dx, h - dy]);
    }
    case 'homePlate': {
      const dx = Math.min((ss * a('adj', 50000)) / 100000, w);
      return one(poly([[0, 0], [w - dx, 0], [w, vc], [w - dx, h], [0, h]]), [0, 0, w - dx / 2, h]);
    }
    case 'chevron': {
      const x = Math.min((ss * a('adj', 50000)) / 100000, w);
      return one(poly([[0, 0], [w - x, 0], [w, vc], [w - x, h], [0, h], [x, vc]]), [x, 0, w - x, h]);
    }
    case 'notchedRightArrow': {
      const a1 = a('adj1', 50000);
      const dx = Math.min((ss * a('adj2', 50000)) / 100000, w);
      const dy = (h * a1) / 200000;
      const nx = (dy * 2 > 0 ? dy : 1) * 0.6;
      return one(poly([[0, vc - dy], [w - dx, vc - dy], [w - dx, 0], [w, vc], [w - dx, h], [w - dx, vc + dy], [0, vc + dy], [nx, vc]]), full(w, h));
    }
    case 'bentArrow': {
      const t = (ss * a('adj1', 25000)) / 100000;
      const hh = (ss * a('adj2', 25000)) / 100000;
      const hl = (ss * a('adj3', 43750)) / 100000;
      return one(poly([[0, h], [0, hh - t / 2], [w - hl, hh - t / 2], [w - hl, 0], [w, hh], [w - hl, 2 * hh], [w - hl, hh + t / 2], [t, hh + t / 2], [t, h]]), full(w, h));
    }
    case 'uturnArrow':
    case 'curvedRightArrow':
    case 'curvedLeftArrow':
    case 'curvedUpArrow':
    case 'curvedDownArrow':
    case 'circularArrow':
    case 'leftUpArrow':
    case 'bentUpArrow':
    case 'quadArrow':
    case 'leftRightUpArrow': {
      const dy = h * 0.2;
      return one(poly([[0, h * 0.5 - dy], [w * 0.65, h * 0.5 - dy], [w * 0.65, 0], [w, h * 0.5], [w * 0.65, h], [w * 0.65, h * 0.5 + dy], [0, h * 0.5 + dy]]), full(w, h));
    }

    // ---- callouts ----
    case 'wedgeRectCallout':
    case 'wedgeRoundRectCallout': {
      const dxPos = (w * a('adj1', -20833)) / 100000;
      const dyPos = (h * a('adj2', 62500)) / 100000;
      const xPos = hc + dxPos;
      const yPos = vc + dyPos;
      const dq = (dxPos * h) / w;
      const dz = Math.abs(dyPos) - Math.abs(dq);
      const x1 = (w * (dxPos > 0 ? 7 : 2)) / 12;
      const x2 = (w * (dxPos > 0 ? 10 : 5)) / 12;
      const y1 = (h * (dyPos > 0 ? 7 : 2)) / 12;
      const y2 = (h * (dyPos > 0 ? 10 : 5)) / 12;
      const xl = dz > 0 ? 0 : dxPos > 0 ? 0 : xPos;
      const xt = dz > 0 ? (dyPos > 0 ? x1 : xPos) : x1;
      const xr = dz > 0 ? w : dxPos > 0 ? xPos : w;
      const xb = dz > 0 ? (dyPos > 0 ? xPos : x1) : x1;
      const yl = dz > 0 ? y1 : dxPos > 0 ? y1 : yPos;
      const yt = dz > 0 ? (dyPos > 0 ? 0 : yPos) : 0;
      const yr = dz > 0 ? y1 : dxPos > 0 ? yPos : y1;
      const yb = dz > 0 ? (dyPos > 0 ? yPos : h) : h;
      if (prst === 'wedgeRoundRectCallout') {
        const r = Math.min((ss * a('adj3', 16667)) / 100000, ss / 2);
        const d =
          `M${f(r)},0H${f(x1)}L${f(xt)},${f(yt)}L${f(x2)},0H${f(w - r)}A${f(r)},${f(r)} 0 0 1 ${f(w)},${f(r)}V${f(y1)}L${f(xr)},${f(yr)}L${f(w)},${f(y2)}V${f(h - r)}A${f(r)},${f(r)} 0 0 1 ${f(w - r)},${f(h)}` +
          `H${f(x2)}L${f(xb)},${f(yb)}L${f(x1)},${f(h)}H${f(r)}A${f(r)},${f(r)} 0 0 1 0,${f(h - r)}V${f(y2)}L${f(xl)},${f(yl)}L0,${f(y1)}V${f(r)}A${f(r)},${f(r)} 0 0 1 ${f(r)},0Z`;
        return one(d, [r * 0.29, r * 0.29, w - r * 0.29, h - r * 0.29]);
      }
      return one(poly([[0, 0], [x1, 0], [xt, yt], [x2, 0], [w, 0], [w, y1], [xr, yr], [w, y2], [w, h], [x2, h], [xb, yb], [x1, h], [0, h], [0, y2], [xl, yl], [0, y1]]), full(w, h));
    }
    case 'wedgeEllipseCallout': {
      const dx = (w * a('adj1', -20833)) / 100000;
      const dy = (h * a('adj2', 62500)) / 100000;
      const tipX = hc + dx;
      const tipY = vc + dy;
      const ang = (Math.atan2((tipY - vc) / vc, (tipX - hc) / hc) * 180) / Math.PI;
      const half = 12;
      const [sx, sy] = ptOnEllipse(hc, vc, hc, vc, ang + half);
      const d = `M${f(sx)},${f(sy)}${arcTo(hc, vc, hc, vc, ang - half, 360 - half * 2)}L${f(tipX)},${f(tipY)}Z`;
      return one(d, [w * 0.146, h * 0.146, w * 0.854, h * 0.854]);
    }
    case 'rightArrowCallout':
    case 'leftArrowCallout':
    case 'upArrowCallout':
    case 'downArrowCallout': {
      return one(poly([[0, 0], [w * 0.6, 0], [w * 0.6, h * 0.25], [w, vc], [w * 0.6, h * 0.75], [w * 0.6, h], [0, h]]), [0, 0, w * 0.6, h]);
    }

    // ---- 3-D-ish ----
    case 'can': {
      const y1 = Math.min((ss * a('adj', 25000)) / 200000, h / 2);
      return {
        paths: [
          { d: `M0,${f(y1)}A${f(hc)},${f(y1)} 0 0 1 ${f(w)},${f(y1)}V${f(h - y1)}A${f(hc)},${f(y1)} 0 0 1 0,${f(h - y1)}Z`, fill: 'norm', stroke: true },
          { d: `M0,${f(y1)}A${f(hc)},${f(y1)} 0 0 1 ${f(w)},${f(y1)}A${f(hc)},${f(y1)} 0 0 1 0,${f(y1)}Z`, fill: 'lighten', stroke: true },
        ],
        text: [0, y1 * 2, w, h - y1],
      };
    }
    case 'flowChartMagneticDisk':
      return presetGeometry('can', w, h, { adj: 33333 });
    case 'cube': {
      const y = Math.min((ss * a('adj', 25000)) / 100000, ss);
      return {
        paths: [
          { d: poly([[0, y], [w - y, y], [w - y, h], [0, h]]), fill: 'norm', stroke: true },
          { d: poly([[0, y], [y, 0], [w, 0], [w - y, y]]), fill: 'lighten', stroke: true },
          { d: poly([[w - y, y], [w, 0], [w, h - y], [w - y, h]]), fill: 'darken', stroke: true },
        ],
        text: [0, y, w - y, h],
      };
    }
    case 'bevel': {
      const t = (ss * Math.min(a('adj', 12500), 50000)) / 100000;
      return {
        paths: [
          { d: `M0,0H${f(w)}V${f(h)}H0Z`, fill: 'norm', stroke: true },
          { d: poly([[0, 0], [w, 0], [w - t, t], [t, t]]), fill: 'lighten', stroke: true },
          { d: poly([[w, 0], [w, h], [w - t, h - t], [w - t, t]]), fill: 'darken', stroke: true },
          { d: poly([[0, h], [w, h], [w - t, h - t], [t, h - t]]), fill: 'darken', stroke: true },
          { d: poly([[0, 0], [t, t], [t, h - t], [0, h]]), fill: 'lighten', stroke: true },
        ],
        text: [t, t, w - t, h - t],
      };
    }
    case 'foldedCorner': {
      const y = (ss * Math.min(a('adj', 16667), 50000)) / 100000;
      return {
        paths: [
          { d: poly([[0, 0], [w, 0], [w, h - y], [w - y, h], [0, h]]), fill: 'norm', stroke: true },
          { d: poly([[w - y, h], [w - y * 0.15, h - y * 0.95], [w, h - y]]), fill: 'darken', stroke: true },
        ],
        text: [0, 0, w, h - y / 2],
      };
    }
    case 'flowChartPredefinedProcess':
      return {
        paths: [
          { d: `M0,0H${f(w)}V${f(h)}H0Z`, fill: 'norm', stroke: true },
          { d: `M${f(w / 8)},0V${f(h)}M${f((w * 7) / 8)},0V${f(h)}`, fill: 'none', stroke: true },
        ],
        text: [w / 8, 0, (w * 7) / 8, h],
      };
    case 'flowChartTerminator': {
      const r = h / 2;
      return one(`M${f(r)},0H${f(w - r)}A${f(r)},${f(r)} 0 0 1 ${f(w - r)},${f(h)}H${f(r)}A${f(r)},${f(r)} 0 0 1 ${f(r)},0Z`, [w * 0.1, h * 0.15, w * 0.9, h * 0.85]);
    }
    case 'flowChartDocument':
      return one(`M0,0H${f(w)}V${f(h * 0.82)}C${f(w * 0.75)},${f(h * 0.7)} ${f(w * 0.75)},${f(h * 0.95)} ${f(w * 0.5)},${f(h * 0.88)}C${f(w * 0.25)},${f(h * 0.8)} ${f(w * 0.25)},${f(h * 1.02)} 0,${f(h * 0.9)}Z`, [0, 0, w, h * 0.8]);
    case 'flowChartManualInput':
      return one(poly([[0, h / 5], [w, 0], [w, h], [0, h]]), [0, h / 5, w, h]);
    case 'flowChartOffpageConnector':
      return one(poly([[0, 0], [w, 0], [w, h * 0.8], [hc, h], [0, h * 0.8]]), [0, 0, w, h * 0.8]);
    case 'flowChartDelay':
      return one(`M0,0H${f(hc)}A${f(hc)},${f(vc)} 0 0 1 ${f(hc)},${f(h)}H0Z`, [0, h * 0.15, w * 0.85, h * 0.85]);
    case 'flowChartSort':
      return {
        paths: [
          { d: poly([[hc, 0], [w, vc], [hc, h], [0, vc]]), fill: 'norm', stroke: true },
          { d: `M0,${f(vc)}H${f(w)}`, fill: 'none', stroke: true },
        ],
        text: [w / 4, h / 4, (w * 3) / 4, (h * 3) / 4],
      };

    // ---- brackets ----
    case 'leftBracket': {
      const r = Math.min((ss * a('adj', 8333)) / 100000, w);
      const d = `M${f(w)},0A${f(r)},${f(r)} 0 0 0 0,${f(r)}V${f(h - r)}A${f(r)},${f(r)} 0 0 0 ${f(w)},${f(h)}`;
      return { paths: [{ d: d + 'Z', fill: 'norm', stroke: false }, { d, fill: 'none', stroke: true }], text: [r / 3, r / 3, w, h - r / 3], open: true };
    }
    case 'rightBracket': {
      const r = Math.min((ss * a('adj', 8333)) / 100000, w);
      const d = `M0,0A${f(r)},${f(r)} 0 0 1 ${f(w)},${f(r)}V${f(h - r)}A${f(r)},${f(r)} 0 0 1 0,${f(h)}`;
      return { paths: [{ d: d + 'Z', fill: 'norm', stroke: false }, { d, fill: 'none', stroke: true }], text: [0, r / 3, w - r / 3, h - r / 3], open: true };
    }
    case 'bracketPair': {
      const r = Math.min((ss * a('adj', 16667)) / 100000, ss / 2);
      const d = `M${f(r)},0H${f(w - r)}A${f(r)},${f(r)} 0 0 1 ${f(w)},${f(r)}V${f(h - r)}A${f(r)},${f(r)} 0 0 1 ${f(w - r)},${f(h)}H${f(r)}A${f(r)},${f(r)} 0 0 1 0,${f(h - r)}V${f(r)}A${f(r)},${f(r)} 0 0 1 ${f(r)},0Z`;
      return { paths: [{ d, fill: 'norm', stroke: false }, { d: `M${f(w * 0.08)},0Q0,0 0,${f(r)}V${f(h - r)}Q0,${f(h)} ${f(w * 0.08)},${f(h)}M${f(w * 0.92)},0Q${f(w)},0 ${f(w)},${f(r)}V${f(h - r)}Q${f(w)},${f(h)} ${f(w * 0.92)},${f(h)}`, fill: 'none', stroke: true }], text: [r * 0.29, r * 0.29, w - r * 0.29, h - r * 0.29] };
    }
    case 'leftBrace':
    case 'rightBrace': {
      const r = Math.min((ss * a('adj1', 8333)) / 100000, h / 4);
      const ym = (h * a('adj2', 50000)) / 100000;
      const rx = w / 2;
      const left = prst === 'leftBrace';
      const X = (x: number) => (left ? x : w - x);
      const sw = left ? 0 : 1;
      const d = `M${f(X(w))},0A${f(rx)},${f(r)} 0 0 ${sw} ${f(X(w / 2))},${f(r)}V${f(ym - r)}A${f(rx)},${f(r)} 0 0 ${1 - sw} ${f(X(0))},${f(ym)}A${f(rx)},${f(r)} 0 0 ${1 - sw} ${f(X(w / 2))},${f(ym + r)}V${f(h - r)}A${f(rx)},${f(r)} 0 0 ${sw} ${f(X(w))},${f(h)}`;
      return { paths: [{ d: d + 'Z', fill: 'norm', stroke: false }, { d, fill: 'none', stroke: true }], text: [left ? w / 4 : 0, r / 3, left ? w : (w * 3) / 4, h - r / 3], open: true };
    }
    case 'bracePair': {
      return presetGeometry('bracketPair', w, h, adj);
    }

    // ---- arcs ----
    case 'arc': {
      const st = a('adj1', 16200000) / 60000;
      const en = a('adj2', 0) / 60000;
      let sweep = en - st;
      if (sweep <= 0) sweep += 360;
      const [sx, sy] = ptOnEllipse(hc, vc, hc, vc, st);
      const d = `M${f(sx)},${f(sy)}${arcTo(hc, vc, hc, vc, en, sweep)}`;
      return { paths: [{ d: `${d}L${f(hc)},${f(vc)}Z`, fill: 'norm', stroke: false }, { d, fill: 'none', stroke: true }], text: full(w, h), open: true };
    }
    case 'pie': {
      const st = a('adj1', 0) / 60000;
      const en = a('adj2', 16200000) / 60000;
      let sweep = en - st;
      if (sweep <= 0) sweep += 360;
      const [sx, sy] = ptOnEllipse(hc, vc, hc, vc, st);
      return one(`M${f(hc)},${f(vc)}L${f(sx)},${f(sy)}${arcTo(hc, vc, hc, vc, en, sweep)}Z`, [w * 0.146, h * 0.146, w * 0.854, h * 0.854]);
    }
    case 'chord': {
      const st = a('adj1', 2700000) / 60000;
      const en = a('adj2', 16200000) / 60000;
      let sweep = en - st;
      if (sweep <= 0) sweep += 360;
      const [sx, sy] = ptOnEllipse(hc, vc, hc, vc, st);
      return one(`M${f(sx)},${f(sy)}${arcTo(hc, vc, hc, vc, en, sweep)}Z`, [w * 0.146, h * 0.146, w * 0.854, h * 0.854]);
    }
    case 'blockArc': {
      const st = a('adj1', 10800000) / 60000;
      const en = a('adj2', 0) / 60000;
      const t = (ss * Math.min(a('adj3', 25000), 50000)) / 100000;
      let sweep = en - st;
      if (sweep <= 0) sweep += 360;
      const irx = Math.max(0.1, hc - t);
      const iry = Math.max(0.1, vc - t);
      const [sx, sy] = ptOnEllipse(hc, vc, hc, vc, st);
      const [ex, ey] = ptOnEllipse(hc, vc, irx, iry, en);
      void ex;
      void ey;
      const d = `M${f(sx)},${f(sy)}${arcTo(hc, vc, hc, vc, en, sweep)}L${f(ptOnEllipse(hc, vc, irx, iry, en)[0])},${f(ptOnEllipse(hc, vc, irx, iry, en)[1])}${arcTo(hc, vc, irx, iry, st, -sweep)}Z`;
      return one(d, full(w, h));
    }
    case 'teardrop': {
      const k = Math.min(Math.max(a('adj', 100000), 0), 200000) / 100000;
      const px = Math.min(hc + hc * k, w);
      const py = Math.max(vc - vc * k, 0);
      return one(`M${f(hc)},0L${f(px)},${f(py)}L${f(w)},${f(vc)}A${f(hc)},${f(vc)} 0 1 1 ${f(hc)},0Z`, [w * 0.146, h * 0.146, w * 0.854, h * 0.854]);
    }

    // ---- math ----
    case 'mathPlus': {
      const t = (ss * Math.min(a('adj1', 23520), 73490)) / 200000;
      const [x0, x1, y0, y1] = [w * 0.1, w * 0.9, h * 0.1, h * 0.9];
      return one(poly([[hc - t, y0], [hc + t, y0], [hc + t, vc - t], [x1, vc - t], [x1, vc + t], [hc + t, vc + t], [hc + t, y1], [hc - t, y1], [hc - t, vc + t], [x0, vc + t], [x0, vc - t], [hc - t, vc - t]]), full(w, h));
    }
    case 'mathMinus': {
      const t = (h * Math.min(a('adj1', 23520), 100000)) / 200000;
      return one(poly([[w * 0.1, vc - t], [w * 0.9, vc - t], [w * 0.9, vc + t], [w * 0.1, vc + t]]), full(w, h));
    }
    case 'mathEqual': {
      const t = (h * Math.min(a('adj1', 23520), 36745)) / 100000;
      const gap = (h * a('adj2', 11760)) / 200000;
      const y1 = vc - gap - t;
      return one(poly([[w * 0.1, y1], [w * 0.9, y1], [w * 0.9, vc - gap], [w * 0.1, vc - gap]]) + poly([[w * 0.1, vc + gap], [w * 0.9, vc + gap], [w * 0.9, vc + gap + t], [w * 0.1, vc + gap + t]]), full(w, h));
    }
    case 'mathMultiply': {
      const t = Math.min(a('adj1', 23520), 51960) / 100000;
      const plus: [number, number][] = [[-t, -1], [t, -1], [t, -t], [1, -t], [1, t], [t, t], [t, 1], [-t, 1], [-t, t], [-1, t], [-1, -t], [-t, -t]];
      const c = Math.SQRT1_2;
      const rot = plus.map(([x, y]): [number, number] => [x * c - y * c, x * c + y * c]);
      return one(poly(fitPoints(rot, w * 0.9, h * 0.9).map(([x, y]): [number, number] => [x + w * 0.05, y + h * 0.05])), full(w, h));
    }
    case 'mathDivide': {
      const t = (h * Math.min(a('adj1', 23520), 36745)) / 200000;
      const r = (ss * a('adj3', 5880)) / 100000 + 0.1;
      return one(poly([[w * 0.1, vc - t], [w * 0.9, vc - t], [w * 0.9, vc + t], [w * 0.1, vc + t]]) + ellipsePath(hc, vc - t - r * 1.6, r, r) + ellipsePath(hc, vc + t + r * 1.6, r, r), full(w, h));
    }
    case 'wave':
    case 'doubleWave': {
      const dy = (h * Math.min(a('adj1', 12500), 20000)) / 100000;
      const d = `M0,${f(dy)}C${f(w * 0.2)},0 ${f(w * 0.3)},0 ${f(w * 0.5)},${f(dy)}C${f(w * 0.7)},${f(2 * dy)} ${f(w * 0.8)},${f(2 * dy)} ${f(w)},${f(dy)}V${f(h - dy)}C${f(w * 0.8)},${f(h)} ${f(w * 0.7)},${f(h)} ${f(w * 0.5)},${f(h - dy)}C${f(w * 0.3)},${f(h - 2 * dy)} ${f(w * 0.2)},${f(h - 2 * dy)} 0,${f(h - dy)}Z`;
      return one(d, [w * 0.1, dy * 2, w * 0.9, h - dy * 2]);
    }
    case 'plaque': {
      const r = (ss * Math.min(a('adj', 16667), 50000)) / 100000;
      return one(`M${f(r)},0H${f(w - r)}A${f(r)},${f(r)} 0 0 0 ${f(w)},${f(r)}V${f(h - r)}A${f(r)},${f(r)} 0 0 0 ${f(w - r)},${f(h)}H${f(r)}A${f(r)},${f(r)} 0 0 0 0,${f(h - r)}V${f(r)}A${f(r)},${f(r)} 0 0 0 ${f(r)},0Z`, [r * 0.7, r * 0.7, w - r * 0.7, h - r * 0.7]);
    }

    // ---- lines & connectors ----
    case 'line':
    case 'lineInv':
    case 'straightConnector1':
      return { paths: [{ d: prst === 'lineInv' ? `M0,${f(h)}L${f(w)},0` : `M0,0L${f(w)},${f(h)}`, fill: 'none', stroke: true }], text: full(w, h), open: true };
    case 'bentConnector2':
      return { paths: [{ d: `M0,0H${f(w)}V${f(h)}`, fill: 'none', stroke: true }], text: full(w, h), open: true };
    case 'bentConnector3': {
      const x1 = (w * a('adj1', 50000)) / 100000;
      return { paths: [{ d: `M0,0H${f(x1)}V${f(h)}H${f(w)}`, fill: 'none', stroke: true }], text: full(w, h), open: true };
    }
    case 'bentConnector4':
    case 'bentConnector5': {
      const x1 = (w * a('adj1', 50000)) / 100000;
      const y2 = (h * a('adj2', 50000)) / 100000;
      return { paths: [{ d: `M0,0H${f(x1)}V${f(y2)}H${f(w)}V${f(h)}`, fill: 'none', stroke: true }], text: full(w, h), open: true };
    }
    case 'curvedConnector2':
      return { paths: [{ d: `M0,0C${f(w / 2)},0 ${f(w)},${f(h / 2)} ${f(w)},${f(h)}`, fill: 'none', stroke: true }], text: full(w, h), open: true };
    case 'curvedConnector3':
    case 'curvedConnector4':
    case 'curvedConnector5': {
      const x1 = (w * a('adj1', 50000)) / 100000;
      return { paths: [{ d: `M0,0C${f(x1 / 2)},0 ${f(x1)},${f(h / 4)} ${f(x1)},${f(h / 2)}C${f(x1)},${f((h * 3) / 4)} ${f((x1 + w) / 2)},${f(h)} ${f(w)},${f(h)}`, fill: 'none', stroke: true }], text: full(w, h), open: true };
    }
    default:
      return one(`M0,0H${f(w)}V${f(h)}H0Z`, full(w, h));
  }
}

/** Geometry for any shape or picture: a preset, or custom paths scaled into the box. */
export function geometryOf(geom: Geom | undefined, w: number, h: number): ShapeGeometry {
  if (!geom) return presetGeometry('rect', w, h);
  if ('cust' in geom) {
    const paths: ShapePath[] = geom.cust.map((p) => ({ d: scalePath(p, w, h), fill: p.fill === false ? 'none' : 'norm', stroke: p.stroke !== false }));
    return { paths, text: full(w, h), open: paths.every((p) => p.fill === 'none') };
  }
  return presetGeometry(geom.prst, w, h, geom.adj);
}

/** Scale an SVG path from its own (w x h) space to the target size. Only absolute commands are produced by our importer. */
export function scalePath(p: CustPath, w: number, h: number): string {
  const sx = p.w ? w / p.w : 1;
  const sy = p.h ? h / p.h : 1;
  return p.d.replace(/([MLCQAZ])([^MLCQAZ]*)/gi, (_m, cmd: string, args: string) => {
    const nums = args.trim().length ? args.trim().split(/[\s,]+/).map(Number) : [];
    if (/z/i.test(cmd)) return 'Z';
    if (/a/i.test(cmd)) {
      const out: number[] = [];
      for (let i = 0; i < nums.length; i += 7) out.push(nums[i] * sx, nums[i + 1] * sy, nums[i + 2], nums[i + 3], nums[i + 4], nums[i + 5] * sx, nums[i + 6] * sy);
      return cmd + out.map(f).join(' ');
    }
    return cmd + nums.map((n, i) => f(n * (i % 2 === 0 ? sx : sy))).join(' ');
  });
}

export const LINE_PRESETS = new Set(['line', 'lineInv', 'straightConnector1', 'bentConnector2', 'bentConnector3', 'bentConnector4', 'bentConnector5', 'curvedConnector2', 'curvedConnector3', 'curvedConnector4', 'curvedConnector5']);

export interface ShapeInfo {
  id: string;
  label: string;
}
export const SHAPE_GALLERY: { group: string; items: ShapeInfo[] }[] = [
  {
    group: 'Lines',
    items: [
      { id: 'line', label: 'Line' },
      { id: 'straightConnector1', label: 'Arrow' },
      { id: 'bentConnector3', label: 'Elbow Connector' },
      { id: 'curvedConnector3', label: 'Curved Connector' },
    ],
  },
  {
    group: 'Basic Shapes',
    items: [
      { id: 'rect', label: 'Rectangle' },
      { id: 'roundRect', label: 'Rounded Rectangle' },
      { id: 'snip1Rect', label: 'Snip Single Corner Rectangle' },
      { id: 'round2SameRect', label: 'Round Same Side Corner Rectangle' },
      { id: 'ellipse', label: 'Oval' },
      { id: 'triangle', label: 'Isosceles Triangle' },
      { id: 'rtTriangle', label: 'Right Triangle' },
      { id: 'parallelogram', label: 'Parallelogram' },
      { id: 'trapezoid', label: 'Trapezoid' },
      { id: 'diamond', label: 'Diamond' },
      { id: 'pentagon', label: 'Regular Pentagon' },
      { id: 'hexagon', label: 'Hexagon' },
      { id: 'heptagon', label: 'Heptagon' },
      { id: 'octagon', label: 'Octagon' },
      { id: 'decagon', label: 'Decagon' },
      { id: 'dodecagon', label: 'Dodecagon' },
      { id: 'pie', label: 'Partial Circle' },
      { id: 'chord', label: 'Chord' },
      { id: 'teardrop', label: 'Teardrop' },
      { id: 'frame', label: 'Frame' },
      { id: 'plus', label: 'Cross' },
      { id: 'plaque', label: 'Plaque' },
      { id: 'can', label: 'Cylinder' },
      { id: 'cube', label: 'Cube' },
      { id: 'bevel', label: 'Bevel' },
      { id: 'donut', label: 'Donut' },
      { id: 'noSmoking', label: 'No Symbol' },
      { id: 'blockArc', label: 'Block Arc' },
      { id: 'foldedCorner', label: 'Folded Corner' },
      { id: 'smileyFace', label: 'Smiley Face' },
      { id: 'heart', label: 'Heart' },
      { id: 'lightningBolt', label: 'Lightning Bolt' },
      { id: 'sun', label: 'Sun' },
      { id: 'moon', label: 'Moon' },
      { id: 'cloud', label: 'Cloud' },
      { id: 'arc', label: 'Arc' },
      { id: 'bracketPair', label: 'Double Bracket' },
      { id: 'leftBracket', label: 'Left Bracket' },
      { id: 'rightBracket', label: 'Right Bracket' },
      { id: 'leftBrace', label: 'Left Brace' },
      { id: 'rightBrace', label: 'Right Brace' },
    ],
  },
  {
    group: 'Block Arrows',
    items: [
      { id: 'rightArrow', label: 'Arrow: Right' },
      { id: 'leftArrow', label: 'Arrow: Left' },
      { id: 'upArrow', label: 'Arrow: Up' },
      { id: 'downArrow', label: 'Arrow: Down' },
      { id: 'leftRightArrow', label: 'Arrow: Left-Right' },
      { id: 'upDownArrow', label: 'Arrow: Up-Down' },
      { id: 'bentArrow', label: 'Arrow: Bent' },
      { id: 'notchedRightArrow', label: 'Arrow: Notched Right' },
      { id: 'homePlate', label: 'Arrow: Pentagon' },
      { id: 'chevron', label: 'Arrow: Chevron' },
    ],
  },
  {
    group: 'Equation Shapes',
    items: [
      { id: 'mathPlus', label: 'Plus' },
      { id: 'mathMinus', label: 'Minus' },
      { id: 'mathMultiply', label: 'Multiply' },
      { id: 'mathDivide', label: 'Divide' },
      { id: 'mathEqual', label: 'Equal' },
    ],
  },
  {
    group: 'Flowchart',
    items: [
      { id: 'flowChartProcess', label: 'Flowchart: Process' },
      { id: 'flowChartAlternateProcess', label: 'Flowchart: Alternate Process' },
      { id: 'flowChartDecision', label: 'Flowchart: Decision' },
      { id: 'flowChartInputOutput', label: 'Flowchart: Data' },
      { id: 'flowChartPredefinedProcess', label: 'Flowchart: Predefined Process' },
      { id: 'flowChartDocument', label: 'Flowchart: Document' },
      { id: 'flowChartTerminator', label: 'Flowchart: Terminator' },
      { id: 'flowChartPreparation', label: 'Flowchart: Preparation' },
      { id: 'flowChartManualInput', label: 'Flowchart: Manual Input' },
      { id: 'flowChartConnector', label: 'Flowchart: Connector' },
      { id: 'flowChartOffpageConnector', label: 'Flowchart: Off-page Connector' },
      { id: 'flowChartMagneticDisk', label: 'Flowchart: Stored Data' },
      { id: 'flowChartSort', label: 'Flowchart: Sort' },
      { id: 'flowChartDelay', label: 'Flowchart: Delay' },
    ],
  },
  {
    group: 'Stars and Banners',
    items: [
      { id: 'star4', label: 'Star: 4 Points' },
      { id: 'star5', label: 'Star: 5 Points' },
      { id: 'star6', label: 'Star: 6 Points' },
      { id: 'star7', label: 'Star: 7 Points' },
      { id: 'star8', label: 'Star: 8 Points' },
      { id: 'star10', label: 'Star: 10 Points' },
      { id: 'star12', label: 'Star: 12 Points' },
      { id: 'star16', label: 'Star: 16 Points' },
      { id: 'star24', label: 'Star: 24 Points' },
      { id: 'star32', label: 'Star: 32 Points' },
      { id: 'wave', label: 'Wave' },
    ],
  },
  {
    group: 'Callouts',
    items: [
      { id: 'wedgeRectCallout', label: 'Speech Bubble: Rectangle' },
      { id: 'wedgeRoundRectCallout', label: 'Speech Bubble: Rectangle with Corners Rounded' },
      { id: 'wedgeEllipseCallout', label: 'Speech Bubble: Oval' },
    ],
  },
];
