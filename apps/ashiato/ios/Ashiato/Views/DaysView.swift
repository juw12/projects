import SwiftData
import SwiftUI

/// Kiroku/Footnotes-style endless timeline with a DOOD-style calendar toggle.
struct DaysView: View {
    enum Layout: String, CaseIterable {
        case deck, timeline, calendar

        var label: CozyLabel {
            switch self {
            case .deck: Copy.cards
            case .timeline: Copy.timeline
            case .calendar: Copy.calendar
            }
        }
    }

    @Query(sort: \Day.date, order: .reverse) private var days: [Day]
    @State private var layout: Layout = .deck
    @State private var searchText = ""
    @State private var deckIndex = 0
    @State private var openedDay: Day?
    @Environment(\.language) private var language

    private var filteredDays: [Day] {
        guard !searchText.isEmpty else { return days }
        return days.filter { day in
            day.weather.localizedCaseInsensitiveContains(searchText)
                || day.sortedMoments.contains { $0.text.localizedCaseInsensitiveContains(searchText) }
                || (day.clips ?? []).contains {
                    $0.status != .letGo && $0.ocrText.localizedCaseInsensitiveContains(searchText)
                }
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                switch layout {
                case .deck: deck
                case .timeline: timeline
                case .calendar: calendar
                }
            }
            .background(Theme.paper)
            .navigationDestination(item: $openedDay) { day in
                DayDetailView(day: day)
            }
            .onChange(of: searchText) {
                deckIndex = 0
            }
            .navigationTitle(Copy.days.text(language))
            .searchable(text: $searchText, prompt: Copy.searchDays.text(language))
            .toolbar {
                Picker("Layout", selection: $layout) {
                    ForEach(Layout.allCases, id: \.self) { Text($0.label.short(language)) }
                }
                .pickerStyle(.segmented)
            }
        }
    }

    private var deck: some View {
        VStack(spacing: 16) {
            if filteredDays.isEmpty {
                ContentUnavailableView(
                    Copy.nothingYet.text(language),
                    systemImage: "leaf",
                    description: Text(Copy.daysWillStack.text(language))
                )
            } else {
                let entries = filteredDays.map { DeckEntry(day: $0) }
                SwipeDeckView(entries: entries, index: $deckIndex) { entry in
                    openedDay = filteredDays.first { $0.date == entry.date }
                }
                WeekStrip(entries: entries, index: $deckIndex)
                    .padding(.bottom, 72)
            }
        }
        .padding(.top, 8)
    }

    private var timeline: some View {
        List(filteredDays) { day in
            NavigationLink {
                DayDetailView(day: day)
            } label: {
                HStack(spacing: 12) {
                    DayCardView(sceneKey: day.storedSceneKey, moments: day.sortedMoments, compact: true)
                        .frame(width: 88, height: 88)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(day.date, format: .dateTime.weekday().month().day())
                            .font(.cozyBold(16, relativeTo: .headline))
                        Text(day.sortedMoments.first(where: { !$0.text.isEmpty })?.text ?? "")
                            .lineLimit(2)
                            .foregroundStyle(Theme.muted)
                    }
                }
            }
            .listRowBackground(Theme.paper)
        }
        .listStyle(.plain)
    }

    private var calendar: some View {
        ScrollView {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 7), spacing: 4) {
                ForEach(filteredDays) { day in
                    NavigationLink {
                        DayDetailView(day: day)
                    } label: {
                        DayCardView(sceneKey: day.storedSceneKey, moments: day.sortedMoments, compact: true)
                            .overlay(alignment: .topLeading) {
                                Text(day.date, format: .dateTime.day())
                                    .font(.caption2.bold())
                                    .padding(4)
                            }
                    }
                }
            }
            .padding(8)
        }
    }
}

struct DayDetailView: View {
    let day: Day
    @Environment(\.language) private var language

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                CozyDayCard(entry: DeckEntry(day: day), isLive: true)
                    .aspectRatio(SwipeDeckView.cardAspect, contentMode: .fit)
                    .shadow(color: Theme.hojicha.opacity(0.25), radius: 18, y: 14)
                Text(day.date, format: .dateTime.weekday(.wide).month().day().year())
                    .font(.cozyBold(24, relativeTo: .title))
                ForEach(day.sortedMoments) { MomentRow(moment: $0) }

                let dayClips = (day.clips ?? []).filter { $0.status == .kept }
                if !dayClips.isEmpty {
                    Text(Copy.thisDaysScreenshots.text(language))
                        .font(.cozy(13))
                        .foregroundStyle(Theme.muted)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(dayClips) { clip in
                                NavigationLink {
                                    ClipDetailView(clip: clip)
                                } label: {
                                    ClipThumbnail(clip: clip).frame(width: 96)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
            }
            .padding()
        }
        .background(Theme.paper)
    }
}

extension Day {
    /// Days are stored with their weather + season; time is shown as "noon" in history.
    var storedSceneKey: SceneKey {
        SceneKey(
            weather: SceneKey.Weather(rawValue: weather) ?? .clear,
            time: .noon,
            season: SceneKey.Season(rawValue: season) ?? .spring
        )
    }
}
