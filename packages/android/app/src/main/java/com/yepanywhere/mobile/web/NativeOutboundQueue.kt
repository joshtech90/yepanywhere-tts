package com.yepanywhere.mobile.web

import com.yepanywhere.mobile.connection.YaNativeOperationException
import com.yepanywhere.mobile.connection.YaNativeOperationFailure
import com.yepanywhere.mobile.connection.YaSubscriptionOverflowException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.selects.select

/** State/control get the next frame; catch-up waits in its own bounded lane. */
class NativeOutboundQueue(
    private val onQueued: (Int) -> Unit,
    private val byteLimit: Int = 64 * 1024 * 1024,
) {
    class Message(val kind: Int, val bytes: ByteArray, val generation: Int?) {
        internal val charged = AtomicBoolean(false)
    }
    private val bytes = AtomicInteger()
    val queuedBytes: Int get() = bytes.get()
    private val states = Channel<Message>(16, BufferOverflow.DROP_OLDEST, ::delivered)
    private val control = Channel<Message>(32, onUndeliveredElement = ::delivered)
    private val events = Channel<Message>(8, onUndeliveredElement = ::delivered)
    private val responses = Channel<Message>(8, onUndeliveredElement = ::delivered)
    private var preferEvents = true

    private fun reserve(message: Message, limit: Int) {
        require(message.bytes.isNotEmpty() && message.bytes.size <= NativeTransportFrames.MAX_MESSAGE_BYTES)
        while (true) {
            val before = bytes.get()
            if (message.bytes.size > limit - before) {
                if (limit < byteLimit) throw YaSubscriptionOverflowException()
                throw YaNativeOperationException(YaNativeOperationFailure.OVERFLOW)
            }
            if (bytes.compareAndSet(before, before + message.bytes.size)) {
                message.charged.set(true)
                onQueued(before + message.bytes.size)
                return
            }
        }
    }
    fun state(message: Message) {
        require(message.bytes.size <= 4096)
        reserve(message, byteLimit + 128 * 1024)
        if (states.trySend(message).isFailure) delivered(message)
    }
    suspend fun send(message: Message, event: Boolean = false) {
        reserve(message, if (event) byteLimit - minOf(byteLimit / 16, 4 * 1024 * 1024) else byteLimit)
        val lane = if (event) events else if (message.kind == NativeTransportFrames.RESPONSE) responses else control
        try { lane.send(message) }
        catch (error: Throwable) { delivered(message); throw error }
    }
    suspend fun receive(): Message {
        val next = select {
            states.onReceive { it }
            control.onReceive { it }
            if (preferEvents) { events.onReceive { it }; responses.onReceive { it } }
            else { responses.onReceive { it }; events.onReceive { it } }
        }
        preferEvents = !preferEvents
        return next
    }
    fun delivered(message: Message) {
        if (message.charged.compareAndSet(true, false)) bytes.addAndGet(-message.bytes.size)
    }
    fun close() { states.cancel(); control.cancel(); events.cancel(); responses.cancel() }
}
