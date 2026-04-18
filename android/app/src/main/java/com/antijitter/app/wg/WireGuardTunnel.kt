package com.antijitter.app.wg

import android.util.Base64
import android.util.Log

/**
 * Thin wrapper around the wireguard-go userspace implementation shipped in
 * com.wireguard.android:tunnel. We don't use [com.wireguard.android.backend.GoBackend]
 * directly because it manages its own VpnService — instead we hand wireguard-go
 * the TUN fd from our [com.antijitter.app.vpn.BondingVpnService] and let it
 * speak UDP to 127.0.0.1:<bondingPort>, where the bonding client picks up.
 *
 * The wireguard-go entry points ([wgTurnOn], [wgTurnOff]) are private static
 * native methods on GoBackend; we reach them with reflection. The JNI library
 * (libwg-go.so) is loaded by GoBackend's static initializer.
 */
class WireGuardTunnel private constructor(
    private val handle: Int,
    private val name: String,
) {
    fun stop() {
        try {
            wgTurnOffMethod.invoke(null, handle)
            Log.i(TAG, "tunnel down: $name (handle=$handle)")
        } catch (t: Throwable) {
            Log.w(TAG, "wgTurnOff failed for $name: ${t.message}")
        }
    }

    companion object {
        private const val TAG = "AJ.WireGuard"
        private const val BACKEND_CLASS = "com.wireguard.android.backend.GoBackend"

        private val backendClass: Class<*> by lazy { Class.forName(BACKEND_CLASS) }

        private val wgTurnOnMethod by lazy {
            backendClass.getDeclaredMethod(
                "wgTurnOn",
                String::class.java,
                Int::class.javaPrimitiveType,
                String::class.java,
            ).apply { isAccessible = true }
        }

        private val wgTurnOffMethod by lazy {
            backendClass.getDeclaredMethod(
                "wgTurnOff",
                Int::class.javaPrimitiveType,
            ).apply { isAccessible = true }
        }

        /**
         * Brings up a wireguard-go device wrapping [tunFd]. Caller keeps the fd
         * alive until [stop] is called; wireguard-go takes ownership of reads/writes.
         *
         * [bondingEndpoint] should be "127.0.0.1:<port>" — wireguard-go will send
         * its encrypted UDP datagrams there for the bonding client to fan out.
         */
        fun start(
            name: String,
            tunFd: Int,
            privateKeyBase64: String,
            peerPublicKeyBase64: String,
            bondingEndpoint: String,
            allowedIps: List<String>,
        ): WireGuardTunnel {
            val settings = buildUapi(
                privateKeyBase64 = privateKeyBase64,
                peerPublicKeyBase64 = peerPublicKeyBase64,
                endpoint = bondingEndpoint,
                allowedIps = allowedIps,
            )

            val handle = try {
                wgTurnOnMethod.invoke(null, name, tunFd, settings) as Int
            } catch (t: Throwable) {
                throw IllegalStateException("wgTurnOn JNI call failed: ${t.message}", t)
            }
            if (handle < 0) {
                throw IllegalStateException("wgTurnOn returned $handle (failed)")
            }
            Log.i(TAG, "tunnel up: $name (handle=$handle endpoint=$bondingEndpoint)")
            return WireGuardTunnel(handle, name)
        }

        /** Builds wireguard-go's UAPI text format. Keys are hex, not base64. */
        private fun buildUapi(
            privateKeyBase64: String,
            peerPublicKeyBase64: String,
            endpoint: String,
            allowedIps: List<String>,
        ): String = buildString {
            append("private_key=").append(base64ToHex(privateKeyBase64)).append('\n')
            append("replace_peers=true\n")
            append("public_key=").append(base64ToHex(peerPublicKeyBase64)).append('\n')
            append("endpoint=").append(endpoint).append('\n')
            append("persistent_keepalive_interval=25\n")
            for (aip in allowedIps) append("allowed_ip=").append(aip).append('\n')
        }

        private fun base64ToHex(b64: String): String {
            val raw = Base64.decode(b64, Base64.DEFAULT)
            require(raw.size == 32) { "WireGuard key must decode to 32 bytes, got ${raw.size}" }
            return raw.joinToString("") { String.format("%02x", it) }
        }
    }
}
