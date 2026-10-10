// Screenshot a few slides of an opened deck.   SHOTS=1,2,3 SHOTDIR=<dir> node tools/drive.mjs tools/scenarios/slides.mjs --user-data-dir=<tmp> <file>
import { join } from 'node:path';
export default async ({ eval: ev, shot, wait, console: logs }) => {
  await wait(1200);
  const total = await ev(`window.__app.pres.slides.length`);
  const wanted = (process.env.SHOTS ?? '1').split(',').map((n) => parseInt(n, 10) - 1).filter((i) => i >= 0 && i < total);
  const dir = process.env.SHOTDIR ?? '.';
  console.log('slides:', total);
  for (const i of wanted) {
    await ev(`window.__app.goto(${i}, true)`);
    await wait(500);
    await shot(join(dir, `slide-${i + 1}.png`));
  }
  console.log('console:', logs().slice(0, 30));
};
