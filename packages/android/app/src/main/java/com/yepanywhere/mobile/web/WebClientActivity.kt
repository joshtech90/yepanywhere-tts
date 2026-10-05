package com.yepanywhere.mobile.web

import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import androidx.activity.enableEdgeToEdge
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.edit
import androidx.core.net.toUri
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewFeature
import androidx.webkit.WebSettingsCompat
import com.yepanywhere.mobile.BuildConfig
import com.yepanywhere.mobile.R
import com.yepanywhere.mobile.MainActivity
import com.yepanywhere.mobile.YepAnywhereApplication
import com.yepanywhere.mobile.notifications.NotificationFoundation
import com.yepanywhere.mobile.notifications.NotificationNativeHostOperations
import com.yepanywhere.mobile.notifications.NotificationStatusReader

open class WebClientActivity : ComponentActivity() {
    protected val config by lazy(WebClientConfig::fromBuild)
    private var webView: WebView? = null
    private var nativeHost: YaNativeMessageHost? = null
    private var transportHost: YaNativeTransportHost? = null
    private var notificationOperations: NotificationNativeHostOperations? = null
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var mainFrameFailed = false
    private var transportErrorView: View? = null
    fun nativeTransportDiagnostics(): org.json.JSONObject? = transportHost?.diagnostics()

    protected lateinit var shellRoot: FrameLayout
    private lateinit var pageRoot: FrameLayout
    private lateinit var hostLabel: TextView
    private lateinit var tabButton: Button
    private val tabs = NativeTabs()
    private val histories = mutableMapOf<String, Bundle>()
    private var activeTabId: String? = null
    private var activeProfileId: String? = null
    protected open val ownsTabs: Boolean = false
    private var pageForeground = true
    protected fun setPageForeground(value: Boolean) {
        pageForeground = value
        transportHost?.setForeground(value && lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED))
    }
    protected val hasSelectedTab: Boolean get() = tabs.selected != null
    private val tabPreferences by lazy { getSharedPreferences("native-tabs", MODE_PRIVATE) }
    protected open fun showHostManagement(newTab: Boolean = false) {
        startActivity(Intent(this, MainActivity::class.java).putExtra(MainActivity.SHOW_HOSTS, true))
        finish()
    }

    protected fun restoreTabs(profileIds: Set<String>) {
        tabs.restore(tabPreferences.getString("state", null))
        tabs.retainProfiles(profileIds)
        activateSelectedTab()
    }
    protected fun retainTabProfiles(ids: Set<String>) {
        tabs.retainProfiles(ids)
        histories.keys.retainAll(tabs.items.map { it.id }.toSet())
        activateSelectedTab()
    }
    protected fun openProfile(profileId: String, url: String? = null, newTab: Boolean = false) {
        val path = url?.takeIf { WebClientNavigation.decide(it, config.origin) == NavigationDecision.ALLOW_IN_APP }
            ?.toUri()?.encodedPath ?: "/projects"
        tabs.open(profileId, path, newTab) ?: return tabLimit()
        activateSelectedTab()
        if (url != null) webView?.loadUrl(config.origin + NativeTabs.safePath(path))
        persistTabs()
    }
    private fun persistTabs() {
        if (ownsTabs) tabPreferences.edit { putString("state", tabs.encode()) }
        updateToolbar()
    }
    private fun updateToolbar() {
        if (!ownsTabs) return
        tabButton.text = tabs.items.size.toString()
        tabButton.contentDescription = resources.getQuantityString(R.plurals.native_tabs_count, tabs.items.size, tabs.items.size)
        val profileId = tabs.selected?.profileId
        lifecycleScope.launch {
            val label = profileId?.let { (application as YepAnywhereApplication).nativeRuntime.pairedServers.snapshot(it)?.profile?.label } ?: getString(R.string.app_name)
            if (tabs.selected?.profileId == profileId) hostLabel.text = label
        }
    }
    private fun activateSelectedTab() {
        val selected = tabs.selected
        if (activeTabId == selected?.id) { persistTabs(); return }
        activeTabId?.takeIf { id -> tabs.items.any { it.id == id } }?.let { id ->
            webView?.takeIf { it.copyBackForwardList().size <= 64 }?.let { view ->
                histories[id] = Bundle().also(view::saveState)
            }
        }
        destroyDocument()
        pageRoot.removeAllViews()
        activeTabId = selected?.id
        activeProfileId = selected?.profileId
        if (selected != null) {
            mountDocument(config.origin + selected.path, histories.remove(selected.id))
        }
        persistTabs()
    }
    private fun tabLimit() = android.widget.Toast.makeText(this, getString(R.string.native_tab_limit, NativeTabs.MAX_TABS), android.widget.Toast.LENGTH_SHORT).show()
    private fun localPath(url: String): String {
        val uri = url.toUri()
        return NativeTabs.livePath((uri.encodedPath ?: "/projects") +
            (uri.encodedQuery?.let { "?$it" } ?: "") + (uri.encodedFragment?.let { "#$it" } ?: ""))
    }
    private fun openTab(url: String, foreground: Boolean) {
        when (WebClientNavigation.decide(url, config.origin)) {
            NavigationDecision.ALLOW_IN_APP -> {
                val profile = activeProfileId ?: return
                if (tabs.open(profile, localPath(url), newTab = true, foreground = foreground) == null) { tabLimit(); return }
                activateSelectedTab()
                persistTabs()
                if (!foreground) android.widget.Toast.makeText(this, getString(R.string.native_tab_opened), android.widget.Toast.LENGTH_SHORT).show()
            }
            NavigationDecision.OPEN_EXTERNALLY -> openExternal(url)
            NavigationDecision.BLOCK -> Unit
        }
    }
    private fun showTabs() {
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val scroll = android.widget.ScrollView(this).apply { addView(list) }
        val dialog = android.app.AlertDialog.Builder(this).setTitle(R.string.native_tabs).setView(scroll).setNegativeButton(R.string.native_tabs_done, null).create()
        val snapshot = tabs.items.toList()
        lifecycleScope.launch {
            for (tab in snapshot) {
                val name = (application as YepAnywhereApplication).nativeRuntime.pairedServers.snapshot(tab.profileId)?.profile?.label ?: getString(R.string.native_tab_unavailable_host)
                val row = LinearLayout(this@WebClientActivity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
                val label = LinearLayout(this@WebClientActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    gravity = Gravity.CENTER_VERTICAL
                    minimumHeight = dp(64)
                    setPadding(dp(16), dp(8), dp(8), dp(8))
                    isClickable = true; isFocusable = true
                    contentDescription = getString(R.string.native_tab_select, name, NativeTabs.safePath(tab.path))
                    if (tab.id == tabs.selectedId) setBackgroundColor(0x224FC7AC)
                    addView(TextView(context).apply {
                        text = getString(R.string.native_tab_host_label, if (tab.id == tabs.selectedId) "✓ " else "", name)
                        textSize = 16f; setTextColor(Color.WHITE)
                        setTypeface(typeface, android.graphics.Typeface.BOLD)
                        maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END
                    })
                    addView(TextView(context).apply {
                        val path = NativeTabs.safePath(tab.path)
                        text = when {
                            tab.title !in setOf("Projects", "Yep Anywhere", "Yep Anywhere - Remote") -> tab.title
                            path == "/projects" -> getString(R.string.native_tab_projects)
                            else -> path
                        }
                        textSize = 13f; setTextColor(Color.LTGRAY)
                        maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END
                    })
                    setOnClickListener { dialog.dismiss(); tabs.select(tab.id); activateSelectedTab() }
                }
                row.addView(label, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                row.addView(Button(this@WebClientActivity, null, android.R.attr.borderlessButtonStyle).apply {
                    text = "×"; contentDescription = getString(R.string.native_tab_close, name)
                    setOnClickListener {
                        histories.remove(tab.id); tabs.close(tab.id); activateSelectedTab(); dialog.dismiss()
                        if (tabs.selected == null) showHostManagement() else showTabs()
                    }
                }, LinearLayout.LayoutParams(dp(48), dp(48)))
                list.addView(row)
            }
        }
        dialog.show()
    }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val callback = fileChooserCallback
        fileChooserCallback = null
        callback?.onReceiveValue(
            WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data),
        )
    }

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) {
        notificationOperations?.onPermissionResult()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        notificationOperations = NotificationNativeHostOperations(
            activity = this,
            statusReader = NotificationStatusReader(
                this,
                NotificationFoundation.installationStore(this),
            ),
            launchPermissionRequest = {
                notificationPermissionLauncher.launch(POST_NOTIFICATIONS_PERMISSION)
            },
        )
        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.rgb(24, 24, 24))
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val handled = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            val bars = insets.getInsets(handled)
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            // Native layout owns these edges. Forward zeroes, rather than
            // consuming the event, so WebView clears old safe areas and still
            // receives keyboard/visual-viewport updates.
            WindowInsetsCompat.Builder(insets).setInsets(handled, Insets.NONE).build()
        }

        shellRoot = root
        val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        pageRoot = FrameLayout(this)
        if (ownsTabs) {
            val toolbar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            hostLabel = TextView(this).apply {
                setText(R.string.app_name); textSize = 16f; setTextColor(Color.WHITE)
                gravity = Gravity.CENTER_VERTICAL
                setCompoundDrawablesWithIntrinsicBounds(R.drawable.native_host, 0, 0, 0)
                compoundDrawablePadding = dp(10)
                setPadding(dp(16), 0, dp(8), 0); maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END
                contentDescription = getString(R.string.native_switch_host); setOnClickListener { showHostManagement() }
            }
            toolbar.addView(hostLabel, LinearLayout.LayoutParams(0, dp(48), 1f))
            tabButton = Button(this).apply { text = "0"; textSize = 12f; setPadding(0, 0, 0, 0); setBackgroundResource(R.drawable.native_tab_count); setOnClickListener { showTabs() } }
            toolbar.addView(tabButton, LinearLayout.LayoutParams(dp(56), dp(48)))
            toolbar.addView(Button(this, null, android.R.attr.borderlessButtonStyle).apply { text = "+"; textSize = 24f; contentDescription = getString(R.string.native_tab_new); setOnClickListener { showHostManagement(newTab = true) } }, LinearLayout.LayoutParams(dp(48), dp(48)))
            column.addView(toolbar)
        }
        column.addView(pageRoot, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        root.addView(column)
        setContentView(root)

        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    val current = webView
                    if (current?.canGoBack() == true) {
                        current.goBack()
                    } else {
                        moveTaskToBack(true)
                    }
                }
            },
        )

        if (!ownsTabs) {
            activeProfileId = intent.getStringExtra(PROFILE_ID)
            val restoredPath = savedInstanceState?.getString(NATIVE_WEB_PATH)
            mountDocument(restoredPath?.let { config.origin + NativeTabs.safePath(it) } ?: consumeStartUrl())
        }
    }

    private fun mountDocument(url: String, history: Bundle? = null) {
        val clientView = createWebView()
        val errorView = createErrorView(clientView)
        transportErrorView = errorView
        pageRoot.addView(clientView, FrameLayout.LayoutParams(-1, -1))
        pageRoot.addView(errorView, FrameLayout.LayoutParams(-1, -1))
        clientView.webViewClient = createWebViewClient(errorView)
        if (config.bundled && activeProfileId != null && transportHost == null) {
            errorView.visibility = View.VISIBLE
            return
        }
        if (history == null || clientView.restoreState(history) == null) clientView.loadUrl(url)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        if (config.bundled && activeProfileId != null) {
            webView?.url?.takeIf { WebClientNavigation.decide(it, config.origin) == NavigationDecision.ALLOW_IN_APP }?.let {
                // Preserve native app navigation across recreation, without
                // persisting login fragments or query credentials in a Bundle.
                outState.putString(NATIVE_WEB_PATH, it.toUri().encodedPath)
            }
        }
        super.onSaveInstanceState(outState)
    }

    private fun consumeStartUrl(): String {
        val requestedUrl = intent.dataString
        intent.data = null
        return requestedUrl?.takeIf {
            WebClientNavigation.decide(it, config.origin) == NavigationDecision.ALLOW_IN_APP
        } ?: if (config.bundled && activeProfileId != null) "${config.origin}/projects" else config.startUrl
    }

    @Suppress("SetJavaScriptEnabled")
    private fun createWebView(): WebView {
        val view = WebView(this).apply {
            id = R.id.web_client
            setBackgroundColor(Color.rgb(24, 24, 24))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.javaScriptCanOpenWindowsAutomatically = false
            settings.setSupportMultipleWindows(ownsTabs)
            settings.builtInZoomControls = false
            settings.displayZoomControls = false
            if (WebViewFeature.isFeatureSupported(WebViewFeature.SAFE_BROWSING_ENABLE)) {
                WebSettingsCompat.setSafeBrowsingEnabled(settings, true)
            }
            CookieManager.getInstance().setAcceptCookie(true)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
            setOnLongClickListener { clicked ->
                val hit = hitTestResult
                val url = hit.extra
                if (ownsTabs && hit.type == WebView.HitTestResult.SRC_ANCHOR_TYPE && url != null &&
                    WebClientNavigation.decide(url, config.origin) == NavigationDecision.ALLOW_IN_APP) {
                    android.app.AlertDialog.Builder(this@WebClientActivity)
                        .setItems(arrayOf(getString(R.string.native_tab_open))) { _, _ -> if (clicked === webView) openTab(url, false) }.show()
                    true
                } else false
            }
            webChromeClient = object : WebChromeClient() {
                override fun onReceivedTitle(view: WebView, title: String?) {
                    if (view === webView) tabs.selected?.title = title?.take(160) ?: "Projects"
                }
                override fun onCreateWindow(view: WebView, dialog: Boolean, userGesture: Boolean, result: android.os.Message): Boolean {
                    if (!ownsTabs || !userGesture || view !== webView) return false
                    // This temporary resolver has no JavaScript, cookies configured by us,
                    // asset loader or native bridge. It never loads the destination.
                    val popup = WebView(this@WebClientActivity)
                    var finished = false
                    fun dispose() { if (!finished) { finished = true; popup.destroy() } }
                    popup.webViewClient = object : WebViewClient() {
                        override fun shouldInterceptRequest(v: WebView, request: WebResourceRequest): WebResourceResponse =
                            WebResourceResponse("text/plain", "utf-8", java.io.ByteArrayInputStream(ByteArray(0)))
                        override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                            if (!finished && request.isForMainFrame && view === webView) openTab(request.url.toString(), true)
                            v.post { dispose() }
                            return true
                        }
                    }
                    (result.obj as WebView.WebViewTransport).webView = popup
                    result.sendToTarget()
                    view.postDelayed({ dispose() }, 5000)
                    return true
                }

                override fun onShowFileChooser(
                    webView: WebView,
                    filePathCallback: ValueCallback<Array<Uri>>,
                    fileChooserParams: FileChooserParams,
                ): Boolean {
                    fileChooserCallback?.onReceiveValue(null)
                    fileChooserCallback = filePathCallback
                    return try {
                        fileChooserLauncher.launch(fileChooserParams.createIntent())
                        true
                    } catch (_: ActivityNotFoundException) {
                        fileChooserCallback = null
                        filePathCallback.onReceiveValue(null)
                        false
                    }
                }
            }
            setDownloadListener { url, _, _, _, _ ->
                openExternal(url)
            }
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        nativeHost = YaNativeMessageHost.install(
            view,
            config,
            checkNotNull(notificationOperations),
        )
        activeProfileId?.let { profileId ->
            transportHost = YaNativeTransportHost.install(view, config,
                (application as YepAnywhereApplication).nativeRuntime, profileId, onFatal = {
                    mainFrameFailed = true
                    transportErrorView?.visibility = View.VISIBLE
                }) {
                showHostManagement()
            }
        }
        transportHost?.setForeground(pageForeground && lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED))
        webView = view
        return view
    }

    private fun createErrorView(clientView: WebView): View {
        return LinearLayout(this).apply errorView@ {
            id = R.id.web_error
            visibility = View.GONE
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(48, 48, 48, 48)
            setBackgroundColor(Color.rgb(24, 24, 24))

            addView(TextView(context).apply {
                text = getString(R.string.web_client_unavailable)
                setTextColor(Color.WHITE)
                textSize = 18f
                gravity = Gravity.CENTER
            })
            addView(Button(context).apply {
                val unavailableTransport = config.bundled && activeProfileId != null && transportHost == null
                text = getString(if (unavailableTransport) R.string.back else R.string.retry)
                setOnClickListener {
                    if (unavailableTransport) finish()
                    else {
                        this@errorView.visibility = View.GONE
                        clientView.reload()
                    }
                }
            })
        }
    }

    private fun createWebViewClient(errorView: View): WebViewClient {
        val assetLoader = if (config.bundled) {
            WebViewAssetLoader.Builder()
                .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
                .build()
        } else {
            null
        }

        return object : WebViewClient() {
            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                if (view === webView && url != null && WebClientNavigation.decide(url, config.origin) == NavigationDecision.ALLOW_IN_APP) {
                    tabs.selected?.path = localPath(url)
                    persistTabs()
                }
            }

            override fun onPageStarted(
                view: WebView,
                url: String,
                favicon: Bitmap?,
            ) {
                if (view !== webView) return
                mainFrameFailed = false
                errorView.visibility = View.GONE
                nativeHost?.onDocumentChanged()
                transportHost?.onDocumentChanged()
            }

            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? {
                if (
                    assetLoader != null &&
                    request.isForMainFrame &&
                    WebClientNavigation.decide(request.url.toString(), config.origin) ==
                    NavigationDecision.ALLOW_IN_APP &&
                    request.url.lastPathSegment?.contains('.') != true
                ) {
                    return assetLoader.shouldInterceptRequest(
                        "${config.origin}/index.html".toUri(),
                    )
                }
                return assetLoader?.shouldInterceptRequest(request.url)
            }

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean {
                if (view !== webView) return true
                return when (
                    WebClientNavigation.decide(request.url.toString(), config.origin)
                ) {
                    NavigationDecision.ALLOW_IN_APP -> false
                    NavigationDecision.OPEN_EXTERNALLY -> {
                        openExternal(request.url.toString())
                        true
                    }
                    NavigationDecision.BLOCK -> true
                }
            }

            override fun onPageFinished(view: WebView, url: String) {
                if (view !== webView) return
                if (!mainFrameFailed) {
                    errorView.visibility = View.GONE
                }
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError,
            ) {
                if (view === webView && request.isForMainFrame) {
                    mainFrameFailed = true
                    errorView.visibility = View.VISIBLE
                }
            }

            override fun onReceivedHttpError(
                view: WebView,
                request: WebResourceRequest,
                errorResponse: WebResourceResponse,
            ) {
                if (view === webView && request.isForMainFrame) {
                    mainFrameFailed = true
                    errorView.visibility = View.VISIBLE
                }
            }

            override fun onRenderProcessGone(
                view: WebView,
                detail: RenderProcessGoneDetail,
            ): Boolean {
                if (view !== webView) { view.destroy(); return true }
                transportHost?.close()
                transportHost = null
                nativeHost?.destroy()
                nativeHost = null
                webView = null
                (view.parent as? ViewGroup)?.removeView(view)
                view.destroy()
                recreate()
                return true
            }
        }
    }

    private fun openExternal(url: String) {
        if (
            WebClientNavigation.decide(url, config.origin) !=
            NavigationDecision.OPEN_EXTERNALLY
        ) {
            return
        }
        try {
            startActivity(
                Intent(Intent.ACTION_VIEW, url.toUri()).apply {
                    addCategory(Intent.CATEGORY_BROWSABLE)
                },
            )
        } catch (_: ActivityNotFoundException) {
            // The navigation remains blocked inside the privileged WebView.
        }
    }

    private fun destroyDocument() {
        transportHost?.close()
        transportHost = null
        transportErrorView = null
        fileChooserCallback?.onReceiveValue(null)
        fileChooserCallback = null
        nativeHost?.destroy()
        nativeHost = null
        webView?.let { view ->
            (view.parent as? ViewGroup)?.removeView(view)
            view.stopLoading()
            view.destroy()
        }
        webView = null
    }

    override fun onDestroy() {
        destroyDocument()
        notificationOperations?.destroy()
        notificationOperations = null
        super.onDestroy()
    }

    override fun onStop() {
        persistTabs()
        transportHost?.setForeground(false)
        webView?.onPause()
        super.onStop()
    }

    override fun onStart() {
        super.onStart()
        webView?.onResume()
        transportHost?.setForeground(pageForeground)
    }

    override fun onUserInteraction() {
        super.onUserInteraction()
        notificationOperations?.recordUserInteraction()
    }

    companion object {
        const val PROFILE_ID = "nativeProfileId"
        private const val NATIVE_WEB_PATH = "nativeWebPath"
        private const val POST_NOTIFICATIONS_PERMISSION =
            "android.permission.POST_NOTIFICATIONS"
    }
}
