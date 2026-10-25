# Vendored skill packs

Both packs are MIT-licensed work by Jake Schincariol, copied unmodified (their own
`LICENSE` files are kept inside each folder). Twin runs their command-line
tools as subprocesses.

| Folder | Upstream | Commit |
| --- | --- | --- |
| `day-trader-skill/` | https://github.com/Jakeschincariol/day-trader-skill | `3d0f4ef6986f` |
| `trader-skill/` | https://github.com/Jakeschincariol/trader-skill | `5189e79b9a48` |

To update: replace a folder with a fresh clone (minus `.git`) and run
`python apps/twin/tests/verify_api.py`.
