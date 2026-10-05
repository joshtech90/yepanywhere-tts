import Foundation

struct BrokerInstallation: Codable {
  let installationId: String
  let installationSecret: String
  var token: String
  var brokerUrl: String = "https://push.yepanywhere.com"
}
struct BrokerSubscription { let subscriptionId: String; let sendSecret: String }

final class PushBroker {
  static func validOpaqueID(_ id: String) -> Bool {
    id.utf8.count == 22
      && id.utf8.allSatisfy {
        (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45
          || $0 == 95
      }
  }
  static func validSecret(_ secret: String) -> Bool {
    secret.utf8.count == 43
      && secret.utf8.allSatisfy {
        (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45
          || $0 == 95
      }
  }
  private let endpoint: URL
  private let session: URLSession
  var origin: String {
    endpoint.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
  }
  init(
    endpoint: URL = URL(string: "https://push.yepanywhere.com/")!,
    session: URLSession = URLSession(configuration: .ephemeral)
  ) {
    self.endpoint = endpoint; self.session = session
  }
  private func request(
    _ method: String, _ path: String, secret: String?, token: String?, body: Data? = nil
  )
    async throws -> (Int, Data)
  {
    guard endpoint.scheme == "https", endpoint.user == nil, endpoint.password == nil,
      endpoint.query == nil, endpoint.fragment == nil, endpoint.host != nil,
      endpoint.path.isEmpty || endpoint.path == "/"
    else { throw BridgeFailure.invalidCommand }
    var request = URLRequest(url: endpoint.appendingPathComponent(path))
    request.httpMethod = method; request.timeoutInterval = 10
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
    if let secret { request.setValue("Bearer " + secret, forHTTPHeaderField: "Authorization") }
    if let token {
      guard !token.isEmpty, token.utf8.count <= 4096 else { throw BridgeFailure.invalidCommand }
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try JSONSerialization.data(withJSONObject: [
        "target": ["provider": "fcm", "kind": "registration_token", "value": token]
      ])
    }
    if let body {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type");
      request.httpBody = body
    }
    // Reject redirection so a management capability cannot cross origins.
    let delegate = NoBrokerRedirects()
    let (bytes, response) = try await session.bytes(for: request, delegate: delegate)
    guard let response = response as? HTTPURLResponse else { throw BridgeFailure.closed }
    var body = Data()
    for try await byte in bytes {
      guard body.count < 8192 else { throw BridgeFailure.overflow }
      body.append(byte)
    }
    return (response.statusCode, body)
  }
  func create(token: String) async throws -> BrokerInstallation {
    let (status, data) = try await request("POST", "v1/installations", secret: nil, token: token)
    guard status == 201, let v = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      let id = v["installationId"] as? String, Self.validOpaqueID(id),
      let secret = v["installationSecret"] as? String, Self.validSecret(secret)
    else { throw BridgeFailure.invalidCommand }
    return BrokerInstallation(
      installationId: id, installationSecret: secret, token: token, brokerUrl: origin)
  }
  func replace(_ installation: BrokerInstallation, token: String) async throws -> Bool {
    guard Self.validOpaqueID(installation.installationId),
      Self.validSecret(installation.installationSecret), installation.brokerUrl == origin
    else { throw BridgeFailure.invalidCommand }
    let (status, _) = try await request(
      "PUT", "v1/installations/\(installation.installationId)/target",
      secret: installation.installationSecret, token: token)
    if status == 404 { return false }
    guard status == 204 else { throw BridgeFailure.closed }
    return true
  }
  func delete(_ installation: BrokerInstallation) async {
    guard Self.validOpaqueID(installation.installationId),
      Self.validSecret(installation.installationSecret), installation.brokerUrl == origin
    else { return }
    _ = try? await request(
      "DELETE", "v1/installations/\(installation.installationId)",
      secret: installation.installationSecret, token: nil)
  }
  func subscribe(_ installation: BrokerInstallation) async throws -> BrokerSubscription {
    guard installation.brokerUrl == origin, Self.validOpaqueID(installation.installationId),
      Self.validSecret(installation.installationSecret)
    else { throw BridgeFailure.invalidCommand }
    let (status, data) = try await request(
      "POST", "v1/installations/\(installation.installationId)/subscriptions",
      secret: installation.installationSecret, token: nil, body: Data("{}".utf8))
    guard status == 201, let value = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      value.count == 2,
      let id = value["subscriptionId"] as? String, Self.validOpaqueID(id),
      let secret = value["sendSecret"] as? String, Self.validSecret(secret)
    else { throw BridgeFailure.closed }
    return BrokerSubscription(subscriptionId: id, sendSecret: secret)
  }
  func unsubscribe(_ installation: BrokerInstallation, subscriptionId: String) async throws {
    guard installation.brokerUrl == origin, Self.validOpaqueID(installation.installationId),
      Self.validSecret(installation.installationSecret), Self.validOpaqueID(subscriptionId)
    else { throw BridgeFailure.invalidCommand }
    let (status, _) = try await request(
      "DELETE", "v1/installations/\(installation.installationId)/subscriptions/\(subscriptionId)",
      secret: installation.installationSecret, token: nil)
    guard status == 204 || status == 404 else { throw BridgeFailure.closed }
  }
}
private final class NoBrokerRedirects: NSObject, URLSessionTaskDelegate {
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) { completionHandler(nil) }
}
