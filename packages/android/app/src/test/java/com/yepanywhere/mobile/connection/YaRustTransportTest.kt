package com.yepanywhere.mobile.connection

import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import uniffi.ya_mobile_core.NativeSourceLeaseInterface
import uniffi.ya_mobile_core.NativeSecurityBinding

class YaRustTransportTest {
    @Test fun cancellingCallerReleasesItsRustFutureAndPreservesPeer() = runBlocking {
        val session = FakeSession()
        val transport = YaRustMessageTransport(session, true) {}
        try {
            transport.send(JSONObject().put("type", "request").put("id", "held").put("method", "GET").put("path", "/held"))
            withTimeout(5_000) { session.started.await() }
            transport.cancelRequest("held")
            withTimeout(5_000) { session.cancelled.await() }
            assertFalse(session.closed)
            assertEquals(200, transport.directRequest("GET", "/peer", null).status)
        } finally { transport.closeAndAwait() }
        assertTrue(session.closed)
    }
    @Test fun closingSourceWakesActiveAndQueuedUploadWriters() = runBlocking {
        val session = FakeSession().also { it.holdUploads = true }
        val transport = YaRustMessageTransport(session, true) {}
        val id = java.util.UUID.randomUUID().toString()
        val first = async { runCatching { transport.sendUploadChunk(id, 0, byteArrayOf(1)) } }
        withTimeout(5_000) { session.uploadStarted.await() }
        val queued = async(start = CoroutineStart.UNDISPATCHED) { runCatching { transport.sendUploadChunk(id, 1, byteArrayOf(2)) } }
        transport.closeAndAwait()
        withTimeout(5_000) {
            assertTrue(first.await().isFailure)
            assertTrue(queued.await().isFailure)
        }
    }
    private class FakeSession : NativeSourceLeaseInterface {
        val started = CompletableDeferred<Unit>()
        val cancelled = CompletableDeferred<Unit>()
        private val events = Channel<String>()
        var closed = false
        var holdUploads = false
        val uploadStarted = CompletableDeferred<Unit>()
        override fun release() { closed = true }
        override fun routeId() = "fixture-route"
        override fun credentialData() = YaRustCredential.encode(YaResumeCredential("fixture-owner", "fixture-session", ByteArray(32), 3))
        override fun securityBinding() = NativeSecurityBinding("fixture-session", "fixture-nonce")
        override suspend fun nextEvent() = events.receive()
        override suspend fun uploadChunk(payload: ByteArray) {
            if (holdUploads) { uploadStarted.complete(Unit); awaitCancellation() }
        }
        override suspend fun dispatch(method: String, params: String): String {
            if (JSONObject(params).optString("path") == "/held") {
                started.complete(Unit)
                try { awaitCancellation() } finally { cancelled.complete(Unit) }
            }
            return "{\"status\":200,\"headers\":{},\"body\":{}}"
        }
    }
}
