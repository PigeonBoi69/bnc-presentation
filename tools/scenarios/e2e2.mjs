// More end-to-end checks: master view, ink, charts, find, links, footers, backgrounds, files and exports.
//   BNC_TEST_DIR=<dir> SHOTDIR=<dir> node tools/drive.mjs tools/scenarios/e2e2.mjs --user-data-dir=<tmp>
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`);
  if (!ok) failed++;
};

export default async ({ eval: ev, shot, wait, key, type, click, drag, console: logs }) => {
  const dir = process.env.SHOTDIR ?? '.';
  const out = process.env.BNC_TEST_DIR;
  const S = (n) => shot(join(dir, `e2e2-${n}.png`));
  const rect = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; })()`);
  const app = (expr) => ev(`(() => { const app = window.__app; return (${expr}); })()`);
  const now = (cmd) => ev(`setTimeout(() => window.__app.run(${JSON.stringify(cmd)}), 0); true`);

  await wait(1500);

  // ---- type a title, then link + find
  await app(`app.canvas.startTextEdit(app.curSlide().elements[0].id, 'end')`);
  await type('Find me please');
  await key('Escape', { code: 'Escape', vk: 27 });
  await wait(200);
  await now('find');
  await wait(300);
  await type('please');
  await wait(300);
  const count = await ev(`document.querySelector('.findbar .count').textContent`);
  check('find reports a match', /1 of 1/.test(count), count);
  await key('Escape', { code: 'Escape', vk: 27 });

  // ---- master view
  await app(`app.run('master-open')`);
  await wait(600);
  check('master view opens', await app('!!app.masterView'));
  check('slide master tab appears', !!(await rect('[data-tab="master"]')));
  const layoutCount = await app('app.pres.layouts.length');
  await app(`app.insertShape('ellipse', {x: 20, y: 20, w: 60, h: 60})`);
  await wait(200);
  await S('1-master');
  await app(`app.run('master-close')`);
  await wait(500);
  check('master view closes', !(await app('!!app.masterView')));
  const layoutHasShape = await app(`app.pres.layouts.find(l => l.id === app.curSlide().layoutId).elements.some(e => e.geom && e.geom.prst === 'ellipse')`);
  check('shape added in master view lives on the layout', layoutHasShape);
  check('layout shape renders on the slide', (await ev(`document.querySelectorAll('.slide-host .layer.layout .el').length`)) > 0);
  void layoutCount;

  // ---- pen / eraser
  await app(`app.run('tool-pen', 'pen')`);
  const st = await rect('.stage');
  await drag(st.x + 300, st.y + 300, st.x + 500, st.y + 360, 14);
  await wait(300);
  check('pen creates ink', (await app(`app.container().elements.filter(e => e.ink).length`)) === 1);
  await app(`app.run('tool-eraser')`);
  await drag(st.x + 300, st.y + 300, st.x + 500, st.y + 360, 14);
  await wait(300);
  check('eraser removes ink', (await app(`app.container().elements.filter(e => e.ink).length`)) === 0);
  await app(`app.setTool(null)`);

  // ---- chart, icon
  await app(`app.run('insert-chart', 'col')`);
  await wait(500);
  check('chart inserted', await app(`app.container().elements.some(e => e.type === 'chart')`));
  check('chart renders bars', (await ev(`document.querySelectorAll('.slide-host .ch svg rect').length`)) > 5);
  await S('2-chart-dialog');
  await ev(`[...document.querySelectorAll('.modal-footer button')].find(b => b.textContent === 'OK').click()`);
  await wait(300);
  await app(`app.run('insert-icon', 'Heart')`);
  await wait(300);
  check('icon inserted as editable shape', await app(`app.container().elements.some(e => e.name && e.name.startsWith('Graphic'))`));

  // ---- footers
  await app(`app.mutate('x', () => { app.pres.footer = { slideNum: true, date: false, footer: true, footerText: 'BNC deck', skipTitle: false }; })`);
  await ev(`(async () => { const m = window.__app; })()`);
  await now('header-footer');
  await wait(400);
  await ev(`[...document.querySelectorAll('.modal-footer button')].find(b => b.textContent === 'Apply to All').click()`);
  await wait(400);
  check('footers apply to slides', await app(`app.pres.slides[0].elements.some(e => e.ph && e.ph.type === 'sldNum')`));

  // ---- background
  await now('format-background');
  await wait(300);
  await ev(`[...document.querySelectorAll('.modal-footer button')].find(b => b.textContent === 'Apply').click()`);
  await wait(300);
  check('background dialog applies', await app(`!!app.curSlide().bg`));

  // ---- slide size
  await app(`app.run('slide-size', 'standard')`);
  await wait(500);
  check('slide size changes', (await app('app.pres.size.w')) === 720);
  await app(`app.undo()`);
  await wait(300);
  check('slide size undo', (await app('app.pres.size.w')) === 960);

  // ---- transitions & animations
  await app(`app.newSlide()`);
  await wait(300);
  await app(`app.run('transition', 'push')`);
  check('transition set', (await app(`app.curSlide().transition && app.curSlide().transition.type`)) === 'push');
  await ev(`(() => { const a = window.__app; a.sel = [a.curSlide().elements[0].id]; a.run('anim-set', { effect: 'fade', cls: 'entr' }); })()`);
  await wait(200);
  check('animation added', (await app(`app.curSlide().anims && app.curSlide().anims.length`)) === 1);
  await key('Escape', { code: 'Escape', vk: 27 });
  await wait(1500);
  await key('Escape', { code: 'Escape', vk: 27 });
  await wait(400);

  // ---- save and reopen (.bncpres), export .pptx
  if (out) {
    await ev(`(async () => { const a = window.__app; a.doc.name = 'e2e-deck'; await a.saveAs(); })()`);
    await wait(800);
    const bnc = join(out, 'e2e-deck.bncpres');
    check('bncpres file written', existsSync(bnc) && statSync(bnc).size > 1000, bnc);
    const slidesBefore = await app('app.pres.slides.length');
    await ev(`(async () => { const a = window.__app; const f = await window.bnc.readFile(${JSON.stringify(bnc.replace(/\\/g, '/'))}); await a.loadFile(f); })()`);
    await wait(800);
    check('bncpres reopens with the same slides', (await app('app.pres.slides.length')) === slidesBefore);
    check('bncpres keeps the ink-free layout shape', await app(`app.pres.layouts.some(l => l.elements.some(e => e.geom && e.geom.prst === 'ellipse'))`));

    await ev(`(async () => { await window.__app.exportAs('pptx'); await window.__app.exportAs('pdf'); await window.__app.exportAs('html'); await window.__app.exportAs('md'); await window.__app.exportAs('png'); })()`);
    await wait(4000);
    for (const f of ['e2e-deck.pptx', 'e2e-deck.pdf', 'e2e-deck.html', 'e2e-deck.md']) check(`export ${f}`, existsSync(join(out, f)) && statSync(join(out, f)).size > 500, f);
    check('png export', existsSync(join(out, 'e2e-deck-01.png')), 'e2e-deck-01.png');
    const pdf = existsSync(join(out, 'e2e-deck.pdf')) ? readFileSync(join(out, 'e2e-deck.pdf')) : Buffer.alloc(0);
    check('pdf has one page per slide', (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length === (await app('app.pres.slides.length')), String((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length));
  }

  console.log(`\n${failed ? failed + ' FAILED' : 'ALL PASSED'}`);
  const errs = logs().filter((l) => /error|exception/i.test(l));
  if (errs.length) console.log('console errors:\n' + errs.join('\n'));
  process.exitCode = failed ? 1 : 0;
};
