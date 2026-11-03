# Ashiato for Android

The web app in `../web/app/` wrapped with [Capacitor](https://capacitorjs.com) 8. Nothing is loaded
from a remote UI: the APK ships its own copy, keeps the diary in the app's WebView storage, and asks
for location (walks, foreground only) and camera ("take a photo") the first time they are used.

CI (`.github/workflows/ashiato-apps.yml`) runs `npm install`, `npm run android:prepare` and
`./gradlew assembleDebug`, starts the APK on an emulator for screenshots, and publishes
`Ashiato-android.apk` to the `ashiato-latest` release.

Locally (Node 22+, JDK 21, Android SDK):

    npm install
    npm run android:prepare
    cd android && ./gradlew assembleDebug

`res/` holds launcher icons generated from `../web/app/icons/`.
