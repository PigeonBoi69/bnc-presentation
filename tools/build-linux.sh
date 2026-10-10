#!/bin/bash
# Runs INSIDE the electronuserland/builder container (started by tools/build-linux.ps1).
# Copies the project (without Windows node_modules/outputs), installs Linux dependencies and builds the
# .deb (Ubuntu/Debian installer) and the AppImage (portable single file) into /out.
set -euo pipefail

mkdir -p /work
cd /src
tar c --exclude=./node_modules --exclude=./release --exclude=./release-new --exclude=./release-linux --exclude=./.git . | tar x -C /work
cd /work

export ELECTRON_SKIP_BINARY_DOWNLOAD=1 # electron-builder fetches the Linux Electron itself
npm ci --no-audit --no-fund
npx vite build
npx electron-builder --linux deb AppImage --config.directories.output=/out
ls -la /out
