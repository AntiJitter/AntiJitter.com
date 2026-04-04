export default function BondingPanel({ bonded, packetsRouted, totalFailovers, uptimeSeconds }) {
  const uptime = formatUptime(uptimeSeconds ?? 0);

  return (
    <div
      style={{
        background: "var(--teal-dim)",
        border: "1px solid rgba(0,200,215,0.25)",
        borderRadius: 12,
        padding: "20px 24px",
        minWidth: 200,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: "var(--teal)",
            boxShadow: "0 0 8px var(--teal)",
            display: "inline-block",
          }}
        />
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--teal)" }}>
          AntíJitter Bonded
        </span>
      </div>

      <BigStat label="Latency" value={bonded?.latency_ms != null ? `${bonded.latency_ms} ms` : "—"} />
      <BigStat label="Packet loss" value={bonded?.packet_loss_pct != null ? `${bonded.packet_loss_pct}%` : "—"} />
      <BigStat label="Throughput" value={bonded?.throughput_mbps != null ? `${bonded.throughput_mbps} Mbps` : "—"} />

      <div style={{ borderTop: "1px solid rgba(0,200,215,0.15)", marginTop: 14, paddingTop: 14 }}>
        <SmallStat label="Uptime" value={uptime} />
        <SmallStat label="Packets routed" value={packetsRouted != null ? packetsRouted.toLocaleString() : "—"} />
        <SmallStat label="Failovers caught" value={totalFailovers ?? "—"} />
      </div>
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
