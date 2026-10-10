// BNC Presentation version helper. The app is pre-release, and every time it is updated/rebuilt the version goes up one step:
//   0.1.2 -> 0.1.3 ... 0.1.9 -> 0.2.0 ... 0.9.9 -> 1.0.0       (each part runs 0-9, then rolls over into the next)
//   npx tsx tools/bump-version.ts              bump package.json (and package-lock.json) by one step
//   npx tsx tools/bump-version.ts --set 0.1.3  set an exact version
//   npx tsx tools/bump-version.ts --dry        show what the next version would be
// The version lives in package.json only; the Windows installer, the Linux .deb and the AppImage all use it.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** One step up: add 1 to the last part, carrying into the part before it when a part would pass 9. */
export function nextVersion(version: string): string {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(version.trim());
  if (!m) throw new Error(`"${version}" is not a version like 0.1.2`);
  const parts = [Number(m[1]), Number(m[2]), m[3] === undefined ? undefined : Number(m[3])].filter((p): p is number => p !== undefined);
  let i = parts.length - 1;
  parts[i]++;
  while (i > 0 && parts[i] > 9) {
    parts[i] = 0;
    parts[--i]++;
  }
  return parts.join('.');
}

function writeJson(file: string, data: unknown) {
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const pkgFile = join(root, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8').replace(/^﻿/, ''));
  const args = process.argv.slice(2);
  const setIdx = args.indexOf('--set');
  const next = setIdx >= 0 ? args[setIdx + 1] : nextVersion(pkg.version);
  if (!/^\d+\.\d+\.\d+$/.test(next ?? '')) throw new Error('Use --set with a version like 0.1.3');
  if (args.includes('--dry')) {
    console.log(`${pkg.version} -> ${next} (not written)`);
    return;
  }
  pkg.version = next;
  writeJson(pkgFile, pkg);
  try {
    const lockFile = join(root, 'package-lock.json');
    const lock = JSON.parse(readFileSync(lockFile, 'utf8'));
    lock.version = next;
    if (lock.packages?.['']) lock.packages[''].version = next;
    writeJson(lockFile, lock);
  } catch {
    /* no lockfile */
  }
  console.log(`BNC Presentation version is now ${next}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
