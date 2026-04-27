package com.antijitter.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.antijitter.app.ui.theme.Black
import com.antijitter.app.ui.theme.Border
import com.antijitter.app.ui.theme.Dim
import com.antijitter.app.ui.theme.Green
import com.antijitter.app.ui.theme.Red
import com.antijitter.app.ui.theme.Surface
import com.antijitter.app.ui.theme.Teal
import com.antijitter.app.ui.theme.White

@Composable
fun LoginScreen(
    isLoading: Boolean,
    error: String?,
    onSubmit: (email: String, password: String) -> Unit,
) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    val canSubmit = !isLoading && email.isNotBlank() && password.isNotBlank()

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Black),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(270.dp)
                .background(
                    Brush.verticalGradient(
                        0f to Teal.copy(alpha = 0.22f),
                        0.48f to Green.copy(alpha = 0.07f),
                        1f to Color.Transparent,
                    ),
                ),
        )
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 28.dp),
            verticalArrangement = Arrangement.spacedBy(22.dp),
        ) {
            LoginHero()
            SignInPanel(
                email = email,
                password = password,
                isLoading = isLoading,
                error = error,
                canSubmit = canSubmit,
                onEmailChange = { email = it.trim() },
                onPasswordChange = { password = it },
                onSubmit = { onSubmit(email, password) },
            )
            FooterNote()
        }
    }
}

@Composable
private fun LoginHero() {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BrandLockup(fontSize = 24)
            StatusCapsule("Game Mode", Teal)
        }
        Spacer(Modifier.height(18.dp))
        Text(
            text = "Lock in low latency.",
            color = White,
            fontSize = 38.sp,
            lineHeight = 42.sp,
            fontWeight = FontWeight.ExtraBold,
        )
        Text(
            text = "Bond Wi-Fi and mobile data into one gaming connection with seamless failovers.",
            color = Dim,
            style = MaterialTheme.typography.bodyLarge,
            lineHeight = 22.sp,
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            MiniMetric("34 ms", "best path", Modifier.weight(1f))
            MiniMetric("0%", "packet loss", Modifier.weight(1f))
            MiniMetric("2 paths", "ready", Modifier.weight(1f))
        }
    }
}

@Composable
private fun SignInPanel(
    email: String,
    password: String,
    isLoading: Boolean,
    error: String?,
    canSubmit: Boolean,
    onEmailChange: (String) -> Unit,
    onPasswordChange: (String) -> Unit,
    onSubmit: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(26.dp))
            .background(Surface.copy(alpha = 0.96f))
            .border(BorderStroke(1.dp, Border), RoundedCornerShape(26.dp))
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text(
            text = "Sign in",
            color = White,
            fontSize = 22.sp,
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = "Use the account connected to your AntiJitter subscription.",
            color = Dim,
            style = MaterialTheme.typography.bodySmall,
        )
        AntiJitterTextField(
            value = email,
            onValueChange = onEmailChange,
            label = "Email",
            enabled = !isLoading,
            keyboardType = KeyboardType.Email,
        )
        AntiJitterTextField(
            value = password,
            onValueChange = onPasswordChange,
            label = "Password",
            enabled = !isLoading,
            keyboardType = KeyboardType.Password,
            isPassword = true,
        )
        if (error != null) {
            Text(
                text = error,
                color = Red,
                style = MaterialTheme.typography.bodySmall,
            )
        }
        Button(
            onClick = onSubmit,
            enabled = canSubmit,
            modifier = Modifier
                .fillMaxWidth()
                .height(54.dp),
            shape = RoundedCornerShape(18.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = Teal,
                contentColor = Color.Black,
                disabledContainerColor = Color(0xFF222225),
                disabledContentColor = Dim,
            ),
        ) {
            if (isLoading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    color = Color.Black,
                    strokeWidth = 2.dp,
                )
            } else {
                Text("Continue", fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun AntiJitterTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    enabled: Boolean,
    keyboardType: KeyboardType,
    isPassword: Boolean = false,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        singleLine = true,
        enabled = enabled,
        visualTransformation = if (isPassword) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedTextColor = White,
            unfocusedTextColor = White,
            disabledTextColor = Dim,
            focusedContainerColor = Color(0xFF151517),
            unfocusedContainerColor = Color(0xFF151517),
            disabledContainerColor = Color(0xFF151517),
            focusedBorderColor = Teal,
            unfocusedBorderColor = Border,
            disabledBorderColor = Border,
            focusedLabelColor = Teal,
            unfocusedLabelColor = Dim,
            cursorColor = Teal,
        ),
    )
}

@Composable
private fun MiniMetric(value: String, label: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(18.dp))
            .background(Color.White.copy(alpha = 0.06f))
            .border(BorderStroke(1.dp, Color.White.copy(alpha = 0.08f)), RoundedCornerShape(18.dp))
            .padding(horizontal = 12.dp, vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(value, color = White, fontWeight = FontWeight.ExtraBold, fontSize = 17.sp)
        Text(label, color = Dim, style = MaterialTheme.typography.labelSmall, textAlign = TextAlign.Center)
    }
}

@Composable
private fun StatusCapsule(label: String, color: Color) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(color.copy(alpha = 0.12f))
            .border(BorderStroke(1.dp, color.copy(alpha = 0.28f)), RoundedCornerShape(999.dp))
            .padding(horizontal = 12.dp, vertical = 7.dp),
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
private fun BrandLockup(fontSize: Int) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("Anti", color = White, fontWeight = FontWeight.ExtraBold, fontSize = fontSize.sp)
        Text("Jitter", color = Teal, fontWeight = FontWeight.ExtraBold, fontSize = fontSize.sp)
    }
}

@Composable
private fun FooterNote() {
    Text(
        text = "No account yet? Sign up at antijitter.com",
        color = Dim,
        style = MaterialTheme.typography.bodySmall,
        modifier = Modifier.fillMaxWidth(),
        textAlign = TextAlign.Center,
    )
}
