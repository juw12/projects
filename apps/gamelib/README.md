# Game Library

The browser-game collection is maintained inside Projects.

- Play: <https://juw12.github.io/projects/gamelib/>
- Static website: `web/`
- Owner/maintainer: [@juw12](https://github.com/juw12)

The original repository's complete history was imported without squashing.
The site is deployed but intentionally omitted from the profile, portfolio and
Projects landing-page cards (`listed: false` in the app catalog). This is not
access control: the source and direct game URLs remain public.

Browser-only saves belong to the browser origin and do not automatically move
from the old `juwpegatron.github.io` website to `juw12.github.io`.

## Get it on your device

- **Windows:** [`GameLibrary-Windows-Setup.exe`](https://github.com/juw12/projects/releases/download/gamelib-desktop/GameLibrary-Windows-Setup.exe) (no admin needed; if Windows says it protected your PC, choose *More info → Run anyway*), or without installing [`GameLibrary-Windows-Portable.zip`](https://github.com/juw12/projects/releases/download/gamelib-desktop/GameLibrary-Windows-Portable.zip).
- **Mac:** [`GameLibrary-macOS-AppleSilicon.dmg`](https://github.com/juw12/projects/releases/download/gamelib-desktop/GameLibrary-macOS-AppleSilicon.dmg) (M1 and newer) or [`GameLibrary-macOS-Intel.dmg`](https://github.com/juw12/projects/releases/download/gamelib-desktop/GameLibrary-macOS-Intel.dmg). The first time, macOS blocks it because it is not notarized: **System Settings → Privacy & Security → Open Anyway**.
- **Android:** [`GameLibrary-android.apk`](https://github.com/juw12/projects/releases/download/gamelib-android/GameLibrary-android.apk): open the file on the phone and allow your browser to install apps once.
- **iPhone:** open https://juw12.github.io/projects/gamelib/ in Safari, tap Share, then **Add to Home Screen**.

The Windows, Mac and Android apps are the web app in its own window ([`desktop/`](desktop/README.md), [`android/`](android/README.md)) and change with it. Each build is opened on GitHub's machines before it is published: on Windows and on a Mac the page loads, the app starts and can store data; on an Android emulator it installs, opens and stays up. They are not code-signed or notarised, and no real phone or PC has run them yet.

## Sharp canvases on 2x and 3x screens

Most games draw into a canvas of a fixed size (for example 900 x 480) that the browser stretches over a
phone or laptop screen with two or three times as many pixels, which looks soft. `web/hidpi.js`, loaded
before a game's own script, gives each on-screen 2D canvas a backing store of up to 2x and scales the
drawing to match; the game still sees its own canvas size.

It is in 190 of the 252 fixed-size games: the ones where a scripted play-through (fixed random numbers and
clock, the same taps and keys) drew the same picture and kept the same layout with and without it, the
canvas really had twice the pixels, and the play-through got past the first screen. Checked on 2026-11-21 in
headless Chrome: those 190 play-throughs, every edited page opened at 1280 x 800 at 2x and 390 x 844 at 3x
with no script error, and the canvas at the same place and size as before on a phone, upright and sideways.
Not checked by a person playing, and not on a physical phone.

Not included: 48 games whose scripted play-through never left the first screen (same picture there, but
nothing proven about play), 12 pixel-art games (their blocky look is on purpose) and 4 that read canvas
pixels back. To leave one canvas alone, give it `data-hidpi="off"`.
