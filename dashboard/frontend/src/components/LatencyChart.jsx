import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const LINES = [
  { key: "starlink", label: "Starlink", color: "#ff9f0a", dashed: false },
  { key: "4g",       label: "4G LTE",  color: "#bf5af2", dashed: false },
  { key: "5g",       label: "5G",      color: "#0a84ff", dashed: false },
  { key: "bonded",   label: "Bonded",  color: "#00c8d7", dashed: false },
];

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: "#1c1c1e",
        border: "1px solid #333",
        borderRadius: 8,
        padding: "10px 14px",
        fontSize: 12,
      }}
    >
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color, marginTop: 2 }}>
          {p.name}: <strong>{p.value} ms</strong>
        </div>
      ))}
    </div>
  );
};

export default function LatencyChart({ history }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "20px 24px",
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--white)" }}>
          Latency — last 60 seconds
        </h3>
        <p style={{ fontSize: 12, color: "var(--dim)", marginTop: 4 }}>
          AntíJitter bonded output stays flat even during Starlink satellite handoffs
        </p>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={history} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
          <defs>
            {LINES.map(({ key, color }) => (
              <linearGradient key={key} id={`grad-${key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.25} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
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
            formatter={(value) => (
              <span style={{ color: "#86868b" }}>{value}</span>
            )}
          />
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
