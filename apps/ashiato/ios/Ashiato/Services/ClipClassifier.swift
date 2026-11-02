import Foundation

/// Sorts screenshot OCR text into a drawer. Swift port of prototypes/tidy/tidy.py —
/// both read Resources/clip_lexicon.json so their results stay identical.
/// Pure and synchronous: easy to unit test with prototypes/tidy/samples.json.
struct ClipClassifier {
    struct Result {
        let drawer: ClipDrawer
        let score: Double
    }

    private struct DrawerRules {
        let keywords: [(String, Double)]
        let patterns: [(NSRegularExpression, Double)]
    }

    private struct LexiconFile: Decodable {
        struct Drawer: Decodable {
            let keywords: [String: Double]
            let patterns: [String: Double]
        }

        struct WordsRule: Decodable {
            let max_chars: Int
            let max_lines: Int
            let max_digit_ratio: Double
            let bonus: Double
        }

        let min_score: Double
        let drawers: [String: Drawer]
        let words_rule: WordsRule
    }

    static let maxPatternHits = 3

    private let minScore: Double
    private let rules: [ClipDrawer: DrawerRules]
    private let wordsRule: LexiconFile.WordsRule

    static let shared: ClipClassifier = {
        guard
            let url = Bundle.main.url(forResource: "clip_lexicon", withExtension: "json"),
            let data = try? Data(contentsOf: url),
            let classifier = try? ClipClassifier(lexiconData: data)
        else {
            fatalError("clip_lexicon.json missing or invalid")
        }
        return classifier
    }()

    init(lexiconData: Data) throws {
        let file = try JSONDecoder().decode(LexiconFile.self, from: lexiconData)
        minScore = file.min_score
        wordsRule = file.words_rule
        var built: [ClipDrawer: DrawerRules] = [:]
        for (name, drawer) in file.drawers {
            guard let key = ClipDrawer(rawValue: name) else { continue }
            let patterns = try drawer.patterns.map { pattern, weight in
                (try NSRegularExpression(pattern: pattern, options: [.caseInsensitive, .anchorsMatchLines]), weight)
            }
            built[key] = DrawerRules(
                keywords: drawer.keywords.map { ($0.key.lowercased(), $0.value) },
                patterns: patterns
            )
        }
        rules = built
    }

    func scores(for text: String) -> [ClipDrawer: Double] {
        let lowered = text.lowercased()
        let range = NSRange(text.startIndex..., in: text)
        var result: [ClipDrawer: Double] = [:]
        for (drawer, rule) in rules {
            var score = 0.0
            for (keyword, weight) in rule.keywords where lowered.contains(keyword) {
                score += weight
            }
            for (pattern, weight) in rule.patterns {
                let hits = pattern.numberOfMatches(in: text, range: range)
                score += Double(min(hits, Self.maxPatternHits)) * weight
            }
            result[drawer] = score
        }

        // Short, digit-free, prose-like text → a fragment for the words drawer.
        let compact = text.filter { !$0.isWhitespace }
        let lineCount = text.split(whereSeparator: \.isNewline).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }.count
        if !compact.isEmpty, compact.count <= wordsRule.max_chars, lineCount <= wordsRule.max_lines {
            // Match Python's str.isdigit (decimal/digit only — not CJK numerals like 一).
            let digits = compact.filter { character in
                guard let numericType = character.unicodeScalars.first?.properties.numericType else { return false }
                return numericType == .decimal || numericType == .digit
            }
            let digitRatio = Double(digits.count) / Double(compact.count)
            if digitRatio <= wordsRule.max_digit_ratio {
                result[.words, default: 0] += wordsRule.bonus
            }
        }
        return result
    }

    func classify(_ text: String) -> Result {
        let all = scores(for: text)
        guard let best = all.max(by: { $0.value < $1.value }), best.value >= minScore else {
            return Result(drawer: .other, score: all.values.max() ?? 0)
        }
        return Result(drawer: best.key, score: best.value)
    }
}

/// Finds the earliest upcoming date in a ticket/coupon ("11月14日", "2026.12.20", "Nov 14").
enum ExpiryFinder {
    private static let rawPatterns: [(String, [String])] = [
        (#"(20\d{2})[./-](\d{1,2})[./-](\d{1,2})"#, ["y", "m", "d"]),
        (#"(20\d{2})\s?[年년]\s?(\d{1,2})\s?[月월]\s?(\d{1,2})\s?[日일]?"#, ["y", "m", "d"]),
        (#"(\d{1,2})\s?[月월]\s?(\d{1,2})\s?[日일]"#, ["m", "d"]),
        (#"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})\b"#, ["mon", "d"]),
    ]

    private static let patterns: [(NSRegularExpression, [String])] = rawPatterns.map { entry in
        (try! NSRegularExpression(pattern: entry.0, options: [.caseInsensitive]), entry.1)
    }

    private static let months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

    static func expiry(in text: String, today: Date = .now, calendar: Calendar = .current) -> Date? {
        let startOfToday = calendar.startOfDay(for: today)
        let currentYear = calendar.component(.year, from: today)
        let range = NSRange(text.startIndex..., in: text)
        var found: [Date] = []

        for (pattern, fields) in patterns {
            for match in pattern.matches(in: text, range: range) {
                var parts: [String: String] = [:]
                for (offset, field) in fields.enumerated() {
                    if let groupRange = Range(match.range(at: offset + 1), in: text) {
                        parts[field] = String(text[groupRange])
                    }
                }
                let month: Int?
                if let name = parts["mon"] {
                    month = months.firstIndex(of: String(name.prefix(3)).lowercased()).map { $0 + 1 }
                } else {
                    month = parts["m"].flatMap(Int.init)
                }
                guard let month, let day = parts["d"].flatMap(Int.init) else { continue }
                let explicitYear = parts["y"].flatMap(Int.init)
                var components = DateComponents(year: explicitYear ?? currentYear, month: month, day: day)
                guard var date = calendar.date(from: components), calendar.component(.day, from: date) == day else { continue }
                if explicitYear == nil, date < startOfToday {
                    components.year = currentYear + 1
                    guard let nextYear = calendar.date(from: components) else { continue }
                    date = nextYear
                }
                if date >= startOfToday {
                    found.append(date)
                }
            }
        }
        return found.min()
    }
}
