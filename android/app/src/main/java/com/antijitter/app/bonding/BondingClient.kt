package com.antijitter.app.bonding

import android.net.Network
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/**
 * Multi-path UDP bonding client — Android port of client/bonding/client.go.
 *
 * Each outbound packet is wrapped with a 4-byte big-endian sequence number and
 * sent through every available [Path] simultaneously. Inbound packets from any
 * path are deduplicated by sequence number and forwarded to the consumer.
 *
 * The local UDP listener (port [listenPort]) accepts WireGuard's encrypted
 * datagrams; WireGuard is configured with endpoint=127.0.0.1:[listenPort].
 */
class BondingClient(
    private val protect: (DatagramSocket) -> Boolean,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val seq = Sequencer()
    private val dedup = Deduplicator()
    private val paths = mutableListOf<PathRuntime>()
    private val pathsLock = Any()

    private var localSocket: DatagramSocket? = null
    @Volatile private var localPeer: InetSocketAddress? = null

    private val totalPackets = AtomicLong()
    private val totalBytesUp = AtomicLong()
    private val totalBytesDown = AtomicLong()
    private val cellularBytesUp = AtomicLong()

    /** 4G data cap in bytes; 0 = unlimited. Set via [setDataLimit]. */
    @Volatile private var cellularLimitBytes: Long = 0

    private val running = AtomicReference<Job?>(null)

    /**
     * Starts the local listener on an ephemeral port and returns the bound port.
     * WireGuard should be told to send to 127.0.0.1:<this port>.
     */
    fun startLocalListener(): Int {
        val s = DatagramSocket(InetSocketAddress("127.0.0.1", 0))
        s.receiveBufferSize = 1 shl 20
        s.sendBufferSize = 1 shl 20
        localSocket = s
        val job = scope.launch { runLocalLoop(s) }
        running.set(job)
        return s.localPort
    }

    fun setDataLimit(megabytes: Long) {
        cellularLimitBytes = if (megabytes <= 0) 0 else megabytes * 1024L * 1024L
    }

    /**
     * Adds a network path. The socket is created, [protect]ed (so the kernel
     * doesn't loop it back through our own VPN), pinned to [network], and
     * connected to [serverHost]:[serverPort].
     *
     * Returns true if the path is reachable (probe packet round-tripped).
     */
    suspend fun addPath(name: String, network: Network, serverHost: String, serverPort: Int, isCellular: Boolean): Boolean {
        val socket = DatagramSocket()
        if (!protect(socket)) {
            Log.w(TAG, "$name: VpnService.protect() refused — packets would loop")
            socket.close()
            return false
        }
        try {
            network.bindSocket(socket)
        } catch (t: Throwable) {
            Log.w(TAG, "$name: bindSocket failed: ${t.message}")
            socket.close()
            return false
        }

        val serverAddr = try {
            // Resolve through the bound network so the lookup uses the right DNS.
            val addr = network.getAllByName(serverHost).firstOrNull()
                ?: throw IllegalStateException("DNS returned no addresses")
            InetSocketAddress(addr, serverPort)
        } catch (t: Throwable) {
            Log.w(TAG, "$name: DNS lookup failed for $serverHost: ${t.message}")
            socket.close()
            return false
        }

        socket.connect(serverAddr)
        socket.soTimeout = 0

        val ok = probe(socket)
        if (!ok) {
            Log.w(TAG, "$name: probe to ${serverAddr.address.hostAddress}:${serverAddr.port} failed")
            socket.close()
            return false
        }
        Log.i(TAG, "$name: probe OK via ${serverAddr.address.hostAddress}:${serverAddr.port}")

        val rt = PathRuntime(name, network, socket, serverAddr, isCellular)
        synchronized(pathsLock) { paths += rt }
        scope.launch { runReplyLoop(rt) }
        return true
    }

    private fun probe(socket: DatagramSocket): Boolean {
        val probeBytes = Protocol.buildProbe()
        val recv = ByteArray(64)
        // Two attempts — first probe can be lost while the carrier NAT mapping warms up.
        repeat(2) {
            try {
                socket.send(DatagramPacket(probeBytes, probeBytes.size))
                socket.soTimeout = 1500
                val pkt = DatagramPacket(recv, recv.size)
                socket.receive(pkt)
                if (pkt.length == probeBytes.size && recv.copyOfRange(0, pkt.length).contentEquals(probeBytes)) {
                    socket.soTimeout = 0
                    return true
                }
            } catch (_: Throwable) {
                // try again
            }
        }
        return false
    }

    /** Reads from the local WireGuard listener and fans each packet out across all paths. */
    private suspend fun runLocalLoop(local: DatagramSocket) {
        val buf = ByteArray(Protocol.MAX_PACKET_SIZE)
        while (scope.isActive) {
            val pkt = DatagramPacket(buf, buf.size)
            try {
                local.receive(pkt)
            } catch (_: Throwable) {
                break
            }
            localPeer = InetSocketAddress(pkt.address, pkt.port)

            val s = seq.next()
            val wrapped = Protocol.encode(s, buf, 0, pkt.length)
            totalPackets.incrementAndGet()
            totalBytesUp.addAndGet(pkt.length.toLong())

            val snapshot = synchronized(pathsLock) { paths.toList() }
            for (path in snapshot) {
                if (!path.active) continue
                if (path.cellular && cellularLimitBytes > 0 && cellularBytesUp.get() >= cellularLimitBytes) {
                    path.active = false
                    Log.w(TAG, "${path.name}: 4G data cap reached, disabling")
                    continue
                }
                try {
                    path.socket.send(DatagramPacket(wrapped, wrapped.size))
                    path.packetsSent.incrementAndGet()
                    path.bytesSent.addAndGet(wrapped.size.toLong())
                    if (path.cellular) cellularBytesUp.addAndGet(wrapped.size.toLong())
                } catch (t: Throwable) {
                    Log.w(TAG, "${path.name}: send failed: ${t.message}")
                }
            }
        }
    }

    /** Reads decoded server replies from one path and forwards de-duped packets to WireGuard. */
    private suspend fun runReplyLoop(rt: PathRuntime) {
        val buf = ByteArray(Protocol.MAX_PACKET_SIZE + Protocol.HEADER_SIZE)
        while (scope.isActive && rt.active) {
            val pkt = DatagramPacket(buf, buf.size)
            try {
                rt.socket.receive(pkt)
            } catch (_: Throwable) {
                break
            }
            val s = Protocol.decodeSeq(buf, pkt.length) ?: continue
            // Probes have seq=0; ignore on the reply side (we already handled them in probe()).
            if (s == 0) continue
            if (!dedup.isNew(s)) {
                rt.dupes.incrementAndGet()
                continue
            }
            rt.unique.incrementAndGet()

            val target = localPeer ?: continue
            val payloadLen = pkt.length - Protocol.HEADER_SIZE
            if (payloadLen <= 0) continue
            try {
                localSocket?.send(DatagramPacket(buf, Protocol.HEADER_SIZE, payloadLen, target.address, target.port))
                totalBytesDown.addAndGet(payloadLen.toLong())
            } catch (t: Throwable) {
                Log.w(TAG, "forward to WG failed: ${t.message}")
            }
        }
    }

    fun stats(): Stats {
        val pathStats = synchronized(pathsLock) {
            paths.map {
                PathStats(
                    name = it.name,
                    cellular = it.cellular,
                    active = it.active,
                    packetsSent = it.packetsSent.get(),
                    bytesSent = it.bytesSent.get(),
                    uniqueRx = it.unique.get(),
                    dupesRx = it.dupes.get(),
                )
            }
        }
        return Stats(
            totalPackets = totalPackets.get(),
            totalBytesUp = totalBytesUp.get(),
            totalBytesDown = totalBytesDown.get(),
            cellularBytesUp = cellularBytesUp.get(),
            paths = pathStats,
        )
    }

    fun stop() {
        running.getAndSet(null)?.cancel()
        try { localSocket?.close() } catch (_: Throwable) {}
        synchronized(pathsLock) {
            for (p in paths) {
                try { p.socket.close() } catch (_: Throwable) {}
            }
            paths.clear()
        }
        scope.cancel()
    }

    private class PathRuntime(
        val name: String,
        val network: Network,
        val socket: DatagramSocket,
        val server: InetSocketAddress,
        val cellular: Boolean,
    ) {
        @Volatile var active: Boolean = true
        val packetsSent = AtomicLong()
        val bytesSent = AtomicLong()
        val unique = AtomicLong()
        val dupes = AtomicLong()
    }

    data class PathStats(
        val name: String,
        val cellular: Boolean,
        val active: Boolean,
        val packetsSent: Long,
        val bytesSent: Long,
        val uniqueRx: Long,
        val dupesRx: Long,
    )

    data class Stats(
        val totalPackets: Long,
        val totalBytesUp: Long,
        val totalBytesDown: Long,
        val cellularBytesUp: Long,
        val paths: List<PathStats>,
    )

    companion object {
        private const val TAG = "AJ.Bonding"

        /** Helper: probe each candidate server through [network] and return the first that responds. */
        suspend fun pickReachableServer(
            network: Network,
            protect: (DatagramSocket) -> Boolean,
            servers: List<Pair<String, Int>>,
            perTryTimeoutMs: Long = 1500L,
        ): Pair<String, Int>? = withTimeoutOrNull(perTryTimeoutMs * servers.size + 1000L) {
            for ((host, port) in servers) {
                val socket = DatagramSocket()
                if (!protect(socket)) { socket.close(); continue }
                try {
                    network.bindSocket(socket)
                    val addr = network.getAllByName(host).firstOrNull() ?: run { socket.close(); continue }
                    socket.connect(InetSocketAddress(addr, port))
                    socket.soTimeout = perTryTimeoutMs.toInt()
                    val probe = Protocol.buildProbe()
                    val recv = ByteArray(64)
                    var ok = false
                    repeat(2) {
                        try {
                            socket.send(DatagramPacket(probe, probe.size))
                            val pkt = DatagramPacket(recv, recv.size)
                            socket.receive(pkt)
                            if (pkt.length == probe.size && recv.copyOfRange(0, pkt.length).contentEquals(probe)) {
                                ok = true
                                return@repeat
                            }
                        } catch (_: Throwable) {}
                    }
                    socket.close()
                    if (ok) return@withTimeoutOrNull host to port
                } catch (_: Throwable) {
                    try { socket.close() } catch (_: Throwable) {}
                }
            }
            null
        }
    }
}
