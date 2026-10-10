// electron-builder "afterPack" hook: ad-hoc signs the macOS app.
//
// Why: Apple Silicon Macs will not run a modified app bundle that has no valid signature at all. We have no Apple
// Developer certificate, so the app is signed "ad-hoc" (no identity). That makes it run, but it is NOT notarized, so on
// first launch macOS shows its "unidentified developer" warning (right-click > Open once, see README).
//
// How: on macOS the built-in `codesign` is used. When building on Windows/Linux (tools/build-mac.ps1 runs this inside a
// Linux container) the open-source `rcodesign` (apple-codesign) is used; its path comes from $RCODESIGN.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);

  if (process.platform === 'darwin') {
    console.log(`  • ad-hoc signing with codesign  app=${appPath}`);
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
    return;
  }

  const rcodesign = process.env.RCODESIGN;
  if (!rcodesign) {
    console.warn('  • WARNING: RCODESIGN is not set, so the macOS app was NOT signed. It will not start on Apple Silicon.');
    return;
  }
  console.log(`  • ad-hoc signing with rcodesign  app=${appPath}`);
  execFileSync(rcodesign, ['sign', appPath], { stdio: 'inherit' });
};
