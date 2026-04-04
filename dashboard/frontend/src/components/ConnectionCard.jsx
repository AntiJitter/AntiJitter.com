export default function ConnectionCard({ name, icon, latency, loss, signal, status }) {
  const statusColor =
    status === "degraded" ? "var(--red)" : status === "warning" ? "var(--orange)" : "var(--green)";

  return (
    <div
      style={{
        background: "var(--surface)",
        border: `1px solid ${status === "degraded" ? "rgba(255,69,58,0.3)" : "var(--border)"}`,
        borderRadius: 12,
        padding: "20px 24px",
        flex: 1,
        minWidth: 160,
        transition: "border-color 0.3s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span style={{ fontWeight: 600, fontSize: 14, color: "var(--white)" }}>{name}</span>
        <span
          style={{
            marginLeft: "auto",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: statusColor,
            boxShadow: `0 0 6px ${statusColor}`,
          }}
        />
      </div>

      <Metric label="Latency" value={latency != null ? `${latency} ms` : "—"} highlight={status === "degraded"} />
      <Metric label="Packet loss" value={loss != null ? `${loss}%` : "—"} />
      <Metric label="Signal" value={signal != null ? `${signal}%` : "—"} />
    </div>
  );
}

function Metric({ label, value, highlight }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
      <span style={{ fontSize: 12, color: "var(--dim)" }}>{label}</span>
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: highlight ? "var(--red)" : "var(--white)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}
