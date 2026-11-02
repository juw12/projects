import PhotosUI
import SwiftData
import SwiftUI
import WidgetKit

/// One sheet for every capture type. Target: a moment saved in under 5 seconds.
struct CaptureSheet: View {
    enum Mode: String, CaseIterable {
        case moment, fragment

        var label: CozyLabel { self == .moment ? Copy.moment : Copy.fragment }
    }

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Environment(WalkRecorder.self) private var walks
    @Environment(WeatherProvider.self) private var weather
    @Query(sort: \Day.date, order: .reverse) private var days: [Day]

    @State private var mode: Mode = .moment
    @State private var text = ""
    @State private var mood: Int?
    @State private var pickerItem: PhotosPickerItem?
    @State private var photo: UIImage?
    @State private var doodle: UIImage?
    @State private var style: DoodleStyle = .crayon
    @State private var isRendering = false
    @Environment(\.language) private var language

    var body: some View {
        NavigationStack {
            Form {
                Picker(Copy.type.text(language), selection: $mode) {
                    ForEach(Mode.allCases, id: \.self) { Text($0.label.text(language)) }
                }
                .pickerStyle(.segmented)

                if mode == .moment {
                    momentFields
                } else {
                    Section(footer: Text(Copy.fragmentFooter(text.count, Fragment.maxLength).text(language))) {
                        TextField(Copy.passingThought.text(language), text: $text, axis: .vertical)
                            .onChange(of: text) { _, newValue in
                                if newValue.count > Fragment.maxLength {
                                    text = String(newValue.prefix(Fragment.maxLength))
                                }
                            }
                    }
                }
            }
            .navigationTitle(Copy.capture.text(language))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(Copy.cancel.text(language)) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(Copy.save.text(language), action: save).disabled(!canSave)
                }
            }
        }
    }

    @ViewBuilder
    private var momentFields: some View {
        Section {
            PhotosPicker(selection: $pickerItem, matching: .images) {
                if let doodle {
                    Image(uiImage: doodle).resizable().scaledToFit().frame(maxHeight: 240)
                } else if isRendering {
                    ProgressView(Copy.doodling.text(language))
                } else {
                    Label(Copy.addPhoto.text(language), systemImage: "photo")
                }
            }
            .onChange(of: pickerItem) { _, item in
                Task { await loadPhoto(item) }
            }
            if photo != nil {
                Picker(Copy.style.text(language), selection: $style) {
                    ForEach(DoodleStyle.allCases) { Text($0.label.text(language)).tag($0) }
                }
                .onChange(of: style) { _, _ in Task { await renderDoodle() } }
            }
        }
        Section {
            TextField(Copy.whatHappened.text(language), text: $text, axis: .vertical)
            HStack {
                Text(Copy.mood.text(language))
                Spacer()
                ForEach(1...5, id: \.self) { value in
                    Button {
                        mood = (mood == value) ? nil : value
                    } label: {
                        Image(systemName: (mood ?? 0) >= value ? "circle.fill" : "circle")
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var canSave: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || photo != nil || mood != nil
    }

    private func loadPhoto(_ item: PhotosPickerItem?) async {
        guard let item, let data = try? await item.loadTransferable(type: Data.self),
              let image = UIImage(data: data) else { return }
        photo = image
        await renderDoodle()
    }

    private func renderDoodle() async {
        guard let photo else { return }
        isRendering = true
        let selectedStyle = style
        doodle = await Task.detached(priority: .userInitiated) {
            DoodleRenderer().render(photo, style: selectedStyle)
        }.value
        isRendering = false
    }

    private func save() {
        switch mode {
        case .fragment:
            context.insert(Fragment(text: text))
        case .moment:
            let day = days.first { Calendar.current.isDateInToday($0.date) } ?? {
                let newDay = Day(date: .now)
                context.insert(newDay)
                return newDay
            }()
            // Record the day's atmosphere so history cards show the real weather and season.
            if let key = weather.sceneKey {
                day.weather = key.weather.rawValue
                day.season = key.season.rawValue
            }
            day.temperatureC = weather.temperatureC ?? day.temperatureC
            let kind: MomentKind = photo != nil ? .photo : (text.isEmpty ? .mood : .note)
            let moment = Moment(kind: kind, text: text, mood: mood)
            moment.photoData = photo?.jpegData(compressionQuality: 0.8)
            moment.doodleData = doodle?.pngData()
            moment.doodleStyle = style.rawValue
            if let location = walks.lastLocation {
                moment.latitude = location.coordinate.latitude
                moment.longitude = location.coordinate.longitude
            }
            moment.day = day
            context.insert(moment)
        }
        try? context.save()
        WidgetCenter.shared.reloadAllTimelines()
        dismiss()
    }
}
