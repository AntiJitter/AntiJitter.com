import { Link, useLocation } from "react-router-dom";

export default function PublicNav() {
  const { pathname } = useLocation();
  const active = (path) => pathname === path;

  return (
    <header style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "14px 32px", borderBottom: "1px solid var(--border)",
      background: "var(--surface)", position: "sticky", top: 0, zIndex: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <Link to="/" style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.5px", textDecoration: "none", color: "var(--white)" }}>
          Antí<span style={{ color: "var(--teal)" }}>Jitter</span>
        </Link>
        <nav style={{ display: "flex", gap: 4 }}>
          {[
            { to: "/jitter-test", label: "Jitter Test" },
            { to: "/games",       label: "Games" },
          ].map(({ to, label }) => (
            <Link key={to} to={to} style={{
              fontSize: 13, fontWeight: 600, textDecoration: "none",
              padding: "5px 12px", borderRadius: 99,
              color:      active(to) ? "var(--teal)"  : "var(--dim)",
              background: active(to) ? "rgba(0,200,215,0.10)" : "transparent",
            }}>
              {label}
            </Link>
          ))}
        </nav>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Link to="/login" style={{ fontSize: 13, fontWeight: 600, color: "var(--dim)", textDecoration: "none" }}>
          Log in
        </Link>
        <Link to="/register" style={{
          fontSize: 13, fontWeight: 700, textDecoration: "none",
          padding: "7px 18px", borderRadius: 99,
          background: "var(--teal)", color: "#000",
        }}>
          Get started
        </Link>
      </div>
    </header>
  );
}
