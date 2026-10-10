// Dev tool: import a .pptx and print what the importer found.   npx tsx tools/inspect-pptx.ts <file.pptx> [--json]
import { readFileSync } from 'node:fs';
import { importPptx } from '../src/core/pptx-import';
import { plainText, allElements } from '../src/core/model';

const file = process.argv[2];
if (!file) throw new Error('usage: inspect-pptx <file.pptx>');
const t0 = Date.now();
const r = await importPptx(new Uint8Array(readFileSync(file)));
console.log(`${file}\n  ${r.pres.slides.length} slides, ${r.pres.layouts.length} layouts, ${r.pres.masters.length} masters, ${r.media.size} media, ${r.pres.size.w}x${r.pres.size.h}pt, ${Date.now() - t0}ms`);
r.pres.slides.forEach((s, i) => {
  const els = allElements(s.elements);
  const kinds: Record<string, number> = {};
  for (const e of els) kinds[e.type] = (kinds[e.type] ?? 0) + 1;
  const title = els.find((e) => e.type === 'shape' && e.ph && /title/i.test(e.ph.type));
  console.log(`  ${i + 1}. ${JSON.stringify(kinds)}${s.anims ? ` anims=${s.anims.length}` : ''}${s.transition ? ` tr=${s.transition.type}` : ''} ${title && title.type === 'shape' ? '"' + plainText(title.text).slice(0, 50) + '"' : ''}`);
});
if (r.warnings.length) console.log('WARNINGS:\n  ' + r.warnings.join('\n  '));
if (process.argv.includes('--json')) console.log(JSON.stringify(r.pres, null, 1).slice(0, 20000));
