package com.antijitter.app.bonding

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.sqrt

/**
 * Measures individual path latency (Wi-Fi, mobile data) by timing TCP connects to a
 * known endpoint over each transport, independent of whether the VPN is up.
 *
 * Uses `NetworkRequest` with `NET_CAPABILITY_NOT_VPN` so binding a socket to the
 * acquired Network forces traffic through the physical interface and bypasses
 * our own bonded tunnel — otherwise we'd be measuring the tunnel, not the path.
 *
 * Output is a hot [StateFlow] keyed by display name ("Wi-Fi", "Mobile data") so
 * the UI can render one row per available transport.
 */
class LatencyMonitor(context: Context) {

    data class PathLatency(
        val name: String,
        val available: Boolean,
        /** Last measured RTT in ms, or null if the network is gone or the probe failed. */
        val rttMs: Float?,
        /** Rolling stddev over [HISTORY_SIZE] samples. Null until we have at least 4 samples. */
        val jitterMs: Float?,
    )

    private val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _state = MutableStateFlow<Map<String, PathLatency>>(emptyMap())
    val state: StateFlow<Map<String, PathLatency>> = _state.asStateFlow()

    private val history = ConcurrentHashMap<String, ArrayDeque<Float>>()
    private val networks = ConcurrentHashMap<String, Network>()
    private var watchJob: Job? = null
    private val callbacks = mutableListOf<ConnectivityManager.NetworkCallback>()

    fun start() {
        if (watchJob?.isActive == true) return
        TRANSPORTS.forEach { (transport, name) ->
            registerCallback(transport, name)
        }
        watchJob = scope.launch {
            while (isActive) {
                TRANSPORTS.forEach { (_, name) -> probe(name) }
                delay(INTERVAL_MS)
            }
        }
    }

    fun stop() {
        watchJob?.cancel()
        watchJob = null
        synchronized(callbacks) {
            for (cb in callbacks) {
                try { cm.unregisterNetworkCallback(cb) } catch (_: Throwable) {}
            }
            callbacks.clear()
        }
        networks.clear()
        history.clear()
        _state.value = emptyMap()
        scope.cancel()
    }

    private fun registerCallback(transport: Int, name: String) {
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
            .addTransportType(transport)
            .build()
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                networks[name] = network
                upsert(name) { it.copy(available = true) }
            }
            override fun onLost(network: Network) {
                if (networks[name] == network) {
                    networks.remove(name)
                    history.remove(name)
                    upsert(name) { it.copy(available = false, rttMs = null, jitterMs = null) }
                }
            }
        }
        cm.requestNetwork(request, cb)
        synchronized(callbacks) { callbacks += cb }
    }

    private suspend fun probe(name: String) {
        val net = networks[name] ?: return
        val rtt = measureRtt(net) ?: return
        val q = history.getOrPut(name) { ArrayDeque() }
        synchronized(q) {
            q.addLast(rtt)
            while (q.size > HISTORY_SIZE) q.removeFirst()
        }
        val jitter = stddev(q)
        upsert(name) { it.copy(available = true, rttMs = rtt, jitterMs = jitter) }
    }

    private suspend fun measureRtt(network: Network): Float? = withContext(Dispatchers.IO) {
        // TCP connect time to a reliable anycasted endpoint approximates RTT.
        // Cloudflare DNS over TLS port (853) is reachable from most cellular APNs;
        // 443 also works but cellular carriers sometimes do TLS bumping there.
        val socket = Socket()
        try {
            network.bindSocket(socket)
            val start = System.nanoTime()
            socket.connect(InetSocketAddress(PROBE_HOST, PROBE_PORT), CONNECT_TIMEOUT_MS)
            val elapsed = (System.nanoTime() - start) / 1_000_000.0
            elapsed.toFloat()
        } catch (t: Throwable) {
            Log.v(TAG, "probe via ${network} failed: ${t.message}")
            null
        } finally {
            try { socket.close() } catch (_: Throwable) {}
        }
    }

    private fun stddev(samples: ArrayDeque<Float>): Float? {
        val snap = synchronized(samples) { samples.toList() }
        if (snap.size < 4) return null
        val mean = snap.average().toFloat()
        val variance = snap.fold(0.0) { acc, v -> acc + (v - mean) * (v - mean) } / snap.size
        return sqrt(variance).toFloat()
    }

    private fun upsert(name: String, transform: (PathLatency) -> PathLatency) {
        _state.value = _state.value.toMutableMap().also { m ->
            val current = m[name] ?: PathLatency(name = name, available = false, rttMs = null, jitterMs = null)
            m[name] = transform(current)
        }
    }

    companion object {
        private const val TAG = "AJ.Latency"
        private const val INTERVAL_MS = 2000L
        private const val CONNECT_TIMEOUT_MS = 1500
        private const val HISTORY_SIZE = 30
        private const val PROBE_HOST = "1.1.1.1"
        private const val PROBE_PORT = 443

        private val TRANSPORTS = listOf(
            NetworkCapabilities.TRANSPORT_WIFI to "Wi-Fi",
            NetworkCapabilities.TRANSPORT_CELLULAR to "Mobile data",
        )
    }
}
