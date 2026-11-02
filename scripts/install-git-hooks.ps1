# Installs a pre-push hook that blocks pushes when the git remote URL (or
# http.extraheader) contains an embedded credential.
# Usage:  pwsh -File scripts/install-git-hooks.ps1
$ErrorActionPreference = 'Stop'

$gitDir = (git rev-parse --absolute-git-dir).Trim()
$hooksDir = Join-Path $gitDir 'hooks'
New-Item -ItemType Directory -Force -Path $hooksDir | Out-Null

$hook = @'
#!/bin/sh
# pre-push guard: refuse to push if the remote URL or http.extraheader embeds a
# credential (token). Keeps secrets out of .git/config and out of GitHub.
url=$(git remote get-url origin 2>/dev/null)
case "$url" in
  *://*@*) 
    echo "ERROR: remote 'origin' URL embeds credentials:" >&2
    echo "  $url" >&2
    echo "Fix: git remote set-url origin https://github.com/<owner>/<repo>.git" >&2
    echo "and authenticate with 'gh auth login' or Git Credential Manager." >&2
    exit 1 ;;
esac
if printf '%s' "$url" | grep -Eq 'gh[pousr]_[A-Za-z0-9]{20,}'; then
  echo "ERROR: remote 'origin' URL contains what looks like a token." >&2
  echo "Fix: git remote set-url origin https://github.com/<owner>/<repo>.git" >&2
  exit 1
fi
local_extra=$(git config --local --get http.extraheader 2>/dev/null)
global_extra=$(git config --global --get http.extraheader 2>/dev/null)
if printf '%s %s' "$local_extra" "$global_extra" | grep -Eiq 'authorization'; then
  echo "ERROR: a stored http.extraheader contains credentials." >&2
  echo "Fix: git config --local --unset-all http.extraheader (or --global)" >&2
  exit 1
fi
exit 0
'@

$hookPath = Join-Path $hooksDir 'pre-push'
# Write with LF endings so Git's bundled sh can run it.
[System.IO.File]::WriteAllText($hookPath, ($hook -replace "`r`n", "`n"))

Write-Host "Installed pre-push hook: $hookPath"
