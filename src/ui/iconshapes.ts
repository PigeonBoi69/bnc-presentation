// Turns Lucide icons into editable vector shapes (the "Icons" gallery on the Insert tab).
import { icons } from 'lucide';

type IconNode = [string, Record<string, string>][];

const num = (v: string | undefined, d = 0) => (v === undefined ? d : parseFloat(v));
const f = (n: number) => Math.round(n * 100) / 100;

/** Convert any SVG path data to absolute M / L / C / Q / A / Z commands. */
export function normalizePath(d: string): string {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let cmd = '';
  let lastC: [number, number] | null = null;
  let lastQ: [number, number] | null = null;
  const out: string[] = [];
  const next = () => parseFloat(tokens[i++]);
  const isCmd = (t: string | undefined) => !!t && /[a-zA-Z]/.test(t);
  while (i < tokens.length) {
    if (isCmd(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const up = cmd.toUpperCase();
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;
    switch (up) {
      case 'M': {
        const x = next() + ox;
        const y = next() + oy;
        out.push(`M${f(x)},${f(y)}`);
        cx = sx = x;
        cy = sy = y;
        cmd = rel ? 'l' : 'L';
        lastC = lastQ = null;
        break;
      }
      case 'L': {
        const x = next() + ox;
        const y = next() + oy;
        out.push(`L${f(x)},${f(y)}`);
        cx = x;
        cy = y;
        lastC = lastQ = null;
        break;
      }
      case 'H': {
        const x = next() + ox;
        out.push(`L${f(x)},${f(cy)}`);
        cx = x;
        lastC = lastQ = null;
        break;
      }
      case 'V': {
        const y = next() + oy;
        out.push(`L${f(cx)},${f(y)}`);
        cy = y;
        lastC = lastQ = null;
        break;
      }
      case 'C': {
        const [x1, y1, x2, y2, x, y] = [next() + ox, next() + oy, next() + ox, next() + oy, next() + ox, next() + oy];
        out.push(`C${f(x1)},${f(y1)} ${f(x2)},${f(y2)} ${f(x)},${f(y)}`);
        lastC = [x2, y2];
        lastQ = null;
        cx = x;
        cy = y;
        break;
      }
      case 'S': {
        const [x2, y2, x, y] = [next() + ox, next() + oy, next() + ox, next() + oy];
        const x1 = lastC ? 2 * cx - lastC[0] : cx;
        const y1 = lastC ? 2 * cy - lastC[1] : cy;
        out.push(`C${f(x1)},${f(y1)} ${f(x2)},${f(y2)} ${f(x)},${f(y)}`);
        lastC = [x2, y2];
        lastQ = null;
        cx = x;
        cy = y;
        break;
      }
      case 'Q': {
        const [x1, y1, x, y] = [next() + ox, next() + oy, next() + ox, next() + oy];
        out.push(`Q${f(x1)},${f(y1)} ${f(x)},${f(y)}`);
        lastQ = [x1, y1];
        lastC = null;
        cx = x;
        cy = y;
        break;
      }
      case 'T': {
        const [x, y] = [next() + ox, next() + oy];
        const x1: number = lastQ ? 2 * cx - lastQ[0] : cx;
        const y1: number = lastQ ? 2 * cy - lastQ[1] : cy;
        out.push(`Q${f(x1)},${f(y1)} ${f(x)},${f(y)}`);
        lastQ = [x1, y1];
        lastC = null;
        cx = x;
        cy = y;
        break;
      }
      case 'A': {
        const [rx, ry, rot, large, sweep, x, y] = [next(), next(), next(), next(), next(), next() + ox, next() + oy];
        out.push(`A${f(rx)},${f(ry)} ${f(rot)} ${large ? 1 : 0} ${sweep ? 1 : 0} ${f(x)},${f(y)}`);
        cx = x;
        cy = y;
        lastC = lastQ = null;
        break;
      }
      case 'Z':
        out.push('Z');
        cx = sx;
        cy = sy;
        lastC = lastQ = null;
        break;
      default:
        i++;
    }
  }
  return out.join('');
}

function nodeToPath(tag: string, a: Record<string, string>): string {
  switch (tag) {
    case 'path':
      return normalizePath(a.d ?? '');
    case 'line':
      return `M${f(num(a.x1))},${f(num(a.y1))}L${f(num(a.x2))},${f(num(a.y2))}`;
    case 'polyline':
    case 'polygon': {
      const pts = (a.points ?? '').trim().split(/[\s,]+/).map(Number);
      let d = '';
      for (let i = 0; i + 1 < pts.length; i += 2) d += `${i === 0 ? 'M' : 'L'}${f(pts[i])},${f(pts[i + 1])}`;
      return d + (tag === 'polygon' ? 'Z' : '');
    }
    case 'circle': {
      const [cx, cy, r] = [num(a.cx), num(a.cy), num(a.r)];
      return `M${f(cx - r)},${f(cy)}A${f(r)},${f(r)} 0 1 1 ${f(cx + r)},${f(cy)}A${f(r)},${f(r)} 0 1 1 ${f(cx - r)},${f(cy)}Z`;
    }
    case 'ellipse': {
      const [cx, cy, rx, ry] = [num(a.cx), num(a.cy), num(a.rx), num(a.ry)];
      return `M${f(cx - rx)},${f(cy)}A${f(rx)},${f(ry)} 0 1 1 ${f(cx + rx)},${f(cy)}A${f(rx)},${f(ry)} 0 1 1 ${f(cx - rx)},${f(cy)}Z`;
    }
    case 'rect': {
      const [x, y, w, h] = [num(a.x), num(a.y), num(a.width), num(a.height)];
      const r = Math.min(num(a.rx, num(a.ry)), w / 2, h / 2);
      if (!r) return `M${f(x)},${f(y)}L${f(x + w)},${f(y)}L${f(x + w)},${f(y + h)}L${f(x)},${f(y + h)}Z`;
      return `M${f(x + r)},${f(y)}L${f(x + w - r)},${f(y)}A${f(r)},${f(r)} 0 0 1 ${f(x + w)},${f(y + r)}L${f(x + w)},${f(y + h - r)}A${f(r)},${f(r)} 0 0 1 ${f(x + w - r)},${f(y + h)}L${f(x + r)},${f(y + h)}A${f(r)},${f(r)} 0 0 1 ${f(x)},${f(y + h - r)}L${f(x)},${f(y + r)}A${f(r)},${f(r)} 0 0 1 ${f(x + r)},${f(y)}Z`;
    }
  }
  return '';
}

export function iconNames(): string[] {
  return Object.keys(icons).sort();
}

/** One path per icon element, all in the icon's 24 x 24 space. */
export function iconPaths(name: string): string[] {
  const node = (icons as unknown as Record<string, IconNode>)[name];
  if (!node) return [];
  return node.map(([tag, attrs]) => nodeToPath(tag, attrs)).filter(Boolean);
}

export const prettyName = (n: string) => n.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
