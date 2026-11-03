import Foundation

enum DoodleStyle: String, Codable, CaseIterable, Identifiable {
    case crayon, pencil, watercolor

    var id: String { rawValue }

    var label: CozyLabel {
        switch self {
        case .crayon: CozyLabel(ja: "クレヨン", ko: "크레용", en: "Crayon")
        case .pencil: CozyLabel(ja: "えんぴつ", ko: "연필", en: "Pencil")
        case .watercolor: CozyLabel(ja: "すいさい", ko: "수채화", en: "Watercolor")
        }
    }

    var displayName: String { label.en }

    /// Free tier gets crayon; the others are Haru Plus styles.
    var isPremium: Bool { self != .crayon }
}
