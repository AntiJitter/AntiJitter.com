import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useApiFetch } from "../contexts/AuthContext";

export default function SubscriptionSuccess() {
  const apiFetch = useApiFetch();
  const [downloaded, setDownloaded] = useState(false);

  // Auto-provision WireGuard on arrival (checkout just completed)
  useEffect(() => {
    apiFetch("/api/wireguard/provision", { method: "POST" }).catch(() => {
      // Already provisioned or no active sub yet — Stripe webhook may be slightly delayed
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function download() {
    try {
      const res = await apiFetch("/api/wireguard/config");
      if (!res.ok) throw new Error("Not ready yet — try again in a moment");
      const text = await res.text();
      const blob = new Blob([text], { type: "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "antijitter.conf";
      a.click();
      setDownloaded(true);
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--black)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div style={{ maxWidth: 480, textAlign: "center" }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            background: "rgba(50,215,75,0.12)",
            border: "1px solid rgba(50,215,75,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 24px",
            fontSize: 28,
          }}
        >
          ✓
        </div>

        <h2 style={{ fontSize: 26, fontWeight: 800, marginBottom: 12 }}>
          You&rsquo;re in.
        </h2>
        <p style={{ color: "var(--dim)", fontSize: 15, lineHeight: 1.6, marginBottom: 32 }}>
          Your 7-day free trial has started. Download the WireGuard config and import it
          into the WireGuard app on your device.
        </p>

        <button
          onClick={download}
          style={{
            display: "block",
            width: "100%",
            padding: "15px",
            background: downloaded ? "rgba(0,200,215,0.15)" : "var(--teal)",
            color: downloaded ? "var(--teal)" : "#000",
            border: `1.5px solid var(--teal)`,
            borderRadius: 10,
            fontWeight: 700,
            fontSize: 15,
            cursor: "pointer",
            fontFamily: "inherit",
            marginBottom: 12,
          }}
        >
          {downloaded ? "Downloaded ✓" : "Download antijitter.conf"}
        </button>

        <Link
          to="/dashboard"
          style={{
            display: "block",
            fontSize: 14,
            color: "var(--dim)",
            textDecoration: "none",
          }}
        >
          Go to dashboard →
        </Link>
      </div>
    </div>
  );
}
