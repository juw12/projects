import Foundation
import SwiftData

// MARK: - Core data model (SwiftData, synced with CloudKit private database)
// CloudKit rule: every property needs a default value or must be optional,
// and relationships must be optional.

@Model
final class Day {
    var date: Date = Date.now            // start of day, local time
    var weather: String = SceneKey.Weather.clear.rawValue
    var season: String = SceneKey.Season.spring.rawValue
    var temperatureC: Double?
    var walkedMeters: Double = 0
    var pioneeredMeters: Double = 0
    @Relationship(deleteRule: .cascade, inverse: \Moment.day)
    var moments: [Moment]? = []
    /// Screenshots taken that day (Clutter layer). Nullify: tidying never deletes a day.
    @Relationship(deleteRule: .nullify, inverse: \Clip.day)
    var clips: [Clip]? = []

    init(date: Date) {
        self.date = Calendar.current.startOfDay(for: date)
    }

    var sortedMoments: [Moment] {
        (moments ?? []).sorted { $0.createdAt < $1.createdAt }
    }

    var averageMood: Double? {
        let moods = (moments ?? []).compactMap(\.mood)
        guard !moods.isEmpty else { return nil }
        return Double(moods.reduce(0, +)) / Double(moods.count)
    }
}

enum MomentKind: String, Codable, CaseIterable {
    case photo, note, voice, mood, place
}

@Model
final class Moment {
    var id: UUID = UUID()
    var createdAt: Date = Date.now
    var kindRaw: String = MomentKind.note.rawValue
    var text: String = ""
    var mood: Int?                       // 1...5
    var latitude: Double?
    var longitude: Double?
    @Attribute(.externalStorage) var photoData: Data?
    @Attribute(.externalStorage) var doodleData: Data?
    var doodleStyle: String = DoodleStyle.crayon.rawValue
    var day: Day?

    init(kind: MomentKind, text: String = "", mood: Int? = nil) {
        self.kindRaw = kind.rawValue
        self.text = text
        self.mood = mood
    }

    var kind: MomentKind { MomentKind(rawValue: kindRaw) ?? .note }
}

/// echor-style short fragment: no tags, no folders, max 70 characters.
@Model
final class Fragment {
    static let maxLength = 70
    var id: UUID = UUID()
    var text: String = ""
    var createdAt: Date = Date.now
    var lastSurfacedAt: Date?

    init(text: String) {
        self.text = String(text.prefix(Fragment.maxLength))
    }
}

@Model
final class Walk {
    var id: UUID = UUID()
    var startedAt: Date = Date.now
    var endedAt: Date?
    var distanceMeters: Double = 0
    var pioneeredMeters: Double = 0
    /// Encoded polyline of raw fixes (lat,lon pairs, Float32) for re-matching later.
    @Attribute(.externalStorage) var fixData: Data?

    init(startedAt: Date = .now) {
        self.startedAt = startedAt
    }
}

/// A walked road segment, keyed by a stable ID from the road graph tile.
@Model
final class RoadSegment {
    var segmentID: String = ""
    var tileID: String = ""
    var visitCount: Int = 0
    var firstVisited: Date = Date.now
    var lastVisited: Date = Date.now
    var lengthMeters: Double = 0

    init(segmentID: String, tileID: String, lengthMeters: Double) {
        self.segmentID = segmentID
        self.tileID = tileID
        self.lengthMeters = lengthMeters
    }
}

@Model
final class PromptRecord {
    var date: Date = Date.now
    var text: String = ""
    var category: String = ""
    var kept: Bool = false

    init(date: Date, text: String, category: String) {
        self.date = date
        self.text = text
        self.category = category
    }
}

// MARK: - Screenshot tidy-up (Clutter layer)

/// Drawers mirror ios/Resources/clip_lexicon.json keys.
enum ClipDrawer: String, Codable, CaseIterable, Identifiable {
    case shopping, places, food, tickets, chats, words, other

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .shopping: "bag"
        case .places: "mappin.and.ellipse"
        case .food: "fork.knife"
        case .tickets: "ticket"
        case .chats: "bubble.left.and.bubble.right"
        case .words: "pencil.and.scribble"
        case .other: "tray"
        }
    }

    var label: CozyLabel {
        switch self {
        case .shopping: CozyLabel(ja: "かいもの", ko: "쇼핑", en: "Shopping")
        case .places: CozyLabel(ja: "おでかけ", ko: "나들이", en: "Places")
        case .food: CozyLabel(ja: "ごはん", ko: "요리", en: "Food & recipes")
        case .tickets: CozyLabel(ja: "チケット", ko: "티켓", en: "Tickets & bookings")
        case .chats: CozyLabel(ja: "やりとり", ko: "대화", en: "Chats")
        case .words: CozyLabel(ja: "ことば", ko: "글귀", en: "Words")
        case .other: CozyLabel(ja: "そのほか", ko: "기타", en: "Other")
        }
    }
}

enum ClipStatus: String, Codable {
    case inbox      // not reviewed yet
    case kept       // filed into a drawer
    case later      // "あとで" — comes back next session
    case letGo      // queued for deletion from Photos (committed in one batch)
}

/// One screenshot. The image itself stays in the Photos library; we keep only
/// the reference, OCR text and the user's filing, so nothing is duplicated.
@Model
final class Clip {
    var assetIdentifier: String = ""        // PHAsset.localIdentifier (this device)
    var cloudIdentifier: String?            // PHCloudIdentifier string, to resolve on other devices
    var capturedAt: Date = Date.now
    var ocrText: String = ""
    var suggestedDrawerRaw: String = ClipDrawer.other.rawValue
    var drawerRaw: String = ClipDrawer.other.rawValue
    var statusRaw: String = ClipStatus.inbox.rawValue
    var note: String = ""
    var tags: [String] = []
    var expiresAt: Date?                    // tickets/coupons: suggest letting go after this
    var duplicateOfIdentifier: String?      // near-identical to another screenshot
    var reviewedAt: Date?
    var day: Day?

    init(assetIdentifier: String, capturedAt: Date) {
        self.assetIdentifier = assetIdentifier
        self.capturedAt = capturedAt
    }

    var drawer: ClipDrawer {
        get { ClipDrawer(rawValue: drawerRaw) ?? .other }
        set { drawerRaw = newValue.rawValue }
    }

    var suggestedDrawer: ClipDrawer { ClipDrawer(rawValue: suggestedDrawerRaw) ?? .other }

    var status: ClipStatus {
        get { ClipStatus(rawValue: statusRaw) ?? .inbox }
        set { statusRaw = newValue.rawValue }
    }
}

enum AshiatoSchema {
    static let models: [any PersistentModel.Type] = [
        Day.self, Moment.self, Fragment.self, Walk.self, RoadSegment.self, PromptRecord.self, Clip.self,
    ]
}
