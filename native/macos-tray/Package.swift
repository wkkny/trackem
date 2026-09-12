// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "TrackemTray",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "TrackemTray", targets: ["TrackemTray"])],
    targets: [
        .target(name: "TrayProtocol"),
        .executableTarget(name: "TrackemTray", dependencies: ["TrayProtocol"]),
        .testTarget(name: "TrayProtocolTests", dependencies: ["TrayProtocol"])
    ]
)
