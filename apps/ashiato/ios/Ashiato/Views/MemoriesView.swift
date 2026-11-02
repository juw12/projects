import SwiftData
import SwiftUI

/// Resurfacing (echor / Footnotes): on-this-day moments, a random fragment,
/// and the fragments box itself.
struct MemoriesView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \Day.date, order: .reverse) private var days: [Day]
    @Query(sort: \Fragment.createdAt, order: .reverse) private var fragments: [Fragment]
    @State private var surfacedFragment: Fragment?
    @Environment(\.language) private var language

    var body: some View {
        NavigationStack {
            List {
                let onThisDay = Resurfacer.onThisDay(in: days)
                if !onThisDay.isEmpty {
                    Section(Copy.onThisDay.text(language)) {
                        ForEach(onThisDay) { item in
                            NavigationLink {
                                DayDetailView(day: item.day)
                            } label: {
                                HStack {
                                    DayCardView(sceneKey: item.day.storedSceneKey, moments: item.day.sortedMoments, compact: true)
                                        .frame(width: 64, height: 64)
                                    VStack(alignment: .leading) {
                                        Text(item.cozyLabel.text(language)).font(.cozyBold(15, relativeTo: .headline))
                                        Text(item.day.sortedMoments.first?.text ?? "").lineLimit(2).foregroundStyle(Theme.muted)
                                    }
                                }
                            }
                        }
                    }
                }

                if let surfacedFragment {
                    Section(Copy.fragmentCameBack.text(language)) {
                        Text("\u{201C}\(surfacedFragment.text)\u{201D}").font(.title3)
                        Text(surfacedFragment.createdAt, format: .dateTime.year().month().day())
                            .font(.caption).foregroundStyle(Theme.muted)
                    }
                }

                DrawersSection()

                Section(Copy.fragments.text(language)) {
                    ForEach(fragments) { fragment in
                        Text(fragment.text)
                    }
                    .onDelete { offsets in
                        offsets.map { fragments[$0] }.forEach(context.delete)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.paper)
            .navigationTitle(Copy.memories.text(language))
            .onAppear {
                surfacedFragment = Resurfacer.randomFragment(from: fragments)
                surfacedFragment?.lastSurfacedAt = .now
            }
        }
    }
}
