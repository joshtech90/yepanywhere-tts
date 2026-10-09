package com.yepanywhere.mobile.connection

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.yepanywhere.mobile.YepAnywhereApplication
import com.yepanywhere.mobile.profiles.YaServerRoute
import com.yepanywhere.mobile.profiles.YaPairedServerProfile
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class YaRustRuntimeInstrumentedTest {
    @Test fun existingCredentialsRoutesAndConcurrentMuxHostsRemainIndependent() = runBlocking {
        val args = InstrumentationRegistry.getArguments()
        val relay = args.getString("yaProbeRelayWsUrl")
        val betaName = args.getString("yaProbeSecondUsername")
        val statusUrl = args.getString("yaProbeRelayStatusUrl")
        assumeTrue("Requires two owned servers and an owned relay", relay != null && betaName != null && statusUrl != null)
        val alphaName = checkNotNull(args.getString("yaProbeUsername"))
        val password = checkNotNull(args.getString("yaProbePassword"))
        val runtime = (InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as YepAnywhereApplication).nativeRuntime
        val store = runtime.pairedServers
        val selected = store.selectedProfileId.first()
        val http = OkHttpClient()
        suspend fun demand(circuits: Int, sockets: Int) {
            var observed: JSONObject? = null
            withTimeoutOrNull(10_000) {
                while (true) {
                    val value = withContext(Dispatchers.IO) { http.newCall(Request.Builder().url(checkNotNull(statusUrl)).build()).execute().use { JSONObject(checkNotNull(it.body).string()) } }
                    val mux = value.getJSONObject("mux").also { observed = it }
                    if (mux.getInt("liveCircuits") == circuits && mux.getInt("physicalSockets") == sockets) return@withTimeoutOrNull
                    delay(25)
                }
            } ?: throw AssertionError("Relay mux expected $circuits circuits and $sockets sockets within 10 s; last observed $observed")
        }
        val profiles = mutableListOf<YaPairedServerProfile>()
        val managers = mutableListOf<YaServerConnectionManager>()
        val leases = mutableListOf<YaConnectionLease>()
        try {
            val alpha = runtime.pairing.pair("Rust alpha acceptance", alphaName, password, YaServerRoute.relay(checkNotNull(relay), alphaName)).also { profiles.add(it) }
            val beta = runtime.pairing.pair("Rust beta acceptance", checkNotNull(betaName), password, YaServerRoute.relay(relay, betaName)).also { profiles.add(it) }
            managers.addAll(listOf(runtime.connectionManager(alpha.id), runtime.connectionManager(beta.id)))
            demand(0, 0)
            // The unchanged Keystore codec is the migration boundary. Add an
            // unreachable preferred route, then require credential-proven fallback.
            val saved = checkNotNull(store.snapshot(alpha.id))
            val existing = checkNotNull(saved.resumeCredential)
            val unavailable = YaServerRoute.direct("ws://127.0.0.1:1/api/ws")
            store.upsert(alpha.copy(routes = listOf(unavailable) + alpha.routes, preferredRouteId = unavailable.id), existing)
            val a = managers[0].acquire().also { leases.add(it) }
            val sibling = managers[0].acquire().also { leases.add(it) }
            val b = managers[1].acquire().also { leases.add(it) }
            val results = awaitAll(async { a.request("GET", "/projects") }, async { b.request("GET", "/projects") })
            results.forEach { assertEquals(200, it.status) }
            demand(2, 1)
            val resumed = checkNotNull(store.snapshot(alpha.id))
            assertEquals(alpha.routes.first().id, resumed.profile.preferredRouteId)
            assertEquals(existing.credential, checkNotNull(resumed.resumeCredential).credential)
            a.releaseAndAwait(); leases.remove(a)
            assertEquals(200, sibling.request("GET", "/version").status)
            demand(2, 1)
            sibling.releaseAndAwait(); leases.remove(sibling)
            demand(1, 1)
            assertEquals(200, b.request("GET", "/version").status)
            b.releaseAndAwait(); leases.remove(b)
            demand(0, 0)
        } finally {
            leases.forEach { it.releaseAndAwait() }
            managers.forEach { it.shutdownAndAwait() }
            profiles.forEach { store.forget(it.id) }
            if (selected != null && store.snapshot(selected) != null) store.select(selected)
            http.connectionPool.evictAll(); http.dispatcher.executorService.shutdown()
        }
    }
}
