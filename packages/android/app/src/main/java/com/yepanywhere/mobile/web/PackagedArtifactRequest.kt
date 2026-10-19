package com.yepanywhere.mobile.web

import java.net.URI
import java.net.URLDecoder

/** Fixed shell routing only. No file grants, paths or network fetching. */
internal object PackagedArtifactRequest {
    const val PARENT = "https://appassets.androidplatform.net"
    val ASSETS = setOf("bootstrap.html", "bootstrap.js", "worker.js", "frame.js")
    private val host = Regex("artifact-[a-f0-9]{32}\\.yepanywhere\\.com")
    data class Route(val asset: String? = null, val status: Int = 404)

    fun route(raw: String, method: String, mainFrame: Boolean): Route? {
        val url = runCatching { URI(raw) }.getOrNull() ?: return null
        val hostname = url.host?.lowercase() ?: return null
        if (!host.matches(hostname)) return null
        if (url.scheme != "https" || url.port !in setOf(-1, 443) ||
            url.rawUserInfo != null || mainFrame || method !in setOf("GET", "HEAD")) return Route(status = 403)
        val name = url.rawPath.removePrefix("/__ya/1/")
        if (url.rawPath != "/__ya/1/$name" || name !in ASSETS) return Route()
        if (name == "bootstrap.html") {
            val pairs = runCatching {
                url.rawQuery.orEmpty().split('&').map { pair ->
                    val parts = pair.split('=', limit = 2)
                    require(parts.size == 2)
                    URLDecoder.decode(parts[0], "UTF-8") to URLDecoder.decode(parts[1], "UTF-8")
                }
            }.getOrNull() ?: return Route(status = 400)
            val query = pairs.toMap()
            if (pairs.size != 2 || query.keys != setOf("viewer", "parent") ||
                query["parent"] != PARENT || query["viewer"] != hostname.removePrefix("artifact-").removeSuffix(".yepanywhere.com")) return Route(status = 400)
        } else if (url.rawQuery != null) return Route()
        return Route(name, 200)
    }
}
