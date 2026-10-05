package com.yepanywhere.mobile.notifications

import android.app.NotificationManager
import android.content.Intent
import com.yepanywhere.mobile.MainActivity
import java.io.File
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.yepanywhere.mobile.BuildConfig
import com.yepanywhere.mobile.YepAnywhereApplication
import com.yepanywhere.mobile.connection.YaServerConnectionManager
import com.yepanywhere.mobile.profiles.YaServerRoute
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Opt-in real Firebase acceptance. It preserves existing saved hosts. */
@RunWith(AndroidJUnit4::class)
class NativePushLiveInstrumentedTest {
    @Test fun realDeliveryIsPerHostAndTapResumesBeforeOpeningSession() = runBlocking {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue("Live push uses private Firebase setup and disposable fixtures", args.getString("yaNativePushLive") == "true" && BuildConfig.FIREBASE_CONFIGURED)
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val runtime = (context.applicationContext as YepAnywhereApplication).nativeRuntime
        val previous = runtime.pairedServers.listState.first().selectedProfileId
        val profiles = mutableListOf<String>()
        val managers = mutableListOf<YaServerConnectionManager>()
        val notificationManager = context.getSystemService(NotificationManager::class.java)
        val http = OkHttpClient()
        var firstSubscription: String? = null
        var secondSubscription: String? = null
        try {
            // Earlier physical FCM registration completed in under 10 s.
            // 40 s is 4x that observed live-device startup maximum.
            withTimeout(40_000) {
                while (NotificationFoundation.installationStore(context).read()?.targetCurrent != true) delay(100)
            }
            for ((endpointKey, username) in listOf("yaProbeWsUrl" to "ios-fixture", "yaProbeSecondWsUrl" to "rust-beta")) {
                val profile = withTimeout(30_000) { runtime.pairing.pair("Push acceptance $username", username, "native-fixture-password", YaServerRoute.direct(checkNotNull(args.getString(endpointKey)))) }
                profiles += profile.id
                managers += runtime.connectionManager(profile.id)
                withTimeout(30_000) { runtime.nativePush.enable(profile.id) }
                assertTrue(runtime.nativePush.enabled(profile.id))
            }
            val first = checkNotNull(runtime.nativePush.bindings.get(profiles[0]))
            val second = checkNotNull(runtime.nativePush.bindings.get(profiles[1]))
            firstSubscription = first.subscriptionId; secondSubscription = second.subscriptionId
            assertNotEquals(first.subscriptionId, second.subscriptionId)
            val device = UiDevice.getInstance(instrumentation)
            context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra(MainActivity.SHOW_HOSTS, true))
            assertTrue(device.wait(Until.hasObject(By.text(context.getString(com.yepanywhere.mobile.R.string.native_push_enabled))), 5_000))
            assertTrue(device.wait(Until.hasObject(By.text(context.getString(com.yepanywhere.mobile.R.string.native_push_disable))), 5_000))
            assertTrue(device.takeScreenshot(File(context.getExternalFilesDir(null), "native-push-hosts.png")))
            NativePushPresenter.foreground = true
            withTimeout(30_000) { runtime.nativePush.test(profiles[0]) }
            // Broker submission and real FCM delivery are different assertions.
            withTimeout(40_000) { while (notificationManager.activeNotifications.none { it.tag == "${first.subscriptionId}:host" }) delay(100) }
            assertFalse(NativePushPresenter.present(context, runtime, mapOf("intent" to "approval_required", "subscriptionId" to "x".repeat(22), "test" to "true", "url" to "https://attacker.invalid")))
            val secondBefore = runtime.pairedServers.snapshot(profiles[1])?.resumeCredential?.credential
            device.pressHome()
            NativePushPresenter.foreground = false
            val base = checkNotNull(args.getString("yaProbeWsUrl")).replace("ws://", "http://").removeSuffix("/api/ws")
            val result = http.newCall(Request.Builder().url("$base/__probe/push").post(ByteArray(0).toRequestBody()).build()).execute().use { response ->
                assertEquals(200, response.code); JSONObject(checkNotNull(response.body).string())
            }
            assertEquals(1, result.getInt("sent"))
            val secondBase = checkNotNull(args.getString("yaProbeSecondWsUrl")).replace("ws://", "http://").removeSuffix("/api/ws")
            http.newCall(Request.Builder().url("$secondBase/__probe/push").post(ByteArray(0).toRequestBody()).build()).execute().use { response ->
                assertEquals(200, response.code); assertEquals(1, JSONObject(checkNotNull(response.body).string()).getInt("sent"))
            }
            withTimeout(40_000) { while (notificationManager.activeNotifications.none { it.tag == "${second.subscriptionId}:android-preview-session" }) delay(100) }
            val session = result.getString("sessionId")
            val tag = "${first.subscriptionId}:$session"
            val delivered = withTimeout(40_000) {
                var found = notificationManager.activeNotifications.firstOrNull { it.tag == tag }
                while (found == null) { delay(100); found = notificationManager.activeNotifications.firstOrNull { it.tag == tag } }
                found
            }
            assertEquals(context.getString(com.yepanywhere.mobile.R.string.push_completed), delivered.notification.extras.getCharSequence("android.text").toString())
            val dedupePayload = mapOf("intent" to "input_required", "subscriptionId" to first.subscriptionId, "test" to "true", "eventId" to "native-push-dedupe-proof")
            assertTrue(NativePushPresenter.present(context, runtime, dedupePayload))
            assertFalse(NativePushPresenter.present(context, runtime, dedupePayload))
            delivered.notification.contentIntent.send()
            assertTrue("Native push tap did not open the authenticated YA session", device.wait(Until.hasObject(By.textContains("Preview message 50")), 30_000))
            assertTrue(device.takeScreenshot(File(context.getExternalFilesDir(null), "native-push-session.png")))
            assertEquals(profiles[0], runtime.pairedServers.listState.first().selectedProfileId)
            assertEquals(secondBefore, runtime.pairedServers.snapshot(profiles[1])?.resumeCredential?.credential)
            withTimeout(30_000) { runtime.nativePush.disable(profiles[0]) }
            assertFalse(runtime.nativePush.enabled(profiles[0])); assertTrue(runtime.nativePush.enabled(profiles[1]))
            assertNull(NativePushPresenter.destination(runtime, first.subscriptionId))
            runtime.pairedServers.markSecurityClientRevoked(profiles[1], second.clientId)
            assertNull(NativePushPresenter.destination(runtime, second.subscriptionId))
        } finally {
            for (id in profiles) {
                runtime.nativePush.forget(id)
                runtime.pairedServers.forget(id)
            }
            firstSubscription?.let { id -> notificationManager.activeNotifications.filter { it.tag?.startsWith("$id:") == true }.forEach { notificationManager.cancel(it.tag, it.id) } }
            secondSubscription?.let { id -> notificationManager.activeNotifications.filter { it.tag?.startsWith("$id:") == true }.forEach { notificationManager.cancel(it.tag, it.id) } }
            if (previous != null && runtime.pairedServers.snapshot(previous) != null) runtime.pairedServers.select(previous)
            managers.forEach { it.shutdownAndAwait() }
            http.connectionPool.evictAll(); http.dispatcher.executorService.shutdown()
        }
    }
}
