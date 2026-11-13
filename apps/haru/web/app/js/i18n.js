// Every piece of UI copy in one place (port of ios/Shared/Language.swift `Copy`).
// Tone: gentle invitations — never "streak", "goal", "you missed" or "delete".

export const LANGS = ["duo", "english", "japanese", "korean"];

export const LANG_TITLES = {
  duo: "日本語 · 한국어",
  english: "English",
  japanese: "日本語",
  korean: "한국어",
};

const L = (ja, ko, en) => ({ ja, ko, en });

let mode = localStorage.getItem("ui.languageMode") || systemDefault();

function systemDefault() {
  const preferred = (navigator.languages && navigator.languages[0]) || navigator.language || "en";
  return preferred.startsWith("ja") || preferred.startsWith("ko") ? "duo" : "english";
}

export function lang() {
  return mode;
}

export function setLang(next) {
  mode = next;
  localStorage.setItem("ui.languageMode", next);
  document.documentElement.lang = next === "english" ? "en" : next === "korean" ? "ko" : "ja";
}

/** Full text: "はれ · 맑음", "clear", "はれ" or "맑음". */
export function t(label) {
  if (typeof label === "string") return label;
  switch (mode) {
    case "duo":
      return label.ja === label.ko ? label.ja : `${label.ja} · ${label.ko}`;
    case "japanese":
      return label.ja;
    case "korean":
      return label.ko;
    default:
      return label.en;
  }
}

/** Compact text for tight spots (tabs, stamps): duo shows only the Japanese. */
export function short(label) {
  if (typeof label === "string") return label;
  if (mode === "duo" || mode === "japanese") return label.ja;
  if (mode === "korean") return label.ko;
  return label.en;
}

/** BCP-47 locale for dates. */
export function locale() {
  return { duo: "ja-JP", japanese: "ja-JP", korean: "ko-KR", english: "en-US" }[mode];
}

export function weekday(date) {
  if (mode === "duo") {
    const ja = date.toLocaleDateString("ja-JP", { weekday: "long" });
    const ko = date.toLocaleDateString("ko-KR", { weekday: "long" });
    return `${ja} · ${ko}`;
  }
  return date.toLocaleDateString(locale(), { weekday: "long" });
}

export const C = {
  appName: L("Haru", "Haru", "Haru"),
  tagline: L(
    "あなたの毎日が、歩いてめぐる小さな町に。",
    "당신의 하루하루가 걸어서 도는 작은 마을이 돼요.",
    "Your days, as a little town you walk through."
  ),
  today: L("きょう", "오늘", "Today"),
  days: L("ひび", "나날", "Days"),
  map: L("ちず", "지도", "Map"),
  memories: L("おもいで", "추억", "Memories"),
  yourMap: L("わたしの地図", "나의 지도", "Your map"),
  settings: L("設定", "설정", "Settings"),
  language: L("ことば", "언어", "Language"),

  walked: (d) => L(`あるいた ${d}`, `걸었어요 ${d}`, `walked ${d}`),
  newRoads: (d) => L(`新しい道 +${d}`, `새로운 길 +${d}`, `new roads +${d}`),
  thisDaysScreenshots: L("この日のスクショ", "이날의 스크린샷", "Screenshots from this day"),

  todaysPrompt: L("きょうの おだい", "오늘의 작은 질문", "Today's little prompt"),
  keepIt: L("のこす", "남기기", "Keep it"),
  letItGo: L("ながす", "흘려보내기", "Let it go"),
  walking: L("さんぽ中…", "산책 중…", "Walking…"),
  goForWalk: L("さんぽに行こう", "산책 갈까요", "Go for a walk"),
  start: L("はじめる", "시작", "Start"),
  stop: L("おわる", "끝", "Stop"),
  walksOnPhone: L(
    "さんぽは スマホで 記録されます",
    "산책은 휴대폰에서 기록돼요",
    "Walks are recorded on your phone"
  ),
  noLocation: L(
    "位置情報がオフです（設定でオンにできます）",
    "위치 정보가 꺼져 있어요 (설정에서 켤 수 있어요)",
    "Location is off (you can turn it on in Settings)"
  ),
  emptyToday: L(
    "＋で きょうを残そう",
    "＋로 오늘을 남겨요",
    "Tap + to add today"
  ),

  cards: L("カード", "카드", "Cards"),
  timeline: L("ならべる", "타임라인", "Timeline"),
  calendar: L("こよみ", "달력", "Calendar"),
  searchDays: L("ことばや天気でさがす", "글이나 날씨로 찾기", 'Search words or weather ("rain")'),
  nothingYet: L("まだ なにも", "아직 없어요", "Nothing here yet"),
  daysWillStack: L("日々がここに重なっていきます", "하루하루가 여기에 쌓여요", "Your days will stack up here."),
  swipeHint: L("← → めくる", "← → 넘기기", "← → swipe through"),

  onThisDay: L("この日に", "이날에는", "On this day"),
  yearsAgo: (n) => L(`${n}年前`, `${n}년 전`, n === 1 ? "1 year ago" : `${n} years ago`),
  weekAgo: L("1週間前", "일주일 전", "A week ago"),
  fragmentCameBack: L("かけらが もどってきた", "조각이 돌아왔어요", "A fragment came back"),
  fragments: L("かけら", "조각들", "Fragments"),
  drawers: L("引き出し", "서랍", "Drawers"),
  drawersEmpty: L(
    "スクショを片付けると、ここにしまわれます。",
    "스크린샷을 정리하면 여기에 담겨요.",
    "Tidy your screenshots and they'll be tucked away here."
  ),

  walksCount: (n) => L(`さんぽ ${n} 回`, `산책 ${n}번`, `${n} walks`),
  kmOnFoot: (km) => L(`歩いた距離 ${km.toFixed(1)} km`, `걸은 거리 ${km.toFixed(1)} km`, `${km.toFixed(1)} km on foot`),
  realMap: L("ほんものの地図", "실제 지도", "Real map"),
  noWalksYet: L("さんぽすると、道がここに描かれます", "산책하면 길이 여기에 그려져요", "Walk, and your streets get drawn here"),

  capture: L("残す", "남기기", "Capture"),
  moment: L("できごと", "순간", "Moment"),
  fragment: L("かけら", "조각", "Fragment"),
  cancel: L("やめる", "취소", "Cancel"),
  save: L("のこす", "저장", "Save"),
  close: L("とじる", "닫기", "Close"),
  addPhoto: L("写真をえらぶ", "사진 고르기", "Add a photo"),
  doodling: L("らくがき中…", "낙서하는 중…", "Doodling…"),
  style: L("かきかた", "그림체", "Style"),
  styles: {
    crayon: L("クレヨン", "크레용", "Crayon"),
    pencil: L("えんぴつ", "연필", "Pencil"),
    watercolor: L("すいさい", "수채화", "Watercolor"),
    photo: L("そのまま", "그대로", "As is"),
  },
  whatHappened: L("なにがあった？", "무슨 일이 있었나요?", "What happened?"),
  mood: L("きもち", "기분", "Mood"),
  passingThought: L("ふと思ったこと…", "문득 든 생각…", "A passing thought…"),
  fragmentFooter: (n, limit) =>
    L(`${n}/${limit} · フォルダもタグもなし`, `${n}/${limit} · 폴더도 태그도 없이`, `${n}/${limit} · no folders, no tags`),

  tidy: L("片付け", "정리", "Tidy up"),
  keep: L("しまう", "넣기", "keep"),
  letGo: L("てばなす", "보내기", "let go"),
  later: L("あとで", "나중에", "later"),
  allTidy: L("すっきり", "깔끔해요", "All tidy"),
  tidyMotto: L("ちいさな引き出しに、きちんと。", "작은 서랍에, 차곡차곡.", "Everything in its little drawer."),
  laterCount: (n) => L(`あとで ${n} 枚 — 明日またね`, `나중에 ${n}장 — 내일 또 봐요`, `${n} for later — see you tomorrow`),
  goesInto: (d) => L(`しまう先 → ${d}`, `넣을 곳 → ${d}`, `Goes into → ${d}`),
  until: (d) => L(`⏳ ${d} まで`, `⏳ ${d} 까지`, `⏳ until ${d}`),
  lookalike: L("そっくり", "비슷해요", "Lookalike"),
  screenshotsWaiting: (n) => L(`スクショが ${n} 枚`, `스크린샷 ${n}장`, `${n} screenshots waiting`),
  tidyInvite: L("スクショ、片付けませんか", "스크린샷, 정리해 볼까요", "Tidy your screenshots?"),
  tidyPrivacy: L(
    "文字の読み取りも仕分けも この端末の中だけ",
    "글자 읽기도 정리도 이 기기 안에서만",
    "Text is read and sorted on this device only"
  ),
  addScreenshots: L("スクショを入れる", "스크린샷 넣기", "Add screenshots"),
  reading: (i, n) => L(`よみとり中… ${i}/${n}`, `읽는 중… ${i}/${n}`, `Reading… ${i}/${n}`),
  readText: L("よみとった文字", "읽은 글자", "Text in this screenshot"),
  copy: L("コピー", "복사", "Copy"),
  copied: L("コピーしました", "복사했어요", "Copied"),
  letGoNote: L(
    "てばなしたスクショはHaruから消えます（元の写真はそのまま）",
    "보낸 스크린샷은 Haru에서만 사라져요 (원본 사진은 그대로)",
    "Let-go screenshots leave Haru only — your original photos stay put"
  ),
  changeDrawer: L("引き出しを変える", "서랍 바꾸기", "Move to another drawer"),
  empty: L("からっぽ", "비어 있어요", "Empty"),

  welcome: L("ようこそ", "어서 오세요", "Welcome"),
  next: L("つぎへ", "다음", "Next"),
  lookAround: L("サンプルの日々で見てみる", "샘플 나날로 둘러보기", "Look around with sample days"),
  startMine: L("じぶんの日記をはじめる", "나만의 일기 시작하기", "Start my own diary"),
  allowLocation: L("位置情報をつかう", "위치 정보 사용", "Use my location"),
  locationWhy: L(
    "きょうの天気で町の景色が変わり、歩いた道が地図に描かれます。位置はこの端末からどこにも送られません（天気を調べるときの大まかな位置をのぞく）。",
    "오늘 날씨에 따라 마을 풍경이 바뀌고, 걸은 길이 지도에 그려져요. 위치는 이 기기 밖으로 보내지 않아요 (날씨 조회용 대략적인 위치 제외).",
    "Today's weather changes your town's scene, and the streets you walk get drawn on your map. Your location never leaves this device (except a rough position to look up the weather)."
  ),
  maybeLater: L("あとで", "나중에", "Maybe later"),

  sampleDays: L("サンプルの日々", "샘플 나날", "Sample days"),
  sampleOn: L("いまはサンプルを表示中", "지금 샘플을 보는 중", "You're looking at sample days"),
  sampleBanner: L("サンプル表示中 — 設定で自分の日記へ", "샘플 보는 중 — 설정에서 내 일기로", "Sample days — switch to your diary in Settings"),
  weatherPlace: L("天気の場所", "날씨 장소", "Weather place"),
  myLocation: L("現在地", "현재 위치", "My location"),
  searchCity: L("町の名前でさがす", "도시 이름으로 찾기", "Search a town or city"),
  backup: L("バックアップ", "백업", "Backup"),
  exportData: L("書き出す", "내보내기", "Export"),
  importData: L("読み込む", "가져오기", "Import"),
  backupNote: L(
    "日記はこの端末の中だけに保存されます。別の端末へはファイルで移せます。",
    "일기는 이 기기 안에만 저장돼요. 다른 기기로는 파일로 옮길 수 있어요.",
    "Your diary lives on this device only. Move it to another device with a backup file."
  ),
  imported: L("読み込みました", "가져왔어요", "Imported"),
  getApps: L("アプリ版", "앱 버전", "Get the app"),
  getAppsNote: L(
    "Android・Windows・Mac 版はこちら。iPhone はホーム画面に追加でアプリのように使えます。",
    "Android·Windows·Mac 버전은 여기서. iPhone은 홈 화면에 추가하면 앱처럼 써요.",
    "Android, Windows and Mac versions are here. On iPhone, Add to Home Screen to use it like an app."
  ),
  version: L("バージョン", "버전", "Version"),
  widgetTitle: L("iPhone ウィジェット", "iPhone 위젯", "iPhone widget"),
  widgetNote: L(
    "今日の空と日記の数を、PocketDex・Cozy Island と並べて iPhone のホーム画面に。コードを保存しているあいだだけ、小さなまとめを ntfy.sh 経由で送ります。日記の文章・写真・場所は送りません。",
    "오늘의 하늘과 일기 수를 PocketDex·Cozy Island와 나란히 iPhone 홈 화면에. 코드를 저장해 둔 동안에만 작은 요약을 ntfy.sh를 거쳐 보내요. 일기 글·사진·장소는 보내지 않아요.",
    "Today's sky and your diary counts on the iPhone home screen, next to PocketDex and Cozy Island. While a code is saved, a small summary goes through the ntfy.sh relay. Diary text, photos and places are never sent."
  ),
  widgetSetup: L("ウィジェットの準備", "위젯 준비하기", "Set up the widget"),
  widgetCode: L("ウィジェットコード", "위젯 코드", "Widget code"),
  widgetSave: L("コードを保存", "코드 저장", "Save code"),
  widgetUnpair: L("連携をやめる", "연결 끊기", "Unpair"),
  widgetPaired: L("この端末は連携中", "이 기기는 연결됨", "Paired on this device"),
  widgetNotPaired: L("まだ連携していません", "아직 연결되지 않았어요", "Not paired"),
  widgetBadCode: L(
    "ウィジェットコードではないようです。準備ページからコピーしてください。",
    "위젯 코드가 아닌 것 같아요. 준비 페이지에서 복사해 주세요.",
    "That is not a widget code. Copy it from the setup page."
  ),
  widgetOffline: L(
    "いまはつながりません。オンラインでもう一度どうぞ。",
    "지금은 연결할 수 없어요. 온라인에서 다시 해 주세요.",
    "Could not reach the widget relay. Try again when you are online."
  ),

  weather: {
    clear: L("はれ", "맑음", "clear"),
    partly_cloudy: L("ときどきくもり", "구름 조금", "partly cloudy"),
    cloudy: L("くもり", "흐림", "cloudy"),
    rain: L("あめ", "비", "rain"),
    storm: L("あらし", "폭풍", "storm"),
    snow: L("ゆき", "눈", "snow"),
    fog: L("きり", "안개", "fog"),
    heat: L("あつい", "더위", "heat"),
  },
  time: {
    dawn: L("あけがた", "새벽", "dawn"),
    morning: L("あさ", "아침", "morning"),
    noon: L("ひる", "낮", "noon"),
    dusk: L("ゆうがた", "해질녘", "dusk"),
    night: L("よる", "밤", "night"),
    late_night: L("しんや", "한밤", "late night"),
  },
  season: {
    spring: L("はる", "봄", "spring"),
    summer: L("なつ", "여름", "summer"),
    autumn: L("あき", "가을", "autumn"),
    winter: L("ふゆ", "겨울", "winter"),
  },
  moodStamps: ["…", "ふつ", "よし", "楽", "嬉"],
  drawerLabels: {
    shopping: L("かいもの", "쇼핑", "Shopping"),
    places: L("おでかけ", "나들이", "Places"),
    food: L("ごはん", "요리", "Food & recipes"),
    tickets: L("チケット", "티켓", "Tickets & bookings"),
    chats: L("やりとり", "대화", "Chats"),
    words: L("ことば", "글귀", "Words"),
    other: L("そのほか", "기타", "Other"),
  },
  prompts: [
    L("きょう、いちばん おいしかったものは？", "오늘 가장 맛있었던 건?", "What tasted best today?"),
    L("ふと 見上げたら 何があった？", "문득 올려다보니 무엇이 있었나요?", "What did you see when you looked up?"),
    L("だれかに ありがとうと 言いたいことは？", "누군가에게 고맙다고 하고 싶은 일은?", "Something you'd like to thank someone for?"),
    L("きょうの 小さな 発見は？", "오늘의 작은 발견은?", "Today's small discovery?"),
    L("いま 聞こえる 音は？", "지금 들리는 소리는?", "What can you hear right now?"),
    L("明日の自分に ひとこと", "내일의 나에게 한마디", "A word for tomorrow's you"),
    L("きょう 歩いた道で 気になったものは？", "오늘 걸은 길에서 눈에 띈 것은?", "Something you noticed on today's walk?"),
  ],
};

export const DRAWERS = ["shopping", "places", "food", "tickets", "chats", "words", "other"];

export const DRAWER_ICONS = {
  shopping: "🛍️",
  places: "📍",
  food: "🍙",
  tickets: "🎫",
  chats: "💬",
  words: "✒️",
  other: "🗂️",
};
