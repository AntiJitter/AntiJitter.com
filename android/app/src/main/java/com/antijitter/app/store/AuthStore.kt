package com.antijitter.app.store

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.authDataStore by preferencesDataStore(name = "auth")

class AuthStore(private val context: Context) {
    private val tokenKey = stringPreferencesKey("token")
    private val emailKey = stringPreferencesKey("email")

    val token: Flow<String?> = context.authDataStore.data.map { it[tokenKey] }
    val email: Flow<String?> = context.authDataStore.data.map { it[emailKey] }

    suspend fun currentToken(): String? = token.first()

    suspend fun save(token: String, email: String) {
        context.authDataStore.edit {
            it[tokenKey] = token
            it[emailKey] = email
        }
    }

    suspend fun clear() {
        context.authDataStore.edit { it.clear() }
    }
}
