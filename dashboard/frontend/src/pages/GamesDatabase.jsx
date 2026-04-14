import { useEffect, useState } from "react";

const PLATFORMS = ["PC", "PlayStation", "Xbox", "Mobile", "Nintendo Switch", "Other"];

export default function GamesDatabase() {
  const [games, setGames] = useState([]);
  const [stats, setStats] = useState(null);
  const [requests, setRequests] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ game_name: "", platform: "", website: "", notes: "", submitted_email: "" });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [votedIds, setVotedIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem("aj_voted") || "[]"); } catch { return []; }
  });

  useEffect(() => {
    fetch("/api/games").then(r => r.json()).then(setGames).catch(() => {});
    fetch("/api/games/stats").then(r => r.json()).then(setStats).catch(() => {});
    fetch("/api/games/requests").then(r => r.json()).then(setRequests).catch(() => {});
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.game_name.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/games/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.status === 409) {
        setError("A request for this game already exists — upvote it below instead.");
        setSubmitting(false);
        return;
      }
      if (!res.ok) throw new Error();
      const newReq = await res.json();
      setRequests(prev => [newReq, ...prev]);
      setSubmitted(true);
      setShowForm(false);
      setForm({ game_name: "", platform: "", website: "", notes: "", submitted_email: "" });
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setSubmitting(false);
  }

  async function handleVote(id) {
    if (votedIds.includes(id)) return;
    try {
      const res = await fetch(`/api/games/requests/${id}/vote`, { method: "POST" });
      const data = await res.json();
      setRequests(prev => prev.map(r => r.id === id ? { ...r, votes: data.votes } : r));
      const next = [...votedIds, id];
      setVotedIds(next);
      localStorage.setItem("aj_voted", JSON.stringify(next));
    } catch {}
  }

  const fmtSynced = (ts) => {
    if (!ts) return "never";
    const d = new Date(ts);
    const hrs = Math.floor((Date.now() - d) / 3600000);
    if (hrs < 1) return "just now";
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--black)", color: "var(--white)", fontFamily: "'Mona Sans', sans-serif" }}>

      {/* Nav */}
      <header style={{ padding: "16px 32px", borderBottom: "1px solid var(--border)", background: "var(--surface)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <a href="/" style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.5px", textDecoration: "none", color: "var(--white)" }}>
          Antí<span style={{ color: "var(--teal)" }}>Jitter</span>
        </a>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <a href="/jitter-test" style={{ fontSize: 13, color: "var(--dim)", textDecoration: "none" }}>Free Test</a>
          <a href="/login" style={{ fontSize: 13, color: "var(--dim)", textDecoration: "none" }}>Login</a>
          <a href="/register" style={{ fontSize: 13, padding: "6px 16px", background: "var(--teal)", color: "#000", borderRadius: 99, fontWeight: 700, textDecoration: "none" }}>Get Started</a>
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 24px" }}>

        {/* Hero */}
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <h1 style={{ fontSize: 40, fontWeight: 800, margin: 0, letterSpacing: "-1px" }}>
            Game Coverage <span style={{ color: "var(--teal)" }}>Database</span>
          </h1>
          <p style={{ color: "var(--dim)", fontSize: 16, marginTop: 12, marginBottom: 0 }}>
            AntiJitter auto-routes only your game traffic — never your Netflix or YouTube.
          </p>

          {/* Live stats */}
          {stats && (
            <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 24, flexWrap: "wrap" }}>
              <StatBadge value={stats.game_count} label="games protected" />
              <StatBadge value={stats.range_count.toLocaleString()} label="IP ranges covered" />
              <StatBadge value={fmtSynced(stats.last_synced)} label="last synced" />
            </div>
          )}
        </div>

        {/* Games grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14, marginBottom: 56 }}>
          {games.map(game => (
            <GameCard key={game.id} game={game} fmtSynced={fmtSynced} />
          ))}
          {games.length === 0 && (
            <div style={{ gridColumn: "1/-1", textAlign: "center", color: "var(--dim)", padding: 48 }}>
              Loading game database…
            </div>
          )}
        </div>

        {/* How it works blurb */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 24px", marginBottom: 48 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 700, color: "var(--white)" }}>How the database stays current</h3>
          <p style={{ margin: 0, fontSize: 13, color: "var(--dim)", lineHeight: 1.6 }}>
            Each game publisher operates dedicated server infrastructure registered under an AS Number (ASN).
            AntiJitter queries the <strong style={{ color: "var(--white)" }}>RIPE NCC database</strong> weekly to fetch every
            IP range announced by that ASN — so when Activision spins up new CoD servers in Frankfurt,
            we automatically include them. Your 4G data is never spent on traffic outside this list.
          </p>
        </div>

        {/* Requested games */}
        <div style={{ marginBottom: 48 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Request a Game</h2>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--dim)" }}>
                Don't see your game? Request it — we add new games based on community votes.
              </p>
            </div>
            <button
              onClick={() => { setShowForm(f => !f); setSubmitted(false); setError(""); }}
              style={{
                padding: "8px 20px", background: showForm ? "transparent" : "var(--teal)",
                color: showForm ? "var(--dim)" : "#000", border: "1px solid",
                borderColor: showForm ? "var(--border)" : "var(--teal)",
                borderRadius: 99, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              {showForm ? "Cancel" : "+ Request a game"}
            </button>
          </div>

          {/* Submission form */}
          {showForm && (
            <form onSubmit={handleSubmit} style={{ background: "var(--surface)", border: "1px solid var(--teal)", borderRadius: 12, padding: "20px 24px", marginBottom: 20 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>Game name *</label>
                  <input
                    required value={form.game_name} onChange={e => setForm(f => ({ ...f, game_name: e.target.value }))}
                    placeholder="e.g. Rocket League" style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Platform</label>
                  <select value={form.platform} onChange={e => setForm(f => ({ ...f, platform: e.target.value }))} style={inputStyle}>
                    <option value="">Select platform…</option>
                    {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Game website (helps us find their servers)</label>
                <input
                  value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))}
                  placeholder="https://…" style={inputStyle}
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Notes (optional)</label>
                <textarea
                  value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Any extra context about servers, regions, etc." rows={2}
                  style={{ ...inputStyle, resize: "vertical" }}
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Your email (optional — we'll notify you when it's added)</label>
                <input
                  type="email" value={form.submitted_email} onChange={e => setForm(f => ({ ...f, submitted_email: e.target.value }))}
                  placeholder="you@example.com" style={inputStyle}
                />
              </div>
              {error && <p style={{ color: "var(--orange)", fontSize: 13, margin: "0 0 12px" }}>{error}</p>}
              <button
                type="submit" disabled={submitting}
                style={{ padding: "9px 24px", background: "var(--teal)", color: "#000", border: "none", borderRadius: 99, fontSize: 13, fontWeight: 700, cursor: submitting ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: submitting ? 0.6 : 1 }}
              >
                {submitting ? "Submitting…" : "Submit request"}
              </button>
            </form>
          )}

          {submitted && (
            <div style={{ background: "rgba(48,209,88,0.08)", border: "1px solid var(--green)", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "var(--green)" }}>
              Request submitted — thank you! Upvote others below to show what the community wants most.
            </div>
          )}

          {/* Requests list */}
          {requests.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {requests.map(req => (
                <RequestRow key={req.id} req={req} voted={votedIds.includes(req.id)} onVote={() => handleVote(req.id)} />
              ))}
            </div>
          ) : (
            <div style={{ textAlign: "center", color: "var(--dim)", fontSize: 13, padding: "32px 0" }}>
              No pending requests yet — be the first to request your game.
            </div>
          )}
        </div>

      </main>
    </div>
  );
}

function GameCard({ game, fmtSynced }) {
  const regionColors = { EU: "var(--teal)", NA: "var(--blue)", APAC: "var(--purple)", Global: "var(--green)" };
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 24 }}>{game.icon}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{game.name}</div>
            {game.asn && <div style={{ fontSize: 11, color: "var(--dim)", marginTop: 1 }}>{game.asn}</div>}
          </div>
        </div>
        <span style={{ fontSize: 11, color: "var(--green)", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)", display: "inline-block" }} />
          Live
        </span>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {(game.regions || []).map(r => (
          <span key={r} style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99, border: `1px solid ${regionColors[r] || "var(--dim)"}`, color: regionColors[r] || "var(--dim)" }}>
            {r}
          </span>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--dim)" }}>
        <span><strong style={{ color: "var(--white)" }}>{game.range_count > 0 ? game.range_count.toLocaleString() : "—"}</strong> IP ranges</span>
        <span>synced {fmtSynced(game.last_synced)}</span>
      </div>
    </div>
  );
}

function RequestRow({ req, voted, onVote }) {
  const statusColor = { pending: "var(--dim)", in_review: "var(--orange)", added: "var(--green)" };
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
      <div style={{ flex: 1 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{req.game_name}</span>
        {req.platform && <span style={{ fontSize: 12, color: "var(--dim)", marginLeft: 10 }}>{req.platform}</span>}
        {req.notes && <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--dim)" }}>{req.notes}</p>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 11, color: statusColor[req.status] || "var(--dim)", fontWeight: 600, textTransform: "capitalize" }}>
          {req.status.replace("_", " ")}
        </span>
        <button
          onClick={onVote} disabled={voted}
          style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
            padding: "6px 12px", borderRadius: 8, border: "1px solid",
            borderColor: voted ? "var(--teal)" : "var(--border)",
            background: voted ? "rgba(0,200,215,0.08)" : "transparent",
            color: voted ? "var(--teal)" : "var(--dim)",
            cursor: voted ? "default" : "pointer", fontFamily: "inherit",
          }}
        >
          <span style={{ fontSize: 14 }}>▲</span>
          <span style={{ fontSize: 12, fontWeight: 700 }}>{req.votes}</span>
        </button>
      </div>
    </div>
  );
}

function StatBadge({ value, label }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 20px", textAlign: "center" }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: "var(--teal)" }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--dim)", marginTop: 2 }}>{label}</div>
    </div>
  );
}

const labelStyle = { display: "block", fontSize: 11, color: "var(--dim)", marginBottom: 5, fontWeight: 600 };
const inputStyle = {
  width: "100%", boxSizing: "border-box",
  background: "#0a0a0a", border: "1px solid var(--border)", borderRadius: 8,
  color: "var(--white)", padding: "8px 12px", fontSize: 13, fontFamily: "inherit",
  outline: "none",
};
