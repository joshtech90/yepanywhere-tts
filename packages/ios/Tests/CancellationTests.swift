import CryptoKit
import Foundation
import Network
import XCTest
@testable import YepAnywhere

// An owned peer completes only the WebSocket upgrade, receives the native
// authentication message, then withholds its reply. EOF proves that cancelling
// Swift also drops the Rust socket, rather than merely discarding its result.
private final class BlackholePeer: @unchecked Sendable {
  let received = XCTestExpectation(description: "Native authentication frame")
  let closed = XCTestExpectation(description: "Cancelled native socket closed")
  private let listener: NWListener
  private let queue = DispatchQueue(label: "ya.native-cancellation-peer")
  private var connection: NWConnection?
  private var header = Data()
  private var upgraded = false
  private var sawFrame = false
  private var sawClose = false
  init() throws { listener = try NWListener(using: .tcp, on: .any) }
  func start() async throws -> String {
    let port = try await withCheckedThrowingContinuation {
      (ready: CheckedContinuation<UInt16, Error>) in
      listener.stateUpdateHandler = { [listener] state in
        switch state {
        case .ready:
          listener.stateUpdateHandler = nil; ready.resume(returning: listener.port!.rawValue)
        case .failed(let error): listener.stateUpdateHandler = nil; ready.resume(throwing: error)
        default: break
        }
      }
      listener.newConnectionHandler = { [weak self] connection in
        guard let self else { connection.cancel(); return }
        self.connection = connection; connection.start(queue: self.queue); self.read(connection)
      }
      listener.start(queue: queue)
    }
    return "ws://127.0.0.1:\(port)/api/ws"
  }
  private func read(_ connection: NWConnection) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) {
      [weak self] bytes, _, eof, error in
      guard let self else { return }
      if let bytes, !bytes.isEmpty {
        if !self.upgraded {
          self.header.append(bytes)
          let header = String(decoding: self.header, as: UTF8.self)
          if header.contains("\r\n\r\n"),
            let field = header.components(separatedBy: "\r\n").first(where: {
              $0.lowercased().hasPrefix("sec-websocket-key:")
            })
          {
            let key = field.split(separator: ":", maxSplits: 1)[1].trimmingCharacters(
              in: .whitespaces)
            let accept = Data(
              Insecure.SHA1.hash(data: Data((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").utf8))
            ).base64EncodedString()
            self.upgraded = true
            connection.send(
              content: Data(
                "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: \(accept)\r\n\r\n"
                  .utf8), completion: .contentProcessed { _ in })
          }
        } else if !self.sawFrame {
          self.sawFrame = true; self.received.fulfill()
        }
      }
      if eof || error != nil {
        if !self.sawClose { self.sawClose = true; self.closed.fulfill() }
        connection.cancel()
      } else {
        self.read(connection)
      }
    }
  }
  func stop() { listener.cancel(); queue.async { self.connection?.cancel() } }
}

@MainActor
final class CancellationTests: XCTestCase {
  func testCancellingBlackholedLoginAndStoredResumeClosesRustSocket() async throws {
    for resume in [false, true] {
      let peer = try BlackholePeer(); let endpoint = try await peer.start()
      defer { peer.stop() }
      let profile = HostProfile(
        id: UUID().uuidString, label: "Cancellation", endpoint: endpoint,
        username: "fixture-owner", lastConnected: Date())
      let backend = MemoryProtectedStore(); let store = HostStore(backend: backend)
      let credential = try JSONSerialization.data(withJSONObject: [
        "username": profile.username,
        "session_id": "public-fixture-session", "base_key": Array(repeating: 7, count: 32),
        "resume_protocol_version": 3,
      ])
      if resume { _ = try store.pair(profile, credential) }
      let task = Task {
        if resume {
          return try await nativeResumeStored(
            options: profile.options, credential: credential,
            storage: SavedCredential(store: store, profile: profile))
        }
        return try await nativeLoginStored(
          options: profile.options, password: "public-fixture-password",
          storage: SavedCredential(store: store, profile: profile, pairing: true))
      }
      await fulfillment(of: [peer.received], timeout: 5)
      let start = ContinuousClock.now; task.cancel()
      do {
        let session = try await task.value; session.close();
        XCTFail("Cancelled native future returned a session")
      } catch is CancellationError {}
      await fulfillment(of: [peer.closed], timeout: 0.5)
      XCTAssertLessThan(start.duration(to: .now), .milliseconds(500))
      if resume {
        XCTAssertEqual(
          try JSONSerialization.jsonObject(with: XCTUnwrap(store.credential(profile.id)))
            as? NSDictionary,
          try JSONSerialization.jsonObject(with: credential) as? NSDictionary,
          "Cancellation before any authenticated proof can safely retain the existing pin")
      } else {
        XCTAssertNil(try store.credential(profile.id))
      }
      XCTAssertEqual(try store.catalog().profiles.count, resume ? 1 : 0)
    }
  }
}
