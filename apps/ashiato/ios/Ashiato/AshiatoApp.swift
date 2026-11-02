import SwiftData
import SwiftUI

@main
struct AshiatoApp: App {
    @State private var weather = WeatherProvider()
    @State private var walks = WalkRecorder()
    @State private var screenshots = ScreenshotInbox()
    @AppStorage(LanguageMode.storageKey, store: LanguageMode.sharedDefaults)
    private var languageRaw = LanguageMode.systemDefault.rawValue

    let container: ModelContainer = {
        let schema = Schema(AshiatoSchema.models)
        let configuration = ModelConfiguration(
            schema: schema,
            groupContainer: .identifier("group.app.ashiato"),   // shared with widgets
            cloudKitDatabase: .private("iCloud.app.ashiato")     // no account needed beyond iCloud
        )
        do {
            return try ModelContainer(for: schema, configurations: configuration)
        } catch {
            fatalError("Could not create model container: \(error)")
        }
    }()

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .environment(weather)
                .environment(walks)
                .environment(screenshots)
                .environment(\.language, LanguageMode(rawValue: languageRaw) ?? .duo)
                .tint(Theme.accent)
                .fontDesign(.rounded)   // matches Zen Maru Gothic wherever system text remains
        }
        .modelContainer(container)
    }
}
