import Foundation
import Cocoa
import CoreGraphics
import ScreenCaptureKit
import VideoToolbox
import CoreMedia

// ADR-0005: daemon mode. `MacSidecar daemon` stays alive for a whole agent
// loop run: it holds the ScreenCaptureKit stream (so the system recording
// indicator stays lit, Codex-style) and renders the halo/pulse overlay.
// Protocol: one JSON object per stdin line -> one JSON object per stdout line.
// Commands: ping, overlay-show, overlay-event, overlay-describe, overlay-hide,
// stream-start, stream-frame, stream-stop, exit.

func useLegacyCapture() -> Bool {
    return ProcessInfo.processInfo.environment["COMPUTER_USE_LEGACY_CAPTURE"] == "1"
}

func encodeJPEG(_ image: CGImage, quality: Double = 0.8) -> String? {    let bitmapRep = NSBitmapImageRep(cgImage: image)
    guard let data = bitmapRep.representation(using: .jpeg, properties: [.compressionFactor: quality]) else {
        return nil
    }
    return data.base64EncodedString()
}

func cropImage(_ image: CGImage, region: [Double]?) -> CGImage? {
    guard let r = region, r.count >= 4 else { return image }
    let rect = CGRect(x: r[0], y: r[1], width: r[2] - r[0], height: r[3] - r[1])
    return image.cropping(to: rect)
}

// MARK: - One-shot ScreenCaptureKit capture (fast JPEG path)

/// SCK stream dimensions track the capture backing store. The model grounds
/// in backing pixels (the legacy CGDisplayCreateImage contract), so we pass
/// display points x backing scale to keep the coordinate contract identical.
func configureStreamSize(_ config: SCStreamConfiguration, displayID: CGDirectDisplayID) {
    let bounds = CGDisplayBounds(displayID)
    let scale = NSScreen.main?.backingScaleFactor ?? 2
    config.width = Int(bounds.width * scale)
    config.height = Int(bounds.height * scale)
}

/// Lock-guarded holder for values produced on cooperative-pool threads.
final class LockedBox<T>: @unchecked Sendable {
    private var value: T?
    private let lock = NSLock()
    func set(_ v: T?) {
        lock.lock()
        defer { lock.unlock() }
        value = v
    }
    func get() -> T? {
        lock.lock()
        defer { lock.unlock() }
        return value
    }
}

/// SCK can stall server-side under stream churn; the one-shot path must never
/// hang the agent, so the wait is bounded and callers fall back to legacy.
@available(macOS 14.0, *)
func captureOneShotSCK(timeoutSeconds: Double = 3) -> CGImage? {
    let box = LockedBox<CGImage>()
    let sem = DispatchSemaphore(value: 0)
    Task {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            let mainID = CGMainDisplayID()
            guard let display = content.displays.first(where: { $0.displayID == mainID }) ?? content.displays.first else {
                sem.signal()
                return
            }
            let filter = SCContentFilter(display: display, excludingWindows: [])
            let config = SCStreamConfiguration()
            configureStreamSize(config, displayID: display.displayID)
            config.showsCursor = true
            box.set(try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config))
        } catch {
            box.set(nil)
        }
        sem.signal()
    }
    if sem.wait(timeout: .now() + timeoutSeconds) == .timedOut {
        fputs("captureOneShotSCK timed out after \(timeoutSeconds)s, falling back to legacy\n", stderr)
        return nil
    }
    return box.get()
}

func captureScreenImage() -> CGImage? {
    if !useLegacyCapture() {
        if #available(macOS 14.0, *) {
            if let cg = captureOneShotSCK() { return cg }
        }
    }
    return CGDisplayCreateImage(CGMainDisplayID())
}

// MARK: - Overlay window (halo follower + click pulses)

final class OverlayController {
    private var window: NSWindow?
    private var canvas: OverlayCanvas?
    private var timer: Timer?

    var isVisible: Bool { window?.isVisible ?? false }

    func show() -> Bool {
        guard let screen = NSScreen.main else { return false }
        if window == nil {
            let w = NSWindow(
                contentRect: screen.frame,
                styleMask: .borderless,
                backing: .buffered,
                defer: false,
                screen: screen
            )
            w.isOpaque = false
            w.backgroundColor = .clear
            w.hasShadow = false
            w.ignoresMouseEvents = true
            w.level = .screenSaver
            w.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
            w.sharingType = .none
            let canvas = OverlayCanvas(frame: screen.frame)
            w.contentView = canvas
            self.canvas = canvas
            self.window = w
        }
        window?.orderFrontRegardless()
        startFollowing()
        return true
    }

    func describe() -> [String: Any] {
        guard let w = window else {
            return ["visible": false, "sharingType": NSWindow.SharingType.none.rawValue, "ignoresMouseEvents": true]
        }
        return [
            "visible": w.isVisible,
            "sharingType": w.sharingType.rawValue,
            "ignoresMouseEvents": w.ignoresMouseEvents,
            "level": w.level.rawValue,
        ]
    }

    func event(member: String, coordinate: [Double]?, pulse: [String: Any]?) {
        guard let canvas = canvas else { return }
        let point: NSPoint
        if let c = coordinate, c.count >= 2 {
            point = canvas.toWindowPoint(physicalX: c[0], physicalY: c[1])
        } else {
            let cur = getCurrentCursor()
            point = canvas.toWindowPoint(physicalX: Double(cur.x) * canvas.scale, physicalY: Double(cur.y) * canvas.scale)
        }
        canvas.moveHalo(to: point)
        guard let pulse = pulse,
              let colorName = pulse["color"] as? String,
              let pulses = pulse["pulses"] as? Int else { return }
        let color: NSColor
        switch colorName {
        case "purple": color = .systemPurple
        case "gray": color = .systemGray
        default: color = .systemBlue
        }
        var trail: (NSPoint, NSPoint)?
        if let t = pulse["trail"] as? [String: Any],
           let from = t["from"] as? [Double], from.count >= 2,
           let to = t["to"] as? [Double], to.count >= 2 {
            trail = (canvas.toWindowPoint(physicalX: from[0], physicalY: from[1]),
                     canvas.toWindowPoint(physicalX: to[0], physicalY: to[1]))
        }
        for i in 0..<max(1, pulses) {
            let delay = Double(i) * 0.12
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                canvas.pulse(at: point, color: color, trail: trail)
            }
        }
    }

    func hide() {
        timer?.invalidate()
        timer = nil
        window?.orderOut(nil)
    }

    var windowNumber: Int { window?.windowNumber ?? -1 }

    private func startFollowing() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
            guard let self = self, let canvas = self.canvas else { return }
            let cur = getCurrentCursor()
            canvas.moveHalo(to: canvas.toWindowPoint(
                physicalX: Double(cur.x) * canvas.scale,
                physicalY: Double(cur.y) * canvas.scale
            ))
        }
    }
}

final class OverlayCanvas: NSView {
    let scale: CGFloat = NSScreen.main?.backingScaleFactor ?? 1.0
    private var halo: CAShapeLayer?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.backgroundColor = NSColor.clear.cgColor
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
    }

    func toWindowPoint(physicalX: Double, physicalY: Double) -> NSPoint {
        // Screenshot/CGEvent space is physical pixels, origin top-left.
        // AppKit window space is points, origin bottom-left.
        NSPoint(x: physicalX / Double(scale), y: bounds.height - physicalY / Double(scale))
    }

    func moveHalo(to point: NSPoint) {
        if halo == nil {
            let layer = CAShapeLayer()
            layer.strokeColor = NSColor.white.withAlphaComponent(0.65).cgColor
            layer.fillColor = NSColor.white.withAlphaComponent(0.08).cgColor
            layer.lineWidth = 1.5
            self.layer?.addSublayer(layer)
            halo = layer
        }
        halo?.path = CGPath(ellipseIn: CGRect(x: point.x - 10, y: point.y - 10, width: 20, height: 20), transform: nil)
    }

    func pulse(at point: NSPoint, color: NSColor, trail: (NSPoint, NSPoint)?) {
        guard let parent = self.layer else { return }
        let layer = CAShapeLayer()
        layer.strokeColor = color.cgColor
        layer.fillColor = NSColor.clear.cgColor
        layer.lineWidth = 2.5
        let path = CGMutablePath()
        if let (from, to) = trail {
            path.move(to: from)
            path.addLine(to: to)
        }
        path.addEllipse(in: CGRect(x: point.x - 14, y: point.y - 14, width: 28, height: 28))
        layer.path = path
        parent.addSublayer(layer)

        CATransaction.begin()
        CATransaction.setAnimationDuration(0.3)
        CATransaction.setCompletionBlock { layer.removeFromSuperlayer() }
        let scaleAnim = CABasicAnimation(keyPath: "transform.scale")
        scaleAnim.fromValue = 1.0
        scaleAnim.toValue = 1.6
        let fadeAnim = CABasicAnimation(keyPath: "opacity")
        fadeAnim.fromValue = 1.0
        fadeAnim.toValue = 0.0
        layer.add(scaleAnim, forKey: "pulse-scale")
        layer.add(fadeAnim, forKey: "pulse-fade")
        CATransaction.commit()
    }
}

// MARK: - Continuous ScreenCaptureKit stream (system indicator source)

final class StreamCapture: NSObject, SCStreamOutput {
    /// Locked box: NSLock must not be touched from async contexts directly
    /// (Swift 6 diagnostic), so all locking lives in these sync helpers.
    final class State: @unchecked Sendable {
        private var stream: SCStream?
        private var latest: CGImage?
        private let lock = NSLock()

        func setStream(_ s: SCStream?) {
            lock.lock()
            defer { lock.unlock() }
            stream = s
        }

        func takeStream() -> SCStream? {
            lock.lock()
            defer { lock.unlock() }
            let s = stream
            stream = nil
            latest = nil
            return s
        }

        func isRunning() -> Bool {
            lock.lock()
            defer { lock.unlock() }
            return stream != nil
        }

        func setLatest(_ image: CGImage?) {
            lock.lock()
            defer { lock.unlock() }
            latest = image
        }

        func getLatest() -> CGImage? {
            lock.lock()
            defer { lock.unlock() }
            return latest
        }
    }

    private let state = State()
    private let queue = DispatchQueue(label: "computer-use.stream-output")

    var isRunning: Bool { state.isRunning() }

    func start(excludingWindowNumber: Int) async throws -> Int {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        let mainID = CGMainDisplayID()
        guard let display = content.displays.first(where: { $0.displayID == mainID }) ?? content.displays.first else {
            throw NSError(domain: "computer-use", code: 1, userInfo: [NSLocalizedDescriptionKey: "No display for stream"])
        }
        let excluded: [SCWindow]
        if excludingWindowNumber >= 0 {
            excluded = content.windows.filter { $0.windowID == CGWindowID(excludingWindowNumber) }
        } else {
            excluded = []
        }
        let filter = SCContentFilter(display: display, excludingWindows: excluded.isEmpty ? [] : excluded)
        let config = SCStreamConfiguration()
        configureStreamSize(config, displayID: display.displayID)
        config.showsCursor = true
        let s = SCStream(filter: filter, configuration: config, delegate: nil)
        try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        try await s.startCapture()
        state.setStream(s)
        return excluded.count
    }

    func latestFrame() -> CGImage? {
        state.getLatest()
    }

    func stop() async {
        let s = state.takeStream()
        try? await s?.stopCapture()
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen,
              let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        var cg: CGImage?
        VTCreateCGImageFromCVPixelBuffer(pixelBuffer, options: nil, imageOut: &cg)
        guard let image = cg else { return }
        state.setLatest(image)
    }
}

// MARK: - Daemon command loop

func daemonResponse(_ dict: [String: Any], id: String?) -> String {
    var out = dict
    if let id = id { out["id"] = id }
    guard let data = try? JSONSerialization.data(withJSONObject: out),
          let str = String(data: data, encoding: .utf8) else {
        return "{\"is_error\":true,\"error\":\"encode\"}"
    }
    return str
}

func runDaemon() {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let overlay = OverlayController()
    let capture = StreamCapture()

    func needsPermissions() -> [String: Any]? {
        if !checkPermissions() {
            return ["is_error": true, "error": "Missing accessibility/screen recording permissions"]
        }
        return nil
    }

    func requirePermissions(id: String?) -> String? {
        if let err = needsPermissions() { return daemonResponse(err, id: id) }
        return nil
    }

    func handle(_ line: String) -> String? {
        guard let data = line.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let cmd = obj["cmd"] as? String else {
            return daemonResponse(["is_error": true, "error": "Invalid daemon command"], id: nil)
        }
        let id = obj["id"] as? String
        switch cmd {
        case "ping":
            return daemonResponse(["ok": true], id: id)
        case "exit":
            DispatchQueue.main.async { app.terminate(nil) }
            return daemonResponse(["ok": true], id: id)
        case "overlay-show":
            if let denied = requirePermissions(id: id) { return denied }
            var ok = false
            DispatchQueue.main.sync { ok = overlay.show() }
            return ok
                ? daemonResponse(["ok": true], id: id)
                : daemonResponse(["is_error": true, "error": "No display for overlay"], id: id)
        case "overlay-event":
            if let denied = requirePermissions(id: id) { return denied }
            let member = obj["member"] as? String ?? ""
            let coord = obj["coordinate"] as? [Double]
            let pulse = obj["pulse"] as? [String: Any]
            DispatchQueue.main.sync { overlay.event(member: member, coordinate: coord, pulse: pulse) }
            return daemonResponse(["ok": true], id: id)
        case "overlay-describe":
            var desc: [String: Any] = [:]
            DispatchQueue.main.sync { desc = overlay.describe() }
            desc["ok"] = true
            return daemonResponse(desc, id: id)
        case "overlay-hide":
            DispatchQueue.main.sync { overlay.hide() }
            return daemonResponse(["ok": true], id: id)
        case "stream-start":
            if let denied = requirePermissions(id: id) { return denied }
            let startBox = LockedBox<NSError>()
            let startedBox = LockedBox<NSNumber>()
            let sem = DispatchSemaphore(value: 0)
            Task {
                do {
                    var win = -1
                    DispatchQueue.main.sync { win = overlay.windowNumber }
                    let n = try await capture.start(excludingWindowNumber: win)
                    startedBox.set(NSNumber(value: n))
                } catch {
                    startBox.set(error as NSError)
                }
                sem.signal()
            }
            if sem.wait(timeout: .now() + 15) == .timedOut {
                return daemonResponse(["is_error": true, "error": "stream-start timed out"], id: id)
            }
            if let e = startBox.get() {
                return daemonResponse(["is_error": true, "error": "stream-start: \(e.localizedDescription)"], id: id)
            }
            return daemonResponse(["ok": true, "excludedWindows": startedBox.get()?.intValue ?? 0], id: id)
        case "stream-frame":
            if let denied = requirePermissions(id: id) { return denied }
            // Block briefly for the first frame so back-to-back
            // start/frame sequences are deterministic.
            var image = capture.latestFrame()
            var waited = 0
            while image == nil && waited < 100 {
                usleep(50_000)
                waited += 1
                image = capture.latestFrame()
            }
            guard var frame = image else {
                return daemonResponse(["is_error": true, "error": "no-frame"], id: id)
            }
            if let region = obj["region"] as? [Double] {
                guard let cropped = cropImage(frame, region: region) else {
                    return daemonResponse(["is_error": true, "error": "Invalid region for crop"], id: id)
                }
                frame = cropped
            }
            guard let b64 = encodeJPEG(frame) else {
                return daemonResponse(["is_error": true, "error": "Failed to encode frame to JPEG"], id: id)
            }
            return daemonResponse(["ok": true, "base64_image": b64, "imageFormat": "jpeg"], id: id)
        case "stream-stop":
            let sem = DispatchSemaphore(value: 0)
            Task {
                await capture.stop()
                sem.signal()
            }
            sem.wait()
            return daemonResponse(["ok": true], id: id)
        case "snap-frame":
            // Snapshot the stream buffer to a frame file for the TS bridge
            // (sync fs polling; Node sockets expose no sync fd for RPC).
            if let denied = requirePermissions(id: id) { return denied }
            guard let dir = ProcessInfo.processInfo.environment["COMPUTER_USE_FRAME_DIR"],
                  !dir.isEmpty else {
                return daemonResponse(["is_error": true, "error": "COMPUTER_USE_FRAME_DIR not set"], id: id)
            }
            guard let nonce = obj["nonce"] as? String, !nonce.isEmpty,
                  nonce.range(of: "^[A-Za-z0-9_-]{1,64}$", options: .regularExpression) != nil else {
                return daemonResponse(["is_error": true, "error": "snap-frame needs nonce [A-Za-z0-9_-]{1,64}"], id: id)
            }
            var image = capture.latestFrame()
            var waited = 0
            while image == nil && waited < 100 {
                usleep(50_000)
                waited += 1
                image = capture.latestFrame()
            }
            guard var frame = image else {
                return daemonResponse(["is_error": true, "error": "no-frame"], id: id)
            }
            if let region = obj["region"] as? [Double] {
                guard let cropped = cropImage(frame, region: region) else {
                    return daemonResponse(["is_error": true, "error": "Invalid region for crop"], id: id)
                }
                frame = cropped
            }
            guard let b64 = encodeJPEG(frame),
                  let data = Data(base64Encoded: b64) else {
                return daemonResponse(["is_error": true, "error": "Failed to encode frame to JPEG"], id: id)
            }
            let tmpURL = URL(fileURLWithPath: dir).appendingPathComponent("frame-\(nonce).jpg.tmp")
            let dstURL = URL(fileURLWithPath: dir).appendingPathComponent("frame-\(nonce).jpg")
            do {
                try data.write(to: tmpURL, options: .atomic)
                try FileManager.default.moveItem(at: tmpURL, to: dstURL)
            } catch {
                return daemonResponse(["is_error": true, "error": "frame write: \(error.localizedDescription)"], id: id)
            }
            return daemonResponse(["ok": true, "nonce": nonce], id: id)
        default:
            return daemonResponse(["is_error": true, "error": "Unknown daemon command: \(cmd)"], id: id)
        }
    }

    Thread.detachNewThread {
        while let line = readLine(strippingNewline: true) {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty { continue }
            if let resp = handle(trimmed) {
                print(resp)
                fflush(stdout)
            }
        }
        // EOF: session over, clean up and exit.
        DispatchQueue.main.async { app.terminate(nil) }
    }
    app.run()
}
