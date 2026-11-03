import CoreLocation
import SwiftData
import UIKit

/// Sample content for `-demo` launches (simulator screenshots, App Store captures, first-look demos).
/// Lives only in an in-memory store, so it never mixes with a real diary.
@MainActor
enum DemoData {
    private struct SampleDay {
        let daysAgo: Int
        let weather: SceneKey.Weather
        let temperatureC: Double
        let note: CozyLabel
        let mood: Int
        let walkedMeters: Double
        let pioneeredMeters: Double
        let doodle: String?
    }

    private static let sampleDays: [SampleDay] = [
        SampleDay(
            daysAgo: 0, weather: .clear, temperatureC: 14,
            note: CozyLabel(ja: "近所の猫が、やっと撫でさせてくれた。", ko: "동네 고양이가 드디어 만지게 해 줬다.", en: "The neighbourhood cat finally let me pet her."),
            mood: 5, walkedMeters: 4_200, pioneeredMeters: 800, doodle: "demo_cat"
        ),
        SampleDay(
            daysAgo: 1, weather: .partlyCloudy, temperatureC: 12,
            note: CozyLabel(ja: "角の喫茶店で、窓ぎわの席。", ko: "모퉁이 카페, 창가 자리.", en: "Window seat at the corner café."),
            mood: 4, walkedMeters: 2_600, pioneeredMeters: 0, doodle: "demo_coffee"
        ),
        SampleDay(
            daysAgo: 2, weather: .rain, temperatureC: 9,
            note: CozyLabel(ja: "雨の音を聞きながら、本を一冊。", ko: "빗소리 들으며 책 한 권.", en: "Read a whole book to the sound of rain."),
            mood: 3, walkedMeters: 600, pioneeredMeters: 0, doodle: nil
        ),
        SampleDay(
            daysAgo: 3, weather: .cloudy, temperatureC: 11,
            note: CozyLabel(ja: "花屋さんで小さなブーケを買った。", ko: "꽃집에서 작은 꽃다발을 샀다.", en: "Bought a tiny bouquet at the flower shop."),
            mood: 4, walkedMeters: 3_100, pioneeredMeters: 450, doodle: "demo_flowers"
        ),
        SampleDay(
            daysAgo: 4, weather: .clear, temperatureC: 15,
            note: CozyLabel(ja: "知らない坂道をのぼってみた。", ko: "모르는 언덕길을 올라 봤다.", en: "Took an unknown slope just to see."),
            mood: 5, walkedMeters: 5_400, pioneeredMeters: 1_200, doodle: "demo_cat_watercolor"
        ),
        SampleDay(
            daysAgo: 6, weather: .fog, temperatureC: 8,
            note: CozyLabel(ja: "朝の霧で、町がやさしく見えた。", ko: "아침 안개에 동네가 부드러워 보였다.", en: "Morning fog made the town look soft."),
            mood: 4, walkedMeters: 1_900, pioneeredMeters: 300, doodle: "demo_coffee_pencil"
        ),
        SampleDay(
            daysAgo: 365, weather: .clear, temperatureC: 16,
            note: CozyLabel(ja: "はじめてこの町を歩いた日。", ko: "처음 이 동네를 걸은 날.", en: "My first walk around this town."),
            mood: 5, walkedMeters: 6_800, pioneeredMeters: 6_800, doodle: "demo_cat"
        ),
    ]

    private static let fragments: [CozyLabel] = [
        CozyLabel(ja: "パン屋は火曜休み", ko: "빵집은 화요일 휴무", en: "Bakery closed on Tuesdays"),
        CozyLabel(ja: "ゆっくりでいい", ko: "천천히 해도 돼", en: "Slow is fine"),
        CozyLabel(ja: "あの歌の名前、あとで調べる", ko: "그 노래 제목 나중에 찾아보기", en: "Look up the name of that song"),
    ]

    private struct SampleClip {
        let text: String
        let drawer: ClipDrawer
        let status: ClipStatus
        let daysAgo: Int
    }

    private static let sampleClips: [SampleClip] = [
        SampleClip(text: "Shinkansen Nozomi 23 Tokyo → Kyoto Car 7 Seat 12A", drawer: .tickets, status: .kept, daysAgo: 1),
        SampleClip(text: "Cafe Hidamari Yanaka 3-chome open 8:00-18:00", drawer: .places, status: .kept, daysAgo: 3),
        SampleClip(text: "Miso soup: dashi 400ml, miso 2 tbsp, tofu, wakame", drawer: .food, status: .kept, daysAgo: 4),
        SampleClip(text: "Order confirmed: linen tote bag ¥3,200", drawer: .shopping, status: .inbox, daysAgo: 0),
        SampleClip(text: "see you at the station at 6!", drawer: .chats, status: .inbox, daysAgo: 0),
        SampleClip(text: "\"The best way out is always through.\"", drawer: .words, status: .inbox, daysAgo: 1),
    ]

    /// A short loop through Yanaka, Tokyo, for the walk map.
    private static let walkRoute: [CLLocationCoordinate2D] = [
        .init(latitude: 35.7268, longitude: 139.7670), .init(latitude: 35.7262, longitude: 139.7683),
        .init(latitude: 35.7255, longitude: 139.7695), .init(latitude: 35.7246, longitude: 139.7702),
        .init(latitude: 35.7238, longitude: 139.7712), .init(latitude: 35.7229, longitude: 139.7705),
        .init(latitude: 35.7225, longitude: 139.7690), .init(latitude: 35.7231, longitude: 139.7676),
        .init(latitude: 35.7243, longitude: 139.7668), .init(latitude: 35.7256, longitude: 139.7663),
        .init(latitude: 35.7268, longitude: 139.7670),
    ]

    static func seed(into context: ModelContext, language: LanguageMode) {
        let calendar = Calendar.current
        let now = Date.now
        var daysByOffset: [Int: Day] = [:]

        for sample in sampleDays {
            guard let date = calendar.date(byAdding: .day, value: -sample.daysAgo, to: now) else { continue }
            let day = Day(date: date)
            day.weather = sample.weather.rawValue
            day.season = SceneKey.Season(date: date, latitude: 35.7).rawValue
            day.temperatureC = sample.temperatureC
            day.walkedMeters = sample.walkedMeters
            day.pioneeredMeters = sample.pioneeredMeters
            context.insert(day)

            let moment = Moment(kind: .note, text: noteText(sample.note, language), mood: sample.mood)
            moment.createdAt = calendar.date(byAdding: .hour, value: 15, to: day.date) ?? day.date
            if let name = sample.doodle, let picture = UIImage(named: "\(name).jpg") ?? UIImage(named: name) {
                moment.doodleData = picture.jpegData(compressionQuality: 0.85)
            }
            context.insert(moment)
            moment.day = day
            daysByOffset[sample.daysAgo] = day
        }

        for (index, label) in fragments.enumerated() {
            let fragment = Fragment(text: noteText(label, language))
            fragment.createdAt = calendar.date(byAdding: .day, value: -(index * 9 + 5), to: now) ?? now
            context.insert(fragment)
        }

        for (index, sample) in sampleClips.enumerated() {
            let captured = calendar.date(byAdding: .day, value: -sample.daysAgo, to: now) ?? now
            let clip = Clip(assetIdentifier: "demo-clip-\(index)", capturedAt: captured)
            clip.ocrText = sample.text
            clip.suggestedDrawerRaw = sample.drawer.rawValue
            clip.drawerRaw = sample.drawer.rawValue
            clip.statusRaw = sample.status.rawValue
            if sample.status == .kept {
                clip.reviewedAt = captured
            }
            context.insert(clip)
            clip.day = daysByOffset[sample.daysAgo]
        }

        for (offset, scale) in [(0, 1.0), (4, 1.6)] {
            let start = calendar.date(byAdding: .day, value: -offset, to: now) ?? now
            let walk = Walk(startedAt: start)
            walk.endedAt = start.addingTimeInterval(55 * 60)
            let fixes = walkRoute.map { coordinate in
                CLLocation(
                    latitude: 35.7247 + (coordinate.latitude - 35.7247) * scale,
                    longitude: 139.7687 + (coordinate.longitude - 139.7687) * scale
                )
            }
            walk.fixData = WalkRecorder.encode(fixes)
            walk.distanceMeters = zip(fixes, fixes.dropFirst()).reduce(0) { $0 + $1.0.distance(from: $1.1) }
            walk.pioneeredMeters = walk.distanceMeters * 0.3
            context.insert(walk)
        }

        try? context.save()
    }

    /// Notes are the user's own words, so the demo writes them in the language being shown
    /// (Japanese for duo, as a Japanese user would).
    private static func noteText(_ label: CozyLabel, _ language: LanguageMode) -> String {
        switch language {
        case .english: label.en
        case .korean: label.ko
        case .duo, .japanese: label.ja
        }
    }
}
