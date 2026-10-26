import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platform = process.argv[2];
if (!['android', 'ios'].includes(platform)) throw new Error('Choose android or ios');
const config = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);
if ([major, minor, patch].some(value => !Number.isInteger(value) || value < 0 || value > 999)) throw new Error('Unsupported mobile version');
const versionCode = major * 1000000 + minor * 1000 + patch;
const cli = path.join(root, 'node_modules/@capacitor/cli/bin/capacitor');
function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, stdio: 'inherit', env: { ...process.env, CAPACITOR_TELEMETRY_DISABLED: '1' } });
  if (result.status !== 0) throw new Error('Capacitor failed: ' + args.join(' '));
}
if (!fs.existsSync(path.join(root, platform))) run(platform === 'ios' ? ['add', 'ios', '--packagemanager', 'SPM'] : ['add', 'android']);
run(['sync', platform]);

if (platform === 'android') {
  const android = path.join(root, 'android');
  const java = path.join(android, 'app/src/main/java', ...config.appId.split('.'));
  fs.mkdirSync(java, { recursive: true });
  fs.copyFileSync(path.join(root, 'native/android/AirizClassicSerialPlugin.java'), path.join(java, 'AirizClassicSerialPlugin.java'));
  fs.writeFileSync(path.join(java, 'MainActivity.java'), `package ${config.appId};
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {
  @Override public void onCreate(Bundle state) {
    registerPlugin(AirizClassicSerialPlugin.class);
    super.onCreate(state);
  }
}
`);
  const manifestPath = path.join(android, 'app/src/main/AndroidManifest.xml');
  let manifest = fs.readFileSync(manifestPath, 'utf8');
  if (!manifest.includes('xmlns:tools=')) manifest = manifest.replace('<manifest ', '<manifest xmlns:tools="http://schemas.android.com/tools" ');
  manifest = manifest.replace('android:allowBackup="true"', 'android:allowBackup="false"');
  const permissions = `
    <uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" tools:targetApi="s" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-feature android:name="android.hardware.bluetooth_le" android:required="false" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />
`;
  if (!manifest.includes('neverForLocation')) manifest = manifest.replace('</manifest>', permissions + '</manifest>');
  fs.writeFileSync(manifestPath, manifest);
  const variables = path.join(android, 'variables.gradle');
  fs.writeFileSync(variables, fs.readFileSync(variables, 'utf8').replace(/minSdkVersion = \d+/, 'minSdkVersion = 26'));
  const gradlePath = path.join(android, 'app/build.gradle');
  let gradle = fs.readFileSync(gradlePath, 'utf8');
  gradle = gradle.replace(/versionCode \d+/, 'versionCode ' + versionCode).replace(/versionName "[^"]+"/, 'versionName "' + pkg.version + '"');
  if (!gradle.includes('AIRIZ_ANDROID_KEYSTORE_PATH')) {
    gradle = gradle.replace('    buildTypes {', `    signingConfigs {
        release {
            def location = System.getenv('AIRIZ_ANDROID_KEYSTORE_PATH')
            if (location) {
                storeFile file(location)
                storeType 'PKCS12'
                storePassword System.getenv('AIRIZ_ANDROID_SIGNING_PASSWORD')
                keyAlias 'airiz'
                keyPassword System.getenv('AIRIZ_ANDROID_SIGNING_PASSWORD')
            }
        }
    }
    buildTypes {`);
    gradle = gradle.replace('        release {\n            minifyEnabled', '        release {\n            signingConfig signingConfigs.release\n            minifyEnabled');
    gradle += `
gradle.taskGraph.whenReady { graph ->
    if (graph.allTasks.any { it.name.toLowerCase().contains('release') }
        && (!System.getenv('AIRIZ_ANDROID_KEYSTORE_PATH') || !System.getenv('AIRIZ_ANDROID_SIGNING_PASSWORD'))) {
        throw new GradleException('Release signing credentials are required; an unsigned APK must not be published.')
    }
}
`;
  }
  fs.writeFileSync(gradlePath, gradle);
  for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
    const directory = path.join(android, 'app/src/main/res/mipmap-' + density);
    fs.mkdirSync(directory, { recursive: true });
    for (const name of ['ic_launcher.png', 'ic_launcher_round.png']) fs.copyFileSync(path.join(root, 'assets/icon-' + density + '.png'), path.join(directory, name));
    fs.copyFileSync(path.join(root, 'assets/foreground-' + density + '.png'), path.join(directory, 'ic_launcher_foreground.png'));
  }
  const adaptive = path.join(android, 'app/src/main/res/mipmap-anydpi-v26');
  fs.mkdirSync(adaptive, { recursive: true });
  for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) fs.writeFileSync(path.join(adaptive, name), '<?xml version="1.0" encoding="utf-8"?><adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@android:color/black"/><foreground android:drawable="@mipmap/ic_launcher_foreground"/></adaptive-icon>');
} else {
  const target = path.join(root, 'ios/App/App');
  const plist = path.join(target, 'Info.plist');
  let content = fs.readFileSync(plist, 'utf8');
  const additions = {
    NSBluetoothAlwaysUsageDescription: 'Discover and connect to your selected AIRIZ test device. Bluetooth data stays on this phone unless you export it.',
    NSCameraUsageDescription: 'Use the phone camera for a local bench preview. This is not video streamed over Bluetooth.',
    NSMicrophoneUsageDescription: 'Microphone access is used only if you explicitly choose a recording feature that requests it.'
  };
  for (const [key, value] of Object.entries(additions)) {
    if (!content.includes('<key>' + key + '</key>')) content = content.replace('</dict>\n</plist>', '<key>' + key + '</key><string>' + value + '</string>\n</dict>\n</plist>');
  }
  fs.writeFileSync(plist, content);
  const project = path.join(root, 'ios/App/App.xcodeproj/project.pbxproj');
  let projectText = fs.readFileSync(project, 'utf8');
  projectText = projectText.replace(/IPHONEOS_DEPLOYMENT_TARGET = [^;]+;/g, 'IPHONEOS_DEPLOYMENT_TARGET = 16.0;');
  projectText = projectText.replace(/MARKETING_VERSION = [^;]+;/g, 'MARKETING_VERSION = ' + pkg.version + ';');
  fs.writeFileSync(project, projectText);
  const icons = path.join(target, 'Assets.xcassets/AppIcon.appiconset');
  fs.copyFileSync(path.join(root, 'assets/app-icon-1024.png'), path.join(icons, 'AppIcon-512@2x.png'));
  const privacy = path.join(target, 'PrivacyInfo.xcprivacy');
  fs.writeFileSync(privacy, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>NSPrivacyTracking</key><false/>
<key>NSPrivacyCollectedDataTypes</key><array/>
<key>NSPrivacyAccessedAPITypes</key><array><dict>
<key>NSPrivacyAccessedAPIType</key><string>NSPrivacyAccessedAPICategoryFileTimestamp</string>
<key>NSPrivacyAccessedAPITypeReasons</key><array><string>C617.1</string></array>
</dict><dict><key>NSPrivacyAccessedAPIType</key><string>NSPrivacyAccessedAPICategoryUserDefaults</string>
<key>NSPrivacyAccessedAPITypeReasons</key><array><string>CA92.1</string></array></dict></array>
</dict></plist>`);
  const require = createRequire(import.meta.url);
  const xcode = require('xcode');
  const parsed = xcode.project(project);
  parsed.parseSync();
  if (!fs.readFileSync(project, 'utf8').includes('PrivacyInfo.xcprivacy')) parsed.addResourceFile('App/PrivacyInfo.xcprivacy', { target: parsed.getFirstTarget().uuid });
  fs.writeFileSync(project, parsed.writeSync());
}
console.log('Prepared ' + platform + ' native project for ' + pkg.version + '.');
