package de.joscha.yepcockpit

import android.content.Context
import android.os.Build
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Meldet die App fuer Push an.
 *
 * Weg einer Meldung: Yep-Server (Mac oder aihub) verschluesselt sie mit seinem
 * eingebauten Web Push fuer den Schluessel dieser App und schickt sie an die
 * Bruecke im Smartzone-Push-Dienst auf aihub. Die Bruecke reicht den
 * unlesbaren Inhalt per FCM an genau dieses Geraet weiter, PushDienst
 * entschluesselt ihn. Am Yep-Server aendert sich dafuer nichts: die App ist
 * dort ein ganz normales Web-Push-Abo.
 */
object Push {
    private const val TAG = "YEPC_PUSH"
    private const val PREFS = "push"
    private const val APP = "yep"

    /** Neu-Anmeldung je Rechner spaetestens nach diesem Abstand. */
    private const val ABO_ALTER_MS = 24 * 60 * 60 * 1000L
    private const val BRUECKE_ALTER_MS = 7 * ABO_ALTER_MS

    private val arbeiter = Executors.newSingleThreadExecutor()

    val eingerichtet: Boolean
        get() = BuildConfig.PUSH_BRUECKE.isNotEmpty() && BuildConfig.FIREBASE_APP_ID.isNotEmpty()

    /** Nach einem Fehlschlag erst nach dieser Pause wieder versuchen (ausser erzwungen). */
    private const val PAUSE_NACH_FEHLER_MS = 60_000L

    @Volatile private var naechsterVersuch = 0L

    /** Ohne Wartezeit; doppelte Aufrufe kosten nur einen Blick in die Einstellungen. */
    fun anmelden(ctx: Context, erzwingen: Boolean = false) {
        if (!eingerichtet) return
        val app = ctx.applicationContext
        arbeiter.execute {
            if (!erzwingen && System.currentTimeMillis() < naechsterVersuch) return@execute
            val ok = try {
                anmeldenJetzt(app, erzwingen)
            } catch (e: Exception) {
                Log.w(TAG, "Anmeldung gescheitert: ${e.javaClass.simpleName}")
                false
            }
            naechsterVersuch = if (ok) 0L else System.currentTimeMillis() + PAUSE_NACH_FEHLER_MS
        }
    }

    /** Neues FCM-Token: alles neu anmelden, die alten Adressen sind tot. */
    fun tokenGeaendert(ctx: Context) {
        // Nur Bruecke und Abos vergessen; "fertig_an_*" bleibt, sonst schaltete
        // ein Tokenwechsel von Joscha abgewaehlte Fertig-Meldungen wieder ein.
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.edit().apply {
            prefs.all.keys.filter { !it.startsWith("fertig_an_") }.forEach { remove(it) }
        }.apply()
        anmelden(ctx, erzwingen = true)
    }

    /** true, wenn nichts mehr nachzuholen ist (ein nicht angemeldeter Rechner zaehlt nicht als Fehler). */
    private fun anmeldenJetzt(ctx: Context, erzwingen: Boolean): Boolean {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val token = Tasks.await(FirebaseMessaging.getInstance().token, 30, TimeUnit.SECONDS)
        val tid = kennung(token)
        val jetzt = System.currentTimeMillis()

        if (erzwingen || prefs.getString("bruecke", null) != tid ||
            jetzt - prefs.getLong("bruecke_zeit", 0) > BRUECKE_ALTER_MS
        ) {
            val body = JSONObject()
                .put("app", APP)
                .put("package", BuildConfig.APPLICATION_ID)
                .put("token", token)
            val a = Netz.json("${BuildConfig.PUSH_BRUECKE}/api/push/register", body.toString())
            val ok = a.status == 200 && JSONObject(a.text).optBoolean("ok")
            Log.d(TAG, "Bruecke status=${a.status} ok=$ok")
            if (!ok) return false
            prefs.edit()
                .putString("bruecke", tid)
                .putLong("bruecke_zeit", jetzt)
                .apply()
        }

        var allesOk = true
        for (r in RechnerListe.alle) {
            // Ein schlafender Rechner darf den anderen nicht aufhalten.
            allesOk = try {
                abonnieren(ctx, r, tid, erzwingen, jetzt)
            } catch (e: Exception) {
                Log.w(TAG, "${r.schluessel}: ${e.javaClass.simpleName}")
                false
            } && allesOk
        }
        return allesOk
    }

    private fun abonnieren(ctx: Context, r: Rechner, tid: String, erzwingen: Boolean, jetzt: Long): Boolean {
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        run {
            val endpunkt = "${BuildConfig.PUSH_BRUECKE}/api/push/webpush/$APP/$tid/${r.schluessel}"
            val stand = prefs.getString("abo_${r.schluessel}", null)
            val zeit = prefs.getLong("abo_zeit_${r.schluessel}", 0)
            if (!erzwingen && stand == endpunkt && jetzt - zeit < ABO_ALTER_MS) return true
            val cookies = Netz.cookies(r)
            if (cookies == null) {
                Log.d(TAG, "${r.schluessel}: noch nicht angemeldet")
                return true
            }
            val abo = JSONObject()
                .put("browserProfileId", "android-app-" + Schluessel.installation(ctx))
                .put("deviceName", "Yep-App ${Build.MODEL}")
                .put(
                    "subscription",
                    JSONObject()
                        .put("endpoint", endpunkt)
                        .put(
                            "keys",
                            JSONObject()
                                .put("p256dh", Schluessel.b64url(Schluessel.oeffentlich()))
                                .put("auth", Schluessel.b64url(Schluessel.authGeheimnis(ctx))),
                        ),
                )
            val a = Netz.json(r.pfad("/api/push/subscribe"), abo.toString(), cookies, yep = true)
            Log.d(TAG, "${r.schluessel}: Abo status=${a.status}")
            if (a.status != 200) return false
            prefs.edit()
                .putString("abo_${r.schluessel}", endpunkt)
                .putLong("abo_zeit_${r.schluessel}", jetzt)
                .apply()
            // "Fertig"-Meldungen sind in Yep ab Werk aus. Die App ist genau
            // dafuer da: beim ersten Abo je Rechner einmal einschalten. Schaltet
            // Joscha sie spaeter in den Einstellungen ab, bleibt das so.
            if (!prefs.getBoolean("fertig_an_${r.schluessel}", false)) {
                val s = Netz.json(
                    r.pfad("/api/push/settings"),
                    JSONObject().put("sessionHalted", true).toString(),
                    cookies,
                    yep = true,
                    methode = "PUT",
                )
                Log.d(TAG, "${r.schluessel}: Fertig-Meldungen status=${s.status}")
                if (s.status == 200) prefs.edit().putBoolean("fertig_an_${r.schluessel}", true).apply()
            }
        }
        return true
    }

    /** Kurzer Hash des Tokens: die Bruecke findet das Geraet, das Token selbst bleibt aus den Yep-Daten. */
    private fun kennung(token: String): String =
        MessageDigest.getInstance("SHA-256").digest(token.toByteArray())
            .take(16).joinToString("") { "%02x".format(it) }
}
