package com.yepanywhere.mobile.web

import java.nio.ByteBuffer

/** One credited frame at a time; one bounded logical message per direction. */
object NativeTransportFrames {
    const val HEADER_BYTES = 16
    const val CHUNK_BYTES = 64 * 1024
    const val MAX_MESSAGE_BYTES = 32 * 1024 * 1024
    const val JSON = 1
    const val UPLOAD = 2

    data class Frame(val kind: Int, val id: Int, val offset: Int, val total: Int, val data: ByteArray)
    data class Message(val kind: Int, val data: ByteArray)

    fun encode(kind: Int, id: Int, offset: Int, total: Int, data: ByteArray): ByteArray {
        require(kind == JSON || kind == UPLOAD)
        require(id > 0 && total in 1..MAX_MESSAGE_BYTES)
        require(offset >= 0 && data.size in 1..CHUNK_BYTES && offset <= total - data.size)
        return ByteBuffer.allocate(HEADER_BYTES + data.size)
            .putShort(0x5941).put(1).put(kind.toByte()).putInt(id).putInt(offset).putInt(total)
            .put(data).array()
    }

    fun decode(bytes: ByteArray): Frame {
        require(bytes.size in (HEADER_BYTES + 1)..(HEADER_BYTES + CHUNK_BYTES))
        val input = ByteBuffer.wrap(bytes)
        require(input.short.toInt() == 0x5941 && input.get().toInt() == 1)
        val kind = input.get().toInt()
        val id = input.int
        val offset = input.int
        val total = input.int
        val data = ByteArray(input.remaining()).also(input::get)
        // Reuse the encoder's range validation, without allocating another frame.
        require(kind == JSON || kind == UPLOAD)
        require(id > 0 && total in 1..MAX_MESSAGE_BYTES && offset >= 0 && offset <= total - data.size)
        return Frame(kind, id, offset, total, data)
    }

    class Receiver {
        private var nextId = 1
        private var kind = 0
        private var offset = 0
        private var buffer: ByteArray? = null

        fun accept(frame: Frame): Message? {
            require(frame.id == nextId) { "Out-of-order native frame" }
            if (buffer == null) {
                require(frame.offset == 0)
                buffer = ByteArray(frame.total)
                kind = frame.kind
            }
            val target = checkNotNull(buffer)
            require(frame.kind == kind && frame.total == target.size && frame.offset == offset)
            frame.data.copyInto(target, offset)
            offset += frame.data.size
            if (offset != target.size) return null
            buffer = null
            offset = 0
            nextId += 1
            return Message(kind, target)
        }
    }
}
