// Precedents for Mac: Greenshoot's precedents library, one keystroke away. Control-Option-P shows a search panel over
// whatever you're working in; type anything to find a precedent, open it, and drag its images straight into
// InDesign, PowerPoint or Finder (or copy or download them). Control-Option-O sends a screenshot to the inbox.
// Separate from Groundwork Capture (the mapping tools' widget): its own app, shortcuts and settings.
//
// The panel itself is a web page (public/desk.html, .css, .js), built into the app by build.command and loaded as if
// it came from the Precedents site, so it can search the library and keep the sign-in. This file only does what a
// web page can't: the floating window, shortcuts, dragging files out, downloads, copying images, screenshots.
// Build with build.command (it needs Apple's Command Line Tools, which it offers to install).

import Cocoa
import WebKit
import Carbon.HIToolbox
import ApplicationServices
import ServiceManagement

let defaultSite = "https://greenshoot-precedents.netlify.app"
let maxUploadBytes = 4_400_000

final class FloatingPanel: NSPanel {
    override var canBecomeKey: Bool { true }       // so the search box can be typed into
    override var canBecomeMain: Bool { false }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate, NSDraggingSource {
    var panel: FloatingPanel!
    var web: WKWebView!
    var statusItem: NSStatusItem!
    var hotKeyRefs: [EventHotKeyRef?] = []
    var ready = false
    var pendingJS: [String] = []
    var pinned = false
    var dragging = false
    var previousApp: NSRunningApplication?
    let size = NSSize(width: 600, height: 660)

    let defaults = UserDefaults.standard
    // The Precedents site (change with: defaults write au.greenshoot.precedents siteURL https://...).
    var siteURL: URL { URL(string: defaults.string(forKey: "siteURL") ?? defaultSite)! }

    // Images being dragged out are fetched first into the app's cache, so the drag is a real file.
    lazy var cacheDir: URL = {
        let d = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("au.greenshoot.precedents/images")
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()
    var downloadsDir: URL { FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0].appendingPathComponent("Precedents") }

    // MARK: Launch

    func applicationDidFinishLaunching(_ note: Notification) {
        buildPanel()
        buildMenu()
        registerHotKeys()
    }

    func buildPanel() {
        panel = FloatingPanel(contentRect: NSRect(origin: .zero, size: size),
                              styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.delegate = self

        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "pr")
        config.websiteDataStore = .default()           // keeps the sign-in between launches
        web = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: config)
        web.autoresizingMask = [.width, .height]
        web.setValue(false, forKey: "drawsBackground")
        web.navigationDelegate = self
        panel.contentView = web
        loadPage()
    }

    // The panel page is built into the app (copied in by build.command), so it opens instantly. The pageURL default
    // loads a live copy instead (for trying design changes without rebuilding).
    func loadPage() {
        ready = false
        if defaults.string(forKey: "pageURL") == nil, let html = bundledPage() {
            web.loadHTMLString(html, baseURL: siteURL.appendingPathComponent("/"))
        } else {
            web.load(URLRequest(url: URL(string: defaults.string(forKey: "pageURL") ?? siteURL.absoluteString + "/desk.html")!))
        }
    }

    func bundledPage() -> String? {
        guard let r = Bundle.main.resourceURL,
              var html = try? String(contentsOf: r.appendingPathComponent("desk.html"), encoding: .utf8),
              let css = try? String(contentsOf: r.appendingPathComponent("desk.css"), encoding: .utf8),
              let script = try? String(contentsOf: r.appendingPathComponent("desk.js"), encoding: .utf8) else { return nil }
        html = html.replacingOccurrences(of: #"<link href="desk.css" rel="stylesheet">"#, with: "<style>\n\(css)\n</style>")
        html = html.replacingOccurrences(of: #"<script src="desk.js" type="module"></script>"#, with: "<script type=\"module\">\n\(script)\n</script>")
        return html
    }

    func buildMenu() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.image = NSImage(systemSymbolName: "photo.stack", accessibilityDescription: "Precedents")
        statusItem.button?.toolTip = "Precedents (Control-Option-P)"
        let menu = NSMenu()
        func add(_ title: String, _ action: Selector, _ key: String = "") -> NSMenuItem {
            let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
            i.target = self
            if !key.isEmpty { i.keyEquivalentModifierMask = [.control, .option] }
            menu.addItem(i)
            return i
        }
        _ = add("Find a precedent", #selector(showPanel), "p")
        _ = add("Send a screenshot", #selector(takeScreenshot), "o")
        menu.addItem(.separator())
        _ = add("Open the library", #selector(openLibrary))
        _ = add("Show downloaded images", #selector(showDownloads))
        let login = add("Start at login", #selector(toggleLogin))
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        _ = add("Reload", #selector(reload))
        menu.addItem(.separator())
        _ = add("Quit Precedents", #selector(quit))
        statusItem.menu = menu
    }

    // MARK: Shortcuts (Carbon hot keys need no special permission)

    func registerHotKeys() {
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, event, userData -> OSStatus in
            var hk = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                              nil, MemoryLayout<EventHotKeyID>.size, nil, &hk)
            let me = Unmanaged<AppDelegate>.fromOpaque(userData!).takeUnretainedValue()
            DispatchQueue.main.async { me.hotKey(Int(hk.id)) }
            return noErr
        }, 1, &spec, Unmanaged.passUnretained(self).toOpaque(), nil)
        let mods = UInt32(controlKey | optionKey)
        for (id, key) in [(1, kVK_ANSI_P), (2, kVK_ANSI_O)] {
            var ref: EventHotKeyRef?
            RegisterEventHotKey(UInt32(key), mods, EventHotKeyID(signature: OSType(0x5052_4543), id: UInt32(id)),   // "PREC"
                                GetApplicationEventTarget(), 0, &ref)
            hotKeyRefs.append(ref)
        }
    }

    func hotKey(_ id: Int) {
        if id == 1 { (panel.isVisible && panel.isKeyWindow) ? hidePanel() : showPanel() }
        if id == 2 { takeScreenshot() }
    }

    // MARK: Showing and hiding

    @objc func showPanel() {
        if let f = NSWorkspace.shared.frontmostApplication, f.processIdentifier != getpid() { previousApp = f }
        if !panel.isVisible { place() }
        panel.makeKeyAndOrderFront(nil)
        js("pr.focus()")
    }

    func hidePanel() {
        panel.orderOut(nil)
        previousApp?.activate()
    }

    // Centred near the top of the screen with the mouse, or where it was left when pinned.
    func place() {
        let screen = NSScreen.screens.first { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) } ?? NSScreen.main!
        let vf = screen.visibleFrame
        if pinned, let s = defaults.string(forKey: "pinnedOrigin") {
            let o = NSPointFromString(s)
            if vf.contains(NSPoint(x: o.x + 40, y: o.y + size.height - 40)) { panel.setFrameOrigin(o); return }
        }
        panel.setFrameOrigin(NSPoint(x: vf.midX - size.width / 2, y: vf.maxY - size.height - vf.height * 0.08))
    }

    // Click away and it hides, unless pinned (or while an image is being dragged out).
    func windowDidResignKey(_ notification: Notification) {
        if !pinned && !dragging { panel.orderOut(nil) }
    }

    // MARK: Messages from the panel page

    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let m = message.body as? [String: Any], let type = m["type"] as? String else { return }
        switch type {
        case "ready":
            ready = true
            js("pr.setPinned(\(pinned))")
            pendingJS.forEach { web.evaluateJavaScript($0) }
            pendingJS.removeAll()
        case "hide": hidePanel()
        case "pin":
            pinned = (m["on"] as? Bool) ?? false
            if pinned { defaults.set(NSStringFromPoint(panel.frame.origin), forKey: "pinnedOrigin") }
        case "move":
            let dx = (m["dx"] as? NSNumber)?.doubleValue ?? 0, dy = (m["dy"] as? NSNumber)?.doubleValue ?? 0
            var o = panel.frame.origin
            o.x += dx; o.y -= dy
            panel.setFrameOrigin(o)
            if pinned { defaults.set(NSStringFromPoint(o), forKey: "pinnedOrigin") }
        case "open":
            if let s = m["url"] as? String, let u = URL(string: s) { NSWorkspace.shared.open(u) }
        case "download":
            download(folder: m["folder"] as? String ?? "Precedent", items: m["items"] as? [[String: String]] ?? [])
        case "prefetch":
            for it in m["items"] as? [[String: String]] ?? [] { cached(it) { _ in } }
        case "drag":
            dragOut(m)
        case "copy":
            if let u = m["url"] as? String { copyImage(u) }
        case "reveal":
            let d = downloadsDir.appendingPathComponent(clean(m["folder"] as? String ?? ""))
            NSWorkspace.shared.activateFileViewerSelecting([FileManager.default.fileExists(atPath: d.path) ? d : downloadsDir])
        case "screenshot":
            takeScreenshot()
        default: break
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.navigationType == .linkActivated, let u = action.request.url {   // links open in the browser
            NSWorkspace.shared.open(u); decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }

    func js(_ code: String) {
        if ready { web.evaluateJavaScript(code) } else { pendingJS.append(code) }
    }

    func jsonString(_ v: Any) -> String {
        if let s = v as? String, let d = try? JSONSerialization.data(withJSONObject: [s]), let a = String(data: d, encoding: .utf8) {
            return String(a.dropFirst().dropLast())
        }
        guard let d = try? JSONSerialization.data(withJSONObject: v), let s = String(data: d, encoding: .utf8) else { return "null" }
        return s
    }

    // MARK: Images: cache, drag out, copy, download

    func clean(_ s: String) -> String {
        String(s.map { "/:\\".contains($0) ? "-" : $0 }).trimmingCharacters(in: .whitespaces)
    }

    // The image as a file in the cache (fetched once). Calls back with the file, or nil.
    func cached(_ it: [String: String], _ done: @escaping (URL?) -> Void) {
        guard let s = it["url"], let u = URL(string: s) else { return done(nil) }
        let file = cacheDir.appendingPathComponent(clean(it["filename"] ?? UUID().uuidString + ".jpg"))
        if FileManager.default.fileExists(atPath: file.path) { return done(file) }
        URLSession.shared.dataTask(with: u) { data, res, _ in
            let ok = (res as? HTTPURLResponse)?.statusCode == 200
            if ok, let d = data { try? d.write(to: file) }
            DispatchQueue.main.async { done(ok ? file : nil) }
        }.resume()
    }

    func dragOut(_ m: [String: Any]) {
        guard let url = m["url"] as? String, let name = m["filename"] as? String else { return }
        let file = cacheDir.appendingPathComponent(clean(name))
        guard FileManager.default.fileExists(atPath: file.path) else {
            cached(["url": url, "filename": name]) { _ in }
            js("pr.note('Getting the full-size image. Try dragging again in a moment.')")
            return
        }
        guard let event = NSApp.currentEvent, [.leftMouseDragged, .leftMouseDown].contains(event.type) else { return }
        let item = NSDraggingItem(pasteboardWriter: file as NSURL)
        let at = web.convert(event.locationInWindow, from: nil)
        let preview = NSImage(contentsOf: file) ?? NSImage()
        let w: CGFloat = 140, h = preview.size.width > 0 ? w * preview.size.height / preview.size.width : 100
        item.setDraggingFrame(NSRect(x: at.x - w / 2, y: at.y - h / 2, width: w, height: h), contents: preview)
        dragging = true
        if !pinned { pinned = true; js("pr.setPinned(true); pr.note('Pinned while you drag images in. Click Pinned to let it hide again.')") }
        web.beginDraggingSession(with: [item], event: event, source: self)
    }

    func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation { .copy }
    func draggingSession(_ session: NSDraggingSession, endedAt screenPoint: NSPoint, operation: NSDragOperation) { dragging = false }

    func copyImage(_ url: String) {
        cached(["url": url, "filename": "copy-\(url.hashValue & 0x7fffffff).jpg"]) { file in
            guard let f = file, let img = NSImage(contentsOf: f) else { self.js("pr.note('Couldn\\'t copy that image.')"); return }
            let pb = NSPasteboard.general
            pb.clearContents()
            pb.writeObjects([img])
            self.js("pr.copied()")
        }
    }

    func download(folder: String, items: [[String: String]]) {
        let dir = downloadsDir.appendingPathComponent(clean(folder))
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var left = items.count, saved = 0
        if left == 0 { return }
        for it in items {
            cached(it.merging(["filename": "\(clean(folder)) \(it["filename"] ?? "image.jpg")"]) { $1 }) { file in
                if let f = file {
                    var dest = dir.appendingPathComponent(self.clean(it["filename"] ?? "image.jpg"))
                    var n = 2
                    while FileManager.default.fileExists(atPath: dest.path) {
                        dest = dir.appendingPathComponent("\(dest.deletingPathExtension().lastPathComponent.replacingOccurrences(of: #" \d+$"#, with: "", options: .regularExpression)) \(n).jpg"); n += 1
                    }
                    if (try? FileManager.default.copyItem(at: f, to: dest)) != nil { saved += 1 }
                }
                left -= 1
                if left == 0 { self.js("pr.downloaded(\(saved), \(self.jsonString(folder)))") }
            }
        }
    }

    // MARK: Screenshot to the inbox

    @objc func takeScreenshot() {
        let wasShown = panel.isVisible
        panel.orderOut(nil)
        let ctx = frontContext()
        let file = NSTemporaryDirectory() + "precedents-\(UUID().uuidString).png"
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        p.arguments = ["-i", "-x", file]
        p.terminationHandler = { _ in
            DispatchQueue.main.async {
                defer { try? FileManager.default.removeItem(atPath: file) }
                guard let img = NSImage(contentsOfFile: file), let enc = self.encodeImage(img) else {   // Esc: nothing taken
                    if wasShown { self.showPanel() }
                    return
                }
                var item = ctx; item["image"] = enc
                self.showPanel()
                self.js("pr.shot(\(self.jsonString(item)))")
            }
        }
        try? p.run()
    }

    // The app in front and, where it says, the web page or document (for the inbox item's source).
    func frontContext() -> [String: Any] {
        var out: [String: Any] = [:]
        guard let app = NSWorkspace.shared.frontmostApplication, app.processIdentifier != getpid() else { return out }
        out["app"] = app.localizedName ?? ""
        let bundle = app.bundleIdentifier ?? ""
        if AXIsProcessTrusted() {
            let axApp = AXUIElementCreateApplication(app.processIdentifier)
            var win: CFTypeRef?
            if AXUIElementCopyAttributeValue(axApp, kAXFocusedWindowAttribute as CFString, &win) == .success, let w = win {
                var doc: CFTypeRef?, title: CFTypeRef?
                if AXUIElementCopyAttributeValue(w as! AXUIElement, kAXDocumentAttribute as CFString, &doc) == .success,
                   let s = doc as? String, let u = URL(string: s), u.isFileURL { out["file"] = u.path }
                if AXUIElementCopyAttributeValue(w as! AXUIElement, kAXTitleAttribute as CFString, &title) == .success, let t = title as? String {
                    out["windowTitle"] = t
                }
            }
        }
        let script: String?
        switch bundle {
        case "com.apple.Safari": script = #"tell application "Safari" to return (URL of front document) & linefeed & (name of front document)"#
        case "com.google.Chrome", "com.microsoft.edgemac", "com.brave.Browser", "company.thebrowser.Browser":
            script = "tell application id \"\(bundle)\" to return (URL of active tab of front window) & linefeed & (title of active tab of front window)"
        default: script = nil
        }
        if let s = script, let res = NSAppleScript(source: s)?.executeAndReturnError(nil).stringValue {
            let parts = res.components(separatedBy: "\n")
            out["url"] = parts.first
            if parts.count > 1 { out["title"] = parts[1] }
        }
        return out
    }

    // Any image to a JPEG of at most 2600 px, small enough to send.
    func encodeImage(_ img: NSImage) -> [String: String]? {
        guard let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
        for (side, q) in [(2600.0, 0.82), (2000.0, 0.72), (1600.0, 0.62)] {
            let scale = min(1, side / Double(max(cg.width, cg.height)))
            let w = max(1, Int(Double(cg.width) * scale)), h = max(1, Int(Double(cg.height) * scale))
            guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
            ctx.setFillColor(NSColor.white.cgColor); ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
            ctx.interpolationQuality = .high
            ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
            guard let out = ctx.makeImage(),
                  let data = NSBitmapImageRep(cgImage: out).representation(using: .jpeg, properties: [.compressionFactor: q]) else { return nil }
            if data.count <= maxUploadBytes { return ["data": data.base64EncodedString(), "type": "image/jpeg"] }
        }
        return nil
    }

    // MARK: Menu actions

    @objc func openLibrary() { NSWorkspace.shared.open(siteURL) }
    @objc func showDownloads() {
        try? FileManager.default.createDirectory(at: downloadsDir, withIntermediateDirectories: true)
        NSWorkspace.shared.activateFileViewerSelecting([downloadsDir])
    }
    @objc func toggleLogin(_ sender: NSMenuItem) {
        do {
            if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() } else { try SMAppService.mainApp.register() }
            sender.state = SMAppService.mainApp.status == .enabled ? .on : .off
        } catch {
            let a = NSAlert(); a.messageText = "Couldn't change Start at login"; a.informativeText = error.localizedDescription; a.runModal()
        }
    }
    @objc func reload() { loadPage() }
    @objc func quit() { NSApp.terminate(nil) }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)      // menu bar only, no Dock icon
app.run()
