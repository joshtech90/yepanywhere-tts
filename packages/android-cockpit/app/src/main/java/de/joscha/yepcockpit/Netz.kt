package de.joscha.yepcockpit

import android.webkit.CookieManager
import java.net.HttpURLConnection
import java.net.URL
import javax.net.ssl.HttpsURLConnection

/** Kleine HTTPS-Aufrufe ausserhalb der WebView, nur zu den eigenen Rechnern. */
object Netz {
    class Antwort(val status: Int, val text: String)

    /** Anmelde-Cookies der WebView fuer genau diesen Rechner, sonst null. */
    fun cookies(rechner: Rechner): String? =
        CookieManager.getInstance().getCookie(rechner.basis.toString())?.takeIf { it.isNotBlank() }

    /**
     * POST oder PUT mit JSON. Ohne Weiterleitungen: Cookies und Inhalt duerfen nie an
     * ein anderes Ziel gehen. Wirft bei Netzfehlern.
     */
    fun json(
        url: String,
        json: String,
        cookies: String? = null,
        yep: Boolean = false,
        methode: String = "POST",
    ): Antwort {
        val daten = json.toByteArray(Charsets.UTF_8)
        val c = URL(url).openConnection() as? HttpsURLConnection
            ?: throw IllegalArgumentException("nur https")
        try {
            c.instanceFollowRedirects = false
            c.connectTimeout = 10_000
            c.readTimeout = 15_000
            c.useCaches = false
            c.requestMethod = methode
            c.doOutput = true
            c.setFixedLengthStreamingMode(daten.size)
            c.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            if (cookies != null) c.setRequestProperty("Cookie", cookies)
            // Yeps Schutz gegen fremde Seiten verlangt diesen Kopf bei /api.
            if (yep) c.setRequestProperty("X-Yep-Anywhere", "true")
            c.outputStream.use { it.write(daten) }
            val status = c.responseCode
            val strom = if (status >= HttpURLConnection.HTTP_BAD_REQUEST) c.errorStream else c.inputStream
            val text = strom?.use { s -> s.readBytes().toString(Charsets.UTF_8).take(4000) }.orEmpty()
            return Antwort(status, text)
        } finally {
            c.disconnect()
        }
    }
}
