// Find & replace across all slides (shape text, table cells and notes).
import type { App } from '../app';
import { allElements, type Para, type TextBody } from '../core/model';
import { h, iconEl } from './dom';

interface Hit {
  slide: number;
  elId: string;
  body: TextBody;
  para: Para;
  run: number;
  index: number;
  length: number;
}

export class FindBar {
  el: HTMLElement;
  private find: HTMLInputElement;
  private repl: HTMLInputElement;
  private count: HTMLElement;
  private caseBox: HTMLInputElement;
  private hits: Hit[] = [];
  private at = -1;

  constructor(private app: App, host: HTMLElement) {
    this.find = h('input', { attrs: { type: 'text', placeholder: 'Find', 'aria-label': 'Find' } });
    this.repl = h('input', { attrs: { type: 'text', placeholder: 'Replace with', 'aria-label': 'Replace' } });
    this.count = h('span', { class: 'count', text: '' });
    this.caseBox = h('input', { attrs: { type: 'checkbox' } });
    const btn = (icon: Parameters<typeof iconEl>[0], title: string, fn: () => void) => h('button', { class: 'icon-btn', title, on: { click: fn } }, iconEl(icon, 15));
    this.el = h('div', { class: 'findbar' },
      h('div', { class: 'row' }, this.find, this.count, btn('chevronUp', 'Previous (Shift+Enter)', () => this.step(-1)), btn('chevronRight', 'Next (Enter)', () => this.step(1)), btn('close', 'Close (Esc)', () => this.close())),
      h('div', { class: 'row' }, this.repl, h('button', { class: 'btn small', text: 'Replace', on: { click: () => this.replaceOne() } }), h('button', { class: 'btn small', text: 'All', on: { click: () => this.replaceAll() } })),
      h('label', null, this.caseBox, 'Match case'),
    );
    host.append(this.el);
    this.find.addEventListener('input', () => this.search(true));
    this.caseBox.addEventListener('change', () => this.search(true));
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (document.activeElement === this.repl) this.replaceOne();
        else this.step(e.shiftKey ? -1 : 1);
      }
    });
  }

  open(replace = false) {
    this.el.classList.add('open');
    this.el.classList.toggle('with-replace', replace);
    const te = this.app.canvas.textEditor;
    if (te && !te.view.state.selection.empty) this.find.value = te.selectionText();
    (replace ? this.repl : this.find).focus();
    this.find.select();
    this.search(false);
  }

  close() {
    this.el.classList.remove('open');
  }

  private matcher(): RegExp | null {
    const q = this.find.value;
    if (!q) return null;
    return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), this.caseBox.checked ? 'g' : 'gi');
  }

  private search(jump: boolean) {
    const re = this.matcher();
    this.hits = [];
    if (re) {
      this.app.pres.slides.forEach((s, si) => {
        for (const e of allElements(s.elements)) {
          const bodies: TextBody[] = e.type === 'shape' && e.text ? [e.text] : e.type === 'table' ? e.rows.flatMap((r) => r.cells.map((c) => c.text)) : [];
          for (const b of bodies) for (const p of b.paras) p.runs.forEach((r, ri) => {
            if (!r.t) return;
            re.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = re.exec(r.t))) {
              this.hits.push({ slide: si, elId: e.id, body: b, para: p, run: ri, index: m.index, length: m[0].length });
              if (m[0].length === 0) re.lastIndex++;
            }
          });
        }
      });
    }
    this.at = this.hits.length ? Math.max(0, this.hits.findIndex((h_) => h_.slide >= this.app.curIndex)) : -1;
    if (this.at < 0 && this.hits.length) this.at = 0;
    this.updateCount();
    if (jump && this.at >= 0) this.show();
  }

  private updateCount() {
    this.count.textContent = this.find.value ? (this.hits.length ? `${this.at + 1} of ${this.hits.length}` : 'No results') : '';
  }

  private step(dir: 1 | -1) {
    if (!this.hits.length) return this.search(true);
    this.at = (this.at + dir + this.hits.length) % this.hits.length;
    this.updateCount();
    this.show();
  }

  private show() {
    const hit = this.hits[this.at];
    if (!hit) return;
    this.app.canvas.endTextEdit();
    if (this.app.curIndex !== hit.slide || this.app.masterView) {
      this.app.masterView = null;
      this.app.goto(hit.slide, true);
    }
    this.app.setSel([hit.elId]);
    const dom = this.app.canvas.elDom(hit.elId);
    dom?.scrollIntoView({ block: 'nearest' });
  }

  private replaceOne() {
    const hit = this.hits[this.at];
    if (!hit) return this.search(true);
    this.app.mutate('Replace', () => {
      const r = hit.para.runs[hit.run];
      r.t = r.t.slice(0, hit.index) + this.repl.value + r.t.slice(hit.index + hit.length);
    });
    this.search(true);
  }

  private replaceAll() {
    const re = this.matcher();
    if (!re) return;
    let n = 0;
    this.app.mutate('Replace all', () => {
      for (const s of this.app.pres.slides) {
        for (const e of allElements(s.elements)) {
          const bodies: TextBody[] = e.type === 'shape' && e.text ? [e.text] : e.type === 'table' ? e.rows.flatMap((r) => r.cells.map((c) => c.text)) : [];
          for (const b of bodies) for (const p of b.paras) for (const r of p.runs) {
            if (!r.t) continue;
            re.lastIndex = 0;
            r.t = r.t.replace(re, () => (n++, this.repl.value));
          }
        }
      }
    });
    this.count.textContent = `${n} replaced`;
    this.search(false);
  }
}
