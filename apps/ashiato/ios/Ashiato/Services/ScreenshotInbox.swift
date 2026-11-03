import Foundation
import Photos
import SwiftData
import UIKit
import Vision

/// Finds new screenshots in Photos, reads them on-device (Vision OCR, ja/ko/en),
/// suggests a drawer, spots near-duplicates and ticket expiry dates, and files
/// each one under the day it was taken. Nothing leaves the phone.
@MainActor
@Observable
final class ScreenshotInbox {
    enum Access {
        case unknown, granted, limited, denied
    }

    private(set) var access: Access = .unknown
    private(set) var isScanning = false
    private(set) var scannedCount = 0

    /// Only look this far back on first launch so the first session stays small and calm.
    static let firstScanWindow: TimeInterval = 60 * 60 * 24 * 30
    /// Vision feature-print distance under which two screenshots count as "そっくり".
    /// Starting value — tune on real libraries (see docs/plan.md §4.11).
    nonisolated static let duplicateDistance: Float = 0.35
    private static let lastScanKey = "screenshotInbox.lastScan"
    private static let batchSize = 24

    private let imageManager = PHCachingImageManager()

    // MARK: Permission

    /// Reads the current permission without prompting (used at launch).
    func refreshAccess() {
        access = switch PHPhotoLibrary.authorizationStatus(for: .readWrite) {
        case .authorized: .granted
        case .limited: .limited
        case .notDetermined: .unknown
        default: .denied
        }
    }

    func requestAccess() async {
        let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        access = switch status {
        case .authorized: .granted
        case .limited: .limited
        case .notDetermined: .unknown
        default: .denied
        }
    }

    // MARK: Scanning

    /// Imports screenshots taken since the last scan. Safe to call on every app launch.
    func scan(into context: ModelContext) async {
        guard access == .granted || access == .limited, !isScanning else { return }
        isScanning = true
        defer { isScanning = false }

        let since = (UserDefaults.standard.object(forKey: Self.lastScanKey) as? Date)
            ?? Date.now.addingTimeInterval(-Self.firstScanWindow)
        let scanStarted = Date.now

        let options = PHFetchOptions()
        options.predicate = NSPredicate(
            format: "(mediaSubtypes & %d) != 0 AND creationDate > %@",
            PHAssetMediaSubtype.photoScreenshot.rawValue,
            since as NSDate
        )
        options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
        let result = PHAsset.fetchAssets(with: .image, options: options)

        var assets: [PHAsset] = []
        result.enumerateObjects { asset, _, _ in
            assets.append(asset)
        }

        let known = Set((try? context.fetch(FetchDescriptor<Clip>()))?.map(\.assetIdentifier) ?? [])
        var recentPrints: [(String, VNFeaturePrintObservation)] = []

        for batch in stride(from: 0, to: assets.count, by: Self.batchSize).map({ Array(assets[$0..<min($0 + Self.batchSize, assets.count)]) }) {
            for asset in batch where !known.contains(asset.localIdentifier) {
                guard let picture = await image(for: asset, longestSide: 1400) else { continue }
                async let text = Self.recognizeText(in: picture)
                async let featurePrint = Self.featurePrint(of: picture)
                let ocrText = await text
                let imagePrint = await featurePrint

                let clip = Clip(assetIdentifier: asset.localIdentifier, capturedAt: asset.creationDate ?? .now)
                clip.ocrText = ocrText
                let suggestion = ClipClassifier.shared.classify(ocrText)
                clip.suggestedDrawerRaw = suggestion.drawer.rawValue
                clip.drawer = suggestion.drawer
                if suggestion.drawer == .tickets || suggestion.drawer == .shopping {
                    clip.expiresAt = ExpiryFinder.expiry(in: ocrText, today: clip.capturedAt)
                }
                if let imagePrint {
                    clip.duplicateOfIdentifier = Self.nearestDuplicate(of: imagePrint, among: recentPrints)
                    recentPrints.append((asset.localIdentifier, imagePrint))
                    if recentPrints.count > 40 {
                        recentPrints.removeFirst()   // duplicates are almost always taken close together
                    }
                }
                clip.day = day(for: clip.capturedAt, in: context)
                context.insert(clip)
                scannedCount += 1
            }
            try? context.save()
        }
        resolveCloudIdentifiers(context: context)
        UserDefaults.standard.set(scanStarted, forKey: Self.lastScanKey)
    }

    private func day(for date: Date, in context: ModelContext) -> Day {
        let start = Calendar.current.startOfDay(for: date)
        let descriptor = FetchDescriptor<Day>(predicate: #Predicate { $0.date == start })
        if let existing = try? context.fetch(descriptor).first {
            return existing
        }
        let created = Day(date: start)
        context.insert(created)
        return created
    }

    /// Local identifiers differ per device; store the cloud identifier so synced clips resolve elsewhere.
    private func resolveCloudIdentifiers(context: ModelContext) {
        let descriptor = FetchDescriptor<Clip>(predicate: #Predicate { $0.cloudIdentifier == nil })
        guard let clips = try? context.fetch(descriptor), !clips.isEmpty else { return }
        let mappings = PHPhotoLibrary.shared().cloudIdentifierMappings(forLocalIdentifiers: clips.map(\.assetIdentifier))
        for clip in clips {
            if case .success(let cloudIdentifier) = mappings[clip.assetIdentifier] {
                clip.cloudIdentifier = cloudIdentifier.stringValue
            }
        }
    }

    // MARK: Review actions

    func file(_ clip: Clip, into drawer: ClipDrawer, context: ModelContext) {
        clip.drawer = drawer
        clip.status = .kept
        clip.reviewedAt = .now
        // Short quotes also become echor-style fragments so they can resurface.
        if drawer == .words, clip.ocrText.count <= Fragment.maxLength, !clip.ocrText.isEmpty {
            context.insert(Fragment(text: clip.ocrText.replacingOccurrences(of: "\n", with: " ")))
        }
    }

    func postpone(_ clip: Clip) {
        clip.status = .later
        clip.reviewedAt = .now
    }

    func queueLetGo(_ clip: Clip) {
        clip.status = .letGo
        clip.reviewedAt = .now
    }

    /// Deletes every queued screenshot from Photos in ONE batch, so the user sees a single
    /// system confirmation. iOS keeps them in "Recently Deleted" for 30 days.
    func commitLetGo(context: ModelContext) async throws -> Int {
        let descriptor = FetchDescriptor<Clip>(predicate: #Predicate { $0.statusRaw == "letGo" })
        let queued = try context.fetch(descriptor)
        guard !queued.isEmpty else { return 0 }
        let assets = PHAsset.fetchAssets(withLocalIdentifiers: queued.map(\.assetIdentifier), options: nil)
        try await PHPhotoLibrary.shared().performChanges {
            PHAssetChangeRequest.deleteAssets(assets)
        }
        queued.forEach(context.delete)
        try context.save()
        return queued.count
    }

    /// Returns "later" clips to the inbox at the start of each new session.
    func reopenPostponed(context: ModelContext) {
        let descriptor = FetchDescriptor<Clip>(predicate: #Predicate { $0.statusRaw == "later" })
        for clip in (try? context.fetch(descriptor)) ?? [] {
            clip.status = .inbox
        }
    }

    // MARK: Images

    func image(for clip: Clip, longestSide: CGFloat = 900) async -> UIImage? {
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [clip.assetIdentifier], options: nil).firstObject else {
            return nil
        }
        return await image(for: asset, longestSide: longestSide)
    }

    func image(for asset: PHAsset, longestSide: CGFloat) async -> UIImage? {
        let scale = longestSide / CGFloat(max(asset.pixelWidth, asset.pixelHeight, 1))
        let target = CGSize(width: CGFloat(asset.pixelWidth) * scale, height: CGFloat(asset.pixelHeight) * scale)
        let options = PHImageRequestOptions()
        options.deliveryMode = .highQualityFormat
        options.isNetworkAccessAllowed = true   // screenshots may be optimised to iCloud
        options.resizeMode = .exact
        return await withCheckedContinuation { continuation in
            imageManager.requestImage(for: asset, targetSize: target, contentMode: .aspectFit, options: options) { image, _ in
                continuation.resume(returning: image)
            }
        }
    }

    /// Rough on-disk size for the "about x MB freed" line. PhotoKit has no public file-size API,
    /// so estimate from pixels (iPhone PNG/HEIC screenshots average ~0.5 byte per pixel).
    static func estimatedBytes(of identifier: String) -> Int64 {
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [identifier], options: nil).firstObject else { return 0 }
        return Int64(Double(asset.pixelWidth * asset.pixelHeight) * 0.5)
    }

    // MARK: Vision (off the main actor)

    nonisolated static func recognizeText(in picture: UIImage) async -> String {
        guard let cgImage = picture.cgImage else { return "" }
        return await withCheckedContinuation { continuation in
            let request = VNRecognizeTextRequest { request, _ in
                let lines = (request.results as? [VNRecognizedTextObservation])?
                    .compactMap { $0.topCandidates(1).first?.string } ?? []
                continuation.resume(returning: lines.joined(separator: "\n"))
            }
            request.recognitionLevel = .accurate
            request.recognitionLanguages = ["ja-JP", "ko-KR", "en-US"]
            request.usesLanguageCorrection = true
            do {
                try VNImageRequestHandler(cgImage: cgImage).perform([request])
            } catch {
                continuation.resume(returning: "")
            }
        }
    }

    nonisolated static func featurePrint(of picture: UIImage) async -> VNFeaturePrintObservation? {
        guard let cgImage = picture.cgImage else { return nil }
        let request = VNGenerateImageFeaturePrintRequest()
        try? VNImageRequestHandler(cgImage: cgImage).perform([request])
        return request.results?.first as? VNFeaturePrintObservation
    }

    nonisolated static func nearestDuplicate(
        of imagePrint: VNFeaturePrintObservation,
        among others: [(String, VNFeaturePrintObservation)]
    ) -> String? {
        var best: (String, Float)?
        for (identifier, other) in others {
            var distance: Float = .greatestFiniteMagnitude
            guard (try? imagePrint.computeDistance(&distance, to: other)) != nil else { continue }
            if distance < duplicateDistance, distance < (best?.1 ?? .greatestFiniteMagnitude) {
                best = (identifier, distance)
            }
        }
        return best?.0
    }
}
