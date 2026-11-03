import SwiftData
import SwiftUI

/// 引き出し · 서랍 — browse filed screenshots by drawer (lives in the Memories tab).
struct DrawersSection: View {
    @Query(filter: #Predicate<Clip> { $0.statusRaw == "kept" }, sort: \Clip.capturedAt, order: .reverse)
    private var kept: [Clip]
    @Environment(\.language) private var language

    var body: some View {
        Section(Copy.drawers.text(language)) {
            if kept.isEmpty {
                Text(Copy.drawersEmpty.text(language))
                    .font(.cozy(13))
                    .foregroundStyle(Theme.muted)
            } else {
                ForEach(ClipDrawer.allCases) { drawer in
                    let clips = kept.filter { $0.drawer == drawer }
                    if !clips.isEmpty {
                        NavigationLink {
                            DrawerDetailView(drawer: drawer)
                        } label: {
                            HStack {
                                Label(drawer.label.text(language), systemImage: drawer.icon)
                                    .font(.cozy(15))
                                Spacer()
                                Text("\(clips.count)")
                                    .font(.cozy(13))
                                    .foregroundStyle(Theme.muted)
                            }
                        }
                    }
                }
            }
        }
    }
}

struct DrawerDetailView: View {
    let drawer: ClipDrawer
    @Query private var clips: [Clip]
    @State private var searchText = ""
    @Environment(\.language) private var language

    init(drawer: ClipDrawer) {
        self.drawer = drawer
        let raw = drawer.rawValue
        _clips = Query(
            filter: #Predicate<Clip> { $0.statusRaw == "kept" && $0.drawerRaw == raw },
            sort: \Clip.capturedAt,
            order: .reverse
        )
    }

    private var visible: [Clip] {
        guard !searchText.isEmpty else { return clips }
        return clips.filter {
            $0.ocrText.localizedCaseInsensitiveContains(searchText)
                || $0.note.localizedCaseInsensitiveContains(searchText)
                || $0.tags.contains { $0.localizedCaseInsensitiveContains(searchText) }
        }
    }

    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), spacing: 12)], spacing: 14) {
                ForEach(visible) { clip in
                    NavigationLink {
                        ClipDetailView(clip: clip)
                    } label: {
                        ClipThumbnail(clip: clip)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding()
        }
        .background(Theme.paper)
        .navigationTitle(drawer.label.text(language))
        .searchable(text: $searchText, prompt: Copy.searchText.text(language))
    }
}

struct ClipThumbnail: View {
    let clip: Clip
    @Environment(ScreenshotInbox.self) private var inbox
    @State private var picture: UIImage?

    var body: some View {
        VStack(spacing: 4) {
            Group {
                if let picture {
                    Image(uiImage: picture).resizable().scaledToFill()
                } else {
                    Theme.paperDeep
                }
            }
            .frame(height: 170)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .padding(4)
            .background(.white, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .shadow(color: Theme.hojicha.opacity(0.2), radius: 6, y: 4)
            Text(clip.capturedAt, format: .dateTime.month().day())
                .font(.cozy(11))
                .foregroundStyle(Theme.muted)
        }
        .task(id: clip.assetIdentifier) {
            picture = await inbox.image(for: clip, longestSide: 400)
        }
    }
}

/// One screenshot: full image, OCR text with copy (Clutter's "copy text"), note, tags,
/// move to another drawer, or let go.
struct ClipDetailView: View {
    @Bindable var clip: Clip
    @Environment(ScreenshotInbox.self) private var inbox
    @Environment(\.dismiss) private var dismiss
    @State private var picture: UIImage?
    @State private var newTag = ""
    @State private var copied = false
    @Environment(\.language) private var language

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let picture {
                    Image(uiImage: picture)
                        .resizable()
                        .scaledToFit()
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .shadow(color: Theme.hojicha.opacity(0.25), radius: 12, y: 8)
                }

                if !clip.ocrText.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(Copy.readText.text(language)).font(.cozy(12)).foregroundStyle(Theme.muted)
                            Spacer()
                            Button((copied ? Copy.copied : Copy.copy).text(language)) {
                                UIPasteboard.general.string = clip.ocrText
                                copied = true
                            }
                            .font(.cozy(12))
                        }
                        Text(clip.ocrText)
                            .font(.note(for: clip.ocrText, size: 15))
                            .textSelection(.enabled)
                    }
                    .padding()
                    .background(Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text(Copy.note.text(language)).font(.cozy(12)).foregroundStyle(Theme.muted)
                    TextField(Copy.notePrompt.text(language), text: $clip.note, axis: .vertical)
                        .font(.hand(16))
                    HStack {
                        ForEach(clip.tags, id: \.self) { tag in
                            CozyPill(text: "#\(tag)", tint: Theme.sakura)
                        }
                        TextField(Copy.tagPrompt.text(language), text: $newTag)
                            .font(.cozy(13))
                            .onSubmit {
                                let tag = newTag.trimmingCharacters(in: .whitespaces)
                                if !tag.isEmpty, !clip.tags.contains(tag) {
                                    clip.tags.append(tag)
                                }
                                newTag = ""
                            }
                    }
                }
                .padding()
                .background(Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))

                if let expiry = clip.expiresAt {
                    Label(Copy.fineToLetGo(expiry.formatted(.dateTime.month().day())).text(language), systemImage: "hourglass")
                        .font(.cozy(13))
                }

                HStack {
                    Menu {
                        ForEach(ClipDrawer.allCases) { drawer in
                            Button {
                                clip.drawer = drawer
                            } label: {
                                Label(drawer.label.text(language), systemImage: drawer.icon)
                            }
                        }
                    } label: {
                        Label(Copy.changeDrawer.text(language), systemImage: "tray.and.arrow.down")
                    }
                    Spacer()
                    Button(role: .destructive) {
                        inbox.queueLetGo(clip)
                        dismiss()
                    } label: {
                        Label(Copy.letGo.text(language), systemImage: "leaf")
                    }
                }
                .font(.cozy(14))
            }
            .padding()
        }
        .background(Theme.paper)
        .navigationTitle(clip.capturedAt.formatted(.dateTime.month().day()))
        .navigationBarTitleDisplayMode(.inline)
        .task(id: clip.assetIdentifier) {
            picture = await inbox.image(for: clip, longestSide: 1400)
        }
    }
}

/// Gentle prompt on Today: shown when screenshots are waiting (or to invite first use).
struct TidyInviteCard: View {
    let waiting: Int
    let hasAccess: Bool
    var onOpen: () -> Void
    @Environment(\.language) private var language

    var body: some View {
        Button(action: onOpen) {
            HStack(spacing: 14) {
                Image(systemName: "tray.full")
                    .font(.system(size: 22))
                    .foregroundStyle(Theme.hojicha)
                    .frame(width: 44, height: 44)
                    .background(Color(hex: 0xF3E2C4), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text((hasAccess ? Copy.screenshotsWaiting(waiting) : Copy.tidyInvite).text(language))
                        .font(.cozyBold(15))
                        .foregroundStyle(Theme.ink)
                    Text((hasAccess ? Copy.tidyNudge : Copy.tidyPrivacy).text(language))
                        .font(.cozy(12))
                        .foregroundStyle(Theme.muted)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(Theme.muted)
            }
            .padding()
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}
