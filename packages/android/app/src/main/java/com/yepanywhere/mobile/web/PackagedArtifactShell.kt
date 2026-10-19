package com.yepanywhere.mobile.web

import android.content.Context
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import androidx.webkit.ServiceWorkerClientCompat
import androidx.webkit.ServiceWorkerControllerCompat
import androidx.webkit.WebViewFeature
import java.io.ByteArrayInputStream
import org.json.JSONObject

/** Application-owned fixed bytes. Holds no Activity, credentials or file bridge. */
class PackagedArtifactShell private constructor(private val assets: Map<String, Asset>) {
    private data class Asset(val bytes: ByteArray, val headers: Map<String, String>)
    val version: Int get() = 1

    fun intercept(request: WebResourceRequest): WebResourceResponse? {
        val route = PackagedArtifactRequest.route(request.url.toString(), request.method, request.isForMainFrame) ?: return null
        val asset = assets[route.asset]
        val headers = (asset ?: assets.getValue("bootstrap.html")).headers +
            mapOf("cache-control" to "no-store", "x-ya-packaged-shell" to "1")
        val mime = if (route.asset == "bootstrap.html") "text/html" else if (asset != null) "text/javascript" else "text/plain"
        val bytes = if (request.method == "HEAD" || route.status != 200) byteArrayOf() else checkNotNull(asset).bytes
        return WebResourceResponse(mime, "utf-8", route.status,
            if (route.status == 200) "OK" else "Denied", headers, ByteArrayInputStream(bytes))
    }

    companion object {
        /** Called once by Application before any WebView can create a worker. */
        fun install(context: Context): PackagedArtifactShell? {
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_BASIC_USAGE) ||
                !WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_SHOULD_INTERCEPT_REQUEST)) return null
            val shell = runCatching {
                val resources = context.applicationContext.assets
                val manifest = resources.open("artifact-shell/manifest.json").bufferedReader().use { JSONObject(it.readText()) }
                require(manifest.getInt("version") == 1)
                val entries = manifest.getJSONObject("assets")
                require(entries.keys().asSequence().toSet() == PackagedArtifactRequest.ASSETS)
                PackagedArtifactShell(PackagedArtifactRequest.ASSETS.associateWith { name ->
                    val bytes = resources.open("artifact-shell/$name").use { it.readBytes() }
                    require(bytes.size in 1..512 * 1024)
                    val headers = entries.getJSONObject(name)
                    Asset(bytes, headers.keys().asSequence().associateWith { headers.getString(it) })
                })
            }.getOrNull() ?: return null // Hosted-only APKs have no bundled shell.
            ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(object : ServiceWorkerClientCompat() {
                override fun shouldInterceptRequest(request: WebResourceRequest) = shell.intercept(request)
            })
            return shell
        }
    }
}
