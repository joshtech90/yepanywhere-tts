package com.yepanywhere.mobile.notifications

import android.content.Context
import android.os.Bundle
import androidx.core.content.edit
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.yepanywhere.mobile.BuildConfig
import com.yepanywhere.mobile.YepAnywhereApplication
import com.yepanywhere.mobile.profiles.YaServerRoute
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Separate invocations allow the controller to remove the app process between tests. */
@RunWith(AndroidJUnit4::class)
class NativePushHeadlessInstrumentedTest {
    @Test fun prepare() = runBlocking {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val args = InstrumentationRegistry.getArguments()
        assumeTrue(args.getString("yaNativePushLive") == "true" && BuildConfig.FIREBASE_CONFIGURED)
        val context = instrumentation.targetContext
        val runtime = (context.applicationContext as YepAnywhereApplication).nativeRuntime
        val state = context.getSharedPreferences(STATE, Context.MODE_PRIVATE)
        check(!state.contains("profile")) { "Clean the previous owned headless fixture first" }
        val previous = runtime.pairedServers.listState.first().selectedProfileId
        val profile = withTimeout(30_000) { runtime.pairing.pair("Headless push acceptance", "ios-fixture", "native-fixture-password", YaServerRoute.direct(checkNotNull(args.getString("yaProbeWsUrl")))) }
        var prepared = false
        try {
            withTimeout(30_000) { runtime.nativePush.enable(profile.id) }
            val binding = checkNotNull(runtime.nativePush.bindings.get(profile.id))
            state.edit(commit = true) { putString("profile", profile.id); putString("previous", previous); putString("subscription", binding.subscriptionId) }
            // Public opaque routing metadata only; no installation/send secret.
            instrumentation.sendStatus(0, Bundle().apply { putString("nativePushPrepared", JSONObject().put("subscriptionId", binding.subscriptionId).toString()) })
            prepared = true
        } finally {
            if (!prepared) { runtime.nativePush.forget(profile.id); runtime.pairedServers.forget(profile.id) }
        }
    }
    @Test fun cleanup() = runBlocking {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue(args.getString("yaNativePushLive") == "true" && BuildConfig.FIREBASE_CONFIGURED)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val runtime = (context.applicationContext as YepAnywhereApplication).nativeRuntime
        val state = context.getSharedPreferences(STATE, Context.MODE_PRIVATE)
        val profile = state.getString("profile", null)
        assumeTrue(profile != null)
        val id = checkNotNull(profile)
        runtime.nativePush.forget(id)
        assertNull("Broker cleanup must retire the owned capability", runtime.nativePush.bindings.get(id))
        runtime.pairedServers.forget(id)
        val previous = state.getString("previous", null)
        if (previous != null && runtime.pairedServers.snapshot(previous) != null) runtime.pairedServers.select(previous)
        val subscription = state.getString("subscription", null)
        val manager = context.getSystemService(android.app.NotificationManager::class.java)
        manager.activeNotifications.filter { it.tag?.startsWith("$subscription:") == true }.forEach { manager.cancel(it.tag, it.id) }
        state.edit(commit = true) { clear() }
    }
    companion object { private const val STATE = "ya_owned_headless_push_probe" }
}
