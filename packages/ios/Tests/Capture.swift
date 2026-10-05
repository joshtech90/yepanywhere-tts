import WebKit
@testable import YepAnywhere

extension WKWebView {
  func capturedImage() async throws -> UIImage {
    try await withCheckedThrowingContinuation { continuation in
      takeSnapshot(with: nil) { image, error in
        if let error {
          continuation.resume(throwing: error)
        } else if let image {
          continuation.resume(returning: image)
        } else {
          continuation.resume(throwing: BridgeFailure.closed)
        }
      }
    }
  }
}
