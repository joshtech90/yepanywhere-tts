package de.joscha.yepcockpit

import android.app.Application
import android.app.NotificationManager
import android.content.Context
import android.net.Uri
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class MeldungenTest {
    private val ctx: Context get() = RuntimeEnvironment.getApplication()
    private val nm get() = ctx.getSystemService(NotificationManager::class.java)
    private val rechner = Rechner("mac", "Mac", Uri.parse("https://mac.example:3400"), 0, 0)

    @Before
    fun vorbereiten() {
        Meldungen.kanaeleAnlegen(ctx)
        ctx.getSharedPreferences("meldungsstand", Context.MODE_PRIVATE).edit().clear().commit()
    }

    @After
    fun aufraeumen() {
        Meldungen.sichtbarMelden(ctx, null, null)
        nm.cancelAll()
    }

    private fun fertig(sitzung: String) = JSONObject()
        .put("type", "session-halted").put("sessionId", sitzung).put("projectId", "projekt")
        .put("timestamp", "2026-10-22T18:00:00Z").put("lastMessage", "Antwort")

    @Test
    fun unterdruecktNurDieExaktSichtbareSitzung() {
        Meldungen.sichtbarMelden(ctx, rechner, Uri.parse(rechner.pfad("/cockpit/projects/projekt/sessions/sitzung-lang")))
        Meldungen.verarbeiten(ctx, rechner, fertig("sitzung"))
        assertEquals(1, nm.activeNotifications.size)
        Meldungen.verarbeiten(ctx, rechner, fertig("sitzung-lang"))
        assertEquals(1, nm.activeNotifications.size)
    }
    @Test
    fun meldungBleibtBisDieSitzungWirklichSichtbarIst() {
        Meldungen.sichtbarMelden(ctx, null, null)
        Meldungen.verarbeiten(ctx, rechner, fertig("sitzung"))
        val pfad = "/cockpit/projects/projekt/sessions/sitzung"
        // Ein anderer Rechner und eine fremde Herkunft lesen diese Meldung nicht.
        val anderer = rechner.copy(schluessel = "aihub", basis = Uri.parse("https://aihub.example:3400"))
        Meldungen.sichtbarMelden(ctx, anderer, Uri.parse(anderer.pfad(pfad)))
        assertEquals(1, nm.activeNotifications.size)
        Meldungen.sichtbarMelden(ctx, rechner, Uri.parse("https://other.example$pfad"))
        assertEquals(1, nm.activeNotifications.size)
        Meldungen.sichtbarMelden(ctx, rechner, Uri.parse(rechner.pfad(pfad)))
        assertEquals(0, nm.activeNotifications.size)
    }
    @Test
    fun spaeteAntwortBestaetigungDarfNeueFrageNichtErsetzen() {
        Meldungen.verarbeiten(ctx, rechner, fertig("sitzung"))
        val version = nm.activeNotifications.single().notification.extras.getString(Meldungen.EXTRA_VERSION)
        Meldungen.verarbeiten(ctx, rechner, fertig("sitzung").put("type", "pending-input")
            .put("timestamp", "2026-10-22T18:00:01Z").put("summary", "Neue Frage"))
        Meldungen.antwortErgebnis(ctx, rechner, "projekt", "sitzung", version, true, "Meine Antwort")
        assertEquals(Meldungen.KANAL_WARTET, nm.activeNotifications.single().notification.channelId)
    }

    @Test
    fun antwortBestaetigtNurDieUrspruenglicheNochUngeleseneMeldung() {
        for (ok in listOf(true, false)) {
            Meldungen.verarbeiten(ctx, rechner, fertig("sitzung"))
            val version = nm.activeNotifications.single().notification.extras.getString(Meldungen.EXTRA_VERSION)
            Meldungen.antwortErgebnis(ctx, rechner, "projekt", "sitzung", version, ok, "Meine Antwort")
            assertEquals("Meine Antwort", nm.activeNotifications.single().notification.extras.getString("android.text"))
            nm.cancelAll()
            Meldungen.antwortErgebnis(ctx, rechner, "projekt", "sitzung", version, ok, "Meine Antwort")
            assertEquals(0, nm.activeNotifications.size)
        }
    }
}
