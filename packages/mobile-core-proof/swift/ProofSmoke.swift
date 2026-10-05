import Foundation

@main struct ProofSmoke {
    static func main() throws {
        let repo = CommandLine.arguments[1]
        let core = CommandLine.arguments[2]
        let paths = [
            "\(repo)/packages/android/app/src/sharedTest/resources/ya-secure-interop-v1.json",
            "\(core)/test-vectors/minimal-public-unicode.json",
            "\(core)/test-vectors/minimal-m1.json",
        ]
        for path in paths {
            let fixture = try String(contentsOfFile: path, encoding: .utf8)
            let report = try verifyInteropFixture(fixtureJson: fixture)
            precondition(report.vectorChecks.count == 27 && report.rejectionChecks.count == 17)
            precondition(report.sodiumVersion == "1.0.22")
            var object = try JSONSerialization.jsonObject(with: Data(fixture.utf8)) as! [String: Any]
            var srp = object["srp"] as! [String: Any]
            srp["M2"] = "00"
            object["srp"] = srp
            let wrong = String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
            do {
                _ = try verifyInteropFixture(fixtureJson: wrong)
                preconditionFailure("Corrupt proof accepted")
            } catch ProofError.Mismatch { }
            print("Swift: \(URL(fileURLWithPath: path).lastPathComponent): 27 vectors, 17 rejections; bad M2 rejected")
        }
        do {
            _ = try verifyInteropFixture(fixtureJson: "{")
            preconditionFailure("Malformed JSON accepted")
        } catch ProofError.InvalidInput { }
    }
}
