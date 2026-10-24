package de.joscha.yepcockpit

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.ServiceWorkerClient
import android.webkit.ServiceWorkerController
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.Toast
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/**
 * Eine WebView je Rechner, wie in der Mac-App. Die Cockpit-Oberflaeche bleibt
 * unveraendert; die App ergaenzt nur, was eine Browser-App nicht kann.
 * Fremde Adressen oeffnen als Browser-Tab ueber der App, nie in einer Ansicht
 * mit Cockpit-Anmeldung.
 */
class MainActivity : Activity() {
    private lateinit var leiste: View
    private lateinit var ablage: FrameLayout
    private val ansichten = LinkedHashMap<String, WebView>()
    private lateinit var aktiv: Rechner
    private var vordergrund = false

    private var dateiRueckruf: ValueCallback<Array<Uri>>? = null
    private var mikrofonAnfrage: PermissionRequest? = null

    /** Geteilte Inhalte je Rechner, die nach dem Laden von "Neue Sitzung" eingesetzt werden. */
    private val ausstehendesTeilen = HashMap<String, MutableList<String>>()

    /** Rechner, deren Seite fertig geladen ist und geteilte Inhalte sofort annimmt. */
    private val geladen = HashSet<String>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (RechnerListe.alle.isEmpty()) {
            Toast.makeText(this, "Keine Rechner eingebaut, build.sh benutzen", Toast.LENGTH_LONG).show()
            finish()
            return
        }
        // Laufzeit-Diagnose ueber chrome://inspect braucht ADB, also das Handy in der Hand.
        WebView.setWebContentsDebuggingEnabled(true)
        CookieManager.getInstance().setAcceptCookie(true)
        ServiceWorkerController.getInstance().setServiceWorkerClient(object : ServiceWorkerClient() {
            override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? =
                RechnerListe.zu(request.url)?.let { Teilen.abliefern(this@MainActivity, it, request.url) }
        })

        leiste = View(this)
        ablage = FrameLayout(this)
        val wurzel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.BLACK)
            addView(leiste, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0))
            addView(ablage, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        }
        // Randlos (Pflicht ab Android 15): oben ein Streifen in der Kachelfarbe
        // des Rechners hinter der Statusleiste, unten Platz fuer Navigation
        // und Tastatur, damit das Eingabefeld nie verdeckt ist.
        window.setDecorFitsSystemWindows(false)
        wurzel.setOnApplyWindowInsetsListener { v, insets ->
            val leisten = insets.getInsets(WindowInsets.Type.systemBars())
            val tastatur = insets.getInsets(WindowInsets.Type.ime())
            leiste.layoutParams = leiste.layoutParams.apply { height = leisten.top }
            v.setPadding(leisten.left, 0, leisten.right, maxOf(leisten.bottom, tastatur.bottom))
            WindowInsets.CONSUMED
        }
        setContentView(wurzel)
        window.insetsController?.setSystemBarsAppearance(
            0,
            WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
        )

        val zuletzt = getSharedPreferences("ansicht", MODE_PRIVATE).getString("rechner", null)
        zeigen(RechnerListe.nach(zuletzt) ?: RechnerListe.alle.first())
        // Nach einem Prozessende stellt Android die urspruengliche Startabsicht
        // erneut zu (Wiederherstellung oder Start aus "Zuletzt verwendet"). Sie
        // ist dann laengst erledigt: kein zweites Teilen, kein Sprung zur alten Meldung.
        val erledigt = savedInstanceState != null ||
            (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0
        if (!erledigt) behandeln(intent)

        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), ANFRAGE_MELDUNGEN)
        }
        verknuepfungenSetzen()
    }

    @Deprecated("Activity ohne AndroidX; ohne Predictive-Back-Opt-in weiter gueltig")
    override fun onBackPressed() {
        val a = ansichten[aktiv.schluessel]
        if (a != null && a.canGoBack()) a.goBack() else moveTaskToBack(true)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        behandeln(intent)
    }

    override fun onResume() {
        super.onResume()
        vordergrund = true
        sichtbarMelden()
        Push.anmelden(this)
    }

    override fun onPause() {
        super.onPause()
        vordergrund = false
        sichtbarMelden()
        // Hintergrund-Aufrufe (Push-Abo, Antworten) lesen die Cookies.
        CookieManager.getInstance().flush()
    }

    override fun onDestroy() {
        ansichten.values.forEach { it.destroy() }
        ansichten.clear()
        super.onDestroy()
    }

    // MARK: Rechner

    private fun ansicht(r: Rechner): WebView =
        ansichten.getOrPut(r.schluessel) { neueAnsicht(r).also { it.loadUrl(r.start) } }

    private fun zeigen(r: Rechner) {
        aktiv = r
        val a = ansicht(r)
        if (a.parent !== ablage) {
            ablage.removeAllViews()
            ablage.addView(a, FrameLayout.LayoutParams(-1, -1))
        }
        a.requestFocus()
        leiste.setBackgroundColor(r.kachel)
        getSharedPreferences("ansicht", MODE_PRIVATE).edit().putString("rechner", r.schluessel).apply()
        sichtbarMelden()
    }

    private fun sichtbarMelden(url: String? = null) {
        if (!vordergrund || !::aktiv.isInitialized) {
            Meldungen.sichtbarMelden(this, null, null)
            return
        }
        val uri = (url ?: ansichten[aktiv.schluessel]?.url)?.let(Uri::parse)
        Meldungen.sichtbarMelden(this, aktiv, uri)
    }

    /** Ziel aus Meldung, Verknuepfung oder Teilen. Nur gepruefte Kennungen, nie freie Pfade. */
    private fun behandeln(intent: Intent?) {
        val r = RechnerListe.nach(intent?.getStringExtra(Meldungen.EXTRA_RECHNER)) ?: return
        val teilen = intent?.getStringExtra(Teilen.EXTRA)?.takeIf { Teilen.gueltig(it) }
        val pfad = when {
            intent?.getStringExtra(EXTRA_ZIEL) == ZIEL_NEU -> Ziele.NEUE_SITZUNG
            else -> Ziele.sitzung(
                intent?.getStringExtra(Meldungen.EXTRA_PROJEKT).orEmpty(),
                intent?.getStringExtra(Meldungen.EXTRA_SITZUNG).orEmpty(),
            )
        }
        zeigen(r)
        val a = ansicht(r)
        when {
            // "Neue Sitzung" steht schon: Inhalt anhaengen statt neu laden, sonst
            // gingen vorher geteilte oder getippte Eingaben verloren.
            teilen != null && r.schluessel in geladen && istNeueSitzung(r, a.url) ->
                einsetzen(a, listOf(teilen))
            teilen != null -> {
                ausstehendesTeilen.getOrPut(r.schluessel) { mutableListOf() }.add(teilen)
                laden(r, a, r.pfad(Ziele.NEUE_SITZUNG))
            }
            pfad != null -> laden(r, a, r.pfad(pfad))
        }
        // Erledigt: die Absicht nicht nach einer Drehung noch einmal ausfuehren.
        intent?.removeExtra(Meldungen.EXTRA_RECHNER)
        intent?.removeExtra(Teilen.EXTRA)
    }

    /** Bis die neue Seite fertig ist, nimmt die alte keine geteilten Inhalte mehr an. */
    private fun laden(r: Rechner, view: WebView, url: String) {
        geladen.remove(r.schluessel)
        view.loadUrl(url)
    }

    private fun istNeueSitzung(r: Rechner, url: String?): Boolean {
        val uri = url?.let(Uri::parse) ?: return false
        return r.besitzt(uri) && uri.path == "/cockpit" && uri.getQueryParameter("view") == "new"
    }

    private fun einsetzen(view: WebView, ids: List<String>) {
        val skript = ids.mapNotNull { Teilen.einsetzenSkript(this, it) }.joinToString("")
        if (skript.isNotEmpty()) view.evaluateJavascript(skript, null)
    }

    private fun verknuepfungenSetzen() {
        val sm = getSystemService(ShortcutManager::class.java) ?: return
        val liste = RechnerListe.alle.take(sm.maxShortcutCountPerActivity).mapIndexed { i, r ->
            val symbol = resources.getIdentifier("zeichen_${r.schluessel}", "drawable", packageName)
            ShortcutInfo.Builder(this, "neu-${r.schluessel}")
                .setShortLabel("Neu · ${r.name}")
                .setLongLabel("Neue Sitzung auf ${r.name}")
                .setRank(i)
                .apply { if (symbol != 0) setIcon(Icon.createWithResource(this@MainActivity, symbol)) }
                .setIntent(
                    Intent(this, MainActivity::class.java)
                        .setAction(Intent.ACTION_VIEW)
                        .putExtra(Meldungen.EXTRA_RECHNER, r.schluessel)
                        .putExtra(EXTRA_ZIEL, ZIEL_NEU),
                )
                .build()
        }
        runCatching { sm.dynamicShortcuts = liste }
    }

    // MARK: WebView

    @SuppressLint("SetJavaScriptEnabled")
    private fun neueAnsicht(r: Rechner): WebView = WebView(this).apply {
        setBackgroundColor(Color.BLACK)
        settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // Vorlesen startet Audio ohne neuen Tipp.
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            setSupportMultipleWindows(false)
            textZoom = 100
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
        webViewClient = Fuehrung(r)
        webChromeClient = Oberflaeche(r)
        setDownloadListener { url, _, inhalt, typ, _ -> herunterladen(r, this, url, inhalt, typ) }
        // Downloads aus blob:- und Worker-Adressen kann nur die Seite selbst
        // lesen; sie reicht den Inhalt ueber diesen Kanal, nur von den eigenen Rechnern.
        // Die CSP des Cockpits verbietet fetch auf blob:-Adressen. Deshalb merkt
        // sich die Seite ihre Blobs kurz selbst, nur auf den eigenen Rechnern.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(
                this, BLOB_MERKER, RechnerListe.alle.map { it.basis.toString() }.toSet(),
            )
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(
                this, "YepApp",
                RechnerListe.alle.map { it.basis.toString() }.toSet(),
            ) { _, nachricht, herkunft, istHauptrahmen, _ ->
                if (istHauptrahmen && RechnerListe.zu(herkunft) != null) {
                    nachricht.data?.let(::speichernAusSeite)
                }
            }
        }
    }

    private inner class Fuehrung(private val r: Rechner) : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
            if (!req.isForMainFrame) return false
            val uri = req.url
            if (r.besitzt(uri)) return false
            // Rechnerwechsel aus dem Cockpit: zur anderen Ansicht springen,
            // statt das andere Cockpit in dieser zu laden.
            RechnerListe.zu(uri)?.let { anderer ->
                zeigen(anderer)
                if (uri.path != "/cockpit" && uri.path != "/" && !uri.path.isNullOrEmpty()) {
                    ansicht(anderer).loadUrl(uri.toString())
                }
                return true
            }
            extern(uri)
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            if (view === ansichten[r.schluessel]) geladen.remove(r.schluessel)
        }

        override fun onPageFinished(view: WebView, url: String) {
            val uri = Uri.parse(url)
            if (!r.besitzt(uri)) return
            // Ein abgebrochenes Laden meldet sich noch mit seiner alten Adresse.
            if (view === ansichten[r.schluessel] && url == view.url) geladen.add(r.schluessel)
            sichtbarMelden()
            // Nach der Anmeldung liegen die Cookies vor: Push einrichten.
            Push.anmelden(this@MainActivity)
            if (istNeueSitzung(r, url)) {
                ausstehendesTeilen.remove(r.schluessel)?.let { einsetzen(view, it) }
            }
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
            if (view === ansichten[aktiv.schluessel]) sichtbarMelden(url)
        }

        override fun shouldInterceptRequest(view: WebView, req: WebResourceRequest): WebResourceResponse? =
            Teilen.abliefern(this@MainActivity, r, req.url)

        override fun onReceivedError(view: WebView, req: WebResourceRequest, fehler: WebResourceError) {
            if (!req.isForMainFrame) return
            view.loadDataWithBaseURL(null, fehlerSeite(r, fehler.description.toString()), "text/html", "utf-8", null)
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            // Speicherdruck: Ansicht neu aufbauen statt die App abstuerzen zu lassen.
            Log.w(TAG, "Renderer weg (${r.schluessel}), crash=${detail.didCrash()}")
            ablage.removeView(view)
            ansichten.remove(r.schluessel)
            geladen.remove(r.schluessel)
            view.destroy()
            if (aktiv == r) zeigen(r)
            return true
        }
    }

    private inner class Oberflaeche(private val r: Rechner) : WebChromeClient() {
        override fun onShowFileChooser(
            view: WebView,
            rueckruf: ValueCallback<Array<Uri>>,
            parameter: FileChooserParams,
        ): Boolean {
            dateiRueckruf?.onReceiveValue(null)
            dateiRueckruf = rueckruf
            val auswahl = parameter.createIntent().apply {
                if (parameter.mode == FileChooserParams.MODE_OPEN_MULTIPLE) {
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                }
            }
            return try {
                startActivityForResult(auswahl, ANFRAGE_DATEI)
                true
            } catch (e: ActivityNotFoundException) {
                dateiRueckruf = null
                false
            }
        }

        override fun onPermissionRequest(anfrage: PermissionRequest) {
            val mikrofon = PermissionRequest.RESOURCE_AUDIO_CAPTURE
            if (!r.besitzt(anfrage.origin) || anfrage.resources.toList() != listOf(mikrofon)) {
                anfrage.deny()
                return
            }
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                anfrage.grant(arrayOf(mikrofon))
            } else {
                mikrofonAnfrage?.deny()
                mikrofonAnfrage = anfrage
                requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), ANFRAGE_MIKROFON)
            }
        }

        override fun onPermissionRequestCanceled(anfrage: PermissionRequest) {
            if (mikrofonAnfrage === anfrage) mikrofonAnfrage = null
        }
    }

    @Deprecated("Activity ohne AndroidX")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != ANFRAGE_DATEI) return
        val rueckruf = dateiRueckruf ?: return
        dateiRueckruf = null
        val mehrere = data?.clipData
        val dateien = when {
            resultCode != RESULT_OK -> null
            mehrere != null -> Array(mehrere.itemCount) { mehrere.getItemAt(it).uri }
            else -> WebChromeClient.FileChooserParams.parseResult(resultCode, data)
        }
        rueckruf.onReceiveValue(dateien)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != ANFRAGE_MIKROFON) return
        val anfrage = mikrofonAnfrage ?: return
        mikrofonAnfrage = null
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            anfrage.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
        } else {
            anfrage.deny()
        }
    }

    // MARK: Hilfen

    private fun extern(uri: Uri) {
        val absicht = fremdeAbsicht(uri) ?: return
        try {
            startActivity(absicht)
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, "Keine App für diesen Link", Toast.LENGTH_SHORT).show()
        }
    }

    private fun herunterladen(r: Rechner, view: WebView, url: String, inhalt: String?, typ: String?) {
        val uri = Uri.parse(url)
        if (uri.scheme != "blob" && !r.besitzt(uri)) {
            extern(uri)
            return
        }
        // Immer ueber die Seite selbst: ihr fetch schickt Cookies nur an den
        // eigenen Ursprung, auch bei Weiterleitungen, und erreicht blob:- und
        // Service-Worker-Adressen. (DownloadManager gaebe einen gesetzten
        // Cookie-Kopf auch an ein fremdes Weiterleitungsziel weiter.)
        val name = URLUtil.guessFileName(url, inhalt, typ)
        val funktion = assets.open("download.js").bufferedReader().use { it.readText() }
        val skript = "(function() { $funktion; downloadFile(${JSONObject.quote(url)}, ${JSONObject.quote(name)}, $MAX_DOWNLOAD); })();"
        view.evaluateJavascript(skript, null)
    }

    private fun speichernAusSeite(text: String) {
        // Base64 dekodieren und schreiben kostet bei grossen Dateien Sekunden:
        // nie im Hauptthread, sonst haengen Eingaben.
        Thread({
            val ergebnis = try {
                speichernJetzt(text)
            } catch (e: Throwable) {
                Log.w(TAG, "Download gescheitert: ${e.javaClass.simpleName}")
                "Download gescheitert"
            }
            if (ergebnis != null) runOnUiThread { Toast.makeText(this, ergebnis, Toast.LENGTH_LONG).show() }
        }, "yep-download").start()
    }

    /** Rueckmeldung fuer Joscha, oder null ohne Meldung. */
    private fun speichernJetzt(text: String): String? {
        // data:-URL eines 50-MB-Inhalts ist etwa 67 MB lang; mehr kommt nicht herein.
        if (text.length > MAX_DOWNLOAD / 3 * 4 + 4096) return "Download zu groß, bitte im Browser laden"
        val o = runCatching { JSONObject(text) }.getOrNull() ?: return null
        if (o.has("fehler")) {
            val grund = if (o.optString("fehler").contains("zu gross")) " (über 50 MB, bitte im Browser laden)" else ""
            return "Download gescheitert$grund"
        }
        val name = o.optString("name").ifBlank { "Download" }.replace('/', '_')
        val daten = o.optString("daten")
        val komma = daten.indexOf(',')
        if (!daten.startsWith("data:") || komma < 0) return "Download gescheitert"
        val typ = daten.substring(5, komma).substringBefore(';').ifBlank { "application/octet-stream" }
        val bytes = Base64.decode(daten.substring(komma + 1), Base64.DEFAULT)
        val werte = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, name)
            put(MediaStore.Downloads.MIME_TYPE, typ)
            // Erst sichtbar, wenn vollstaendig geschrieben.
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val ziel = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, werte)
            ?: return "Download gescheitert"
        try {
            contentResolver.openOutputStream(ziel)?.use { it.write(bytes) } ?: error("kein Ziel")
            val freigegeben = contentResolver.update(
                ziel, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null,
            )
            check(freigegeben == 1) { "nicht freigegeben" }
        } catch (e: Exception) {
            contentResolver.delete(ziel, null, null)
            throw e
        }
        return "In Downloads gespeichert: $name"
    }

    private fun fehlerSeite(r: Rechner, grund: String): String {
        val text = grund.replace("&", "&amp;").replace("<", "&lt;")
        return """
            <html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
            <body style="background:#000;color:#ccc;font:16px sans-serif;display:flex;align-items:center;
            justify-content:center;height:100vh;margin:0;text-align:center;padding:0 24px">
            <div><h2 style="color:#fff">${r.name} ist gerade nicht erreichbar</h2>
            <p>$text</p><p>Tailscale an? Rechner wach?</p>
            <p><a style="color:#8ab4ff;font-size:18px" href="${r.start}">Erneut versuchen</a></p>
            ${RechnerListe.alle.filter { it != r }.joinToString("") {
                "<p><a style=\"color:#8ab4ff;font-size:18px\" href=\"${it.start}\">Zu ${it.name} wechseln</a></p>"
            }}</div>
            </body></html>
        """.trimIndent()
    }

    companion object {
        private const val TAG = "YEPC_MAIN"
        private const val ANFRAGE_DATEI = 1
        private const val ANFRAGE_MIKROFON = 2
        private const val ANFRAGE_MELDUNGEN = 3
        const val EXTRA_ZIEL = "de.joscha.yepcockpit.ZIEL"
        const val ZIEL_NEU = "neu"
        /** Haelt Blobs bis eine Minute nach dem Freigeben, damit ein Download sie noch lesen kann. */
        private val BLOB_MERKER = """
            (() => {
              const blobs = new Map();
              const namen = new Map();
              Object.defineProperty(window, "__yepBlobs", { value: blobs });
              Object.defineProperty(window, "__yepDownloadNamen", { value: namen });
              // WebView reicht das download-Attribut nicht weiter; die Seite merkt es sich.
              document.addEventListener("click", (e) => {
                const a = e.target instanceof Element ? e.target.closest("a[download]") : null;
                if (a && a.href) namen.set(a.href, a.getAttribute("download") || "");
              }, true);
              const anlegen = URL.createObjectURL.bind(URL);
              const freigeben = URL.revokeObjectURL.bind(URL);
              URL.createObjectURL = (o) => {
                const u = anlegen(o);
                if (o instanceof Blob) blobs.set(u, o);
                return u;
              };
              URL.revokeObjectURL = (u) => {
                freigeben(u);
                setTimeout(() => blobs.delete(u), 60000);
              };
            })();
        """.trimIndent()

        /** Downloads laufen als data:-URL durch den Speicher; groessere gehen im Browser. */
        private const val MAX_DOWNLOAD = 50 * 1024 * 1024

        /** Kennzeichnet eine Absicht als Custom Tab; ohne Sitzung genuegt der leere Eintrag. */
        private const val CUSTOM_TAB_SITZUNG = "android.support.customtabs.extra.SESSION"

        /**
         * Webadressen oeffnen als Browser-Tab (Custom Tab) ueber der App; Zurueck
         * fuehrt ins Cockpit. Ein normales Chrome-Fenster schloss sich auf Joschas
         * vivo (Android 16, Chrome 155) nach dem Kaltstart sofort wieder (24.10.2026).
         * Hat eine App die Adresse fest uebernommen, etwa GitHub, oeffnet weiter
         * diese. Mail und Telefon gehen an ihre App.
         */
        fun fremdeAbsicht(uri: Uri): Intent? {
            val absicht = Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)
            return when (uri.scheme) {
                "http", "https" -> absicht.putExtras(Bundle().apply { putBinder(CUSTOM_TAB_SITZUNG, null) })
                "mailto", "tel" -> absicht
                else -> null
            }
        }
    }
}
