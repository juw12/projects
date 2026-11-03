import SwiftUI

struct RootTabView: View {
    @State private var showCapture = AppLaunch.current.sheet == .capture
    @State private var selectedTab = AppLaunch.current.tab
    @AppStorage("onboarding.done") private var onboardingDone = false
    @State private var showOnboarding = false
    @Environment(WalkRecorder.self) private var walks
    @Environment(\.language) private var language

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            TabView(selection: $selectedTab) {
                TodayView()
                    .tabItem { Label(Copy.today.short(language), systemImage: "sun.max") }
                    .tag(AppLaunch.Tab.today)
                DaysView()
                    .tabItem { Label(Copy.days.short(language), systemImage: "calendar") }
                    .tag(AppLaunch.Tab.days)
                WalkMapView()
                    .tabItem { Label(Copy.map.short(language), systemImage: "map") }
                    .tag(AppLaunch.Tab.map)
                MemoriesView()
                    .tabItem { Label(Copy.memories.short(language), systemImage: "sparkles") }
                    .tag(AppLaunch.Tab.memories)
            }
            CaptureButton { showCapture = true }
                .padding(.trailing, 20)
                .padding(.bottom, 64)   // floats just above the tab bar
        }
        .sheet(isPresented: $showCapture) {
            CaptureSheet()
                .presentationDetents([.medium, .large])
        }
        .fullScreenCover(isPresented: $showOnboarding) {
            OnboardingView {
                onboardingDone = true
                showOnboarding = false
                walks.startContextUpdates()
            }
        }
        .onAppear {
            let launch = AppLaunch.current
            if launch.sheet == .onboarding || (!launch.demo && !onboardingDone) {
                showOnboarding = true      // location is asked inside onboarding, with context
            } else if !launch.demo {
                walks.startContextUpdates() // no prompt: only runs if already authorised
            }
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
