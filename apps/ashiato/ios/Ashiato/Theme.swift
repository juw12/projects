import SwiftUI

/// Cozy JP/KR "slow indie" palette — mirrors prototypes/cozy3d (see docs/art-direction.md).
enum Theme {
    // Paper & ink
    static let paper = Color(hex: 0xF6EFE2)        // washi background
    static let paperDeep = Color(hex: 0xEFE4D0)    // grouped surfaces
    static let card = Color(hex: 0xFFFAF1)         // card stock
    static let ink = Color(hex: 0x3A3240)          // sumi plum, never pure black
    static let muted = Color(hex: 0x9A8F93)

    // Accents
    static let sakura = Color(hex: 0xF4B9C6)
    static let matcha = Color(hex: 0x9DBF8E)
    static let hojicha = Color(hex: 0xB07A5A)
    static let persimmon = Color(hex: 0xE8875A)
    static let yuzu = Color(hex: 0xF2C14E)
    static let indigo = Color(hex: 0x4F5D7E)
    static let hanko = Color(hex: 0xD2493F)        // stamp red

    static let accent = persimmon

    // Motion: everything moves slowly and settles softly.
    /// ≈ CSS cubic-bezier(.22, 1, .36, 1) over 0.9 s — card throws, page changes.
    static let slowSpring = Animation.spring(duration: 0.9, bounce: 0.1)
    /// Snap-back when a swipe is cancelled.
    static let settle = Animation.spring(duration: 0.6, bounce: 0.22)
    /// Ambient loops (sheen, breathing cat) — at least 4 s per cycle.
    static let ambient = Animation.easeInOut(duration: 4).repeatForever(autoreverses: true)

    static let cardCorner: CGFloat = 28
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}

/// Bundled OFL fonts (Resources/Fonts, registered via UIAppFonts in project.yml).
/// Font.custom falls back to the system font if a file is missing, and CoreText
/// cascades to system glyphs for scripts a font lacks (e.g. Hangul in Zen Maru).
extension Font {
    /// Rounded UI text — Zen Maru Gothic.
    static func cozy(_ size: CGFloat, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom("ZenMaruGothic-Regular", size: size, relativeTo: style)
    }

    static func cozyBold(_ size: CGFloat, relativeTo style: Font.TextStyle = .headline) -> Font {
        .custom("ZenMaruGothic-Bold", size: size, relativeTo: style)
    }

    /// Handwritten Japanese/English notes — Klee One (pencil-textbook feel).
    static func hand(_ size: CGFloat, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom("KleeOne-Regular", size: size, relativeTo: style)
    }

    /// Handwritten Korean notes — Nanum Pen Script (runs small, so sized up).
    static func handKorean(_ size: CGFloat, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom("NanumPen-Regular", size: size * 1.35, relativeTo: style)
    }

    /// Soft Korean UI text — Gowun Dodum.
    static func softKorean(_ size: CGFloat, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom("GowunDodum-Regular", size: size, relativeTo: style)
    }

    /// Picks the right handwriting for a note's script.
    static func note(for text: String, size: CGFloat) -> Font {
        text.containsHangul ? .handKorean(size) : .hand(size)
    }
}

/// Subtle washi fibre texture, deterministic per seed so cards don't shimmer on redraw.
struct PaperGrain: View {
    var seed: UInt64 = 7
    var density: Int = 420
    var opacity: Double = 0.07

    var body: some View {
        Canvas { context, size in
            var generator = SplitMix64(seed: seed)
            for _ in 0..<density {
                let x = Double(generator.next() % 10_000) / 10_000 * size.width
                let y = Double(generator.next() % 10_000) / 10_000 * size.height
                let length = 1 + Double(generator.next() % 5)
                let angle = Double(generator.next() % 628) / 100
                var fibre = Path()
                fibre.move(to: CGPoint(x: x, y: y))
                fibre.addLine(to: CGPoint(x: x + cos(angle) * length, y: y + sin(angle) * length))
                context.stroke(fibre, with: .color(Theme.hojicha.opacity(opacity)), lineWidth: 0.6)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

struct SplitMix64: RandomNumberGenerator {
    private var state: UInt64

    init(seed: UInt64) {
        state = seed
    }

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}
