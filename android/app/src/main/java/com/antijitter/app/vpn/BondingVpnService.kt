package com.antijitter.app.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.NetworkCapabilities
import android.net.VpnService
import android.os.IBinder
import android.os.ParcelFileDescriptor
import android.util.Log
import androidx.core.app.NotificationCompat
import com.antijitter.app.MainActivity
import com.antijitter.app.BondingVpnServiceStats
import com.antijitter.app.R
import com.antijitter.app.api.AntiJitterConfig
import com.antijitter.app.bonding.BondingClient
import com.antijitter.app.bonding.NetworkBinder
import com.antijitter.app.wg.WireGuardTunnel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json

/**
 * VPN backbone for the AntiJitter Android client.
 *
 * Flow:
 *   1. ConnectivityManager.requestNetwork() acquires Wi-Fi and Cellular [Network]s independently.
 *   2. For each, probe the bonding server list to find a reachable host:port pair.
 *   3. Build the TUN with VpnService.Builder using the WireGuard peer IP.
 *   4. Start [BondingClient] listening on 127.0.0.1:<ephemeral>.
 *   5. Start [WireGuardTunnel] with endpoint=127.0.0.1:<bonding port>; wireguard-go
 *      reads the TUN fd, encrypts, and sends UDP into the bonding listener.
 *   6. Bonding wraps each packet with a 4-byte seq, fans out across all paths.
 *
 * Replies from the server come in on either path's socket, get deduped, and are
 * forwarded to wireguard-go via the local UDP socket; wireguard-go decrypts and
 * writes plaintext IP packets back to the TUN.
 */
class BondingVpnService : VpnService() {

    enum class State { DISCONNECTED, CONNECTING, CONNECTED, FAILED }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var startJob: Job? = null

    private var tun: ParcelFileDescriptor? = null
    private var bonding: BondingClient? = null
    private var wireguard: WireGuardTunnel? = null
    private var binder: NetworkBinder? = null

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "onCreate")
        BondingVpnServiceStats.setProvider { bonding?.stats() }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "onStartCommand: action=${intent?.action}")
        when (intent?.action) {
            ACTION_START -> {
                val configJson = intent.getStringExtra(EXTRA_CONFIG_JSON)
                if (configJson == null) {
                    Log.e(TAG, "ACTION_START missing $EXTRA_CONFIG_JSON")
                    setState(State.FAILED, "Missing config")
                    return START_NOT_STICKY
                }
                startTunnel(configJson)
            }
            ACTION_STOP -> {
                stopTunnel("user request")
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        val current = statusFlow.value.state
        Log.i(TAG, "onDestroy (state=$current)")
        cleanup()
        startJob?.cancel()
        startJob = null
        when (current) {
            // Preserve existing error so the UI can show why we died.
            State.FAILED -> { /* keep */ }
            // If we were still CONNECTING, the system killed us before we
            // finished. Don't hide it — surface it.
            State.CONNECTING -> setState(
                State.FAILED,
                "VPN service terminated before the tunnel came up (check battery / app standby).",
            )
            else -> setState(State.DISCONNECTED, null)
        }
        BondingVpnServiceStats.setProvider(null)
        scope.cancel()
        super.onDestroy()
    }

    override fun onRevoke() {
        Log.w(TAG, "onRevoke — system or another VPN preempted us")
        stopTunnel("revoked by system")
        super.onRevoke()
    }

    private fun startTunnel(configJson: String) {
        if (startJob?.isActive == true) {
            Log.w(TAG, "start requested while already starting")
            return
        }
        Log.i(TAG, "startTunnel: state -> CONNECTING")
        setState(State.CONNECTING, null)
        try {
            ensureChannel()
            // VpnService is auto-classified as type=vpn by Android; no type arg needed.
            startForeground(NOTIF_ID, buildNotification("Connecting…", "Setting up bonded paths"))
        } catch (t: Throwable) {
            Log.e(TAG, "startForeground failed", t)
            setState(State.FAILED, "Foreground start denied: ${t.message}")
            stopSelf()
            return
        }

        startJob = scope.launch {
            try {
                val config = Json { ignoreUnknownKeys = true }
                    .decodeFromString(AntiJitterConfig.serializer(), configJson)
                doStart(config)
                Log.i(TAG, "tunnel fully up — state -> CONNECTED")
                setState(State.CONNECTED, null)
            } catch (t: Throwable) {
                Log.e(TAG, "tunnel start failed", t)
                setState(State.FAILED, t.message ?: t::class.java.simpleName)
                cleanup()
            }
        }
    }

    private suspend fun doStart(config: AntiJitterConfig) {
        val nb = NetworkBinder(applicationContext).also { binder = it }

        val servers = config.bonding_servers.mapNotNull(::parseHostPort)
        require(servers.isNotEmpty()) { "config.bonding_servers empty or malformed" }

        // Acquire networks in parallel — cellular often takes longer to register.
        val wifiDeferred = scope.async { nb.acquire(NetworkCapabilities.TRANSPORT_WIFI) }
        val cellDeferred = scope.async { nb.acquire(NetworkCapabilities.TRANSPORT_CELLULAR) }
        val wifi = wifiDeferred.await()
        val cell = cellDeferred.await()

        if (wifi == null && cell == null) {
            throw IllegalStateException("No Wi-Fi or cellular network available")
        }
        Log.i(TAG, "networks: wifi=${wifi != null} cellular=${cell != null}")

        // Build the TUN before we start userspace WireGuard.
        val ipParts = config.wireguard.address.split("/")
        val ip = ipParts[0]
        val prefix = ipParts.getOrNull(1)?.toIntOrNull() ?: 24

        val builder = Builder()
            .setSession("AntiJitter")
            .addAddress(ip, prefix)
            .addDnsServer(config.wireguard.dns)
            .setMtu(1280)
        for (cidr in config.wireguard.allowed_ips) {
            val (route, plen) = parseCidr(cidr) ?: continue
            builder.addRoute(route, plen)
        }
        // Make sure our own UDP sockets to the bonding server don't loop back through the TUN.
        builder.addDisallowedApplication(packageName)

        val tunFd = builder.establish()
            ?: throw IllegalStateException("VpnService.Builder.establish() returned null — VPN not prepared?")
        tun = tunFd

        // Bonding listener — WireGuard's UDP endpoint will be 127.0.0.1:<this port>.
        val client = BondingClient(protect = ::protect).also { bonding = it }
        val bondingPort = client.startLocalListener()
        client.setDataLimit(config.data_limit_mb)

        var pathsAdded = 0
        if (wifi != null) {
            val pick = BondingClient.pickReachableServer(wifi, ::protect, servers)
            if (pick != null) {
                val ok = client.addPath("Wi-Fi", wifi, pick.first, pick.second, isCellular = false)
                if (ok) pathsAdded++
            } else {
                Log.w(TAG, "Wi-Fi: no bonding server reachable")
            }
        }
        if (cell != null) {
            val pick = BondingClient.pickReachableServer(cell, ::protect, servers)
            if (pick != null) {
                val ok = client.addPath("Cellular", cell, pick.first, pick.second, isCellular = true)
                if (ok) pathsAdded++
            } else {
                Log.w(TAG, "Cellular: no bonding server reachable")
            }
        }
        if (pathsAdded == 0) {
            throw IllegalStateException("No bonding paths reachable")
        }

        wireguard = WireGuardTunnel.start(
            name = "antijitter",
            tunFd = tunFd.fd,
            privateKeyBase64 = config.wireguard.private_key,
            peerPublicKeyBase64 = config.wireguard.peer_key,
            bondingEndpoint = "127.0.0.1:$bondingPort",
            allowedIps = config.wireguard.allowed_ips,
        )

        // Stats poll → notification refresh
        scope.launch {
            while (isActive) {
                delay(2000)
                refreshNotification()
            }
        }
    }

    private fun stopTunnel(reason: String) {
        Log.i(TAG, "stopping: $reason")
        startJob?.cancel()
        startJob = null
        cleanup()
        setState(State.DISCONNECTED, null)
        try {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } catch (_: Throwable) {}
    }

    private fun cleanup() {
        try { wireguard?.stop() } catch (_: Throwable) {}
        wireguard = null
        try { bonding?.stop() } catch (_: Throwable) {}
        bonding = null
        try { tun?.close() } catch (_: Throwable) {}
        tun = null
        try { binder?.releaseAll() } catch (_: Throwable) {}
        binder = null
    }

    // ---- foreground service / notifications ------------------------------

    private fun refreshNotification() {
        val stats = bonding?.stats() ?: return
        val activePaths = stats.paths.count { it.active }
        val mbUp = stats.totalBytesUp / 1024 / 1024
        val mbDown = stats.totalBytesDown / 1024 / 1024
        val title = "Game Mode active — $activePaths path${if (activePaths == 1) "" else "s"}"
        val body = "↑ ${mbUp} MB · ↓ ${mbDown} MB · cellular ${stats.cellularBytesUp / 1024 / 1024} MB"
        val nm = getSystemService(NotificationManager::class.java)
        nm?.notify(NOTIF_ID, buildNotification(title, body))
    }

    private fun buildNotification(title: String, text: String): Notification {
        val pending = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentIntent(pending)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
    }

    private fun ensureChannel() {
        val nm = getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        val ch = NotificationChannel(CHANNEL_ID, "Game Mode", NotificationManager.IMPORTANCE_LOW)
        ch.description = "Active bonded VPN tunnel"
        nm.createNotificationChannel(ch)
    }

    private fun setState(state: State, message: String?) {
        statusFlow.value = Status(state, message)
    }

    // ---- Helpers --------------------------------------------------------

    private fun parseHostPort(s: String): Pair<String, Int>? {
        val idx = s.lastIndexOf(':')
        if (idx <= 0 || idx == s.length - 1) return null
        val host = s.substring(0, idx)
        val port = s.substring(idx + 1).toIntOrNull() ?: return null
        return host to port
    }

    private fun parseCidr(s: String): Pair<String, Int>? {
        val parts = s.split("/")
        if (parts.size != 2) return null
        val plen = parts[1].toIntOrNull() ?: return null
        return parts[0] to plen
    }

    data class Status(val state: State, val message: String?) {
        val isActive: Boolean get() = state == State.CONNECTED || state == State.CONNECTING
    }

    companion object {
        private const val TAG = "AJ.Vpn"
        private const val CHANNEL_ID = "antijitter_vpn"
        private const val NOTIF_ID = 0x4747

        const val ACTION_START = "com.antijitter.app.action.START"
        const val ACTION_STOP = "com.antijitter.app.action.STOP"
        const val EXTRA_CONFIG_JSON = "config_json"

        /** Globally observable state for the UI. Single instance — only one tunnel at a time. */
        val statusFlow = MutableStateFlow(Status(State.DISCONNECTED, null))
        val status: StateFlow<Status> = statusFlow.asStateFlow()

        fun start(context: Context, configJson: String) {
            val intent = Intent(context, BondingVpnService::class.java)
                .setAction(ACTION_START)
                .putExtra(EXTRA_CONFIG_JSON, configJson)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, BondingVpnService::class.java).setAction(ACTION_STOP)
            context.startService(intent)
        }
    }
}
