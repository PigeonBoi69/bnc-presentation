// The slide panel on the left (thumbnails, drag to reorder, sections) and the Slide Sorter grid.
import type { App } from '../app';
import { renderSlideInto } from '../core/render';
import type { Layout, Master, Slide } from '../core/model';
import { h, iconEl, contextMenu, type MenuItem } from './dom';

interface Cached {
  el: HTMLElement;
  frame: HTMLElement;
  sig: string;
  scale: number;
}

export class SlidePanel {
  private list: HTMLElement;
  private cache = new Map<string, Cached>();
  private sorterCache = new Map<string, Cached>();
  private lastDesign = '';
  private sorterHost: HTMLElement | null = null;

  constructor(private app: App, private host: HTMLElement) {
    this.list = h('div', { class: 'thumb-list', attrs: { tabindex: '0', 'aria-label': 'Slides' } });
    host.append(this.list);
    this.list.addEventListener('contextmenu', (e) => {
      if (!(e.target as HTMLElement).closest('.thumb')) {
        e.preventDefault();
        contextMenu(e.clientX, e.clientY, [{ label: 'New slide', icon: 'newSlide', run: () => void this.app.run('new-slide') }, { label: 'Paste', icon: 'paste', run: () => void this.app.run('slide-paste') }]);
      }
    });
  }

  private designSig(): string {
    const p = this.app.pres;
    return JSON.stringify([p.masters, p.layouts, p.size]);
  }

  private thumbScale(): number {
    return 158 / this.app.pres.size.w;
  }

  private makeThumb(map: Map<string, Cached>, key: string, content: Slide | Layout | Master, sigExtra: string, scale: number, force: boolean): Cached {
    const sig = sigExtra + JSON.stringify(content);
    let c = map.get(key);
    const { w, h: hh } = this.app.pres.size;
    if (!c) {
      const frame = h('div', { class: 'frame' });
      const el = h('div', { class: 'thumb', dataset: { id: key } }, frame);
      c = { el, frame, sig: '', scale: 0 };
      map.set(key, c);
    }
    if (force || c.sig !== sig || c.scale !== scale) {
      c.frame.style.width = `${w * scale}px`;
      c.frame.style.height = `${hh * scale}px`;
      const inner = h('div');
      const slideIdx = this.app.pres.slides.indexOf(content as Slide);
      const o = this.app.renderOpts({}, slideIdx >= 0 ? (content as Slide) : undefined);
      renderSlideInto(inner, content, o);
      inner.style.transform = `scale(${scale})`;
      c.frame.replaceChildren(inner);
      c.sig = sig;
      c.scale = scale;
    }
    return c;
  }

  // -------------------------------------------------------------------------
  // Normal list
  // -------------------------------------------------------------------------
  refresh(force = false) {
    if (this.app.masterView) return this.refreshMaster();
    const design = this.designSig();
    const designChanged = design !== this.lastDesign;
    this.lastDesign = design;
    const pres = this.app.pres;
    const scale = this.thumbScale();
    const rows: HTMLElement[] = [];
    const alive = new Set<string>();
    pres.slides.forEach((s, i) => {
      alive.add(s.id);
      if (s.section !== undefined) {
        const sec = h('div', { class: 'sec', title: 'Section' }, iconEl('chevron', 12), h('span', { text: s.section || 'Untitled Section' }));
        sec.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          contextMenu(e.clientX, e.clientY, [{ label: 'Rename section…', run: () => void this.app.run('section-rename', s.id) }, { label: 'Remove section', run: () => void this.app.run('section-remove', s.id) }]);
        });
        rows.push(sec);
      }
      const c = this.makeThumb(this.cache, s.id, s, '', scale, force || designChanged);
      this.decorate(c.el, s, i);
      rows.push(c.el);
    });
    for (const key of [...this.cache.keys()]) if (!alive.has(key)) this.cache.delete(key);
    this.list.replaceChildren(...rows);
    this.highlight();
    if (this.sorterHost && this.app.view === 'sorter') this.renderSorter(this.sorterHost);
  }

  private decorate(el: HTMLElement, s: Slide, i: number) {
    el.replaceChildren(h('span', { class: 'num', text: String(i + (this.app.pres.firstSlideNumber ?? 1)) }), el.querySelector('.frame') as HTMLElement);
    el.classList.toggle('hidden-slide', !!s.hidden);
    if (s.hidden) el.append(h('span', { class: 'badge', title: 'Hidden slide' }, iconEl('hide', 12)));
    if (s.anims?.length) el.append(h('span', { class: 'badge anim', title: 'Has animations' }, iconEl('star', 12)));
    el.onpointerdown = (e) => this.onDown(e, s);
    el.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.app.slideSel.includes(s.id)) {
        this.app.slideSel = [s.id];
        this.app.goto(this.app.pres.slides.indexOf(s));
        this.highlight();
      }
      contextMenu(e.clientX, e.clientY, this.menuItems());
    };
  }

  private menuItems(): MenuItem[] {
    const R = (id: string, arg?: any) => () => void this.app.run(id, arg);
    const cur = this.app.curSlide();
    return [
      { label: 'New slide', icon: 'newSlide', shortcut: 'Ctrl+M', run: R('new-slide') },
      { label: 'Duplicate slide', icon: 'files', shortcut: 'Ctrl+D', run: R('duplicate-slide') },
      { label: 'Delete slide', icon: 'trash', shortcut: 'Del', run: R('delete-slide') },
      { separator: true },
      { label: 'Cut', icon: 'cut', run: R('slide-cut') },
      { label: 'Copy', icon: 'copy', run: R('slide-copy') },
      { label: 'Paste', icon: 'paste', run: R('slide-paste') },
      { separator: true },
      { label: 'Layout', icon: 'layout', sub: this.app.pres.layouts.map<MenuItem>((l) => ({ label: l.name, checked: cur.layoutId === l.id, run: R('slide-layout', l.id) })) },
      { label: 'Reset slide', run: R('reset-slide') },
      { label: cur.hidden ? 'Show slide' : 'Hide slide', icon: cur.hidden ? 'view' : 'hide', run: R('hide-slide') },
      { separator: true },
      { label: 'Add section', run: R('section-add') },
      { label: 'Move up', icon: 'up', run: R('slide-move-up') },
      { label: 'Move down', icon: 'down', run: R('slide-move-down') },
      { separator: true },
      { label: 'Format background…', icon: 'palette', run: R('format-background') },
      { label: 'Start slide show from here', icon: 'monitorPlay', run: R('show-current') },
    ];
  }

  highlight() {
    const sel = new Set(this.app.slideSel);
    const cur = this.app.pres.slides[this.app.curIndex]?.id;
    for (const [id, c] of this.cache) {
      c.el.classList.toggle('sel', sel.has(id) || id === cur);
      c.el.classList.toggle('cur', id === cur);
    }
    for (const [id, c] of this.sorterCache) {
      c.el.classList.toggle('sel', sel.has(id) || id === cur);
      c.el.classList.toggle('cur', id === cur);
    }
    this.cache.get(cur ?? '')?.el.scrollIntoView({ block: 'nearest' });
  }

  // ---- selection & drag to reorder ----
  private onDown(e: PointerEvent, s: Slide, sorter = false) {
    if (e.button === 2) return;
    const app = this.app;
    const idx = app.pres.slides.indexOf(s);
    if (e.shiftKey && app.slideSel.length) {
      const a = app.pres.slides.findIndex((x) => x.id === app.slideSel[0]);
      const [lo, hi] = [Math.min(a, idx), Math.max(a, idx)];
      app.slideSel = app.pres.slides.slice(lo, hi + 1).map((x) => x.id);
      app.goto(idx, true);
    } else if (e.ctrlKey || e.metaKey) {
      app.slideSel = app.slideSel.includes(s.id) ? app.slideSel.filter((i) => i !== s.id) : [...app.slideSel, s.id];
      app.goto(idx, true);
    } else if (!app.slideSel.includes(s.id) || app.slideSel.length === 1) {
      app.slideSel = [s.id];
      app.goto(idx, true);
    }
    this.highlight();
    this.list.focus({ preventScroll: true });

    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    const ids = app.slideSel.includes(s.id) ? [...app.slideSel] : [s.id];
    const marker = h('div', { class: sorter ? 'drop-marker v' : 'drop-marker' });
    let target = -1;
    const container = sorter ? this.sorterHost! : this.list;
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
      dragging = true;
      document.body.classList.add('dragging-slides');
      const items = [...container.querySelectorAll<HTMLElement>('.thumb')];
      // find the insertion index by the pointer position
      let best = items.length;
      let bestEl: HTMLElement | null = null;
      for (let i = 0; i < items.length; i++) {
        const r = items[i].getBoundingClientRect();
        const before = sorter ? ev.clientY < r.bottom && ev.clientX < r.left + r.width / 2 && ev.clientY > r.top : ev.clientY < r.top + r.height / 2;
        if (before) {
          best = i;
          bestEl = items[i];
          break;
        }
      }
      target = best;
      marker.remove();
      if (bestEl) bestEl.before(marker);
      else container.append(marker);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('dragging-slides');
      marker.remove();
      if (dragging && target >= 0) app.moveSlides(ids, target);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // -------------------------------------------------------------------------
  // Slide Master view: masters and layouts
  // -------------------------------------------------------------------------
  private refreshMaster() {
    const app = this.app;
    const pres = app.pres;
    const scale = this.thumbScale();
    const rows: HTMLElement[] = [];
    pres.masters.forEach((m) => {
      const key = `m:${m.id}`;
      const c = this.makeThumb(this.cache, key, m, '', scale, true);
      c.el.replaceChildren(h('span', { class: 'num' }, iconEl('layers', 12)), c.frame);
      c.el.title = `${m.name} (slide master)`;
      c.el.classList.toggle('sel', app.masterView?.kind === 'master' && app.masterView.id === m.id);
      c.el.onpointerdown = () => {
        app.masterView = { kind: 'master', id: m.id };
        app.sel = [];
        app.fullRender();
      };
      c.el.oncontextmenu = null;
      rows.push(c.el);
      pres.layouts
        .filter((l) => l.masterId === m.id)
        .forEach((l) => {
          const lk = `l:${l.id}`;
          const lc = this.makeThumb(this.cache, lk, l, '', scale * 0.9, true);
          lc.el.replaceChildren(h('span', { class: 'num small', title: l.name, text: '•' }), lc.frame, h('span', { class: 'lname', text: l.name }));
          lc.el.classList.toggle('sel', app.masterView?.kind === 'layout' && app.masterView.id === l.id);
          lc.el.classList.add('layoutitem');
          lc.el.onpointerdown = () => {
            app.masterView = { kind: 'layout', id: l.id };
            app.sel = [];
            app.fullRender();
          };
          lc.el.oncontextmenu = (e) => {
            e.preventDefault();
            contextMenu(e.clientX, e.clientY, [
              { label: 'Rename layout…', run: () => void app.run('layout-rename', l.id) },
              { label: 'Duplicate layout', run: () => void app.run('layout-duplicate', l.id) },
              { label: 'Delete layout', run: () => void app.run('layout-delete', l.id) },
            ]);
          };
          rows.push(lc.el);
        });
    });
    this.list.replaceChildren(...rows);
  }

  /** leaving master view: forget the master thumbnails */
  resetMasterCache() {
    for (const k of [...this.cache.keys()]) if (/^[ml]:/.test(k)) this.cache.delete(k);
  }

  // -------------------------------------------------------------------------
  // Slide Sorter
  // -------------------------------------------------------------------------
  renderSorter(host: HTMLElement) {
    this.sorterHost = host;
    const app = this.app;
    const pres = app.pres;
    const scale = 220 / pres.size.w;
    const items: HTMLElement[] = [];
    const alive = new Set<string>();
    pres.slides.forEach((s, i) => {
      alive.add(s.id);
      if (s.section !== undefined) items.push(h('div', { class: 'sec wide', text: s.section || 'Untitled Section' }));
      const c = this.makeThumb(this.sorterCache, s.id, s, '', scale, false);
      c.el.replaceChildren(c.frame, h('span', { class: 'num', text: String(i + 1) }));
      c.el.classList.toggle('hidden-slide', !!s.hidden);
      if (s.hidden) c.el.append(h('span', { class: 'badge', title: 'Hidden slide' }, iconEl('hide', 12)));
      if (s.transition && s.transition.type !== 'none') c.el.append(h('span', { class: 'badge tr', title: `Transition: ${s.transition.type}` }, iconEl('transition', 12)));
      if (s.anims?.length) c.el.append(h('span', { class: 'badge anim', title: 'Has animations' }, iconEl('star', 12)));
      c.el.onpointerdown = (e) => this.onDown(e, s, true);
      c.el.ondblclick = () => {
        app.goto(i, true);
        app.showSorter(false);
      };
      c.el.oncontextmenu = (e) => {
        e.preventDefault();
        if (!app.slideSel.includes(s.id)) {
          app.slideSel = [s.id];
          app.goto(i, true);
          this.highlight();
        }
        contextMenu(e.clientX, e.clientY, this.menuItems());
      };
      items.push(c.el);
    });
    for (const key of [...this.sorterCache.keys()]) if (!alive.has(key)) this.sorterCache.delete(key);
    host.replaceChildren(h('div', { class: 'sorter-grid' }, ...items));
    this.highlight();
  }
}
