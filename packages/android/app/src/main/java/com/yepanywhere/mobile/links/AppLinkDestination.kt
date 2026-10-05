package com.yepanywhere.mobile.links

import java.net.URI
import java.net.URLDecoder

object AppLinkDestination {
    data class NativePairingLink(val username: String, val password: String, val relayWebsocketUrl: String)

    /** Legacy password-bearing App Links stay in native memory in bundled mode. */
    fun toNativePairingLink(action: String?, appLink: String?): NativePairingLink? {
        if (action != ACTION_VIEW || toWebClientUrl(appLink, "https://appassets.androidplatform.net/") == null) return null
        return runCatching {
            val params = parseQuery(URI(checkNotNull(appLink)).rawQuery)
            val relay = params["r"]?.takeIf(String::isNotBlank)?.let { raw ->
                val uri = URI(raw)
                require(uri.host != null && uri.userInfo == null && uri.rawFragment == null && uri.rawQuery == null)
                val scheme = when (uri.scheme) {
                    "https", "wss" -> "wss"
                    "http", "ws" -> "ws"
                    else -> error("Invalid relay scheme")
                }
                val path = uri.rawPath.orEmpty().trimEnd('/').let { if (it.endsWith("/ws")) it else "$it/ws" }
                "$scheme://${uri.rawAuthority}$path"
            }.orEmpty()
            NativePairingLink(checkNotNull(params["u"]), checkNotNull(params["p"]), relay)
        }.getOrNull()
    }

    fun toWebClientUrlForIntent(
        action: String?,
        appLink: String?,
        clientStartUrl: String,
    ): String? {
        if (action != ACTION_VIEW) return null
        return toWebClientUrl(appLink, clientStartUrl)
    }

    fun toWebClientUrl(appLink: String?, clientStartUrl: String): String? {
        if (appLink == null) {
            return null
        }
        val uri = runCatching { URI(appLink) }.getOrNull() ?: return null
        if (
            !uri.scheme.equals("https", ignoreCase = true) ||
            !uri.host.equals(APP_LINK_HOST, ignoreCase = true) ||
            uri.userInfo != null ||
            (uri.port != -1 && uri.port != 443) ||
            uri.rawPath != APP_LINK_PATH ||
            uri.rawFragment != null
        ) {
            return null
        }

        val rawQuery = uri.rawQuery?.takeIf(String::isNotEmpty) ?: return null
        val params = runCatching { parseQuery(rawQuery) }.getOrNull() ?: return null
        if (params["u"].isNullOrEmpty() || params["p"].isNullOrEmpty()) {
            return null
        }
        return "${clientStartUrl.substringBefore('#')}#$rawQuery"
    }

    private fun parseQuery(rawQuery: String): Map<String, String> {
        return buildMap {
            for (part in rawQuery.split('&')) {
                val separator = part.indexOf('=')
                val rawName = if (separator == -1) part else part.substring(0, separator)
                val rawValue = if (separator == -1) "" else part.substring(separator + 1)
                val name = URLDecoder.decode(rawName, Charsets.UTF_8.name())
                val value = URLDecoder.decode(rawValue, Charsets.UTF_8.name())
                putIfAbsent(name, value)
            }
        }
    }

    private const val APP_LINK_HOST = "yepanywhere.com"
    private const val APP_LINK_PATH = "/open"
    private const val ACTION_VIEW = "android.intent.action.VIEW"
}
