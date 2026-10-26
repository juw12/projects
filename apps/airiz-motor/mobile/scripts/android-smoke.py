"""Exercise the signed APK in a disposable Android emulator, not on real hardware."""
from pathlib import Path
import json
import re
import subprocess
import time
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
PACKAGE = 'io.github.juwpegatron.airiz.mobile'
version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
output = ROOT / 'dist'
output.mkdir(exist_ok=True)
apk = output / f'AIRIZ-Mobile-{version}-android.apk'


def adb(*arguments, binary=False):
    result = subprocess.run(['adb', *arguments], capture_output=True, check=True)
    return result.stdout if binary else result.stdout.decode('utf-8', errors='replace')


def hierarchy():
    adb('shell', 'uiautomator', 'dump', '/sdcard/airiz-ui.xml')
    return ET.fromstring(adb('shell', 'cat', '/sdcard/airiz-ui.xml'))


def find_text(root, label):
    return next((node for node in root.iter('node') if node.get('text') == label or node.get('content-desc') == label), None)


def tap_text(label):
    node = find_text(hierarchy(), label)
    if node is None:
        raise AssertionError('Visible control not found: ' + label)
    numbers = [int(number) for number in re.findall(r'\d+', node.attrib['bounds'])]
    x = (numbers[0] + numbers[2]) // 2
    y = (numbers[1] + numbers[3]) // 2
    adb('shell', 'input', 'tap', str(x), str(y))


adb('install', '-r', str(apk))
adb('shell', 'am', 'start', '-n', PACKAGE + '/.MainActivity')
time.sleep(10)
try:
    initial = hierarchy()
    assert find_text(initial, 'Connect Bluetooth') is not None
    tap_text('Try demo')
    time.sleep(3)
    current = hierarchy()
    assert any('Demo Mode' in (node.get('text', '') + node.get('content-desc', '')) for node in current.iter('node'))
    (output / 'airiz-android-emulator.png').write_bytes(adb('exec-out', 'screencap', '-p', binary=True))
    report = {'result': 'passed', 'signed_apk_installed': True, 'native_bluetooth_ui_loaded': True, 'demo_mode_started': True, 'physical_bluetooth_tested': False}
    (output / 'android-smoke-results.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report))
except Exception:
    (output / 'airiz-android-failure.png').write_bytes(adb('exec-out', 'screencap', '-p', binary=True))
    (output / 'android-ui-failure.xml').write_text(adb('shell', 'cat', '/sdcard/airiz-ui.xml'), encoding='utf-8')
    (output / 'android-logcat.txt').write_text(adb('logcat', '-d', '-t', '500'), encoding='utf-8')
    raise
finally:
    adb('shell', 'am', 'force-stop', PACKAGE)
