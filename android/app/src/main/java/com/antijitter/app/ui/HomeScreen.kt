package com.antijitter.app.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.antijitter.app.bonding.BondingClient
import com.antijitter.app.bonding.LatencyMonitor
import com.antijitter.app.ui.theme.Border
import com.antijitter.app.ui.theme.Dim
import com.antijitter.app.ui.theme.Green
import com.antijitter.app.ui.theme.Orange
import com.antijitter.app.ui.theme.Red
import com.antijitter.app.ui.theme.Surface
import com.antijitter.app.ui.theme.Teal
import com.antijitter.app.ui.theme.White
import com.antijitter.app.vpn.BondingVpnService

/**
 * Layout (Speedify-inspired, AntiJitter palette):
 *
 *   ┌──────────────────────────────────────┐
 *   │ AntíJitter             Sign out      │   header
 *   ├──────────────────────────────────────┤
 *   │  Game Mode             ─ • ─  on/off │   top-bar toggle
 *   │  Bonded paths active                 │
 *   ├──────────────────────────────────────┤
 *   │           — ms                       │   hero bonded latency
 *   │     −Δ ms vs Wi-Fi alone             │
 *   ├──────────────────────────────────────┤
 *   │ ACTIVE PATHS                         │
 *   │ ● Wi-Fi      3.2 MB sent             │   one-liner per path
 *   │ ● Cellular   1.4 MB sent             │
 *   ├──────────────────────────────────────┤
 *   │ Sent                  4.6 MB         │
 *   │ Received             82.1 MB         │
 *   │ Cellular used         1.4 MB         │
 *   │ Seamless failovers        —          │
 *   └──────────────────────────────────────┘
 *
 * Latency / jitter / packet loss show "—" until the bonding client measures
 * them via probe RTTs (next backend pass). All other numbers are wired up.
 */
@Composable
fun HomeScreen(
    email: String,
    status: BondingVpnService.Status,
    stats: BondingClient.Stats?,
    pathLatency: Map<String, LatencyMonitor.PathLatency>,
    busy: Boolean,
    error: String?,
    onToggle: () -> Unit,
    onSignOut: () -> Unit,
    // BEGIN DEV-TOGGLE (route-all) — remove for production
    routeAllTraffic: Boolean,
    onRouteAllTrafficChange: (Boolean) -> Unit,
    // END DEV-TOGGLE
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 20.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Header(email = email, onSignOut = onSignOut)
        GameModeToggleBar(status = status, busy = busy, error = error, onToggle = onToggle)
        HeroLatencyCard(status = status, pathLatency = pathLatency)
        ActivePathsCard(bondedPaths = stats?.paths.orEmpty(), pathLatency = pathLatency)
        if (stats != null) {
            SessionSummaryCard(stats)
        }
        // BEGIN DEV-TOGGLE (route-all) — remove for production
        DevRouteAllRow(
            enabled = routeAllTraffic,
            onChange = onRouteAllTrafficChange,
            tunnelActive = status.state == BondingVpnService.State.CONNECTED ||
                status.state == BondingVpnService.State.CONNECTING,
        )
        // END DEV-TOGGLE
    }
}

@Composable
private fun Header(email: String, onSignOut: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Antí", color = White, fontWeight = FontWeight.ExtraBold, fontSize = 18.sp)
                Text("Jitter", color = Teal, fontWeight = FontWeight.ExtraBold, fontSize = 18.sp)
            }
            Text(email, style = MaterialTheme.typography.bodySmall, color = Dim)
        }
        TextButton(onClick = onSignOut) { Text("Sign out", color = Dim) }
    }
}

@Composable
private fun GameModeToggleBar(
    status: BondingVpnService.Status,
    busy: Boolean,
    error: String?,
    onToggle: () -> Unit,
) {
    val state = status.state
    val on = state == BondingVpnService.State.CONNECTED ||
        state == BondingVpnService.State.CONNECTING
    val (statusLabel, statusColor) = when {
        error != null -> error to Red
        busy -> "Fetching tunnel config…" to Orange
        state == BondingVpnService.State.CONNECTED -> "Bonded paths active" to Teal
        state == BondingVpnService.State.CONNECTING -> "Probing networks…" to Orange
        state == BondingVpnService.State.FAILED -> (status.message ?: "Connection failed") to Red
        else -> "Tunnel idle" to Dim
    }
    val barColor by animateColorAsState(
        targetValue = if (on) Teal.copy(alpha = 0.10f) else Surface,
        label = "toggleBarBg",
    )

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(barColor)
            .padding(horizontal = 18.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = "Game Mode",
                color = if (on) Teal else White,
                fontWeight = FontWeight.Bold,
                fontSize = 16.sp,
            )
            Text(
                text = statusLabel,
                color = statusColor,
                style = MaterialTheme.typography.bodySmall,
            )
        }
        Switch(
            checked = on,
            onCheckedChange = { onToggle() },
            enabled = !busy,
            colors = SwitchDefaults.colors(
                checkedTrackColor = Teal,
                checkedThumbColor = Color.Black,
                uncheckedTrackColor = Color(0xFF2A2A2A),
                uncheckedThumbColor = Color(0xFFAAAAAA),
                disabledCheckedTrackColor = Orange,
                disabledUncheckedTrackColor = Color(0xFF2A2A2A),
            ),
        )
    }
}

@Composable
private fun HeroLatencyCard(
    status: BondingVpnService.Status,
    pathLatency: Map<String, LatencyMonitor.PathLatency>,
) {
    val on = status.state == BondingVpnService.State.CONNECTED
    // Bonded delivery picks the first-arriving packet, so the bonded RTT is
    // approximately the minimum across available paths. Until we measure
    // through-tunnel RTT directly, this is a good live proxy.
    val measured = pathLatency.values.filter { it.available && it.rttMs != null }
    val bestRtt = measured.minByOrNull { it.rttMs!! }?.rttMs
    val secondBest = measured.sortedBy { it.rttMs!! }.getOrNull(1)?.rttMs
    val delta = if (bestRtt != null && secondBest != null) (secondBest - bestRtt).toInt() else null

    val number = bestRtt?.toInt()?.toString() ?: "—"
    val numberColor = when {
        bestRtt == null -> Dim
        bestRtt < 50f -> Green
        bestRtt < 100f -> Teal
        bestRtt < 200f -> Orange
        else -> Red
    }
    val subtitle = when {
        bestRtt == null -> "Measuring paths…"
        on && delta != null -> "Bonded — saving up to ${delta} ms vs slowest path"
        on -> "Bonded delivery active"
        delta != null -> "Best path right now · turn on Game Mode to lock in"
        else -> "Best path right now · turn on Game Mode to lock in"
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Surface)
            .padding(horizontal = 22.dp, vertical = 22.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = if (on) "BONDED LATENCY" else "BEST PATH LATENCY",
            color = Dim,
            style = MaterialTheme.typography.labelSmall,
        )
        Spacer(Modifier.height(4.dp))
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                text = number,
                color = numberColor,
                fontWeight = FontWeight.ExtraBold,
                fontSize = 48.sp,
            )
            Spacer(Modifier.width(6.dp))
            Text(
                text = "ms",
                color = Dim,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(bottom = 10.dp),
            )
        }
        Spacer(Modifier.height(2.dp))
        Text(
            text = subtitle,
            color = Dim,
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

private data class PathDisplay(
    val name: String,
    val active: Boolean,
    val rttMs: Float?,
    val jitterMs: Float?,
    val bytesSent: Long?,
    val packetsSent: Long?,
)

private fun mergePaths(
    bondedPaths: List<BondingClient.PathStats>,
    pathLatency: Map<String, LatencyMonitor.PathLatency>,
): List<PathDisplay> {
    // Show one row per network the latency monitor knows about (so Wi-Fi and
    // Cellular appear before Game Mode is on), augmented with bytes/packets
    // from the bonding stats when available. Latency-monitor names match the
    // bonding service path names ("Wi-Fi", "Cellular"), so the merge is direct.
    if (pathLatency.isEmpty()) {
        // Initial state: fall back to whatever bonding reported (may be empty too).
        return bondedPaths.map { p ->
            PathDisplay(p.name, p.active, null, null, p.bytesSent, p.packetsSent)
        }
    }
    val order = listOf("Wi-Fi", "Cellular")
    return order.mapNotNull { name ->
        val lat = pathLatency[name] ?: return@mapNotNull null
        val bonded = bondedPaths.firstOrNull { it.name == name }
        PathDisplay(
            name = name,
            active = lat.available,
            rttMs = lat.rttMs,
            jitterMs = lat.jitterMs,
            bytesSent = bonded?.bytesSent,
            packetsSent = bonded?.packetsSent,
        )
    }
}

@Composable
private fun ActivePathsCard(
    bondedPaths: List<BondingClient.PathStats>,
    pathLatency: Map<String, LatencyMonitor.PathLatency>,
) {
    val merged = mergePaths(bondedPaths, pathLatency)
    if (merged.isEmpty()) return

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Surface)
            .padding(horizontal = 18.dp, vertical = 16.dp),
    ) {
        Text(
            text = "ACTIVE PATHS",
            color = Dim,
            style = MaterialTheme.typography.labelSmall,
        )
        Spacer(Modifier.height(10.dp))
        merged.forEachIndexed { i, p ->
            PathRow(p)
            if (i < merged.lastIndex) {
                Spacer(Modifier.height(6.dp))
                Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(Border))
                Spacer(Modifier.height(6.dp))
            }
        }
    }
}

@Composable
private fun PathRow(p: PathDisplay) {
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(if (p.active) Green else Dim),
            )
            Spacer(Modifier.width(12.dp))
            Text(
                text = p.name,
                color = White,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.width(80.dp),
            )
            Text(
                text = p.rttMs?.let { "${it.toInt()} ms" } ?: "—",
                color = if (p.active) White else Dim,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.weight(1f),
            )
            Text(
                text = p.jitterMs?.let { "±${it.toInt()} ms" } ?: "",
                color = Dim,
                style = MaterialTheme.typography.bodySmall,
            )
        }
        if (p.bytesSent != null) {
            Spacer(Modifier.height(2.dp))
            Row(modifier = Modifier.padding(start = 20.dp)) {
                Text(
                    text = "${formatBytes(p.bytesSent)} · ${p.packetsSent ?: 0} pkts",
                    color = Dim,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

@Composable
private fun SessionSummaryCard(stats: BondingClient.Stats) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Surface)
            .padding(horizontal = 18.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        SummaryRow("Sent", formatBytes(stats.totalBytesUp))
        SummaryRow("Received", formatBytes(stats.totalBytesDown))
        SummaryRow("Cellular used", formatBytes(stats.cellularBytesUp))
        SummaryRow("Seamless failovers", "—")
    }
}

@Composable
private fun SummaryRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, color = Dim, style = MaterialTheme.typography.bodyMedium)
        Text(value, color = White, fontWeight = FontWeight.SemiBold)
    }
}

private fun formatBytes(b: Long): String = when {
    b < 1024L -> "$b B"
    b < 1024L * 1024 -> "${b / 1024} KB"
    b < 1024L * 1024 * 1024 -> String.format("%.1f MB", b / 1024.0 / 1024.0)
    else -> String.format("%.2f GB", b / 1024.0 / 1024.0 / 1024.0)
}

// BEGIN DEV-TOGGLE (route-all) — remove for production
@Composable
private fun DevRouteAllRow(
    enabled: Boolean,
    onChange: (Boolean) -> Unit,
    tunnelActive: Boolean,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(Surface)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text("DEV: route ALL traffic", color = White, style = MaterialTheme.typography.bodyMedium)
            Text(
                if (tunnelActive) "Applies on next Game Mode toggle — turn off then on."
                else "Sends every packet through Germany (for speedtest.net checks).",
                color = Dim,
                style = MaterialTheme.typography.bodySmall,
            )
        }
        Switch(
            checked = enabled,
            onCheckedChange = onChange,
            colors = SwitchDefaults.colors(checkedTrackColor = Teal),
        )
    }
}
// END DEV-TOGGLE
