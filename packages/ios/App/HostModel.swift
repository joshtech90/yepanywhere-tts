import Foundation
import SwiftUI
import WebKit

@MainActor
final class HostModel: ObservableObject {
  @Published var catalog = HostCatalog()
  @Published var webView: WKWebView?
  @Published var busy = false
  @Published var error: String?
  @Published var reauthenticate: HostProfile?
  @Published var adding = false
  @Published var forgetAnyway: HostProfile?
  @Published var catalogAvailable = false
  private var started = false
  private(set) var connections = NativeRuntime()
  private let store: HostStore
  private let security: SecurityClientCoordinator
  private var bridge: NativeBridge?
  private var work: Task<Void, Never>?
  private var generation = UUID()
  private var suspendedProfile: HostProfile?
  let notifications: NativeNotifications
  init(store: HostStore = HostStore()) {
    self.store = store; security = SecurityClientCoordinator(store: store)
    // Acceptance catalogs must never retire the user's push bindings.
    let pushService =
      store.service == "com.yepanywhere.ios.hosts.v1"
      ? "com.yepanywhere.ios.push.v1" : store.service + ".push.v1"
    notifications = NativeNotifications(store: HostStore(service: pushService))
    do { catalog = try store.catalog(); catalogAvailable = true } catch {
      self.error = "Saved hosts are unavailable. Unlock the device and try again."
    }
    notifications.knownHost = { [weak self] id in
      guard let self,
        let profile = self.catalog.profiles.first(where: { $0.id == id && $0.forgetting != true })
      else { return false }
      do { try self.security.requireUnrevoked(profile); return true } catch { return false }
    }
    notifications.currentClientID = { [weak self] id in
      guard let self,
        let profile = self.catalog.profiles.first(where: { $0.id == id && $0.forgetting != true })
      else { return nil }
      return try? self.security.pushClientID(profile)
    }
    notifications.openHost = { [weak self] id, sessionID in
      guard let self, let profile = self.catalog.profiles.first(where: { $0.id == id }) else {
        return
      }
      self.open(profile, pushSessionID: sessionID)
    }
  }
  func switchHost() {
    let retiring = webView
    Task {
      _ = try? await retiring?.evaluateJavaScript(
        "window.dispatchEvent(new Event('pagehide'));true")
    }
    generation = UUID(); work?.cancel(); work = nil; busy = false
    bridge?.close(); bridge = nil; webView = nil; suspendedProfile = nil
  }
  func login(label: String, endpoint: String, target: String?, username: String, password: String) {
    guard catalogAvailable else { return }
    switchHost(); error = nil; busy = true
    let token = generation
    let prior = reauthenticate
    let profile =
      prior
      ?? HostProfile(
        id: UUID().uuidString, label: label.isEmpty ? username : label, endpoint: endpoint,
        relayTarget: target, username: username, lastConnected: Date())
    guard catalog.profiles.count < 20 || prior != nil else {
      busy = false; error = "You can save up to 20 hosts."; return
    }
    work = Task {
      do {
        try security.requireUnrevoked(profile)
        let persistence = SavedCredential(store: store, profile: profile, pairing: prior == nil) {
          [weak self] in self?.catalog = $0
        }
        let session = try await connections.login(
          profileId: profile.id, route: profile.nativeRoute, username: profile.username,
          password: password, storage: persistence)
        guard generation == token, !Task.isCancelled else { session.close(); return }
        do {
          try await security.ensure(profile, session: session)
          guard generation == token, !Task.isCancelled else { session.close(); return }
          try show(profile, session: session)
          adding = false; reauthenticate = nil
        } catch { session.close(); throw error }
      } catch {
        if generation == token {
          self.error =
            error is NativeSecurityFailure
            ? "This installation could not prove continuity. A revoked host must be forgotten before pairing again."
            : "Could not sign in. Check the host, username and password."
        }
      }
      if generation == token {
        if catalog.profiles.contains(where: { $0.id == profile.id }) { adding = false }
        busy = false; work = nil
      }
    }
  }
  func open(_ profile: HostProfile, pushSessionID: String? = nil) {
    guard catalogAvailable else { return }
    if profile.forgetting == true { forget(profile); return }
    switchHost(); error = nil; busy = true
    let token = generation
    work = Task {
      do {
        try security.requireUnrevoked(profile)
        guard let credential = try store.credential(profile.id) else {
          reauthenticate = profile; busy = false; return
        }
        let session = try await connections.acquire(
          profileId: profile.id, routes: [profile.nativeRoute], username: profile.username,
          credential: credential,
          storage: SavedCredential(store: store, profile: profile))
        guard generation == token, !Task.isCancelled else { session.close(); return }
        do {
          try await security.ensure(profile, session: session)
          guard generation == token, !Task.isCancelled else { session.close(); return }
          if let pushSessionID,
            let route = try await notifications.destination(
              profile.id, sessionID: pushSessionID, session: session, security: security)
          {
            try store.write("route." + profile.id, Data(route.utf8))
          }
          guard generation == token, !Task.isCancelled else { session.close(); return }
          try show(profile, session: session)
        } catch { session.close(); throw error }
        reauthenticate = nil
      } catch {
        guard generation == token else { return }
        if case CoreError.ReauthenticationRequired = error {
          try? store.forgetCredential(profile.id); reauthenticate = profile
          self.error = "This host requires you to sign in again."
        } else if case NativeSecurityFailure.revoked = error {
          self.error = "This installation was revoked. Forget this host before pairing again."
        } else {
          self.error = "Could not connect. Your saved host is still available."
        }
      }
      if generation == token { busy = false; work = nil }
    }
  }
  private func show(_ profile: HostProfile, session: NativeSourceLease) throws {
    guard let root = Bundle.main.url(forResource: "web", withExtension: nil) else {
      throw BridgeFailure.closed
    }
    let saved = try store.read("route." + profile.id).flatMap { String(data: $0, encoding: .utf8) }
    let route =
      saved.flatMap { $0.utf8.count <= 4096 && $0.hasPrefix("/") && !$0.hasPrefix("//") ? $0 : nil }
      ?? "/"
    guard let url = URL(string: BundledAssets.origin + route), url.scheme == BundledAssets.scheme,
      url.host == BundledAssets.host
    else { throw BridgeFailure.invalidCommand }
    let source = RustSource(profile: profile, session: session)
    source.checkIn = { [security] in try await security.ensure(profile, session: session) }
    let bridge = NativeBridge(source: source)
    bridge.reauthenticationRequired = { [weak self] revoked in
      guard let self else { return }
      self.switchHost(); try? self.store.forgetCredential(profile.id)
      if revoked {
        self.error = "This installation was revoked. Forget this host before pairing again."
      } else {
        self.reauthenticate = profile; self.error = "This host requires you to sign in again."
      }
    }
    bridge.routeChanged = { [store] route in
      try? store.write("route." + profile.id, Data(route.utf8))
    }
    bridge.switchHost = { [weak self] in self?.switchHost() }
    bridge.notificationStatus = { [weak self] in await self?.notifications.status() ?? [:] }
    bridge.requestPermission = { [weak self] in await self?.notifications.requestPermission() ?? [:]
    }
    let view = bridge.makeWebView(root: root)
    self.bridge = bridge; webView = view
    view.load(URLRequest(url: url))
  }
  func forget(_ profile: HostProfile, anyway: Bool = false) {
    guard catalogAvailable else { return }
    switchHost(); error = nil; forgetAnyway = nil; busy = true
    let token = generation
    work = Task {
      do {
        if !anyway, profile.forgetting != true {
          guard let credential = try store.credential(profile.id) else {
            throw BridgeFailure.closed
          }
          let session = try await connections.acquire(
            profileId: profile.id, routes: [profile.nativeRoute], username: profile.username,
            credential: credential,
            storage: SavedCredential(store: store, profile: profile))
          defer { session.close() }
          try await security.revoke(profile, session: session)
        }
        guard generation == token, !Task.isCancelled else { return }
        // The durable tombstone retains a visible retry owner until every local
        // cleanup succeeds; it also prevents resuming a partially removed host.
        connections.retireProfile(profileId: profile.id)
        catalog = try store.markForRemoval(profile.id)
        try? await notifications.forget(profile.id)
        try store.delete("route." + profile.id)
        if let id = UUID(uuidString: profile.id) {
          try await withCheckedThrowingContinuation { (done: CheckedContinuation<Void, Error>) in
            WKWebsiteDataStore.remove(forIdentifier: id) { error in
              if let error { done.resume(throwing: error) } else { done.resume() }
            }
          }
        }
        try security.forget(profile)
        catalog = try store.remove(profile.id)
        if reauthenticate?.id == profile.id { reauthenticate = nil }
      } catch {
        if generation == token {
          self.error =
            "Could not finish removing this host. Retry, or forget locally without confirming server revocation."
          if profile.forgetting != true { forgetAnyway = profile }
        }
      }
      if generation == token { busy = false; work = nil }
    }
  }
  enum PushAction { case enable, disable, test }
  func pushEnabled(_ profile: HostProfile) -> Bool { notifications.enabled(profile.id) }
  func push(_ profile: HostProfile, action: PushAction) {
    guard catalogAvailable, !busy else { return }
    error = nil; busy = true
    let token = generation
    work = Task {
      do {
        try security.requireUnrevoked(profile)
        if action == .disable {
          // Broker revocation also works when the YA host cannot be reached.
          try notifications.retire(profile.id)
          try await notifications.forget(profile.id)
          if generation == token { busy = false; work = nil; objectWillChange.send() }
          return
        }
        guard let credential = try store.credential(profile.id) else {
          reauthenticate = profile; throw BridgeFailure.closed
        }
        let session = try await connections.acquire(
          profileId: profile.id, routes: [profile.nativeRoute], username: profile.username,
          credential: credential, storage: SavedCredential(store: store, profile: profile))
        defer { session.close() }
        try await security.ensure(profile, session: session)
        guard generation == token, !Task.isCancelled else { return }
        switch action {
        case .enable:
          try await notifications.enable(
            profile, clientID: security.pushClientID(profile), session: session, security: security)
        case .disable:
          try await notifications.disable(profile, session: session, security: security)
        case .test: try await notifications.test(profile, session: session, security: security)
        }
      } catch {
        guard generation == token else { return }
        if case NativePushFailure.updateRequired = error {
          self.error = "Update this YA server to enable native notifications."
        } else {
          self.error =
            "Could not update notifications. Check notification permission and your connection, then retry."
        }
      }
      if generation == token { busy = false; work = nil; objectWillChange.send() }
    }
  }
  func background() {
    let profile = webView == nil ? nil : catalog.profiles.first { $0.id == catalog.selected }
    // Flush React's existing draft owner before discarding its document.
    // Closing native transport is immediate; pending source operations stop.
    bridge?.close(); notifications.background()
    connections.shutdown(); connections = NativeRuntime()
    let view = webView
    let token = generation
    work?.cancel(); work = nil; busy = false
    suspendedProfile = profile
    Task { [weak self] in
      _ = try? await view?.evaluateJavaScript("window.dispatchEvent(new Event('pagehide'))")
      guard let self, self.generation == token else { return }
      self.bridge = nil; self.webView = nil
    }
  }
  func start() { guard !started else { return }; started = true; foreground() }
  func foreground() {
    notifications.foreground()
    if !catalogAvailable {
      do { catalog = try store.catalog(); catalogAvailable = true; error = nil } catch { return }
    }
    if let profile = suspendedProfile {
      suspendedProfile = nil; open(profile)
    } else if started, webView == nil, !busy, error == nil, let id = catalog.selected,
      let profile = catalog.profiles.first(where: { $0.id == id })
    {
      open(profile)
    }
  }
}
