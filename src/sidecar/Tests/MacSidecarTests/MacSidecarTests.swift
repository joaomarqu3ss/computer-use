import XCTest
import class Foundation.Bundle

final class MacSidecarTests: XCTestCase {
    var binaryURL: URL {
        let bundle = Bundle(for: type(of: self))
        let binURL = bundle.bundleURL.deletingLastPathComponent().appendingPathComponent("MacSidecar")
        return binURL
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
            process.waitUntilExit()
            
            let dataOut = pipeOut.fileHandleForReading.readDataToEndOfFile()
            let dataErr = pipeErr.fileHandleForReading.readDataToEndOfFile()
            
            let out = String(data: dataOut, encoding: .utf8) ?? ""
            let err = String(data: dataErr, encoding: .utf8) ?? ""
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
}
