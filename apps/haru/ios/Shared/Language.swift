import SwiftUI

/// How UI text is shown. `duo` is the signature cozy look (Japanese · Korean side by side);
/// the others are single-language modes. Stored in the App Group so widgets follow it.
enum LanguageMode: String, CaseIterable, Identifiable {
    case duo, english, japanese, korean

    var id: String { rawValue }

    static let storageKey = "ui.languageMode"
    static let sharedDefaults = UserDefaults(suiteName: "group.app.haru") ?? .standard

    /// First launch: follow the phone. Japanese/Korean phones get the duo look, everyone else English.
    static var systemDefault: LanguageMode {
        let preferred = Locale.preferredLanguages.first ?? "en"
        return preferred.hasPrefix("ja") || preferred.hasPrefix("ko") ? .duo : .english
    }

    /// Current setting, readable outside SwiftUI (widgets, services).
    static var current: LanguageMode {
        sharedDefaults.string(forKey: storageKey).flatMap(LanguageMode.init(rawValue:)) ?? systemDefault
    }

    /// Shown in the picker in its own language.
    var menuTitle: String {
        switch self {
        case .duo: "日本語 · 한국어"
        case .english: "English"
        case .japanese: "日本語"
        case .korean: "한국어"
        }
    }

    /// Locale for weekday names etc. (duo uses Japanese + Korean explicitly where it matters).
    var locale: Locale {
        switch self {
        case .duo, .japanese: Locale(identifier: "ja_JP")
        case .english: Locale(identifier: "en_US")
        case .korean: Locale(identifier: "ko_KR")
        }
    }
}

extension CozyLabel {
    /// Full text for a mode: "はれ · 맑음", "clear", "はれ" or "맑음".
    func text(_ mode: LanguageMode) -> String {
        switch mode {
        case .duo: "\(ja) · \(ko)"
        case .english: en
        case .japanese: ja
        case .korean: ko
        }
    }

    /// Compact text for tight spots (tab bar, stamps): duo shows only the Japanese.
    func short(_ mode: LanguageMode) -> String {
        switch mode {
        case .duo, .japanese: ja
        case .english: en
        case .korean: ko
        }
    }
}

private struct LanguageModeKey: EnvironmentKey {
    static let defaultValue: LanguageMode = .duo
}

extension EnvironmentValues {
    var language: LanguageMode {
        get { self[LanguageModeKey.self] }
        set { self[LanguageModeKey.self] = newValue }
    }
}

/// Every piece of UI copy, in one place. Tone: gentle invitations, never "streak", "goal",
/// "you missed" or "delete" (see docs/art-direction.md §3).
enum Copy {
    // Tabs & titles
    static let today = CozyLabel(ja: "きょう", ko: "오늘", en: "Today")
    static let days = CozyLabel(ja: "ひび", ko: "나날", en: "Days")
    static let map = CozyLabel(ja: "ちず", ko: "지도", en: "Map")
    static let memories = CozyLabel(ja: "おもいで", ko: "추억", en: "Memories")
    static let yourMap = CozyLabel(ja: "わたしの地図", ko: "나의 지도", en: "Your map")
    static let captureMoment = CozyLabel(ja: "いまを残す", ko: "지금을 남기기", en: "Capture a moment")
    static let settings = CozyLabel(ja: "設定", ko: "설정", en: "Settings")
    static let language = CozyLabel(ja: "ことば", ko: "언어", en: "Language")

    // Day cards
    static let notePlaceholder = CozyLabel(ja: "きょうの ひとこと…", ko: "오늘의 한마디…", en: "A word for today…")
    static func walked(_ distance: String) -> CozyLabel {
        CozyLabel(ja: "あるいた \(distance)", ko: "걸었어요 \(distance)", en: "walked \(distance)")
    }
    static func newRoads(_ distance: String) -> CozyLabel {
        CozyLabel(ja: "新しい道 +\(distance)", ko: "새로운 길 +\(distance)", en: "new roads +\(distance)")
    }
    static let thisDaysScreenshots = CozyLabel(ja: "この日のスクショ", ko: "이날의 스크린샷", en: "Screenshots from this day")

    // Today
    static let todaysPrompt = CozyLabel(ja: "きょうの おだい", ko: "오늘의 작은 질문", en: "Today's little prompt")
    static let keepIt = CozyLabel(ja: "のこす", ko: "남기기", en: "Keep it")
    static let letItGo = CozyLabel(ja: "ながす", ko: "흘려보내기", en: "Let it go")
    static let walking = CozyLabel(ja: "さんぽ中…", ko: "산책 중…", en: "Walking…")
    static let goForWalk = CozyLabel(ja: "さんぽに行こう", ko: "산책 갈까요", en: "Go for a walk")
    static let start = CozyLabel(ja: "はじめる", ko: "시작", en: "Start")
    static let stop = CozyLabel(ja: "おわる", ko: "끝", en: "Stop")

    // Days
    static let cards = CozyLabel(ja: "カード", ko: "카드", en: "Cards")
    static let timeline = CozyLabel(ja: "ならべる", ko: "타임라인", en: "Timeline")
    static let calendar = CozyLabel(ja: "こよみ", ko: "달력", en: "Calendar")
    static let searchDays = CozyLabel(ja: "ことばや天気でさがす", ko: "글이나 날씨로 찾기", en: "Search words or weather (\"rain\")")
    static let nothingYet = CozyLabel(ja: "まだ なにも", ko: "아직 없어요", en: "Nothing here yet")
    static let daysWillStack = CozyLabel(ja: "日々がここに重なっていきます", ko: "하루하루가 여기에 쌓여요", en: "Your days will stack up here.")

    // Memories
    static let onThisDay = CozyLabel(ja: "この日に", ko: "이날에는", en: "On this day")
    static let fragmentCameBack = CozyLabel(ja: "かけらが もどってきた", ko: "조각이 돌아왔어요", en: "A fragment came back")
    static let fragments = CozyLabel(ja: "かけら", ko: "조각들", en: "Fragments")
    static let drawers = CozyLabel(ja: "引き出し", ko: "서랍", en: "Drawers")
    static let drawersEmpty = CozyLabel(
        ja: "スクショを片付けると、ここにしまわれます。",
        ko: "스크린샷을 정리하면 여기에 담겨요.",
        en: "Tidy your screenshots and they'll be tucked away here."
    )

    // Map
    static func walksCount(_ count: Int) -> CozyLabel {
        CozyLabel(ja: "さんぽ \(count) 回", ko: "산책 \(count)번", en: "\(count) walks")
    }
    static func kmOnFoot(_ km: Double) -> CozyLabel {
        let value = String(format: "%.1f", km)
        return CozyLabel(ja: "歩いた距離 \(value) km", ko: "걸은 거리 \(value) km", en: "\(value) km on foot")
    }
    static let realMap = CozyLabel(ja: "ほんものの地図", ko: "실제 지도", en: "Real map")

    // Capture
    static let capture = CozyLabel(ja: "残す", ko: "남기기", en: "Capture")
    static let moment = CozyLabel(ja: "できごと", ko: "순간", en: "Moment")
    static let fragment = CozyLabel(ja: "かけら", ko: "조각", en: "Fragment")
    static let type = CozyLabel(ja: "しゅるい", ko: "종류", en: "Type")
    static let cancel = CozyLabel(ja: "やめる", ko: "취소", en: "Cancel")
    static let save = CozyLabel(ja: "のこす", ko: "저장", en: "Save")
    static let close = CozyLabel(ja: "とじる", ko: "닫기", en: "Close")
    static let addPhoto = CozyLabel(ja: "写真をえらぶ", ko: "사진 고르기", en: "Add a photo")
    static let doodling = CozyLabel(ja: "らくがき中…", ko: "낙서하는 중…", en: "Doodling…")
    static let style = CozyLabel(ja: "かきかた", ko: "그림체", en: "Style")
    static let whatHappened = CozyLabel(ja: "なにがあった？", ko: "무슨 일이 있었나요?", en: "What happened?")
    static let mood = CozyLabel(ja: "きもち", ko: "기분", en: "Mood")
    static let passingThought = CozyLabel(ja: "ふと思ったこと…", ko: "문득 든 생각…", en: "A passing thought…")
    static func fragmentFooter(_ count: Int, _ limit: Int) -> CozyLabel {
        CozyLabel(
            ja: "\(count)/\(limit) · フォルダもタグもなし",
            ko: "\(count)/\(limit) · 폴더도 태그도 없이",
            en: "\(count)/\(limit) · no folders, no tags"
        )
    }

    // Widget
    static let tapToAdd = CozyLabel(ja: "＋で きょうを残そう", ko: "＋로 오늘을 남겨요", en: "Tap + to add today")

    // Tidy-up (Clutter layer)
    static let tidy = CozyLabel(ja: "片付け", ko: "정리", en: "Tidy up")
    static let keep = CozyLabel(ja: "しまう", ko: "넣기", en: "keep")
    static let letGo = CozyLabel(ja: "てばなす", ko: "보내기", en: "let go")
    static let later = CozyLabel(ja: "あとで", ko: "나중에", en: "later")
    static let tidyHintDuo = "→ しまう 넣기 · ← てばなす 보내기 · ↑ あとで 나중에"
    static func tidyHint(_ mode: LanguageMode) -> String {
        mode == .duo ? tidyHintDuo : "→ \(keep.text(mode)) · ← \(letGo.text(mode)) · ↑ \(later.text(mode))"
    }
    static let allTidy = CozyLabel(ja: "すっきり", ko: "깔끔해요", en: "All tidy")
    static func canFree(_ size: String) -> CozyLabel {
        CozyLabel(ja: "約 \(size) あけられます", ko: "약 \(size) 비울 수 있어요", en: "About \(size) can be freed")
    }
    static let tidyMotto = CozyLabel(ja: "ちいさな引き出しに、きちんと。", ko: "작은 서랍에, 차곡차곡.", en: "Everything in its little drawer.")
    static func letGoAfter(_ date: String) -> CozyLabel {
        CozyLabel(ja: "\(date) のあと そっと手放す提案", ko: "\(date) 이후에 살며시 보내기 제안", en: "Suggest letting go after \(date)")
    }
    static func laterCount(_ count: Int) -> CozyLabel {
        CozyLabel(ja: "あとで \(count) 枚 — 明日またね", ko: "나중에 \(count)장 — 내일 또 봐요", en: "\(count) for later — see you tomorrow")
    }
    static func letGoFromPhotos(_ count: Int) -> CozyLabel {
        CozyLabel(ja: "\(count) 枚を写真から手放す", ko: "사진에서 \(count)장 보내기", en: "Let go of \(count) from Photos")
    }
    static let recentlyDeletedNote = CozyLabel(
        ja: "「最近削除した項目」に30日間のこります",
        ko: "'최근 삭제된 항목'에 30일 동안 남아 있어요",
        en: "They stay in Recently Deleted for 30 days"
    )
    static func goesInto(_ drawer: String) -> CozyLabel {
        CozyLabel(ja: "しまう先 → \(drawer)", ko: "넣을 곳 → \(drawer)", en: "Goes into → \(drawer)")
    }
    static func until(_ date: String) -> CozyLabel {
        CozyLabel(ja: "⏳ \(date) まで", ko: "⏳ \(date) 까지", en: "⏳ until \(date)")
    }
    static let lookalike = CozyLabel(ja: "そっくり", ko: "비슷해요", en: "Lookalike")
    static func screenshotsWaiting(_ count: Int) -> CozyLabel {
        CozyLabel(ja: "スクショが \(count) 枚", ko: "스크린샷 \(count)장", en: "\(count) screenshots waiting")
    }
    static let tidyInvite = CozyLabel(ja: "スクショ、片付けませんか", ko: "스크린샷, 정리해 볼까요", en: "Tidy your screenshots?")
    static let tidyNudge = CozyLabel(ja: "ちょっと片付けよう", ko: "잠깐 정리해요", en: "A small tidy-up")
    static let tidyPrivacy = CozyLabel(ja: "この iPhone の中だけで仕分けます", ko: "이 iPhone 안에서만 정리해요", en: "Sorted on this iPhone only")
    static let searchText = CozyLabel(ja: "文字でさがす", ko: "글자로 찾기", en: "Search the text")
    static let readText = CozyLabel(ja: "よみとった文字", ko: "읽은 글자", en: "Text in this screenshot")
    static let copy = CozyLabel(ja: "コピー", ko: "복사", en: "Copy")
    static let copied = CozyLabel(ja: "コピーしました", ko: "복사했어요", en: "Copied")
    static let note = CozyLabel(ja: "メモ", ko: "메모", en: "Note")
    static let notePrompt = CozyLabel(ja: "ひとこと…", ko: "한마디…", en: "A little note…")
    static let tagPrompt = CozyLabel(ja: "#タグ", ko: "#태그", en: "#tag")
    static func fineToLetGo(_ date: String) -> CozyLabel {
        CozyLabel(ja: "\(date) のあと手放してもよさそう", ko: "\(date) 이후엔 보내도 괜찮아요", en: "Fine to let go after \(date)")
    }
    static let changeDrawer = CozyLabel(ja: "引き出しを変える", ko: "서랍 바꾸기", en: "Move to another drawer")
}
