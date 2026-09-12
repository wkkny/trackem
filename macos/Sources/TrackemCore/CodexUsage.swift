import Foundation

public struct UsageWindow: Sendable {
    public let usedPercent: Double
    public let resetAt: Date?
}

public struct UsageSnapshot: Sendable {
    public let plan: String?
    public let fiveHour: UsageWindow?
    public let weekly: UsageWindow?
    public let bankedResets: Int?
}

public enum CodexUsageError: LocalizedError {
    case missingLogin
    case malformedLogin
    case expiredLogin
    case network
    case unavailable

    public var errorDescription: String? {
        switch self {
        case .missingLogin:
            return "No Codex login found. Run codex login."
        case .malformedLogin:
            return "The Codex login file is invalid. Run codex login again."
        case .expiredLogin:
            return "The Codex login expired. Run codex login again."
        case .network:
            return "Codex could not be reached."
        case .unavailable:
            return "Codex usage is unavailable."
        }
    }
}

public struct CodexUsageClient: Sendable {
    private static let usageURL = URL(string: "https://chatgpt.com/backend-api/wham/usage")!
    private static let resetCreditsURL = URL(string: "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits")!

    public init() {}

    public func fetch() async throws -> UsageSnapshot {
        let credentials = try loadCredentials()
        async let usage = fetchUsage(credentials: credentials)
        async let bankedResets = fetchBankedResets(credentials: credentials)

        let response = try await usage
        let resets = await bankedResets
        let fiveHour = normalize(response.rateLimit?.primaryWindow)
        let weekly = normalize(response.rateLimit?.secondaryWindow)
        guard fiveHour != nil || weekly != nil else { throw CodexUsageError.unavailable }

        return UsageSnapshot(
            plan: response.planType,
            fiveHour: fiveHour,
            weekly: weekly,
            bankedResets: resets
        )
    }

    private func loadCredentials() throws -> Credentials {
        let environment = ProcessInfo.processInfo.environment
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let configuredHome = environment["CODEX_HOME"].flatMap { value -> String? in
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return nil }
            if trimmed == "~" { return home }
            if trimmed.hasPrefix("~/") { return home + String(trimmed.dropFirst()) }
            return trimmed
        }
        let authURL = URL(fileURLWithPath: configuredHome ?? home + "/.codex")
            .appendingPathComponent("auth.json")

        let data: Data
        do {
            data = try Data(contentsOf: authURL)
        } catch {
            throw CodexUsageError.missingLogin
        }

        let auth: AuthFile
        do {
            auth = try JSONDecoder().decode(AuthFile.self, from: data)
        } catch {
            throw CodexUsageError.malformedLogin
        }

        guard !auth.tokens.accessToken.isEmpty else { throw CodexUsageError.missingLogin }
        if tokenIsExpired(auth.tokens.accessToken) { throw CodexUsageError.expiredLogin }
        return Credentials(accessToken: auth.tokens.accessToken, accountID: auth.tokens.accountID)
    }

    private func fetchUsage(credentials: Credentials) async throws -> UsageResponse {
        let (data, response) = try await request(Self.usageURL, credentials: credentials)
        if response.statusCode == 401 || response.statusCode == 403 {
            throw CodexUsageError.expiredLogin
        }
        guard (200..<300).contains(response.statusCode) else { throw CodexUsageError.unavailable }
        do {
            return try JSONDecoder().decode(UsageResponse.self, from: data)
        } catch {
            throw CodexUsageError.unavailable
        }
    }

    private func fetchBankedResets(credentials: Credentials) async -> Int? {
        do {
            let (data, response) = try await request(Self.resetCreditsURL, credentials: credentials)
            guard (200..<300).contains(response.statusCode) else { return nil }
            let payload = try JSONDecoder().decode(ResetCreditsResponse.self, from: data)
            if let available = payload.availableCount, available >= 0 { return available }

            let now = Date()
            return payload.credits?.filter { credit in
                guard credit.redeemedAt == nil,
                      credit.status != "redeemed",
                      credit.status != "expired",
                      !credit.hasInvalidExpiration else { return false }
                return credit.expiresAt.map { $0 > now } ?? true
            }.count
        } catch {
            return nil
        }
    }

    private func request(_ url: URL, credentials: Credentials) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: url)
        request.timeoutInterval = 10
        request.setValue("Bearer \(credentials.accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("codex-cli", forHTTPHeaderField: "User-Agent")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let accountID = credentials.accountID {
            request.setValue(accountID, forHTTPHeaderField: "ChatGPT-Account-Id")
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 10
        configuration.timeoutIntervalForResource = 10
        let session = URLSession(configuration: configuration, delegate: RedirectBlocker(), delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }

        do {
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else { throw CodexUsageError.network }
            return (data, httpResponse)
        } catch let error as CodexUsageError {
            throw error
        } catch {
            throw CodexUsageError.network
        }
    }

    private func normalize(_ window: UsageWindowResponse?) -> UsageWindow? {
        guard let window,
              let usedPercent = window.usedPercent,
              usedPercent.isFinite,
              (0...100).contains(usedPercent) else { return nil }

        let resetAt = window.resetAt.flatMap { value -> Date? in
            guard value.isFinite, abs(value) < 8.64e12 else { return nil }
            return Date(timeIntervalSince1970: value)
        }
        return UsageWindow(usedPercent: usedPercent, resetAt: resetAt)
    }

    private func tokenIsExpired(_ token: String) -> Bool {
        let pieces = token.split(separator: ".")
        guard pieces.count > 1 else { return false }
        var payload = String(pieces[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        payload += String(repeating: "=", count: (4 - payload.count % 4) % 4)
        guard let data = Data(base64Encoded: payload),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let expiry = object["exp"] as? Double else { return false }
        return expiry <= Date().timeIntervalSince1970
    }
}

private final class RedirectBlocker: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

private struct Credentials {
    let accessToken: String
    let accountID: String?
}

private struct AuthFile: Decodable {
    let tokens: Tokens

    struct Tokens: Decodable {
        let accessToken: String
        let accountID: String?

        enum CodingKeys: String, CodingKey {
            case accessToken = "access_token"
            case accountID = "account_id"
        }
    }
}

private struct UsageResponse: Decodable {
    let planType: String?
    let rateLimit: RateLimit?

    enum CodingKeys: String, CodingKey {
        case planType = "plan_type"
        case rateLimit = "rate_limit"
    }

    struct RateLimit: Decodable {
        let primaryWindow: UsageWindowResponse?
        let secondaryWindow: UsageWindowResponse?

        enum CodingKeys: String, CodingKey {
            case primaryWindow = "primary_window"
            case secondaryWindow = "secondary_window"
        }
    }
}

private struct UsageWindowResponse: Decodable {
    let usedPercent: Double?
    let resetAt: Double?

    enum CodingKeys: String, CodingKey {
        case usedPercent = "used_percent"
        case resetAt = "reset_at"
    }
}

private struct ResetCreditsResponse: Decodable {
    let availableCount: Int?
    let credits: [ResetCredit]?

    enum CodingKeys: String, CodingKey {
        case availableCount = "available_count"
        case credits
    }
}

private struct ResetCredit: Decodable {
    let status: String?
    let expiresAt: Date?
    let hasInvalidExpiration: Bool
    let redeemedAt: Date?

    enum CodingKeys: String, CodingKey {
        case status
        case expiresAt = "expires_at"
        case redeemedAt = "redeemed_at"
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        status = try values.decodeIfPresent(String.self, forKey: .status)
        let expiration = Self.decodeExpiration(values)
        expiresAt = expiration.date
        hasInvalidExpiration = expiration.invalid
        redeemedAt = Self.decodeDate(values, key: .redeemedAt)
    }

    private static func decodeExpiration(_ values: KeyedDecodingContainer<CodingKeys>) -> (date: Date?, invalid: Bool) {
        if !values.contains(.expiresAt) || (try? values.decodeNil(forKey: .expiresAt)) == true {
            return (nil, false)
        }
        guard let raw = try? values.decode(String.self, forKey: .expiresAt),
              let date = parseDate(raw) else { return (nil, true) }
        return (date, false)
    }

    private static func decodeDate(_ values: KeyedDecodingContainer<CodingKeys>, key: CodingKeys) -> Date? {
        guard let raw = try? values.decode(String.self, forKey: key) else { return nil }
        return parseDate(raw)
    }

    private static func parseDate(_ raw: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
    }
}
