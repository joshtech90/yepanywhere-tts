package com.yepanywhere.mobile.connection

import android.content.Context
import android.security.NetworkSecurityPolicy
import java.net.URI
import java.io.IOException
import com.yepanywhere.mobile.profiles.*
import java.io.Closeable
import java.nio.ByteBuffer
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import org.json.JSONArray
import org.json.JSONObject
import uniffi.ya_mobile_core.*

/** Only native storage converts the existing Keystore credential representation. */
internal object YaRustCredential {
    fun encode(credential: YaResumeCredential): ByteArray {
        val key = credential.copyBaseKey()
        return try {
            JSONObject().put("username", credential.username).put("session_id", credential.sessionId)
                .put("base_key", JSONArray(key.map { it.toInt() and 255 }))
                .put("resume_protocol_version", credential.resumeProtocolVersion)
                .toString().toByteArray(Charsets.UTF_8)
        } finally { key.fill(0) }
    }
    fun decode(data: ByteArray): YaResumeCredential {
        var key: ByteArray? = null
        try {
            require(data.size <= 4096)
            val value = JSONObject(data.toString(Charsets.UTF_8))
            val bytes = value.getJSONArray("base_key")
            require(bytes.length() == 32)
            for (index in 0 until 32) require(bytes.getInt(index) in 0..255)
            val decoded = ByteArray(32) { bytes.getInt(it).toByte() }
            key = decoded
            return YaResumeCredential(value.getString("username"), value.getString("session_id"), decoded, value.getInt("resume_protocol_version"))
        } finally { key?.fill(0); data.fill(0) }
    }
}

internal object YaRustTls {
    private var initialized = false
    @JvmStatic external fun initialize(context: Context)
    @Synchronized fun ensure(context: Context) {
        if (!initialized) {
            System.loadLibrary("ya_mobile_core")
            initialize(context.applicationContext)
            initialized = true
        }
    }
}

class YaRustTerminalException(val phase: YaConnectionPhase, val recoverable: Boolean = false) : IllegalStateException("Native Rust connection ended")

/** Historical regression tag; request failures now use typed operation errors. */
const val SYNTHETIC_RESPONSE_TAG = "YaSyntheticResponse"

class YaRustProfileConnector(private val repository: YaPairedServerRepository) : YaProfileConnector, Closeable {
    private val active = ConcurrentHashMap.newKeySet<YaRustMessageTransport>()
    private val runtime = NativeRuntime()
    // UniFFI polls suspended Rust futures on the calling coroutine's thread.
    // Android's TLS verifier can fetch CRLs synchronously during a poll, so
    // every connection entry point must leave Main even when called by the UI.
    override suspend fun login(route: YaServerRoute, username: String, password: String): YaMessageTransport = connectOnIo({ it }) {
        val memory = object : CredentialPersistence {
            override fun beginResume() = true
            override fun persist(credential: ByteArray): Boolean { credential.fill(0); return true }
        }
        transport(runtime.login(UUID.randomUUID().toString(), nativeRoute(route), username, password, memory), false)
    }
    override suspend fun loginProfile(profile: YaPairedServerProfile, route: YaServerRoute, password: String): YaMessageTransport = connectOnIo({ it }) {
        val snapshot = repository.snapshot(profile.id)
        val previous = snapshot?.resumeCredential
        val stored = previous ?: YaStoredResumeCredential(YaResumeCredential(profile.username, "pending", ByteArray(32), 3), System.currentTimeMillis(), null)
        val session = runtime.login(profile.id, nativeRoute(route), profile.username, password,
            persistence(profile, stored, pairing = snapshot == null))
        transport(session, false)
    }
    override suspend fun resume(profile: YaPairedServerProfile, credential: YaResumeCredential): YaRoutedTransport = connectOnIo({ it.transport }) {
        val stored = checkNotNull(repository.snapshot(profile.id)?.resumeCredential)
        val routes = profile.routes.sortedWith(compareByDescending<YaServerRoute> { it.id == profile.preferredRouteId }.thenBy { it.kind != YaServerRouteKind.DIRECT })
        val allowed = routes.filter(::routePermitted).map(::nativeRoute)
        if (allowed.isEmpty()) throw IOException("No route allowed by Android network policy")
        val bytes = YaRustCredential.encode(credential)
        val session = try {
            runtime.acquire(profile.id, allowed, profile.username, bytes, persistence(profile, stored))
        } catch (_: CoreException.ReauthenticationRequired) { throw YaAllRoutesRejectedException() }
        finally { bytes.fill(0) }
        val transport = transport(session, true)
        YaRoutedTransport(profile.routes.first { it.id == transport.routeId }, transport)
    }
    private suspend fun <T : Any> connectOnIo(transport: (T) -> YaMessageTransport, operation: suspend () -> T): T {
        var opened: T? = null
        try {
            return withContext(Dispatchers.IO) { operation().also { opened = it } }
        } catch (error: Throwable) {
            // withContext can cancel after IO has opened the source but before
            // delivering its result to Main. Do not strand that native lease.
            opened?.let { transport(it).cancel() }
            throw error
        }
    }
    private fun routePermitted(route: YaServerRoute): Boolean {
        val uri = URI(route.websocketUrl)
        return uri.scheme != "ws" || NetworkSecurityPolicy.getInstance().isCleartextTrafficPermitted(uri.host)
    }
    private fun nativeRoute(route: YaServerRoute): NativeRoute {
        if (!routePermitted(route)) throw IOException("Cleartext native transport is forbidden by Android network policy")
        return NativeRoute(route.id, route.websocketUrl, route.relayTarget)
    }
    private fun persistence(profile: YaPairedServerProfile, stored: YaStoredResumeCredential, pairing: Boolean = false): CredentialPersistence =
        YaRustCredentialPersistence(repository, profile, stored, pairing)
    private fun transport(session: NativeSourceLease, resumed: Boolean): YaRustMessageTransport {
        val transport = YaRustMessageTransport(session, resumed, autoStart = false) { active.remove(it) }
        active.add(transport)
        transport.start()
        return transport
    }
    override fun close() { active.toList().forEach { it.cancel() }; runtime.shutdown(); runtime.destroy() }
}

internal class YaRustCredentialPersistence(
    private val repository: YaPairedServerRepository,
    private val profile: YaPairedServerProfile,
    private val stored: YaStoredResumeCredential,
    pairing: Boolean = false,
) : CredentialPersistence {
    private var mayCreateProfile = pairing
        @Synchronized override fun beginResume(): Boolean = runCatching { runBlocking(Dispatchers.IO) {
            val current = checkNotNull(repository.snapshot(profile.id))
            check(current.profile.securityClient?.revoked != true)
            repository.clearCredential(profile.id)
        } }.isSuccess
        @Synchronized override fun persist(credential: ByteArray): Boolean = runCatching {
            val decoded = YaRustCredential.decode(credential)
            check(decoded.username == profile.username)
            runBlocking(Dispatchers.IO) {
                val next = stored.copy(credential = decoded)
                if (mayCreateProfile && repository.snapshot(profile.id) == null) {
                    repository.upsert(profile, next)
                } else {
                    repository.updateCredential(profile.id, next)
                }
                mayCreateProfile = false
            }
        }.isSuccess
    }

private fun CoreException.nativeFailure(): YaNativeOperationFailure = when (this) {
    is CoreException.Unavailable, is CoreException.Closed -> YaNativeOperationFailure.CONNECTION_UNAVAILABLE
    is CoreException.Timeout -> YaNativeOperationFailure.TIMEOUT
    is CoreException.Overflow -> YaNativeOperationFailure.OVERFLOW
    is CoreException.InvalidMessage -> YaNativeOperationFailure.INVALID_MESSAGE
    is CoreException.ReauthenticationRequired -> YaNativeOperationFailure.REAUTHENTICATION_REQUIRED
}

/** Kotlin keeps platform demand; all protocol operations run in the Rust actor. */
internal class YaRustMessageTransport(
    private val session: NativeSourceLeaseInterface,
    @Volatile override var resumed: Boolean,
    autoStart: Boolean = true,
    private val retired: (YaRustMessageTransport) -> Unit,
) : YaMessageTransport {
    private val scopeJob = SupervisorJob()
    private val scope = CoroutineScope(scopeJob + Dispatchers.IO)
    private val incoming = Channel<JSONObject>(32)
    private val closed = CompletableDeferred<Unit>()
    private val ended = AtomicBoolean(false)
    private val sessionLock = Any()
    private var activeCalls = 0
    private var released = false
    private var scopeStopped = false
    private var destroyed = false
    private data class Work(val message: JSONObject?, val chunk: ByteArray?, val reply: CompletableDeferred<Unit>?)
    private val work = Channel<Work>(32)
    private class RequestSlot { val cancelled = AtomicBoolean(false); @Volatile var job: Job? = null }
    private val requests = ConcurrentHashMap<String, RequestSlot>()
    override val credential: YaResumeCredential get() = YaRustCredential.decode(withSession { session.credentialData() })
    override val routeId: String? get() = withSession { session.routeId() }.takeIf { it.isNotEmpty() }
    override val securityBinding: YaSrpTransportBinding get() = withSession { session.securityBinding() }.let {
        YaSrpTransportBinding(it.sessionId, it.transportNonce, if (resumed) YaSrpAuthenticationMethod.RESUME else YaSrpAuthenticationMethod.FULL)
    }
    init {
        scopeJob.invokeOnCompletion {
            synchronized(sessionLock) { scopeStopped = true; destroyWhenIdle() }
        }
        if (autoStart) start()
    }
    // Cancellation is cooperative. Keep the wrapper alive across every native
    // call, including direct callers outside scope, and reject late admission.
    private inline fun <T> withSession(operation: () -> T): T {
        synchronized(sessionLock) {
            if (ended.get()) throw CancellationException("Native source released")
            activeCalls++
        }
        try { return operation() }
        finally { synchronized(sessionLock) { activeCalls--; destroyWhenIdle() } }
    }
    // Called only under sessionLock, after release and all native work drain.
    private fun destroyWhenIdle() {
        if (released && scopeStopped && activeCalls == 0 && !destroyed) {
            destroyed = true
            (session as? Disposable)?.destroy(); retired(this); closed.complete(Unit)
        }
    }
    internal fun start() {
        scope.launch {
            try {
                while (isActive) {
                    val event = JSONObject(withSession { session.nextEvent() })
                    if (event.optString("type") == "state" && event.optString("phase") == "CONNECTED") resumed = true
                    if (event.optString("type") == "subscriptionError" && !event.has("errorCode") && event.optInt("status") > 0) {
                        event.put("type", "response").put("id", event.getString("subscriptionId"))
                            .put("body", JSONObject().put("error", event.opt("error")))
                    }
                    incoming.send(event)
                    if (event.optString("type") == "state" && event.optString("phase") in setOf("FAILED", "REAUTHENTICATION_REQUIRED")) {
                        throw YaRustTerminalException(YaConnectionPhase.valueOf(event.getString("phase")), event.optBoolean("recoverable"))
                    }
                }
            } catch (error: CoreException) { finish(YaRustTerminalException(YaConnectionPhase.FAILED, error is CoreException.Unavailable || error is CoreException.Closed || error is CoreException.Timeout)) }
            catch (error: Throwable) { finish(error) }
        }
        scope.launch {
            try {
                for (item in work) {
                    try {
                        if (item.chunk != null) withSession { session.uploadChunk(item.chunk) }
                        else execute(checkNotNull(item.message))
                        item.reply?.complete(Unit)
                    } catch (error: Throwable) {
                        item.reply?.completeExceptionally(error)
                        if (error is CancellationException) throw error
                        if (item.reply == null && item.message != null) {
                            val message = item.message
                            when (message.optString("type")) {
                                "subscribe" -> incoming.send(JSONObject().put("type", "subscriptionError")
                                    .put("subscriptionId", message.getString("subscriptionId"))
                                    .put("errorCode", (error as? CoreException)?.nativeFailure()?.name)
                                    .put("error", error.message ?: "Native subscription failed"))
                                "upload_start", "staged_upload_start", "upload_end" -> incoming.send(JSONObject().put("type", "upload_error").put("uploadId", message.getString("uploadId")).put("error", "Native upload rejected"))
                                "unsubscribe" -> Unit
                                else -> throw error
                            }
                        }
                    }
                }
            } catch (error: Throwable) { finish(error) }
        }
    }
    override fun send(message: JSONObject) {
        check(!ended.get())
        val id = message.optString("id").takeIf { message.optString("type") == "request" }
        if (id != null) { check(requests.size < 32); check(requests.putIfAbsent(id, RequestSlot()) == null) }
        if (work.trySend(Work(JSONObject(message.toString()), null, null)).isFailure) {
            if (id != null) requests.remove(id)
            error("Native command queue is full")
        }
    }
    private suspend fun execute(message: JSONObject) {
        when (message.getString("type")) {
            "request" -> {
                val id = message.getString("id")
                val slot = requests[id] ?: return
                val job = scope.launch(start = CoroutineStart.LAZY) {
                    try {
                        val response = JSONObject(withSession { session.dispatch("request", message.toString()) })
                        response.put("type", "response").put("id", id)
                        incoming.send(response)
                    } catch (error: CancellationException) { throw error }
                    catch (error: CoreException) {
                        val failure = error.nativeFailure()
                        // No server answered. Preserve an operation failure, never an HTTP status.
                        incoming.send(JSONObject().put("type", "requestError").put("id", id).put("code", failure.name))
                    } finally { requests.remove(id, slot) }
                }
                slot.job = job
                if (slot.cancelled.get()) job.cancel() else job.start()
            }
            "subscribe", "unsubscribe" -> withSession { session.dispatch(message.getString("type"), message.toString()) }
            "upload_start", "staged_upload_start" -> withSession { session.dispatch("uploadStart", message.toString()) }
            "upload_end" -> withSession { session.dispatch("uploadEnd", message.toString()) }
            "upload_cancel" -> withSession { session.dispatch("uploadCancel", message.toString()) }
            else -> error("Unsupported native operation")
        }
    }
    override fun cancelRequest(id: String) { requests.remove(id)?.let { it.cancelled.set(true); it.job?.cancel() } }
    override suspend fun directRequest(method: String, path: String, body: JSONObject?): YaApiResponse {
        val request = JSONObject().put("method", method).put("path", path).put("headers", JSONObject().put("Content-Type", "application/json").put("X-Yep-Anywhere", "true"))
        if (body != null) request.put("body", body)
        val response = JSONObject(withSession { session.dispatch("request", request.toString()) })
        val headers = response.optJSONObject("headers")
        return YaApiResponse(response.getInt("status"), headers?.keys()?.asSequence()?.associateWith { headers.getString(it) }.orEmpty(), response.opt("body").takeUnless { it == JSONObject.NULL })
    }
    override suspend fun sendUploadChunk(uploadId: String, offset: Long, chunk: ByteArray) {
        val id = UUID.fromString(uploadId)
        val payload = ByteBuffer.allocate(24 + chunk.size).putLong(id.mostSignificantBits).putLong(id.leastSignificantBits).putLong(offset).put(chunk).array()
        val reply = CompletableDeferred<Unit>()
        work.send(Work(null, payload, reply)); reply.await()
    }
    override suspend fun cancelUpload(uploadId: String) {
        val reply = CompletableDeferred<Unit>()
        work.send(Work(JSONObject().put("type", "upload_cancel").put("uploadId", uploadId), null, reply)); reply.await()
    }
    override suspend fun receive(): JSONObject = incoming.receive()
    override suspend fun awaitClosed() { closed.await() }
    override suspend fun closeAndAwait() { cancel(); closed.await() }
    override fun cancel() { finish(CancellationException("Native source released")) }
    private fun finish(error: Throwable) {
        if (ended.compareAndSet(false, true)) {
            work.close(error); incoming.close(error)
            while (true) { val item = work.tryReceive().getOrNull() ?: break; item.reply?.completeExceptionally(error) }
            requests.clear()
            synchronized(sessionLock) { session.release(); released = true }
            scope.cancel()
        }
    }
}
