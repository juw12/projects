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

    def test_link_share_preview(self):
        source = (WEB / 'index.html').read_text()
        site = 'https://juw12.github.io/projects/guangyao/'
        head = source.split('</head>', 1)[0]
        self.assertNotIn('互動原型', head)
        self.assertIn(f'<meta property="og:url" content="{site}">', source)
        self.assertIn(f'<meta property="og:image" content="{site}icons/og-image-v2.jpg">', source)
        self.assertIn('<meta name="twitter:card" content="summary_large_image">', source)
        self.assertIn('<meta property="og:locale:alternate" content="id_ID">', source)
        self.assertIn('Aplikasi belajar gratis', source)
        for name in ('og:title', 'og:description', 'og:image:alt'):
            self.assertRegex(source, rf'<meta property="{name}" content="[^"]+">')
        image = (WEB / 'icons' / 'og-image-v2.jpg').read_bytes()
        self.assertEqual(image[:3], b'\xff\xd8\xff')
        self.assertLess(len(image), 300_000)
        self.assertIn('content="1200"', source)
        self.assertIn('content="630"', source)

    def test_public_cache_allowlist(self):
        worker = (WEB / 'sw.js').read_text()
        block = re.search(r'const SHELL_FILES = \[(.*?)\];', worker, re.S).group(1)
        paths = re.findall(r"'([^']+)'", block)
        self.assertEqual(len(paths), 9)
        for relative in paths:
            self.assertTrue(relative.startswith('./'))
            self.assertTrue((WEB / relative).is_file())
            self.assertNotIn('/api/', relative)
        self.assertIn('ACTIVATE_APPROVED_UPDATE', worker)
        self.assertIn('SHELL_URLS.has(canonicalURL)', worker)
        self.assertIn('encodeURIComponent(BASE.pathname)', worker)

    def test_demo_boundaries_remain_visible(self):
        source = (WEB / 'index.html').read_text()
        for required in ['非官方', '非官方授證', '沒有收款', 'setNavigationOpen', 'withMutationLock', 'data-intent=', 'normalizeState', 'GY_PAGES', 'normalizeStudyState', 'GY_WELCOME', 'admin.html']:
            self.assertIn(required, source)
        scripts = re.findall(r'<script src="([^"]+)" defer>', source)
        self.assertEqual(scripts, ['catalog.js', 'study.js', 'account.js', 'pwa.js'])
        study = (WEB / 'study.js').read_text()
        for required in ['LESSON_CONTENT', 'scheduleCard', 'localTutor', 'registerOfficialLessons', 'COMPANION_RULES', 'aiAvailable', '示範教材', '官方教材']:
            self.assertIn(required, study)
        account = (WEB / 'account.js').read_text()
        for required in ['puterSignIn', 'startAsGuest', 'mergeStates', 'puter.kv', 'guidePage', 'libraryPage', 'maybeStartTour']:
            self.assertIn(required, account)
        self.assertNotIn('<script src="https://js.puter.com', source)
        self.assertIn('https://juw12.github.io/portfolio/#projects', source)
        self.assertNotIn('api.stripe.com', source)
        self.assertNotIn('supabase.co', source)

    def test_admin_console_and_content_store(self):
        admin_page = (WEB / 'admin.html').read_text()
        self.assertIn('<meta name="robots" content="noindex">', admin_page)
        self.assertEqual(re.findall(r'<script src="([^"]+)"', admin_page), ['catalog.js', 'admin.js'])
        admin = (WEB / 'admin.js').read_text()
        for required in ['permissions.push', 'sessionStorage', 'saveCatalog', 'maxFileBytes', '/contents/', 'utf8ToBase64']:
            self.assertIn(required, admin)
        catalog = (WEB / 'catalog.js').read_text()
        self.assertIn("owner: 'juw12'", catalog)
        self.assertIn("repo: 'projects'", catalog)
        self.assertIn("contentPath: 'content/guangyao'", catalog)
        self.assertIn("catalogPath: 'content/guangyao/catalog.json'", catalog)
        self.assertIn('cdn.jsdelivr.net/gh/', catalog)
        # No credential may ever be committed with the app.
        for path in WEB.rglob('*'):
            if path.suffix in {'.html', '.js', '.json', '.webmanifest'}:
                content = path.read_text(encoding='utf-8')
                self.assertIsNone(re.search(r'gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}', content), path.name)

    def test_migrated_content_files_exist(self):
        content_root = REPOSITORY / 'content' / 'guangyao'
        catalog = json.loads((content_root / 'catalog.json').read_text(encoding='utf-8'))
        for material in catalog.get('materials', []):
            if material.get('kind') != 'file':
                continue
            path = (content_root / material['path']).resolve()
            self.assertTrue(path.is_relative_to(content_root.resolve()))
            self.assertTrue(path.is_file())
            self.assertRegex(material['commit'], r'^[0-9a-f]{40}$')
        admin = (WEB / 'admin.js').read_text(encoding='utf-8')
        self.assertIn('${CONFIG.contentPath}/${path.split', admin)
        self.assertIn('${CONFIG.contentPath}/${item.path.split', admin)

    def test_catalog_and_generated_note_status(self):
        catalog = json.loads((REPOSITORY / 'scripts/apps.json').read_text())['apps']
        entries = [entry for entry in catalog if entry['id'] == 'guangyao']
        self.assertEqual(len(entries), 1)
        app = entries[0]
        self.assertEqual(app['status'], 'public-beta')
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
        self.assertIn('status: public-beta', note)
        self.assertNotIn('status: shipped', note)
        ordinary = dict(app)
        ordinary.pop('status')
        self.assertIn('status: shipped', publisher.render_note(ordinary, '2026-10-25'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
