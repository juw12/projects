"""Local regression tests. Requires Python 3.9+ and Playwright Chromium/WebKit.
Runs an isolated loopback server; never contacts a production backend.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import unquote, urlsplit
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
            content = (ROOT / 'sw.js').read_text().replace("'4.2.0'", "'4.2.1-test'")
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


EMPTY_CATALOG = {'schema': 1, 'settings': {}, 'lessons': [], 'materials': [], 'events': []}
CONTENT_CATALOG = {
    'schema': 1,
    'updatedAt': '2026-11-09T10:00:00Z',
    'settings': {'announcement': '11 月共學開放報名中', 'hideSamples': False},
    'lessons': [
        {'id': 'onboarding', 'title': '新手導覽：怎麼使用光耀同行', 'summary': '五分鐘學會登入與每日學習。', 'status': 'published', 'order': 0,
         'reading': ['第一次打開時，可以選擇登入或以訪客身分繼續。', '每天先選每日目標，再上一堂課，最後做每日複習。'],
         'video': 'https://youtu.be/dQw4w9WgXcQ', 'materials': ['handbook', 'draft-file'],
         'quiz': [
             {'question': '想讓手機和電腦進度同步，應該怎麼做？', 'options': ['用帳號登入', '一直用訪客'], 'answer': 0, 'explain': '登入後會同步。'},
             {'question': '複習時翻面要按哪個鍵？', 'options': ['Esc', '空白鍵', 'Tab'], 'answer': 1, 'explain': '按空白鍵翻面。'}
         ],
         'reflect': '你打算每天什麼時候學習？', 'cards': [['訪客和登入的差別？', '登入會跨裝置同步']]},
        {'id': 'hidden-draft', 'title': '尚未發布的草稿', 'status': 'draft', 'reading': ['草稿內容']},
        {'id': 'xss', 'title': '<img src=x onerror="window.catalogXss=1">', 'status': 'published', 'order': 5, 'reading': ['<script>window.catalogXss=2</script>']}
    ],
    'materials': [
        {'id': 'handbook', 'title': '學員使用手冊', 'kind': 'file', 'path': 'files/2026/11/abc-handbook.pdf', 'commit': 'a' * 40, 'size': 204800, 'mime': 'application/pdf', 'filename': '使用手冊.pdf', 'status': 'published',
         'description': '可列印的操作說明。', 'notes': '連續保護：每連續學習七天會得到一個連續保護，最多兩個。'},
        {'id': 'draft-file', 'title': '草稿講義', 'kind': 'link', 'url': 'https://example.com/draft', 'status': 'draft'},
        {'id': 'evil-link', 'title': '危險連結', 'kind': 'link', 'url': 'javascript:alert(1)', 'status': 'published'},
        {'id': 'escape-path', 'title': '路徑攻擊', 'kind': 'file', 'path': 'files/../../etc/passwd', 'status': 'published'}
    ],
    'events': [
        {'id': 'open-day', 'title': '新朋友線上說明會', 'date': '2026-11-20', 'time': '19:30', 'type': 'online', 'teacher': '服務團隊', 'place': '線上會議', 'description': '介紹平台', 'signupUrl': 'https://example.com/form', 'status': 'published'},
        {'id': 'draft-event', 'title': '草稿活動', 'date': '2026-11-21', 'time': '10:00', 'status': 'draft'}
    ]
}


def make_context(browser, catalog=None, skip_tour=True, **options):
    """Isolated context: the content repo is mocked and Puter/GitHub API calls never leave the machine."""
    context = browser.new_context(accept_downloads=False, **options)
    body = json.dumps(catalog or EMPTY_CATALOG)
    context.route('https://raw.githubusercontent.com/**', lambda route: route.fulfill(status=200, content_type='application/json', body=body))
    context.route('https://api.github.com/**', lambda route: route.fulfill(status=200, content_type='application/json', body=body))
    context.route('https://js.puter.com/**', lambda route: route.abort())
    if skip_tour:
        context.add_init_script("localStorage.setItem('guangyao-tour-v1', 'test');")
    return context


def start_guest(page):
    expect(page.locator('.welcome')).to_be_visible()
    page.locator('.welcome [data-action="guest-start"]').click()
    expect(page.locator('.welcome')).to_have_count(0)
    page.wait_for_timeout(80)


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


def complete_lesson(page, perfect=True, reflection='今天想練習先聽完再回應。'):
    """Drive the v3 interactive lesson player from reading to the XP summary."""
    click(page, 'play-lesson')
    expect(page.locator('#modal.lesson-dialog')).to_be_visible()
    key = page.evaluate('session.key')
    content = page.evaluate('(key) => GY_LESSONS[key]', key)
    click(page, 'lesson-next')
    answer = content['mcq']['answer'] if perfect else (content['mcq']['answer'] + 1) % 3
    click(page, 'lesson-choose', f'[data-index="{answer}"]')
    expect(page.locator('#modal .feedback')).to_have_class('feedback good' if perfect else 'feedback bad')
    click(page, 'lesson-next')
    page.locator('[data-form="lesson-cloze"] input').fill(content['cloze']['answers'][0])
    page.locator('[data-form="lesson-cloze"] [type="submit"]').click()
    expect(page.locator('#modal .feedback.good')).to_be_visible()
    click(page, 'lesson-next')
    for index in range(len(content['order']['items'])):
        click(page, 'lesson-pick', f'[data-index="{index}"]')
    click(page, 'lesson-check-order')
    expect(page.locator('#modal .feedback.good')).to_be_visible()
    click(page, 'lesson-next')
    page.locator('#lesson-reflection').fill(reflection)
    click(page, 'lesson-finish')
    click(page, 'complete-lesson')
    page.wait_for_timeout(200)
    return key


def core_flows(browser, base, engine):
    context = make_context(browser, viewport={'width': 1440, 'height': 1000})
    page = context.new_page()
    page.set_default_timeout(7000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(base + 'index.html')
    start_guest(page)
    assert read_state(page)['account']['mode'] == 'guest'
    go(page, 'course/practice')
    expect(page.locator('[data-action="play-lesson"]')).to_be_disabled()
    go(page, 'course/foundation')
    for index in [1, 2]:
        click(page, 'select-lesson', f'[data-index="{index}"]')
        complete_lesson(page)
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
    assert 'e4' not in [card.get_attribute('data-id') for card in page.locator('[data-action="event-detail"]').all()]
    click(page, 'account')
    expect(page.locator('#modal [name="role"]')).to_have_count(0)
    click(page, 'close')
    go(page, 'admin')
    expect(page.locator('#main .card a[href="admin.html"]').first).to_be_visible()
    passed(f'{engine}: registration, cancellation, no learner-side role switch and staff work routed to the admin console')

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

    routes = ['home', 'courses', 'library', 'guide', 'course/foundation', 'schedule', 'community', 'meetings', 'portfolio', 'vault', 'rewards', 'invite', 'about', 'admin']
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
    passed(f'{engine}: 42 route layouts, mobile drawer focus state and installation guidance')

    click(page, 'account')
    click(page, 'logout')
    expect(page.locator('#dialog-title')).to_contain_text('已登出')
    click(page, 'close')
    expect(page.locator('.welcome')).to_be_visible()
    assert read_state(page)['signedIn'] is False
    assert read_state(page)['completed'] == ['foundation']
    start_guest(page)
    assert read_state(page)['completed'] == ['foundation']
    click(page, 'account')
    click(page, 'reset')
    click(page, 'confirm-reset')
    start_guest(page)
    assert read_state(page)['points'] == 320
    assert read_state(page)['completed'] == []
    for course_id in ['foundation', 'practice', 'lead']:
        go(page, f'course/{course_id}')
        for index in [0, 1, 2]:
            click(page, 'select-lesson', f'[data-index="{index}"]')
            complete_lesson(page)
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
    passed(f'{engine}: logout keeps local progress, clear-device reset, all three levels, repeat-award protection and no application errors')
    context.close()


TODAY = '2026-11-10'


def fixed_day_context(browser, seed=None, catalog=None, **options):
    context = make_context(browser, catalog=catalog, **options)
    script = f"window.GY_TEST_TODAY = '{TODAY}';"
    if seed is not None:
        script += f"""
        if (!sessionStorage.getItem('seeded')) {{
            localStorage.setItem('guangyao-v2:' + new URL('.', location.href).pathname, {json.dumps(json.dumps(seed))});
            sessionStorage.setItem('seeded', '1');
        }}"""
    context.add_init_script(script)
    return context


def capture_blobs(page):
    page.evaluate("""() => {
        window.blobs = [];
        const makeURL = URL.createObjectURL.bind(URL);
        URL.createObjectURL = blob => {
            window.blobs.push(blob);
            return makeURL(blob);
        };
    }""")


def ask_tutor(page, text=None, chip=None):
    """Send one tutor message and wait for its reply instead of reading a stale bubble."""
    before = page.locator('.tutor-messages .bubble').count()
    if chip:
        click(page, 'tutor-chip', f'[data-text="{chip}"]')
    else:
        page.locator('[data-form="tutor"] input').fill(text)
        page.locator('[data-form="tutor"] [type="submit"]').click()
    page.wait_for_function('(count) => document.querySelectorAll(".tutor-messages .bubble").length >= count + 2', arg=before)
    return page.locator('.tutor-messages .bubble').last


def study_flows(browser, base, engine):
    context = fixed_day_context(browser, viewport={'width': 1440, 'height': 1000})
    page = context.new_page()
    page.set_default_timeout(7000)
    errors = []
    puter_requests = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: puter_requests.append(request.url) if 'puter.com' in request.url else None)
    page.goto(base + 'index.html')
    start_guest(page)
    expect(page.locator('.today-panel')).to_be_visible()
    assert page.locator('.nav-item[data-page="review"] .count').inner_text() == '3'
    click(page, 'choose-goal', '[data-xp="10"]')
    assert read_state(page)['study']['dailyGoal'] == 10
    assert read_state(page)['study']['goalChosen'] is True
    expect(page.locator('.goal-picker')).to_have_count(0)
    passed(f'{engine}: today panel, review badge and first-run daily goal')

    go(page, 'course/foundation')
    click(page, 'select-lesson', '[data-index="1"]')
    key = complete_lesson(page, perfect=False, reflection='先確認，再回應。')
    data = read_state(page)['study']
    assert key == 'foundation:1'
    assert data['xpByDay'][TODAY] == 12, data['xpByDay']
    assert data['mastery'][key] == {'correct': 2, 'total': 3}
    assert len(data['cards']) == 5
    assert data['journal'][-1]['text'] == '先確認，再回應。'
    assert 1 in read_state(page)['lessons']['foundation']
    expect(page.locator('#toast')).to_contain_text('今日目標達成')
    passed(f'{engine}: interactive lesson feedback, no-hearts wrong answer, XP, mastery, journal and auto flashcards')

    go(page, 'review')
    expect(page.locator('.flashcard')).to_be_visible()
    assert 'GY_STUDY' in page.evaluate('Object.keys(window).filter(name => name.startsWith("GY_")).join(",")')
    page.keyboard.press(' ')
    expect(page.locator('.flash-back')).to_be_visible()
    page.locator('[data-action="review-rate"][data-rating="again"]').click()
    page.wait_for_timeout(150)
    for _ in range(6):
        if page.locator('[data-action="review-reveal"]').count() == 0:
            break
        click(page, 'review-reveal')
        page.locator('[data-action="review-rate"][data-rating="good"]').click()
        page.wait_for_timeout(150)
    expect(page.locator('main')).to_contain_text('今天的複習完成了')
    cards = read_state(page)['study']['cards']
    assert all(card['due'] == '2026-11-11' and card['interval'] == 1 for card in cards.values()), cards
    assert any(card['lapses'] == 1 for card in cards.values())
    assert read_state(page)['study']['xpByDay'][TODAY] == 18
    assert page.locator('.nav-item[data-page="review"] .count').count() == 0
    passed(f'{engine}: spaced repetition with keyboard reveal, relearning queue, intervals, XP and cleared badge')

    schedule = page.evaluate("""() => {
        const fresh = {due: GY_STUDY.today(), interval: 0, ease: 2.5, reps: 0, lapses: 0};
        const good = GY_STUDY.scheduleCard(fresh, 'good');
        const goodTwice = GY_STUDY.scheduleCard(good, 'good');
        const goodThrice = GY_STUDY.scheduleCard(goodTwice, 'good');
        const easy = GY_STUDY.scheduleCard(fresh, 'easy');
        const again = GY_STUDY.scheduleCard(goodTwice, 'again');
        return [good.interval, goodTwice.interval, goodThrice.interval, easy.interval, again.interval, again.ease, again.lapses];
    }""")
    assert schedule == [1, 3, 8, 3, 0, 2.3, 1], schedule
    passed(f'{engine}: SM-2 scheduling intervals 1 → 3 → 8 days, easy bonus and lapse penalty')

    routing = {
        '長輩提重物時我該怎麼做？': 'practice:0',
        '看見需要是什麼意思？': 'practice:0',
        '活動拍照要注意什麼？': 'lead:1',
        '怎麼帶領討論？': 'lead:2',
        '朋友分享心事時怎麼回應？': 'foundation:1',
        '服務紀錄可以放受助者照片嗎？': 'practice:1',
        '預算為什麼要公開？': 'lead:0',
        '學習要和別人比較嗎？': 'foundation:0',
        '股票要怎麼買才會賺錢': None,
        '明天天氣如何': None,
    }
    for question, expected in routing.items():
        hits = page.evaluate('(q) => GY_STUDY.retrieve(q, 1)', question)
        top = hits[0]['key'] if hits and hits[0]['score'] >= 0.3 else None
        assert top == expected, (question, hits)
    passed(f'{engine}: tutor retrieval routes 10/10 benchmark questions, including honest not-found')
    go(page, 'tutor')
    expect(ask_tutor(page, '什麼是先詢問再協助？')).to_contain_text('出處：〈看見生活裡的需要〉')
    expect(ask_tutor(page, '股票要怎麼買才會賺錢')).to_contain_text('找不到')
    expect(ask_tutor(page, chip='考考我')).to_contain_text('來一題')
    reply = ask_tutor(page, '給我答案')
    expect(reply).to_contain_text('提示')
    expect(reply).not_to_contain_text('參考答案')
    assert page.evaluate('pendingQuiz !== null')
    expect(ask_tutor(page, '先聽完再回應，並確認對方的意思')).to_contain_text('參考答案')
    page.locator('[data-setting-tutor-scope]').select_option('foundation:2')
    expect(ask_tutor(page, chip='整理成閃卡')).to_contain_text('2 張閃卡')
    assert len(read_state(page)['study']['cards']) == 7
    ask_tutor(page, '<img src=x onerror="window.tutorXss=1">')
    assert page.evaluate('window.tutorXss === undefined')
    assert not puter_requests, puter_requests
    expect(page.locator('.callout.ai-cta [data-action="puter-signin"]')).to_be_visible()
    plan = ask_tutor(page, chip='幫我排今天的學習計畫')
    expect(plan).to_contain_text('今天的學習計畫')
    passed(f'{engine}: offline tutor citations, honest no-answer, quiz, answer withheld with hint, flashcards, study plan, escaping, zero network')

    install_puter_mock(page)
    click(page, 'puter-signin')
    page.wait_for_function("state.account.mode === 'puter'")
    assert read_state(page)['account']['username'] == 'tester'
    expect(page.locator('.callout.ai-on')).to_contain_text('AI 學伴已啟用')
    page.locator('[data-setting-tutor-scope]').select_option('all')
    reply = ask_tutor(page, '長輩提重物時我該怎麼做？')
    expect(reply).to_contain_text('AI 學伴')
    expect(reply).to_contain_text('先詢問')
    calls = page.evaluate('window.puterCalls')
    assert len(calls) == 1 and calls[0]['options'] == {'model': 'gpt-5-mini', 'stream': True}, calls
    messages = calls[0]['messages']
    assert '只根據「課程與教材摘錄」回答' in messages[0]['content']
    assert '〈看見生活裡的需要〉' in messages[1]['content'] and '學員進度' in messages[1]['content'], messages[1]['content']
    assert messages[-1] == {'role': 'user', 'content': '長輩提重物時我該怎麼做？'}
    page.locator('[data-setting-ai-context]').uncheck()
    page.wait_for_timeout(120)
    ask_tutor(page, chip='用簡單的話解釋')
    calls = page.evaluate('window.puterCalls')
    assert '不分享學習進度' in calls[-1]['messages'][1]['content']
    assert any(entry['role'] == 'assistant' for entry in calls[-1]['messages'][2:-1]), 'conversation history is sent'
    page.evaluate("window.puterReply = JSON.stringify([{front: '先詢問再協助的原因？', back: '尊重對方的意願'}, {front: '提重物前要先做什麼？', back: '先問對方需不需要幫忙'}])")
    expect(ask_tutor(page, chip='整理成閃卡')).to_contain_text('已建立 2 張閃卡')
    custom = read_state(page)['study']['customCards']
    assert len(custom) == 2 and all(card_id in read_state(page)['study']['cards'] for card_id in custom), custom
    page.evaluate("() => { window.puterFail = 'quota exceeded'; }")
    expect(ask_tutor(page, '看見需要是什麼意思？')).to_contain_text('離線回答')
    page.evaluate("() => { window.puterFail = ''; }")
    page.locator('[data-setting-offline]').check()
    page.wait_for_timeout(120)
    before = len(page.evaluate('window.puterCalls'))
    expect(ask_tutor(page, '看見需要是什麼意思？')).to_contain_text('離線學伴')
    assert len(page.evaluate('window.puterCalls')) == before
    page.locator('[data-setting-offline]').uncheck()
    page.wait_for_timeout(120)
    passed(f'{engine}: Puter sign-in unlocks the AI companion: streamed grounded answers with history, privacy toggle, AI flashcards, offline fallback and offline-only mode')

    go(page, 'home')
    click(page, 'focus-open')
    click(page, 'focus-start', '[data-minutes="10"]')
    expect(page.locator('#focus-display')).to_be_visible()
    page.evaluate('GY_COMPLETE_FOCUS_FOR_TEST()')
    page.wait_for_timeout(250)
    data = read_state(page)['study']
    assert data['focusByDay'][TODAY] == 10
    assert data['xpByDay'][TODAY] == 20
    passed(f'{engine}: wall-clock focus timer logs minutes and XP')

    capture_blobs(page)
    go(page, 'stats')
    assert page.locator('.heatmap .heat').count() == 84
    expect(page.locator('.stats')).to_contain_text('連續學習')
    page.evaluate("""() => {
        window.sharedFiles = [];
        Object.defineProperty(navigator, 'canShare', {value: () => true, configurable: true});
        Object.defineProperty(navigator, 'share', {value: async data => { window.sharedFiles.push(...data.files); }, configurable: true});
    }""")
    click(page, 'share-card')
    page.wait_for_function('window.sharedFiles.length === 1')
    shared = page.evaluate('({type: window.sharedFiles[0].type, size: window.sharedFiles[0].size, name: window.sharedFiles[0].name})')
    assert shared['type'] == 'image/png' and shared['size'] > 10000 and shared['name'] == 'guangyao-progress.png', shared
    page.evaluate("() => { Object.defineProperty(navigator, 'canShare', {value: () => false, configurable: true}); }")
    click(page, 'share-card')
    page.wait_for_function('window.blobs.some(blob => blob.type === \"image/png\")')
    blob = page.evaluate('(() => { const png = window.blobs.filter(item => item.type === "image/png").at(-1); return {type: png.type, size: png.size}; })()')
    assert blob['size'] > 10000, blob
    passed(f'{engine}: stats heatmap, native share sheet with PNG card and download fallback')

    go(page, 'schedule')
    click(page, 'event-detail', '[data-id="e1"]')
    click(page, 'register-event')
    click(page, 'event-detail', '[data-id="e1"]')
    click(page, 'event-ics')
    ics = page.evaluate('window.blobs.at(-1).text()')
    assert 'DTSTART:20261105T113000Z' in ics and 'DTEND:20261105T123000Z' in ics, ics
    assert 'SUMMARY:日常裡的善意・線上共學' in ics
    click(page, 'close')
    passed(f'{engine}: registered activity exports a valid Taipei-time calendar file')

    click(page, 'account')
    click(page, 'study-settings')
    page.locator('[data-form="study-settings"] [name="theme"][value="dark"]').check()
    page.locator('[data-form="study-settings"] [name="textSize"][value="xl"]').check()
    page.locator('[data-form="study-settings"] [type="submit"]').click()
    page.wait_for_timeout(150)
    assert page.evaluate('document.documentElement.dataset.theme') == 'dark'
    assert page.evaluate('document.documentElement.dataset.text') == 'xl'
    page.set_viewport_size({'width': 390, 'height': 844})
    for route in ['home', 'review', 'tutor', 'stats', 'courses', 'course/foundation']:
        go(page, route)
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth'), route
    expect(page.locator('#mobile-nav [data-page="review"]')).to_be_visible()
    page.reload()
    assert page.evaluate('document.documentElement.dataset.theme') == 'dark'
    passed(f'{engine}: dark theme and extra-large text persist and fit phone width')

    go(page, 'course/foundation')
    click(page, 'select-lesson', '[data-index="2"]')
    click(page, 'play-lesson')
    expect(page.locator('#modal.lesson-dialog')).to_be_visible()
    box = page.locator('#modal').bounding_box()
    assert box['width'] >= 389 and box['height'] >= 800, box
    click(page, 'close')
    assert not errors, errors
    passed(f'{engine}: full-screen mobile lesson player and no uncaught errors')
    context.close()


def streak_rules(browser, base):
    def seeded(days, freezes, extra=None):
        study = {'xpByDay': {day: 15 for day in days}, 'freezes': freezes, 'dailyGoal': 20, 'goalChosen': True}
        study.update(extra or {})
        return {'name': '測試', 'role': 'member', 'signedIn': True, 'lessons': {'foundation': [0], 'practice': [], 'lead': []}, 'completed': [], 'study': study}

    week = [f'2026-11-0{day}' for day in range(1, 8)]

    # One missed day (11-09) with one freeze keeps an 8-day run alive.
    context = fixed_day_context(browser, seeded([f'2026-11-0{day}' for day in range(1, 9)], 1))
    page = context.new_page()
    page.goto(base + 'index.html')
    info = page.evaluate('({streak: GY_STUDY.currentStreak(), freezes: state.study.freezes, frozen: state.study.frozenDays})')
    assert info == {'streak': 9, 'freezes': 0, 'frozen': ['2026-11-09']}, info
    context.close()

    # Two missed days with one freeze: the streak breaks and the freeze is kept.
    context = fixed_day_context(browser, seeded(week, 1))
    page = context.new_page()
    page.goto(base + 'index.html')
    info = page.evaluate('({streak: GY_STUDY.currentStreak(), freezes: state.study.freezes, frozen: state.study.frozenDays})')
    assert info == {'streak': 0, 'freezes': 1, 'frozen': []}, info
    context.close()

    # Six days through yesterday + XP today = 7-day milestone that earns a freeze.
    context = fixed_day_context(browser, seeded([f'2026-11-0{day}' for day in range(4, 10)], 0))
    page = context.new_page()
    page.goto(base + 'index.html#review')
    click(page, 'review-reveal')
    page.locator('[data-action="review-rate"][data-rating="good"]').click()
    page.wait_for_timeout(200)
    info = page.evaluate('({streak: GY_STUDY.currentStreak(), freezes: state.study.freezes, milestones: state.study.milestones})')
    assert info == {'streak': 7, 'freezes': 1, 'milestones': [7]}, info
    expect(page.locator('#toast')).to_contain_text('連續保護')
    context.close()

    # Tampered study data is clamped instead of trusted.
    hostile = seeded(['2026-11-10'], 99, {'xpByDay': {'2026-11-10': -50, 'not-a-date': 9, '2030-01-01': 5}, 'cards': {'bogus#0': {'due': '2026-11-10'}, 'foundation:0#0': {'due': 'x', 'ease': 99, 'interval': -3}}, 'settings': {'theme': 'neon', 'textSize': '<b>', 'aiOptIn': 'yes'}, 'tutorLog': [{'role': 'system', 'text': 'x'}]})
    context = fixed_day_context(browser, hostile)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(base + 'index.html')
    study = page.evaluate('state.study')
    assert study['xpByDay'] == {} and study['freezes'] == 2
    assert 'bogus#0' not in study['cards']
    assert study['cards']['foundation:0#0'] == {'due': TODAY, 'interval': 0, 'ease': 2.5, 'reps': 0, 'lapses': 0}
    assert study['settings'] == {'theme': 'system', 'textSize': 'normal', 'speechRate': 1, 'aiOptIn': False, 'offlineOnly': False, 'aiContext': True}
    assert study['tutorLog'] == []
    assert not errors, errors
    context.close()
    passed('Streak freezes fill short gaps only, 7-day milestone awards a freeze, tampered study data is clamped')


def concurrent_and_storage(browser, base):
    context = make_context(browser)
    first = context.new_page()
    second = context.new_page()
    first.goto(base + 'index.html')
    start_guest(first)
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
        context = make_context(browser)
        context.add_init_script(f'''if (!sessionStorage.getItem('seeded')) {{
            localStorage.setItem('guangyao-v2:' + new URL('.', location.href).pathname, {json.dumps(raw)});
            sessionStorage.setItem('seeded', '1');
        }}''')
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(base + 'index.html')
        expect(page.locator('.welcome')).to_be_visible()
        assert page.evaluate('state.points') == 320
        assert page.evaluate('state.completed.length') == 0
        assert page.evaluate('state.groups.length') == 0
        assert not errors, errors
        context.close()
    passed('Corrupt JSON, invalid shapes, hostile IDs and fabricated balances normalize safely')

    context = make_context(browser)
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
    assert page.evaluate('state.account.mode') == 'guest'
    expect(page.locator('.hero')).to_be_visible()
    passed('Existing v1 progress and redemptions migrate (as a guest account) without resetting valid work')
    context.close()


def pwa_and_updates(browser, base):
    context = make_context(browser)
    page = context.new_page()
    page.set_default_timeout(10000)
    page.goto(base + 'demo-project/index.html')
    start_guest(page)
    page.wait_for_function('navigator.serviceWorker.controller !== null')
    scope = page.evaluate('navigator.serviceWorker.getRegistration().then(registration => registration.scope)')
    assert scope.endswith('/demo-project/')
    manifest = page.evaluate('fetch("manifest.webmanifest").then(response => response.json())')
    assert manifest['scope'] == './' and manifest['display'] == 'standalone'
    cdp = context.new_cdp_session(page)
    cdp.send('Page.enable')
    installability = cdp.send('Page.getInstallabilityErrors')
    assert installability['installabilityErrors'] == [], installability
    cdp.detach()
    keys = page.evaluate('caches.keys()')
    shell_key = next(key for key in keys if '%2Fdemo-project%2F' in key)
    cached_urls = page.evaluate('(key) => caches.open(key).then(cache => cache.keys()).then(keys => keys.map(request => request.url))', shell_key)
    assert len(cached_urls) == 9
    assert all('/demo-project/' in url for url in cached_urls)
    assert not any('admin' in url or 'githubusercontent' in url for url in cached_urls)
    assert not any('/api/' in url for url in cached_urls)
    awaitable = 'fetch("api/private-probe", {cache: "no-store"}).then(response => response.status)'
    page.evaluate(awaitable)
    assert page.evaluate('(key) => caches.open(key).then(cache => cache.keys()).then(keys => keys.length)', shell_key) == 9
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
    page.wait_for_function('caches.keys().then(keys => keys.some(key => key.endsWith("4.2.1-test")))')
    assert shell_key not in page.evaluate('caches.keys()')
    passed('Updates wait for confirmation; approved update activates and clears only its scoped old cache')
    DemoHandler.release_override = False
    context.close()


PUTER_MOCK_JS = """
(() => {
  if (window.__puterMock) return;
  window.__puterMock = true;
  window.puterCalls = [];
  window.puterReply = '';
  window.puterFail = '';
  const store = () => JSON.parse(sessionStorage.getItem('mock-kv') || '{}');
  const persist = data => sessionStorage.setItem('mock-kv', JSON.stringify(data));
  window.puter = {
    auth: {
      isSignedIn: () => sessionStorage.getItem('mock-puter-signed') === '1',
      signIn: async () => { sessionStorage.setItem('mock-puter-signed', '1'); return true; },
      signOut: async () => { sessionStorage.removeItem('mock-puter-signed'); window.puterSignedOut = true; },
      getUser: async () => ({username: 'tester'})
    },
    kv: {
      get: async key => (store()[key] ?? null),
      set: async (key, value) => {
        if (window.kvFail) throw new Error(window.kvFail);
        const data = store();
        data[key] = value;
        persist(data);
        return true;
      },
      del: async key => { const data = store(); delete data[key]; persist(data); return true; }
    },
    ai: {
      chat: async (messages, options) => {
        window.puterCalls.push({messages, options});
        if (window.puterFail) throw new Error(window.puterFail);
        const text = window.puterReply || '先想一想：課文說要先詢問再協助〈看見生活裡的需要〉。你會怎麼開口？';
        window.puterReply = '';
        const parts = [text.slice(0, 5), text.slice(5, 12), text.slice(12)];
        return (async function* stream() {
          for (const part of parts) yield {text: part};
        })();
      }
    }
  };
})();
"""


def install_puter_mock(page):
    page.evaluate(PUTER_MOCK_JS)


def content_flows(browser, base, engine):
    context = fixed_day_context(browser, catalog=CONTENT_CATALOG, viewport={'width': 1440, 'height': 1000})
    page = context.new_page()
    page.set_default_timeout(8000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(base + 'index.html')
    expect(page.locator('.welcome')).to_be_visible()
    expect(page.locator('.welcome-compare')).to_contain_text('AI 學伴')
    expect(page.locator('.welcome a[href="admin.html"]')).to_be_visible()
    go(page, 'guide')
    expect(page.locator('#main h1')).to_contain_text('使用指南')
    assert page.locator('.faq').count() >= 5
    expect(page.locator('#main .card a[href="admin.html"]').first).to_be_visible()
    go(page, 'home')
    start_guest(page)
    expect(page.locator('.official-strip')).to_contain_text('11 月共學開放報名中')
    expect(page.locator('.official-strip [data-action="play-official"]').first).to_contain_text('新手導覽')
    passed(f'{engine}: welcome screen with guest/sign-in choice, usage guide before sign-in, announcement and newest lessons on home')

    go(page, 'library')
    lessons = page.locator('.official-lesson')
    assert lessons.count() == 2, lessons.count()
    expect(page.locator('#main')).not_to_contain_text('尚未發布的草稿')
    assert page.evaluate('window.catalogXss === undefined')
    rows = page.locator('.material-row')
    assert rows.count() == 1, rows.count()
    href = rows.first.locator('a').get_attribute('href')
    assert href == 'https://cdn.jsdelivr.net/gh/juw12/projects@' + 'a' * 40 + '/content/guangyao/files/2026/11/abc-handbook.pdf', href
    assert rows.first.locator('a').get_attribute('rel') == 'noopener noreferrer'
    passed(f'{engine}: official library hides drafts, rejects javascript: and path-traversal materials, escapes titles and links commit-pinned files')

    page.locator('[data-action="play-official"][data-id="onboarding"]').click()
    expect(page.locator('#modal.lesson-dialog')).to_be_visible()
    assert 'youtube-nocookie.com/embed/dQw4w9WgXcQ' in page.locator('.video-embed iframe').get_attribute('src')
    expect(page.locator('.attachments')).to_contain_text('學員使用手冊')
    expect(page.locator('.attachments')).not_to_contain_text('草稿講義')
    expect(page.locator('.lesson-count')).to_have_text('1/4')
    click(page, 'lesson-next')
    click(page, 'lesson-choose', '[data-index="0"]')
    expect(page.locator('#modal .feedback')).to_have_class('feedback good')
    click(page, 'lesson-next')
    click(page, 'lesson-choose', '[data-index="0"]')
    expect(page.locator('#modal .feedback')).to_have_class('feedback bad')
    click(page, 'lesson-next')
    page.locator('#lesson-reflection').fill('晚上九點')
    click(page, 'lesson-finish')
    expect(page.locator('#modal')).to_contain_text('答對 1 / 2 題')
    click(page, 'complete-lesson')
    page.wait_for_timeout(200)
    expect(page.locator('#modal')).not_to_be_visible()
    data = read_state(page)['study']
    assert data['officialDone'] == ['onboarding']
    assert data['mastery']['official:onboarding'] == {'correct': 1, 'total': 2}
    assert 'official:onboarding#0' in data['cards']
    assert data['journal'][-1] == {'date': TODAY, 'lesson': 'official:onboarding', 'text': '晚上九點'}
    passed(f'{engine}: admin-published lesson plays with video, attachments, two questions and a reflection; completion, mastery, cards and journal recorded')

    go(page, 'tutor')
    expect(ask_tutor(page, '連續保護最多幾個？')).to_contain_text('出處：〈學員使用手冊〉')
    passed(f'{engine}: offline tutor answers from admin material notes with a citation')

    go(page, 'schedule')
    expect(page.locator('#main')).to_contain_text('新朋友線上說明會')
    expect(page.locator('#main')).not_to_contain_text('草稿活動')
    card = page.locator('.event-card', has_text='新朋友線上說明會')
    expect(card.locator('.tag.blue')).to_contain_text('正式公告')
    click(page, 'event-detail', '[data-id="pub-open-day"]')
    signup = page.locator('#modal a', has_text='前往主辦方報名')
    assert signup.get_attribute('href') == 'https://example.com/form' and signup.get_attribute('target') == '_blank'
    click(page, 'register-event')
    assert 'pub-open-day' in read_state(page)['registrations']
    click(page, 'calendar-toggle')
    expect(page.locator('#main h2').first).to_contain_text('2026 年 11 月')
    click(page, 'calendar-month', '[data-step="1"]')
    expect(page.locator('#main h2').first).to_contain_text('2026 年 12 月')
    click(page, 'calendar-toggle')
    assert page.locator('[data-action="event-detail"][data-id="e1"]').count() >= 1
    hidden = dict(CONTENT_CATALOG, settings={'announcement': '', 'hideSamples': True})
    page.evaluate('(catalog) => GY_CATALOG.inject(catalog)', hidden)
    page.wait_for_timeout(150)
    assert page.locator('[data-action="event-detail"][data-id="e1"]').count() == 0
    expect(page.locator('#main')).to_contain_text('新朋友線上說明會')
    passed(f'{engine}: published events with external signup, personal schedule, month calendar navigation and admin-hidden sample events')

    page.reload()
    assert 'official:onboarding#0' in read_state(page)['study']['cards']
    stripped = dict(CONTENT_CATALOG, lessons=[])
    page.evaluate('(catalog) => GY_CATALOG.inject(catalog)', stripped)
    go(page, 'review')
    expect(page.locator('main h1')).to_contain_text('每日複習')
    assert not any(card.startswith('official:') for card in page.evaluate('GY_STUDY.dueCards()'))
    assert 'official:onboarding#0' in page.evaluate('state.study.cards ? Object.keys(state.study.cards) : []')
    assert not errors, errors
    passed(f'{engine}: progress on official lessons survives reloads; unpublished lessons are skipped in review without losing data')
    context.close()


def account_sync_flows(browser, base):
    context = make_context(browser, skip_tour=False, viewport={'width': 1300, 'height': 900})
    context.add_init_script(PUTER_MOCK_JS)
    remote = {
        'name': '雲端', 'signedIn': True, 'lessons': {'foundation': [0, 1, 2], 'practice': [], 'lead': []},
        'completed': [], 'registrations': ['e2'],
        'study': {'xpByDay': {'2026-10-20': 30}, 'cards': {'foundation:2#0': {'due': '2026-10-30', 'interval': 6, 'ease': 2.6, 'reps': 3, 'lapses': 0}}, 'officialDone': ['onboarding'], 'journal': [{'date': '2026-10-20', 'lesson': 'foundation:2', 'text': '雲端心得'}]}
    }
    context.add_init_script(f"""
        if (!sessionStorage.getItem('mock-kv')) {{
            const text = JSON.stringify({json.dumps(remote, ensure_ascii=False)});
            sessionStorage.setItem('mock-kv', JSON.stringify({{'guangyao-sync-v1:0': text, 'guangyao-sync-v1:meta': JSON.stringify({{parts: 1, updatedAt: '2026-10-20T00:00:00Z'}})}}));
        }}""")
    page = context.new_page()
    page.set_default_timeout(8000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(base + 'index.html')
    page.locator('.welcome [data-action="puter-signin"]').click()
    expect(page.locator('.tour')).to_be_visible()
    page.locator('[data-form="tour-name"] input').fill('小芳')
    page.locator('[data-form="tour-name"] [type="submit"]').click()
    for _ in range(2):
        click(page, 'tour-next')
    click(page, 'tour-skip')
    expect(page.locator('#modal')).not_to_be_visible()
    state = read_state(page)
    assert state['account'] == {'mode': 'puter', 'username': 'tester', 'syncedAt': ''}, state['account']
    assert state['name'] == '小芳'
    assert sorted(state['lessons']['foundation']) == [0, 1, 2]
    assert state['study']['xpByDay'].get('2026-10-20') == 30
    assert state['study']['cards']['foundation:2#0']['reps'] == 3
    assert 'onboarding' in state['study']['officialDone']
    assert 'e2' in state['registrations']
    assert page.evaluate("localStorage.getItem('guangyao-tour-v1') !== null")
    passed('Puter sign-in from the welcome screen merges cloud progress (lessons, XP, cards, journal, registrations) and runs the first-visit tour once')

    page.wait_for_function("JSON.parse(sessionStorage.getItem('mock-kv'))['guangyao-sync-v1:meta'] && JSON.parse(JSON.parse(sessionStorage.getItem('mock-kv'))['guangyao-sync-v1:0']).name === '小芳'", timeout=10000)
    click(page, 'choose-goal', '[data-xp="30"]')
    page.wait_for_function("JSON.parse(JSON.parse(sessionStorage.getItem('mock-kv'))['guangyao-sync-v1:0']).study.dailyGoal === 30", timeout=10000)
    expect(page.locator('.top-actions .demo-pill')).to_contain_text('已同步')
    merged = page.evaluate("""() => GY_MERGE_STATES(
        {name: '學員', lessons: {foundation: [0]}, completed: [], study: {xpByDay: {'2026-11-01': 10, '2026-11-02': 40}, cards: {'a#0': {reps: 1, due: '2026-11-03'}}, journal: [{date: '2026-11-01', lesson: 'x', text: 'A'}], officialDone: ['one']}},
        {name: '遠端', lessons: {foundation: [1]}, completed: ['foundation'], study: {xpByDay: {'2026-11-01': 25}, cards: {'a#0': {reps: 4, due: '2026-11-20'}}, journal: [{date: '2026-11-01', lesson: 'x', text: 'A'}], officialDone: ['two']}}
    )""")
    assert merged['name'] == '遠端'
    assert sorted(merged['lessons']['foundation']) == [0, 1] and merged['completed'] == ['foundation']
    assert merged['study']['xpByDay'] == {'2026-11-01': 25, '2026-11-02': 40}
    assert merged['study']['cards']['a#0']['reps'] == 4
    assert len(merged['study']['journal']) == 1 and sorted(merged['study']['officialDone']) == ['one', 'two']
    passed('Changes push to the Puter key-value store automatically; merges never lose XP, cards, completions or journal entries')

    page.evaluate("window.kvFail = 'network down'")
    page.evaluate('GY_ACCOUNT.pushNow()')
    expect(page.locator('.top-actions .demo-pill')).to_contain_text('同步暫停', timeout=10000)
    page.evaluate("window.kvFail = ''")
    page.reload()
    page.wait_for_function("document.querySelector('.top-actions .demo-pill') && document.querySelector('.top-actions .demo-pill').textContent.includes('已同步')", timeout=10000)
    assert read_state(page)['account']['mode'] == 'puter'
    passed('Sync failures are surfaced, and the session resumes and re-syncs after a reload')

    click(page, 'account')
    expect(page.locator('.account-status.puter')).to_contain_text('tester')
    click(page, 'logout')
    expect(page.locator('#dialog-title')).to_contain_text('已登出')
    assert page.evaluate('window.puterSignedOut === true')
    click(page, 'confirm-reset')
    expect(page.locator('.welcome')).to_be_visible()
    assert read_state(page)['signedIn'] is False
    assert not errors, errors
    passed('Sign-out syncs first, signs out of Puter and offers to clear a shared device')
    context.close()


class MockGitHub:
    """In-memory stand-in for the GitHub contents API used by the admin console."""

    def __init__(self, catalog):
        self.files = {'catalog.json': json.dumps(catalog, ensure_ascii=False)}
        self.shas = {'catalog.json': 'sha-catalog-1'}
        self.counter = 1
        self.fail_next_catalog_put = False
        self.requests = []

    def handle(self, route):
        import base64
        request = route.request
        token = (request.headers.get('authorization') or '').removeprefix('Bearer ')
        path = urlsplit(request.url).path
        self.requests.append((request.method, path))
        if token not in ('good-token', 'read-token'):
            return route.fulfill(status=401, json={'message': 'Bad credentials'})
        if path == '/user':
            return route.fulfill(json={'login': 'admin-tester', 'name': '測試管理員'})
        if path == '/repos/juw12/projects':
            return route.fulfill(json={'permissions': {'push': token == 'good-token'}})
        prefix = '/repos/juw12/projects/contents/content/guangyao/'
        if not path.startswith(prefix):
            return route.fulfill(status=404, json={'message': 'Not Found'})
        name = unquote(path[len(prefix):])
        if request.method == 'GET':
            if name not in self.files:
                return route.fulfill(status=404, json={'message': 'Not Found'})
            return route.fulfill(json={'sha': self.shas[name], 'content': base64.b64encode(self.files[name].encode() if isinstance(self.files[name], str) else self.files[name]).decode()})
        body = json.loads(request.post_data or '{}')
        if token != 'good-token':
            return route.fulfill(status=403, json={'message': 'Resource not accessible'})
        if request.method == 'DELETE':
            if body.get('sha') != self.shas.get(name):
                return route.fulfill(status=409, json={'message': 'sha mismatch'})
            self.files.pop(name)
            self.shas.pop(name)
            return route.fulfill(json={'commit': {'sha': 'd' * 40}})
        if name == 'catalog.json':
            if self.fail_next_catalog_put:
                self.fail_next_catalog_put = False
                self.counter += 1
                self.shas[name] = f'sha-catalog-{self.counter}'
                return route.fulfill(status=409, json={'message': 'is at abc but expected def'})
            if body.get('sha') != self.shas[name]:
                return route.fulfill(status=409, json={'message': 'sha mismatch'})
            self.files[name] = base64.b64decode(body['content']).decode()
        else:
            if name in self.files and body.get('sha') != self.shas[name]:
                return route.fulfill(status=422, json={'message': 'sha required'})
            self.files[name] = base64.b64decode(body['content'])
        self.counter += 1
        self.shas[name] = f'sha-{self.counter}'
        commit = f'{self.counter:040x}'
        return route.fulfill(json={'commit': {'sha': commit}, 'content': {'sha': self.shas[name], 'path': name}})

    @property
    def catalog(self):
        return json.loads(self.files['catalog.json'])


def admin_flows(browser, base, engine):
    github = MockGitHub(EMPTY_CATALOG)
    context = browser.new_context(viewport={'width': 1280, 'height': 900})
    context.route('https://api.github.com/**', github.handle)
    page = context.new_page()
    page.set_default_timeout(8000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(base + 'admin.html')
    expect(page.locator('h1')).to_contain_text('管理員登入')
    assert page.locator('a[href="https://github.com/settings/personal-access-tokens/new"]').count() == 1
    assert 'scopes=public_repo' in page.locator('a', has_text='建立 Classic 權杖').get_attribute('href')
    for token, message in [('wrong-token', '權杖無效'), ('read-token', '沒有內容庫的寫入權限')]:
        page.fill('#login-form [name="token"]', token)
        page.click('#login-form [type="submit"]')
        expect(page.locator('.notice.error')).to_contain_text(message)
    page.fill('#login-form [name="token"]', 'good-token')
    page.click('#login-form [type="submit"]')
    expect(page.locator('.tabs')).to_be_visible()
    assert page.evaluate("sessionStorage.getItem('guangyao-admin-token') === 'good-token' && localStorage.getItem('guangyao-admin-token') === null")
    passed(f'{engine}: admin login rejects bad and read-only tokens, explains token setup and keeps the token in session storage only')

    page.click('[data-tab="materials"]')
    upload = page.locator('#upload-form')
    upload.locator('[name="file"]').set_input_files({'name': '講義.pdf', 'mimeType': 'application/pdf', 'buffer': b'%PDF-1.4 test handout'})
    upload.locator('[name="title"]').fill('<img src=x onerror="window.adminXss=1">講義')
    upload.locator('[name="notes"]').fill('重點：先聽完再回應。')
    upload.locator('[type="submit"]').click()
    expect(page.locator('.notice.ok')).to_contain_text('教材已上傳')
    material = github.catalog['materials'][0]
    assert material['path'].startswith('files/') and material['path'].endswith('-file.pdf'), material
    assert material['filename'] == '講義.pdf' and len(material['commit']) == 40 and material['size'] == 21
    assert github.files[material['path']] == b'%PDF-1.4 test handout'
    assert page.evaluate('window.adminXss === undefined')
    page.locator('#upload-form [name="file"]').set_input_files({'name': 'huge.pdf', 'mimeType': 'application/pdf', 'buffer': b'0' * (20 * 1024 * 1024 + 1)}, timeout=60000)
    page.fill('#upload-form [name="title"]', '太大的檔案')
    page.locator('#upload-form [type="submit"]').click()
    expect(page.locator('.notice.error')).to_contain_text('檔案太大')
    assert len(github.catalog['materials']) == 1
    page.select_option('#link-form [name="kind"]', 'link')
    page.fill('#link-form [name="url"]', 'javascript:alert(1)')
    page.fill('#link-form [name="title"]', '危險連結')
    page.locator('#link-form [type="submit"]').click()
    expect(page.locator('.notice.error')).to_contain_text('https://')
    passed(f'{engine}: uploads commit the file then the catalog entry; oversize files and javascript: links are refused; titles are escaped')

    page.click('[data-tab="lessons"]')
    lesson = page.locator('#lesson-form')
    lesson.locator('[name="title"]').fill('傾聽練習')
    lesson.locator('[name="reading"]').fill('第一段：先聽完。\n\n第二段：再回應。')
    lesson.locator('[name="q-0"]').fill('先做什麼？')
    lesson.locator('[name="o-0"]').fill('先聽完\n先回應')
    lesson.locator('[name="a-0"]').fill('3')
    lesson.locator('[type="submit"]').click()
    expect(page.locator('.notice.error')).to_contain_text('第 1 題')
    assert github.catalog['lessons'] == []
    expect(page.locator('#lesson-form [name="title"]')).to_have_value('傾聽練習')
    expect(page.locator('#lesson-form [name="o-0"]')).to_have_value('先聽完\n先回應')
    page.locator('#lesson-form [name="a-0"]').fill('1')
    page.locator('#lesson-form [name="video"]').fill('https://vimeo.com/123')
    page.locator('#lesson-form [type="submit"]').click()
    expect(page.locator('.notice.error')).to_contain_text('YouTube')
    page.locator('#lesson-form [name="video"]').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    page.locator('#lesson-form [name="cards"]').fill('傾聽第一步？ | 先聽完\n無效的一行')
    page.locator('#lesson-form [name="materials"]').first.check()
    page.locator('#lesson-form [type="submit"]').click()
    expect(page.locator('.notice.ok')).to_contain_text('課程單元已發布')
    saved = github.catalog['lessons'][0]
    assert saved['reading'] == ['第一段：先聽完。', '第二段：再回應。']
    assert saved['quiz'] == [{'question': '先做什麼？', 'options': ['先聽完', '先回應'], 'answer': 0, 'explain': ''}]
    assert saved['cards'] == [['傾聽第一步？', '先聽完']] and saved['materials'] == [material['id']]
    page.locator(f'[data-edit-lesson="{saved["id"]}"]').click()
    page.locator('#lesson-form [name="title"]').fill('傾聽練習（修訂）')
    page.locator('#lesson-form [type="submit"]').click()
    expect(page.locator('.notice.ok')).to_contain_text('已更新')
    assert len(github.catalog['lessons']) == 1 and github.catalog['lessons'][0]['title'] == '傾聽練習（修訂）'
    github.fail_next_catalog_put = True
    page.locator(f'[data-toggle="lessons"][data-id="{saved["id"]}"]').click()
    expect(page.locator('.notice.ok')).to_contain_text('顯示狀態')
    assert github.catalog['lessons'][0]['status'] == 'draft'
    page.locator(f'[data-toggle="lessons"][data-id="{saved["id"]}"]').click()
    expect(page.locator('.notice.ok')).to_contain_text('顯示狀態')
    passed(f'{engine}: lesson editor validates quizzes and videos, parses paragraphs and flashcards, edits in place and retries after a concurrent-write conflict')

    page.click('[data-tab="events"]')
    event = page.locator('#event-form')
    event.locator('[name="title"]').fill('共學說明會')
    event.locator('[name="date"]').fill('2026-12-05')
    event.locator('[name="time"]').fill('19:30')
    event.locator('[name="signupUrl"]').fill('https://example.com/signup')
    event.locator('[type="submit"]').click()
    expect(page.locator('.notice.ok')).to_contain_text('活動已儲存')
    assert github.catalog['events'][0]['signupUrl'] == 'https://example.com/signup'
    page.click('[data-tab="settings"]')
    page.fill('#settings-form [name="announcement"]', '歡迎加入！')
    page.check('#settings-form [name="hideSamples"]')
    page.click('#settings-form [type="submit"]')
    expect(page.locator('.notice.ok')).to_contain_text('設定已儲存')
    assert github.catalog['settings'] == {'announcement': '歡迎加入！', 'hideSamples': True}
    published = github.catalog
    page.click('[data-tab="materials"]')
    page.once('dialog', lambda dialog: dialog.accept())
    page.locator(f'[data-delete="materials"][data-id="{material["id"]}"]').click()
    expect(page.locator('.notice.ok')).to_contain_text('已刪除')
    assert material['path'] not in github.files
    assert github.catalog['materials'] == [] and github.catalog['lessons'][0]['materials'] == []
    assert ('DELETE', f'/repos/juw12/projects/contents/content/guangyao/{material["path"]}') in [(method, unquote(path)) for method, path in github.requests]
    page.click('#logout')
    assert page.evaluate("sessionStorage.getItem('guangyao-admin-token') === null")
    assert not errors, errors
    passed(f'{engine}: events, announcement and sample visibility publish; deleting a material removes the file and its lesson links; logout clears the token')
    context.close()

    learner = make_context(browser, catalog=published, viewport={'width': 1280, 'height': 900})
    page = learner.new_page()
    page.goto(base + 'index.html')
    start_guest(page)
    expect(page.locator('.official-strip')).to_contain_text('歡迎加入！')
    go(page, 'library')
    expect(page.locator('.official-lesson')).to_contain_text('傾聽練習（修訂）')
    go(page, 'schedule')
    expect(page.locator('#main')).to_contain_text('共學說明會')
    assert page.locator('[data-action="event-detail"][data-id="e1"]').count() == 0
    learner.close()
    passed(f'{engine}: what the admin publishes is exactly what learners see')


def screenshots(browser, base):
    showcase = dict(CONTENT_CATALOG, lessons=[item for item in CONTENT_CATALOG['lessons'] if item['id'] == 'onboarding'])
    context = make_context(browser, catalog=showcase, viewport={'width': 1440, 'height': 1080}, device_scale_factor=1)
    page = context.new_page()
    page.goto(base + 'index.html')
    page.wait_for_selector('.welcome')
    page.screenshot(path=str(MEDIA / 'welcome.png'))
    start_guest(page)
    page.wait_for_selector('.hero')
    page.screenshot(path=str(MEDIA / 'desktop.png'), full_page=True)
    page.set_viewport_size({'width': 390, 'height': 844})
    page.wait_for_timeout(400)
    page.screenshot(path=str(MEDIA / 'mobile.png'))
    context.close()


NATIVE_SHELL_JS = """
(() => {
  window.__written = [];
  window.__shared = [];
  window.__signInCalls = 0;
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      Filesystem: {writeFile: async options => { window.__written.push(options); return {uri: 'file:///cache/' + options.path}; }},
      Share: {share: async options => { window.__shared.push(options); }}
    }
  };
  // Puter whose sign-in window is closed by the user: the promise never settles.
  window.puter = {
    auth: {isSignedIn: () => false, signIn: () => { window.__signInCalls += 1; return new Promise(() => {}); }, getUser: async () => null},
    kv: {get: async () => null, set: async () => true, del: async () => true},
    ai: {chat: async () => { throw new Error('offline'); }}
  };
})();
"""


IPHONE_UA = ('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 '
             '(KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1')


def close_tour_if_open(page):
    if page.evaluate("document.getElementById('modal').open"):
        skip = page.locator('#modal [data-action="tour-skip"]')
        if skip.count():
            skip.first.click()
        else:
            page.locator('#modal [data-action="close"]').first.click()
    expect(page.locator('#modal')).not_to_be_visible()


def iphone_install_flows(browser, base):
    """iPhone visitors get a free home-screen app: icons, launch screens, guided steps and a one-time hint."""
    context = make_context(browser, viewport={'width': 393, 'height': 852}, user_agent=IPHONE_UA)
    page = context.new_page()
    page.set_default_timeout(8000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(base + 'index.html')
    expect(page.locator('.welcome')).to_be_visible()
    head = page.evaluate("""() => ({
        touch: document.querySelector('link[rel="apple-touch-icon"]').getAttribute('href'),
        sizes: document.querySelector('link[rel="apple-touch-icon"]').getAttribute('sizes'),
        startup: [...document.querySelectorAll('link[rel="apple-touch-startup-image"]')].map(link => link.getAttribute('href')),
        capable: document.querySelector('meta[name="apple-mobile-web-app-capable"]').content,
        title: document.querySelector('meta[name="apple-mobile-web-app-title"]').content
    })""")
    assert head['touch'] == 'icons/apple-touch-icon.png' and head['sizes'] == '180x180', head
    assert len(head['startup']) >= 10 and head['capable'] == 'yes' and head['title'] == '光耀同行', head
    for href in [head['touch']] + head['startup']:
        response = page.request.get(base + href)
        assert response.ok and response.headers['content-type'].startswith('image/png'), href
    # The hint never covers the welcome screen.
    page.wait_for_timeout(7000)
    expect(page.locator('.ios-install-prompt')).to_have_count(0)
    passed('iPhone: 180 px home-screen icon, launch screens for current iPhones, no hint over the welcome screen')

    page.locator('.welcome [data-action="guest-start"]').click()
    close_tour_if_open(page)
    prompt = page.locator('.ios-install-prompt')
    expect(prompt).to_be_visible(timeout=15000)
    expect(prompt).to_contain_text('把光耀同行加到主畫面')
    prompt.locator('[data-pwa-action="iphone-guide"]').click()
    dialog = page.locator('#modal')
    expect(dialog).to_contain_text('把光耀同行裝到 iPhone')
    expect(dialog.locator('.ios-steps li')).to_have_count(4)
    expect(dialog).to_contain_text('加入主畫面')
    ipa = dialog.locator('.ios-advanced a').first
    assert ipa.get_attribute('href').endswith('/guangyao-ios/GuangYao-iOS.ipa'), ipa.get_attribute('href')
    expect(prompt).to_have_count(0)
    assert page.evaluate("Boolean(localStorage.getItem('gy-ios-install-dismissed'))")
    dialog.locator('[data-action="close"]').first.click()
    expect(page.locator('[data-pwa-action="install"]')).to_have_text('加到主畫面')
    page.locator('[data-pwa-action="install"]').click()
    expect(dialog).to_contain_text('把光耀同行裝到 iPhone')
    dialog.locator('[data-action="close"]').first.click()
    page.reload()
    page.wait_for_timeout(11000)
    expect(page.locator('.ios-install-prompt')).to_have_count(0)
    assert not errors, errors
    passed('iPhone: one-time hint opens the step-by-step home-screen guide (with free sideload option) and stays dismissed')
    context.close()

    installed = make_context(browser, viewport={'width': 393, 'height': 852}, user_agent=IPHONE_UA)
    installed.add_init_script("Object.defineProperty(navigator, 'standalone', {get: () => true})")
    page = installed.new_page()
    page.set_default_timeout(8000)
    page.goto(base + 'index.html')
    page.locator('.welcome [data-action="guest-start"]').click()
    close_tour_if_open(page)
    page.wait_for_timeout(11000)
    expect(page.locator('.ios-install-prompt')).to_have_count(0)
    expect(page.locator('[data-pwa-action="install"]')).to_have_text('已安裝 · 使用說明')
    passed('iPhone: opened from the home screen, no install hint is shown')
    installed.close()


def native_shell_flows(browser, base):
    """The same site inside the Android/iPhone shell: detected by user agent, uses the native share sheet."""
    context = make_context(browser, catalog=CONTENT_CATALOG, viewport={'width': 412, 'height': 900},
                           user_agent='Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141 Mobile Safari/537.36 GuangYaoApp/1.0')
    context.add_init_script(NATIVE_SHELL_JS)
    page = context.new_page()
    page.set_default_timeout(8000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(base + 'index.html')
    expect(page.locator('.welcome')).to_be_visible()
    assert page.evaluate("window.GY_NATIVE.isApp && document.documentElement.classList.contains('native-app')")
    expect(page.locator('[data-pwa-action="install"]')).to_be_hidden()
    expect(page.locator('#network-state')).to_contain_text('光耀同行 App')

    page.locator('.welcome [data-action="puter-signin"]').click()
    page.wait_for_function('window.__signInCalls === 1')
    page.locator('.welcome [data-action="puter-signin"]').click()
    page.wait_for_timeout(200)
    assert page.evaluate('window.__signInCalls') == 1
    page.evaluate("window.dispatchEvent(new CustomEvent('guangyao:native-window-closed'))")
    expect(page.locator('#signin-error')).to_contain_text('登入視窗已關閉')
    page.locator('.welcome [data-action="puter-signin"]').click()
    page.wait_for_function('window.__signInCalls === 2')
    passed('App shell: detected by user agent, PWA install hidden, closing the Puter window unlocks sign-in again')

    page.evaluate("window.dispatchEvent(new CustomEvent('guangyao:native-window-closed'))")
    page.wait_for_timeout(1700)
    page.locator('.welcome [data-action="guest-start"]').click()
    expect(page.locator('.welcome')).to_have_count(0)
    page.evaluate("document.body.insertAdjacentHTML('beforeend', '<button type=\"button\" data-action=\"share-card\" id=\"share-test\">share</button>')")
    page.locator('#share-test').click()
    page.wait_for_function('window.__shared.length === 1')
    shared = page.evaluate('[window.__written[0].path, window.__written[0].directory, window.__written[0].data.length > 1000, window.__shared[0].files[0]]')
    assert shared[0] == 'guangyao-progress.png' and shared[1] == 'CACHE' and shared[2], shared
    assert shared[3] == 'file:///cache/guangyao-progress.png', shared
    page.evaluate("downloadFile('guangyao-test.ics', 'BEGIN:VCALENDAR\\nEND:VCALENDAR', 'text/calendar;charset=utf-8')")
    page.wait_for_function('window.__shared.length === 2')
    assert page.evaluate('window.__written[1].path') == 'guangyao-test.ics'
    assert not errors, errors
    passed('App shell: progress card and calendar entries go through the native share sheet')
    context.close()

    web = make_context(browser, viewport={'width': 1280, 'height': 900})
    page = web.new_page()
    page.goto(base + 'index.html')
    start_guest(page)
    assert not page.evaluate('window.GY_NATIVE.isApp')
    expect(page.locator('[data-pwa-action="install"]')).to_be_visible()
    go(page, '#guide')
    expect(page.locator('a[href$="/guangyao-android/GuangYao-android.apk"]').first).to_be_visible()
    page.locator('[data-pwa-action="install"]').click()
    expect(page.locator('#modal a[href$="/guangyao-android/GuangYao-android.apk"]')).to_be_visible()
    passed('Web: guide and install help offer the Android app download')
    web.close()


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
            study_flows(chromium, base, 'Chromium')
            content_flows(chromium, base, 'Chromium')
            account_sync_flows(chromium, base)
            native_shell_flows(chromium, base)
            admin_flows(chromium, base, 'Chromium')
            streak_rules(chromium, base)
            concurrent_and_storage(chromium, base)
            pwa_and_updates(chromium, base)
            screenshots(chromium, base)
            chromium.close()
            webkit = playwright.webkit.launch()
            core_flows(webkit, base, 'WebKit')
            study_flows(webkit, base, 'WebKit')
            content_flows(webkit, base, 'WebKit')
            admin_flows(webkit, base, 'WebKit')
            iphone_install_flows(webkit, base)
            webkit.close()
        print(f'\n{len(PASSED)} grouped regression checks passed, including 84 route-layout checks, accounts, sync, official content and the admin console.', flush=True)
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
