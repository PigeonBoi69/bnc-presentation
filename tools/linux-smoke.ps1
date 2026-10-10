# Installs release-linux\*.deb in a clean Ubuntu 24.04 container (Docker Desktop), starts the app on a virtual display
# and opens a sample presentation. Writes the screenshot to release-linux\linux-screenshot.png.
#   .\tools\linux-smoke.ps1 [-Deck C:\path\to\file.pptx]
param([string]$Deck, [switch]$AppImage) # -AppImage runs the AppImage instead of the installed .deb
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'release-linux'
$args2 = @('run', '--rm', '-e', $(if ($AppImage) { 'MODE=appimage' } else { 'MODE=deb' }), '-v', "${out}:/pkg:ro", '-v', "${root}\tools:/tools:ro", '--mount', "type=bind,source=${out},target=/out")
$wbArg = ''
if ($Deck) {
  $dir = Split-Path -Parent $Deck
  $args2 += @('-v', "${dir}:/data:ro")
  $wbArg = '/data/' + (Split-Path -Leaf $Deck)
}
$args2 += @('ubuntu:24.04', 'bash', '/tools/linux-smoke.sh')
if ($wbArg) { $args2 += $wbArg }
docker @args2
