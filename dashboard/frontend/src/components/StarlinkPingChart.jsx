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

const DISPLAY_CAP     = 200;
const HANDOFF_ABS_MIN = 300;
const BASELINE_WINDOW = 90;
const BASELINE_PCT    = 0.20;
const MIN_BASELINE_SAMPLES = 3;
// Game Mode cap = baseline * this. ~10% overhead is realistic for an extra
// encrypted hop through the bonding server.
const GAME_MODE_OVERHEAD = 1.10;
// Only flag a point as a spike on the chart once it's this much above the
// floor — used for handoff markers, not for the simulated line.
const SPIKE_MULT      = 4;
const SPIKE_ABS_MIN   = 100;

// Switch to bucket mode once there are more raw points than this
const RAW_MAX = 150;

const TIME_WINDOWS = [
  { label: "2m",  minutes: 2  },
  { label: "5m",  minutes: 5  },
  { label: "15m", minutes: 15 },
  { label: "1h",  minutes: 60 },
];

// ─── Raw mode (≤150 pts) ─────────────────────────────────────────────────────
// Spike detection + Game Mode simulation per individual sample.
function buildRawData(samples) {
  if (!samples.length) return { data: [], stats: null, bucketed: false };

  // Seed a global floor from the whole sample set so early points already get
  // a meaningful Game Mode cap instead of overlapping until enough history
  // accumulates. Real bonding delivers min(path_latencies) continuously —
  // the simulation should reflect that from the first sample.
  const allSortedMs = samples.map((s) => s.latency_ms).sort((a, b) => a - b);
  const globalFloor = allSortedMs.length
    ? allSortedMs[Math.floor(allSortedMs.length * BASELINE_PCT)]
    : null;

  const data = samples.map((s, i) => {
    const win = samples
      .slice(Math.max(0, i - BASELINE_WINDOW), i)
      .map((x) => x.latency_ms)
      .sort((a, b) => a - b);
    const localBaseline =
      win.length >= MIN_BASELINE_SAMPLES ? win[Math.floor(win.length * BASELINE_PCT)] : null;
    // Prefer the trailing window so the line reacts to recent changes, but
    // fall back to the full-sample floor before we have enough history.
    const baseline = localBaseline ?? globalFloor;

    const isSpike =
      baseline !== null &&
      s.latency_ms > baseline * SPIKE_MULT &&
      s.latency_ms > SPIKE_ABS_MIN;
    const isHandoff = isSpike && s.latency_ms > HANDOFF_ABS_MIN;

    // Game Mode always caps at floor + overhead — min(starlink, cap). During
    // quiet times starlink <= cap so lines overlap; during any elevation
    // starlink > cap and the teal line visibly diverges below.
    const gameMode =
      baseline != null
        ? Math.min(s.latency_ms, baseline * GAME_MODE_OVERHEAD)
        : s.latency_ms;

    const starlink   = Math.round(s.latency_ms * 10) / 10;
    const gm         = Math.round(gameMode    * 10) / 10;

    return {
      time:        s.ts instanceof Date ? s.ts : new Date(s.ts),
      starlink, gameMode: gm, isSpike, isHandoff,
      starlinkViz: Math.min(starlink, DISPLAY_CAP),
      gameModeViz: Math.min(gm,       DISPLAY_CAP),
    };
  });

  const quietVals = data.filter((d) => !d.isSpike).map((d) => d.starlink);
  const sv = quietVals.length >= 4 ? quietVals : data.map((d) => d.starlink);
  const avg = sv.reduce((a, b) => a + b, 0) / sv.length;
  const jitter = Math.sqrt(sv.reduce((s, v) => s + (v - avg) ** 2, 0) / sv.length);

  return {
    data, bucketed: false,
    stats: {
      current:  Math.round(data[data.length - 1].starlink * 10) / 10,
      avg:      Math.round(avg    * 10) / 10,
      jitter:   Math.round(jitter * 10) / 10,
      handoffs: data.filter((d) => d.isHandoff).length,
      samples:  data.length,
    },
  };
}

// ─── Bucket mode (>150 pts) ──────────────────────────────────────────────────
// Each bucket shows p75 for Starlink (elevated moments) and p25 for Game Mode
// (the steady floor bonding would maintain). No spike detection needed —
// the percentile gap IS the comparison.
function buildBucketData(samples, bucketCount = RAW_MAX) {
  if (!samples.length) return { data: [], stats: null, bucketed: true };

  const bSize = samples.length / bucketCount;

  const data = Array.from({ length: bucketCount }, (_, i) => {
    const start  = Math.floor(i * bSize);
    const end    = Math.floor((i + 1) * bSize);
    const bucket = samples.slice(start, end);
    const sorted = [...bucket].map((s) => s.latency_ms).sort((a, b) => a - b);
    const n = sorted.length;

    const p25 = sorted[Math.floor(n * 0.25)];
    const p50 = sorted[Math.floor(n * 0.50)];
    const p75 = sorted[Math.floor(n * 0.75)];

    const sl = Math.min(Math.round(p75 * 10) / 10, DISPLAY_CAP);
    const gm = Math.min(Math.round(p25 * 10) / 10, DISPLAY_CAP);

    return {
      time:        bucket[Math.floor(n / 2)].ts instanceof Date
                     ? bucket[Math.floor(n / 2)].ts
                     : new Date(bucket[Math.floor(n / 2)].ts),
      starlink:    Math.round(p75 * 10) / 10,   // real value for tooltip
      gameMode:    Math.round(p25 * 10) / 10,
      median:      Math.round(p50 * 10) / 10,
      starlinkViz: sl,
      gameModeViz: gm,
      isSpike: false, isHandoff: false,
    };
  });

  // Stats from all raw samples (accurate, not from buckets)
  const allVals = samples.map((s) => s.latency_ms).sort((a, b) => a - b);
  const n = allVals.length;
  const median = allVals[Math.floor(n * 0.5)];
  const iqr    = allVals[Math.floor(n * 0.75)] - allVals[Math.floor(n * 0.25)];

  return {
    data, bucketed: true,
    stats: {
      current:  Math.round(samples[samples.length - 1].latency_ms * 10) / 10,
      avg:      Math.round(median * 10) / 10,
      jitter:   Math.round((iqr / 2)   * 10) / 10,   // half-IQR ≈ median absolute deviation
      handoffs: null,   // not meaningful in bucket view
      samples:  n,
    },
  };
}

function fmtTime(ts) {
  if (!ts) return "";
  const d = ts instanceof Date ? ts : new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const RawTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div style={{ background: "#1c1c1e", border: "1px solid #333", borderRadius: 8, padding: "10px 14px", fontSize: 12 }}>
      {row.time && <div style={{ color: "#86868b", marginBottom: 4 }}>{fmtTime(row.time)}</div>}
      <div style={{ color: "#ff9f0a", marginTop: 2 }}>
        Starlink: <strong>{row.starlink} ms</strong>
        {row.starlink > DISPLAY_CAP && <span style={{ color: "#86868b", fontSize: 10, marginLeft: 4 }}>(capped at {DISPLAY_CAP})</span>}
      </div>
      <div style={{ color: "#00c8d7", marginTop: 2 }}>
        With Game Mode: <strong>{row.gameMode} ms</strong>
      </div>
    </div>
  );
};

const BucketTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div style={{ background: "#1c1c1e", border: "1px solid #333", borderRadius: 8, padding: "10px 14px", fontSize: 12 }}>
      {row.time && <div style={{ color: "#86868b", marginBottom: 4 }}>{fmtTime(row.time)}</div>}
      <div style={{ color: "#ff9f0a", marginTop: 2 }}>
        Starlink p75: <strong>{row.starlink} ms</strong>
      </div>
      <div style={{ color: "#86868b", marginTop: 1, fontSize: 11 }}>
        Median: {row.median} ms
      </div>
      <div style={{ color: "#00c8d7", marginTop: 2 }}>
        Game Mode p25: <strong>{row.gameMode} ms</strong>
      </div>
    </div>
  );
};

export default function StarlinkPingChart({ samples }) {
  const [windowMin, setWindowMin] = useState(5);

  const visible = useMemo(() => {
    if (!samples.length) return samples;
    const cutoff = new Date(Date.now() - windowMin * 60 * 1000);
    const sliced = samples.filter((s) => {
      const ts = s.ts instanceof Date ? s.ts : new Date(s.ts);
      return ts >= cutoff;
    });
    return sliced.length >= 2 ? sliced : samples.slice(-2);
  }, [samples, windowMin]);

  const { data, stats, bucketed } = useMemo(
    () => visible.length > RAW_MAX
      ? buildBucketData(visible, RAW_MAX)
      : buildRawData(visible),
    [visible],
  );

  const pingColor =
    !stats           ? "#86868b"
    : stats.current < 50  ? "var(--green)"
    : stats.current < 100 ? "var(--teal)"
    : stats.current < 200 ? "var(--orange)"
    : "var(--red)";

  const tickInterval = Math.max(1, Math.floor(data.length / 6));

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 24px" }}>

      {/* Header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        gap: 12, flexWrap: "wrap", marginBottom: 6,
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--white)", margin: 0 }}>
          Starlink Latency
        </h3>

        <div style={{ display: "flex", alignItems: "center", gap: 16, marginLeft: "auto" }}>
          <div style={{ display: "flex", gap: 4 }}>
            {TIME_WINDOWS.map(({ label, minutes }) => (
              <button key={label} onClick={() => setWindowMin(minutes)} style={{
                padding: "3px 10px", borderRadius: 99, border: "1px solid",
                borderColor: windowMin === minutes ? "var(--teal)" : "var(--border)",
                background:  windowMin === minutes ? "rgba(0,200,215,0.12)" : "transparent",
                color:       windowMin === minutes ? "var(--teal)" : "var(--dim)",
                fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              }}>
                {label}
              </button>
            ))}
          </div>

          {stats && (
            <div style={{ textAlign: "right", lineHeight: 1 }}>
              <span style={{ fontSize: 36, fontWeight: 800, color: pingColor }}>{stats.current}</span>
              <span style={{ fontSize: 13, color: "var(--dim)", marginLeft: 4 }}>ms</span>
            </div>
          )}
        </div>
      </div>

      <p style={{ fontSize: 11, color: "var(--dim)", margin: "0 0 12px 0" }}>
        {bucketed
          ? "Showing percentile bands per interval — orange = p75, teal = p25"
          : "Measured from your browser every 2 s"}
      </p>

      {/* Stats */}
      {stats && (() => {
        const lowConfidence = stats.samples < 8;
        const linesOverlap = !bucketed && data.length > 0 && data.every(
          (d) => Math.abs(d.starlink - d.gameMode) < 0.05,
        );
        return (
          <>
            <div style={{ display: "flex", gap: 20, marginBottom: 6, flexWrap: "wrap" }}>
              <StatPill label={bucketed ? "Median" : "Avg"} value={`${stats.avg} ms`} />
              <StatPill
                label="Jitter"
                value={lowConfidence ? "—" : `±${stats.jitter} ms`}
                color={lowConfidence ? "var(--dim)" : (stats.jitter > 15 ? "var(--orange)" : "var(--white)")}
              />
              {!bucketed && (
                <StatPill
                  label="Handoffs"
                  value={stats.handoffs}
                  color={stats.handoffs > 0 ? "var(--red)" : "var(--dim)"}
                />
              )}
              <StatPill label="Samples" value={stats.samples.toLocaleString()} />
            </div>
            {lowConfidence && (
              <p style={{ fontSize: 11, color: "var(--dim)", margin: "0 0 10px 0", fontStyle: "italic" }}>
                Collecting samples — jitter shown once we have at least 8.
              </p>
            )}

            {/* Legend */}
            <div style={{ display: "flex", gap: 16, marginBottom: 8, flexWrap: "wrap" }}>
              <LegendItem color="#ff9f0a" label={bucketed ? "Starlink (p75)" : "Starlink"} />
              <LegendItem color="var(--teal)" label={bucketed ? "Game Mode (p25)" : "With Game Mode"} dashed />
              {!bucketed && stats?.handoffs > 0 && (
                <span style={{ fontSize: 11, color: "#ff453a", display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ display: "inline-block", width: 12, borderTop: "1.5px dashed #ff453a" }} />
                  Satellite handoff
                </span>
              )}
            </div>

            {linesOverlap && !lowConfidence && (
              <p style={{ fontSize: 11, color: "var(--dim)", margin: "0 0 8px 0", fontStyle: "italic" }}>
                Lines overlap when there are no spikes — Game Mode diverges during latency peaks.
              </p>
            )}
          </>
        );
      })()}

      {data.length === 0 ? (
        <div style={{ height: 240, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--dim)", fontSize: 13 }}>
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
                <stop offset="5%"  stopColor="#00c8d7" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#00c8d7" stopOpacity={0}    />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" />
            <XAxis dataKey="time" tickFormatter={fmtTime} tick={{ fill: "#86868b", fontSize: 10 }} interval={tickInterval} />
            <YAxis tick={{ fill: "#86868b", fontSize: 11 }} tickFormatter={(v) => `${v}ms`} domain={[0, DISPLAY_CAP + 10]} allowDataOverflow />
            <Tooltip content={bucketed ? <BucketTooltip /> : <RawTooltip />} />

            <ReferenceLine
              y={DISPLAY_CAP}
              stroke="rgba(255,69,58,0.3)"
              strokeDasharray="6 4"
              label={{ value: "Unplayable", position: "insideTopRight", fill: "rgba(255,69,58,0.5)", fontSize: 10, fontWeight: 600 }}
            />

            {!bucketed && data.filter((d) => d.isHandoff).map((d, i) => (
              <ReferenceLine key={i} x={d.time} stroke="#ff453a" strokeWidth={1} strokeDasharray="4 3" />
            ))}

            <Area type="monotone" dataKey="starlinkViz" name="Starlink"
              stroke="#ff9f0a" strokeWidth={2} fill="url(#sl-grad)" dot={false} isAnimationActive={false} />
            <Area type="monotone" dataKey="gameModeViz" name="With Game Mode"
              stroke="#00c8d7" strokeWidth={1.5} strokeDasharray="6 3" fill="url(#gm-grad)" dot={false} isAnimationActive={false} />
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
      {dashed
        ? <span style={{ display: "inline-block", width: 20, borderTop: `2px dashed ${color}` }} />
        : <span style={{ display: "inline-block", width: 12, height: 8, background: color, borderRadius: 2, opacity: 0.8 }} />
      }
      {label}
    </span>
  );
}
