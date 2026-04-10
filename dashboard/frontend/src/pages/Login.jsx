import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthPage title="Welcome back">
      <form onSubmit={handleSubmit}>
        <Field label="Email" type="email" value={email} onChange={setEmail} />
        <Field label="Password" type="password" value={password} onChange={setPassword} />
        {error && <ErrorMsg>{error}</ErrorMsg>}
        <SubmitBtn loading={loading}>Sign in</SubmitBtn>
      </form>
      <p style={{ textAlign: "center", marginTop: 20, fontSize: 13, color: "var(--dim)" }}>
        No account?{" "}
        <Link to="/register" style={{ color: "var(--teal)" }}>
          Create one
        </Link>
      </p>
    </AuthPage>
  );
}


// ── Shared auth-page primitives ───────────────────────────────────────────────

export function AuthPage({ title, children }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--black)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div style={{ marginBottom: 32, textAlign: "center" }}>
        <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.5px" }}>
          Antí<span style={{ color: "var(--teal)" }}>Jitter</span>
        </span>
        <p style={{ marginTop: 8, color: "var(--dim)", fontSize: 14 }}>Dead calm gaming.</p>
      </div>

      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          padding: "32px 36px",
          width: "100%",
          maxWidth: 380,
        }}
      >
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, type, value, onChange }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 12, color: "var(--dim)", marginBottom: 6 }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        style={{
          width: "100%",
          padding: "11px 14px",
          background: "#1c1c1e",
          border: "1px solid var(--border)",
          borderRadius: 8,
          color: "var(--white)",
          fontSize: 14,
          outline: "none",
          fontFamily: "inherit",
        }}
      />
    </div>
  );
}

export function ErrorMsg({ children }) {
  return (
    <p
      style={{
        fontSize: 13,
        color: "var(--red)",
        background: "rgba(255,69,58,0.08)",
        border: "1px solid rgba(255,69,58,0.2)",
        borderRadius: 6,
        padding: "8px 12px",
        marginBottom: 14,
      }}
    >
      {children}
    </p>
  );
}

export function SubmitBtn({ loading, children }) {
  return (
    <button
      type="submit"
      disabled={loading}
      style={{
        width: "100%",
        padding: "13px",
        background: loading ? "rgba(0,200,215,0.4)" : "var(--teal)",
        color: "#000",
        border: "none",
        borderRadius: 8,
        fontWeight: 700,
        fontSize: 14,
        cursor: loading ? "not-allowed" : "pointer",
        fontFamily: "inherit",
        marginTop: 4,
      }}
    >
      {loading ? "…" : children}
    </button>
  );
}
