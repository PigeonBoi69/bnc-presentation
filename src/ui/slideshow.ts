// The slide show: full-screen playback with slide transitions, animations, a laser pointer and a pen.
import type { App } from '../app';
import { renderSlideInto } from '../core/render';
import type { Anim, Slide } from '../core/model';
import { contextMenu, h } from './dom';

interface Step {
  /** the animations that start together on one click (with start offsets in seconds) */
  items: { anim: Anim; start: number }[];
}

function buildSteps(slide: Slide): Step[] {
  const steps: Step[] = [];
  let prevStart = 0;
  let prevEnd = 0;
  for (const a of slide.anims ?? []) {
    if (a.trigger === 'click' || !steps.length) {
      steps.push({ items: [] });
      prevStart = 0;
      prevEnd = 0;
    }
    const step = steps[steps.length - 1];
    const start = a.trigger === 'after' ? prevEnd + a.delay : a.trigger === 'with' ? prevStart + a.delay : a.delay;
    step.items.push({ anim: a, start });
    prevStart = start;
    prevEnd = start + a.dur;
  }
  return steps;
}

const DIST = (dir: string | undefined, el: HTMLElement, w: number, h_: number) => {
  const x = parseFloat(el.style.left) || 0;
  const y = parseFloat(el.style.top) || 0;
  const ew = parseFloat(el.style.width) || 0;
  const eh = parseFloat(el.style.height) || 0;
  switch (dir) {
    case 'l': return [-(x + ew), 0];
    case 'r': return [w - x, 0];
    case 't': return [0, -(y + eh)];
    default: return [0, h_ - y];
  }
};

function keyframesFor(a: Anim, el: HTMLElement, w: number, hh: number): { frames: Keyframe[]; hide: boolean; easing: string } {
  const out = a.cls === 'exit';
  const rev = (f: Keyframe[]) => (out ? [...f].reverse() : f);
  switch (a.effect) {
    case 'appear':
      return { frames: rev([{ opacity: 0 }, { opacity: 1 }]), hide: out, easing: 'steps(1, end)' };
    case 'fly': {
      const [dx, dy] = DIST(a.dir, el, w, hh);
      return { frames: rev([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0,0)' }]), hide: out, easing: 'ease-out' };
    }
    case 'float':
      return { frames: rev([{ opacity: 0, transform: 'translateY(40px)' }, { opacity: 1, transform: 'translateY(0)' }]), hide: out, easing: 'ease-out' };
    case 'wipe': {
      const from = a.dir === 'r' ? 'inset(0 0 0 100%)' : a.dir === 't' ? 'inset(0 0 100% 0)' : a.dir === 'b' ? 'inset(100% 0 0 0)' : 'inset(0 100% 0 0)';
      return { frames: rev([{ clipPath: from }, { clipPath: 'inset(0 0 0 0)' }]), hide: out, easing: 'linear' };
    }
    case 'split':
      return { frames: rev([{ clipPath: 'inset(0 50% 0 50%)' }, { clipPath: 'inset(0 0 0 0)' }]), hide: out, easing: 'ease-out' };
    case 'zoom':
      return { frames: rev([{ opacity: 0, transform: 'scale(0.2)' }, { opacity: 1, transform: 'scale(1)' }]), hide: out, easing: 'ease-out' };
    case 'wheel':
      return { frames: rev([{ opacity: 0, transform: 'rotate(-180deg) scale(0.3)' }, { opacity: 1, transform: 'rotate(0) scale(1)' }]), hide: out, easing: 'ease-out' };
    case 'bounce':
      return { frames: rev([{ opacity: 0, transform: 'translateY(-300px)', offset: 0 }, { opacity: 1, transform: 'translateY(0)', offset: 0.6 }, { transform: 'translateY(-40px)', offset: 0.78 }, { transform: 'translateY(0)', offset: 0.9 }, { transform: 'translateY(-10px)', offset: 0.96 }, { transform: 'translateY(0)', offset: 1 }]), hide: out, easing: 'ease-in' };
    case 'pulse':
      return { frames: [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], hide: false, easing: 'ease-in-out' };
    case 'spin':
      return { frames: [{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }], hide: false, easing: 'ease-in-out' };
    case 'grow':
      return { frames: [{ transform: 'scale(1)' }, { transform: 'scale(1.5)' }], hide: false, easing: 'ease-in-out' };
    default:
      return { frames: rev([{ opacity: 0 }, { opacity: 1 }]), hide: out, easing: 'linear' };
  }
}

export interface ShowOpts {
  from: number;
  /** only play the transition into slide `from` (used by the ribbon's Preview) */
  previewTransition?: boolean;
  /** play the animations of slide `from` and stop */
  previewAnims?: boolean;
}

export class SlideShow {
  private root: HTMLElement;
  private stage: HTMLElement;
  private bar: HTMLElement;
  private page: HTMLElement | null = null;
  private slides: number[];
  private pos = 0;
  private steps: Step[] = [];
  private stepIdx = 0;
  private busy = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private laser: HTMLElement | null = null;
  private pen: HTMLCanvasElement | null = null;
  private penOn = false;
  private black: HTMLElement | null = null;
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);
  private numBuf = '';
  private scale = 1;
  private offX = 0;
  private offY = 0;
  private onResize = () => this.layoutPage();
  private hideBarTimer: ReturnType<typeof setTimeout> | undefined;
  private finished: () => void = () => {};

  constructor(private app: App, private o: ShowOpts) {
    this.slides = app.pres.slides.map((s, i) => (s.hidden && i !== o.from ? -1 : i)).filter((i) => i >= 0);
    this.pos = Math.max(0, this.slides.indexOf(o.from));
    this.stage = h('div', { class: 'show-stage' });
    this.bar = h('div', { class: 'show-bar' },
      h('button', { text: '‹', title: 'Previous', on: { click: (e) => { e.stopPropagation(); void this.prev(); } } }),
      h('span', { class: 'show-count' }),
      h('button', { text: '›', title: 'Next', on: { click: (e) => { e.stopPropagation(); void this.next(); } } }),
      h('button', { text: '✕', title: 'End show (Esc)', on: { click: (e) => { e.stopPropagation(); this.end(); } } }),
    );
    this.root = h('div', { class: 'show' }, this.stage, this.bar);
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.finished = resolve;
      document.body.append(this.root);
      void window.bnc.setFullscreen(true);
      document.addEventListener('keydown', this.keyHandler, true);
      window.addEventListener('resize', this.onResize);
      this.root.addEventListener('pointerdown', (e) => this.onPointerDown(e));
      this.root.addEventListener('pointermove', (e) => this.onPointerMove(e));
      this.root.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.menu(e.clientX, e.clientY);
      });
      this.root.addEventListener('wheel', (e) => {
        if (e.ctrlKey) return;
        e.preventDefault();
        void (e.deltaY > 0 ? this.next() : this.prev());
      }, { passive: false });
      // let the fullscreen settle before measuring
      setTimeout(() => void this.showSlide(this.slides[this.pos], 'none', true), 120);
    });
  }

  end() {
    clearTimeout(this.timer);
    document.removeEventListener('keydown', this.keyHandler, true);
    window.removeEventListener('resize', this.onResize);
    this.root.querySelectorAll('video,audio').forEach((m) => (m as HTMLMediaElement).pause());
    this.root.remove();
    void window.bnc.setFullscreen(false);
    this.finished();
  }

  // ---- layout ----
  private layoutPage() {
    const { w, h: hh } = this.app.pres.size;
    const vw = this.root.clientWidth || window.innerWidth;
    const vh = this.root.clientHeight || window.innerHeight;
    this.scale = Math.min(vw / w, vh / hh);
    this.offX = (vw - w * this.scale) / 2;
    this.offY = (vh - hh * this.scale) / 2;
    if (this.page) this.page.style.transform = `translate(${this.offX}px, ${this.offY}px) scale(${this.scale})`;
    if (this.pen) {
      this.pen.width = vw;
      this.pen.height = vh;
    }
  }

  private makePage(index: number): HTMLElement {
    const slide = this.app.pres.slides[index];
    const page = h('div', { class: 'show-page' });
    const o = this.app.renderOpts({ playing: true }, slide);
    renderSlideInto(page, slide, o);
    page.classList.add('show-slide');
    page.style.position = 'absolute';
    page.style.left = '0';
    page.style.top = '0';
    page.style.transformOrigin = '0 0';
    page.style.transform = `translate(${this.offX}px, ${this.offY}px) scale(${this.scale})`;
    page.querySelectorAll<HTMLElement>('.layer, .el').forEach((n) => (n.style.pointerEvents = 'auto'));
    return page;
  }

  // ---- slides & transitions ----
  private async showSlide(index: number, how: 'none' | 'next' | 'prev', first = false) {
    if (index === undefined) return this.end();
    this.busy = true;
    clearTimeout(this.timer);
    const slide = this.app.pres.slides[index];
    this.layoutPage();
    const old = this.page;
    const wrap = h('div', { class: 'show-wrap' });
    const page = this.makePage(index);
    wrap.append(page);
    this.page = page;
    this.steps = buildSteps(slide);
    this.stepIdx = 0;
    this.prepareAnimations(page, slide, how === 'prev');
    if (this.pen) this.pen.getContext('2d')?.clearRect(0, 0, this.pen.width, this.pen.height);
    const oldWrap = old?.parentElement as HTMLElement | null;
    this.stage.append(wrap);
    this.bar.querySelector('.show-count')!.textContent = `${this.slides.indexOf(index) + 1} / ${this.slides.length}`;
    const tr = how === 'prev' ? this.app.pres.slides[this.slides[this.pos + 1] ?? index].transition : slide.transition;
    if (!first && how !== 'none' && oldWrap && tr && tr.type !== 'none' && tr.type !== 'cut') await this.transition(oldWrap, wrap, tr.type, tr.dir, tr.dur ?? 0.7, how === 'prev');
    oldWrap?.remove();
    this.stage.querySelectorAll('.show-wrap').forEach((w) => w !== wrap && w.remove());
    this.startMedia(page, slide);
    this.busy = false;
    this.armTimer(slide);
    if (this.o.previewAnims && first) setTimeout(() => void this.playAll(), 400);
    if (this.o.previewTransition && first) this.o.previewTransition = false;
    this.root.focus();
  }

  private armTimer(slide: Slide) {
    const useTimings = this.app.pres.show?.useTimings !== false;
    const adv = slide.transition?.advAfter;
    if (useTimings && adv && adv > 0 && !this.steps.length && !this.o.previewAnims) this.timer = setTimeout(() => void this.next(), adv * 1000);
  }

  private startMedia(page: HTMLElement, slide: Slide) {
    for (const el of slide.elements) {
      if (el.type !== 'media' || !el.autoplay) continue;
      const m = page.querySelector(`.el[data-id="${CSS.escape(el.id)}"] video, .el[data-id="${CSS.escape(el.id)}"] audio`) as HTMLMediaElement | null;
      m?.play().catch(() => {});
    }
  }

  private async transition(oldWrap: HTMLElement, newWrap: HTMLElement, type: string, dir: string | undefined, dur: number, reverse: boolean) {
    const W = this.root.clientWidth;
    const H = this.root.clientHeight;
    const ms = Math.max(120, dur * 1000);
    const opt: KeyframeAnimationOptions = { duration: ms, easing: 'ease-in-out', fill: 'both' };
    const d = (reverse ? ({ l: 'r', r: 'l', t: 'b', b: 't' } as Record<string, string>)[dir ?? 'l'] : dir) ?? 'r';
    const vec = (dd: string): [number, number] => (dd === 'l' ? [-W, 0] : dd === 'r' ? [W, 0] : dd === 't' ? [0, -H] : [0, H]);
    const from = ({ l: 'inset(0 0 0 100%)', r: 'inset(0 100% 0 0)', t: 'inset(100% 0 0 0)', b: 'inset(0 0 100% 0)' } as Record<string, string>)[d] ?? 'inset(0 100% 0 0)';
    newWrap.style.zIndex = '2';
    oldWrap.style.zIndex = '1';
    const anims: Animation[] = [];
    switch (type) {
      case 'push': {
        // the new slide enters from the side the dir names; the old one leaves the opposite way
        const [vx, vy] = vec(({ l: 'r', r: 'l', t: 'b', b: 't' } as Record<string, string>)[d] ?? 'r');
        anims.push(newWrap.animate([{ transform: `translate(${-vx}px, ${-vy}px)` }, { transform: 'translate(0,0)' }], opt));
        anims.push(oldWrap.animate([{ transform: 'translate(0,0)' }, { transform: `translate(${vx}px, ${vy}px)` }], opt));
        break;
      }
      case 'cover': {
        const [vx, vy] = vec(({ l: 'r', r: 'l', t: 'b', b: 't' } as Record<string, string>)[d] ?? 'r');
        anims.push(newWrap.animate([{ transform: `translate(${-vx}px, ${-vy}px)` }, { transform: 'translate(0,0)' }], opt));
        break;
      }
      case 'pull': {
        newWrap.style.zIndex = '1';
        oldWrap.style.zIndex = '2';
        const [vx, vy] = vec(d);
        anims.push(oldWrap.animate([{ transform: 'translate(0,0)' }, { transform: `translate(${vx}px, ${vy}px)` }], opt));
        break;
      }
      case 'wipe':
        anims.push(newWrap.animate([{ clipPath: from }, { clipPath: 'inset(0 0 0 0)' }], opt));
        break;
      case 'split':
        anims.push(newWrap.animate([{ clipPath: dir === 'vert' ? 'inset(50% 0 50% 0)' : 'inset(0 50% 0 50%)' }, { clipPath: 'inset(0 0 0 0)' }], opt));
        break;
      case 'zoom':
        if (dir === 'out') {
          newWrap.style.zIndex = '1';
          oldWrap.style.zIndex = '2';
          anims.push(oldWrap.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(2)', opacity: 0 }], opt));
        } else anims.push(newWrap.animate([{ transform: 'scale(0.15)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], opt));
        break;
      default:
        anims.push(newWrap.animate([{ opacity: 0 }, { opacity: 1 }], opt));
    }
    await Promise.all(anims.map((a) => a.finished.catch(() => {})));
    anims.forEach((a) => a.cancel());
  }

  // ---- animations ----
  private elOf(page: HTMLElement, id: string): HTMLElement | null {
    return page.querySelector(`.layer.content > .el[data-id="${CSS.escape(id)}"]`);
  }

  private prepareAnimations(page: HTMLElement, slide: Slide, finished: boolean) {
    if (finished) {
      // coming back: show the slide as it ends
      for (const a of slide.anims ?? []) {
        const el = this.elOf(page, a.target);
        if (el && a.cls === 'exit') el.style.visibility = 'hidden';
      }
      this.stepIdx = this.steps.length;
      return;
    }
    for (const a of slide.anims ?? []) {
      const el = this.elOf(page, a.target);
      if (el && a.cls === 'entr') el.style.visibility = 'hidden';
    }
  }

  private async playStep(step: Step) {
    const { w, h: hh } = this.app.pres.size;
    const page = this.page!;
    const runs = step.items.map(({ anim, start }) => {
      const el = this.elOf(page, anim.target);
      if (!el) return Promise.resolve();
      const { frames, hide, easing } = keyframesFor(anim, el, w, hh);
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          el.style.visibility = 'visible';
          const a = el.animate(frames, { duration: Math.max(1, anim.dur * 1000), easing, fill: 'both' });
          a.finished.then(() => {
            a.cancel();
            el.style.visibility = hide ? 'hidden' : 'visible';
            resolve();
          }).catch(() => resolve());
        }, start * 1000);
      });
    });
    await Promise.all(runs);
  }

  private async playAll() {
    while (this.stepIdx < this.steps.length) {
      await this.playStep(this.steps[this.stepIdx++]);
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  // ---- navigation ----
  async next() {
    if (this.busy) return;
    if (this.black) return this.clearBlack();
    if (this.stepIdx < this.steps.length) {
      this.busy = true;
      await this.playStep(this.steps[this.stepIdx++]);
      this.busy = false;
      // a following "after previous" chain continues by itself; nothing else to do
      return;
    }
    if (this.o.previewAnims || this.o.previewTransition) return this.end();
    if (this.pos < this.slides.length - 1) {
      this.pos++;
      await this.showSlide(this.slides[this.pos], 'next');
    } else if (this.app.pres.show?.loop) {
      this.pos = 0;
      await this.showSlide(this.slides[0], 'next');
    } else this.end();
  }

  async prev() {
    if (this.busy) return;
    if (this.pos > 0) {
      this.pos--;
      await this.showSlide(this.slides[this.pos], 'prev');
    }
  }

  private async goTo(slideIndex: number) {
    const p = this.slides.indexOf(slideIndex);
    if (p < 0 || this.busy) return;
    this.pos = p;
    await this.showSlide(slideIndex, 'none');
  }

  // ---- input ----
  private onKey(e: KeyboardEvent) {
    const k = e.key;
    if (e.ctrlKey && k.toLowerCase() === 'l') {
      e.preventDefault();
      e.stopPropagation();
      return this.toggleLaser();
    }
    if (e.ctrlKey && k.toLowerCase() === 'p') {
      e.preventDefault();
      e.stopPropagation();
      return this.togglePen();
    }
    if (e.ctrlKey || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    if (k === 'Escape') return this.penOn || this.laser ? (this.laser?.remove(), (this.laser = null), this.penOn && this.togglePen()) : this.end();
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === ' ' || k === 'Enter' || k === 'PageDown' || k.toLowerCase() === 'n') {
      if (k === 'Enter' && this.numBuf) {
        const n = parseInt(this.numBuf, 10) - 1;
        this.numBuf = '';
        return void this.goTo(n);
      }
      return void this.next();
    }
    if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'Backspace' || k === 'PageUp' || k.toLowerCase() === 'p') return void this.prev();
    if (k === 'Home') return void this.goTo(this.slides[0]);
    if (k === 'End') return void this.goTo(this.slides[this.slides.length - 1]);
    if (k.toLowerCase() === 'b' || k === '.') return this.blackout('#000');
    if (k.toLowerCase() === 'w' || k === ',') return this.blackout('#fff');
    if (k.toLowerCase() === 'e') return void this.pen?.getContext('2d')?.clearRect(0, 0, this.pen.width, this.pen.height);
    if (/^\d$/.test(k)) this.numBuf += k;
  }

  private onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (this.penOn) return this.penStart(e);
    if (t.closest('.show-bar')) return;
    const link = t.closest('.lnk') as HTMLElement | null;
    const hot = t.closest('[data-link]') as HTMLElement | null;
    if (link?.dataset.href) {
      e.stopPropagation();
      return void this.followLink(link.dataset.href);
    }
    if (hot?.dataset.link) return void this.followLink(hot.dataset.link);
    if (t.closest('video, audio')) return;
    void this.next();
  }

  private async followLink(href: string) {
    if (href.startsWith('slide:')) {
      const idx = this.app.pres.slides.findIndex((s) => s.id === href.slice(6));
      if (idx >= 0) {
        if (!this.slides.includes(idx)) this.slides.push(idx);
        return void this.goTo(idx);
      }
      return;
    }
    await window.bnc.openExternal(href);
  }

  private onPointerMove(e: PointerEvent) {
    this.bar.classList.add('on');
    clearTimeout(this.hideBarTimer);
    this.hideBarTimer = setTimeout(() => this.bar.classList.remove('on'), 1800);
    if (this.laser) {
      this.laser.style.left = `${e.clientX}px`;
      this.laser.style.top = `${e.clientY}px`;
    }
  }

  private toggleLaser() {
    if (this.laser) {
      this.laser.remove();
      this.laser = null;
      return;
    }
    this.laser = h('div', { class: 'laser' });
    this.root.append(this.laser);
    this.root.style.cursor = 'none';
  }

  private togglePen() {
    this.penOn = !this.penOn;
    if (this.penOn && !this.pen) {
      this.pen = h('canvas', { class: 'show-pen' });
      this.root.append(this.pen);
      this.layoutPage();
    }
    this.root.style.cursor = this.penOn ? 'crosshair' : '';
    if (this.pen) this.pen.style.pointerEvents = 'none';
  }

  private penStart(e: PointerEvent) {
    const c = this.pen!;
    const ctx = c.getContext('2d')!;
    ctx.strokeStyle = '#ff2b4a';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(e.clientX, e.clientY);
    const move = (ev: PointerEvent) => {
      ctx.lineTo(ev.clientX, ev.clientY);
      ctx.stroke();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  private blackout(color: string) {
    if (this.black) return this.clearBlack();
    this.black = h('div', { class: 'show-black', style: { background: color } });
    this.root.append(this.black);
  }
  private clearBlack() {
    this.black?.remove();
    this.black = null;
  }

  private menu(x: number, y: number) {
    contextMenu(x, y, [
      { label: 'Next', run: () => void this.next() },
      { label: 'Previous', run: () => void this.prev() },
      { label: 'Go to slide', sub: this.slides.map((i) => ({ label: `${i + 1}. ${this.app.slideTitleOf(this.app.pres.slides[i]) || 'Slide ' + (i + 1)}`, run: () => void this.goTo(i) })) },
      { separator: true },
      { label: 'Laser pointer', shortcut: 'Ctrl+L', run: () => this.toggleLaser() },
      { label: 'Pen', shortcut: 'Ctrl+P', run: () => this.togglePen() },
      { label: 'Black screen', shortcut: 'B', run: () => this.blackout('#000') },
      { separator: true },
      { label: 'End show', shortcut: 'Esc', run: () => this.end() },
    ]);
  }
}

export async function startShow(app: App, o: ShowOpts) {
  app.canvas.endTextEdit();
  const show = new SlideShow(app, o);
  await show.start();
  app.goto(app.curIndex, true);
}
