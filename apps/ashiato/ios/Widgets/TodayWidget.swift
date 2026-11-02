import SwiftData
import SwiftUI
import WidgetKit

/// Home-screen widget: today's scene with the latest doodle.
/// Re-renders hourly so the light changes through the day (DayCity-style).
struct TodayEntry: TimelineEntry {
    let date: Date
    let sceneKey: SceneKey
    let doodle: UIImage?
    let momentCount: Int
}

struct TodayProvider: TimelineProvider {
    func placeholder(in context: Context) -> TodayEntry {
        TodayEntry(date: .now, sceneKey: Self.key(at: .now, weather: .clear), doodle: nil, momentCount: 0)
    }

    func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
        completion(placeholder(in: context))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
        Task { @MainActor in
            let (weather, doodle, count) = loadToday()
            let now = Date.now
            // One entry per hour for the next 6 hours; widgets can't fetch weather themselves,
            // so the stored weather is reused and only the light changes.
            let entries = (0..<6).map { offset -> TodayEntry in
                let date = Calendar.current.date(byAdding: .hour, value: offset, to: now) ?? now
                return TodayEntry(date: date, sceneKey: Self.key(at: date, weather: weather), doodle: doodle, momentCount: count)
            }
            completion(Timeline(entries: entries, policy: .atEnd))
        }
    }

    @MainActor
    private func loadToday() -> (SceneKey.Weather, UIImage?, Int) {
        guard let container = try? ModelContainer(
            for: Schema(AshiatoSchema.models),
            configurations: ModelConfiguration(groupContainer: .identifier("group.app.ashiato"))
        ) else { return (.clear, nil, 0) }
        let start = Calendar.current.startOfDay(for: .now)
        let descriptor = FetchDescriptor<Day>(predicate: #Predicate { $0.date >= start })
        guard let day = try? container.mainContext.fetch(descriptor).first else { return (.clear, nil, 0) }
        let doodle = day.sortedMoments.last(where: { $0.doodleData != nil })?.doodleData.flatMap(UIImage.init(data:))
        return (SceneKey.Weather(rawValue: day.weather) ?? .clear, doodle, day.moments?.count ?? 0)
    }

    static func key(at date: Date, weather: SceneKey.Weather) -> SceneKey {
        SceneKey(weather: weather, time: .init(date: date, sunrise: nil, sunset: nil), season: .init(date: date, latitude: 35))
    }
}

struct TodayWidgetView: View {
    let entry: TodayEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            if let scene = entry.sceneKey.image {
                Image(uiImage: scene).resizable().scaledToFill()
            }
            if let doodle = entry.doodle {
                Image(uiImage: doodle)
                    .resizable().scaledToFill()
                    .frame(width: family == .systemSmall ? 54 : 80, height: family == .systemSmall ? 54 : 80)
                    .clipped()
                    .padding(4)
                    .background(.white)
                    .rotationEffect(.degrees(-6))
                    .shadow(radius: 2)
                    .padding(10)
            } else {
                Text(Copy.tapToAdd.text(LanguageMode.current))
                    .font(.caption2.bold())
                    .padding(6)
                    .background(.white.opacity(0.85), in: Capsule())
                    .padding(10)
            }
        }
        .containerBackground(for: .widget) { Color(red: 246 / 255, green: 239 / 255, blue: 226 / 255) }   // washi #F6EFE2
    }
}

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TodayWidget", provider: TodayProvider()) { entry in
            TodayWidgetView(entry: entry)
        }
        .configurationDisplayName("Today")
        .description("Today's little town, with your latest doodle.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}

@main
struct AshiatoWidgetBundle: WidgetBundle {
    var body: some Widget {
        TodayWidget()
    }
}
