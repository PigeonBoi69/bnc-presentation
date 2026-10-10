# Builds the macOS app (Apple Silicon + Intel .zip files) from Windows, using Docker Desktop.
#   .\tools\build-mac.ps1
# Output goes to release-mac\. Apple's own tools only run on a Mac, so the build runs in a Linux container and the app is
# ad-hoc signed with rcodesign (no Apple Developer account needed; macOS will ask the first time you open it, see README).
$ErrorActionPreference = 'Continue' # npm writes warnings to stderr; success is judged by the exit codes below
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'release-mac'
New-Item -ItemType Directory -Force $out | Out-Null

docker version --format '{{.Server.Version}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker is not running. Start Docker Desktop and try again.' }

docker run --rm `
  -v "${root}:/src:ro" `
  -v "${out}:/out" `
  -v bnc-presentation-electron-cache:/root/.cache/electron `
  -v bnc-presentation-builder-cache:/root/.cache/electron-builder `
  -v bnc-presentation-mac-tools:/root/tools `
  electronuserland/builder:latest `
  bash /src/tools/build-mac.sh
if ($LASTEXITCODE -ne 0) { throw 'The macOS build failed.' }
Get-ChildItem $out -File | Select-Object Name, Length
