import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import BondingPanel from "../components/BondingPanel";
import ConnectionCard from "../components/ConnectionCard";
import FailoverLog from "../components/FailoverLog";
import LatencyChart from "../components/LatencyChart";
import OutageTimeline from "../components/OutageTimeline";
import SessionHistory from "../components/SessionHistory";
import Connections from "./Connections";
import { useAuth } from "../contexts/AuthContext";
import { useMetrics } from "../hooks/useMetrics";

const TABS = ["Live", "Connections", "History"];

export default function Dashboard() {
  const { user, logout, token } = useAuth();
  const { history, status, events, connected, failoverTs } = useMetrics(token);
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
