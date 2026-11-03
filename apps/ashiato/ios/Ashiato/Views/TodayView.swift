import SwiftData
import SwiftUI

struct TodayView: View {
    @Environment(\.modelContext) private var context
    @Environment(WeatherProvider.self) private var weather
    @Environment(WalkRecorder.self) private var walks
    @Environment(ScreenshotInbox.self) private var screenshots
    @Query(filter: #Predicate<Clip> { $0.statusRaw == "inbox" }) private var waitingClips: [Clip]
    @AppStorage("tidy.inviteDismissed") private var tidyInviteDismissed = false
    @State private var showTidy = AppLaunch.current.sheet == .tidy
    @State private var showSettings = AppLaunch.current.sheet == .settings
    @Environment(\.language) private var language
    @Query(sort: \Day.date, order: .reverse) private var days: [Day]
    @State private var prompt = PromptLibrary.prompt(for: .now)
    @State private var promptDismissed = false
    @State private var deckIndex = 0
    @State private var openedDay: Day?

    private var today: Day? {
        days.first { Calendar.current.isDateInToday($0.date) }
    }

    private var sceneKey: SceneKey {
        weather.sceneKey ?? SceneKey(
            weather: .clear,
            time: .init(date: .now, sunrise: nil, sunset: nil),
            season: .init(date: .now, latitude: walks.lastLocation?.coordinate.latitude ?? 35)
        )
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(Copy.today.text(language))
                            .font(.cozyBold(28, relativeTo: .largeTitle))
                            .foregroundStyle(Theme.ink)
                        Text(weatherLine)
                            .font(.cozy(14, relativeTo: .subheadline))
                            .foregroundStyle(Theme.muted)
                    }

                    SwipeDeckView(entries: deckEntries, index: $deckIndex) { entry in
                        openedDay = days.first { Calendar.current.isDate($0.date, inSameDayAs: entry.date) }
                    }
                    .frame(height: 560)
                    .padding(.horizontal, -16)

                    WeekStrip(entries: deckEntries, index: $deckIndex)
                        .padding(.horizontal, -16)

                    if !promptDismissed {
                        PromptCard(prompt: prompt) { kept in
                            if kept {
                                context.insert(PromptRecord(date: .now, text: prompt.text, category: prompt.category))
                            }
                            withAnimation { promptDismissed = true }
                        }
                    }

                    WalkCard()

                    if waitingClips.count >= 3 || (screenshots.access == .unknown && !tidyInviteDismissed) {
                        TidyInviteCard(waiting: waitingClips.count, hasAccess: screenshots.access != .unknown) {
                            Task {
                                if screenshots.access == .unknown {
                                    await screenshots.requestAccess()
                                    tidyInviteDismissed = true
                                    await screenshots.scan(into: context)
                                }
                                showTidy = true
                            }
                        }
                    }

                    ForEach(today?.sortedMoments ?? []) { moment in
                        MomentRow(moment: moment)
                    }
                }
                .padding()
                .padding(.bottom, 80)
            }
            .background(Theme.paper)
            .background(PaperGrain(seed: 3, density: 900, opacity: 0.05).ignoresSafeArea())
            .navigationDestination(item: $openedDay) { day in
                DayDetailView(day: day)
            }
            .sheet(isPresented: $showTidy) {
                TidyView()
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showSettings = true
                    } label: {
                        Image(systemName: "gearshape")
                    }
                    .accessibilityLabel(Copy.settings.text(language))
                }
            }
            .task {
                guard !AppLaunch.current.demo else { return }
                screenshots.refreshAccess()
                await screenshots.scan(into: context)   // no-op unless already permitted
            }
            .task(id: walks.lastLocation?.coordinate.latitude) {
                if let location = walks.lastLocation {
                    await weather.refresh(for: location)
                }
            }
        }
    }

    /// Today (live weather) first, then up to six earlier days, then any on-this-day memory.
    private var deckEntries: [DeckEntry] {
        var entries: [DeckEntry] = [
            today.map { DeckEntry(day: $0, sceneKey: sceneKey) } ?? .empty(date: .now, sceneKey: sceneKey)
        ]
        let recent = days.filter { !Calendar.current.isDateInToday($0.date) }.prefix(6)
        entries += recent.map { DeckEntry(day: $0) }
        let shownDates = Set(entries.map(\.id))
        for memory in Resurfacer.onThisDay(in: days) where !shownDates.contains(memory.day.date) {
            entries.append(DeckEntry(day: memory.day, memoryLabel: memory.cozyLabel))
        }
        return entries
    }

    private var weatherLine: String {
        // Duo keeps the playful mix (Japanese weather + time, Korean season); others are single-language.
        var parts = language == .duo
            ? [sceneKey.weather.cozyLabel.ja, sceneKey.time.cozyLabel.ja, sceneKey.season.cozyLabel.ko]
            : [
                sceneKey.weather.cozyLabel.text(language),
                sceneKey.time.cozyLabel.text(language),
                sceneKey.season.cozyLabel.text(language),
            ]
        if let temperature = weather.temperatureC {
            parts.insert("\(Int(temperature.rounded()))°", at: 0)
        }
        return parts.joined(separator: " · ")
    }
}

private struct PromptCard: View {
    let prompt: DailyPrompt
    var onDecide: (Bool) -> Void
    @Environment(\.language) private var language

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(Copy.todaysPrompt.text(language)).font(.cozy(12, relativeTo: .caption)).foregroundStyle(Theme.muted)
            if language == .duo {
                // Long sentences read better stacked than joined with "·".
                Text(prompt.label.ja).font(.hand(19, relativeTo: .title3)).foregroundStyle(Theme.ink)
                Text(prompt.label.ko).font(.handKorean(15)).foregroundStyle(Theme.muted)
            } else {
                Text(prompt.label.text(language))
                    .font(.note(for: prompt.label.text(language), size: 19))
                    .foregroundStyle(Theme.ink)
            }
            HStack {
                Button(Copy.keepIt.text(language)) { onDecide(true) }.buttonStyle(.borderedProminent)
                Button(Copy.letItGo.text(language)) { onDecide(false) }.buttonStyle(.bordered)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(Theme.card))
        .overlay(alignment: .topTrailing) {
            WashiTape(tint: Theme.matcha).frame(width: 58, height: 16).rotationEffect(.degrees(8)).offset(x: -18, y: -7)
        }
    }
}

private struct WalkCard: View {
    @Environment(\.modelContext) private var context
    @Environment(WalkRecorder.self) private var walks
    @Environment(\.language) private var language

    var body: some View {
        HStack {
            VStack(alignment: .leading) {
                Text((walks.isRecording ? Copy.walking : Copy.goForWalk).text(language))
                    .font(.cozyBold(16, relativeTo: .headline))
                    .foregroundStyle(Theme.ink)
                Text(Measurement(value: walks.distanceMeters / 1000, unit: UnitLength.kilometers),
                     format: .measurement(width: .abbreviated, numberFormatStyle: .number.precision(.fractionLength(1))))
                    .foregroundStyle(Theme.muted)
            }
            Spacer()
            Button((walks.isRecording ? Copy.stop : Copy.start).text(language)) {
                if walks.isRecording {
                    if let walk = walks.stop() {
                        context.insert(walk)
                    }
                } else {
                    walks.start()
                }
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
        .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(Theme.card))
    }
}

struct MomentRow: View {
    let moment: Moment

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if let data = moment.doodleData, let image = UIImage(data: data) {
                Image(uiImage: image).resizable().scaledToFill()
                    .frame(width: 64, height: 64).clipShape(RoundedRectangle(cornerRadius: 10))
            }
            VStack(alignment: .leading, spacing: 4) {
                if !moment.text.isEmpty {
                    Text(moment.text)
                        .font(.note(for: moment.text, size: 16))
                        .foregroundStyle(Theme.ink)
                }
                HStack {
                    Text(moment.createdAt, style: .time)
                    if let mood = moment.mood {
                        Text(String(repeating: "●", count: mood) + String(repeating: "○", count: 5 - mood))
                    }
                }
                .font(.caption)
                .foregroundStyle(Theme.muted)
            }
            Spacer()
        }
    }
}
