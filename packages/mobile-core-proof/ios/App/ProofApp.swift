import SwiftUI
// Xcode 26 extracts intent metadata for app targets. An explicit system
// framework dependency lets its empty test-host metadata pass without warnings.
import AppIntents

// Test host only. This is not the YA consumer application's UI or bundle ID.
@main struct ProofApp: App {
    var body: some Scene { WindowGroup { EmptyView() } }
}
