import Foundation

public enum ProtocolError: Error { case invalidMessage, oversizedLine }
public enum Provider: String, Decodable { case codex, claude }
public enum WindowID: String, Decodable { case fiveHour, weekly }
public enum Action: String, Encodable { case dashboard, settings, refresh, quit, opened }

public struct QuotaWindow: Decodable {
    public let id: WindowID
    public let usedPercent: Double
    public let resetAt: String?
}
public struct Account: Decodable {
    public let id: String
    public let provider: Provider
    public let label: String
    public let plan: String?
    public let available: Bool
    public let updatedAt: String?
    public let windows: [QuotaWindow]
    public let bankedResets: Int?
    public let status: String
}
public struct Snapshot: Decodable {
    public let version: Int
    public let type: String
    public let checkedAt: String?
    public let appVersion: String?
    public let accounts: [Account]

    public static func decode(_ data: Data) throws -> Snapshot {
        guard data.count <= LineDecoder.limit else { throw ProtocolError.oversizedLine }
        let value = try JSONDecoder().decode(Snapshot.self, from: data)
        guard value.version == 1, value.type == "snapshot", value.accounts.count <= 22,
              Set(value.accounts.map(\.id)).count == value.accounts.count else { throw ProtocolError.invalidMessage }
        if let appVersion = value.appVersion {
            guard appVersion.count <= 24,
                  appVersion.allSatisfy({ $0.isLetter || $0.isNumber || ".+-".contains($0) })
            else { throw ProtocolError.invalidMessage }
        }
        for account in value.accounts {
            guard account.id.count <= 80, account.label.count <= 160, account.status.count <= 200,
                  (account.plan?.count ?? 0) <= 160, account.windows.count <= 2,
                  account.available || account.windows.isEmpty,
                  Set(account.windows.map(\.id)).count == account.windows.count,
                  (account.bankedResets ?? 0) >= 0 else { throw ProtocolError.invalidMessage }
            for window in account.windows {
                guard window.usedPercent.isFinite, (0...100).contains(window.usedPercent) else { throw ProtocolError.invalidMessage }
            }
        }
        return value
    }
}

public struct Event: Encodable {
    public let version = 1
    public let type: String
    public let action: Action?
    public init(action: Action? = nil) { self.type = action == nil ? "ready" : "action"; self.action = action }
    public func line() throws -> Data {
        var data = try JSONEncoder().encode(self)
        data.append(10)
        return data
    }
}

/** Bounded framing, including when the parent sends a partial UTF-8 character. */
public struct LineDecoder {
    public static let limit = 256 * 1024
    private var buffer = Data()
    public init() {}
    public mutating func append(_ data: Data) throws -> [Data] {
        var lines: [Data] = []
        for byte in data {
            if byte == 10 { lines.append(buffer); buffer = Data() }
            else {
                guard buffer.count < Self.limit else { throw ProtocolError.oversizedLine }
                buffer.append(byte)
            }
        }
        return lines
    }
}

public func parseDate(_ text: String?) -> Date? {
    guard let text else { return nil }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: text) ?? ISO8601DateFormatter().date(from: text)
}

public func resetDescription(_ text: String?, now: Date = Date()) -> String {
    guard let date = parseDate(text) else { return "Reset time unavailable" }
    let minutes = Int(ceil(date.timeIntervalSince(now) / 60))
    guard minutes > 0 else { return "Reset due. Refresh to check." }
    let days = minutes / 1440, hours = (minutes % 1440) / 60
    if days > 0 { return "Resets in \(days)d \(hours)h" }
    if hours > 0 { return "Resets in \(hours)h \(minutes % 60)m" }
    return "Resets in \(minutes)m"
}
