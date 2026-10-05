import Foundation
import XCTest
import YAProof

final class CryptoProofTests: XCTestCase {
    func testProductionAndEncodingEdgeVectors() throws {
        for name in ["ya-secure-interop-v1", "minimal-public-unicode", "minimal-m1"] {
            let url = try XCTUnwrap(Bundle.main.url(forResource: name, withExtension: "json"))
            let fixture = try String(contentsOf: url, encoding: .utf8)
            let report = try verifyInteropFixture(fixtureJson: fixture)
            XCTAssertEqual(report.vectorChecks.count, 27)
            XCTAssertEqual(report.rejectionChecks.count, 17)
            XCTAssertEqual(report.sodiumVersion, "1.0.22")
            var object = try JSONSerialization.jsonObject(with: Data(fixture.utf8)) as! [String: Any]
            var srp = object["srp"] as! [String: Any]
            srp["M2"] = "00"
            object["srp"] = srp
            let wrong = String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
            XCTAssertThrowsError(try verifyInteropFixture(fixtureJson: wrong)) { error in
                guard case ProofError.Mismatch(let check) = error else { return XCTFail("Incorrect error type") }
                XCTAssertEqual(check, "M2")
            }
        }
    }

    func testMalformedInputAcrossBindings() {
        XCTAssertThrowsError(try verifyInteropFixture(fixtureJson: "{")) { error in
            guard case ProofError.InvalidInput = error else { return XCTFail("Incorrect error type") }
        }
    }
}
