import Foundation

/// Decides what comes back from the past. Pure functions so they are easy to unit test.
enum Resurfacer {
    struct Memory: Identifiable {
        let day: Day
        let label: String
        /// 0 = "1 month ago", otherwise whole years.
        var yearsAgo: Int = 0
        var id: Date { day.date }

        /// "1年前 · 1년 전" / "1ヶ月前 · 한 달 전" for the card ribbon.
        var cozyLabel: CozyLabel {
            yearsAgo == 0
                ? CozyLabel(ja: "1ヶ月前", ko: "한 달 전", en: label)
                : CozyLabel(ja: "\(yearsAgo)年前", ko: "\(yearsAgo)년 전", en: label)
        }
    }

    /// Same calendar day 1 month, and 1+ years ago.
    static func onThisDay(in days: [Day], today: Date = .now, calendar: Calendar = .current) -> [Memory] {
        let todayParts = calendar.dateComponents([.year, .month, .day], from: today)
        var result: [Memory] = []
        for day in days {
            let parts = calendar.dateComponents([.year, .month, .day], from: day.date)
            guard parts.day == todayParts.day, !calendar.isDate(day.date, inSameDayAs: today) else { continue }
            if parts.month == todayParts.month, let year = parts.year, let thisYear = todayParts.year, year < thisYear {
                let years = thisYear - year
                result.append(Memory(day: day, label: years == 1 ? "1 year ago" : "\(years) years ago", yearsAgo: years))
            } else if let monthsAgo = calendar.dateComponents([.month], from: day.date, to: today).month, monthsAgo == 1 {
                result.append(Memory(day: day, label: "1 month ago"))
            }
        }
        return result.sorted { $0.day.date > $1.day.date }
    }

    /// Weighted toward fragments that haven't surfaced for a long time.
    static func randomFragment(from fragments: [Fragment], now: Date = .now) -> Fragment? {
        guard !fragments.isEmpty else { return nil }
        let weights = fragments.map { fragment -> Double in
            let last = fragment.lastSurfacedAt ?? fragment.createdAt
            let days = max(1, now.timeIntervalSince(last) / 86_400)
            return min(days, 365)
        }
        var pick = Double.random(in: 0..<weights.reduce(0, +))
        for (fragment, weight) in zip(fragments, weights) {
            pick -= weight
            if pick < 0 { return fragment }
        }
        return fragments.last
    }
}

struct DailyPrompt {
    let label: CozyLabel
    let category: String

    /// Stable English text, used when saving a PromptRecord.
    var text: String { label.en }
}

/// One Good Thing-style daily prompt; deterministic per date so it's stable all day.
enum PromptLibrary {
    static let prompts: [DailyPrompt] = [
        DailyPrompt(label: CozyLabel(ja: "今日の道で、青いものをひとつ見つけて。", ko: "오늘 가는 길에 파란 것을 하나 찾아봐요.", en: "Find something blue on your way today."), category: "noticing"),
        DailyPrompt(label: CozyLabel(ja: "今朝、どんな音に気づいた？", ko: "오늘 아침, 어떤 소리를 들었나요?", en: "What sound did you notice this morning?"), category: "noticing"),
        DailyPrompt(label: CozyLabel(ja: "帰り道、いつもと違う道で。", ko: "집에 갈 때 다른 길로 가봐요.", en: "Take a different street home."), category: "walking"),
        DailyPrompt(label: CozyLabel(ja: "うまくいった小さなことは？", ko: "잘 풀린 작은 일 하나는?", en: "What's one small thing that went right?"), category: "gratitude"),
        DailyPrompt(label: CozyLabel(ja: "影を一枚、撮ってみて。", ko: "그림자를 한 장 찍어봐요.", en: "Photograph a shadow."), category: "creativity"),
        DailyPrompt(label: CozyLabel(ja: "最近、だれに笑顔をもらった？", ko: "요즘 누가 웃게 해줬나요?", en: "Who made you smile recently?"), category: "people"),
        DailyPrompt(label: CozyLabel(ja: "今日の空気は、どんなにおい？", ko: "오늘 공기는 어떤 냄새인가요?", en: "What does the air smell like today?"), category: "noticing"),
        DailyPrompt(label: CozyLabel(ja: "まだ見たことのない木に出会うまで歩こう。", ko: "아직 본 적 없는 나무를 만날 때까지 걸어봐요.", en: "Walk until you find a tree you've never looked at."), category: "walking"),
        DailyPrompt(label: CozyLabel(ja: "ふと耳にした言葉を書きとめて。", ko: "우연히 들은 한 문장을 적어봐요.", en: "Write down a sentence you overheard."), category: "fragments"),
        DailyPrompt(label: CozyLabel(ja: "一年前の自分に、なんて言う？", ko: "1년 전의 나에게 뭐라고 말할까요?", en: "What would you tell yourself a year ago?"), category: "reflection"),
    ]

    static func prompt(for date: Date, calendar: Calendar = .current) -> DailyPrompt {
        let dayNumber = calendar.ordinality(of: .day, in: .era, for: date) ?? 0
        return prompts[dayNumber % prompts.count]
    }
}
