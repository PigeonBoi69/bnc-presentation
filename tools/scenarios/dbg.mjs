export default async ({ eval: ev, wait, drag, console: logs }) => {
  await wait(1500);
  const app = (expr) => ev(`(() => { const app = window.__app; return (${expr}); })()`);
  const st = await ev(`(() => { const r = document.querySelector('.stage').getBoundingClientRect(); return { x: r.left, y: r.top }; })()`);
  await ev(`window.__app.run('tool-pen', 'pen'); true`);
  await drag(st.x + 300, st.y + 300, st.x + 500, st.y + 360, 14);
  await wait(300);
  await ev(`window.__app.run('tool-eraser'); true`);
  console.log('tool', await app('JSON.stringify(app.tool)'));
  await ev(`window.__log = []; window.addEventListener('pointerdown', e => window.__log.push('down ' + e.target.tagName + ' ' + (e.target.className.baseVal ?? e.target.className)), true)`);
  await drag(st.x + 300, st.y + 300, st.x + 500, st.y + 360, 14);
  await wait(300);
  console.log('ink count after erase', await app(`app.container().elements.filter(e => e.ink).length`));
  console.log(await ev('window.__log'));
  console.log(logs());
};
