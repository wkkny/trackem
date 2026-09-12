import Foundation
import Testing
@testable import TrayProtocol

struct ProtocolTests {
    private let empty = #"{"version":1,"type":"snapshot","checkedAt":null,"accounts":[]}"#
    @Test func testEmptyIsNotFakeQuota() throws {
        let snapshot = try Snapshot.decode(Data(empty.utf8))
        #expect(snapshot.accounts.isEmpty)
        #expect(snapshot.checkedAt == nil)
        #expect(snapshot.appVersion == nil)
        let versioned = try Snapshot.decode(Data(empty.replacingOccurrences(of: #""accounts":[]"#, with: #""appVersion":"0.1.0","accounts":[]"#).utf8))
        #expect(versioned.appVersion == "0.1.0")
    }
    @Test func testRejectsOversizedOrUnsafeVersion() {
        let long = empty.replacingOccurrences(of: #""accounts":[]"#, with: #""appVersion":"# + String(repeating: "1", count: 30) + #""accounts":[]"#)
        #expect(throws: (any Error).self) { try Snapshot.decode(Data(long.utf8)) }
        let unsafe = empty.replacingOccurrences(of: #""accounts":[]"#, with: #""appVersion":"0.1<>\n","accounts":[]"#)
        #expect(throws: (any Error).self) { try Snapshot.decode(Data(unsafe.utf8)) }
    }
    @Test func testRejectsWrongVersionAndMessage() {
        #expect(throws: (any Error).self) { try Snapshot.decode(Data(empty.replacingOccurrences(of: #""version":1"#, with: #""version":2"#).utf8)) }
        #expect(throws: (any Error).self) { try Snapshot.decode(Data("{}".utf8)) }
    }
    @Test func testBoundedFramingWithSplitUTF8AndMultipleLines() throws {
        let data = Data("é\nsecond\n".utf8)
        var decoder = LineDecoder()
        #expect(try decoder.append(data.prefix(1)).isEmpty)
        let lines = try decoder.append(data.dropFirst())
        #expect(lines.map { String(decoding: $0, as: UTF8.self) } == ["é", "second"])
        #expect(throws: (any Error).self) { try decoder.append(Data(repeating: 65, count: LineDecoder.limit + 1)) }
    }
    @Test func testEventSchema() throws {
        let ready = try JSONSerialization.jsonObject(with: Event().line()) as? [String: Any]
        #expect(ready?["version"] as? Int == 1)
        #expect(ready?["type"] as? String == "ready")
        let action = try JSONSerialization.jsonObject(with: Event(action: .settings).line()) as? [String: Any]
        #expect(action?["action"] as? String == "settings")
    }
    @Test func testExpiredResetIsNotARefilledQuota() {
        let now = Date(timeIntervalSince1970: 1000)
        #expect(resetDescription("1970-01-01T00:00:00.000Z", now: now) == "Reset due. Refresh to check.")
        #expect(resetDescription(nil, now: now) == "Reset time unavailable")
        #expect(resetDescription("bad date", now: now) == "Reset time unavailable")
    }
    @Test func testRejectsInvalidQuota() throws {
        let account: [String: Any] = [
            "id": "codex:0", "provider": "codex", "label": "Codex",
            "available": true, "windows": [["id": "fiveHour", "usedPercent": 101]],
            "status": "Provider-reported subscription usage"
        ]
        let data = try JSONSerialization.data(withJSONObject: ["version": 1, "type": "snapshot", "accounts": [account]])
        #expect(throws: (any Error).self) { try Snapshot.decode(data) }
    }
}
