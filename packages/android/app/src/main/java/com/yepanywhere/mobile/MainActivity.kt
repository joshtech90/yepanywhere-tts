package com.yepanywhere.mobile

import android.content.Intent
import android.os.Bundle
import androidx.activity.viewModels
import androidx.core.net.toUri
import androidx.lifecycle.lifecycleScope
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import com.yepanywhere.mobile.links.AppLinkDestination
import com.yepanywhere.mobile.ui.YaHostManagementScreen
import com.yepanywhere.mobile.ui.YaHostManagementViewModel
import com.yepanywhere.mobile.ui.YaPairingInput
import com.yepanywhere.mobile.ui.theme.YepAnywhereTheme
import com.yepanywhere.mobile.web.WebClientActivity
import com.yepanywhere.mobile.web.WebClientConfig
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.Job
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.yepanywhere.mobile.notifications.NativePushPresenter
import com.yepanywhere.mobile.notifications.NotificationFoundation
import com.yepanywhere.mobile.notifications.NotificationStatusReader

class MainActivity : WebClientActivity() {
    override val ownsTabs get() = config.bundled
    private var managementView: androidx.compose.ui.platform.ComposeView? = null
    private var createNewTab = false
    private var initialized = false
    private lateinit var managementBack: androidx.activity.OnBackPressedCallback
    private val homeViewModel by viewModels<YaHostManagementViewModel>()
    private var launchJob: Job? = null
    private var pendingPushProfile: String? = null
    private val pushPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val profile = pendingPushProfile
        pendingPushProfile = null
        if (granted && profile != null) homeViewModel.setPush(profile, true)
    }
    private fun enablePush(profileId: String) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            pendingPushProfile = profileId
            NotificationStatusReader(this, NotificationFoundation.installationStore(this)).markPermissionRequested()
            pushPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else homeViewModel.setPush(profileId, true)
    }
    // App Link credentials are transient visible UI state, never a ViewModel
    // value or saved-instance state.
    private var pairingInput by mutableStateOf<YaPairingInput?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        pendingPushProfile = savedInstanceState?.getString("pendingPushProfile")
        managementBack = object : androidx.activity.OnBackPressedCallback(false) {
            override fun handleOnBackPressed() { hideManagement() }
        }
        onBackPressedDispatcher.addCallback(this, managementBack)
        lifecycleScope.launch {
            homeViewModel.openProfile.collect {
                pairingInput = null
                if (ownsTabs) { openProfile(it, newTab = createNewTab); hideManagement() }
                else startWebClient(null, it)
            }
        }
        lifecycleScope.launch {
            val runtime = (application as YepAnywhereApplication).nativeRuntime
            val list = runtime.pairedServers.listState.first()
            if (ownsTabs) restoreTabs(list.profiles.map { it.id }.toSet())
            initialized = true
            routeLaunch(intent)
            runtime.pairedServers.listState.collect { current ->
                retainTabProfiles(current.profiles.map { it.id }.toSet())
                if (!hasSelectedTab) showHostManagement()
            }
        }
    }

    override fun showHostManagement(newTab: Boolean) {
        createNewTab = newTab
        if (newTab && homeViewModel.state.value.profiles.isNotEmpty()) {
            val profiles = homeViewModel.state.value.profiles.toList()
            android.app.AlertDialog.Builder(this).setTitle(R.string.native_tab_new)
                .setItems(profiles.map { it.label }.toTypedArray()) { _, index ->
                    openProfile(profiles[index].id, newTab = true)
                }.setNeutralButton(R.string.native_tab_add_host) { _, _ -> showManagementScreen() }
                .setNegativeButton(android.R.string.cancel, null).show()
            return
        }
        showManagementScreen()
    }

    private fun showManagementScreen() {
        if (managementView != null) return
        managementBack.isEnabled = hasSelectedTab
        setPageForeground(false)
        managementView = androidx.compose.ui.platform.ComposeView(this).apply {
            setContent {
                YepAnywhereTheme {
                    YaHostManagementScreen(
                        viewModel = homeViewModel,
                        pairingInput = pairingInput,
                        onClearPairingInput = { pairingInput = null },
                        onEnablePush = ::enablePush,
                    )
                }
            }
            shellRoot.addView(this, android.widget.FrameLayout.LayoutParams(-1, -1))
        }
    }

    private fun hideManagement() {
        managementView?.let { shellRoot.removeView(it); it.disposeComposition() }
        managementView = null
        managementBack.isEnabled = false
        createNewTab = false
        setPageForeground(true)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        pendingPushProfile?.let { outState.putString("pendingPushProfile", it) }
        super.onSaveInstanceState(outState)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (initialized) routeLaunch(intent)
    }

    private fun routeLaunch(intent: Intent) {
        launchJob?.cancel()
        val subscription = intent.getStringExtra(NativePushPresenter.SUBSCRIPTION_EXTRA)
        if (subscription != null) {
            val session = intent.getStringExtra(NativePushPresenter.SESSION_EXTRA)?.takeIf { Regex("^[A-Za-z0-9_-]{1,128}$").matches(it) }
            intent.removeExtra(NativePushPresenter.SUBSCRIPTION_EXTRA)
            intent.removeExtra(NativePushPresenter.SESSION_EXTRA)
            launchJob = lifecycleScope.launch {
                val runtime = (application as YepAnywhereApplication).nativeRuntime
                val binding = NativePushPresenter.destination(runtime, subscription) ?: return@launch
                val lease = runtime.connectionManager(binding.profileId).acquire()
                try {
                    lease.request("GET", "/version")
                    if (NativePushPresenter.destination(runtime, subscription) == null) return@launch
                    runtime.pairedServers.select(binding.profileId)
                    val path = session?.let {
                        (lease.request("GET", "/security/clients/${binding.clientId}/native-push-subscription/destination?sessionId=$it").body as? org.json.JSONObject)?.optString("path")?.takeIf { path -> Regex("^/projects/[A-Za-z0-9_-]{1,2048}/sessions/[A-Za-z0-9_-]{1,128}$").matches(path) }
                    }
                    startWebClient(path?.let { WebClientConfig.fromBuild().origin + it }, binding.profileId)
                } catch (error: kotlinx.coroutines.CancellationException) {
                    throw error
                } catch (_: Exception) {
                    // Expired/revoked hosts stay in native management for recovery.
                } finally { kotlinx.coroutines.withContext(kotlinx.coroutines.NonCancellable) { lease.releaseAndAwait() } }
            }
            return
        }
        if (intent.getBooleanExtra(SHOW_HOSTS, false)) {
            intent.removeExtra(SHOW_HOSTS)
            showHostManagement()
            return
        }
        if (WebClientConfig.fromBuild().bundled) {
            val pairingLink = AppLinkDestination.toNativePairingLink(intent.action, intent.dataString)
            if (pairingLink != null) {
                intent.data = null
                pairingInput = YaPairingInput(pairingLink.username, pairingLink.password, relayWebsocketUrl = pairingLink.relayWebsocketUrl)
                showHostManagement()
                return
            }
            // A malformed pairing link must never fall through to web login.
            if (intent.action == Intent.ACTION_VIEW && intent.data != null) {
                intent.data = null
                return
            }
        }
        if (hasSelectedTab && intent.action != Intent.ACTION_VIEW) return
        val requestedUrl = AppLinkDestination.toWebClientUrlForIntent(
            action = intent.action,
            appLink = intent.dataString,
            clientStartUrl = WebClientConfig.fromBuild().startUrl,
        )
        intent.data = null
        launchJob = lifecycleScope.launch {
            val list = (application as YepAnywhereApplication).nativeRuntime.pairedServers.listState.first()
            val profileId = list.selectedProfileId ?: list.profiles.firstOrNull()?.id
            if (profileId != null) startWebClient(requestedUrl, profileId)
            else if (!WebClientConfig.fromBuild().bundled && requestedUrl != null) startWebClient(requestedUrl, null)
            else showHostManagement()
        }
    }

    private fun startWebClient(requestedUrl: String?, profileId: String?) {
        if (profileId != null && config.bundled) {
            openProfile(profileId, requestedUrl)
            hideManagement()
        } else {
            startActivity(Intent(this, WebClientActivity::class.java).apply { if (requestedUrl != null) data = requestedUrl.toUri() })
        }
    }

    companion object { const val SHOW_HOSTS = "showHosts" }
}
