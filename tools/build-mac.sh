#!/bin/bash
# Runs INSIDE the electronuserland/builder container (started by tools/build-mac.ps1).
# Builds the macOS app for Apple Silicon (arm64) and Intel (x64) as .zip files, ad-hoc signed with rcodesign.
set -euo pipefail

# --- rcodesign (open-source Apple code-signing tool that runs on Linux), cached between runs ---
RC_VERSION=0.29.0
RC_DIR=/root/tools/rcodesign-$RC_VERSION
if [ ! -x "$RC_DIR/rcodesign" ]; then
  mkdir -p "$RC_DIR"
  URL="https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign%2F${RC_VERSION}/apple-codesign-${RC_VERSION}-x86_64-unknown-linux-musl.tar.gz"
  echo "== downloading rcodesign $RC_VERSION"
  curl -fsSL "$URL" | tar xz -C "$RC_DIR" --strip-components=1
fi
export RCODESIGN="$RC_DIR/rcodesign"
"$RCODESIGN" --version
echo "rcodesign sha256: $(sha256sum "$RCODESIGN" | cut -d' ' -f1)"

# --- copy the project (without Windows node_modules/outputs), install, build ---
mkdir -p /work
cd /src
tar c --exclude=./node_modules --exclude=./release --exclude=./release-v3 --exclude=./release-new --exclude=./release-linux --exclude=./release-mac --exclude=./.git . | tar x -C /work
cd /work

export ELECTRON_SKIP_BINARY_DOWNLOAD=1 # electron-builder fetches the macOS Electron builds itself
npm ci --no-audit --no-fund
npx vite build
# IMPORTANT, two things about symbolic links (a macOS app bundle is full of them: the frameworks):
#  1. build on the container's own Linux disk, NOT on the Windows folder mounted at /out, which turns links into copies;
#  2. let electron-builder produce only the .app folders ("dir"), because its own zip step on Linux flattens the links,
#     then zip them here with Info-ZIP (-y keeps symbolic links). A flattened app has a broken signature and won't start.
npx electron-builder --mac dir --arm64 --x64 --config.directories.output=/work/release-mac

command -v zip >/dev/null || { apt-get update -qq >/dev/null && apt-get install -y -qq zip >/dev/null; }
VERSION=$(node -p "require('./package.json').version")
for pair in "mac-arm64:arm64" "mac:x64"; do
  DIR="/work/release-mac/${pair%%:*}"
  ARCH="${pair##*:}"
  APP="$DIR/BNC Presentation.app"
  LINKS=$(find "$APP" -type l | wc -l)
  echo "== $ARCH: $LINKS symbolic links in the app"
  [ "$LINKS" -gt 0 ] || { echo "ERROR: the app has no symbolic links, the build is broken"; exit 1; }
  (cd "$DIR" && zip -qry "/out/BNC-Presentation-${VERSION}-mac-${ARCH}.zip" "BNC Presentation.app")
done
ls -la /out
