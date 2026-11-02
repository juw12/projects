import SwiftData
import SwiftUI

/// 片付け · 정리 — review new screenshots one card at a time.
/// → しまう (file into the suggested drawer), ← てばなす (let go), ↑ あとで (later).
/// Tap a drawer in the chest to change where the card goes. Deletions are queued
/// and committed once at the end, behind a single system confirmation.
struct TidyView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Environment(ScreenshotInbox.self) private var inbox
    @Query(filter: #Predicate<Clip> { $0.statusRaw == "inbox" }, sort: \Clip.capturedAt)
    private var queue: [Clip]
    /// Everything waiting to be deleted (this session + "てばなす" from drawer details).
    @Query(filter: #Predicate<Clip> { $0.statusRaw == "letGo" })
    private var letGoQueue: [Clip]

    @State private var drag: CGSize = .zero
    @State private var overrideDrawer: ClipDrawer?
    @State private var flyTarget: CGSize?
    @State private var session = SessionTally()
    @State private var decisionCount = 0
    @State private var committing = false
    @State private var commitError: String?
    @Environment(\.language) private var language

    private struct SessionTally {
        var kept: [ClipDrawer: Int] = [:]
        var letGoBytes: Int64 = 0
        var letGoCount = 0
        var later = 0
        var nextExpiry: Date?
    }

    private enum Decision {
        case keep, letGo, later
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 14) {
                Text(Copy.tidyHint(language))
                    .font(.cozy(12, relativeTo: .caption))
                    .foregroundStyle(Theme.muted)

                ZStack {
                    if let top = queue.first {
                        ForEach(Array(queue.prefix(3).enumerated().reversed()), id: \.element.id) { depth, clip in
                            ClipCard(clip: clip, drawer: depth == 0 ? (overrideDrawer ?? clip.drawer) : clip.drawer)
                                .overlay { if depth == 0 { stamps } }
                                .scaleEffect(1 - CGFloat(depth) * 0.05)
                                .offset(y: CGFloat(depth) * 14)
                                .rotationEffect(.degrees(depth == 0 ? 0 : (depth == 1 ? -2.6 : 2.2)))
                                .modifier(TopCardMotion(isTop: depth == 0, drag: drag, flyTarget: flyTarget))
                                .zIndex(-Double(depth))
                                .gesture(swipe(for: top), including: depth == 0 ? .all : .none)
                        }
                    } else {
                        summary
                    }
                }
                .frame(maxHeight: .infinity)

                if !queue.isEmpty {
                    HStack(spacing: 12) {
                        actionButton("← \(Copy.letGo.short(language))") { decide(.letGo) }
                        actionButton("↑ \(Copy.later.short(language))") { decide(.later) }
                        actionButton("\(Copy.keep.short(language)) →") { decide(.keep) }
                    }
                }

                DrawerChest(
                    highlighted: queue.first.map { overrideDrawer ?? $0.drawer },
                    counts: session.kept,
                    letGoCount: session.letGoCount
                ) { drawer in
                    if let drawer {
                        withAnimation(Theme.settle) {
                            overrideDrawer = drawer
                        }
                    } else {
                        decide(.letGo)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
            .background(Theme.paper.ignoresSafeArea())
            .navigationTitle(Copy.tidy.text(language))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(Copy.close.text(language)) { dismiss() }
                }
            }
            .sensoryFeedback(.impact(flexibility: .soft, intensity: 0.5), trigger: decisionCount)
            .onAppear { inbox.reopenPostponed(context: context) }
        }
    }

    // MARK: Gesture & decisions

    private func swipe(for clip: Clip) -> some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { drag = $0.translation }
            .onEnded { value in
                let end = value.predictedEndTranslation
                if end.width > 120 {
                    decide(.keep)
                } else if end.width < -120 {
                    decide(.letGo)
                } else if end.height < -120, abs(end.width) < 90 {
                    decide(.later)
                } else {
                    withAnimation(Theme.settle) {
                        drag = .zero
                    }
                }
            }
    }

    private func decide(_ decision: Decision) {
        guard let clip = queue.first, flyTarget == nil else { return }
        let destination = overrideDrawer ?? clip.drawer
        let target: CGSize = switch decision {
        case .keep: CGSize(width: 0, height: 520)          // drops down into the chest
        case .letGo: CGSize(width: -520, height: 360)
        case .later: CGSize(width: 0, height: -700)
        }

        withAnimation(Theme.slowSpring, completionCriteria: .logicallyComplete) {
            flyTarget = target
        } completion: {
            switch decision {
            case .keep:
                inbox.file(clip, into: destination, context: context)
                session.kept[destination, default: 0] += 1
                if let expiry = clip.expiresAt {
                    session.nextExpiry = min(session.nextExpiry ?? expiry, expiry)
                }
            case .letGo:
                inbox.queueLetGo(clip)
                session.letGoCount += 1
                session.letGoBytes += ScreenshotInbox.estimatedBytes(of: clip.assetIdentifier)
            case .later:
                inbox.postpone(clip)
                session.later += 1
            }
            var reset = Transaction()
            reset.disablesAnimations = true
            withTransaction(reset) {
                flyTarget = nil
                drag = .zero
                overrideDrawer = nil
            }
            decisionCount += 1
        }
    }

    private var stamps: some View {
        ZStack {
            stamp(Copy.keep.short(language), color: Theme.matcha, opacity: drag.width / 110, angle: -12)
                .frame(maxWidth: .infinity, alignment: .leading)
            stamp(Copy.letGo.short(language), color: Theme.hanko, opacity: -drag.width / 110, angle: 12)
                .frame(maxWidth: .infinity, alignment: .trailing)
            stamp(Copy.later.short(language), color: Theme.indigo, opacity: abs(drag.width) < 60 ? -drag.height / 110 : 0, angle: -4)
                .frame(maxHeight: .infinity, alignment: .top)
                .padding(.top, 40)
        }
        .padding(16)
        .allowsHitTesting(false)
    }

    private func stamp(_ label: String, color: Color, opacity: CGFloat, angle: Double) -> some View {
        Text(label)
            .font(.cozyBold(20))
            .foregroundStyle(color)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(color, lineWidth: 3))
            .background(Theme.card.opacity(0.6), in: RoundedRectangle(cornerRadius: 14))
            .rotationEffect(.degrees(angle))
            .opacity(Double(max(0, min(1, opacity))))
    }

    private func actionButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.cozy(13))
                .foregroundStyle(Theme.ink)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(Theme.card, in: Capsule())
                .overlay(Capsule().strokeBorder(Theme.hojicha.opacity(0.25)))
        }
        .buttonStyle(.plain)
    }

    // MARK: Summary

    private var summary: some View {
        VStack(spacing: 10) {
            Image(systemName: "leaf")
                .font(.system(size: 40))
                .foregroundStyle(Theme.matcha)
            Text(Copy.allTidy.text(language))
                .font(.cozyBold(26))
            if session.letGoCount > 0 {
                Text(Copy.canFree(ByteCountFormatter.string(fromByteCount: session.letGoBytes, countStyle: .file)).text(language))
                    .font(.cozy(13))
                    .foregroundStyle(Theme.muted)
            }
            Text(Copy.tidyMotto.text(language))
                .font(.note(for: Copy.tidyMotto.text(language), size: 17))
                .padding(.vertical, 6)
            VStack(alignment: .leading, spacing: 6) {
                ForEach(ClipDrawer.allCases.filter { session.kept[$0] != nil }) { drawer in
                    Label("\(drawer.label.text(language)) — \(session.kept[drawer] ?? 0)", systemImage: drawer.icon)
                }
                if let expiry = session.nextExpiry {
                    Label(Copy.letGoAfter(expiry.formatted(.dateTime.month().day())).text(language), systemImage: "hourglass")
                }
                if session.later > 0 {
                    Label(Copy.laterCount(session.later).text(language), systemImage: "arrow.up")
                }
            }
            .font(.cozy(14))

            if !letGoQueue.isEmpty {
                Button {
                    Task {
                        committing = true
                        defer { committing = false }
                        do {
                            _ = try await inbox.commitLetGo(context: context)
                            session.letGoCount = 0
                        } catch {
                            commitError = error.localizedDescription
                        }
                    }
                } label: {
                    Text(Copy.letGoFromPhotos(letGoQueue.count).text(language))
                        .font(.cozyBold(15))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.hanko)
                .disabled(committing)
                .padding(.top, 12)
                Text(Copy.recentlyDeletedNote.text(language))
                    .font(.cozy(11))
                    .foregroundStyle(Theme.muted)
            }
            if let commitError {
                Text(commitError).font(.caption).foregroundStyle(Theme.hanko)
            }
        }
        .padding(24)
        .frame(maxWidth: 360)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.cardCorner, style: .continuous))
        .shadow(color: Theme.hojicha.opacity(0.25), radius: 18, y: 14)
    }
}

/// Drag follow + 3D turn for the top card, and its flight into a drawer / off screen.
private struct TopCardMotion: ViewModifier {
    let isTop: Bool
    let drag: CGSize
    let flyTarget: CGSize?

    func body(content: Content) -> some View {
        if isTop {
            let offset = flyTarget ?? drag
            content
                .offset(offset)
                .scaleEffect(flyTarget == nil ? 1 : 0.15)
                .rotationEffect(.degrees(Double(offset.width / 26)), anchor: .bottom)
                .rotation3DEffect(.degrees(Double(-offset.width / 14)), axis: (x: 0, y: 1, z: 0), perspective: 0.55)
                .opacity(flyTarget == nil ? 1 : 0.2)
        } else {
            content
        }
    }
}

// MARK: - Card

struct ClipCard: View {
    let clip: Clip
    let drawer: ClipDrawer
    @Environment(ScreenshotInbox.self) private var inbox
    @State private var picture: UIImage?
    @Environment(\.language) private var language

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Group {
                if let picture {
                    Image(uiImage: picture).resizable().scaledToFit()
                } else {
                    Theme.paperDeep.aspectRatio(0.48, contentMode: .fit)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .padding(6)
            .background(.white, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .shadow(color: Theme.ink.opacity(0.25), radius: 10, y: 8)
            .overlay(alignment: .top) {
                WashiTape(tint: Theme.sakura).frame(width: 64, height: 18).rotationEffect(.degrees(4)).offset(y: -9)
            }
            .rotationEffect(.degrees(-2))
            .frame(maxWidth: .infinity, maxHeight: 360)

            Label(Copy.goesInto(drawer.label.text(language)).text(language), systemImage: drawer.icon)
                .font(.cozy(13))
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(Theme.matcha.opacity(0.3), in: Capsule())

            if let line = headline {
                Text(line)
                    .font(.note(for: line, size: 15))
                    .lineLimit(1)
            }

            HStack(spacing: 6) {
                if let expiry = clip.expiresAt {
                    CozyPill(text: Copy.until(expiry.formatted(.dateTime.month().day())).text(language), tint: Theme.yuzu)
                }
                if clip.duplicateOfIdentifier != nil {
                    CozyPill(text: Copy.lookalike.text(language), tint: Theme.indigo)
                }
            }
        }
        .padding(18)
        .frame(maxWidth: 340)
        .background(
            RoundedRectangle(cornerRadius: Theme.cardCorner, style: .continuous)
                .fill(Theme.card)
                .overlay(PaperGrain(seed: UInt64(abs(clip.capturedAt.timeIntervalSince1970))).clipShape(RoundedRectangle(cornerRadius: Theme.cardCorner)))
        )
        .shadow(color: Theme.hojicha.opacity(0.3), radius: 20, y: 16)
        .task(id: clip.assetIdentifier) {
            picture = await inbox.image(for: clip)
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint("Swipe right to keep in \(drawer.label.en), left to let go, up for later")
    }

    /// Most informative of the first OCR lines (skips brand names / headers).
    private var headline: String? {
        clip.ocrText
            .split(whereSeparator: \.isNewline)
            .prefix(4)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .max { $0.count < $1.count }
    }
}

// MARK: - Wooden drawer chest

struct DrawerChest: View {
    let highlighted: ClipDrawer?
    let counts: [ClipDrawer: Int]
    let letGoCount: Int
    /// nil = the let-go drawer.
    var onTap: (ClipDrawer?) -> Void
    @Environment(\.language) private var language

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 7), count: 4)

    var body: some View {
        LazyVGrid(columns: columns, spacing: 7) {
            ForEach(ClipDrawer.allCases) { drawer in
                cell(icon: drawer.icon, label: drawer.label, count: counts[drawer] ?? 0, isTarget: drawer == highlighted, isTrash: false) {
                    onTap(drawer)
                }
            }
            cell(icon: "leaf", label: Copy.letGo, count: letGoCount, isTarget: false, isTrash: true) {
                onTap(nil)
            }
        }
        .padding(10)
        .background(
            LinearGradient(colors: [Color(hex: 0xD9B98F), Color(hex: 0xCFA977)], startPoint: .top, endPoint: .bottom),
            in: RoundedRectangle(cornerRadius: 18, style: .continuous)
        )
        .shadow(color: Theme.hojicha.opacity(0.4), radius: 12, y: 8)
    }

    private func cell(icon: String, label: CozyLabel, count: Int, isTarget: Bool, isTrash: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Image(systemName: icon).font(.system(size: 14))
                if language == .duo {
                    Text(label.ja).font(.cozy(11))
                    Text(label.ko).font(.softKorean(9)).foregroundStyle(Theme.muted)
                } else {
                    Text(label.text(language)).font(.cozy(11)).lineLimit(1).minimumScaleFactor(0.7)
                }
                Capsule().fill(Color(hex: 0xB98F60)).frame(width: 14, height: 4).padding(.top, 2)
            }
            .foregroundStyle(Theme.ink)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 7)
            .background(
                LinearGradient(
                    colors: isTrash ? [Color(hex: 0xF1D9D3), Color(hex: 0xE7C3BA)] : [Color(hex: 0xF3E2C4), Color(hex: 0xE9D2AB)],
                    startPoint: .top,
                    endPoint: .bottom
                ),
                in: RoundedRectangle(cornerRadius: 10, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(Theme.persimmon, lineWidth: isTarget ? 2 : 0)
            )
            .overlay(alignment: .topTrailing) {
                if count > 0 {
                    Text("\(count)")
                        .font(.cozyBold(11))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 5)
                        .frame(minWidth: 18, minHeight: 18)
                        .background(Theme.persimmon, in: Capsule())
                        .offset(x: 4, y: -6)
                        .transition(.scale)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(label.en)\(count > 0 ? ", \(count)" : "")")
    }
}
