import SwiftUI

/// The core visual: today's scene with the day's doodles pinned on top.
/// Mirrors prototypes/daycard.py.
struct DayCardView: View {
    let sceneKey: SceneKey
    let moments: [Moment]
    var compact = false

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            SceneImage(key: sceneKey)
            ForEach(Array(doodles.prefix(3).enumerated()), id: \.offset) { index, image in
                Polaroid(image: image, width: compact ? 70 : 140)
                    .rotationEffect(.degrees([-6, 5, -2][index]))
                    .offset(x: CGFloat(-index * (compact ? 36 : 70)), y: CGFloat(index * -10))
                    .padding(compact ? 8 : 16)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: compact ? 12 : 24, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    private var doodles: [UIImage] {
        moments.compactMap { $0.doodleData }.compactMap(UIImage.init(data:))
    }

    private var accessibilityText: String {
        let weather = sceneKey.weather.rawValue.replacingOccurrences(of: "_", with: " ")
        let time = sceneKey.time.rawValue.replacingOccurrences(of: "_", with: " ")
        return "A \(weather) \(time) in \(sceneKey.season.rawValue), with \(doodles.count) doodles"
    }
}

struct SceneImage: View {
    let key: SceneKey

    var body: some View {
        if let image = key.image {
            Image(uiImage: image)
                .resizable()
                .aspectRatio(1, contentMode: .fit)
        } else {
            Rectangle()
                .fill(Theme.paper)
                .aspectRatio(1, contentMode: .fit)
                .overlay(Text(key.assetName).font(.caption).foregroundStyle(Theme.muted))
        }
    }
}

struct Polaroid: View {
    let image: UIImage
    let width: CGFloat

    var body: some View {
        VStack(spacing: 0) {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(width: width, height: width)
                .clipped()
            Color.white.frame(height: width * 0.2)
        }
        .padding(width * 0.05)
        .background(Color.white)
        .shadow(color: .black.opacity(0.2), radius: 3, x: 3, y: 4)
    }
}
