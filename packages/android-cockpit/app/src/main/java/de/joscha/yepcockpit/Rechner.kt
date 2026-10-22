package de.joscha.yepcockpit

import android.graphics.Color
import android.net.Uri
import org.json.JSONArray

/**
 * Ein Cockpit-Server im Tailnet. build.sh schreibt die Liste aus
 * "AI Worker/hosts/rollen.json" in BuildConfig.RECHNER.
 */
data class Rechner(
    /** Feste Kurzkennung ("mac", "aihub"), auch Teil der Push-Adresse. */
    val schluessel: String,
    val name: String,
    /** https://<tailnet-name>:3400 ohne Pfad. */
    val basis: Uri,
    /** Kachelfarbe des Rechner-Symbols, fuer die Statusleiste. */
    val kachel: Int,
    /** Akzentfarbe, fuer Meldungen. */
    val akzent: Int,
) {
    val start: String get() = "$basis/cockpit"

    fun pfad(p: String): String = basis.toString() + p

    /** Gehoert die Adresse genau zu diesem Rechner (Schema, Host, Port)? */
    fun besitzt(uri: Uri?): Boolean =
        uri != null && uri.scheme == "https" && uri.host == basis.host && port(uri) == port(basis)

    private fun port(uri: Uri): Int = if (uri.port == -1) 443 else uri.port
}

object RechnerListe {
    val alle: List<Rechner> by lazy { lesen(BuildConfig.RECHNER) }

    fun nach(schluessel: String?): Rechner? = alle.firstOrNull { it.schluessel == schluessel }

    fun zu(uri: Uri?): Rechner? = alle.firstOrNull { it.besitzt(uri) }

    private fun lesen(json: String): List<Rechner> {
        val liste = JSONArray(json)
        return (0 until liste.length()).map { i ->
            val o = liste.getJSONObject(i)
            Rechner(
                schluessel = o.getString("schluessel"),
                name = o.getString("name"),
                basis = Uri.parse(o.getString("url").trimEnd('/')),
                kachel = Color.parseColor(o.getString("kachel")),
                akzent = Color.parseColor(o.getString("akzent")),
            )
        }
    }
}

/** Ziele, die von aussen (Meldung, Verknuepfung, Teilen) geoeffnet werden duerfen. */
object Ziele {
    // Yep-Kennungen sind base64url bzw. UUIDs; alles andere wird verworfen,
    // damit niemand ueber Extras einen beliebigen Pfad oeffnen kann.
    private val kennung = Regex("^[A-Za-z0-9_.~-]{1,512}$")

    fun gueltig(wert: String?): Boolean = wert != null && kennung.matches(wert)

    fun sitzung(projektId: String, sitzungId: String): String? =
        if (gueltig(projektId) && gueltig(sitzungId)) {
            "/cockpit/projects/${Uri.encode(projektId)}/sessions/${Uri.encode(sitzungId)}"
        } else {
            null
        }

    const val NEUE_SITZUNG = "/cockpit?view=new"
}
