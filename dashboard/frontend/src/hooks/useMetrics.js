import { useCallback, useEffect, useRef, useState } from "react";

const MAX_HISTORY = 120; // 60 seconds at 0.5s intervals
const API = "";          // proxied via Vite in dev, same-origin in prod

export function useMetrics() {
  const [history, setHistory] = useState([]);
  const [status, setStatus] = useState(null);
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);

  // WebSocket for real-time chart data
  useEffect(() => {
    function connect() {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${window.location.host}/ws/metrics`);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        setTimeout(connect, 2000); // auto-reconnect
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
  }, []);

  // Poll REST status + events every 2 seconds
  const fetchStatus = useCallback(async () => {
    try {
      const [s, e] = await Promise.all([
        fetch(`${API}/api/status`).then((r) => r.json()),
        fetch(`${API}/api/events`).then((r) => r.json()),
      ]);
      setStatus(s);
      setEvents(e.events);
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
