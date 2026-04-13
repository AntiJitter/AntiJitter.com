import { useCallback, useEffect, useRef, useState } from "react";
import { useApiFetch } from "../contexts/AuthContext";

const PING_INTERVAL_MS = 2000;
const BATCH_INTERVAL_MS = 30_000;
// Max samples kept in local state (1 h at 2 s/sample = 1800)
const MAX_LOCAL_SAMPLES = 1800;
// Max total samples kept in the ref buffer (24 h = 43200)
const MAX_REF_SAMPLES = 43_200;

export function usePingLogger() {
  const apiFetch = useApiFetch();
  const [samples, setSamples] = useState([]);
  const allRef = useRef([]);      // full ring buffer, never triggers renders
  const batchRef = useRef([]);    // pending to send

  // Load last 2 h of history from the server on mount
  useEffect(() => {
    apiFetch("/api/ping/history?hours=2")
      .then((r) => r.json())
      .then((data) => {
        if (!data.samples?.length) return;
        const loaded = data.samples.map((s) => ({
          ts: new Date(s.ts),
          latency_ms: s.latency_ms,
        }));
        allRef.current = loaded;
        setSamples(loaded.slice(-MAX_LOCAL_SAMPLES));
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Continuous ping loop — runs independently of auth token refreshes
  const pingOnce = useCallback(async () => {
    const start = performance.now();
    try {
      await fetch("/api/ping");
      const ms = Math.round((performance.now() - start) * 10) / 10;
      const sample = { ts: new Date(), latency_ms: ms };

      allRef.current = [...allRef.current, sample].slice(-MAX_REF_SAMPLES);
      batchRef.current.push(sample);
      setSamples((prev) => [...prev, sample].slice(-MAX_LOCAL_SAMPLES));
    } catch (_) {}
  }, []);

  useEffect(() => {
    let timerId;
    let alive = true;

    async function loop() {
      if (!alive) return;
      await pingOnce();
      if (alive) timerId = setTimeout(loop, PING_INTERVAL_MS);
    }

    // Small delay so the component finishes mounting first
    timerId = setTimeout(loop, 500);
    return () => {
      alive = false;
      clearTimeout(timerId);
    };
  }, [pingOnce]);

  // Batch-send every 30 s
  useEffect(() => {
    const interval = setInterval(async () => {
      const batch = batchRef.current.splice(0);
      if (!batch.length) return;
      try {
        await apiFetch("/api/ping/log", {
          method: "POST",
          body: JSON.stringify({
            samples: batch.map((s) => ({
              ts: s.ts.toISOString(),
              latency_ms: s.latency_ms,
            })),
          }),
        });
      } catch (_) {
        // Put them back so they are retried next cycle
        batchRef.current = [...batch, ...batchRef.current];
      }
    }, BATCH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [apiFetch]);

  return { samples };
}
