# Vitals for Android and iPhone

Capacitor 8 apps around the Vitals dashboard. The dashboard files are **bundled** (copied from
`../web` by `npm run build`, using the same `web/files.txt` list as the desktop installers), so the
app opens instantly and works offline. It starts on the phone layout (`mobile.html`).

What a phone app can do: iOS and Android don't let any app clean other apps' storage, so the phone
app does what is honest — your **computer's** health once paired (on the computer: Vitals →
**Devices → Connect my phone**, then type the code and address in the app, or scan the QR with the
camera), plus the phone **Guides**, the demo and the chat. The agent on the computer speaks plain
HTTP on your own Wi-Fi, so the Android app allows cleartext/mixed content and the iPhone app sets
`NSAllowsLocalNetworking`; nothing else is loaded from the network.

## Build

```sh
npm install
npm run android:prepare      # www/ + cap add/sync android + icons, splash, version, signing
cd android && ./gradlew assembleRelease
npm run ios:prepare          # macOS with Xcode: www/ + cap add/sync ios + icons, splash, version
```

Release signing reads `VITALS_ANDROID_KEYSTORE_PATH`, `VITALS_ANDROID_SIGNING_PASSWORD` and
`VITALS_ANDROID_KEY_ALIAS` (PKCS#12). CI uses the `VITALS_ANDROID_*` secrets if they exist, otherwise
the same developer key as Glow and Sync (`GLOW_ANDROID_*`, alias `glow`). Android only installs an
update over an existing app when it is signed with the same key, so keep using one key.

Icons and splash images in `assets/` are generated from `../web/icons/icon-512.png`.

## Distribution

All builds go to the [`vitals` release](https://github.com/juw12/projects/releases/tag/vitals)
via `.github/workflows/vitals-apps.yml`:

- **Android:** `Vitals-Android.apk` — open it on the phone and allow installing from the browser.
  Google Play would need a developer account ($25 once).
- **iPhone:** easiest is the web app: open <https://juw12.github.io/projects/vitals/mobile.html> in
  Safari → Share → **Add to Home Screen**. `Vitals-iPhone-unsigned.ipa` is for free sideloading with
  Sideloadly or AltStore and your own Apple ID (re-sign every 7 days). The App Store / TestFlight
  need the Apple Developer Program ($99/year).

## Checks

CI installs the debug APK on an Android emulator and reads the live page through the WebView
debugger (`scripts/android-smoke.py`), and launches the iPhone build in the simulator. Pairing with
a computer from inside the iPhone app has not been tested on a device yet.
