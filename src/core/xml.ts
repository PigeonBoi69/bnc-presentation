// A small, dependency-free XML reader for OOXML parts. It keeps element order (which matters for slide
// z-order), strips namespace prefixes from element names, and works in Node and in the browser.

export interface XNode {
  /** local element name (no namespace prefix) */
  n: string;
  /** attributes (names kept as written, e.g. "r:embed") */
  a: Record<string, string>;
  c: XNode[];
  /** text directly inside this element */
  t: string;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });

export function parseXml(src: string): XNode {
  const root: XNode = { n: '#root', a: {}, c: [], t: '' };
  const stack: XNode[] = [root];
  const len = src.length;
  let i = 0;
  if (src.charCodeAt(0) === 0xfeff) i = 1;
  while (i < len) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) {
      const text = src.slice(i, lt);
      const top = stack[stack.length - 1];
      if (top !== root) top.t += decode(text);
    }
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end < 0 ? len : end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      const top = stack[stack.length - 1];
      top.t += src.slice(lt + 9, end < 0 ? len : end);
      i = end < 0 ? len : end + 3;
      continue;
    }
    if (src[lt + 1] === '?' || src[lt + 1] === '!') {
      const end = src.indexOf('>', lt + 2);
      i = end < 0 ? len : end + 1;
      continue;
    }
    if (src[lt + 1] === '/') {
      const end = src.indexOf('>', lt + 2);
      if (stack.length > 1) stack.pop();
      i = end < 0 ? len : end + 1;
      continue;
    }
    // start tag: find the closing '>' while honouring quoted attribute values
    let j = lt + 1;
    let quote = '';
    while (j < len) {
      const ch = src[j];
      if (quote) {
        if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '>') break;
      j++;
    }
    let body = src.slice(lt + 1, j);
    const selfClose = body.endsWith('/');
    if (selfClose) body = body.slice(0, -1);
    const sp = body.search(/[\s]/);
    const rawName = sp < 0 ? body : body.slice(0, sp);
    const node: XNode = { n: rawName.includes(':') ? rawName.slice(rawName.indexOf(':') + 1) : rawName, a: {}, c: [], t: '' };
    if (sp >= 0) {
      const attrSrc = body.slice(sp);
      const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(attrSrc))) node.a[m[1]] = decode(m[3] ?? m[4] ?? '');
    }
    stack[stack.length - 1].c.push(node);
    if (!selfClose) stack.push(node);
    i = j + 1;
  }
  return root.c[0] ?? root;
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------
export const kid = (n: XNode | undefined, name: string): XNode | undefined => n?.c.find((k) => k.n === name);
export const kids = (n: XNode | undefined, name?: string): XNode[] => (n ? (name ? n.c.filter((k) => k.n === name) : n.c) : []);
/** Follow a path of child names, e.g. path(sp, 'spPr', 'xfrm', 'off'). */
export function path(n: XNode | undefined, ...names: string[]): XNode | undefined {
  let cur = n;
  for (const name of names) {
    cur = kid(cur, name);
    if (!cur) return undefined;
  }
  return cur;
}
export const attr = (n: XNode | undefined, name: string): string | undefined => n?.a[name];
export const numAttr = (n: XNode | undefined, name: string): number | undefined => {
  const v = n?.a[name];
  if (v === undefined || v === '') return undefined;
  const x = Number(v);
  return Number.isFinite(x) ? x : undefined;
};
export const boolAttr = (n: XNode | undefined, name: string): boolean | undefined => {
  const v = n?.a[name];
  return v === undefined ? undefined : v === '1' || v === 'true';
};
/** All descendants with the given name (depth-first, document order). */
export function descendants(n: XNode | undefined, name: string, out: XNode[] = []): XNode[] {
  if (!n) return out;
  for (const k of n.c) {
    if (k.n === name) out.push(k);
    descendants(k, name, out);
  }
  return out;
}
export function textOf(n: XNode | undefined): string {
  if (!n) return '';
  return n.t + n.c.map(textOf).join('');
}

export const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
