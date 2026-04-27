package com.antijitter.app.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.antijitter.app.bonding.BondingClient
import com.antijitter.app.bonding.LatencyMonitor
import com.antijitter.app.ui.theme.Black
import com.antijitter.app.ui.theme.Border
import com.antijitter.app.ui.theme.Dim
import com.antijitter.app.ui.theme.Green
import com.antijitter.app.ui.theme.Orange
import com.antijitter.app.ui.theme.Red
import com.antijitter.app.ui.theme.Surface
import com.antijitter.app.ui.theme.Teal
import com.antijitter.app.ui.theme.White
import com.antijitter.app.vpn.BondingVpnService

@Composable
fun HomeScreen(
    email: String,
    status: BondingVpnService.Status,
    stats: BondingClient.Stats?,
    pathLatency: Map<String, LatencyMonitor.PathLatency>,
    tunnelMode: BondingClient.Mode,
    onTunnelModeChange: (BondingClient.Mode) -> Unit,
    busy: Boolean,
    error: String?,
    onToggle: () -> Unit,
    onSignOut: () -> Unit,
    onOpenVpnSettings: () -> Unit,
    onOpenHotspotSettings: () -> Unit,
    // BEGIN DEV-TOGGLE (route-all) - remove for production
    routeAllTraffic: Boolean,
    onRouteAllTrafficChange: (Boolean) -> Unit,
    // END DEV-TOGGLE
) {
    val tunnelActive = status.state == BondingVpnService.State.CONNECTED ||
        status.state == BondingVpnService.State.CONNECTING
    var showShareDialog by remember { mutableStateOf(false) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Black),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(250.dp)
                .background(
                    Brush.verticalGradient(
                        0f to Teal.copy(alpha = if (tunnelActive) 0.18f else 0.10f),
                        0.58f to Color(0xFF0E1718).copy(alpha = 0.28f),
                        1f to Color.Transparent,
                    ),
                ),
        )
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 18.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Header(email = email, status = status, onSignOut = onSignOut)
            HeroConnectionCard(
                status = status,
                busy = busy,
                error = error,
                pathLatency = pathLatency,
                onToggle = onToggle,
            )
            ModeSelectorCard(selected = tunnelMode, onSelect = onTunnelModeChange)
            ActivePathsCard(bondedPaths = stats?.paths.orEmpty(), pathLatency = pathLatency)
            SessionSummaryCard(stats = stats, onShareGameMode = { showShareDialog = true })
            // BEGIN DEV-TOGGLE (route-all) - remove for production
            DevRouteAllRow(
                enabled = routeAllTraffic,
                onChange = onRouteAllTrafficChange,
                tunnelActive = tunnelActive,
            )
            // END DEV-TOGGLE
        }
        if (showShareDialog) {
            ShareGameModeDialog(
                onDismiss = { showShareDialog = false },
                onOpenHotspotSettings = onOpenHotspotSettings,
                onOpenVpnSettings = onOpenVpnSettings,
            )
        }
    }
}

@Composable
private fun Header(
    email: String,
    status: BondingVpnService.Status,
    onSignOut: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Anti", color = White, fontWeight = FontWeight.ExtraBold, fontSize = 23.sp)
                Text("Jitter", color = Teal, fontWeight = FontWeight.ExtraBold, fontSize = 23.sp)
            }
            Text(email, style = MaterialTheme.typography.bodySmall, color = Dim)
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(5.dp)) {
            ConnectionPill(status)
            TextButton(onClick = onSignOut) {
                Text("Sign out", color = Dim, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun ConnectionPill(status: BondingVpnService.Status) {
    val (label, color) = when (status.state) {
        BondingVpnService.State.CONNECTED -> "Connected" to Green
        BondingVpnService.State.CONNECTING -> "Connecting" to Orange
        BondingVpnService.State.FAILED -> "Needs attention" to Red
        BondingVpnService.State.DISCONNECTED -> "Idle" to Dim
    }
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(color.copy(alpha = 0.11f))
            .border(BorderStroke(1.dp, color.copy(alpha = 0.22f)), RoundedCornerShape(999.dp))
            .padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Box(
            modifier = Modifier
                .size(7.dp)
                .clip(CircleShape)
                .background(color),
        )
        Text(label, color = color, style = MaterialTheme.typography.labelSmall)
    }
}

@Composable
private fun HeroConnectionCard(
    status: BondingVpnService.Status,
    busy: Boolean,
    error: String?,
    pathLatency: Map<String, LatencyMonitor.PathLatency>,
    onToggle: () -> Unit,
) {
    val state = status.state
    val on = state == BondingVpnService.State.CONNECTED ||
        state == BondingVpnService.State.CONNECTING
    val measured = pathLatency.values.filter { it.available && it.rttMs != null }
    val bestRtt = measured.minByOrNull { it.rttMs!! }?.rttMs
    val slowestRtt = measured.maxByOrNull { it.rttMs!! }?.rttMs
    val delta = if (bestRtt != null && slowestRtt != null && slowestRtt > bestRtt) {
        (slowestRtt - bestRtt).toInt()
    } else null
    val latencyColor = latencyColor(bestRtt)
    val statusText = when {
        error != null -> error
        busy -> "Fetching tunnel config"
        state == BondingVpnService.State.CONNECTED -> "Bonded paths active"
        state == BondingVpnService.State.CONNECTING -> "Probing networks"
        state == BondingVpnService.State.FAILED -> status.message ?: "Connection failed"
        else -> "Ready when you are"
    }
    val subtitle = when {
        bestRtt == null -> "Measuring paths..."
        on && delta != null -> "Saving up to ${delta} ms vs slowest path"
        on -> "Bonded delivery active"
        delta != null -> "Best path now - Game Mode locks it in"
        else -> "Best path now - Game Mode locks it in"
    }
    val cardBorder by animateColorAsState(
        targetValue = when {
            error != null || state == BondingVpnService.State.FAILED -> Red.copy(alpha = 0.34f)
            on -> Teal.copy(alpha = 0.34f)
            else -> Border
        },
        label = "heroBorder",
    )

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(28.dp))
            .background(
                Brush.verticalGradient(
                    listOf(
                        Surface.copy(alpha = 0.98f),
                        Color(0xFF0F1012).copy(alpha = 0.98f),
                    ),
                ),
            )
            .border(BorderStroke(1.dp, cardBorder), RoundedCornerShape(28.dp))
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Game Mode", color = White, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                Text(statusText, color = if (error != null) Red else Dim, style = MaterialTheme.typography.bodySmall)
            }
            Switch(
                checked = on,
                onCheckedChange = { onToggle() },
                enabled = !busy,
                colors = SwitchDefaults.colors(
                    checkedTrackColor = Teal,
                    checkedThumbColor = Color.Black,
                    uncheckedTrackColor = Color(0xFF2B2B30),
                    uncheckedThumbColor = Color(0xFFE5E5EA),
                    disabledCheckedTrackColor = Orange,
                    disabledUncheckedTrackColor = Color(0xFF2B2B30),
                ),
            )
        }
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                text = if (on) "BONDED LATENCY" else "BEST PATH LATENCY",
                color = Dim,
                style = MaterialTheme.typography.labelSmall,
            )
            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    text = bestRtt?.toInt()?.toString() ?: "--",
                    color = latencyColor,
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 58.sp,
                    lineHeight = 62.sp,
                )
                Spacer(Modifier.width(7.dp))
                Text(
                    text = "ms",
                    color = Dim,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(bottom = 12.dp),
                )
            }
            Text(subtitle, color = Dim, style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center)
        }
    }
}

@Composable
private fun ModeSelectorCard(
    selected: BondingClient.Mode,
    onSelect: (BondingClient.Mode) -> Unit,
) {
    val description = when (selected) {
        BondingClient.Mode.GAMING -> "Best for games: every packet uses both paths."
        BondingClient.Mode.BROWSING -> "Saves mobile data: Wi-Fi first, mobile backup."
    }
    AppCard(contentPadding = 14.dp) {
        Text("MODE", color = Dim, style = MaterialTheme.typography.labelSmall)
        Spacer(Modifier.height(8.dp))
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(Color(0xFF1A1A1D))
                .padding(4.dp),
        ) {
            ModeChip(
                label = "Gaming",
                selected = selected == BondingClient.Mode.GAMING,
                onClick = { onSelect(BondingClient.Mode.GAMING) },
                modifier = Modifier.weight(1f),
            )
            ModeChip(
                label = "Browsing",
                selected = selected == BondingClient.Mode.BROWSING,
                onClick = { onSelect(BondingClient.Mode.BROWSING) },
                modifier = Modifier.weight(1f),
            )
        }
        Spacer(Modifier.height(8.dp))
        Text(description, color = Dim, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun ModeChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val bg by animateColorAsState(
        targetValue = if (selected) Teal else Color.Transparent,
        label = "modeChipBg",
    )
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(bg)
            .clickable { onClick() }
            .padding(vertical = 9.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = if (selected) Color.Black else Dim,
            fontWeight = FontWeight.Bold,
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
    val order = listOf("Wi-Fi", "Mobile data", "Cellular")
    val bondedByName = bondedPaths.associateBy { displayPathName(it.name, it.cellular) }
    val latencyByName = pathLatency.values.associateBy { displayPathName(it.name, false) }
    if (pathLatency.isEmpty()) {
        return bondedPaths.map { p ->
            PathDisplay(displayPathName(p.name, p.cellular), p.active, null, null, p.bytesSent, p.packetsSent)
        }
    }
    val names = buildList {
        order.map { displayPathName(it) }.forEach { name ->
            if ((latencyByName.containsKey(name) || bondedByName.containsKey(name)) && !contains(name)) add(name)
        }
        (latencyByName.keys + bondedByName.keys).forEach { name ->
            if (!contains(name)) add(name)
        }
    }
    return names.map { name ->
        val lat = latencyByName[name]
        val bonded = bondedByName[name]
        PathDisplay(
            name = displayPathName(name, bonded?.cellular == true),
            active = lat?.available ?: bonded?.active ?: false,
            rttMs = lat?.rttMs,
            jitterMs = lat?.jitterMs,
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
    AppCard {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("ACTIVE PATHS", color = Dim, style = MaterialTheme.typography.labelSmall)
            Text(
                text = "${merged.count { it.active }} online",
                color = Dim,
                style = MaterialTheme.typography.labelSmall,
            )
        }
        Spacer(Modifier.height(12.dp))
        if (merged.isEmpty()) {
            Text("Waiting for Wi-Fi or mobile data...", color = Dim, style = MaterialTheme.typography.bodySmall)
        } else {
            merged.forEachIndexed { i, p ->
                PathRow(p)
                if (i < merged.lastIndex) {
                    Spacer(Modifier.height(10.dp))
                    DividerLine()
                    Spacer(Modifier.height(10.dp))
                }
            }
        }
    }
}

@Composable
private fun PathRow(path: PathDisplay) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(9.dp)
                .clip(CircleShape)
                .background(if (path.active) Green else Dim),
        )
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                text = path.name,
                color = White,
                fontWeight = FontWeight.Bold,
                fontSize = 17.sp,
            )
            Text(
                text = path.bytesSent?.let { "${formatBytes(it)} - ${path.packetsSent ?: 0} pkts" }
                    ?: "Measuring path",
                color = Dim,
                style = MaterialTheme.typography.bodySmall,
            )
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                text = path.rttMs?.let { "${it.toInt()} ms" } ?: "--",
                color = latencyColor(path.rttMs),
                fontWeight = FontWeight.ExtraBold,
                fontSize = 18.sp,
            )
            Text(
                text = path.jitterMs?.let { "jitter +/-${it.toInt()} ms" } ?: "jitter --",
                color = Dim,
                style = MaterialTheme.typography.bodySmall,
                textAlign = TextAlign.End,
            )
        }
    }
}

@Composable
private fun SessionSummaryCard(
    stats: BondingClient.Stats?,
    onShareGameMode: () -> Unit,
) {
    AppCard(contentPadding = 14.dp) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("SESSION", color = Dim, style = MaterialTheme.typography.labelSmall)
            CompactAction(label = "Share Game Mode", onClick = onShareGameMode)
        }
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
            SummaryMetric("Sent", formatBytes(stats?.totalBytesUp ?: 0L), Modifier.weight(1f))
            SummaryMetric("Received", formatBytes(stats?.totalBytesDown ?: 0L), Modifier.weight(1f))
            SummaryMetric("Mobile", formatBytes(stats?.cellularBytesUp ?: 0L), Modifier.weight(1f))
            SummaryMetric("Failovers", "--", Modifier.weight(1f))
        }
    }
}

@Composable
private fun SummaryMetric(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, color = Dim, style = MaterialTheme.typography.labelSmall)
        Text(value, color = White, fontWeight = FontWeight.ExtraBold, fontSize = 14.sp)
    }
}

@Composable
private fun CompactAction(label: String, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(Teal.copy(alpha = 0.10f))
            .border(BorderStroke(1.dp, Teal.copy(alpha = 0.22f)), RoundedCornerShape(999.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = Teal, fontWeight = FontWeight.Bold, fontSize = 12.sp)
    }
}

@Composable
private fun AppCard(
    contentPadding: androidx.compose.ui.unit.Dp = 18.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(24.dp))
            .background(Surface.copy(alpha = 0.96f))
            .border(BorderStroke(1.dp, Border), RoundedCornerShape(24.dp))
            .padding(contentPadding),
        content = content,
    )
}

@Composable
private fun ShareGameModeDialog(
    onDismiss: () -> Unit,
    onOpenHotspotSettings: () -> Unit,
    onOpenVpnSettings: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Surface,
        titleContentColor = White,
        textContentColor = Dim,
        title = { Text("Share Game Mode", fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Use Android hotspot to share AntiJitter with an Xbox, PC, Steam Deck, or PlayStation.")
                Text("For best hotspot routing, enable Always-on VPN. If traffic still bypasses AntiJitter, turn on Block connections without VPN.")
                Text("That strict mode can block internet when AntiJitter is disconnected, so keep it for hotspot sessions.")
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    onDismiss()
                    onOpenVpnSettings()
                },
                colors = ButtonDefaults.buttonColors(containerColor = Teal, contentColor = Color.Black),
            ) {
                Text("VPN settings", fontWeight = FontWeight.Bold)
            }
        },
        dismissButton = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(
                    onClick = {
                        onDismiss()
                        onOpenHotspotSettings()
                    },
                ) {
                    Text("Hotspot settings", color = Teal)
                }
                TextButton(onClick = onDismiss) {
                    Text("Done", color = Dim)
                }
            }
        },
    )
}

@Composable
private fun DividerLine() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(Border),
    )
}

private fun latencyColor(rttMs: Float?): Color = when {
    rttMs == null -> Dim
    rttMs < 50f -> Green
    rttMs < 100f -> Teal
    rttMs < 200f -> Orange
    else -> Red
}

private fun displayPathName(name: String, cellular: Boolean = false): String = when {
    cellular -> "Mobile data"
    name == "Cellular" -> "Mobile data"
    else -> name
}

private fun formatBytes(bytes: Long): String = when {
    bytes < 1024L -> "$bytes B"
    bytes < 1024L * 1024L -> "${bytes / 1024L} KB"
    bytes < 1024L * 1024L * 1024L -> String.format("%.1f MB", bytes / 1024.0 / 1024.0)
    else -> String.format("%.2f GB", bytes / 1024.0 / 1024.0 / 1024.0)
}

// BEGIN DEV-TOGGLE (route-all) - remove for production
@Composable
private fun DevRouteAllRow(
    enabled: Boolean,
    onChange: (Boolean) -> Unit,
    tunnelActive: Boolean,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(Color(0xFF101013))
            .border(BorderStroke(1.dp, Border), RoundedCornerShape(18.dp))
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text("DEV: route all traffic", color = White, style = MaterialTheme.typography.bodyMedium)
            Text(
                if (tunnelActive) "Applies on next Game Mode restart."
                else "Routes every packet through Germany.",
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
