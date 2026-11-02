import MapKit
import SwiftData
import SwiftUI

/// PlainWalk-style map. Phase 1 draws raw walk polylines on a muted map;
/// Phase 2 replaces this with road-segment matching (prototypes/walkmap)
/// rendered on a blank paper canvas, with the real map as an optional overlay.
struct WalkMapView: View {
    @Query(sort: \Walk.startedAt) private var walks: [Walk]
    @State private var showRealMap = false
    @Environment(\.language) private var language

    private var totalKilometers: Double {
        walks.reduce(0) { $0 + $1.distanceMeters } / 1000
    }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                Map {
                    ForEach(walks) { walk in
                        if let data = walk.fixData {
                            MapPolyline(coordinates: WalkRecorder.decode(data))
                                .stroke(Theme.ink.opacity(0.75), lineWidth: 4)
                        }
                    }
                }
                .mapStyle(showRealMap ? .standard(pointsOfInterest: .excludingAll) : .standard(emphasis: .muted, pointsOfInterest: .excludingAll))
                .overlay {
                    if !showRealMap {
                        // Paper wash so only your own lines stand out.
                        Theme.paper.opacity(0.82).allowsHitTesting(false)
                    }
                }

                HStack {
                    VStack(alignment: .leading) {
                        Text(Copy.walksCount(walks.count).text(language)).font(.cozyBold(16, relativeTo: .headline))
                        Text(Copy.kmOnFoot(totalKilometers).text(language)).font(.cozy(13)).foregroundStyle(Theme.muted)
                    }
                    Spacer()
                    Toggle(Copy.realMap.text(language), isOn: $showRealMap).fixedSize()
                }
                .padding()
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
                .padding()
                .padding(.bottom, 56)
            }
            .navigationTitle(Copy.yourMap.text(language))
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
