import Foundation
import WebKit

@MainActor
protocol NativeSource: AnyObject {
  var profileID: String { get }
  var label: String { get }
  func dispatch(method: String, params: Data) async throws -> Data
  func upload(_ payload: Data) async throws
  func nextEvent() async throws -> Data
  func close()
}

@MainActor
final class NativeBridge: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
  private(set) var handle = UUID().uuidString
  private(set) var document = UUID().uuidString
  private(set) var closed = false
  private(set) var framesReceived = 0
  private(set) var framesSent = 0
  private(set) var queuedHighWater = 0
  private let source: NativeSource
  private var committed = false
  #if DEBUG
    private var keyboardObserver: NSObjectProtocol?
  #endif
  private var inboundJobs = 0
  private var receiver = NativeFrameReceiver()
  private var operations: [String: Task<Void, Never>] = [:]
  private var queue: [Data] = []
  private var queuedBytes = 0
  private var nextID: UInt32 = 1
  private var drain: Task<Void, Never>?
  private var events: Task<Void, Never>?
  private var ack: (String, CheckedContinuation<Void, Error>)?
  private var queueWaiters: [UUID: CheckedContinuation<Void, Error>] = [:]
  private var ackTimeout: Task<Void, Never>?
  weak var webView: WKWebView?
  var routeChanged: (String) -> Void = { _ in }
  var switchHost: () -> Void = {}
  var openExternal: (URL) -> Void = { UIApplication.shared.open($0) }
  var reauthenticationRequired: (Bool) -> Void = { _ in }
  var notificationStatus: () async -> [String: Any] = {
    [
      "firebase": "unavailable", "permission": "not_requested", "channel": "not_supported",
      "installation": "unavailable", "notificationsEnabled": false,
    ]
  }
  var requestPermission: () async -> [String: Any] = {
    [
      "firebase": "unavailable", "permission": "not_requested", "channel": "not_supported",
      "installation": "unavailable", "notificationsEnabled": false,
    ]
  }

  init(source: NativeSource) { self.source = source }

  func makeWebView(root: URL) -> WKWebView {
    let configuration = WKWebViewConfiguration()
    configuration.allowsInlineMediaPlayback = true
    configuration.allowsAirPlayForMediaPlayback = false
    #if DEBUG
      InputAcceptance.install(configuration)
    #endif
    configuration.setURLSchemeHandler(BundledAssets(root: root), forURLScheme: BundledAssets.scheme)
    if #available(iOS 17.0, *), let id = UUID(uuidString: source.profileID) {
      configuration.websiteDataStore = WKWebsiteDataStore(forIdentifier: id)
    } else {
      configuration.websiteDataStore = .nonPersistent()
    }
    configuration.userContentController.add(self, name: "ya")
    let token = String(
      data: try! JSONSerialization.data(withJSONObject: document, options: .fragmentsAllowed),
      encoding: .utf8)!
    let bootstrap = """
      (() => {
        const documentToken = \(token);
        for (const [name, channel] of [['yaNativeTransport', 'source'], ['yaNative', 'control']]) {
          const port = { onmessage: null, postMessage(data) {
            if (typeof data !== 'string') throw new Error('iOS bridge requires negotiated string frames');
            window.webkit.messageHandlers.ya.postMessage({ document: documentToken, channel, data });
          }};
          Object.defineProperty(window, name, { value: port, configurable: false });
        }
        const reportRoute = () => window.webkit.messageHandlers.ya.postMessage({document:documentToken,channel:'route',data:location.pathname+location.search+location.hash});
        for (const method of ['pushState','replaceState']) {
          const original = history[method];
          history[method] = function(...args) { const result=original.apply(this,args);reportRoute();return result; };
        }
        window.addEventListener('popstate',reportRoute);
        window.addEventListener('DOMContentLoaded',reportRoute);
        Object.defineProperty(window, '__yaNativeReceive', { value(channel, data, token) {
          if (token !== documentToken) return;
          const port = channel === 'source' ? window.yaNativeTransport : window.yaNative;
          port.onmessage?.({ data });
        }});
      })();
      """
    configuration.userContentController.addUserScript(
      WKUserScript(source: bootstrap, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    let view = WKWebView(frame: .zero, configuration: configuration)
    view.navigationDelegate = self
    if #available(iOS 16.4, *) { view.isInspectable = false }
    webView = view
    #if DEBUG
      if ProcessInfo.processInfo.arguments.contains("-qa-input-metrics") {
        keyboardObserver = NotificationCenter.default.addObserver(
          forName: UIResponder.keyboardDidShowNotification, object: nil, queue: .main
        ) { [weak view] _ in
          Task { @MainActor in
            _ = try? await view?.evaluateJavaScript(
              "window.dispatchEvent(new Event('yaKeyboardShown'))")
          }
        }
      }
    #endif
    return view
  }

  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    guard !closed, message.frameInfo.isMainFrame,
      let url = message.frameInfo.request.url,
      url.scheme == BundledAssets.scheme, url.host == BundledAssets.host,
      let body = message.body as? [String: Any], body["document"] as? String == document,
      let text = body["data"] as? String, let channel = body["channel"] as? String
    else { return }
    guard inboundJobs < 32 else { fail(); return }
    inboundJobs += 1
    Task {
      defer { inboundJobs -= 1 }
      guard !closed else { return }
      do {
        if channel == "source" {
          try await receive(text)
        } else if channel == "control" {
          try await control(text)
        } else if channel == "route", text.utf8.count <= 4096, text.hasPrefix("/"),
          !text.hasPrefix("//")
        {
          routeChanged(text)
        }
      } catch { fail() }
    }
  }

  private func receive(_ text: String) async throws {
    guard text.utf8.count <= 87_500 else { throw BridgeFailure.overflow }
    if text.hasPrefix("ack:") {
      guard let pending = ack, pending.0 == text else { throw BridgeFailure.invalidFrame }
      ack = nil; ackTimeout?.cancel(); ackTimeout = nil
      pending.1.resume()
    } else if text == "release:" + handle {
      close()
    } else if text.hasPrefix("frame:") {
      guard let bytes = Data(base64Encoded: String(text.dropFirst(6))) else {
        throw BridgeFailure.invalidFrame
      }
      let frame = try NativeFrame(bytes)
      let completed = try receiver.accept(frame)
      framesReceived += 1
      if let (kind, data) = completed {
        if kind == 2 { try await source.upload(data) } else { try dispatch(data) }
      }
      try await deliver("ack:\(handle):\(frame.id):\(frame.offset + frame.data.count)")
    } else {
      guard text.utf8.count <= 16_384,
        let value = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
        value["type"] as? String == "hello", value["protocol"] as? Int == 1,
        events == nil
      else { throw BridgeFailure.invalidCommand }
      try await deliver(
        json([
          "type": "hello", "protocol": 1, "handle": handle, "profileId": source.profileID,
          "label": source.label, "binary": false,
        ]))
      try enqueue(Data(json(["type": "state", "phase": "CONNECTED"]).utf8))
      events = Task { [weak self, source] in
        do {
          while !Task.isCancelled {
            let event = try await source.nextEvent()
            guard let self, !self.closed else { return }
            try await self.waitForQueueRoom(event.count, limit: 24)
            try self.enqueue(event)
          }
        } catch {
          guard !Task.isCancelled, let self else { return }
          if case CoreError.ReauthenticationRequired = error {
            self.close(); self.reauthenticationRequired(false)
          } else if case NativeSecurityFailure.revoked = error {
            self.close(); self.reauthenticationRequired(true)
          } else {
            self.fail()
          }
        }
      }
    }
  }

  private func dispatch(_ data: Data) throws {
    guard let command = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      command["handle"] as? String == handle,
      let id = command["id"] as? String, !id.isEmpty, id.utf8.count <= 128,
      let method = command["method"] as? String
    else { throw BridgeFailure.staleDocument }
    let params = command["params"] as? [String: Any] ?? [:]
    if method == "cancel" {
      if let target = params["id"] as? String { operations.removeValue(forKey: target)?.cancel() }
      return
    }
    guard operations.count < 32, operations[id] == nil else { throw BridgeFailure.overflow }
    let paramsData = try JSONSerialization.data(withJSONObject: params)
    operations[id] = Task { [weak self, source] in
      guard let self else { return }
      defer { self.operations.removeValue(forKey: id) }
      do {
        let result: Any
        if method == "switchHost" {
          self.switchHost(); result = [:]
        } else {
          result = try JSONSerialization.jsonObject(
            with: await source.dispatch(method: method, params: paramsData))
        }
        guard !Task.isCancelled, !self.closed else { return }
        let reply = Data(self.json(["type": "reply", "id": id, "result": result]).utf8)
        try await self.waitForQueueRoom(reply.count, limit: 32)
        try self.enqueue(reply)
      } catch {
        if !Task.isCancelled, !self.closed {
          try? await self.waitForQueueRoom(2048, limit: 32)
          try? self.enqueue(
            Data(
              self.json(["type": "reply", "id": id, "error": "Native source operation failed"]).utf8
            ))
        }
      }
    }
  }

  private func control(_ text: String) async throws {
    guard text.utf8.count <= 16_384,
      let command = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
      command["protocol"] as? Int == 1, let id = command["id"] as? String, id.utf8.count <= 128,
      let method = command["method"] as? String
    else { throw BridgeFailure.invalidCommand }
    let result: [String: Any]
    switch method {
    case "host.describe":
      result = [
        "protocol": 1, "platform": "ios",
        "appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
          ?? "0.1.0", "buildVersion": 1,
        "features": ["notifications.status", "notifications.requestPermission"],
      ]
    case "notifications.status": result = await notificationStatus()
    case "notifications.requestPermission": result = await requestPermission()
    default: throw BridgeFailure.invalidCommand
    }
    try await deliver(
      json(["protocol": 1, "id": id, "ok": true, "result": result]), channel: "control")
  }

  private func json(_ value: [String: Any]) -> String {
    String(
      data: (try? JSONSerialization.data(withJSONObject: value)) ?? Data("{}".utf8), encoding: .utf8
    ) ?? "{}"
  }

  private func waitForQueueRoom(_ bytes: Int, limit: Int) async throws {
    guard bytes <= NativeFrame.messageLimit else { throw BridgeFailure.overflow }
    while queue.count >= limit || queuedBytes > 64 * 1024 * 1024 - bytes {
      try Task.checkCancellation(); guard !closed else { throw BridgeFailure.closed }
      let id = UUID()
      try await withTaskCancellationHandler {
        try await withCheckedThrowingContinuation { (ready: CheckedContinuation<Void, Error>) in
          queueWaiters[id] = ready
        }
      } onCancel: {
        Task { @MainActor [weak self] in
          self?.queueWaiters.removeValue(forKey: id)?.resume(throwing: CancellationError())
        }
      }
    }
    try Task.checkCancellation(); guard !closed else { throw BridgeFailure.closed }
  }
  private func queueRoomChanged() {
    let waiting = queueWaiters.values; queueWaiters.removeAll()
    for ready in waiting { ready.resume() }
  }
  func enqueue(_ message: Data) throws {
    guard !closed, !message.isEmpty, message.count <= NativeFrame.messageLimit,
      queue.count < 32, queuedBytes <= 64 * 1024 * 1024 - message.count
    else { throw BridgeFailure.overflow }
    queue.append(message); queuedBytes += message.count
    queuedHighWater = max(queuedHighWater, queuedBytes)
    guard drain == nil else { return }
    drain = Task { [weak self] in
      guard let self else { return }
      defer { self.drain = nil }
      do {
        while !self.queue.isEmpty, !self.closed {
          let bytes = self.queue.removeFirst()
          defer {
            self.queuedBytes = max(0, self.queuedBytes - bytes.count); self.queueRoomChanged()
          }
          let id = self.nextID
          guard id < UInt32.max else { throw BridgeFailure.overflow }
          self.nextID += 1
          for start in stride(from: 0, to: bytes.count, by: NativeFrame.chunkLimit) {
            let end = min(bytes.count, start + NativeFrame.chunkLimit)
            let frame = try NativeFrame.encode(
              id: id, offset: start, total: bytes.count, data: bytes.subdata(in: start..<end))
            try await withCheckedThrowingContinuation {
              (continuation: CheckedContinuation<Void, Error>) in
              self.ack = ("ack:\(self.handle):\(id):\(end)", continuation)
              self.ackTimeout = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                if !Task.isCancelled { self?.fail() }
              }
              Task {
                do {
                  try await self.deliver("frame:" + frame.base64EncodedString());
                  self.framesSent += 1
                } catch { self.fail() }
              }
            }
          }
        }
      } catch { self.fail() }
    }
  }

  // Dispatch source work after the rendering opportunity. Running its React
  // callbacks inside rAF steals the very paint slot reserved for keyboard input.
  private func deliver(_ text: String, channel: String = "source") async throws {
    guard !closed, let view = webView else { throw BridgeFailure.closed }
    _ = try await view.callAsyncJavaScript(
      "if (data.startsWith('frame:')) { requestAnimationFrame(() => setTimeout(() => window.__yaNativeReceive(channel, data, token), 0)); } else { window.__yaNativeReceive(channel, data, token); }",
      arguments: ["channel": channel, "data": text, "token": document], in: nil, contentWorld: .page
    )
  }

  func close() {
    guard !closed else { return }
    closed = true
    events?.cancel(); events = nil
    for operation in operations.values { operation.cancel() }
    operations.removeAll()
    ackTimeout?.cancel(); ackTimeout = nil
    ack?.1.resume(throwing: BridgeFailure.closed); ack = nil
    drain?.cancel(); drain = nil
    let waiting = queueWaiters.values; queueWaiters.removeAll()
    for ready in waiting { ready.resume(throwing: BridgeFailure.closed) }
    queue.removeAll(); queuedBytes = 0
    #if DEBUG
      if let keyboardObserver { NotificationCenter.default.removeObserver(keyboardObserver) }
      keyboardObserver = nil
    #endif
    source.close()
    webView?.configuration.userContentController.removeScriptMessageHandler(forName: "ya")
  }

  private func fail() { guard !closed else { return }; close(); switchHost() }

  func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
    if navigationAction.targetFrame?.isMainFrame != false {
      if url.scheme != BundledAssets.scheme || url.host != BundledAssets.host {
        if navigationAction.navigationType == .linkActivated,
          ["https", "http"].contains(url.scheme ?? ""), url.user == nil, url.password == nil
        {
          openExternal(url)
        }
        decisionHandler(.cancel); return
      }
      if committed { close(); decisionHandler(.cancel); switchHost(); return }
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) { committed = true }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { close(); switchHost() }
}
