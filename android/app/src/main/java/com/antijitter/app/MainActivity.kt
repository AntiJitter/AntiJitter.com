package com.antijitter.app

import android.app.Activity
import android.content.Intent
import android.net.VpnService
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.antijitter.app.api.ApiClient
import com.antijitter.app.api.ApiException
import com.antijitter.app.api.AntiJitterConfig
import com.antijitter.app.bonding.BondingClient
import com.antijitter.app.bonding.LatencyMonitor
import com.antijitter.app.store.AuthStore
import com.antijitter.app.ui.HomeScreen
import com.antijitter.app.ui.LoginScreen
import com.antijitter.app.ui.theme.AntiJitterTheme
import com.antijitter.app.ui.theme.Black
import com.antijitter.app.vpn.BondingVpnService
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class MainActivity : ComponentActivity() {

    private lateinit var pendingConfigJson: String
    private var pendingMode: BondingClient.Mode = BondingClient.Mode.GAMING
    private val vpnPermission =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
            if (res.resultCode == Activity.RESULT_OK) {
                android.util.Log.i("AJ.UI", "VPN consent granted, starting service")
                BondingVpnService.start(this, pendingConfigJson, pendingMode)
            } else {
                android.util.Log.w("AJ.UI", "VPN consent denied (resultCode=${res.resultCode})")
                BondingVpnService.statusFlow.value = BondingVpnService.Status(
                    BondingVpnService.State.FAILED,
                    "VPN permission denied. Tap Game Mode again and allow the connection.",
                )
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            AntiJitterTheme {
                Surface(modifier = Modifier.fillMaxSize().background(Black)) {
                    Box(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
                        val vm: AppViewModel = viewModel()
                        AppRoot(
                            vm = vm,
                            onRequestVpnPermission = ::requestVpnPermission,
                            onOpenVpnSettings = ::openVpnSettings,
                            onOpenHotspotSettings = ::openHotspotSettings,
                        )
                    }
                }
            }
        }
    }

    private fun requestVpnPermission(configJson: String, mode: BondingClient.Mode) {
        android.util.Log.i("AJ.UI", "requestVpnPermission: preparing VPN (mode=$mode)")
        pendingConfigJson = configJson
        pendingMode = mode
        val intent = VpnService.prepare(this)
        if (intent != null) {
            android.util.Log.i("AJ.UI", "requestVpnPermission: launching consent dialog")
            vpnPermission.launch(intent)
        } else {
            android.util.Log.i("AJ.UI", "requestVpnPermission: already granted, starting service")
            BondingVpnService.start(this, configJson, mode)
        }
    }

    private fun openVpnSettings() {
        openSystemSettings(Settings.ACTION_VPN_SETTINGS)
    }

    private fun openHotspotSettings() {
        openSystemSettings(ACTION_TETHER_SETTINGS, Settings.ACTION_WIRELESS_SETTINGS)
    }

    private fun openSystemSettings(action: String, fallback: String = Settings.ACTION_SETTINGS) {
        val opened = runCatching { startActivity(Intent(action)) }.isSuccess
        if (!opened) {
            runCatching { startActivity(Intent(fallback)) }
        }
    }

    companion object {
        private const val ACTION_TETHER_SETTINGS = "android.settings.TETHER_SETTINGS"
    }
}

@Composable
private fun AppRoot(
    vm: AppViewModel,
    onRequestVpnPermission: (String, BondingClient.Mode) -> Unit,
    onOpenVpnSettings: () -> Unit,
    onOpenHotspotSettings: () -> Unit,
) {
    val ui by vm.ui.collectAsState()
    val vpnStatus by BondingVpnService.status.collectAsState()
    val stats by vm.stats.collectAsState()
    val pathLatency by vm.pathLatency.collectAsState()

    LaunchedEffect(vm) { vm.init() }
    LaunchedEffect(Unit) {
        while (true) {
            delay(1000)
            vm.refreshStats()
        }
    }
    LaunchedEffect(ui.startRequest, ui.pendingMode) {
        val req = ui.startRequest ?: return@LaunchedEffect
        onRequestVpnPermission(req, ui.pendingMode)
        vm.consumeStartRequest()
    }

    val token = ui.token
    if (token == null) {
        LoginScreen(
            isLoading = ui.busy,
            error = ui.error,
            onSubmit = { e, p -> vm.login(e, p) },
        )
    } else {
        HomeScreen(
            email = ui.email.orEmpty(),
            status = vpnStatus,
            stats = stats,
            pathLatency = pathLatency,
            tunnelMode = ui.tunnelMode,
            onTunnelModeChange = { vm.setTunnelMode(it) },
            busy = ui.busy,
            error = ui.error,
            onToggle = { vm.toggleTunnel(vpnStatus) },
            onSignOut = { vm.signOut() },
            onOpenVpnSettings = onOpenVpnSettings,
            onOpenHotspotSettings = onOpenHotspotSettings,
            // BEGIN DEV-TOGGLE (route-all) — remove for production
            routeAllTraffic = ui.routeAllTraffic,
            onRouteAllTrafficChange = { vm.setRouteAllTraffic(it) },
            // END DEV-TOGGLE
        )
    }
}

class AppViewModel(app: android.app.Application) : AndroidViewModel(app) {

    private val store = AuthStore(app)
    private val api = ApiClient()
    private val latencyMonitor = LatencyMonitor(app)

    private val _ui = MutableStateFlow(UiState())
    val ui: StateFlow<UiState> = _ui.asStateFlow()

    private val _stats = MutableStateFlow<BondingClient.Stats?>(null)
    val stats: StateFlow<BondingClient.Stats?> = _stats.asStateFlow()

    val pathLatency: StateFlow<Map<String, LatencyMonitor.PathLatency>> = latencyMonitor.state

    private val json = Json { encodeDefaults = true }

    fun init() {
        latencyMonitor.start()
        viewModelScope.launch {
            val tok = store.token.first()
            val em = store.email.first()
            _ui.value = _ui.value.copy(token = tok, email = em)
        }
    }

    override fun onCleared() {
        super.onCleared()
        latencyMonitor.stop()
    }

    fun login(email: String, password: String) {
        if (email.isBlank() || password.isBlank()) return
        _ui.value = _ui.value.copy(busy = true, error = null)
        viewModelScope.launch {
            try {
                val resp = api.login(email, password)
                store.save(resp.token, resp.user.email)
                _ui.value = _ui.value.copy(busy = false, token = resp.token, email = resp.user.email, error = null)
            } catch (e: ApiException) {
                _ui.value = _ui.value.copy(busy = false, error = e.message)
            } catch (t: Throwable) {
                _ui.value = _ui.value.copy(busy = false, error = t.message ?: "Network error")
            }
        }
    }

    fun signOut() {
        viewModelScope.launch {
            BondingVpnService.stop(getApplication())
            store.clear()
            _ui.value = UiState()
        }
    }

    fun toggleTunnel(current: BondingVpnService.Status) {
        android.util.Log.i("AJ.UI", "toggleTunnel: current=${current.state}")
        if (current.state == BondingVpnService.State.CONNECTED ||
            current.state == BondingVpnService.State.CONNECTING
        ) {
            BondingVpnService.stop(getApplication())
            return
        }
        val token = _ui.value.token
        if (token == null) {
            android.util.Log.w("AJ.UI", "toggleTunnel: no token — forcing re-login")
            _ui.value = _ui.value.copy(busy = false, error = "Please sign in again", token = null)
            return
        }
        _ui.value = _ui.value.copy(busy = true, error = null)
        viewModelScope.launch {
            try {
                android.util.Log.i("AJ.UI", "toggleTunnel: GET /api/config")
                val fetched = api.fetchConfig(token)
                android.util.Log.i("AJ.UI", "toggleTunnel: config OK, bonding_servers=${fetched.bonding_servers}")
                // BEGIN DEV-TOGGLE (route-all) — remove for production
                val cfg = if (_ui.value.routeAllTraffic) {
                    android.util.Log.w("AJ.UI", "DEV: routing ALL traffic through the tunnel")
                    fetched.copy(wireguard = fetched.wireguard.copy(allowed_ips = listOf("0.0.0.0/0")))
                } else fetched
                // END DEV-TOGGLE
                val raw = json.encodeToString(AntiJitterConfig.serializer(), cfg)
                _ui.value = _ui.value.copy(
                    busy = false,
                    startRequest = raw,
                    pendingMode = _ui.value.tunnelMode,
                )
            } catch (e: ApiException) {
                android.util.Log.w("AJ.UI", "toggleTunnel: API ${e.status}: ${e.message}")
                if (e.status == 401) {
                    store.clear()
                    _ui.value = UiState(error = "Session expired — sign in again")
                } else if (e.status == 403) {
                    _ui.value = _ui.value.copy(
                        busy = false,
                        error = "No active subscription. Start one at antijitter.com/dashboard.",
                    )
                } else {
                    _ui.value = _ui.value.copy(busy = false, error = "Config: ${e.message}")
                }
            } catch (t: Throwable) {
                android.util.Log.e("AJ.UI", "toggleTunnel: unexpected", t)
                _ui.value = _ui.value.copy(busy = false, error = t.message ?: "Network error")
            }
        }
    }

    fun consumeStartRequest() {
        _ui.value = _ui.value.copy(startRequest = null)
    }

    fun setTunnelMode(mode: BondingClient.Mode) {
        if (_ui.value.tunnelMode == mode) return
        _ui.value = _ui.value.copy(tunnelMode = mode)
        // If the tunnel is already up, push the new dispatch mode to the
        // running BondingClient — no reconnect required.
        BondingVpnService.setMode(getApplication(), mode)
    }

    // BEGIN DEV-TOGGLE (route-all) — remove for production
    fun setRouteAllTraffic(enabled: Boolean) {
        _ui.value = _ui.value.copy(routeAllTraffic = enabled)
    }
    // END DEV-TOGGLE

    fun refreshStats() {
        // Reach into the running service via the singleton flow — simple approach for one-tunnel app.
        _stats.value = BondingVpnServiceStats.snapshot()
    }

    data class UiState(
        val token: String? = null,
        val email: String? = null,
        val busy: Boolean = false,
        val error: String? = null,
        val startRequest: String? = null,
        val tunnelMode: BondingClient.Mode = BondingClient.Mode.GAMING,
        /** Snapshot of [tunnelMode] at the moment the start was requested, so the consent dialog uses the same mode the user was looking at. */
        val pendingMode: BondingClient.Mode = BondingClient.Mode.GAMING,
        // BEGIN DEV-TOGGLE (route-all) — remove for production
        val routeAllTraffic: Boolean = false,
        // END DEV-TOGGLE
    )
}

/** Bridge: lets the UI poll bonding stats without a Service binding. */
object BondingVpnServiceStats {
    @Volatile private var provider: (() -> BondingClient.Stats?)? = null
    fun setProvider(p: (() -> BondingClient.Stats?)?) { provider = p }
    fun snapshot(): BondingClient.Stats? = provider?.invoke()
}
