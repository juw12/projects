# setup.ps1 - One-shot setup for the AI Agent Team repo.
# Run this once after you created the empty GitHub repo.
#
# Usage:
#   1. Open PowerShell (no admin needed)
#   2. cd to this folder:
#        cd "C:\Users\juwen_lie\Documents\Default Project\ai-agent-team"
#   3. Run this script:
#        .\setup.ps1
#   4. Type your GitHub username when prompted
#   5. Approve the browser sign-in popup when git asks

[CmdletBinding()]
param()

# ---------- Pretty helpers ----------
function Step($n, $msg) {
    Write-Host ""
    Write-Host "==== Step $n : $msg ====" -ForegroundColor Cyan
}
function Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "  [FAIL] $msg" -ForegroundColor Red }
function Info($msg) { Write-Host "  $msg" -ForegroundColor Gray }

# ---------- Preflight: git installed? ----------
Step 0 "Preflight checks"

$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
    Fail "git is not installed."
    Info "Download Git for Windows from https://git-scm.com/download/win"
    Info "During install, accept all defaults. After install, close and reopen PowerShell, then run this script again."
    exit 1
}
Ok ("git found: " + ($git.Source))

# ---------- Preflight: in the right folder? ----------
$expectedFolderName = "ai-agent-team"
$cwd = (Get-Location).Path
if (-not $cwd.EndsWith($expectedFolderName, [System.StringComparison]::OrdinalIgnoreCase)) {
    Fail "This script must be run from inside the '$expectedFolderName' folder."
    Info "You are currently in: $cwd"
    Info "Run this first, then re-run the script:"
    Info "  cd `"C:\Users\juwen_lie\Documents\Default Project\$expectedFolderName`""
    exit 1
}
Ok "Running from $cwd"

# ---------- Preflight: required files present? ----------
$required = @(
    ".github\workflows\daily-agent.yml",
    "agents\idea_agent.py",
    "agents\pm_agent.py",
    "run_daily.py",
    "requirements.txt",
    "README.md"
)
$missing = $required | Where-Object { -not (Test-Path -LiteralPath $_) }
if ($missing) {
    Fail "Missing required files:"
    $missing | ForEach-Object { Info "  - $_" }
    Info "Re-download / re-copy the ai-agent-team folder before continuing."
    exit 1
}
Ok "All required files present"

# ---------- Step 1: get GitHub username ----------
Step 1 "GitHub username"
$username = ""
while ([string]::IsNullOrWhiteSpace($username)) {
    $username = Read-Host "  Type your GitHub username (letters, numbers, dashes only)"
    if ($username -notmatch '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?$') {
        Warn "That doesn't look like a valid GitHub username. Try again."
        $username = ""
    }
}
$repoUrl = "https://github.com/$username/$expectedFolderName.git"
Ok "Will push to: $repoUrl"

# ---------- Step 2: make sure the empty repo actually exists on GitHub ----------
Step 2 "Confirm the GitHub repo exists"
Info "Opening $repoUrl in your browser so you can verify the repo was created..."
Start-Process $repoUrl
$answer = Read-Host "  Did you create the empty '$expectedFolderName' repo on GitHub? (y/n)"
if ($answer -ne "y") {
    Warn "Please go create the empty repo first:"
    Info "  1. Open https://github.com/new"
    Info "  2. Name: $expectedFolderName  |  Visibility: Public  |  No README/license/.gitignore"
    Info "  3. Click Create repository"
    Info "  4. Re-run this script:  .\setup.ps1"
    exit 1
}
Ok "Repo confirmed (or proceeding on faith)"

# ---------- Step 3: git init + first commit ----------
Step 3 "Initialize local git repo and create first commit"
if (-not (Test-Path -LiteralPath ".git")) {
    git init | Out-Null
    Ok "git init done"
} else {
    Warn ".git already exists — skipping git init"
}

git config user.email  | Out-Null
if ($LASTEXITCODE -ne 0) { git config user.email "agent@local" | Out-Null }
git config user.name  | Out-Null
if ($LASTEXITCODE -ne 0) { git config user.name  "AI Agent Team" | Out-Null }
Ok "git user.name / user.email set"

git add .
$status = git status --porcelain
if ([string]::IsNullOrWhiteSpace($status)) {
    Warn "Nothing to commit — files already committed?"
} else {
    git commit -m "initial agent team setup" | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Ok "Initial commit created"
    } else {
        Fail "git commit failed. Run 'git status' to see what's wrong."
        exit 1
    }
}

# ---------- Step 4: set branch to main ----------
Step 4 "Ensure branch is 'main'"
git branch -M main 2>$null
Ok "Branch is main"

# ---------- Step 5: add remote ----------
Step 5 "Add GitHub as the remote"
$existingRemote = git remote get-url origin 2>$null
if ($existingRemote -eq $repoUrl) {
    Ok "Remote 'origin' already points to your repo"
} elseif ($existingRemote) {
    Warn "Remote 'origin' already exists and points to: $existingRemote"
    $overwrite = Read-Host "  Overwrite it? (y/n)"
    if ($overwrite -eq "y") {
        git remote remove origin
        git remote add origin $repoUrl
        Ok "Remote 'origin' updated to $repoUrl"
    } else {
        Info "Keeping existing remote. Push may fail until you fix it."
    }
} else {
    git remote add origin $repoUrl
    Ok "Remote 'origin' added: $repoUrl"
}

# ---------- Step 6: push ----------
Step 6 "Push to GitHub"
Info "A browser window will pop up asking you to sign in to GitHub."
Info "Approve it. Git Credential Manager will remember you for next time."
git push -u origin main
if ($LASTEXITCODE -eq 0) {
    Ok "Push successful"
} else {
    Fail "git push failed."
    Info "Common causes:"
    Info "  - You didn't approve the browser sign-in popup"
    Info "  - Your repo URL is wrong (check it matches: $repoUrl)"
    Info "  - Your repo isn't empty (delete it on GitHub and re-create)"
    Info "  - You need a Personal Access Token: https://github.com/settings/tokens/new?scopes=repo"
    exit 1
}

# ---------- Done ----------
Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  DONE. Your code is on GitHub." -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps (browser):" -ForegroundColor Cyan
Write-Host "  1. Refresh your repo page: $repoUrl" -ForegroundColor White
Write-Host "  2. Get a free Gemini key: https://aistudio.google.com/app/apikey" -ForegroundColor White
Write-Host "  3. Repo Settings -> Secrets and variables -> Actions -> New secret" -ForegroundColor White
Write-Host "       Name:  GEMINI_API_KEY" -ForegroundColor White
Write-Host "       Value: paste the AIza... key" -ForegroundColor White
Write-Host "  4. Actions tab -> Daily AI Agent Team -> Run workflow" -ForegroundColor White
Write-Host "  5. Wait ~30s, then check the specs/ folder for a brand-new spec." -ForegroundColor White
Write-Host ""
