package de.joscha.yepcockpit

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.Context
import android.content.Intent
import org.json.JSONObject

/**
 * Baut aus den Yep-Push-Inhalten (packages/server/src/push/types.ts) die
 * Android-Meldungen. Je Sitzung und Rechner gibt es genau eine Meldung:
 * "Wartet auf dich" wird von "Fertig" ersetzt, ein "dismiss" vom Server
 * raeumt eine erledigte Frage weg.
 */
object Meldungen {
    const val KANAL_FERTIG = "fertig"
    const val KANAL_WARTET = "wartet"
    const val KANAL_HINWEIS = "hinweis"

    const val EXTRA_RECHNER = "de.joscha.yepcockpit.RECHNER"
    const val EXTRA_PROJEKT = "de.joscha.yepcockpit.PROJEKT"
    const val EXTRA_SITZUNG = "de.joscha.yepcockpit.SITZUNG"
    const val EXTRA_MELDUNG = "de.joscha.yepcockpit.MELDUNG"
    const val ANTWORT = "antwort"

    /** Was die App gerade im Vordergrund zeigt; dafuer keine Meldung. */
    object Sichtbar {
        @Volatile var rechner: String? = null
        @Volatile var pfad: String? = null
    }

    fun kanaeleAnlegen(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannels(
            listOf(
                NotificationChannel(KANAL_FERTIG, "Fertig", NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = "Eine Sitzung hat ihren Durchgang beendet"
                },
                NotificationChannel(KANAL_WARTET, "Wartet auf dich", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Eine Sitzung braucht eine Antwort oder Freigabe"
                },
                NotificationChannel(KANAL_HINWEIS, "Hinweise", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Test- und Sammelmeldungen"
                },
            ),
        )
    }

    fun id(rechner: Rechner, sitzung: String): Int = (rechner.schluessel + "/" + sitzung).hashCode()

    fun verarbeiten(ctx: Context, rechner: Rechner, d: JSONObject) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        val sitzung = d.optString("sessionId").takeIf { Ziele.gueltig(it) }
        // FCM haelt keine Reihenfolge ein: ein verspaetetes "Wartet" darf kein
        // neueres "Fertig" ersetzen, ein altes "dismiss" keine neue Frage loeschen.
        if (sitzung != null && !istNeuestes(ctx, rechner, sitzung, d.optString("timestamp"))) return
        val projekt = d.optString("projectId").takeIf { Ziele.gueltig(it) }
        val titel = d.optString("sessionTitle").ifBlank { d.optString("projectName").ifBlank { rechner.name } }

        when (d.optString("type")) {
            "dismiss" -> {
                if (sitzung == null) return
                val id = id(rechner, sitzung)
                // Nur eine offene Frage wegraeumen, nie ein "Fertig".
                if (nm.activeNotifications.any { it.id == id && it.notification.channelId == KANAL_WARTET }) {
                    nm.cancel(id)
                }
            }
            "pending-input" -> {
                if (sitzung == null || projekt == null || zeigtGerade(rechner, sitzung)) return
                val freigabe = d.optString("inputType") == "tool-approval"
                zeigen(
                    ctx, rechner, projekt, sitzung, KANAL_WARTET,
                    kopf = "Wartet auf dich · $titel",
                    text = (if (freigabe) "Freigabe: " else "") + d.optString("summary"),
                    antworten = false,
                )
            }
            "session-halted" -> {
                if (sitzung == null || projekt == null || zeigtGerade(rechner, sitzung)) return
                val fehler = d.optString("reason") == "error"
                val antwort = d.optString("lastMessage").trim()
                zeigen(
                    ctx, rechner, projekt, sitzung, KANAL_FERTIG,
                    kopf = (if (fehler) "Abgebrochen · " else "Fertig · ") + titel,
                    text = antwort.ifEmpty { dauerText(d.optLong("duration")) },
                    antworten = !fehler,
                )
            }
            "test" -> hinweis(ctx, rechner, "Test", d.optString("message"))
            "project-inactive" -> hinweis(ctx, rechner, "Alles erledigt", d.optString("projectName"))
            "ya-inactive" -> hinweis(ctx, rechner, "Alles erledigt", "Keine Sitzung arbeitet mehr")
        }
    }

    private const val STAND = "meldungsstand"
    private const val STAND_ALTER_MS = 7 * 24 * 60 * 60 * 1000L

    /** Merkt den Zeitpunkt des neuesten Ereignisses je Sitzung; aeltere verwirft es. */
    @Synchronized
    private fun istNeuestes(ctx: Context, rechner: Rechner, sitzung: String, zeit: String): Boolean {
        val ms = runCatching { java.time.Instant.parse(zeit).toEpochMilli() }.getOrNull() ?: return true
        val prefs = ctx.getSharedPreferences(STAND, Context.MODE_PRIVATE)
        val schluessel = rechner.schluessel + "/" + sitzung
        if (ms < prefs.getLong(schluessel, 0)) return false
        val grenze = System.currentTimeMillis() - STAND_ALTER_MS
        prefs.edit().apply {
            putLong(schluessel, ms)
            prefs.all.forEach { (k, v) -> if (v is Long && v < grenze) remove(k) }
        }.apply()
        return true
    }

    private fun zeigtGerade(rechner: Rechner, sitzung: String): Boolean =
        Sichtbar.rechner == rechner.schluessel && Sichtbar.pfad?.contains(sitzung) == true

    private fun dauerText(ms: Long): String {
        val min = ms / 60_000
        return when {
            ms <= 0 -> ""
            min < 1 -> "nach ${ms / 1000} s"
            min < 60 -> "nach $min min"
            else -> "nach ${min / 60} h ${min % 60} min"
        }
    }

    fun oeffnenIntent(ctx: Context, rechner: Rechner, projekt: String, sitzung: String, id: Int): PendingIntent {
        val i = Intent(ctx, MainActivity::class.java)
            .setAction("oeffnen:$id")
            .putExtra(EXTRA_RECHNER, rechner.schluessel)
            .putExtra(EXTRA_PROJEKT, projekt)
            .putExtra(EXTRA_SITZUNG, sitzung)
            .putExtra(EXTRA_MELDUNG, id)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(
            ctx, id, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    fun zeigen(
        ctx: Context,
        rechner: Rechner,
        projekt: String,
        sitzung: String,
        kanal: String,
        kopf: String,
        text: String,
        antworten: Boolean,
    ) {
        val id = id(rechner, sitzung)
        val b = grundgeruest(ctx, rechner, kanal, kopf, text)
            .setContentIntent(oeffnenIntent(ctx, rechner, projekt, sitzung, id))
            .setPublicVersion(
                grundgeruest(ctx, rechner, kanal, kopf.substringBefore(" · "), "").build(),
            )
        if (antworten) {
            val eingabe = RemoteInput.Builder(ANTWORT).setLabel("Antwort an die Sitzung").build()
            val ziel = Intent(ctx, AntwortEmpfaenger::class.java)
                .setAction("antworten:$id")
                .putExtra(EXTRA_RECHNER, rechner.schluessel)
                .putExtra(EXTRA_PROJEKT, projekt)
                .putExtra(EXTRA_SITZUNG, sitzung)
                .putExtra(EXTRA_MELDUNG, id)
            // RemoteInput braucht ein veraenderbares PendingIntent; das Ziel ist
            // ausdruecklich der nicht exportierte Empfaenger.
            val pi = PendingIntent.getBroadcast(
                ctx, id, ziel, PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            b.addAction(
                Notification.Action.Builder(null, "Antworten", pi)
                    .addRemoteInput(eingabe)
                    .setAllowGeneratedReplies(false)
                    .build(),
            )
        }
        ctx.getSystemService(NotificationManager::class.java).notify(id, b.build())
    }

    /** Rueckmeldung nach "Antworten": ersetzt die Meldung, ohne erneut zu klingeln. */
    fun antwortErgebnis(ctx: Context, rechner: Rechner, projekt: String, sitzung: String, ok: Boolean, text: String) {
        val id = id(rechner, sitzung)
        val b = grundgeruest(
            ctx, rechner, KANAL_FERTIG,
            if (ok) "Gesendet" else "Nicht gesendet, tippen zum Öffnen",
            text,
        )
            .setContentIntent(oeffnenIntent(ctx, rechner, projekt, sitzung, id))
            .setOnlyAlertOnce(true)
        if (ok) b.setTimeoutAfter(8_000)
        ctx.getSystemService(NotificationManager::class.java).notify(id, b.build())
    }

    private fun hinweis(ctx: Context, rechner: Rechner, kopf: String, text: String) {
        val b = grundgeruest(ctx, rechner, KANAL_HINWEIS, kopf, text)
            .setContentIntent(
                PendingIntent.getActivity(
                    ctx, 0,
                    Intent(ctx, MainActivity::class.java).putExtra(EXTRA_RECHNER, rechner.schluessel)
                        .setAction("rechner:${rechner.schluessel}"),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                ),
            )
        ctx.getSystemService(NotificationManager::class.java).notify(("hinweis/" + rechner.schluessel).hashCode(), b.build())
    }

    private fun grundgeruest(ctx: Context, rechner: Rechner, kanal: String, kopf: String, text: String) =
        Notification.Builder(ctx, kanal)
            .setSmallIcon(R.drawable.ic_meldung)
            .setColor(rechner.akzent)
            .setSubText(rechner.name)
            .setContentTitle(kopf)
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_MESSAGE)
}
