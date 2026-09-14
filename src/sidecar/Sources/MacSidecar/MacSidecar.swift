import Foundation
import Cocoa
import CoreGraphics
import ApplicationServices

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

func handleScreenshot() -> [String: Any] {
    let displayID = CGMainDisplayID()
    guard let image = CGDisplayCreateImage(displayID) else {
        return ["is_error": true, "error": "Failed to capture screen"]
    }
    
    let bitmapRep = NSBitmapImageRep(cgImage: image)
    guard let pngData = bitmapRep.representation(using: .png, properties: [:]) else {
        return ["is_error": true, "error": "Failed to encode screen to PNG"]
    }
    
    let base64 = pngData.base64EncodedString()
    return ["base64_image": base64]
}

func mapCoordinate(_ coord: [Double]) -> CGPoint {
    let scale = getScreenScale()
    return CGPoint(x: coord[0] / Double(scale), y: coord[1] / Double(scale))
}

func getCurrentCursor() -> CGPoint {
    let event = CGEvent(source: nil)
    return event?.location ?? CGPoint.zero
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
        let button: CGMouseButton = member == "right_click" ? .right : (member == "middle_click" ? .center : .left)
        let downType: CGEventType = member == "right_click" ? .rightMouseDown : (member == "middle_click" ? .otherMouseDown : .leftMouseDown)
        let upType: CGEventType = member == "right_click" ? .rightMouseUp : (member == "middle_click" ? .otherMouseUp : .leftMouseUp)
        
        let down = CGEvent(mouseEventSource: source, mouseType: downType, mouseCursorPosition: point, mouseButton: button)
        let up = CGEvent(mouseEventSource: source, mouseType: upType, mouseCursorPosition: point, mouseButton: button)
        
        down?.post(tap: .cghidEventTap)
        up?.post(tap: .cghidEventTap)
        return ["text": "OK"]
        
    case "double_click":
        let point = getPoint()
        let down1 = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)
        down1?.setIntegerValueField(.mouseEventClickState, value: 1)
        down1?.post(tap: .cghidEventTap)
        
        let up1 = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)
        up1?.setIntegerValueField(.mouseEventClickState, value: 1)
        up1?.post(tap: .cghidEventTap)
        
        let down2 = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)
        down2?.setIntegerValueField(.mouseEventClickState, value: 2)
        down2?.post(tap: .cghidEventTap)
        
        let up2 = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)
        up2?.setIntegerValueField(.mouseEventClickState, value: 2)
        up2?.post(tap: .cghidEventTap)
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
        let scriptStr = "tell application \"System Events\" to keystroke \"\(text.replacingOccurrences(of: "\"", with: "\\\"").replacingOccurrences(of: "\\", with: "\\\\"))\""
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
        var appleScriptCommand = ""
        let lower = text.lowercased()
        
        // Very basic mapping for special keys
        let specialKeys: [String: Int] = [
            "return": 36, "enter": 36, "tab": 48, "space": 49,
            "escape": 53, "esc": 53, "backspace": 51,
            "up": 126, "down": 125, "left": 123, "right": 124
        ]
        
        if let keyCode = specialKeys[lower] {
            appleScriptCommand = "tell application \"System Events\" to key code \(keyCode)"
        } else {
            // Check for combinations like ctrl+c
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
            script.executeAndReturnError(&error)
            if let err = error {
                return ["is_error": true, "error": "AppleScript error: \(err)"]
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
        
    case "screenshot":
        return handleScreenshot()
        
    default:
        return ["is_error": true, "error": "Unsupported member: \(member)"]
    }
}

func main() {
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

main()
