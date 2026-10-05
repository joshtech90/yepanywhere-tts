import Foundation

@MainActor
final class RustSource: NativeSource {
  let profileID: String
  let label: String
  let session: any NativeAuthenticatedSession
  var checkIn: () async throws -> Void = {}
  init(profile: HostProfile, session: any NativeAuthenticatedSession) {
    profileID = profile.id; label = profile.label; self.session = session
  }
  func dispatch(method: String, params: Data) async throws -> Data {
    guard let text = String(data: params, encoding: .utf8) else {
      throw BridgeFailure.invalidCommand
    }
    return Data(try await session.dispatch(method: method, params: text).utf8)
  }
  func upload(_ payload: Data) async throws { try await session.uploadChunk(payload: payload) }
  func nextEvent() async throws -> Data {
    let bytes = Data(try await session.nextEvent().utf8)
    let event = try JSONSerialization.jsonObject(with: bytes) as? [String: Any]
    if event?["type"] as? String == "state" {
      if event?["phase"] as? String == "CONNECTED" { try await checkIn() }
      if event?["phase"] as? String == "REAUTHENTICATION_REQUIRED" {
        throw CoreError.ReauthenticationRequired
      }
    }
    return bytes
  }
  func close() { session.close() }
}
