import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useApiFetch } from "../contexts/AuthContext";

function causeLabel(cause) {
  const MAP = {
    OBSTRUCTED:          "Obstructed",
    NO_SATS:             "No satellites",
    BOOTING:             "Dish booting",
    SEARCHING:           "Searching",
    MOVING:              "Dish moving",
    NO_DOWNLINK:         "No downlink",
    THERMAL_SHUTDOWN:    "Thermal shutdown",
    STOWED:              "Dish stowed",
  };
  return MAP[cause] ?? cause ?? "Unknown";
}

function formatDuration(seconds) {
  if (seconds == null) return "ongoing";
  if (seconds < 60)  return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function formatTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function OutageCard({ outage }) {
  const ongoing = !outage.resolved;
  const accentColor = ongoing ? "var(--red)" : "var(--dim)";

  return (
    <div style={{
      display: "flex",
      alignItems: "flex-start",
      gap: 14,
      padding: "14px 0",
      borderBottom: "1px solid rgba(255,255,255,0.05)",
    }}>
      {/* Left: status dot + line */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 3, flexShrink: 0 }}>
        <span style={{
          width: 9, height: 9, borderRadius: "50%",
          background: ongoing ? "var(--red)" : "#3a3a3c",
          boxShadow: ongoing ? "0 0 8px var(--red)" : "none",
          flexShrink: 0,
        }} />
      </div>

      {/* Right: details */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: accentColor }}>
            {causeLabel(outage.cause)}
          </span>
          {ongoing && (
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
              color: "var(--red)", background: "rgba(255,69,58,0.12)",
              border: "1px solid rgba(255,69,58,0.3)",
              borderRadius: 5, padding: "2px 6px",
            }}>
              LIVE
            </span>
          )}
          <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--dim)", fontVariantNumeric: "tabular-nums" }}>
            {formatTime(outage.started_at)}
          </span>
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <Pill label="Duration" value={formatDuration(outage.duration_seconds)} highlight={ongoing} />
          {outage.latency_ms && (
            <Pill label="Peak latency" value={`${outage.latency_ms} ms`} color="var(--red)" />
          )}
        </div>
      </div>
    </div>
  );
}

function Pill({ label, value, highlight, color }) {
  return (
    <span style={{ fontSize: 11, color: "var(--dim)" }}>
      {label}:{" "}
      <strong style={{ color: color ?? (highlight ? "var(--red)" : "var(--white)"), fontVariantNumeric: "tabular-nums" }}>
        {value}
      </strong>
    </span>
  );
}

export default function OutageTimeline({ isSubscribed = true }) {
  const apiFetch = useApiFetch();
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/starlink/outages");
      if (res.ok) setData(await res.json());
    } catch { /* backend not reachable */ }
  }, [apiFetch]);

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  const outages = data?.outages ?? [];
  const hasOpen = (data?.open_count ?? 0) > 0;

  return (
    <div style={{
      background: "var(--surface)",
      border: `1px solid ${hasOpen ? "rgba(255,69,58,0.35)" : "var(--border)"}`,
      borderRadius: 12,
      padding: "20px 24px",
      transition: "border-color 0.3s",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--white)" }}>
            Starlink Outage History
          </h3>
          <p style={{ fontSize: 12, color: "var(--dim)", marginTop: 3 }}>
            {data == null
              ? "Loading…"
              : outages.length === 0
              ? "No outages detected yet — your dish is solid"
              : `${outages.length} outage${outages.length !== 1 ? "s" : ""} recorded`}
          </p>
        </div>

        {hasOpen && (
          <span style={{
            fontSize: 11, fontWeight: 700,
            color: "var(--red)", background: "rgba(255,69,58,0.1)",
            border: "1px solid rgba(255,69,58,0.3)",
            borderRadius: 8, padding: "6px 12px",
          }}>
            Outage in progress
          </span>
        )}
      </div>

      {/* Free-tier upsell */}
      {!isSubscribed && (
        <div style={{
          background: "rgba(255,159,10,0.06)",
          border: "1px solid rgba(255,159,10,0.18)",
          borderRadius: 10, padding: "14px 16px",
          marginBottom: 16, display: "flex",
          alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
        }}>
          <p style={{ fontSize: 12, color: "var(--dim)", lineHeight: 1.5 }}>
            <strong style={{ color: "#ff9f0a" }}>See fewer outages.</strong>{" "}
            Game Mode automatically routes around dish obstructions using your 4G/5G backup.
          </p>
          <Link
            to="/dashboard/subscription"
            style={{
              fontSize: 12, fontWeight: 700, color: "#000",
              background: "#ff9f0a", borderRadius: 8,
              padding: "8px 16px", textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            Fix it — $5/mo →
          </Link>
        </div>
      )}

      {/* Timeline */}
      {outages.length === 0 ? (
        <div style={{ textAlign: "center", padding: "24px 0" }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
          <p style={{ fontSize: 13, color: "var(--dim)" }}>
            {data == null ? "Checking outage history…" : "Clean session — no outages detected"}
          </p>
        </div>
      ) : (
        <div>
          {outages.map((o) => (
            <OutageCard key={o.id} outage={o} />
          ))}
        </div>
      )}
    </div>
  );
}
