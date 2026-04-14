import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import PublicNav from "../components/PublicNav";

const PING_URL = "/api/ping";
const INTERVAL_MS = 600;
const TEST_DURATION = 60; // seconds
const MAX_BARS = 90;
const SPIKE_THRESHOLD = 2.5; // × baseline
const BASELINE_SAMPLES = 8;

function jitter(arr) {
  if (arr.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < arr.length; i++) sum += Math.abs(arr[i] - arr[i - 1]);
  return Math.round(sum / (arr.length - 1));
}

function grade(j) {
  if (j < 5)  return { label: "Excellent", color: "#30d158", detail: "Your Starlink is performing well. No action needed." };
  if (j < 15) return { label: "Good",      color: "#00c8d7", detail: "Mild jitter. Acceptable for most gaming — but spikes can still disconnect you." };
  if (j < 30) return { label: "High",      color: "#ff9f0a", detail: "Noticeable lag spikes. Satellite handoffs are affecting your gaming." };
  return       { label: "Severe",           color: "#ff453a", detail: "Severe jitter. Every handoff will lag or disconnect you mid-game." };
}

async function measurePing() {
  try {
    const t0 = performance.now();
    await fetch(PING_URL, { cache: "no-store" });
    return Math.round(performance.now() - t0);
  } catch {
    return null;
  }
}

export default function JitterTest() {
  const [phase, setPhase] = useState("idle"); // idle | warmup | running | done
  const [readings, setReadings] = useState([]);
  const [current, setCurrent] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [spikes, setSpikes] = useState(0);
  const timerRef = useRef(null);
  const baselineRef = useRef(null);
  const spikesRef = useRef(0);
  const readingsRef = useRef([]);

  function stop() {
    clearInterval(timerRef.current);
    setPhase("done");
  }

  async function start() {
    setPhase("warmup");
    setReadings([]);
    setCurrent(null);
    setElapsed(0);
    setSpikes(0);
    spikesRef.current = 0;
    readingsRef.current = [];
    baselineRef.current = null;

    // Warmup — pre-warm the connection so first real ping isn't inflated by TLS
    await measurePing();
    await measurePing();

    const startTs = Date.now();
    setPhase("running");

    timerRef.current = setInterval(async () => {
      const ms = await measurePing();
      if (ms === null) return;

      readingsRef.current = [...readingsRef.current, ms];
      const arr = readingsRef.current;

      // Establish baseline after N samples
      if (arr.length === BASELINE_SAMPLES) {
        baselineRef.current = arr.reduce((a, b) => a + b, 0) / arr.length;
      }

      // Spike detection
      if (baselineRef.current && ms > baselineRef.current * SPIKE_THRESHOLD) {
        spikesRef.current += 1;
        setSpikes(spikesRef.current);
      }

      setCurrent(ms);
      setReadings([...arr]);

      const secs = Math.round((Date.now() - startTs) / 1000);
      setElapsed(secs);

      if (secs >= TEST_DURATION) {
        clearInterval(timerRef.current);
        setPhase("done");
      }
    }, INTERVAL_MS);
  }

  useEffect(() => () => clearInterval(timerRef.current), []);

  const j = jitter(readings);
  const g = grade(j);
  const maxMs = readings.length ? Math.max(...readings, 100) : 100;
  const baseline = baselineRef.current;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#f5f5f7", fontFamily: "'Mona Sans', system-ui, sans-serif" }}>

      <PublicNav />

      <div style={{ maxWidth: 700, margin: "0 auto", padding: "20px 24px" }}>

        {/* Title + ping side by side */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: "clamp(22px,4vw,32px)", fontWeight: 800, letterSpacing: "-1px", margin: 0 }}>
              Starlink Jitter Test
            </h1>
            <p style={{ fontSize: 13, color: "#86868b", marginTop: 4, marginBottom: 0 }}>
              Free · No account needed · Handoffs show as spikes
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{
              fontSize: "clamp(52px,10vw,80px)",
              fontWeight: 800,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-3px",
              lineHeight: 1,
              color: current == null ? "#2a2a2a"
                : current < 80 ? "#30d158"
                : current < 150 ? "#ff9f0a" : "#ff453a",
              transition: "color 0.3s",
            }}>
              {current ?? "—"}
            </div>
            <div style={{ fontSize: 12, color: "#86868b", marginTop: 2 }}>ms</div>
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14, background: "#111", border: "1px solid #1e1e1e", borderRadius: 10, padding: "10px 20px" }}>
          <Stat label="Jitter" value={readings.length > 1 ? `${j} ms` : "—"} color={readings.length > 1 ? g.color : undefined} />
          <Stat label="Spikes" value={phase === "idle" ? "—" : spikes} color={spikes > 0 ? "#ff453a" : undefined} />
          <Stat label="Avg ping" value={readings.length ? `${Math.round(readings.reduce((a,b)=>a+b,0)/readings.length)} ms` : "—"} />
          <Stat label="Samples" value={readings.length || "—"} />
        </div>

        {/* Live chart */}
        <div style={{
          background: "#111", border: "1px solid #1e1e1e", borderRadius: 12,
          padding: "12px", marginBottom: 12, height: 120,
          display: "flex", alignItems: "flex-end", gap: 2, overflow: "hidden",
          position: "relative",
        }}>
          {/* Baseline marker */}
          {baseline && (
            <div style={{
              position: "absolute",
              bottom: 12 + (baseline / maxMs) * (120 - 24),
              left: 12, right: 12,
              borderTop: "1px dashed rgba(0,200,215,0.4)",
              pointerEvents: "none",
            }}>
              <span style={{ fontSize: 9, color: "rgba(0,200,215,0.5)", paddingLeft: 4 }}>
                baseline {Math.round(baseline)}ms
              </span>
            </div>
          )}

          {readings.length === 0 && (
            <div style={{
              position: "absolute", inset: 0, display: "flex",
              alignItems: "center", justifyContent: "center",
              color: "#333", fontSize: 14,
            }}>
              {phase === "warmup" ? "Warming up connection…" : "Press Start Test to begin"}
            </div>
          )}

          {readings.slice(-MAX_BARS).map((ms, i, arr) => {
            const isSpike = baseline && ms > baseline * SPIKE_THRESHOLD;
            const h = Math.max(4, (ms / maxMs) * (120 - 24));
            const color = isSpike ? "#ff453a" : ms < 80 ? "#00c8d7" : ms < 150 ? "#ff9f0a" : "#ff453a";
            return (
              <div
                key={i}
                title={`${ms}ms`}
                style={{
                  flex: "1 0 0", maxWidth: 12,
                  height: h,
                  background: color,
                  borderRadius: "2px 2px 0 0",
                  opacity: i === arr.length - 1 ? 1 : 0.7,
                  transition: "height 0.2s",
                  boxShadow: isSpike ? `0 0 6px ${color}` : "none",
                }}
              />
            );
          })}
        </div>

        {/* Progress bar + button row */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
          {(phase === "running" || phase === "done") ? (
            <div style={{ flex: 1, background: "#1a1a1a", borderRadius: 99, height: 4, overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 99,
                background: phase === "done" ? "#30d158" : "#00c8d7",
                width: `${Math.min((elapsed / TEST_DURATION) * 100, 100)}%`,
                transition: "width 0.5s",
              }} />
            </div>
          ) : <div style={{ flex: 1 }} />}

          {phase !== "running" && phase !== "warmup" && (
            <button
              onClick={start}
              style={{
                background: "#00c8d7", color: "#000",
                border: "none", borderRadius: 99,
                padding: "12px 36px", fontSize: 15, fontWeight: 700,
                cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
              }}
            >
              {phase === "idle" ? "Start Test" : "Run Again"}
            </button>
          )}
          {phase === "warmup" && (
            <span style={{ fontSize: 13, color: "#86868b" }}>Warming up…</span>
          )}
        </div>

        {/* Results card */}
        {phase === "done" && readings.length > 4 && (
          <div style={{
            background: "#111",
            border: `1px solid ${g.color}40`,
            borderRadius: 14, padding: "28px 32px",
            marginBottom: 32,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
              <div style={{
                fontSize: 32, fontWeight: 800, color: g.color,
                fontVariantNumeric: "tabular-nums",
              }}>
                {j} ms
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: g.color }}>{g.label} jitter</div>
                <div style={{ fontSize: 12, color: "#86868b" }}>measured over {elapsed}s</div>
              </div>
            </div>

            <p style={{ fontSize: 14, color: "#86868b", lineHeight: 1.6, marginBottom: 20 }}>
              {g.detail}
              {spikes > 0 && (
                <> We detected <strong style={{ color: "#ff453a" }}>{spikes} satellite handoff{spikes !== 1 ? "s" : ""}</strong> — each one caused a lag spike in your games.</>
              )}
            </p>

            {j >= 5 && (
              <div style={{ borderTop: "1px solid #1e1e1e", paddingTop: 20 }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: "#f5f5f7", marginBottom: 12 }}>
                  AntiJitter eliminates this jitter in real-time
                </p>
                <p style={{ fontSize: 13, color: "#86868b", marginBottom: 16, lineHeight: 1.5 }}>
                  By bonding your Starlink with 4G/5G simultaneously, every satellite handoff
                  is covered by the backup connection. Your games see zero spikes.
                </p>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <Link
                    to="/register"
                    style={{
                      background: "#00c8d7", color: "#000",
                      borderRadius: 99, padding: "12px 28px",
                      fontWeight: 700, fontSize: 14, textDecoration: "none",
                    }}
                  >
                    Fix my jitter — 7 days free →
                  </Link>
                  <a
                    href="https://antijitter.com"
                    style={{
                      border: "1px solid #333", color: "#86868b",
                      borderRadius: 99, padding: "12px 28px",
                      fontSize: 14, textDecoration: "none",
                    }}
                  >
                    Learn more
                  </a>
                </div>
                <p style={{ fontSize: 12, color: "#444", marginTop: 10 }}>
                  $5/month after trial · Cancel anytime
                </p>
              </div>
            )}

            {j < 5 && (
              <p style={{ fontSize: 13, color: "#86868b" }}>
                Your Starlink looks great right now — but jitter varies. Run the test again
                during peak gaming hours or after bad weather.
              </p>
            )}
          </div>
        )}

        {/* What is jitter explainer — SEO content */}
        <div style={{ borderTop: "1px solid #1a1a1a", paddingTop: 40 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>What is Starlink jitter?</h2>
          <p style={{ fontSize: 15, color: "#86868b", lineHeight: 1.7, marginBottom: 20 }}>
            <strong style={{ color: "#f5f5f7" }}>Jitter</strong> is the variation in your ping over time.
            A ping of 40ms is fine for gaming. But if your ping bounces between 25ms and 400ms every 45 seconds,
            that variation — the jitter — causes rubber-banding, lag spikes, and disconnects.
          </p>
          <p style={{ fontSize: 15, color: "#86868b", lineHeight: 1.7, marginBottom: 20 }}>
            Starlink has <strong style={{ color: "#f5f5f7" }}>unusually high jitter</strong> compared to cable or fibre.
            The dish continuously switches between satellites as they orbit overhead. Each handoff takes
            milliseconds but causes a brief gap in coverage — which your games see as a spike.
          </p>
          <p style={{ fontSize: 15, color: "#86868b", lineHeight: 1.7 }}>
            <strong style={{ color: "#f5f5f7" }}>AntiJitter</strong> solves this by bonding your Starlink
            with a 4G or 5G connection simultaneously. When Starlink handoffs occur, 4G covers the gap
            with zero packet loss. Your games stay connected.
          </p>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: color ?? "#f5f5f7" }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}
