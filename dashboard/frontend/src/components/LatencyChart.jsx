import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const LINES = [
  { key: "starlink", label: "Starlink", color: "#ff9f0a" },
  { key: "4g",       label: "4G LTE",  color: "#bf5af2" },
  { key: "5g",       label: "5G",      color: "#0a84ff" },
  { key: "bonded",   label: "Game Mode", color: "#00c8d7" },
];

// 4G LTE typical latency band — visually anchors the "normal 4G zone"
const BAND_4G = { y1: 35, y2: 70 };

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#1c1c1e",
      border: "1px solid #333",
      borderRadius: 8,
      padding: "10px 14px",
      fontSize: 12,
    }}>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color, marginTop: 2 }}>
          {p.name}: <strong>{p.value} ms</strong>
        </div>
      ))}
    </div>
  );
};

const FailoverLabel = ({ viewBox }) => {
  if (!viewBox) return null;
  const { x } = viewBox;
  return (
    <g>
      <line x1={x} y1={0} x2={x} y2={220} stroke="#ff453a" strokeWidth={1.5} strokeDasharray="4 3" />
      <text x={x + 4} y={14} fill="#ff453a" fontSize={9} fontWeight={700}>
        HANDOFF
      </text>
    </g>
  );
};

export default function LatencyChart({ history, failoverTs = [] }) {
  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 12,
      padding: "20px 24px",
    }}>
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--white)" }}>
          Latency — last 60 seconds
        </h3>
        <p style={{ fontSize: 12, color: "var(--dim)", marginTop: 4 }}>
          Game Mode keeps your latency flat even during Starlink satellite handoffs
          {failoverTs.length > 0 && (
            <span style={{ color: "#ff453a", marginLeft: 8 }}>
              · {failoverTs.length} handoff{failoverTs.length !== 1 ? "s" : ""} caught
            </span>
          )}
        </p>
      </div>

      {/* Legend extras */}
      <div style={{ display: "flex", gap: 16, marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "#86868b", display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ display: "inline-block", width: 12, height: 8, background: "rgba(191,90,242,0.15)", borderRadius: 2 }} />
          4G coverage zone
        </span>
        {failoverTs.length > 0 && (
          <span style={{ fontSize: 11, color: "#ff453a", display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ display: "inline-block", width: 12, borderTop: "1.5px dashed #ff453a" }} />
            Satellite handoff
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={history} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
          <defs>
            {LINES.map(({ key, color }) => (
              <linearGradient key={key} id={`grad-${key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={color} stopOpacity={0.25} />
                <stop offset="95%" stopColor={color} stopOpacity={0}    />
              </linearGradient>
            ))}
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" />
          <XAxis dataKey="t" hide />
          <YAxis
            tick={{ fill: "#86868b", fontSize: 11 }}
            tickFormatter={(v) => `${v}ms`}
            domain={[0, "auto"]}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 12, color: "#86868b", paddingTop: 12 }}
            formatter={(value) => <span style={{ color: "#86868b" }}>{value}</span>}
          />

          {/* 4G coverage band — subtle purple fill showing typical 4G latency zone */}
          <ReferenceArea
            y1={BAND_4G.y1}
            y2={BAND_4G.y2}
            fill="rgba(191,90,242,0.07)"
            stroke="rgba(191,90,242,0.18)"
            strokeDasharray="4 4"
            strokeWidth={1}
            ifOverflow="extendDomain"
          />

          {/* Vertical markers where satellite handoffs were detected */}
          {failoverTs.map((t) => (
            <ReferenceLine
              key={t}
              x={t}
              stroke="transparent"
              label={<FailoverLabel />}
            />
          ))}

          {LINES.map(({ key, label, color }) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              name={label}
              stroke={color}
              strokeWidth={key === "bonded" ? 2.5 : 1.5}
              fill={`url(#grad-${key})`}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
