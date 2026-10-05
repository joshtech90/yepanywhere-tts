import Foundation
import XCTest
@testable import YepAnywhere

@MainActor
final class TLSTests: XCTestCase {
  func testPlatformTrustAuthenticatesWSSAndRejectsHostExpiryAndUntrustedRoot() async throws {
    let file = try XCTUnwrap(
      Bundle(for: Self.self).url(forResource: "fixture", withExtension: "json"))
    let fixture = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as! [String: Any]
    let tls = try XCTUnwrap(fixture["tls"] as? [String: String])
    let options = SessionOptions(
      endpoint: try XCTUnwrap(tls["trusted"]), relayTarget: nil, username: "ios-fixture")
    let session = try await nativeLogin(options: options, password: "native-fixture-password")
    defer { session.close() }
    let projects = try await session.dispatch(
      method: "request", params: "{\"method\":\"GET\",\"path\":\"/api/projects\"}")
    XCTAssertTrue(projects.contains("200")); session.close()
    for mode in ["wrongHost", "untrusted", "expired"] {
      do {
        let source = try await nativeLogin(
          options: SessionOptions(
            endpoint: try XCTUnwrap(tls[mode]),
            relayTarget: nil, username: "ios-fixture"), password: "native-fixture-password")
        source.close(); XCTFail("Platform TLS accepted \(mode)")
      } catch CoreError.Unavailable {}
    }
    let (bytes, _) = try await URLSession.shared.data(from: XCTUnwrap(URL(string: tls["status"]!)))
    let upgrades = try JSONSerialization.jsonObject(with: bytes) as! [String: Int]
    XCTAssertEqual(upgrades["trusted"], 1)
    for mode in ["wrongHost", "untrusted", "expired"] {
      XCTAssertEqual(
        upgrades[mode], 0,
        "Invalid TLS must fail before a WebSocket upgrade or authentication message")
    }
  }
}
