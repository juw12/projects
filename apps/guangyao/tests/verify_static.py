"""Dependency-free structural checks for the public demo and publishing metadata."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
import importlib.util
import json
import re
import struct
import unittest

APP = Path(__file__).resolve().parents[1]
REPOSITORY = APP.parents[1]
WEB = APP / 'web'


class References(HTMLParser):
    def __init__(self):
        super().__init__()
        self.references = []

    def handle_starttag(self, tag, attributes):
        for key, value in attributes:
            if key in ('href', 'src') and value:
                self.references.append(value)


class StaticAppTests(unittest.TestCase):
    def test_relative_html_resources_exist(self):
        for page in WEB.glob('*.html'):
            parser = References()
            parser.feed(page.read_text(encoding='utf-8'))
            for reference in parser.references:
                url = urlsplit(reference)
                if url.scheme or url.netloc or not url.path:
                    continue
                self.assertFalse(url.path.startswith('/'), reference)
                destination = (page.parent / url.path).resolve()
                self.assertTrue(destination.is_relative_to(WEB.resolve()), reference)
                self.assertTrue(destination.exists(), reference)

    def test_manifest_and_icons(self):
        manifest = json.loads((WEB / 'manifest.webmanifest').read_text())
        self.assertEqual(manifest['scope'], './')
        self.assertEqual(manifest['id'], './')
        self.assertEqual(manifest['display'], 'standalone')
        self.assertTrue(manifest['start_url'].startswith('./'))
        self.assertEqual({icon['sizes'] for icon in manifest['icons']}, {'192x192', '512x512'})
        for icon in manifest['icons']:
            data = (WEB / icon['src']).read_bytes()
            self.assertEqual(data[:8], b'\x89PNG\r\n\x1a\n')
            width, height = struct.unpack('>II', data[16:24])
            self.assertEqual(f'{width}x{height}', icon['sizes'])
            self.assertIn('maskable', icon['purpose'])

    def test_public_cache_allowlist(self):
        worker = (WEB / 'sw.js').read_text()
        block = re.search(r'const SHELL_FILES = \[(.*?)\];', worker, re.S).group(1)
        paths = re.findall(r"'([^']+)'", block)
        self.assertEqual(len(paths), 7)
        for relative in paths:
            self.assertTrue(relative.startswith('./'))
            self.assertTrue((WEB / relative).is_file())
            self.assertNotIn('/api/', relative)
        self.assertIn('ACTIVATE_APPROVED_UPDATE', worker)
        self.assertIn('SHELL_URLS.has(canonicalURL)', worker)
        self.assertIn('encodeURIComponent(BASE.pathname)', worker)

    def test_demo_boundaries_remain_visible(self):
        source = (WEB / 'index.html').read_text()
        for required in ['本機示範', '非官方授證', '沒有收款', 'setNavigationOpen', 'withMutationLock', 'data-intent=', 'normalizeState', 'study.js', 'GY_PAGES', 'normalizeStudyState']:
            self.assertIn(required, source)
        study = (WEB / 'study.js').read_text()
        for required in ['LESSON_CONTENT', 'scheduleCard', 'localTutor', 'aiOptIn', '示範教材']:
            self.assertIn(required, study)
        self.assertNotIn('<script src="https://js.puter.com', source)
        self.assertIn('https://juwpegatron.github.io/portfolio/#projects', source)
        self.assertNotIn('api.stripe.com', source)
        self.assertNotIn('supabase.co', source)

    def test_catalog_and_generated_note_status(self):
        catalog = json.loads((REPOSITORY / 'scripts/apps.json').read_text())['apps']
        entries = [entry for entry in catalog if entry['id'] == 'guangyao']
        self.assertEqual(len(entries), 1)
        app = entries[0]
        self.assertEqual(app['status'], 'frontend-pwa-demo')
        self.assertIn('unofficial', app['description'].lower())
        for reference in app['links'].values():
            path = urlsplit(reference).path.removeprefix('guangyao/')
            self.assertTrue((WEB / (path or 'index.html')).exists())
        worker = (WEB / 'sw.js').read_text()
        self.assertIn(f"const RELEASE = '{app['version']}';", worker)
        script = REPOSITORY / 'scripts/publish_portfolio.py'
        spec = importlib.util.spec_from_file_location('publisher_under_test', script)
        publisher = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(publisher)
        note = publisher.render_note(app, '2026-10-25')
        self.assertIn('status: frontend-pwa-demo', note)
        self.assertNotIn('status: shipped', note)
        ordinary = dict(app)
        ordinary.pop('status')
        self.assertIn('status: shipped', publisher.render_note(ordinary, '2026-10-25'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
