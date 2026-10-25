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
            content = (ROOT / 'sw.js').read_text().replace("'3.0.0'", "'3.0.1-test'")
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
    passed(f'{engine}: logout, reset, all three levels, repeat-award protection and no application errors')
    context.close()


TODAY = '2026-11-10'


def fixed_day_context(browser, seed=None, **options):
    context = browser.new_context(accept_downloads=False, **options)
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
    expect(ask_tutor(page, chip='做成閃卡')).to_contain_text('2 張閃卡')
    assert len(read_state(page)['study']['cards']) == 7
    ask_tutor(page, '<img src=x onerror="window.tutorXss=1">')
    assert page.evaluate('window.tutorXss === undefined')
    assert not puter_requests, puter_requests
    passed(f'{engine}: offline tutor citations, honest no-answer, quiz, answer withheld with hint, flashcard creation, escaping, zero network')

    page.locator('[data-setting-ai]').click()
    expect(page.locator('[data-setting-ai]')).not_to_be_checked()
    expect(page.locator('#dialog-title')).to_contain_text('雲端 AI')
    assert read_state(page)['study']['settings']['aiOptIn'] is False
    page.evaluate("""() => {
        window.puterCalls = [];
        window.puter = {
            auth: {isSignedIn: () => true, signIn: async () => true},
            ai: {chat: async messages => {
                window.puterCalls.push(messages);
                return {message: {content: '先想一想：課文說要先詢問再協助〈看見生活裡的需要〉。你會怎麼開口？'}};
            }}
        };
    }""")
    click(page, 'ai-confirm')
    assert read_state(page)['study']['settings']['aiOptIn'] is True
    page.locator('[data-setting-tutor-scope]').select_option('all')
    expect(ask_tutor(page, '長輩提重物時我該怎麼做？')).to_contain_text('雲端 AI')
    calls = page.evaluate('window.puterCalls')
    assert len(calls) == 1
    assert '只根據使用者提供的課程摘錄回答' in calls[0][0]['content']
    assert '〈看見生活裡的需要〉' in calls[0][1]['content'] and '先詢問' in calls[0][1]['content'], calls[0][1]['content']
    page.evaluate("() => { window.puter.ai.chat = async () => { throw new Error('quota exceeded'); }; }")
    expect(ask_tutor(page, '看見需要是什麼意思？')).to_contain_text('改用離線學伴')
    page.locator('[data-setting-ai]').uncheck()
    page.wait_for_timeout(150)
    assert read_state(page)['study']['settings']['aiOptIn'] is False
    passed(f'{engine}: cloud AI requires consent, sends grounded prompt, falls back offline on failure and can be turned off')

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
    assert study['settings'] == {'theme': 'system', 'textSize': 'normal', 'speechRate': 1, 'aiOptIn': False}
    assert study['tutorLog'] == []
    assert not errors, errors
    context.close()
    passed('Streak freezes fill short gaps only, 7-day milestone awards a freeze, tampered study data is clamped')


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
    assert len(cached_urls) == 7
    assert all('/demo-project/' in url for url in cached_urls)
    assert not any('/api/' in url for url in cached_urls)
    awaitable = 'fetch("api/private-probe", {cache: "no-store"}).then(response => response.status)'
    page.evaluate(awaitable)
    assert page.evaluate('(key) => caches.open(key).then(cache => cache.keys()).then(keys => keys.length)', shell_key) == 7
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
    page.wait_for_function('caches.keys().then(keys => keys.some(key => key.endsWith("3.0.1-test")))')
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
            study_flows(chromium, base, 'Chromium')
            streak_rules(chromium, base)
            concurrent_and_storage(chromium, base)
            pwa_and_updates(chromium, base)
            screenshots(chromium, base)
            chromium.close()
            webkit = playwright.webkit.launch()
            core_flows(webkit, base, 'WebKit')
            study_flows(webkit, base, 'WebKit')
            webkit.close()
        print(f'\n{len(PASSED)} grouped regression checks passed, including 72 route-layout checks plus v3 study flows.', flush=True)
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    main()
