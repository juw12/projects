import CoreMotion
import SwiftUI

// MARK: - Data

/// One card in the deck: a day rendered as a little diorama keepsake.
struct DeckEntry: Identifiable {
    let id: Date                 // start of day
    let sceneKey: SceneKey
    let note: String?
    let doodle: UIImage?
    let mood: Int?               // 1...5
    let walkedMeters: Double
    let pioneeredMeters: Double
    var memoryLabel: CozyLabel?  // "1年前 · 1년 전" for resurfaced days

    var date: Date { id }
}

extension DeckEntry {
    init(day: Day, sceneKey: SceneKey? = nil, memoryLabel: CozyLabel? = nil) {
        let moments = day.sortedMoments
        self.init(
            id: day.date,
            sceneKey: sceneKey ?? day.storedSceneKey,
            note: moments.last(where: { !$0.text.isEmpty })?.text,
            doodle: moments.compactMap(\.doodleData).last.flatMap(UIImage.init(data:)),
            mood: day.averageMood.map { Int($0.rounded()) },
            walkedMeters: day.walkedMeters,
            pioneeredMeters: day.pioneeredMeters,
            memoryLabel: memoryLabel
        )
    }

    /// Placeholder for a day with nothing recorded yet (today, first launch).
    static func empty(date: Date, sceneKey: SceneKey) -> DeckEntry {
        DeckEntry(
            id: Calendar.current.startOfDay(for: date),
            sceneKey: sceneKey,
            note: nil,
            doodle: nil,
            mood: nil,
            walkedMeters: 0,
            pioneeredMeters: 0
        )
    }
}

// MARK: - Device tilt (gentle parallax, like looking into a shoebox diorama)

@Observable
final class MotionTilt {
    /// -1...1 on each axis, low-pass filtered.
    var x: Double = 0
    var y: Double = 0

    private let manager = CMMotionManager()

    func start() {
        guard manager.isDeviceMotionAvailable, !manager.isDeviceMotionActive else { return }
        manager.deviceMotionUpdateInterval = 1 / 30
        manager.startDeviceMotionUpdates(to: .main) { [weak self] motion, _ in
            guard let self, let attitude = motion?.attitude else { return }
            let targetX = max(-1, min(1, attitude.roll / 0.5))
            let targetY = max(-1, min(1, (attitude.pitch - 0.8) / 0.5))   // phone held ~45°
            self.x += (targetX - self.x) * 0.12
            self.y += (targetY - self.y) * 0.12
        }
    }

    func stop() {
        manager.stopDeviceMotionUpdates()
    }
}

// MARK: - Deck

/// Stack of day cards. Swipe left = older day, right = newer. Cards move on slow,
/// soft springs, tilt in 3D while dragged, and lean with the phone.
struct SwipeDeckView: View {
    let entries: [DeckEntry]
    @Binding var index: Int
    var onOpen: (DeckEntry) -> Void = { _ in }

    @State private var drag: CGSize = .zero
    @State private var isThrowing = false
    @State private var landedCount = 0
    @State private var tilt = MotionTilt()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let visibleDepth = 3
    private let throwDistance: CGFloat = 110
    static let cardAspect: CGFloat = 0.7   // width / height

    private struct Slot: Identifiable {
        let entry: DeckEntry
        let depth: Int
        var id: Date { entry.id }
    }

    private var slots: [Slot] {
        guard !entries.isEmpty else { return [] }
        let start = min(max(index, 0), entries.count - 1)
        let end = min(start + visibleDepth, entries.count)
        return (start..<end).map { Slot(entry: entries[$0], depth: $0 - start) }
    }

    var body: some View {
        GeometryReader { proxy in
            let cardWidth = min(proxy.size.width - 40, proxy.size.height * Self.cardAspect - 24, 380)
            ZStack {
                ForEach(slots.reversed()) { slot in
                    card(for: slot, width: cardWidth, containerWidth: proxy.size.width)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .onAppear {
            if !reduceMotion {
                tilt.start()
            }
        }
        .onDisappear { tilt.stop() }
        .sensoryFeedback(.impact(flexibility: .soft, intensity: 0.55), trigger: landedCount)
        .accessibilityElement(children: .contain)
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: step(by: 1)
            case .decrement: step(by: -1)
            @unknown default: break
            }
        }
    }

    @ViewBuilder
    private func card(for slot: Slot, width: CGFloat, containerWidth: CGFloat) -> some View {
        let isTop = slot.depth == 0
        let depth = CGFloat(slot.depth)
        // Resting fan of the cards underneath: slightly smaller, lower, alternately askew.
        let restingTurn: Double = isTop ? 0 : (slot.depth.isMultiple(of: 2) ? 2.2 : -2.8)
        let dragProgress = isTop ? drag.width / max(containerWidth, 1) : 0
        let tiltX = isTop && !reduceMotion ? tilt.x : 0
        let tiltY = isTop && !reduceMotion ? tilt.y : 0

        CozyDayCard(entry: slot.entry, parallax: CGSize(width: tiltX, height: tiltY), isLive: isTop)
            .frame(width: width, height: width / Self.cardAspect)
            .scaleEffect(1 - depth * 0.05)
            .offset(y: depth * 16)
            .rotationEffect(.degrees(restingTurn))
            // Drag: follow the finger, swing from the bottom like a hanging card, turn in 3D.
            .offset(isTop ? drag : .zero)
            .rotationEffect(.degrees(Double(dragProgress) * 14), anchor: .bottom)
            .rotation3DEffect(
                .degrees(Double(-dragProgress) * 28 + tiltX * 6),
                axis: (x: 0, y: 1, z: 0),
                perspective: 0.55
            )
            .rotation3DEffect(
                .degrees(-tiltY * 5 + Double(drag.height / 40)),
                axis: (x: 1, y: 0, z: 0),
                perspective: 0.55
            )
            .opacity(isTop ? 1 - min(abs(Double(dragProgress)) * 0.35, 0.35) : 1 - Double(depth) * 0.08)
            .shadow(color: Theme.hojicha.opacity(isTop ? 0.28 : 0.14), radius: isTop ? 22 : 10, x: 0, y: isTop ? 18 : 8)
            .zIndex(-Double(slot.depth))
            .allowsHitTesting(isTop && !isThrowing)
            .gesture(dragGesture(containerWidth: containerWidth), including: isTop ? .all : .none)
            .onTapGesture {
                if isTop {
                    onOpen(slot.entry)
                }
            }
            .accessibilityHidden(!isTop)
    }

    private func dragGesture(containerWidth: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { value in
                let canMove = canStep(value.translation.width < 0 ? 1 : -1)
                // Rubber-band at either end of the deck.
                drag = CGSize(
                    width: canMove ? value.translation.width : value.translation.width * 0.25,
                    height: value.translation.height * 0.2
                )
            }
            .onEnded { value in
                let projected = value.predictedEndTranslation.width
                let direction = projected < 0 ? 1 : -1      // left → older (+1), right → newer (-1)
                if abs(projected) > throwDistance, canStep(direction) {
                    throwCard(direction: direction, containerWidth: containerWidth)
                } else {
                    withAnimation(Theme.settle) {
                        drag = .zero
                    }
                }
            }
    }

    private func canStep(_ direction: Int) -> Bool {
        let target = index + direction
        return target >= 0 && target < entries.count
    }

    /// Button / VoiceOver / keyboard navigation uses the same slow motion as a swipe.
    func step(by direction: Int) {
        guard canStep(direction), !isThrowing else { return }
        throwCard(direction: direction, containerWidth: 420)
    }

    private func throwCard(direction: Int, containerWidth: CGFloat) {
        isThrowing = true
        let offscreen = containerWidth * 1.3
        if direction > 0 {
            // Older: the top card drifts off to the left, the next one rises.
            withAnimation(Theme.slowSpring, completionCriteria: .logicallyComplete) {
                drag = CGSize(width: -offscreen, height: 40)
            } completion: {
                var settle = Transaction(animation: reduceMotion ? nil : Theme.settle)
                settle.disablesAnimations = false
                withTransaction(settle) {
                    index += 1
                    drag = .zero
                }
                landedCount += 1
                isThrowing = false
            }
        } else {
            // Newer: the previous card floats back in from the right.
            var instant = Transaction()
            instant.disablesAnimations = true
            withTransaction(instant) {
                index -= 1
                drag = CGSize(width: offscreen, height: 40)
            }
            DispatchQueue.main.async {
                withAnimation(Theme.slowSpring, completionCriteria: .logicallyComplete) {
                    drag = .zero
                } completion: {
                    landedCount += 1
                    isThrowing = false
                }
            }
        }
    }
}

// MARK: - Card

/// The keepsake card: washi paper, diorama window, taped polaroid, hanko mood stamp,
/// handwritten note, and soft pills. Layers shift at different rates for fake depth.
struct CozyDayCard: View {
    let entry: DeckEntry
    var parallax: CGSize = .zero     // -1...1 from MotionTilt
    var isLive = false
    @Environment(\.language) private var language

    var body: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: Theme.cardCorner, style: .continuous)
                .fill(Theme.card)
                .overlay(
                    PaperGrain(seed: UInt64(abs(entry.id.timeIntervalSince1970)))
                        .clipShape(RoundedRectangle(cornerRadius: Theme.cardCorner, style: .continuous))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.cardCorner, style: .continuous)
                        .strokeBorder(Theme.hojicha.opacity(0.12), lineWidth: 1)
                )

            VStack(alignment: .leading, spacing: 12) {
                header
                sceneWindow
                noteLine
                Spacer(minLength: 0)
                pills
            }
            .padding(16)

            if let memory = entry.memoryLabel {
                MemoryRibbon(label: memory)
                    .offset(x: -6, y: 18)
            }

            sheen
        }
        .compositingGroup()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .accessibilityAddTraits(.isButton)
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.date, format: .dateTime.month(.twoDigits).day(.twoDigits))
                    .font(.cozyBold(30, relativeTo: .largeTitle))
                    .foregroundStyle(Theme.ink)
                    .monospacedDigit()
                Text(weekdayLine)
                    .font(.cozy(13, relativeTo: .caption))
                    .foregroundStyle(Theme.muted)
            }
            Spacer()
            if let mood = entry.mood {
                HankoStamp(mood: mood)
                    .offset(x: parallax.width * 3, y: parallax.height * 3)
            }
        }
    }

    private var sceneWindow: some View {
        ZStack(alignment: .bottomTrailing) {
            Group {
                if let scene = entry.sceneKey.image {
                    Image(uiImage: scene)
                        .resizable()
                        .scaledToFill()
                        // Back layer moves against the tilt → the diorama feels recessed.
                        .scaleEffect(1.08)
                        .offset(x: -parallax.width * 6, y: -parallax.height * 6)
                } else {
                    Theme.paperDeep
                }
            }
            .frame(maxWidth: .infinity)
            .aspectRatio(1.05, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .strokeBorder(.white.opacity(0.65), lineWidth: 3)
            )
            .overlay(alignment: .topLeading) {
                Text(entry.sceneKey.weather.cozyLabel.text(language))
                    .font(.cozy(12, relativeTo: .caption))
                    .foregroundStyle(Theme.ink)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(.ultraThinMaterial, in: Capsule())
                    .padding(10)
            }

            if let doodle = entry.doodle {
                // Front layer moves with the tilt → it floats above the scene.
                TapedPolaroid(image: doodle)
                    .frame(width: 104)
                    .rotationEffect(.degrees(-5))
                    .offset(x: 10 + parallax.width * 9, y: 18 + parallax.height * 9)
            }
        }
    }

    @ViewBuilder
    private var noteLine: some View {
        if let note = entry.note {
            Text(note)
                .font(.note(for: note, size: 17))
                .foregroundStyle(Theme.ink)
                .lineLimit(3)
                .lineSpacing(3)
                .padding(.trailing, entry.doodle == nil ? 0 : 80)
        } else {
            Text(Copy.notePlaceholder.text(language))
                .font(.hand(15))
                .foregroundStyle(Theme.muted)
        }
    }

    private var pills: some View {
        HStack(spacing: 8) {
            if entry.walkedMeters > 0 {
                CozyPill(text: Copy.walked(kilometres(entry.walkedMeters)).text(language), tint: Theme.matcha)
            }
            if entry.pioneeredMeters > 0 {
                CozyPill(text: Copy.newRoads(kilometres(entry.pioneeredMeters)).text(language), tint: Theme.sakura)
            }
            if entry.walkedMeters == 0 && entry.pioneeredMeters == 0 {
                CozyPill(text: entry.sceneKey.season.cozyLabel.text(language), tint: Theme.yuzu)
            }
        }
    }

    /// Light glint that slides across the card as it tilts.
    private var sheen: some View {
        LinearGradient(
            colors: [.clear, .white.opacity(isLive ? 0.22 : 0.08), .clear],
            startPoint: UnitPoint(x: 0.0 + parallax.width * 0.4, y: 0.0),
            endPoint: UnitPoint(x: 0.9 + parallax.width * 0.4, y: 1.0)
        )
        .blendMode(.softLight)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cardCorner, style: .continuous))
        .allowsHitTesting(false)
    }

    private var weekdayLine: String {
        guard language == .duo else {
            return entry.date.formatted(.dateTime.weekday(.wide).locale(language.locale))
        }
        let japanese = entry.date.formatted(.dateTime.weekday(.wide).locale(Locale(identifier: "ja_JP")))
        let korean = entry.date.formatted(.dateTime.weekday(.wide).locale(Locale(identifier: "ko_KR")))
        return "\(japanese) · \(korean)"
    }

    private func kilometres(_ meters: Double) -> String {
        String(format: "%.1fkm", meters / 1000)
    }

    private var accessibilityText: String {
        var parts = [
            entry.date.formatted(date: .complete, time: .omitted),
            entry.sceneKey.weather.cozyLabel.en,
            entry.sceneKey.season.cozyLabel.en,
        ]
        if let memory = entry.memoryLabel {
            parts.insert(memory.en, at: 0)
        }
        if let note = entry.note {
            parts.append(note)
        }
        if entry.walkedMeters > 0 {
            parts.append("walked \(kilometres(entry.walkedMeters))")
        }
        return parts.joined(separator: ", ")
    }
}

// MARK: - Little paper pieces

/// Red ink seal for the day's mood, slightly rotated and uneven like a real stamp.
struct HankoStamp: View {
    let mood: Int
    @Environment(\.language) private var language

    private var glyph: String {
        switch mood {
        case ...1: "休"   // rest
        case 2: "静"      // quiet
        case 3: "和"      // calm
        case 4: "良"      // good
        default: "嬉"     // happy
        }
    }

    var body: some View {
        Text(glyph)
            .font(.cozyBold(20))
            .foregroundStyle(Theme.hanko)
            .frame(width: 44, height: 44)
            .overlay(Circle().strokeBorder(Theme.hanko, lineWidth: 2.5))
            .opacity(0.85)
            .rotationEffect(.degrees(-12))
            .blendMode(.multiply)
            .accessibilityLabel(CozyLabel(ja: "きもち \(mood)/5", ko: "기분 \(mood)/5", en: "mood \(mood) of 5").text(language))
    }
}

struct TapedPolaroid: View {
    let image: UIImage

    var body: some View {
        VStack(spacing: 0) {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .aspectRatio(1, contentMode: .fit)
                .clipped()
            Color.white.frame(height: 18)
        }
        .padding(6)
        .background(Color.white)
        .shadow(color: Theme.hojicha.opacity(0.3), radius: 6, x: 2, y: 6)
        .overlay(alignment: .top) {
            WashiTape(tint: Theme.sakura)
                .frame(width: 52, height: 16)
                .rotationEffect(.degrees(4))
                .offset(y: -8)
        }
    }
}

/// Semi-transparent masking tape with torn ends and a faint dot print.
struct WashiTape: View {
    var tint: Color

    var body: some View {
        Canvas { context, size in
            var tape = Path()
            let teeth = 5
            tape.move(to: .zero)
            tape.addLine(to: CGPoint(x: size.width, y: 0))
            for tooth in 0...teeth {
                let y = size.height * CGFloat(tooth) / CGFloat(teeth)
                tape.addLine(to: CGPoint(x: size.width - (tooth.isMultiple(of: 2) ? 0 : 2.5), y: y))
            }
            tape.addLine(to: CGPoint(x: 0, y: size.height))
            for tooth in stride(from: teeth, through: 0, by: -1) {
                let y = size.height * CGFloat(tooth) / CGFloat(teeth)
                tape.addLine(to: CGPoint(x: tooth.isMultiple(of: 2) ? 2.5 : 0, y: y))
            }
            tape.closeSubpath()
            context.fill(tape, with: .color(tint.opacity(0.72)))
            for dot in stride(from: 8.0, to: size.width - 6, by: 9) {
                let circle = Path(ellipseIn: CGRect(x: dot, y: size.height / 2 - 1.5, width: 3, height: 3))
                context.fill(circle, with: .color(.white.opacity(0.55)))
            }
        }
        .accessibilityHidden(true)
    }
}

struct CozyPill: View {
    let text: String
    var tint: Color

    var body: some View {
        Text(text)
            .font(.cozy(12, relativeTo: .caption))
            .foregroundStyle(Theme.ink)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(tint.opacity(0.35), in: Capsule())
            .overlay(Capsule().strokeBorder(tint.opacity(0.6), lineWidth: 1))
    }
}

/// Bookmark ribbon for resurfaced days ("1年前 · 1년 전").
struct MemoryRibbon: View {
    let label: CozyLabel
    @Environment(\.language) private var language

    var body: some View {
        Text(label.text(language))
            .font(.cozyBold(12, relativeTo: .caption))
            .foregroundStyle(.white)
            .padding(.leading, 14)
            .padding(.trailing, 12)
            .padding(.vertical, 6)
            .background(Theme.indigo, in: UnevenRoundedRectangle(bottomTrailingRadius: 10, topTrailingRadius: 10))
            .shadow(color: Theme.indigo.opacity(0.3), radius: 4, y: 3)
    }
}

// MARK: - Week strip (tiny scene thumbnails synced with the deck)

struct WeekStrip: View {
    let entries: [DeckEntry]
    @Binding var index: Int

    var body: some View {
        ScrollViewReader { reader in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(Array(entries.enumerated()), id: \.element.id) { position, entry in
                        Button {
                            withAnimation(Theme.slowSpring) {
                                index = position
                            }
                        } label: {
                            VStack(spacing: 4) {
                                Group {
                                    if let scene = entry.sceneKey.image {
                                        Image(uiImage: scene).resizable().scaledToFill()
                                    } else {
                                        Theme.paperDeep
                                    }
                                }
                                .frame(width: 44, height: 44)
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                                        .strokeBorder(position == index ? Theme.persimmon : .clear, lineWidth: 2)
                                )
                                .scaleEffect(position == index ? 1.08 : 1)
                                Text(entry.date, format: .dateTime.day())
                                    .font(.cozy(11, relativeTo: .caption2))
                                    .foregroundStyle(position == index ? Theme.ink : Theme.muted)
                            }
                        }
                        .buttonStyle(.plain)
                        .id(position)
                        .accessibilityLabel(entry.date.formatted(date: .abbreviated, time: .omitted))
                    }
                }
                .padding(.horizontal, 20)
            }
            .onChange(of: index) { _, newIndex in
                withAnimation(Theme.slowSpring) {
                    reader.scrollTo(newIndex, anchor: .center)
                }
            }
        }
    }
}
