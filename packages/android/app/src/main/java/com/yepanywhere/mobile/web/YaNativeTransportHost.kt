package com.yepanywhere.mobile.web

import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.yepanywhere.mobile.YaNativeRuntime
import java.io.Closeable
import android.util.Base64
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.first
import org.json.JSONObject

/** Installed only on the bundled app-assets origin, with a document-owned lease. */
class YaNativeTransportHost private constructor(
    private val view: WebView,
    private val runtime: YaNativeRuntime,
    private val profileId: String,
    private val onFatal: () -> Unit,
    private val switchHost: () -> Unit,
) : Closeable {
    private var document: Document? = null
    private var destroyed = false
    private data class Foreground(val active: Boolean, val generation: Int)
    private val foreground = MutableStateFlow(Foreground(true, 0))
    @Volatile private var foregroundGeneration = 0
    fun setForeground(value: Boolean) {
        if (foreground.value.active == value) return
        foregroundGeneration += 1
        foreground.value = Foreground(value, foregroundGeneration)
        if (!value) document?.suspendSession()
    }
    fun diagnostics(): JSONObject? = document?.metrics?.snapshot()?.put("profileId", profileId)
        ?.put("foreground", foreground.value.active)?.put("sessionActive", document?.session != null)

    fun onDocumentChanged() { document?.close(); document = null }

    override fun close() {
        destroyed = true
        onDocumentChanged()
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.removeWebMessageListener(view, OBJECT_NAME)
        }
    }

    private fun receive(message: WebMessageCompat, reply: JavaScriptReplyProxy) {
        if (destroyed) return
        try {
            if (message.type == WebMessageCompat.TYPE_STRING && message.data?.startsWith("release:") == true) {
                if (message.data == "release:${document?.handle}") onDocumentChanged()
                return
            }
            if (message.type == WebMessageCompat.TYPE_STRING && message.data?.startsWith("{\"type\":\"hello\"") == true) {
                require(document == null && checkNotNull(message.data).length < 1024)
                val hello = JSONObject(message.data!!)
                require(hello.getInt("protocol") == 1)
                val binary = hello.optBoolean("binary") &&
                    WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER)
                Document(reply, binary).also { document = it; it.start() }
                return
            }
            val current = checkNotNull(document) { "Native source handshake required" }
            if (message.type == WebMessageCompat.TYPE_STRING) {
                val data = checkNotNull(message.data)
                if (data.startsWith("ack:")) { current.acknowledge(data); return }
                require(data.startsWith("frame:") && data.length <= 87500)
                current.receive(Base64.decode(data.substring(6), Base64.NO_WRAP))
            } else {
                require(current.binary && message.type == WebMessageCompat.TYPE_ARRAY_BUFFER)
                current.receive(message.arrayBuffer)
            }
        } catch (_: Throwable) {
            onDocumentChanged()
            if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                reply.postMessage("{\"type\":\"fatal\",\"error\":\"Native source bridge rejected a message\"}")
            }
            onFatal()
        }
    }

    private inner class Document(val reply: JavaScriptReplyProxy, val binary: Boolean) : Closeable {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val handle = UUID.randomUUID().toString()
        val receiver = NativeTransportFrames.Receiver()
        val outbound = Channel<ByteArray>(32)
        val queuedBytes = AtomicInteger()
        val metrics = NativeTransportMetrics()
        @Volatile var session: YaWebTransportSession? = null
        @Volatile var acknowledgement: CompletableDeferred<Unit>? = null
        @Volatile var expectedAck: String? = null
        @Volatile var closed = false
        @Volatile var receiving = false
        private val lifecycleLock = Any()
        private var sessionGeneration = 0

        fun suspendSession() {
            synchronized(lifecycleLock) {
                sessionGeneration += 1
                session?.close()
                session = null
                if (!closed) emit(JSONObject().put("type", "state").put("phase", "SUSPENDED"))
            }
        }

        private suspend fun observeForeground() {
            foreground.collectLatest { lifecycle ->
                val active = lifecycle.active
                if (!active) {
                    emit(JSONObject().put("type", "state").put("phase", "SUSPENDED"))
                    return@collectLatest
                }
                val manager = runtime.connectionManager(profileId)
                val lease = manager.acquire()
                val generation = synchronized(lifecycleLock) { ++sessionGeneration }
                val acquired = YaWebTransportSession(handle, lease, scope, { value ->
                    synchronized(lifecycleLock) { if (!closed && generation == sessionGeneration) emit(value) }
                }, metrics::cancelled) { view.post { if (!closed) switchHost() } }
                try {
                    synchronized(lifecycleLock) {
                        if (closed || !foreground.value.active) { acquired.close(); return@collectLatest }
                        session = acquired
                    }
                    // Even an already-connected sibling source needs a lifecycle
                    // edge so this document's streams reattach to its new lease.
                    emit(JSONObject().put("type", "state").put("phase", "CONNECTING"))
                    manager.state.collect { state ->
                        synchronized(lifecycleLock) {
                            if (generation == sessionGeneration && foreground.value.active) {
                                emit(JSONObject().put("type", "state").put("phase", state.phase.name)
                                    .put("retryAttempt", state.retryAttempt)
                                    .put("error", state.errorMessage ?: JSONObject.NULL))
                            }
                        }
                    }
                } finally {
                    synchronized(lifecycleLock) {
                        if (session === acquired) { session = null; sessionGeneration += 1 }
                        acquired.close()
                    }
                }
            }
        }

        fun start() {
            scope.launch {
                try {
                    val snapshot = checkNotNull(runtime.pairedServers.snapshot(profileId))
                    postText(JSONObject().put("type", "hello").put("protocol", 1).put("handle", handle)
                        .put("profileId", profileId).put("label", snapshot.profile.label)
                        .put("binary", binary).toString())
                    scope.launch {
                        try { observeForeground() }
                        catch (error: kotlinx.coroutines.CancellationException) { throw error }
                        catch (_: Throwable) { fail() }
                    }
                    var id = 1
                    for (bytes in outbound) {
                        var offset = 0
                        while (offset < bytes.size) {
                            val chunk = bytes.copyOfRange(offset, minOf(offset + NativeTransportFrames.CHUNK_BYTES, bytes.size))
                            val frame = NativeTransportFrames.encode(NativeTransportFrames.JSON, id, offset, bytes.size, chunk)
                            acknowledgement = CompletableDeferred()
                            expectedAck = "ack:$handle:$id:${offset + chunk.size}"
                            val creditStarted = System.nanoTime()
                            withContext(Dispatchers.Main) {
                                val drainStarted = System.nanoTime()
                                if (!closed) {
                                    if (binary && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER)) reply.postMessage(frame)
                                    else if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                                        reply.postMessage("frame:" + Base64.encodeToString(frame, Base64.NO_WRAP))
                                    }
                                }
                                metrics.mainThread(System.nanoTime() - drainStarted)
                                metrics.frame(frame.size)
                            }
                            while (!checkNotNull(acknowledgement).isCompleted) {
                                // No periodic wakeups while the document is hidden.
                                foreground.first { it.active }
                                val generation = foregroundGeneration
                                if (withTimeoutOrNull(30_000) { checkNotNull(acknowledgement).await(); true } == true) break
                                // A stopped WebView can defer local delivery.
                                check(!foreground.value.active || generation != foregroundGeneration) { "Native frame acknowledgement timed out" }
                            }
                            metrics.credit(System.nanoTime() - creditStarted)
                            offset += chunk.size
                        }
                        queuedBytes.addAndGet(-bytes.size)
                        id += 1
                    }
                } catch (_: kotlinx.coroutines.CancellationException) {
                    // The departed document receives no further replies.
                } catch (_: Throwable) { fail() }
            }
        }

        fun emit(value: JSONObject) {
            val bytes = value.toString().toByteArray(Charsets.UTF_8)
            val queued = queuedBytes.addAndGet(bytes.size)
            metrics.queued(queued)
            if (bytes.size > NativeTransportFrames.MAX_MESSAGE_BYTES ||
                queued > 64 * 1024 * 1024 || outbound.trySend(bytes).isFailure) {
                metrics.overflow()
                fail()
            }
        }

        fun acknowledge(value: String) {
            if (!value.startsWith("ack:$handle:")) return
            require(value == expectedAck)
            expectedAck = null
            checkNotNull(acknowledgement).complete(Unit)
        }

        fun receive(bytes: ByteArray) {
            val drainStarted = System.nanoTime()
            require(!closed && !receiving)
            val frame = NativeTransportFrames.decode(bytes)
            val complete = receiver.accept(frame)
            metrics.frame(bytes.size)
            metrics.mainThread(System.nanoTime() - drainStarted)
            receiving = true
            scope.launch {
                try {
                    if (complete != null) {
                        if (complete.kind == NativeTransportFrames.UPLOAD) {
                            // Still credit queued chunks after foreground release.
                            // SUSPENDED rejects the corresponding JS upload.
                            val active = session
                            if (active != null && foreground.value.active) {
                                try { active.uploadChunk(complete.data) }
                                catch (_: kotlinx.coroutines.CancellationException) { /* Foreground lease released. */ }
                            }
                        } else {
                            val command = JSONObject(complete.data.toString(Charsets.UTF_8))
                            synchronized(lifecycleLock) {
                                require(command.getString("handle") == handle)
                                val active = session
                                if (active != null && foreground.value.active) active.dispatch(command)
                                else if (command.optString("method") != "cancel") emit(JSONObject()
                                    .put("type", "reply").put("id", command.getString("id"))
                                    .put("error", "Native page is suspended"))
                            }
                        }
                    }
                    receiving = false
                    postText("ack:$handle:${frame.id}:${frame.offset + frame.data.size}")
                } catch (_: kotlinx.coroutines.CancellationException) {
                    // Teardown cancels the consumer, never its sibling leases.
                } catch (_: Throwable) { fail() }
            }
        }

        suspend fun postText(value: String) {
            withContext(Dispatchers.Main) {
                if (!closed && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) reply.postMessage(value)
            }
        }

        fun fail() {
            view.post {
                if (closed) return@post
                if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                    reply.postMessage("{\"type\":\"fatal\",\"error\":\"Native source bridge closed\"}")
                }
                close()
                onFatal()
            }
        }

        override fun close() {
            synchronized(lifecycleLock) {
                if (closed) return
                closed = true
                metrics.cancelled()
                session?.close()
                session = null
            }
            outbound.close()
            scope.cancel()
        }
    }

    companion object {
        const val OBJECT_NAME = "yaNativeTransport"
        fun install(view: WebView, config: WebClientConfig, runtime: YaNativeRuntime,
            profileId: String, onFatal: () -> Unit = {}, switchHost: () -> Unit): YaNativeTransportHost? {
            if (!config.bundled || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return null
            val host = YaNativeTransportHost(view, runtime, profileId, onFatal, switchHost)
            WebViewCompat.addWebMessageListener(view, OBJECT_NAME, setOf(config.origin)) { _, message, origin, mainFrame, reply ->
                if (mainFrame && runCatching { WebClientOrigin.parse(origin.toString()) }.getOrNull() == config.origin) {
                    host.receive(message, reply)
                }
            }
            return host
        }
    }
}
