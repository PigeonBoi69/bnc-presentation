// Checks that the shared .bnctheme plugins load for every BNC app:  npx tsx tools/verify-plugin.mts [folder with the .bnctheme files]
// (default: the bnc-plugins repository checked out next to this one, ../bnc-plugins)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTheme } from '../electron/themes';

const dir = process.argv[2] ?? join(__dirname, '..', '..', 'bnc-plugins');
for (const f of ['red', 'orange', 'yellow', 'green', 'blue', 'pink', 'purple', 'brown', 'black', 'grey']) {
  for (const app of ['bnc-ambient', 'bnc-docs', 'bnc-presentation']) {
    const t = parseTheme(readFileSync(join(dir, `${f}.bnctheme`)), app);
    console.log(f, app, 'applies:', t.appliesHere, 'accent:', t.accent, 'ink:', t.accentInk, 'icon bytes:', t.iconPng?.length);
  }
}
