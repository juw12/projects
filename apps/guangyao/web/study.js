/* 光耀同行 v3 study engine.
 * Interactive lessons, spaced repetition, streaks and daily goals, a source-grounded study buddy,
 * focus sessions, analytics, accessibility settings, calendar export and shareable progress cards.
 * Classic script loaded with `defer`: it shares the page's global bindings (state, render, modal…)
 * and registers before the first render. All learning content is illustrative sample material,
 * not official 發一光耀 teaching.
 */
'use strict';

/* ------------------------------------------------------------------ *
 * Sample lesson content (one entry per course lesson)
 * ------------------------------------------------------------------ */
const LESSON_CONTENT = {
  'foundation:0': {
    reading: [
      '學習的第一步，不是急著讀完，而是先問自己：「我希望從這次學習帶走什麼？」把期待寫下來，學習就有了方向。',
      '學習不是比賽，而是成長的旅程。每個人的起點和步調都不同，不需要和別人比較進度。',
      '一個簡單的習慣是：開始前寫下期待，學習時專心投入，結束後記錄一句心得。'
    ],
    summary: '先寫下期待，再專心學習，最後記錄心得；學習是成長的旅程，不是比賽。',
    mcq: {question: '設定學習方向時，第一步最適合做什麼？', options: ['先問自己希望帶走什麼', '先和別人比較進度', '一次讀完所有課程'], answer: 0, explain: '先釐清自己的期待，學習才有方向；比較進度容易讓人焦慮。'},
    cloze: {before: '學習不是比賽，而是', after: '的旅程。', answers: ['成長'], explain: '課文提到：學習不是比賽，而是成長的旅程。'},
    order: {prompt: '排出建議的學習習慣順序', items: ['寫下期待', '專心投入', '記錄心得'], explain: '開始前寫期待、過程中專心、結束後記錄。'},
    reflect: '這次學習，你最希望帶走的一件事是什麼？',
    cards: [
      ['開始學習前，先問自己什麼？', '我希望從這次學習帶走什麼。'],
      ['學習是比賽嗎？', '不是，學習是成長的旅程，不需要比較進度。'],
      ['建議的三步學習習慣？', '寫下期待 → 專心投入 → 記錄心得。']
    ]
  },
  'foundation:1': {
    reading: [
      '好的交流從傾聽開始：先聽完，再回應。急著給建議，常常讓對方覺得沒有被聽見。',
      '回應之前，可以先用一句話確認對方的意思，例如：「你的意思是……對嗎？」',
      '尊重也包括保護隱私：別人信任你而分享的故事，未經同意不轉述給他人。'
    ],
    summary: '先聽完再回應，用一句話確認理解，並保護對方分享的隱私。',
    mcq: {question: '朋友正在分享心事，哪個做法最尊重對方？', options: ['先聽完，再回應', '立刻給出建議', '一邊滑手機一邊聽'], answer: 0, explain: '先完整傾聽，對方才會感到被理解。'},
    cloze: {before: '回應之前，先用一句話', after: '對方的意思。', answers: ['確認', '確認一下'], explain: '確認理解能避免誤會，例如：「你的意思是……對嗎？」'},
    order: {prompt: '排出尊重交流的順序', items: ['專心聆聽', '確認理解', '尊重回應'], explain: '先聽、再確認、最後回應。'},
    reflect: '最近一次被好好傾聽，是什麼感覺？',
    cards: [
      ['交流時，回應之前應該先做什麼？', '先聽完，並用一句話確認對方的意思。'],
      ['別人分享的私人故事可以轉述嗎？', '未經同意不轉述，這是尊重與保護隱私。']
    ]
  },
  'foundation:2': {
    reading: [
      '善意不必轟轟烈烈。一句問候、一次讓座、一則真誠的感謝，都是把善意放進日常。',
      '善意不在大小，而在於持續。每天一件小事，比偶爾一件大事更能改變習慣。',
      '做完之後記錄行動與感受，不是為了比較，而是看見自己的成長。'
    ],
    summary: '從小事開始，持續比規模更重要；記錄是為了看見成長，不是比較。',
    mcq: {question: '關於日常善意，哪一句最符合課文？', options: ['善意不在大小，而在於持續', '只有大型活動才算善行', '善行要公開比較才有意義'], answer: 0, explain: '持續的小行動比偶爾的大事更能培養習慣。'},
    cloze: {before: '善意不在大小，而在於', after: '。', answers: ['持續', '堅持'], explain: '課文強調持續：每天一件小事。'},
    order: {prompt: '排出一次日常善行的步驟', items: ['選一件小事', '真誠去做', '記錄感受'], explain: '選擇、行動、記錄。'},
    reflect: '今天你做得到的一件小善事是什麼？',
    cards: [
      ['日常善意的關鍵是什麼？', '不在大小，而在於持續。'],
      ['為什麼要記錄善行？', '為了看見自己的成長，不是為了比較。']
    ]
  },
  'practice:0': {
    reading: [
      '幫助別人之前，先看見真正的需要。觀察與傾聽，比自己的想像更準確。',
      '先詢問，再協助：「需要我幫忙嗎？」尊重對方的選擇，也保護對方的尊嚴。',
      '有時候最好的幫助，是陪伴與傾聽，而不是替對方做決定。'
    ],
    summary: '先觀察與詢問，再提供協助；尊重對方的選擇與尊嚴。',
    mcq: {question: '看到長輩提著重物，最合適的第一步是？', options: ['先詢問是否需要幫忙', '直接拿走對方的東西', '拍照分享到社群'], answer: 0, explain: '先詢問能尊重對方的意願與尊嚴。'},
    cloze: {before: '先', after: '，再協助。', answers: ['詢問', '問'], explain: '課文原則：先詢問，再協助。'},
    order: {prompt: '排出協助他人的順序', items: ['觀察需要', '詢問意願', '提供協助'], explain: '觀察 → 詢問 → 協助。'},
    reflect: '你身邊有沒有一個被忽略的需要？',
    cards: [
      ['協助別人之前要先做什麼？', '先觀察並詢問：「需要我幫忙嗎？」'],
      ['最好的幫助一定是替對方做事嗎？', '不一定，陪伴與傾聽也是重要的幫助。']
    ]
  },
  'practice:1': {
    reading: [
      '為行動留下紀錄時，要真實、不誇大。寫下做了什麼、花了多少時間、遇到什麼困難。',
      '保護被協助者的隱私：未經同意，不拍攝、不公開對方的姓名或照片。',
      '真實的紀錄讓團隊能改進，也讓支持者信任每一份投入。'
    ],
    summary: '紀錄要真實不誇大，並在取得同意前不公開被協助者的資訊。',
    mcq: {question: '記錄服務行動時，哪個做法正確？', options: ['如實記錄，未經同意不公開對方照片', '把成果寫得越誇張越好', '拍下受助者照片立即公開'], answer: 0, explain: '真實與尊重隱私，才能建立信任。'},
    cloze: {before: '未經', after: '，不拍攝、不公開對方的照片。', answers: ['同意', '對方同意'], explain: '取得同意是保護隱私的基本原則。'},
    order: {prompt: '排出一份好紀錄的內容', items: ['做了什麼', '花了多少時間', '遇到的困難'], explain: '事實、投入、困難與學習。'},
    reflect: '如果要記錄今天的一件事，你會怎麼寫才真實？',
    cards: [
      ['服務紀錄最重要的原則？', '真實、不誇大。'],
      ['可以公開受助者照片嗎？', '未經同意不拍攝、不公開。']
    ]
  },
  'practice:2': {
    reading: [
      '服務之後，花幾分鐘反思：哪裡做得好？哪裡可以改進？我學到了什麼？',
      '分享心得時，重點放在學習與感謝，而不是誇耀自己。',
      '反思讓每一次行動都成為下一次更好的起點。'
    ],
    summary: '用三個問題反思：做得好、可改進、學到什麼；分享時重學習與感謝。',
    mcq: {question: '分享服務心得時，最好把重點放在哪裡？', options: ['學習與感謝', '自己做了多少', '和別人比較'], answer: 0, explain: '聚焦學習與感謝，分享才能鼓勵彼此。'},
    cloze: {before: '反思讓每一次行動都成為下一次更好的', after: '。', answers: ['起點', '開始'], explain: '反思把經驗轉為下一次的起點。'},
    order: {prompt: '排出三個反思問題', items: ['哪裡做得好', '哪裡可改進', '我學到什麼'], explain: '先肯定、再改進、最後學習。'},
    reflect: '回想一次服務經驗，你學到了什麼？',
    cards: [
      ['服務後的三個反思問題？', '哪裡做得好？哪裡可改進？我學到什麼？'],
      ['分享心得的重點？', '學習與感謝，而不是誇耀自己。']
    ]
  },
  'lead:0': {
    reading: [
      '規劃活動時，先寫清楚目標：為誰、為什麼、希望帶來什麼改變。',
      '分工要明確：誰負責報名、場地、物資與聯絡；每項工作都有負責人與時程。',
      '預算公開透明，讓參與者知道每一筆費用的用途。'
    ],
    summary: '先定目標，再明確分工與時程，並公開預算用途。',
    mcq: {question: '規劃活動時，最先要確定的是？', options: ['活動目標', '海報顏色', '合照姿勢'], answer: 0, explain: '目標決定了分工、預算與成功的標準。'},
    cloze: {before: '預算公開', after: '，讓參與者知道費用用途。', answers: ['透明'], explain: '透明的預算能建立信任。'},
    order: {prompt: '排出活動規劃步驟', items: ['確定目標', '明確分工', '公開預算'], explain: '目標 → 分工 → 預算透明。'},
    reflect: '如果由你規劃一場活動，你最想解決什麼需要？',
    cards: [
      ['活動規劃的第一步？', '寫清楚目標：為誰、為什麼、帶來什麼改變。'],
      ['為什麼預算要公開？', '讓參與者知道費用用途，建立信任。']
    ]
  },
  'lead:1': {
    reading: [
      '每場活動都需要安全計畫：集合地點、緊急聯絡人與應變流程。',
      '拍照或錄影前，先取得參與者同意；不願入鏡的人應被尊重。',
      '互相照顧也包括包容：讓不同年齡、體能與背景的人都能安心參與。'
    ],
    summary: '準備安全計畫、取得拍攝同意，並讓每個人都能安心參與。',
    mcq: {question: '活動要拍照記錄時，應該怎麼做？', options: ['先取得參與者同意', '直接拍下所有人', '拍完再說'], answer: 0, explain: '同意是尊重，不願入鏡的人應被保護。'},
    cloze: {before: '每場活動都需要', after: '計畫與緊急聯絡人。', answers: ['安全'], explain: '安全計畫包括集合地點、聯絡人與應變流程。'},
    order: {prompt: '排出活動前的安全準備', items: ['確認集合地點', '指定緊急聯絡人', '說明應變流程'], explain: '地點、聯絡人、流程。'},
    reflect: '怎樣讓一位第一次參加的人感到安心？',
    cards: [
      ['活動安全計畫包含哪些？', '集合地點、緊急聯絡人與應變流程。'],
      ['拍照前要做什麼？', '先取得參與者同意。']
    ]
  },
  'lead:2': {
    reading: [
      '帶領討論時，邀請較安靜的人發言，讓每個聲音都被聽見。',
      '設定時間，避免討論失焦；必要時把延伸話題記下，之後再談。',
      '結束前整理共識與行動：誰、在什麼時候、完成什麼。'
    ],
    summary: '邀請每個人發言、控制時間，最後整理共識與行動分工。',
    mcq: {question: '討論結束前，帶領者最應該做什麼？', options: ['整理共識與行動分工', '宣布誰說得最好', '直接散會'], answer: 0, explain: '明確的行動讓討論真正產生改變。'},
    cloze: {before: '邀請較', after: '的人發言，讓每個聲音都被聽見。', answers: ['安靜', '沉默'], explain: '主動邀請，讓參與更平衡。'},
    order: {prompt: '排出帶領討論的流程', items: ['邀請發言', '控制時間', '整理行動'], explain: '開放、聚焦、收斂。'},
    reflect: '你曾參與過最有收穫的討論，帶領者做了什麼？',
    cards: [
      ['帶領討論如何讓參與更平衡？', '主動邀請較安靜的人發言。'],
      ['討論結束前要整理什麼？', '共識與行動：誰、何時、完成什麼。']
    ]
  }
};
window.GY_LESSONS = LESSON_CONTENT;

/* ------------------------------------------------------------------ *
 * Dates, ids and study-state normalisation
 * ------------------------------------------------------------------ */
const XP = {lesson: 10, perfect: 5, review: 1, focusPerFiveMinutes: 1, reflection: 2};
const GOALS = [
  {xp: 10, label: '輕鬆', minutes: '約 5 分鐘'},
  {xp: 20, label: '穩定', minutes: '約 10 分鐘'},
  {xp: 30, label: '認真', minutes: '約 15 分鐘'}
];
const HISTORY_DAYS = 400;

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function today() {
  const override = window.GY_TEST_TODAY;
  return typeof override === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(override) ? override : dateKey(new Date());
}
function addDays(key, days) {
  const [year, month, day] = key.split('-').map(Number);
  return dateKey(new Date(year, month - 1, day + days));
}
function daysBetween(fromKey, toKey) {
  const [a, b] = [fromKey, toKey].map(key => {
    const [year, month, day] = key.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  });
  return Math.round((b - a) / 86400000);
}
const isDateKey = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const lessonKey = (courseId, index) => `${courseId}:${index}`;
const lessonTitle = key => {
  const [courseId, index] = key.split(':');
  const course = courses.find(item => item.id === courseId);
  return course ? course.lessons[Number(index)] : key;
};
const cardIdsFor = key => (LESSON_CONTENT[key]?.cards || []).map((_, index) => `${key}#${index}`);

function freshCard(day) {
  return {due: day, interval: 0, ease: 2.5, reps: 0, lapses: 0};
}

function defaultStudy() {
  return {
    dailyGoal: 20,
    goalChosen: false,
    xpByDay: {},
    freezes: 0,
    frozenDays: [],
    milestones: [],
    cards: {},
    mastery: {},
    focusByDay: {},
    journal: [],
    tutorLog: [],
    settings: {theme: 'system', textSize: 'normal', speechRate: 1, aiOptIn: false}
  };
}

/* Called by the page's strict normaliser for every load (also before this file existed). */
function normalizeStudyState(raw, root) {
  const study = defaultStudy();
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const day = today();
  const earliest = addDays(day, -HISTORY_DAYS);
  if (GOALS.some(goal => goal.xp === source.dailyGoal)) study.dailyGoal = source.dailyGoal;
  study.goalChosen = source.goalChosen === true;
  for (const [key, value] of Object.entries(source.xpByDay || {})) {
    if (isDateKey(key) && key >= earliest && key <= day && Number.isInteger(value) && value > 0 && value <= 2000) study.xpByDay[key] = value;
  }
  for (const [key, value] of Object.entries(source.focusByDay || {})) {
    if (isDateKey(key) && key >= earliest && key <= day && Number.isInteger(value) && value > 0 && value <= 1440) study.focusByDay[key] = value;
  }
  study.freezes = Number.isInteger(source.freezes) ? Math.min(Math.max(source.freezes, 0), 2) : 0;
  study.frozenDays = [...new Set((Array.isArray(source.frozenDays) ? source.frozenDays : []).filter(key => isDateKey(key) && key >= earliest && key < day))].slice(-30);
  study.milestones = [...new Set((Array.isArray(source.milestones) ? source.milestones : []).filter(value => Number.isInteger(value) && value > 0 && value <= 5000))].slice(-50);
  const validCards = new Set(Object.keys(LESSON_CONTENT).flatMap(cardIdsFor));
  for (const [id, card] of Object.entries(source.cards || {})) {
    if (!validCards.has(id) || !card || typeof card !== 'object') continue;
    study.cards[id] = {
      due: isDateKey(card.due) ? card.due : day,
      interval: Number.isInteger(card.interval) && card.interval >= 0 && card.interval <= 3650 ? card.interval : 0,
      ease: typeof card.ease === 'number' && card.ease >= 1.3 && card.ease <= 3.5 ? Math.round(card.ease * 100) / 100 : 2.5,
      reps: Number.isInteger(card.reps) && card.reps >= 0 && card.reps <= 1000 ? card.reps : 0,
      lapses: Number.isInteger(card.lapses) && card.lapses >= 0 && card.lapses <= 1000 ? card.lapses : 0
    };
  }
  for (const [key, entry] of Object.entries(source.mastery || {})) {
    if (!LESSON_CONTENT[key] || !entry || typeof entry !== 'object') continue;
    const total = Number.isInteger(entry.total) ? Math.min(Math.max(entry.total, 0), 3) : 0;
    const correct = Number.isInteger(entry.correct) ? Math.min(Math.max(entry.correct, 0), total) : 0;
    if (total > 0) study.mastery[key] = {correct, total};
  }
  // Every studied lesson contributes its flashcards, including lessons finished before v3.
  const lessons = root?.lessons || {};
  for (const course of courses) {
    for (const index of lessons[course.id] || []) {
      for (const id of cardIdsFor(lessonKey(course.id, index))) {
        if (!study.cards[id]) study.cards[id] = freshCard(day);
      }
    }
  }
  study.journal = (Array.isArray(source.journal) ? source.journal : []).filter(entry => entry && isDateKey(entry.date) && LESSON_CONTENT[entry.lesson] && typeof entry.text === 'string').slice(-100).map(entry => ({date: entry.date, lesson: entry.lesson, text: entry.text.slice(0, 500)}));
  applyFreezesTo(study, day);
  study.tutorLog = (Array.isArray(source.tutorLog) ? source.tutorLog : []).filter(entry => entry && ['user', 'tutor'].includes(entry.role) && typeof entry.text === 'string').slice(-40).map(entry => ({role: entry.role, text: entry.text.slice(0, 1200), source: typeof entry.source === 'string' ? entry.source.slice(0, 80) : '', mode: entry.mode === 'cloud' ? 'cloud' : 'local'}));
  const settings = source.settings || {};
  if (['system', 'light', 'dark'].includes(settings.theme)) study.settings.theme = settings.theme;
  if (['normal', 'large', 'xl'].includes(settings.textSize)) study.settings.textSize = settings.textSize;
  if ([0.8, 1, 1.2].includes(settings.speechRate)) study.settings.speechRate = settings.speechRate;
  study.settings.aiOptIn = settings.aiOptIn === true;
  return study;
}
window.normalizeStudyState = normalizeStudyState;
state.study = normalizeStudyState(state.study, state);
const study = () => {
  if (!state.study) state.study = normalizeStudyState(null, state);
  return state.study;
};

/* ------------------------------------------------------------------ *
 * XP, streaks, freezes
 * ------------------------------------------------------------------ */
function activeDay(key) {
  return (study().xpByDay[key] || 0) > 0 || study().frozenDays.includes(key);
}
function currentStreak() {
  let cursor = today();
  if (!activeDay(cursor)) cursor = addDays(cursor, -1);
  let streak = 0;
  while (activeDay(cursor) && streak < HISTORY_DAYS) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}
function longestStreak() {
  const keys = [...new Set([...Object.keys(study().xpByDay), ...study().frozenDays])].sort();
  let best = 0;
  let run = 0;
  let previous = null;
  for (const key of keys) {
    run = previous && daysBetween(previous, key) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = key;
  }
  return best;
}
/* Deterministic and idempotent: fills a short gap before today with freezes, like an automatic streak shield. */
function applyFreezesTo(data, day = today()) {
  const previous = [...Object.keys(data.xpByDay), ...data.frozenDays].filter(key => key < day).sort().pop();
  if (!previous) return 0;
  const missed = daysBetween(previous, day) - 1;
  if (missed < 1 || missed > data.freezes) return 0;
  for (let offset = 1; offset <= missed; offset += 1) data.frozenDays.push(addDays(previous, offset));
  data.freezes -= missed;
  return missed;
}
function applyFreezes() {
  return applyFreezesTo(study());
}
/* Must run inside withMutationLock. Returns a short celebration message or ''. */
function awardXp(amount) {
  const data = study();
  const used = applyFreezes();
  const day = today();
  const before = data.xpByDay[day] || 0;
  data.xpByDay[day] = Math.min(before + amount, 2000);
  const messages = [];
  if (used) messages.push(`已自動使用 ${used} 個連續保護，連續紀錄沒有中斷。`);
  if (before < data.dailyGoal && data.xpByDay[day] >= data.dailyGoal) messages.push('🎯 今日目標達成！');
  const streak = currentStreak();
  if (streak > 0 && streak % 7 === 0 && !data.milestones.includes(streak)) {
    data.milestones.push(streak);
    if (data.freezes < 2) {
      data.freezes += 1;
      messages.push(`🔥 連續 ${streak} 天！獲得 1 個連續保護。`);
    } else {
      messages.push(`🔥 連續 ${streak} 天！`);
    }
  }
  return messages.join(' ');
}
const xpToday = () => study().xpByDay[today()] || 0;
function xpThisWeek() {
  let total = 0;
  for (let offset = 0; offset < 7; offset += 1) total += study().xpByDay[addDays(today(), -offset)] || 0;
  return total;
}
const dueCards = () => Object.entries(study().cards).filter(([, card]) => card.due <= today()).map(([id]) => id);

/* ------------------------------------------------------------------ *
 * Spaced repetition (simplified SM-2)
 * ------------------------------------------------------------------ */
function scheduleCard(card, rating) {
  const next = {...card};
  if (rating === 'again') {
    next.reps = 0;
    next.lapses += 1;
    next.interval = 0;
    next.ease = Math.max(1.3, next.ease - 0.2);
  } else if (rating === 'hard') {
    next.interval = Math.max(1, Math.round(Math.max(next.interval, 1) * 1.2));
    next.ease = Math.max(1.3, next.ease - 0.15);
    next.reps += 1;
  } else if (rating === 'good') {
    next.interval = next.reps === 0 ? 1 : next.reps === 1 ? 3 : Math.round(next.interval * next.ease);
    next.reps += 1;
  } else {
    next.interval = next.reps === 0 ? 3 : Math.round(Math.max(next.interval, 1) * next.ease * 1.3);
    next.ease = Math.min(3.5, next.ease + 0.15);
    next.reps += 1;
  }
  next.interval = Math.min(next.interval, 3650);
  next.ease = Math.round(next.ease * 100) / 100;
  next.due = addDays(today(), next.interval);
  return next;
}
function previewInterval(card, rating) {
  const days = scheduleCard(card, rating).interval;
  return days === 0 ? '今天' : `${days} 天`;
}
function cardContent(id) {
  const [key, index] = id.split('#');
  const [front, back] = LESSON_CONTENT[key].cards[Number(index)];
  return {key, front, back};
}

/* ------------------------------------------------------------------ *
 * Icons, settings and theme
 * ------------------------------------------------------------------ */
Object.assign(paths, {
  layers: '<path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 13 9 5 9-5"/>',
  spark: '<path d="M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/><circle cx="12" cy="12" r="2"/>',
  flame: '<path d="M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-4 5-4 7-1-1-2-2-2-4-2 2-3 5-3 9 0 4 3 7 7 7Z"/>',
  speaker: '<path d="M4 9h4l5-4v14l-5-4H4Z"/><path d="M17 9a4 4 0 0 1 0 6m2-9a8 8 0 0 1 0 12"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12a7 7 0 0 0 .1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6A7 7 0 0 0 19 12Z"/>',
  snow: '<path d="M12 2v20M4 6l16 12M4 18 20 6"/>'
});

const themeQuery = window.matchMedia('(prefers-color-scheme: dark)');
function applyAppearance() {
  const settings = study().settings;
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && themeQuery.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.text = settings.textSize;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f1f1d' : '#183e3c');
}
themeQuery.addEventListener('change', applyAppearance);
document.addEventListener('guangyao:render', applyAppearance);
applyAppearance();

function settingsModal() {
  const settings = study().settings;
  const option = (name, value, label, current) => `<label class="choice"><input type="radio" name="${name}" value="${value}" ${current === value ? 'checked' : ''}><span>${label}</span></label>`;
  modal('外觀與無障礙', `<form data-form="study-settings">
    <fieldset class="choice-group"><legend>主題</legend>${option('theme', 'system', '跟隨裝置', settings.theme)}${option('theme', 'light', '淺色', settings.theme)}${option('theme', 'dark', '深色', settings.theme)}</fieldset>
    <fieldset class="choice-group"><legend>文字大小</legend>${option('textSize', 'normal', '標準', settings.textSize)}${option('textSize', 'large', '大字', settings.textSize)}${option('textSize', 'xl', '特大', settings.textSize)}</fieldset>
    <fieldset class="choice-group"><legend>朗讀速度</legend>${option('speechRate', '0.8', '慢', String(settings.speechRate))}${option('speechRate', '1', '標準', String(settings.speechRate))}${option('speechRate', '1.2', '快', String(settings.speechRate))}</fieldset>
    <fieldset class="choice-group"><legend>每日目標</legend>${GOALS.map(goal => option('dailyGoal', String(goal.xp), `${goal.label} · ${goal.xp} XP（${goal.minutes}）`, String(study().dailyGoal))).join('')}</fieldset>
    <p class="muted" style="font-size:12px">設定只保存在此裝置。大字模式適合長輩或在小螢幕上閱讀。</p>
    <div class="form-actions"><button class="btn" type="submit">儲存設定</button></div>
  </form>`);
}

const originalAccountModal = accountModal;
accountModal = function accountModalWithSettings() {
  originalAccountModal();
  const form = document.querySelector('#modal [data-form="account"]');
  if (form && state.signedIn) {
    form.insertAdjacentHTML('afterend', `<div class="form-actions" style="justify-content:flex-start;margin-top:14px">${button(`${icon('settings')}外觀與無障礙`, 'study-settings', '', 'secondary small')}</div>`);
  }
};

/* ------------------------------------------------------------------ *
 * Speech (offline, on-device)
 * ------------------------------------------------------------------ */
function speak(text) {
  if (!('speechSynthesis' in window)) {
    toast('此瀏覽器不支援朗讀功能。');
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-TW';
  utterance.rate = study().settings.speechRate;
  const voice = window.speechSynthesis.getVoices().find(item => /zh[-_](TW|Hant)/i.test(item.lang));
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}
function stopSpeaking() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

/* ------------------------------------------------------------------ *
 * Interactive lesson player
 * ------------------------------------------------------------------ */
let session = null;
const normalizeAnswer = text => String(text || '').replace(/[\s，。、！？「」『』.,!?]/g, '').trim();

function shuffled(list, seed) {
  const copy = list.map((item, index) => ({item, index}));
  let value = seed;
  for (let index = copy.length - 1; index > 0; index -= 1) {
    value = (value * 9301 + 49297) % 233280;
    const swap = Math.floor((value / 233280) * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  if (copy.every((entry, index) => entry.index === index) && copy.length > 1) copy.push(copy.shift());
  return copy;
}

function startLesson(courseId, index) {
  const key = lessonKey(courseId, index);
  const content = LESSON_CONTENT[key];
  if (!content) return;
  const seed = [...key].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  session = {
    courseId,
    index,
    key,
    step: 0,
    steps: ['read', 'mcq', 'cloze', 'order', 'reflect', 'done'],
    results: {},
    answered: false,
    mcqOrder: shuffled(content.mcq.options, seed),
    orderPool: shuffled(content.order.items, seed + 7),
    orderPicked: [],
    reflection: '',
    finished: false,
    awarded: false
  };
  renderLessonStep();
}

function lessonShell(body, footer) {
  const totalSteps = session.steps.length - 1;
  const progress = Math.min(session.step, totalSteps) / totalSteps * 100;
  const title = lessonTitle(session.key);
  const element = document.getElementById('modal');
  element.classList.add('lesson-dialog');
  element.innerHTML = `<div class="lesson-top"><button class="icon-button" data-action="close" aria-label="離開課程">${icon('close')}</button><div class="lesson-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}" aria-label="課程進度"><i style="width:${progress}%"></i></div><span class="lesson-count">${Math.min(session.step + 1, totalSteps)}/${totalSteps}</span></div>
    <div class="eyebrow">LESSON · 示範教材</div><h2 id="dialog-title" class="lesson-title">${esc(title)}</h2>
    <div class="lesson-body" aria-live="polite">${body}</div><div class="lesson-footer">${footer}</div>`;
  if (!element.open) element.showModal();
  element.querySelector('.lesson-body input, .lesson-body textarea, .lesson-footer .btn')?.focus({preventScroll: true});
}

function feedbackBox(correct, explanation, expected) {
  return `<div class="feedback ${correct ? 'good' : 'bad'}" role="status"><strong>${correct ? '答對了！' : '再想想看'}</strong><p>${correct ? '' : expected ? `參考答案：${esc(expected)}。` : ''}${esc(explanation)}</p></div>`;
}

function renderLessonStep() {
  const content = LESSON_CONTENT[session.key];
  const kind = session.steps[session.step];
  const result = session.results[kind];
  const continueButton = button(`繼續 ${icon('arrow')}`, 'lesson-next', '', 'gold wide');
  if (kind === 'read') {
    lessonShell(
      `<div class="reading">${content.reading.map(paragraph => `<p>${esc(paragraph)}</p>`).join('')}</div><button type="button" class="btn secondary small" data-action="lesson-speak">${icon('speaker')}朗讀課文</button>`,
      continueButton
    );
  } else if (kind === 'mcq') {
    const options = session.mcqOrder.map(({item, index}) => {
      const optionState = !session.answered ? '' : index === content.mcq.answer ? 'correct' : result?.choice === index ? 'wrong' : '';
      return `<button type="button" class="option ${optionState}" data-action="lesson-choose" data-index="${index}" ${session.answered ? 'disabled' : ''}>${esc(item)}</button>`;
    }).join('');
    lessonShell(
      `<p class="prompt">${esc(content.mcq.question)}</p><div class="options">${options}</div>${session.answered ? feedbackBox(result.correct, content.mcq.explain, content.mcq.options[content.mcq.answer]) : ''}`,
      session.answered ? continueButton : '<span class="muted">選一個答案</span>'
    );
  } else if (kind === 'cloze') {
    lessonShell(
      `<p class="prompt">填入空格</p><form data-form="lesson-cloze" class="cloze"><span>${esc(content.cloze.before)}</span><input name="answer" aria-label="填空答案" autocomplete="off" maxlength="20" ${session.answered ? 'disabled' : ''} value="${esc(result?.value || '')}"><span>${esc(content.cloze.after)}</span>${session.answered ? '' : '<button class="btn" type="submit">檢查</button>'}</form>${session.answered ? feedbackBox(result.correct, content.cloze.explain, content.cloze.answers[0]) : ''}`,
      session.answered ? continueButton : '<span class="muted">輸入後按「檢查」</span>'
    );
  } else if (kind === 'order') {
    const picked = session.orderPicked.map(index => `<button type="button" class="chip picked" data-action="lesson-unpick" data-index="${index}" ${session.answered ? 'disabled' : ''}>${esc(content.order.items[index])}</button>`).join('') || '<span class="muted">依序點選下方選項</span>';
    const pool = session.orderPool.filter(({index}) => !session.orderPicked.includes(index)).map(({item, index}) => `<button type="button" class="chip" data-action="lesson-pick" data-index="${index}">${esc(item)}</button>`).join('');
    lessonShell(
      `<p class="prompt">${esc(content.order.prompt)}</p><div class="order-slots" aria-label="已選順序">${picked}</div><div class="order-pool">${session.answered ? '' : pool}</div>${session.answered ? feedbackBox(result.correct, content.order.explain, content.order.items.join(' → ')) : ''}`,
      session.answered ? continueButton : button('檢查順序', 'lesson-check-order', session.orderPicked.length === content.order.items.length ? '' : 'disabled', 'wide')
    );
  } else if (kind === 'reflect') {
    lessonShell(
      `<p class="prompt">${esc(content.reflect)}</p><label class="field"><span>寫給自己（選填，僅存在此裝置）</span><textarea name="reflection" id="lesson-reflection" maxlength="500" placeholder="一兩句就很好">${esc(session.reflection)}</textarea></label>`,
      button(`完成練習 ${icon('arrow')}`, 'lesson-finish', '', 'gold wide')
    );
  } else {
    const graded = ['mcq', 'cloze', 'order'];
    const correct = graded.filter(name => session.results[name]?.correct).length;
    const perfect = correct === graded.length;
    const reflectionXp = session.reflection.trim() ? XP.reflection : 0;
    const earned = XP.lesson + (perfect ? XP.perfect : 0) + reflectionXp;
    session.earned = earned;
    lessonShell(
      `<div class="lesson-complete"><div class="badge-symbol big">${icon(perfect ? 'award' : 'check')}</div><h3>${perfect ? '全部答對！' : '練習完成'}</h3><p>答對 ${correct} / ${graded.length} 題 · 獲得 <strong>${earned} XP</strong>${perfect ? '（含全對加成）' : ''}${reflectionXp ? ' · 含反思 +2' : ''}</p><p class="muted">本課 ${cardIdsFor(session.key).length} 張閃卡已加入「每日複習」。沒有生命值限制，答錯也能繼續學。</p></div>`,
      button(`${icon('check')}完成並收下 XP`, 'complete-lesson', `data-id="${session.courseId}" data-index="${session.index}"`, 'gold wide')
    );
  }
}

async function finishLessonRewards(snapshot) {
  await withMutationLock(() => {
    const data = study();
    const graded = ['mcq', 'cloze', 'order'];
    data.mastery[snapshot.key] = {correct: graded.filter(name => snapshot.results[name]?.correct).length, total: graded.length};
    for (const id of cardIdsFor(snapshot.key)) {
      if (!data.cards[id]) data.cards[id] = freshCard(today());
    }
    if (snapshot.reflection.trim()) data.journal.push({date: today(), lesson: snapshot.key, text: snapshot.reflection.trim().slice(0, 500)});
    data.journal = data.journal.slice(-100);
    const message = awardXp(snapshot.earned);
    save();
    render();
    toast(`+${snapshot.earned} XP${message ? ' · ' + message : ''}`);
  });
}

/* Capture-phase interception keeps the old one-click preview from opening. */
document.addEventListener('click', event => {
  const target = event.target.closest('[data-action="play-lesson"]');
  if (!target || target.disabled) return;
  event.stopImmediatePropagation();
  event.preventDefault();
  if (!state.signedIn) {
    accountModal();
    return;
  }
  const course = courses.find(item => item.id === target.dataset.id);
  if (!course || !unlocked(course)) return;
  startLesson(course.id, ui.lesson);
}, true);

document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  const action = target.dataset.action;
  if (action === 'complete-lesson' && session?.finished && !session.awarded && target.dataset.id === session.courseId && Number(target.dataset.index) === session.index) {
    session.awarded = true;
    const snapshot = session;
    document.getElementById('modal').classList.remove('lesson-dialog');
    finishLessonRewards(snapshot);
    return;
  }
  if (!session || !document.getElementById('modal').classList.contains('lesson-dialog')) return;
  const content = LESSON_CONTENT[session.key];
  if (action === 'lesson-speak') {
    speak(content.reading.join(''));
  } else if (action === 'lesson-next') {
    stopSpeaking();
    session.step += 1;
    session.answered = false;
    renderLessonStep();
  } else if (action === 'lesson-choose' && !session.answered) {
    const choice = Number(target.dataset.index);
    session.results.mcq = {choice, correct: choice === content.mcq.answer};
    session.answered = true;
    renderLessonStep();
  } else if (action === 'lesson-pick' && !session.answered) {
    session.orderPicked.push(Number(target.dataset.index));
    renderLessonStep();
  } else if (action === 'lesson-unpick' && !session.answered) {
    session.orderPicked = session.orderPicked.filter(index => index !== Number(target.dataset.index));
    renderLessonStep();
  } else if (action === 'lesson-check-order' && !session.answered) {
    session.results.order = {correct: session.orderPicked.every((index, position) => index === position)};
    session.answered = true;
    renderLessonStep();
  } else if (action === 'lesson-finish') {
    session.reflection = document.getElementById('lesson-reflection')?.value || '';
    session.finished = true;
    session.step += 1;
    renderLessonStep();
  }
});

document.getElementById('modal').addEventListener('close', () => {
  stopSpeaking();
  document.getElementById('modal').classList.remove('lesson-dialog', 'focus-dialog');
  if (focusTimer && !focusTimer.completed) cancelFocus(false);
});

/* ------------------------------------------------------------------ *
 * Review page (flashcards)
 * ------------------------------------------------------------------ */
let reviewQueue = [];
let reviewRevealed = false;
let reviewDoneToday = 0;

function reviewPage() {
  const due = dueCards();
  if (!reviewQueue.length || reviewQueue.some(id => !study().cards[id])) reviewQueue = due;
  reviewQueue = reviewQueue.filter(id => study().cards[id]);
  const total = Object.keys(study().cards).length;
  const forecast = Array.from({length: 7}, (_, offset) => {
    const day = addDays(today(), offset);
    const count = Object.values(study().cards).filter(card => offset === 0 ? card.due <= day : card.due === day).length;
    return {day, count};
  });
  const maxForecast = Math.max(1, ...forecast.map(entry => entry.count));
  const forecastBars = `<div class="forecast">${forecast.map((entry, index) => `<div><i style="height:${Math.max(4, entry.count / maxForecast * 60)}px"></i><span>${index === 0 ? '今天' : entry.day.slice(5).replace('-', '/')}</span><b>${entry.count}</b></div>`).join('')}</div>`;
  let content;
  if (!total) {
    content = `<div class="card empty">${icon('layers')}<h3>還沒有閃卡</h3><p>完成任何一個課程單元，閃卡就會自動出現在這裡。</p>${navButton('去上第一課', 'courses')}</div>`;
  } else if (!reviewQueue.length) {
    content = `<div class="card empty">${icon('check')}<h3>今天的複習完成了</h3><p>${reviewDoneToday ? `剛剛複習了 ${reviewDoneToday} 張。` : ''}間隔重複會在最適合的時間再提醒你。</p>${navButton('繼續學新單元', 'courses', 'secondary')}</div>`;
  } else {
    const id = reviewQueue[0];
    const card = study().cards[id];
    const {key, front, back} = cardContent(id);
    const ratings = [['again', '重來', 'danger'], ['hard', '困難', 'secondary'], ['good', '良好', ''], ['easy', '簡單', 'secondary']];
    content = `<div class="flashcard ${reviewRevealed ? 'revealed' : ''}"><div class="flash-meta"><span class="tag">${esc(lessonTitle(key))}</span><span class="muted">剩下 ${reviewQueue.length} 張</span></div><p class="flash-front">${esc(front)}</p>${reviewRevealed ? `<hr><p class="flash-back">${esc(back)}</p>` : ''}<div class="flash-actions">${reviewRevealed ? ratings.map(([rating, label, style]) => button(`${label}<small>${previewInterval(card, rating)}</small>`, 'review-rate', `data-rating="${rating}" data-card="${esc(id)}"`, `rate ${style}`)).join('') : button('顯示答案', 'review-reveal', '', 'gold wide') + `<button type="button" class="btn ghost small" data-action="review-speak" aria-label="朗讀題目">${icon('speaker')}</button>`}</div></div><p class="muted" style="font-size:11px;margin-top:12px">鍵盤：空白鍵翻面，1–4 評分。依你的評分安排下次複習時間（簡化 SM-2 演算法）。</p>`;
  }
  return `${pageHead('每日複習', '在快要忘記的時候複習，記得最久。')}<div class="two-col"><section>${content}</section><aside class="card card-pad"><h2>未來 7 天</h2>${forecastBars}<div class="list-row"><span>閃卡總數</span><strong>${total}</strong></div><div class="list-row"><span>今天到期</span><strong>${due.length}</strong></div><div class="list-row"><span>已熟記（間隔 ≥ 21 天）</span><strong>${Object.values(study().cards).filter(card => card.interval >= 21).length}</strong></div></aside></div>`;
}

async function rateCard(id, rating) {
  await withMutationLock(() => {
    const card = study().cards[id];
    if (!card) return;
    study().cards[id] = scheduleCard(card, rating);
    reviewQueue = reviewQueue.filter(item => item !== id);
    if (rating === 'again') reviewQueue.push(id);
    reviewDoneToday += 1;
    reviewRevealed = false;
    const message = awardXp(XP.review);
    save();
    render();
    if (message) toast(message);
  });
}

document.addEventListener('keydown', event => {
  if (location.hash !== '#review' || document.querySelector('dialog[open]') || event.target.matches('input, textarea, select')) return;
  if (event.key === ' ' && !reviewRevealed && reviewQueue.length) {
    event.preventDefault();
    reviewRevealed = true;
    render();
  } else if (reviewRevealed && ['1', '2', '3', '4'].includes(event.key) && reviewQueue.length) {
    rateCard(reviewQueue[0], ['again', 'hard', 'good', 'easy'][Number(event.key) - 1]);
  }
});

/* ------------------------------------------------------------------ *
 * Study buddy: offline retrieval tutor + optional cloud AI (opt-in)
 * ------------------------------------------------------------------ */
let tutorScope = 'all';
let tutorBusy = false;
let pendingQuiz = null;
const PUTER_SDK_URL = 'https://js.puter.com/v2/';
let puterPromise = null;

const STOP_CHARACTERS = /[\s，。、！？「」『』：；（）()…,.!?:;"'\-什麼怎麼樣該要我你妳他她的是嗎呢吧了時做如何請問一下有沒能可以會]/g;
function bigrams(text) {
  const clean = String(text).replace(STOP_CHARACTERS, '');
  const grams = new Set();
  for (let index = 0; index < clean.length - 1; index += 1) grams.add(clean.slice(index, index + 2));
  if (clean.length === 1) grams.add(clean);
  return grams;
}
/* Corpus of citable passages: readings, summary, flashcards and each lesson's real-life scenario. */
let corpusCache = null;
function corpus() {
  if (corpusCache) return corpusCache;
  const passages = [];
  for (const [key, content] of Object.entries(LESSON_CONTENT)) {
    const scenario = `${content.mcq.question}${content.mcq.options[content.mcq.answer]}。${content.mcq.explain}`;
    for (const sentence of [...content.reading, content.summary, scenario, ...content.cards.map(([front, back]) => `${front}${back}`)]) {
      passages.push({key, sentence, grams: bigrams(sentence)});
    }
  }
  const documentFrequency = new Map();
  for (const passage of passages) {
    for (const gram of passage.grams) documentFrequency.set(gram, (documentFrequency.get(gram) || 0) + 1);
  }
  const idf = gram => Math.log(1 + passages.length / (documentFrequency.get(gram) || passages.length));
  corpusCache = {passages, idf};
  return corpusCache;
}
function scopedLessons() {
  const keys = Object.keys(LESSON_CONTENT);
  return tutorScope === 'all' ? keys : keys.filter(key => key === tutorScope);
}
function retrieve(question, limit = 2) {
  const questionGrams = bigrams(question);
  if (!questionGrams.size) return [];
  const {passages, idf} = corpus();
  const scopes = new Set(scopedLessons());
  const maximum = [...questionGrams].reduce((sum, gram) => sum + idf(gram), 0);
  const scored = [];
  for (const passage of passages) {
    if (!scopes.has(passage.key)) continue;
    let weight = 0;
    for (const gram of questionGrams) {
      if (passage.grams.has(gram)) weight += idf(gram);
    }
    const titleWeight = [...questionGrams].filter(gram => lessonTitle(passage.key).includes(gram)).reduce((sum, gram) => sum + idf(gram) * 0.5, 0);
    const score = (weight + titleWeight) / Math.max(maximum, 1e-6);
    if (weight > 0) scored.push({key: passage.key, sentence: passage.sentence, score});
  }
  scored.sort((a, b) => b.score - a.score);
  const results = [];
  for (const entry of scored) {
    if (!results.some(item => item.sentence === entry.sentence)) results.push(entry);
    if (results.length >= limit) break;
  }
  return results;
}
function pickLessonForQuiz() {
  const keys = scopedLessons();
  const studied = keys.filter(key => cardIdsFor(key).some(id => study().cards[id]));
  const pool = studied.length ? studied : keys;
  return pool[(xpToday() + study().tutorLog.length) % pool.length];
}

function localTutor(question) {
  const text = question.trim();
  if (pendingQuiz) {
    const quiz = pendingQuiz;
    if (/答案是什麼|直接告訴我|給我答案|告訴我答案/.test(text)) {
      return {text: `先別急著看答案 🙂 提示：和「${quiz.back.slice(0, Math.max(2, Math.floor(quiz.back.length / 3)))}……」有關。用自己的話試著回答看看？`, source: lessonTitle(quiz.key)};
    }
    if (/提示|hint|不知道|不會/.test(text)) {
      return {text: `提示：答案和「${quiz.back.slice(0, Math.max(2, Math.floor(quiz.back.length / 3)))}……」有關。再試一次？`, source: lessonTitle(quiz.key)};
    }
    pendingQuiz = null;
    const expected = bigrams(quiz.back);
    const given = bigrams(text);
    let overlap = 0;
    for (const gram of given) {
      if (expected.has(gram)) overlap += 1;
    }
    const ratio = overlap / Math.max(expected.size, 1);
    const verdict = ratio >= 0.35 ? '很接近了！' : ratio >= 0.15 ? '方向對了，再補充一點會更完整。' : '還差一點，沒關係。';
    return {text: `${verdict}參考答案：「${quiz.back}」\n要不要把這張卡加入複習？說「做成閃卡」即可。`, source: lessonTitle(quiz.key)};
  }
  if (/^(給我)?提示$/.test(text)) {
    return {text: '先說「考考我」，我出一題之後就能給你提示；也可以直接問課程裡的問題。', source: ''};
  }
  if (/考考我|測驗|quiz|出題/.test(text)) {
    const key = pickLessonForQuiz();
    const [front, back] = LESSON_CONTENT[key].cards[(study().tutorLog.length) % LESSON_CONTENT[key].cards.length];
    pendingQuiz = {key, front, back};
    return {text: `來一題：${front}\n（用自己的話回答；說「提示」可以得到線索。）`, source: lessonTitle(key)};
  }
  if (/總結|摘要|重點|summary/.test(text)) {
    const keys = tutorScope === 'all' ? [retrieve(text, 1)[0]?.key || pickLessonForQuiz()] : [tutorScope];
    return {text: `重點整理：${LESSON_CONTENT[keys[0]].summary}`, source: lessonTitle(keys[0])};
  }
  if (/閃卡|flashcard/.test(text)) {
    return {text: '__ADD_CARDS__', source: ''};
  }
  if (/答案是什麼|直接告訴我|給我答案/.test(text)) {
    return {text: '我比較想陪你一起想：先說說你目前的想法，或說「提示」讓我給你一條線索。', source: ''};
  }
  const hits = retrieve(text);
  if (!hits.length || hits[0].score < 0.3) {
    return {text: '課程內容裡找不到和這個問題直接相關的段落，我不想亂猜。可以換個說法、選擇特定課程，或請教帶領老師。', source: ''};
  }
  const key = hits[0].key;
  const follow = LESSON_CONTENT[key].reflect;
  const sameLesson = hits.filter(hit => hit.key === key);
  return {text: `${sameLesson.map(hit => hit.sentence).join('\n')}\n\n想一想：${follow}`, source: lessonTitle(key)};
}

function ensurePuter() {
  if (window.puter) return Promise.resolve(window.puter);
  if (!puterPromise) {
    puterPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = PUTER_SDK_URL;
      script.async = true;
      script.onload = () => window.puter ? resolve(window.puter) : reject(new Error('Puter 未能啟動。'));
      script.onerror = () => {
        puterPromise = null;
        script.remove();
        reject(new Error('無法連線到 Puter，請檢查網路或廣告攔截器。'));
      };
      document.head.appendChild(script);
    });
  }
  return puterPromise;
}

async function cloudTutor(question) {
  const sdk = await ensurePuter();
  if (sdk.auth && typeof sdk.auth.isSignedIn === 'function' && !sdk.auth.isSignedIn()) {
    await sdk.auth.signIn();
  }
  const hits = retrieve(question, 4);
  const excerpts = hits.length ? hits.map(hit => `〈${lessonTitle(hit.key)}〉${hit.sentence}`).join('\n') : '（沒有找到相關課程摘錄）';
  const system = '你是「光光」，光耀同行學習平台的學習夥伴。只根據使用者提供的課程摘錄回答，使用繁體中文，簡潔溫和。每個重點後用〈課名〉標示出處。若摘錄沒有答案，就說不知道並建議詢問帶領老師，不要編造。不提供宗教教義的權威解釋。採蘇格拉底式引導：先給提示或反問，不直接說出測驗答案。';
  const response = await Promise.race([
    sdk.ai.chat([{role: 'system', content: system}, {role: 'user', content: `課程摘錄：\n${excerpts}\n\n問題：${question}`}]),
    new Promise((_, reject) => setTimeout(() => reject(new Error('雲端 AI 回應逾時。')), 45000))
  ]);
  const text = typeof response === 'string' ? response : String(response?.message?.content || response?.text || '');
  if (!text.trim()) throw new Error('雲端 AI 沒有回應內容。');
  return {text: text.trim().slice(0, 1200), source: hits[0] ? lessonTitle(hits[0].key) : '', mode: 'cloud'};
}

function tutorPage() {
  const log = study().tutorLog;
  const scopeOptions = `<option value="all" ${tutorScope === 'all' ? 'selected' : ''}>全部課程</option>${Object.keys(LESSON_CONTENT).map(key => `<option value="${key}" ${tutorScope === key ? 'selected' : ''}>${esc(lessonTitle(key))}</option>`).join('')}`;
  const messages = log.length ? log.map(entry => `<div class="message ${entry.role === 'user' ? 'mine' : ''}"><span class="avatar ${entry.role === 'user' ? 'peach' : ''}">${entry.role === 'user' ? esc(state.name.slice(-1)) : '光'}</span><div class="bubble"><small>${entry.role === 'user' ? '你' : `光光 · ${entry.mode === 'cloud' ? '雲端 AI' : '離線學伴'}`}</small>${esc(entry.text).replace(/\n/g, '<br>')}${entry.source ? `<span class="cite">出處：〈${esc(entry.source)}〉</span>` : ''}</div></div>`).join('') : `<div class="empty">${icon('spark')}<h3>嗨，我是光光</h3><p>我只根據課程內容回答並標出出處；找不到就會老實說。試試下面的按鈕。</p></div>`;
  const chips = ['考考我', '總結重點', '給我提示', '什麼是先詢問再協助？', '做成閃卡'].map(text => `<button type="button" class="chip" data-action="tutor-chip" data-text="${esc(text)}">${esc(text)}</button>`).join('');
  const cloud = study().settings.aiOptIn;
  return `${pageHead('AI 學伴 · 光光', '有出處的回答、引導式提問，陪你真正想懂。')}
    <div class="callout">${icon('shield')} 預設為<strong>離線學伴</strong>：只在此裝置比對課程內容，不傳送任何資料。${cloud ? '已開啟雲端 AI（Puter，第三方服務）；問題與相關課程摘錄會送出處理。' : ''}</div>
    <div class="card tutor-card"><div class="tutor-head"><label class="field" style="margin:0;flex:1"><span>提問範圍</span><select data-setting-tutor-scope aria-label="提問範圍">${scopeOptions}</select></label><label class="check" style="margin:0"><input type="checkbox" data-setting-ai ${cloud ? 'checked' : ''}>使用雲端 AI（選用）</label>${button('清除對話', 'tutor-clear', log.length ? '' : 'disabled', 'ghost small')}</div>
    <div class="messages tutor-messages" id="tutor-messages">${messages}${tutorBusy ? '<div class="message"><span class="avatar">光</span><div class="bubble typing">思考中…</div></div>' : ''}</div>
    <div class="chips">${chips}</div>
    <form class="chat-compose" data-form="tutor"><input name="question" aria-label="問光光" placeholder="問一個關於課程的問題…" maxlength="300" required autocomplete="off" ${tutorBusy ? 'disabled' : ''}><button class="btn" type="submit" ${tutorBusy ? 'disabled' : ''}>送出 ${icon('arrow')}</button></form></div>
    <p class="muted" style="font-size:11px;margin-top:10px">光光不會直接說出測驗答案，會先給提示。AI 可能出錯，請以課程與老師說明為準。</p>`;
}

async function askTutor(question) {
  const text = question.trim().slice(0, 300);
  if (!text || tutorBusy) return;
  let reply;
  const useCloud = study().settings.aiOptIn && !/考考我|測驗|出題|閃卡/.test(text) && !pendingQuiz;
  if (useCloud) {
    tutorBusy = true;
    await withMutationLock(() => {
      study().tutorLog.push({role: 'user', text, source: '', mode: 'local'});
      save();
    });
    render();
    try {
      reply = await cloudTutor(text);
    } catch (error) {
      reply = {...localTutor(text), text: `（雲端 AI 無法使用：${error.message}，改用離線學伴）\n${localTutor(text).text}`};
    }
    tutorBusy = false;
  } else {
    reply = localTutor(text);
  }
  await withMutationLock(() => {
    const data = study();
    if (!useCloud) data.tutorLog.push({role: 'user', text, source: '', mode: 'local'});
    if (reply.text === '__ADD_CARDS__') {
      const keys = tutorScope === 'all' ? [pickLessonForQuiz()] : [tutorScope];
      let added = 0;
      for (const id of cardIdsFor(keys[0])) {
        if (!data.cards[id]) {
          data.cards[id] = freshCard(today());
          added += 1;
        }
      }
      reply = {text: added ? `已把〈${lessonTitle(keys[0])}〉的 ${added} 張閃卡加入每日複習。` : `〈${lessonTitle(keys[0])}〉的閃卡已經在複習清單裡了。`, source: lessonTitle(keys[0])};
    }
    data.tutorLog.push({role: 'tutor', text: reply.text, source: reply.source || '', mode: reply.mode || 'local'});
    data.tutorLog = data.tutorLog.slice(-40);
    save();
    render();
  });
  document.getElementById('tutor-messages')?.scrollTo(0, 1e6);
  document.querySelector('[data-form="tutor"] input')?.focus();
}

/* ------------------------------------------------------------------ *
 * Focus timer
 * ------------------------------------------------------------------ */
let focusTimer = null;
function openFocus() {
  modal('專注學習', `<p class="muted">選一段時間，放下手機通知，專心讀一課或複習閃卡。完成後會記入學習數據。</p><div class="focus-choices">${[10, 15, 25].map(minutes => button(`${minutes} 分鐘`, 'focus-start', `data-minutes="${minutes}"`, 'secondary')).join('')}</div>`);
}
function renderFocus() {
  if (!focusTimer) return;
  const remaining = Math.max(0, focusTimer.end - Date.now());
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  const ratio = 1 - remaining / (focusTimer.minutes * 60000);
  const display = document.getElementById('focus-display');
  if (display) {
    display.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    document.getElementById('focus-ring')?.style.setProperty('--ratio', ratio.toFixed(4));
  }
  if (remaining <= 0 && !focusTimer.completed) completeFocus();
}
function startFocus(minutes) {
  focusTimer = {minutes, end: Date.now() + minutes * 60000, completed: false, interval: setInterval(renderFocus, 500)};
  const element = document.getElementById('modal');
  element.classList.add('focus-dialog');
  modal('專注中', `<div class="focus-ring" id="focus-ring"><span id="focus-display">${String(minutes).padStart(2, '0')}:00</span></div><p class="muted" style="text-align:center">即使切換分頁，時間仍以實際時鐘計算。</p><div class="form-actions" style="justify-content:center">${button('提前結束', 'focus-cancel', '', 'secondary')}</div>`);
  renderFocus();
}
function cancelFocus(showToast = true) {
  if (!focusTimer) return;
  clearInterval(focusTimer.interval);
  focusTimer = null;
  if (showToast) toast('已結束專注，這次不計入紀錄。');
}
async function completeFocus() {
  const minutes = focusTimer.minutes;
  focusTimer.completed = true;
  clearInterval(focusTimer.interval);
  focusTimer = null;
  await withMutationLock(() => {
    const data = study();
    data.focusByDay[today()] = Math.min((data.focusByDay[today()] || 0) + minutes, 1440);
    const earned = Math.max(1, Math.floor(minutes / 5)) * XP.focusPerFiveMinutes;
    const message = awardXp(earned);
    save();
    closeModal();
    render();
    toast(`專注 ${minutes} 分鐘完成！+${earned} XP${message ? ' · ' + message : ''}`);
  });
}
window.GY_COMPLETE_FOCUS_FOR_TEST = () => {
  if (focusTimer) focusTimer.end = Date.now() - 1;
  renderFocus();
};

/* ------------------------------------------------------------------ *
 * Stats page, heatmap, share card
 * ------------------------------------------------------------------ */
function goalRing(size = 92) {
  const goal = study().dailyGoal;
  const ratio = Math.min(xpToday() / goal, 1);
  const radius = size / 2 - 8;
  const circumference = 2 * Math.PI * radius;
  return `<svg class="goal-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="今日 ${xpToday()} / ${goal} XP"><circle cx="${size / 2}" cy="${size / 2}" r="${radius}" class="track"/><circle cx="${size / 2}" cy="${size / 2}" r="${radius}" class="fill" stroke-dasharray="${circumference}" stroke-dashoffset="${circumference * (1 - ratio)}" transform="rotate(-90 ${size / 2} ${size / 2})"/><text x="50%" y="47%" text-anchor="middle" class="ring-big">${xpToday()}</text><text x="50%" y="66%" text-anchor="middle" class="ring-small">/ ${goal} XP</text></svg>`;
}
function heatmap(weeks = 12) {
  const end = today();
  const [year, month, day] = end.split('-').map(Number);
  const weekday = new Date(year, month - 1, day).getDay();
  const start = addDays(end, -weekday - (weeks - 1) * 7);
  const cells = [];
  for (let offset = 0; offset < weeks * 7; offset += 1) {
    const key = addDays(start, offset);
    if (key > end) {
      cells.push('<i class="heat future"></i>');
      continue;
    }
    const xp = study().xpByDay[key] || 0;
    const frozen = study().frozenDays.includes(key);
    const level = frozen ? 'frozen' : xp === 0 ? 'l0' : xp < 10 ? 'l1' : xp < 20 ? 'l2' : xp < 40 ? 'l3' : 'l4';
    cells.push(`<i class="heat ${level}" title="${key}：${frozen ? '連續保護' : `${xp} XP`}"></i>`);
  }
  const dayLabels = ['日', '一', '二', '三', '四', '五', '六'].map((label, index) => `<span>${index % 2 ? label : ''}</span>`).join('');
  return `<div class="heat-wrap"><div class="heat-days" aria-hidden="true">${dayLabels}</div><div class="heatmap" style="--weeks:${weeks}" role="img" aria-label="最近 ${weeks} 週學習紀錄">${cells.join('')}</div></div><div class="heat-legend"><span>少</span><i class="heat l0"></i><i class="heat l1"></i><i class="heat l2"></i><i class="heat l3"></i><i class="heat l4"></i><span>多</span><i class="heat frozen"></i><span>保護</span></div>`;
}
function statsPage() {
  const data = study();
  const totalXp = Object.values(data.xpByDay).reduce((sum, value) => sum + value, 0);
  const focusTotal = Object.values(data.focusByDay).reduce((sum, value) => sum + value, 0);
  const masteryEntries = Object.values(data.mastery);
  const accuracy = masteryEntries.length ? Math.round(masteryEntries.reduce((sum, entry) => sum + entry.correct, 0) / masteryEntries.reduce((sum, entry) => sum + entry.total, 0) * 100) : null;
  const courseMastery = courses.map(course => {
    const keys = course.lessons.map((_, index) => lessonKey(course.id, index));
    const done = keys.filter(key => data.mastery[key]).length;
    const score = keys.reduce((sum, key) => sum + (data.mastery[key] ? data.mastery[key].correct / data.mastery[key].total : 0), 0) / keys.length;
    return `<div style="margin:14px 0"><div class="progress-label"><span>${esc(course.title)}</span><span>${done}/3 單元 · 熟練度 ${Math.round(score * 100)}%</span></div><div class="progress"><i style="width:${score * 100}%"></i></div></div>`;
  }).join('');
  const journal = data.journal.slice(-5).reverse().map(entry => `<div class="list-row"><div><h3>${esc(lessonTitle(entry.lesson))}</h3><p>${esc(entry.text)}</p></div><small>${entry.date.slice(5).replace('-', '/')}</small></div>`).join('') || '<div class="empty">完成課程的反思題後，筆記會出現在這裡（僅存在此裝置）。</div>';
  return `${pageHead('學習數據', '看見自己的節奏，而不是和別人比較。', button(`${icon('share')}分享學習卡`, 'share-card', '', 'secondary'))}
    <section class="stats">${stat('連續學習', currentStreak(), 'flame', '天')}${stat('最長連續', longestStreak(), 'award', '天')}${stat('累積 XP', format(totalXp), 'spark')}${stat('專注時間', focusTotal, 'timer', '分鐘')}</section>
    <div class="two-col"><section class="card card-pad"><div class="section-head"><h2>最近 12 週</h2><span class="tag">${icon('snow')} 連續保護 ${data.freezes}/2</span></div>${heatmap()}<p class="muted" style="font-size:11px;margin-top:10px">每連續 7 天可獲得 1 個連續保護（最多 2 個），漏掉一天時自動使用。</p><h2 class="space-top">課程熟練度</h2>${courseMastery}<p class="muted" style="font-size:12px">練習題正確率：${accuracy === null ? '尚無資料' : `${accuracy}%`}</p></section>
    <aside><div class="card card-pad" style="text-align:center"><h2>今日目標</h2>${goalRing(132)}<p class="muted" style="font-size:12px">${xpToday() >= data.dailyGoal ? '今天的目標已達成，做得好！' : `還差 ${data.dailyGoal - xpToday()} XP`}</p>${button(`${icon('settings')}調整目標與外觀`, 'study-settings', '', 'secondary small')}</div><div class="card card-pad space-top"><h2>我的反思筆記</h2>${journal}</div></aside></div>`;
}

function shareCardCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1080;
  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, 0, 1080);
  gradient.addColorStop(0, '#183e3c');
  gradient.addColorStop(1, '#24584f');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 1080, 1080);
  context.fillStyle = '#edc784';
  context.beginPath();
  context.arc(820, 260, 120, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#ffffff';
  context.font = '600 46px "PingFang TC", "Noto Sans TC", sans-serif';
  context.fillText('光耀同行 · 學習足跡', 90, 150);
  context.font = '800 200px "PingFang TC", "Noto Sans TC", sans-serif';
  context.fillText(String(currentStreak()), 90, 470);
  context.font = '600 60px "PingFang TC", "Noto Sans TC", sans-serif';
  context.fillText('天連續學習', 90, 560);
  context.font = '400 42px "PingFang TC", "Noto Sans TC", sans-serif';
  context.fillStyle = '#cfe0d4';
  const completed = state.completed.length;
  context.fillText(`本週 ${xpThisWeek()} XP · 已完成 ${completed} 門課程`, 90, 690);
  context.fillText('一起學習，一起成為更好的自己。', 90, 770);
  context.font = '400 28px sans-serif';
  context.fillStyle = '#9fbaa7';
  context.fillText('非官方示範 · juwpegatron.github.io/projects/guangyao', 90, 980);
  return canvas;
}
async function shareProgress() {
  const canvas = shareCardCanvas();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) {
    toast('無法產生圖片。');
    return;
  }
  const file = new File([blob], 'guangyao-progress.png', {type: 'image/png'});
  if (navigator.canShare && navigator.canShare({files: [file]})) {
    try {
      await navigator.share({files: [file], title: '光耀同行 · 學習足跡', text: `我已連續學習 ${currentStreak()} 天！`});
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'guangyao-progress.png';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast('已下載學習卡圖片，可分享到社群。');
}

/* ------------------------------------------------------------------ *
 * Home "today" panel, cooperative group goal
 * ------------------------------------------------------------------ */
const GROUP_SAMPLE_XP = [{name: '徐子晴', xp: 86}, {name: '周以哲', xp: 64}, {name: '許宥恩', xp: 41}];
const GROUP_GOAL = 300;
function todayPanel() {
  if (!state.signedIn) return '';
  const data = study();
  const due = dueCards().length;
  const nextCourse = courses.find(course => unlocked(course) && !state.completed.includes(course.id)) || courses[0];
  const nextIndex = [0, 1, 2].find(index => !(state.lessons[nextCourse.id] || []).includes(index));
  const groupTotal = GROUP_SAMPLE_XP.reduce((sum, member) => sum + member.xp, 0) + xpThisWeek();
  const goalPrompt = data.goalChosen ? '' : `<div class="goal-picker card card-pad"><div><h3>設定你的每日目標</h3><p class="muted">選一個做得到的節奏。之後可隨時在「學習數據」調整。</p></div><div class="goal-options">${GOALS.map(goal => button(`<strong>${goal.label}</strong><small>${goal.xp} XP · ${goal.minutes}</small>`, 'choose-goal', `data-xp="${goal.xp}"`, `goal-option ${data.dailyGoal === goal.xp ? 'selected' : ''}`)).join('')}</div></div>`;
  return `${goalPrompt}<section class="today-panel" aria-label="今日學習">
    <div class="today-card ring-card">${goalRing()}<div><span class="eyebrow">今日目標</span><strong>${xpToday() >= data.dailyGoal ? '已達成 🎉' : `${data.dailyGoal - xpToday()} XP 待完成`}</strong></div></div>
    <div class="today-card"><span class="flame ${currentStreak() ? 'lit' : ''}">${icon('flame')}</span><div><span class="eyebrow">連續學習</span><strong>${currentStreak()} 天</strong><small>${icon('snow')} 保護 ${data.freezes}/2</small></div></div>
    <button type="button" class="today-card action" data-action="navigate" data-page="review"><span class="stat-symbol">${icon('layers')}</span><div><span class="eyebrow">每日複習</span><strong>${due} 張到期</strong><small>${due ? '約 ' + Math.max(1, Math.ceil(due / 4)) + ' 分鐘' : '今天已完成'}</small></div></button>
    ${nextIndex === undefined ? `<button type="button" class="today-card action" data-action="navigate" data-page="course/${nextCourse.id}"><span class="stat-symbol">${icon('book')}</span><div><span class="eyebrow">全部單元已完成</span><strong>回顧課程</strong></div></button>` : `<button type="button" class="today-card action primary" data-action="open-lesson-direct" data-id="${nextCourse.id}" data-index="${nextIndex}"><span class="stat-symbol">${icon('play')}</span><div><span class="eyebrow">下一課 · 約 3 分鐘</span><strong>${esc(nextCourse.lessons[nextIndex])}</strong></div></button>`}
    <button type="button" class="today-card action" data-action="focus-open"><span class="stat-symbol">${icon('timer')}</span><div><span class="eyebrow">專注學習</span><strong>開始計時</strong></div></button>
  </section>
  <section class="group-quest card card-pad"><div class="section-head"><h3>${icon('people')} 初學同行小組 · 本週共同目標</h3><span class="tag gold">${Math.min(groupTotal, GROUP_GOAL)} / ${GROUP_GOAL} XP</span></div><div class="progress"><i style="width:${Math.min(groupTotal / GROUP_GOAL, 1) * 100}%"></i></div><p class="muted" style="font-size:11px;margin:6px 0 0">互相成全，不互相比較：每個人的 XP 都會累加到小組目標（其他成員為示範數據，你本週貢獻 ${xpThisWeek()} XP）。</p></section>`;
}
const originalHomePage = homePage;
homePage = function homePageWithToday() {
  const html = originalHomePage();
  return html.replace('<section class="hero"', `${todayPanel()}<section class="hero"`);
};

/* Mobile bottom navigation: learn-first shortcuts with a review badge. */
renderMobileNavigation = function renderLearningNavigation(activePage) {
  const due = state.signedIn ? dueCards().length : 0;
  const shortcuts = [['home', 'home', '總覽'], ['courses', 'book', '學習'], ['review', 'layers', '複習'], ['tutor', 'spark', '學伴'], ['portfolio', 'award', '我的']];
  document.getElementById('mobile-nav').innerHTML = shortcuts.map(([page, symbol, label]) => `<button type="button" data-action="navigate" data-page="${page}" ${activePage === page ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${label}</span>${page === 'review' && due ? `<b class="nav-badge" aria-label="${due} 張到期">${due}</b>` : ''}</button>`).join('');
};
window.GY_NAV_BADGE = id => {
  if (id !== 'review' || !state.signedIn) return '';
  const due = dueCards().length;
  return due ? `<span class="count">${due}</span>` : '';
};

/* ------------------------------------------------------------------ *
 * Calendar export for registered activities
 * ------------------------------------------------------------------ */
function icsEscape(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
function icsFor(event) {
  const [year, month, day] = event.date.split('-').map(Number);
  const [hour, minute] = event.time.split(':').map(Number);
  const startUtc = new Date(Date.UTC(year, month - 1, day, hour - 8, minute));
  const durationMatch = /(\d+)\s*(分鐘|小時)/.exec(event.duration || '');
  const minutes = durationMatch ? Number(durationMatch[1]) * (durationMatch[2] === '小時' ? 60 : 1) : 60;
  const endUtc = new Date(startUtc.getTime() + minutes * 60000);
  const stamp = value => value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Guang Yao Together//Demo//ZH-TW', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', `UID:${event.id}@guangyao-demo`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(startUtc)}`, `DTEND:${stamp(endUtc)}`, `SUMMARY:${icsEscape(event.title)}`, `LOCATION:${icsEscape(event.place)}`, `DESCRIPTION:${icsEscape(`${event.teacher}｜${event.description}｜示範活動，實際時間地點以主辦公告為準。`)}`, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
}
const originalEventDetail = eventDetail;
eventDetail = function eventDetailWithCalendar(id) {
  originalEventDetail(id);
  if (!state.registrations.includes(id)) return;
  const actions = document.querySelector('#modal .form-actions');
  if (actions) actions.insertAdjacentHTML('afterbegin', button(`${icon('calendar')}加入行事曆`, 'event-ics', `data-id="${esc(id)}"`, 'secondary'));
};

/* ------------------------------------------------------------------ *
 * Event wiring for v3 actions, forms and settings
 * ------------------------------------------------------------------ */
document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  const action = target.dataset.action;
  const signedInActions = ['study-settings', 'review-reveal', 'review-rate', 'review-speak', 'tutor-chip', 'tutor-clear', 'focus-open', 'focus-start', 'focus-cancel', 'share-card', 'choose-goal', 'open-lesson-direct', 'event-ics'];
  if (!signedInActions.includes(action)) return;
  if (!state.signedIn) return;
  if (action === 'study-settings') {
    settingsModal();
  } else if (action === 'review-reveal') {
    reviewRevealed = true;
    render();
  } else if (action === 'review-rate') {
    rateCard(target.dataset.card, target.dataset.rating);
  } else if (action === 'review-speak') {
    const id = reviewQueue[0];
    if (id) speak(cardContent(id).front);
  } else if (action === 'tutor-chip') {
    askTutor(target.dataset.text);
  } else if (action === 'tutor-clear') {
    withMutationLock(() => {
      study().tutorLog = [];
      pendingQuiz = null;
      save();
      render();
    });
  } else if (action === 'focus-open') {
    openFocus();
  } else if (action === 'focus-start') {
    startFocus(Number(target.dataset.minutes));
  } else if (action === 'focus-cancel') {
    cancelFocus();
    closeModal();
  } else if (action === 'share-card') {
    shareProgress();
  } else if (action === 'choose-goal') {
    const xp = Number(target.dataset.xp);
    withMutationLock(() => {
      if (!GOALS.some(goal => goal.xp === xp)) return;
      study().dailyGoal = xp;
      study().goalChosen = true;
      save();
      render();
      toast(`每日目標設為 ${xp} XP。`);
    });
  } else if (action === 'open-lesson-direct') {
    const course = courses.find(item => item.id === target.dataset.id);
    if (!course || !unlocked(course)) return;
    ui.course = course.id;
    ui.lesson = Number(target.dataset.index);
    navigate(`course/${course.id}`);
    startLesson(course.id, ui.lesson);
  } else if (action === 'event-ics') {
    const record = visibleEvents().find(item => item.id === target.dataset.id);
    if (record) downloadFile(`guangyao-${record.id}.ics`, icsFor(record), 'text/calendar;charset=utf-8');
  }
});

document.addEventListener('submit', event => {
  const form = event.target.closest('[data-form="lesson-cloze"], [data-form="tutor"], [data-form="study-settings"]');
  if (!form) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const data = new FormData(form);
  if (form.dataset.form === 'lesson-cloze' && session && !session.answered) {
    const value = String(data.get('answer') || '');
    const content = LESSON_CONTENT[session.key];
    const correct = content.cloze.answers.some(answer => normalizeAnswer(answer) === normalizeAnswer(value));
    session.results.cloze = {value, correct};
    session.answered = true;
    renderLessonStep();
  } else if (form.dataset.form === 'tutor') {
    askTutor(String(data.get('question') || ''));
  } else if (form.dataset.form === 'study-settings') {
    withMutationLock(() => {
      const settings = study().settings;
      const theme = String(data.get('theme'));
      const textSize = String(data.get('textSize'));
      const speechRate = Number(data.get('speechRate'));
      const dailyGoal = Number(data.get('dailyGoal'));
      if (['system', 'light', 'dark'].includes(theme)) settings.theme = theme;
      if (['normal', 'large', 'xl'].includes(textSize)) settings.textSize = textSize;
      if ([0.8, 1, 1.2].includes(speechRate)) settings.speechRate = speechRate;
      if (GOALS.some(goal => goal.xp === dailyGoal)) {
        study().dailyGoal = dailyGoal;
        study().goalChosen = true;
      }
      save();
      closeModal();
      render();
      toast('設定已儲存。');
    });
  }
}, true);

document.addEventListener('change', event => {
  if (event.target.matches('[data-setting-tutor-scope]')) {
    tutorScope = Object.keys(LESSON_CONTENT).includes(event.target.value) ? event.target.value : 'all';
    pendingQuiz = null;
    render();
  } else if (event.target.matches('[data-setting-ai]')) {
    const enabled = event.target.checked;
    if (enabled) {
      event.target.checked = false;
      modal('開啟雲端 AI？', `<p>雲端 AI 透過 <strong>Puter</strong>（第三方服務）執行，需要免費的 Puter 帳號，費用由你的 Puter 免費額度支付。</p><ul class="install-steps"><li>你的問題和相關的課程摘錄會傳送到 Puter 與其 AI 供應商。</li><li>請勿輸入個人、宗教、健康或財務等敏感資訊。</li><li>AI 可能出錯；光光會被要求只依課程回答並標示出處。</li><li>可隨時關閉，關閉後立即改回離線學伴。</li></ul><div class="form-actions">${button('先不要', 'close', '', 'secondary')}${button('我了解，開啟', 'ai-confirm')}</div>`);
    } else {
      withMutationLock(() => {
        study().settings.aiOptIn = false;
        save();
        render();
        toast('已關閉雲端 AI，改用離線學伴。');
      });
    }
  }
});
document.addEventListener('click', event => {
  if (!event.target.closest('[data-action="ai-confirm"]') || !state.signedIn) return;
  withMutationLock(() => {
    study().settings.aiOptIn = true;
    save();
    closeModal();
    render();
    toast('已開啟雲端 AI。第一次提問時會請你登入 Puter。');
  });
});

window.GY_PAGES = {review: reviewPage, tutor: tutorPage, stats: statsPage};
window.GY_STUDY = {today, addDays, scheduleCard, currentStreak, longestStreak, dueCards, retrieve, localTutor, icsFor, normalizeStudyState, xpToday};
