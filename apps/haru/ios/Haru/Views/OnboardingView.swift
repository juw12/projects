import SwiftUI

/// First launch: a quiet welcome, the language choice, and *why* we'd like location
/// before iOS asks. Photos access is asked later, in context, from the tidy invite card.
struct OnboardingView: View {
    var onFinish: () -> Void

    @Environment(WalkRecorder.self) private var walks
    @Environment(\.language) private var language
    @AppStorage(LanguageMode.storageKey, store: LanguageMode.sharedDefaults)
    private var languageRaw = LanguageMode.systemDefault.rawValue
    @State private var page = 0

    private static let welcomeScene = SceneKey(weather: .clear, time: .morning, season: .spring)
    private static let walkScene = SceneKey(weather: .partlyCloudy, time: .dusk, season: .autumn)

    var body: some View {
        VStack(spacing: 0) {
            TabView(selection: $page) {
                welcomePage.tag(0)
                languagePage.tag(1)
                walkPage.tag(2)
            }
            .tabViewStyle(.page(indexDisplayMode: .always))
            .indexViewStyle(.page(backgroundDisplayMode: .always))

            Button(action: advance) {
                Text(page < 2 ? Phrase.next.text(language) : Phrase.start.text(language))
                    .font(.cozyBold(17))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(Capsule().fill(Theme.accent))
            }
            .padding(.horizontal, 28)
            .padding(.bottom, 24)
        }
        .background(Theme.paper.ignoresSafeArea())
        .animation(Theme.settle, value: page)
    }

    private func advance() {
        if page < 2 {
            page += 1
        } else {
            onFinish()
        }
    }

    // MARK: Pages

    private var welcomePage: some View {
        VStack(spacing: 22) {
            Spacer(minLength: 12)
            sceneCard(Self.welcomeScene)
            VStack(spacing: 8) {
                Text("Haru")
                    .font(.cozyBold(30, relativeTo: .largeTitle))
                    .foregroundStyle(Theme.ink)
                Text(Phrase.tagline.text(language))
                    .font(.cozy(17))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 32)
            Spacer()
        }
    }

    private var languagePage: some View {
        VStack(spacing: 20) {
            Spacer(minLength: 24)
            Text(Phrase.chooseLanguage.text(language))
                .font(.cozyBold(24, relativeTo: .title))
                .foregroundStyle(Theme.ink)
                .multilineTextAlignment(.center)
            VStack(spacing: 12) {
                ForEach(LanguageMode.allCases) { mode in
                    Button {
                        languageRaw = mode.rawValue
                    } label: {
                        HStack {
                            Text(mode.menuTitle).font(.cozy(18))
                            Spacer()
                            if languageRaw == mode.rawValue {
                                Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.accent)
                            }
                        }
                        .foregroundStyle(Theme.ink)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 16)
                        .background(RoundedRectangle(cornerRadius: 18).fill(Theme.card))
                        .overlay(
                            RoundedRectangle(cornerRadius: 18)
                                .stroke(languageRaw == mode.rawValue ? Theme.accent : .clear, lineWidth: 2)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 28)
            Text(Phrase.changeLater.text(language))
                .font(.cozy(14))
                .foregroundStyle(Theme.muted)
            Spacer()
        }
    }

    private var walkPage: some View {
        VStack(spacing: 22) {
            Spacer(minLength: 12)
            sceneCard(Self.walkScene)
            VStack(spacing: 10) {
                Text(Phrase.walkTitle.text(language))
                    .font(.cozyBold(24, relativeTo: .title))
                    .foregroundStyle(Theme.ink)
                Text(Phrase.walkBody.text(language))
                    .font(.cozy(16))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 32)
            Button {
                walks.requestPermission()
            } label: {
                Label(Phrase.allowLocation.text(language), systemImage: "location")
                    .font(.cozyBold(16))
                    .foregroundStyle(Theme.accent)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                    .background(Capsule().stroke(Theme.accent, lineWidth: 1.5))
            }
            Spacer()
        }
    }

    private func sceneCard(_ key: SceneKey) -> some View {
        Group {
            if let image = key.image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Theme.paperDeep
            }
        }
        .frame(width: 260, height: 260)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cardCorner))
        .shadow(color: Theme.ink.opacity(0.12), radius: 18, y: 10)
    }
}

/// Onboarding-only phrases (kept here so the main Copy table stays focused on everyday UI).
private enum Phrase {
    static let tagline = CozyLabel(
        ja: "毎日を、歩いてめくる小さな町に。",
        ko: "하루하루를, 걸으며 넘기는 작은 동네로.",
        en: "Your days, as a little town you walk through."
    )
    static let chooseLanguage = CozyLabel(ja: "ことばをえらぶ", ko: "언어를 골라요", en: "Choose your language")
    static let changeLater = CozyLabel(
        ja: "あとで設定から変えられます",
        ko: "나중에 설정에서 바꿀 수 있어요",
        en: "You can change this later in Settings"
    )
    static let walkTitle = CozyLabel(ja: "歩いた道を、地図に", ko: "걸은 길을 지도에", en: "Your walks, drawn as a map")
    static let walkBody = CozyLabel(
        ja: "現在地は、歩いた道とその日の天気のためだけに使います。データはこのiPhoneとあなたのiCloudにだけ残ります。",
        ko: "위치는 걸은 길과 그날의 날씨에만 쓰여요. 데이터는 이 iPhone과 당신의 iCloud에만 남아요.",
        en: "Location is only used to draw the streets you walk and show the day's weather. It stays on this iPhone and in your own iCloud."
    )
    static let allowLocation = CozyLabel(ja: "位置情報をゆるす", ko: "위치 허용하기", en: "Allow location")
    static let next = CozyLabel(ja: "つぎへ", ko: "다음", en: "Next")
    static let start = CozyLabel(ja: "はじめる", ko: "시작하기", en: "Let's begin")
}
