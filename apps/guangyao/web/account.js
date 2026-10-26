/* Accounts (guest or Puter), cross-device sync, published-content pages, usage guide and onboarding.
 * Loaded after index.html's inline script, catalog.js and study.js. */
'use strict';

Object.assign(paths, {
  library: '<path d="M4 4h4v16H4zM10 4h4v16h-4z"/><path d="m16 5 4 1-3 14-4-1"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5Z"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9a4.5 4.5 0 0 0 1 9Z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  download: '<path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/>',
  file: '<path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v4h4"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>'
});
['account-pill', 'guest-start', 'puter-signin', 'tour-next', 'tour-skip', 'catalog-refresh', 'sync-now'].forEach(action => publicActions.add(action));

/* ------------------------------------------------------------------ *
 * Account state helpers
 * ------------------------------------------------------------------ */
const SYNC_PREFIX = 'guangyao-sync-v1';
const SYNC_CHUNK = 90000;
const SYNC_TIME_KEY = 'guangyao-synced-at';
const TOUR_KEY = 'guangyao-tour-v1';
let syncTimer = null;
let syncing = false;
let syncError = '';
let lastPull = 0;
let signingIn = false;

const isPuter = () => state.signedIn && state.account?.mode === 'puter';
const lastSynced = () => localStorage.getItem(SYNC_TIME_KEY) || '';
const relativeTime = iso => {
  if (!iso) return '尚未同步';
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 1) return '剛剛';
  if (minutes < 60) return `${minutes} 分鐘前`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} 小時前`;
  return new Date(iso).toLocaleDateString('zh-TW');
};

window.GY_ACCOUNT_LABEL = () => {
  if (!state.signedIn) return '登入或以訪客使用';
  return isPuter() ? `Puter · ${state.account.username}` : '訪客 · 進度存在此裝置';
};
window.GY_ACCOUNT_PILL = () => {
  if (!state.signedIn) return '';
  if (!isPuter()) return `<button type="button" class="demo-pill" data-action="account-pill">${icon('user')} 訪客模式</button>`;
  const label = syncing ? '同步中…' : syncError ? '同步暫停' : '已同步';
  return `<button type="button" class="demo-pill ${syncError ? 'warn' : 'synced'}" data-action="account-pill" title="${esc(syncError || `上次同步：${relativeTime(lastSynced())}`)}">${icon('cloud')} ${label}</button>`;
};
function updateStatusBar() {
  const element = document.getElementById('account-status');
  if (!element) return;
  element.textContent = !state.signedIn
    ? '非官方平台 · 登入或以訪客身分開始'
    : isPuter()
      ? `已登入 ${state.account.username} · ${syncError ? '同步暫停' : `進度已同步（${relativeTime(lastSynced())}）`}`
      : '訪客模式 · 進度只存在這台裝置';
}
document.addEventListener('guangyao:render', updateStatusBar);
function refreshAccountUi() {
  const pill = document.querySelector('.top-actions .demo-pill');
  if (pill) pill.outerHTML = window.GY_ACCOUNT_PILL();
  updateStatusBar();
}

/* ------------------------------------------------------------------ *
 * Welcome screen (shown until the person chooses guest or sign-in)
 * ------------------------------------------------------------------ */
window.GY_WELCOME = function welcomeScreen() {
  const rows = [
    ['互動課程、每日複習、學習數據', '✓', '✓'],
    ['官方教材與活動公告', '✓', '✓'],
    ['離線學伴（有出處的課程問答）', '✓', '✓'],
    ['AI 學伴：自由對話、出題批改、學習計畫', '—', '✓'],
    ['進度跨裝置同步（手機、電腦）', '僅這台裝置', '✓'],
    ['需要註冊', '不用', '免費帳號']
  ];
  return `<section class="welcome">
    <div class="welcome-card">
      <span class="brandmark big">${icon('sun')}</span>
      <div class="eyebrow">FA YI GUANG YAO · TOGETHER IN GROWTH</div>
      <h1>歡迎來到光耀同行</h1>
      <p class="welcome-lead">一起學習、一起成長：互動課程、每日複習、AI 學伴，以及同行活動。選一種方式開始。</p>
      <div class="welcome-options">
        <button type="button" class="welcome-option primary" data-action="puter-signin" ${signingIn ? 'disabled' : ''}>${icon('cloud')}<span><strong>${signingIn ? '登入中…' : '登入 / 建立帳號'}</strong><small>使用免費的 Puter 帳號（Email 即可註冊）。進度跨裝置同步，並解鎖 AI 學伴。</small></span></button>
        <button type="button" class="welcome-option" data-action="guest-start">${icon('user')}<span><strong>以訪客身分繼續</strong><small>不用註冊，馬上開始。進度只存在這台裝置，之後隨時可以登入保存。</small></span></button>
      </div>
      <p class="welcome-error" id="signin-error" role="alert" hidden></p>
      <div class="welcome-links"><a href="#guide">${icon('compass')} 第一次使用？看使用指南</a><a href="#about">認識光耀</a><a href="admin.html">${icon('shield')} 管理員登入</a></div>
    </div>
    <div class="card card-pad welcome-compare"><h2>訪客與登入有什麼不同？</h2><div class="table-wrap"><table><thead><tr><th>功能</th><th>訪客</th><th>登入</th></tr></thead><tbody>${rows.map(([feature, guest, member]) => `<tr><td>${feature}</td><td>${guest}</td><td><strong>${member}</strong></td></tr>`).join('')}</tbody></table></div><p class="muted" style="font-size:12px;margin-top:12px">登入由 Puter（第三方服務）處理，光耀同行不會看到你的密碼。這是非官方平台：積分、善行寶庫與社群聊天目前仍是示範功能。</p></div>
  </section>`;
};

function setSigninError(message) {
  const element = document.getElementById('signin-error');
  if (element) {
    element.textContent = message;
    element.hidden = !message;
  } else if (message) {
    toast(message);
  }
}
function signinFailureText(error) {
  const code = error && (error.error || error.code);
  if (code === 'auth_window_closed') return '登入視窗已關閉。可以再試一次，或先以訪客身分繼續。';
  if (code === 'unsupported_origin') return '請從正式網址開啟光耀同行再登入。';
  return `登入沒有完成：${(error && (error.message || error.msg)) || '請再試一次'}。若瀏覽器擋住了彈出視窗，請允許後重試。`;
}

function preloadPuter() {
  if (!window.puter && window.GY_PUTER && navigator.onLine) window.GY_PUTER().catch(() => {});
}
/* Load Puter only when someone reaches for the sign-in button: guests never contact it,
 * and the SDK is ready by the time the click opens the popup (so it is not blocked). */
['pointerover', 'focusin', 'touchstart'].forEach(type => document.addEventListener(type, event => {
  if (event.target.closest && event.target.closest('[data-action="puter-signin"]')) preloadPuter();
}, {passive: true}));

// In the iPhone/Android app the Puter window is a native sheet; if it is closed before finishing, unlock the button.
window.addEventListener('guangyao:native-window-closed', () => {
  setTimeout(() => {
    if (!signingIn || (window.puter && window.puter.auth.isSignedIn())) return;
    signingIn = false;
    setSigninError('登入視窗已關閉。需要時可以再按一次「登入 / 建立帳號」。');
  }, 1500);
});

async function puterSignIn() {
  if (signingIn) return;
  setSigninError('');
  signingIn = true;
  try {
    const sdk = window.puter || await window.GY_PUTER();
    // Called straight from the click so the Puter popup is not blocked.
    if (!sdk.auth.isSignedIn()) await sdk.auth.signIn();
    const user = await Promise.resolve(sdk.auth.getUser()).catch(() => null);
    const username = String((user && user.username) || 'Puter 使用者').slice(0, 40);
    const firstVisit = !state.signedIn;
    await withMutationLock(() => {
      if (!state.signedIn && (!state.name || state.name === '學員')) state.name = username.slice(0, 20);
      state.signedIn = true;
      state.account = {mode: 'puter', username, syncedAt: ''};
      save();
    });
    syncError = '';
    await pullAndMerge();
    closeModal();
    render();
    toast(`已登入 ${username}，進度會自動同步。`);
    if (firstVisit) maybeStartTour();
  } catch (error) {
    setSigninError(signinFailureText(error));
  } finally {
    signingIn = false;
  }
}

async function startAsGuest() {
  await withMutationLock(() => {
    state.signedIn = true;
    state.account = {mode: 'guest', username: '', syncedAt: ''};
    if (!state.name) state.name = '學員';
    save();
  });
  navigate('home');
  maybeStartTour();
}

window.GY_SIGN_OUT = async function signOut() {
  const wasPuter = isPuter();
  if (wasPuter) {
    clearTimeout(syncTimer);
    await pushNow().catch(() => {});
    try {
      if (window.puter) await Promise.resolve(window.puter.auth.signOut());
    } catch (error) {
      console.warn('Puter sign-out failed', error);
    }
  }
  await withMutationLock(() => {
    state.signedIn = false;
    state.account = {mode: 'none', username: '', syncedAt: ''};
    save();
  });
  syncError = '';
  navigate('home');
  modal('已登出', `<p>${wasPuter ? '你的進度已同步到 Puter 帳戶，下次登入會自動回來。' : '訪客紀錄仍保留在這台裝置上。'}</p><p class="muted" style="font-size:13px">如果這是共用裝置，建議清除此裝置上的紀錄。</p><div class="form-actions">${button('保留在此裝置', 'close', '', 'secondary')}${button('清除此裝置紀錄', 'confirm-reset', '', 'danger')}</div>`);
};

/* ------------------------------------------------------------------ *
 * Account modal
 * ------------------------------------------------------------------ */
accountModal = function realAccountModal() {
  if (!state.signedIn) {
    modal('開始使用光耀同行', `<p>選擇登入方式。登入可跨裝置同步並使用 AI 學伴；訪客不需註冊，進度只存在這台裝置。</p><div class="welcome-options compact">${button(`${icon('cloud')}登入 / 建立帳號`, 'puter-signin', '', 'wide')}${button(`${icon('user')}以訪客身分繼續`, 'guest-start', '', 'secondary wide')}</div><p class="welcome-error" id="signin-error" role="alert" hidden></p><p class="muted" style="font-size:12px;margin-top:14px">管理員請改用 <a href="admin.html">管理員登入</a>。</p>`);
    return;
  }
  const status = isPuter()
    ? `<div class="account-status puter">${icon('cloud')}<div><strong>Puter 帳戶 · ${esc(state.account.username)}</strong><small>${syncError ? `同步暫停：${esc(syncError)}` : `進度自動同步 · 上次同步 ${relativeTime(lastSynced())}`}</small></div>${button(syncing ? '同步中…' : '立即同步', 'sync-now', syncing ? 'disabled' : '', 'secondary small')}</div>`
    : `<div class="account-status guest">${icon('user')}<div><strong>訪客模式</strong><small>進度只存在這台裝置。登入後會把目前的進度一起保存到帳戶。</small></div>${button('登入保存進度', 'puter-signin', '', 'small')}</div>`;
  modal('我的帳戶', `${status}<p class="welcome-error" id="signin-error" role="alert" hidden></p>
    <form data-form="account"><label class="field"><span>顯示名稱</span><input name="name" value="${esc(state.name)}" maxlength="20" required></label><div class="form-actions"><button class="btn" type="submit">儲存名稱</button></div></form>
    <div class="form-actions" style="justify-content:flex-start;margin-top:14px">${button(`${icon('settings')}外觀與無障礙`, 'study-settings', '', 'secondary small')}${button(`${icon('compass')}使用指南`, 'navigate', 'data-page="guide"', 'secondary small')}</div>
    <div class="account-footer"><div><small>${isPuter() ? '登出前會先同步一次。' : '登出不會刪除這台裝置上的紀錄。'}</small></div><div>${button(`${icon('logout')}登出`, 'logout', '', 'secondary small')} ${button('清除此裝置紀錄', 'reset', '', 'danger small')}</div></div>`);
};

/* ------------------------------------------------------------------ *
 * Cross-device sync through Puter's per-user, per-app key-value store
 * ------------------------------------------------------------------ */
const syncReady = () => isPuter() && window.puter && window.puter.kv && window.puter.auth.isSignedIn();

async function kvWrite(snapshot) {
  const text = JSON.stringify(snapshot);
  const parts = [];
  for (let index = 0; index < text.length; index += SYNC_CHUNK) parts.push(text.slice(index, index + SYNC_CHUNK));
  for (let index = 0; index < parts.length; index += 1) await window.puter.kv.set(`${SYNC_PREFIX}:${index}`, parts[index]);
  await window.puter.kv.set(`${SYNC_PREFIX}:meta`, JSON.stringify({parts: parts.length, updatedAt: new Date().toISOString(), app: 4}));
}
async function kvRead() {
  const metaText = await window.puter.kv.get(`${SYNC_PREFIX}:meta`);
  if (!metaText) return null;
  const meta = JSON.parse(metaText);
  if (!Number.isInteger(meta.parts) || meta.parts < 1 || meta.parts > 200) return null;
  const parts = [];
  for (let index = 0; index < meta.parts; index += 1) parts.push(await window.puter.kv.get(`${SYNC_PREFIX}:${index}`) || '');
  return JSON.parse(parts.join(''));
}

/* Progress only ever grows when two devices meet: unions for completions, maxima for XP. */
function mergeStates(local, remote) {
  if (!remote || typeof remote !== 'object') return local;
  const union = (a, b) => [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])])];
  const longer = (a, b) => ((Array.isArray(b) ? b : []).length > (Array.isArray(a) ? a : []).length ? b : a);
  const merged = {...remote, ...local};
  merged.name = local.name && local.name !== '學員' ? local.name : (remote.name || local.name);
  merged.lessons = {};
  for (const course of courses) merged.lessons[course.id] = union(local.lessons?.[course.id], remote.lessons?.[course.id]);
  merged.completed = union(remote.completed, local.completed);
  merged.enrolled = union(local.enrolled, remote.enrolled);
  merged.registrations = union(local.registrations, remote.registrations);
  merged.requests = union(local.requests, remote.requests);
  merged.redemptions = longer(local.redemptions, remote.redemptions);
  merged.donations = longer(local.donations, remote.donations);
  merged.events = [...(local.events || []), ...(remote.events || []).filter(item => !(local.events || []).some(own => own.id === item.id))];
  merged.groups = [...(local.groups || []), ...(remote.groups || []).filter(item => !(local.groups || []).some(own => own.id === item.id))];
  merged.messages = {...(remote.messages || {})};
  for (const [room, list] of Object.entries(local.messages || {})) merged.messages[room] = longer(list, merged.messages[room]);
  merged.poll = local.poll ?? remote.poll ?? null;
  merged.publicPortfolio = Boolean(local.publicPortfolio || remote.publicPortfolio);
  merged.leaderboard = Boolean(local.leaderboard || remote.leaderboard);
  const a = local.study || {};
  const b = remote.study || {};
  const maxDays = (x = {}, y = {}) => {
    const out = {...y};
    for (const [day, value] of Object.entries(x)) out[day] = Math.max(value, out[day] || 0);
    return out;
  };
  const cards = {...(b.cards || {})};
  for (const [id, card] of Object.entries(a.cards || {})) {
    const other = cards[id];
    if (!other || (card.reps || 0) > (other.reps || 0) || ((card.reps || 0) === (other.reps || 0) && String(card.due) > String(other.due))) cards[id] = card;
  }
  const mastery = {...(b.mastery || {})};
  for (const [key, entry] of Object.entries(a.mastery || {})) {
    if (!mastery[key] || entry.correct / Math.max(entry.total, 1) >= mastery[key].correct / Math.max(mastery[key].total, 1)) mastery[key] = entry;
  }
  const journalKey = entry => `${entry.date}|${entry.lesson}|${entry.text}`;
  const journal = [...(b.journal || []), ...(a.journal || [])].filter((entry, index, list) => entry && list.findIndex(item => item && journalKey(item) === journalKey(entry)) === index).sort((x, y) => String(x.date).localeCompare(String(y.date)));
  merged.study = {
    ...b,
    ...a,
    dailyGoal: a.goalChosen ? a.dailyGoal : (b.dailyGoal || a.dailyGoal),
    goalChosen: Boolean(a.goalChosen || b.goalChosen),
    xpByDay: maxDays(a.xpByDay, b.xpByDay),
    focusByDay: maxDays(a.focusByDay, b.focusByDay),
    freezes: Math.max(a.freezes || 0, b.freezes || 0),
    frozenDays: union(a.frozenDays, b.frozenDays),
    milestones: union(a.milestones, b.milestones),
    cards,
    mastery,
    journal,
    customCards: {...(b.customCards || {}), ...(a.customCards || {})},
    officialDone: union(a.officialDone, b.officialDone),
    tutorLog: longer(a.tutorLog, b.tutorLog),
    settings: {...(b.settings || {}), ...(a.settings || {})}
  };
  return merged;
}
window.GY_MERGE_STATES = mergeStates;

async function pushNow() {
  if (!syncReady() || syncing) return;
  syncing = true;
  refreshAccountUi();
  try {
    await kvWrite(JSON.parse(JSON.stringify(state)));
    localStorage.setItem(SYNC_TIME_KEY, new Date().toISOString());
    syncError = '';
  } catch (error) {
    syncError = (error && (error.message || error.msg)) || '無法連線到 Puter';
  } finally {
    syncing = false;
    refreshAccountUi();
  }
}
async function pullAndMerge() {
  if (!syncReady()) return;
  try {
    const remote = await kvRead();
    lastPull = Date.now();
    if (remote) {
      await withMutationLock(() => {
        const account = state.account;
        state = normalizeState(mergeStates(state, remote));
        state.signedIn = true;
        state.account = account;
        save();
      });
    }
    syncError = '';
  } catch (error) {
    syncError = (error && (error.message || error.msg)) || '無法讀取雲端進度';
  }
  await pushNow();
}
function schedulePush() {
  if (!isPuter()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => pushNow(), 2500);
}
window.addEventListener('guangyao:saved', schedulePush);
document.addEventListener('visibilitychange', () => {
  if (!isPuter()) return;
  if (document.visibilityState === 'hidden') {
    clearTimeout(syncTimer);
    pushNow();
  } else if (Date.now() - lastPull > 60000) {
    pullAndMerge().then(() => {
      if (!document.querySelector('dialog[open]')) render();
    });
  }
});

/* Restore a Puter session on start-up without blocking the first paint. */
async function resumeSession() {
  if (!isPuter()) return;
  try {
    const sdk = await window.GY_PUTER();
    if (!sdk.auth.isSignedIn()) {
      syncError = 'Puter 登入已過期，請重新登入以同步';
      refreshAccountUi();
      return;
    }
    await pullAndMerge();
    if (!document.querySelector('dialog[open]')) render();
  } catch (error) {
    syncError = (error && error.message) || '無法連線到 Puter';
    refreshAccountUi();
  }
}

/* ------------------------------------------------------------------ *
 * Official materials library (published from the admin console)
 * ------------------------------------------------------------------ */
const formatBytes = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;
const shortDate = iso => iso ? new Date(iso).toLocaleDateString('zh-TW', {month: 'numeric', day: 'numeric'}) : '';
let catalogLoading = false;
let catalogFailed = false;

function materialIcon(material) {
  if (material.kind === 'video') return 'video';
  if (material.kind === 'link') return 'share';
  return /image\//.test(material.mime) ? 'award' : /audio\//.test(material.mime) ? 'speaker' : 'file';
}
function libraryPage() {
  const live = window.GY_CATALOG ? window.GY_CATALOG.live : {lessons: [], materials: [], events: [], settings: {}};
  const done = new Set(study().officialDone);
  const lessonCards = live.lessons.map(lesson => {
    const content = window.GY_LESSONS[`official:${lesson.id}`];
    const badges = [lesson.quiz.length ? `${lesson.quiz.length} 題練習` : '', lesson.video ? '含影片' : '', lesson.materials.length ? `${lesson.materials.length} 份附件` : '', content?.cards.length ? `${content.cards.length} 張閃卡` : ''].filter(Boolean);
    return `<article class="card official-lesson"><div class="card-pad"><div class="section-head"><span class="tag blue">官方教材</span>${done.has(lesson.id) ? `<span class="tag">${icon('check')} 已完成</span>` : ''}</div><h3>${esc(lesson.title)}</h3><p class="muted">${esc(lesson.summary || lesson.reading[0].slice(0, 80))}</p><div class="badges">${badges.map(badge => `<span>${esc(badge)}</span>`).join('')}</div>${button(`${icon('play')}${done.has(lesson.id) ? '再學一次' : '開始學習'}`, 'play-official', `data-id="${esc(lesson.id)}"`, done.has(lesson.id) ? 'secondary' : '')}</div></article>`;
  }).join('');
  const materialRows = live.materials.map(material => {
    const url = window.GY_CATALOG.fileUrl(material);
    const meta = [material.kind === 'file' ? formatBytes(material.size) : material.kind === 'video' ? '影片連結' : '外部連結', shortDate(material.publishedAt) ? `${shortDate(material.publishedAt)} 發布` : ''].filter(Boolean).join(' · ');
    return `<div class="list-row material-row"><span class="stat-symbol">${icon(materialIcon(material))}</span><div style="flex:1;min-width:0"><h3>${esc(material.title)}</h3><p>${esc(material.description || meta)}</p>${material.description ? `<small class="muted">${esc(meta)}</small>` : ''}</div><a class="btn secondary small" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon(material.kind === 'file' ? 'download' : 'arrow')}${material.kind === 'file' ? '開啟' : '前往'}</a></div>`;
  }).join('');
  const empty = !live.lessons.length && !live.materials.length;
  const status = catalogLoading ? '更新中…' : catalogFailed ? '目前離線，顯示上次下載的內容' : live.updatedAt ? `最後更新 ${new Date(live.updatedAt).toLocaleString('zh-TW', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'})}` : '';
  return `${pageHead('官方教材', '由管理員發布的課程單元、講義與影片。新內容約 5 分鐘內出現在所有人的 App。', button(`${icon('refresh')}重新整理`, 'catalog-refresh', catalogLoading ? 'disabled' : '', 'secondary'))}
    ${live.settings.announcement ? `<div class="callout announcement">${icon('bell')} <strong>公告</strong>　${esc(live.settings.announcement)}</div>` : ''}
    ${empty ? `<div class="card empty">${icon('library')}<h3>目前還沒有發布的教材</h3><p>管理員從後台上傳後，課程單元與講義會出現在這裡。在那之前，可以先上「探索課程」的入門單元。</p>${navButton('去探索課程', 'courses')}</div>` : ''}
    ${live.lessons.length ? `<div class="section-head"><h2>課程單元</h2><small class="muted">${live.lessons.length} 個單元</small></div><div class="three-col">${lessonCards}</div>` : ''}
    ${live.materials.length ? `<section class="card card-pad space-top"><div class="section-head"><h2>講義與資源</h2><small class="muted">${live.materials.length} 份</small></div>${materialRows}<p class="muted" style="font-size:11px;margin-top:10px">檔案由內容庫公開提供；每次發布都有版本紀錄。AI 學伴會參考管理員為教材提供的重點說明。</p></section>` : ''}
    <p class="muted" style="font-size:11px;margin-top:12px">${esc(status)}</p>`;
}
async function refreshCatalog(fresh) {
  if (!window.GY_CATALOG || catalogLoading) return;
  catalogLoading = true;
  if (location.hash === '#library') render();
  try {
    await window.GY_CATALOG.refresh({fresh});
    catalogFailed = false;
  } catch {
    catalogFailed = true;
  } finally {
    catalogLoading = false;
  }
  // Content changes re-render through the guangyao:catalog event; only the library's status line needs a refresh here.
  if (location.hash === '#library' && !document.querySelector('dialog[open]')) render();
}
document.addEventListener('guangyao:catalog', () => {
  if (!document.querySelector('dialog[open]')) render();
});

/* Home: announcement plus newest official lessons above the hero. */
const homeBeforeAccounts = homePage;
homePage = function homeWithOfficial() {
  const html = homeBeforeAccounts();
  const live = window.GY_CATALOG ? window.GY_CATALOG.live : null;
  if (!live || (!live.lessons.length && !live.settings.announcement && !live.materials.length)) return html;
  const fresh = live.lessons.slice(0, 3).map(lesson => `<button type="button" class="new-lesson" data-action="play-official" data-id="${esc(lesson.id)}">${icon('play')}<span><strong>${esc(lesson.title)}</strong><small>${study().officialDone.includes(lesson.id) ? '已完成 · 再複習一次' : '官方教材 · 約 5 分鐘'}</small></span></button>`).join('');
  const strip = `<section class="official-strip card card-pad">${live.settings.announcement ? `<p class="announcement-line">${icon('bell')} ${esc(live.settings.announcement)}</p>` : ''}<div class="section-head"><h2>${icon('library')} 最新官方教材</h2>${navButton(`全部教材 ${icon('arrow')}`, 'library', 'ghost')}</div>${fresh ? `<div class="new-lessons">${fresh}</div>` : `<p class="muted">${live.materials.length} 份講義與資源已發布。</p>`}</section>`;
  return html.replace('<section class="hero"', `${strip}<section class="hero"`);
};

/* Courses page points to official lessons when there are any. */
const coursesBeforeAccounts = coursesPage;
coursesPage = function coursesWithOfficial() {
  const html = coursesBeforeAccounts();
  const count = window.GY_CATALOG ? window.GY_CATALOG.live.lessons.length : 0;
  const banner = count
    ? `<div class="callout">${icon('library')} 有 <strong>${count}</strong> 個管理員發布的官方教材單元。${navButton('前往官方教材', 'library', 'small')}</div>`
    : `<div class="callout">以下是入門示範課程，用來體驗學習流程；管理員發布的正式教材會出現在「官方教材」。</div>`;
  return html.replace('<div class="filters">', `${banner}<div class="filters">`);
};

/* ------------------------------------------------------------------ *
 * Usage guide
 * ------------------------------------------------------------------ */
function guidePage() {
  const step = (number, title, body) => `<div class="guide-step"><span class="guide-number">${number}</span><div><h3>${title}</h3><p>${body}</p></div></div>`;
  const faq = [
    ['訪客的進度會不見嗎？', '訪客進度存在這台裝置的瀏覽器裡。清除瀏覽器資料或換手機就看不到了。登入後，目前的進度會一起保存到帳戶。'],
    ['Puter 是什麼？要付錢嗎？', 'Puter 是提供登入、雲端儲存與 AI 的第三方服務，註冊免費，用 Email 就能建立帳號。AI 學伴使用你帳戶的免費額度。'],
    ['AI 學伴會不會亂講？', '光光被要求只根據課程與教材回答並標出處，找不到會直接說不知道。AI 仍可能出錯，請以教材與老師說明為準。'],
    ['可以離線使用嗎？', '安裝成 App 後，課程、複習與離線學伴在沒有網路時也能用；AI 學伴、同步與新教材需要網路。'],
    ['我是管理員，要怎麼上傳教材？', '從頁尾或歡迎畫面點「管理員登入」，用 GitHub 權杖登入後台。後台有逐步說明。']
  ];
  return `${pageHead('使用指南', '三分鐘看懂光耀同行：怎麼開始、每天怎麼學、怎麼用 AI 學伴。')}
    <div class="two-col guide"><section>
      <section class="card card-pad"><h2>${icon('user')} 1. 開始使用：登入或訪客</h2>
        ${step(1, '打開光耀同行', '用手機或電腦的瀏覽器開啟網址。建議先「安裝 App」，之後從主畫面一鍵開啟（見下方第 4 節）。')}
        ${step(2, '選擇「登入 / 建立帳號」或「以訪客身分繼續」', '登入使用免費 Puter 帳號：進度跨裝置同步，並解鎖 AI 學伴。訪客不用註冊，進度只存在這台裝置。')}
        ${step(3, '隨時可以改變', '訪客之後按右上角的名字 →「登入保存進度」，目前的進度會一起帶進帳戶。')}
      </section>
      <section class="card card-pad space-top"><h2>${icon('book')} 2. 每天這樣學（約 10 分鐘）</h2>
        ${step(1, '看「今日目標」', '在「我的總覽」選一個做得到的每日目標（10、20 或 30 XP）。連續學習會累積天數，每連續 7 天送一個「連續保護」。')}
        ${step(2, '上一堂課', '到「官方教材」或「探索課程」按「開始學習」：閱讀（可朗讀）→ 選擇題 → 填空／排序 → 寫一句心得。答錯沒關係，沒有生命值限制。')}
        ${step(3, '每日複習', '學過的重點會變成閃卡。「每日複習」按空白鍵翻面，用 1–4 評分；系統會在你快忘記時再提醒。')}
        ${step(4, '看見自己的進步', '「學習數據」有 12 週熱度圖、熟練度與心得筆記，也能做成分享卡。')}
      </section>
      <section class="card card-pad space-top"><h2>${icon('spark')} 3. AI 學伴「光光」</h2>
        ${step(1, '問問題', '用自己的話問課程內容，光光會回答並標出〈出處〉。可以在「提問範圍」選特定單元或教材。')}
        ${step(2, '請它考你', '按「考考我」，回答後光光會批改；卡住時按「給我提示」，它會先給線索、不直接說答案。')}
        ${step(3, '排計畫、做閃卡', '按「幫我排今天的學習計畫」或「整理成閃卡」，新閃卡會自動加入每日複習。')}
        <div class="callout">訪客使用<strong>離線學伴</strong>（只比對課程內容、不傳送資料）。登入後使用<strong>AI 學伴</strong>：問題與相關摘錄會送到 Puter 的 AI 服務處理，請勿輸入敏感個資。</div>
      </section>
      <section class="card card-pad space-top"><h2>${icon('download')} 4. 安裝到手機</h2>
        ${step('iPhone', 'Safari', '開啟網址 → 分享按鈕 → 「加入主畫面」。')}
        ${step('Android', 'App', `<a href="https://github.com/juw12/projects/releases/download/guangyao-android/GuangYao-android.apk" target="_blank" rel="noopener">下載 Android App（APK）</a>，開啟後允許安裝；或用 Chrome 選單「⋮」→「安裝應用程式」。`)}
        ${step('電腦', 'Chrome / Edge', '網址列右側的安裝圖示，或頁面上方的「安裝 App」。')}
      </section>
    </section>
    <aside>
      <section class="card card-pad"><h2>常見問題</h2>${faq.map(([question, answer]) => `<details class="faq"><summary>${question}</summary><p>${answer}</p></details>`).join('')}</section>
      <section class="card card-pad space-top"><h2>${icon('shield')} 管理員</h2><p class="muted" style="font-size:13px">管理員從專屬後台上傳講義、建立課程單元與練習題、發布活動公告。發布後約 5 分鐘內出現在所有人的 App。</p><a class="btn secondary" href="admin.html">管理員登入 ${icon('arrow')}</a></section>
      <section class="card card-pad space-top"><h2>隱私與資料</h2><ul class="install-steps"><li>訪客資料只在這台裝置。</li><li>登入後，學習進度存放在你自己的 Puter 帳戶。</li><li>教材內容庫是公開的，不放個人資料。</li><li>積分、善行寶庫、社群聊天目前是示範功能，不涉及真實金流或訊息。</li></ul></section>
      ${state.signedIn ? '' : `<div class="space-top">${button(`開始使用 ${icon('arrow')}`, 'navigate', 'data-page="home"', 'gold wide')}</div>`}
    </aside></div>`;
}

/* ------------------------------------------------------------------ *
 * First-run tour
 * ------------------------------------------------------------------ */
let tourStep = 0;
const TOUR = [
  () => `<div class="tour-hero">${icon('sun')}</div><h2>歡迎，${esc(state.name)}！</h2><p>先告訴我們怎麼稱呼你（之後可以在帳戶裡修改）。</p><form data-form="tour-name"><label class="field"><span>顯示名稱</span><input name="name" value="${esc(state.name)}" maxlength="20" required></label><div class="form-actions">${button('略過導覽', 'tour-skip', '', 'ghost')}<button class="btn" type="submit">下一步 ${icon('arrow')}</button></div></form>`,
  () => `<div class="tour-hero">${icon('book')}</div><h2>每天十分鐘就好</h2><ol class="tour-list"><li><strong>今日目標</strong>：選一個做得到的節奏。</li><li><strong>上一堂課</strong>：閱讀、練習、寫一句心得。</li><li><strong>每日複習</strong>：在快忘記時複習，記得最久。</li></ol>`,
  () => `<div class="tour-hero">${icon('spark')}</div><h2>AI 學伴「光光」</h2><p>${isPuter() ? '你已登入，可以自由提問、請光光出題批改、排學習計畫或做閃卡。課程問題會標出處。' : '訪客可使用離線學伴（有出處的課程問答）。登入免費 Puter 帳號即可解鎖完整 AI 學伴與跨裝置同步。'}</p>`,
  () => `<div class="tour-hero">${icon('download')}</div><h2>裝到手機，隨時學</h2><p>iPhone 用 Safari「加入主畫面」；Android 用 Chrome「安裝應用程式」。完整說明都在「使用指南」。</p>`
];
function renderTour() {
  const last = tourStep === TOUR.length - 1;
  const footer = tourStep === 0 ? '' : `<div class="form-actions">${button('略過', 'tour-skip', '', 'ghost')}${last ? button(`開始學習 ${icon('arrow')}`, 'tour-skip', 'data-finish="1"', 'gold') : button(`下一步 ${icon('arrow')}`, 'tour-next')}</div>`;
  modal('快速導覽', `<div class="tour"><div class="tour-dots">${TOUR.map((_, index) => `<i class="${index === tourStep ? 'on' : ''}"></i>`).join('')}</div>${TOUR[tourStep]()}${footer}</div>`);
}
function maybeStartTour() {
  if (localStorage.getItem(TOUR_KEY)) return;
  tourStep = 0;
  renderTour();
}
function finishTour(goGuide) {
  localStorage.setItem(TOUR_KEY, new Date().toISOString());
  closeModal();
  if (goGuide) navigate('guide');
}

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */
document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  const action = target.dataset.action;
  if (action === 'account-pill') {
    accountModal();
  } else if (action === 'puter-signin') {
    puterSignIn();
  } else if (action === 'guest-start') {
    closeModal();
    startAsGuest();
  } else if (action === 'sync-now') {
    pullAndMerge().then(() => {
      if (document.querySelector('#modal[open]')) accountModal();
      toast(syncError ? `同步失敗：${syncError}` : '已同步。');
    });
  } else if (action === 'catalog-refresh') {
    refreshCatalog(true).then(() => toast(catalogFailed ? '目前無法連線，顯示上次下載的內容。' : '教材已是最新。'));
  } else if (action === 'tour-next') {
    tourStep = Math.min(tourStep + 1, TOUR.length - 1);
    renderTour();
  } else if (action === 'tour-skip') {
    finishTour(false);
  }
});
document.addEventListener('submit', event => {
  const form = event.target.closest('[data-form="tour-name"]');
  if (!form) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const name = String(new FormData(form).get('name') || '').trim().slice(0, 20);
  withMutationLock(() => {
    if (name) state.name = name;
    save();
    render();
  }).then(() => {
    tourStep = 1;
    renderTour();
  });
}, true);

window.GY_PAGES = {...(window.GY_PAGES || {}), library: libraryPage, guide: guidePage};
window.GY_ACCOUNT = {mergeStates, pushNow, pullAndMerge, refreshCatalog, isPuter, startAsGuest};

document.addEventListener('DOMContentLoaded', () => {
  updateStatusBar();
  refreshCatalog(false);
  resumeSession();
  setInterval(() => {
    if (document.visibilityState === 'visible') refreshCatalog(false);
  }, 5 * 60 * 1000);
});
