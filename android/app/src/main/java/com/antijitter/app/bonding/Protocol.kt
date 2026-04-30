package com.antijitter.app.bonding

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicInteger

/**
 * Bonding wire format — must match server/bonding/protocol.go exactly:
 * each packet is [4-byte big-endian seq][payload].
 */
object Protocol {
    const val HEADER_SIZE = 4
    const val MAX_PACKET_SIZE = 1500

    /** Probe packet body — sent with seq=0; server echoes the bytes back unchanged. */
    val PROBE_PAYLOAD: ByteArray = "probe".toByteArray(Charsets.US_ASCII)
    private const val REPLY_MODE_PREFIX = "reply-mode:"

    fun encode(seq: Int, payload: ByteArray, payloadOffset: Int, payloadLen: Int): ByteArray {
        val out = ByteArray(HEADER_SIZE + payloadLen)
        out[0] = (seq ushr 24).toByte()
        out[1] = (seq ushr 16).toByte()
        out[2] = (seq ushr 8).toByte()
        out[3] = seq.toByte()
        System.arraycopy(payload, payloadOffset, out, HEADER_SIZE, payloadLen)
        return out
    }

    fun encodeInto(buf: ByteBuffer, seq: Int, payload: ByteArray, payloadLen: Int) {
        buf.clear()
        buf.order(ByteOrder.BIG_ENDIAN)
        buf.putInt(seq)
        buf.put(payload, 0, payloadLen)
        buf.flip()
    }

    /** Returns sequence number, or null if data is too short. Caller takes payload from data[4..] directly. */
    fun decodeSeq(data: ByteArray, len: Int): Int? {
        if (len < HEADER_SIZE) return null
        return ((data[0].toInt() and 0xff) shl 24) or
                ((data[1].toInt() and 0xff) shl 16) or
                ((data[2].toInt() and 0xff) shl 8) or
                (data[3].toInt() and 0xff)
    }

    fun buildProbe(): ByteArray = encode(0, PROBE_PAYLOAD, 0, PROBE_PAYLOAD.size)

    fun buildReplyMode(mode: String): ByteArray {
        val payload = "$REPLY_MODE_PREFIX$mode".toByteArray(Charsets.US_ASCII)
        return encode(0, payload, 0, payload.size)
    }
}

/** Thread-safe monotonic sequence number generator starting at 1. */
class Sequencer {
    private val seq = AtomicInteger(0)
    fun next(): Int = seq.incrementAndGet()
    fun current(): Int = seq.get()
}

/**
 * Sliding-window deduplicator — mirrors server/bonding/protocol.go.
 * Used on the client side to drop duplicate replies that arrive on multiple paths.
 */
class Deduplicator(private val windowSize: Int = 4096) {
    private val seen = BooleanArray(windowSize)
    private var minSeq: Long = 0
    private var maxSeen: Long = 0
    private var lastPktNanos: Long = 0

    private val sessionRestartThreshold = (windowSize * 4).toLong()
    private val sessionIdleNanos = 10_000_000_000L

    @Synchronized
    fun isNew(seqInt: Int): Boolean {
        val seq = seqInt.toLong() and 0xffff_ffffL
        val now = System.nanoTime()

        if (lastPktNanos != 0L && now - lastPktNanos > sessionIdleNanos) {
            seen.fill(false)
            minSeq = 0
            maxSeen = 0
        }
        lastPktNanos = now

        if (maxSeen > sessionRestartThreshold && seq + sessionRestartThreshold < maxSeen) {
            seen.fill(false)
            minSeq = 0
            maxSeen = 0
        }

        if (seq < minSeq) return false

        val idx = (seq % windowSize).toInt()
        if (seq >= minSeq + windowSize) {
            val newMin = seq - windowSize + 1
            var i = minSeq
            while (i < newMin && i < minSeq + windowSize) {
                seen[(i % windowSize).toInt()] = false
                i++
            }
            minSeq = newMin
        }

        if (seen[idx]) return false
        seen[idx] = true
        if (seq > maxSeen) maxSeen = seq
        return true
    }
}
