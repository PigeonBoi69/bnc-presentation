# Inspects release-mac\*.zip inside a container (Docker Desktop): CPU architecture, Info.plist, signature, icon, packed app.
#   .\tools\mac-check.ps1
# This cannot START the app (that needs a Mac); it checks the things that can be checked from Windows.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'release-mac'
docker run --rm `
  -v "${out}:/pkg:ro" `
  -v "${root}\tools:/tools:ro" `
  -v bnc-presentation-mac-tools:/root/tools `
  electronuserland/builder:latest `
  bash /tools/mac-check.sh
