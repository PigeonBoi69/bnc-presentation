// In-place rich text editing (ProseMirror) for shapes and table cells. Paragraph and run properties map
// 1:1 to the slide model, and the editor renders with the same CSS helpers as the slide itself.
import { baseKeymap, deleteSelection } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { Fragment, Schema, type Mark, type Node as PMNode, type NodeSpec, type MarkSpec } from 'prosemirror-model';
import { EditorState, Plugin, TextSelection, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import type { ThemeCtx } from '../core/color';
import type { Bullet, Para, Run, RunProps, TextBody } from '../core/model';
import { bulletLabels, effBullet, effRun, paraStyle, runStyle, type TextRenderOpts } from '../core/text';

const RUN_KEYS = ['b', 'i', 'u', 'strike', 'sz', 'color', 'font', 'hl', 'base', 'cap', 'spc', 'link', 'lang'] as const;
const PARA_KEYS = ['algn', 'marL', 'indent', 'lnSpc', 'spcBef', 'spcAft', 'bu', 'rtl'] as const;

export type ParaPatch = Partial<Pick<Para, (typeof PARA_KEYS)[number]>> & { level?: number };

export interface TextTarget {
  body: TextBody;
  ctx: ThemeCtx;
  render: TextRenderOpts;
  mount: HTMLElement;
  /** called after every document change with the new body */
  onChange(body: TextBody): void;
  /** Escape pressed or the editor wants to close */
  onExit(): void;
  onSelection?(): void;
}

function runAttrSpec() {
  const a: Record<string, { default: unknown }> = {};
  for (const k of RUN_KEYS) a[k] = { default: null };
  return a;
}
function paraAttrSpec() {
  const a: Record<string, { default: unknown }> = { level: { default: 0 }, end: { default: null } };
  for (const k of PARA_KEYS) a[k] = { default: null };
  return a;
}

function cleanRun(attrs: Record<string, unknown>): RunProps {
  const out: Record<string, unknown> = {};
  for (const k of RUN_KEYS) if (attrs[k] !== null && attrs[k] !== undefined) out[k] = attrs[k];
  return out as RunProps;
}
function paraOfNode(node: PMNode): Para {
  const p: Record<string, unknown> = { runs: [] };
  for (const k of PARA_KEYS) if (node.attrs[k] !== null && node.attrs[k] !== undefined) p[k] = node.attrs[k];
  if (node.attrs.level) p.level = node.attrs.level;
  return p as unknown as Para;
}

export function makeSchema(t: TextTarget): Schema {
  const nodes: Record<string, NodeSpec> = {
    doc: { content: 'paragraph+' },
    paragraph: {
      content: 'inline*',
      group: 'block',
      attrs: paraAttrSpec(),
      parseDOM: [{ tag: 'p', getAttrs: () => ({}) }],
      toDOM(node) {
        const p = paraOfNode(node);
        const style = paraStyle(p, t.body, t.ctx, { ...t.render, scaleVar: true }, false, !!effBullet(p, t.body.lst));
        return ['p', { style }, 0];
      },
    },
    text: { group: 'inline' },
    hard_break: { inline: true, group: 'inline', selectable: false, parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] },
    field: {
      inline: true,
      group: 'inline',
      atom: true,
      attrs: { field: { default: 'slidenum' } },
      toDOM(node) {
        const f = node.attrs.field as string;
        const text = f === 'slidenum' ? String(t.render.slideNumber ?? 1) : f === 'slidecount' ? String(t.render.slideCount ?? 1) : (t.render.date ?? new Date().toLocaleDateString());
        return ['span', { class: 'fld', contenteditable: 'false' }, text];
      },
    },
  };
  const marks: Record<string, MarkSpec> = {
    run: {
      attrs: runAttrSpec(),
      excludes: 'run',
      inclusive: true,
      parseDOM: [
        {
          tag: 'span[style]',
          getAttrs(dom) {
            const el = dom as HTMLElement;
            const a: Record<string, unknown> = {};
            if (el.style.fontWeight === '700' || el.style.fontWeight === 'bold') a.b = true;
            if (el.style.fontStyle === 'italic') a.i = true;
            if (el.style.textDecorationLine.includes('underline')) a.u = true;
            if (el.style.textDecorationLine.includes('line-through')) a.strike = true;
            return a;
          },
        },
      ],
      toDOM(mark) {
        return ['span', { style: runStyle(cleanRun(mark.attrs), t.ctx, 1, true) }, 0];
      },
    },
  };
  return new Schema({ nodes, marks });
}

export function bodyToDoc(body: TextBody, schema: Schema): PMNode {
  const run = schema.marks.run;
  const paras = body.paras.length ? body.paras : [{ runs: [] } as Para];
  const nodes = paras.map((p) => {
    const attrs: Record<string, unknown> = { level: p.level ?? 0, end: p.end ?? null };
    for (const k of PARA_KEYS) attrs[k] = (p as any)[k] ?? null;
    const kids: PMNode[] = [];
    for (const r of p.runs) {
      const rp: Record<string, unknown> = {};
      for (const k of RUN_KEYS) rp[k] = (r as any)[k] ?? null;
      const marks = Object.values(rp).some((v) => v !== null) ? [run.create(rp)] : [];
      if (r.br) kids.push(schema.nodes.hard_break.create(null, undefined, marks));
      else if (r.field) kids.push(schema.nodes.field.create({ field: r.field }, undefined, marks));
      else if (r.t) kids.push(schema.text(r.t, marks));
    }
    return schema.nodes.paragraph.create(attrs, kids);
  });
  return schema.nodes.doc.create(null, nodes);
}

export function docToBody(doc: PMNode, base: TextBody): TextBody {
  const paras: Para[] = [];
  doc.forEach((pn) => {
    const para = paraOfNode(pn);
    pn.forEach((child) => {
      const rp = child.marks.find((m) => m.type.name === 'run');
      const props = rp ? cleanRun(rp.attrs) : {};
      if (child.type.name === 'hard_break') para.runs.push({ t: '', br: true, ...props } as Run);
      else if (child.type.name === 'field') para.runs.push({ t: '', field: child.attrs.field, ...props } as Run);
      else if (child.isText) para.runs.push({ t: child.text ?? '', ...props } as Run);
    });
    if (pn.attrs.end) para.end = pn.attrs.end as RunProps;
    paras.push(para);
  });
  return { ...base, paras };
}

export class TextEditor {
  view: EditorView;
  schema: Schema;
  private target: TextTarget;
  private bodyBase: TextBody;
  private closed = false;

  constructor(t: TextTarget) {
    this.target = t;
    this.bodyBase = t.body;
    this.schema = makeSchema(t);
    const schema = this.schema;
    const self = this;

    const bulletPlugin = new Plugin({
      props: {
        decorations(state) {
          const paras: Para[] = [];
          const poss: [number, number][] = [];
          state.doc.forEach((n, off) => {
            paras.push(paraOfNode(n));
            poss.push([off, off + n.nodeSize]);
          });
          const labels = bulletLabels(paras, self.bodyBase.lst);
          const decos: Decoration[] = [];
          labels.forEach((l, i) => {
            if (l != null) decos.push(Decoration.node(poss[i][0], poss[i][1], { 'data-bu': l }));
          });
          return DecorationSet.create(state.doc, decos);
        },
      },
    });

    const enter = (state: EditorState, dispatch?: (tr: Transaction) => void) => {
      const { $from } = state.selection;
      if (dispatch) {
        let tr = state.tr;
        if (!state.selection.empty) tr = tr.deleteSelection();
        const $pos = tr.doc.resolve(tr.mapping.map($from.pos));
        const parent = $pos.parent;
        const marks = tr.storedMarks ?? $pos.marks();
        tr = tr.split($pos.pos, 1, [{ type: schema.nodes.paragraph, attrs: { ...parent.attrs, end: null } }]);
        tr = tr.setStoredMarks(marks);
        dispatch(tr.scrollIntoView());
      }
      return true;
    };
    const softBreak = (state: EditorState, dispatch?: (tr: Transaction) => void) => {
      if (dispatch) dispatch(state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView());
      return true;
    };
    const tab = (delta: number) => (state: EditorState, dispatch?: (tr: Transaction) => void) => {
      if (dispatch) this.changeLevel(delta);
      return true;
    };

    this.view = new EditorView(t.mount, {
      state: EditorState.create({
        doc: bodyToDoc(t.body, schema),
        plugins: [
          history(),
          keymap({
            'Mod-z': undo,
            'Mod-y': redo,
            'Mod-Shift-z': redo,
            'Mod-b': () => (this.toggleRun('b'), true),
            'Mod-i': () => (this.toggleRun('i'), true),
            'Mod-u': () => (this.toggleRun('u'), true),
            Enter: enter,
            'Shift-Enter': softBreak,
            Tab: tab(1),
            'Shift-Tab': tab(-1),
            Escape: () => (this.target.onExit(), true),
          }),
          keymap(baseKeymap),
          bulletPlugin,
        ],
      }),
      attributes: { spellcheck: 'true', 'aria-label': 'Slide text' },
      dispatchTransaction: (tr) => {
        const next = this.view.state.apply(tr);
        this.view.updateState(next);
        if (tr.docChanged) this.target.onChange(this.body());
        if (tr.docChanged || tr.selectionSet || tr.storedMarksSet) this.target.onSelection?.();
      },
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData('text/plain');
        if (text == null || event.clipboardData?.getData('text/html')?.includes('data-pm-slice')) return false;
        event.preventDefault();
        this.insertText(text);
        return true;
      },
      clipboardTextParser: undefined,
    });
  }

  body(): TextBody {
    return docToBody(this.view.state.doc, this.bodyBase);
  }

  focus(at?: { x: number; y: number } | 'end' | 'all') {
    this.view.focus();
    const doc = this.view.state.doc;
    if (at && typeof at === 'object') {
      const pos = this.view.posAtCoords({ left: at.x, top: at.y });
      if (pos) this.view.dispatch(this.view.state.tr.setSelection(TextSelection.near(doc.resolve(pos.pos))));
      else this.view.dispatch(this.view.state.tr.setSelection(TextSelection.atEnd(doc)));
    } else if (at === 'all') {
      this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(doc, 0, doc.content.size)));
    } else {
      this.view.dispatch(this.view.state.tr.setSelection(TextSelection.atEnd(doc)));
    }
  }

  destroy(): TextBody {
    const body = this.body();
    this.closed = true;
    this.view.destroy();
    return body;
  }
  get isClosed() {
    return this.closed;
  }

  // ---- reading selection state ----
  private ranges(): { node: PMNode; pos: number; from: number; to: number }[] {
    const { from, to } = this.view.state.selection;
    const out: { node: PMNode; pos: number; from: number; to: number }[] = [];
    this.view.state.doc.forEach((n, off) => {
      const start = off;
      const end = off + n.nodeSize;
      if (end >= from && start <= to) out.push({ node: n, pos: off, from: Math.max(from, start + 1), to: Math.min(to, end - 1) });
    });
    return out;
  }

  /** Effective run properties at the selection (undefined where the selection is mixed). */
  runProps(): RunProps {
    const state = this.view.state;
    const { empty, from, to } = state.selection;
    const samples: RunProps[] = [];
    if (empty) {
      const marks = state.storedMarks ?? state.selection.$from.marks();
      const run = marks.find((m) => m.type.name === 'run');
      const para = paraOfNode(state.selection.$from.parent);
      samples.push(effRun(this.bodyBase, para, run ? cleanRun(run.attrs) : undefined));
    } else {
      state.doc.nodesBetween(from, to, (node, pos, parent) => {
        if (node.isInline && parent) {
          const run = node.marks.find((m) => m.type.name === 'run');
          samples.push(effRun(this.bodyBase, paraOfNode(parent), run ? cleanRun(run.attrs) : undefined));
        }
        return true;
      });
      if (!samples.length) samples.push(effRun(this.bodyBase, paraOfNode(state.selection.$from.parent), undefined));
    }
    const out: Record<string, unknown> = {};
    for (const k of RUN_KEYS) {
      const first = (samples[0] as any)[k];
      out[k] = samples.every((s) => JSON.stringify((s as any)[k]) === JSON.stringify(first)) ? first : undefined;
    }
    return out as RunProps;
  }

  paraProps(): Para {
    const $from = this.view.state.selection.$from;
    return paraOfNode($from.parent);
  }
  paragraphsInSelection(): Para[] {
    return this.ranges().map((r) => paraOfNode(r.node));
  }
  selectionText(): string {
    const { from, to } = this.view.state.selection;
    return this.view.state.doc.textBetween(from, to, '\n');
  }

  // ---- changing things ----
  setRunProps(patch: RunProps) {
    const { state } = this.view;
    const { from, to, empty } = state.selection;
    const run = this.schema.marks.run;
    const merge = (existing: Mark | undefined): Mark | null => {
      const attrs: Record<string, unknown> = {};
      for (const k of RUN_KEYS) attrs[k] = existing ? existing.attrs[k] : null;
      for (const [k, v] of Object.entries(patch)) attrs[k] = v === undefined ? null : v;
      return Object.values(attrs).some((v) => v !== null) ? run.create(attrs) : null;
    };
    let tr = state.tr;
    if (empty) {
      const marks = state.storedMarks ?? state.selection.$from.marks();
      const existing = marks.find((m) => m.type === run);
      const next = merge(existing);
      let set: readonly Mark[] = marks.filter((m) => m.type !== run);
      if (next) set = [...set, next];
      tr = tr.setStoredMarks(set as Mark[]);
      const parent = state.selection.$from.parent;
      if (parent.content.size === 0) {
        const pos = state.selection.$from.before();
        const end = { ...(parent.attrs.end ?? {}) } as Record<string, unknown>;
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined) delete end[k];
          else end[k] = v;
        }
        tr = tr.setNodeMarkup(pos, null, { ...parent.attrs, end: Object.keys(end).length ? end : null });
      }
    } else {
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isInline) return true;
        const start = Math.max(pos, from);
        const end = Math.min(pos + node.nodeSize, to);
        const existing = node.marks.find((m) => m.type === run);
        const next = merge(existing);
        tr = tr.removeMark(start, end, run);
        if (next) tr = tr.addMark(start, end, next);
        return false;
      });
      // paragraphs whose whole content is selected also take the new "end" settings (sizes empty lines)
    }
    this.view.dispatch(tr);
    this.view.focus();
  }

  toggleRun(key: 'b' | 'i' | 'u' | 'strike') {
    const cur = this.runProps();
    this.setRunProps({ [key]: !(cur as any)[key] } as RunProps);
  }

  setParaProps(patch: ParaPatch) {
    const { state } = this.view;
    let tr = state.tr;
    for (const r of this.ranges()) {
      const attrs = { ...r.node.attrs };
      for (const [k, v] of Object.entries(patch)) attrs[k] = v === undefined ? (k === 'level' ? 0 : null) : v;
      tr = tr.setNodeMarkup(r.pos, null, attrs);
    }
    this.view.dispatch(tr);
    this.view.focus();
  }

  changeLevel(delta: number) {
    const { state } = this.view;
    let tr = state.tr;
    for (const r of this.ranges()) {
      const level = Math.max(0, Math.min(8, (r.node.attrs.level ?? 0) + delta));
      tr = tr.setNodeMarkup(r.pos, null, { ...r.node.attrs, level, marL: null, indent: null });
    }
    this.view.dispatch(tr);
  }

  setBullet(bu: Bullet | undefined) {
    this.setParaProps({ bu: bu as Bullet });
  }

  insertText(text: string) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const { state } = this.view;
    let tr = state.tr;
    const marks = state.storedMarks ?? state.selection.$from.marks();
    tr = tr.deleteSelection();
    lines.forEach((line, i) => {
      if (i > 0) {
        const $p = tr.doc.resolve(tr.selection.from);
        tr = tr.split($p.pos, 1, [{ type: this.schema.nodes.paragraph, attrs: { ...$p.parent.attrs, end: null } }]);
      }
      if (line) tr = tr.insertText(line, tr.selection.from).ensureMarks(marks);
    });
    this.view.dispatch(tr.scrollIntoView());
  }

  insertField(field: Run['field']) {
    const node = this.schema.nodes.field.create({ field });
    this.view.dispatch(this.view.state.tr.replaceSelectionWith(node));
  }

  selectAll() {
    const doc = this.view.state.doc;
    this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(doc, 0, doc.content.size)));
  }

  /** Replace the whole document (used by find & replace and when the model changes underneath). */
  setBody(body: TextBody) {
    this.bodyBase = body;
    const doc = bodyToDoc(body, this.schema);
    this.view.dispatch(this.view.state.tr.replaceWith(0, this.view.state.doc.content.size, doc.content));
  }

  setScale(scale: number) {
    this.target.mount.style.setProperty('--fs', String(scale));
  }
}

void deleteSelection;
void Fragment;
