# Kitty for Android & iPhone

A Capacitor shell around the live Kitty site (`server.url` in `capacitor.config.json`), so every web deploy
updates the installed apps instantly and invite links stay real `https://juw12.github.io/projects/kitty/#join=…`
URLs that work in any browser.

Why not bundle the web files inside the app? Kitty's sharing is end-to-end encrypted with WebCrypto, which needs a
secure context. On iOS, Capacitor serves bundled files from `capacitor://localhost`, which WebKit does not treat as
secure, so `crypto.subtle` can be missing. Loading the HTTPS site avoids that on both platforms.

What the native shell adds on top of the website:

- the native share sheet for invite links (`@capacitor/share`)
- haptics: a light tap when you add an expense, a warning buzz when a category crosses its limit (`@capacitor/haptics`)
- Android Back closes the open sheet or quiz step, returns to Overview, then leaves the app (`@capacitor/app`)
- invite links can open the app (Android intent filter for `/projects/kitty/`; `appUrlOpen` hands the `#join=` part to the web app)
- an offline screen (`shell/offline.html`) that reconnects by itself instead of a browser error page
- proper icons (adaptive on Android, opaque 1024 px on iOS), version and signing

The web app detects the shell through `window.Capacitor` (`NATIVE` in `../web/js/app.js`) and exposes
`window.__kittyNative` for tests.

## Build (CI does this: `.github/workflows/kitty-mobile.yml`)

```
npm install
npm run android:prepare   # cap add/sync android, deep link, icons, signing config, version
cd android && ./gradlew assembleRelease
npm run ios:prepare       # cap add/sync ios (SPM), icons, version
```

Release signing reads `KITTY_ANDROID_KEYSTORE_PATH`, `KITTY_ANDROID_SIGNING_PASSWORD` and `KITTY_ANDROID_KEY_ALIAS`
(PKCS#12). CI uses the developer key already stored for Glow and Sync (alias `glow`). Keep using the same key:
Android only installs updates signed with it.

`scripts/android-e2e.py` installs the debug APK on an emulator, attaches to the WebView over DevTools and checks the
native bridge and plugins, secure context + AES-GCM, the demo budget, haptics, the Back button, a live encrypted
share through the public relay, and the invite-link intent filter. The iOS job compiles a device build (unsigned
`.ipa`) and launches the simulator build, then the `publish` job updates the `kitty-mobile` release.

## Install (free)

Everything is on https://juw12.github.io/projects/kitty/get.html

- **Android:** download `Kitty-android.apk` from the `kitty-mobile` release on the phone, open it, allow installing
  from the browser.
- **iPhone:** easiest is Safari → Share → **Add to Home Screen** (full-screen, offline-capable web app). The `.ipa` is
  unsigned: sideload with AltStore / Sideloadly (free Apple ID, re-sign every 7 days) or sign with an Apple Developer
  account ($99/yr, also needed for TestFlight / App Store).
- **Play Store / App Store:** not published. Google Play needs a one-time $25 developer account and Apple a paid
  developer membership; the builds here are ready to submit once those exist.
