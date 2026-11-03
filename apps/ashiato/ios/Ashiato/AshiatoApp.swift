import SwiftData
import SwiftUI

@main
struct AshiatoApp: App {
    @State private var weather = WeatherProvider()
    @State private var walks = WalkRecorder()
    @State private var screenshots = ScreenshotInbox()
    @AppStorage(LanguageMode.storageKey, store: LanguageMode.sharedDefaults)
    private var languageRaw = LanguageMode.systemDefault.rawValue

    private let container: ModelContainer

    init() {
        let launch = AppLaunch.current
        if let language = launch.language {
            LanguageMode.sharedDefaults.set(language.rawValue, forKey: LanguageMode.storageKey)
        }
        container = ModelStore.makeContainer(demo: launch.demo)
        if launch.demo {
            DemoData.seed(
                into: container.mainContext,
                language: launch.language ?? LanguageMode.current
            )
        }
    }

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
