package de.joscha.yepcockpit

import android.app.Application
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.ServiceWorkerClient
import android.webkit.ServiceWorkerController
import android.webkit.ServiceWorkerWebSettings
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.LinearLayout
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
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

    @Test
    fun fremdeLinksOeffnenAlsBrowserTabUndEigeneBleibenImCockpit() {
        val r = Rechner("mac", "Mac", Uri.parse("https://mac.example:3400"), 0, 0)
        val feld = RechnerListe::class.java.getDeclaredField("alle\$delegate").apply { isAccessible = true }
        val speicher = feld.get(null)
        val vorher = RechnerListe.alle
        ReflectionHelpers.setField(speicher, "_value", listOf(r))
        val controller = Robolectric.buildActivity(MainActivity::class.java)
        try {
            val a = controller.setup().get()
            val wurzel = a.findViewById<FrameLayout>(android.R.id.content).getChildAt(0) as LinearLayout
            val web = (wurzel.getChildAt(1) as FrameLayout).getChildAt(0) as WebView
            val gestartet = shadowOf(a)
            gestartet.clearNextStartedActivities()
            fun antippen(url: String) = web.webViewClient.shouldOverrideUrlLoading(web, anfrage(url))

            // Eigene Cockpit-Seiten bleiben in der angemeldeten Ansicht.
            assertFalse(antippen(r.pfad("/cockpit?view=sessions")))
            assertNull(gestartet.nextStartedActivity)

            // Fremde Webadressen, auch derselbe Host auf anderem Port: Browser-Tab.
            for (url in listOf("https://example.com/seite?a=1", "http://mac.example:8080/")) {
                assertTrue(antippen(url))
                val tab = gestartet.nextStartedActivity
                assertEquals(Intent.ACTION_VIEW, tab.action)
                assertEquals(url, tab.dataString)
                assertTrue(tab.hasCategory(Intent.CATEGORY_BROWSABLE))
                assertTrue(tab.hasExtra("android.support.customtabs.extra.SESSION"))
            }

            // Mail geht ohne Browser-Tab an die Mail-App, unbekannte Schemata nirgendwohin.
            assertTrue(antippen("mailto:post@example.com"))
            assertFalse(gestartet.nextStartedActivity.hasExtra("android.support.customtabs.extra.SESSION"))
            assertTrue(antippen("intent://x#Intent;package=de.joscha.yepcockpit;end"))
            assertNull(gestartet.nextStartedActivity)
        } finally {
            controller.pause().stop().destroy()
            ReflectionHelpers.setField(speicher, "_value", vorher)
        }
    }

    private fun anfrage(url: String) = object : WebResourceRequest {
        override fun getUrl(): Uri = Uri.parse(url)
        override fun isForMainFrame() = true
        override fun isRedirect() = false
        override fun hasGesture() = true
        override fun getMethod() = "GET"
        override fun getRequestHeaders(): Map<String, String> = emptyMap()
    }

    @Test
    fun wiederhergestellteAktivitaetFuehrtAlteStartabsichtNichtErneutAus() {
        val r = Rechner("mac", "Mac", Uri.parse("https://mac.example:3400"), 0, 0)
        val feld = RechnerListe::class.java.getDeclaredField("alle\$delegate").apply { isAccessible = true }
        val speicher = feld.get(null)
        val vorher = RechnerListe.alle
        ReflectionHelpers.setField(speicher, "_value", listOf(r))
        val alt = Intent().putExtra(Meldungen.EXTRA_RECHNER, r.schluessel)
            .putExtra(Meldungen.EXTRA_PROJEKT, "projekt").putExtra(Meldungen.EXTRA_SITZUNG, "sitzung")
        // Nach Prozessende: Wiederherstellung mit gesichertem Zustand oder Start aus "Zuletzt verwendet".
        for ((absicht, zustand) in listOf(
            Intent(alt) to Bundle(),
            Intent(alt).addFlags(Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) to null,
        )) {
            val controller = Robolectric.buildActivity(MainActivity::class.java, absicht)
            try {
                val a = controller.create(zustand).start().postCreate(zustand).resume().visible().get()
                val wurzel = a.findViewById<FrameLayout>(android.R.id.content).getChildAt(0) as LinearLayout
                val web = (wurzel.getChildAt(1) as FrameLayout).getChildAt(0) as WebView
                assertEquals(r.start, shadowOf(web).lastLoadedUrl)
            } finally {
                controller.pause().stop().destroy()
            }
        }
        ReflectionHelpers.setField(speicher, "_value", vorher)
    }
}
