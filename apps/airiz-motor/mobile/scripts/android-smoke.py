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


def tap_node(node):
    numbers = [int(number) for number in re.findall(r'\d+', node.attrib['bounds'])]
    x = (numbers[0] + numbers[2]) // 2
    y = (numbers[1] + numbers[3]) // 2
    adb('shell', 'input', 'tap', str(x), str(y))


def tap_text(label):
    node = find_text(hierarchy(), label)
    if node is None:
        raise AssertionError('Visible control not found: ' + label)
    tap_node(node)


def dismiss_blockers(root):
    """Clear dialogs that cover the console: emulator ANR prompts and the first-run language dialog."""
    texts = [node.get('text', '') for node in root.iter('node')]
    if any("isn't responding" in text for text in texts):
        wait_button = find_text(root, 'Wait')
        if wait_button is not None:
            tap_node(wait_button)
            return True
    first_run_dialogs = (
        ('Welcome to AIRIZ Console', 'Continue'),
        ('Remote control by code', 'Not now'),
    )
    for marker, button_label in first_run_dialogs:
        if find_text(root, marker) is not None:
            button = find_text(root, button_label)
            if button is not None:
                tap_node(button)
                return True
    return False


adb('install', '-r', str(apk))
adb('shell', 'am', 'start', '-n', PACKAGE + '/.MainActivity')
time.sleep(20)
try:
    ready = False
    for attempt in range(15):
        try:
            initial = hierarchy()
            if dismiss_blockers(initial):
                time.sleep(2)
                continue
            ready = find_text(initial, 'Connect Bluetooth') is not None
            if ready:
                break
        except (subprocess.CalledProcessError, ET.ParseError):
            pass
        time.sleep(3)
    assert ready, 'Native Bluetooth UI did not finish loading'
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
    try:
        (output / 'android-ui-failure.xml').write_text(adb('shell', 'cat', '/sdcard/airiz-ui.xml'), encoding='utf-8')
    except subprocess.CalledProcessError:
        pass
    (output / 'android-logcat.txt').write_text(adb('logcat', '-d', '-t', '4000'), encoding='utf-8')
    raise
finally:
    adb('shell', 'am', 'force-stop', PACKAGE)
