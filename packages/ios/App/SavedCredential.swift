import Foundation

// UniFFI polls on both the caller and Rust runtime threads. All profile
// mutations remain serialized on the main actor, including this synchronous
// durability callback before capabilities or continuity work can proceed.
final class SavedCredential: CredentialPersistence, @unchecked Sendable {
  private let store: HostStore
  private let profile: HostProfile
  private var pairing: Bool
  private let changed: @MainActor (HostCatalog) -> Void
  init(
    store: HostStore, profile: HostProfile, pairing: Bool = false,
    changed: @escaping @MainActor (HostCatalog) -> Void = { _ in }
  ) {
    self.store = store; self.profile = profile; self.pairing = pairing; self.changed = changed
  }
  private func onMain(_ operation: @escaping @MainActor () throws -> Void) -> Bool {
    let perform = {
      MainActor.assumeIsolated { do { try operation(); return true } catch { return false } }
    }
    return Thread.isMainThread ? perform() : DispatchQueue.main.sync(execute: perform)
  }
  func beginResume() -> Bool {
    onMain {
      try SecurityClientCoordinator(store: self.store).requireUnrevoked(self.profile);
      try self.store.forgetCredential(self.profile.id)
    }
  }
  func persist(credential: Data) -> Bool {
    onMain {
      try SecurityClientCoordinator(store: self.store).requireUnrevoked(self.profile)
      if self.pairing {
        self.changed(try self.store.pair(self.profile, credential)); self.pairing = false
      } else {
        try self.store.saveCredential(self.profile.id, credential)
      }
    }
  }
}
