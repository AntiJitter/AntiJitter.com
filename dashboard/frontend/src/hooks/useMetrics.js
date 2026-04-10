import { useCallback, useEffect, useRef, useState } from "react";

const MAX_HISTORY = 120; // 60 seconds at 0.5 s intervals
const API = "";          // proxied via Vite in dev, same-origin in prod

export function useMetrics(token = null) {
  const [history, setHistory] = useState([]);
  const [status, setStatus] = useState(null);
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const prevEventsRef = useRef([]);

  // WebSocket — passes token so backend can log the session
  useEffect(() => {
    function connect() {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const qs = token ? `?token=${encodeURIComponent(token)}` : "";
      const ws = new WebSocket(`${proto}://${window.location.host}/ws/metrics${qs}`);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        setTimeout(connect, 2000);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (e) => {
        const point = JSON.parse(e.data);
        setHistory((prev) => {
          const next = [...prev, point];
          return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
        });
      };
    }
    connect();
    return () => wsRef.current?.close();
  }, [token]);

  // Poll REST status + events every 2 s
  const fetchStatus = useCallback(async () => {
    try {
      const [s, e] = await Promise.all([
        fetch(`${API}/api/status`).then((r) => r.json()),
        fetch(`${API}/api/events`).then((r) => r.json()),
      ]);
      setStatus(s);

      // Fire Electron tray notifications for new failover events
      const incoming = e.events ?? [];
      const prev = prevEventsRef.current;
      if (incoming.length > prev.length && window.electronAPI) {
        const newest = incoming[0];
        window.electronAPI.notifyFailover({
          before: newest.latency_before_ms,
          to: newest.to,
          after: newest.latency_after_ms,
          saved: newest.saved_ms,
        });
      }
      prevEventsRef.current = incoming;
      setEvents(incoming);
    } catch {
      // backend not yet ready
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 2000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  return { history, status, events, connected };
}
