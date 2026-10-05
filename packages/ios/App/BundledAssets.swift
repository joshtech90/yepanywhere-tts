import Foundation
import WebKit

final class BundledAssets: NSObject, WKURLSchemeHandler {
  static let scheme = "yepapp"
  static let host = "bundle"
  static let origin = "yepapp://bundle"
  let root: URL

  init(root: URL) { self.root = root.standardizedFileURL.resolvingSymlinksInPath() }

  func resource(_ url: URL) throws -> (Data, String) {
    guard url.scheme == Self.scheme, url.host == Self.host,
      url.user == nil, url.password == nil, url.port == nil
    else { throw BridgeFailure.staleDocument }
    let path = url.path.removingPercentEncoding ?? url.path
    guard !path.split(separator: "/").contains(".."), !path.contains("\0") else {
      throw BridgeFailure.invalidCommand
    }
    var file = root.appendingPathComponent(
      (path.isEmpty || path == "/") ? "remote.html" : String(path.dropFirst())
    ).standardizedFileURL.resolvingSymlinksInPath()
    guard file.path.hasPrefix(root.path + "/") else { throw BridgeFailure.invalidCommand }
    if !FileManager.default.fileExists(atPath: file.path),
      !(path.split(separator: "/").last?.contains(".") ?? false)
    {
      file = root.appendingPathComponent("remote.html")
    }
    let mime = [
      "html": "text/html", "js": "application/javascript", "css": "text/css",
      "json": "application/json", "svg": "image/svg+xml", "png": "image/png", "jpg": "image/jpeg",
      "woff2": "font/woff2", "wasm": "application/wasm", "mp4": "video/mp4", "webm": "video/webm",
      "ico": "image/x-icon", "wav": "audio/wav", "mp3": "audio/mpeg", "m4a": "audio/mp4",
    ]
    var bytes = try Data(contentsOf: file)
    guard bytes.count <= NativeFrame.messageLimit else { throw BridgeFailure.overflow }
    if file.lastPathComponent == "remote.html" {
      guard let html = String(data: bytes, encoding: .utf8) else {
        throw BridgeFailure.invalidCommand
      }
      // A same-origin child could call functions on its parent window.
      // Disallow embedding documents in the privileged app altogether.
      let policy =
        "<meta http-equiv=\"Content-Security-Policy\" content=\"frame-src 'none'; object-src 'none'; base-uri 'none'\">"
      guard html.components(separatedBy: "<head>").count == 2 else {
        throw BridgeFailure.invalidCommand
      }
      bytes = Data(html.replacingOccurrences(of: "<head>", with: "<head>" + policy).utf8)
    }
    return (bytes, mime[file.pathExtension] ?? "application/octet-stream")
  }

  func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
    do {
      guard let url = urlSchemeTask.request.url else { throw BridgeFailure.invalidCommand }
      let (bytes, mime) = try resource(url)
      urlSchemeTask.didReceive(
        URLResponse(
          url: url, mimeType: mime, expectedContentLength: bytes.count,
          textEncodingName: mime.hasPrefix("text/") ? "utf-8" : nil))
      urlSchemeTask.didReceive(bytes)
      urlSchemeTask.didFinish()
    } catch { urlSchemeTask.didFailWithError(error) }
  }
  func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}
