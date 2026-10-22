package de.joscha.yepcockpit

import android.app.Application
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.ServiceWorkerClient
import android.webkit.ServiceWorkerController
import android.webkit.ServiceWorkerWebSettings
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.LinearLayout
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.util.ReflectionHelpers

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class, shadows = [MainActivityTest.ServiceWorkers::class])
class MainActivityTest {
    // Robolectric has no native Chromium service-worker provider. Keep only
    // this unused platform adapter inert; real Activity/notification code runs.
    @Implements(ServiceWorkerController::class)
    class ServiceWorkers {
        companion object {
            @Suppress("DEPRECATION") // Test adapter for the existing platform API.
            @JvmStatic @Implementation
            fun getInstance(): ServiceWorkerController = object : ServiceWorkerController() {
                override fun getServiceWorkerWebSettings(): ServiceWorkerWebSettings = error("unused")
                override fun setServiceWorkerClient(client: ServiceWorkerClient?) = Unit
            }
        }
    }

    @Test
    fun hintergrundNavigationLiestKeineMeldungUndResumeLiestSie() {
        val r = Rechner("mac", "Mac", Uri.parse("https://mac.example:3400"), 0, 0)
        val feld = RechnerListe::class.java.getDeclaredField("alle\$delegate").apply { isAccessible = true }
        val speicher = feld.get(null)
        val vorher = RechnerListe.alle
        ReflectionHelpers.setField(speicher, "_value", listOf(r))
        val ctx: Context = RuntimeEnvironment.getApplication()
        val nm = ctx.getSystemService(NotificationManager::class.java)
        Meldungen.kanaeleAnlegen(ctx)
        ctx.getSharedPreferences("meldungsstand", Context.MODE_PRIVATE).edit().clear().commit()
        val controller = Robolectric.buildActivity(MainActivity::class.java)
        try {
            val a = controller.setup().get()
            val wurzel = a.findViewById<FrameLayout>(android.R.id.content).getChildAt(0) as LinearLayout
            val web = (wurzel.getChildAt(1) as FrameLayout).getChildAt(0) as WebView
            controller.pause()
            Meldungen.verarbeiten(ctx, r, JSONObject().put("type", "session-halted")
                .put("sessionId", "sitzung").put("projectId", "projekt"))
            val url = r.pfad("/cockpit/projects/projekt/sessions/sitzung")
            web.loadUrl(url)
            web.webViewClient.doUpdateVisitedHistory(web, url, false)
            assertEquals(1, nm.activeNotifications.size)
            controller.resume()
            assertEquals(0, nm.activeNotifications.size)
        } finally {
            controller.pause().stop().destroy()
            Meldungen.sichtbarMelden(ctx, null, null)
            nm.cancelAll()
            ReflectionHelpers.setField(speicher, "_value", vorher)
        }
    }

    @Test
    fun mehrereGeteilteInhalteBleibenVorUndNachDemLadenErhalten() {
        val r = Rechner("mac", "Mac", Uri.parse("https://mac.example:3400"), 0, 0)
        val feld = RechnerListe::class.java.getDeclaredField("alle\$delegate").apply { isAccessible = true }
        val speicher = feld.get(null)
        val vorher = RechnerListe.alle
        ReflectionHelpers.setField(speicher, "_value", listOf(r))
        val ctx: Context = RuntimeEnvironment.getApplication()
        val controller = Robolectric.buildActivity(MainActivity::class.java)
        try {
            val a = controller.setup().get()
            val wurzel = a.findViewById<FrameLayout>(android.R.id.content).getChildAt(0) as LinearLayout
            val web = (wurzel.getChildAt(1) as FrameLayout).getChildAt(0) as WebView
            fun teilen(text: String) {
                val (id, _) = Teilen.speichern(ctx, text, emptyList())
                controller.newIntent(Intent().putExtra(Meldungen.EXTRA_RECHNER, r.schluessel).putExtra(Teilen.EXTRA, id))
            }
            teilen("Erster Text")
            teilen("Zweiter Text")
            web.webViewClient.onPageFinished(web, r.pfad(Ziele.NEUE_SITZUNG))
            val skript = shadowOf(web).lastEvaluatedJavascript
            assertTrue(skript.contains("Erster Text"))
            assertTrue(skript.contains("Zweiter Text"))
            teilen("Dritter Text")
            // Bereits geladene Eingabe bleibt bestehen; neuer Inhalt kommt
            // sofort und braucht keinen weiteren Seitenlade-Callback.
            assertTrue(shadowOf(web).lastEvaluatedJavascript.contains("Dritter Text"))
            // Waehrend "Neue Sitzung" noch laedt, gehoert die geladene Seite zur
            // alten Adresse: ein weiterer Inhalt wartet auf die neue Seite.
            val sitzung = r.pfad("/cockpit/projects/projekt/sessions/sitzung")
            web.loadUrl(sitzung)
            web.webViewClient.onPageFinished(web, sitzung)
            teilen("Vierter Text")
            teilen("Fuenfter Text")
            assertTrue(!shadowOf(web).lastEvaluatedJavascript.contains("Fuenfter Text"))
            web.webViewClient.onPageFinished(web, r.pfad(Ziele.NEUE_SITZUNG))
            assertTrue(shadowOf(web).lastEvaluatedJavascript.contains("Vierter Text"))
            assertTrue(shadowOf(web).lastEvaluatedJavascript.contains("Fuenfter Text"))
        } finally {
            controller.pause().stop().destroy()
            ReflectionHelpers.setField(speicher, "_value", vorher)
        }
    }
}
