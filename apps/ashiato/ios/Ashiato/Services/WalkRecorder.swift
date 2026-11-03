import CoreLocation
import CoreMotion
import Foundation

/// Records walks with battery-aware location settings.
/// - Precise GPS only while a walk is active.
/// - Optional auto-start when CoreMotion reports walking (Plus feature).
/// - Fixes are stored raw; map matching (prototypes/walkmap) runs after the walk.
@MainActor
@Observable
final class WalkRecorder: NSObject, CLLocationManagerDelegate {
    private(set) var isRecording = false
    private(set) var distanceMeters: Double = 0
    private(set) var fixes: [CLLocation] = []
    private(set) var lastLocation: CLLocation?
    var autoStartEnabled = false

    private let manager = CLLocationManager()
    private let activity = CMMotionActivityManager()
    private var startedAt: Date?

    /// Reject fixes worse than this; walking map needs street-level accuracy.
    private let maxHorizontalAccuracy: CLLocationAccuracy = 25
    /// Ignore jitter while standing still.
    private let minStepMeters: CLLocationDistance = 3

    override init() {
        super.init()
        manager.delegate = self
        manager.activityType = .fitness
        manager.pausesLocationUpdatesAutomatically = true
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func requestPermission() {
        manager.requestWhenInUseAuthorization()
    }

    var isAuthorized: Bool {
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways: true
        default: false
        }
    }

    /// Low-power location for weather/day context (no GPS). Never prompts: does nothing until
    /// the user has allowed location (asked once, with context, in onboarding).
    func startContextUpdates() {
        guard isAuthorized else { return }
        manager.startMonitoringSignificantLocationChanges()
        manager.requestLocation()
    }

    func start() {
        guard !isRecording else { return }
        fixes.removeAll()
        distanceMeters = 0
        startedAt = .now
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 5
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        manager.startUpdatingLocation()
        isRecording = true
    }

    /// Stops recording and returns the finished walk for persistence and matching.
    func stop() -> Walk? {
        guard isRecording, let startedAt else { return nil }
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        isRecording = false
        let walk = Walk(startedAt: startedAt)
        walk.endedAt = .now
        walk.distanceMeters = distanceMeters
        walk.fixData = Self.encode(fixes)
        return walk
    }

    func enableAutoStart() {
        guard CMMotionActivityManager.isActivityAvailable() else { return }
        autoStartEnabled = true
        activity.startActivityUpdates(to: .main) { [weak self] motion in
            guard let self, let motion, motion.confidence != .low else { return }
            Task { @MainActor in
                if motion.walking, !self.isRecording, self.autoStartEnabled {
                    self.start()
                } else if motion.stationary || motion.automotive, self.isRecording, self.autoStartEnabled {
                    _ = self.stop()
                }
            }
        }
    }

    // MARK: CLLocationManagerDelegate

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        Task { @MainActor in
            for location in locations {
                self.lastLocation = location
                guard self.isRecording,
                      location.horizontalAccuracy > 0,
                      location.horizontalAccuracy <= self.maxHorizontalAccuracy else { continue }
                if let previous = self.fixes.last {
                    let step = location.distance(from: previous)
                    guard step >= self.minStepMeters else { continue }
                    self.distanceMeters += step
                }
                self.fixes.append(location)
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}

    /// Permission granted (e.g. from onboarding): start the low-power context updates right away.
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            self.startContextUpdates()
        }
    }

    // MARK: Encoding (lat, lon as Float32 pairs ~ 8 bytes per fix)

    static func encode(_ locations: [CLLocation]) -> Data {
        var values: [Float32] = []
        values.reserveCapacity(locations.count * 2)
        for location in locations {
            values.append(Float32(location.coordinate.latitude))
            values.append(Float32(location.coordinate.longitude))
        }
        return values.withUnsafeBufferPointer { Data(buffer: $0) }
    }

    static func decode(_ data: Data) -> [CLLocationCoordinate2D] {
        let values = data.withUnsafeBytes { Array($0.bindMemory(to: Float32.self)) }
        return stride(from: 0, to: values.count - 1, by: 2).map {
            CLLocationCoordinate2D(latitude: CLLocationDegrees(values[$0]), longitude: CLLocationDegrees(values[$0 + 1]))
        }
    }
}
