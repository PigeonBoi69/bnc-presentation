import { icon, type IconName } from './icons';

type Child = Node | string | null | undefined | false;
interface Props {
  class?: string;
  text?: string;
  title?: string;
  style?: Partial<CSSStyleDeclaration> | string;
  attrs?: Record<string, string>;
  on?: Record<string, (e: any) => void>;
  value?: string;
  dataset?: Record<string, string>;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    if (props.class) el.className = props.class;
    if (props.text != null) el.textContent = props.text;
    if (props.title) el.title = props.title;
    if (props.style) {
      if (typeof props.style === 'string') el.setAttribute('style', props.style);
      else Object.assign(el.style, props.style);
    }
    if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
    if (props.dataset) for (const [k, v] of Object.entries(props.dataset)) el.dataset[k] = v;
    if (props.on) for (const [k, fn] of Object.entries(props.on)) el.addEventListener(k, fn);
    if (props.value != null) (el as any).value = props.value;
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

/** On a Mac, show shortcuts the Mac way: "Ctrl+Shift+S" -> "⇧⌘S", "Alt+Q" -> "⌥Q". Other systems are unchanged. */
export function macify(text: string): string {
  if (!document.documentElement.classList.contains('platform-darwin')) return text;
  return text.replace(/((?:Ctrl|Alt|Shift)\+)+/g, (run) => {
    const keys = run.split('+').filter(Boolean);
    const sym = (k: string) => (k === 'Ctrl' ? '⌘' : k === 'Alt' ? '⌥' : '⇧');
    // Mac order is Shift, Option, Command
    return ['Shift', 'Alt', 'Ctrl'].filter((k) => keys.includes(k)).map(sym).join('');
  });
}

export function clear(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function iconEl(name: IconName, size = 18) {
  return icon(name, size);
}

export function debounce<T extends (...a: any[]) => void>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout> | undefined;
  return ((...args: any[]) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as T;
}

// ---------------------------------------------------------------------------
// Popovers (dropdowns, menus, pickers). One open at a time, closed by outside click or Escape.
// ---------------------------------------------------------------------------
let openPop: { el: HTMLElement; anchor: HTMLElement; close: () => void } | null = null;

export function closePopover() {
  openPop?.close();
  openPop = null;
}

export function popover(anchor: HTMLElement, content: HTMLElement, opts: { align?: 'left' | 'right'; className?: string } = {}): () => void {
  closePopover();
  const el = h('div', { class: `popover ${opts.className ?? ''}` }, content);
  document.body.append(el);
  const place = () => {
    const r = anchor.getBoundingClientRect();
    const pw = el.offsetWidth;
    const ph = el.offsetHeight;
    let left = opts.align === 'right' ? r.right - pw : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
    let top = r.bottom + 4;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 4);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  };
  place();
  const onDown = (e: MouseEvent) => {
    const t = e.target as Element;
    // clicks inside this popover, its anchor or any of its submenus must not dismiss it
    if (!el.contains(t) && !anchor.contains(t) && !t.closest?.('.submenu')) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  const close = () => {
    el.remove();
    document.querySelectorAll('.submenu').forEach((s) => s.remove());
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    if (openPop?.el === el) openPop = null;
  };
  setTimeout(() => {
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
  }, 0);
  openPop = { el, anchor, close };
  return close;
}

export interface MenuItem {
  label?: string;
  icon?: IconName;
  shortcut?: string;
  run?: () => void;
  checked?: boolean;
  disabled?: boolean;
  separator?: boolean;
  sub?: MenuItem[];
  header?: boolean;
  /** two colours drawn as a little gradient dot before the label */
  swatch?: [string, string];
}

export function buildMenu(items: MenuItem[], close: () => void): HTMLElement {
  const menu = h('div', { class: 'menu' });
  for (const it of items) {
    if (it.separator) {
      menu.append(h('div', { class: 'menu-sep' }));
      continue;
    }
    if (it.header) {
      menu.append(h('div', { class: 'menu-header', text: it.label }));
      continue;
    }
    const row = h(
      'div',
      { class: `menu-item${it.disabled ? ' disabled' : ''}` },
      h('span', { class: 'menu-check' }, it.checked ? iconEl('check', 14) : it.icon ? iconEl(it.icon, 16) : null),
      h(
        'span',
        { class: 'menu-label', style: it.swatch ? { display: 'flex', alignItems: 'center', gap: '8px' } : undefined },
        it.swatch ? h('span', { class: 'menu-swatch', style: { background: `linear-gradient(135deg, ${it.swatch[0]}, ${it.swatch[1]})` } }) : null,
        it.label ?? '',
      ),
      it.shortcut ? h('span', { class: 'menu-shortcut', text: macify(it.shortcut) }) : null,
      it.sub ? iconEl('chevronRight', 14) : null,
    );
    if (it.sub) {
      let subEl: HTMLElement | null = null;
      row.addEventListener('mouseenter', () => {
        subEl?.remove();
        subEl = h('div', { class: 'popover submenu' }, buildMenu(it.sub!, close));
        document.body.append(subEl);
        const r = row.getBoundingClientRect();
        subEl.style.left = `${Math.min(r.right - 2, window.innerWidth - subEl.offsetWidth - 8)}px`;
        subEl.style.top = `${Math.min(r.top - 4, window.innerHeight - subEl.offsetHeight - 8)}px`;
      });
      row.addEventListener('mouseleave', (e) => {
        if (!(e.relatedTarget instanceof Node && subEl?.contains(e.relatedTarget))) {
          setTimeout(() => {
            if (subEl && !subEl.matches(':hover') && !row.matches(':hover')) {
              subEl.remove();
              subEl = null;
            }
          }, 120);
        }
      });
    } else if (!it.disabled) {
      row.addEventListener('click', () => {
        close();
        document.querySelectorAll('.submenu').forEach((s) => s.remove());
        it.run?.();
      });
    }
    menu.append(row);
  }
  return menu;
}

export function showMenu(anchor: HTMLElement, items: MenuItem[] | (() => MenuItem[]), opts: { align?: 'left' | 'right' } = {}) {
  const list = typeof items === 'function' ? items() : items;
  let close: () => void = () => {};
  const menu = buildMenu(list, () => close());
  close = popover(anchor, menu, opts);
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
export function toast(message: string, kind: 'info' | 'error' = 'info', ms = 3200) {
  let host = document.getElementById('toasts');
  if (!host) {
    host = h('div', { class: 'toasts', attrs: { id: 'toasts' } });
    document.body.append(host);
  }
  const t = h('div', { class: `toast ${kind}`, text: message });
  host.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

// ---------------------------------------------------------------------------
// Modal dialogs
// ---------------------------------------------------------------------------
export interface ModalButton {
  label: string;
  primary?: boolean;
  /** Return false to keep the dialog open. */
  run?: () => boolean | void | Promise<boolean | void>;
}

export function modal(title: string, body: HTMLElement, buttons: ModalButton[], opts: { width?: number; onClose?: () => void } = {}): { close: () => void; el: HTMLElement } {
  const overlay = h('div', { class: 'modal-overlay' });
  const dlg = h('div', { class: 'modal', style: { width: `${opts.width ?? 440}px` }, attrs: { role: 'dialog', 'aria-label': title } });
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    opts.onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) {
      const primary = buttons.find((b) => b.primary);
      if (primary) {
        e.preventDefault();
        void click(primary);
      }
    }
  };
  const click = async (b: ModalButton) => {
    const r = await b.run?.();
    if (r !== false) close();
  };
  const footer = h('div', { class: 'modal-footer' });
  for (const b of buttons) footer.append(h('button', { class: `btn${b.primary ? ' primary' : ''}`, text: b.label, on: { click: () => void click(b) } }));
  dlg.append(
    h('div', { class: 'modal-head' }, h('h2', { text: title }), h('button', { class: 'icon-btn', title: 'Close', on: { click: close } }, iconEl('close', 16))),
    h('div', { class: 'modal-body' }, body),
    ...(buttons.length ? [footer] : []),
  );
  overlay.append(dlg);
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });
  document.body.append(overlay);
  document.addEventListener('keydown', onKey, true);
  setTimeout(() => (dlg.querySelector('input,select,textarea') as HTMLElement | null)?.focus(), 0);
  return { close, el: dlg };
}

export function field(label: string, input: HTMLElement, hint?: string): HTMLElement {
  return h('label', { class: 'field' }, h('span', { class: 'field-label', text: label }), input, hint ? h('span', { class: 'field-hint', text: hint }) : null);
}

export function prompt(title: string, label: string, initial = '', confirmLabel = 'OK'): Promise<string | null> {
  return new Promise((resolve) => {
    const input = h('input', { class: 'input', value: initial, attrs: { type: 'text' } });
    let done = false;
    const finish = (v: string | null) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    modal(title, field(label, input), [
      { label: 'Cancel', run: () => finish(null) },
      { label: confirmLabel, primary: true, run: () => finish(input.value.trim() || null) },
    ], { onClose: () => finish(null) });
    setTimeout(() => input.select(), 10);
  });
}


export function confirmBox(title: string, message: string, confirmLabel = 'OK', danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    modal(title, h('p', { text: message, style: { margin: '4px 0' } }), [
      { label: 'Cancel', run: () => finish(false) },
      { label: confirmLabel, primary: !danger, run: () => finish(true) },
    ], { onClose: () => finish(false), width: 400 });
  });
}

export function selectEl(options: [string, string][], value: string, onChange: (v: string) => void): HTMLSelectElement {
  const s = h('select', { class: 'select' }, ...options.map(([v, l]) => h('option', { text: l, attrs: { value: v } })));
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

export function checkbox(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const input = h('input', { attrs: { type: 'checkbox', ...(checked ? { checked: '' } : {}) } });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'switch' }, input, label);
}

export function numberField(value: number, o: { min?: number; max?: number; step?: number }, onChange: (v: number) => void): HTMLInputElement {
  const i = h('input', { class: 'input', value: String(Math.round(value * 100) / 100), attrs: { type: 'number', ...(o.min !== undefined ? { min: String(o.min) } : {}), ...(o.max !== undefined ? { max: String(o.max) } : {}), step: String(o.step ?? 1) } });
  i.addEventListener('change', () => {
    const v = parseFloat(i.value);
    if (Number.isFinite(v)) onChange(v);
  });
  return i;
}

/** Right-click style menu at a screen position. */
export function contextMenu(x: number, y: number, items: MenuItem[]) {
  const anchor = h('div', { style: { position: 'fixed', left: `${x}px`, top: `${y - 4}px`, width: '0', height: '0' } });
  document.body.append(anchor);
  let close: () => void = () => {};
  const menu = buildMenu(items, () => close());
  const inner = popover(anchor, menu);
  close = () => {
    inner();
    anchor.remove();
  };
  const onGone = () => setTimeout(() => anchor.remove(), 50);
  document.addEventListener('mousedown', onGone, { once: true, capture: true });
}
