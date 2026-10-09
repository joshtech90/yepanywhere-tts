package com.yepanywhere.mobile.web

import android.Manifest
import android.app.Activity
import android.app.Instrumentation.ActivityResult
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Build
import android.webkit.WebView
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsetsController
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import android.webkit.WebViewClient
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.espresso.intent.Intents
import androidx.test.espresso.intent.Intents.intending
import androidx.test.espresso.intent.matcher.IntentMatchers.hasAction
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.StaleObjectException
import androidx.test.uiautomator.UiDevice
import com.yepanywhere.mobile.R
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WebClientActivityTest {
    @Test
    fun darkNativeSystemBarsKeepLightIconsAfterRecreation() {
        ActivityScenario.launch(WebClientActivity::class.java).use { scenario ->
            repeat(2) { generation ->
                scenario.onActivity { activity ->
                    // Inspect the framework result: unused AndroidX test-only
                    // helpers can be removed from the minified target APK.
                    val lightBarAppearance = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        checkNotNull(activity.window.insetsController).systemBarsAppearance and
                            (WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS)
                    } else {
                        @Suppress("DEPRECATION")
                        (activity.window.decorView.systemUiVisibility and
                            (View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR))
                    }
                    assertEquals("Dark native insets need light foreground icons in every system theme", 0, lightBarAppearance)
                }
                if (generation == 0) scenario.recreate()
            }
        }
    }

    @Test
    fun systemBarsAndCutoutAreAppliedOnceWithoutConsumingKeyboardInsets() {
        launchClient().use { scenario ->
            scenario.onActivity { activity ->
                val root = activity.findViewById<ViewGroup>(android.R.id.content).getChildAt(0)
                val handled = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
                for (bars in listOf(Insets.of(0, 45, 0, 24), Insets.of(36, 0, 0, 48))) {
                    val original = WindowInsetsCompat.Builder()
                        .setInsets(handled, bars)
                        .setInsets(WindowInsetsCompat.Type.ime(), Insets.of(0, 0, 0, 320))
                        .build()
                    val forwarded = ViewCompat.dispatchApplyWindowInsets(root, original)
                    assertEquals(bars, Insets.of(root.paddingLeft, root.paddingTop, root.paddingRight, root.paddingBottom))
                    assertEquals(Insets.NONE, forwarded.getInsets(handled))
                    assertEquals(320, forwarded.getInsets(WindowInsetsCompat.Type.ime()).bottom)
                }
                ViewCompat.requestApplyInsets(root)
            }
        }
    }

    @Test
    fun nativeHostDescribesAndroidOverWebMessage() {
        launchClient().use { scenario ->
            awaitJavaScript(scenario, "document.readyState", "\"complete\"")
            assertEquals("\"object\"", evaluateJavaScript(scenario, "typeof window.yaNative"))

            postNativeMethod(scenario, "device-test", "host.describe")

            awaitJavaScript(
                scenario,
                """
                window.__yaNativeTestResponse === null
                  ? "pending"
                  : JSON.parse(window.__yaNativeTestResponse).result.platform
                """.trimIndent(),
                "\"android\"",
            )
            awaitJavaScript(
                scenario,
                """
                JSON.parse(window.__yaNativeTestResponse).result.features.join(",")
                """.trimIndent(),
                "\"notifications.status,notifications.requestPermission\"",
            )
        }
    }

    @Test
    fun notificationStatusIsBoundedAndPermissionRequiresUserAction() {
        launchClient().use { scenario ->
            awaitJavaScript(scenario, "document.readyState", "\"complete\"")
            requestNativeMethod(scenario, "notification-status", "notifications.status")
            awaitJavaScript(
                scenario,
                """
                (() => {
                  const response = JSON.parse(window.__yaNativeTestResponse);
                  const result = response.result;
                  return response.ok &&
                    Object.keys(result).sort().join(",") ===
                      "channel,firebase,installation,notificationsEnabled,permission" &&
                    !("installationId" in result) &&
                    !("installationSecret" in result) &&
                    !("fid" in result);
                })()
                """.trimIndent(),
                "true",
            )

            requestNativeMethod(
                scenario,
                "permission-without-action",
                "notifications.requestPermission",
            )
            awaitJavaScriptOneOf(
                scenario,
                """
                (() => {
                  const response = JSON.parse(window.__yaNativeTestResponse);
                  return response.ok ? response.result.permission : response.error.code;
                })()
                """.trimIndent(),
                setOf("\"granted\"", "\"user_action_required\""),
            )
        }
    }

    @Test
    fun recentUserActionCanResolveNotificationPermission() {
        val permissionDevice = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            resetNotificationPermission()
        } else {
            null
        }
        launchClient().use { scenario ->
            awaitJavaScript(scenario, "document.readyState", "\"complete\"")
            scenario.onActivity { activity -> activity.onUserInteraction() }
            postNativeMethod(
                scenario,
                "permission-with-action",
                "notifications.requestPermission",
            )

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                val device = checkNotNull(permissionDevice)
                grantNotificationPermission(device)
                awaitJavaScript(
                    scenario,
                    """
                    (() => {
                      if (window.__yaNativeTestResponse === null) return "pending";
                      const response = JSON.parse(window.__yaNativeTestResponse);
                      return response.ok ? response.result.permission : response.error.code;
                    })()
                    """.trimIndent(),
                    "\"granted\"",
                )
            } else {
                awaitJavaScript(
                    scenario,
                    """
                    JSON.parse(window.__yaNativeTestResponse).result.permission
                    """.trimIndent(),
                    "\"not_required\"",
                )
            }
        }
    }

    @Test
    fun nativeHostIsAbsentFromAnUnapprovedOrigin() {
        launchClient().use { scenario ->
            awaitJavaScript(scenario, "document.readyState", "\"complete\"")
            scenario.onActivity { activity ->
                activity.findViewById<WebView>(R.id.web_client).apply {
                    webViewClient = WebViewClient()
                    loadDataWithBaseURL(
                        "https://untrusted.example/",
                        "<html><body>untrusted</body></html>",
                        "text/html",
                        Charsets.UTF_8.name(),
                        null,
                    )
                }
            }

            awaitJavaScript(
                scenario,
                "document.body.textContent",
                "\"untrusted\"",
            )
            assertEquals(
                "\"undefined\"",
                evaluateJavaScript(scenario, "typeof window.yaNative"),
            )
        }
    }

    @Test
    fun nativeHostDoesNotReplyToASubframe() {
        launchClient().use { scenario ->
            awaitJavaScript(scenario, "document.readyState", "\"complete\"")
            evaluateJavaScript(
                scenario,
                """
                window.__yaNativeFrameReady = "pending";
                const frame = document.createElement("iframe");
                frame.id = "ya-native-test-frame";
                frame.srcdoc = "<!doctype html><html><body>frame</body></html>";
                frame.addEventListener("load", () => {
                  window.__yaNativeFrameReady =
                    frame.contentDocument?.readyState ?? "missing";
                }, { once: true });
                document.body.appendChild(frame);
                true;
                """.trimIndent(),
            )
            awaitJavaScript(
                scenario,
                "window.__yaNativeFrameReady",
                "\"complete\"",
            )
            evaluateJavaScript(
                scenario,
                """
                window.__yaNativeFrameResult = "pending";
                const channel = document.getElementById("ya-native-test-frame")
                  .contentWindow.yaNative;
                if (!channel) {
                  window.__yaNativeFrameResult = "absent";
                } else {
                  channel.onmessage = () => {
                    window.__yaNativeFrameResult = "reply";
                  };
                  channel.postMessage(
                    '{"protocol":1,"id":"frame-test","method":"host.describe"}'
                  );
                  setTimeout(() => {
                    if (window.__yaNativeFrameResult === "pending") {
                      window.__yaNativeFrameResult = "no-reply";
                    }
                  }, 1000);
                }
                true;
                """.trimIndent(),
            )

            awaitJavaScriptOneOf(
                scenario,
                "window.__yaNativeFrameResult",
                setOf("\"absent\"", "\"no-reply\""),
            )
            assertEquals(
                "false",
                evaluateJavaScript(
                    scenario,
                    "window.__yaNativeFrameResult === 'reply'",
                ),
            )
        }
    }

    @Test
    fun activityRecreationRestoresTheClientAndNativeHost() {
        launchClient().use { scenario ->
            awaitJavaScript(scenario, "document.readyState", "\"complete\"")

            scenario.recreate()

            awaitJavaScript(scenario, "document.readyState", "\"complete\"")
            assertEquals("\"object\"", evaluateJavaScript(scenario, "typeof window.yaNative"))
            requestHostDescription(scenario, "recreated-document")
        }
    }

    @Test
    fun rotationRestoresTheClientAndNativeHost() {
        launchClient().use { scenario ->
            awaitJavaScript(scenario, "document.readyState", "\"complete\"")
            try {
                scenario.onActivity { activity ->
                    activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
                }
                awaitOrientation(scenario, Configuration.ORIENTATION_LANDSCAPE)
                awaitJavaScript(scenario, "document.readyState", "\"complete\"")
                awaitJavaScript(scenario, "typeof window.yaNative", "\"object\"")
                requestHostDescription(scenario, "rotated-document")
            } finally {
                scenario.onActivity { activity ->
                    activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                }
                awaitOrientation(scenario, Configuration.ORIENTATION_PORTRAIT)
            }
        }
    }

    @Test
    fun backNavigatesWebHistoryBeforeFinishingTheActivity() {
        launchClient().use { scenario ->
            awaitJavaScript(scenario, "document.readyState", "\"complete\"")
            awaitJavaScript(scenario, "window.location.pathname", "\"/login\"")
            val initialUrl = evaluateJavaScript(scenario, "window.location.href")
            scenario.onActivity { activity ->
                activity.findViewById<WebView>(R.id.web_client).loadUrl(
                    "https://appassets.androidplatform.net/login/direct" +
                        "?android-history-contract=1",
                )
            }
            awaitJavaScript(
                scenario,
                "window.location.pathname",
                "\"/login/direct\"",
            )
            awaitJavaScript(scenario, "document.readyState", "\"complete\"")
            awaitWebViewCondition(
                scenario,
                "WebView history did not include the direct-login page",
            ) { view ->
                view.canGoBack()
            }

            scenario.onActivity { activity ->
                activity.onBackPressedDispatcher.onBackPressed()
            }

            awaitJavaScript(scenario, "window.location.href", initialUrl)
            assertEquals(Lifecycle.State.RESUMED, scenario.state)
        }
    }

    @Test
    fun externalHttpsNavigationLeavesThePrivilegedWebView() {
        Intents.init()
        try {
            intending(hasAction(Intent.ACTION_VIEW)).respondWith(
                ActivityResult(Activity.RESULT_OK, null),
            )
            launchClient().use { scenario ->
                awaitJavaScript(scenario, "document.readyState", "\"complete\"")
                evaluateJavaScript(
                    scenario,
                    "window.location.href = 'https://example.com/android-contract'; true",
                )

                awaitExternalIntent("https://example.com/android-contract")
                assertEquals(
                    "\"https://appassets.androidplatform.net\"",
                    evaluateJavaScript(scenario, "window.location.origin"),
                )
            }
        } finally {
            Intents.release()
        }
    }

    private fun launchClient(): ActivityScenario<WebClientActivity> {
        // Control-plane tests have no native profile. Start at the stable login
        // route so a / -> /login redirect cannot discard the test's reply state.
        // Activity consumes/clears Intent.data, which ActivityScenario uses
        // for lifecycle matching. Load the route after its launch instead.
        val scenario = ActivityScenario.launch(WebClientActivity::class.java)
        scenario.onActivity { activity ->
            activity.findViewById<WebView>(R.id.web_client).apply {
                stopLoading()
                loadUrl("${WebClientConfig.fromBuild().origin}/login")
            }
        }
        awaitJavaScript(scenario, "location.pathname === '/login' && document.readyState === 'complete'", "true")
        return scenario
    }

    private fun requestHostDescription(
        scenario: ActivityScenario<WebClientActivity>,
        requestId: String,
    ) {
        postNativeMethod(scenario, requestId, "host.describe")
        awaitJavaScript(
            scenario,
            """
            window.__yaNativeTestResponse === null
              ? "pending"
              : JSON.parse(window.__yaNativeTestResponse).result.platform
            """.trimIndent(),
            "\"android\"",
        )
    }

    private fun requestNativeMethod(
        scenario: ActivityScenario<WebClientActivity>,
        requestId: String,
        method: String,
    ) {
        postNativeMethod(scenario, requestId, method)
        awaitJavaScriptOneOf(
            scenario,
            "window.__yaNativeTestResponse === null ? 'pending' : 'ready'",
            setOf("\"ready\""),
        )
    }

    private fun postNativeMethod(
        scenario: ActivityScenario<WebClientActivity>,
        requestId: String,
        method: String,
    ) {
        // The web client binds yaNative.onmessage for its own requests once its
        // app chunk loads, which can follow document completion. Listen
        // alongside it and keep only this request's reply.
        evaluateJavaScript(
            scenario,
            """
            window.__yaNativeTestResponse = null;
            window.yaNative.addEventListener("message", (event) => {
              try {
                if (JSON.parse(event.data).id !== ${jsonString(requestId)}) return;
              } catch {
                return;
              }
              window.__yaNativeTestResponse = event.data;
            });
            window.yaNative.postMessage(
              JSON.stringify({
                protocol: 1,
                id: ${jsonString(requestId)},
                method: ${jsonString(method)}
              })
            );
            true;
            """.trimIndent(),
        )
    }

    private fun jsonString(value: String): String {
        return org.json.JSONObject.quote(value)
    }

    private fun resetNotificationPermission(): UiDevice {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val device = UiDevice.getInstance(instrumentation)
        val packageName = instrumentation.targetContext.packageName
        val permission = Manifest.permission.POST_NOTIFICATIONS
        instrumentation.uiAutomation.revokeRuntimePermission(packageName, permission)
        device.executeShellCommand(
            "pm clear-permission-flags $packageName $permission user-set user-fixed",
        )
        return device
    }

    private fun grantNotificationPermission(device: UiDevice) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val targetContext = instrumentation.targetContext
        val permission = Manifest.permission.POST_NOTIFICATIONS
        val allowButtonSelector = By.res(
            "com.android.permissioncontroller:id/permission_allow_button",
        )
        val startedAt = System.nanoTime()
        val accessibilityFallbackAt = startedAt + TimeUnit.SECONDS.toNanos(5)
        val deadline = startedAt + TimeUnit.SECONDS.toNanos(30)
        var clickAttempts = 0
        var nextClickAt = 0L
        var nextDialogProbeAt = 0L
        var permissionDialogSeen = false
        var accessibilityFallbackUsed = false

        while (System.nanoTime() < deadline) {
            if (targetContext.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) {
                return
            }

            val now = System.nanoTime()
            if (!permissionDialogSeen && now >= nextDialogProbeAt) {
                permissionDialogSeen = isPermissionDialogResumed(device)
                nextDialogProbeAt = now + TimeUnit.MILLISECONDS.toNanos(500)
            }
            val allowButton = device.findObject(allowButtonSelector)
            if (allowButton != null && now >= nextClickAt) {
                try {
                    allowButton.click()
                    clickAttempts += 1
                    nextClickAt = now + TimeUnit.SECONDS.toNanos(1)
                } catch (_: StaleObjectException) {
                    // The permission controller replaced its accessibility tree; retry the live node.
                }
            }
            if (
                !accessibilityFallbackUsed &&
                clickAttempts == 0 &&
                permissionDialogSeen &&
                now >= accessibilityFallbackAt
            ) {
                // Some API 35 emulator boots render the real permission activity while
                // UiAutomator retains the app's stale accessibility tree. Complete that
                // already-observed OS request without depending on the missing button node.
                instrumentation.uiAutomation.grantRuntimePermission(
                    targetContext.packageName,
                    permission,
                )
                accessibilityFallbackUsed = true
                if (isPermissionDialogResumed(device)) {
                    device.pressBack()
                }
            }
            Thread.sleep(100)
        }

        throw AssertionError(
            "Android did not grant notification permission after $clickAttempts Allow attempts " +
                "(dialogSeen=$permissionDialogSeen, fallbackUsed=$accessibilityFallbackUsed)",
        )
    }

    private fun isPermissionDialogResumed(device: UiDevice): Boolean {
        return device.executeShellCommand("dumpsys activity activities")
            .lineSequence()
            .any { line ->
                (line.contains("mResumedActivity") || line.contains("topResumedActivity")) &&
                    line.contains("GrantPermissionsActivity")
            }
    }

    private fun awaitOrientation(
        scenario: ActivityScenario<WebClientActivity>,
        expected: Int,
    ) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
        var actual = Configuration.ORIENTATION_UNDEFINED
        while (System.nanoTime() < deadline) {
            scenario.onActivity { activity ->
                actual = activity.resources.configuration.orientation
            }
            if (actual == expected) {
                return
            }
            Thread.sleep(100)
        }
        assertEquals(expected, actual)
    }

    private fun awaitExternalIntent(expectedUrl: String) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
        var matched = false
        while (System.nanoTime() < deadline) {
            matched = Intents.getIntents().any { intent ->
                intent.action == Intent.ACTION_VIEW && intent.dataString == expectedUrl
            }
            if (matched) {
                return
            }
            Thread.sleep(100)
        }
        assertTrue("External VIEW intent was not recorded", matched)
    }

    private fun awaitWebViewCondition(
        scenario: ActivityScenario<WebClientActivity>,
        failureMessage: String,
        condition: (WebView) -> Boolean,
    ) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
        var matched = false
        while (System.nanoTime() < deadline) {
            scenario.onActivity { activity ->
                matched = condition(activity.findViewById(R.id.web_client))
            }
            if (matched) {
                return
            }
            Thread.sleep(100)
        }
        assertTrue(failureMessage, matched)
    }

    private fun awaitJavaScript(
        scenario: ActivityScenario<WebClientActivity>,
        script: String,
        expected: String,
    ) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
        var actual = ""
        while (System.nanoTime() < deadline) {
            actual = evaluateJavaScriptOrNull(scenario, script, 1) ?: "<no callback>"
            if (actual == expected) {
                return
            }
            Thread.sleep(100)
        }
        assertEquals(expected, actual)
    }

    private fun awaitJavaScriptOneOf(
        scenario: ActivityScenario<WebClientActivity>,
        script: String,
        expected: Set<String>,
    ) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
        var actual = ""
        while (System.nanoTime() < deadline) {
            actual = evaluateJavaScriptOrNull(scenario, script, 1) ?: "<no callback>"
            if (actual in expected) {
                return
            }
            Thread.sleep(100)
        }
        assertTrue("Expected one of $expected but was $actual", actual in expected)
    }

    private fun evaluateJavaScript(
        scenario: ActivityScenario<WebClientActivity>,
        script: String,
    ): String {
        return evaluateJavaScriptOrNull(scenario, script, 5)
            ?: throw AssertionError("JavaScript evaluation timed out")
    }

    private fun evaluateJavaScriptOrNull(
        scenario: ActivityScenario<WebClientActivity>,
        script: String,
        timeoutSeconds: Long,
    ): String? {
        val result = AtomicReference<String>()
        val completed = CountDownLatch(1)
        scenario.onActivity { activity ->
            activity.findViewById<WebView>(R.id.web_client).evaluateJavascript(script) { value ->
                result.set(value)
                completed.countDown()
            }
        }
        return if (completed.await(timeoutSeconds, TimeUnit.SECONDS)) {
            result.get()
        } else {
            null
        }
    }
}
