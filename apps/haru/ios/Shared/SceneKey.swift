import Foundation

/// Identifies one of the 192 bundled base scenes:
/// Resources/Scenes/<weather>__<time>__<season>.jpg
/// (cozy 3D dioramas rendered by prototypes/cozy3d — keep names in sync; load via `SceneKey.image`).
struct SceneKey: Hashable, Codable {
    enum Weather: String, Codable, CaseIterable {
        case clear, partlyCloudy = "partly_cloudy", cloudy, rain, storm, snow, fog, heat
    }

    enum TimeOfDay: String, Codable, CaseIterable {
        case dawn, morning, noon, dusk, night, lateNight = "late_night"

        init(date: Date, sunrise: Date?, sunset: Date?, calendar: Calendar = .current) {
            if let sunrise, let sunset {
                let hour: TimeInterval = 3600
                switch date {
                case ..<sunrise.addingTimeInterval(-hour):
                    let midnightDistance = date.timeIntervalSince(calendar.startOfDay(for: date))
                    self = midnightDistance < 4 * hour ? .lateNight : .night
                    return
                case ..<sunrise.addingTimeInterval(hour): self = .dawn; return
                case ..<sunrise.addingTimeInterval(5 * hour): self = .morning; return
                case ..<sunset.addingTimeInterval(-hour): self = .noon; return
                case ..<sunset.addingTimeInterval(hour): self = .dusk; return
                default: break
                }
            }
            let hourOfDay = calendar.component(.hour, from: date)
            switch hourOfDay {
            case 0..<4: self = .lateNight
            case 4..<7: self = .dawn
            case 7..<11: self = .morning
            case 11..<17: self = .noon
            case 17..<20: self = .dusk
            default: self = .night
            }
        }
    }

    enum Season: String, Codable, CaseIterable {
        case spring, summer, autumn, winter

        init(date: Date, latitude: Double, calendar: Calendar = .current) {
            let month = calendar.component(.month, from: date)
            let northern: Season
            switch month {
            case 3...5: northern = .spring
            case 6...8: northern = .summer
            case 9...11: northern = .autumn
            default: northern = .winter
            }
            guard latitude < 0 else {
                self = northern
                return
            }
            switch northern {
            case .spring: self = .autumn
            case .summer: self = .winter
            case .autumn: self = .spring
            case .winter: self = .summer
            }
        }
    }

    var weather: Weather
    var time: TimeOfDay
    var season: Season

    var assetName: String { "\(weather.rawValue)__\(time.rawValue)__\(season.rawValue)" }
}
