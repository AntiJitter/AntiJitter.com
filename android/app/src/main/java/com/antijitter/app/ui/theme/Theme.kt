package com.antijitter.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val Black = Color(0xFF0A0A0A)
val Surface = Color(0xFF111111)
val Border = Color(0xFF1E1E1E)
val White = Color(0xFFF5F5F7)
val Dim = Color(0xFF86868B)
val Teal = Color(0xFF00C8D7)
val Green = Color(0xFF30D158)
val Orange = Color(0xFFFF9F0A)
val Red = Color(0xFFFF453A)

private val AntiJitterDarkColors = darkColorScheme(
    primary = Teal,
    onPrimary = Black,
    secondary = Green,
    background = Black,
    onBackground = White,
    surface = Surface,
    onSurface = White,
    surfaceVariant = Surface,
    onSurfaceVariant = Dim,
    error = Red,
    outline = Border,
)

@Composable
fun AntiJitterTheme(
    @Suppress("UNUSED_PARAMETER") darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = AntiJitterDarkColors,
        typography = MaterialTheme.typography,
        content = content,
    )
}
