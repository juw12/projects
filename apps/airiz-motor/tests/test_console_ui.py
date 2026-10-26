#!/usr/bin/env python3
"""Dependency-free structural regression checks for the controller redesign.

Browser interaction checks are separate; these tests also run in the existing CI.
"""
from html.parser import HTMLParser
from pathlib import Path
import json
import unittest

APP = Path(__file__).resolve().parent.parent
WEB = APP / 'web'


class ShellParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.elements = []
        self.scripts = []
        self.styles = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        self.elements.append((tag, attributes))
        if tag == 'script' and 'src' in attributes:
            self.scripts.append(attributes['src'])
        if tag == 'link' and attributes.get('rel') == 'stylesheet':
            self.styles.append(attributes['href'])


class ControllerShellTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = (WEB / 'index.html').read_text(encoding='utf-8')
        cls.parser = ShellParser()
        cls.parser.feed(cls.html)
        cls.by_id = {
            attrs['id']: (tag, attrs)
            for tag, attrs in cls.parser.elements
            if 'id' in attrs
        }

    def test_original_elements_are_retained_and_unique(self):
        expected = json.loads((APP / 'tests' / 'fixtures' / 'original-shell-ids.json').read_text(encoding='utf-8'))
        ids = [attrs['id'] for _, attrs in self.parser.elements if 'id' in attrs]
        self.assertEqual(len(ids), len(set(ids)), 'Duplicate HTML IDs break event bindings')
        self.assertTrue(set(expected).issubset(ids), 'Original app controls must remain available')

    def test_dashboard_assets_load_after_the_existing_app(self):
        scripts = self.parser.scripts
        expected = ['data/commands.js', 'data/macros.js', 'data/sounds.js', 'app.js', 'console-ui.js']
        positions = [scripts.index(name) for name in expected]
        self.assertEqual(positions, sorted(positions))
        self.assertIn('styles.css', self.parser.styles)
        self.assertIn('console-ui.css', self.parser.styles)
        for name in expected + self.parser.styles:
            self.assertTrue((WEB / name).is_file(), name)

    def test_offline_worker_includes_new_assets_and_uses_its_scope(self):
        worker = (WEB / 'sw.js').read_text(encoding='utf-8')
        self.assertIn("'./console-ui.js'", worker)
        self.assertIn("'./console-ui.css'", worker)
        self.assertIn('self.registration.scope', worker)
        self.assertIn('name.startsWith(CACHE_PREFIX)', worker)
        self.assertIn('cache.match(event.request)', worker)
        self.assertNotIn('caches.match(event.request)', worker)

    def test_reference_metadata_is_not_hidden(self):
        self.assertIn('reference-strip', self.by_id)
        for element_id in ['fw-version', 'data-source']:
            self.assertNotIn('hidden', self.by_id[element_id][1])

    def test_install_and_preferences_have_accessible_entry_points(self):
        self.assertEqual(self.by_id['install-gate'][0], 'dialog')
        self.assertNotIn('hidden', self.by_id['btn-install-app'][1])
        self.assertIn('btn-shortcuts-mobile', self.by_id)
        self.assertIn('console-settings-bar', self.by_id)
        for element_id in ['chk-audio-autosave', 'chk-autoscroll']:
            self.assertEqual(self.by_id[element_id][1]['type'], 'checkbox')
            self.assertNotIn('hidden', self.by_id[element_id][1])

    def test_system_theme_is_retained(self):
        application = (WEB / 'app.js').read_text(encoding='utf-8')
        stylesheet = (WEB / 'console-ui.css').read_text(encoding='utf-8')
        self.assertIn("['dark', 'light', 'system']", application)
        self.assertIn('data-theme="system"', stylesheet)
        self.assertIn('prefers-color-scheme: light', stylesheet)
        self.assertIn("theme === 'system'", self.html)

    def test_new_jog_controls_use_finite_native_ranges(self):
        for axis, speed_max in [('pan', '17'), ('rising', '30')]:
            speed = self.by_id[axis + '-speed'][1]
            steps = self.by_id[axis + '-steps'][1]
            self.assertEqual(speed['min'], '1')
            self.assertEqual(speed['max'], speed_max)
            self.assertEqual(steps['min'], '1')
            self.assertEqual(steps['max'], '99999')
            self.assertEqual(steps['value'], '1')
        self.assertNotIn('checked', self.by_id['arm-jog'][1])
        self.assertIn('not position feedback', self.html.lower())
        self.assertIn('does not stop an in-flight move', self.html)


if __name__ == '__main__':
    unittest.main(verbosity=2)
