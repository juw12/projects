# Git credentials: the safe way (and the trap to avoid)

## The trap that leaked a token

Some of our templates build the remote like this:

```powershell
# DO NOT DO THIS
$repoUrl = "https://${env:GITHUB_TOKEN}@github.com/$user/$repo.git"
git remote add origin $repoUrl
```

This writes the token into `.git/config` as plaintext in the URL. Anyone who
reads that file (or any tool that prints the remote, or a backup) sees a live
credential. This is what happened to `juw12/projects`.

## The safe way

Let a credential helper hold the secret, and keep the remote URL clean:

```powershell
git remote add origin https://github.com/<owner>/<repo>.git
# authenticate once:
gh auth login          # or let Git Credential Manager prompt on first push
```

Git Credential Manager (`credential.helper=manager`) stores the token in the
Windows Credential Manager (encrypted) or in `gh`'s OS keyring. The URL itself
never contains a secret.

## Check a repo for a leaked token

```powershell
git remote get-url origin          # must NOT contain user:token@
git config --get http.extraheader   # must be empty
git config --get credential.helper  # expect: manager
```

## Clean a repo that already has one

```powershell
git remote set-url origin https://github.com/<owner>/<repo>.git
```

Then rotate the token if it may have left this machine:
GitHub -> Settings -> Developer settings -> Personal access tokens.

## Guardrail: the pre-push hook

`scripts/install-git-hooks.ps1` installs a `pre-push` hook that refuses to push
when the remote URL (or `http.extraheader`) contains credentials. Run it in any
repo:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-git-hooks.ps1
```

The guard was verified on this machine: `pre-push` fires, a token-bearing remote
URL is blocked (exit 1), and a clean URL is allowed (exit 0).

It is local (`.git/hooks/` is not committed), so run it once per clone.

## Never commit secrets

The root `.gitignore` blocks `.env`, `*.pem`, `*.key`, `.git-credentials` and
similar. If a secret is ever committed, rotate it first, then purge it from
history (`git filter-repo`).
