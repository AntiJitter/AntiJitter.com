import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMemo } from "react";

const SPIKE_MULT = 2.5;
const BASELINE_WINDOW = 20;

/** Build chart-ready data from raw samples array. */
function buildChartData(samples) {
  if (!samples.length) return { data: [], stats: null };

  const data = samples.map((s, i) => {
    // Rolling median of last N samples as baseline (resistant to spikes)
    const window = samples
      .slice(Math.max(0, i - BASELINE_WINDOW), i)
      .map((x) => x.latency_ms)
      .sort((a, b) => a - b);
    const baseline =
      window.length >= 4 ? window[Math.floor(window.length / 2)] : null;

    const isSpike = baseline !== null && s.latency_ms > baseline * SPIKE_MULT;
    const gameMode = isSpike && baseline ? baseline * 1.05 : s.latency_ms;

    return {
      time: s.ts instanceof Date ? s.ts : new Date(s.ts),
      starlink: Math.round(s.latency_ms * 10) / 10,
      gameMode: Math.round(gameMode * 10) / 10,
      isSpike,
    };
  });

  const values = samples.map((s) => s.latency_ms);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / values.length;

  return {
    data,
    stats: {
      current: Math.round(values[values.length - 1] * 10) / 10,
      avg: Math.round(avg * 10) / 10,
      jitter: Math.round(Math.sqrt(variance) * 10) / 10,
      handoffs: data.filter((d) => d.isSpike).length,
      samples: values.length,
    },
  };
}

function fmtTime(ts) {
  if (!ts) return "";
  const d = ts instanceof Date ? ts : new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const time = payload[0]?.payload?.time;
  return (
    <div style={{
      background: "#1c1c1e",
      border: "1px solid #333",
      borderRadius: 8,
      padding: "10px 14px",
      fontSize: 12,
    }}>
      {time && (
        <div style={{ color: "#86868b", marginBottom: 4 }}>
          {fmtTime(time)}
        </div>
      )}
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color, marginTop: 2 }}>
          {p.name}: <strong>{p.value} ms</strong>
        </div>
      ))}
    </div>
  );
};

export default function StarlinkPingChart({ samples }) {
  const { data, stats } = useMemo(() => buildChartData(samples), [samples]);

  const pingColor =
    !stats ? "#86868b"
    : stats.current < 50  ? "var(--green)"
    : stats.current < 100 ? "var(--teal)"
    : stats.current < 200 ? "var(--orange)"
    : "var(--red)";

  // X-axis tick positions: show one label every ~5 minutes
  const tickInterval = Math.max(1, Math.floor((5 * 60 * 1000) / 2000));

  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 12,
      padding: "20px 24px",
    }}>
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--white)", margin: 0 }}>
            Starlink Latency
          </h3>
          <p style={{ fontSize: 12, color: "var(--dim)", marginTop: 4, marginBottom: 0 }}>
            Measured from your browser every 2 s · up to 1 h shown
          </p>
        </div>
        {stats && (
          <div style={{ textAlign: "right", lineHeight: 1 }}>
            <span style={{ fontSize: 36, fontWeight: 800, color: pingColor }}>
              {stats.current}
            </span>
            <span style={{ fontSize: 13, color: "var(--dim)", marginLeft: 4 }}>ms</span>
          </div>
        )}
      </div>

      {/* Stats pills */}
      {stats && (
        <div style={{ display: "flex", gap: 20, marginBottom: 12, flexWrap: "wrap" }}>
          <StatPill label="Avg" value={`${stats.avg} ms`} />
          <StatPill
            label="Jitter"
            value={`±${stats.jitter} ms`}
            color={stats.jitter > 20 ? "var(--orange)" : "var(--white)"}
          />
          <StatPill
            label="Handoffs"
            value={stats.handoffs}
            color={stats.handoffs > 0 ? "var(--red)" : "var(--dim)"}
          />
          <StatPill label="Samples" value={stats.samples.toLocaleString()} />
        </div>
      )}

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, marginBottom: 8, flexWrap: "wrap" }}>
        <LegendItem color="#ff9f0a" label="Starlink" />
        <LegendItem color="var(--teal)" label="With Game Mode" dashed />
        {stats?.handoffs > 0 && (
          <span style={{ fontSize: 11, color: "#ff453a", display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ display: "inline-block", width: 12, borderTop: "1.5px dashed #ff453a" }} />
            Satellite handoff
          </span>
        )}
      </div>

      {data.length === 0 ? (
        <div style={{
          height: 240,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--dim)",
          fontSize: 13,
        }}>
          Measuring latency… this takes a few seconds
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={data} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
            <defs>
              <linearGradient id="sl-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#ff9f0a" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#ff9f0a" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gm-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#00c8d7" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#00c8d7" stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" />
            <XAxis
              dataKey="time"
              tickFormatter={fmtTime}
              tick={{ fill: "#86868b", fontSize: 10 }}
              interval={tickInterval}
            />
            <YAxis
              tick={{ fill: "#86868b", fontSize: 11 }}
              tickFormatter={(v) => `${v}ms`}
              domain={[0, "auto"]}
            />
            <Tooltip content={<CustomTooltip />} />

            {/* Vertical markers at each detected handoff */}
            {data
              .filter((d) => d.isSpike)
              .map((d, i) => (
                <ReferenceLine
                  key={i}
                  x={d.time}
                  stroke="#ff453a"
                  strokeWidth={1}
                  strokeDasharray="4 3"
                />
              ))}

            <Area
              type="monotone"
              dataKey="starlink"
              name="Starlink"
              stroke="#ff9f0a"
              strokeWidth={2}
              fill="url(#sl-grad)"
              dot={false}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="gameMode"
              name="With Game Mode"
              stroke="#00c8d7"
              strokeWidth={1.5}
              strokeDasharray="6 3"
              fill="url(#gm-grad)"
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function StatPill({ label, value, color = "var(--white)" }) {
  return (
    <div style={{ fontSize: 12 }}>
      <span style={{ color: "var(--dim)" }}>{label}: </span>
      <span style={{ fontWeight: 600, color }}>{value}</span>
    </div>
  );
}

function LegendItem({ color, label, dashed }) {
  return (
    <span style={{ fontSize: 11, color: "#86868b", display: "flex", alignItems: "center", gap: 5 }}>
      {dashed ? (
        <span style={{ display: "inline-block", width: 20, borderTop: `2px dashed ${color}` }} />
      ) : (
        <span style={{ display: "inline-block", width: 12, height: 8, background: color, borderRadius: 2, opacity: 0.8 }} />
      )}
      {label}
    </span>
  );
}
