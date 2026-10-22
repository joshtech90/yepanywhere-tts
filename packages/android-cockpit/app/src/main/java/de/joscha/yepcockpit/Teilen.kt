package de.joscha.yepcockpit

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.WebResourceResponse
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.SecureRandom

/**
 * Geteilte Inhalte aus anderen Apps. Dateien werden in den privaten App-Ordner
 * kopiert und der Cockpit-Seite unter einer eigenen Adresse ihres Rechners
 * angeboten (/__yep_app/teilen/<id>/<n>), die nur diese App beantwortet. Die
 * Seite holt sie dort ab und legt sie in "Neue Sitzung"
 * (useCockpitAppShare.ts). Nichts geht an einen Server, bevor Joscha startet.
 */
object Teilen {
    const val EXTRA = "de.joscha.yepcockpit.TEILEN"
    private const val PFAD = "/__yep_app/teilen/"
    private const val MAX_DATEIEN = 20
    private const val MAX_BYTES = 200L * 1024 * 1024
    private const val AUFBEWAHRUNG_MS = 24 * 60 * 60 * 1000L
    private val kennung = Regex("^[a-f0-9]{24}$")

    fun gueltig(id: String?): Boolean = id != null && kennung.matches(id)

    private fun ordner(ctx: Context) = File(ctx.filesDir, "teilen")

    /** Kopiert Text und Dateien; Kennung und Zahl der nicht uebernommenen Dateien. Nicht im Hauptthread. */
    fun speichern(ctx: Context, text: String?, quellen: List<Uri>): Pair<String, Int> {
        aufraeumen(ctx)
        val id = ByteArray(12).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
        val ziel = File(ordner(ctx), id).apply { mkdirs() }
        val dateien = JSONArray()
        var summe = 0L
        for (quelle in quellen.take(MAX_DATEIEN)) {
            val (name, typ) = beschreiben(ctx, quelle)
            val datei = File(ziel, dateien.length().toString())
            val kopiert = runCatching {
                ctx.contentResolver.openInputStream(quelle)?.use { ein ->
                    datei.outputStream().use { aus -> kopieren(ein, aus, MAX_BYTES - summe) }
                }
            }.getOrNull()
            if (kopiert == null || kopiert < 0) {
                datei.delete()
                continue
            }
            summe += kopiert
            dateien.put(JSONObject().put("name", name).put("typ", typ))
        }
        val fehlend = quellen.size - dateien.length()
        val meta = JSONObject().put("text", text.orEmpty()).put("dateien", dateien).put("fehlend", fehlend)
        File(ziel, "meta.json").writeText(meta.toString())
        return id to fehlend
    }

    /** JavaScript, das den Inhalt an die Cockpit-Seite uebergibt. */
    fun einsetzenSkript(ctx: Context, id: String): String? {
        if (!gueltig(id)) return null
        val meta = runCatching { JSONObject(File(File(ordner(ctx), id), "meta.json").readText()) }.getOrNull()
            ?: return null
        val dateien = meta.optJSONArray("dateien") ?: JSONArray()
        val liste = JSONArray()
        for (i in 0 until dateien.length()) {
            val d = dateien.getJSONObject(i)
            liste.put(
                JSONObject()
                    .put("url", "$PFAD$id/$i")
                    .put("name", d.optString("name"))
                    .put("type", d.optString("typ")),
            )
        }
        val eintrag = JSONObject().put("text", meta.optString("text")).put("files", liste)
            .put("missing", meta.optInt("fehlend"))
        return "(function(e){(window.__yepAppShare=window.__yepAppShare||[]).push(e);" +
            "window.dispatchEvent(new Event('yep-app-share'));})($eintrag);"
    }

    /** Antwort auf /__yep_app/teilen/<id>/<n> des eigenen Rechners, sonst null. */
    fun abliefern(ctx: Context, r: Rechner, uri: Uri): WebResourceResponse? {
        val pfad = uri.path ?: return null
        if (!r.besitzt(uri) || !pfad.startsWith(PFAD)) return null
        val teile = pfad.removePrefix(PFAD).split('/')
        val id = teile.getOrNull(0)
        val n = teile.getOrNull(1)?.toIntOrNull()
        val meta = if (gueltig(id) && n != null && teile.size == 2) {
            runCatching { JSONObject(File(File(ordner(ctx), id!!), "meta.json").readText()) }.getOrNull()
        } else {
            null
        }
        val eintrag = meta?.optJSONArray("dateien")?.optJSONObject(n ?: -1)
        val datei = File(File(ordner(ctx), id.orEmpty()), n.toString())
        if (eintrag == null || !datei.isFile) {
            return WebResourceResponse("text/plain", "utf-8", 404, "Not Found", mapOf(), "".byteInputStream())
        }
        return WebResourceResponse(
            eintrag.optString("typ").ifBlank { "application/octet-stream" }, null, 200, "OK",
            mapOf("Cache-Control" to "no-store"), datei.inputStream(),
        )
    }

    private fun beschreiben(ctx: Context, uri: Uri): Pair<String, String> {
        var name = uri.lastPathSegment?.substringAfterLast('/') ?: "Datei"
        runCatching {
            ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0)?.let { name = it }
            }
        }
        val typ = ctx.contentResolver.getType(uri) ?: "application/octet-stream"
        return name.replace('/', '_') to typ
    }

    /** Kopiert hoechstens [rest] Byte; -1, wenn die Grenze ueberschritten wuerde. */
    private fun kopieren(ein: java.io.InputStream, aus: java.io.OutputStream, rest: Long): Long {
        val puffer = ByteArray(64 * 1024)
        var gesamt = 0L
        while (true) {
            val n = ein.read(puffer)
            if (n < 0) return gesamt
            gesamt += n
            if (gesamt > rest) return -1
            aus.write(puffer, 0, n)
        }
    }

    private fun aufraeumen(ctx: Context) {
        val grenze = System.currentTimeMillis() - AUFBEWAHRUNG_MS
        ordner(ctx).listFiles()?.filter { it.lastModified() < grenze }?.forEach { it.deleteRecursively() }
    }
}
