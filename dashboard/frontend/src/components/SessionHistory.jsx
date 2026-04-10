import { useEffect, useState } from "react";
import { useApiFetch } from "../contexts/AuthContext";

function fmtDuration(s) {
  if (s == null) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export default function SessionHistory() {
  const apiFetch = useApiFetch();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/api/sessions/history")
      .then((r) => r.json())
      .then((d) => setSessions(d.sessions))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function exportCSV() {
    apiFetch("/api/sessions/export").then((r) => {
      r.blob().then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "antijitter-sessions.csv";
        a.click();
      });
    });
  }

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "20px 24px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--white)" }}>
          Session history
        </h3>
        {sessions.length > 0 && (
          <button
            onClick={exportCSV}
            style={{
              fontSize: 12,
              color: "var(--teal)",
              background: "none",
              border: "1px solid rgba(0,200,215,0.3)",
              borderRadius: 6,
              padding: "4px 12px",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Export CSV
          </button>
        )}
      </div>

      {loading ? (
        <p style={{ fontSize: 13, color: "var(--dim)" }}>Loading…</p>
      ) : !sessions.length ? (
        <p style={{ fontSize: 13, color: "var(--dim)" }}>
          No sessions recorded yet. Sessions are logged when you connect via WebSocket with a valid token.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                {["Date", "Duration", "Avg ping", "Max spike", "Failovers"].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      color: "var(--dim)",
                      fontWeight: 500,
                      paddingBottom: 8,
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td style={td}>{new Date(s.started_at).toLocaleDateString()}</td>
                  <td style={td}>{fmtDuration(s.duration_seconds)}</td>
                  <td style={td}>{s.avg_ping != null ? `${s.avg_ping} ms` : "—"}</td>
                  <td style={{ ...td, color: s.max_spike > 100 ? "var(--orange)" : "inherit" }}>
                    {s.max_spike != null ? `${s.max_spike} ms` : "—"}
                  </td>
                  <td style={{ ...td, color: s.failover_count > 0 ? "var(--teal)" : "var(--dim)" }}>
                    {s.failover_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const td = {
  padding: "10px 0",
  borderBottom: "1px solid #1a1a1a",
  fontVariantNumeric: "tabular-nums",
};
