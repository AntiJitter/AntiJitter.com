/**
 * Compact per-path rows — mirrors the Android HomeScreen `ActivePathsCard`.
 * Replaces the previous trio of full-width ConnectionCards with one tight
 * panel that fits the Speedify-style visual rhythm.
 */
export default function ActivePathsCard({ paths }) {
  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 16,
      padding: "16px 20px",
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: "var(--dim)",
        textTransform: "uppercase", letterSpacing: "0.06em",
        marginBottom: 10,
      }}>
        Active paths
      </div>

      {paths.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--dim)", padding: "10px 0" }}>
          No paths reported yet.
        </div>
      ) : (
        paths.map((p, i) => (
          <div key={p.name ?? i}>
            <PathRow path={p} />
            {i < paths.length - 1 && (
              <div style={{ height: 1, background: "var(--border)", margin: "8px 0" }} />
            )}
          </div>
        ))
      )}
    </div>
  );
}

function PathRow({ path }) {
  const active = path.status !== "degraded";
  const dotColor =
    path.status === "degraded" ? "var(--red)"
      : path.status === "warning" ? "var(--orange)"
      : "var(--green)";

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "6px 0", flexWrap: "wrap",
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%",
        background: dotColor,
        boxShadow: active ? `0 0 6px ${dotColor}` : "none",
        flexShrink: 0,
      }} />
      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--white)", minWidth: 90 }}>
        {path.icon ? <span style={{ marginRight: 6 }}>{path.icon}</span> : null}
        {path.name}
      </span>
      <Stat label="Latency" value={path.latency_ms != null ? `${path.latency_ms} ms` : "—"} />
      <Stat label="Loss"    value={path.packet_loss_pct != null ? `${path.packet_loss_pct}%` : "—"} />
      <Stat label="Signal"  value={path.signal_pct != null ? `${path.signal_pct}%` : "—"} />
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{
      display: "flex", alignItems: "baseline", gap: 6,
      marginLeft: "auto", fontVariantNumeric: "tabular-nums",
    }}>
      <span style={{ fontSize: 10, color: "var(--dim)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </span>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--white)", minWidth: 52, textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}
