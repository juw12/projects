import UIKit

/// Loads the bundled cozy 3D diorama for a scene key.
/// Files: Resources/Scenes/<weather>__<time>__<season>.jpg
/// (rendered by prototypes/cozy3d/diorama.js — keep names in sync with SceneKey).
extension SceneKey {
    var image: UIImage? {
        UIImage(named: "\(assetName).jpg") ?? UIImage(named: assetName)
    }
}

/// Soft bilingual labels used on cards: Japanese hiragana, Korean, English.
struct CozyLabel {
    let ja: String
    let ko: String
    let en: String

    var line: String { "\(ja) · \(ko)" }
}

extension SceneKey.Weather {
    var cozyLabel: CozyLabel {
        switch self {
        case .clear: CozyLabel(ja: "はれ", ko: "맑음", en: "clear")
        case .partlyCloudy: CozyLabel(ja: "うすぐもり", ko: "구름 조금", en: "partly cloudy")
        case .cloudy: CozyLabel(ja: "くもり", ko: "흐림", en: "cloudy")
        case .rain: CozyLabel(ja: "あめ", ko: "비", en: "rain")
        case .storm: CozyLabel(ja: "あらし", ko: "폭풍", en: "storm")
        case .snow: CozyLabel(ja: "ゆき", ko: "눈", en: "snow")
        case .fog: CozyLabel(ja: "きり", ko: "안개", en: "fog")
        case .heat: CozyLabel(ja: "あつい", ko: "무더위", en: "hot")
        }
    }
}

extension SceneKey.TimeOfDay {
    var cozyLabel: CozyLabel {
        switch self {
        case .dawn: CozyLabel(ja: "あけがた", ko: "새벽", en: "dawn")
        case .morning: CozyLabel(ja: "あさ", ko: "아침", en: "morning")
        case .noon: CozyLabel(ja: "ひる", ko: "낮", en: "afternoon")
        case .dusk: CozyLabel(ja: "ゆうがた", ko: "해질녘", en: "dusk")
        case .night: CozyLabel(ja: "よる", ko: "밤", en: "night")
        case .lateNight: CozyLabel(ja: "しんや", ko: "깊은 밤", en: "late night")
        }
    }
}

extension SceneKey.Season {
    var cozyLabel: CozyLabel {
        switch self {
        case .spring: CozyLabel(ja: "はる", ko: "봄", en: "spring")
        case .summer: CozyLabel(ja: "なつ", ko: "여름", en: "summer")
        case .autumn: CozyLabel(ja: "あき", ko: "가을", en: "autumn")
        case .winter: CozyLabel(ja: "ふゆ", ko: "겨울", en: "winter")
        }
    }
}

extension String {
    /// True when the text contains Hangul, so notes can switch to the Korean hand font.
    var containsHangul: Bool {
        unicodeScalars.contains { (0xAC00...0xD7A3).contains($0.value) || (0x3131...0x318E).contains($0.value) }
    }
}
