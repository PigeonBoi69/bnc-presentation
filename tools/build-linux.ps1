# Builds the Ubuntu/Debian installer (.deb) and the portable AppImage from Windows, using Docker Desktop.
#   .\tools\build-linux.ps1
# Output goes to release-linux\. The first run downloads the electronuserland/builder image (about 1.5 GB).
$ErrorActionPreference = 'Continue' # npm writes warnings to stderr; success is judged by the exit codes below
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'release-linux'
New-Item -ItemType Directory -Force $out | Out-Null

docker version --format '{{.Server.Version}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker is not running. Start Docker Desktop and try again.' }

docker run --rm `
  -v "${root}:/src:ro" `
  -v "${out}:/out" `
  -v bnc-presentation-electron-cache:/root/.cache/electron `
  -v bnc-presentation-builder-cache:/root/.cache/electron-builder `
  electronuserland/builder:latest `
  bash /src/tools/build-linux.sh
if ($LASTEXITCODE -ne 0) { throw 'The Linux build failed.' }
Get-ChildItem $out -File | Select-Object Name, Length
