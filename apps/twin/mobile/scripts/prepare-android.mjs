// Creates/updates the Capacitor Android project for Twin: version (from ../web/release.json, the one
// place Twin's version is kept), icons, splash and release signing from CI secrets.
// Twin's web app is bundled (www/, from npm run build), so the app works offline.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
const release = JSON.parse(fs.readFileSync(path.resolve(root, '..', 'web', 'release.json'), 'utf8'));
const [major, minor, patch] = String(release.version).split('.').map(Number);
if ([major, minor, patch].some((value) => !Number.isInteger(value) || value < 0 || value > 999)) {
  throw new Error('Unsupported version ' + release.version);
}
const versionCode = major * 1000000 + minor * 1000 + patch;
const cli = path.join(root, 'node_modules/@capacitor/cli/bin/capacitor');
const assets = path.join(root, 'assets');

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CAPACITOR_TELEMETRY_DISABLED: '1' },
  });
  if (result.status !== 0) {
    throw new Error('Capacitor failed: ' + args.join(' '));
  }
}

function edit(file, change) {
  const before = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, change(before));
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

if (!fs.existsSync(path.join(root, 'www', 'index.html'))) {
  throw new Error('www/ is missing: run "npm run build" first.');
}
if (!fs.existsSync(path.join(root, 'android'))) {
  run(['add', 'android']);
}
run(['sync', 'android']);

const android = path.join(root, 'android');
const res = path.join(android, 'app/src/main/res');

edit(path.join(android, 'app/src/main/AndroidManifest.xml'), (manifest) => {
  let text = manifest.replace('android:allowBackup="true"', 'android:allowBackup="false"');
  if (!text.includes('android.permission.INTERNET')) {
    text = text.replace('</manifest>', '    <uses-permission android:name="android.permission.INTERNET" />\n</manifest>');
  }
  return text;
});

// Version + release signing (PKCS#12 from CI secrets; the keystore never lives in the repo).
edit(path.join(android, 'app/build.gradle'), (gradle) => {
  let text = gradle
    .replace(/versionCode \d+/, 'versionCode ' + versionCode)
    .replace(/versionName "[^"]*"/, 'versionName "' + release.version + '"');
  if (!text.includes('TWIN_ANDROID_KEYSTORE_PATH')) {
    text = text.replace('    buildTypes {', `    signingConfigs {
        release {
            def location = System.getenv('TWIN_ANDROID_KEYSTORE_PATH')
            if (location) {
                storeFile file(location)
                storeType 'PKCS12'
                storePassword System.getenv('TWIN_ANDROID_SIGNING_PASSWORD')
                keyAlias System.getenv('TWIN_ANDROID_KEY_ALIAS') ?: 'twin'
                keyPassword System.getenv('TWIN_ANDROID_SIGNING_PASSWORD')
            }
        }
    }
    buildTypes {`);
    text = text.replace(/(\n\s*release \{\n)(\s*minifyEnabled)/,
      "$1            if (System.getenv('TWIN_ANDROID_KEYSTORE_PATH')) signingConfig signingConfigs.release\n$2");
  }
  if (!text.includes('signingConfigs.release')) {
    throw new Error('app/build.gradle layout changed: release signing was not wired in');
  }
  return text;
});

// Launcher icons: legacy PNGs plus an adaptive icon (Twin's own icon, its art inside the safe middle).
for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
  const directory = path.join(res, 'mipmap-' + density);
  fs.mkdirSync(directory, { recursive: true });
  for (const name of ['ic_launcher.png', 'ic_launcher_round.png']) {
    fs.copyFileSync(path.join(assets, 'icon-' + density + '.png'), path.join(directory, name));
  }
  fs.copyFileSync(path.join(assets, 'foreground-' + density + '.png'), path.join(directory, 'ic_launcher_foreground.png'));
}
const adaptive = path.join(res, 'mipmap-anydpi-v26');
fs.mkdirSync(adaptive, { recursive: true });
const adaptiveXml = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">' +
  '<background android:drawable="@color/twin_icon_background"/><foreground android:drawable="@mipmap/ic_launcher_foreground"/></adaptive-icon>\n';
for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
  fs.writeFileSync(path.join(adaptive, name), adaptiveXml);
}
fs.mkdirSync(path.join(res, 'values'), { recursive: true });
fs.writeFileSync(path.join(res, 'values/twin_colors.xml'),
  '<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="twin_icon_background">#152B45</color>' +
  '<color name="twin_background">' + config.backgroundColor + '</color></resources>\n');

// Splash: Twin's icon on its dark background instead of Capacitor's default image.
walk(res, (file) => {
  if (path.basename(file) === 'splash.png') {
    fs.rmSync(file);
  }
});
fs.mkdirSync(path.join(res, 'drawable-nodpi'), { recursive: true });
fs.copyFileSync(path.join(assets, 'splash-logo.png'), path.join(res, 'drawable-nodpi/splash_logo.png'));
fs.mkdirSync(path.join(res, 'drawable'), { recursive: true });
fs.writeFileSync(path.join(res, 'drawable/splash.xml'),
  '<?xml version="1.0" encoding="utf-8"?>\n<layer-list xmlns:android="http://schemas.android.com/apk/res/android">\n' +
  '    <item android:drawable="@color/twin_background"/>\n' +
  '    <item android:gravity="center" android:width="144dp" android:height="144dp" android:drawable="@drawable/splash_logo"/>\n' +
  '</layer-list>\n');

// The smaller Gradle "bin" distribution is enough for command-line builds.
edit(path.join(android, 'gradle/wrapper/gradle-wrapper.properties'), (props) => props.replace('-all.zip', '-bin.zip'));

console.log('Prepared Twin for Android ' + release.version + ' (' + versionCode + ') with the bundled web app.');
