# Twin for Android

The Android app is Twin's own web app (`../web`) in a native shell ([Capacitor](https://capacitorjs.com)). The
files are inside the app, so it opens without a connection: practice money, the 10,000 replays and research,
the same as https://juw12.github.io/projects/twin/ on a phone. Real trading runs on a computer (the Twin
desktop app or Twin's own server); the Android app does not place real orders.

Get it: `Twin-Android.apk` on the [twin release](https://github.com/juw12/projects/releases/tag/twin). Open the
file on the phone and allow "install unknown apps" for your browser once.

## How it is built

`.github/workflows/twin-apps.yml`, job `android`:

```
npm install
npm run android:prepare      # copies ../web into www/, creates android/, sets version, icons, splash, signing
cd android && ./gradlew assembleRelease assembleDebug
```

- The version is the one in `../web/release.json`. There is no second number to raise.
- The release APK is signed with the developer key kept in the repository's secrets (`TWIN_ANDROID_KEYSTORE_BASE64`
  when there is one, else the key Glow and Vitals are signed with). Without a secret the APK is debug-signed and says so.
- The `emulator` job installs the debug APK on an Android 15 emulator and checks that Twin renders from its
  bundled files, with nothing scrolling sideways and no crash (`scripts/android-smoke.py`). An APK that fails
  is not published.

Nothing is committed from `www/`, `android/` or `node_modules/`: they are made by the build.
