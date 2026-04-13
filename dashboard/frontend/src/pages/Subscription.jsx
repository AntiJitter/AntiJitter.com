import { useEffect, useState } from "react";
import { useApiFetch, useAuth } from "../contexts/AuthContext";

const PLAN = {
  id: "solo",
  name: "AntíJitter",
  price: "$5",
  period: "/month",
  features: [
    "Full Game Mode — all connections bonded",
    "Unlimited devices in your home",
    "Real-time dashboard",
    "WireGuard config — 1 click setup",
    "7-day free trial",
    "Cancel anytime",
  ],
};

export default function Subscription() {
  const { user } = useAuth();
  const apiFetch = useApiFetch();
  const [subStatus, setSubStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/api/subscription/status")
      .then((r) => r.json())
      .then(setSubStatus)
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function startCheckout() {
    setError("");
    setLoading(true);
    try {
      const res = await apiFetch(`/api/subscription/create?plan=solo`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).detail);
      const { url } = await res.json();
      window.open(url, "_blank", "noopener");
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  async function downloadConfig() {
    const res = await apiFetch("/api/wireguard/config");
    if (!res.ok) {
      await apiFetch("/api/wireguard/provision", { method: "POST" });
      return downloadConfig();
    }
    const text = await res.text();
    const blob = new Blob([text], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "antijitter.conf";
    a.click();
  }

  if (subStatus?.has_subscription) {
    return <ActiveSubscription sub={subStatus} onDownload={downloadConfig} />;
  }

  return (
    <PageWrap>
      <div
        style={{
          background: "var(--teal-dim)",
          border: "1px solid rgba(0,200,215,0.3)",
          borderRadius: 16,
          padding: "36px 40px",
          maxWidth: 420,
          margin: "0 auto",
          textAlign: "center",
        }}
      >
        {/* Free badge */}
        <div style={{
          display: "inline-block",
          background: "rgba(0,200,215,0.15)",
          border: "1px solid rgba(0,200,215,0.4)",
          borderRadius: 99,
          padding: "4px 14px",
          fontSize: 12,
          fontWeight: 700,
          color: "var(--teal)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          marginBottom: 16,
        }}>
          No credit card required
        </div>

        {/* Hero: trial */}
        <div style={{ marginBottom: 6 }}>
          <span style={{ fontSize: 64, fontWeight: 800, lineHeight: 1, color: "#f5f5f7" }}>7 days</span>
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "var(--teal)", marginBottom: 4 }}>
          completely free
        </div>
        <div style={{ fontSize: 13, color: "var(--dim)", marginBottom: 28 }}>
          then $5/month — cancel anytime
        </div>

        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 28px", textAlign: "left" }}>
          {["Full Game Mode — all connections bonded", "Unlimited devices in your home", "Real-time dashboard", "WireGuard config — 1 click setup"].map((f) => (
            <li key={f} style={{ fontSize: 14, color: "var(--dim)", marginBottom: 10, display: "flex", gap: 10 }}>
              <span style={{ color: "var(--teal)", flexShrink: 0 }}>✓</span>
              {f}
            </li>
          ))}
        </ul>

        <button
          onClick={startCheckout}
          disabled={loading}
          style={{
            width: "100%",
            padding: "15px",
            background: loading ? "rgba(0,200,215,0.4)" : "var(--teal)",
            color: "#000",
            border: "none",
            borderRadius: 10,
            fontWeight: 700,
            fontSize: 15,
            cursor: loading ? "not-allowed" : "pointer",
            fontFamily: "inherit",
          }}
        >
          {loading ? "Redirecting to Stripe…" : "Start free trial →"}
        </button>

        {error && (
          <p style={{ color: "var(--red)", fontSize: 13, marginTop: 12 }}>{error}</p>
        )}

        <p style={{ fontSize: 12, color: "#555", marginTop: 14 }}>
          You won't be charged until your trial ends.
        </p>
      </div>
    </PageWrap>
  );
}

function ActiveSubscription({ sub, onDownload }) {
  return (
    <PageWrap>
      <div
        style={{
          background: "var(--teal-dim)",
          border: "1px solid rgba(0,200,215,0.25)",
          borderRadius: 12,
          padding: "28px 32px",
          maxWidth: 400,
          margin: "0 auto",
        }}
      >
        <Row label="Plan" value="AntíJitter" />
        <Row label="Status" value={<StatusBadge status={sub.status} />} />
        {sub.expires_at && (
          <Row label="Next billing" value={new Date(sub.expires_at).toLocaleDateString()} />
        )}

        <button
          onClick={onDownload}
          style={{
            marginTop: 24,
            width: "100%",
            padding: "13px",
            background: "var(--teal)",
            color: "#000",
            border: "none",
            borderRadius: 8,
            fontWeight: 700,
            fontSize: 14,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {sub.has_wireguard ? "Download .conf file" : "Provision & download .conf"}
        </button>
      </div>
    </PageWrap>
  );
}

function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
      <span style={{ fontSize: 13, color: "var(--dim)" }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function StatusBadge({ status }) {
  const color =
    status === "active" ? "var(--green)" :
    status === "trialing" ? "var(--teal)" :
    status === "past_due" ? "var(--orange)" :
    "var(--red)";
  return <span style={{ color, fontWeight: 700 }}>{status}</span>;
}

function PageWrap({ children }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--black)", padding: "60px 20px" }}>
      <div style={{ maxWidth: 700, margin: "0 auto" }}>
        <h2 style={{ fontSize: 26, fontWeight: 800, textAlign: "center", marginBottom: 8 }}>
          Try AntíJitter free for 7 days
        </h2>
        <p style={{ textAlign: "center", color: "var(--dim)", fontSize: 14, marginBottom: 36 }}>
          No payment needed to start. Cancel before the trial ends and you owe nothing.
        </p>
        {children}
      </div>
    </div>
  );
}
