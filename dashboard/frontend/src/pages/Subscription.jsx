import { useEffect, useState } from "react";
import { useApiFetch, useAuth } from "../contexts/AuthContext";

const PLANS = [
  {
    id: "solo",
    name: "Solo",
    price: "49 NOK",
    period: "/month",
    devices: 1,
    features: ["1 WireGuard device", "Starlink + 4G/5G bonding", "Real-time dashboard", "7-day free trial"],
  },
  {
    id: "family",
    name: "Family",
    price: "99 NOK",
    period: "/month",
    devices: 4,
    features: ["Up to 4 devices", "Everything in Solo", "Shared bonding pool", "7-day free trial"],
    highlight: true,
  },
];

export default function Subscription() {
  const { user } = useAuth();
  const apiFetch = useApiFetch();
  const [subStatus, setSubStatus] = useState(null);
  const [loading, setLoading] = useState(null); // plan id being loaded
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/api/subscription/status")
      .then((r) => r.json())
      .then(setSubStatus)
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function startCheckout(planId) {
    setError("");
    setLoading(planId);
    try {
      const res = await apiFetch(`/api/subscription/create?plan=${planId}`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).detail);
      const { url } = await res.json();
      window.location.href = url;
    } catch (err) {
      setError(err.message);
      setLoading(null);
    }
  }

  async function downloadConfig() {
    const res = await apiFetch("/api/wireguard/config");
    if (!res.ok) {
      // Not provisioned yet — provision first
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
    <PageWrap title="Choose your plan">
      <p style={{ color: "var(--dim)", fontSize: 14, marginBottom: 32, textAlign: "center" }}>
        7-day free trial on all plans. Cancel anytime.
      </p>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", justifyContent: "center" }}>
        {PLANS.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            loading={loading === plan.id}
            onSelect={() => startCheckout(plan.id)}
          />
        ))}
      </div>

      {error && (
        <p style={{ color: "var(--red)", textAlign: "center", marginTop: 20, fontSize: 13 }}>
          {error}
        </p>
      )}
    </PageWrap>
  );
}

function ActiveSubscription({ sub, onDownload }) {
  return (
    <PageWrap title="Your subscription">
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
        <Row label="Plan" value={sub.plan === "solo" ? "Solo" : "Family"} />
        <Row label="Status" value={<StatusBadge status={sub.status} />} />
        {sub.expires_at && (
          <Row label="Next billing" value={new Date(sub.expires_at).toLocaleDateString()} />
        )}
        <Row label="Devices" value={sub.plan === "family" ? "Up to 4" : "1"} />

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

function PlanCard({ plan, loading, onSelect }) {
  return (
    <div
      style={{
        background: plan.highlight ? "var(--teal-dim)" : "var(--surface)",
        border: `1px solid ${plan.highlight ? "rgba(0,200,215,0.35)" : "var(--border)"}`,
        borderRadius: 16,
        padding: "28px 28px 24px",
        width: 280,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {plan.highlight && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--teal)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginBottom: 10,
          }}
        >
          Most popular
        </span>
      )}
      <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{plan.name}</h3>
      <div style={{ marginBottom: 20 }}>
        <span style={{ fontSize: 28, fontWeight: 800, color: plan.highlight ? "var(--teal)" : "var(--white)" }}>
          {plan.price}
        </span>
        <span style={{ fontSize: 14, color: "var(--dim)" }}>{plan.period}</span>
      </div>

      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 24px", flex: 1 }}>
        {plan.features.map((f) => (
          <li key={f} style={{ fontSize: 13, color: "var(--dim)", marginBottom: 8, display: "flex", gap: 8 }}>
            <span style={{ color: "var(--teal)" }}>✓</span> {f}
          </li>
        ))}
      </ul>

      <button
        onClick={onSelect}
        disabled={loading}
        style={{
          padding: "13px",
          background: plan.highlight ? "var(--teal)" : "transparent",
          color: plan.highlight ? "#000" : "var(--teal)",
          border: `1.5px solid var(--teal)`,
          borderRadius: 8,
          fontWeight: 700,
          fontSize: 14,
          cursor: loading ? "not-allowed" : "pointer",
          fontFamily: "inherit",
          opacity: loading ? 0.6 : 1,
        }}
      >
        {loading ? "Redirecting…" : "Start free trial"}
      </button>
    </div>
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

function PageWrap({ title, children }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--black)", padding: "60px 20px" }}>
      <div style={{ maxWidth: 700, margin: "0 auto" }}>
        <h2 style={{ fontSize: 26, fontWeight: 800, textAlign: "center", marginBottom: 8 }}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
