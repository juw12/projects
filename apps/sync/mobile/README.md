# Sync for Android & iPhone

A Capacitor shell around the live Sync site (`server.url` in `capacitor.config.json`), so every web deploy
updates the installed apps instantly. Loading the real HTTPS site (instead of bundled files) also keeps
YouTube embeds working: YouTube rejects players from `capacitor://` / `https://localhost` origins (error 153).

What the native shell adds on top of the website:

- real haptics on iPhone (Taptic Engine) and Android, via `@capacitor/haptics`
- the native share sheet for invites (`@capacitor/share`)
- Android Back closes sheets → returns to the player → leaves the app with the room still playing (`@capacitor/app`)
- invite links (`https://juw12.github.io/projects/sync/?room=…`) can open the app; resume reconnects at once
- iPhone: background audio mode + microphone prompt for voice chat; Android: microphone permission
- an offline screen (`shell/offline.html`) instead of a browser error
- Android: a foreground playback service (`native/android/SyncPlaybackService.java`) while you are in a room.
  Android 14+ freezes background apps without one, which would stop the music and drop the room. It also
  shows the lock-screen / notification player (prev, play/pause, next, seek) that the WebView cannot.
- iPhone: the `.playback` audio session, so music keeps going on the lock screen and with the silent switch on

The web app detects the shell through `window.Capacitor` (see `NATIVE` in `../web/app.js`).

## Build (CI does this: `.github/workflows/sync-mobile.yml`)

```
npm install
npm run android:prepare   # cap add/sync android, permissions, deep link, icons, signing config
cd android && ./gradlew assembleRelease
npm run ios:prepare       # cap add/sync ios (SPM), Info.plist keys, icons, version
```

Release signing reads `SYNC_ANDROID_KEYSTORE_PATH`, `SYNC_ANDROID_SIGNING_PASSWORD` and
`SYNC_ANDROID_KEY_ALIAS` (PKCS#12). CI uses the developer key stored for Glow (alias `glow`). Keep using the
same key: Android only installs updates signed with it.

`scripts/android-e2e.py` installs the debug APK on an emulator, attaches to the WebView over DevTools, and has a
desktop Chrome join the app's room as a friend. It checks the native bridge, music in the background and with the
screen off (friend still connected), the playback service and lock-screen player, media keys pausing/resuming the
whole room, and voice chat between the app and the desktop.

`../tools/native_bridge_test.py` runs the web half locally in desktop Chrome with a fake Capacitor bridge.

## Install

The `sync-mobile` GitHub release has the files.

- **Android:** download the `.apk` on the phone, open it, allow installing from the browser.
- **iPhone:** the `.ipa` is unsigned. Sideload with AltStore / Sideloadly (free Apple ID, re-sign every 7 days) or
  sign with an Apple Developer account ($99/yr; also needed for TestFlight / App Store). Without that, use Safari →
  Share → Add to Home Screen.
