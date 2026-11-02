import SwiftUI

/// Language picker (Today → gear). More settings join here later (iCloud, export, privacy zones).
struct SettingsView: View {
    @AppStorage(LanguageMode.storageKey, store: LanguageMode.sharedDefaults)
    private var languageRaw = LanguageMode.systemDefault.rawValue
    @Environment(\.language) private var language
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section(Copy.language.text(language)) {
                    Picker(Copy.language.text(language), selection: $languageRaw) {
                        ForEach(LanguageMode.allCases) { mode in
                            Text(mode.menuTitle).tag(mode.rawValue)
                        }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.paper)
            .navigationTitle(Copy.settings.text(language))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(Copy.close.text(language)) { dismiss() }
                }
            }
        }
    }
}
