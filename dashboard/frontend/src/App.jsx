import BondingPanel from "./components/BondingPanel.jsx";
import ConnectionCard from "./components/ConnectionCard.jsx";
import FailoverLog from "./components/FailoverLog.jsx";
import LatencyChart from "./components/LatencyChart.jsx";
import { useMetrics } from "./hooks/useMetrics.js";

export default function App() {
  const { history, status, events, connected } = useMetrics();
  const conns = status?.connections;

  return (
    <div style={{ minHeight: "100vh", background: "var(--black)" }}>
      {/* ── Header ── */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 28px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.5px", color: "var(--white)" }}>
            Antí<span style={{ color: "var(--teal)" }}>Jitter</span>
          </span>
          <span
            style={{
              fontSize: 11,
              background: "rgba(0,200,215,0.12)",
              color: "var(--teal)",
              border: "1px solid rgba(0,200,215,0.25)",
              borderRadius: 99,
              padding: "2px 10px",
              fontWeight: 600,
            }}
          >
            Dashboard
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: connected ? "var(--green)" : "var(--red)",
              boxShadow: connected ? "0 0 6px var(--green)" : "none",
              display: "inline-block",
              transition: "background 0.3s",
            }}
          />
          <span style={{ fontSize: 12, color: "var(--dim)" }}>
            {connected ? "Live" : "Connecting…"}
          </span>
        </div>
      </header>

      {/* ── Main content ── */}
      <main style={{ padding: "24px 28px", maxWidth: 1280, margin: "0 auto" }}>

        {/* ── Row 1: Connection cards + Bonding panel ── */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
          {conns ? (
            <>
              <ConnectionCard
                name={conns.starlink.name}
                icon={conns.starlink.icon}
                latency={conns.starlink.latency_ms}
                loss={conns.starlink.packet_loss_pct}
                signal={conns.starlink.signal_pct}
                status={conns.starlink.status}
              />
              <ConnectionCard
                name={conns["4g"].name}
                icon={conns["4g"].icon}
                latency={conns["4g"].latency_ms}
                loss={conns["4g"].packet_loss_pct}
                signal={conns["4g"].signal_pct}
                status={conns["4g"].status}
              />
              <ConnectionCard
                name={conns["5g"].name}
                icon={conns["5g"].icon}
                latency={conns["5g"].latency_ms}
                loss={conns["5g"].packet_loss_pct}
                signal={conns["5g"].signal_pct}
                status={conns["5g"].status}
              />
            </>
          ) : (
            <SkeletonCards />
          )}

          <BondingPanel
            bonded={status?.bonded}
            packetsRouted={status?.packets_routed}
            totalFailovers={status?.total_failovers}
            uptimeSeconds={status?.uptime_seconds}
          />
        </div>

        {/* ── Row 2: Latency chart ── */}
        <div style={{ marginBottom: 20 }}>
          <LatencyChart history={history} />
        </div>

        {/* ── Row 3: Failover log ── */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <FailoverLog events={events} />
        </div>
      </main>
    </div>
  );
}

function SkeletonCards() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: "20px 24px",
            flex: 1,
            minWidth: 160,
            minHeight: 120,
            animation: "pulse 1.5s ease-in-out infinite",
          }}
        />
      ))}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </>
  );
}
