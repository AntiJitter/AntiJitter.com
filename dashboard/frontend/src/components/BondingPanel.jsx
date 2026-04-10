import { useState } from "react";
import { Link } from "react-router-dom";

const EXPLANATION =
  "Game Mode sends every packet through all your connections simultaneously for zero-spike gaming. " +
  "Turn off for downloads, game updates, and streaming to use full available bandwidth.";

export default function BondingPanel({ bonded, packetsRouted, totalFailovers, uptimeSeconds, isSubscribed = true }) {
  const [gameMode, setGameMode] = useState(true);
  const [showUpsell, setShowUpsell] = useState(false);
  const uptime = formatUptime(uptimeSeconds ?? 0);

  const locked = !isSubscribed;

  function handleToggle() {
    if (locked) {
      setShowUpsell((v) => !v);
      return;
    }
    setGameMode((v) => !v);
    setShowUpsell(false);
  }

  return (
    <div style={{
      background: gameMode && !locked ? "var(--teal-dim)" : "rgba(134,134,139,0.08)",
      border: `1px solid ${gameMode && !locked ? "rgba(0,200,215,0.25)" : "rgba(134,134,139,0.2)"}`,
      borderRadius: 12,
      padding: "20px 24px",
      minWidth: 200,
      transition: "background 0.3s, border-color 0.3s",
    }}>
      {/* ── Header + toggle ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            width: 10, height: 10, borderRadius: "50%",
            background: gameMode && !locked ? "var(--teal)" : "var(--dim)",
            boxShadow: gameMode && !locked ? "0 0 8px var(--teal)" : "none",
            display: "inline-block",
            transition: "background 0.3s, box-shadow 0.3s",
          }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: gameMode && !locked ? "var(--teal)" : "var(--dim)" }}>
            Game Mode
          </span>
          {locked && (
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
              color: "#ff9f0a", background: "rgba(255,159,10,0.12)",
              border: "1px solid rgba(255,159,10,0.25)",
              borderRadius: 5, padding: "2px 6px",
            }}>
              $5/mo
            </span>
          )}
        </div>

        {/* Toggle switch */}
        <button
          onClick={handleToggle}
          aria-label={locked ? "Unlock Game Mode" : gameMode ? "Turn Game Mode off" : "Turn Game Mode on"}
          style={{
            width: 44, height: 24, borderRadius: 99, border: "none",
            background: locked ? "#2a2a2a" : gameMode ? "var(--teal)" : "#333",
            cursor: "pointer",
            position: "relative",
            transition: "background 0.25s",
            flexShrink: 0,
          }}
        >
          {locked ? (
            /* Lock icon */
            <svg
              viewBox="0 0 24 24"
              width="12" height="12"
              fill="none"
              stroke="#86868b"
              strokeWidth="2"
              style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)" }}
            >
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          ) : (
            <span style={{
              position: "absolute", top: 3,
              left: gameMode ? 23 : 3,
              width: 18, height: 18, borderRadius: "50%",
              background: "#fff",
              transition: "left 0.2s",
              boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
            }} />
          )}
        </button>
      </div>

      {/* ON/OFF / locked label */}
      <p style={{
        fontSize: 11,
        color: locked ? "#86868b" : gameMode ? "var(--teal)" : "var(--dim)",
        marginBottom: 12, fontWeight: 600, letterSpacing: "0.05em",
      }}>
        {locked ? "Locked — subscribe to enable" : gameMode ? "ON — zero-spike gaming" : "OFF — full bandwidth mode"}
      </p>

      {/* ── Locked upsell panel ── */}
      {locked && showUpsell && (
        <div style={{
          background: "rgba(255,159,10,0.06)",
          border: "1px solid rgba(255,159,10,0.2)",
          borderRadius: 10,
          padding: "14px 16px",
          marginBottom: 14,
        }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: "#ff9f0a", marginBottom: 6 }}>
            Unlock Game Mode
          </p>
          <p style={{ fontSize: 12, color: "var(--dim)", lineHeight: 1.6, marginBottom: 12 }}>
            Bond all your connections into one zero-spike pipe.
            Those lag spikes you're seeing? Gone.
          </p>
          <Link
            to="/dashboard/subscription"
            style={{
              display: "block", textAlign: "center",
              background: "#ff9f0a", color: "#000",
              fontWeight: 700, fontSize: 13,
              borderRadius: 8, padding: "9px 0",
              textDecoration: "none",
            }}
          >
            Start 7-day free trial →
          </Link>
          <p style={{ fontSize: 11, color: "var(--dim)", textAlign: "center", marginTop: 8 }}>
            $5/month after trial · Cancel anytime
          </p>
        </div>
      )}

      {/* ── Live stats (subscribed + game mode ON) ── */}
      {!locked && gameMode && (
        <>
          <BigStat label="Latency" value={bonded?.latency_ms != null ? `${bonded.latency_ms} ms` : "—"} />
          <BigStat label="Packet loss" value={bonded?.packet_loss_pct != null ? `${bonded.packet_loss_pct}%` : "—"} />
          <BigStat label="Throughput" value={bonded?.throughput_mbps != null ? `${bonded.throughput_mbps} Mbps` : "—"} />
          <div style={{ borderTop: "1px solid rgba(0,200,215,0.15)", marginTop: 14, paddingTop: 14 }}>
            <SmallStat label="Uptime"          value={uptime} />
            <SmallStat label="Packets routed"  value={packetsRouted != null ? packetsRouted.toLocaleString() : "—"} />
            <SmallStat label="Failovers caught" value={totalFailovers ?? "—"} />
          </div>
        </>
      )}

      {/* ── Free tier: blurred preview stats ── */}
      {locked && !showUpsell && (
        <>
          <div style={{ position: "relative" }}>
            <div style={{ filter: "blur(5px)", userSelect: "none", pointerEvents: "none" }}>
              <BigStat label="Latency"    value="24 ms" />
              <BigStat label="Packet loss" value="0.01%" />
              <BigStat label="Throughput" value="62 Mbps" />
            </div>
            <div style={{
              position: "absolute", inset: 0,
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 8,
            }}>
              <span style={{ fontSize: 12, color: "var(--dim)", textAlign: "center", lineHeight: 1.5 }}>
                Subscribe to see your<br />live bonded stats
              </span>
              <button
                onClick={() => setShowUpsell(true)}
                style={{
                  fontSize: 12, fontWeight: 700,
                  color: "#ff9f0a", background: "transparent",
                  border: "1px solid rgba(255,159,10,0.35)",
                  borderRadius: 8, padding: "6px 14px",
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Unlock →
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Game mode OFF explanation ── */}
      {!locked && !gameMode && (
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
