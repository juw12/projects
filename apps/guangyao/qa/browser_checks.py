"""Local regression tests. Requires Python 3.9+ and Playwright Chromium/WebKit.
Runs an isolated loopback server; never contacts a production backend.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlsplit
import json

from playwright.sync_api import sync_playwright, expect

APP_ROOT = Path(__file__).resolve().parents[1]
ROOT = APP_ROOT / 'web'
MEDIA = APP_ROOT / 'docs' / 'images'
PASSED = []


class DemoHandler(SimpleHTTPRequestHandler):
    release_override = False

    def translate_path(self, path):
        if path.startswith('/demo-project/'):
            path = path[len('/demo-project'):]
        return super().translate_path(path)

    def do_GET(self):
        if urlsplit(self.path).path.endswith('/sw.js') and self.release_override:
            content = (ROOT / 'sw.js').read_text().replace("'2.0.2'", "'2.0.3-test'")
            payload = content.encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript; charset=utf-8')
            self.send_header('Content-Length', str(len(payload)))
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            self.wfile.write(payload)
            return
        super().do_GET()

    def log_message(self, *args):
        pass


def passed(label):
    PASSED.append(label)
    print(f'PASS: {label}', flush=True)


def go(page, route):
    page.evaluate('(route) => { location.hash = route; }', route)
    page.wait_for_timeout(70)


def click(page, action, extra=''):
    scope = page.locator('#modal') if page.locator('#modal').is_visible() else page
    scope.locator(f'[data-action="{action}"]{extra}').first.click()
    page.wait_for_timeout(70)


def read_state(page):
    return page.evaluate('JSON.parse(localStorage.getItem(storageKey)) || state')


def change_role(page, role):
    click(page, 'account')
    page.locator('[data-form="account"] select').select_option(role)
    page.locator('[data-form="account"] [type="submit"]').click()
    page.wait_for_timeout(90)


def core_flows(browser, base, engine):
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=False)
    page = context.new_page()
    page.set_default_timeout(7000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(base + 'index.html')
    go(page, 'course/practice')
    expect(page.locator('[data-action="play-lesson"]')).to_be_disabled()
    go(page, 'course/foundation')
    for index in [1, 2]:
        click(page, 'select-lesson', f'[data-index="{index}"]')
        click(page, 'play-lesson')
        click(page, 'complete-lesson')
    click(page, 'quiz')
    page.locator('[name="q1"][value="a"]').check()
    page.locator('[name="q2"][value="a"]').check()
    page.locator('[data-form="quiz"] [type="submit"]').click()
    expect(page.locator('#quiz-feedback')).to_contain_text('0 / 2')
    assert read_state(page)['completed'] == []
    page.locator('[name="q1"][value="b"]').check()
    page.locator('[name="q2"][value="c"]').check()
    page.locator('[data-form="quiz"] [type="submit"]').click()
    expect(page.locator('#dialog-title')).to_contain_text('完成了')
    assert read_state(page)['points'] == 420
    click(page, 'close')
    go(page, 'course/practice')
    expect(page.locator('[data-action="play-lesson"]')).to_be_enabled()
    go(page, 'portfolio')
    assert page.locator('.certificate').count() == 1
    page.locator('[data-setting="publicPortfolio"]').check()
    page.wait_for_timeout(90)
    click(page, 'portfolio-preview')
    expect(page.locator('#dialog-title')).to_contain_text('本機預覽')
    click(page, 'close')
    passed(f'{engine}: learning, failed quiz, certificate, prerequisite and private portfolio')

    go(page, 'schedule')
    click(page, 'event-detail', '[data-id="e1"]')
    click(page, 'register-event')
    assert 'e1' in read_state(page)['registrations']
    click(page, 'event-filter', '[data-id="mine"]')
    assert page.locator('.event-card').count() == 1
    click(page, 'event-detail', '[data-id="e1"]')
    click(page, 'register-event')
    assert read_state(page)['registrations'] == []
    change_role(page, 'organizer')
    go(page, 'admin')
    click(page, 'create-event')
    form = page.locator('[data-form="create-event"]')
    for field, value in [('title', 'Restricted QA activity'), ('teacher', '示範教師'), ('place', '示範地點'), ('description', '測試安全說明')]:
        form.locator(f'[name="{field}"]').fill(value)
    form.locator('[name="rank"]').select_option('organizer')
    form.locator('[type="submit"]').click()
    expect(page.locator('#modal')).not_to_be_visible()
    assert len(read_state(page)['events']) == 1
    change_role(page, 'member')
    go(page, 'schedule')
    assert 'Restricted QA activity' not in page.locator('#main').inner_text()
    go(page, 'admin')
    expect(page.locator('#main')).to_contain_text('目前沒有存取權限')
    passed(f'{engine}: registration, cancellation and restricted organizer content')

    go(page, 'community')
    page.locator('[data-form="message"] input').fill('<script>window.injection = true</script>')
    page.locator('[data-form="message"] [type="submit"]').click()
    expect(page.locator('.message.mine')).to_contain_text('<script>')
    assert page.evaluate('window.injection === undefined')
    click(page, 'community-tab', '[data-id="poll"]')
    click(page, 'vote', '[data-index="0"]')
    assert read_state(page)['poll'] == 0
    assert page.locator('[data-action="vote"]').count() == 0
    go(page, 'rewards')
    click(page, 'redeem', '[data-id="r1"]')
    click(page, 'confirm-redeem')
    assert read_state(page)['points'] == 220
    page.reload()
    assert read_state(page)['points'] == 220
    go(page, 'vault')
    click(page, 'donate', '[data-id="p1"]')
    page.locator('[data-form="donate"] [name="consent"]').check()
    page.locator('[data-form="donate"] [type="submit"]').click()
    expect(page.locator('#dialog-title')).to_contain_text('僅模擬')
    assert read_state(page)['points'] == 220
    assert read_state(page)['donations'][0]['anonymous']
    click(page, 'close')
    passed(f'{engine}: escaped chat, voting, rewards, persistence and no-charge donation')

    routes = ['home', 'courses', 'course/foundation', 'schedule', 'community', 'meetings', 'portfolio', 'vault', 'rewards', 'invite', 'about', 'admin']
    for width in [1440, 768, 390]:
        page.set_viewport_size({'width': width, 'height': 844})
        for route in routes:
            go(page, route)
            assert not page.evaluate('document.documentElement.scrollWidth > innerWidth'), (engine, width, route)
    click(page, 'menu')
    assert page.locator('#workspace').evaluate('(element) => element.inert')
    assert page.locator('[data-action="menu"]').get_attribute('aria-expanded') == 'true'
    page.keyboard.press('Escape')
    assert page.locator('#sidebar').evaluate('(element) => element.inert')
    assert not page.locator('#workspace').evaluate('(element) => element.inert')
    page.locator('#mobile-nav [data-page="home"]').click()
    page.wait_for_timeout(90)
    page.locator('[data-pwa-action="install"]').click()
    expect(page.locator('#dialog-title')).to_contain_text('安裝')
    click(page, 'close')
    passed(f'{engine}: 36 route layouts, mobile drawer focus state and installation guidance')

    click(page, 'account')
    click(page, 'logout')
    expect(page.locator('#main')).to_contain_text('進入示範帳戶')
    assert read_state(page)['signedIn'] is False
    click(page, 'account')
    page.locator('[data-form="account"] [type="submit"]').click()
    page.wait_for_timeout(100)
    click(page, 'account')
    click(page, 'reset')
    click(page, 'confirm-reset')
    assert read_state(page)['points'] == 320
    assert read_state(page)['completed'] == []
    for course_id in ['foundation', 'practice', 'lead']:
        go(page, f'course/{course_id}')
        for index in [0, 1, 2]:
            click(page, 'select-lesson', f'[data-index="{index}"]')
            click(page, 'play-lesson')
            click(page, 'complete-lesson')
        click(page, 'quiz')
        page.locator('[name="q1"][value="b"]').check()
        page.locator('[name="q2"][value="c"]').check()
        page.locator('[data-form="quiz"] [type="submit"]').click()
        expect(page.locator('#dialog-title')).to_contain_text('完成了')
        click(page, 'close')
    assert read_state(page)['completed'] == ['foundation', 'practice', 'lead']
    assert read_state(page)['points'] == 620
    page.evaluate('quizModal("foundation")')
    page.locator('[name="q1"][value="b"]').check()
    page.locator('[name="q2"][value="c"]').check()
    page.locator('[data-form="quiz"] [type="submit"]').click()
    expect(page.locator('#dialog-title')).to_contain_text('完成了')
    assert read_state(page)['points'] == 620
    click(page, 'close')
    assert not errors, errors
    passed(f'{engine}: logout, reset, all three levels, repeat-award protection and no application errors')
    context.close()


def concurrent_and_storage(browser, base):
    context = browser.new_context()
    first = context.new_page()
    second = context.new_page()
    for page in [first, second]:
        page.set_default_timeout(7000)
        page.goto(base + 'index.html#rewards')
        click(page, 'redeem', '[data-id="r1"]')
    first.evaluate('''() => {
        window.lockHeld = false;
        navigator.locks.request(storageKey, () => new Promise(resolve => {
            window.releaseTestLock = resolve;
            window.lockHeld = true;
        }));
    }''')
    first.wait_for_function('window.lockHeld')
    first.locator('#modal [data-action="confirm-redeem"]').click()
    second.locator('#modal [data-action="confirm-redeem"]').click()
    first.evaluate('window.releaseTestLock()')
    first.wait_for_function('JSON.parse(localStorage.getItem(storageKey)).points === 120')
    second.wait_for_function('state.points === 120')
    expect(second.locator('#modal')).not_to_be_visible()
    assert len(read_state(first)['redemptions']) == 1
    passed('Concurrent tabs: serialized redemption prevents overspending')

    for page in [first, second]:
        go(page, 'schedule')
        click(page, 'event-detail', '[data-id="e1"]')
    click(first, 'register-event')
    click(second, 'register-event')
    assert read_state(first)['registrations'] == ['e1']
    passed('Stale registration action is idempotent instead of canceling a booking')
    context.close()

    for raw in ['{broken-json', json.dumps({'points': -999, 'lessons': None, 'completed': ['lead', 'lead'], 'groups': [{'id': '\" onclick=\"alert(1)', 'title': 'Unsafe'}], 'messages': [], 'events': 'invalid', 'redemptions': [{'reward': 'unknown'}], 'name': 'Data recovery'})]:
        context = browser.new_context()
        context.add_init_script(f'''if (!sessionStorage.getItem('seeded')) {{
            localStorage.setItem('guangyao-v2:' + new URL('.', location.href).pathname, {json.dumps(raw)});
            sessionStorage.setItem('seeded', '1');
        }}''')
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(base + 'index.html')
        expect(page.locator('.hero')).to_be_visible()
        assert page.evaluate('state.points') == 320
        assert page.evaluate('state.completed.length') == 0
        assert page.evaluate('state.groups.length') == 0
        assert not errors, errors
        context.close()
    passed('Corrupt JSON, invalid shapes, hostile IDs and fabricated balances normalize safely')

    context = browser.new_context()
    context.add_init_script('''if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('guangyao-prototype-v1', JSON.stringify({
            name: '既有學員', role: 'member', signedIn: true,
            lessons: {foundation: [0, 1, 2], practice: [], lead: []},
            completed: ['foundation'], enrolled: ['foundation'],
            redemptions: [{id: 'REDEEM-DEMO-1', reward: 'r1'}]
        }));
        sessionStorage.setItem('seeded', '1');
    }''')
    page = context.new_page()
    page.goto(base + 'index.html')
    assert page.evaluate('state.name') == '既有學員'
    assert page.evaluate('state.points') == 220
    assert page.evaluate('state.completed[0]') == 'foundation'
    passed('Existing v1 progress and redemptions migrate without resetting valid work')
    context.close()


def pwa_and_updates(browser, base):
    context = browser.new_context()
    page = context.new_page()
    page.set_default_timeout(10000)
    page.goto(base + 'demo-project/index.html')
    page.wait_for_function('navigator.serviceWorker.controller !== null')
    scope = page.evaluate('navigator.serviceWorker.getRegistration().then(registration => registration.scope)')
    assert scope.endswith('/demo-project/')
    manifest = page.evaluate('fetch("manifest.webmanifest").then(response => response.json())')
    assert manifest['scope'] == './' and manifest['display'] == 'standalone'
    cdp = context.new_cdp_session(page)
    cdp.send('Page.enable')
    installability = cdp.send('Page.getInstallabilityErrors')
    assert installability['installabilityErrors'] == [], installability
    keys = page.evaluate('caches.keys()')
    shell_key = next(key for key in keys if '%2Fdemo-project%2F' in key)
    cached_urls = page.evaluate('(key) => caches.open(key).then(cache => cache.keys()).then(keys => keys.map(request => request.url))', shell_key)
    assert len(cached_urls) == 6
    assert all('/demo-project/' in url for url in cached_urls)
    assert not any('/api/' in url for url in cached_urls)
    awaitable = 'fetch("api/private-probe", {cache: "no-store"}).then(response => response.status)'
    page.evaluate(awaitable)
    assert page.evaluate('(key) => caches.open(key).then(cache => cache.keys()).then(keys => keys.length)', shell_key) == 6
    context.set_offline(True)
    page.reload(wait_until='domcontentloaded')
    expect(page.locator('.hero')).to_be_visible()
    expect(page.locator('#network-state')).to_contain_text('離線')
    page.goto(base + 'demo-project/app-plan.html')
    expect(page.locator('h1')).to_be_visible()
    context.set_offline(False)
    page.goto(base + 'demo-project/index.html')
    passed('PWA manifest, Chromium installability, scoped cache, private-request exclusion and offline reload')

    DemoHandler.release_override = True
    page.evaluate('navigator.serviceWorker.getRegistration().then(registration => registration.update())')
    page.wait_for_function('navigator.serviceWorker.getRegistration().then(registration => !!registration.waiting)')
    expect(page.locator('#update-app')).to_be_visible()
    old_cache = page.evaluate('caches.keys()')
    assert shell_key in old_cache
    page.once('dialog', lambda dialog: dialog.dismiss())
    page.locator('#update-app').click()
    assert page.evaluate('navigator.serviceWorker.getRegistration().then(registration => !!registration.waiting)')
    page.once('dialog', lambda dialog: dialog.accept())
    with page.expect_navigation(wait_until='domcontentloaded'):
        page.locator('#update-app').click()
    page.wait_for_function('caches.keys().then(keys => keys.some(key => key.endsWith("2.0.3-test")))')
    assert shell_key not in page.evaluate('caches.keys()')
    passed('Updates wait for confirmation; approved update activates and clears only its scoped old cache')
    DemoHandler.release_override = False
    context.close()


def screenshots(browser, base):
    context = browser.new_context(viewport={'width': 1440, 'height': 1080}, device_scale_factor=1)
    page = context.new_page()
    page.goto(base + 'index.html')
    page.wait_for_selector('.hero')
    page.screenshot(path=str(MEDIA / 'desktop.png'), full_page=True)
    page.set_viewport_size({'width': 390, 'height': 844})
    page.wait_for_timeout(400)
    page.screenshot(path=str(MEDIA / 'mobile.png'))
    context.close()


def main():
    handler = partial(DemoHandler, directory=str(ROOT))
    server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f'http://127.0.0.1:{server.server_address[1]}/'
    try:
        with sync_playwright() as playwright:
            chromium = playwright.chromium.launch()
            core_flows(chromium, base, 'Chromium')
            concurrent_and_storage(chromium, base)
            pwa_and_updates(chromium, base)
            screenshots(chromium, base)
            chromium.close()
            webkit = playwright.webkit.launch()
            core_flows(webkit, base, 'WebKit')
            webkit.close()
        print(f'\n{len(PASSED)} grouped regression checks passed, including 72 route-layout checks.', flush=True)
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
