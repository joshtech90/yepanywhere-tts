import AppIntents
import SwiftUI
import WebKit

@main
struct YepAnywhereApp: App {
  @UIApplicationDelegateAdaptor(PushAppDelegate.self) private var appDelegate
  @StateObject private var hosts: HostModel
  @Environment(\.scenePhase) private var phase
  init() {
    #if DEBUG
      let qa = ProcessInfo.processInfo.arguments.contains("-qa-input-metrics")
      let store = HostStore(
        service: qa ? "com.yepanywhere.ios.acceptance" : "com.yepanywhere.ios.hosts.v1")
      if qa && ProcessInfo.processInfo.arguments.contains("-qa-reset-hosts") {
        try? store.delete("hosts-state.v1")
      }
      _hosts = StateObject(wrappedValue: HostModel(store: store))
    #else
      _hosts = StateObject(wrappedValue: HostModel())
    #endif
  }
  var body: some Scene {
    WindowGroup {
      HostScreen(hosts: hosts).task { hosts.start() }.onReceive(
        NotificationCenter.default.publisher(
          for: UIApplication.protectedDataDidBecomeAvailableNotification)
      ) { _ in hosts.foreground() }.onChange(of: phase) { _, phase in
        if phase == .background {
          hosts.background()
        } else if phase == .active {
          hosts.foreground()
        }
      }
    }
  }
}
private struct WebScreen: UIViewRepresentable {
  let view: WKWebView
  func makeUIView(context: Context) -> WKWebView { view }
  func updateUIView(_ uiView: WKWebView, context: Context) {}
}
private struct HostScreen: View {
  @ObservedObject var hosts: HostModel
  var body: some View {
    if let web = hosts.webView {
      WebScreen(view: web).ignoresSafeArea(.container, edges: .bottom)
    } else {
      NavigationStack {
        List {
          if let error = hosts.error {
            Text(error).foregroundStyle(.red).accessibilityIdentifier("host-error")
          }
          if hosts.busy { ProgressView("Connecting…") }
          if hosts.reauthenticate != nil || hosts.adding || hosts.catalog.profiles.isEmpty {
            LoginForm(hosts: hosts, profile: hosts.reauthenticate).id(
              hosts.reauthenticate?.id ?? "new")
          } else {
            Section("Saved hosts") {
              ForEach(hosts.catalog.profiles) { profile in
                Button {
                  hosts.open(profile)
                } label: {
                  VStack(alignment: .leading) {
                    Text(
                      profile.label + (profile.forgetting == true ? " (removal incomplete)" : ""));
                    Text(profile.username).font(.caption).foregroundStyle(.secondary)
                  }.frame(minHeight: 44)
                }.disabled(hosts.busy || !hosts.catalogAvailable)
                  .swipeActions { Button("Forget", role: .destructive) { hosts.forget(profile) } }
                HStack {
                  Button(
                    hosts.pushEnabled(profile) ? "Disable notifications" : "Enable notifications"
                  ) {
                    hosts.push(profile, action: hosts.pushEnabled(profile) ? .disable : .enable)
                  }.accessibilityIdentifier("host-push-" + profile.id)
                  if hosts.pushEnabled(profile) {
                    Button("Send test") { hosts.push(profile, action: .test) }
                  }
                }.buttonStyle(.borderless).disabled(hosts.busy || profile.forgetting == true)
              }
            }
            Button("Add host") { hosts.adding = true }.accessibilityIdentifier("host-add")
          }
        }.navigationTitle("Yep Anywhere")
          .confirmationDialog(
            "Server revocation could not be confirmed",
            isPresented: Binding(
              get: { hosts.forgetAnyway != nil }, set: { if !$0 { hosts.forgetAnyway = nil } }
            )
          ) {
            if let profile = hosts.forgetAnyway {
              Button("Forget anyway", role: .destructive) { hosts.forget(profile, anyway: true) }
            }
            Button("Cancel", role: .cancel) { hosts.forgetAnyway = nil }
          } message: {
            Text(
              "This removes local keys and drafts. The server may still list this installation; revoke it from Security settings on another device."
            )
          }
          .toolbar {
            if hosts.busy {
              Button("Cancel") { hosts.switchHost() }
            } else if hosts.adding || hosts.reauthenticate != nil {
              Button("Cancel") {
                hosts.adding = false; hosts.reauthenticate = nil; hosts.error = nil
              }
            }
          }
      }
    }
  }
}
private struct LoginForm: View {
  @ObservedObject var hosts: HostModel
  let profile: HostProfile?
  @State private var label = ""
  @State private var endpoint = ""
  @State private var relay = false
  @State private var username = ""
  @State private var password = ""
  var body: some View {
    Section(profile == nil ? "Connect to your Yep Anywhere server" : "Sign in again") {
      if profile == nil {
        TextField("Host name", text: $label).accessibilityIdentifier("host-label")
        Toggle("Connect through relay", isOn: $relay).onChange(of: relay) { _, relay in
          endpoint = relay ? "wss://relay.yepanywhere.com/ws" : ""
        }
        TextField(relay ? "Relay WebSocket URL" : "Server URL", text: $endpoint)
          .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
          .accessibilityIdentifier("host-url")
        TextField("Username", text: $username).textContentType(.username)
          .textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier(
            "host-username")
      } else if let profile {
        Text(profile.label + (profile.forgetting == true ? " (removal incomplete)" : ""));
        Text(profile.username).foregroundStyle(.secondary)
      }
      SecureField("Password", text: $password).textContentType(.password).accessibilityIdentifier(
        "host-password")
      Button("Sign in") {
        let secret = password; password = ""
        guard let url = normalizedEndpoint() else {
          hosts.error = "Enter a valid server URL."; return
        }
        let user = profile?.username ?? username.trimmingCharacters(in: .whitespacesAndNewlines)
        hosts.login(
          label: label, endpoint: url, target: relay ? user : nil, username: user, password: secret)
      }.accessibilityIdentifier("host-sign-in")
        .disabled(
          hosts.busy || password.isEmpty
            || (profile == nil && (username.isEmpty || endpoint.isEmpty)))
    }.disabled(hosts.busy || !hosts.catalogAvailable)
  }
  private func normalizedEndpoint() -> String? {
    if let profile { return profile.endpoint }
    guard var url = URLComponents(string: endpoint.trimmingCharacters(in: .whitespacesAndNewlines)),
      let scheme = url.scheme,
      ["http", "https", "ws", "wss"].contains(scheme), url.host != nil, url.user == nil,
      url.password == nil, url.fragment == nil
    else { return nil }
    if scheme == "http" || scheme == "https" {
      url.scheme = scheme == "https" ? "wss" : "ws"
      if url.path.isEmpty || url.path == "/" { url.path = relay ? "/ws" : "/api/ws" }
    }
    return url.string
  }
}
