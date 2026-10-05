import java.io.File
import uniffi.ya_mobile_core_proof.ProofException
import uniffi.ya_mobile_core_proof.verifyInteropFixture

fun main(args: Array<String>) {
    val paths = listOf(
        File(args[0], "packages/android/app/src/sharedTest/resources/ya-secure-interop-v1.json"),
        File(args[1], "test-vectors/minimal-public-unicode.json"),
        File(args[1], "test-vectors/minimal-m1.json"),
    )
    for (path in paths) {
        val fixture = path.readText()
        val report = verifyInteropFixture(fixture)
        check(report.vectorChecks.size == 27)
        check(report.rejectionChecks.size == 17)
        check(report.sodiumVersion == "1.0.22")
        val wrong = fixture.replace(Regex("\"M2\": \"[0-9a-f]+\""), "\"M2\": \"00\"")
        try {
            verifyInteropFixture(wrong)
            error("Corrupt proof accepted")
        } catch (_: ProofException.Mismatch) { }
        println("Kotlin: ${path.name}: 27 vectors, 17 rejections; bad M2 rejected")
    }
    try {
        verifyInteropFixture("{")
        error("Malformed JSON accepted")
    } catch (_: ProofException.InvalidInput) { }
}
