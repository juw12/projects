import SwiftUI

struct RootTabView: View {
    @State private var showCapture = false
    @Environment(WalkRecorder.self) private var walks
    @Environment(\.language) private var language

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            TabView {
                TodayView()
                    .tabItem { Label(Copy.today.short(language), systemImage: "sun.max") }
                DaysView()
                    .tabItem { Label(Copy.days.short(language), systemImage: "calendar") }
                WalkMapView()
                    .tabItem { Label(Copy.map.short(language), systemImage: "map") }
                MemoriesView()
                    .tabItem { Label(Copy.memories.short(language), systemImage: "sparkles") }
            }
            CaptureButton { showCapture = true }
                .padding(.trailing, 20)
                .padding(.bottom, 64)   // floats just above the tab bar
        }
        .sheet(isPresented: $showCapture) {
            CaptureSheet()
                .presentationDetents([.medium, .large])
        }
        .onAppear {
            walks.requestPermission()
            walks.startContextUpdates()
        }
    }
}

private struct CaptureButton: View {
    var action: () -> Void
    @Environment(\.language) private var language

    var body: some View {
        Button(action: action) {
            Image(systemName: "plus")
                .font(.title2.weight(.bold))
                .foregroundStyle(.white)
                .frame(width: 58, height: 58)
                .background(Circle().fill(Theme.accent))
                .shadow(radius: 4, y: 2)
        }
        .accessibilityLabel(Copy.captureMoment.text(language))
    }
}
