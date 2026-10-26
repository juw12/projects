#!/usr/bin/env python3
"""Portable, standard-library checks for the Windows app's shared-source wiring."""
from pathlib import Path
import importlib.util
import json
import unittest

APP = Path(__file__).resolve().parent.parent
REPO = APP.parents[1]
WEB = APP / 'web'
DESKTOP = APP / 'desktop'


class WindowsDesktopTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.package = json.loads((DESKTOP / 'package.json').read_text(encoding='utf-8'))
        cls.version = cls.package['version']
        cls.release = f'https://github.com/juwpegatron/projects/releases/download/airiz-desktop-v{cls.version}/'

    def test_shared_web_ui_is_bundled_not_a_remote_shortcut(self):
        files = self.package['build']['files']
        self.assertTrue(any(isinstance(item, dict) and item.get('from') == '../web' and item.get('to') == 'web' for item in files))
        main = (DESKTOP / 'main.cjs').read_text(encoding='utf-8')
        self.assertIn("loadURL('airiz://app/')", main)
        self.assertNotIn("loadURL('https://", main)
        self.assertIn('nodeIntegration: false', main)
        self.assertIn('contextIsolation: true', main)
        self.assertIn('sandbox: true', main)

    def test_both_windows_outputs_are_configured(self):
        build = self.package['build']
        self.assertIn('nsis', build['win']['target'])
        self.assertIn('portable', build['win']['target'])
        self.assertFalse(build['nsis']['perMachine'])
        self.assertFalse(build['nsis']['deleteAppDataOnUninstall'])
        self.assertTrue((DESKTOP / 'assets' / 'app.ico').is_file())
        lock = json.loads((DESKTOP / 'package-lock.json').read_text(encoding='utf-8'))
        self.assertEqual(lock['version'], self.version)

    def test_download_buttons_and_catalog_target_real_release_assets(self):
        html = (WEB / 'index.html').read_text(encoding='utf-8')
        installer = self.release + f'AIRIZ-Console-Setup-{self.version}-x64.exe'
        portable = self.release + f'AIRIZ-Console-Portable-{self.version}-x64.exe'
        self.assertIn(installer, html)
        self.assertIn(portable, html)
        self.assertIn('unsigned first release', html)
        catalog = json.loads((REPO / 'scripts' / 'apps.json').read_text(encoding='utf-8'))
        entry = next(item for item in catalog['apps'] if item['id'] == 'airiz-motor')
        self.assertEqual(entry['links']['app'], installer)
        self.assertEqual(entry['links']['web'], 'airiz-motor/')
        self.assertEqual(entry['links']['mobile'], 'airiz-motor/')

    def test_portfolio_sync_preserves_absolute_download_urls(self):
        path = REPO / 'scripts' / 'publish_portfolio.py'
        spec = importlib.util.spec_from_file_location('portfolio_for_airiz_tests', path)
        publisher = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(publisher)
        catalog = json.loads((REPO / 'scripts' / 'apps.json').read_text(encoding='utf-8'))
        entry = next(item for item in catalog['apps'] if item['id'] == 'airiz-motor')
        self.assertEqual(publisher.app_url(entry, 'app'), entry['links']['app'])
        self.assertNotIn('projects/https://', publisher.render_card(entry))

    def test_updater_uses_the_airiz_channel_and_idle_install_policy(self):
        expected = 'https://juwpegatron.github.io/projects/airiz-motor/updates/windows/'
        self.assertEqual(self.package['build']['publish'][0]['url'], expected)
        controller = (DESKTOP / 'update-controller.cjs').read_text(encoding='utf-8')
        self.assertIn(expected, controller)
        self.assertIn('updater.autoDownload = false', controller)
        self.assertIn('updater.autoInstallOnAppQuit = false', controller)
        self.assertIn('updater.allowDowngrade = false', controller)
        self.assertIn('prepareForInstall()', controller)
        self.assertNotIn('verifyUpdateCodeSignature =', controller)

    def test_release_feed_matches_the_current_desktop_version(self):
        manifest = json.loads((WEB / 'updates/windows/latest.yml').read_text(encoding='utf-8'))
        release = json.loads((WEB / 'updates/windows/release.json').read_text(encoding='utf-8'))
        self.assertEqual(manifest['version'], self.version)
        self.assertEqual(release['version'], self.version)
        self.assertEqual(manifest['files'][0]['url'], release['installer']['url'])
        self.assertEqual(manifest['files'][0]['sha512'], release['installer']['sha512'])
        self.assertEqual(manifest['files'][0]['size'], release['installer']['size'])
        self.assertTrue(release['installer']['url'].startswith(self.release))

    def test_browser_and_desktop_adapters_are_explicitly_separate(self):
        app = (WEB / 'app.js').read_text(encoding='utf-8')
        integration = (WEB / 'desktop-integration.js').read_text(encoding='utf-8')
        worker = (WEB / 'sw.js').read_text(encoding='utf-8')
        self.assertIn('if (window.airizDesktop) return;', app)
        self.assertIn('if (!host) {', integration)
        self.assertIn("'./desktop-integration.js'", worker)
        self.assertIn('cameraRecording:', app)
        self.assertIn('sessionActive:', app)


if __name__ == '__main__':
    unittest.main(verbosity=2)
