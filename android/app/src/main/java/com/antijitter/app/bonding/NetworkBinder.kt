package com.antijitter.app.bonding

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import java.net.DatagramSocket

/**
 * Acquires Wi-Fi and cellular [Network] objects independently so each bonding
 * socket can be pinned to its own interface via [Network.bindSocket].
 *
 * Android equivalent of Windows IP_UNICAST_IF — but it actually works reliably.
 */
class NetworkBinder(context: Context) {
    private val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private val callbacks = mutableListOf<ConnectivityManager.NetworkCallback>()

    /** Returns the requested network when it becomes available, or null on timeout. */
    suspend fun acquire(transport: Int, timeoutMs: Long = 5000): Network? {
        val deferred = CompletableDeferred<Network?>()
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
            .addTransportType(transport)
            .build()

        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                if (!deferred.isCompleted) deferred.complete(network)
            }
            override fun onUnavailable() {
                if (!deferred.isCompleted) deferred.complete(null)
            }
        }
        cm.requestNetwork(request, cb)
        synchronized(callbacks) { callbacks += cb }

        return withTimeoutOrNull(timeoutMs) { deferred.await() }
    }

    /** Releases all networks acquired through this binder. */
    fun releaseAll() {
        synchronized(callbacks) {
            for (cb in callbacks) {
                try { cm.unregisterNetworkCallback(cb) } catch (_: Throwable) {}
            }
            callbacks.clear()
        }
    }
}

/**
 * Binds [socket] to [network] so packets are forced through that physical
 * interface regardless of the device's default route.
 */
fun Network.bindUdp(socket: DatagramSocket) {
    bindSocket(socket)
}

/** A path is a UDP socket pinned to a specific [Network], targeting a specific server. */
data class Path(
    val name: String,
    val network: Network,
    val socket: DatagramSocket,
    val serverHost: String,
    val serverPort: Int,
)
