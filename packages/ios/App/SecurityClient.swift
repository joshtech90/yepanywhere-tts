import CoreFoundation
import CryptoKit
import Foundation
import Security
import UIKit

struct SecurityClientBinding: Codable {
  var requestID: String
  var clientID: String?
  var revoked = false
}
enum NativeSecurityFailure: Error { case revoked, invalidProof }

@MainActor
final class SecurityClientCoordinator {
  private let store: HostStore
  private struct VerifiedTransport {
    let sessionID: String
    let nonce: String
    let clientID: String
  }
  private var verified: [String: VerifiedTransport] = [:]
  init(store: HostStore) { self.store = store }
  private func account(_ profile: HostProfile) -> String { "security." + profile.id }
  private func binding(_ profile: HostProfile) throws -> SecurityClientBinding {
    if let bytes = try store.read(account(profile)) {
      guard bytes.count < 4096 else { throw BridgeFailure.overflow }
      let value = try JSONDecoder().decode(SecurityClientBinding.self, from: bytes)
      guard UUID(uuidString: value.requestID) != nil,
        value.clientID == nil || UUID(uuidString: value.clientID!) != nil
      else { throw BridgeFailure.invalidCommand }
      return value
    }
    let value = SecurityClientBinding(requestID: UUID().uuidString)
    try save(value, profile); return value
  }
  private func save(_ value: SecurityClientBinding, _ profile: HostProfile) throws {
    try store.write(account(profile), JSONEncoder().encode(value))
  }
  private func installationID() throws -> String {
    if let data = try store.read("security-installation"),
      let id = String(data: data, encoding: .utf8), UUID(uuidString: id) != nil
    {
      return id
    }
    let id = UUID().uuidString; try store.write("security-installation", Data(id.utf8)); return id
  }
  func requireUnrevoked(_ profile: HostProfile) throws {
    guard let bytes = try store.read(account(profile)) else { return }
    guard bytes.count < 4096 else { throw BridgeFailure.overflow }
    if try JSONDecoder().decode(SecurityClientBinding.self, from: bytes).revoked {
      try store.forgetCredential(profile.id); try ContinuityKey.delete(profileID: profile.id)
      throw NativeSecurityFailure.revoked
    }
  }
  func ensure(_ profile: HostProfile, session: any NativeAuthenticatedSession) async throws {
    try requireUnrevoked(profile)
    var binding = try binding(profile)
    guard !binding.revoked else { throw NativeSecurityFailure.revoked }
    let transport = try session.securityBinding()
    if let known = verified[profile.id], known.sessionID == transport.sessionId,
      known.nonce == transport.transportNonce, known.clientID == binding.clientID
    {
      return
    }
    let version = try await request(session, "GET", "/api/version")
    guard version.status == 200 else { throw BridgeFailure.closed }
    guard (version.body["capabilities"] as? [String])?.contains("security-client-audit-v1") == true
    else { return }
    let key = try ContinuityKey(profileID: profile.id)
    let publicKey = try key.publicSPKI()
    let descriptor: [String: Any] = [
      "installationId": try installationID(),
      "deviceClass": UIDevice.current.userInterfaceIdiom == .pad ? "tablet" : "phone",
      "deviceName": UIDevice.current.name, "appName": "Yep Anywhere",
      "appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0",
      "appBuild": Int(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1") ?? 1,
      "locale": Locale.current.identifier, "languages": Array(Locale.preferredLanguages.prefix(16)),
      "timeZone": TimeZone.current.identifier,
      "supportedProofs": ["continuity-key", "platform-keystore"], "manufacturer": "Apple",
      "model": UIDevice.current.model,
      "systemName": UIDevice.current.userInterfaceIdiom == .pad ? "iPadOS" : "iOS",
      "osVersion": UIDevice.current.systemVersion,
      "packageName": Bundle.main.bundleIdentifier ?? "com.yepanywhere.ios",
    ]
    for _ in 0..<2 {
      let register = binding.clientID == nil
      let route =
        register
        ? "/api/security/clients/register" : "/api/security/clients/\(binding.clientID!)/check-in"
      var body: [String: Any] = ["descriptorVersion": 1, "descriptor": descriptor]
      if register {
        body["requestId"] = binding.requestID; body["label"] = profile.label;
        body["kind"] = "ios-native"
        body["key"] = [
          "protocol": "client-key-p256-v1", "publicKeySpki": publicKey.base64URL,
          "reportedStorage": "ios-keychain",
        ]
      }
      let digest = Data(SHA256.hash(data: try Self.canonical(body)))
      let parts = [
        Data("yep-security-client-key-v1".utf8), Data((register ? "register" : "check-in").utf8),
        Data(route.utf8), Data(transport.sessionId.utf8), Data(transport.transportNonce.utf8),
        Data((binding.clientID ?? binding.requestID).utf8), digest,
      ]
      var transcript = Data()
      for part in parts {
        var size = UInt32(part.count).bigEndian
        transcript.append(Data(bytes: &size, count: 4)); transcript.append(part)
      }
      let signature = try key.sign(transcript).base64URL
      if register {
        var k = body["key"] as! [String: Any]; k["signature"] = signature; body["key"] = k
      } else {
        body["signature"] = signature
      }
      let response = try await request(session, "POST", route, body)
      if response.body["code"] as? String == "security_client_revoked" {
        binding.revoked = true; try save(binding, profile)
        try store.forgetCredential(profile.id); try key.delete()
        throw NativeSecurityFailure.revoked
      }
      if !register, response.body["code"] as? String == "security_client_unknown" {
        binding.clientID = nil; binding.requestID = UUID().uuidString; try save(binding, profile);
        continue
      }
      guard (200..<300).contains(response.status),
        let client = response.body["client"] as? [String: Any],
        let id = client["clientId"] as? String, UUID(uuidString: id) != nil,
        let proofs = client["proofs"] as? [[String: Any]],
        let continuity = proofs.first(where: { $0["type"] as? String == "continuity-key" }),
        continuity["keyFingerprint"] as? String == Data(SHA256.hash(data: publicKey)).base64URL
      else { throw NativeSecurityFailure.invalidProof }
      binding.clientID = id; try save(binding, profile)
      // A new document can reuse an already-proven transport. Registration
      // followed by check-in on that same nonce is a different server proof.
      verified[profile.id] = VerifiedTransport(
        sessionID: transport.sessionId,
        nonce: transport.transportNonce, clientID: id)
      return
    }
    throw NativeSecurityFailure.invalidProof
  }
  func request(
    _ session: any NativeAuthenticatedSession, _ method: String, _ path: String,
    _ body: [String: Any]? = nil
  ) async throws -> (status: Int, body: [String: Any]) {
    var params: [String: Any] = [
      "method": method, "path": path,
      "headers": ["Content-Type": "application/json", "X-Yep-Anywhere": "true"],
    ]
    if let body { params["body"] = body }
    let text = String(decoding: try JSONSerialization.data(withJSONObject: params), as: UTF8.self)
    let response = try await session.dispatch(method: "request", params: text)
    guard let value = try JSONSerialization.jsonObject(with: Data(response.utf8)) as? [String: Any],
      let status = value["status"] as? Int
    else { throw BridgeFailure.invalidCommand }
    return (status, value["body"] as? [String: Any] ?? [:])
  }
  static func canonical(_ value: Any) throws -> Data {
    if let object = value as? [String: Any] {
      let fields = try object.keys.sorted { $0.utf16.lexicographicallyPrecedes($1.utf16) }.map {
        key in
        String(decoding: try canonical(key), as: UTF8.self) + ":"
          + String(decoding: try canonical(object[key]!), as: UTF8.self)
      }
      return Data(("{" + fields.joined(separator: ",") + "}").utf8)
    }
    if let array = value as? [Any] {
      return Data(
        ("["
          + (try array.map { String(decoding: try canonical($0), as: UTF8.self) }).joined(
            separator: ",") + "]").utf8)
    }
    return try JSONSerialization.data(
      withJSONObject: value, options: [.fragmentsAllowed, .withoutEscapingSlashes])
  }
  func revoke(_ profile: HostProfile, session: any NativeAuthenticatedSession) async throws {
    var value = try binding(profile)
    if value.revoked { return }
    // Recover an accepted registration whose response was lost using its
    // durable request id/key before attempting owner-authorized revocation.
    if value.clientID == nil {
      try await ensure(profile, session: session); value = try binding(profile)
    }
    guard let id = value.clientID else { return }  // Older server has no audit capability.
    let response = try await request(session, "DELETE", "/api/security/clients/" + id)
    guard (200..<300).contains(response.status) || response.status == 404 else {
      throw BridgeFailure.closed
    }
    value.revoked = true; try save(value, profile)
  }
  func forget(_ profile: HostProfile) throws {
    verified.removeValue(forKey: profile.id)
    try store.delete(account(profile)); try ContinuityKey.delete(profileID: profile.id)
  }
  func pushClientID(_ profile: HostProfile) throws -> String {
    try requireUnrevoked(profile)
    guard let id = try binding(profile).clientID else { throw BridgeFailure.invalidCommand }
    return id
  }
}

final class ContinuityKey {
  private let key: SecKey
  private let profileID: String
  private static func query(_ id: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassKey, kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrApplicationTag as String: Data(("com.yepanywhere.ios.continuity." + id).utf8),
    ]
  }
  init(profileID: String) throws {
    guard UUID(uuidString: profileID) != nil else { throw BridgeFailure.invalidCommand }
    self.profileID = profileID
    var q = Self.query(profileID); q[kSecReturnRef as String] = true
    var result: CFTypeRef?
    let status = SecItemCopyMatching(q as CFDictionary, &result)
    if status == errSecSuccess, let result { key = (result as! SecKey); return }
    guard status == errSecItemNotFound else { throw KeychainFailure(status: status) }
    let attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: 256,
      kSecPrivateKeyAttrs as String: [
        kSecAttrIsPermanent as String: true,
        kSecAttrApplicationTag as String: Self.query(profileID)[kSecAttrApplicationTag as String]!,
        kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
      ],
    ]
    var failure: Unmanaged<CFError>?
    guard let created = SecKeyCreateRandomKey(attributes as CFDictionary, &failure) else {
      throw BridgeFailure.closed
    }
    key = created
  }
  func publicSPKI() throws -> Data {
    guard let publicKey = SecKeyCopyPublicKey(key),
      let representation = SecKeyCopyExternalRepresentation(publicKey, nil) as Data?,
      representation.count == 65, representation.first == 4
    else { throw BridgeFailure.closed }
    // DER SubjectPublicKeyInfo header for id-ecPublicKey + prime256v1.
    var spki = Data([
      0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08,
      0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
    ])
    spki.append(representation); return spki
  }
  func sign(_ transcript: Data) throws -> Data {
    guard
      let signature = SecKeyCreateSignature(
        key, .ecdsaSignatureMessageX962SHA256, transcript as CFData, nil) as Data?
    else { throw BridgeFailure.closed }
    return signature
  }
  func delete() throws { try Self.delete(profileID: profileID) }
  static func delete(profileID: String) throws {
    let status = SecItemDelete(query(profileID) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw KeychainFailure(status: status)
    }
  }
}
extension Data {
  var base64URL: String {
    base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(
      of: "/", with: "_"
    ).replacingOccurrences(of: "=", with: "")
  }
}
