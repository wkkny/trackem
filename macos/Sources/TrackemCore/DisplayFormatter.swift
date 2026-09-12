import Foundation

public enum DisplayFormatter {
    public static func plan(_ value: String?) -> String {
        guard let value, !value.isEmpty else { return "Unavailable" }
        return value
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
            .capitalized
    }

    public static func percentLeft(_ usedPercent: Double) -> Int {
        Int((100 - min(100, max(0, usedPercent))).rounded())
    }

    public static func fiveHourReset(_ date: Date?, now: Date = Date()) -> String {
        guard let seconds = remainingSeconds(until: date, now: now) else { return "Unavailable" }
        if seconds == 0 { return "Now" }
        let hours = seconds / 3_600
        let minutes = (seconds % 3_600) / 60
        if hours == 0 { return "\(max(1, minutes))m" }
        return minutes == 0 ? "\(hours)h" : "\(hours)h \(minutes)m"
    }

    public static func weeklyReset(_ date: Date?, now: Date = Date()) -> String {
        guard let seconds = remainingSeconds(until: date, now: now) else { return "Unavailable" }
        if seconds == 0 { return "Now" }
        let days = seconds / 86_400
        let hours = (seconds % 86_400) / 3_600
        if days == 0 { return "\(max(1, hours))h" }
        return hours == 0 ? "\(days)d" : "\(days)d \(hours)h"
    }

    private static func remainingSeconds(until date: Date?, now: Date) -> Int? {
        guard let date else { return nil }
        return max(0, Int(ceil(date.timeIntervalSince(now))))
    }
}
