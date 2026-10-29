# Mint for Android and iPhone

Capacitor 8 shells around the live app (`https://juw12.github.io/projects/mint/`). The app loads the same site, so
features and fixes arrive without a new app release, and people keep one account and the same budgets on web,
Windows, Mac, Android and iPhone. The site's front door opens Budget; Templates is one tap away.

What the shell adds (detected through `window.Capacitor` and the `MintApp/1.1` user-agent suffix):

- **Files.** WebViews ignore `<a download>`, so Budget backups, CSV exports and result cards and Templates
  `.xlsx` / CSV files are written to the app cache with `@capacitor/filesystem` and handed to the share sheet
  (`@capacitor/share`): save to Files or Drive, or open in Excel / Google Sheets.
- **Back button and haptics** (`@capacitor/app`, `@capacitor/haptics`): Back closes sheets and steps back through
  Budget before leaving the app; adding an expense and limit warnings give a light vibration.
- **Invites** open in the app and use the native share sheet; checkout links open in the phone's browser.
- The first launch asks for language and region like the website does.
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
is in `android-certificate-sha256.txt`, and CI refuses to publish an APK signed with anything else.

The `Mint apps` workflow (`.github/workflows/mint-apps.yml`) builds the release and debug APKs with the key from the
repository secrets, opens the debug build on an Android emulator (`scripts/android-smoke.py`: Mint loads, the
native plugins are there, no crash) and publishes `Mint-Android.apk` to the `mint` release. It also refreshes
`Mint-android.apk` on the older `mint-android` release so earlier links keep working.

## Distribution

- **Android:** <https://github.com/juw12/projects/releases/download/mint/Mint-Android.apk>. Open it on the phone and
  allow installs from the browser; it updates an earlier Mint app in place. Google Play needs a developer account
  ($25 once).
- **iPhone:** Apple only installs apps through the App Store/TestFlight (Apple Developer Program, $99/year) or Xcode.
  Until then, iPhone users open Mint in Safari → Share → Add to Home Screen, which runs full-screen with its icon.

## Known limits

- Needs a connection on first launch (the marketplace and accounts are online); the offline page offers a retry.
- Phone notifications from Templates are not available inside the app (use Chrome or the installed web app).
- The iOS project has not been compiled (no Xcode in CI for Mint yet).
