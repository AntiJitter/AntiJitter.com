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
import java.util.ArrayDeque

/**
 * Lightweight local Starlink detector for Android.
 *
 * Starlink exposes richer gRPC telemetry on 192.168.100.1:9200, but Android
 * would need generated Starlink protobuf bindings to parse it directly. This
 * monitor starts with robust reachability and latency probes over the bound
 * Wi-Fi Network so the UI can show Starlink status and recent dish dropouts.
 */
class StarlinkMonitor(context: Context) {

    data class Event(
        val ts: Long,
        val title: String,
        val detail: String,
    )

    data class State(
        val detected: Boolean = false,
        val reachable: Boolean = false,
        val lastRttMs: Float? = null,
        val outageActive: Boolean = false,
        val outageStartedAt: Long? = null,
        val lastOutageSeconds: Int? = null,
        val events: List<Event> = emptyList(),
    )

    private val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state.asStateFlow()

    private var wifiNetwork: Network? = null
    private var callback: ConnectivityManager.NetworkCallback? = null
    private var watchJob: Job? = null

    fun start() {
        if (watchJob?.isActive == true) return

        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .build()
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                wifiNetwork = network
            }

            override fun onLost(network: Network) {
                if (wifiNetwork == network) {
                    wifiNetwork = null
                    handleProbe(null)
                }
            }
        }
        cm.requestNetwork(request, cb)
        callback = cb

        watchJob = scope.launch {
            while (isActive) {
                val net = wifiNetwork
                val rtt = if (net == null) null else probeDish(net)
                handleProbe(rtt)
                delay(INTERVAL_MS)
            }
        }
    }

    fun stop() {
        watchJob?.cancel()
        watchJob = null
        callback?.let { cb -> runCatching { cm.unregisterNetworkCallback(cb) } }
        callback = null
        wifiNetwork = null
        _state.value = State()
        scope.cancel()
    }

    private suspend fun probeDish(network: Network): Float? = withContext(Dispatchers.IO) {
        val socket = Socket()
        try {
            network.bindSocket(socket)
            val start = System.nanoTime()
            socket.connect(InetSocketAddress(DISH_HOST, DISH_PORT), CONNECT_TIMEOUT_MS)
            ((System.nanoTime() - start) / 1_000_000.0).toFloat()
        } catch (t: Throwable) {
            Log.v(TAG, "Starlink dish probe failed: ${t.message}")
            null
        } finally {
            try { socket.close() } catch (_: Throwable) {}
        }
    }

    @Synchronized
    private fun handleProbe(rttMs: Float?) {
        val now = System.currentTimeMillis()
        val prior = _state.value
        val misses = recentMisses

        if (rttMs == null) {
            misses.addLast(now)
            while (misses.size > MISS_WINDOW) misses.removeFirst()
        } else {
            misses.clear()
        }

        val detected = prior.detected || rttMs != null
        val isOutage = detected && misses.size >= MISS_WINDOW
        var next = prior.copy(
            detected = detected,
            reachable = rttMs != null,
            lastRttMs = rttMs ?: prior.lastRttMs,
        )

        if (isOutage && !prior.outageActive) {
            next = next.copy(
                outageActive = true,
                outageStartedAt = misses.peekFirst() ?: now,
                events = prependEvent(prior.events, Event(now, "Starlink unreachable", "Dish stopped responding on Wi-Fi")),
            )
        } else if (!isOutage && prior.outageActive) {
            val started = prior.outageStartedAt ?: now
            val seconds = ((now - started) / 1000L).toInt().coerceAtLeast(1)
            next = next.copy(
                outageActive = false,
                outageStartedAt = null,
                lastOutageSeconds = seconds,
                events = prependEvent(prior.events, Event(now, "Starlink recovered", "Dish reachable again after ${seconds}s")),
            )
        }

        _state.value = next
    }

    private fun prependEvent(events: List<Event>, event: Event): List<Event> =
        (listOf(event) + events).take(MAX_EVENTS)

    private val recentMisses = ArrayDeque<Long>()

    companion object {
        private const val TAG = "AJ.Starlink"
        private const val DISH_HOST = "192.168.100.1"
        private const val DISH_PORT = 9200
        private const val CONNECT_TIMEOUT_MS = 900
        private const val INTERVAL_MS = 2500L
        private const val MISS_WINDOW = 3
        private const val MAX_EVENTS = 5
    }
}
