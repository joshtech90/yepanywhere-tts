package com.yepanywhere.mobile.web

import org.junit.Assert.*
import org.junit.Test

class PackagedArtifactRequestTest {
    private val viewer = "0123456789abcdef0123456789abcdef"
    private val origin = "https://artifact-$viewer.yepanywhere.com"
    private val query = "?viewer=$viewer&parent=https%3A%2F%2Fappassets.androidplatform.net"
    private fun route(url: String, method: String = "GET", main: Boolean = false) = PackagedArtifactRequest.route(url, method, main)

    @Test fun servesOnlyTheFixedShellForTheMatchingViewerAndBundledParent() {
        for (method in listOf("GET", "HEAD")) {
            assertEquals(200, route("$origin/__ya/1/bootstrap.html$query", method)?.status)
            for (name in listOf("bootstrap.js", "worker.js", "frame.js"))
                assertEquals(name, route("$origin/__ya/1/$name", method)?.asset)
        }
        for (url in listOf("$origin/__ya/1/bootstrap.html", "$origin/__ya/1/bootstrap.html${query.replace(viewer, "f".repeat(32))}",
            "$origin/__ya/1/bootstrap.html${query.replace("appassets.androidplatform.net", "evil.example")}",
            "$origin/__ya/1/bootstrap.html$query&parent=x")) assertEquals(400, route(url)?.status)
    }
    @Test fun deniesReservedOriginFallbackAndLeavesOtherOriginsAlone() {
        for (path in listOf("/v/$viewer/a.html", "/api/version", "/__ya/2/worker.js", "/__ya/1/../frame.js", "/__ya/1/%66rame.js", "/__ya/1/frame.js?other=1"))
            assertEquals(404, route(origin + path)?.status)
        assertEquals(403, route("$origin/__ya/1/worker.js", main = true)?.status)
        assertEquals(403, route("$origin/__ya/1/worker.js", method = "POST")?.status)
        assertEquals(403, route("${origin.replace("https:", "http:")}/__ya/1/worker.js")?.status)
        assertEquals(403, route("$origin:444/__ya/1/worker.js")?.status)
        assertEquals(403, route("${origin.replace("https://", "https://user@")}/__ya/1/worker.js")?.status)
        for (url in listOf("https://appassets.androidplatform.net/index.html", "https://custom.example/worker.js", "https://artifact-$viewer.yepanywhere.com.evil.example/worker.js")) assertNull(route(url))
    }
}
