package de.joscha.yepcockpit

import android.app.RemoteInput
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import org.json.JSONObject

/**
 * "Antworten" direkt aus der Meldung: schickt den Text so an die Sitzung wie
 * das Cockpit selbst (cockpitSend.ts). Laeuft der Prozess noch, geht er an
 * /api/sessions/:id/messages, sonst wird die Sitzung mit ihm fortgesetzt; der
 * Server setzt dabei den eigenen Modus der Sitzung wieder ein.
 */
class AntwortEmpfaenger : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val text = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(Meldungen.ANTWORT)
            ?.toString()?.trim().orEmpty()
        val rechner = RechnerListe.nach(intent.getStringExtra(Meldungen.EXTRA_RECHNER))
        val projekt = intent.getStringExtra(Meldungen.EXTRA_PROJEKT)
        val sitzung = intent.getStringExtra(Meldungen.EXTRA_SITZUNG)
        if (text.isEmpty() || rechner == null || !Ziele.gueltig(projekt) || !Ziele.gueltig(sitzung)) return
        val version = intent.getStringExtra(Meldungen.EXTRA_VERSION)
        val app = ctx.applicationContext
        val warten = goAsync()
        Thread({
            val ok = try {
                senden(rechner, projekt!!, sitzung!!, text)
            } catch (e: Exception) {
                Log.w(TAG, "Antwort gescheitert: ${e.javaClass.simpleName}")
                false
            }
            try {
                Meldungen.antwortErgebnis(app, rechner, projekt!!, sitzung!!, version, ok, text)
            } finally {
                warten.finish()
            }
        }, "yep-antwort").start()
    }

    private fun senden(rechner: Rechner, projekt: String, sitzung: String, text: String): Boolean {
        val cookies = Netz.cookies(rechner) ?: return false
        val body = JSONObject()
            .put("message", text)
            .put("clientTimestamp", System.currentTimeMillis())
            .toString()
        val direkt = Netz.json(rechner.pfad("/api/sessions/${enc(sitzung)}/messages"), body, cookies, yep = true)
        Log.d(TAG, "messages status=${direkt.status}")
        if (direkt.status in 200..299) return true
        // 404 = kein laufender Prozess mehr: Sitzung mit der Antwort fortsetzen.
        if (direkt.status != 404) return false
        val weiter = Netz.json(
            rechner.pfad("/api/projects/${enc(projekt)}/sessions/${enc(sitzung)}/resume"),
            body, cookies, yep = true,
        )
        Log.d(TAG, "resume status=${weiter.status}")
        return weiter.status in 200..299
    }

    private fun enc(s: String) = android.net.Uri.encode(s)

    private companion object {
        const val TAG = "YEPC_ANTWORT"
    }
}
