import FirebaseCore
import FirebaseMessaging
import Foundation
import UIKit
import UserNotifications

struct NativePushRoute: Codable {
  let profileID: String
  let clientID: String
  let installationID: String
  let subscriptionID: String
  var enabled: Bool
}
private struct NativePushRoutes: Codable { let brokerUrl: String; var rows: [NativePushRoute] }
enum NativePushFailure: Error { case updateRequired, unavailable, operationPending }

@MainActor
final class NativeNotifications: NSObject, UNUserNotificationCenterDelegate {
  var openHost: (String, String?) -> Void = { _, _ in }
  var knownHost: (String) -> Bool = { _ in false }
  var currentClientID: (String) -> String? = { _ in nil }
  private var enrollmentBusy = false
  private var cleanupWork: Task<Void, Never>?
  private let permissionRequest: (() async -> Bool)?
  private let store: HostStore
  private let broker: PushBroker
  private var observer: NSObjectProtocol?
  private var active = true
  private var registerAgain = false
  private var work: Task<Void, Never>?
  private var installationWait: (id: UUID, continuation: CheckedContinuation<Void, Never>)?
  private var installationDeadline: Task<Void, Never>?
  init(
    store: HostStore = HostStore(service: "com.yepanywhere.ios.push.v1"),
    broker: PushBroker = PushBroker(),
    permissionRequest: (() async -> Bool)? = nil
  ) {
    self.store = store; self.broker = broker; self.permissionRequest = permissionRequest
    super.init()
    UNUserNotificationCenter.current().delegate = self
    observer = NotificationCenter.default.addObserver(
      forName: .yaPushToken, object: nil, queue: .main
    ) { [weak self] note in
      guard let token = note.object as? String else { return }
      Task { @MainActor [weak self] in self?.receiveToken(token) }
    }
  }
  deinit {
    if let observer { NotificationCenter.default.removeObserver(observer) }; work?.cancel();
    cleanupWork?.cancel(); installationDeadline?.cancel()
  }
  private func installation() -> BrokerInstallation? {
    guard let data = try? store.read("installation"), data.count <= 8192 else { return nil }
    guard let value = try? JSONDecoder().decode(BrokerInstallation.self, from: data),
      PushBroker.validOpaqueID(value.installationId),
      PushBroker.validSecret(value.installationSecret), value.brokerUrl == broker.origin
    else { return nil }
    return value
  }
  private func pendingToken() -> String? {
    guard let data = try? store.read("token"), data.count <= 4096 else { return nil }
    return String(data: data, encoding: .utf8)
  }
  private func finishInstallationWait(id: UUID? = nil) {
    guard let wait = installationWait, id == nil || wait.id == id else { return }
    installationWait = nil; installationDeadline?.cancel(); installationDeadline = nil
    wait.continuation.resume()
  }
  private func registeredInstallation() async -> BrokerInstallation? {
    guard active, !Task.isCancelled else { return nil }
    if let record = installation() { return record }
    let id = UUID()
    await withTaskCancellationHandler {
      await withCheckedContinuation { continuation in
        installationWait = (id, continuation)
        // First permission can return before APNs/FCM and broker registration.
        // One event-driven wait per serialized enrollment; no polling/retries.
        installationDeadline = Task { [weak self] in
          do { try await Task.sleep(for: .seconds(15)) } catch { return }
          self?.finishInstallationWait(id: id)
        }
        register()
      }
    } onCancel: {
      Task { @MainActor [weak self] in self?.finishInstallationWait(id: id) }
    }
    guard active, !Task.isCancelled else { return nil }
    return installation()
  }
  func receiveToken(_ token: String) {
    guard !token.isEmpty, token.utf8.count <= 4096 else { return }
    do { try store.write("token", Data(token.utf8)); register() } catch { return }
  }
  private func register() {
    guard active else { return }
    guard work == nil else { registerAgain = true; return }
    work = Task { [weak self] in
      guard let self else { return }
      defer {
        self.work = nil
        if self.registerAgain, self.active { self.registerAgain = false; self.register() }
      }
      // Rotation is serialized. Persist every returned management secret
      // before processing a newer token; callbacks cannot orphan it.
      for _ in 0..<3 {
        guard !Task.isCancelled, let token = pendingToken() else { return }
        do {
          var record: BrokerInstallation
          if let prior = installation() {
            if prior.token == token { finishInstallationWait(); return }
            if try await broker.replace(prior, token: token) {
              record = prior; record.token = token
            } else {
              record = try await broker.create(token: token)
            }
          } else {
            record = try await broker.create(token: token)
          }
          do { try store.write("installation", JSONEncoder().encode(record)) } catch {
            finishInstallationWait(); await broker.delete(record); return
          }
          finishInstallationWait()
          if pendingToken() == token { return }
        } catch { finishInstallationWait(); return }
      }
    }
  }
  func status() async -> [String: Any] {
    let settings = await UNUserNotificationCenter.current().notificationSettings()
    let permission: String
    switch settings.authorizationStatus {
    case .authorized, .provisional, .ephemeral: permission = "granted"
    case .denied: permission = "denied"
    default: permission = "not_requested"
    }
    let configured = FirebaseApp.allApps?.isEmpty == false && FirebaseApp.app() != nil
    let record = installation()
    let state =
      !configured
      ? "unavailable"
      : record == nil
        ? "not_registered" : record?.token == pendingToken() ? "ready" : "update_pending"
    let hasEnrollment = (try? routes().contains { enabled($0.profileID) }) ?? false
    return [
      "firebase": configured ? "configured" : "unavailable", "permission": permission,
      "channel": "not_supported", "installation": state,
      "notificationsEnabled": permission == "granted" && hasEnrollment,
    ]
  }
  private func routes() throws -> [NativePushRoute] {
    guard let data = try store.read("routes.v1") else { return [] }
    guard data.count <= 32768 else { throw BridgeFailure.overflow }
    let value = try JSONDecoder().decode(NativePushRoutes.self, from: data)
    guard value.brokerUrl == broker.origin, value.rows.count <= 20,
      Set(value.rows.map(\.profileID)).count == value.rows.count,
      Set(value.rows.map(\.subscriptionID)).count == value.rows.count,
      value.rows.allSatisfy({
        UUID(uuidString: $0.profileID) != nil && UUID(uuidString: $0.clientID) != nil
          && PushBroker.validOpaqueID($0.installationID)
          && PushBroker.validOpaqueID($0.subscriptionID)
      })
    else { throw BridgeFailure.invalidCommand }
    return value.rows
  }
  private func put(_ route: NativePushRoute) throws {
    let rows = try routes().filter { $0.profileID != route.profileID } + [route]
    guard rows.count <= 20 else { throw BridgeFailure.overflow }
    try store.write(
      "routes.v1", JSONEncoder().encode(NativePushRoutes(brokerUrl: broker.origin, rows: rows)))
  }
  private func remove(_ profileID: String) throws {
    try store.write(
      "routes.v1",
      JSONEncoder().encode(
        NativePushRoutes(
          brokerUrl: broker.origin, rows: try routes().filter { $0.profileID != profileID })))
  }
  func enabled(_ profileID: String) -> Bool {
    guard let route = try? routes().first(where: { $0.profileID == profileID }), route.enabled
    else { return false }
    return knownHost(profileID) && currentClientID(profileID) == route.clientID
      && installation()?.installationId == route.installationID
  }
  func retire(_ profileID: String) throws {
    guard var route = try routes().first(where: { $0.profileID == profileID }) else { return }
    route.enabled = false; try put(route)
  }
  func enable(
    _ profile: HostProfile, clientID: String, session: any NativeAuthenticatedSession,
    security: SecurityClientCoordinator
  ) async throws {
    guard !enrollmentBusy else { throw NativePushFailure.operationPending }
    enrollmentBusy = true; defer { enrollmentBusy = false }
    let version = try await security.request(session, "GET", "/api/version")
    guard
      (version.body["capabilities"] as? [String])?.contains("native-push-subscriptions-v1") == true,
      let info = version.body["nativePush"] as? [String: Any], info["protocolVersion"] as? Int == 1,
      let endpoint = info["brokerUrl"] as? String,
      endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/")) == broker.origin
    else { throw NativePushFailure.updateRequired }
    let granted: Bool
    if let permissionRequest {
      granted = await permissionRequest()
    } else {
      granted = await requestPermission()["permission"] as? String == "granted"
    }
    guard granted, let installation = await registeredInstallation() else {
      throw NativePushFailure.unavailable
    }
    if enabled(profile.id) { return }
    if let prior = try routes().first(where: { $0.profileID == profile.id }) {
      try await cleanup(prior)
    }
    let subscription = try await broker.subscribe(installation)
    let pending = NativePushRoute(
      profileID: profile.id, clientID: clientID, installationID: installation.installationId,
      subscriptionID: subscription.subscriptionId, enabled: false)
    do {
      try put(pending)
      let response = try await security.request(
        session, "PUT", "/api/security/clients/\(clientID)/native-push-subscription",
        [
          "subscriptionId": subscription.subscriptionId, "sendSecret": subscription.sendSecret,
          "privacyMode": "generic",
        ])
      guard response.status == 200, !Task.isCancelled, knownHost(profile.id),
        self.installation()?.installationId == installation.installationId
      else { throw BridgeFailure.closed }
      guard try security.pushClientID(profile) == clientID else { throw BridgeFailure.closed }
      var ready = pending; ready.enabled = true; try put(ready)
    } catch {
      do { try await cleanup(pending) } catch {
        try? await broker.unsubscribe(installation, subscriptionId: subscription.subscriptionId)
      }
      throw error
    }
  }
  func disable(
    _ profile: HostProfile, session: any NativeAuthenticatedSession,
    security: SecurityClientCoordinator
  ) async throws {
    guard !enrollmentBusy else { throw NativePushFailure.operationPending }
    enrollmentBusy = true; defer { enrollmentBusy = false }
    guard var route = try routes().first(where: { $0.profileID == profile.id }) else { return }
    route.enabled = false; try put(route)
    let response = try? await security.request(
      session, "DELETE", "/api/security/clients/\(route.clientID)/native-push-subscription")
    do { try await cleanup(route) } catch { if response?.status != 200 { throw error } }
  }
  func test(
    _ profile: HostProfile, session: any NativeAuthenticatedSession,
    security: SecurityClientCoordinator
  ) async throws {
    guard !enrollmentBusy else { throw NativePushFailure.operationPending }
    enrollmentBusy = true; defer { enrollmentBusy = false }
    guard enabled(profile.id), let route = try routes().first(where: { $0.profileID == profile.id })
    else { throw NativePushFailure.unavailable }
    let response = try await security.request(
      session, "POST", "/api/security/clients/\(route.clientID)/native-push-subscription/test")
    if ["native_push_invalid_subscription", "native_push_not_enrolled"].contains(
      response.body["code"] as? String ?? "")
    {
      try await cleanup(route)
    }
    guard response.status == 202 else { throw BridgeFailure.closed }
  }
  private func cleanup(_ route: NativePushRoute) async throws {
    var retired = route; retired.enabled = false; try put(retired)
    if let current = installation(), current.installationId == route.installationID {
      try await broker.unsubscribe(current, subscriptionId: route.subscriptionID)
    }
    try remove(route.profileID)
  }
  func forget(_ profileID: String) async throws {
    guard let route = try routes().first(where: { $0.profileID == profileID }) else { return }
    try await cleanup(route)
  }
  func destination(
    _ profileID: String, sessionID: String?, session: any NativeAuthenticatedSession,
    security: SecurityClientCoordinator
  ) async throws -> String? {
    guard let id = sessionID,
      id.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil,
      let route = try routes().first(where: { $0.profileID == profileID }), enabled(profileID)
    else { return nil }
    let response = try await security.request(
      session, "GET",
      "/api/security/clients/\(route.clientID)/native-push-subscription/destination?sessionId=\(id)"
    )
    guard response.status == 200, let path = response.body["path"] as? String,
      path.range(
        of: "^/projects/[A-Za-z0-9_-]{1,2048}/sessions/[A-Za-z0-9_-]{1,128}$",
        options: .regularExpression) != nil
    else { return nil }
    return path
  }
  func requestPermission() async -> [String: Any] {
    let allowed =
      (try? await UNUserNotificationCenter.current().requestAuthorization(options: [
        .alert, .badge, .sound,
      ])) ?? false
    if allowed, FirebaseApp.allApps?.isEmpty == false && FirebaseApp.app() != nil {
      Messaging.messaging().isAutoInitEnabled = true
      UIApplication.shared.registerForRemoteNotifications()
      register()
    }
    return await status()
  }
  func background() {
    active = false; finishInstallationWait(); work?.cancel(); cleanupWork?.cancel()
  }
  func foreground() {
    active = true;
    if cleanupWork == nil, !enrollmentBusy {
      enrollmentBusy = true
      cleanupWork = Task { [weak self] in
        guard let self else { return }
        defer { self.enrollmentBusy = false; self.cleanupWork = nil }
        // At most four attempts per visible lifecycle trigger; no retry timer.
        for route in ((try? self.routes()) ?? []).filter({
          !$0.enabled || !self.knownHost($0.profileID)
            || self.currentClientID($0.profileID) != $0.clientID
        }).prefix(4) {
          guard !Task.isCancelled else { return }
          try? await self.cleanup(route)
        }
      }
    }
    if FirebaseApp.allApps?.isEmpty == false && FirebaseApp.app() != nil { register() }
  }
  func hostForPush(_ info: [AnyHashable: Any]) -> String? {
    let intents = ["approval_required", "input_required", "session_completed", "session_failed"]
    guard let intent = info["intent"] as? String, intents.contains(intent),
      let subscription = info["subscriptionId"] as? String, PushBroker.validOpaqueID(subscription),
      let route = try? routes().first(where: { $0.subscriptionID == subscription }),
      enabled(route.profileID)
    else { return nil }
    return route.profileID
  }
  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
  ) async {
    let info = response.notification.request.content.userInfo
    guard let intent = info["intent"] as? String,
      let subscription = info["subscriptionId"] as? String
    else { return }
    let sessionID = info["sessionId"] as? String
    await MainActor.run {
      // Native saved bindings select the host. Payload URLs and host ids
      // never select credentials or navigation; resume precedes opening.
      if let id = hostForPush(["intent": intent, "subscriptionId": subscription]) {
        openHost(id, sessionID)
      }
    }
  }
  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    let info = notification.request.content.userInfo
    guard let intent = info["intent"] as? String,
      let subscription = info["subscriptionId"] as? String
    else { return [] }
    let isTest = info["test"] as? String == "true"
    return await MainActor.run {
      guard hostForPush(["intent": intent, "subscriptionId": subscription]) != nil,
        !active || isTest
      else { return [] }
      return [.banner, .list, .sound]
    }
  }
}
