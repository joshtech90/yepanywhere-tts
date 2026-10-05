package com.yepanywhere.mobile.web

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class NativeTransportFramesTest {
    @Test fun reassemblesLargeResponsesAndRejectsReplayedFrames() {
        val bytes = ByteArray(1024 * 1024) { (it % 251).toByte() }
        val receiver = NativeTransportFrames.Receiver()
        var result: NativeTransportFrames.Message? = null
        for (offset in bytes.indices step NativeTransportFrames.CHUNK_BYTES) {
            val frame = NativeTransportFrames.decode(NativeTransportFrames.encode(
                NativeTransportFrames.JSON, 1, offset, bytes.size,
                bytes.copyOfRange(offset, minOf(offset + NativeTransportFrames.CHUNK_BYTES, bytes.size)),
            ))
            result = receiver.accept(frame)
            if (offset + frame.data.size < bytes.size) assertNull(result)
        }
        assertArrayEquals(bytes, checkNotNull(result).data)
        assertThrows(IllegalArgumentException::class.java) {
            receiver.accept(NativeTransportFrames.Frame(1, 1, 0, 1, byteArrayOf(1)))
        }
    }

    @Test fun rejectsOversizedInconsistentAndOutOfOrderFramesBeforeAllocation() {
        assertThrows(IllegalArgumentException::class.java) {
            NativeTransportFrames.encode(1, 1, 0, NativeTransportFrames.MAX_MESSAGE_BYTES + 1, byteArrayOf(1))
        }
        val receiver = NativeTransportFrames.Receiver()
        assertNull(receiver.accept(NativeTransportFrames.Frame(1, 1, 0, 4, byteArrayOf(1, 2))))
        assertThrows(IllegalArgumentException::class.java) {
            receiver.accept(NativeTransportFrames.Frame(1, 1, 1, 4, byteArrayOf(3, 4)))
        }
        assertThrows(IllegalArgumentException::class.java) {
            receiver.accept(NativeTransportFrames.Frame(2, 1, 2, 4, byteArrayOf(3, 4)))
        }
    }
}
