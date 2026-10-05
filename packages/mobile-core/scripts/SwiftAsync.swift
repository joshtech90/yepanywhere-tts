// UniFFI 0.32.2 exposes rust_future_cancel but its Swift template does not
// call it. Keep this narrow, version-checked generated-binding adapter until
// upstream Swift cancellation is available. The gate prevents cancel/free races.
private final class NativeFutureLifetime: @unchecked Sendable {
  private let lock = NSLock()
  private var handle: UInt64?
  private let cancelFunc: (UInt64) -> Void
  private let freeFunc: (UInt64) -> Void
  init(_ handle: UInt64, cancel: @escaping (UInt64) -> Void, free: @escaping (UInt64) -> Void) {
    self.handle = handle; self.cancelFunc = cancel; self.freeFunc = free
  }
  func cancel() {
    lock.lock(); defer { lock.unlock() }
    if let handle { cancelFunc(handle) }
  }
  func free() {
    lock.lock()
    let owned = handle; handle = nil
    lock.unlock()
    // Dropping a Rust future can invoke foreign storage callbacks. Do not
    // hold the gate while a callback dispatches to the main actor.
    if let owned { freeFunc(owned) }
  }
}
fileprivate func uniffiRustCallAsync<F, T>(
  rustFutureFunc: () -> UInt64,
  pollFunc: (UInt64, @escaping UniffiRustFutureContinuationCallback, UInt64) -> (),
  completeFunc: (UInt64, UnsafeMutablePointer<RustCallStatus>) -> F,
  cancelFunc: @escaping (UInt64) -> (),
  freeFunc: @escaping (UInt64) -> (),
  liftFunc: (F) throws -> T,
  errorHandler: ((RustBuffer) throws -> Swift.Error)?
) async throws -> T {
  try Task.checkCancellation()
  uniffiEnsureYaMobileCoreInitialized()
  let rustFuture = rustFutureFunc()
  let lifetime = NativeFutureLifetime(rustFuture, cancel: cancelFunc, free: freeFunc)
  defer { lifetime.free() }
  return try await withTaskCancellationHandler {
    var pollResult: Int8
    repeat {
      pollResult = await withUnsafeContinuation {
        pollFunc(
          rustFuture,
          { handle, result in
            uniffiFutureContinuationCallback(handle: handle, pollResult: result)
          }, uniffiContinuationHandleMap.insert(obj: $0))
      }
    } while pollResult != UNIFFI_RUST_FUTURE_POLL_READY
    try Task.checkCancellation()
    return try liftFunc(
      makeRustCall(
        { completeFunc(rustFuture, $0) }, errorHandler: errorHandler
      ))
  } onCancel: {
    lifetime.cancel()
  }
}
