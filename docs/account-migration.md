# Main-account and content migration

Main owner and maintainer: [@juw12](https://github.com/juw12).
Co-founder and collaborator: [@juwpegatron](https://github.com/juwpegatron).
Existing commit authorship has not been rewritten.

## Current locations

- Projects: <https://github.com/juw12/projects>
- Projects website: <https://juw12.github.io/projects/>
- Portfolio: <https://juw12.github.io/portfolio/>
- Guang Yao app: <https://juw12.github.io/projects/guangyao/>
- Published content: `content/guangyao/`
- Game Library source: `apps/gamelib/web/`
- Game Library direct URL: <https://juw12.github.io/projects/gamelib/>

Game Library is intentionally omitted from profile, portfolio and landing-page
cards. Its direct URL and source are public; this is not an access restriction.

## History and uploaded materials

Both consolidated sources were imported with non-squashed Git subtrees:

| Source | Original head | Destination |
| --- | --- | --- |
| Game Library | `5e498f39506ec81f719de908df696de5160cb60e` | `apps/gamelib/web/` |
| Guang Yao content | `72e11401d2e2eadae7219d9ce814c879c39b9fec` | `content/guangyao/` |

Existing material files are pinned to import commit `8eaceffa05b1f1c3b438e8254b42aa1bdab3bee7`,
where their new prefixed paths exist. Material authors and lesson data are preserved.
New uploads and deletes operate only under `content/guangyao/` in the app.

## Compatibility and permissions

- Old GitHub repository URLs redirect after ownership transfer; GitHub Pages URLs do not.
- Browser-only progress, cached credentials and installed PWAs do not automatically
  migrate between the old and new browser origins. Recover/export any necessary
  data before removing an old installation; verify account sync separately.
- Guang Yao administrators need a token that can write to `juw12/projects`.
  GitHub permissions cover the entire repository, not an individual folder.
- Existing AIRIZ desktop installers embed the old Pages update-feed URL. Source
  endpoints have been updated, but already-installed binaries are not rewritten.
  A future desktop release or an approved compatibility-hosting plan is needed
  for those existing installations; do not assume their automatic updater migrated.
- Original standalone source repositories are retained until the owner confirms
  deletion after verifying the new destinations.
