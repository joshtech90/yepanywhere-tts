package com.yepanywhere.mobile.web

import org.json.JSONObject

/** Bounded observational counters; no message contents, identifiers or keys. */
class NativeTransportMetrics {
    private var frames = 0L
    private var bytes = 0L
    private var queueHighWater = 0
    private var cancellations = 0L
    private var overflows = 0L
    private val creditMicros = Samples()
    private val mainThreadMicros = Samples()

    @Synchronized fun frame(size: Int) { frames++; bytes += size }
    @Synchronized fun queued(size: Int) { queueHighWater = maxOf(queueHighWater, size) }
    @Synchronized fun credit(nanos: Long) { creditMicros.add(nanos / 1000) }
    @Synchronized fun mainThread(nanos: Long) { mainThreadMicros.add(nanos / 1000) }
    @Synchronized fun cancelled() { cancellations++ }
    @Synchronized fun overflow() { overflows++ }
    @Synchronized fun snapshot(): JSONObject = JSONObject()
        .put("frames", frames).put("bytes", bytes).put("queueHighWaterBytes", queueHighWater)
        .put("cancellations", cancellations).put("overflows", overflows)
        .put("creditMicros", creditMicros.snapshot()).put("mainThreadMicros", mainThreadMicros.snapshot())

    private class Samples {
        private val values = LongArray(256)
        private var count = 0L
        fun add(value: Long) { values[(count % values.size).toInt()] = value; count++ }
        fun snapshot(): JSONObject {
            val sorted = values.take(minOf(count, values.size.toLong()).toInt()).sorted()
            fun percentile(fraction: Double): Long = if (sorted.isEmpty()) 0 else sorted[((sorted.size - 1) * fraction).toInt()]
            return JSONObject().put("samples", count).put("p50", percentile(0.50)).put("p95", percentile(0.95))
        }
    }
}
