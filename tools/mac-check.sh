#!/bin/bash
# Runs INSIDE a container (see tools/mac-check.ps1). Looks inside release-mac\*.zip and checks what can be checked
# without a Mac: how the zip stores symlinks, CPU architecture of the executables, Info.plist, the ad-hoc signature,
# the icon and the packed app.
set -uo pipefail
RC=$(ls -d /root/tools/rcodesign-*/rcodesign 2>/dev/null | head -1)
FAIL=0

for ZIP in /pkg/*.zip; do
  NAME=$(basename "$ZIP")
  echo "=================================================================="
  echo "== $NAME ($(du -h "$ZIP" | cut -f1))"

  echo "-- zip contents:"
  python3 - "$ZIP" <<'PY'
import sys, zipfile, stat
z = zipfile.ZipFile(sys.argv[1])
infos = z.infolist()
links = [i for i in infos if stat.S_ISLNK(i.external_attr >> 16)]
execs = [i for i in infos if (i.external_attr >> 16) & 0o111 and not stat.S_ISLNK(i.external_attr >> 16) and not i.is_dir()]
total = sum(i.file_size for i in infos); packed = sum(i.compress_size for i in infos)
print(f'   {len(infos)} entries, {len(links)} symbolic links kept as links, {len(execs)} executable files')
print(f'   uncompressed {total/1048576:.0f} MB -> in zip {packed/1048576:.0f} MB')
cur = [i.filename for i in links if i.filename.endswith('Versions/Current')]
print('   framework "Versions/Current" links:', 'present' if cur else 'MISSING (the app would be broken)')
if not cur or not links: sys.exit(3)
PY
  [ $? -ne 0 ] && FAIL=1

  D=$(mktemp -d)
  python3 - "$ZIP" "$D" <<'PY'
import sys, zipfile, os, stat
# extract like unzip does, keeping symlinks and permissions
z = zipfile.ZipFile(sys.argv[1]); out = sys.argv[2]
for i in z.infolist():
    p = os.path.join(out, i.filename)
    mode = i.external_attr >> 16
    if i.is_dir(): os.makedirs(p, exist_ok=True); continue
    os.makedirs(os.path.dirname(p), exist_ok=True)
    if stat.S_ISLNK(mode):
        if os.path.lexists(p): os.remove(p)
        os.symlink(z.read(i).decode(), p)
    else:
        open(p, 'wb').write(z.read(i))
        if mode & 0o111: os.chmod(p, 0o755)
PY
  APP=$(find "$D" -maxdepth 2 -name '*.app' -type d | head -1)
  echo "app bundle: $(basename "$APP")"
  BIN="$APP/Contents/MacOS/$(basename "$APP" .app)"

  echo "-- executable:"
  python3 - "$BIN" <<'PY'
import sys, struct
h = open(sys.argv[1], 'rb').read(8)
magic, cpu = struct.unpack('<II', h)
names = {0x0100000c: 'arm64 (Apple Silicon)', 0x01000007: 'x86_64 (Intel)'}
print('   Mach-O 64-bit' if magic == 0xfeedfacf else f'   NOT a Mach-O file (magic {magic:#x})', '|', names.get(cpu, f'cpu {cpu:#x}'))
PY

  echo "-- Info.plist:"
  python3 - "$APP/Contents/Info.plist" <<'PY'
import plistlib, sys
p = plistlib.load(open(sys.argv[1], 'rb'))
for k in ['CFBundleIdentifier','CFBundleName','CFBundleShortVersionString','CFBundleVersion','CFBundleExecutable','CFBundleIconFile','LSMinimumSystemVersion','LSApplicationCategoryType']: print(f'   {k} = {p.get(k)}')
for d in p.get('CFBundleDocumentTypes', []): print('   document type:', d.get('CFBundleTypeName'), d.get('CFBundleTypeExtensions'), d.get('CFBundleTypeRole'))
print('   ElectronAsarIntegrity:', 'present' if 'ElectronAsarIntegrity' in p else 'MISSING')
PY

  echo "-- icon:"; ls -l "$APP/Contents/Resources/"icon.icns 2>/dev/null | awk '{print "  ", $5, "bytes  icon.icns"}'
  [ -f "$APP/Contents/Resources/icon.icns" ] || { echo "   MISSING icon.icns"; FAIL=1; }

  echo "-- packed app (asar):"
  ASAR="$APP/Contents/Resources/app.asar"
  if [ -f "$ASAR" ]; then
    LIST=$(npx --yes @electron/asar list "$ASAR" 2>/dev/null)
    for need in /dist/index.html /dist-electron/main.js /dist-electron/preload.js /package.json /build/icon.png; do
      echo "$LIST" | grep -qx "$need" && echo "   ok  $need" || { echo "   MISSING $need"; FAIL=1; }
    done
  else echo "   no app.asar found"; FAIL=1; fi

  echo "-- signature (ad-hoc):"
  if [ -n "$RC" ]; then
    # every code object (main app, helpers, frameworks) should carry an ad-hoc signature
    OUT=$("$RC" print-signature-info "$APP" 2>&1)
    N=$(echo "$OUT" | grep -c 'CodeSignatureFlags(ADHOC)')
    echo "   code objects with an ad-hoc signature: $N"
    [ "$N" -ge 6 ] || { echo "   TOO FEW signed objects"; FAIL=1; }
  else echo "   (rcodesign not found; run tools/build-mac.ps1 first)"; fi
  rm -rf "$D"
done
[ $FAIL -eq 0 ] && echo "ALL CHECKS PASSED" || echo "SOME CHECKS FAILED"
exit $FAIL
