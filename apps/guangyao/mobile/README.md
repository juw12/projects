# 光耀同行 for Android and iPhone

Capacitor shells around the live site (`https://juw12.github.io/projects/guangyao/`). The app opens the same
web app, so lessons, admin-published content and fixes arrive without a new app release, and learners keep the
same Puter account and progress on web, Android and iPhone.

What the native shells add (`native/`):

- **Puter sign-in window.** `window.open()` normally fails inside a WebView. Android
  (`native/android/MainActivity.java`) and iOS (`native/ios/GuangYaoViewController.swift`) open Puter's sign-in
  page in a full-screen in-app window that keeps its `window.opener` link, so the page receives the result.
  If the window is closed early, the page gets `guangyao:native-window-closed` and unlocks the sign-in button.
- **Every other new-window link** (PDF handouts, YouTube, sign-up forms) opens in the phone's browser.
- **Share sheet** for the progress card and calendar entries (`@capacitor/share` + `@capacitor/filesystem`,
  used by `window.GY_NATIVE.shareFile` in `web/pwa.js`).
- Brand icon, splash, offline page (`www/offline.html`) when the site cannot load.

The web app detects the shell through the `GuangYaoApp/1.0` user-agent suffix and hides the "install PWA" button.

## Build

```sh
npm install
npm run android:prepare            # cap add/sync android + MainActivity, icons, splash, version, signing
cd android && ./gradlew assembleRelease
npm run ios:prepare                # macOS: cap add/sync ios + view controller, icons, splash, version
# then open ios/App/App.xcodeproj in Xcode, choose your team, Run or Archive
```

Release signing reads `GUANGYAO_ANDROID_KEYSTORE_PATH` and `GUANGYAO_ANDROID_SIGNING_PASSWORD` (PKCS#12, alias
`guangyao`). Keep the keystore safe: Android only installs updates signed with the same key. Its SHA-256
fingerprint is in `android-certificate-sha256.txt`.

## Distribution

- **Android:** `GuangYao-android.apk` on the `guangyao-android` release of this repository
  (<https://github.com/juw12/projects/releases/download/guangyao-android/GuangYao-android.apk>). Install by opening
  the file on the phone and allowing installs from the browser. Google Play needs a developer account ($25 once).
- **iPhone:** Apple only installs apps through the App Store/TestFlight (Apple Developer Program, $99/year) or
  Xcode on a Mac. Until then, iPhone users use Safari → Share → Add to Home Screen, which gives the same app
  full-screen with its own icon.

## Known limits

- Needs a connection on first launch (then the web app's own offline cache applies on Android).
- Google sign-in is blocked by Google inside embedded browsers; create the Puter account with email.
- The iOS project is generated and patched by `prepare-native.mjs` but has not been compiled here (no Xcode).
