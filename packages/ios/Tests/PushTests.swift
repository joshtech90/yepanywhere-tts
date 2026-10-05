import AppIntents
import XCTest
@testable import YepAnywhere

private final class BrokerProtocol: URLProtocol {
  static var responseCode = 201
  static var responseBody = Data()
  static var installationBody: Data?
  static var requests: [URLRequest] = []
  override class func canInit(with request: URLRequest) -> Bool {
    request.url?.host == "fixture.invalid"
  }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    Self.requests.append(request)
    let response = HTTPURLResponse(
      url: request.url!, statusCode: Self.responseCode, httpVersion: nil,
      headerFields: ["Content-Type": "application/json"])!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    let body = request.url?.path == "/v1/installations" ? Self.installationBody : nil
    client?.urlProtocol(self, didLoad: body ?? Self.responseBody)
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}
private final class PushFixtureSession: NativeAuthenticatedSession {
  var supportsPush = true
  var putStatus = 200
  var paths: [String] = []
  func dispatch(method: String, params: String) async throws -> String {
    let request = try JSONSerialization.jsonObject(with: Data(params.utf8)) as! [String: Any]
    let path = request["path"] as! String; paths.append(path)
    let body: [String: Any]
    var status = 200
    if path == "/api/version" {
      body = [
        "capabilities": supportsPush ? ["native-push-subscriptions-v1"] : [],
        "nativePush": ["protocolVersion": 1, "brokerUrl": "https://fixture.invalid"],
      ]
    } else {
      body = [:]
      if request["method"] as? String == "PUT" {
        status = putStatus; BrokerProtocol.responseCode = 204; BrokerProtocol.responseBody = Data()
      }
    }
    return String(
      decoding: try JSONSerialization.data(withJSONObject: ["status": status, "body": body]),
      as: UTF8.self)
  }
  func uploadChunk(payload: Data) async throws { throw BridgeFailure.closed }
  func nextEvent() async throws -> String { throw BridgeFailure.closed }
  func securityBinding() throws -> NativeSecurityBinding { throw BridgeFailure.closed }
  func close() {}
}
@MainActor
final class PushTests: XCTestCase {
  private func broker() -> PushBroker {
    BrokerProtocol.requests = []
    BrokerProtocol.installationBody = nil
    let configuration = URLSessionConfiguration.ephemeral;
    configuration.protocolClasses = [BrokerProtocol.self]
    return PushBroker(
      endpoint: URL(string: "https://fixture.invalid/")!,
      session: URLSession(configuration: configuration))
  }
  func testInstallationAndRotationKeepManagementCapabilityNative() async throws {
    let broker = broker()
    let id = String(repeating: "a", count: 22); let secret = String(repeating: "b", count: 43)
    BrokerProtocol.responseCode = 201;
    BrokerProtocol.responseBody = try JSONSerialization.data(withJSONObject: [
      "installationId": id, "installationSecret": secret,
    ])
    let record = try await broker.create(token: "public-fixture-fcm-token")
    XCTAssertEqual(record.installationId, id)
    XCTAssertNil(BrokerProtocol.requests[0].value(forHTTPHeaderField: "Authorization"))
    BrokerProtocol.responseCode = 204; BrokerProtocol.responseBody = Data()
    let replaced = try await broker.replace(record, token: "public-new-fixture-token")
    XCTAssertTrue(replaced)
    XCTAssertEqual(
      BrokerProtocol.requests.last?.value(forHTTPHeaderField: "Authorization"), "Bearer " + secret)
    XCTAssertFalse(BrokerProtocol.requests.last!.url!.absoluteString.contains(secret))
    BrokerProtocol.responseCode = 404
    let missing = try await broker.replace(record, token: "public-fixture-token")
    XCTAssertFalse(missing)
  }
  func testBrokerRejectsOversizeAndMalformedManagementRecords() async throws {
    let broker = broker(); BrokerProtocol.responseCode = 201
    for data in [
      Data(repeating: 32, count: 8193),
      Data("{\"installationId\":\"../../host\",\"installationSecret\":\"invalid\"}".utf8),
    ] {
      BrokerProtocol.responseBody = data
      do {
        _ = try await broker.create(token: "fixture-token");
        XCTFail("Hostile broker response accepted")
      } catch {}
    }
    let invalid = BrokerInstallation(
      installationId: "../host", installationSecret: "secret\r\nHeader: value",
      token: "fixture-token")
    do {
      _ = try await broker.replace(invalid, token: "fixture-token");
      XCTFail("Malformed persisted capability accepted")
    } catch {}
  }
  func testSubscriptionsUseOnlyInstallationManagementAndRejectCrossOrigin() async throws {
    let broker = broker()
    let installation = BrokerInstallation(
      installationId: String(repeating: "a", count: 22),
      installationSecret: String(repeating: "b", count: 43), token: "fixture",
      brokerUrl: broker.origin)
    let id = String(repeating: "c", count: 22)
    BrokerProtocol.responseCode = 201
    BrokerProtocol.responseBody = try JSONSerialization.data(withJSONObject: [
      "subscriptionId": id, "sendSecret": String(repeating: "d", count: 43),
    ])
    let child = try await broker.subscribe(installation)
    XCTAssertEqual(child.subscriptionId, id)
    XCTAssertEqual(
      BrokerProtocol.requests.last?.value(forHTTPHeaderField: "Authorization"),
      "Bearer " + installation.installationSecret)
    XCTAssertEqual(
      BrokerProtocol.requests.last?.url?.path,
      "/v1/installations/" + installation.installationId + "/subscriptions")
    BrokerProtocol.responseCode = 404
    BrokerProtocol.responseBody = Data()
    try await broker.unsubscribe(installation, subscriptionId: id)
    var changed = installation; changed.brokerUrl = "https://other.invalid"
    let count = BrokerProtocol.requests.count
    do {
      _ = try await broker.subscribe(changed); XCTFail("Cross-origin capability accepted")
    } catch {}
    XCTAssertEqual(BrokerProtocol.requests.count, count)
    for body in [
      Data(repeating: 32, count: 8193),
      Data("{\"subscriptionId\":\"../host\",\"sendSecret\":\"bad\"}".utf8),
    ] {
      BrokerProtocol.responseCode = 201; BrokerProtocol.responseBody = body
      do { _ = try await broker.subscribe(installation); XCTFail("Malformed child accepted") } catch
      {}
    }
  }
  func testSavedPushBindingsFenceHostSelectionAndRevocation() async throws {
    let broker = broker(); let backend = MemoryProtectedStore()
    let store = HostStore(backend: backend)
    let profile = UUID().uuidString; let second = UUID().uuidString
    let installation = BrokerInstallation(
      installationId: String(repeating: "a", count: 22),
      installationSecret: String(repeating: "b", count: 43), token: "fixture",
      brokerUrl: broker.origin)
    try store.write("installation", JSONEncoder().encode(installation))
    let rows = [profile, second].enumerated().map { index, id in
      [
        "profileID": id, "clientID": UUID().uuidString,
        "installationID": installation.installationId,
        "subscriptionID": String(repeating: index == 0 ? "c" : "d", count: 22), "enabled": true,
      ] as [String: Any]
    }
    try store.write(
      "routes.v1",
      JSONSerialization.data(withJSONObject: ["brokerUrl": broker.origin, "rows": rows]))
    let notifications = NativeNotifications(store: store, broker: broker)
    notifications.currentClientID = { id in
      rows.first(where: { $0["profileID"] as? String == id })?["clientID"] as? String
    }
    var known = Set([profile, second]); notifications.knownHost = { known.contains($0) }
    let payload: [AnyHashable: Any] = [
      "intent": "approval_required", "subscriptionId": String(repeating: "c", count: 22),
      "host": "https://attacker.invalid", "url": "https://attacker.invalid",
    ]
    XCTAssertEqual(notifications.hostForPush(payload), profile)
    XCTAssertNil(
      notifications.hostForPush([
        "intent": "approval_required", "subscriptionId": String(repeating: "x", count: 22),
      ]))
    known.remove(profile)
    XCTAssertNil(notifications.hostForPush(payload))
    known.insert(profile)
    BrokerProtocol.responseCode = 503; BrokerProtocol.responseBody = Data()
    do { try await notifications.forget(profile); XCTFail("Failed cleanup accepted") } catch {}
    XCTAssertFalse(notifications.enabled(profile))
    XCTAssertTrue(notifications.enabled(second))
    BrokerProtocol.responseCode = 404
    try await notifications.forget(profile)
    XCTAssertTrue(notifications.enabled(second))
    let saved = String(data: try store.read("routes.v1")!, encoding: .utf8)!
    XCTAssertFalse(saved.contains(profile));
    XCTAssertFalse(saved.contains(installation.installationSecret))
    var changed = installation; changed.brokerUrl = "https://other.invalid"
    try store.write("installation", JSONEncoder().encode(changed))
    XCTAssertFalse(notifications.enabled(second))
  }

  func testEnrollmentTransfersSendSecretAndCompensatesSourceRejection() async throws {
    for status in [200, 503] {
      let broker = broker(); let backend = MemoryProtectedStore();
      let store = HostStore(backend: backend)
      let installation = BrokerInstallation(
        installationId: String(repeating: "a", count: 22),
        installationSecret: String(repeating: "b", count: 43), token: "fixture",
        brokerUrl: broker.origin)
      try store.write("installation", JSONEncoder().encode(installation))
      let profile = HostProfile(
        id: UUID().uuidString, label: "Private fixture", endpoint: "wss://fixture.invalid/api/ws",
        username: "fixture", lastConnected: Date())
      let client = UUID().uuidString
      try store.write(
        "security." + profile.id,
        JSONEncoder().encode(SecurityClientBinding(requestID: UUID().uuidString, clientID: client)))
      let security = SecurityClientCoordinator(store: store)
      let session = PushFixtureSession(); session.putStatus = status
      let notifications = NativeNotifications(
        store: store, broker: broker, permissionRequest: { true })
      notifications.knownHost = { $0 == profile.id }
      notifications.currentClientID = { $0 == profile.id ? client : nil }
      let sendSecret = String(repeating: "s", count: 43)
      BrokerProtocol.responseCode = 201
      BrokerProtocol.responseBody = try JSONSerialization.data(withJSONObject: [
        "subscriptionId": String(repeating: "c", count: 22), "sendSecret": sendSecret,
      ])
      if status == 200 {
        try await notifications.enable(
          profile, clientID: client, session: session, security: security)
        XCTAssertTrue(notifications.enabled(profile.id))
        XCTAssertFalse(
          String(decoding: try store.read("routes.v1")!, as: UTF8.self).contains(sendSecret))
        try await notifications.disable(profile, session: session, security: security)
      } else {
        do {
          try await notifications.enable(
            profile, clientID: client, session: session, security: security);
          XCTFail("Rejected source acknowledged")
        } catch {}
      }
      XCTAssertFalse(notifications.enabled(profile.id))
      XCTAssertEqual(BrokerProtocol.requests.last?.httpMethod, "DELETE")
      XCTAssertTrue(
        session.paths.contains("/api/security/clients/" + client + "/native-push-subscription"))
    }
  }
  func testOldServerDoesNotRegisterAnySubscription() async throws {
    let broker = broker(); let store = HostStore(backend: MemoryProtectedStore())
    let notifications = NativeNotifications(
      store: store, broker: broker, permissionRequest: { true })
    let profile = HostProfile(
      id: UUID().uuidString, label: "Older", endpoint: "wss://fixture.invalid/api/ws",
      username: "fixture", lastConnected: Date())
    let session = PushFixtureSession(); session.supportsPush = false
    do {
      try await notifications.enable(
        profile, clientID: UUID().uuidString, session: session,
        security: SecurityClientCoordinator(store: store));
      XCTFail("Unsupported server enrolled")
    } catch NativePushFailure.updateRequired {} catch { XCTFail("Wrong failure: \(error)") }
    XCTAssertEqual(BrokerProtocol.requests.count, 0)
  }

  func testFirstEnrollmentWaitsForTokenAndProtectedInstallation() async throws {
    let broker = broker(); let store = HostStore(backend: MemoryProtectedStore())
    let profile = HostProfile(
      id: UUID().uuidString, label: "First enrollment", endpoint: "wss://fixture.invalid/api/ws",
      username: "fixture", lastConnected: Date())
    let client = UUID().uuidString
    try store.write(
      "security." + profile.id,
      JSONEncoder().encode(SecurityClientBinding(requestID: UUID().uuidString, clientID: client)))
    BrokerProtocol.responseCode = 201
    BrokerProtocol.installationBody = try JSONSerialization.data(withJSONObject: [
      "installationId": String(repeating: "a", count: 22),
      "installationSecret": String(repeating: "b", count: 43),
    ])
    BrokerProtocol.responseBody = try JSONSerialization.data(withJSONObject: [
      "subscriptionId": String(repeating: "c", count: 22),
      "sendSecret": String(repeating: "s", count: 43),
    ])
    weak var owner: NativeNotifications?
    let notifications = NativeNotifications(
      store: store, broker: broker,
      permissionRequest: {
        Task { @MainActor in
          await Task.yield(); owner?.receiveToken("public-first-registration-token")
        }
        return true
      })
    owner = notifications
    notifications.knownHost = { $0 == profile.id }
    notifications.currentClientID = { $0 == profile.id ? client : nil }
    try await notifications.enable(
      profile, clientID: client, session: PushFixtureSession(),
      security: SecurityClientCoordinator(store: store))
    XCTAssertTrue(notifications.enabled(profile.id))
    XCTAssertEqual(
      BrokerProtocol.requests.map { $0.url!.path },
      [
        "/v1/installations",
        "/v1/installations/" + String(repeating: "a", count: 22) + "/subscriptions",
      ])
  }

  func testBackgroundStopsFirstRegistrationWaitWithoutEnrolling() async throws {
    let broker = broker(); let store = HostStore(backend: MemoryProtectedStore())
    let permission = expectation(description: "Permission returns before registration")
    let notifications = NativeNotifications(
      store: store, broker: broker,
      permissionRequest: {
        permission.fulfill(); return true
      })
    let profile = HostProfile(
      id: UUID().uuidString, label: "Pending", endpoint: "wss://fixture.invalid/api/ws",
      username: "fixture", lastConnected: Date())
    let enrollment = Task {
      try await notifications.enable(
        profile, clientID: UUID().uuidString, session: PushFixtureSession(),
        security: SecurityClientCoordinator(store: store))
    }
    await fulfillment(of: [permission], timeout: 2)
    notifications.background()
    do {
      try await enrollment.value; XCTFail("Suspended enrollment accepted")
    } catch NativePushFailure.unavailable {} catch { XCTFail("Wrong failure: \(error)") }
    XCTAssertFalse(notifications.enabled(profile.id))
    XCTAssertEqual(BrokerProtocol.requests.count, 0)
  }

}
