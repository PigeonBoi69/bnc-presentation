// Dev tool: node tools/check-icons.mjs Name1 Name2 ...   -> prints which lucide icon names do not exist.
import * as L from 'lucide';
const want = process.argv.slice(2);
const missing = want.filter((n) => !(n in L));
console.log(missing.length ? 'missing: ' + missing.join(', ') : 'all icons exist');
