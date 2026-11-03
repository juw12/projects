// Bundles web/app/ into www/, creates/updates the Android project and applies Haru's
// permissions, icons, splash and version. Run from CI (or anywhere with Node 22+ and a JDK 21).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webApp = path.resolve(root, '../web/app');
const www = path.join(root, 'www');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);
const versionCode = major * 1000000 + minor * 1000 + patch;

// 1. The app ships its own copy of the web app: no remote UI, works offline.
if (!fs.existsSync(path.join(webApp, 'index.html'))) throw new Error('web/app/index.html not found');
fs.rmSync(www, { recursive: true, force: true });
fs.cpSync(webApp, www, { recursive: true, filter: (name) => !name.endsWith('.md') });

// 2. Capacitor project.
const cli = path.join(root, 'node_modules/@capacitor/cli/bin/capacitor');
function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CAPACITOR_TELEMETRY_DISABLED: '1' },
  });
  if (result.status !== 0) throw new Error('Capacitor failed: ' + args.join(' '));
}
if (!fs.existsSync(path.join(root, 'android'))) run(['add', 'android']);
run(['sync', 'android']);

const android = path.join(root, 'android');
const res = path.join(android, 'app/src/main/res');

// 3. Permissions: location for walks (foreground only), camera for "take a photo".
const manifestPath = path.join(android, 'app/src/main/AndroidManifest.xml');
let manifest = fs.readFileSync(manifestPath, 'utf8');
const permissions = [
  '<uses-permission android:name="android.permission.INTERNET" />',
  '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
  '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
  '<uses-permission android:name="android.permission.CAMERA" />',
  '<uses-feature android:name="android.hardware.camera" android:required="false" />',
  '<uses-feature android:name="android.hardware.location.gps" android:required="false" />',
];
for (const line of permissions) {
  const name = line.match(/android:name="([^"]+)"/)[1];
  if (!manifest.includes(`"${name}"`)) manifest = manifest.replace('<application', line + '\n    <application');
}
fs.writeFileSync(manifestPath, manifest);

// 4. Launcher icons (generated from web/app/icons) and a paper-coloured splash.
fs.cpSync(path.join(root, 'res'), res, { recursive: true });
fs.mkdirSync(path.join(res, 'values'), { recursive: true });
fs.writeFileSync(path.join(res, 'values/ic_launcher_background.xml'),
  '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#F6EFE2</color>\n</resources>\n');
for (const folder of fs.readdirSync(res)) {
  if (!folder.startsWith('drawable')) continue;
  const splash = path.join(res, folder, 'splash.png');
  if (fs.existsSync(splash)) fs.rmSync(splash);
}
fs.mkdirSync(path.join(res, 'drawable'), { recursive: true });
fs.writeFileSync(path.join(res, 'drawable/splash.xml'), `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item><color android:color="#F6EFE2" /></item>
    <item android:width="160dp" android:height="160dp" android:gravity="center" android:drawable="@mipmap/ic_launcher_foreground" />
</layer-list>
`);

// 5. Version.
const gradlePath = path.join(android, 'app/build.gradle');
let gradle = fs.readFileSync(gradlePath, 'utf8');
gradle = gradle
  .replace(/versionCode \d+/, 'versionCode ' + versionCode)
  .replace(/versionName "[^"]*"/, 'versionName "' + pkg.version + '"');
fs.writeFileSync(gradlePath, gradle);

console.log(`Android project ready: ${config.appName} ${pkg.version} (${versionCode}), ${fs.readdirSync(www).length} web entries.`);
