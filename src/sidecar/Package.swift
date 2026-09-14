// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MacSidecar",
    platforms: [
        .macOS(.v11)
    ],
    targets: [
        .executableTarget(
            name: "MacSidecar"),
        .testTarget(
            name: "MacSidecarTests",
            dependencies: ["MacSidecar"]),
    ]
)
