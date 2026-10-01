// Yep Cockpit fuer macOS: ein natives Fenster um die beiden Cockpits (Mac und
// aihub) mit Mitteilungen, wenn ein Auftrag fertig ist oder auf Joscha wartet.
//
// Die Web-Oberflaeche bleibt unveraendert; die App bettet sie in je eine
// WKWebView pro Rechner ein. Mitteilungen kommen nicht ueber Web Push (das kann
// eine eingebettete WebView nicht), sondern aus einer leichten Abfrage von
// /api/processes mit den Anmelde-Cookies der WebView.

import AppKit
import UserNotifications
import WebKit

struct Rechner: Decodable {
    let name: String
    let url: String

    var basis: URL { URL(string: url)! }
    var host: String { basis.host ?? "" }
    var start: URL { basis.appendingPathComponent("cockpit") }
}

func rechnerLaden() -> [Rechner] {
    guard let pfad = Bundle.main.url(forResource: "rechner", withExtension: "json"),
          let daten = try? Data(contentsOf: pfad),
          let liste = try? JSONDecoder().decode([Rechner].self, from: daten),
          !liste.isEmpty
    else {
        fatalError("rechner.json fehlt im App-Bundle; build.sh erneut ausfuehren")
    }
    return liste
}

// MARK: - Abfrage der laufenden Auftraege

struct Prozess: Decodable {
    let sessionId: String
    let projectId: String
    let projectName: String?
    let sessionTitle: String?
    let state: String
}

struct ProzessListe: Decodable {
    let processes: [Prozess]
}

final class Waechter {
    let rechner: Rechner
    let speicher: WKHTTPCookieStore
    let melden: (Rechner, Prozess, String) -> Void
    let zaehlerGeaendert: () -> Void

    private(set) var arbeitend = 0
    private var letzterStand: [String: String]?
    private var timer: Timer?
    private var laeuft = false

    init(rechner: Rechner, speicher: WKHTTPCookieStore,
         melden: @escaping (Rechner, Prozess, String) -> Void,
         zaehlerGeaendert: @escaping () -> Void) {
        self.rechner = rechner
        self.speicher = speicher
        self.melden = melden
        self.zaehlerGeaendert = zaehlerGeaendert
    }

    func start() {
        abfragen()
        timer = Timer.scheduledTimer(withTimeInterval: 6, repeats: true) { [weak self] _ in
            self?.abfragen()
        }
        timer?.tolerance = 2
    }

    private func abfragen() {
        guard !laeuft else { return }
        laeuft = true
        speicher.getAllCookies { [weak self] cookies in
            guard let self else { return }
            // Nur die Cookies dieses Rechners mitschicken, nie fremde.
            let eigene = cookies.filter { cookie in
                let domain = cookie.domain.hasPrefix(".") ? String(cookie.domain.dropFirst()) : cookie.domain
                return domain == self.rechner.host
            }
            guard !eigene.isEmpty else {
                self.ergebnis(nil)
                return
            }
            var anfrage = URLRequest(url: self.rechner.basis.appendingPathComponent("api/processes"),
                                     cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
            anfrage.httpShouldHandleCookies = false
            for (feld, wert) in HTTPCookie.requestHeaderFields(with: eigene) {
                anfrage.setValue(wert, forHTTPHeaderField: feld)
            }
            anfrage.setValue("true", forHTTPHeaderField: "X-Yep-Anywhere")
            URLSession.shared.dataTask(with: anfrage) { daten, antwort, _ in
                let ok = (antwort as? HTTPURLResponse)?.statusCode == 200
                let liste = ok ? daten.flatMap { try? JSONDecoder().decode(ProzessListe.self, from: $0) } : nil
                DispatchQueue.main.async { self.ergebnis(liste?.processes) }
            }.resume()
        }
    }

    private func ergebnis(_ prozesse: [Prozess]?) {
        laeuft = false
        guard let prozesse else {
            // Nicht angemeldet oder Rechner nicht erreichbar: keinen alten Stand
            // vergleichen, sonst kaemen nach dem Wiederverbinden Fehlmeldungen.
            letzterStand = nil
            if arbeitend != 0 { arbeitend = 0; zaehlerGeaendert() }
            return
        }
        let jetzt = Dictionary(prozesse.map { ($0.sessionId, $0.state) }, uniquingKeysWith: { _, b in b })
        if let vorher = letzterStand {
            for prozess in prozesse {
                let alt = vorher[prozess.sessionId]
                if alt == "in-turn" && prozess.state == "idle" {
                    melden(rechner, prozess, "fertig")
                } else if prozess.state == "waiting-input" && alt != nil && alt != "waiting-input" {
                    melden(rechner, prozess, "wartet")
                }
            }
        }
        letzterStand = jetzt
        let neu = prozesse.filter { $0.state == "in-turn" }.count
        if neu != arbeitend { arbeitend = neu; zaehlerGeaendert() }
    }
}

// MARK: - Fenster

final class CockpitFenster: NSWindowController, NSWindowDelegate, WKNavigationDelegate,
    WKUIDelegate, WKDownloadDelegate, NSToolbarDelegate {
    let rechner: [Rechner]
    private(set) var ansichten: [WKWebView] = []
    private(set) var aktiv = 0
    private let umschalter: NSSegmentedControl
    private let ablage = NSView()

    init(rechner: [Rechner]) {
        self.rechner = rechner
        umschalter = NSSegmentedControl(labels: rechner.map(\.name), trackingMode: .selectOne,
                                        target: nil, action: nil)
        let fenster = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 860),
                               styleMask: [.titled, .closable, .miniaturizable, .resizable,
                                           .fullSizeContentView],
                               backing: .buffered, defer: false)
        fenster.title = "Yep Cockpit"
        fenster.titleVisibility = .hidden
        fenster.minSize = NSSize(width: 420, height: 400)
        fenster.center()
        fenster.setFrameAutosaveName("YepCockpitFenster")
        fenster.tabbingMode = .disallowed
        super.init(window: fenster)
        fenster.delegate = self

        let konfiguration = WKWebViewConfiguration()
        konfiguration.websiteDataStore = .default()
        // Vorlesen startet Audio ohne neuen Klick im Fenster.
        konfiguration.mediaTypesRequiringUserActionForPlayback = []
        konfiguration.preferences.isElementFullscreenEnabled = true
        for eintrag in rechner {
            let ansicht = WKWebView(frame: .zero, configuration: konfiguration)
            ansicht.navigationDelegate = self
            ansicht.uiDelegate = self
            ansicht.allowsBackForwardNavigationGestures = true
            ansicht.allowsMagnification = true
            ansicht.isInspectable = true
            ansicht.load(URLRequest(url: eintrag.start))
            ansichten.append(ansicht)
        }

        ablage.wantsLayer = true
        ablage.layer?.backgroundColor = NSColor.black.cgColor
        fenster.contentView = ablage
        fenster.backgroundColor = .black

        umschalter.target = self
        umschalter.action = #selector(umschalterGeklickt)
        umschalter.segmentStyle = .separated
        let leiste = NSToolbar(identifier: "YepCockpitLeiste")
        leiste.delegate = self
        leiste.displayMode = .iconOnly
        fenster.toolbar = leiste
        fenster.toolbarStyle = .unifiedCompact

        zeigen(UserDefaults.standard.integer(forKey: "aktiverRechner"))
    }

    required init?(coder: NSCoder) { nil }

    func zeigen(_ index: Int) {
        let index = rechner.indices.contains(index) ? index : 0
        aktiv = index
        umschalter.selectedSegment = index
        UserDefaults.standard.set(index, forKey: "aktiverRechner")
        ablage.subviews.forEach { $0.removeFromSuperview() }
        let ansicht = ansichten[index]
        ansicht.frame = ablage.bounds
        ansicht.autoresizingMask = [.width, .height]
        ablage.addSubview(ansicht)
        window?.makeFirstResponder(ansicht)
        window?.subtitle = rechner[index].name
    }

    func oeffnen(rechnerName: String, pfad: String) {
        guard let index = rechner.firstIndex(where: { $0.name == rechnerName }) else { return }
        zeigen(index)
        if let ziel = URL(string: pfad, relativeTo: rechner[index].basis) {
            ansichten[index].load(URLRequest(url: ziel))
        }
        showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    /// Zeigt das Fenster gerade genau diese Sitzung? Dann keine Mitteilung.
    func zeigtSitzung(_ sessionId: String, auf name: String) -> Bool {
        guard NSApp.isActive, window?.isVisible == true, window?.isMiniaturized == false,
              rechner[aktiv].name == name else { return false }
        return ansichten[aktiv].url?.path.contains(sessionId) == true
    }

    var aktuelleAnsicht: WKWebView { ansichten[aktiv] }

    @objc private func umschalterGeklickt() { zeigen(umschalter.selectedSegment) }

    // Fenster schliessen versteckt nur: die Abfragen und offenen Verbindungen
    // laufen weiter, ein Klick aufs Dock-Symbol holt das Fenster zurueck.
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        sender.orderOut(nil)
        return false
    }

    // MARK: Werkzeugleiste

    private let umschalterKennung = NSToolbarItem.Identifier("rechner")

    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        [.flexibleSpace, umschalterKennung, .flexibleSpace]
    }

    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        toolbarDefaultItemIdentifiers(toolbar)
    }

    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier kennung: NSToolbarItem.Identifier,
                 willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        guard kennung == umschalterKennung else { return nil }
        let eintrag = NSToolbarItem(itemIdentifier: kennung)
        eintrag.view = umschalter
        eintrag.label = "Rechner"
        return eintrag
    }

    // MARK: Navigation

    private func istEigen(_ url: URL?) -> Bool {
        guard let url else { return false }
        if url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" { return true }
        return rechner.contains { $0.basis.host == url.host && $0.basis.port == url.port && url.scheme == "https" }
    }

    func webView(_ webView: WKWebView, decidePolicyFor aktion: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if aktion.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        guard let url = aktion.request.url else { return decisionHandler(.cancel) }
        // Fremde Adressen (GitHub, Doku, ...) gehoeren in den normalen Browser,
        // nicht in ein Fenster mit Cockpit-Anmeldung.
        if aktion.targetFrame?.isMainFrame != false, !istEigen(url) {
            if ["http", "https", "mailto"].contains(url.scheme ?? "") {
                NSWorkspace.shared.open(url)
            }
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor antwort: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(antwort.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction,
                 didBecome download: WKDownload) { download.delegate = self }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse,
                 didBecome download: WKDownload) { download.delegate = self }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let ordner = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
        let name = (suggestedFilename as NSString).lastPathComponent
        var ziel = ordner.appendingPathComponent(name.isEmpty ? "Download" : name)
        var n = 2
        while FileManager.default.fileExists(atPath: ziel.path) {
            let basis = (name as NSString).deletingPathExtension
            let endung = (name as NSString).pathExtension
            ziel = ordner.appendingPathComponent(endung.isEmpty ? "\(basis) \(n)" : "\(basis) \(n).\(endung)")
            n += 1
        }
        completionHandler(ziel)
    }

    func downloadDidFinish(_ download: WKDownload) {}

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
                 withError fehler: Error) {
        let code = (fehler as NSError).code
        guard code != NSURLErrorCancelled, let index = ansichten.firstIndex(of: webView) else { return }
        let eintrag = rechner[index]
        let html = """
        <html><body style="background:#000;color:#ccc;font:15px -apple-system;display:flex;\
        align-items:center;justify-content:center;height:100vh;margin:0;text-align:center">
        <div><h2 style="color:#fff">\(eintrag.name) ist gerade nicht erreichbar</h2>
        <p>\(fehler.localizedDescription)</p>
        <p><a style="color:#8ab4ff" href="\(eintrag.start.absoluteString)">Erneut versuchen</a>
        &nbsp;·&nbsp; ⌘R</p></div></body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    // Pruefhilfe ohne Bildschirmfreigabe: YEP_SCHNAPPSCHUSS=/tmp/x legt nach dem
    // Laden /tmp/x-<Rechner>.png ab (open --env YEP_SCHNAPPSCHUSS=/tmp/x -a ...).
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let basis = ProcessInfo.processInfo.environment["YEP_SCHNAPPSCHUSS"],
              let index = ansichten.firstIndex(of: webView) else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
            webView.takeSnapshot(with: nil) { bild, _ in
                guard let bild, let tiff = bild.tiffRepresentation,
                      let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:])
                else { return }
                try? png.write(to: URL(fileURLWithPath: "\(basis)-\(self.rechner[index].name).png"))
            }
        }
    }

    // Prozess der WebView abgestuerzt (Speicher): still neu laden statt weiss.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

    // MARK: Oberflaechen-Dialoge der Webseite

    func webView(_ webView: WKWebView, createWebViewWith konfiguration: WKWebViewConfiguration,
                 for aktion: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        // target=_blank: eigene Seiten im selben Fenster, fremde im Browser.
        if let url = aktion.request.url {
            if istEigen(url) { webView.load(aktion.request) } else { NSWorkspace.shared.open(url) }
        }
        return nil
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameter: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let auswahl = NSOpenPanel()
        auswahl.allowsMultipleSelection = parameter.allowsMultipleSelection
        auswahl.canChooseDirectories = parameter.allowsDirectories
        auswahl.canChooseFiles = true
        auswahl.beginSheetModal(for: window!) { ergebnis in
            completionHandler(ergebnis == .OK ? auswahl.urls : nil)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage nachricht: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let hinweis = NSAlert()
        hinweis.messageText = nachricht
        hinweis.beginSheetModal(for: window!) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage nachricht: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let frage = NSAlert()
        frage.messageText = nachricht
        frage.addButton(withTitle: "OK")
        frage.addButton(withTitle: "Abbrechen")
        frage.beginSheetModal(for: window!) { antwort in completionHandler(antwort == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt text: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        let frage = NSAlert()
        frage.messageText = text
        let feld = NSTextField(frame: NSRect(x: 0, y: 0, width: 300, height: 24))
        feld.stringValue = defaultText ?? ""
        frage.accessoryView = feld
        frage.addButton(withTitle: "OK")
        frage.addButton(withTitle: "Abbrechen")
        frage.beginSheetModal(for: window!) { antwort in
            completionHandler(antwort == .alertFirstButtonReturn ? feld.stringValue : nil)
        }
    }

    // Mikrofon fuer die Spracheingabe, nur fuer die eigenen Cockpits.
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        let eigen = rechner.contains { $0.basis.host == origin.host && ($0.basis.port ?? 443) == origin.port }
        decisionHandler(eigen && origin.protocol == "https" ? .grant : .deny)
    }
}

// MARK: - App

final class AppSteuerung: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    private var fenster: CockpitFenster!
    private var waechter: [Waechter] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        let rechner = rechnerLaden()
        menueBauen(rechner)
        fenster = CockpitFenster(rechner: rechner)
        fenster.showWindow(nil)

        let mitteilungen = UNUserNotificationCenter.current()
        mitteilungen.delegate = self
        mitteilungen.requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }

        let speicher = WKWebsiteDataStore.default().httpCookieStore
        for eintrag in rechner {
            let w = Waechter(rechner: eintrag, speicher: speicher,
                             melden: { [weak self] in self?.melden($0, $1, $2) },
                             zaehlerGeaendert: { [weak self] in self?.dockAktualisieren() })
            waechter.append(w)
            w.start()
        }
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        fenster.showWindow(nil)
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    private func dockAktualisieren() {
        let summe = waechter.reduce(0) { $0 + $1.arbeitend }
        NSApp.dockTile.badgeLabel = summe > 0 ? "\(summe)" : nil
    }

    private func melden(_ rechner: Rechner, _ prozess: Prozess, _ art: String) {
        if fenster.zeigtSitzung(prozess.sessionId, auf: rechner.name) { return }
        let inhalt = UNMutableNotificationContent()
        let titel = prozess.sessionTitle?.trimmingCharacters(in: .whitespacesAndNewlines)
        let sitzung = (titel?.isEmpty == false ? titel : nil) ?? prozess.projectName ?? "Sitzung"
        inhalt.title = art == "fertig" ? "Fertig: \(sitzung)" : "Wartet auf dich: \(sitzung)"
        inhalt.subtitle = [rechner.name, prozess.projectName].compactMap { $0 }.joined(separator: " · ")
        inhalt.body = art == "fertig" ? "Der Auftrag ist abgeschlossen." : "Eine Frage oder Freigabe ist offen."
        inhalt.sound = .default
        inhalt.threadIdentifier = prozess.sessionId
        inhalt.userInfo = [
            "rechner": rechner.name,
            "pfad": "/cockpit/projects/\(prozess.projectId)/sessions/\(prozess.sessionId)",
        ]
        // Gleiche Sitzung ersetzt ihre alte Mitteilung statt zu stapeln.
        let anfrage = UNNotificationRequest(identifier: "\(rechner.name)-\(prozess.sessionId)",
                                            content: inhalt, trigger: nil)
        UNUserNotificationCenter.current().add(anfrage)
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler:
                                @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .list])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        if let name = info["rechner"] as? String, let pfad = info["pfad"] as? String {
            fenster.oeffnen(rechnerName: name, pfad: pfad)
        }
        completionHandler()
    }

    // MARK: Menue

    @objc private func rechnerWaehlen(_ sender: NSMenuItem) {
        fenster.zeigen(sender.tag)
        fenster.showWindow(nil)
    }

    @objc private func neuLaden(_ sender: Any?) { fenster.aktuelleAnsicht.reload() }
    @objc private func zurueck(_ sender: Any?) { fenster.aktuelleAnsicht.goBack() }
    @objc private func vor(_ sender: Any?) { fenster.aktuelleAnsicht.goForward() }
    @objc private func startseite(_ sender: Any?) {
        fenster.aktuelleAnsicht.load(URLRequest(url: fenster.rechner[fenster.aktiv].start))
    }
    @objc private func groesser(_ sender: Any?) { fenster.aktuelleAnsicht.pageZoom += 0.1 }
    @objc private func kleiner(_ sender: Any?) { fenster.aktuelleAnsicht.pageZoom -= 0.1 }
    @objc private func normal(_ sender: Any?) { fenster.aktuelleAnsicht.pageZoom = 1 }
    @objc private func imBrowser(_ sender: Any?) {
        if let url = fenster.aktuelleAnsicht.url { NSWorkspace.shared.open(url) }
    }

    private func menueBauen(_ rechner: [Rechner]) {
        let leiste = NSMenu()

        func menue(_ titel: String, _ eintraege: [NSMenuItem]) -> NSMenuItem {
            let oben = NSMenuItem()
            let m = NSMenu(title: titel)
            eintraege.forEach(m.addItem)
            oben.submenu = m
            leiste.addItem(oben)
            return oben
        }

        func eintrag(_ titel: String, _ aktion: Selector?, _ taste: String,
                     _ mod: NSEvent.ModifierFlags = .command, ziel: AnyObject? = nil) -> NSMenuItem {
            let e = NSMenuItem(title: titel, action: aktion, keyEquivalent: taste)
            e.keyEquivalentModifierMask = mod
            e.target = ziel
            return e
        }

        _ = menue("Yep Cockpit", [
            eintrag("Über Yep Cockpit", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), ""),
            .separator(),
            eintrag("Yep Cockpit ausblenden", #selector(NSApplication.hide(_:)), "h"),
            eintrag("Andere ausblenden", #selector(NSApplication.hideOtherApplications(_:)), "h",
                    [.command, .option]),
            .separator(),
            eintrag("Yep Cockpit beenden", #selector(NSApplication.terminate(_:)), "q"),
        ])
        _ = menue("Bearbeiten", [
            eintrag("Widerrufen", Selector(("undo:")), "z"),
            eintrag("Wiederholen", Selector(("redo:")), "z", [.command, .shift]),
            .separator(),
            eintrag("Ausschneiden", #selector(NSText.cut(_:)), "x"),
            eintrag("Kopieren", #selector(NSText.copy(_:)), "c"),
            eintrag("Einsetzen", #selector(NSText.paste(_:)), "v"),
            eintrag("Alles auswählen", #selector(NSText.selectAll(_:)), "a"),
        ])
        var rechnerEintraege = rechner.enumerated().map { index, r -> NSMenuItem in
            let e = eintrag(r.name, #selector(rechnerWaehlen(_:)), "\(index + 1)", ziel: self)
            e.tag = index
            return e
        }
        rechnerEintraege += [
            .separator(),
            eintrag("Cockpit-Startseite", #selector(startseite(_:)), "h", [.command, .shift], ziel: self),
            eintrag("Zurück", #selector(zurueck(_:)), "[", ziel: self),
            eintrag("Vor", #selector(vor(_:)), "]", ziel: self),
            eintrag("Neu laden", #selector(neuLaden(_:)), "r", ziel: self),
            .separator(),
            eintrag("Größer", #selector(groesser(_:)), "+", ziel: self),
            eintrag("Kleiner", #selector(kleiner(_:)), "-", ziel: self),
            eintrag("Originalgröße", #selector(normal(_:)), "0", ziel: self),
            .separator(),
            eintrag("Im Browser öffnen", #selector(imBrowser(_:)), "o", [.command, .shift], ziel: self),
        ]
        _ = menue("Ansicht", rechnerEintraege)
        let fensterMenue = menue("Fenster", [
            eintrag("Im Dock ablegen", #selector(NSWindow.performMiniaturize(_:)), "m"),
            eintrag("Zoomen", #selector(NSWindow.performZoom(_:)), ""),
            eintrag("Schließen", #selector(NSWindow.performClose(_:)), "w"),
        ])
        NSApp.windowsMenu = fensterMenue.submenu
        NSApp.mainMenu = leiste
    }
}

let app = NSApplication.shared
let steuerung = AppSteuerung()
app.delegate = steuerung
app.setActivationPolicy(.regular)
app.run()
