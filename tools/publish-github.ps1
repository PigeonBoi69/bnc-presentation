# Publishes BNC Presentation to GitHub and creates a PRE-RELEASE with the Windows, macOS and Linux downloads.
#
#   .\tools\publish-github.ps1 -Owner your-github-name            # first time: creates the repo, pushes, makes release v<version>
#   .\tools\publish-github.ps1 -Owner your-github-name -DryRun    # shows what it would do, changes nothing
#   .\tools\publish-github.ps1 -Owner your-github-name -ReleaseOnly   # later versions: just (re)create the release for the current version
#
# Needs: Git (winget install --id Git.Git -e), GitHub CLI (winget install --id GitHub.cli -e) and "gh auth login" done once.
param(
  [Parameter(Mandatory = $true)][string]$Owner,
  [string]$Repo = 'bnc-presentation',
  [ValidateSet('public', 'private')][string]$Visibility = 'public',
  [string]$PluginsRepo = 'bnc-plugins',
  [switch]$DryRun,
  [switch]$ReleaseOnly
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Run([string]$exe, [string[]]$a) {
  if ($DryRun) { Write-Host "   [dry run] $exe $($a -join ' ')" -ForegroundColor DarkGray; return }
  & $exe @a
  if ($LASTEXITCODE -ne 0) { throw "$exe $($a -join ' ') failed (exit $LASTEXITCODE)" }
}

# run a native command whose failure is an expected answer (not an error); the exit code is left in $LASTEXITCODE
function Quiet([scriptblock]$b) {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & $b *>$null } finally { $ErrorActionPreference = $old }
}
$pkg = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$v = $pkg.version
$tag = "v$v"
$full = "$Owner/$Repo"

Step "Checking tools"
foreach ($t in 'git', 'gh') {
  if (-not (Get-Command $t -ErrorAction SilentlyContinue)) {
    if ($DryRun) { Write-Host "   [dry run] '$t' is not installed (install it before the real run)" -ForegroundColor Yellow }
    else { throw "'$t' is not installed. Run: winget install --id $(if ($t -eq 'git') { 'Git.Git' } else { 'GitHub.cli' }) -e   (then open a NEW PowerShell window)" }
  }
}
if (-not $DryRun) {
  Quiet { gh auth status }
  if ($LASTEXITCODE -ne 0) { throw "You are not logged in to GitHub. Run: gh auth login" }
}

Step "Release notes"
$notes = Join-Path $root "docs\releases\$tag.md"
if (-not (Test-Path $notes)) { throw "Missing $notes - copy docs\releases\TEMPLATE.md to it and fill it in." }
Write-Host "   $notes"

Step "Collecting installers + checksums (version $v)"
& (Join-Path $PSScriptRoot 'make-release-assets.ps1') | Out-Null
$assets = Get-ChildItem (Join-Path $root 'release-assets') -File | ForEach-Object FullName
$assets | ForEach-Object { Write-Host "   $(Split-Path $_ -Leaf)" }
if ($assets.Count -ne 6) { throw "Expected 5 installers + SHA256SUMS.txt, found $($assets.Count) files." }

if (-not $ReleaseOnly) {
  Step "Filling in your GitHub name ($Owner) and repository URLs"
  $files = 'README.md', 'CONTRIBUTING.md', "docs\releases\$tag.md"
  foreach ($f in $files) {
    $p = Join-Path $root $f
    $txt = [IO.File]::ReadAllText($p)
    $new = $txt.Replace('github.com/OWNER/bnc-plugins', "github.com/$Owner/$PluginsRepo").Replace('github.com/OWNER/bnc-presentation', "github.com/$Owner/$Repo").Replace('OWNER', $Owner)
    if ($new -ne $txt) {
      Write-Host "   updated $f"
      if (-not $DryRun) { [IO.File]::WriteAllText($p, $new, (New-Object Text.UTF8Encoding($false))) }
    }
  }
  # repository / bugs in package.json (edited as text so the formatting stays as it is)
  $pp = Join-Path $root 'package.json'
  $json = [IO.File]::ReadAllText($pp)
  if ($json -notmatch '"repository"') {
    $add = "  `"homepage`": `"$($pkg.homepage)`",`n  `"repository`": { `"type`": `"git`", `"url`": `"git+https://github.com/$full.git`" },`n  `"bugs`": { `"url`": `"https://github.com/$full/issues`" },"
    $json2 = [regex]::Replace($json, '(?m)^[ \t]*"homepage":[ \t]*"[^"]*",[ \t]*\r?\n', ($add + "`n"), 1)
    Write-Host "   added repository + bugs to package.json"
    if (-not $DryRun) { [IO.File]::WriteAllText($pp, $json2, (New-Object Text.UTF8Encoding($false))) }
  }

  Step "Creating the git repository and first commit"
  if (-not (Test-Path (Join-Path $root '.git'))) { Run 'git' @('init', '-b', 'main') }
  Run 'git' @('add', '-A')
  if (-not $DryRun) {
    $staged = git diff --cached --name-only
    if ($staged | Where-Object { $_ -match '^(release|dist|node_modules)' -or $_ -match '\.(exe|deb|AppImage|zip|bnctheme)$' }) {
      throw "Build output or installers got staged - check .gitignore:`n$($staged -join "`n")"
    }
    Write-Host "   $(@($staged).Count) files staged"
  }
  $hasHead = $false
  if (-not $DryRun) { Quiet { git rev-parse --verify HEAD }; $hasHead = ($LASTEXITCODE -eq 0) }
  if (-not $hasHead) { Run 'git' @('commit', '-m', "BNC Presentation $v (pre-release)") }
  else { git diff --cached --quiet; if ($LASTEXITCODE -ne 0) { Run 'git' @('commit', '-m', "Prepare release $tag") } }

  Step "Creating $Visibility repository $full on GitHub and pushing"
  if ($DryRun) { Write-Host "   [dry run] gh repo create $full --$Visibility --source . --remote origin --push --description ..." -ForegroundColor DarkGray }
  else {
    Quiet { gh repo view $full }
    if ($LASTEXITCODE -eq 0) {
      Write-Host "   $full already exists - pushing to it"
      if (-not (git remote | Where-Object { $_ -eq 'origin' })) { git remote add origin "https://github.com/$full.git" }
      git push -u origin main
      if ($LASTEXITCODE -ne 0) { throw 'git push failed' }
    } else {
      gh repo create $full "--$Visibility" --source . --remote origin --push --description 'BNC Presentation: open-source presentation maker with .pptx support and Nextcloud (Windows, macOS, Linux)'
      if ($LASTEXITCODE -ne 0) { throw 'gh repo create failed' }
    }
  }
  Run 'gh' @('repo', 'edit', $full, '--add-topic', 'presentation', '--add-topic', 'electron', '--add-topic', 'pptx', '--add-topic', 'nextcloud', '--add-topic', 'open-source')
}

Step "Creating the PRE-RELEASE $tag with the downloads"
if (-not $DryRun) {
  Quiet { gh release view $tag --repo $full }
  if ($LASTEXITCODE -eq 0) { throw "Release $tag already exists on $full. Bump the version (npm run version:bump), rebuild, or delete it on GitHub first." }
}
Run 'gh' (@('release', 'create', $tag, '--repo', $full, '--prerelease', '--target', 'main', '--title', "BNC Presentation $v (pre-release)", '--notes-file', $notes) + $assets)

Write-Host "`nDone. https://github.com/$full/releases/tag/$tag" -ForegroundColor Green
if ($DryRun) { Write-Host '(dry run: nothing was changed or uploaded)' -ForegroundColor Yellow }
