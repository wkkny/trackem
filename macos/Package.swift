// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "Trackem",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "Trackem", targets: ["Trackem"]),
    ],
    targets: [
        .target(name: "TrackemCore"),
        .executableTarget(name: "Trackem", dependencies: ["TrackemCore"]),
    ]
)
