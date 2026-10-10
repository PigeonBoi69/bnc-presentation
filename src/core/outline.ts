// Outline formats: Markdown and plain text <-> slides.
//   Markdown:  "# Title" starts a slide, "- item" / "* item" / "1. item" are bullets (indent = level), other lines are body text.
//   Plain text: a line with no indent is a slide title, indented lines are bullets (two spaces or a tab per level).
import { blankPres, clone, slideFromLayout, plainText, slideTitle, type Deck, type El, type Para, type Pres, type ShapeEl } from './model';

function bodyParas(lines: { text: string; level: number; bullet: boolean }[]): Para[] {
  return lines.map((l) => ({ runs: l.text ? [{ t: l.text }] : [], level: l.level || undefined, ...(l.bullet ? {} : { bu: { t: 'none' as const }, marL: 0, indent: 0 }) }));
}

function fillSlide(pres: Pres, title: string, body: { text: string; level: number; bullet: boolean }[]) {
  const layout = pres.layouts.find((l) => l.kind === (body.length ? 'obj' : 'titleOnly')) ?? pres.layouts[1] ?? pres.layouts[0];
  const slide = slideFromLayout(pres, layout.id);
  for (const e of slide.elements as ShapeEl[]) {
    if (e.ph?.type === 'title' || e.ph?.type === 'ctrTitle') e.text!.paras = [{ runs: title ? [{ t: title }] : [] }];
    else if (body.length && e.text && (e.ph?.type === 'obj' || e.ph?.type === 'body')) {
      e.text.paras = bodyParas(body);
      body = [];
    }
  }
  pres.slides.push(slide);
}

export function deckFromOutline(src: string, kind: 'md' | 'txt'): Deck {
  const pres = blankPres();
  pres.slides = [];
  let title = '';
  let body: { text: string; level: number; bullet: boolean }[] = [];
  let open = false;
  const flush = () => {
    if (open) fillSlide(pres, title, body);
    open = false;
    title = '';
    body = [];
  };
  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    if (!raw.trim()) continue;
    if (kind === 'md') {
      const h = /^(#{1,2})\s+(.*)$/.exec(raw);
      if (h) {
        flush();
        title = h[2].trim();
        open = true;
        continue;
      }
      const b = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(raw);
      if (!open) {
        open = true;
        title = '';
      }
      if (b) body.push({ text: b[3].trim(), level: Math.min(8, Math.floor(b[1].replace(/\t/g, '  ').length / 2)), bullet: true });
      else if (/^#{3,}\s+/.test(raw)) body.push({ text: raw.replace(/^#+\s+/, '').trim(), level: 0, bullet: false });
      else body.push({ text: raw.trim(), level: 0, bullet: false });
    } else {
      const indent = /^(\s*)/.exec(raw)![1].replace(/\t/g, '  ').length;
      if (indent === 0) {
        flush();
        title = raw.trim();
        open = true;
      } else {
        if (!open) {
          open = true;
          title = '';
        }
        body.push({ text: raw.trim(), level: Math.min(8, Math.max(0, Math.floor(indent / 2) - 1)), bullet: true });
      }
    }
  }
  flush();
  if (!pres.slides.length) fillSlide(pres, '', []);
  const first = pres.slides[0];
  if (first) {
    // first slide becomes the title slide when it has no body
    const titleLayout = pres.layouts.find((l) => l.kind === 'title');
    const hasBody = first.elements.some((e) => e.type === 'shape' && e.text && e.ph?.type === 'obj' && plainText(e.text).trim());
    if (titleLayout && !hasBody) {
      const t = (first.elements.find((e) => e.type === 'shape' && e.ph?.type === 'title') as ShapeEl | undefined)?.text;
      const fresh = slideFromLayout(pres, titleLayout.id);
      const ft = fresh.elements.find((e) => e.type === 'shape' && e.ph?.type === 'ctrTitle') as ShapeEl | undefined;
      if (ft && t) ft.text!.paras = clone(t.paras);
      pres.slides[0] = fresh;
    }
  }
  return { pres, media: new Map() };
}

function slideLines(pres: Pres): { title: string; body: { text: string; level: number; numbered: boolean }[]; notes: string }[] {
  return pres.slides.map((s) => {
    const body: { text: string; level: number; numbered: boolean }[] = [];
    for (const e of s.elements as El[]) {
      if (e.type !== 'shape' || !e.text || e.ph?.type === 'title' || e.ph?.type === 'ctrTitle') continue;
      if (e.ph && /^(dt|ftr|sldNum)$/.test(e.ph.type)) continue;
      for (const p of e.text.paras) {
        const text = p.runs.map((r) => (r.br ? ' ' : r.t)).join('').trim();
        if (text) body.push({ text, level: p.level ?? 0, numbered: (p.bu ?? e.text.lst?.[p.level ?? 0]?.bu)?.t === 'num' });
      }
    }
    return { title: slideTitle(s), body, notes: s.notes ? s.notes.map((p) => p.runs.map((r) => r.t).join('')).join('\n') : '' };
  });
}

export function outlineToMarkdown(pres: Pres): string {
  return (
    slideLines(pres)
      .map((s) => {
        const lines = [`# ${s.title || 'Untitled slide'}`, ''];
        for (const b of s.body) lines.push(`${'  '.repeat(b.level)}${b.numbered ? '1.' : '-'} ${b.text}`);
        if (s.notes) lines.push('', ...s.notes.split('\n').map((n) => `> ${n}`));
        return lines.join('\n');
      })
      .join('\n\n') + '\n'
  );
}

export function outlineToText(pres: Pres): string {
  return (
    slideLines(pres)
      .map((s) => [s.title || 'Untitled slide', ...s.body.map((b) => `${'  '.repeat(b.level + 1)}${b.text}`)].join('\n'))
      .join('\n') + '\n'
  );
}
