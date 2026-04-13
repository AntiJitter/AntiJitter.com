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
import { useMemo, useState } from "react";

// Visual cap — spikes above this are clamped in the chart (real value still in tooltip)
const DISPLAY_CAP = 200;

// Spike = above this multiple of baseline AND above the absolute floor
// Uses a wide window + low percentile so the baseline reflects "good" pings, not averages
const SPIKE_MULT       = 4;     // 4× baseline to count as a spike for Game Mode simulation
const SPIKE_ABS_MIN    = 100;   // must also be >100 ms (ignores tiny noisy bumps)
const HANDOFF_ABS_MIN  = 300;   // only draw a red line for severe spikes (real handoffs)
const BASELINE_WINDOW  = 90;    // ~3 min of samples — long enough to stay stable
const BASELINE_PCT     = 0.20;  // 20th-percentile: baseline = "good" pings, not average

const TIME_WINDOWS = [
  { label: "2m",  minutes: 2  },
  { label: "5m",  minutes: 5  },
  { label: "15m", minutes: 15 },
  { label: "1h",  minutes: 60 },
];

/** Build chart-ready data from a (already-windowed) samples array. */
function buildChartData(samples) {
  if (!samples.length) return { data: [], stats: null };

  const data = samples.map((s, i) => {
    const win = samples
      .slice(Math.max(0, i - BASELINE_WINDOW), i)
      .map((x) => x.latency_ms)
      .sort((a, b) => a - b);

    // Use low percentile so the baseline hugs "quiet" pings
    const baseline =
      win.length >= 8 ? win[Math.floor(win.length * BASELINE_PCT)] : null;

    const isSpike =
      baseline !== null &&
      s.latency_ms > baseline * SPIKE_MULT &&
      s.latency_ms > SPIKE_ABS_MIN;

    const isHandoff = isSpike && s.latency_ms > HANDOFF_ABS_MIN;

    const gameMode    = isSpike && baseline ? baseline * 1.05 : s.latency_ms;
    const starlink    = Math.round(s.latency_ms * 10) / 10;
    const gameModeVal = Math.round(gameMode   * 10) / 10;

    return {
      time:       s.ts instanceof Date ? s.ts : new Date(s.ts),
      starlink,
      gameMode:   gameModeVal,
      isSpike,
      isHandoff,
      starlinkViz: Math.min(starlink,    DISPLAY_CAP),
      gameModeViz: Math.min(gameModeVal, DISPLAY_CAP),
    };
  });

  // Stats: compute avg & jitter only from non-spike samples so one big
  // handoff doesn't blow up the numbers
  const quietVals = data.filter((d) => !d.isSpike).map((d) => d.starlink);
  const statsVals = quietVals.length >= 4 ? quietVals : data.map((d) => d.starlink);
  const avg = statsVals.reduce((a, b) => a + b, 0) / statsVals.length;
  const variance =
    statsVals.reduce((sum, v) => sum + (v - avg) ** 2, 0) / statsVals.length;

  return {
    data,
    stats: {
      current:  Math.round(data[data.length - 1].starlink * 10) / 10,
      avg:      Math.round(avg * 10) / 10,
      jitter:   Math.round(Math.sqrt(variance) * 10) / 10,
      handoffs: data.filter((d) => d.isHandoff).length,
      samples:  data.length,
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
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div style={{
      background: "#1c1c1e",
      border: "1px solid #333",
      borderRadius: 8,
      padding: "10px 14px",
      fontSize: 12,
    }}>
      {row.time && (
        <div style={{ color: "#86868b", marginBottom: 4 }}>{fmtTime(row.time)}</div>
      )}
      <div style={{ color: "#ff9f0a", marginTop: 2 }}>
        Starlink: <strong>{row.starlink} ms</strong>
        {row.starlink > DISPLAY_CAP && (
          <span style={{ color: "#86868b", fontSize: 10, marginLeft: 4 }}>
            (capped at {DISPLAY_CAP} in chart)
          </span>
        )}
      </div>
      <div style={{ color: "#00c8d7", marginTop: 2 }}>
        With Game Mode: <strong>{row.gameMode} ms</strong>
      </div>
    </div>
  );
};

export default function StarlinkPingChart({ samples }) {
  const [windowMin, setWindowMin] = useState(5);

  // Slice to the selected time window
  const visible = useMemo(() => {
    if (!samples.length) return samples;
    const cutoff = new Date(Date.now() - windowMin * 60 * 1000);
    const sliced = samples.filter((s) => {
      const ts = s.ts instanceof Date ? s.ts : new Date(s.ts);
      return ts >= cutoff;
    });
    return sliced.length >= 2 ? sliced : samples.slice(-2);
  }, [samples, windowMin]);

  const { data, stats } = useMemo(() => buildChartData(visible), [visible]);

  const pingColor =
    !stats           ? "#86868b"
    : stats.current < 50  ? "var(--green)"
    : stats.current < 100 ? "var(--teal)"
    : stats.current < 200 ? "var(--orange)"
    : "var(--red)";

  // ~6 evenly-spaced X labels across the window
  const tickInterval = Math.max(1, Math.floor(data.length / 6));

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
            Measured from your browser every 2 s
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* Time window picker */}
          <div style={{ display: "flex", gap: 4 }}>
            {TIME_WINDOWS.map(({ label, minutes }) => (
              <button
                key={label}
                onClick={() => setWindowMin(minutes)}
                style={{
                  padding: "3px 10px",
                  borderRadius: 99,
                  border: "1px solid",
                  borderColor: windowMin === minutes ? "var(--teal)" : "var(--border)",
                  background: windowMin === minutes ? "rgba(0,200,215,0.12)" : "transparent",
                  color: windowMin === minutes ? "var(--teal)" : "var(--dim)",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Current ping */}
          {stats && (
            <div style={{ textAlign: "right", lineHeight: 1 }}>
              <span style={{ fontSize: 36, fontWeight: 800, color: pingColor }}>
                {stats.current}
              </span>
              <span style={{ fontSize: 13, color: "var(--dim)", marginLeft: 4 }}>ms</span>
            </div>
          )}
        </div>
      </div>

      {/* Stats row */}
      {stats && (
        <div style={{ display: "flex", gap: 20, marginBottom: 12, flexWrap: "wrap" }}>
          <StatPill label="Avg" value={`${stats.avg} ms`} />
          <StatPill
            label="Jitter"
            value={`±${stats.jitter} ms`}
            color={stats.jitter > 15 ? "var(--orange)" : "var(--white)"}
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
                <stop offset="95%" stopColor="#ff9f0a" stopOpacity={0}    />
              </linearGradient>
              <linearGradient id="gm-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#00c8d7" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#00c8d7" stopOpacity={0}   />
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
              domain={[0, DISPLAY_CAP + 10]}
              allowDataOverflow
            />
            <Tooltip content={<CustomTooltip />} />

            {/* Unplayable threshold */}
            <ReferenceLine
              y={DISPLAY_CAP}
              stroke="rgba(255,69,58,0.3)"
              strokeDasharray="6 4"
              label={{
                value: "Unplayable",
                position: "insideTopRight",
                fill: "rgba(255,69,58,0.5)",
                fontSize: 10,
                fontWeight: 600,
              }}
            />

            {/* Red verticals only for genuine handoff-level spikes (>300 ms) */}
            {data
              .filter((d) => d.isHandoff)
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
              dataKey="starlinkViz"
              name="Starlink"
              stroke="#ff9f0a"
              strokeWidth={2}
              fill="url(#sl-grad)"
              dot={false}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="gameModeViz"
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
