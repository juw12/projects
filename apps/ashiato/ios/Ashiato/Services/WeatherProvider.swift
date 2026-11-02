import CoreLocation
import Foundation
import WeatherKit

/// Fetches today's weather once per hour per location and maps it to a scene.
/// WeatherKit: 500k calls/month are included with the Apple Developer Program.
@MainActor
@Observable
final class WeatherProvider {
    private(set) var sceneKey: SceneKey?
    private(set) var temperatureC: Double?
    private(set) var conditionText: String = ""
    private var lastFetch: (date: Date, location: CLLocation)?

    func refresh(for location: CLLocation, now: Date = .now) async {
        if let lastFetch,
           now.timeIntervalSince(lastFetch.date) < 3600,
           location.distance(from: lastFetch.location) < 5_000 {
            return
        }
        do {
            let (current, daily) = try await WeatherService.shared.weather(for: location, including: .current, .daily)
            let today = daily.forecast.first
            let weather = Self.sceneWeather(for: current.condition, temperatureC: current.temperature.converted(to: .celsius).value)
            sceneKey = SceneKey(
                weather: weather,
                time: SceneKey.TimeOfDay(date: now, sunrise: today?.sun.sunrise, sunset: today?.sun.sunset),
                season: SceneKey.Season(date: now, latitude: location.coordinate.latitude)
            )
            temperatureC = current.temperature.converted(to: .celsius).value
            conditionText = current.condition.description
            lastFetch = (now, location)
        } catch {
            // Offline or quota: fall back to a clock-based scene so the card never looks empty.
            sceneKey = SceneKey(
                weather: sceneKey?.weather ?? .clear,
                time: SceneKey.TimeOfDay(date: now, sunrise: nil, sunset: nil),
                season: SceneKey.Season(date: now, latitude: location.coordinate.latitude)
            )
        }
    }

    static func sceneWeather(for condition: WeatherCondition, temperatureC: Double) -> SceneKey.Weather {
        switch condition {
        case .clear, .mostlyClear:
            return temperatureC >= 32 ? .heat : .clear
        case .hot:
            return .heat
        case .partlyCloudy:
            return .partlyCloudy
        case .cloudy, .mostlyCloudy, .breezy, .windy:
            return .cloudy
        case .foggy, .haze, .smoky, .blowingDust:
            return .fog
        case .drizzle, .rain, .heavyRain, .sunShowers, .freezingDrizzle, .freezingRain:
            return .rain
        case .thunderstorms, .isolatedThunderstorms, .scatteredThunderstorms, .strongStorms,
             .tropicalStorm, .hurricane:
            return .storm
        case .snow, .heavySnow, .flurries, .sunFlurries, .blizzard, .blowingSnow, .sleet,
             .wintryMix, .hail, .frigid:
            return .snow
        @unknown default:
            return .clear
        }
    }
}
