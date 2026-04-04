export default function FailoverLog({ events }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "20px 24px",
        flex: 1,
        minWidth: 0,
      }}
    >
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, color: "var(--white)" }}>
        Failover events
      </h3>

      {!events?.length ? (
        <p style={{ fontSize: 13, color: "var(--dim)" }}>No failovers yet — all connections stable.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {events.map((ev, i) => (
            <EventRow key={i} event={ev} />
          ))}
        </div>
      )}
    </div>
  );
}

function EventRow({ event }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        background: "rgba(255,69,58,0.06)",
        border: "1px solid rgba(255,69,58,0.12)",
        borderRadius: 8,
        fontSize: 12,
        flexWrap: "wrap",
      }}
    >
      <span style={{ color: "var(--dim)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
        {event.time}
      </span>
      <span style={{ color: "var(--red)", fontWeight: 600 }}>{event.from}</span>
      <span style={{ color: "var(--dim)" }}>→</span>
      <span style={{ color: "var(--teal)", fontWeight: 600 }}>{event.to}</span>
      <span style={{ marginLeft: "auto", color: "var(--dim)" }}>
        <span style={{ color: "var(--red)" }}>{event.latency_before_ms} ms</span>
        {" → "}
        <span style={{ color: "var(--green)" }}>{event.latency_after_ms} ms</span>
        <span style={{ color: "var(--teal)", marginLeft: 6 }}>
          (−{event.saved_ms} ms)
        </span>
      </span>
    </div>
  );
}
