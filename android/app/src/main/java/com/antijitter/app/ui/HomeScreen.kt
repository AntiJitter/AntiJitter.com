package com.antijitter.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.antijitter.app.bonding.BondingClient
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
    onToggle: () -> Unit,
    onSignOut: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column {
                Text("AntiJitter", style = MaterialTheme.typography.titleLarge, color = Teal)
                Text(email, style = MaterialTheme.typography.bodySmall, color = Dim)
            }
            TextButton(onClick = onSignOut) { Text("Sign out", color = Dim) }
        }

        Spacer(Modifier.height(40.dp))

        Box(
            modifier = Modifier.fillMaxWidth(),
            contentAlignment = Alignment.Center,
        ) {
            ToggleButton(status = status, onClick = onToggle)
        }

        Spacer(Modifier.height(16.dp))

        StatusLine(status = status)

        Spacer(Modifier.height(32.dp))

        if (stats != null) {
            StatsCard(stats)
        } else {
            HelpCard()
        }
    }
}

@Composable
private fun ToggleButton(
    status: BondingVpnService.Status,
    onClick: () -> Unit,
) {
    val (label, color) = when (status.state) {
        BondingVpnService.State.CONNECTED -> "Game Mode ON" to Green
        BondingVpnService.State.CONNECTING -> "Connecting…" to Orange
        BondingVpnService.State.FAILED -> "Try again" to Red
        BondingVpnService.State.DISCONNECTED -> "Turn on Game Mode" to Teal
    }
    Button(
        onClick = onClick,
        colors = ButtonDefaults.buttonColors(containerColor = color, contentColor = Color.Black),
        shape = RoundedCornerShape(28.dp),
        modifier = Modifier.fillMaxWidth().height(72.dp),
    ) {
        Text(label, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
private fun StatusLine(status: BondingVpnService.Status) {
    val msg = status.message
    val text = when (status.state) {
        BondingVpnService.State.CONNECTED -> "Bonded paths active. Enjoy lossless gaming."
        BondingVpnService.State.CONNECTING -> "Probing networks…"
        BondingVpnService.State.FAILED -> msg ?: "Connection failed"
        BondingVpnService.State.DISCONNECTED -> "Tunnel idle"
    }
    Text(
        text = text,
        color = if (status.state == BondingVpnService.State.FAILED) Red else Dim,
        style = MaterialTheme.typography.bodyMedium,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun StatsCard(stats: BondingClient.Stats) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Surface)
            .padding(20.dp),
    ) {
        Text("Active paths", color = Dim, style = MaterialTheme.typography.labelMedium)
        Spacer(Modifier.height(8.dp))
        for (p in stats.paths) {
            PathRow(p)
            Spacer(Modifier.height(8.dp))
        }
        Spacer(Modifier.height(12.dp))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            StatBlock("Sent", "${stats.totalBytesUp / 1024 / 1024} MB")
            StatBlock("Received", "${stats.totalBytesDown / 1024 / 1024} MB")
            StatBlock("Cellular", "${stats.cellularBytesUp / 1024 / 1024} MB")
        }
    }
}

@Composable
private fun PathRow(p: BondingClient.PathStats) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier
                .size(10.dp)
                .clip(CircleShape)
                .background(if (p.active) Green else Dim),
        )
        Spacer(Modifier.width(12.dp))
        Text(p.name, color = White, style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.width(12.dp))
        Text(
            "${p.packetsSent} pkts · ${p.bytesSent / 1024} KB",
            color = Dim,
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

@Composable
private fun StatBlock(label: String, value: String) {
    Column {
        Text(label, color = Dim, style = MaterialTheme.typography.labelSmall)
        Spacer(Modifier.height(2.dp))
        Text(value, color = White, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun HelpCard() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Surface)
            .padding(PaddingValues(20.dp)),
    ) {
        Text("How it works", color = White, style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(8.dp))
        Text(
            "AntiJitter sends every game packet over Wi-Fi AND cellular at the same time. " +
                "If one path drops a packet, the other delivers. Server deduplicates. Zero loss.",
            color = Dim,
            style = MaterialTheme.typography.bodySmall,
        )
        Spacer(Modifier.height(12.dp))
        Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(Border))
        Spacer(Modifier.height(12.dp))
        Text(
            "Cellular data is metered against your monthly cap. We disable the cellular " +
                "path automatically when you hit the limit.",
            color = Dim,
            style = MaterialTheme.typography.bodySmall,
        )
    }
}
