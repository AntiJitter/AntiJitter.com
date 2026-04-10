import { useCallback, useEffect, useState } from "react";
import { useApiFetch } from "../contexts/AuthContext";

const ICONS = {
  satellite: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3"/>
      <path d="M6.3 6.3 4 4M17.7 6.3 20 4M6.3 17.7 4 20M17.7 17.7 20 20"/>
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2"/>
    </svg>
  ),
  phone: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="7" y="2" width="10" height="20" rx="2"/>
      <circle cx="12" cy="18" r="1" fill="currentColor"/>
      <line x1="10" y1="5" x2="14" y2="5"/>
    </svg>
  ),
  wifi: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 12.55a11 11 0 0 1 14.08 0"/>
      <path d="M1.42 9a16 16 0 0 1 21.16 0"/>
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
      <circle cx="12" cy="20" r="1" fill="currentColor"/>
    </svg>
  ),
  cellular: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="2"  y="16" width="3" height="6" rx="1" fill="currentColor" stroke="none"/>
      <rect x="7"  y="11" width="3" height="11" rx="1" fill="currentColor" stroke="none"/>
      <rect x="12" y="6"  width="3" height="16" rx="1" fill="currentColor" stroke="none"/>
      <rect x="17" y="2"  width="3" height="20" rx="1" fill="currentColor" stroke="none"/>
    </svg>
  ),
  unknown: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="10"/>
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
      <circle cx="12" cy="17" r="1" fill="currentColor"/>
    </svg>
  ),
};

function PingBadge({ ms }) {
  if (ms == null) return <span style={{ fontSize: 11, color: "var(--dim)" }}>—</span>;
  const color = ms < 50 ? "var(--green)" : ms < 80 ? "var(--orange)" : "var(--red)";
  return (
    <span style={{
      fontSize: 12, fontWeight: 700, color,
      background: `${color}18`, border: `1px solid ${color}40`,
      borderRadius: 6, padding: "2px 8px",
      fontVariantNumeric: "tabular-nums",
    }}>
      {ms} ms
    </span>
  );
}

function InterfaceCard({ iface, onToggle, toggling }) {
  const Icon = ICONS[iface.icon] ?? ICONS.unknown;
  const statusColor = iface.up && iface.ping_ms != null
    ? "var(--green)" : iface.up ? "var(--orange)" : "var(--dim)";

  return (
    <div style={{
      background: "var(--surface)",
      border: `1px solid ${iface.up ? "var(--border)" : "#1a1a1a"}`,
      borderRadius: 12,
      padding: "18px 20px",
      display: "flex",
      alignItems: "center",
      gap: 16,
      opacity: iface.up ? 1 : 0.6,
      transition: "opacity 0.3s, border-color 0.3s",
    }}>
      {/* Icon */}
      <div style={{ color: iface.up ? "var(--teal)" : "var(--dim)", flexShrink: 0 }}>
        <Icon />
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{iface.label}</span>
          <span style={{ fontSize: 11, color: "var(--dim)", fontFamily: "monospace" }}>
            {iface.name}
          </span>
          <span style={{
            marginLeft: "auto",
            width: 7, height: 7, borderRadius: "50%",
            background: statusColor,
            boxShadow: iface.up && iface.ping_ms != null ? `0 0 5px ${statusColor}` : "none",
            flexShrink: 0,
          }}/>
        </div>

        {iface.hint && (
          <p style={{ fontSize: 12, color: "var(--teal)", margin: 0, lineHeight: 1.4 }}>
            {iface.hint}
          </p>
        )}

        {!iface.hint && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "var(--dim)" }}>
              {iface.up ? "Active path" : "Inactive"}
            </span>
            <PingBadge ms={iface.ping_ms} />
          </div>
        )}
      </div>

      {/* Toggle */}
      <button
        onClick={() => onToggle(iface.name, !iface.up)}
        disabled={toggling === iface.name}
        style={{
          width: 44, height: 24, borderRadius: 99, border: "none", flexShrink: 0,
          background: iface.up ? "var(--teal)" : "#333",
          cursor: toggling === iface.name ? "wait" : "pointer",
          position: "relative", transition: "background 0.25s",
          opacity: toggling === iface.name ? 0.6 : 1,
        }}
      >
        <span style={{
          position: "absolute", top: 3,
          left: iface.up ? 23 : 3,
          width: 18, height: 18, borderRadius: "50%",
          background: "#fff", transition: "left 0.2s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
        }}/>
      </button>
    </div>
  );
}

export default function Connections() {
  const apiFetch = useApiFetch();
  const [data, setData]       = useState(null);
  const [toggling, setToggling] = useState(null);
  const [lastScan, setLastScan] = useState(null);

  const scan = useCallback(async () => {
    try {
      const res = await apiFetch("/api/connections/scan");
      if (res.ok) {
        const d = await res.json();
        setData(d);
        setLastScan(new Date());
      }
    } catch { /* backend not reachable in dev */ }
  }, [apiFetch]);

  // Auto-refresh every 5 s
  useEffect(() => {
    scan();
    const id = setInterval(scan, 5000);
    return () => clearInterval(id);
  }, [scan]);

  async function handleToggle(name, enable) {
    setToggling(name);
    try {
      const res = await apiFetch("/api/connections/toggle", {
        method: "POST",
        body: JSON.stringify({ interface: name, enable }),
      });
      if (res.ok) {
        const updated = await res.json();
        setData((prev) => prev ? {
          ...prev,
          interfaces: prev.interfaces.map((i) =>
            i.name === name ? { ...i, up: updated.up, ping_ms: updated.ping_ms } : i
          ),
          active_paths: prev.interfaces.filter((i) =>
            i.name === name ? enable : i.up
          ).length,
        } : prev);
      }
    } catch { /* ignore */ }
    setToggling(null);
  }

  const activePaths = data?.active_paths ?? 0;
  const pathColor = activePaths >= 3 ? "var(--green)" : activePaths >= 2 ? "var(--teal)" : "var(--orange)";

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "0 4px" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Connections</h3>
          <p style={{ fontSize: 12, color: "var(--dim)" }}>
            {lastScan ? `Scanned ${lastScan.toLocaleTimeString()}` : "Scanning…"}
          </p>
        </div>
        <div style={{
          background: `${pathColor}15`,
          border: `1px solid ${pathColor}40`,
          borderRadius: 10, padding: "8px 16px", textAlign: "center",
        }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: pathColor }}>
            {activePaths}
          </div>
          <div style={{ fontSize: 11, color: "var(--dim)" }}>active paths</div>
        </div>
      </div>

      {/* Interface cards */}
      {!data ? (
        <p style={{ color: "var(--dim)", fontSize: 13 }}>Scanning interfaces…</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {data.interfaces.map((iface) => (
            <InterfaceCard
              key={iface.name}
              iface={iface}
              onToggle={handleToggle}
              toggling={toggling}
            />
          ))}

          {/* USB tether missing hint */}
          {!data.usb_tether_present && (
            <div style={{
              border: "1px dashed rgba(0,200,215,0.3)",
              borderRadius: 12, padding: "16px 20px",
              display: "flex", gap: 14, alignItems: "center",
            }}>
              <div style={{ color: "var(--dim)", flexShrink: 0 }}>
                {ICONS.phone()}
              </div>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Add a third bonded path</p>
                <p style={{ fontSize: 12, color: "var(--dim)" }}>
                  Plug in your phone via USB and enable USB tethering to bond
                  a third connection into Game Mode.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
