// Precedents for Mac: Greenshoot's precedents library, always at the edge of the screen. A Precedents tab sits on the
// right edge: click it and a search panel slides out beside it (drag the tab up or down to move it; drop images on it
// to send them to the inbox). Control-Option-P shows the same search as a panel near the top of the screen over
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
import UniformTypeIdentifiers

let defaultSite = "https://greenshoot-precedents.netlify.app"
let maxUploadBytes = 4_400_000

final class FloatingPanel: NSPanel {
    override var canBecomeKey: Bool { true }       // so the search box can be typed into
    override var canBecomeMain: Bool { false }
}

// The tab on the right edge of the screen: click to open the side panel, drag up or down to move it, drop images on it
// to send them to the inbox. Drawn here (not a web page) so it is always instant and light.
final class TabView: NSView {
    var onClick: (() -> Void)?
    var onDrag: ((CGFloat) -> Void)?
    var onDrop: (([(NSImage, String)]) -> Void)?     // each image with its file name ("" if dragged from an app)
    var isOpen = false { didSet { needsDisplay = true } }
    var hovering = false { didSet { needsDisplay = true } }
    var dropping = false { didSet { needsDisplay = true } }
    private var downAt: NSPoint?
    private var lastY: CGFloat = 0
    private var moved = false

    override init(frame: NSRect) {
        super.init(frame: frame)
        registerForDraggedTypes([.fileURL, .tiff, .png, NSPasteboard.PasteboardType("public.jpeg")])
        toolTip = "Precedents: click to search the library. Drag up or down to move. Drop images here to send them."
    }
    required init?(coder: NSCoder) { fatalError("not used") }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func updateTrackingAreas() {
        trackingAreas.forEach { removeTrackingArea($0) }
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self, userInfo: nil))
        super.updateTrackingAreas()
    }
    override func mouseEntered(with event: NSEvent) { hovering = true }
    override func mouseExited(with event: NSEvent) { hovering = false }
    override func resetCursorRects() { addCursorRect(bounds, cursor: .pointingHand) }

    override func mouseDown(with event: NSEvent) {
        downAt = NSEvent.mouseLocation; lastY = downAt!.y; moved = false
    }
    override func mouseDragged(with event: NSEvent) {
        let p = NSEvent.mouseLocation
        if let d = downAt, abs(p.y - d.y) > 3 { moved = true }
        if moved { onDrag?(lastY - p.y); lastY = p.y }      // positive: moved down the screen
    }
    override func mouseUp(with event: NSEvent) {
        if !moved { onClick?() }
        downAt = nil; moved = false
    }

    override func draw(_ dirtyRect: NSRect) {
        let ink = NSColor(red: 0.082, green: 0.098, blue: 0.11, alpha: 1)
        let accent = NSColor(red: 0.169, green: 0.373, blue: 0.541, alpha: 1)
        let fill = (isOpen || dropping) ? accent : hovering ? NSColor(red: 0.16, green: 0.18, blue: 0.2, alpha: 1) : ink
        // Rounded on the left; the right side runs off the screen edge.
        let shape = NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: bounds.width + 12, height: bounds.height), xRadius: 10, yRadius: 10)
        fill.setFill(); shape.fill()
        let fg = NSColor(white: 0.92, alpha: 1)

        // The G mark (a small grid square), near the top.
        let m = NSRect(x: (bounds.width - 20) / 2, y: bounds.height - 12 - 20, width: 20, height: 20)
        NSColor(white: 0.92, alpha: 0.16).setStroke()
        let grid = NSBezierPath(); grid.lineWidth = 1
        for i in 1..<4 {
            let o = CGFloat(i) * 5
            grid.move(to: NSPoint(x: m.minX + o, y: m.minY)); grid.line(to: NSPoint(x: m.minX + o, y: m.maxY))
            grid.move(to: NSPoint(x: m.minX, y: m.minY + o)); grid.line(to: NSPoint(x: m.maxX, y: m.minY + o))
        }
        grid.stroke()
        fg.setStroke()
        let box = NSBezierPath(rect: m.insetBy(dx: 0.75, dy: 0.75)); box.lineWidth = 1.5; box.stroke()
        let g = "G" as NSString
        let gAttrs: [NSAttributedString.Key: Any] = [.font: NSFont.monospacedSystemFont(ofSize: 12, weight: .semibold), .foregroundColor: fg]
        let gs = g.size(withAttributes: gAttrs)
        g.draw(at: NSPoint(x: m.midX - gs.width / 2, y: m.midY - gs.height / 2), withAttributes: gAttrs)

        // The name, reading down the tab (or what a drop will do).
        let label = (dropping ? "Drop to send" : "Precedents") as NSString
        let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 12, weight: .semibold), .foregroundColor: fg, .kern: 0.4]
        let sz = label.size(withAttributes: attrs)
        NSGraphicsContext.saveGraphicsState()
        let t = NSAffineTransform()
        t.translateX(by: bounds.midX - sz.height / 2, yBy: m.minY - 10)
        t.rotate(byDegrees: -90)
        t.concat()
        label.draw(at: .zero, withAttributes: attrs)
        NSGraphicsContext.restoreGraphicsState()
    }

    // Images dropped on the tab: image files from Finder, or an image dragged from a browser or another app.
    private func imageURLs(_ pb: NSPasteboard) -> [URL] {
        (pb.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true,
            .urlReadingContentsConformToTypes: ["public.image"]]) as? [URL]) ?? []
    }
    private func canTake(_ pb: NSPasteboard) -> Bool { !imageURLs(pb).isEmpty || NSImage.canInit(with: pb) }
    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        let ok = canTake(sender.draggingPasteboard)
        dropping = ok
        return ok ? .copy : []
    }
    override func draggingExited(_ sender: NSDraggingInfo?) { dropping = false }
    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        dropping = false
        let pb = sender.draggingPasteboard
        var imgs: [(NSImage, String)] = imageURLs(pb).prefix(20).compactMap { u in NSImage(contentsOf: u).map { ($0, u.lastPathComponent) } }
        if imgs.isEmpty, let i = NSImage(pasteboard: pb) { imgs = [(i, "")] }
        if imgs.isEmpty { return false }
        onDrop?(imgs)
        return true
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate, NSDraggingSource {
    var panel: FloatingPanel!
    var web: WKWebView!
    var statusItem: NSStatusItem!
    var hotKeyRefs: [EventHotKeyRef?] = []
    var ready = false
    var pendingJS: [String] = []
    var pinned = false
    var dragging = false
    var choosing = false                             // the "choose photos" window is open: keep the panel up
    var previousApp: NSRunningApplication?
    var appWindow: NSWindow?                         // the panel opened as a normal window (⤢), resizable, full screen
    var windowed: Bool { appWindow?.isVisible == true || appWindow?.isMiniaturized == true }
    var side = false                                 // which of the two the panel is showing as
    var tabPanel: NSPanel!
    var tabView: TabView!
    let tabSize = NSSize(width: 34, height: 142)
    var hiddenAt = Date.distantPast

    let defaults = UserDefaults.standard
    // The Precedents site (change with: defaults write au.greenshoot.precedents siteURL https://...).
    var siteURL: URL { URL(string: defaults.string(forKey: "siteURL") ?? defaultSite)! }
    // The tab: shown or not (menu bar), and how far below the top of the screen it sits (drag it to change).
    var tabShown: Bool {
        get { defaults.object(forKey: "tabShown") as? Bool ?? true }
        set { defaults.set(newValue, forKey: "tabShown") }
    }
    var tabTop: CGFloat {
        get { defaults.object(forKey: "tabTop") as? CGFloat ?? 220 }
        set { defaults.set(newValue, forKey: "tabTop") }
    }
    var tabScreen: NSScreen { NSScreen.screens.first ?? NSScreen.main! }   // the screen with the menu bar
    // Panel sizes, kept when you resize them (drag the corner of the top panel, or the left edge of the side panel).
    var size: NSSize {
        get {
            if let s = defaults.string(forKey: "topSize") { let z = NSSizeFromString(s); if z.width >= 420 && z.height >= 400 { return z } }
            return NSSize(width: 600, height: 660)
        }
        set { defaults.set(NSStringFromSize(newValue), forKey: "topSize") }
    }
    var sideWidth: CGFloat {
        get { defaults.object(forKey: "sideWidth") as? CGFloat ?? 440 }
        set { defaults.set(newValue, forKey: "sideWidth") }
    }

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
        buildTab()
        buildMenu()
        buildMainMenu()
        registerHotKeys()
        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            guard let me = self else { return }
            me.placeTab()
            if me.side && me.panel.isVisible { me.placeSide() }
        }
    }

    func buildTab() {
        tabPanel = NSPanel(contentRect: NSRect(origin: .zero, size: tabSize), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        tabPanel.isFloatingPanel = true
        tabPanel.level = .floating
        tabPanel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        tabPanel.backgroundColor = .clear
        tabPanel.isOpaque = false
        tabPanel.hasShadow = true
        tabPanel.hidesOnDeactivate = false
        tabView = TabView(frame: NSRect(origin: .zero, size: tabSize))
        tabPanel.contentView = tabView
        tabView.onClick = { [weak self] in self?.tabClicked() }
        tabView.onDrag = { [weak self] dy in
            guard let me = self else { return }
            let vf = me.tabScreen.visibleFrame
            me.tabTop = min(max(me.tabTop + dy, 0), vf.height - me.tabSize.height)
            me.placeTab()
            if me.side && me.panel.isVisible { me.placeSide() }
        }
        tabView.onDrop = { [weak self] imgs in self?.sendDropped(imgs) }
        placeTab()
        if tabShown { tabPanel.orderFrontRegardless() }
    }

    func placeTab() {
        let vf = tabScreen.visibleFrame
        let top = min(max(tabTop, 0), vf.height - tabSize.height)
        tabPanel.setFrame(NSRect(x: vf.maxX - tabSize.width, y: vf.maxY - top - tabSize.height, width: tabSize.width, height: tabSize.height), display: true)
    }

    // The side panel: beside the tab, as tall as the screen allows, centred on the tab.
    func placeSide() {
        let vf = tabScreen.visibleFrame
        let h = min(vf.height - 20, 900)
        var y = tabPanel.frame.midY - h / 2
        y = min(max(y, vf.minY + 10), vf.maxY - 10 - h)
        panel.setFrame(NSRect(x: vf.maxX - tabSize.width - sideWidth - 6, y: y, width: sideWidth, height: h), display: true)
    }

    func tabClicked() {
        if windowed { show(side: true); return }      // open as a window: the tab brings it to the front
        if panel.isVisible && side { hidePanel(); return }
        if Date().timeIntervalSince(hiddenAt) < 0.35 && side { return }   // that click is what just closed it
        show(side: true)
    }

    @objc func toggleTab(_ sender: NSMenuItem) {
        tabShown.toggle()
        sender.state = tabShown ? .on : .off
        if tabShown { placeTab(); tabPanel.orderFrontRegardless() } else {
            if side && panel.isVisible { hidePanel() }
            tabPanel.orderOut(nil)
        }
    }

    // Images dropped on the tab go to the inbox, through the same send form as a screenshot.
    func sendDropped(_ imgs: [(NSImage, String)]) {
        let encs: [[String: String]] = imgs.prefix(20).compactMap { pair in
            guard var e = encodeImage(pair.0) else { return nil }
            if !pair.1.isEmpty { e["name"] = pair.1 }      // the file name often names the project
            return e
        }
        guard !encs.isEmpty else { return }
        show(side: true)
        js("pr.shot(\(jsonString(["images": encs])))")
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
        web.uiDelegate = self                         // so "+ New precedent" can open a file chooser
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
        _ = add("Open as a window", #selector(openWindow))
        let tabItem = add("Show the Precedents tab", #selector(toggleTab(_:)))
        tabItem.state = tabShown ? .on : .off
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
        if id == 1 { (!windowed && panel.isVisible && panel.isKeyWindow) ? hidePanel() : showPanel() }
        if id == 2 { takeScreenshot() }
    }

    // MARK: Showing and hiding

    @objc func showPanel() { show(side: false) }

    // side: beside the tab on the right edge; otherwise the panel near the top of the screen (Control-Option-P).
    func show(side wantSide: Bool) {
        if let w = appWindow, windowed {
            if w.isMiniaturized { w.deminiaturize(nil) }
            NSApp.activate(ignoringOtherApps: true); w.makeKeyAndOrderFront(nil); js("pr.focus()"); return
        }
        if let f = NSWorkspace.shared.frontmostApplication, f.processIdentifier != getpid() { previousApp = f }
        let changed = wantSide != side
        side = wantSide
        js("pr.setMode('\(wantSide ? "side" : "top")')")
        if wantSide { placeSide() } else if !panel.isVisible || changed { place() }
        panel.makeKeyAndOrderFront(nil)
        tabView?.isOpen = wantSide
        js("pr.focus()")
    }

    func hidePanel() {
        panel.orderOut(nil)
        tabView?.isOpen = false
        hiddenAt = Date()
        previousApp?.activate()
    }

    // Centred near the top of the screen with the mouse, or where it was left when pinned.
    func place() {
        panel.setContentSize(size)
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
        guard (notification.object as? NSWindow) === panel else { return }
        if !pinned && !dragging && !choosing { panel.orderOut(nil); tabView?.isOpen = false; hiddenAt = Date() }
    }

    // A web view can't open a file chooser by itself: "+ New precedent" (an <input type="file">) asks for one here.
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let chooser = NSOpenPanel()
        chooser.allowsMultipleSelection = parameters.allowsMultipleSelection
        chooser.canChooseDirectories = false
        chooser.canChooseFiles = true
        chooser.allowedContentTypes = [.image]
        chooser.message = "Choose photos to send to the Precedents inbox"
        chooser.prompt = "Choose"
        chooser.level = NSWindow.Level(rawValue: NSWindow.Level.floating.rawValue + 1)   // above the panel
        choosing = true
        NSApp.activate(ignoringOtherApps: true)
        chooser.begin { [weak self] result in
            completionHandler(result == .OK ? chooser.urls : nil)
            guard let me = self else { return }
            me.choosing = false
            if let w = me.web.window { w.makeKeyAndOrderFront(nil) }   // back to the send form
        }
    }

    // MARK: Resizing, and opening as a normal window

    // The top panel grows from its bottom-right corner; the side panel from its left edge (it stays beside the tab).
    func resizePanel(dx: Double, dy: Double) {
        if windowed { return }
        var f = panel.frame
        if side {
            let vf = tabScreen.visibleFrame
            sideWidth = min(max(f.width - CGFloat(dx), 340), vf.width - tabSize.width - 40)
            placeSide()
        } else {
            let vf = (panel.screen ?? NSScreen.main!).visibleFrame
            let w = min(max(f.width + CGFloat(dx), 420), vf.width), h = min(max(f.height + CGFloat(dy), 400), vf.height)
            f.origin.y = f.maxY - h
            f.size = NSSize(width: w, height: h)
            panel.setFrame(f, display: true)
            size = f.size
        }
    }

    // The same page in a normal Mac window: resize it, make it full screen, Command-Tab to it. Closing it (or ⤡)
    // puts it back in the panel. While it's open, Precedents shows in the Dock.
    @objc func openWindow() {
        if appWindow == nil {
            let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1200, height: 820),
                             styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            w.title = "Precedents"
            w.isReleasedWhenClosed = false
            w.minSize = NSSize(width: 520, height: 480)
            w.collectionBehavior = [.fullScreenPrimary]
            w.delegate = self
            if !w.setFrameUsingName("PrecedentsWindow") { w.center() }
            w.setFrameAutosaveName("PrecedentsWindow")
            appWindow = w
        }
        guard let w = appWindow else { return }
        panel.orderOut(nil)
        tabView?.isOpen = false
        panel.contentView = NSView()
        w.contentView = web
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        w.makeKeyAndOrderFront(nil)
        js("pr.setMode('window')")
        js("pr.focus()")
    }

    @objc func backToPanelAction() { backToPanel(closing: false) }

    func backToPanel(closing: Bool) {
        guard let w = appWindow, w.contentView === web else { return }
        if w.styleMask.contains(.fullScreen) && !closing { w.toggleFullScreen(nil) }
        w.contentView = NSView()
        panel.contentView = web
        if !closing { w.orderOut(nil) }
        NSApp.setActivationPolicy(.accessory)
        js("pr.setMode('\(side ? "side" : "top")')")
        if !closing { show(side: side) }
    }

    func windowWillClose(_ notification: Notification) {
        if (notification.object as? NSWindow) === appWindow { backToPanel(closing: true) }
    }

    // A menu bar for when it's a normal window (Edit for copy and paste in the search box; Window for close, minimise
    // and full screen). An accessory app shows no menu bar, so this only appears while the window is open.
    func buildMainMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu()
        let back = NSMenuItem(title: "Back to the panel", action: #selector(backToPanelAction), keyEquivalent: "")
        back.target = self
        appMenu.addItem(back)
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Precedents", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Quit Precedents", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        let winItem = NSMenuItem(); main.addItem(winItem)
        let win = NSMenu(title: "Window")
        win.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        win.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        let fs = NSMenuItem(title: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fs.keyEquivalentModifierMask = [.command, .control]
        win.addItem(fs)
        winItem.submenu = win
        NSApp.mainMenu = main
        NSApp.windowsMenu = win
    }

    // MARK: Messages from the panel page

    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let m = message.body as? [String: Any], let type = m["type"] as? String else { return }
        switch type {
        case "ready":
            ready = true
            js("pr.setPinned(\(pinned))")
            js("pr.setMode('\(side ? "side" : "top")')")
            pendingJS.forEach { web.evaluateJavaScript($0) }
            pendingJS.removeAll()
        case "hide": if !windowed { hidePanel() }
        case "pin":
            pinned = (m["on"] as? Bool) ?? false
            if pinned && !side { defaults.set(NSStringFromPoint(panel.frame.origin), forKey: "pinnedOrigin") }
        case "window":
            if (m["on"] as? Bool) == true { openWindow() } else { backToPanel(closing: false) }
        case "resize":
            resizePanel(dx: (m["dx"] as? NSNumber)?.doubleValue ?? 0, dy: (m["dy"] as? NSNumber)?.doubleValue ?? 0)
        case "move":
            if side || windowed { break }                          // the side panel stays beside the tab (drag the tab instead)
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
