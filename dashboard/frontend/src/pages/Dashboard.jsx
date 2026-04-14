import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import BondingPanel from "../components/BondingPanel";
import ConnectionCard from "../components/ConnectionCard";
import FailoverLog from "../components/FailoverLog";
import LatencyChart from "../components/LatencyChart";
import OutageTimeline from "../components/OutageTimeline";
import SessionHistory from "../components/SessionHistory";
import StarlinkPingChart from "../components/StarlinkPingChart";
import Connections from "./Connections";
import { useAuth } from "../contexts/AuthContext";
import { useMetrics } from "../hooks/useMetrics";
import { usePingLogger } from "../hooks/usePingLogger";

const TABS = ["Live", "Connections", "History"];

export default function Dashboard() {
  const { user, logout, token } = useAuth();
  const { history, status, events, connected, failoverTs } = useMetrics(token);
  const { samples: pingSamples } = usePingLogger();
  const navigate = useNavigate();
  const conns = status?.connections;
  const [tab, setTab] = useState("Live");

  // Subscription check — free tier sees dashboard but Game Mode is locked
  const sub = user?.subscription;
  const isSubscribed = sub?.status === "active" || sub?.status === "trialing";

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--black)" }}>
      {/* ── Header ── */}
      <header style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 24px",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.5px" }}>
            Antí<span style={{ color: "var(--teal)" }}>Jitter</span>
          </span>

          <div style={{ display: "flex", gap: 4 }}>
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: "5px 14px",
                  borderRadius: 99,
                  border: "none",
                  background: tab === t ? "rgba(0,200,215,0.12)" : "transparent",
                  color: tab === t ? "var(--teal)" : "var(--dim)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{
              width: 7, height: 7, borderRadius: "50%",
              background: connected ? "var(--green)" : "var(--red)",
              boxShadow: connected ? "0 0 6px var(--green)" : "none",
              display: "inline-block",
              transition: "background 0.3s",
            }} />
            <span style={{ fontSize: 12, color: "var(--dim)" }}>
              {connected ? "Live" : "Reconnecting…"}
            </span>
          </div>

          <Link
            to="/games"
            style={{ fontSize: 12, color: "var(--dim)", textDecoration: "none", fontWeight: 600 }}
          >
            Games
          </Link>

          <Link
            to="/dashboard/subscription"
            style={{ fontSize: 12, color: isSubscribed ? "var(--green)" : "var(--dim)", textDecoration: "none" }}
          >
            {isSubscribed
              ? `✓ ${sub.status === "trialing" ? "Trial" : "Active"}`
              : "Subscribe →"}
          </Link>

          <button
            onClick={handleLogout}
            style={{
              fontSize: 12, color: "var(--dim)",
              background: "none", border: "none",
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      {/* ── Main content ── */}
      <main style={{ padding: "22px 24px", maxWidth: 1280, margin: "0 auto" }}>
        {tab === "Live" && (
          <>
            {/* Row 0: Starlink ping history chart */}
            <div style={{ marginBottom: 18 }}>
              <StarlinkPingChart samples={pingSamples} />
            </div>

            {/* Row 1: Connection cards + Bonding panel */}
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
              {conns ? (
                <>
                  <ConnectionCard {...cardProps(conns.starlink)} />
                  <ConnectionCard {...cardProps(conns["4g"])} />
                  <ConnectionCard {...cardProps(conns["5g"])} />
                </>
              ) : (
                <SkeletonCards />
              )}
              <BondingPanel
                bonded={status?.bonded}
                packetsRouted={status?.packets_routed}
                totalFailovers={status?.total_failovers}
                uptimeSeconds={status?.uptime_seconds}
                isSubscribed={isSubscribed}
              />
            </div>

            {/* Row 2: Latency chart with handoff markers */}
            <div style={{ marginBottom: 18 }}>
              <LatencyChart history={history} failoverTs={failoverTs} />
            </div>

            {/* Row 3: Outage timeline */}
            <div style={{ marginBottom: 18 }}>
              <OutageTimeline isSubscribed={isSubscribed} />
            </div>

            {/* Row 4: Failover log */}
            <FailoverLog events={events} />

            {/* Row 5: Game coverage info */}
            <GameCoverageWidget />
          </>
        )}

        {tab === "Connections" && <Connections />}

        {tab === "History" && <SessionHistory />}
      </main>
    </div>
  );
}

function cardProps(c) {
  return {
    name: c.name,
    icon: c.icon,
    latency: c.latency_ms,
    loss: c.packet_loss_pct,
    signal: c.signal_pct,
    status: c.status,
  };
}

function GameCoverageWidget() {
  const [stats, setStats] = useState(null);
  const [games, setGames] = useState([]);

  useEffect(() => {
    fetch("/api/games/stats").then(r => r.json()).then(setStats).catch(() => {});
    fetch("/api/games").then(r => r.json()).then(setGames).catch(() => {});
  }, []);

  return (
    <div style={{
      marginTop: 14,
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 12,
      padding: "14px 18px",
      display: "flex",
      alignItems: "center",
      gap: 16,
      flexWrap: "wrap",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--white)" }}>Game Coverage</span>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
          background: "rgba(0,200,215,0.1)", color: "var(--teal)", border: "1px solid rgba(0,200,215,0.2)",
        }}>LIVE</span>
      </div>

      {stats ? (
        <div style={{ display: "flex", gap: 20, flex: 1, flexWrap: "wrap" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--teal)", fontVariantNumeric: "tabular-nums" }}>{stats.game_count}</div>
            <div style={{ fontSize: 10, color: "var(--dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>games</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--white)", fontVariantNumeric: "tabular-nums" }}>{(stats.range_count ?? 0).toLocaleString()}</div>
            <div style={{ fontSize: 10, color: "var(--dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>IP ranges</div>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, fontSize: 13, color: "var(--dim)" }}>Loading…</div>
      )}

      {games.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: "1 1 auto" }}>
          {games.slice(0, 8).map(g => (
            <span key={g.id} title={g.name} style={{ fontSize: 18, lineHeight: 1 }}>{g.icon}</span>
          ))}
          {games.length > 8 && (
            <span style={{ fontSize: 11, color: "var(--dim)", alignSelf: "center" }}>+{games.length - 8} more</span>
          )}
        </div>
      )}

      <Link
        to="/games"
        style={{
          fontSize: 12, color: "var(--teal)", textDecoration: "none", fontWeight: 600,
          whiteSpace: "nowrap", flex: "0 0 auto",
        }}
      >
        View all →
      </Link>
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
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    </>
  );
}
