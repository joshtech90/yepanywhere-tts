import AppIntents
import XCTest
import Security
@testable import YepAnywhere

final class MemoryProtectedStore: ProtectedStore {
  var items: [String: Data] = [:]
  var locked = false
  var failNextWrite = false
  var failAccount: String?
  var writesBeforeFailure = 0
  func read(_ account: String) throws -> Data? {
    if locked { throw KeychainFailure(status: errSecInteractionNotAllowed) }; return items[account]
  }
  func write(_ account: String, _ data: Data) throws {
    if account == failAccount {
      if writesBeforeFailure == 0 { throw KeychainFailure(status: errSecInteractionNotAllowed) }
      writesBeforeFailure -= 1
    }
    if locked || failNextWrite {
      failNextWrite = false; throw KeychainFailure(status: errSecInteractionNotAllowed)
    }; items[account] = data
  }
  func delete(_ account: String) throws {
    if locked { throw KeychainFailure(status: errSecInteractionNotAllowed) };
    items.removeValue(forKey: account)
  }
}

@MainActor
final class StorageTests: XCTestCase {
  private func profile() -> HostProfile {
    HostProfile(
      id: UUID().uuidString, label: "Fixture", endpoint: "ws://127.0.0.1/api/ws",
      username: "fixture-owner", lastConnected: Date())
  }
  func testPairAndForgetAreAtomicAndLockedReadCannotOverwrite() throws {
    let backend = MemoryProtectedStore(); let store = HostStore(backend: backend)
    let first = profile(); let second = profile()
    _ = try store.pair(first, Data("public-test-credential".utf8))
    backend.failNextWrite = true
    XCTAssertThrowsError(try store.pair(second, Data("another-public-fixture".utf8)))
    XCTAssertEqual(try store.catalog().profiles.map(\.id), [first.id]);
    XCTAssertNil(try store.credential(second.id))
    backend.failNextWrite = true
    XCTAssertThrowsError(try store.remove(first.id))
    XCTAssertEqual(try store.catalog().profiles.count, 1);
    XCTAssertNotNil(try store.credential(first.id))
    backend.locked = true
    XCTAssertThrowsError(try store.catalog()); XCTAssertThrowsError(try store.pair(second, Data()))
    let model = HostModel(store: store)
    XCTAssertFalse(model.catalogAvailable)
    model.login(
      label: "Fixture", endpoint: second.endpoint, target: nil, username: second.username,
      password: "fixture-password")
    XCTAssertFalse(model.busy)
    backend.locked = false; model.foreground()
    XCTAssertTrue(model.catalogAvailable);
    XCTAssertEqual(model.catalog.profiles.map(\.id), [first.id])
    model.switchHost()
    _ = try store.remove(first.id)
    XCTAssertTrue(try store.catalog().profiles.isEmpty);
    XCTAssertNil(try store.credential(first.id))
  }
  func testResumePersistenceFailureIsFailClosedAndRemovalRetainsRetryOwner() throws {
    let backend = MemoryProtectedStore(); let store = HostStore(backend: backend)
    let profile = profile(); let older = Data("public-v3-fixture".utf8);
    let newer = Data("public-v4-fixture".utf8)
    _ = try store.pair(profile, older)
    let sink = SavedCredential(store: store, profile: profile)
    XCTAssertTrue(sink.beginResume()); XCTAssertNil(try store.credential(profile.id))
    backend.failNextWrite = true
    XCTAssertFalse(sink.persist(credential: newer)); XCTAssertNil(try store.credential(profile.id))
    XCTAssertTrue(sink.persist(credential: newer));
    XCTAssertEqual(try store.credential(profile.id), newer)
    let catalog = try store.markForRemoval(profile.id)
    XCTAssertEqual(catalog.profiles.first?.forgetting, true);
    XCTAssertNil(try store.credential(profile.id))
    XCTAssertFalse(
      sink.persist(credential: newer), "Late callbacks cannot restore a removal tombstone")
    backend.failNextWrite = true
    XCTAssertThrowsError(try store.remove(profile.id))
    XCTAssertEqual(try store.catalog().profiles.first?.forgetting, true)
    _ = try store.remove(profile.id); XCTAssertTrue(try store.catalog().profiles.isEmpty)
  }
  func testPushRoutingUsesOnlyProtectedOpaqueBindings() throws {
    let backend = MemoryProtectedStore(); let store = HostStore(backend: backend)
    let profile = UUID().uuidString; let subscription = String(repeating: "a", count: 22)
    try store.write("routes", JSONEncoder().encode([subscription: profile]))
    let notifications = NativeNotifications(store: store)
    XCTAssertNil(
      notifications.hostForPush(["intent": "approval_required", "subscriptionId": subscription]),
      "Legacy unbound records cannot route a push")
    let client = UUID().uuidString
    let installation = BrokerInstallation(
      installationId: String(repeating: "i", count: 22),
      installationSecret: String(repeating: "s", count: 43), token: "fixture")
    try store.write("installation", JSONEncoder().encode(installation))
    let route = NativePushRoute(
      profileID: profile, clientID: client, installationID: installation.installationId,
      subscriptionID: subscription, enabled: true)
    let row = try JSONSerialization.jsonObject(with: JSONEncoder().encode(route))
    try store.write(
      "routes.v1",
      JSONSerialization.data(withJSONObject: ["brokerUrl": installation.brokerUrl, "rows": [row]]))
    notifications.knownHost = { $0 == profile }
    notifications.currentClientID = { $0 == profile ? client : nil }
    XCTAssertEqual(
      notifications.hostForPush([
        "intent": "approval_required", "subscriptionId": subscription,
        "url": "https://attacker.invalid", "hostId": "other",
      ]), profile)
    XCTAssertNil(
      notifications.hostForPush(["intent": "launch_url", "subscriptionId": subscription]))
    XCTAssertNil(
      notifications.hostForPush([
        "intent": "approval_required", "subscriptionId": String(repeating: "b", count: 22),
      ]))
    backend.locked = true
    XCTAssertNil(
      notifications.hostForPush(["intent": "approval_required", "subscriptionId": subscription]))
  }
  func testCanonicalSecurityPayloadMatchesJavaScriptOrdering() throws {
    let value: [String: Any] = ["z": ["β": "😀", "a": "a/b"], "a": [true, 1, NSNull()]]
    XCTAssertEqual(
      String(decoding: try SecurityClientCoordinator.canonical(value), as: UTF8.self),
      "{\"a\":[true,1,null],\"z\":{\"a\":\"a/b\",\"β\":\"😀\"}}")
  }
}
