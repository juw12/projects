// Creates/updates the Capacitor Android or iOS project for Sync: permissions, deep links,
// background audio, icons, version and (Android) release signing from CI secrets.
// The app loads the live site (capacitor.config.json -> server.url), so a web deploy
// updates every installed app without a new build.
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
if ([major, minor, patch].some((value) => !Number.isInteger(value) || value < 0 || value > 999)) {
  throw new Error('Unsupported version ' + pkg.version);
}
const versionCode = major * 1000000 + minor * 1000 + patch;
const publicUrl = new URL(config.server.url);
const cli = path.join(root, 'node_modules/@capacitor/cli/bin/capacitor');

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
  const after = change(before);
  fs.writeFileSync(file, after);
}

if (!fs.existsSync(path.join(root, platform))) {
  run(platform === 'ios' ? ['add', 'ios', '--packagemanager', 'SPM'] : ['add', 'android']);
}
run(['sync', platform]);

if (platform === 'android') {
  const android = path.join(root, 'android');

  // Background playback service + lock-screen controls (native/android/*.java), registered in MainActivity.
  const javaDir = path.join(android, 'app/src/main/java', ...config.appId.split('.'));
  fs.mkdirSync(javaDir, { recursive: true });
  for (const name of ['SyncPlaybackService.java', 'SyncPlaybackPlugin.java']) {
    const source = fs.readFileSync(path.join(root, 'native/android', name), 'utf8')
      .replace(/^package [^;]+;/m, 'package ' + config.appId + ';');
    fs.writeFileSync(path.join(javaDir, name), source);
  }
  fs.writeFileSync(path.join(javaDir, 'MainActivity.java'), `package ${config.appId};

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SyncPlaybackPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`);

  // Microphone for voice chat; invite links open in the app.
  edit(path.join(android, 'app/src/main/AndroidManifest.xml'), (manifest) => {
    let text = manifest.replace('android:allowBackup="true"', 'android:allowBackup="false"');
    const permissions = [
      'android.permission.INTERNET',
      'android.permission.RECORD_AUDIO',
      'android.permission.MODIFY_AUDIO_SETTINGS',
      'android.permission.WAKE_LOCK',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
      'android.permission.FOREGROUND_SERVICE_MICROPHONE',
      'android.permission.POST_NOTIFICATIONS',
    ];
    for (const permission of permissions) {
      if (!text.includes(permission)) {
        text = text.replace('</manifest>', `    <uses-permission android:name="${permission}" />\n</manifest>`);
      }
    }
    if (!text.includes('SyncPlaybackService')) {
      text = text.replace('</application>',
        '    <service android:name=".SyncPlaybackService" android:exported="false"' +
        ' android:foregroundServiceType="mediaPlayback|microphone" />\n    </application>');
    }
    if (!text.includes('android.hardware.microphone')) {
      text = text.replace('</manifest>', '    <uses-feature android:name="android.hardware.microphone" android:required="false" />\n</manifest>');
    }
    if (!text.includes(publicUrl.pathname)) {
      const filter = `
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="${publicUrl.host}" android:pathPrefix="${publicUrl.pathname}" />
            </intent-filter>
        </activity>`;
      text = text.replace('</activity>', filter);
    }
    return text;
  });

  // Version + release signing (PKCS#12 from CI secrets; never publish an unsigned release).
  edit(path.join(android, 'app/build.gradle'), (gradle) => {
    let text = gradle
      .replace(/versionCode \d+/, 'versionCode ' + versionCode)
      .replace(/versionName "[^"]*"/, 'versionName "' + pkg.version + '"');
    if (!text.includes('SYNC_ANDROID_KEYSTORE_PATH')) {
      text = text.replace('    buildTypes {', `    signingConfigs {
        release {
            def location = System.getenv('SYNC_ANDROID_KEYSTORE_PATH')
            if (location) {
                storeFile file(location)
                storeType 'PKCS12'
                storePassword System.getenv('SYNC_ANDROID_SIGNING_PASSWORD')
                keyAlias System.getenv('SYNC_ANDROID_KEY_ALIAS') ?: 'sync'
                keyPassword System.getenv('SYNC_ANDROID_SIGNING_PASSWORD')
            }
        }
    }
    buildTypes {`);
      text = text.replace(/(\n\s*release \{\n)(\s*minifyEnabled)/, "$1            if (System.getenv('SYNC_ANDROID_KEYSTORE_PATH')) signingConfig signingConfigs.release\n$2");
    }
    return text;
  });

  // Launcher icons (legacy + adaptive).
  for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
    const directory = path.join(android, 'app/src/main/res/mipmap-' + density);
    fs.mkdirSync(directory, { recursive: true });
    for (const name of ['ic_launcher.png', 'ic_launcher_round.png']) {
      fs.copyFileSync(path.join(root, 'assets/icon-' + density + '.png'), path.join(directory, name));
    }
    fs.copyFileSync(path.join(root, 'assets/foreground-' + density + '.png'), path.join(directory, 'ic_launcher_foreground.png'));
  }
  const adaptive = path.join(android, 'app/src/main/res/mipmap-anydpi-v26');
  fs.mkdirSync(adaptive, { recursive: true });
  const adaptiveXml = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">' +
    '<background android:drawable="@color/sync_icon_background"/><foreground android:drawable="@mipmap/ic_launcher_foreground"/></adaptive-icon>\n';
  for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
    fs.writeFileSync(path.join(adaptive, name), adaptiveXml);
  }
  const values = path.join(android, 'app/src/main/res/values');
  fs.mkdirSync(values, { recursive: true });
  fs.writeFileSync(path.join(values, 'sync_colors.xml'),
    '<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="sync_icon_background">' + config.backgroundColor + '</color></resources>\n');
} else {
  const target = path.join(root, 'ios/App/App');

  // Microphone for voice chat; keep music playing with the screen locked.
  edit(path.join(target, 'Info.plist'), (plist) => {
    let text = plist;
    const additions = {
      NSMicrophoneUsageDescription: '<string>Sync uses the microphone only when you join voice chat in a room.</string>',
      UIBackgroundModes: '<array><string>audio</string></array>',
    };
    for (const [key, value] of Object.entries(additions)) {
      if (!text.includes('<key>' + key + '</key>')) {
        text = text.replace(/<\/dict>\s*<\/plist>\s*$/, '\t<key>' + key + '</key>\n\t' + value + '\n</dict>\n</plist>\n');
      }
    }
    return text;
  });

  // Playback audio session: keeps music going on the lock screen and with the silent switch on,
  // and makes Sync the "Now Playing" app (WebKit switches to play-and-record for voice chat).
  edit(path.join(target, 'AppDelegate.swift'), (swift) => {
    let text = swift;
    if (!text.includes('import AVFoundation')) {
      text = text.replace('import UIKit', 'import UIKit\nimport AVFoundation');
    }
    if (!text.includes('AVAudioSession')) {
      const hook = /(didFinishLaunchingWithOptions[^{]*\{\n)/;
      if (!hook.test(text)) {
        throw new Error('AppDelegate.swift layout changed: launch hook not found');
      }
      text = text.replace(hook, '$1        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [])\n');
    }
    return text;
  });

  edit(path.join(root, 'ios/App/App.xcodeproj/project.pbxproj'), (project) => project
    .replace(/IPHONEOS_DEPLOYMENT_TARGET = [^;]+;/g, 'IPHONEOS_DEPLOYMENT_TARGET = 16.0;')
    .replace(/MARKETING_VERSION = [^;]+;/g, 'MARKETING_VERSION = ' + pkg.version + ';')
    .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, 'CURRENT_PROJECT_VERSION = ' + versionCode + ';'));

  const icons = path.join(target, 'Assets.xcassets/AppIcon.appiconset');
  for (const name of fs.readdirSync(icons).filter((file) => file.endsWith('.png'))) {
    fs.copyFileSync(path.join(root, 'assets/app-icon-1024.png'), path.join(icons, name));
  }
}

console.log('Prepared Sync ' + platform + ' ' + pkg.version + ' (' + versionCode + ') loading ' + config.server.url);
