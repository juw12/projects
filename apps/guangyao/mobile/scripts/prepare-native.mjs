// Creates/updates the native projects for Guang Yao Together and applies the app's own pieces:
// new-window (Puter sign-in) support, icons, splash, version and release signing.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platform = process.argv[2];
if (!['android', 'ios'].includes(platform)) {
  throw new Error('Usage: node scripts/prepare-native.mjs android|ios');
}
const config = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);
const versionCode = major * 1000000 + minor * 1000 + patch;
const cli = path.join(root, 'node_modules/@capacitor/cli/bin/capacitor');

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CAPACITOR_TELEMETRY_DISABLED: '1' }
  });
  if (result.status !== 0) {
    throw new Error('Capacitor failed: ' + args.join(' '));
  }
}

function edit(file, transform) {
  const before = fs.readFileSync(file, 'utf8');
  const after = transform(before);
  fs.writeFileSync(file, after);
  return after;
}

function walk(folder, visit) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      walk(full, visit);
    } else {
      visit(full);
    }
  }
}

if (!fs.existsSync(path.join(root, platform))) {
  run(['add', platform]);
}
run(['sync', platform]);

if (platform === 'android') {
  const android = path.join(root, 'android');
  const main = path.join(android, 'app/src/main');
  const javaDir = path.join(main, 'java', ...config.appId.split('.'));
  fs.mkdirSync(javaDir, { recursive: true });
  const activity = fs.readFileSync(path.join(root, 'native/android/MainActivity.java'), 'utf8')
    .replace(/^package [^;]+;/m, 'package ' + config.appId + ';');
  fs.writeFileSync(path.join(javaDir, 'MainActivity.java'), activity);

  edit(path.join(main, 'AndroidManifest.xml'), manifest => {
    let result = manifest.replace('android:allowBackup="true"', 'android:allowBackup="false"');
    if (!result.includes('android.permission.INTERNET')) {
      result = result.replace('<application', '<uses-permission android:name="android.permission.INTERNET" />\n    <application');
    }
    return result;
  });

  // Icons: adaptive icon (sun on the brand green) plus legacy PNGs; splash: brand green with the sun.
  const res = path.join(main, 'res');
  fs.cpSync(path.join(root, 'resources/android'), res, { recursive: true });
  const adaptive = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/ic_launcher_background"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n';
  fs.mkdirSync(path.join(res, 'mipmap-anydpi-v26'), { recursive: true });
  fs.writeFileSync(path.join(res, 'mipmap-anydpi-v26/ic_launcher.xml'), adaptive);
  fs.writeFileSync(path.join(res, 'mipmap-anydpi-v26/ic_launcher_round.xml'), adaptive);
  fs.writeFileSync(path.join(res, 'values/ic_launcher_background.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#183E3C</color>\n</resources>\n');
  walk(res, file => {
    if (path.basename(file) === 'splash.png') {
      fs.rmSync(file);
    }
  });
  fs.mkdirSync(path.join(res, 'drawable'), { recursive: true });
  fs.writeFileSync(path.join(res, 'drawable/splash.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<layer-list xmlns:android="http://schemas.android.com/apk/res/android">\n    <item android:drawable="@color/ic_launcher_background"/>\n    <item android:gravity="center" android:width="160dp" android:height="160dp" android:drawable="@drawable/splash_logo"/>\n</layer-list>\n');

  // Version and release signing (the keystore path/password come from the environment, never the repo).
  edit(path.join(android, 'app/build.gradle'), gradle => {
    let result = gradle
      .replace(/versionCode \d+/, 'versionCode ' + versionCode)
      .replace(/versionName "[^"]*"/, 'versionName "' + pkg.version + '"');
    if (!result.includes('guangyaoRelease')) {
      result = result.replace(/android \{/, `android {
    signingConfigs {
        guangyaoRelease {
            if (System.getenv("GUANGYAO_ANDROID_KEYSTORE_PATH")) {
                storeFile file(System.getenv("GUANGYAO_ANDROID_KEYSTORE_PATH"))
                storePassword System.getenv("GUANGYAO_ANDROID_SIGNING_PASSWORD")
                keyAlias "guangyao"
                keyPassword System.getenv("GUANGYAO_ANDROID_SIGNING_PASSWORD")
                storeType "pkcs12"
            }
        }
    }`);
      result = result.replace(/release \{/, 'release {\n            if (System.getenv("GUANGYAO_ANDROID_KEYSTORE_PATH")) signingConfig signingConfigs.guangyaoRelease');
    }
    return result;
  });
  console.log(`Android project ready: ${config.appName} ${pkg.version} (${versionCode}).`);
}

if (platform === 'ios') {
  const app = path.join(root, 'ios/App/App');
  const snippet = fs.readFileSync(path.join(root, 'native/ios/GuangYaoViewController.swift'), 'utf8');
  edit(path.join(app, 'AppDelegate.swift'), source => {
    if (source.includes('class GuangYaoViewController')) {
      return source;
    }
    const withImport = source.includes('import WebKit') ? source : 'import WebKit\n' + source;
    return withImport + '\n' + snippet.replace(/^import WebKit\n/m, '');
  });
  edit(path.join(app, 'Base.lproj/Main.storyboard'), storyboard => {
    const patched = storyboard.replace(
      /customClass="CAPBridgeViewController" customModule="Capacitor"/,
      'customClass="GuangYaoViewController" customModule="App" customModuleProvider="target"'
    );
    if (!patched.includes('GuangYaoViewController')) {
      throw new Error('Main.storyboard layout changed: CAPBridgeViewController not found');
    }
    return patched;
  });
  const iconSet = path.join(app, 'Assets.xcassets/AppIcon.appiconset');
  const splashSet = path.join(app, 'Assets.xcassets/Splash.imageset');
  for (const [folder, source] of [[iconSet, 'AppIcon-512@2x.png'], [splashSet, 'splash-2732x2732.png']]) {
    if (!fs.existsSync(folder)) {
      continue;
    }
    for (const name of fs.readdirSync(folder).filter(file => file.endsWith('.png'))) {
      fs.copyFileSync(path.join(root, 'resources/ios', source), path.join(folder, name));
    }
  }
  edit(path.join(root, 'ios/App/App.xcodeproj/project.pbxproj'), project => project
    .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${pkg.version};`)
    .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${versionCode};`));
  console.log(`iOS project ready: ${config.appName} ${pkg.version} (${versionCode}).`);
}
