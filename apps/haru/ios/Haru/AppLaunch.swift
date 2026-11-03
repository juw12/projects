import Foundation
import SwiftData

/// Launch arguments used for simulator screenshots, UI tests and App Store captures:
///
///     -demo                 in-memory store filled with sample days; no permission prompts
///     -lang english         duo | english | japanese | korean (overrides the saved setting)
///     -tab days             today | days | map | memories
///     -sheet settings       settings | tidy | capture | onboarding  (opened on launch)
struct AppLaunch {
    enum Tab: String {
        case today, days, map, memories
    }

    enum Sheet: String {
        case settings, tidy, capture, onboarding
    }

    let demo: Bool
    let language: LanguageMode?
    let tab: Tab
    let sheet: Sheet?

    static let current = AppLaunch(arguments: ProcessInfo.processInfo.arguments)

    init(arguments: [String]) {
        func value(after flag: String) -> String? {
            guard let index = arguments.firstIndex(of: flag), index + 1 < arguments.count else {
                return nil
            }
            return arguments[index + 1]
        }
        demo = arguments.contains("-demo")
        language = value(after: "-lang").flatMap(LanguageMode.init(rawValue:))
        tab = value(after: "-tab").flatMap(Tab.init(rawValue:)) ?? .today
        sheet = value(after: "-sheet").flatMap(Sheet.init(rawValue:))
    }
}

/// Builds the SwiftData container without ever crashing on launch.
///
/// Order of preference:
/// 1. App Group store synced to the CloudKit private database (normal signed build)
/// 2. App Group store, local only (iCloud container unavailable)
/// 3. App-private local store (no App Group entitlement, e.g. unsigned simulator build)
/// 4. In-memory store (disk unavailable) — the app still opens, nothing is lost silently on disk
enum ModelStore {
    static let appGroup = "group.app.haru"
    static let cloudContainer = "iCloud.app.haru"

    static func makeContainer(demo: Bool) -> ModelContainer {
        let schema = Schema(HaruSchema.models)
        if demo {
            return inMemory(schema: schema)
        }
        let hasAppGroup = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroup) != nil

        var attempts: [ModelConfiguration] = []
        if hasAppGroup {
            attempts.append(ModelConfiguration(
                schema: schema,
                groupContainer: .identifier(appGroup),
                cloudKitDatabase: .private(cloudContainer)
            ))
            attempts.append(ModelConfiguration(
                schema: schema,
                groupContainer: .identifier(appGroup),
                cloudKitDatabase: .none
            ))
        }
        attempts.append(ModelConfiguration(
            schema: schema,
            groupContainer: .none,
            cloudKitDatabase: .none
        ))

        for configuration in attempts {
            if let container = try? ModelContainer(for: schema, configurations: configuration) {
                return container
            }
        }
        return inMemory(schema: schema)
    }

    private static func inMemory(schema: Schema) -> ModelContainer {
        let configuration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)
        // An in-memory store cannot fail for a valid schema; crash loudly if the schema itself is broken.
        // swiftlint:disable:next force_try
        return try! ModelContainer(for: schema, configurations: configuration)
    }
}
