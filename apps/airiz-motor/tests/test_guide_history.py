#!/usr/bin/env python3
"""Guide → History of the app: complete, newest first, translated; Camera tab keeps the 1.11.20 layout."""
from pathlib import Path
import html
import json
import re
import unittest

APP = Path(__file__).resolve().parent.parent
WEB = APP / 'web'
ITEM = re.compile(r'<li><time>(.*?)</time><div><strong>(.*?)</strong><p>(.*?)</p></div></li>')
VERSION = re.compile(r'\((\d+(?:\.\d+)+)')


def text_content(fragment):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', fragment))).strip()


def version_key(version):
    return tuple(int(part) for part in version.split('.'))


class GuideHistoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.index = (WEB / 'index.html').read_text(encoding='utf-8')
        timeline = re.search(r'<ol class="guide-timeline">(.*?)</ol>', cls.index, re.S).group(1)
        cls.items = ITEM.findall(timeline)
        cls.version = json.loads((APP / 'desktop' / 'package.json').read_text(encoding='utf-8'))['version']
        cls.zh_tw = json.loads((APP / 'i18n' / 'zh-TW.json').read_text(encoding='utf-8'))

    def versions(self):
        found = []
        for _, title, _ in self.items:
            match = VERSION.search(title)
            if match:
                found.append(match.group(1))
        return found

    def test_history_has_the_current_version_first(self):
        versions = self.versions()
        self.assertTrue(versions, 'no versioned history entries')
        self.assertEqual(versions[0], self.version, 'the newest history entry must be the app version')

    def test_history_is_newest_first_without_gaps_in_recent_releases(self):
        versions = self.versions()
        keys = [version_key(v) for v in versions]
        self.assertEqual(keys, sorted(keys, reverse=True), 'history must be ordered newest first')
        self.assertEqual(len(set(versions)), len(versions), 'duplicate history entries')
        major, minor, patch = version_key(self.version)[:3]
        for missing_patch in range(patch, -1, -1):
            self.assertIn(f'{major}.{minor}.{missing_patch}', versions,
                          f'history is missing {major}.{minor}.{missing_patch}')

    def test_history_entries_are_translated(self):
        for _, title, body in self.items:
            self.assertIn(text_content(title), self.zh_tw['text'], f'zh-TW title missing: {text_content(title)}')
            table = self.zh_tw['html'] if '<' in body else self.zh_tw['text']
            self.assertIn(text_content(body), table, f'zh-TW body missing for: {text_content(title)}')

    def test_camera_tab_keeps_the_1_11_20_layout(self):
        self.assertIn('id="ptz-speed-row"', self.index, 'Motor speed belongs in the Position group')
        self.assertIn('<div hidden="" id="ptz-height-reference">', self.index)
        self.assertIn('<details class="ptz-group" hidden="" id="ptz-calibration">', self.index)
        self.assertNotIn('<li><strong>Motor speed</strong>', self.index, 'old Motor speed row in Calibration')
        self.assertIn('id="ptz-camera-night"', self.index, '1.11.21 camera night-vision option')


if __name__ == '__main__':
    unittest.main(verbosity=2)
