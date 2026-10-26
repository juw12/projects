// Creates/updates the Android project and adds the GlowBrowser plugin (the built-in browser Glow Hands drives).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platform = process.argv[2];
if (platform !== 'android') throw new Error('Only android is supported for now');
const config = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);
const versionCode = major * 1000000 + minor * 1000 + patch;
const cli = path.join(root, 'node_modules/@capacitor/cli/bin/capacitor');
function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, stdio: 'inherit', env: { ...process.env, CAPACITOR_TELEMETRY_DISABLED: '1' } });
  if (result.status !== 0) throw new Error('Capacitor failed: ' + args.join(' '));
}
if (!fs.existsSync(path.join(root, 'android'))) run(['add', 'android']);
run(['sync', 'android']);

const android = path.join(root, 'android');
const java = path.join(android, 'app/src/main/java', ...config.appId.split('.'));
fs.mkdirSync(java, { recursive: true });
const plugin = fs.readFileSync(path.join(root, 'native/android/GlowBrowserPlugin.java'), 'utf8').replace(/^package [^;]+;/m, 'package ' + config.appId + ';');
fs.writeFileSync(path.join(java, 'GlowBrowserPlugin.java'), plugin);
fs.writeFileSync(path.join(java, 'MainActivity.java'), `package ${config.appId};
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {
  @Override public void onCreate(Bundle state) {
    registerPlugin(GlowBrowserPlugin.class);
    super.onCreate(state);
  }
}
`);

const manifestPath = path.join(android, 'app/src/main/AndroidManifest.xml');
let manifest = fs.readFileSync(manifestPath, 'utf8');
manifest = manifest.replace('android:allowBackup="true"', 'android:allowBackup="false"');
if (!manifest.includes('android.permission.INTERNET')) manifest = manifest.replace('<application', '<uses-permission android:name="android.permission.INTERNET" />\n    <application');
fs.writeFileSync(manifestPath, manifest);

// Version and release signing (the keystore comes from CI secrets; debug builds stay unsigned-for-release).
const gradlePath = path.join(android, 'app/build.gradle');
let gradle = fs.readFileSync(gradlePath, 'utf8');
gradle = gradle.replace(/versionCode \d+/, 'versionCode ' + versionCode).replace(/versionName "[^"]*"/, 'versionName "' + pkg.version + '"');
if (!gradle.includes('glowRelease')) {
  gradle = gradle.replace(/android \{/, `android {
    signingConfigs {
        glowRelease {
            if (System.getenv("GLOW_ANDROID_KEYSTORE_PATH")) {
                storeFile file(System.getenv("GLOW_ANDROID_KEYSTORE_PATH"))
                storePassword System.getenv("GLOW_ANDROID_SIGNING_PASSWORD")
                keyAlias "glow"
                keyPassword System.getenv("GLOW_ANDROID_SIGNING_PASSWORD")
                storeType "pkcs12"
            }
        }
    }`);
  gradle = gradle.replace(/release \{/, 'release {\n            if (System.getenv("GLOW_ANDROID_KEYSTORE_PATH")) signingConfig signingConfigs.glowRelease');
}
fs.writeFileSync(gradlePath, gradle);
console.log('Android project ready: Glow ' + pkg.version + ' (' + versionCode + ') with the GlowBrowser plugin.');
