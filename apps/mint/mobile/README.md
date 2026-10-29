# Mint for Android and iPhone

Capacitor 8 shells around the live app (`https://juw12.github.io/projects/mint/app.html`). The app loads the same
site, so features and fixes arrive without a new app release, and users keep one account on web, Android and iPhone.

Since Mint 3.0 the site has two halves. The shell opens on Templates; **Budget** (`budget/`, formerly Kitty) is the
first item in the tab bar and runs in the same WebView. It arrived without rebuilding the app because `server.url`
did not change. Inside the app, Budget invites use the native share sheet (`@capacitor/share`); haptics and
Back-button handling would need `@capacitor/haptics` and `@capacitor/app`, which this shell does not include;
Budget skips them quietly when they are missing.

What the shell changes (detected in `web/js/app.js` through the `MintApp/1.0` user-agent suffix):

- **Downloads.** WebViews ignore `<a download>`, so `.xlsx` / CSV / share cards / recovery codes are written to the
  app cache with `@capacitor/filesystem` and handed to the phone's share sheet (`@capacitor/share`): save to Files or
  Drive, or open in Excel / Google Sheets.
- **Checkout links** open in the phone's browser instead of a popup.
- The "Get the app" link and install page are hidden inside the app.
- Brand icon (adaptive), splash and an offline page (`www/offline.html`) when the site cannot load.

## Build

```sh
npm install
npm run android:prepare            # cap add/sync android + icons, splash, version, signing, Gradle bin
cd android && ./gradlew assembleRelease
npm run ios:prepare                # macOS with Xcode: cap add/sync ios + icons, splash, version
# then open ios/App/App.xcodeproj in Xcode, choose your team, Run or Archive
```

Release signing reads `MINT_ANDROID_KEYSTORE_PATH` and `MINT_ANDROID_SIGNING_PASSWORD` (PKCS#12, alias `mint`).
Keep the keystore safe: Android only installs updates signed with the same key. Its SHA-256 certificate fingerprint
is in `android-certificate-sha256.txt`.

## Distribution

- **Android:** `Mint-android.apk` on the `mint-android` release of this repository
  (<https://github.com/juw12/projects/releases/download/mint-android/Mint-android.apk>). Open it on the phone and
  allow installs from the browser. Google Play needs a developer account ($25 once).
- **iPhone:** Apple only installs apps through the App Store/TestFlight (Apple Developer Program, $99/year) or Xcode.
  Until then, iPhone users open Mint in Safari → Share → Add to Home Screen, which runs full-screen with its icon.

## Known limits

- Needs a connection (the marketplace and accounts are online); the offline page offers a retry.
- Budget's CSV export, JSON backup and result-card downloads are not routed through the download bridge above, so
  in the app they need Chrome or the installed web app.
- Built and signed on a Mac without an emulator or device run; the iOS project has not been compiled (no Xcode).
