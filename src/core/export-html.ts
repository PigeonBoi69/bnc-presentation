// HTML built for exports: PDF pages, slide pictures, and a self-contained web slide show.
import { mediaDataUri } from './media';
import { slideHtmlString, type RenderOpts } from './render';
import { esc } from './text';
import type { Deck, Slide } from './model';

const cache = new WeakMap<Deck['media'], Map<string, string | undefined>>();

function dataUriResolver(deck: Deck) {
  let c = cache.get(deck.media);
  if (!c) cache.set(deck.media, (c = new Map()));
  const map = c;
  return (id: string) => {
    if (!map.has(id)) map.set(id, mediaDataUri(deck.media, id));
    return map.get(id);
  };
}

function opts(deck: Deck, slide: Slide, i: number, media: (id: string) => string | undefined, extra: Partial<RenderOpts> = {}): RenderOpts {
  return { pres: deck.pres, media, slideNumber: i + (deck.pres.firstSlideNumber ?? 1), slideCount: deck.pres.slides.length, date: new Date().toLocaleDateString(), ...extra };
}

const visible = (deck: Deck) => deck.pres.slides.map((s, i) => ({ s, i })).filter(({ s }) => !s.hidden);

/** One printable page per (non-hidden) slide, 13.33 x 7.5 in for a 16:9 deck. */
export function buildPdfHtml(deck: Deck, slideCss: string): string {
  const { w, h } = deck.pres.size;
  const k = 96 / 72;
  const media = dataUriResolver(deck);
  const pages = visible(deck)
    .map(({ s, i }) => `<div class="pg">${slideHtmlString(s, opts(deck, s, i, media, { playing: false }))}</div>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page{size:${Math.round(w * k)}px ${Math.round(h * k)}px;margin:0}
html,body{margin:0;padding:0;background:#fff}
.pg{width:${Math.round(w * k)}px;height:${Math.round(h * k)}px;overflow:hidden;page-break-after:always;break-after:page;position:relative}
.pg .slide{transform:scale(${k});transform-origin:0 0}
${slideCss}
</style></head><body>${pages}</body></html>`;
}

/** One HTML page per slide, sized for a screenshot at pxPerPt pixels per slide point. */
export function buildImagePages(deck: Deck, slideCss: string, pxPerPt: number, only?: number[]): { pages: string[]; width: number; height: number } {
  const { w, h } = deck.pres.size;
  const media = dataUriResolver(deck);
  const width = Math.round(w * pxPerPt);
  const height = Math.round(h * pxPerPt);
  const list = only ? only.map((i) => ({ s: deck.pres.slides[i], i })) : visible(deck);
  const pages = list.map(({ s, i }) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden;background:#fff}
.pg{width:${width}px;height:${height}px;overflow:hidden;position:relative}.pg .slide{transform:scale(${pxPerPt});transform-origin:0 0}${slideCss}</style></head><body><div class="pg">${slideHtmlString(s, opts(deck, s, i, media))}</div></body></html>`);
  return { pages, width, height };
}

/** A single self-contained .html file that plays the deck in any browser. */
export function buildSlideshowHtml(deck: Deck, slideCss: string, title: string): string {
  const { w, h } = deck.pres.size;
  const used = new Map<string, string>();
  const media = (id: string) => {
    if (!used.has(id)) {
      const uri = mediaDataUri(deck.media, id);
      if (!uri) return undefined;
      used.set(id, uri);
    }
    return `bncmedia:${id}`;
  };
  const slides = visible(deck)
    .map(({ s, i }) => `<section class="s" data-tr="${esc(s.transition?.type ?? 'none')}" data-adv="${s.transition?.advAfter ?? ''}">${slideHtmlString(s, opts(deck, s, i, media, { playing: true }))}</section>`)
    .join('\n');
  const table = JSON.stringify(Object.fromEntries(used));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
html,body{margin:0;height:100%;background:#000;overflow:hidden;font-family:system-ui,sans-serif}
#stage{position:absolute;left:0;top:0;width:${w}px;height:${h}px;transform-origin:0 0}
.s{position:absolute;left:0;top:0;width:${w}px;height:${h}px;opacity:0;pointer-events:none;transition:opacity .45s ease;overflow:hidden}
.s.on{opacity:1;pointer-events:auto}
#bar{position:fixed;left:0;right:0;bottom:0;height:3px;background:rgba(255,255,255,.15)}#bar i{display:block;height:100%;background:#2dd4bf;width:0;transition:width .3s}
#hint{position:fixed;right:12px;bottom:10px;color:#fff8;font-size:12px}
${slideCss}
</style></head><body><div id="stage">${slides}</div><div id="bar"><i></i></div><div id="hint">← → to navigate · F for full screen</div>
<script>
(function(){
var M=${table};
document.querySelectorAll('[src^="bncmedia:"],image[href^="bncmedia:"]').forEach(function(e){var a=e.hasAttribute('src')?'src':'href';e.setAttribute(a,M[e.getAttribute(a).slice(9)]||'')});
document.querySelectorAll('[style*="bncmedia:"]').forEach(function(e){e.setAttribute('style',e.getAttribute('style').replace(/bncmedia:([\\w.-]+)/g,function(_,id){return M[id]||''}))});
var S=[].slice.call(document.querySelectorAll('.s')),i=0,st=document.getElementById('stage'),bar=document.querySelector('#bar i'),timer;
function fit(){var k=Math.min(innerWidth/${w},innerHeight/${h});st.style.transform='translate('+((innerWidth-${w}*k)/2)+'px,'+((innerHeight-${h}*k)/2)+'px) scale('+k+')'}
function show(n){if(n<0||n>=S.length)return;S[i].classList.remove('on');i=n;S[i].classList.add('on');bar.style.width=((i+1)/S.length*100)+'%';clearTimeout(timer);var a=parseFloat(S[i].dataset.adv);if(a>0&&i<S.length-1)timer=setTimeout(function(){show(i+1)},a*1000)}
addEventListener('keydown',function(e){if(e.key==='ArrowRight'||e.key==='ArrowDown'||e.key===' '||e.key==='PageDown'||e.key==='Enter')show(i+1);else if(e.key==='ArrowLeft'||e.key==='ArrowUp'||e.key==='PageUp'||e.key==='Backspace')show(i-1);else if(e.key==='Home')show(0);else if(e.key==='End')show(S.length-1);else if(e.key==='f'||e.key==='F'){document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen()}});
addEventListener('click',function(e){if(e.target.closest&&e.target.closest('a,video,audio'))return;show(i+(e.clientX<innerWidth*0.2?-1:1))});
addEventListener('resize',fit);fit();show(0);
})();
</script></body></html>`;
}
