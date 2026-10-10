// Smoke test: launch, take a screenshot, report errors.
//   node tools/drive.mjs tools/scenarios/smoke.mjs --user-data-dir=<tmp> [file.pptx]
export default async ({ eval: ev, shot, wait, console: logs }) => {
  await wait(1500);
  const info = await ev(`(() => { const a = window.__app; return { slides: a.pres.slides.length, cur: a.curIndex, title: a.doc.name, zoom: a.canvas.zoom, elements: a.container().elements.length } })()`);
  console.log(JSON.stringify(info));
  await shot(process.env.SHOT ?? 'smoke.png');
  console.log('console:', logs().slice(0, 20));
};
