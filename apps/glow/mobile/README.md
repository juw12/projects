# Glow for Android

GlowLead packaged with Capacitor, plus a native **GlowBrowser** plugin
(`native/android/GlowBrowserPlugin.java`): a second WebView shown as a panel over GlowLead that the shared
Glow Hands core (`../web/shared/hands-core.js`) drives one action at a time. The plugin only opens http(s)
pages, exposes no JavaScript bridge to the pages it shows, and GlowLead applies the same rules as Glow Hands
(no local-network hosts, password fields refused, approval before submitting).

Build (CI does this: `.github/workflows/glow-android.yml`):

```
npm install
npm run build             # copies GlowLead into www/
npm run android:prepare   # cap add/sync android, installs the plugin, signing config
cd android && ./gradlew assembleRelease
```

Release signing reads `GLOW_ANDROID_KEYSTORE_PATH` and `GLOW_ANDROID_SIGNING_PASSWORD` (PKCS#12, alias
`glow`). Keep the keystore: Android only installs updates signed with the same key. Its SHA-256 fingerprint
is in `android-certificate-sha256.txt`.

`scripts/android-e2e.py` runs a mission on an emulator through the WebView DevTools socket: types into a
public test form, checks that submitting needs approval and that private addresses are blocked.
