package com.antijitter.app.api

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

@Serializable
data class LoginRequest(val email: String, val password: String)

@Serializable
data class SubscriptionInfo(
    val plan: String? = null,
    val status: String? = null,
    val has_wireguard: Boolean = false,
)

@Serializable
data class UserInfo(
    val id: Long,
    val email: String,
    val subscription: SubscriptionInfo? = null,
)

@Serializable
data class LoginResponse(val token: String, val user: UserInfo)

@Serializable
data class WireGuardConfig(
    val private_key: String,
    val address: String,
    val dns: String,
    val peer_key: String,
    val allowed_ips: List<String>,
)

@Serializable
data class AntiJitterConfig(
    val wireguard: WireGuardConfig,
    val bonding_servers: List<String>,
    val data_limit_mb: Long,
)

class ApiException(val status: Int, message: String) : IOException(message)

/**
 * Talks to app.antijitter.com — login + GET /api/config.
 *
 * Note: tokens are stored in DataStore (see store/AuthStore.kt). This client
 * is stateless; pass the token explicitly to authenticated calls.
 */
class ApiClient(
    private val baseUrl: String = DEFAULT_BASE_URL,
    private val http: OkHttpClient = defaultClient(),
) {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    suspend fun login(email: String, password: String): LoginResponse = withContext(Dispatchers.IO) {
        val body = json.encodeToString(LoginRequest(email, password))
            .toRequestBody(JSON_MEDIA)
        val req = Request.Builder()
            .url("$baseUrl/api/auth/login")
            .post(body)
            .build()
        http.newCall(req).execute().use { resp ->
            val text = resp.body?.string().orEmpty()
            if (!resp.isSuccessful) {
                throw ApiException(resp.code, parseDetail(text) ?: "Login failed (${resp.code})")
            }
            json.decodeFromString(LoginResponse.serializer(), text)
        }
    }

    suspend fun fetchConfig(token: String): AntiJitterConfig = withContext(Dispatchers.IO) {
        val req = Request.Builder()
            .url("$baseUrl/api/config")
            .header("Authorization", "Bearer $token")
            .get()
            .build()
        http.newCall(req).execute().use { resp ->
            val text = resp.body?.string().orEmpty()
            if (!resp.isSuccessful) {
                throw ApiException(resp.code, parseDetail(text) ?: "Config fetch failed (${resp.code})")
            }
            json.decodeFromString(AntiJitterConfig.serializer(), text)
        }
    }

    private fun parseDetail(text: String): String? = try {
        @Serializable data class Err(val detail: String? = null)
        json.decodeFromString(Err.serializer(), text).detail
    } catch (_: Throwable) {
        null
    }

    companion object {
        const val DEFAULT_BASE_URL = "https://app.antijitter.com"
        private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

        private fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .build()
    }
}
