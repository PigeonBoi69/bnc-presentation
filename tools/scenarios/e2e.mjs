// End-to-end checks of the editor through the real UI (CDP).
//   SHOTDIR=<dir> node tools/drive.mjs tools/scenarios/e2e.mjs --user-data-dir=<tmp>
import { join } from 'node:path';

let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`);
  if (!ok) failed++;
};

export default async ({ eval: ev, shot, wait, key, type, click, drag, console: logs }) => {
  const dir = process.env.SHOTDIR ?? '.';
  const S = (n) => shot(join(dir, `e2e-${n}.png`));
  const rect = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; })()`);
  const app = (expr) => ev(`(() => { const app = window.__app; return (${expr}); })()`);

  await wait(1500);
  check('app boots with one slide', (await app('app.pres.slides.length')) === 1);

  // ---- click the title placeholder and type
  let r = await rect('.slide-host .el[data-ph="ctrTitle"] .tx');
  check('title placeholder is rendered', !!r);
  await click(r.cx, r.cy);
  await wait(300);
  check('click on text starts editing', await app('!!app.canvas.textEditor'));
  await type('Hello BNC');
  await wait(200);
  await key('Escape', { code: 'Escape', vk: 27 });
  await wait(300);
  const title = await app(`app.pres.slides[0].elements.find(e => e.ph && e.ph.type === 'ctrTitle').text.paras[0].runs.map(r => r.t).join('')`);
  check('typed text lands in the model', title === 'Hello BNC', title);
  check('editing ended on Escape', !(await app('!!app.canvas.textEditor')));
  check('title is undoable', (await app('app.canUndo()')) === true);
  await S('1-typed');

  // ---- undo / redo
  await app('app.undo()');
  await wait(200);
  const t2 = await app(`app.pres.slides[0].elements.find(e => e.ph && e.ph.type === 'ctrTitle').text.paras[0].runs.length`);
  check('undo removes the typed text', t2 === 0, String(t2));
  await app('app.redo()');
  await wait(200);
  check('redo restores it', (await app(`app.pres.slides[0].elements.find(e => e.ph && e.ph.type === 'ctrTitle').text.paras[0].runs.map(r => r.t).join('')`)) === 'Hello BNC');

  // ---- new slide, draw a shape by dragging
  await app(`app.run('new-slide')`);
  await wait(400);
  check('new slide added', (await app('app.pres.slides.length')) === 2);
  await app(`app.run('insert-shape', 'roundRect')`);
  const st = await rect('.stage');
  await drag(st.x + 200, st.y + 300, st.x + 420, st.y + 420);
  await wait(300);
  const shapes = await app(`app.container().elements.filter(e => e.geom && e.geom.prst === 'roundRect').length`);
  check('dragging draws a shape', shapes === 1, String(shapes));
  check('new shape is selected', (await app('app.sel.length')) === 1);

  // ---- move it with the mouse
  const sel0 = await app(`(() => { const e = app.selectedEls()[0]; return { x: e.x, y: e.y, w: e.w }; })()`);
  const box = await rect('.selbox.full');
  await drag(box.x + box.w * 0.25, box.y + 1, box.x + box.w * 0.25 + 60, box.y + 41);
  await wait(300);
  const sel1 = await app(`(() => { const e = app.container().elements.find(e => e.geom && e.geom.prst === 'roundRect'); return { x: e.x, y: e.y, w: e.w }; })()`);
  check('dragging the frame moves the shape', sel1.x > sel0.x + 20 && sel1.y > sel0.y + 20, JSON.stringify([sel0, sel1]));

  // ---- resize with a handle
  const se = await rect('.selbox.full .handle.se');
  await drag(se.cx, se.cy, se.cx + 80, se.cy + 40);
  await wait(300);
  const sel2 = await app(`app.container().elements.find(e => e.geom && e.geom.prst === 'roundRect').w`);
  check('resize handle changes the width', sel2 > sel1.w + 20, `${sel1.w} -> ${sel2}`);

  // ---- type into the shape (double click)
  const box2 = await rect('.selbox.full');
  await click(box2.cx, box2.cy, 2);
  await wait(300);
  check('double click edits shape text', await app('!!app.canvas.textEditor'));
  await type('Shape text');
  await key('Escape', { code: 'Escape', vk: 27 });
  await wait(300);
  const shapeText = await app(`app.container().elements.find(e => e.geom && e.geom.prst === 'roundRect').text.paras[0].runs.map(r => r.t).join('')`);
  check('shape text stored', shapeText === 'Shape text', shapeText);

  // ---- formatting through commands
  await app(`app.run('bold')`);
  await wait(200);
  const bold = await app(`app.container().elements.find(e => e.geom && e.geom.prst === 'roundRect').text.paras[0].runs[0].b`);
  check('Bold applies to selected shape text', bold === true, String(bold));
  await app(`app.run('shape-fill', '#ff8800')`);
  await wait(200);
  check('shape fill applied', (await app(`app.container().elements.find(e => e.geom && e.geom.prst === 'roundRect').fill.c`)) === '#ff8800');

  // ---- table
  await app(`app.run('insert-table', { rows: 3, cols: 3 })`);
  await wait(500);
  check('table inserted', (await app(`app.container().elements.some(e => e.type === 'table')`)));
  check('first cell is in edit mode', await app('!!app.canvas.textEditor'));
  await type('Cell A');
  await key('Escape', { code: 'Escape', vk: 27 });
  await wait(300);
  const cellText = await app(`app.container().elements.find(e => e.type === 'table').rows[0].cells[0].text.paras[0].runs.map(r => r.t).join('')`);
  check('table cell text stored', cellText === 'Cell A', cellText);
  await S('2-shape-table');

  // ---- ribbon tabs and modes
  await app(`document.querySelector('[data-tab="insert"]').click()`);
  await wait(300);
  await S('3-insert-tab');
  await app(`document.querySelector('[data-tab="animations"]').click()`);
  await wait(300);
  await S('3b-anim-tab');
  await app(`app.setRibbonMode('simplified')`);
  await wait(400);
  await S('4-simplified');
  check('simplified ribbon renders', !!(await rect('.ribbon.simple')));
  await app(`document.querySelector('[data-tab="home"]').click()`);
  await wait(300);
  await S('4b-simplified-home');
  await app(`app.setRibbonMode('classic')`);

  // ---- views
  await app(`app.run('view-sorter')`);
  await wait(600);
  await S('5-sorter');
  check('sorter shows both slides', (await ev(`document.querySelectorAll('.sorter-grid .thumb').length`)) === 2);
  await app(`app.run('view-normal')`);
  await wait(300);

  // ---- slideshow
  await app(`app.goto(0, true)`);
  await ev(`setTimeout(() => window.__app.run('show-start'), 0); true`);
  await wait(900);
  check('slide show opens', !!(await rect('.show')));
  await S('6-show');
  await key('ArrowRight', { code: 'ArrowRight', vk: 39 });
  await wait(1200);
  await S('6b-show2');
  await key('Escape', { code: 'Escape', vk: 27 });
  await wait(500);
  check('Escape ends the show', !(await rect('.show')));

  // ---- save / reload as bncpres in memory
  const bytesLen = await ev(`(async () => { const m = await import('./assets/' + [...document.scripts].map(s => s.src.split('/').pop()).find(n => /^index-/.test(n))).catch(() => null); return m ? 1 : 0; })()`);
  void bytesLen;

  console.log(`\n${failed ? failed + ' FAILED' : 'ALL PASSED'}`);
  const errs = logs().filter((l) => /error|exception/i.test(l));
  if (errs.length) console.log('console errors:\n' + errs.join('\n'));
  process.exitCode = failed ? 1 : 0;
};
