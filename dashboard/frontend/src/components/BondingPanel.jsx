import { useState } from "react";

const EXPLANATION =
  "Game Mode sends every packet through all your connections simultaneously for zero-spike gaming. " +
  "Turn off for downloads, game updates, and streaming to use full available bandwidth.";

export default function BondingPanel({ bonded, packetsRouted, totalFailovers, uptimeSeconds }) {
  const [gameMode, setGameMode] = useState(true);
  const uptime = formatUptime(uptimeSeconds ?? 0);

  return (
    <div
      style={{
        background: gameMode ? "var(--teal-dim)" : "rgba(134,134,139,0.08)",
        border: `1px solid ${gameMode ? "rgba(0,200,215,0.25)" : "rgba(134,134,139,0.2)"}`,
        borderRadius: 12,
        padding: "20px 24px",
        minWidth: 200,
        transition: "background 0.3s, border-color 0.3s",
      }}
    >
      {/* ── Header + toggle ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: gameMode ? "var(--teal)" : "var(--dim)",
              boxShadow: gameMode ? "0 0 8px var(--teal)" : "none",
              display: "inline-block",
              transition: "background 0.3s, box-shadow 0.3s",
            }}
          />
          <span style={{ fontSize: 14, fontWeight: 700, color: gameMode ? "var(--teal)" : "var(--dim)" }}>
            Game Mode
          </span>
        </div>

        {/* Toggle switch */}
        <button
          onClick={() => setGameMode((v) => !v)}
          aria-label={gameMode ? "Turn Game Mode off" : "Turn Game Mode on"}
          style={{
            width: 44,
            height: 24,
            borderRadius: 99,
            border: "none",
            background: gameMode ? "var(--teal)" : "#333",
            cursor: "pointer",
            position: "relative",
            transition: "background 0.25s",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 3,
              left: gameMode ? 23 : 3,
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: "#fff",
              transition: "left 0.2s",
              boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
            }}
          />
        </button>
      </div>

      {/* ON/OFF label */}
      <p style={{ fontSize: 11, color: gameMode ? "var(--teal)" : "var(--dim)", marginBottom: 12, fontWeight: 600, letterSpacing: "0.05em" }}>
        {gameMode ? "ON — zero-spike gaming" : "OFF — full bandwidth mode"}
      </p>

      {gameMode ? (
        <>
          <BigStat label="Latency" value={bonded?.latency_ms != null ? `${bonded.latency_ms} ms` : "—"} />
          <BigStat label="Packet loss" value={bonded?.packet_loss_pct != null ? `${bonded.packet_loss_pct}%` : "—"} />
          <BigStat label="Throughput" value={bonded?.throughput_mbps != null ? `${bonded.throughput_mbps} Mbps` : "—"} />

          <div style={{ borderTop: "1px solid rgba(0,200,215,0.15)", marginTop: 14, paddingTop: 14 }}>
            <SmallStat label="Uptime" value={uptime} />
            <SmallStat label="Packets routed" value={packetsRouted != null ? packetsRouted.toLocaleString() : "—"} />
            <SmallStat label="Failovers caught" value={totalFailovers ?? "—"} />
          </div>
        </>
      ) : (
        <p style={{ fontSize: 12, color: "var(--dim)", lineHeight: 1.6, marginTop: 4 }}>
          {EXPLANATION}
        </p>
      )}
    </div>
  );
}

function BigStat({ label, value }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: "rgba(0,200,215,0.6)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--teal)", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
    </div>
  );
}

function SmallStat({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
      <span style={{ fontSize: 12, color: "var(--dim)" }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--white)", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
    </div>
  );
}

function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
