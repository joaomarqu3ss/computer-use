import Foundation
import Cocoa
import CoreGraphics
import ApplicationServices

let keyMap: [String: CGKeyCode] = [
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9,
    "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19,
    "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28,
    "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35, "l": 37, "j": 38,
    "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47,
    "space": 49, "return": 36, "enter": 36, "tab": 48, "backspace": 51, "escape": 53, "esc": 53,
    "command": 55, "cmd": 55, "meta": 55, "super": 55, "shift": 56, "capslock": 57,
    "option": 58, "alt": 58, "control": 59, "ctrl": 59, "rightshift": 60,
    "rightoption": 61, "rightcontrol": 62, "fn": 63,
    "up": 126, "down": 125, "left": 123, "right": 124
]

func checkPermissions() -> Bool {
    let trusted = AXIsProcessTrusted()
    var screenAccess = true
    if #available(macOS 11.0, *) {
        screenAccess = CGPreflightScreenCaptureAccess()
    }
    
    if !trusted || !screenAccess {
        let msg = "Permissões insuficientes. Vá para System Settings > Privacy & Security. " +
        "Certifique-se de habilitar Accessibility e Screen Recording para este terminal/aplicativo. " +
        "Veja screenshots/accessibility.png e screenshots/screen_system_audio_recording.png para referência."
        fputs(msg + "\n", stderr)
        return false
    }
    return true
}

func getScreenScale() -> CGFloat {
    return NSScreen.main?.backingScaleFactor ?? 1.0
}

func handleScreenshot(region: [Double]? = nil) -> [String: Any] {
    guard var image = captureScreenImage() else {
        return ["is_error": true, "error": "Failed to capture screen"]
    }

    if region != nil {
        guard let cropped = cropImage(image, region: region) else {
            return ["is_error": true, "error": "Invalid region for crop"]
        }
        image = cropped
    }

    guard let base64 = encodeJPEG(image) else {
        return ["is_error": true, "error": "Failed to encode screen to JPEG"]
    }

    return ["base64_image": base64, "imageFormat": "jpeg"]
}

func mapCoordinate(_ coord: [Double]) -> CGPoint {
    let scale = getScreenScale()
    return CGPoint(x: coord[0] / Double(scale), y: coord[1] / Double(scale))
}

func getCurrentCursor() -> CGPoint {
    let event = CGEvent(source: nil)
    return event?.location ?? CGPoint.zero
}

func parseModifiers(_ text: String?) -> CGEventFlags {
    guard let text = text else { return [] }
    var flags = CGEventFlags()
    let parts = text.lowercased().components(separatedBy: "+")
    if parts.contains("shift") { flags.insert(.maskShift) }
    if parts.contains("ctrl") || parts.contains("control") { flags.insert(.maskControl) }
    if parts.contains("alt") || parts.contains("option") { flags.insert(.maskAlternate) }
    if parts.contains("cmd") || parts.contains("command") || parts.contains("meta") || parts.contains("super") { flags.insert(.maskCommand) }
    return flags
}

func handleAction(member: String, input: [String: Any]) -> [String: Any] {
    let scale = getScreenScale()
    
    func getPoint() -> CGPoint {
        if let coord = input["coordinate"] as? [Double] {
            return mapCoordinate(coord)
        }
        return getCurrentCursor()
    }
    
    let source = CGEventSource(stateID: .hidSystemState)
    
    switch member {
    case "left_click", "right_click", "middle_click":
        let point = getPoint()
        let flags = parseModifiers(input["text"] as? String)
        let button: CGMouseButton = member == "right_click" ? .right : (member == "middle_click" ? .center : .left)
        let downType: CGEventType = member == "right_click" ? .rightMouseDown : (member == "middle_click" ? .otherMouseDown : .leftMouseDown)
        let upType: CGEventType = member == "right_click" ? .rightMouseUp : (member == "middle_click" ? .otherMouseUp : .leftMouseUp)
        
        let down = CGEvent(mouseEventSource: source, mouseType: downType, mouseCursorPosition: point, mouseButton: button)
        down?.flags = flags
        let up = CGEvent(mouseEventSource: source, mouseType: upType, mouseCursorPosition: point, mouseButton: button)
        up?.flags = flags
        
        down?.post(tap: .cghidEventTap)
        up?.post(tap: .cghidEventTap)
        return ["text": "OK"]
        
    case "double_click", "triple_click":
        let point = getPoint()
        let flags = parseModifiers(input["text"] as? String)
        let clicks = member == "triple_click" ? 3 : 2
        
        for i in 1...clicks {
            let down = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)
            down?.flags = flags
            down?.setIntegerValueField(.mouseEventClickState, value: Int64(i))
            down?.post(tap: .cghidEventTap)
            
            let up = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)
            up?.flags = flags
            up?.setIntegerValueField(.mouseEventClickState, value: Int64(i))
            up?.post(tap: .cghidEventTap)
        }
        return ["text": "OK"]
        
    case "mouse_move":
        let point = getPoint()
        let move = CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)
        move?.post(tap: .cghidEventTap)
        return ["text": "OK"]
        
    case "left_mouse_down":
        let point = getPoint()
        let down = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)
        down?.post(tap: .cghidEventTap)
        return ["text": "OK"]
        
    case "left_mouse_up":
        let point = getPoint()
        let up = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)
        up?.post(tap: .cghidEventTap)
        return ["text": "OK"]
        
    case "left_click_drag":
        guard let startCoord = input["start_coordinate"] as? [Double], let endCoord = input["coordinate"] as? [Double] else {
            return ["is_error": true, "error": "Missing coordinates for drag"]
        }
        let start = mapCoordinate(startCoord)
        let end = mapCoordinate(endCoord)
        
        let down = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: start, mouseButton: .left)
        let drag = CGEvent(mouseEventSource: source, mouseType: .leftMouseDragged, mouseCursorPosition: end, mouseButton: .left)
        let up = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: end, mouseButton: .left)
        
        down?.post(tap: .cghidEventTap)
        usleep(50000) // 50ms pause
        drag?.post(tap: .cghidEventTap)
        usleep(50000)
        up?.post(tap: .cghidEventTap)
        return ["text": "OK"]
        
    case "type":
        guard let text = input["text"] as? String else { return ["is_error": true, "error": "Missing text"] }
        // Escape backslashes first, then quotes
        let escapedText = text.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
        let scriptStr = "tell application \"System Events\" to keystroke \"\(escapedText)\""
        var error: NSDictionary?
        if let script = NSAppleScript(source: scriptStr) {
            script.executeAndReturnError(&error)
            if let err = error {
                return ["is_error": true, "error": "AppleScript error: \(err)"]
            }
        }
        return ["text": "OK"]
        
    case "key":
        guard let text = input["text"] as? String else { return ["is_error": true, "error": "Missing text"] }
        let repeatCount = input["repeat"] as? Int ?? 1
        var appleScriptCommand = ""
        let lower = text.lowercased()
        
        let specialKeys: [String: Int] = [
            "return": 36, "enter": 36, "tab": 48, "space": 49,
            "escape": 53, "esc": 53, "backspace": 51,
            "up": 126, "down": 125, "left": 123, "right": 124
        ]
        
        if let keyCode = specialKeys[lower] {
            appleScriptCommand = "tell application \"System Events\" to key code \(keyCode)"
        } else {
            let parts = lower.components(separatedBy: "+")
            if parts.count > 1 {
                let char = parts.last!
                var modifiers = [String]()
                if parts.contains("ctrl") || parts.contains("control") { modifiers.append("control down") }
                if parts.contains("shift") { modifiers.append("shift down") }
                if parts.contains("alt") || parts.contains("option") { modifiers.append("option down") }
                if parts.contains("meta") || parts.contains("cmd") || parts.contains("command") || parts.contains("super") { modifiers.append("command down") }
                
                if let keyCode = specialKeys[char] {
                    appleScriptCommand = "tell application \"System Events\" to key code \(keyCode) using {\(modifiers.joined(separator: ", "))}"
                } else {
                    appleScriptCommand = "tell application \"System Events\" to keystroke \"\(char)\" using {\(modifiers.joined(separator: ", "))}"
                }
            } else {
                appleScriptCommand = "tell application \"System Events\" to keystroke \"\(text)\""
            }
        }
        
        var error: NSDictionary?
        if let script = NSAppleScript(source: appleScriptCommand) {
            for _ in 0..<repeatCount {
                script.executeAndReturnError(&error)
                if let err = error {
                    return ["is_error": true, "error": "AppleScript error: \(err)"]
                }
            }
        }
        return ["text": "OK"]
        
    case "hold_key":
        guard let text = input["text"] as? String, let duration = input["duration"] as? Double else {
            return ["is_error": true, "error": "Missing text or duration"]
        }
        
        // We need a robust CGEvent mapping for hold_key
        var keysToHold = [CGKeyCode]()
        let parts = text.lowercased().components(separatedBy: "+")
        for part in parts {
            if let code = keyMap[part] {
                keysToHold.append(code)
            }
        }
        
        if keysToHold.isEmpty {
            // fallback: return unsupported explicitly
            return ["is_error": true, "error": "Unsupported key for hold_key: \(text)"]
        }
        
        // Press down
        for code in keysToHold {
            if let down = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true) {
                down.post(tap: .cghidEventTap)
            }
        }
        
        usleep(useconds_t(duration * 1000000.0))
        
        // Release
        for code in keysToHold.reversed() {
            if let up = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false) {
                up.post(tap: .cghidEventTap)
            }
        }
        return ["text": "OK"]

    case "scroll":
        guard let amount = input["scroll_amount"] as? Int, let direction = input["scroll_direction"] as? String else {
            return ["is_error": true, "error": "Missing scroll details"]
        }
        let point = getPoint()
        CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
        
        var scrollY = 0
        var scrollX = 0
        if direction == "up" { scrollY = amount }
        else if direction == "down" { scrollY = -amount }
        else if direction == "left" { scrollX = amount }
        else if direction == "right" { scrollX = -amount }
        
        let scrollEvent = CGEvent(scrollWheelEvent2Source: source, units: .line, wheelCount: 2, wheel1: Int32(scrollY), wheel2: Int32(scrollX), wheel3: 0)
        scrollEvent?.post(tap: .cghidEventTap)
        return ["text": "OK"]
        
    case "cursor_position":
        let point = getCurrentCursor()
        let x = Int(point.x * scale)
        let y = Int(point.y * scale)
        return ["text": "[\(x), \(y)]"]
        
    case "wait":
        let duration = input["duration"] as? Double ?? 1.0
        usleep(useconds_t(duration * 1000000.0))
        return ["text": "OK"]
        
    case "screenshot", "zoom":
        let region = input["region"] as? [Double]
        return handleScreenshot(region: region)
        
    default:
        return ["is_error": true, "error": "Unsupported member: \(member)"]
    }
}

func runOneShot() {
    let args = CommandLine.arguments
    if args.count > 1 && args[1] == "check-permissions" {
        let ok = checkPermissions()
        print(ok ? "true" : "false")
        exit(ok ? 0 : 1)
    }
    
    guard args.count > 1 else {
        print("Usage: MacSidecar <json_tool_call>")
        exit(1)
    }
    
    if !checkPermissions() {
        let err: [String: Any] = ["id": "", "is_error": true, "error": "Missing accessibility/screen recording permissions"]
        if let data = try? JSONSerialization.data(withJSONObject: err), let str = String(data: data, encoding: .utf8) {
            print(str)
        }
        exit(1)
    }
    
    let jsonString = args[1]
    guard let jsonData = jsonString.data(using: .utf8),
          let call = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
          let id = call["id"] as? String,
          let member = call["member"] as? String else {
        let err: [String: Any] = ["id": "", "is_error": true, "error": "Invalid JSON input"]
        if let data = try? JSONSerialization.data(withJSONObject: err), let str = String(data: data, encoding: .utf8) {
            print(str)
        }
        exit(1)
    }
    let input = call["input"] as? [String: Any] ?? [:]
    
    var result = handleAction(member: member, input: input)
    result["id"] = id
    
    if let data = try? JSONSerialization.data(withJSONObject: result), let str = String(data: data, encoding: .utf8) {
        print(str)
    }
}

@main
struct MacSidecarEntry {
    static func main() {
        let args = CommandLine.arguments
        if args.count > 1 && args[1] == "daemon" {
            runDaemon()
        } else {
            runOneShot()
        }
    }
}
