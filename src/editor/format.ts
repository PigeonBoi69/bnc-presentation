// Applying text formatting from the ribbon: to the live text selection when editing, otherwise to all text
// in the selected shapes / table cells.
import type { App } from '../app';
import type { Bullet, Para, RunProps, TextBody } from '../core/model';
import { effRun } from '../core/text';
import type { ParaPatch } from './textedit';
import { FONT_SIZES } from '../ui/pickers';

/** The text bodies a formatting command applies to when not editing text. */
export function textTargets(app: App): TextBody[] {
  const out: TextBody[] = [];
  for (const el of app.selectedEls()) {
    if (el.type === 'shape' && el.text) out.push(el.text);
    else if (el.type === 'shape' && !el.text) {
      el.text = app.defaultShapeText(el);
      out.push(el.text);
    } else if (el.type === 'table') {
      const cs = app.cellSel && app.cellSel.id === el.id ? app.cellSel : null;
      const r0 = cs ? Math.min(cs.r0, cs.r1) : 0;
      const r1 = cs ? Math.max(cs.r0, cs.r1) : el.rows.length - 1;
      const c0 = cs ? Math.min(cs.c0, cs.c1) : 0;
      const c1 = cs ? Math.max(cs.c0, cs.c1) : el.cols.length - 1;
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (el.rows[r]?.cells[c]) out.push(el.rows[r].cells[c].text);
    } else if (el.type === 'group') {
      const walk = (list: typeof el.children) => {
        for (const k of list) {
          if (k.type === 'shape' && k.text) out.push(k.text);
          else if (k.type === 'group') walk(k.children);
        }
      };
      walk(el.children);
    }
  }
  return out;
}

export function applyRun(app: App, patch: RunProps, label = 'Format text') {
  const te = app.canvas.textEditor;
  if (te) {
    te.setRunProps(patch);
    return;
  }
  const bodies = textTargets(app);
  if (!bodies.length) return;
  app.mutate(label, () => {
    for (const tb of bodies) {
      const lst = (tb.lst ??= []);
      for (let i = 0; i < 9; i++) {
        lst[i] ??= {};
        assign(lst[i], patch);
      }
      for (const p of tb.paras) {
        for (const r of p.runs) assign(r, patch);
        if (p.end) assign(p.end, patch);
      }
    }
  });
}

function assign(target: object, patch: object) {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete (target as any)[k];
    else (target as any)[k] = v;
  }
}

export function applyPara(app: App, patch: ParaPatch, label = 'Format paragraph') {
  const te = app.canvas.textEditor;
  if (te) {
    te.setParaProps(patch);
    return;
  }
  const bodies = textTargets(app);
  if (!bodies.length) return;
  app.mutate(label, () => {
    for (const tb of bodies) for (const p of tb.paras) assign(p, patch);
  });
}

/** What the ribbon should show for the current selection. */
export function currentRun(app: App): RunProps {
  const te = app.canvas.textEditor;
  if (te) return te.runProps();
  const bodies = textTargets(app);
  if (!bodies.length) return {};
  const tb = bodies[0];
  const p = tb.paras[0] ?? { runs: [] };
  const first = p.runs.find((r) => !r.br && r.t) ?? p.runs[0];
  const eff = effRun(tb, p, first);
  // a mixed selection reports the first run's look, like PowerPoint's ribbon does
  return eff;
}

export function currentPara(app: App): Para {
  const te = app.canvas.textEditor;
  if (te) return te.paraProps();
  const tb = textTargets(app)[0];
  return tb?.paras[0] ?? { runs: [] };
}

export function currentBody(app: App): TextBody | undefined {
  const te = app.canvas.textEditor;
  if (te) return te.body();
  return textTargets(app)[0];
}

export function effectiveAlign(app: App): 'l' | 'ctr' | 'r' | 'just' {
  const p = currentPara(app);
  const tb = currentBody(app);
  return p.algn ?? tb?.lst?.[p.level ?? 0]?.algn ?? 'l';
}

export function effectiveBullet(app: App): Bullet | undefined {
  const p = currentPara(app);
  const tb = currentBody(app);
  return p.bu ?? tb?.lst?.[p.level ?? 0]?.bu;
}

export function toggleBullet(app: App) {
  const cur = effectiveBullet(app);
  const on = !!cur && cur.t === 'char';
  applyPara(app, on ? { bu: { t: 'none' } } : { bu: { t: 'char', ch: '•', font: 'Arial' }, ...bulletIndent(app) }, 'Bullets');
}

function bulletIndent(app: App) {
  const p = currentPara(app);
  const tb = currentBody(app);
  const lv = tb?.lst?.[p.level ?? 0];
  // a paragraph that gains a bullet needs a hanging indent
  if ((p.marL ?? lv?.marL ?? 0) === 0 && (p.indent ?? lv?.indent ?? 0) === 0) return { marL: 18 + (p.level ?? 0) * 36, indent: -18 };
  return {};
}

export function setNumbering(app: App, scheme: string | null) {
  const cur = effectiveBullet(app);
  if (scheme === null || (cur && cur.t === 'num' && cur.scheme === scheme)) return applyPara(app, { bu: { t: 'none' } }, 'Numbering');
  applyPara(app, { bu: { t: 'num', scheme }, ...bulletIndent(app) }, 'Numbering');
}

export function setBulletChar(app: App, ch: string | null) {
  if (ch === null) return applyPara(app, { bu: { t: 'none' } }, 'Bullets');
  applyPara(app, { bu: { t: 'char', ch, font: ch === '•' ? 'Arial' : undefined }, ...bulletIndent(app) }, 'Bullets');
}

export function changeIndent(app: App, delta: number) {
  const te = app.canvas.textEditor;
  if (te) return te.changeLevel(delta);
  const bodies = textTargets(app);
  if (!bodies.length) return;
  app.mutate(delta > 0 ? 'Increase indent' : 'Decrease indent', () => {
    for (const tb of bodies) for (const p of tb.paras) {
      p.level = Math.max(0, Math.min(8, (p.level ?? 0) + delta)) || undefined;
      delete p.marL;
      delete p.indent;
    }
  });
}

export function stepFontSize(app: App, dir: 1 | -1) {
  const cur = currentRun(app).sz ?? 18;
  let next: number;
  if (dir > 0) next = FONT_SIZES.find((s) => s > cur + 0.01) ?? Math.round(cur + 8);
  else next = [...FONT_SIZES].reverse().find((s) => s < cur - 0.01) ?? Math.max(1, Math.round(cur - 2));
  applyRun(app, { sz: next });
}

export function setCase(app: App, mode: 'upper' | 'lower' | 'title' | 'sentence' | 'toggle') {
  const conv = (s: string) => {
    if (mode === 'upper') return s.toUpperCase();
    if (mode === 'lower') return s.toLowerCase();
    if (mode === 'title') return s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
    if (mode === 'sentence') return s.toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());
    return [...s].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('');
  };
  const te = app.canvas.textEditor;
  if (te) {
    const { from, to, empty } = te.view.state.selection;
    if (empty) return;
    const text = te.view.state.doc.textBetween(from, to, '\n');
    const out = conv(text);
    if (out === text) return;
    let tr = te.view.state.tr;
    te.view.state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isText) return true;
      const s = Math.max(from, pos);
      const e = Math.min(to, pos + node.nodeSize);
      const part = node.text!.slice(s - pos, e - pos);
      tr = tr.replaceWith(tr.mapping.map(s), tr.mapping.map(e), te.schema.text(conv(part), node.marks));
      return false;
    });
    te.view.dispatch(tr);
    return;
  }
  const bodies = textTargets(app);
  if (!bodies.length) return;
  app.mutate('Change case', () => {
    for (const tb of bodies) for (const p of tb.paras) for (const r of p.runs) if (!r.br && r.t) r.t = conv(r.t);
  });
}

export function clearFormatting(app: App) {
  const te = app.canvas.textEditor;
  if (te) {
    te.setRunProps({ b: undefined, i: undefined, u: undefined, strike: undefined, sz: undefined, color: undefined, font: undefined, hl: undefined, base: undefined, cap: undefined, spc: undefined });
    return;
  }
  const bodies = textTargets(app);
  if (!bodies.length) return;
  app.mutate('Clear formatting', () => {
    for (const tb of bodies) for (const p of tb.paras) {
      for (const r of p.runs) {
        for (const k of ['b', 'i', 'u', 'strike', 'sz', 'color', 'font', 'hl', 'base', 'cap', 'spc'] as const) delete r[k];
      }
      p.end = undefined;
    }
  });
}
