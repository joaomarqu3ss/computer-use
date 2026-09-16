import XCTest
import class Foundation.Bundle

final class MacSidecarTests: XCTestCase {
    var binaryURL: URL {
        let bundle = Bundle(for: type(of: self))
        let binURL = bundle.bundleURL.deletingLastPathComponent().appendingPathComponent("MacSidecar")
        return binURL
    }
    
    // Screenshot/stream output exceeds the 64KB pipe buffer, so both pipes
    // must be drained concurrently or the child deadlocks mid-write.
    final class Drain: @unchecked Sendable {
        var out = Data()
        var err = Data()
    }

    func runBinary(with args: [String]) -> (String, String, Int) {
        let process = Process()
        process.executableURL = binaryURL
        process.arguments = args

        let pipeOut = Pipe()
        let pipeErr = Pipe()
        process.standardOutput = pipeOut
        process.standardError = pipeErr

        do {
            try process.run()
            let drain = Drain()
            let group = DispatchGroup()
            group.enter()
            DispatchQueue.global().async {
                drain.out = pipeOut.fileHandleForReading.readDataToEndOfFile()
                group.leave()
            }
            group.enter()
            DispatchQueue.global().async {
                drain.err = pipeErr.fileHandleForReading.readDataToEndOfFile()
                group.leave()
            }
            process.waitUntilExit()
            group.wait()

            let out = String(data: drain.out, encoding: .utf8) ?? ""
            let err = String(data: drain.err, encoding: .utf8) ?? ""
            return (out, err, Int(process.terminationStatus))
        } catch {
            return ("", "", -1)
        }
    }
    
    func testCheckPermissions() throws {
        let (out, err, status) = runBinary(with: ["check-permissions"])
        XCTAssertTrue(status == 0 || status == 1)
        if status == 1 {
            XCTAssertEqual(out.trimmingCharacters(in: .whitespacesAndNewlines), "false")
            XCTAssertTrue(err.contains("Permissões insuficientes"))
        }
    }
    
    func testInvalidJSON() throws {
        let (out, err, status) = runBinary(with: ["not-a-json"])
        XCTAssertEqual(status, 1)
        XCTAssertTrue(out.contains("\"is_error\":true"))
        
        // Check for either the JSON parse error (if permissions granted) or the permission error
        XCTAssertTrue(out.contains("Invalid JSON input") || err.contains("Permissões insuficientes"))
    }
    
    func testScaleMapping() throws {
        let call = """
        {"id": "call_1", "member": "cursor_position", "input": {}}
        """
        let (out, err, _) = runBinary(with: [call])
        if out.contains("\"is_error\":true") {
            XCTAssertTrue(err.contains("Permissões insuficientes"))
        } else {
            XCTAssertTrue(out.contains("call_1"))
        }
    }

    func runDaemon(with commands: [String], timeout: TimeInterval = 60, env: [String: String]? = nil) -> [String] {
        let process = Process()
        process.executableURL = binaryURL
        process.arguments = ["daemon"]
        if let env = env {
            var merged = ProcessInfo.processInfo.environment
            for (k, v) in env { merged[k] = v }
            process.environment = merged
        }

        let pipeIn = Pipe()
        let pipeOut = Pipe()
        process.standardInput = pipeIn
        process.standardOutput = pipeOut
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
        } catch {
            return []
        }

        let input = (commands.joined(separator: "\n") + "\n").data(using: .utf8)!
        pipeIn.fileHandleForWriting.write(input)
        pipeIn.fileHandleForWriting.closeFile()

        // Drain stdout concurrently: stream frames exceed the pipe buffer.
        let drain = Drain()
        let group = DispatchGroup()
        group.enter()
        DispatchQueue.global().async {
            drain.out = pipeOut.fileHandleForReading.readDataToEndOfFile()
            group.leave()
        }

        // Watchdog: never hang the suite on a stuck daemon.
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout) {
            if process.isRunning { process.terminate() }
        }
        process.waitUntilExit()
        group.wait()

        let out = String(data: drain.out, encoding: .utf8) ?? ""
        return out.components(separatedBy: "\n").filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
    }

    func testDaemonPingAndUnknownCommand() throws {
        let lines = runDaemon(with: ["{\"cmd\":\"ping\"}", "{\"cmd\":\"bogus-cmd\"}"])
        XCTAssertGreaterThanOrEqual(lines.count, 2)
        XCTAssertTrue(lines[0].contains("\"ok\":true"), lines[0])
        XCTAssertTrue(lines[1].contains("Unknown daemon command"), lines[1])
    }

    func testOverlayDescribeDefaultsToHidden() throws {
        let lines = runDaemon(with: ["{\"cmd\":\"overlay-describe\"}"])
        XCTAssertEqual(lines.count, 1)
        XCTAssertTrue(lines[0].contains("\"visible\":false"), lines[0])
    }

    func testOverlayShowDescribeHide() throws {
        let lines = runDaemon(with: [
            "{\"cmd\":\"overlay-show\",\"id\":\"a\"}",
            "{\"cmd\":\"overlay-describe\",\"id\":\"b\"}",
            "{\"cmd\":\"overlay-event\",\"id\":\"c\",\"member\":\"left_click\",\"coordinate\":[735,478],\"pulse\":{\"color\":\"blue\",\"pulses\":1}}",
            "{\"cmd\":\"overlay-hide\",\"id\":\"d\"}",
        ])
        XCTAssertEqual(lines.count, 4, lines.joined(separator: "\n"))
        XCTAssertTrue(lines[0].contains("\"ok\":true"), lines[0])
        // sharingType 0 = kCGWindowSharingNone: the overlay is excluded from
        // captures, so the model never sees the halo.
        XCTAssertTrue(lines[1].contains("\"visible\":true"), lines[1])
        XCTAssertTrue(lines[1].contains("\"sharingType\":0"), lines[1])
        XCTAssertTrue(lines[1].contains("\"ignoresMouseEvents\":true"), lines[1])
        XCTAssertTrue(lines[2].contains("\"ok\":true"), lines[2])
        XCTAssertTrue(lines[3].contains("\"ok\":true"), lines[3])
    }

    func testStreamStartFrameStop() throws {
        let lines = runDaemon(with: [
            "{\"cmd\":\"stream-start\",\"id\":\"a\"}",
            "{\"cmd\":\"stream-frame\",\"id\":\"b\"}",
            "{\"cmd\":\"stream-frame\",\"id\":\"c\"}",
            "{\"cmd\":\"stream-frame\",\"id\":\"d\"}",
            "{\"cmd\":\"stream-stop\",\"id\":\"e\"}",
        ], timeout: 90)
        XCTAssertEqual(lines.count, 5, lines.joined(separator: "\n"))
        XCTAssertTrue(lines[0].contains("\"ok\":true"), lines[0])
        XCTAssertTrue(lines[0].contains("excludedWindows"), lines[0])
        let frames = [lines[1], lines[2], lines[3]].filter { $0.contains("base64_image") }
        XCTAssertFalse(frames.isEmpty, lines.joined(separator: "\n"))
        guard let first = frames.first else { return }
        XCTAssertTrue(first.contains("\"imageFormat\":\"jpeg\""), first.prefix(200).description)
        XCTAssertTrue(first.contains("9j\\/"), first.prefix(300).description) // \/9j\/ after JSON escaping
        XCTAssertTrue(lines[4].contains("\"ok\":true"), lines[4])
    }

    func testSnapFrameWritesJPEGFile() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("cu-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }

        let lines = runDaemon(with: [
            "{\"cmd\":\"overlay-show\",\"id\":\"a\"}",
            "{\"cmd\":\"stream-start\",\"id\":\"b\"}",
            "{\"cmd\":\"snap-frame\",\"id\":\"c\",\"nonce\":\"snaptest1\"}",
            "{\"cmd\":\"snap-frame\",\"id\":\"d\",\"nonce\":\"bad nonce!\"}",
            "{\"cmd\":\"stream-stop\",\"id\":\"e\"}",
        ], timeout: 90, env: ["COMPUTER_USE_FRAME_DIR": dir.path])
        XCTAssertEqual(lines.count, 5, lines.joined(separator: "\n"))
        XCTAssertTrue(lines[1].contains("excludedWindows"), lines[0] + lines[1])
        XCTAssertTrue(lines[2].contains("\"nonce\":\"snaptest1\""), lines[2])
        XCTAssertTrue(lines[3].contains("is_error"), lines[3])

        let frameURL = dir.appendingPathComponent("frame-snaptest1.jpg")
        XCTAssertTrue(FileManager.default.fileExists(atPath: frameURL.path), lines.joined(separator: "\n"))
        let data = try Data(contentsOf: frameURL)
        XCTAssertGreaterThan(data.count, 10_000)
        XCTAssertEqual(data[0], 0xFF)
        XCTAssertEqual(data[1], 0xD8) // JPEG magic
    }

    func testScreenshotIsJPEG() throws {
        let (out, err, _) = runBinary(with: ["{\"id\": \"shot1\", \"member\": \"screenshot\", \"input\": {}}"])
        if out.contains("\"is_error\":true") {
            XCTAssertTrue(err.contains("Permissões insuficientes"))
        } else {
            XCTAssertTrue(out.contains("\"imageFormat\":\"jpeg\""), out.prefix(200).description)
            XCTAssertTrue(out.contains("9j\\/"), out.prefix(400).description) // \/9j\/ after JSON escaping
        }
    }
}
